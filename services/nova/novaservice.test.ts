// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.nova (novaservice.js) over a fake root (a temporary
// folder laid out like a device's /) with stand-ins for mount, mknod,
// systemctl, ls-control and pkill that record their calls
// (test/fake-system.cjs), as services/updates is tested with a fake RAUC:
// the device's refusals, apply (into upper/ before the first mount, then
// through the merged path) and its rollback, replace and add, every row of
// the restart map, reverting one file (one the image has, one a bundle
// added, one a bundle deleted) and Revert to Image at the next boot, the
// build tie, the Developer Mode gate, the overlay's cap, and the extra
// layer on granted keys (signed grants, scope, expiry, revocation, no
// replay, 10 a day, the owner's Apply with the passcode).

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const nova = require("./novaservice.js") as Any;
const keys = require("./lib/keys.js") as Any;
const boot = require("./boot.js") as Any;
const { createFakeSystem } = require("./test/fake-system.cjs") as Any;
const h = require("./test/helpers.cjs") as Any;

vi.setConfig({ testTimeout: 20_000 });

const QML = "/usr/share/phoenix/qml/Phoenix/Shell/CardView.qml";
const SETTINGS = "/usr/palm/applications/org.webosphoenix.settings/";

let dev: Any, sys: Any, core: Any, computer: Any, lunaCalls: Any[], notes: string[], running: string[], clock: Date, passcode: string;

function make(extra: Any = {}) {
    core = nova.createNova(Object.assign({
        root: dev.root, run: sys.run, whiteout: sys.whiteout, now: () => clock,
        luna: { call: async (uri: string, params: Any) => {
            lunaCalls.push([uri.replace("luna://", ""), params]);
            if (/\/running$/.test(uri)) return { returnValue: true, running: running.map((id) => ({ id })) };
            if (/matchDevicePasscode$/.test(uri)) return { returnValue: true, succeeded: params.passCode === passcode };
            return { returnValue: true };
        } },
        notify: (t: string) => notes.push(t),
    }, extra));
    return core;
}
// This computer paired with the device (pairing itself: proto.test.ts).
function pairComputer(key = computer, name = "Laptop") {
    const list = JSON.parse(dev.read("/var/lib/phoenix/nova/paired.json") || "[]");
    list.push({ key: key.publicKey, fingerprint: key.fingerprint, name, paired: clock.toISOString(), lastUsed: null });
    dev.write("/var/lib/phoenix/nova/paired.json", JSON.stringify(list));
}
const from = (key = computer) => ({ key: key.publicKey, name: "Laptop" });
async function push(files: Any[], opts: Any = {}) {
    const b = await h.makeBundle(Object.assign({ key: computer, files }, opts));
    return core.receive(b.bytes, b.signature, opts.from === undefined ? from() : opts.from);
}
const upper = (p: string) => path.join(dev.root, "var/lib/phoenix/overlay", h.BUILD, "upper", p);
const state = () => JSON.parse(dev.read("/var/lib/phoenix/overlay/state.json"));
const mounts = () => sys.calls.filter((c: string) => c.startsWith("mount"));

beforeEach(() => {
    dev = h.makeRoot();
    sys = createFakeSystem(dev.root);
    computer = keys.generate("nova");
    lunaCalls = [];
    notes = [];
    running = [];
    clock = new Date("2026-11-26T12:00:00Z");
    passcode = "1234";
    make();
    pairComputer();
});
afterEach(() => { core.pairCancel(); fs.rmSync(dev.root, { recursive: true, force: true }); });

describe("the device's checks (docs/DEV-PUSH.md 5.3)", () => {
    it("refuses everything but getStatus with Developer Mode off", async () => {
        fs.rmSync(path.join(dev.root, "var/luna/preferences/devmode_enabled"));
        await expect(push([{ path: QML, data: "x" }])).rejects.toMatchObject({ code: "NEEDS_DEVMODE" });
        for (const m of ["listWaiting", "apply", "decline", "revert", "pairStart", "listKeys", "removeKey", "addGrant", "setOptions", "restart", "rescan"]) {
            expect((await core.methods[m]({})).errorCode, m).toBe("NEEDS_DEVMODE");
        }
        const st = await core.methods.getStatus({});
        expect(st.returnValue).toBe(true);
        expect(st.devMode).toBe(false);
        expect(sys.calls).toEqual([]);
    });

    it("refuses a bundle by a key it does not trust, for another build or device, a replay and a refused path", async () => {
        const stranger = keys.generate("x");
        await expect(push([{ path: QML, data: "x" }], { key: stranger, from: from(stranger) })).rejects.toMatchObject({ code: "UNTRUSTED" });
        await expect(push([{ path: QML, data: "x" }], { build: "20250101000000" })).rejects.toMatchObject({ code: "WRONG_BUILD" });
        await expect(push([{ path: QML, data: "x" }], { device: "nova-0123456789abcdef" })).rejects.toMatchObject({ code: "WRONG_DEVICE" });
        await expect(push([{ path: QML, data: "x" }], { product: "2.0" })).rejects.toMatchObject({ code: "WRONG_PRODUCT" });
        await push([{ path: QML, data: "one" }], { counter: 1795615300000 });
        await expect(push([{ path: QML, data: "two" }], { counter: 1795615300000 })).rejects.toMatchObject({ code: "REPLAY" });
        await expect(push([{ path: "/etc/palm/phoenix/servers.json", data: "{}" }])).rejects.toMatchObject({ code: "REFUSED_PATH" });
        expect(dev.read("/etc/palm/phoenix/servers.json")).toContain("devpush");
    });

    it("keeps the overlay under its cap (a Developer Mode setting, 256 MB by default)", async () => {
        expect((await core.methods.getStatus({})).cap).toBe(256 * 1024 * 1024);
        expect((await core.methods.setOptions({ overlayCap: 1 << 20 })).returnValue).toBe(true);
        const big = "x".repeat((1 << 20) + 1);
        await expect(push([{ path: QML, data: big }])).rejects.toMatchObject({ code: "NO_SPACE" });
        // Replace: what the overlay held before does not count; add: it does.
        await push([{ path: QML, data: "y".repeat(700 * 1024) }]);
        await push([{ path: SETTINGS + "index.js", data: "z".repeat(700 * 1024) }]);
        await expect(push([{ path: SETTINGS + "old.js", data: "z".repeat(700 * 1024) }], { mode: "add" })).rejects.toMatchObject({ code: "NO_SPACE" });
        // An add that removes a file has its space back.
        await push([{ path: QML, data: "q".repeat(1 << 20) }]);
        await push([{ path: SETTINGS + "index.js", data: "small" }], { mode: "add", removed: [QML] });
        expect((await core.methods.getStatus({})).usage).toBe(5);
    });
});

describe("applying a bundle (4.3, 4.4)", () => {
    it("writes the first push into upper/, then mounts the overlay with the image's copy beside it and the refused paths bound back", async () => {
        const r = await push([{ path: QML, data: "// pushed card view\n" }, { path: "/usr/share/luna-service2/roles.d/org.example.svc.role.json", data: "{\"x\":1}\n" }]);
        expect(r.waiting).toBe(false);
        expect(fs.readFileSync(upper(QML), "utf8")).toBe("// pushed card view\n");
        expect(mounts()).toEqual([
            "mount --bind /usr/share/phoenix /run/phoenix/overlay/lower/usr/share/phoenix",
            `mount -t overlay overlay -o lowerdir=/run/phoenix/overlay/lower/usr/share/phoenix,upperdir=/var/lib/phoenix/overlay/${h.BUILD}/upper/usr/share/phoenix,workdir=/var/lib/phoenix/overlay/${h.BUILD}/work/usr/share/phoenix /usr/share/phoenix`,
            "mount --bind /run/phoenix/overlay/lower/usr/share/phoenix/manifest.json /usr/share/phoenix/manifest.json",
            "mount --bind /usr/share/luna-service2 /run/phoenix/overlay/lower/usr/share/luna-service2",
            `mount -t overlay overlay -o lowerdir=/run/phoenix/overlay/lower/usr/share/luna-service2,upperdir=/var/lib/phoenix/overlay/${h.BUILD}/upper/usr/share/luna-service2,workdir=/var/lib/phoenix/overlay/${h.BUILD}/work/usr/share/luna-service2 /usr/share/luna-service2`,
            "mount --bind /run/phoenix/overlay/lower/usr/share/luna-service2/roles.d/org.webosphoenix.nova.role.json /usr/share/luna-service2/roles.d/org.webosphoenix.nova.role.json",
        ]);
        expect(dev.read(QML)).toBe("// pushed card view\n");
        expect(dev.read("/run/phoenix/overlay/lower" + QML)).toBe(h.IMAGE[QML]);
        const st = state();
        expect(st.build).toBe(h.BUILD);
        expect(st.files[QML]).toMatchObject({ size: 20, kind: "paired", name: "Laptop", by: computer.id });
        expect(st.bundles).toHaveLength(1);
    });

    it("writes later pushes through the merged path, leaving the layers alone", async () => {
        await push([{ path: QML, data: "one\n" }]);
        const before = fs.readFileSync(upper(QML), "utf8");
        sys.reset();
        await push([{ path: QML, data: "two\n" }]);
        expect(mounts()).toEqual([]);
        expect(dev.read(QML)).toBe("two\n");
        expect(fs.readFileSync(upper(QML), "utf8")).toBe(before);
        expect(dev.exists(QML + ".nova-new")).toBe(false);
    });

    it("replaces by default: a file the new bundle leaves out goes back to the image's; --add keeps it", async () => {
        await push([{ path: QML, data: "pushed\n" }, { path: SETTINGS + "index.js", data: "pushed settings\n" }]);
        await push([{ path: QML, data: "pushed again\n" }]);
        expect(dev.read(SETTINGS + "index.js")).toBe(h.IMAGE[SETTINGS + "index.js"]);
        expect(Object.keys(state().files)).toEqual([QML]);
        await push([{ path: SETTINGS + "index.js", data: "added\n" }], { mode: "add" });
        expect(Object.keys(state().files).sort()).toEqual([QML, SETTINGS + "index.js"].sort());
        expect(dev.read(QML)).toBe("pushed again\n");
    });

    it("puts every file back when a write fails part way, and says which", async () => {
        await push([{ path: QML, data: "before\n" }, { path: SETTINGS + "index.js", data: "settings before\n" }]);
        // Where the second file's temporary copy goes is a folder: the write fails.
        fs.mkdirSync(path.join(dev.root, SETTINGS + "index.js.nova-new"), { recursive: true });
        const was = JSON.stringify(state());
        sys.reset();
        await expect(push([{ path: QML, data: "after\n" }, { path: SETTINGS + "index.js", data: "new\n" }]))
            .rejects.toMatchObject({ code: "WRITE_FAILED", path: SETTINGS + "index.js" });
        expect(dev.read(QML)).toBe("before\n");
        expect(dev.read(SETTINGS + "index.js")).toBe("settings before\n");
        expect(JSON.stringify(state())).toBe(was);
        expect(sys.calls.filter((c: string) => /^(systemctl|pkill|ls-control)/.test(c))).toEqual([]);
    });

    it("rolls back the first push in upper/, with nothing mounted", async () => {
        fs.mkdirSync(upper(SETTINGS + "index.js.nova-new"), { recursive: true });
        await expect(push([{ path: QML, data: "a\n" }, { path: SETTINGS + "index.js", data: "b\n" }])).rejects.toMatchObject({ code: "WRITE_FAILED" });
        expect(fs.existsSync(upper(QML))).toBe(false);
        expect(mounts()).toEqual([]);
        expect(dev.read(QML)).toBe(h.IMAGE[QML]);
    });

    // A mount that fails after the files went into upper/: what this apply
    // mounted is unmounted and upper/ put back, so a later push shows only
    // its own files (not the failed bundle's, unlisted).
    it("rolls back the first push when mounting fails, what it mounted too", async () => {
        sys.failOn("mount", "lowerdir=/run/phoenix/overlay/lower/usr/palm,");
        await expect(push([{ path: QML, data: "a\n" }, { path: SETTINGS + "index.js", data: "b\n" }]))
            .rejects.toMatchObject({ code: "WRITE_FAILED" });
        expect(sys.calls).toContain("umount /usr/share/phoenix");
        expect(fs.existsSync(upper(QML))).toBe(false);
        expect(fs.existsSync(upper(SETTINGS + "index.js"))).toBe(false);
        expect(fs.existsSync(path.join(dev.root, "proc/mounts")) ? fs.readFileSync(path.join(dev.root, "proc/mounts"), "utf8") : "").toBe("");
        expect(dev.read(QML)).toBe(h.IMAGE[QML]);
        expect(state()?.files || {}).toEqual({});
        await push([{ path: SETTINGS + "index.js", data: "c\n" }]);
        expect(dev.read(QML)).toBe(h.IMAGE[QML]);
        expect(dev.read(SETTINGS + "index.js")).toBe("c\n");
        expect(Object.keys(state().files)).toEqual([SETTINGS + "index.js"]);
    });

    it("removes an image file with a whiteout before the first mount, by unlinking it after", async () => {
        await push([{ path: QML, data: "x\n" }], { removed: [SETTINGS + "old.js"] });
        expect(dev.exists(SETTINGS + "old.js")).toBe(false);
        expect(sys.calls).toContain(`mknod ${upper(SETTINGS + "old.js")} c 0 0`);
        expect(state().removed[SETTINGS + "old.js"]).toMatchObject({ kind: "paired" });
    });
});

describe("the restart map (4.5)", () => {
    const restarts = () => sys.calls.filter((c: string) => /^(systemctl|ls-control|pkill)/.test(c));
    it("restarts the shell for QML, WebAppMgr for the runtime, and each once, narrowest first", async () => {
        const r = await push([{ path: QML, data: "a" }, { path: "/usr/share/phoenix/qml/Phoenix/Shell/Shell.qml", data: "b" },
                              { path: "/usr/share/phoenix/runtime/phoenix-runtime.js", data: "c" }]);
        expect(r.restarted.map((x: Any) => x.what)).toEqual(["wam", "shell"]);
        expect(restarts()).toEqual(["systemctl restart webapp-mgr.service", "systemctl restart surface-manager-daemon.service"]);
    });
    it("closes an open app and opens it again, and rescans when its appinfo.json changed", async () => {
        running = ["org.webosphoenix.settings"];
        const r = await push([{ path: SETTINGS + "index.js", data: "a" }, { path: SETTINGS + "appinfo.json", data: "{}" }]);
        expect(r.restarted.map((x: Any) => x.what)).toEqual(["rescan", "app:org.webosphoenix.settings"]);
        expect(lunaCalls.map((c) => c[0])).toEqual(["com.palm.applicationManager/rescan", "com.webos.applicationManager/running",
            "com.webos.applicationManager/closeByAppId", "com.webos.applicationManager/launch"]);
    });
    it("leaves a closed app closed", async () => {
        await push([{ path: SETTINGS + "index.js", data: "a" }]);
        expect(lunaCalls.map((c) => c[0])).toEqual(["com.webos.applicationManager/running"]);
    });
    it("stops a service (the hub starts it on the next call), scans the hub's tables, runs the configurator", async () => {
        const r = await push([{ path: "/usr/palm/services/org.example.svc/service.js", data: "a" },
                              { path: "/usr/share/luna-service2/roles.d/org.example.svc.role.json", data: "{}" },
                              { path: "/etc/palm/db/kinds/org.example.kind", data: "{\"id\":1}" }]);
        expect(r.restarted.map((x: Any) => [x.what, x.ok])).toEqual([["hub", true], ["configurator", true], ["service:org.example.svc", true]]);
        expect(restarts()).toEqual(["ls-control scan-services", "pkill -f /usr/palm/services/org.example.svc/"]);
        expect(lunaCalls[0]).toEqual(["com.palm.configurator/run", { types: ["dbkinds", "dbpermissions", "activities"] }]);
    });
    it("asks for a device restart for what nothing restarts live, and a failed restart is said, not undone", async () => {
        sys.failOn("systemctl");
        const r = await push([{ path: "/usr/share/phoenix/product.json", data: "{}" }, { path: QML, data: "a" }]);
        expect(r.restarted).toEqual([{ what: "shell", ok: false, error: expect.stringContaining("failed") }, { what: "reboot", ok: true, pending: true }]);
        expect(r.pendingReboot).toBe(true);
        expect(dev.read(QML)).toBe("a");
        expect((await core.methods.getStatus({})).pendingReboot).toBe(true);
    });
});

describe("reverting (4.6)", () => {
    it("puts one file back: one the image has, one a bundle added, one a bundle deleted", async () => {
        const NEW = SETTINGS + "new.js";
        await push([{ path: QML, data: "changed\n" }, { path: NEW, data: "added\n" }], { removed: [SETTINGS + "old.js"] });
        expect(dev.read(QML)).toBe("changed\n");
        expect(dev.read(NEW)).toBe("added\n");
        expect(dev.exists(SETTINGS + "old.js")).toBe(false);
        sys.reset();
        expect((await core.methods.revert({ path: QML })).returnValue).toBe(true);
        expect(dev.read(QML)).toBe(h.IMAGE[QML]);
        expect((await core.methods.revert({ path: NEW })).returnValue).toBe(true);
        expect(dev.exists(NEW)).toBe(false);
        expect((await core.methods.revert({ path: SETTINGS + "old.js" })).returnValue).toBe(true);
        expect(dev.read(SETTINGS + "old.js")).toBe(h.IMAGE[SETTINGS + "old.js"]);
        expect(state().files).toEqual({});
        expect(state().removed).toEqual({});
        expect(sys.calls).toContain("systemctl restart surface-manager-daemon.service");
        expect(mounts()).toEqual([]);
        expect((await core.methods.revert({ path: QML })).errorCode).toBe("NOT_FOUND");
    });

    it("Revert to Image: marked, the device restarts, and the next boot deletes the overlay before mounting anything", async () => {
        await push([{ path: QML, data: "changed\n" }]);
        const r = await core.methods.revert({});
        expect(r).toMatchObject({ returnValue: true, restarting: true });
        expect(sys.calls[sys.calls.length - 1]).toBe("systemctl reboot");
        expect(state().clear).toBe(true);
        // The restart: the kernel's mounts are gone, the boot script runs.
        fs.rmSync(path.join(dev.root, "proc"), { recursive: true, force: true });
        sys.reset();
        const plan = await boot.boot({ root: dev.root, run: sys.run });
        expect(plan.clear).toBe(true);
        expect(fs.existsSync(path.join(dev.root, "var/lib/phoenix/overlay"))).toBe(false);
        expect(mounts()).toEqual([]);
    });

    it("at boot: mounts an overlay made for this build with Developer Mode on, drops what reverts left, and nothing otherwise", async () => {
        await push([{ path: QML, data: "changed\n" }, { path: SETTINGS + "index.js", data: "s\n" }]);
        await core.methods.revert({ path: SETTINGS + "index.js" });
        // The revert wrote the image's copy through the merged path; here, by hand, as overlayfs would have copied it up.
        fs.mkdirSync(path.dirname(upper(SETTINGS + "index.js")), { recursive: true });
        fs.writeFileSync(upper(SETTINGS + "index.js"), h.IMAGE[SETTINGS + "index.js"]);
        const reboot = () => { fs.rmSync(path.join(dev.root, "proc"), { recursive: true, force: true }); sys.reset(); };
        reboot();
        let plan = await boot.boot({ root: dev.root, run: sys.run });
        expect(plan.mount).toEqual(["/usr/share/phoenix", "/usr/palm"].filter((m) => plan.mount.includes(m)));
        expect(plan.mount).toContain("/usr/share/phoenix");
        expect(plan.drop).toEqual([SETTINGS + "index.js"]);
        expect(fs.existsSync(upper(SETTINGS + "index.js"))).toBe(false);
        expect(mounts().some((c: string) => c.endsWith(" /usr/share/phoenix"))).toBe(true);

        reboot();
        fs.rmSync(path.join(dev.root, "var/luna/preferences/devmode_enabled"));
        plan = await boot.boot({ root: dev.root, run: sys.run });
        expect(plan).toMatchObject({ mount: [], why: "Developer Mode is off" });
        expect(mounts()).toEqual([]);

        reboot();
        dev.write("/var/luna/preferences/devmode_enabled", "");
        dev.write("/etc/os-release", "BUILD_ID=20261201000000\n");
        plan = await boot.boot({ root: dev.root, run: sys.run });
        expect(plan.why).toMatch(/made for build/);
        expect(mounts()).toEqual([]);
        // The device on the new build starts with an empty overlay, and keeps the old one for a fall back.
        make();
        const st = await core.methods.getStatus({});
        expect(st.files).toEqual([]);
        expect(st.build).toBe("20261201000000");
        expect(fs.existsSync(path.join(dev.root, "var/lib/phoenix/overlay", h.BUILD))).toBe(true);
    });
});

describe("Trusted Developers: the extra layer on granted keys (9.1)", () => {
    let ada: Any;
    beforeEach(() => { ada = keys.generate("ada"); });
    const addGrant = (extra?: Any, master = dev.master) => core.methods.addGrant(h.grant(master, ada, core.image().id, extra));
    const send = (files: Any[], opts: Any = {}) => push(files, Object.assign({ key: ada, device: core.image().id, from: null }, opts));

    it("takes only a grant the platform's key signed, for this device, of 90 days at most, not expired", async () => {
        expect((await addGrant(undefined, keys.generate("not the platform"))).errorCode).toBe("BAD_GRANT");
        expect((await addGrant({ devices: ["nova-ffffffffffffffff"] })).errorText).toMatch(/does not cover this device/);
        expect((await addGrant({ expires: "2027-03-01T00:00:00Z" })).errorText).toMatch(/90 days/);
        expect((await addGrant({ issued: "2026-10-01T00:00:00Z", expires: "2026-10-15T00:00:00Z" })).errorText).toMatch(/expired/);
        expect((await addGrant()).returnValue).toBe(true);
        const k = await core.methods.listKeys({});
        expect(k.grants).toMatchObject([{ id: "grant-1", name: "Ada Developer", parts: ["apps", "shell"], expired: false, revoked: false }]);
        expect(k.master.fingerprint).toBe(dev.master.fingerprint);
    });

    it("a granted key's bundle waits for the owner, who is told, and applies with the passcode", async () => {
        await addGrant();
        const r = await send([{ path: QML, data: "from ada\n" }], { note: "Card fix" });
        expect(r).toMatchObject({ waiting: true });
        expect(dev.read(QML)).toBe(h.IMAGE[QML]);
        expect(notes).toEqual(["Developer changes from Ada Developer: Card fix"]);
        const w = await core.methods.listWaiting({});
        expect(w.bundles).toMatchObject([{ id: r.id, kind: "grant", grant: "grant-1", name: "Ada Developer", note: "Card fix", files: [QML],
                                          restart: ["shell"], roles: false }]);
        expect((await core.methods.apply({ id: r.id, passCode: "0000" })).errorCode).toBe("BAD_PASSCODE");
        const a = await core.methods.apply({ id: r.id, passCode: "1234" });
        expect(a).toMatchObject({ returnValue: true, applied: r.id });
        expect(dev.read(QML)).toBe("from ada\n");
        expect((await core.methods.listWaiting({})).bundles).toEqual([]);
        expect(state().files[QML]).toMatchObject({ kind: "grant", name: "Ada Developer" });
    });

    it("Decline drops one", async () => {
        await addGrant();
        const r = await send([{ path: QML, data: "x" }]);
        expect((await core.methods.decline({ id: r.id })).returnValue).toBe(true);
        expect((await core.methods.listWaiting({})).bundles).toEqual([]);
        expect((await core.methods.apply({ id: r.id, passCode: "1234" })).errorCode).toBe("NOT_FOUND");
    });

    it("refuses parts the grant does not allow, a bundle for any device, and one after the grant expired", async () => {
        await addGrant();
        await expect(send([{ path: "/usr/palm/services/org.example.svc/service.js", data: "x" }])).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
        await expect(send([{ path: QML, data: "x" }], { device: "any" })).rejects.toMatchObject({ code: "WRONG_DEVICE" });
        const r = await send([{ path: QML, data: "x" }]);
        clock = new Date("2026-12-10T00:00:00Z");
        const a = await core.methods.apply({ id: r.id, passCode: "1234" });
        expect(a).toMatchObject({ returnValue: false, errorCode: "UNTRUSTED" });
        expect(a.errorText).toMatch(/expired/);
        expect((await core.methods.listWaiting({})).bundles).toEqual([]);
    });

    it("a signed revocation list withdraws a grant (never an older list), checked again at Apply", async () => {
        await addGrant();
        const r = await send([{ path: QML, data: "x" }]);
        expect((await core.methods.setRevocations(h.revocations(dev.master, 2, { grants: ["grant-1"] }))).returnValue).toBe(true);
        expect((await core.methods.setRevocations(h.revocations(dev.master, 1))).errorCode).toBe("BAD_REVOCATIONS");
        expect((await core.methods.setRevocations(h.revocations(keys.generate("no"), 3))).errorCode).toBe("BAD_REVOCATIONS");
        const a = await core.methods.apply({ id: r.id, passCode: "1234" });
        expect(a.errorCode).toBe("UNTRUSTED");
        expect(a.errorText).toMatch(/revoked/);
        expect((await core.methods.listKeys({})).grants[0].revoked).toBe(true);
        await expect(send([{ path: QML, data: "y" }])).rejects.toMatchObject({ code: "UNTRUSTED" });
    });

    it("no replay per grant, and 10 bundles a day", async () => {
        await addGrant();
        const one = await send([{ path: QML, data: "1" }], { counter: 1795615400000 });
        expect((await core.methods.apply({ id: one.id, passCode: "1234" })).returnValue).toBe(true);
        await expect(send([{ path: QML, data: "2" }], { counter: 1795615400000 })).rejects.toMatchObject({ code: "REPLAY" });
        for (let i = 2; i <= 10; i++) {
            const b = await send([{ path: QML, data: String(i) }], { counter: 1795615400000 + i });
            expect((await core.methods.apply({ id: b.id, passCode: "1234" })).returnValue, "bundle " + i).toBe(true);
        }
        await expect(send([{ path: QML, data: "11" }], { counter: 1795615400011 })).rejects.toMatchObject({ code: "RATE_LIMITED" });
        clock = new Date(clock.getTime() + 86400000 + 1000);
        expect((await send([{ path: QML, data: "next day" }], { counter: 1795615400012 })).waiting).toBe(true);
    });

    it("the counters outlive Revert to Image", async () => {
        await push([{ path: QML, data: "1" }], { counter: 1795615500000 });
        await core.methods.revert({});
        fs.rmSync(path.join(dev.root, "proc"), { recursive: true, force: true });
        await boot.boot({ root: dev.root, run: sys.run });
        make();
        await expect(push([{ path: QML, data: "again" }], { counter: 1795615500000 })).rejects.toMatchObject({ code: "REPLAY" });
    });

    it("the platform's key and a paired computer relaying another's bundle wait for the owner too", async () => {
        const b = await h.makeBundle({ key: dev.master, files: [{ path: QML, data: "from the platform" }] });
        expect((await core.receive(b.bytes, b.signature, from())).waiting).toBe(true);
        const other = keys.generate("other");
        pairComputer(other, "Desktop");
        const c = await h.makeBundle({ key: other, files: [{ path: QML, data: "desktop's" }] });
        expect((await core.receive(c.bytes, c.signature, from())).waiting).toBe(true);
        expect((await core.methods.listWaiting({})).bundles.map((x: Any) => x.kind).sort()).toEqual(["master", "paired"]);
    });

    // Every grant for a key counts, not only the first on file: a renewed
    // grant (a new id) beside a revoked one, and a second grant with
    // another scope, each authorize what they allow.
    it("a key with several grants: any valid one authorizes, the counter is the grant's that did, never a replay across grants", async () => {
        await addGrant();
        await core.methods.setRevocations(h.revocations(dev.master, 1, { grants: ["grant-1"] }));
        expect((await addGrant({ id: "grant-2" })).returnValue).toBe(true);
        const one = await send([{ path: QML, data: "renewed" }], { counter: 1795615600000 });
        expect(one.waiting).toBe(true);
        expect((await core.methods.listWaiting({})).bundles[0].grant).toBe("grant-2");
        expect((await core.methods.apply({ id: one.id, passCode: "1234" })).returnValue).toBe(true);
        expect(JSON.parse(dev.read("/var/lib/phoenix/nova/counters.json"))["grant:grant-2"]).toBe(1795615600000);
        // Services only under a third grant: it applies under that one.
        expect((await addGrant({ id: "grant-3", parts: ["services"] })).returnValue).toBe(true);
        const svc = await send([{ path: "/usr/palm/services/org.example.svc/service.js", data: "x" }], { counter: 1795615600001 });
        expect((await core.methods.listWaiting({})).bundles.find((b: Any) => b.id === svc.id).grant).toBe("grant-3");
        // The bundle grant-2 took cannot come again under grant-3 (it allows
        // its parts too, but the key's bundles count up across its grants).
        await addGrant({ id: "grant-4", parts: ["shell"] });
        await expect(send([{ path: QML, data: "renewed" }], { counter: 1795615600000 })).rejects.toMatchObject({ code: "REPLAY" });
    });

    it("a renewed grant replaces the expired one for its key; an expired grant alone still says it expired", async () => {
        await addGrant();
        clock = new Date("2026-12-10T00:00:00Z");
        await expect(send([{ path: QML, data: "x" }])).rejects.toMatchObject({ code: "UNTRUSTED", message: expect.stringMatching(/expired/) });
        expect((await addGrant({ id: "grant-2", issued: "2026-12-09T00:00:00Z", expires: "2026-12-23T00:00:00Z" })).returnValue).toBe(true);
        expect((await core.methods.listKeys({})).grants.map((g: Any) => g.id)).toEqual(["grant-2"]);
        expect((await send([{ path: QML, data: "x" }])).waiting).toBe(true);
    });

    it("a revoked paired computer is trusted for nothing: unpaired, its SSH key taken out, and it cannot pair again", async () => {
        dev.write("/home/user/.ssh/authorized_keys", "ssh-ed25519 AAAAmine me@laptop\n");
        const desk = keys.generate("desk");
        expect(await pairWith(desk, "Desk top")).toBe(true);
        expect(dev.read("/home/user/.ssh/authorized_keys")).toContain("nova:Desk_top");
        expect(core.isPaired(desk.publicKey)).toBe(true);
        expect((await core.methods.setRevocations(h.revocations(dev.master, 1, { keys: [desk.id] }))).returnValue).toBe(true);
        expect(core.isPaired(desk.publicKey)).toBe(false);
        expect(core.paired().map((p: Any) => p.key)).toEqual([computer.publicKey]);
        expect(dev.read("/home/user/.ssh/authorized_keys")).not.toContain("nova:Desk_top");
        expect(dev.read("/home/user/.ssh/authorized_keys")).toContain("me@laptop");
        expect(core.isRevoked(desk.publicKey)).toBe(true);
        await expect(pairWith(desk, "Desk top")).rejects.toMatchObject({ code: "UNTRUSTED" });
        expect(core.isPaired(desk.publicKey)).toBe(false);
        // A paired.json from before the list (written behind novad's back)
        // still gives the revoked key nothing.
        pairComputer(desk, "Desk top");
        expect(core.isPaired(desk.publicKey)).toBe(false);
    });

    it("at start, a revoked key left from before the list is unpaired and its SSH key taken out", async () => {
        dev.write("/home/user/.ssh/authorized_keys", "ssh-ed25519 AAAAmine me@laptop\n");
        const desk = keys.generate("desk");
        expect(await pairWith(desk, "Desk top")).toBe(true);
        const before = dev.read("/home/user/.ssh/authorized_keys");
        expect((await core.methods.setRevocations(h.revocations(dev.master, 1, { keys: [desk.id] }))).returnValue).toBe(true);
        // An older novad left the revoked key in paired.json and its SSH line in place.
        pairComputer(desk, "Desk top");
        dev.write("/home/user/.ssh/authorized_keys", before);
        expect(dev.read("/home/user/.ssh/authorized_keys")).toContain("nova:Desk_top");
        make();   // novad starts again
        expect(core.paired().map((p: Any) => p.key)).toEqual([computer.publicKey]);
        expect(dev.read("/home/user/.ssh/authorized_keys")).not.toContain("nova:Desk_top");
        expect(dev.read("/home/user/.ssh/authorized_keys")).toContain("me@laptop");
    });

    // A replace puts back what it leaves out (4.4): under a grant, only what
    // the grant may change, so an apps-only grant never reverts the owner's
    // shell, service or role changes (nor restarts the shell for them); the
    // waiting entry lists the reverts and the restarts they cause.
    it("a grant's replace puts back only what the grant may change, and the waiting entry says so", async () => {
        const SVC = "/usr/palm/services/org.example.svc/service.js", ROLE = "/usr/share/luna-service2/roles.d/org.example.svc.role.json";
        const APP = SETTINGS + "index.js", OLD = SETTINGS + "old.js";
        await push([{ path: QML, data: "paired\n" }, { path: SVC, data: "paired svc\n" }, { path: ROLE, data: "{\"paired\": 1}\n" },
                    { path: OLD, data: "paired old\n" }]);
        await addGrant({ parts: ["apps"] });
        const r = await send([{ path: APP, data: "from ada\n" }]);
        expect(r).toMatchObject({ waiting: true });
        const w = (await core.methods.listWaiting({})).bundles[0];
        expect(w).toMatchObject({ files: [APP], removed: [], reverts: [OLD], restart: ["app:org.webosphoenix.settings"] });
        sys.reset();
        const a = await core.methods.apply({ id: r.id, passCode: "1234" });
        expect(a).toMatchObject({ returnValue: true, reverted: 1, restarted: [{ what: "app:org.webosphoenix.settings", ok: true }] });
        expect(dev.read(OLD)).toBe(h.IMAGE[OLD]);
        expect([dev.read(QML), dev.read(SVC), dev.read(ROLE)]).toEqual(["paired\n", "paired svc\n", "{\"paired\": 1}\n"]);
        expect(Object.keys(state().files).sort()).toEqual([APP, QML, ROLE, SVC].sort());
        expect(sys.calls.filter((c: string) => /^(systemctl|pkill|ls-control)/.test(c))).toEqual([]);
        // A paired computer's replace still puts back everything it leaves out.
        await push([{ path: QML, data: "paired again\n" }]);
        expect(Object.keys(state().files)).toEqual([QML]);
    });

    // What a grant's replace keeps (outside its parts) counts against the cap.
    it("a grant's replace counts the files it keeps against the overlay's cap", async () => {
        expect((await core.methods.setOptions({ overlayCap: 1 << 20 })).returnValue).toBe(true);
        await push([{ path: QML, data: "y".repeat(700 * 1024) }]);
        await addGrant({ parts: ["apps"] });
        await expect(send([{ path: SETTINGS + "index.js", data: "z".repeat(700 * 1024) }])).rejects.toMatchObject({ code: "NO_SPACE" });
        const r = await send([{ path: SETTINGS + "index.js", data: "z".repeat(300 * 1024) }]);
        expect(r).toMatchObject({ waiting: true });
        // Checked again at Apply, against the overlay as it is then.
        await push([{ path: QML, data: "y".repeat(800 * 1024) }]);
        expect(await core.methods.apply({ id: r.id, passCode: "1234" })).toMatchObject({ returnValue: false, errorCode: "NO_SPACE" });
        expect((await core.methods.getStatus({})).usage).toBe(800 * 1024);
    });

    it("Remove takes a paired computer or a grant away, and its bundles with it", async () => {
        await addGrant();
        expect((await core.methods.removeKey({ key: "grant-1" })).removed).toBe("grant");
        await expect(send([{ path: QML, data: "x" }])).rejects.toMatchObject({ code: "UNTRUSTED" });
        expect((await core.methods.removeKey({ key: computer.id })).removed).toBe("paired");
        await expect(push([{ path: QML, data: "x" }])).rejects.toMatchObject({ code: "UNTRUSTED" });
        expect((await core.methods.removeKey({ key: "nope" })).errorCode).toBe("NOT_FOUND");
    });
});

describe("Pair a Computer and the status", () => {
    it("shows a six-digit code and the device's fingerprint for two minutes", async () => {
        const r = await core.methods.pairStart({});
        expect(r.code).toMatch(/^\d{6}$/);
        expect(r.fingerprint).toBe(core.deviceKey().fingerprint);
        expect(Date.parse(r.expires) - clock.getTime()).toBe(120000);
        const st = await core.methods.getStatus({});
        expect(st.pairing).toMatchObject({ code: r.code, runsLeft: 5 });
        await core.methods.pairCancel({});
        expect((await core.methods.getStatus({})).pairing).toBeNull();
    });

    it("lists what the overlay holds, and tells subscribers each change", async () => {
        const seen: Any[] = [];
        const stop = core.watch((s: Any) => seen.push(s));
        await push([{ path: QML, data: "abc" }], { note: "A note" });
        stop();
        const st = await core.methods.getStatus({});
        expect(st).toMatchObject({ devMode: true, build: h.BUILD, product: "1.0", compatible: h.COMPATIBLE, active: true, usage: 3,
                                   files: [{ path: QML, size: 3, name: "Laptop" }] });
        expect(st.bundles[0]).toMatchObject({ note: "A note", kind: "paired", files: 1 });
        expect(st.deviceId).toMatch(/^nova-[0-9a-f]{16}$/);
        expect(seen.length).toBeGreaterThan(0);
    });

    it("writes the paired computers into the `user` account's authorized_keys (nova term), leaving the rest", async () => {
        dev.write("/home/user/.ssh/authorized_keys", "ssh-ed25519 AAAAmine me@laptop\n");
        await core.methods.setOptions({ network: true });
        // Pairing adds; removing takes away.
        const other = keys.generate("x");
        const run = await pairWith(other, "Desk top");
        expect(run).toBe(true);
        const text = dev.read("/home/user/.ssh/authorized_keys");
        expect(text).toContain("ssh-ed25519 AAAAmine me@laptop");
        expect(text).toContain(keys.sshPublic(other.publicKey, "nova:Desk_top"));
        await core.methods.removeKey({ key: other.id });
        expect(dev.read("/home/user/.ssh/authorized_keys")).not.toContain("nova:Desk_top");
        expect(dev.read("/home/user/.ssh/authorized_keys")).toContain("me@laptop");
    });
});

describe("a pairing run belongs to its window (6.4)", () => {
    // The device's side of a run, up to the computer's confirmation.
    function startRun(key: Any, code: string) {
        const pake = require("./lib/pake.js");
        const crypto = require("node:crypto");
        const aad = Buffer.alloc(32, 9);
        const ids = nova.pairIdentities(key.publicKey, core.deviceKey().publicKey);
        const a = pake.party("A", { code, salt: ids.salt, A: ids.A, B: ids.B, aad });
        const run = core.pairRun(key.publicKey, aad, a.start().toString("base64"));
        const res = a.finish(Buffer.from(run.reply.pB, "base64"));
        expect(a.verify(Buffer.from(run.reply.confirm, "base64"))).toBe(true);
        const proof = crypto.sign(null, Buffer.from(nova.proofText("A", res.TT)), key.privateKey).toString("base64");
        return () => run.finish(res.confirm.toString("base64"), proof, "Late");
    }
    const late = () => keys.generate("late");

    it("is refused once the owner cancels", () => {
        const k = late();
        const confirm = startRun(k, core.pairStart().code);
        core.pairCancel();
        expect(confirm).toThrow(expect.objectContaining({ code: "NOT_PAIRING" }));
        expect(core.isPaired(k.publicKey)).toBe(false);
    });
    it("is refused once the two minutes are up", () => {
        const k = late();
        const confirm = startRun(k, core.pairStart().code);
        clock = new Date(clock.getTime() + 121000);
        expect(confirm).toThrow(expect.objectContaining({ code: "NOT_PAIRING" }));
        expect(core.isPaired(k.publicKey)).toBe(false);
    });
    it("is refused once a new window starts", () => {
        const k = late();
        const confirm = startRun(k, core.pairStart().code);
        core.pairStart();
        expect(confirm).toThrow(expect.objectContaining({ code: "NOT_PAIRING" }));
        expect(core.isPaired(k.publicKey)).toBe(false);
    });
    it("is refused once another computer pairs in the same window", () => {
        const k = late(), other = keys.generate("other");
        const { code } = core.pairStart();
        const confirm = startRun(k, code);
        startRun(other, code)();
        expect(core.isPaired(other.publicKey)).toBe(true);
        expect(confirm).toThrow(expect.objectContaining({ code: "NOT_PAIRING" }));
        expect(core.isPaired(k.publicKey)).toBe(false);
    });
    it("still pairs within its own window", () => {
        const k = late();
        startRun(k, core.pairStart().code)();
        expect(core.isPaired(k.publicKey)).toBe(true);
    });
});

// The device's side of a run, driven in process (over TLS: proto.test.ts).
async function pairWith(key: Any, name: string) {
    const pake = require("./lib/pake.js");
    const crypto = require("node:crypto");
    const { code } = core.pairStart();
    const aad = Buffer.alloc(32, 7);
    const ids = nova.pairIdentities(key.publicKey, core.deviceKey().publicKey);
    const a = pake.party("A", { code, salt: ids.salt, A: ids.A, B: ids.B, aad });
    const run = core.pairRun(key.publicKey, aad, a.start().toString("base64"));
    const res = a.finish(Buffer.from(run.reply.pB, "base64"));
    if (!a.verify(Buffer.from(run.reply.confirm, "base64"))) return false;
    const proof = crypto.sign(null, Buffer.from(nova.proofText("A", res.TT)), key.privateKey).toString("base64");
    run.finish(res.confirm.toString("base64"), proof, name);
    return true;
}

// nova term's SSH (sshd-phoenix-devmode.conf): sshd reads authorized_keys
// as `user` and refuses (StrictModes) one another account owns.
describe("the paired computers' SSH keys on a fresh image", () => {
    it("makes ~/.ssh when the image has none, and both it and authorized_keys belong to the account", async () => {
        const home = path.join(dev.root, "home/user");
        fs.rmSync(path.join(home, ".ssh"), { recursive: true, force: true });
        // As root (a container), give the home another owner, so the chown is seen.
        if (process.getuid && process.getuid() === 0) fs.chownSync(home, 4242, 4242);
        const owner = fs.statSync(home);
        const desk = keys.generate("desk");
        expect(await pairWith(desk, "Desk top")).toBe(true);
        expect(dev.read("/home/user/.ssh/authorized_keys")).toContain("nova:Desk_top");
        const dir = fs.statSync(path.join(home, ".ssh")), file = fs.statSync(path.join(home, ".ssh/authorized_keys"));
        expect(dir.mode & 0o777).toBe(0o700);
        expect(file.mode & 0o777).toBe(0o600);
        expect([dir.uid, dir.gid, file.uid, file.gid]).toEqual([owner.uid, owner.gid, owner.uid, owner.gid]);
    });

    it("writes nothing when the account has no home", async () => {
        fs.rmSync(path.join(dev.root, "home/user"), { recursive: true, force: true });
        expect(await pairWith(keys.generate("desk"), "Desk top")).toBe(true);
        expect(dev.exists("/home/user")).toBe(false);
    });
});
