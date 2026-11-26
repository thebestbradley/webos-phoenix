// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// For the tests of org.webosphoenix.nova and nova: a fake device root (a
// temporary folder laid out like a device's /, with an image's files, its
// manifest and os-release), the platform's dev-signing key, dev bundles
// made the way nova makes them (tools/nova/lib/bundle.cjs writeBundle), and
// grant certificates and revocation lists signed as the platform would.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const devpush = require("@phoenix/platform/src/devpush");
const keys = require("../lib/keys");
const bundleLib = require("../../../tools/nova/lib/bundle.cjs");

const BUILD = "20261124093012";
const COMPATIBLE = "phoenix-pinephonepro";

// The image's files (path -> text), as an image built with them holds them.
const IMAGE = {
    "/usr/share/phoenix/qml/Phoenix/Shell/CardView.qml": "// the image's card view\n",
    "/usr/share/phoenix/qml/Phoenix/Shell/Shell.qml": "// the image's shell\n",
    "/usr/share/phoenix/runtime/phoenix-runtime.js": "// the image's runtime\n",
    "/usr/share/phoenix/product.json": "{\"name\": \"webOS Phoenix\", \"version\": \"1.0.0\"}\n",
    "/usr/palm/applications/org.webosphoenix.settings/appinfo.json": "{\"id\": \"org.webosphoenix.settings\"}\n",
    "/usr/palm/applications/org.webosphoenix.settings/index.js": "// the image's settings\n",
    "/usr/palm/applications/org.webosphoenix.settings/old.js": "// a file the image has\n",
    "/usr/palm/services/org.example.svc/service.js": "// the image's service\n",
    "/usr/share/luna-service2/roles.d/org.example.svc.role.json": "{}\n",
    "/usr/share/luna-service2/roles.d/org.webosphoenix.nova.role.json": "{\"image\": true}\n",
    "/etc/palm/db/kinds/org.example.kind": "{}\n",
    "/etc/palm/phoenix/servers.json": "{}\n",
};

function makeRoot(opts) {
    opts = opts || {};
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-root-"));
    const W = (p, data, mode) => {
        fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
        fs.writeFileSync(path.join(root, p), data, { mode: mode || 0o644 });
    };
    for (const [p, t] of Object.entries(IMAGE)) W(p, t);
    const master = opts.master || keys.generate("platform");
    W("/etc/palm/phoenix/servers.json", JSON.stringify({ devpush: { key: master.id } }));
    W("/etc/os-release", `NAME="webOS Phoenix"\nVERSION_ID=1.0.0\nBUILD_ID=${opts.build || BUILD}\n`);
    W("/usr/share/phoenix/manifest.json", JSON.stringify({
        format: 1, build: opts.build || BUILD, product: { name: "webOS Phoenix", version: "1.0.0", line: "1.0" }, compatible: COMPATIBLE,
        files: Object.keys(IMAGE).filter((p) => !devpush.pathProblem(p)).sort().map((p) => ({
            path: p, size: Buffer.byteLength(IMAGE[p]), sha256: crypto.createHash("sha256").update(IMAGE[p]).digest("hex"), mode: "0644" })),
    }));
    if (opts.devMode !== false) W("/var/luna/dev-mode-enabled", "");
    fs.mkdirSync(path.join(root, "home/user/.ssh"), { recursive: true });
    return { root, master, read: (p) => { try { return fs.readFileSync(path.join(root, p), "utf8"); } catch (e) { return null; } },
             write: W, exists: (p) => fs.existsSync(path.join(root, p)) };
}

let counter = 1795615380000;
// {key (keys.generate), files: [{path, data, mode?}], removed: [], mode,
// device, counter, build, product, compatible, note} -> {bytes, signature,
// manifest}
async function makeBundle(o) {
    const files = (o.files || []).map((f) => ({ path: f.path, data: new Uint8Array(Buffer.from(f.data)), mode: f.mode || 0o644 }));
    const removed = (o.removed || []).slice().sort();
    const paths = files.map((f) => f.path).concat(removed);
    const m = {
        format: 1, id: "", made: "2026-11-26T10:00:00Z", build: o.build || BUILD, product: o.product || "1.0",
        compatible: o.compatible === undefined ? COMPATIBLE : o.compatible, device: o.device || "any",
        counter: o.counter || ++counter, mode: o.mode || "replace", parts: devpush.partsFor(paths),
        files: files.map((f) => ({ path: f.path, sha256: crypto.createHash("sha256").update(f.data).digest("hex"), size: f.data.length,
                                   mode: f.mode === 0o755 ? "0755" : "0644" })).sort((a, b) => (a.path < b.path ? -1 : 1)),
        removed, restart: devpush.restartsFor(paths), by: o.key.id,
    };
    if (o.note) m.note = o.note;
    const rest = Object.assign({}, m);
    delete rest.id;
    m.id = crypto.createHash("sha256").update(bundleLib.canonical(rest)).digest("hex").slice(0, 32);
    const bytes = await bundleLib.writeBundle(m, files);
    const signature = crypto.sign(null, bytes, o.key.privateKey).toString("base64") + "\n";
    return { bytes, signature, manifest: m };
}

function sign(text, key) {
    return crypto.sign(null, Buffer.from(text, "utf8"), key.privateKey).toString("base64");
}
// A grant certificate, signed by master (or another key, to be refused).
function grant(master, developer, deviceId, extra) {
    const issued = new Date("2026-11-20T00:00:00Z");
    const g = Object.assign({ format: 1, type: "phoenix-devpush-grant", id: "grant-1", key: developer.id, name: "Ada Developer",
                              account: "ada", devices: [deviceId], product: "1.0", parts: ["apps", "shell"],
                              issued: issued.toISOString(), expires: new Date(issued.getTime() + 14 * 86400000).toISOString() }, extra || {});
    const text = JSON.stringify(g);
    return { grant: text, signature: sign(text, master) };
}
function revocations(master, sequence, extra) {
    const text = JSON.stringify(Object.assign({ format: 1, type: "phoenix-devpush-revocations", sequence, issued: "2026-11-25T00:00:00Z",
                                                grants: [], keys: [] }, extra || {}));
    return { list: text, signature: sign(text, master) };
}

module.exports = { BUILD, COMPATIBLE, IMAGE, makeRoot, makeBundle, grant, revocations, sign };
