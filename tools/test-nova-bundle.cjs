#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Dev bundles (docs/DEV-PUSH.md 5, 8, 9; P1), without a device or a build:
//
//   - the image's manifest (tools/install-rootfs.py --manifest, --stamp,
//     --print-manifest) of a small checkout made here: only the overlay's
//     files, the shell's included, refused ones left out, sizes and hashes
//     of the bytes the image gets, the build from /etc/os-release;
//   - the bundle maker (tools/nova): only changed and new files, image files
//     the checkout no longer installs, the restart map and parts, --add,
//     --only, the same bytes from the same input, a compiled part changed
//     stopping it, an unstamped or other product's manifest refused;
//   - the device's checks (@phoenix/platform devpush.js verify): a good
//     bundle, and each refusal: a tampered file, a bad signature, another
//     key's "by", wrong build, product, device type and device, a counter
//     replayed, forbidden paths, links and special files, modes, the 64 MB
//     cap, the overlay's space, Developer Mode off, granted keys' expiry,
//     revocation, scope and device;
//   - devpush.json and manifest.json against docs/platform-api/devpush.schema.json,
//     the path rules alike in Python and JavaScript, the nova command itself.
//
//   node tools/test-nova-bundle.cjs      (tools/ci-checks.sh nova-bundle)

"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-"));
process.env.XDG_CONFIG_HOME = path.join(TMP, "config");
const bundle = require("./nova/lib/bundle.cjs");
const keys = require("./nova/lib/keys.cjs");
const nova = require("./nova/nova.cjs");
const devpush = require("../apps/shared/platform/src/devpush.js");
const schema = require("./platform-mock/schema.cjs");

let failures = 0, passed = 0;
async function t(name, fn) {
    try {
        await fn();
        passed++;
        console.log("ok   " + name);
    } catch (e) {
        failures++;
        console.log("FAIL " + name + "\n     " + String(e && e.stack || e).split("\n").slice(0, 4).join("\n     "));
    }
}
async function rejects(promise, code, what) {
    try {
        await promise;
    } catch (e) {
        assert.strictEqual(e.code, code, (what || "") + ": " + e.code + " " + e.message);
        if (process.env.NOVA_TEST_VERBOSE) console.log("       " + code + ": " + e.message);
        return e;
    }
    throw new Error((what || "") + ": expected " + code + ", but it was accepted");
}

// ---- A small checkout -----------------------------------------------------------------

const FAKE = path.join(TMP, "repo");
function write(rel, text, mode) {
    const f = path.join(FAKE, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    if (mode) fs.chmodSync(f, mode);
}
function git(...args) {
    const r = spawnSync("git", ["-C", FAKE, "-c", "user.name=test", "-c", "user.email=test@example.org"].concat(args), { encoding: "utf8" });
    if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr);
    return r.stdout.trim();
}
write("runtime/rootfs.json", JSON.stringify({
    mounts: { "/usr/share/phoenix/runtime/": "runtime/js/", "/usr/palm/frameworks/demo/": "frameworks/demo/", "/media/internal/samples/": "samples/" },
    applicationDirs: ["apps"], product: "product.json",
}));
write("product.json", JSON.stringify({ name: "webOS Phoenix", version: "1.0.0", releaseNotes: "release-notes.json" }));
write("release-notes.json", JSON.stringify({ format: 1, unreleased: { new: ["Next."] }, versions: [{ version: "1.0.0", new: ["First."] }] }));
write("runtime/js/phoenix-runtime.js", "// the runtime\n");
write("frameworks/demo/demo.js", "// a framework\n");
write("samples/a.txt", "a sample\n");
write("apps/demo/appinfo.json", JSON.stringify({ id: "org.example.demo", version: "1.0.0", type: "web", title: "Demo", main: "index.html" }));
write("apps/demo/index.html", "<html><head><title>Demo</title></head><body></body></html>\n");
write("apps/demo/app.js", "// the app\n");
write("apps/demo/tool.sh", "#!/bin/sh\n", 0o755);
write("apps/demo/old.js", "// to be removed\n");
write("services/hello/package.json", JSON.stringify({ name: "org.example.hello" }));
write("services/hello/service.js", "// the service\n");
write("services/hello/sysbus/org.example.hello.role.json", "{}\n");
write("services/hello/sysbus/org.example.hello.service", "[D-BUS Service]\nName=org.example.hello\nExec=/usr/bin/run-js-service -n /usr/palm/services/org.example.hello\n");
write("services/hello/etc/palm/phoenix/servers.json", "{}\n");
write("services/hello/etc/palm/db/kinds/org.example.hello.thing", "{}\n");
write("shell/qml/Phoenix/Shell/Card.qml", "Item {}\n");
write("shell/assets/images/dot.png", "PNG\n");
write("shell/assets/fonts/noto-color-emoji/emoji.ttf", "font\n");
write("shell/sysbus/com.webos.surfacemanager.phoenix.perm.json", "{}\n");
write("shell/native/thing.cpp", "// compiled\n");
git("init", "-q");
git("add", "-A");
git("commit", "-q", "-m", "image");

function installRootfs(...args) {
    const r = spawnSync("python3", [path.join(REPO, "tools/install-rootfs.py"), "--repo", FAKE].concat(args), { encoding: "utf8" });
    if (r.status !== 0) throw new Error("install-rootfs " + args.join(" ") + ": " + r.stderr);
    return r;
}

const IMAGE = path.join(TMP, "image");
const BUILD = "20261124093012";
let image;            // the image's manifest.json
const key = keys.load();

(async () => {
    await t("install-rootfs --manifest and --stamp: the image's manifest", async () => {
        installRootfs(IMAGE, "--manifest");
        fs.mkdirSync(path.join(IMAGE, "etc"), { recursive: true });
        fs.writeFileSync(path.join(IMAGE, "etc/os-release"), `ID=webos\nBUILD_ID="${BUILD}"\n`);
        const raw = JSON.parse(fs.readFileSync(path.join(IMAGE, "usr/share/phoenix/manifest.json"), "utf8"));
        assert.strictEqual(raw.build, "unstamped");
        // The image's copy of a file differs from what was installed (another
        // recipe changed it), and one is gone: --stamp records the image's.
        fs.appendFileSync(path.join(IMAGE, "usr/palm/applications/org.example.demo/app.js"), "// patched in the image\n");
        // phoenix-shell installs the shell's QML and assets (shell/CMakeLists.txt).
        fs.cpSync(path.join(FAKE, "shell/qml"), path.join(IMAGE, "usr/share/phoenix/qml"), { recursive: true });
        fs.cpSync(path.join(FAKE, "shell/assets"), path.join(IMAGE, "usr/share/phoenix/assets"), { recursive: true });
        fs.mkdirSync(path.join(IMAGE, "usr/share/luna-service2/client-permissions.d"), { recursive: true });
        fs.copyFileSync(path.join(FAKE, "shell/sysbus/com.webos.surfacemanager.phoenix.perm.json"),
                        path.join(IMAGE, "usr/share/luna-service2/client-permissions.d/com.webos.surfacemanager.phoenix.perm.json"));
        installRootfs("--stamp", IMAGE, "--compatible", "phoenix-test");
        image = JSON.parse(fs.readFileSync(path.join(IMAGE, "usr/share/phoenix/manifest.json"), "utf8"));
        assert.strictEqual(image.build, BUILD);
        assert.strictEqual(image.compatible, "phoenix-test");
        assert.deepStrictEqual(image.product, { name: "webOS Phoenix", version: "1.0.0", line: "1.0" });
        assert.strictEqual(image.source.commit, git("rev-parse", "HEAD"));
        const paths = image.files.map((f) => f.path);
        assert.deepStrictEqual(paths, paths.slice().sort(), "sorted");
        for (const p of ["/usr/share/phoenix/qml/Phoenix/Shell/Card.qml", "/usr/share/phoenix/assets/images/dot.png",
                         "/usr/share/luna-service2/client-permissions.d/com.webos.surfacemanager.phoenix.perm.json",
                         "/usr/palm/applications/org.example.demo/index.html", "/usr/palm/services/org.example.hello/service.js",
                         "/usr/share/luna-service2/roles.d/org.example.hello.role.json", "/etc/palm/db/kinds/org.example.hello.thing",
                         "/usr/share/phoenix/runtime/phoenix-runtime.js", "/usr/share/phoenix/release-notes.json"]) {
            assert.ok(paths.includes(p), "listed: " + p);
        }
        for (const p of ["/etc/palm/phoenix/servers.json", "/media/internal/samples/a.txt", "/usr/share/phoenix/manifest.json"]) {
            assert.ok(!paths.includes(p), "not listed: " + p);
        }
        assert.ok(!paths.some((p) => p.includes("noto-color-emoji")), "the emoji font is the system's, not the overlay's");
        // Sizes and hashes are of the bytes the image holds: the page with the
        // runtime's tag, the notes without "unreleased", the patched file.
        for (const f of image.files) {
            const bytes = fs.readFileSync(path.join(IMAGE, f.path.slice(1)));
            assert.strictEqual(f.sha256, bundle.sha256(bytes), f.path);
            assert.strictEqual(f.size, bytes.length, f.path);
        }
        const tool = image.files.find((f) => f.path.endsWith("/tool.sh"));
        assert.strictEqual(tool.mode, "0755");
        assert.deepStrictEqual(schema.validate("devpush.schema.json", "#/$defs/imageManifest", image), []);
        assert.deepStrictEqual(bundle.checkImageManifest(image), []);
        fs.writeFileSync(path.join(TMP, "image.json"), JSON.stringify(image));
    });

    await t("install-rootfs --stamp: no BUILD_ID is an error", async () => {
        const other = path.join(TMP, "image2");
        installRootfs(other, "--manifest");
        const r = spawnSync("python3", [path.join(REPO, "tools/install-rootfs.py"), "--stamp", other], { encoding: "utf8" });
        assert.notStrictEqual(r.status, 0);
        assert.match(r.stderr, /BUILD_ID/);
    });

    await t("the path rules: Python's and JavaScript's agree", async () => {
        const samples = ["/usr/share/phoenix/qml/A.qml", "/usr/share/phoenix/manifest.json", "/usr/palm/applications/a.b/x.js",
                         "/usr/palm/services/com.palm.update/service.js", "/usr/palm/services/org.webosphoenix.nova/x.js",
                         "/usr/share/luna-service2/roles.d/com.palm.update.role.json", "/usr/share/luna-service2/roles.d/com.palm.updater.role.json",
                         "/usr/share/luna-service2/services.d/org.webosphoenix.nova.service", "/etc/palm/phoenix/servers.json",
                         "/etc/palm/marketplace/sources.json", "/etc/palm/marketplace/preinstalled.json", "/etc/palm/hardware/catalog.json",
                         "/etc/palm/db/kinds/x", "/usr/lib/luna/system/x.html", "/usr/bin/luna-send", "/usr/lib/qt6/qml/x.so",
                         "/etc/systemd/system/x.service", "/media/cryptofs/apps/x", "/usr/palmx/y"];
        const py = spawnSync("python3", ["-c", `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("ir", ${JSON.stringify(path.join(REPO, "tools/install-rootfs.py"))})
ir = importlib.util.module_from_spec(spec); spec.loader.exec_module(ir)
rules = ir.devpush_rules()
print(json.dumps([ir.overlayable(p, rules) for p in json.loads(sys.argv[1])]))`, JSON.stringify(samples)], { encoding: "utf8" });
        assert.strictEqual(py.status, 0, py.stderr);
        const expect = samples.map((p) => devpush.overlayable(p));
        assert.deepStrictEqual(JSON.parse(py.stdout), expect);
        assert.deepStrictEqual(expect, [true, false, true, false, false, false, true, false, false, false, true, false, true, true, false, false, false, false, false]);
    });

    await t("the restart map (DEV-PUSH.md 4.5), each row", async () => {
        const r = devpush.restartsFor;
        assert.deepStrictEqual(r(["/usr/share/phoenix/qml/Phoenix/Shell/Card.qml", "/usr/share/phoenix/assets/a.png"]), ["shell"]);
        assert.deepStrictEqual(r(["/usr/share/phoenix/runtime/phoenix-runtime.js"]), ["wam"]);
        assert.deepStrictEqual(r(["/usr/palm/frameworks/enyo/1.0/x.js"]), ["wam"]);
        assert.deepStrictEqual(r(["/usr/lib/luna/system/luna-systemui/x.html"]), ["wam"]);
        assert.deepStrictEqual(r(["/usr/palm/applications/a.b/x.js"]), ["app:a.b"]);
        assert.deepStrictEqual(r(["/usr/palm/applications/a.b/appinfo.json"]), ["rescan", "app:a.b"]);
        assert.deepStrictEqual(r(["/usr/palm/services/s.t/x.js", "/usr/palm/services/s.t/y.js"]), ["service:s.t"]);
        assert.deepStrictEqual(r(["/usr/share/luna-service2/roles.d/s.t.role.json"]), ["hub"]);
        assert.deepStrictEqual(r(["/etc/palm/db/kinds/x", "/etc/palm/activities/applications/a/b.json"]), ["configurator"]);
        assert.deepStrictEqual(r(["/usr/share/phoenix/product.json", "/usr/palm/sounds/x.mp3"]), ["reboot"]);
        assert.deepStrictEqual(r(["/usr/share/phoenix/qml/A.qml", "/usr/palm/applications/a.b/x.js", "/usr/share/luna-service2/x/y",
                                  "/usr/palm/services/s.t/x.js", "/usr/share/phoenix/product.json"]),
                               ["hub", "service:s.t", "app:a.b", "shell", "reboot"], "narrowest first");
        assert.deepStrictEqual(devpush.partsFor(["/usr/share/luna-service2/a/b", "/usr/palm/applications/a.b/c", "/etc/palm/db/kinds/x",
                                                 "/usr/share/phoenix/qml/A.qml"]), ["apps", "roles", "services", "shell"]);
    });

    const IMAGE_JSON = path.join(TMP, "image.json");
    const MADE = "2026-11-25T14:03:00Z";
    const make = (o) => bundle.makeSystemBundle(Object.assign({ repo: FAKE, manifest: bundle.readImageManifest(IMAGE_JSON), key, made: MADE }, o));

    await t("the maker: nothing changed, no bundle (but the image's own changes)", async () => {
        // The one file the image patched differs from the checkout's.
        const r = await make({ only: ["/usr/share/phoenix"] });
        assert.ok(r.nothing);
        const all = await make({});
        assert.deepStrictEqual(all.manifest.files.map((f) => f.path), ["/usr/palm/applications/org.example.demo/app.js"]);
    });

    let good;   // {bytes, signature, manifest}
    await t("the maker: only changed and new files, deletions, restarts, parts", async () => {
        write("shell/qml/Phoenix/Shell/Card.qml", "Item { id: card }\n");
        write("shell/qml/Phoenix/Shell/NewThing.qml", "Item {}\n");
        write("apps/demo/appinfo.json", JSON.stringify({ id: "org.example.demo", version: "1.0.1", type: "web", title: "Demo", main: "index.html" }));
        fs.unlinkSync(path.join(FAKE, "apps/demo/old.js"));
        write("services/hello/sysbus/org.example.hello.role.json", "{\"changed\": true}\n");
        write("services/hello/etc/palm/phoenix/servers.json", "{\"changed\": true}\n");   // refused: never in a bundle
        const logs = [];
        good = await make({ log: (s) => logs.push(s), note: "Card view: an id" });
        const m = good.manifest;
        assert.deepStrictEqual(m.files.map((f) => f.path), [
            "/usr/palm/applications/org.example.demo/app.js",
            "/usr/palm/applications/org.example.demo/appinfo.json",
            "/usr/share/luna-service2/roles.d/org.example.hello.role.json",
            "/usr/share/phoenix/qml/Phoenix/Shell/Card.qml",
            "/usr/share/phoenix/qml/Phoenix/Shell/NewThing.qml",
        ]);
        assert.deepStrictEqual(m.removed, ["/usr/palm/applications/org.example.demo/old.js"]);
        assert.deepStrictEqual(m.restart, ["hub", "rescan", "app:org.example.demo", "shell"]);
        assert.deepStrictEqual(m.parts, ["apps", "roles", "shell"]);
        assert.strictEqual(m.build, BUILD);
        assert.strictEqual(m.product, "1.0");
        assert.strictEqual(m.compatible, "phoenix-test");
        assert.strictEqual(m.device, "any");
        assert.strictEqual(m.counter, Date.parse(MADE));
        assert.strictEqual(m.mode, "replace");
        assert.strictEqual(m.by, key.id);
        assert.strictEqual(m.note, "Card view: an id");
        assert.strictEqual(m.source.dirty, true);
        assert.deepStrictEqual(logs, [], "no warnings: the refused file is not in either manifest");
        assert.deepStrictEqual(schema.validate("devpush.schema.json", "#/$defs/bundleManifest", m), []);
        assert.deepStrictEqual(devpush.checkManifest(m), []);
        // The appinfo.json in the bundle is the image's form of it (WebAppMgr's Back).
        const pkg = await bundle.ipk.read(new Uint8Array(good.bytes));
        const info = pkg.files.find((f) => f.path.endsWith("appinfo.json"));
        assert.strictEqual(JSON.parse(Buffer.from(info.data).toString()).disableBackHistoryAPI, true);
        assert.strictEqual(pkg.control.Package, "phoenix-devpush");
        assert.match(good.signature, /^[A-Za-z0-9+/]{86}==\n$/);
    });

    await t("the maker: the same input makes the same bytes", async () => {
        const again = await make({ note: "Card view: an id" });
        assert.ok(Buffer.compare(again.bytes, good.bytes) === 0);
        assert.strictEqual(again.signature, good.signature);
    });

    await t("the maker: --add removes nothing; --only limits it; --device", async () => {
        const add = await make({ mode: "add", device: "dev-1" });
        assert.deepStrictEqual(add.manifest.removed, []);
        assert.strictEqual(add.manifest.mode, "add");
        assert.strictEqual(add.manifest.device, "dev-1");
        const only = await make({ only: ["/usr/share/phoenix/qml"] });
        assert.deepStrictEqual(only.manifest.files.map((f) => f.path), ["/usr/share/phoenix/qml/Phoenix/Shell/Card.qml", "/usr/share/phoenix/qml/Phoenix/Shell/NewThing.qml"]);
        assert.deepStrictEqual(only.manifest.removed, []);
    });

    await t("the maker: refused paths in an image's manifest are left out, with a warning", async () => {
        const m = JSON.parse(fs.readFileSync(IMAGE_JSON, "utf8"));
        m.files.push({ path: "/etc/palm/phoenix/servers.json", size: 3, sha256: "0".repeat(64), mode: "0644" });
        m.files.sort((a, b) => (a.path < b.path ? -1 : 1));
        const logs = [];
        const r = await make({ manifest: m, log: (s) => logs.push(s) });
        assert.ok(!r.manifest.removed.includes("/etc/palm/phoenix/servers.json"));
        assert.ok(logs.some((s) => /left out.*servers\.json/.test(s)), logs.join("\n"));
    });

    await t("the maker: a compiled part changed needs an image", async () => {
        write("shell/native/thing.cpp", "// compiled, changed\n");
        const e = await rejects(make({}), "NEEDS_IMAGE");
        assert.match(e.message, /shell\/native changed: this needs a new image/);
        const r = await make({ allowCompiled: true });
        assert.deepStrictEqual(r.compiled, ["shell/native/thing.cpp"]);
        git("checkout", "--", "shell/native/thing.cpp");
    });

    await t("the maker: an unstamped manifest, another product line, unbuilt apps", async () => {
        const m = JSON.parse(fs.readFileSync(IMAGE_JSON, "utf8"));
        await rejects(make({ manifest: Object.assign({}, m, { build: "unstamped" }) }), "UNSTAMPED");
        await rejects(make({ manifest: Object.assign({}, m, { product: { name: "webOS Phoenix", version: "2.0.0", line: "2.0" } }) }), "WRONG_PRODUCT");
        write("apps/built/public/appinfo.json", "{}");
        await rejects(make({}), "NOT_BUILT");
        fs.rmSync(path.join(FAKE, "apps/built"), { recursive: true });
    });

    // ---- The device's checks ----------------------------------------------------------
    const DEVICE = { build: BUILD, product: "1.0", compatible: "phoenix-test", id: "dev-1" };
    const trustMe = [{ key: key.publicKey, kind: "paired" }];
    const verify = (b, sig, o) => bundle.verifyBundle(b, sig, Object.assign({ trust: trustMe, device: DEVICE, lastCounter: () => 0 }, o));
    const other = keys.load(path.join(TMP, "other", "key"));
    // A bundle signed properly but with what it holds set by hand: the checks
    // after the signature.
    async function forged(edit, files, signer) {
        const m = JSON.parse(JSON.stringify(good.manifest));
        const pkg = await bundle.ipk.read(new Uint8Array(good.bytes));
        let data = pkg.files.map((f) => ({ path: "/" + f.path, data: f.data, mode: f.mode }));
        if (files) data = files(data);
        edit(m);
        const bytes = await bundle.writeBundle(m, data);
        return { bytes, signature: keys.signDetached(bytes, signer || key) };
    }

    await t("verify: a good bundle", async () => {
        const r = await verify(good.bytes, good.signature);
        assert.strictEqual(r.files.length, 5);
        assert.deepStrictEqual(r.restart, good.manifest.restart);
        assert.strictEqual(r.trust.kind, "paired");
    });

    await t("verify: a tampered bundle (bytes changed after signing)", async () => {
        const b = Buffer.from(good.bytes);
        b[b.length - 100] ^= 1;
        await rejects(verify(b, good.signature), "UNTRUSTED");
    });

    await t("verify: a tampered file (signed, but not what devpush.json lists)", async () => {
        const tamper = (x) => { const b = Buffer.from(x.data); b[0] ^= 1; return Object.assign({}, x, { data: b }); };
        const f = await forged(() => {}, (d) => d.map((x) => x.path.endsWith("Card.qml") ? tamper(x) : x));
        const e = await rejects(verify(f.bytes, f.signature), "BAD_BUNDLE", "hash");
        assert.match(e.message, /SHA-256/);
        const s = await forged(() => {}, (d) => d.map((x) => x.path.endsWith("Card.qml") ? Object.assign({}, x, { data: Buffer.concat([x.data, Buffer.from(" ")]) }) : x));
        await rejects(verify(s.bytes, s.signature), "BAD_BUNDLE", "size");
        const g = await forged(() => {}, (d) => d.concat([{ path: "/usr/share/phoenix/qml/Extra.qml", data: Buffer.from("x"), mode: 0o644 }]));
        await rejects(verify(g.bytes, g.signature), "BAD_BUNDLE", "an unlisted file");
        const h = await forged(() => {}, (d) => d.slice(1));
        await rejects(verify(h.bytes, h.signature), "BAD_BUNDLE", "a listed file missing");
        const i = await forged(() => {}, (d) => d.map((x) => Object.assign({}, x, { mode: 0o4755 })));
        await rejects(verify(i.bytes, i.signature), "BAD_BUNDLE", "setuid");
    });

    await t("verify: a bad signature, an untrusted key, \"by\" not the signer", async () => {
        await rejects(verify(good.bytes, "AAAA\n"), "UNTRUSTED", "garbage");
        await rejects(verify(good.bytes, keys.signDetached(good.bytes, other)), "UNTRUSTED", "another key");
        await rejects(verify(good.bytes, good.signature, { trust: [] }), "UNTRUSTED", "no keys");
        const f = await forged(() => {}, null, other);
        await rejects(verify(f.bytes, f.signature, { trust: trustMe.concat({ key: other.publicKey, kind: "paired" }) }), "UNTRUSTED", "by");
    });

    await t("verify: wrong build, product, device type, device", async () => {
        await rejects(verify(good.bytes, good.signature, { device: Object.assign({}, DEVICE, { build: "20261201000000" }) }), "WRONG_BUILD");
        await rejects(verify(good.bytes, good.signature, { device: Object.assign({}, DEVICE, { product: "2.0" }) }), "WRONG_PRODUCT");
        await rejects(verify(good.bytes, good.signature, { device: Object.assign({}, DEVICE, { compatible: "phoenix-other" }) }), "WRONG_DEVICE");
        const f = await forged((m) => { m.device = "dev-2"; });
        await rejects(verify(f.bytes, f.signature), "WRONG_DEVICE");
        const g = await forged((m) => { m.device = "dev-1"; m.compatible = null; });
        await verify(g.bytes, g.signature);
    });

    await t("verify: a counter replayed", async () => {
        const c = good.manifest.counter;
        await rejects(verify(good.bytes, good.signature, { lastCounter: () => c }), "REPLAY");
        await rejects(verify(good.bytes, good.signature, { lastCounter: () => Promise.resolve(c + 1) }), "REPLAY");
        let asked;
        await verify(good.bytes, good.signature, { lastCounter: (s) => { asked = s; return c - 1; } });
        assert.strictEqual(asked, "key:" + key.publicKey);
    });

    await t("verify: forbidden paths", async () => {
        const forbidden = ["/etc/palm/phoenix/servers.json", "/usr/palm/services/com.palm.update/service.js", "/usr/bin/luna-send",
                           "/usr/share/luna-service2/roles.d/org.webosphoenix.nova.role.json", "/usr/share/phoenix/manifest.json",
                           "/usr/palm/applications/../../../etc/shadow", "/usr/palm//x", "/etc/systemd/system/x.service"];
        for (const p of forbidden) {
            const data = Buffer.from("x\n");
            const f = await forged((m) => {
                m.files = [{ path: p, sha256: bundle.sha256(data), size: data.length, mode: "0644" }];
                m.removed = [];
                m.parts = devpush.partsFor([p]);
            }, () => [{ path: p, data, mode: 0o644 }]);
            await rejects(verify(f.bytes, f.signature), "REFUSED_PATH", p);
        }
        const r = await forged((m) => { m.removed = ["/etc/palm/hardware/catalog.json"]; m.parts = devpush.partsFor(m.files.map((x) => x.path).concat(m.removed)); });
        await rejects(verify(r.bytes, r.signature), "REFUSED_PATH", "a removal");
    });

    await t("verify: links, special files and modes are refused", async () => {
        const ipkLib = require("../apps/marketplace/service/lib/ipk.js");
        const pkg = await bundle.ipk.read(new Uint8Array(good.bytes));
        const tarWithLink = (() => {
            const t = ipkLib.writeTar(pkg.files.map((f) => ({ path: f.path, data: f.data, mode: f.mode })));
            // A symbolic link entry, written by hand.
            const h = Buffer.alloc(512);
            h.write("./usr/share/phoenix/qml/Link.qml", 0);
            h.write("0000777\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
            h.write("00000000000\0", 124); h.write("00000000000\0", 136); h.write("        ", 148);
            h.write("2", 156); h.write("/etc/shadow", 157); h.write("ustar\0", 257); h.write("00", 263);
            let sum = 0; for (const b of h) sum += b;
            h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
            return Buffer.concat([Buffer.from(t.subarray(0, t.length - 1024)), h, Buffer.alloc(1024)]);
        })();
        const ar = ipkLib.readAr(new Uint8Array(good.bytes));
        const data = await bundle.gzip.gzip(tarWithLink);
        const arOut = [Buffer.from("!<arch>\n")];
        for (const [name, body] of [["debian-binary", ar["debian-binary"]], ["control.tar.gz", ar["control.tar.gz"]], ["data.tar.gz", data]]) {
            arOut.push(Buffer.from(name.padEnd(16) + "0".padEnd(12) + "0".padEnd(6) + "0".padEnd(6) + "100644".padEnd(8) + String(body.length).padEnd(10) + "`\n"), Buffer.from(body));
            if (body.length % 2) arOut.push(Buffer.from("\n"));
        }
        const bytes = Buffer.concat(arOut);
        await rejects(verify(bytes, keys.signDetached(bytes, key)), "BAD_BUNDLE", "a link");
        assert.ok(devpush.checkManifest(Object.assign({}, good.manifest, { files: [Object.assign({}, good.manifest.files[0], { mode: "0777" })] })).length);
    });

    await t("verify: the 64 MB cap, the overlay's space, Developer Mode", async () => {
        const big = Buffer.alloc(devpush.RULES.maxBundleBytes + 1);
        await rejects(verify(big, good.signature), "TOO_BIG");
        assert.strictEqual(devpush.RULES.maxBundleBytes, 64 * 1024 * 1024);
        await rejects(verify(good.bytes, good.signature, { spaceLeft: 10 }), "NO_SPACE");
        await rejects(verify(good.bytes, good.signature, { devMode: false }), "NEEDS_DEVMODE");
        await verify(good.bytes, good.signature, { devMode: true, spaceLeft: 1 << 20 });
        // The maker stops at the cap too: a 65 MB file that does not compress.
        write("shell/assets/images/noise.bin", crypto.randomBytes(devpush.RULES.maxBundleBytes + 1024));
        await rejects(make({ only: ["/usr/share/phoenix/assets"] }), "TOO_BIG");
        fs.unlinkSync(path.join(FAKE, "shell/assets/images/noise.bin"));
    });

    await t("verify: granted keys (expiry, revocation, device, product, parts)", async () => {
        const grant = { id: "g1", devices: ["dev-1"], product: "1.0", parts: ["apps", "roles", "shell"], expires: "2026-12-09T00:00:00Z" };
        const now = new Date("2026-11-26T00:00:00Z");
        const asGrant = (g) => [{ key: key.publicKey, kind: "grant", grant: g }];
        const f = await forged((m) => { m.device = "dev-1"; });
        let asked;
        await verify(f.bytes, f.signature, { trust: asGrant(grant), now, lastCounter: (s) => { asked = s; return 0; } });
        assert.strictEqual(asked, "grant:g1");
        await rejects(verify(f.bytes, f.signature, { trust: asGrant(Object.assign({}, grant, { expires: "2026-11-25T00:00:00Z" })), now }), "UNTRUSTED", "expired");
        await rejects(verify(f.bytes, f.signature, { trust: asGrant(Object.assign({}, grant, { revoked: true })), now }), "UNTRUSTED", "revoked");
        await rejects(verify(good.bytes, good.signature, { trust: asGrant(grant), now }), "WRONG_DEVICE", "\"any\" from a grant");
        await rejects(verify(f.bytes, f.signature, { trust: asGrant(Object.assign({}, grant, { devices: ["dev-9"] })), now }), "OUT_OF_SCOPE", "device");
        await rejects(verify(f.bytes, f.signature, { trust: asGrant(Object.assign({}, grant, { product: "2.0" })), now }), "OUT_OF_SCOPE", "product");
        await rejects(verify(f.bytes, f.signature, { trust: asGrant(Object.assign({}, grant, { parts: ["apps", "shell"] })), now }), "OUT_OF_SCOPE", "roles not granted");
    });

    await t("verify: not a bundle; devpush.json broken", async () => {
        const notIpk = Buffer.from("hello");
        await rejects(verify(notIpk, keys.signDetached(notIpk, key)), "NOT_A_BUNDLE");
        const app = await bundle.packageApp(path.join(FAKE, "apps/demo"));
        await rejects(verify(app.bytes, keys.signDetached(app.bytes, key)), "NOT_A_BUNDLE", "an app's .ipk");
        const f = await forged((m) => { m.format = 2; });
        await rejects(verify(f.bytes, f.signature), "BAD_BUNDLE");
        const g = await forged((m) => { m.parts = ["apps"]; });
        await rejects(verify(g.bytes, g.signature), "BAD_BUNDLE", "parts that do not match its paths");
    });

    // ---- The nova command ---------------------------------------------------------------
    async function run(...argv) {
        const out = [], err = [];
        const code = await nova.main(argv, { log: (s) => out.push(s), err: (s) => err.push(s) });
        return { code, out: out.join("\n"), err: err.join("\n") };
    }

    await t("nova package --system, nova verify, nova key", async () => {
        const file = path.join(TMP, "out.ipk");
        let r = await run("package", "--system", "--manifest", IMAGE_JSON, "--repo", FAKE, "--made", MADE, "--note", "Card view: an id", "-o", file);
        assert.strictEqual(r.code, 0, r.err);
        assert.match(r.out, /5 files, 1 removed/);
        assert.ok(Buffer.compare(fs.readFileSync(file), good.bytes) === 0, "the same bundle as the library made");
        assert.strictEqual(fs.readFileSync(file + ".sig", "utf8"), good.signature);
        r = await run("verify", file, "--build", BUILD, "--product", "1.0", "--compatible", "phoenix-test");
        assert.strictEqual(r.code, 0, r.err);
        r = await run("verify", file, "--build", BUILD, "--product", "1.0", "--compatible", "phoenix-test", "--last-counter", String(Date.parse(MADE)));
        assert.strictEqual(r.code, 1);
        assert.match(r.err, /^REPLAY/);
        r = await run("verify", file, "--build", BUILD, "--product", "1.0", "--trust", other.id);
        assert.match(r.err, /^UNTRUSTED/);
        r = await run("package", "--system", "--manifest", IMAGE_JSON, "--repo", FAKE, "--dry-run");
        assert.strictEqual(r.code, 0);
        assert.match(r.out, /dry run/);
        r = await run("key");
        assert.strictEqual(r.out.split("\n")[0], key.id);
    });

    await t("nova package APPDIR: an app's .ipk", async () => {
        const r = await run("package", path.join(FAKE, "apps/demo"), "-o", TMP);
        assert.strictEqual(r.code, 0, r.err);
        const pkg = await bundle.ipk.read(new Uint8Array(fs.readFileSync(path.join(TMP, "org.example.demo_1.0.1_all.ipk"))));
        assert.strictEqual(pkg.control.Package, "org.example.demo");
        assert.strictEqual(pkg.control.Version, "1.0.1");
        assert.deepStrictEqual(pkg.apps.map((a) => a.id), ["org.example.demo"]);
        assert.ok(pkg.files.some((f) => f.path === "usr/palm/applications/org.example.demo/tool.sh" && f.mode === 0o755));
    });

    await t("nova: usage, commands still to come, the key's mode", async () => {
        assert.strictEqual((await run()).code, 2);
        assert.strictEqual((await run("frobnicate")).code, 2);
        const later = await run("push");
        assert.strictEqual(later.code, 2);
        assert.match(later.err, /P2/);
        assert.strictEqual((await run("package", "--system")).code, 2);
        assert.strictEqual(fs.statSync(key.file).mode & 0o777, 0o600);
        const loose = path.join(TMP, "loose", "key");
        keys.load(loose);
        fs.chmodSync(loose, 0o644);
        assert.throws(() => keys.load(loose), /can be read by others/);
    });

    await t("./phoenix nova runs it", async () => {
        const r = spawnSync("sh", [path.join(REPO, "phoenix"), "nova", "key"], { encoding: "utf8", env: process.env });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.strictEqual(r.stdout.split("\n")[0], key.id);
    });

    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(failures ? `${failures} failed, ${passed} passed` : `all ${passed} passed`);
    process.exitCode = failures ? 1 : 0;
})();
