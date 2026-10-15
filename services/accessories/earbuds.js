// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.earbuds: AirPods and Beats as an iPhone shows them
// (docs/ACCESSORIES.md). Two sources:
//
//   - Their Bluetooth LE advertisements (continuity.js: Proximity
//     Pairing), heard by the scan (scanner.js): which model is near, the
//     earbuds' and case's batteries, the case's lid open. Anyone's AirPods
//     advertise them; the shell shows a card when a case opens nearby.
//   - The AirPods' control channel (aap.js), an L2CAP channel (PSM 0x1001)
//     to AirPods paired and connected through OSE's Bluetooth service:
//     exact batteries, which earbud is in an ear, the listening mode, ear
//     detection and Conversation Awareness. Node has no L2CAP sockets: the
//     channel is phoenix-l2cap's (services/l2cap), a small helper the
//     service runs, packets in and out on its standard streams (service.js).
//
// Pairing (connect {id}, the card's Connect) is the ordinary Bluetooth way,
// through com.webos.service.bluetooth2 (adapter/startDiscovery, then
// adapter/pair and a2dp/connect for the AirPods that turn up): AirPods only
// pair with a device that is not Apple's while their case is in pairing
// mode (the button on the back of the case held until the light flashes
// white; Apple: "Connect AirPods to a non-Apple device"), which the card
// asks for. Phoenix does not present itself as Apple's (the Bluetooth
// vendor ID): what needs that (Hearing Aid, Customize Transparency Mode,
// switching between devices) is not offered.
//
// Which advertisement is which paired AirPods: the advertisement's address
// is random and its identifying part encrypted, so Phoenix matches by model:
// the one paired AirPods of that model is taken to be the ones nearby.
//
//   getStatus {subscribe} -> {bluetooth, nearby: [{id, model, modelName,
//       kind, color, battery: {left, right, case}, charging, lidOpen,
//       lidOpenCount, rssi, paired: address | ""}], devices: [{address,
//       name, model, kind, modelNumber, connected, aap, battery: {left,
//       right, case, single}, charging, inEar: {left, right}, noiseMode,
//       noiseModes, earDetection, conversationAwareness (null: the model
//       has none)}], pairing: null | {id, state ("searching", "pairing",
//       "connecting", "failed"), address, error}}
//   connect {id}, cancelConnect {}, setNoiseMode {address, mode ("off",
//       "transparency", "adaptive", "anc")}, setEarDetection {address,
//       enabled}, setConversationAwareness {address, enabled}, rename
//       {address, name}, forget {address}
//
// Batteries are percentages, -1 for no reading. The service keeps the
// names given and the ear detection choice in its store.
//
// createEarbuds({call, subscribe, scanner, l2cap(address, psm) -> {send,
// close, onPacket(fn), onClose(fn)}, store: {load, save}, now?, timers?})
// -> {service: {method: (params, caller, respond) -> cancel?}, advert(dev),
// close()}
// STATUS: written against bluetooth2's sources (OSE) and earbuds.test.ts;
// not yet run on a device or with AirPods.

"use strict";

var continuity = require("./lib/continuity");
var aap = require("./lib/aap");
var models = require("./lib/models");

var BT = "luna://com.webos.service.bluetooth2";
var NEARBY_FOR = 15 * 1000;        // an advertisement heard this recently is "near"
var PAIR_TIMEOUT = 60 * 1000;
var RETRY_AAP = 30 * 1000;

function ok(extra) { return Object.assign({ returnValue: true }, extra || {}); }
function fail(text) { return { returnValue: false, errorCode: -1, errorText: text }; }

function isEarbudsName(name) { return /\b(air ?pods|beats|powerbeats)\b/i.test(String(name || "")); }

function createEarbuds(opts) {
    var now = opts.now || function () { return Date.now(); };
    var timers = opts.timers || { setTimeout: setTimeout, clearTimeout: clearTimeout };
    var watchers = [];
    var bluetooth = false;
    var nearby = {};           // id -> advert summary
    var btDevices = [];        // bluetooth2's paired devices
    var sessions = {};         // address -> {session, transport, state}
    var retryAt = {};          // address -> ms
    var pairing = null;
    var pairTimer = null;
    var cancels = [];

    function store() { return (opts.store && opts.store.load()) || {}; }
    function saved() { return store().earbuds || {}; }
    function save(fn) {
        if (!opts.store) return;
        var s = store();
        s.earbuds = s.earbuds || {};
        fn(s.earbuds);
        opts.store.save(s);
    }

    function deviceList() {
        var mine = saved();
        return btDevices.filter(function (d) { return d.paired && (isEarbudsName(d.name) || mine[d.address]); }).map(function (d) {
            var keep = mine[d.address] || {};
            var s = sessions[d.address] ? sessions[d.address].state : null;
            var info = s && s.modelNumber ? models.byNumber(s.modelNumber) : null;
            var guess = models.guess(keep.kind, d.name);
            var modes = info ? info.modes : guess.modes;
            var ca = info ? info.conversationAwareness : guess.conversationAwareness;
            var connected = Array.isArray(d.connectedProfiles) && d.connectedProfiles.length > 0;
            var battery = { left: -1, right: -1, case: -1, single: -1 };
            var charging = { left: false, right: false, case: false, single: false };
            if (s) for (var k in s.battery) { battery[k] = s.battery[k]; charging[k] = !!s.charging[k]; }
            return {
                address: d.address, name: keep.name || d.name || "AirPods", btName: d.name || "",
                model: info ? info.name : keep.modelName || "", kind: info ? info.kind : keep.kind || "",
                modelNumber: s ? s.modelNumber : "", connected: connected, aap: !!(s && s.connected),
                battery: battery, charging: charging,
                inEar: s ? { left: s.inEar.left, right: s.inEar.right } : { left: "", right: "" },
                noiseMode: s && s.listeningMode ? s.listeningMode : "", noiseModes: modes,
                earDetection: keep.earDetection !== false,
                conversationAwareness: ca ? (s && s.conversationAwareness !== null ? !!s.conversationAwareness : true) : null
            };
        });
    }

    function nearbyList() {
        var t = now(), devs = deviceList();
        return Object.keys(nearby).filter(function (id) { return t - nearby[id].seenAt <= NEARBY_FOR; }).map(function (id) {
            var n = nearby[id];
            // The paired AirPods these are, by model (see above).
            var same = devs.filter(function (d) {
                return n.kind ? d.kind === n.kind || (!d.kind && n.modelName && d.name.indexOf(n.modelName) >= 0) : true;
            });
            return { id: id, model: n.model, modelName: n.modelName || "AirPods", kind: n.kind, color: n.color,
                     battery: n.battery, charging: n.charging, lidOpen: n.lidOpen, lidOpenCount: n.lidOpenCount, rssi: n.rssi,
                     paired: same.length === 1 ? same[0].address : "" };
        });
    }

    function status() { return ok({ bluetooth: bluetooth, nearby: nearbyList(), devices: deviceList(), pairing: pairing }); }

    var firing = false;
    function fire() {
        if (firing) return;
        firing = true;
        Promise.resolve().then(function () {
            firing = false;
            var st = status();
            watchers.slice().forEach(function (w) { w(Object.assign({ subscribed: true }, st)); });
        });
    }

    // ---- The control channel ----------------------------------------------------------
    function openSessions() {
        btDevices.forEach(function (d) {
            var mine = saved();
            if (!d.paired || !(isEarbudsName(d.name) || mine[d.address])) return;
            var connected = Array.isArray(d.connectedProfiles) && d.connectedProfiles.length > 0;
            var have = sessions[d.address];
            if (!connected) {
                if (have) { have.transport.close(); delete sessions[d.address]; fire(); }
                return;
            }
            if (have || !opts.l2cap || now() < (retryAt[d.address] || 0)) return;
            var t = opts.l2cap(d.address, aap.PSM);
            if (!t) return;
            var entry = { transport: t, state: null, session: null };
            sessions[d.address] = entry;
            entry.session = aap.session(t, function (st) {
                entry.state = st;
                // Ear detection as the user set it here, once connected.
                if (st.connected && !entry.told) {
                    entry.told = true;
                    var want = (saved()[d.address] || {}).earDetection;
                    if (want === false) entry.session.setEarDetection(false);
                }
                fire();
            });
            t.onPacket(function (bytes) { entry.session.receive(bytes); });
            t.onClose(function () {
                if (sessions[d.address] === entry) delete sessions[d.address];
                retryAt[d.address] = now() + RETRY_AAP;
                fire();
            });
        });
    }

    // ---- bluetooth2 ------------------------------------------------------------------
    cancels.push(opts.subscribe(BT + "/adapter/getStatus", { subscribe: true }, function (r) {
        if (!r || r.returnValue === false || !Array.isArray(r.adapters)) return;
        var on = !!(r.adapters[0] && r.adapters[0].powered);
        if (on !== bluetooth) {
            bluetooth = on;
            if (opts.scanner) opts.scanner.setBluetooth(on);
            if (!on) nearby = {};
            fire();
        }
    }));
    cancels.push(opts.subscribe(BT + "/device/getStatus", { subscribe: true }, function (r) {
        if (!r || r.returnValue === false || !Array.isArray(r.devices)) return;
        btDevices = r.devices;
        pairingProgress();
        openSessions();
        fire();
    }));

    // ---- Advertisements ----------------------------------------------------------------
    function advert(dev) {
        var c = continuity.classify(dev);
        if (!c || c.kind !== "earbuds") return;
        var id = String(dev.address || "");
        var was = nearby[id];
        nearby[id] = { model: "0x" + ("000" + c.model.toString(16)).slice(-4), modelName: c.modelName, kind: c.family, color: c.color,
                       battery: c.battery, charging: c.charging, lidOpen: c.lidOpen, lidOpenCount: c.lidOpenCount,
                       rssi: typeof dev.rssi === "number" ? dev.rssi : 0, seenAt: now() };
        if (!was || JSON.stringify(Object.assign({}, was, { seenAt: 0, rssi: 0 })) !== JSON.stringify(Object.assign({}, nearby[id], { seenAt: 0, rssi: 0 })))
            fire();
    }
    if (opts.scanner) opts.scanner.onAdvert(advert);

    // ---- Pairing (the card's Connect) ---------------------------------------------------
    function setPairing(p) { pairing = p; fire(); }
    function pairingProgress() {
        if (!pairing || pairing.state === "failed") return;
        var target = pairing.address ? btDevices.filter(function (d) { return d.address === pairing.address; })[0] : null;
        if (pairing.state === "searching") {
            // AirPods in pairing mode, found by the inquiry: their name, an
            // audio device (major class 4, Bluetooth Assigned Numbers).
            var want = pairing.modelName;
            var found = btDevices.filter(function (d) {
                return !d.paired && isEarbudsName(d.name) && (((d.classOfDevice >> 8) & 0x1f) === 4 || !d.classOfDevice)
                    && (!want || d.name.toLowerCase().indexOf(want.toLowerCase()) >= 0 || /airpods/i.test(want) === /airpods/i.test(d.name));
            })[0];
            if (!found) return;
            opts.call(BT + "/adapter/cancelDiscovery", {});
            setPairing({ id: pairing.id, state: "pairing", address: found.address, modelName: pairing.modelName, kind: pairing.kind, error: "" });
            opts.call(BT + "/adapter/pair", { address: found.address }).then(function (r) {
                if (r && r.returnValue === false) failPairing(r.errorText || "AirPods did not pair");
            });
        } else if (pairing.state === "pairing" && target && target.paired) {
            var p = pairing;
            save(function (e) { e[p.address] = Object.assign({}, e[p.address] || {}, { modelName: p.modelName, kind: p.kind }); });
            setPairing({ id: p.id, state: "connecting", address: p.address, modelName: p.modelName, kind: p.kind, error: "" });
            opts.call(BT + "/a2dp/connect", { address: p.address }).then(function (r) {
                if (r && r.returnValue === false) failPairing(r.errorText || "AirPods did not connect");
            });
        } else if (pairing.state === "connecting" && target && Array.isArray(target.connectedProfiles) && target.connectedProfiles.length) {
            if (pairTimer) timers.clearTimeout(pairTimer);
            pairTimer = null;
            setPairing(null);
        }
    }
    function failPairing(text) {
        if (!pairing) return;
        if (pairTimer) timers.clearTimeout(pairTimer);
        pairTimer = null;
        opts.call(BT + "/adapter/cancelDiscovery", {});
        setPairing(Object.assign({}, pairing, { state: "failed", error: text }));
    }

    function deviceFor(address) {
        return deviceList().filter(function (d) { return d.address === address; })[0] || null;
    }
    function sessionFor(address, respond) {
        var s = sessions[address];
        if (!s || !s.state || !s.state.connected) { respond(fail("These AirPods are not connected")); return null; }
        return s.session;
    }

    var service = {
        getStatus: function (p, caller, respond) {
            respond(Object.assign(p.subscribe ? { subscribed: true } : {}, status()));
            if (!p.subscribe) return undefined;
            watchers.push(respond);
            return function () { watchers = watchers.filter(function (w) { return w !== respond; }); };
        },
        connect: function (p, caller, respond) {
            var n = nearby[String(p.id || "")];
            if (!bluetooth) return respond(fail("Bluetooth is off"));
            if (!n) return respond(fail("Those AirPods are no longer nearby"));
            if (pairTimer) timers.clearTimeout(pairTimer);
            pairTimer = timers.setTimeout(function () { failPairing("No AirPods in pairing mode were found"); }, PAIR_TIMEOUT);
            setPairing({ id: String(p.id), state: "searching", address: "", modelName: n.modelName, kind: n.kind, error: "" });
            opts.call(BT + "/adapter/startDiscovery", {}).then(function (r) {
                if (r && r.returnValue === false) failPairing(r.errorText || "Bluetooth could not search");
            });
            respond(ok());
        },
        cancelConnect: function (p, caller, respond) {
            if (pairTimer) timers.clearTimeout(pairTimer);
            pairTimer = null;
            if (pairing && pairing.state === "searching") opts.call(BT + "/adapter/cancelDiscovery", {});
            setPairing(null);
            respond(ok());
        },
        setNoiseMode: function (p, caller, respond) {
            var d = deviceFor(String(p.address || ""));
            if (!d) return respond(fail("No such AirPods"));
            if (d.noiseModes.indexOf(p.mode) < 0) return respond(fail("These AirPods do not have that listening mode"));
            var s = sessionFor(d.address, respond);
            if (!s) return undefined;
            s.setListeningMode(p.mode);
            respond(ok());
        },
        setEarDetection: function (p, caller, respond) {
            var d = deviceFor(String(p.address || ""));
            if (!d) return respond(fail("No such AirPods"));
            var on = p.enabled !== false;
            save(function (e) { e[d.address] = Object.assign({}, e[d.address] || {}, { earDetection: on }); });
            var s = sessions[d.address];
            if (s && s.state && s.state.connected) s.session.setEarDetection(on);
            fire();
            respond(ok());
        },
        setConversationAwareness: function (p, caller, respond) {
            var d = deviceFor(String(p.address || ""));
            if (!d) return respond(fail("No such AirPods"));
            if (d.conversationAwareness === null) return respond(fail("These AirPods do not have Conversation Awareness"));
            var s = sessionFor(d.address, respond);
            if (!s) return undefined;
            s.setConversationAwareness(p.enabled !== false);
            respond(ok());
        },
        rename: function (p, caller, respond) {
            var d = deviceFor(String(p.address || ""));
            var name = String(p.name || "").trim();
            if (!d) return respond(fail("No such AirPods"));
            if (!name || name.length > 32) return respond(fail("The name has 1 to 32 characters"));
            save(function (e) { e[d.address] = Object.assign({}, e[d.address] || {}, { name: name }); });
            fire();
            respond(ok());
        },
        forget: function (p, caller, respond) {
            var address = String(p.address || "");
            var d = deviceFor(address);
            if (!d) return respond(fail("No such AirPods"));
            if (sessions[address]) { sessions[address].transport.close(); delete sessions[address]; }
            opts.call(BT + "/adapter/unpair", { address: address }).then(function (r) {
                if (r && r.returnValue === false) return respond(fail(r.errorText || "These AirPods could not be forgotten"));
                save(function (e) { delete e[address]; });
                fire();
                respond(ok());
            });
        }
    };

    return {
        service: service,
        advert: advert,
        status: status,
        // Expire the AirPods no longer heard (service.js calls it every few seconds).
        tick: function () {
            var t = now(), gone = false;
            Object.keys(nearby).forEach(function (id) { if (t - nearby[id].seenAt > NEARBY_FOR) { delete nearby[id]; gone = true; } });
            openSessions();
            if (gone) fire();
        },
        close: function () {
            cancels.forEach(function (c) { if (typeof c === "function") c(); });
            Object.keys(sessions).forEach(function (a) { sessions[a].transport.close(); });
        }
    };
}

var METHODS = ["getStatus", "connect", "cancelConnect", "setNoiseMode", "setEarDetection", "setConversationAwareness", "rename", "forget"];

module.exports = { createEarbuds: createEarbuds, METHODS: METHODS, isEarbudsName: isEarbudsName };
