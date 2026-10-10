// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Game Controllers, USB, Hotspot & Tethering and Battery on a
// device (docs/APP-RUNTIME.md "Accessories, tethering and the battery";
// GAPS E4): the runtime's four services (runtime/phoenix-runtime.js
// "Accessories, tethering and the battery's use"), with the same requests
// and replies, over what webOS OSE has:
//
//   org.webosphoenix.gamepads/list {subscribe}: the game controllers OSE's
//       physical device manager sees (com.webos.service.pdm
//       getAttachedNonStorageDeviceList, its "XPAD" class: src/devices/
//       gamepad, Device(..., "XPAD")). Web apps read the controllers
//       themselves with the Gamepad API.
//   org.webosphoenix.usb/listDrives {subscribe}, unmount {id}, mount {id}:
//       the drives PDM mounted (getAttachedStorageDeviceList: each
//       device's storageDriveList, driveSize in KB, PdmFs.cpp:249), their
//       free space from the file system; Safely Remove is PDM's eject
//       {deviceNum} (StorageDeviceHandler::eject), which lets the whole
//       device go. A drive put in: a notification (Settings > USB).
//   org.webosphoenix.tethering/getStatus {subscribe}, setWifi, setUsb:
//       the Wi-Fi hotspot is the connman adapter's
//       (com.webos.service.wifi/tethering/setState {enabled, ssid,
//       passPhrase, securityType}, getState; wifi_tethering_service.c),
//       USB tethering connman's gadget technology (connmanctl tether
//       gadget on|off: the adapter has no API for it). Available when the
//       device has a connection to share (a modem's, or Ethernet).
//   org.webosphoenix.battery/usage {subscribe}: the level over the last day
//       and each app's share of the screen-on time, as the runtime keeps
//       them; the level from the kernel's power supply class
//       (/sys/class/power_supply: a "Battery" supply's capacity, status
//       and temp; a mains or USB supply online is the charger), since OSE
//       has no powerd. The shell reports which app is in front
//       (phoenix/usageTick, the shell's only).
//
// createAccessories({call(uri, params) -> Promise<reply>, subscribe(uri,
// params, onReply) -> cancel, readFile(path) -> string | null, listDir(path)
// -> [names], run(cmd, args) -> Promise<{code, stdout}>, statfs(path) ->
// {size, used} | null, store: {load(), save(obj)}, now(), notify(n),
// ongoing(o)}) -> {services: {name: {method: (params, caller, respond) ->
// cancel | undefined}}, sample(), close()}
// STATUS: written against PDM's, the connman adapter's and the kernel's
// interfaces and accessories.test.ts; not yet run on a device.

"use strict";

var PDM = "luna://com.webos.service.pdm";
var WIFI = "luna://com.webos.service.wifi";
var CM = "luna://com.webos.service.connectionmanager";
var SETTINGS = "org.webosphoenix.settings";
var DAY = 24 * 3600 * 1000;
var SHELL_NAMES = ["com.webos.surfacemanager"];

function ok(extra) {
    var r = { returnValue: true };
    for (var k in extra) r[k] = extra[k];
    return r;
}
function fail(text) { return { returnValue: false, errorCode: -1, errorText: text }; }

function watchers() {
    var list = [];
    return {
        add: function (p, respond, build) {
            var w = { respond: respond, build: build };
            Promise.resolve(build()).then(function (r) { respond(p.subscribe ? Object.assign({ subscribed: true }, r) : r); });
            if (!p.subscribe) return undefined;
            list.push(w);
            return function () { list = list.filter(function (x) { return x !== w; }); };
        },
        fire: function () {
            list.slice().forEach(function (w) {
                Promise.resolve(w.build()).then(function (r) { w.respond(Object.assign({ subscribed: true }, r)); });
            });
        },
        count: function () { return list.length; }
    };
}

function createAccessories(opts) {
    var now = opts.now || function () { return Date.now(); };
    var cancels = [];
    function store() { return (opts.store && opts.store.load()) || {}; }
    function save(s) { if (opts.store) opts.store.save(s); }

    // ---- Game controllers (PDM) ----------------------------------------------------
    var pads = [];
    var padWatch = watchers();
    function padList() {
        return ok({ gamepads: pads.map(function (d, i) {
            var name = String(d.productName || "Game controller").trim();
            var vendor = String(d.vendorName || "").trim();
            return { index: i, id: name + (vendor ? " (" + vendor + ")" : ""), name: name, connection: "usb",
                     mapping: "standard", buttons: [], axes: [] };
        }) });
    }
    cancels.push(opts.subscribe(PDM + "/getAttachedNonStorageDeviceList", { subscribe: true }, function (r) {
        if (!r || r.returnValue === false || !Array.isArray(r.nonStorageDeviceList)) return;
        pads = r.nonStorageDeviceList.filter(function (d) { return d && d.deviceType === "XPAD"; });
        padWatch.fire();
    }));

    // ---- USB drives (PDM) -------------------------------------------------------------
    var devices = [];
    var seenDevices = null;
    var usbWatch = watchers();
    function driveList() {
        var out = [];
        devices.forEach(function (dev) {
            (Array.isArray(dev.storageDriveList) ? dev.storageDriveList : []).forEach(function (d) {
                var mounted = !!d.isMounted && !!d.mountName && d.mountName !== "UNSUPPORTED_FILESYSTEM";
                var space = mounted && opts.statfs ? opts.statfs(d.mountName) : null;
                var size = space ? space.size : (Number(d.driveSize) || 0) * 1024;
                out.push({ id: String(d.driveName), label: String(d.volumeLabel || dev.productName || "USB drive").trim(),
                           vendor: [dev.vendorName, dev.productName].filter(Boolean).join(" ").trim(),
                           size: size, used: space ? space.used : 0, fs: String(d.fsType || ""),
                           mounted: mounted, path: mounted ? String(d.mountName) : "", safeToRemove: !mounted,
                           deviceNum: dev.deviceNum });
            });
        });
        return ok({ drives: out });
    }
    cancels.push(opts.subscribe(PDM + "/getAttachedStorageDeviceList", { subscribe: true }, function (r) {
        if (!r || r.returnValue === false || !Array.isArray(r.storageDeviceList)) return;
        devices = r.storageDeviceList.filter(function (d) { return d && d.deviceType !== "CARD_READER_EMPTY"; });
        var nums = devices.map(function (d) { return String(d.deviceNum); });
        // A drive put in (not the ones there at start): the notification.
        if (seenDevices !== null) {
            devices.forEach(function (d) {
                if (seenDevices.indexOf(String(d.deviceNum)) >= 0) return;
                var first = (d.storageDriveList || [])[0] || {};
                opts.notify && opts.notify({ appId: SETTINGS, title: String(first.volumeLabel || d.productName || "USB drive").trim() + " connected",
                                             body: "Tap to see it or remove it safely", params: { page: "usb" } });
            });
        }
        seenDevices = nums;
        usbWatch.fire();
    }));
    function deviceOf(id) {
        for (var i = 0; i < devices.length; ++i)
            if ((devices[i].storageDriveList || []).some(function (d) { return String(d.driveName) === id; }))
                return devices[i];
        return null;
    }

    // ---- Hotspot and tethering ---------------------------------------------------
    var tetherWatch = watchers();
    var wifiTether = { enabled: false, ssid: "", security: "wpa2" };
    var upstream = false;
    function gadgetOn() {
        if (!opts.run) return Promise.resolve(false);
        return opts.run("connmanctl", ["technologies"]).then(function (r) {
            var on = false, inGadget = false;
            String(r && r.stdout || "").split("\n").forEach(function (l) {
                if (/^\s*\//.test(l)) inGadget = /\/gadget\s*$/.test(l.trim());
                if (inGadget && /^\s*Tethering\s*=\s*True/.test(l)) on = true;
            });
            return on;
        }, function () { return false; });
    }
    function tetherStatus() {
        var saved = store().tethering || {};
        return gadgetOn().then(function (usbOn) {
            return ok({ available: upstream,
                        wifi: { enabled: wifiTether.enabled, ssid: wifiTether.ssid || (saved.wifi && saved.wifi.ssid) || "Phoenix Hotspot",
                                passphrase: (saved.wifi && saved.wifi.passphrase) || "", security: wifiTether.enabled ? wifiTether.security
                                    : (saved.wifi && saved.wifi.security) === "open" ? "open" : "wpa2", clients: [] },
                        usb: { enabled: usbOn, connected: usbOn } });
        });
    }
    function tetherOngoing() {
        tetherStatus().then(function (t) {
            var on = [];
            if (t.wifi.enabled) on.push("Wi-Fi hotspot “" + t.wifi.ssid + "”");
            if (t.usb.enabled) on.push("USB tethering");
            if (!opts.ongoing) return;
            if (on.length)
                opts.ongoing({ id: "tethering", appId: SETTINGS, title: "Sharing your mobile data", body: on.join(" and ") + " on",
                               params: { page: "hotspot" }, progress: -1 });
            else opts.ongoing({ id: "tethering", clear: true });
        });
    }
    cancels.push(opts.subscribe(WIFI + "/tethering/getState", { subscribe: true }, function (r) {
        if (!r || r.returnValue === false) return;
        wifiTether = { enabled: !!r.enabled, ssid: String(r.ssid || ""), security: r.securityType === "open" ? "open" : "wpa2" };
        tetherWatch.fire();
    }));
    cancels.push(opts.subscribe(CM + "/getStatus", { subscribe: true }, function (r) {
        if (!r || r.returnValue === false) return;
        // A connection to share: a modem's (cellular) or the wire.
        var was = upstream;
        upstream = !!((r.cellular && r.cellular.state === "connected") || (r.wired && r.wired.state === "connected"));
        if (was !== upstream) tetherWatch.fire();
    }));

    // ---- The battery's use -----------------------------------------------------------
    var batteryWatch = watchers();
    function supplies() {
        var dir = "/sys/class/power_supply";
        return (opts.listDir ? opts.listDir(dir) : []).map(function (n) {
            var read = function (k) { var v = opts.readFile(dir + "/" + n + "/" + k); return v === null || v === undefined ? "" : String(v).trim(); };
            return { name: n, type: read("type"), capacity: read("capacity"), status: read("status"), online: read("online"), temp: read("temp") };
        });
    }
    function power() {
        var all = supplies();
        var bat = all.filter(function (s) { return s.type === "Battery" && s.capacity !== ""; })[0];
        var charger = all.some(function (s) { return s.type !== "Battery" && s.online === "1"; })
            || (bat && (bat.status === "Charging" || bat.status === "Full"));
        return { present: !!bat, percent: bat ? Math.max(0, Math.min(100, Number(bat.capacity))) : 100, charging: !!charger,
                 temperature: bat && bat.temp !== "" ? Number(bat.temp) / 10 : null };
    }
    function sample() {
        var p = power();
        if (!p.present) return;
        var s = store(), h = Array.isArray(s.batteryHistory) ? s.batteryHistory : [], t = now();
        var last = h[h.length - 1];
        if (last && last.percent === p.percent && !!last.charging === p.charging) return;
        h.push({ t: t, percent: p.percent, charging: p.charging });
        s.batteryHistory = h.filter(function (x) { return t - x.t <= DAY; });
        save(s);
        batteryWatch.fire();
    }
    var titles = {};
    function titleOf(id) {
        if (!id) return Promise.resolve("Card view and launcher");
        if (titles[id]) return Promise.resolve(titles[id]);
        return opts.call("luna://com.webos.applicationManager/getAppInfo", { id: id }).then(function (r) {
            var t = r && r.appInfo && r.appInfo.title ? String(r.appInfo.title) : id;
            titles[id] = t;
            return t;
        }, function () { return id; });
    }
    function usage() {
        var t = now(), p = power(), s = store();
        var by = {}, screen = 0;
        (s.batteryUsage || []).forEach(function (x) {
            if (t - x.t > DAY) return;
            screen += x.ms;
            by[x.appId || ""] = (by[x.appId || ""] || 0) + x.ms;
        });
        var ids = Object.keys(by);
        return Promise.all(ids.map(titleOf)).then(function (names) {
            var apps = ids.map(function (id, i) { return { appId: id, title: names[i], ms: by[id], share: screen ? by[id] / screen : 0 }; })
                .sort(function (a, b) { return b.ms - a.ms; });
            var h = (s.batteryHistory || []).filter(function (x) { return t - x.t <= DAY; });
            if (p.present && (!h.length || h[h.length - 1].percent !== p.percent)) h = h.concat([{ t: t, percent: p.percent, charging: p.charging }]);
            return ok({ percent: p.percent, charging: p.charging, temperature: p.temperature !== null ? p.temperature : undefined,
                        history: h, screenOnMs: screen, apps: apps });
        });
    }
    function usageTick(p, caller, respond) {
        if (SHELL_NAMES.indexOf(String(caller || "").split(" ")[0]) < 0) return respond(fail("Only the shell reports the app in front"));
        if (!(Number(p.ms) > 0)) return respond(fail("ms is required"));
        var s = store(), t = Number(p.at) || now();
        s.batteryUsage = (Array.isArray(s.batteryUsage) ? s.batteryUsage : []).concat([{ t: t, appId: String(p.appId || ""), ms: Number(p.ms) }])
            .filter(function (x) { return t - x.t <= DAY; });
        save(s);
        batteryWatch.fire();
        respond(ok());
    }

    var services = {
        "org.webosphoenix.gamepads": {
            list: function (p, caller, respond) { return padWatch.add(p, respond, padList); }
        },
        "org.webosphoenix.usb": {
            listDrives: function (p, caller, respond) { return usbWatch.add(p, respond, driveList); },
            // Safe removal: PDM unmounts the device's drives and lets it go.
            unmount: function (p, caller, respond) {
                var dev = deviceOf(String(p.id || ""));
                if (!dev) return respond(fail("No such drive: " + p.id));
                opts.call(PDM + "/eject", { deviceNum: dev.deviceNum }).then(function (r) {
                    if (r && r.returnValue === false) return respond(fail(r.errorText || "The drive could not be removed"));
                    respond(driveList());
                });
            },
            // PDM mounts what goes in; an ejected drive comes back by going in again.
            mount: function (p, caller, respond) {
                var dev = deviceOf(String(p.id || ""));
                if (!dev) return respond(fail("No such drive: " + p.id + ". Take it out and put it back in."));
                respond(driveList());
            }
        },
        "org.webosphoenix.tethering": {
            getStatus: function (p, caller, respond) { return tetherWatch.add(p, respond, tetherStatus); },
            setWifi: function (p, caller, respond) {
                if (!upstream && p.enabled) return respond(fail("This device has no mobile data to share"));
                var s = store(), w = Object.assign({ ssid: "Phoenix Hotspot", passphrase: "", security: "wpa2" }, (s.tethering || {}).wifi || {});
                if (p.ssid !== undefined) {
                    var ssid = String(p.ssid).trim();
                    if (!ssid || ssid.length > 32) return respond(fail("The network name has 1 to 32 characters"));
                    w.ssid = ssid;
                }
                if (p.security !== undefined) w.security = p.security === "open" ? "open" : "wpa2";
                if (p.passphrase !== undefined) w.passphrase = String(p.passphrase);
                var enable = p.enabled !== undefined ? !!p.enabled : wifiTether.enabled;
                if (w.security === "wpa2" && enable && !(w.passphrase.length >= 8 && w.passphrase.length <= 63))
                    return respond(fail("The password has 8 to 63 characters"));
                s.tethering = Object.assign({}, s.tethering || {}, { wifi: w });
                save(s);
                // The adapter refuses a new name while it shares: off first.
                var steps = Promise.resolve();
                if (wifiTether.enabled && (p.ssid !== undefined || p.passphrase !== undefined || p.security !== undefined))
                    steps = opts.call(WIFI + "/tethering/setState", { enabled: false });
                steps.then(function () {
                    var req = { enabled: enable };
                    if (enable) {
                        req.ssid = w.ssid;
                        req.securityType = w.security === "open" ? "open" : "psk";
                        if (w.security !== "open") req.passPhrase = w.passphrase;
                    }
                    return opts.call(WIFI + "/tethering/setState", req);
                }).then(function (r) {
                    if (r && r.returnValue === false) return respond(fail(r.errorText || "The hotspot could not be changed"));
                    if (r) wifiTether = { enabled: enable, ssid: w.ssid, security: w.security };
                    tetherOngoing();
                    tetherWatch.fire();
                    tetherStatus().then(respond);
                });
            },
            setUsb: function (p, caller, respond) {
                if (!upstream && p.enabled) return respond(fail("This device has no mobile data to share"));
                if (!opts.run) return respond(fail("USB tethering is not available"));
                opts.run("connmanctl", ["tether", "gadget", p.enabled ? "on" : "off"]).then(function (r) {
                    if (r.code !== 0) return respond(fail("USB tethering could not be changed"));
                    tetherOngoing();
                    tetherWatch.fire();
                    tetherStatus().then(respond);
                }, function () { respond(fail("USB tethering could not be changed")); });
            }
        },
        "org.webosphoenix.battery": {
            usage: function (p, caller, respond) { sample(); return batteryWatch.add(p, respond, usage); },
            "phoenix/usageTick": usageTick
        }
    };

    return { services: services, sample: sample, power: power,
             close: function () { cancels.forEach(function (c) { if (typeof c === "function") c(); }); } };
}

var SERVICES = {
    "org.webosphoenix.gamepads": ["list"],
    "org.webosphoenix.usb": ["listDrives", "unmount", "mount"],
    "org.webosphoenix.tethering": ["getStatus", "setWifi", "setUsb"],
    "org.webosphoenix.battery": ["usage", "phoenix/usageTick"]
};

module.exports = { createAccessories: createAccessories, SERVICES: SERVICES };
