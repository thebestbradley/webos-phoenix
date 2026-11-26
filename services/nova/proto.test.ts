// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Pairing and the pinned-key TLS (docs/DEV-PUSH.md 6.4): SPAKE2 (lib/pake.js)
// against RFC 9382's test vectors; novad's TLS server (lib/proto.js) over a
// fake root with a computer pairing over TLS 1.3 with the six-digit code;
// wrong codes and the five runs a window allows; a computer that is not
// paired, a device whose key is not the pinned one; and someone in the
// middle during pairing, who gets one guess per run and nothing to test
// codes against offline.

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const pake = require("./lib/pake.js") as Any;
const keys = require("./lib/keys.js") as Any;
const proto = require("./lib/proto.js") as Any;
const nova = require("./novaservice.js") as Any;
const { createFakeSystem } = require("./test/fake-system.cjs") as Any;
const h = require("./test/helpers.cjs") as Any;
const VECTORS = (require("./test/rfc9382-vectors.json") as Any).vectors;
const p256 = require("@noble/curves/p256").p256;

vi.setConfig({ testTimeout: 30_000 });

describe("SPAKE2 (RFC 9382, SPAKE2-P256-SHA256-HKDF-HMAC)", () => {
    for (const v of VECTORS) {
        it(`matches the RFC's test vector A='${v.A}', B='${v.B}'`, () => {
            const w = BigInt("0x" + v.w);
            const a = pake.party("A", { w, x: BigInt("0x" + v.x), A: v.A, B: v.B });
            const b = pake.party("B", { w, x: BigInt("0x" + v.y), A: v.A, B: v.B });
            expect(a.start().toString("hex")).toBe(v.pA);
            expect(b.start().toString("hex")).toBe(v.pB);
            const ra = a.finish(b.start()), rb = b.finish(a.start());
            expect(ra.K.toString("hex")).toBe(v.K);
            expect(ra.TT.toString("hex")).toBe(v.TT);
            expect(ra.Ke.toString("hex")).toBe(v.Ke);
            expect(ra.confirm.toString("hex")).toBe(v["A conf"]);
            expect(rb.confirm.toString("hex")).toBe(v["B conf"]);
            expect(a.verify(rb.confirm) && b.verify(ra.confirm)).toBe(true);
        });
    }
    it("refuses an element that is not on the curve, or the identity", () => {
        const a = pake.party("A", { w: 5n, A: "a", B: "b" });
        const bad = Buffer.from(a.start());
        bad[40] ^= 1;
        expect(() => a.finish(bad)).toThrow(/point/);
        const b = pake.party("A", { w: 5n, A: "a", B: "b" });
        expect(() => b.finish(Buffer.from([0]))).toThrow();
    });
    it("two runs with different codes disagree", () => {
        const a = pake.party("A", { code: "123456", salt: "s", A: "a", B: "b" });
        const b = pake.party("B", { code: "123457", salt: "s", A: "a", B: "b" });
        const ra = a.finish(b.start()), rb = b.finish(a.start());
        expect(a.verify(rb.confirm)).toBe(false);
        expect(b.verify(ra.confirm)).toBe(false);
    });
});

describe("pairing and pinned keys over TLS 1.3", () => {
    let dev: Any, core: Any, srv: Any, port: number, computer: Any;
    beforeEach(async () => {
        dev = h.makeRoot();
        const sys = createFakeSystem(dev.root);
        core = nova.createNova({ root: dev.root, run: sys.run, whiteout: sys.whiteout });
        srv = proto.createServer(core, { host: "127.0.0.1", port: 0, name: "Test device" });
        port = await srv.listening;
        computer = keys.generate("nova");
    });
    afterEach(async () => { core.pairCancel(); await srv.close(); fs.rmSync(dev.root, { recursive: true, force: true }); });

    const connect = (expect?: string, key = computer) => proto.connect({ host: "127.0.0.1", port, key, expect: expect || null });
    async function pairOnce(code: string, key = computer) {
        const c = await connect(undefined, key);
        try { return await proto.pair(c, { code, key, name: "Laptop" }); } finally { c.close(); }
    }

    it("pairs with the code the device shows, then only with both keys pinned", async () => {
        const c0 = await connect();
        const hello = await c0.request({ op: "hello" });
        expect(hello).toMatchObject({ device: "Test device", paired: false, build: h.BUILD, devMode: true });
        await expect(c0.request({ op: "status" })).rejects.toMatchObject({ code: "NOT_PAIRED" });
        await expect(c0.request({ op: "pair", pA: "x" })).rejects.toMatchObject({ code: "NOT_PAIRING" });
        c0.close();

        const { code, fingerprint } = core.pairStart();
        const r = await pairOnce(code);
        expect(r.fingerprint).toBe(fingerprint);
        expect(core.paired()).toMatchObject([{ key: computer.publicKey, name: "Laptop" }]);
        expect(core.status().pairing).toBeNull();

        const c = await connect(r.deviceKey);
        expect((await c.request({ op: "status" })).status.paired).toBe(1);
        const got = await c.request({ op: "get", path: "/usr/share/phoenix/qml/Phoenix/Shell/CardView.qml" });
        expect(got.data.toString()).toBe(h.IMAGE["/usr/share/phoenix/qml/Phoenix/Shell/CardView.qml"]);
        await expect(c.request({ op: "get", path: "/etc/shadow" })).rejects.toMatchObject({ code: "BAD_PARAMS" });
        c.close();

        // Another computer is not let in by this one's pairing; a device
        // with another key is not taken for the paired one.
        const other = keys.generate("other");
        const c2 = await connect(r.deviceKey, other);
        await expect(c2.request({ op: "status" })).rejects.toMatchObject({ code: "NOT_PAIRED" });
        c2.close();
        await expect(connect(keys.generate("impostor").publicKey)).rejects.toMatchObject({ code: "WRONG_DEVICE_KEY" });
    });

    it("a wrong code fails the run; five failed runs end the window; a code is not used twice", async () => {
        const { code } = core.pairStart();
        const wrong = code === "000000" ? "000001" : "000000";
        for (let i = 0; i < 4; i++) await expect(pairOnce(wrong)).rejects.toMatchObject({ code: "WRONG_CODE" });
        expect(core.status().pairing.runsLeft).toBe(1);
        await expect(pairOnce(wrong)).rejects.toMatchObject({ code: "WRONG_CODE" });
        // The window is gone, the right code too.
        await expect(pairOnce(code)).rejects.toMatchObject({ code: expect.stringMatching(/NOT_PAIRING|PAIRING_CLOSED/) });
        expect(core.paired()).toEqual([]);

        const again = core.pairStart();
        await pairOnce(again.code);
        await expect(pairOnce(again.code, keys.generate("second"))).rejects.toMatchObject({ code: "NOT_PAIRING" });
    });

    it("a run left unfinished counts as one", async () => {
        const { code } = core.pairStart();
        const c = await connect();
        const a = pake.party("A", { code: "999999", salt: "x", A: "a", B: "b", aad: c.exporter() });
        await c.request({ op: "pair", pA: a.start().toString("base64") });
        c.close();
        expect(core.status().pairing.runsLeft).toBe(4);
        await pairOnce(code);
        expect(core.paired()).toHaveLength(1);
    });

    // Someone between the computer and the device during pairing: a TLS
    // server to the computer and a TLS client to the device, each with its
    // own key, passing the pairing messages along unchanged. Each side binds
    // its run to the keys and the connection it sees, so neither run
    // completes, and each is one of the device's five.
    it("someone in the middle who passes the messages on makes the run fail", async () => {
        const mitmKey = keys.generate("mitm");
        const mitm = tls.createServer({ key: mitmKey.pem, cert: mitmKey.cert, requestCert: true, rejectUnauthorized: false, minVersion: "TLSv1.3" },
            (down: Any) => {
                const up = tls.connect({ host: "127.0.0.1", port, key: mitmKey.pem, cert: mitmKey.cert, rejectUnauthorized: false,
                                         checkServerIdentity: () => undefined, minVersion: "TLSv1.3" });
                down.pipe(up);
                up.pipe(down);
                down.on("error", () => up.destroy());
                up.on("error", () => down.destroy());
            });
        await new Promise<void>((r) => mitm.listen(0, "127.0.0.1", () => r()));
        const mport = (mitm.address() as Any).port;
        const { code } = core.pairStart();
        const c = await proto.connect({ host: "127.0.0.1", port: mport, key: computer, expect: null });
        await expect(proto.pair(c, { code, key: computer, name: "Laptop" })).rejects.toMatchObject({ code: "WRONG_CODE" });
        c.close();
        expect(core.paired()).toEqual([]);
        expect(core.status().pairing.runsLeft).toBe(4);
        mitm.close();
    });

    // Someone posing as the computer to the real device: the device's answer
    // (pB, and its confirmation cB, a MAC that depends on the code) is all a
    // run gives. Testing codes against it needs the element the run committed
    // to (pA = x*P + w'*M): only the code w' it guessed can match, so each run
    // tests one code, and testing other codes offline against what was seen
    // fails, the right one included.
    it("someone posing as the computer gets one guess per run, nothing to test other codes against", async () => {
        const { code } = core.pairStart();
        const attacker = keys.generate("attacker");
        const guess = code === "111111" ? "222222" : "111111";
        const c = await connect(undefined, attacker);
        const ids = nova.pairIdentities(attacker.publicKey, c.deviceKey);
        const x = 0x1234567890abcdefn;
        const aad = c.exporter();
        const a = pake.party("A", { code: guess, salt: ids.salt, A: ids.A, B: ids.B, aad, x });
        const pA = a.start();
        const r = await c.request({ op: "pair", pA: pA.toString("base64") });
        c.close();
        const pB = Buffer.from(r.pB, "base64"), cB = Buffer.from(r.confirm, "base64");
        // Offline: every candidate code, the device's own among them.
        const candidates = [code, guess, "000000", "123456", "999999", "424242"];
        const matches = candidates.filter((cand) => {
            const w = pake.passwordScalar(cand, ids.salt);
            const P = p256.ProjectivePoint;
            const K = P.fromHex(pB.toString("hex")).subtract(pake.N.multiply(w)).multiply(x);
            const ks = pake.keySchedule(ids.A, ids.B, pA, pB, Buffer.from(K.toRawBytes(false)), w, aad);
            return crypto.timingSafeEqual(ks.cB, cB);
        });
        expect(matches).toEqual([]);
        expect(core.status().pairing.runsLeft).toBe(4);
        // The same attack with the right code (the one guess) would match:
        // the check above is a real test, not one that can never succeed.
        const c3 = await connect(undefined, attacker);
        const right = pake.party("A", { code, salt: ids.salt, A: ids.A, B: ids.B, aad: c3.exporter(), x });
        const r3 = await c3.request({ op: "pair", pA: right.start().toString("base64") });
        right.finish(Buffer.from(r3.pB, "base64"));
        expect(right.verify(Buffer.from(r3.confirm, "base64"))).toBe(true);
        c3.close();
    });

    // Someone posing as the device to the computer: the computer checks the
    // device's confirmation before it sends its own, so a false device gets
    // pA and nothing else: no MAC to test a code against.
    it("someone posing as the device gets nothing from the computer to test codes against", async () => {
        const fakeKey = keys.generate("fake device");
        const seen: Any[] = [];
        const fake = tls.createServer({ key: fakeKey.pem, cert: fakeKey.cert, requestCert: true, rejectUnauthorized: false, minVersion: "TLSv1.3" },
            (s: Any) => {
                const f = proto.frames(s);
                (async () => {
                    for (;;) {
                        const m = await f.next();
                        seen.push(m.json);
                        if (m.json.op === "pair") {
                            const ids = nova.pairIdentities(keys.peerKey(s.getPeerX509Certificate()), fakeKey.publicKey);
                            const b = pake.party("B", { code: "555555", salt: ids.salt, A: ids.A, B: ids.B,
                                                        aad: s.exportKeyingMaterial(32, proto.EXPORTER_LABEL) });
                            const rb = b.finish(Buffer.from(m.json.pA, "base64"));
                            f.send({ ok: true, pB: b.start().toString("base64"), confirm: rb.confirm.toString("base64") });
                        }
                    }
                })().catch(() => {});
            });
        await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
        const c = await proto.connect({ host: "127.0.0.1", port: (fake.address() as Any).port, key: computer, expect: null });
        await expect(proto.pair(c, { code: "123456", key: computer, name: "Laptop" })).rejects.toMatchObject({ code: "WRONG_CODE" });
        c.close();
        await new Promise((r) => setTimeout(r, 50));
        expect(seen.map((m) => m.op)).toEqual(["pair"]);
        expect(Object.keys(seen[0]).sort()).toEqual(["name", "op", "pA"]);
        fake.close();
    });

    it("pushes over the pinned connection, with progress, and forwards only the allowed ports", async () => {
        const { code } = core.pairStart();
        const { deviceKey } = await pairOnce(code);
        const b = await h.makeBundle({ key: computer, files: [{ path: "/usr/share/phoenix/qml/Phoenix/Shell/CardView.qml", data: "pushed" }] });
        const c = await connect(deviceKey);
        const progress: Any[] = [];
        const r = await c.request({ op: "push", signature: b.signature }, b.bytes, (m: Any) => progress.push(m));
        expect(r.result).toMatchObject({ waiting: false, files: 1, restarted: [{ what: "shell", ok: true }] });
        expect(progress.map((p) => p.progress.step)).toEqual(["write", "restart"]);
        expect(dev.read("/usr/share/phoenix/qml/Phoenix/Shell/CardView.qml")).toBe("pushed");
        await expect(c.request({ op: "forward", port: 8080 })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
        const st = (await c.request({ op: "status" })).status;
        expect(st.files.map((f: Any) => f.path)).toEqual(["/usr/share/phoenix/qml/Phoenix/Shell/CardView.qml"]);
        c.close();
    });

    it("a computer whose key a signed revocation list names loses its open connections and is refused at the next", async () => {
        const { code } = core.pairStart();
        const { deviceKey } = await pairOnce(code);
        const c = await connect(deviceKey);
        expect((await c.request({ op: "status" })).status.paired).toBe(1);
        const closed = new Promise<void>((r) => c.socket.once("close", () => r()));
        const list = h.revocations(dev.master, 1, { keys: [computer.id] });
        expect((await core.methods.setRevocations(list)).returnValue).toBe(true);
        await closed;
        const c2 = await connect(deviceKey);
        await expect(c2.request({ op: "luna", uri: "luna://com.example/x" })).rejects.toBeTruthy();
        c2.close();
        expect(core.paired()).toEqual([]);
    });

    // ---- Bounded output and unauthenticated connections ----

    // A raw TLS connection with a key, for frames the client library would
    // not send (several requests without reading the answers).
    function raw(key = computer, at = port): Promise<Any> {
        return new Promise((resolve, reject) => {
            const s = tls.connect({ host: "127.0.0.1", port: at, key: key.pem, cert: key.cert, rejectUnauthorized: false,
                                    checkServerIdentity: () => undefined, minVersion: "TLSv1.3" }, () => resolve(s));
            s.on("error", reject);
        });
    }
    function frame(kind: string, payload: Buffer) {
        const hd = Buffer.alloc(5);
        hd[0] = kind.charCodeAt(0);
        hd.writeUInt32BE(payload.length, 1);
        return Buffer.concat([hd, payload]);
    }
    const req = (o: Any) => frame("J", Buffer.from(JSON.stringify(o)));
    function closedWithin(s: Any, ms: number): Promise<boolean> {
        if (s.destroyed) return Promise.resolve(true);
        return new Promise((resolve) => {
            const t = setTimeout(() => resolve(false), ms);
            s.once("close", () => { clearTimeout(t); resolve(true); });
        });
    }
    // The device's end of each connection, to see what it holds for it.
    function deviceSockets(server: Any = srv) {
        const out: Any[] = [];
        server.server.on("secureConnection", (s: Any) => out.push(s));
        return out;
    }

    it("stops answering a paired computer that does not read, holding one answer at most, and sends them all once it reads", async () => {
        const { code } = core.pairStart();
        await pairOnce(code);
        const BIG = "/usr/share/phoenix/qml/Phoenix/Shell/Big.qml";
        dev.write(BIG, "x".repeat(1 << 20));
        const held = deviceSockets();
        const s = await raw();
        const f = proto.frames(s);
        s.pause();      // the computer reads nothing
        const N = 40;
        for (let i = 0; i < N; i++) s.write(req({ op: "get", path: BIG }));
        let peak = 0;
        const t0 = Date.now();
        while (Date.now() - t0 < 1500) {
            await new Promise((r) => setTimeout(r, 25));
            peak = Math.max(peak, held[0] ? held[0].writableLength : 0);
        }
        // 40 MB of answers before; now one 1 MB answer and its header.
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThan(3 << 20);
        s.resume();
        for (let i = 0; i < N; i++) {
            const m = await f.next();
            expect(m.json).toMatchObject({ ok: true, bytes: 1 << 20 });
            expect((await f.next()).bytes.length).toBe(1 << 20);
        }
        s.destroy();
    });

    it("closes an unpaired computer that keeps asking without reading", async () => {
        const held = deviceSockets();
        const s = await raw(keys.generate("flood"));
        s.pause();
        const many = Buffer.concat(Array.from({ length: 5000 }, () => req({ op: "hello" })));
        s.write(many);
        // The device's end (the computer's, paused, does not see it until it reads).
        await new Promise((r) => setTimeout(r, 200));
        expect(await closedWithin(held[0], 5000)).toBe(true);
        s.destroy();
    });

    it("takes no bytes and no big message before pairing", async () => {
        const hd = Buffer.alloc(5);
        hd[0] = 0x42;
        hd.writeUInt32BE(50 << 20, 1);
        const s2 = await raw(keys.generate("stranger 2"));
        s2.write(Buffer.concat([hd, Buffer.alloc(1 << 20)]));
        expect(await closedWithin(s2, 3000)).toBe(true);
        const s3 = await raw(keys.generate("stranger 3"));
        s3.write(req({ op: "hello", pad: "y".repeat(200 * 1024) }));
        expect(await closedWithin(s3, 3000)).toBe(true);
    });

    it("bounds unpaired connections: so many at once, and each for a while; a paired computer still gets in", async () => {
        const { code } = core.pairStart();
        const { deviceKey } = await pairOnce(code);
        const srv2 = proto.createServer(core, { host: "127.0.0.1", port: 0, name: "Test device", limits: { unauthMax: 2, unauthMs: 600 } });
        const port2 = await srv2.listening;
        try {
            const a = await raw(keys.generate("a"), port2), b = await raw(keys.generate("b"), port2);
            await new Promise((r) => setTimeout(r, 50));
            const c = await raw(keys.generate("c"), port2);
            expect(await closedWithin(c, 1000)).toBe(true);
            expect(a.destroyed || b.destroyed).toBe(false);
            const p = await proto.connect({ host: "127.0.0.1", port: port2, key: computer, expect: deviceKey });
            expect((await p.request({ op: "status" })).status.paired).toBe(1);
            expect(await closedWithin(a, 2000)).toBe(true);
            expect(await closedWithin(b, 500)).toBe(true);
            // The paired one is not timed out.
            expect((await p.request({ op: "status" })).status.paired).toBe(1);
            p.close();
        } finally { await srv2.close(); }
    });

    // ---- A computer no longer authorized loses its open streams ----

    it("a forward (the inspector, the QML debugger) ends when its computer is removed or Developer Mode goes off", async () => {
        const echo = net.createServer((x) => x.pipe(x));
        await new Promise<void>((r) => echo.listen(0, "127.0.0.1", () => r()));
        const srv2 = proto.createServer(core, { host: "127.0.0.1", port: 0, name: "Test device", limits: { recheckMs: 100 },
                                                connect: () => net.connect((echo.address() as Any).port, "127.0.0.1") });
        const port2 = await srv2.listening;
        async function stream(deviceKey: string) {
            const c = await proto.connect({ host: "127.0.0.1", port: port2, key: computer, expect: deviceKey });
            await c.request({ op: "forward", port: 9998 });
            c.detach();
            c.socket.resume();
            const got = new Promise<string>((r) => c.socket.once("data", (d: Buffer) => r(d.toString())));
            c.socket.write("ping");
            expect(await got).toBe("ping");
            return c;
        }
        try {
            let { deviceKey } = await pairOnce(core.pairStart().code);
            const c = await stream(deviceKey);
            expect((await core.methods.removeKey({ key: computer.id })).removed).toBe("paired");
            expect(await closedWithin(c.socket, 2000)).toBe(true);

            ({ deviceKey } = await pairOnce(core.pairStart().code));
            const c2 = await stream(deviceKey);
            fs.rmSync(dev.root + "/var/luna/dev-mode-enabled");
            expect(await closedWithin(c2.socket, 2000)).toBe(true);
        } finally { await srv2.close(); echo.close(); }
    });

    it("nova unpair still gets its answer before its connection closes", async () => {
        const { deviceKey } = await pairOnce(core.pairStart().code);
        const c = await connect(deviceKey);
        await expect(c.request({ op: "unpair" })).resolves.toMatchObject({ ok: true });
        expect(core.paired()).toEqual([]);
        expect(await closedWithin(c.socket, 2000)).toBe(true);
    });

    it("answers only hello with Developer Mode off", async () => {
        const { code } = core.pairStart();
        const { deviceKey } = await pairOnce(code);
        fs.rmSync(dev.root + "/var/luna/dev-mode-enabled");
        const c = await connect(deviceKey);
        expect((await c.request({ op: "hello" })).devMode).toBe(false);
        await expect(c.request({ op: "status" })).rejects.toMatchObject({ code: "NEEDS_DEVMODE" });
        c.close();
    });

    it("takes private addresses only for Push over network", () => {
        for (const a of ["10.1.2.3", "192.168.1.23", "172.16.42.1", "169.254.1.1", "127.0.0.1", "::1", "fe80::1", "fd00::5", "::ffff:192.168.0.2"]) {
            expect(proto.isPrivate(a), a).toBe(true);
        }
        for (const a of ["8.8.8.8", "172.32.0.1", "2001:db8::1", "::ffff:1.1.1.1"]) expect(proto.isPrivate(a), a).toBe(false);
    });
});

describe("the keys' self-signed certificates (lib/keys.js)", () => {
    // A serial whose first byte was 0 once made one certificate in 128 that
    // OpenSSL refused ("illegal padding": DER integers are minimal).
    it("are valid DER that TLS takes, whatever the serial", () => {
        for (let i = 0; i < 600; i++) {
            const k = keys.generate("x");
            const cert = new crypto.X509Certificate(k.cert);
            expect(keys.peerKey(cert)).toBe(k.publicKey);
            tls.createSecureContext({ key: k.pem, cert: k.cert });
        }
    });
});
