// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// lib/sysfs.js on a made-up /sys (the files and links the kernel makes,
// laid out as on a PC with a USB Wi-Fi dongle and a tablet's device tree
// parts), and lib/node.js's opkg and driver reload with stand-in programs.

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const sysfs = require("./sysfs.js") as Any;
const node = require("./node.js") as Any;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-sysfs-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function put(p: string, text: string) {
    fs.mkdirSync(path.dirname(root + p), { recursive: true });
    fs.writeFileSync(root + p, text);
}
function bind(dev: string, driver: string) {
    fs.mkdirSync(root + dev, { recursive: true });
    fs.symlinkSync(`../../../bus/x/drivers/${driver}`, root + dev + "/driver");
}

// PCI: a host bridge (left out), Atheros Wi-Fi bound to ath9k, an NVMe SSD.
put("/sys/bus/pci/devices/0000:00:00.0/class", "0x060000\n");
put("/sys/bus/pci/devices/0000:00:00.0/vendor", "0x8086\n");
put("/sys/bus/pci/devices/0000:00:00.0/device", "0x9b61\n");
put("/sys/bus/pci/devices/0000:00:00.0/modalias", "pci:v00008086d00009B61sv000017AAsd00005080bc06sc00i00\n");
put("/sys/bus/pci/devices/0000:02:00.0/class", "0x028000\n");
put("/sys/bus/pci/devices/0000:02:00.0/vendor", "0x168c\n");
put("/sys/bus/pci/devices/0000:02:00.0/device", "0x0034\n");
put("/sys/bus/pci/devices/0000:02:00.0/modalias", "pci:v0000168Cd00000034sv0000105Bsd0000E052bc02sc80i00\n");
bind("/sys/bus/pci/devices/0000:02:00.0", "ath9k");
put("/sys/bus/pci/devices/0000:03:00.0/class", "0x010802\n");
put("/sys/bus/pci/devices/0000:03:00.0/vendor", "0x144d\n");
put("/sys/bus/pci/devices/0000:03:00.0/device", "0xa808\n");
put("/sys/bus/pci/devices/0000:03:00.0/modalias", "pci:v0000144Dd0000A808sv0000144Dsd0000A801bc01sc08i02\n");
bind("/sys/bus/pci/devices/0000:03:00.0", "nvme");
// USB: a root hub (not a device), a hub (left out), a Realtek dongle whose
// driver did not get its firmware, a gadget nothing drives.
put("/sys/bus/usb/devices/usb1/idVendor", "1d6b\n");
put("/sys/bus/usb/devices/1-1/idVendor", "05e3\n");
put("/sys/bus/usb/devices/1-1/idProduct", "0610\n");
put("/sys/bus/usb/devices/1-1/bDeviceClass", "09\n");
put("/sys/bus/usb/devices/1-1.2/idVendor", "0bda\n");
put("/sys/bus/usb/devices/1-1.2/idProduct", "c811\n");
put("/sys/bus/usb/devices/1-1.2/bDeviceClass", "00\n");
put("/sys/bus/usb/devices/1-1.2/manufacturer", "Realtek\n");
put("/sys/bus/usb/devices/1-1.2/product", "802.11ac NIC\n");
put("/sys/bus/usb/devices/1-1.2:1.0/modalias", "usb:v0BDApC811d0200dc00dsc00dp00icFFiscFFipFFin00\n");
put("/sys/bus/usb/devices/1-1.2:1.0/bInterfaceClass", "ff\n");
put("/sys/bus/usb/devices/1-3/idVendor", "1209\n");
put("/sys/bus/usb/devices/1-3/idProduct", "0001\n");
put("/sys/bus/usb/devices/1-3/bDeviceClass", "ff\n");
put("/sys/bus/usb/devices/1-3:1.0/modalias", "usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00\n");
// The device tree: a touchscreen (input), an accelerometer (IIO), a clock
// controller nobody needs to see.
put("/sys/bus/i2c/devices/1-005d/modalias", "of:NtouchscreenT(null)Cgoodix,gt911\n");
put("/sys/bus/i2c/devices/1-005d/name", "goodix,gt911\n");
fs.mkdirSync(root + "/sys/bus/i2c/devices/1-005d/input/input3", { recursive: true });
bind("/sys/bus/i2c/devices/1-005d", "Goodix-TS");
put("/sys/bus/i2c/devices/1-0018/modalias", "of:NaccelerometerT(null)Cbosch,bma250e\n");
fs.mkdirSync(root + "/sys/bus/i2c/devices/1-0018/iio:device0", { recursive: true });
bind("/sys/bus/i2c/devices/1-0018", "bmc150_accel_i2c");
put("/sys/bus/platform/devices/ff760000.clock-controller/modalias", "of:Nclock-controllerT(null)Crockchip,rk3399-cru\n");
bind("/sys/bus/platform/devices/ff760000.clock-controller", "rk3399-cru");
// The machine.
put("/sys/firmware/devicetree/base/compatible", "pine64,pinephone-pro\0rockchip,rk3399\0");
put("/sys/firmware/devicetree/base/model", "Pine64 PinePhone Pro\0");
// Firmware: one the dongle asked for is missing; another failure was fixed since.
put("/lib/firmware/rtw88/rtw8822c_fw.bin.zst", "x");
const LOG = [
    "[    5.123456] usb 1-1.2: new high-speed USB device number 4 using xhci_hcd",
    "[    5.301000] rtw_8821cu 1-1.2:1.0: Direct firmware load for rtw88/rtw8821c_fw.bin failed with error -2",
    "[    5.302000] rtw_8821cu 1-1.2:1.0: failed to request firmware",
    "[    6.000000] rtw_8822ce 0000:04:00.0: Direct firmware load for rtw88/rtw8822c_fw.bin failed with error -2",
    "[    7.000000] firmware: failed to load brcm/brcmfmac43455-sdio.bin (-2)",
].join("\n");

describe("the hardware in sysfs", () => {
    const scanner = sysfs.createScanner(node.createFs(root), {
        names: (bus: string, v: string, d: string) => (bus === "pci" && v === "168c" ? { vendor: "Qualcomm Atheros", device: d === "0034" ? "AR9462 Wireless Network Adapter" : null } : null),
    });
    const devices = scanner.scan(LOG);
    const get = (id: string) => devices.find((d: Any) => d.id === id);

    it("lists PCI devices by class, without bridges", () => {
        expect(get("pci:0000:02:00.0")).toEqual({
            id: "pci:0000:02:00.0", bus: "pci", name: "AR9462 Wireless Network Adapter", vendor: "Qualcomm Atheros", category: "wifi",
            modaliases: ["pci:v0000168Cd00000034sv0000105Bsd0000E052bc02sc80i00"], driver: "ath9k", firmwareMissing: [], hidden: false,
        });
        expect(get("pci:0000:03:00.0")).toMatchObject({ name: "NVMe SSD (144d:a808)", category: "storage", driver: "nvme" });
        expect(get("pci:0000:00:00.0").hidden).toBe(true);
    });

    it("lists USB devices by their interfaces, with the firmware their driver did not get", () => {
        expect(get("usb:1-1.2")).toEqual({
            id: "usb:1-1.2", bus: "usb", name: "802.11ac NIC", vendor: "Realtek", category: "wifi",
            modaliases: ["usb:v0BDApC811d0200dc00dsc00dp00icFFiscFFipFFin00"], driver: null,
            firmwareMissing: ["rtw88/rtw8821c_fw.bin"], hidden: false,
        });
        expect(get("usb:1-3")).toMatchObject({ name: "USB device (1209:0001)", driver: null, firmwareMissing: [], hidden: false });
        expect(get("usb:1-1").hidden).toBe(true);
        expect(get("usb:usb1")).toBeUndefined();
    });

    it("lists the device tree's parts that do something the user knows", () => {
        expect(get("i2c:1-005d")).toMatchObject({ bus: "of", name: "GT911", vendor: "goodix", category: "input", driver: "Goodix-TS", hidden: false });
        expect(get("i2c:1-0018")).toMatchObject({ name: "BMA250E", vendor: "bosch", category: "sensors", hidden: false });
        expect(get("platform:ff760000.clock-controller").hidden).toBe(true);
    });

    it("names the machine for board packages, hidden", () => {
        expect(get("machine")).toMatchObject({
            name: "Pine64 PinePhone Pro", hidden: true,
            modaliases: ["of:NmachineT<NULL>Cpine64,pinephone-pro", "of:NmachineT<NULL>Crockchip,rk3399"],
        });
    });

    it("reads firmware failures from the kernel log", () => {
        expect(sysfs.firmwareFailures(LOG)).toEqual([
            { driver: "rtw_8821cu", dev: "1-1.2:1.0", file: "rtw88/rtw8821c_fw.bin" },
            { driver: "rtw_8822ce", dev: "0000:04:00.0", file: "rtw88/rtw8822c_fw.bin" },
            { driver: null, dev: null, file: "brcm/brcmfmac43455-sdio.bin" },
        ]);
    });
});

describe("opkg and the driver reload on a device", () => {
    // Stand-ins that log their arguments, as opkg and modprobe would be run.
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-bin-"));
    const calls = path.join(bin, "calls");
    afterAll(() => fs.rmSync(bin, { recursive: true, force: true }));
    const tool = (name: string, body: string) => {
        fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> ${calls}\n${body}\n`, { mode: 0o755 });
        return path.join(bin, name);
    };

    it("lists, installs and removes packages with opkg", async () => {
        const opkg = node.createOpkg({ command: tool("opkg", `
case "$1" in
  list-installed) printf 'busybox - 1.36.1-r0\\nlinux-firmware-rtw88 - 20240909-r0\\n' ;;
  install) case "$*" in *bad.ipk*) echo "Collected errors: * check_data_file_clashes" >&2; exit 1 ;; esac ;;
esac`) });
        expect(await opkg.list()).toEqual([{ name: "busybox", version: "1.36.1-r0" }, { name: "linux-firmware-rtw88", version: "20240909-r0" }]);
        expect(await opkg.install(["/a.ipk", "/b.ipk"], { downgrade: true })).toMatchObject({ ok: true });
        expect(await opkg.install(["/bad.ipk"], {})).toEqual({ ok: false, stdout: "", error: "Collected errors: * check_data_file_clashes" });
        expect(await opkg.remove(["linux-firmware-rtw88"])).toMatchObject({ ok: true });
        expect(fs.readFileSync(calls, "utf8").trim().split("\n")).toEqual([
            "opkg list-installed", "opkg install --force-downgrade /a.ipk /b.ipk", "opkg install /bad.ipk", "opkg remove linux-firmware-rtw88",
        ]);
    });

    it("reloads the driver's modules, then has udev look again", async () => {
        fs.rmSync(calls, { force: true });
        const activate = node.createActivator({ modprobe: tool("modprobe", ""), udevadm: tool("udevadm", "") });
        await activate({ after: "reload", modules: ["rtw88_8821cu", "rtw88_usb", "bad;rm -rf"], deviceId: "usb:1-1.2" });
        expect(fs.readFileSync(calls, "utf8").trim().split("\n")).toEqual([
            "modprobe -r rtw88_usb rtw88_8821cu", "modprobe rtw88_8821cu", "modprobe rtw88_usb", "udevadm trigger --action=add", "udevadm settle --timeout=10",
        ]);
        fs.rmSync(calls, { force: true });
        await activate({ after: "reboot", modules: ["nvidia"] });
        expect(fs.existsSync(calls)).toBe(false);
    });

    it("rebinds a device to its driver", async () => {
        fs.rmSync(calls, { force: true });
        put("/sys/bus/usb/drivers_probe", "");
        put("/sys/bus/usb/drivers/btusb/unbind", "");
        fs.mkdirSync(root + "/sys/bus/usb/devices/1-4", { recursive: true });
        fs.symlinkSync(root + "/sys/bus/usb/drivers/btusb", root + "/sys/bus/usb/devices/1-4/driver");
        const activate = node.createActivator({ modprobe: tool("modprobe", ""), udevadm: tool("udevadm", ""), root });
        await activate({ after: "rebind", modules: [], deviceId: "usb:1-4" });
        expect(fs.readFileSync(root + "/sys/bus/usb/drivers/btusb/unbind", "utf8")).toBe("1-4");
        expect(fs.readFileSync(root + "/sys/bus/usb/drivers_probe", "utf8")).toBe("1-4");
        expect(fs.readFileSync(calls, "utf8")).toMatch(/udevadm trigger/);
    });
});
