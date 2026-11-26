// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// nova's commands that talk to a device's novad (docs/DEV-PUSH.md 6.1):
// pair, unpair, devices, push, put, get, status, revert, restart, rescan,
// log, luna-send, forward and term, over org.webosphoenix.nova's protocol
// (services/nova/lib/proto.js: TLS 1.3 with both keys pinned, after pairing
// with the code the device shows).

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "../../..");
const proto = require(path.join(REPO, "services/nova/lib/proto.js"));
const tlsKeys = require(path.join(REPO, "services/nova/lib/keys.js"));
const devpush = require(path.join(REPO, "apps/shared/platform/src/devpush.js"));
const keys = require("./keys.cjs");
const devices = require("./devices.cjs");

function fail(code, text) { return Object.assign(new Error(text), { code }); }
function size(n) { return n < 1024 ? n + " B" : n < 1 << 20 ? (n / 1024).toFixed(1) + " KB" : (n / (1 << 20)).toFixed(1) + " MB"; }

// The computer's key as TLS wants it.
function myKey(a, out) {
    const key = keys.load(a.key);
    if (key.made && out) out.err(`Made this computer's nova key: ${key.file} (${key.fingerprint})`);
    return { key, tls: keys.forTls(key) };
}

// A connection to the device -d names, its key pinned. -> {conn, target, hello}
async function open(a, out) {
    const t = devices.select(a.device);
    if (!t.key) {
        throw fail("NOT_PAIRED", `This computer is not paired with ${t.name}${t.sim ? "" : " (" + t.address + ")"}: nova pair ${a.device || t.address}`);
    }
    const { key, tls } = myKey(a, out);
    const conn = await proto.connect({ host: t.address, port: t.port, key: tls, expect: t.key });
    const hello = await conn.request({ op: "hello" });
    if (!hello.paired) {
        conn.close();
        throw fail("NOT_PAIRED", `${t.name} no longer knows this computer (it was removed in Settings, or the device was erased): nova pair ${a.device || t.address}`);
    }
    if (!hello.devMode) {
        conn.close();
        throw fail("NEEDS_DEVMODE", `Developer Mode is off on ${t.name}: turn it on in Settings > Developer Mode`);
    }
    if (t.entry) devices.used(t.name);
    return { conn, target: t, hello, key };
}
async function withDevice(a, out, fn) {
    const d = await open(a, out);
    try { return await fn(d); } finally { d.conn.close(); }
}

// ---- pair, unpair, devices --------------------------------------------------------------

function ask(question) {
    return new Promise((resolve) => {
        const rl = require("readline").createInterface({ input: process.stdin, output: process.stderr });
        rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
    });
}

async function pair(a, out) {
    if (a._.length > 1) throw fail("USAGE", "nova pair [ADDRESS] [--code CODE] [--as NAME]");
    const sel = a._[0] || a.device;
    if (!sel) throw fail("USAGE", "nova pair ADDRESS (the device's address on the network; -d usb over USB; -d sim for the simulator)");
    const t = devices.select(sel);
    const { key, tls } = myKey(a, out);
    const conn = await proto.connect({ host: t.address, port: t.port, key: tls, expect: null });
    try {
        const hello = await conn.request({ op: "hello" });
        if (!hello.devMode) throw fail("NEEDS_DEVMODE", "Developer Mode is off on the device: turn it on in Settings > Developer Mode");
        out.err(`${hello.device} at ${t.address}, key ${hello.fingerprint}`);
        let code = a.code;
        if (!code) code = await ask("The code the device shows (Settings > Developer Mode > Pair a Computer): ");
        code = String(code).replace(/\s+/g, "");
        if (!/^\d{6}$/.test(code)) throw fail("USAGE", "The code is six digits");
        const name = a.name || require("os").hostname().split(".")[0] || "Computer";
        const r = await proto.pair(conn, { code, key: tls, name });
        const as = a.as || (t.sim ? t.name : hello.deviceId);
        devices.remember({ name: as, deviceId: hello.deviceId, key: r.deviceKey, fingerprint: r.fingerprint, address: t.address, port: t.port,
                           paired: new Date().toISOString(), lastUsed: null });
        out.log(`Paired with ${hello.device} as "${as}" (device key ${r.fingerprint}). Check it matches the one the device showed.`);
        return 0;
    } finally { conn.close(); }
}

async function unpair(a, out) {
    const name = a._[0] || a.device;
    if (!name) throw fail("USAGE", "nova unpair DEVICE");
    try {
        await withDevice(Object.assign({}, a, { device: name }), out, (d) => d.conn.request({ op: "unpair" }));
    } catch (e) {
        // A stopped simulator (NO_SIM) is offline too: it is forgotten here.
        if (e.code !== "UNREACHABLE" && e.code !== "NOT_PAIRED" && e.code !== "NO_SIM") throw e;
        out.err(`Could not tell the device (${e.message}); forgetting it here only. Remove this computer in its Settings > Developer Mode.`);
    }
    let known = name;
    if (!(name === "sim" || name.startsWith("sim:"))) {
        try { known = devices.select(name).name; } catch (e) { if (e.code !== "NO_SIM") throw e; }
    }
    if (!devices.forget(known)) out.err(`${name} was not paired here`);
    out.log(`Unpaired ${name}`);
    return 0;
}

async function listDevices(a, out) {
    const d = devices.load();
    const { tls } = myKey(a, null);
    const rows = [];
    async function probe(addr, port, expect) {
        try {
            const c = await proto.connect({ host: addr, port, key: tls, expect, timeout: 1500 });
            try { return await c.request({ op: "hello" }); } finally { c.close(); }
        } catch (e) { return { error: e.message }; }
    }
    for (const e of d.devices) {
        let addr = e.address, port = e.port;
        if (e.name === "sim" || e.name.startsWith("sim:")) {
            try { const s = devices.sim(e.name === "sim" ? null : e.name.slice(4)); addr = s.address; port = s.port; } catch (x) { rows.push([e.name, "not running", e.fingerprint]); continue; }
        }
        const h = await probe(addr, port, e.key);
        rows.push([e.name + (d.last === e.name ? " *" : ""), h.error ? "unreachable (" + addr + ")" :
                   `${addr}: build ${h.build}, Developer Mode ${h.devMode ? "on" : "off"}${h.paired ? "" : ", no longer paired"}`, e.fingerprint]);
    }
    for (const s of devices.listSims()) {
        const name = s.instance === "default" ? "sim" : "sim:" + s.instance;
        if (!d.devices.some((e) => e.name === name)) rows.push([name, `running (127.0.0.1:${s.port}), not paired: nova pair -d ${name}`, s.fingerprint]);
    }
    if (!d.devices.some((e) => e.address === devices.USB_ADDRESS)) {
        const h = await probe(devices.USB_ADDRESS, devices.PORT, null);
        if (!h.error) rows.push(["usb", `${h.device} on the USB link, not paired: nova pair -d usb`, h.fingerprint]);
    }
    if (!rows.length) { out.log("No devices. Pair one: nova pair ADDRESS (or -d usb, -d sim)"); return 0; }
    for (const r of rows) out.log(`${r[0].padEnd(24)} ${r[1]}\n${"".padEnd(24)} ${r[2]}`);
    return 0;
}

// ---- push, put --------------------------------------------------------------------------

// A repository path -> the device path prefix it installs to (nova push
// PATHS), for the common places; a device path is taken as it is.
function devicePrefix(repo, p) {
    if (p.startsWith("/")) return p;
    const rel = p.replace(/^\.\//, "").replace(/\/$/, "");
    const map = [["shell/qml", "/usr/share/phoenix/qml"], ["shell/assets", "/usr/share/phoenix/assets"], ["runtime", "/usr/share/phoenix/runtime"]];
    for (const [r, d] of map) if (rel === r || rel.startsWith(r + "/")) return d + rel.slice(r.length);
    let m = /^services\/([^/]+)(\/.*)?$/.exec(rel);
    if (m) {
        const pkg = JSON.parse(fs.readFileSync(path.join(repo, "services", m[1], "package.json"), "utf8"));
        return "/usr/palm/services/" + pkg.name + (m[2] || "");
    }
    m = /^apps\/([^/]+)(\/.*)?$/.exec(rel);
    if (m) {
        for (const f of ["appinfo.json", "public/appinfo.json"]) {
            try { return "/usr/palm/applications/" + JSON.parse(fs.readFileSync(path.join(repo, "apps", m[1], f), "utf8")).id; } catch (e) { /* next */ }
        }
    }
    throw fail("USAGE", `${p}: say the device path it installs to (for example /usr/palm/applications/<id>)`);
}

function printResult(out, r, name) {
    if (r.waiting) { out.log(`${name} keeps the bundle for its owner to apply (Settings > Developer Mode > Pushed Changes): ${r.id}`); return; }
    out.log(`Applied ${r.applied}: ${r.files} files, ${r.removed} removed${r.reverted ? ", " + r.reverted + " put back to the image's" : ""}`);
    for (const x of r.restarted || []) {
        out.log(x.what === "reboot" ? "  Restart the device to finish (Settings > Developer Mode > Restart Now)" :
                `  restarted ${x.what}${x.ok ? "" : ": FAILED (" + x.error + ")"}`);
    }
}
async function sendBundle(d, out, bytes, signature) {
    const r = await d.conn.request({ op: "push", signature }, bytes, (m) => {
        if (m.progress && m.progress.step === "restart") out.err(`  restarting ${m.progress.what}`);
    });
    printResult(out, r.result, d.target.name);
}

async function push(a, out) {
    const bundle = require("./bundle.cjs");
    return withDevice(a, out, async (d) => {
        const repo = a.repo ? path.resolve(a.repo) : bundle.REPO;
        const mf = await d.conn.request({ op: "manifest" });
        const manifest = JSON.parse(mf.data.toString("utf8"));
        const problems = bundle.checkImageManifest(manifest);
        if (problems.length) throw fail("BAD_MANIFEST", "The device's manifest is not valid: " + problems[0]);
        const only = a._.map((p) => devicePrefix(repo, p));
        const r = await bundle.makeSystemBundle({ repo, manifest, key: d.key, device: d.hello.deviceId, compatible: manifest.compatible || null,
                                                  mode: a.add ? "add" : "replace", note: a.note, only, allowCompiled: !!a["allow-compiled"],
                                                  log: (t) => out.err(t) });
        if (r.nothing) {
            if (a.add) { out.log("Nothing differs from the image: nothing to push."); return 0; }
            // Replace with nothing: what the overlay holds goes back.
            const st = (await d.conn.request({ op: "status" })).status;
            const held = st.files.length + st.removed.length;
            if (!held) { out.log("Nothing differs from the image, and the device holds no pushed changes."); return 0; }
            out.log(`This checkout is the image: ${held} pushed changes on ${d.target.name} go back (nova revert)`);
            if (a["dry-run"]) return 0;
            const back = await d.conn.request({ op: "revert" });
            out.log(back.result.restarting ? "The device restarts without them." : "Done.");
            return 0;
        }
        const m = r.manifest;
        out.log(`${m.files.length} files, ${m.removed.length} removed (${size(r.bytes.length)}); restarts: ${m.restart.join(", ")}`);
        for (const f of m.files) out.log("  " + f.path);
        for (const p of m.removed) out.log("  removed " + p);
        if (a["dry-run"]) { out.log("(dry run: nothing sent)"); return 0; }
        await sendBundle(d, out, r.bytes, r.signature);
        return 0;
    });
}

// One file as a bundle that adds to what the overlay holds (Palm's put).
async function makeFileBundle(hello, key, devicePath, data, mode, note) {
    const bundle = require("./bundle.cjs");
    const why = devpush.pathProblem(devicePath);
    if (why) throw fail("REFUSED_PATH", devicePath + ": " + why);
    const made = new Date();
    const m = {
        format: 1, id: "", made: made.toISOString().replace(/\.\d+Z$/, "Z"), build: hello.build, product: hello.product,
        compatible: hello.compatible || null, device: hello.deviceId, counter: made.getTime(), mode: "add",
        parts: devpush.partsFor([devicePath]),
        files: [{ path: devicePath, sha256: crypto.createHash("sha256").update(data).digest("hex"), size: data.length, mode: mode === 0o755 ? "0755" : "0644" }],
        removed: [], restart: devpush.restartsFor([devicePath]),
    };
    if (note) m.note = String(note).slice(0, 500);
    m.by = key.id;
    const rest = Object.assign({}, m);
    delete rest.id;
    m.id = crypto.createHash("sha256").update(bundle.canonical(rest)).digest("hex").slice(0, 32);
    const bytes = await bundle.writeBundle(m, [{ path: devicePath, data: new Uint8Array(data), mode: mode === 0o755 ? 0o755 : 0o644 }]);
    return { bytes, signature: keys.signDetached(bytes, key), manifest: m };
}

async function put(a, out) {
    if (a._.length !== 2) throw fail("USAGE", "nova put DEVICEPATH FILE");
    const [devicePath, file] = a._;
    const data = fs.readFileSync(file);
    const st = fs.statSync(file);
    return withDevice(a, out, async (d) => {
        const b = await makeFileBundle(d.hello, d.key, devicePath, data, st.mode & 0o111 ? 0o755 : 0o644, a.note);
        await sendBundle(d, out, b.bytes, b.signature);
        return 0;
    });
}

async function get(a, out) {
    if (a._.length < 1 || a._.length > 2) throw fail("USAGE", "nova get DEVICEPATH [FILE]");
    return withDevice(a, out, async (d) => {
        const r = await d.conn.request({ op: "get", path: a._[0] });
        if (a._[1]) { fs.writeFileSync(a._[1], r.data); out.err(`${a._[0]} -> ${a._[1]} (${size(r.data.length)})`); }
        else out.write(r.data);
        return 0;
    });
}

// ---- status, revert, restart, rescan -------------------------------------------------------

async function status(a, out) {
    return withDevice(a, out, async (d) => {
        const s = (await d.conn.request({ op: "status" })).status;
        if (a.json) { out.log(JSON.stringify(s, null, 1)); return 0; }
        out.log(`${d.target.name}: build ${s.build} (webOS Phoenix ${s.product}${s.compatible ? ", " + s.compatible : ""}), device ${s.deviceId}`);
        if (s.clearing) out.log("Revert to Image is waiting for the device to restart.");
        if (!s.files.length && !s.removed.length) { out.log("No pushed changes: the device runs its image."); return 0; }
        out.log(`${s.files.length} files changed, ${s.removed.length} removed, ${size(s.usage)} of ${size(s.cap)}${s.active ? "" : " (not mounted)"}`);
        for (const f of s.files) out.log(`  ${f.path}  (${f.name || f.kind}, ${f.at})`);
        for (const f of s.removed) out.log(`  removed ${f.path}  (${f.name || f.kind}, ${f.at})`);
        if (s.bundles.length) {
            out.log("Bundles:");
            for (const b of s.bundles) out.log(`  ${b.id.slice(0, 8)} ${b.applied} ${b.name || b.fingerprint} ${b.files} files${b.note ? ": " + b.note : ""}`);
        }
        if (s.pendingReboot) out.log("Restart the device to finish applying them.");
        if (s.waiting) out.log(`${s.waiting} bundles wait for the owner in Settings > Developer Mode.`);
        return 0;
    });
}

async function revert(a, out) {
    if (a._.length > 1) throw fail("USAGE", "nova revert [DEVICEPATH]");
    return withDevice(a, out, async (d) => {
        const r = (await d.conn.request({ op: "revert", path: a._[0] || undefined })).result;
        if (r.restarting) out.log(`Revert to Image: ${d.target.name} restarts and comes back as its image.`);
        else {
            out.log(`${r.reverted} is the image's again`);
            for (const x of r.restarted || []) out.log(`  restarted ${x.what}${x.ok ? "" : ": FAILED (" + x.error + ")"}`);
        }
        return 0;
    });
}

async function restart(a, out) {
    const [what, id] = a._;
    const target = what === "app" || what === "service" ? (id ? what + ":" + id : null) : what === "shell" || what === "wam" ? what : null;
    if (!target) throw fail("USAGE", "nova restart shell | wam | app ID | service ID");
    return withDevice(a, out, async (d) => {
        const r = (await d.conn.request({ op: "restart", what: target })).result;
        for (const x of r.restarted || []) out.log(`restarted ${x.what}${x.ok ? "" : ": FAILED (" + x.error + ")"}`);
        return 0;
    });
}

async function rescan(a, out) {
    return withDevice(a, out, async (d) => {
        const r = (await d.conn.request({ op: "rescan" })).result;
        const x = (r.restarted || [])[0];
        out.log(x && x.ok ? "Rescanned the apps" : "The device cannot rescan its apps live: restart it to pick them up");
        return 0;
    });
}

// ---- log, luna-send -------------------------------------------------------------------------

async function log(a, out) {
    if (a._.length > 1) throw fail("USAGE", "nova log [-f] [ID]");
    return withDevice(a, out, async (d) => {
        await d.conn.request({ op: "log", follow: !!a.follow, filter: a._[0] || null }, null, (m) => {
            if (!m.line) return;
            const l = m.line;
            out.log(`${(l.time || "").replace("T", " ").replace(/\.\d+Z$/, "")} ${l.unit || ""}: ${l.message}`);
        });
        return 0;
    });
}

async function lunaSend(a, out) {
    if (a._.length < 1 || a._.length > 2) throw fail("USAGE", "nova luna-send luna://SERVICE/METHOD [JSON]");
    let params = {};
    if (a._[1]) {
        try { params = JSON.parse(a._[1]); } catch (e) { throw fail("USAGE", "The parameters are not JSON: " + a._[1]); }
    }
    return withDevice(a, out, async (d) => {
        const r = await d.conn.request({ op: "luna", uri: a._[0], params });
        out.log(JSON.stringify(r.reply));
        return r.reply && r.reply.returnValue === false ? 1 : 0;
    });
}

// ---- forward, term ----------------------------------------------------------------------------

// A local port that reaches the device's PORT through novad (nova forward,
// docs/DEV-HELPER.md 9.1): one paired TLS connection per local connection.
// -> Promise<{server, port}>
async function startForward(a, out, port, localPort) {
    const t = devices.select(a.device);
    if (!t.key) throw fail("NOT_PAIRED", `This computer is not paired with ${t.name}: nova pair`);
    const { tls } = myKey(a, out);
    const server = net.createServer((local) => {
        local.pause();
        proto.connect({ host: t.address, port: t.port, key: tls, expect: t.key }).then((conn) => {
            return conn.request({ op: "forward", port }).then(() => {
                const rest = conn.detach();
                if (rest.length) local.write(rest);
                local.pipe(conn.socket);
                conn.socket.pipe(local);
                conn.socket.resume();
                local.resume();
                local.on("close", () => conn.close());
                conn.socket.on("close", () => local.destroy());
            });
        }).catch((e) => { out.err(`nova forward: ${e.message}`); local.destroy(); });
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(localPort === undefined ? port : localPort, "127.0.0.1", resolve);
    }).catch((e) => {
        if (e.code === "EADDRINUSE" && localPort === undefined) return new Promise((r) => server.listen(0, "127.0.0.1", r));
        throw e;
    });
    return { server, port: server.address().port, target: t };
}

async function forward(a, out) {
    const port = Number(a._[0]);
    if (!proto.FORWARD_PORTS[port]) {
        throw fail("USAGE", "nova forward PORT [--local N]: PORT is one of " +
                   Object.entries(proto.FORWARD_PORTS).map(([p, w]) => p + " (" + w + ")").join(", "));
    }
    const f = await startForward(a, out, port, a.local !== undefined ? Number(a.local) : undefined);
    out.log(`127.0.0.1:${f.port} reaches ${f.target.name}'s port ${port} (${proto.FORWARD_PORTS[port]}). Ctrl-C to stop.`);
    if (a.once) return new Promise((resolve) => f.server.once("connection", (s) => s.on("close", () => { f.server.close(); resolve(0); })));
    return new Promise(() => {});
}

// SSH as `user` with the paired key, through the forward of port 22
// (Developer Mode's SSH, TERMINAL.md T4).
async function term(a, out) {
    const key = keys.load(a.key);
    const f = await startForward(a, out, 22, 0);
    const known = path.join(keys.configDir(), "known_hosts");
    const args = ["-p", String(f.port), "-i", keys.sshKeyFile(key), "-o", "IdentitiesOnly=yes", "-o", "UserKnownHostsFile=" + known,
                  "-o", "HostKeyAlias=nova-" + (f.target.entry ? f.target.entry.deviceId : f.target.name), "-o", "StrictHostKeyChecking=accept-new",
                  "user@127.0.0.1"].concat(a._);
    return new Promise((resolve) => {
        const p = spawn(a.ssh || "ssh", args, { stdio: "inherit" });
        p.on("error", (e) => { out.err(`nova term: cannot run ssh (${e.message})`); f.server.close(); resolve(1); });
        p.on("close", (code) => { f.server.close(); resolve(code === null ? 1 : code); });
    });
}

module.exports = { pair, unpair, listDevices, push, put, get, status, revert, restart, rescan, log, lunaSend, forward, term, startForward,
                   makeFileBundle, devicePrefix };
