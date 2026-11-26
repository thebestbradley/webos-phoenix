// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The nova command against a device (docs/DEV-PUSH.md 6.1): its main()
// talking to novad (services/nova) over TLS on 127.0.0.1, the device a fake
// root (services/nova/test). pair with the code, devices, put, get, status,
// revert, restart, rescan, luna-send, log, forward, unpair; device
// selection and its errors in plain words; and nova push -d sim against
// the simulator's novad (services/nova/sim.js) over a small checkout.

import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const nova = require("./nova.cjs") as Any;
const remote = require("./lib/remote.cjs") as Any;
const devices = require("./lib/devices.cjs") as Any;
const novad = require("../../services/nova/novaservice.js") as Any;
const proto = require("../../services/nova/lib/proto.js") as Any;
const sim = require("../../services/nova/sim.js") as Any;
const { createFakeSystem } = require("../../services/nova/test/fake-system.cjs") as Any;
const h = require("../../services/nova/test/helpers.cjs") as Any;

vi.setConfig({ testTimeout: 60_000 });

const QML = "/usr/share/phoenix/qml/Phoenix/Shell/CardView.qml";
let config: string, dev: Any, core: Any, srv: Any, port: number, sys: Any, echo: net.Server, echoPort: number;
const savedXdg = process.env.XDG_CONFIG_HOME;

async function run(...argv: string[]) {
    const out: string[] = [], err: string[] = [], bytes: Buffer[] = [];
    const code = await nova.main(argv, { log: (t: string) => out.push(t), err: (t: string) => err.push(t), write: (b: Buffer) => bytes.push(Buffer.from(b)) });
    return { code, out: out.join("\n"), err: err.join("\n"), bytes: Buffer.concat(bytes) };
}

beforeAll(async () => {
    echo = net.createServer((s) => s.pipe(s));
    await new Promise<void>((r) => echo.listen(0, "127.0.0.1", () => r()));
    echoPort = (echo.address() as Any).port;
});
afterAll(() => { echo.close(); process.env.XDG_CONFIG_HOME = savedXdg; });

beforeEach(async () => {
    config = fs.mkdtempSync(path.join(os.tmpdir(), "nova-config-"));
    process.env.XDG_CONFIG_HOME = config;
    dev = h.makeRoot();
    sys = createFakeSystem(dev.root);
    core = novad.createNova({ root: dev.root, run: sys.run, whiteout: sys.whiteout,
                              luna: { call: async (uri: string) => (/running$/.test(uri) ? { returnValue: true, running: [] } : { returnValue: true }) } });
    srv = proto.createServer(core, {
        host: "127.0.0.1", port: 0, name: "Test phone",
        luna: async (uri: string, params: Any) => ({ returnValue: true, uri, params }),
        log: (follow: boolean, filter: string, onLine: Any, onEnd: Any) => {
            onLine({ time: "2026-11-26T12:00:00.000Z", unit: "webapp-mgr.service", message: "hello from " + (filter || "everyone") });
            setTimeout(() => onEnd(null), 10);
            return () => {};
        },
        connect: (p: number) => net.connect(p === 22 ? echoPort : 1, "127.0.0.1"),
    });
    port = await srv.listening;
});
afterEach(async () => {
    core.pairCancel();
    await srv.close();
    fs.rmSync(dev.root, { recursive: true, force: true });
    fs.rmSync(config, { recursive: true, force: true });
});

async function pairIt(as = "phone") {
    const { code } = core.pairStart();
    return run("pair", `127.0.0.1:${port}`, "--code", code, "--as", as, "--name", "Laptop");
}

describe("nova with a device", () => {
    it("pairs with the code the device shows, and says so in plain words when it is wrong", async () => {
        const { code } = core.pairStart();
        const wrong = await run("pair", `127.0.0.1:${port}`, "--code", code === "123456" ? "654321" : "123456");
        expect(wrong.code).toBe(1);
        expect(wrong.err).toMatch(/not the one the device shows/);
        const r = await run("pair", `127.0.0.1:${port}`, "--code", code, "--as", "phone", "--name", "Laptop");
        expect(r.code).toBe(0);
        expect(r.out).toContain(`Paired with Test phone as "phone" (device key ${core.deviceKey().fingerprint})`);
        expect(core.paired()).toMatchObject([{ name: "Laptop" }]);
        const list = await run("devices");
        expect(list.out).toMatch(/phone \*\s+127\.0\.0\.1: build 20261124093012, Developer Mode on/);
    });

    it("needs a pairing first, and names the device it means", async () => {
        expect((await run("status")).err).toMatch(/No device is paired with this computer: nova pair ADDRESS/);
        const r = await run("status", "-d", `127.0.0.1:${port}`);
        expect(r.err).toMatch(/not paired with 127\.0\.0\.1:\d+.*nova pair/);
        expect((await run("status", "-d", "nosuch")).err).toMatch(/No paired device is called nosuch/);
        expect((await run("push", "-d", "sim")).err).toMatch(/No simulator is running with dev push/);
    });

    it("put, get, status, revert, with the device's answers", async () => {
        await pairIt();
        const file = path.join(config, "Card.qml");
        fs.writeFileSync(file, "// put from the computer\n");
        const put = await run("put", QML, file, "--note", "One file");
        expect(put.code).toBe(0);
        expect(put.out).toMatch(/Applied [0-9a-f]{32}: 1 files, 0 removed/);
        expect(put.out).toContain("restarted shell");
        expect(dev.read(QML)).toBe("// put from the computer\n");
        const got = await run("get", QML);
        expect(got.bytes.toString()).toBe("// put from the computer\n");
        const st = await run("status");
        expect(st.out).toMatch(/1 files changed, 0 removed/);
        expect(st.out).toContain(QML);
        const back = await run("revert", QML);
        expect(back.out).toContain(`${QML} is the image's again`);
        expect(dev.read(QML)).toBe(h.IMAGE[QML]);
        expect((await run("put", "/etc/palm/phoenix/servers.json", file)).err).toMatch(/never changed by a bundle/);
        const all = await run("revert");
        expect(all.out).toMatch(/Revert to Image: phone restarts/);
        expect(sys.calls).toContain("systemctl reboot");
    });

    it("restart, rescan, luna-send and log", async () => {
        await pairIt();
        expect((await run("restart", "shell")).out).toBe("restarted shell");
        expect(sys.calls).toContain("systemctl restart luna-surfacemanager.service");
        expect((await run("restart", "app", "org.webosphoenix.settings")).out).toBe("restarted app:org.webosphoenix.settings");
        expect((await run("restart", "everything")).code).toBe(2);
        expect((await run("rescan")).out).toBe("Rescanned the apps");
        const l = await run("luna-send", "luna://com.palm.systemservice/time/getSystemTime", "{\"subscribe\":false}");
        expect(JSON.parse(l.out)).toMatchObject({ returnValue: true, uri: "luna://com.palm.systemservice/time/getSystemTime", params: { subscribe: false } });
        expect((await run("luna-send", "luna://x/y", "not json")).code).toBe(2);
        expect((await run("log", "-f", "org.webosphoenix.settings")).out).toContain("webapp-mgr.service: hello from org.webosphoenix.settings");
    });

    it("forwards only the allowed device-local ports, as a stream", async () => {
        await pairIt();
        expect((await run("forward", "8080")).code).toBe(2);
        const out = { log: () => {}, err: () => {} };
        const f = await remote.startForward({ device: undefined, key: undefined }, out, 22, 0);
        const sock = net.connect(f.port, "127.0.0.1");
        const got = await new Promise<string>((resolve) => {
            let buf = "";
            sock.on("data", (d) => { buf += d; if (buf.length >= 11) resolve(buf); });
            sock.write("hello world");
        });
        expect(got).toBe("hello world");
        sock.destroy();
        f.server.close();
    });

    it("unpair forgets the device here and there; a device with another key is not taken for it", async () => {
        await pairIt();
        expect((await run("unpair", "phone")).out).toBe("Unpaired phone");
        expect(core.paired()).toEqual([]);
        expect(devices.load().devices).toEqual([]);
        await pairIt();
        const d = devices.load();
        d.devices[0].key = h.makeRoot().master.publicKey;
        devices.save(d);
        expect((await run("status")).err).toMatch(/has another key .* than the one paired with it/);
    });
});

// A small checkout (as tools/test-nova-bundle.cjs makes one), the image the
// simulator runs, and a copy with changes that nova push sends.
function checkout(dir: string) {
    const w = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    w("runtime/rootfs.json", JSON.stringify({ mounts: { "/usr/share/phoenix/runtime/": "runtime/js/" }, applicationDirs: ["apps"], product: "product.json" }));
    w("product.json", JSON.stringify({ name: "webOS Phoenix", version: "1.0.0", releaseNotes: "release-notes.json" }));
    w("release-notes.json", JSON.stringify({ format: 1, versions: [{ version: "1.0.0", new: ["First."] }] }));
    w("runtime/js/phoenix-runtime.js", "// the runtime\n");
    w("apps/demo/appinfo.json", JSON.stringify({ id: "org.example.demo", version: "1.0.0", type: "web", title: "Demo", main: "index.html" }));
    w("apps/demo/index.html", "<html><head><title>Demo</title></head><body></body></html>\n");
    w("apps/demo/app.js", "// the app\n");
    w("shell/qml/Phoenix/Shell/Card.qml", "Item {}\n");
    w("shell/assets/images/dot.png", "PNG\n");
    for (const args of [["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "image"]]) {
        spawnSync("git", ["-C", dir, "-c", "user.name=test", "-c", "user.email=test@example.org"].concat(args));
    }
}

describe("nova -d sim", () => {
    it("pairs with the simulator's novad and pushes a checkout's changes into its overlay; Revert to Image clears it at its restart", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-sim-"));
        const image = path.join(tmp, "image"), work = path.join(tmp, "work"), data = path.join(tmp, "data");
        checkout(image);
        fs.cpSync(image, work, { recursive: true });
        fs.writeFileSync(path.join(work, "shell/qml/Phoenix/Shell/Card.qml"), "Item { id: pushed }\n");
        fs.writeFileSync(path.join(work, "apps/demo/app.js"), "// the app, changed\n");
        fs.mkdirSync(path.join(data, "var/luna"), { recursive: true });
        fs.writeFileSync(path.join(data, "var/luna/dev-mode-enabled"), "");
        let s = await sim.start({ data, repo: image, log: () => {} });
        try {
            const { code } = s.core.pairStart();
            expect((await run("pair", "-d", "sim", "--code", code)).out).toMatch(/Paired with webOS Phoenix simulator as "sim"/);
            const dry = await run("push", "-d", "sim", "--repo", work, "--dry-run");
            expect(dry.out).toMatch(/2 files, 0 removed .*restarts: app:org.example.demo, shell/);
            const p = await run("push", "-d", "sim", "--repo", work, "--note", "From the worktree");
            expect(p.code, p.err).toBe(0);
            const upper = path.join(data, "var/lib/phoenix/overlay/sim/upper");
            expect(fs.readFileSync(path.join(upper, "usr/share/phoenix/qml/Phoenix/Shell/Card.qml"), "utf8")).toBe("Item { id: pushed }\n");
            expect(fs.readFileSync(path.join(upper, "usr/palm/applications/org.example.demo/app.js"), "utf8")).toBe("// the app, changed\n");
            expect(fs.existsSync(path.join(data, "var/lib/phoenix/overlay/sim/active"))).toBe(true);
            await new Promise((r) => setTimeout(r, 120));
            const req = JSON.parse(fs.readFileSync(path.join(data, "var/luna/nova/restart.json"), "utf8"));
            expect(req.restart).toEqual(["app:org.example.demo", "shell"]);
            expect((await run("get", "-d", "sim", "/usr/share/phoenix/qml/Phoenix/Shell/Card.qml")).bytes.toString()).toBe("Item { id: pushed }\n");
            // The same again changes nothing; the image's checkout takes them all back.
            expect((await run("push", "-d", "sim", "--repo", work)).out).toMatch(/Applied/);
            const back = await run("push", "-d", "sim", "--repo", image);
            expect(back.out).toMatch(/This checkout is the image: 2 pushed changes on sim go back/);
            await new Promise((r) => setTimeout(r, 120));
            expect(JSON.parse(fs.readFileSync(path.join(data, "var/luna/nova/restart.json"), "utf8")).restart).toEqual(["reboot"]);
            await s.close();
            s = await sim.start({ data, repo: image, log: () => {} });
            expect(fs.existsSync(upper)).toBe(false);
            expect((await run("status", "-d", "sim")).out).toMatch(/No pushed changes/);
        } finally {
            await s.close();
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
