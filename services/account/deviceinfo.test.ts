// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// deviceInfo (deviceinfo.js): what a device registers (POST /v1/devices)
// from its own files. The VM files are the 2.0 Revision 18 image's
// (webos-phoenix-image-phoenix-vm-arm64, 26 November 2026, on the LuneOS
// layers 1.0's images build on too: scripts/luneos-layers.txt), with 1.0's
// product file and device profiles; its registration the platform refused
// with 422 when they were sent as they were read (compatible "", model "",
// build 14 digits).

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const { deviceInfo } = require("./deviceinfo.js") as any;
const { registration } = require("./accountservice.js") as any;

const VM: Record<string, string> = {
    "/etc/os-release": 'ID=luneos\nNAME="LuneOS"\nVERSION="1.0"\nVERSION_ID=1.0\nPRETTY_NAME="LuneOS 1.0"\nCPE_NAME="cpe:/o:openembedded:luneos:1.0"\nBUILD_ID="20261126153551"\n',
    "/etc/buildinfo": "-----------------------\nBuild Configuration:  |\n-----------------------\nBB_VERSION = 2.18.0\nBUILD_SYS = x86_64-linux\n" +
        "TARGET_SYS = aarch64-webos-linux\nMACHINE = phoenix-vm-arm64\nSDKMACHINE = x86_64\nDISTRO = luneos\nDISTRO_VERSION = 1.0\n" +
        "DATETIME = 20261126153551\n-----------------------\nLayer Revisions:      |\n-----------------------\nmeta-phoenix      = <unknown>:<unknown> -- modified\n",
    "/usr/share/phoenix/product.json": JSON.stringify({ name: "webOS Phoenix", version: "1.0.0", releaseNotes: "release-notes.json" }),
    "/proc/cmdline": "root=/dev/vda rw phoenix.device=pinetab2 phoenix.display=retina-adaptive console=ttyAMA0",
    "/usr/share/phoenix/devices/device-profiles.json": JSON.stringify({ profiles: [{ id: "fairphone-fp6", name: "Fairphone (Gen. 6)" }, { id: "pinetab2", name: "PINE64 PineTab2" }] }),
};
const reader = (files: Record<string, string>) => (p: string) => (p in files ? files[p] : null);

describe("deviceInfo", () => {
    it("a VM image without RAUC or a device-tree model: the image's machine, the device profile, the product's version and the build", () => {
        expect(deviceInfo(reader(VM))).toEqual({
            compatible: "phoenix-vm-arm64", model: "PINE64 PineTab2", name: "PINE64 PineTab2", osVersion: "1.0.0", build: 20261126153551,
        });
    });

    it("RAUC's compatible and the device tree's model come first", () => {
        expect(deviceInfo(reader({
            ...VM,
            "/etc/rauc/system.conf": "[system]\ncompatible=phoenix-pinetab2\nbootloader=uboot\n\n[keyring]\npath=/etc/rauc/keyring.pem\n",
            "/proc/device-tree/model": "Pine64 PineTab2 v2.0\u0000",
        }))).toMatchObject({ compatible: "phoenix-pinetab2", model: "Pine64 PineTab2 v2.0", name: "Pine64 PineTab2 v2.0" });
    });

    it("a machine is named as the update feeds name it: phoenix-<MACHINE>", () => {
        const files = { ...VM, "/etc/buildinfo": "MACHINE = pinephonepro\nDATETIME = 20261126153551\n" };
        expect(deviceInfo(reader(files)).compatible).toBe("phoenix-pinephonepro");
    });

    it("a RAUC compatible the platform can't take falls back to the machine", () => {
        expect(deviceInfo(reader({ ...VM, "/etc/rauc/system.conf": "[system]\ncompatible=Pine Tab/2\n" })).compatible).toBe("phoenix-vm-arm64");
    });

    it("DMI's vendor and product when there is neither a device-tree model nor a profile", () => {
        const files = { ...VM, "/proc/cmdline": "root=/dev/vda rw", "/sys/class/dmi/id/sys_vendor": "QEMU\n", "/sys/class/dmi/id/product_name": "Standard PC (Q35 + ICH9, 2009)\n" };
        expect(deviceInfo(reader(files))).toMatchObject({ model: "QEMU Standard PC (Q35 + ICH9, 2009)" });
        expect(deviceInfo(reader({ ...files, "/sys/class/dmi/id/product_name": "QEMU Virtual Machine\n" })).model).toBe("QEMU Virtual Machine");
    });

    it("os-release's VERSION_ID without a product file", () => {
        const { "/usr/share/phoenix/product.json": _, ...files } = VM;
        expect(deviceInfo(reader(files)).osVersion).toBe("1.0");
    });

    it("leaves out what it can't read, and never sends an empty value or a build the server can't store", () => {
        expect(deviceInfo(() => null)).toEqual({ name: "Phoenix device" });
        expect(deviceInfo(() => { throw new Error("EACCES"); })).toEqual({ name: "Phoenix device" });
        const odd = { "/etc/os-release": 'BUILD_ID="2026-11-26"\n', "/proc/device-tree/model": "\u0000", "/etc/buildinfo": "MACHINE = \n" };
        expect(deviceInfo(reader(odd))).toEqual({ name: "Phoenix device" });
        expect(deviceInfo(reader({ "/etc/os-release": "BUILD_ID=99999999999999999999\n" }))).toEqual({ name: "Phoenix device" });
    });
});

describe("registration (POST /v1/devices's body)", () => {
    it("is what deviceInfo found, with the device's key", () => {
        expect(registration("KEY=", deviceInfo(reader(VM)))).toEqual({
            publicKey: "KEY=", name: "PINE64 PineTab2", model: "PINE64 PineTab2", compatible: "phoenix-vm-arm64", osVersion: "1.0.0", build: 20261126153551,
        });
    });

    it("leaves out empty fields and builds that aren't whole numbers up to 2^53-1 (the simulator's osVersion \"\", an old device())", () => {
        expect(registration("KEY=", { name: "", model: "", compatible: "  ", osVersion: "", build: 0 })).toEqual({ publicKey: "KEY=", name: "Phoenix device" });
        expect(registration("KEY=", { name: "Phoenix Simulator", model: "phoenix-sim", compatible: "phoenix-sim", osVersion: "", build: 1 }))
            .toEqual({ publicKey: "KEY=", name: "Phoenix Simulator", model: "phoenix-sim", compatible: "phoenix-sim", build: 1 });
        for (const build of [-1, 1.5, NaN, 2 ** 53, "20261126153551"])
            expect(registration("KEY=", { name: "x", build })).not.toHaveProperty("build");
        expect(registration("KEY=", null)).toEqual({ publicKey: "KEY=", name: "Phoenix device" });
    });
});
