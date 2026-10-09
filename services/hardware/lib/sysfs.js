// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device's hardware, as the kernel shows it in sysfs: what
// org.webosphoenix.hardware lists and matches against the driver catalog.
//
//   PCI, USB and SDIO devices      every one (these buses say what is on
//                                  them); bridges, hubs and host controllers
//                                  are left out
//   device tree, ACPI, I2C, SPI    the ones that do something the user knows
//   (platform, i2c, spi buses)     (an input device, a sensor, a network
//                                  interface, a display, a camera, a sound
//                                  card, Bluetooth); the others only when a
//                                  catalog entry is for them (hidden)
//   the machine                    the board's device tree compatible strings
//                                  and the DMI modalias, hidden: what a
//                                  board-specific package matches
//
// Each device: {id, bus, name, vendor, category, modaliases (the kernel's:
// what modules.alias and the catalog's patterns match), driver (bound, or
// null), firmwareMissing (files its driver asked for, from the kernel log,
// that are still not in /lib/firmware), hidden}.
//
// Reads through fs: {read(path) -> string | null, list(dir) -> [names],
// link(path) -> target | null, exists(path)}, so tests use a made-up /sys.
// No libudev: the same files udev reads.

"use strict";

var PCI_CLASSES = {
    "01": ["storage", "Storage controller"], "02": ["network", "Network controller"], "03": ["graphics", "Display controller"],
    "04": ["audio", "Multimedia controller"], "07": ["other", "Communication controller"], "09": ["input", "Input device"],
    "0c": ["usb", "Serial bus controller"], "0d": ["wifi", "Wireless controller"], "10": ["other", "Encryption controller"],
    "11": ["sensors", "Signal processing controller"]
};
// PCI subclasses with a better name (class + subclass).
var PCI_SUBCLASSES = {
    "0280": ["wifi", "Wireless network adapter"], "0200": ["network", "Ethernet controller"], "0108": ["storage", "NVMe SSD"],
    "0106": ["storage", "SATA controller"], "0403": ["audio", "Audio device"], "0401": ["audio", "Audio device"],
    "0480": ["camera", "Camera"], "0d11": ["bluetooth", "Bluetooth adapter"], "0c03": ["usb", "USB controller"],
    "0c05": ["other", "SMBus controller"]
};
// Bridges, host controllers and system peripherals nobody needs to see.
var PCI_HIDDEN = /^(06|08|05|0c03|0c05|0b)/;
var USB_CLASSES = {
    "01": ["audio", "USB audio device"], "02": ["modem", "USB modem"], "03": ["input", "USB input device"],
    "06": ["camera", "USB camera (still image)"], "07": ["other", "USB printer"], "08": ["storage", "USB storage"],
    "0a": ["network", "USB network device"], "0e": ["camera", "USB camera"], "e0": ["bluetooth", "USB wireless device"],
    "ef": ["other", "USB device"], "ff": ["other", "USB device"]
};
// Drivers whose names say what the device is, when its class does not.
var DRIVER_HINTS = [
    [/^(rtw|rtl8|r8188|r8712|8812|8821|88x2|ath|mt76|mt7|iwl|brcmf|b43|wl$|mwifiex|wcn|qca)/, "wifi"],
    [/^(btusb|btrtl|btintel|hci_)/, "bluetooth"], [/^(uvcvideo|gspca)/, "camera"], [/^(snd|sof)/, "audio"],
    [/^(nouveau|nvidia|amdgpu|radeon|i915|xe$|panfrost|lima|msm|vc4|v3d|etnaviv)/, "graphics"],
    [/^(usb-storage|uas|nvme|ahci|sdhci)/, "storage"], [/^(goodix|elan|hid|usbhid|atmel_mxt|edt-ft5x06|silead)/, "input"],
    [/^(qmi_wwan|cdc_mbim|option)/, "modem"]
];
// What a named (device tree, ACPI, I2C, SPI) device does, by its children.
var CLASS_CHILDREN = [["input", "input"], ["iio:device", "sensors"], ["net", "network"], ["drm", "graphics"],
                      ["video4linux", "camera"], ["sound", "audio"], ["bluetooth", "bluetooth"]];

function trim(s) { return s === null || s === undefined ? null : String(s).replace(/\0/g, "").trim(); }
function base(p) { return p ? String(p).replace(/\/+$/, "").split("/").pop() : null; }
function hex4(s) { return (trim(s) || "").replace(/^0x/i, "").toLowerCase(); }

function hint(driver, category) {
    if (!driver) return category;
    for (var i = 0; i < DRIVER_HINTS.length; i++) if (DRIVER_HINTS[i][0].test(driver)) return DRIVER_HINTS[i][1];
    return category;
}

// "Direct firmware load for rtw88/rtw8821c_fw.bin failed with error -2"
// (drivers/base/firmware_loader/main.c), with the device that asked:
// "rtw_8821cu 1-1:1.0: Direct firmware load for ... failed". The older
// "firmware: failed to load X (-2)" line names no device.
function firmwareFailures(log) {
    var out = [];
    String(log || "").split("\n").forEach(function (line) {
        var m = /(\S+) (\S+): Direct firmware load for (\S+) failed/.exec(line);
        if (m) { out.push({ driver: m[1], dev: m[2], file: m[3] }); return; }
        var n = /firmware: failed to load (\S+)/.exec(line);
        if (n) out.push({ driver: null, dev: null, file: n[1] });
    });
    return out;
}

function createScanner(fs, opts) {
    opts = opts || {};
    var names = opts.names || function () { return null; };   // (bus, vendor, device) -> {vendor, device} | null
    var SYS = "/sys";

    function attr(dir, name) { return trim(fs.read(dir + "/" + name)); }
    function driverOf(dir) { return base(fs.link(dir + "/driver")); }
    function hasFirmware(file) {
        return ["", ".xz", ".zst"].some(function (ext) {
            return ["/lib/firmware/", "/lib/firmware/updates/"].some(function (d) { return fs.exists(d + file + ext); });
        });
    }

    function pci() {
        var dir = SYS + "/bus/pci/devices";
        return fs.list(dir).map(function (addr) {
            var d = dir + "/" + addr;
            var cls = hex4(attr(d, "class")).slice(0, 4);   // 0x028000 -> 0280
            var vendor = hex4(attr(d, "vendor")), device = hex4(attr(d, "device"));
            var known = PCI_SUBCLASSES[cls] || PCI_CLASSES[cls.slice(0, 2)] || ["other", "PCI device"];
            var n = names("pci", vendor, device) || {};
            var driver = driverOf(d);
            return {
                id: "pci:" + addr, bus: "pci", name: n.device || known[1] + " (" + vendor + ":" + device + ")", vendor: n.vendor || "",
                category: hint(driver, known[0]), modaliases: [attr(d, "modalias")].filter(Boolean), driver: driver,
                firmwareMissing: [], hidden: PCI_HIDDEN.test(cls), devnames: [addr]
            };
        });
    }

    function usb() {
        var dir = SYS + "/bus/usb/devices";
        var all = fs.list(dir);
        return all.filter(function (n) { return /^\d+-[\d.]+$/.test(n); }).map(function (n) {
            var d = dir + "/" + n;
            var vendor = hex4(attr(d, "idVendor")), product = hex4(attr(d, "idProduct"));
            var ifaces = all.filter(function (x) { return x.indexOf(n + ":") === 0; }).map(function (x) {
                var f = dir + "/" + x;
                return { name: x, modalias: attr(f, "modalias"), driver: driverOf(f), cls: hex4(attr(f, "bInterfaceClass")) };
            });
            var devClass = hex4(attr(d, "bDeviceClass"));
            var cls = devClass && devClass !== "00" && devClass !== "ef" ? devClass : (ifaces[0] && ifaces[0].cls) || "ff";
            var known = USB_CLASSES[cls] || ["other", "USB device"];
            var drivers = ifaces.map(function (i) { return i.driver; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
            var n2 = names("usb", vendor, product) || {};
            var title = attr(d, "product") || n2.device;
            var aliases = ifaces.map(function (i) { return i.modalias; }).filter(Boolean);
            return {
                id: "usb:" + n, bus: "usb", name: title || known[1] + " (" + vendor + ":" + product + ")",
                vendor: attr(d, "manufacturer") || n2.vendor || "", category: hint(drivers[0], known[0]),
                // Interfaces carry the modaliases; a device not configured yet has
                // only its IDs (as the start of every one of them).
                modaliases: aliases.length ? aliases : ["usb:v" + vendor.toUpperCase() + "p" + product.toUpperCase()],
                driver: drivers[0] || null, firmwareMissing: [], hidden: cls === "09",
                devnames: [n].concat(ifaces.map(function (i) { return i.name; }))
            };
        });
    }

    function simpleBus(bus) {
        var dir = SYS + "/bus/" + bus + "/devices";
        return fs.list(dir).map(function (n) {
            var d = dir + "/" + n;
            var alias = attr(d, "modalias");
            if (!alias) return null;
            var children = fs.list(d);
            var category = null;
            CLASS_CHILDREN.forEach(function (c) {
                if (!category && children.some(function (x) { return x === c[0] || x.indexOf(c[0]) === 0; })) category = c[1];
            });
            if (category === "network" && children.indexOf("net") >= 0 &&
                fs.list(d + "/net").some(function (i) { return fs.exists(d + "/net/" + i + "/wireless"); })) category = "wifi";
            var driver = driverOf(d);
            var compat = /^of:N[^T]*T[^C]*C([^C]+)/.exec(alias);
            var label = attr(d, "name") || (compat ? compat[1] : n);
            var parts = /^([^,]+),(.+)$/.exec(label);
            return {
                id: bus + ":" + n, bus: alias.split(":")[0] === "of" || alias.split(":")[0] === "acpi" ? alias.split(":")[0] : bus,
                name: parts ? parts[2].toUpperCase() : label, vendor: parts ? parts[1] : "",
                category: hint(driver, category || "other"), modaliases: [alias], driver: driver, firmwareMissing: [],
                hidden: !category, devnames: [n]
            };
        }).filter(Boolean);
    }

    function machine() {
        var compat = (fs.read("/sys/firmware/devicetree/base/compatible") || fs.read("/proc/device-tree/compatible") || "")
            .split("\0").filter(Boolean);
        var dmi = attr(SYS + "/class/dmi/id", "modalias");
        var aliases = compat.map(function (c) { return "of:NmachineT<NULL>C" + c; }).concat(dmi ? [dmi] : []);
        var title = trim(fs.read("/sys/firmware/devicetree/base/model")) || attr(SYS + "/class/dmi/id", "product_name") || "This device";
        return aliases.length ? [{ id: "machine", bus: compat.length ? "of" : "dmi", name: title, vendor: attr(SYS + "/class/dmi/id", "sys_vendor") || "",
                                  category: "other", modaliases: aliases, driver: null, firmwareMissing: [], hidden: true, devnames: [] }] : [];
    }

    // -> Promise<devices>; kernelLog: the kernel's messages (dmesg) or "".
    function scan(kernelLog) {
        var list = pci().concat(usb(), simpleBus("sdio"), simpleBus("platform"), simpleBus("i2c"), simpleBus("spi"), machine());
        firmwareFailures(kernelLog).forEach(function (f) {
            if (hasFirmware(f.file)) return;
            var dev = f.dev && list.filter(function (d) { return d.devnames.indexOf(f.dev) >= 0; })[0];
            if (dev && dev.firmwareMissing.indexOf(f.file) < 0) {
                dev.firmwareMissing.push(f.file);
                dev.hidden = false;
                if (!dev.driver && f.driver) dev.category = hint(f.driver, dev.category);
            }
        });
        return list.map(function (d) {
            var out = Object.assign({}, d);
            delete out.devnames;
            return out;
        });
    }

    return { scan: scan };
}

module.exports = { createScanner: createScanner, firmwareFailures: firmwareFailures };
