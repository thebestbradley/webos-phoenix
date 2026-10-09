// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.hardware (hardwareservice.js) against a made-up device:
// its hardware, opkg and the kernel are fakes that behave like the real
// ones (installing a firmware package puts the file in /lib/firmware; a
// reload makes the driver find it). The catalog is signed here with Node's
// Ed25519, as server/drivers signs it with libsodium (tested in
// server/drivers/tests/run.php, and against this code in
// tools/test-hardware.cjs). lib/sysfs.js and lib/node.js are tested in
// lib/*.test.ts.

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const { createHardwareService } = require("./hardwareservice.js") as Any;
const driversLib = require("./lib/drivers.js") as Any;

const BASE = "https://drivers.example/v1/";
const sha256 = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");
const bytesOf = (text: string) => new Uint8Array(Buffer.from(text));

function keyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    return { key: Buffer.from(raw).toString("base64"), sign: (b: Uint8Array) => crypto.sign(null, b, privateKey).toString("base64") };
}

const REALTEK_LICENSE = { id: "LicenseRef-rtlwifi-firmware", name: "Realtek firmware licence", text: "Redistribution and use in binary form, without modification, are permitted…",
                          url: "https://git.kernel.org/pub/scm/linux/kernel/git/firmware/linux-firmware.git/tree/LICENCE.rtlwifi_firmware.txt",
                          free: false, redistributable: true };

// Package files, by URL.
function pkg(name: string, version: string, arch = "all", extra: Any = {}) {
    const body = bytesOf(`${name} ${version} ${arch}`);
    return { file: { name, version, arch, url: `packages/${name}_${version}_${arch}.ipk`, size: body.length, sha256: sha256(body), ...extra },
             url: `${BASE}packages/${name}_${version}_${arch}.ipk`, body };
}

function catalogOf(build: number, entries: Any[], extra: Any = {}) {
    return { format: 1, build, generated: "2026-10-01T00:00:00Z", expires: "2099-01-01T00:00:00Z", source: { id: "phoenix", name: "Phoenix Drivers" },
             drivers: entries, ...extra };
}

function makeWorld() {
    const signer = keyPair();
    const fw8821 = pkg("linux-firmware-rtw88", "20240909");
    const fw8821new = pkg("linux-firmware-rtw88", "20241010");
    const rtl8812 = pkg("kernel-module-rtl8812au", "5.13.6", "x86_64", { kernel: "6.6.21-phoenix" });
    const nvidia = pkg("nvidia-open", "570.86", "x86_64");
    const nvidiaFw = pkg("linux-firmware-nvidia-gsp", "570.86");
    const notForUs = pkg("kernel-module-foo", "1.0", "aarch64");
    const entries: Any = {
        rtw88: { id: "firmware-rtw88", kind: "firmware", title: "Realtek Wi-Fi firmware (rtw88)", summary: "For Realtek USB and PCIe Wi-Fi adapters",
                 category: "wifi", match: ["usb:v0BDApC811d*", "pci:v000010ECd0000C821sv*"], firmware: ["rtw88/rtw8821c_fw.bin"],
                 modules: ["rtw88_8821cu"], after: "reload", license: REALTEK_LICENSE, source: "https://git.kernel.org/pub/scm/linux/kernel/git/firmware/linux-firmware.git",
                 packages: [fw8821.file] },
        rtl8812: { id: "module-rtl8812au", kind: "module", title: "Realtek RTL8812AU driver", category: "wifi", match: ["usb:v0BDAp8812d*"],
                   modules: ["8812au"], after: "reload", license: { id: "GPL-2.0-only", name: "GNU GPL 2.0", free: true, redistributable: true },
                   packages: [rtl8812.file] },
        nvidia: { id: "driver-nvidia-open", kind: "module", title: "NVIDIA driver", category: "graphics", optional: true, match: ["pci:v000010DEd00001F82sv*"],
                  modules: ["nvidia"], after: "reboot", license: { id: "LicenseRef-NVIDIA", name: "NVIDIA software licence", text: "…", free: false, redistributable: true },
                  packages: [nvidia.file, nvidiaFw.file] },
        // Never offered: its licence does not allow passing it on.
        secret: { id: "firmware-secret", kind: "firmware", title: "Not redistributable", match: ["usb:v1209p0001d*"], firmware: [],
                  license: { id: "LicenseRef-x", name: "No", free: false, redistributable: false }, packages: [notForUs.file] },
        arm: { id: "module-foo", kind: "module", title: "Only for ARM", match: ["usb:v1209p0001d*"],
               license: { id: "MIT", name: "MIT", free: true, redistributable: true }, packages: [notForUs.file] },
    };
    const world = {
        signer, entries, files: new Map<string, Uint8Array>(), served: new Map<string, Uint8Array>(), requests: [] as Any[], toasts: [] as Any[],
        ongoing: [] as Any[], activities: [] as Any[], posts: [] as Any[], opkgCalls: [] as Any[], activations: [] as Any[],
        installed: new Map<string, string>([["kernel", "6.6.21"]]), firmware: new Set<string>(), state: null as Any,
        failOpkg: null as string | null, brokenFirmware: false, catalogBuild: 3,
        devices: [
            { id: "pci:0000:02:00.0", bus: "pci", name: "AR9462 Wireless Network Adapter", vendor: "Qualcomm Atheros", category: "wifi",
              modaliases: ["pci:v0000168Cd00000034sv0000105Bsd0000E052bc02sc80i00"], driver: "ath9k", firmwareMissing: [] },
            { id: "usb:1-2", bus: "usb", name: "802.11ac NIC", vendor: "Realtek", category: "wifi",
              modaliases: ["usb:v0BDApC811d0200dc00dsc00dp00icFFiscFFipFFin00"], driver: null, firmwareMissing: ["rtw88/rtw8821c_fw.bin"] },
            { id: "usb:1-3", bus: "usb", name: "802.11n NIC", vendor: "Realtek", category: "wifi",
              modaliases: ["usb:v0BDAp8812d0000dc00dsc00dp00icFFiscFFipFFin00"], driver: null, firmwareMissing: [] },
            { id: "pci:0000:01:00.0", bus: "pci", name: "TU117 [GeForce GTX 1650]", vendor: "NVIDIA", category: "graphics",
              modaliases: ["pci:v000010DEd00001F82sv00001043sd000087B4bc03sc00i00"], driver: "nouveau", firmwareMissing: [] },
            { id: "usb:1-4", bus: "usb", name: "USB device (1209:0001)", vendor: "", category: "other",
              modaliases: ["usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00"], driver: null, firmwareMissing: [] },
            { id: "machine", bus: "dmi", name: "Phoenix Tablet", category: "other", modaliases: ["dmi:bvnPhoenix:pnTablet:"], driver: null,
              firmwareMissing: [], hidden: true },
        ] as Any[],
    };
    for (const p of [fw8821, fw8821new, rtl8812, nvidia, nvidiaFw, notForUs]) world.served.set(p.url, p.body);
    const publish = (build: number, list: Any[], extra: Any = {}) => {
        const index = bytesOf(JSON.stringify(catalogOf(build, list, extra)));
        world.served.set(BASE + "drivers.json", index);
        world.served.set(BASE + "drivers.json.sig", bytesOf(signer.sign(index)));
    };
    publish(world.catalogBuild, Object.values(entries));
    return { world, publish, pkgs: { fw8821, fw8821new, rtl8812, nvidia, nvidiaFw } };
}

function makeService(world: Any, config: Any = null) {
    const fwOf: Record<string, string> = { "linux-firmware-rtw88": "rtw88/rtw8821c_fw.bin" };
    const service = createHardwareService({
        system: {
            // The kernel: a driver binds when it has its firmware.
            scan: async () => world.devices.map((d: Any) => {
                const missing = d.firmwareMissing.filter((f: string) => !world.firmware.has(f));
                const fixed = d.firmwareMissing.length && !missing.length;
                const moduleIn = d.id === "usb:1-3" && world.installed.has("kernel-module-rtl8812au");
                return { ...d, firmwareMissing: missing, driver: fixed ? "rtw88_8821cu" : moduleIn ? "8812au" : d.driver };
            }),
            info: async () => ({ arch: "x86_64", kernel: "6.6.21-phoenix" }),
            activate: async (step: Any) => {
                world.activations.push(step);
                // Firmware is only read when the driver probes again.
                world.firmware = new Set([...world.installed.keys()].map((n) => fwOf[n]).filter((f) => f && !world.brokenFirmware));
            },
        },
        opkg: {
            list: async () => [...world.installed].map(([name, version]) => ({ name, version })),
            install: async (paths: string[], o: Any) => {
                world.opkgCalls.push({ op: "install", paths, downgrade: !!o?.downgrade });
                if (world.failOpkg) return { ok: false, error: world.failOpkg };
                for (const p of paths) {
                    const [name, version] = path.basename(p).split("_");
                    world.installed.set(name, version);
                }
                return { ok: true };
            },
            remove: async (names: string[]) => {
                world.opkgCalls.push({ op: "remove", names });
                names.forEach((n) => world.installed.delete(n));
                return { ok: true };
            },
        },
        request: async (req: Any) => {
            world.requests.push(req.url);
            if (req.method === "POST") { world.posts.push({ url: req.url, body: JSON.parse(req.body) }); return { status: 201, body: "{}" }; }
            const b = world.served.get(req.url);
            return b ? { status: 200, body: Buffer.from(b).toString("utf8") } : { status: 404, body: "" };
        },
        requestBytes: async (req: Any) => {
            world.requests.push(req.url);
            const b = world.served.get(req.url);
            return b ? { status: 200, bytes: b } : { status: 404, bytes: new Uint8Array() };
        },
        crypto: {
            sha256: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha256").update(b).digest()),
            sha512: async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha512").update(b).digest()),
        },
        files: {
            write: (name: string, bytes: Uint8Array) => { world.files.set("/cache/" + name, bytes); return "/cache/" + name; },
            find: (name: string) => (world.files.has("/cache/" + name) ? "/cache/" + name : null),
            remove: (p: string) => { world.files.delete(p); },
        },
        state: { load: () => (world.state ? JSON.parse(JSON.stringify(world.state)) : null), save: (o: Any) => { world.state = JSON.parse(JSON.stringify(o)); } },
        config: () => config ?? { sources: [{ id: "phoenix", name: "Phoenix Drivers", url: BASE, key: world.signer.key }], reportUrl: BASE + "report" },
        luna: {
            call: async (uri: string, params: Any) => {
                if (uri.endsWith("/createToast")) world.toasts.push(params);
                if (uri.includes("org.webosphoenix.ongoing")) world.ongoing.push({ uri, params });
                if (uri.includes("activitymanager")) world.activities.push({ uri, params });
                return { returnValue: true };
            },
        },
        now: () => new Date("2026-10-09T12:00:00Z"),
    });
    return service;
}

const byId = (r: Any, id: string) => r.devices.find((d: Any) => d.id === id);

describe("the driver catalog", () => {
    it("matches modaliases with the kernel's globs", () => {
        const re = driversLib.globToRegExp;
        expect(re("usb:v0BDApC811d*").test("usb:v0BDApC811d0200dc00dsc00dp00icFFiscFFipFFin00")).toBe(true);
        expect(re("usb:v0BDApC811d*").test("usb:v0BDApC812d0200")).toBe(false);
        expect(re("pci:v000010ECd0000C8[0-9A-F]?sv*").test("pci:v000010ECd0000C82Bsv00001043sd00008776bc02sc80i00")).toBe(true);
        expect(re("of:N*T*Crealtek,rtl8723bs*").test("of:NwifiT(null)Crealtek,rtl8723bs")).toBe(true);
        expect(re("acpi:BOSC020[!1]:*").test("acpi:BOSC0200:")).toBe(true);
        expect(re("acpi:BOSC020[!1]:*").test("acpi:BOSC0201:")).toBe(false);
        expect(re("usb:v1.3*").test("usb:v1x3")).toBe(false);
    });

    it("keeps only usable entries that may be redistributed", () => {
        const { world } = makeWorld();
        const n = (e: Any) => driversLib.normalize(e, BASE);
        expect(n(world.entries.rtw88)?.packages[0].url).toBe(`${BASE}packages/linux-firmware-rtw88_20240909_all.ipk`);
        expect(n(world.entries.secret)).toBeNull();
        expect(n({ ...world.entries.rtw88, id: "Bad ID" })).toBeNull();
        expect(n({ ...world.entries.rtw88, kind: "script" })).toBeNull();
        expect(n({ ...world.entries.rtw88, match: ["nope:*"], firmware: [] })).toBeNull();
        expect(n({ ...world.entries.rtw88, firmware: ["../../etc/shadow"], match: [] })).toBeNull();
        expect(n({ ...world.entries.rtw88, packages: [{ ...world.entries.rtw88.packages[0], sha256: "abc" }] })).toBeNull();
    });

    it("picks the packages for this processor and kernel", () => {
        const { world } = makeWorld();
        const e = driversLib.normalize(world.entries.rtl8812, BASE);
        expect(driversLib.packagesFor(e, { arch: "x86_64", kernel: "6.6.21-phoenix" }).packages).toHaveLength(1);
        expect(driversLib.packagesFor(e, { arch: "x86_64", kernel: "6.6.22-phoenix" }).reason).toMatch(/kernel \(6\.6\.22-phoenix\)/);
        expect(driversLib.packagesFor(e, { arch: "aarch64", kernel: "6.6.21-phoenix" }).reason).toMatch(/processor \(aarch64\)/);
    });

    it("takes only a catalog signed with the pinned key, not expired and not older", async () => {
        const { world } = makeWorld();
        const index = world.served.get(BASE + "drivers.json")!;
        const sig = Buffer.from(world.served.get(BASE + "drivers.json.sig")!).toString();
        const sha512 = async (b: Uint8Array) => new Uint8Array(crypto.createHash("sha512").update(b).digest());
        const opts = { sha512, baseUrl: BASE, now: new Date("2026-10-09T00:00:00Z") };
        const ok = await driversLib.verifyIndex(index, sig, world.signer.key, opts);
        expect(ok.build).toBe(3);
        expect(ok.drivers.map((d: Any) => d.id)).toEqual(["firmware-rtw88", "module-rtl8812au", "driver-nvidia-open", "module-foo"]);
        const tampered = new Uint8Array(index);
        tampered[20] ^= 1;
        await expect(driversLib.verifyIndex(tampered, sig, world.signer.key, opts)).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
        await expect(driversLib.verifyIndex(index, sig, keyPair().key, opts)).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
        await expect(driversLib.verifyIndex(index, sig, null, opts)).rejects.toMatchObject({ code: "UNTRUSTED" });
        await expect(driversLib.verifyIndex(index, sig, world.signer.key, { ...opts, lastBuild: 4 })).rejects.toMatchObject({ code: "ROLLBACK" });
        await expect(driversLib.verifyIndex(index, sig, world.signer.key, { ...opts, now: new Date("2100-01-01") })).rejects.toMatchObject({ code: "EXPIRED" });
    });

    it("uses the same Ed25519 and base64 code as the Marketplace", () => {
        for (const f of ["ed25519.js", "b64.js"]) {
            expect(fs.readFileSync(path.join(HERE, "lib", f), "utf8"))
                .toBe(fs.readFileSync(path.join(HERE, "../../apps/marketplace/service/lib", f), "utf8"));
        }
    });
});

describe("the hardware service", () => {
    it("lists the hardware with what each device needs", async () => {
        const { world } = makeWorld();
        const r = await makeService(world).list();
        expect(r.returnValue).toBe(true);
        expect(r.catalog).toMatchObject({ name: "Phoenix Drivers", build: 3, error: null });
        expect(r.devices.map((d: Any) => [d.id, d.status])).toEqual([
            ["pci:0000:02:00.0", "working"], ["usb:1-2", "needs-firmware"], ["usb:1-3", "needs-driver"],
            ["pci:0000:01:00.0", "working"], ["usb:1-4", "no-driver"],
        ]);
        const fw = byId(r, "usb:1-2").offers[0];
        expect(fw).toMatchObject({ driverId: "firmware-rtw88", kind: "firmware", available: true, installed: false, optional: false,
                                   license: { id: "LicenseRef-rtlwifi-firmware", free: false } });
        expect(fw.size).toBe(world.entries.rtw88.packages[0].size);
        expect(byId(r, "pci:0000:01:00.0").offers[0]).toMatchObject({ driverId: "driver-nvidia-open", optional: true, after: "reboot",
                                                                     packages: ["nvidia-open", "linux-firmware-nvidia-gsp"] });
        // Built for another processor: offered as not available, with why.
        expect(byId(r, "usb:1-4").offers).toEqual([expect.objectContaining({ driverId: "module-foo", available: false,
                                                                               reason: expect.stringMatching(/aarch64|x86_64/) })]);
        // The daily check is scheduled.
        expect(world.activities[0].params.activity.name).toBe("org.webosphoenix.hardware.check");
    });

    it("lists the hardware with no catalog, and says why", async () => {
        const { world } = makeWorld();
        const r = await makeService(world, { sources: [{ id: "phoenix", url: BASE, key: null }] }).list();
        expect(r.catalog.error.errorCode).toBe("UNTRUSTED");
        expect(byId(r, "usb:1-2").status).toBe("needs-firmware");
        expect(byId(r, "usb:1-2").offers).toEqual([]);
    });

    it("installs firmware after the licence is accepted, and the device works", async () => {
        const { world } = makeWorld();
        const svc = makeService(world);
        await svc.list();
        const refused = await svc.install({ driverId: "firmware-rtw88", deviceId: "usb:1-2" });
        expect(refused).toMatchObject({ returnValue: false, errorCode: "LICENSE_REQUIRED" });
        const steps: Any[] = [];
        const r = await svc.install({ driverId: "firmware-rtw88", deviceId: "usb:1-2", acceptLicense: "LicenseRef-rtlwifi-firmware" }, (s: Any) => steps.push(s.state));
        expect(r).toMatchObject({ returnValue: true, state: "installed" });
        expect(steps).toEqual(["downloading", "checking", "installing", "activating", "installed"]);
        expect(world.opkgCalls).toEqual([{ op: "install", paths: ["/cache/linux-firmware-rtw88_20240909_all.ipk"], downgrade: false }]);
        expect(world.activations[0]).toMatchObject({ after: "reload", modules: ["rtw88_8821cu"], deviceId: "usb:1-2" });
        // An ongoing activity while it ran, cleared at the end.
        expect(world.ongoing[0].params).toMatchObject({ appId: "org.webosphoenix.settings", title: "Realtek Wi-Fi firmware (rtw88)",
                                                        params: { page: "hardware", driverId: "firmware-rtw88" } });
        expect(world.ongoing.at(-1).uri).toMatch(/\/clear$/);
        const after = await svc.list();
        expect(byId(after, "usb:1-2")).toMatchObject({ status: "working", driver: "rtw88_8821cu" });
        expect(byId(after, "usb:1-2").offers[0]).toMatchObject({ installed: true, installedVersion: "20240909" });
        // The package is kept, to roll an update back to.
        expect([...world.files.keys()]).toEqual(["/cache/linux-firmware-rtw88_20240909_all.ipk"]);
    });

    it("installs a free driver without asking for a licence", async () => {
        const { world } = makeWorld();
        const svc = makeService(world);
        const r = await svc.install({ driverId: "module-rtl8812au", deviceId: "usb:1-3" });
        expect(r.state).toBe("installed");
        expect(byId(await svc.list(), "usb:1-3")).toMatchObject({ status: "working", driver: "8812au" });
    });

    it("refuses a download that is not the file the catalog signed", async () => {
        const { world, pkgs } = makeWorld();
        world.served.set(pkgs.fw8821.url, bytesOf("linux-firmware-rtw88 2024090X all"));   // same size, other bytes
        const svc = makeService(world);
        await svc.list();
        const r = await svc.install({ driverId: "firmware-rtw88", deviceId: "usb:1-2", acceptLicense: REALTEK_LICENSE.id });
        expect(r).toMatchObject({ returnValue: false, errorCode: "BAD_DOWNLOAD", state: "failed", rolledBack: false });
        expect(world.opkgCalls).toEqual([]);
        expect(world.files.size).toBe(0);
        world.served.set(pkgs.fw8821.url, bytesOf("short"));
        expect((await svc.install({ driverId: "firmware-rtw88", acceptLicense: REALTEK_LICENSE.id })).errorText).toMatch(/size/);
        world.served.delete(pkgs.fw8821.url);
        expect((await svc.install({ driverId: "firmware-rtw88", acceptLicense: REALTEK_LICENSE.id })).errorCode).toBe("DOWNLOAD_FAILED");
    });

    it("rolls back when opkg fails", async () => {
        const { world } = makeWorld();
        world.failOpkg = "Cannot satisfy dependencies";
        const svc = makeService(world);
        await svc.list();
        const r = await svc.install({ driverId: "firmware-rtw88", deviceId: "usb:1-2", acceptLicense: REALTEK_LICENSE.id });
        expect(r).toMatchObject({ returnValue: false, errorCode: "INSTALL_FAILED", rolledBack: true });
        expect(r.errorText).toMatch(/Cannot satisfy dependencies\. Your device was put back as it was\./);
        expect(world.opkgCalls.at(-1)).toEqual({ op: "remove", names: ["linux-firmware-rtw88"] });
        expect(world.state.installed).toEqual({});
        expect(world.files.size).toBe(0);
    });

    it("rolls back when the device still does not work", async () => {
        const { world } = makeWorld();
        world.brokenFirmware = true;   // the firmware is installed but the driver cannot use it
        const svc = makeService(world);
        await svc.list();
        const r = await svc.install({ driverId: "firmware-rtw88", deviceId: "usb:1-2", acceptLicense: REALTEK_LICENSE.id });
        expect(r).toMatchObject({ errorCode: "VERIFY_FAILED", rolledBack: true });
        expect(r.errorText).toMatch(/still cannot load rtw88\/rtw8821c_fw\.bin/);
        expect(world.installed.has("linux-firmware-rtw88")).toBe(false);
        // Started again as it was before.
        expect(world.activations.length).toBe(2);
        expect(byId(await svc.list(), "usb:1-2").status).toBe("needs-firmware");
    });

    it("puts the previous version back when an update fails", async () => {
        const { world, publish, pkgs } = makeWorld();
        const svc = makeService(world);
        await svc.list();
        await svc.install({ driverId: "firmware-rtw88", deviceId: "usb:1-2", acceptLicense: REALTEK_LICENSE.id });
        publish(4, [{ ...world.entries.rtw88, packages: [pkgs.fw8821new.file] }]);
        await svc.refresh();
        world.brokenFirmware = true;
        const r = await svc.install({ driverId: "firmware-rtw88", deviceId: "usb:1-2", acceptLicense: REALTEK_LICENSE.id });
        expect(r).toMatchObject({ errorCode: "VERIFY_FAILED", rolledBack: true });
        expect(world.opkgCalls.at(-1)).toEqual({ op: "install", paths: ["/cache/linux-firmware-rtw88_20240909_all.ipk"], downgrade: true });
        expect(world.installed.get("linux-firmware-rtw88")).toBe("20240909");
        expect(world.state.installed["firmware-rtw88"].packages[0].version).toBe("20240909");
        expect([...world.files.keys()]).toEqual(["/cache/linux-firmware-rtw88_20240909_all.ipk"]);
        // And when it works, the old copy goes.
        world.brokenFirmware = false;
        expect((await svc.install({ driverId: "firmware-rtw88", deviceId: "usb:1-2", acceptLicense: REALTEK_LICENSE.id })).state).toBe("installed");
        expect([...world.files.keys()]).toEqual(["/cache/linux-firmware-rtw88_20241010_all.ipk"]);
    });

    it("asks for a restart for a driver that needs one, and removes drivers", async () => {
        const { world } = makeWorld();
        const svc = makeService(world);
        await svc.list();
        const r = await svc.install({ driverId: "driver-nvidia-open", deviceId: "pci:0000:01:00.0", acceptLicense: "LicenseRef-NVIDIA" });
        expect(r.state).toBe("restart");
        expect(world.activations).toEqual([]);
        const l = await svc.list();
        expect(l.pendingRestart).toEqual(["driver-nvidia-open"]);
        expect(byId(l, "pci:0000:01:00.0").status).toBe("restart");
        // Removed before the restart: nothing to restart for.
        expect(await svc.remove({ driverId: "driver-nvidia-open" })).toEqual({ returnValue: true, restart: false });
        expect(world.opkgCalls.at(-1)).toEqual({ op: "remove", names: ["nvidia-open", "linux-firmware-nvidia-gsp"] });
        expect((await svc.list()).pendingRestart).toEqual([]);
        expect((await svc.remove({ driverId: "driver-nvidia-open" })).errorCode).toBe("NOT_INSTALLED");

        await svc.install({ driverId: "firmware-rtw88", deviceId: "usb:1-2", acceptLicense: REALTEK_LICENSE.id });
        expect((await svc.remove({ driverId: "firmware-rtw88" })).returnValue).toBe(true);
        expect(byId(await svc.list(), "usb:1-2").status).toBe("needs-firmware");
        expect(world.files.size).toBe(0);
    });

    it("installs one driver at a time", async () => {
        const { world } = makeWorld();
        const svc = makeService(world);
        await svc.list();
        const first = svc.install({ driverId: "module-rtl8812au", deviceId: "usb:1-3" });
        expect((await svc.install({ driverId: "firmware-rtw88", acceptLicense: REALTEK_LICENSE.id })).errorCode).toBe("BUSY");
        expect((await first).state).toBe("installed");
        expect((await svc.install({ driverId: "nope" })).errorCode).toBe("NOT_FOUND");
        expect((await svc.install({ driverId: "module-foo" })).errorCode).toBe("UNSUPPORTED");
    });

    it("keeps the last good catalog when a new one is not signed or is older", async () => {
        const { world, publish } = makeWorld();
        const svc = makeService(world);
        await svc.list();
        world.served.set(BASE + "drivers.json.sig", bytesOf(keyPair().sign(world.served.get(BASE + "drivers.json")!)));
        let r = await svc.refresh();
        expect(r.catalog).toMatchObject({ build: 3, error: { errorCode: "BAD_SIGNATURE" } });
        expect(byId(r, "usb:1-2").offers).toHaveLength(1);
        publish(2, []);
        r = await svc.refresh();
        expect(r.catalog.error.errorCode).toBe("ROLLBACK");
        expect(byId(r, "usb:1-2").offers).toHaveLength(1);
        world.served.delete(BASE + "drivers.json");
        expect((await svc.refresh()).catalog.error.errorCode).toBe("CONNECTION_FAILED");
    });

    it("reports only the IDs of devices nothing drives, when asked", async () => {
        const { world } = makeWorld();
        const svc = makeService(world);
        const rep = (await svc.getReport()).report;
        expect(rep).toEqual({ format: 1, arch: "x86_64", kernel: "6.6.21", devices: [
            { bus: "usb", ids: ["usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00"], firmwareMissing: [] },
        ] });
        expect(JSON.stringify(rep)).not.toMatch(/Phoenix Tablet|USB device|Realtek/);
        const sent = await svc.sendReport();
        expect(sent).toMatchObject({ returnValue: true, sent: true });
        expect(world.posts).toEqual([{ url: BASE + "report", body: rep }]);
        expect((await svc.list()).report.lastSent).toBe("2026-10-09T12:00:00.000Z");
    });

    it("tells the user about new hardware that needs something, and reports it when they opted in", async () => {
        const { world } = makeWorld();
        const svc = makeService(world);
        let r = await svc.scheduled({ $activity: { activityId: 7 } });
        expect(r).toEqual({ returnValue: true, notified: 2 });
        expect(world.toasts).toEqual([{ message: "2 devices need drivers or firmware", onclick: { appId: "org.webosphoenix.settings", params: { page: "hardware" } } }]);
        expect(world.posts).toEqual([]);   // not opted in
        expect(world.activities.at(-1)).toMatchObject({ uri: "luna://com.palm.activitymanager/complete", params: { activityId: 7, restart: true } });
        expect((await svc.setPreferences({ reportEnabled: true })).report.enabled).toBe(true);
        r = await svc.scheduled({});
        expect(r.notified).toBe(0);
        expect(world.toasts).toHaveLength(1);
        expect(world.posts).toHaveLength(1);
        await svc.scheduled({});
        expect(world.posts).toHaveLength(1);   // nothing new to say
    });

    it("tells list subscribers about changes", async () => {
        const { world } = makeWorld();
        const svc = makeService(world);
        await svc.list();
        const seen: Any[] = [];
        const stop = svc.watch((r: Any) => seen.push(byId(r, "usb:1-3").status));
        await svc.install({ driverId: "module-rtl8812au", deviceId: "usb:1-3" });
        await new Promise((r) => setTimeout(r, 10));
        expect(seen.at(-1)).toBe("working");
        stop();
    });
});
