// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.gamepads, .usb, .tethering and .battery on a device
// (accessories.js), one process: over OSE's physical device manager
// (com.webos.service.pdm), the connman adapter's hotspot
// (com.webos.service.wifi/tethering), connmanctl for USB tethering, and the
// kernel's power supply class. The battery's history and the hotspot's
// settings are kept in /var/lib/phoenix/accessories/state.json. It keeps
// itself running (webos-service's keep-alive activity), sampling the
// battery every minute.
//
// And org.webosphoenix.earbuds (AirPods and Beats: earbuds.js) and
// org.webosphoenix.trackers (unknown tracker alerts: trackers.js), over
// OSE's Bluetooth service (com.webos.service.bluetooth2: an LE scan,
// pairing, GATT), its location service, and phoenix-l2cap for the AirPods'
// control channel (docs/ACCESSORIES.md). The scan follows the screen
// (com.palm.display control/status, phoenix-devices): scanner.js.
// STATUS: written against those services' sources and accessories.test.ts,
// earbuds.test.ts and trackers.test.ts; not yet run on a device.

"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");
var Service = require("webos-service");
var acc = require("./accessories");
var earbudsLib = require("./earbuds");
var trackersLib = require("./trackers");
var scannerLib = require("./scanner");

var DIR = "/var/lib/phoenix/accessories";
var FILE = path.join(DIR, "state.json");

var EARBUDS = "org.webosphoenix.earbuds", TRACKERS = "org.webosphoenix.trackers";
var methods = Object.assign({}, acc.SERVICES);
methods[EARBUDS] = earbudsLib.METHODS;
methods[TRACKERS] = trackersLib.METHODS;
var names = Object.keys(methods);
var services = {};
names.forEach(function (n) { services[n] = new Service(n); });
var bus = services[names[0]];

function call(uri, params) {
    return new Promise(function (resolve) {
        bus.call(uri, params, function (m) { resolve(m.payload || {}); });
    });
}

function subscribe(uri, params, onReply) {
    var s = bus.subscribe(uri, params);
    s.on("response", function (m) { onReply(m.payload || {}); });
    return function () { s.cancel(); };
}
var store = {
    load: function () { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return null; } },
    save: function (obj) {
        fs.mkdirSync(DIR, { recursive: true, mode: 448 });
        fs.writeFileSync(FILE + ".new", JSON.stringify(obj), { mode: 384 });
        fs.renameSync(FILE + ".new", FILE);
    }
};
function notify(n) { call("luna://org.webosphoenix.shellhost/post", { type: "notification", payload: n }); }

var accessories = acc.createAccessories({
    call: call,
    subscribe: subscribe,
    readFile: function (p) { try { return fs.readFileSync(p, "utf8"); } catch (e) { return null; } },
    listDir: function (p) { try { return fs.readdirSync(p); } catch (e) { return []; } },
    run: function (cmd, args) {
        return new Promise(function (resolve) {
            childProcess.execFile(cmd, args, { timeout: 15000 }, function (err, stdout) {
                resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout || "") });
            });
        });
    },
    statfs: function (p) {
        try {
            var s = fs.statfsSync(p);
            return { size: s.blocks * s.bsize, used: (s.blocks - s.bfree) * s.bsize };
        } catch (e) { return null; }
    },
    store: store,
    notify: notify,
    ongoing: function (o) {
        if (o.clear) call("luna://org.webosphoenix.ongoing/clear", { id: o.id });
        else call("luna://org.webosphoenix.ongoing/set", o);
    }
});

// ---- AirPods and tracker alerts ----------------------------------------------------
// The AirPods' control channel: phoenix-l2cap ADDRESS PSM, its packets
// framed on its standard streams (services/l2cap/l2cap.c).
function l2cap(address, psm) {
    var child;
    try {
        child = childProcess.spawn("phoenix-l2cap", [address, String(psm)], { stdio: ["pipe", "pipe", "inherit"] });
    } catch (e) {
        return null;
    }
    var onPacket = null, onClose = null, buf = Buffer.alloc(0), queue = [], open = false, closed = false;
    function finish() {
        if (closed) return;
        closed = true;
        if (onClose) onClose();
    }
    child.on("error", finish);
    child.on("exit", finish);
    child.stdout.on("data", function (chunk) {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
            var len = buf.readUInt16BE(0);
            if (buf.length < 2 + len) break;
            var pkt = Array.prototype.slice.call(buf.subarray(2, 2 + len));
            buf = buf.subarray(2 + len);
            if (len === 0) {
                // Open: what was sent before goes now.
                open = true;
                queue.splice(0).forEach(write);
            } else if (onPacket) {
                onPacket(pkt);
            }
        }
    });
    function write(bytes) {
        var head = Buffer.alloc(2);
        head.writeUInt16BE(bytes.length, 0);
        child.stdin.write(Buffer.concat([head, Buffer.from(bytes)]));
    }
    return {
        send: function (bytes) { if (closed) return; if (open) write(bytes); else queue.push(bytes); },
        close: function () { if (!closed) child.kill("SIGTERM"); },
        onPacket: function (fn) { onPacket = fn; },
        onClose: function (fn) { onClose = fn; }
    };
}

var scanner = scannerLib.createScanner({ subscribe: subscribe });
// The screen: phoenix-devices' com.palm.display (displayOn, displayOff,
// displayDimmed; the first reply's state).
subscribe("luna://com.palm.display/control/status", { subscribe: true }, function (r) {
    if (!r || r.returnValue === false) return;
    if (r.event === "displayOn" || (r.event === "request" && r.state === "on")) scanner.setScreen(true);
    else if (r.event === "displayOff" || (r.event === "request" && r.state === "off")) scanner.setScreen(false);
});
var earbuds = earbudsLib.createEarbuds({ call: call, subscribe: subscribe, scanner: scanner, l2cap: l2cap, store: store });
var trackers = trackersLib.createTrackers({ call: call, subscribe: subscribe, scanner: scanner, store: store, notify: notify });
setInterval(function () { earbuds.tick(); }, 5000);

var handlers = Object.assign({}, accessories.services);
handlers[EARBUDS] = earbuds.service;
handlers[TRACKERS] = trackers.service;

function callerOf(message) {
    return message.applicationID || message.senderServiceName || message.sender || "";
}

names.forEach(function (n) {
    methods[n].forEach(function (method) {
        services[n].register(method, function (message) {
            var cancel = handlers[n][method](message.payload || {}, callerOf(message), function (r) { message.respond(r); });
            if (typeof cancel === "function" && message.isSubscription)
                message.on("cancel", cancel);
        });
    });
});

accessories.sample();
setInterval(function () { accessories.sample(); }, 60000);
bus.activityManager.create("keepAlive", function () {});
