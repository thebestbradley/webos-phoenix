// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The AirPods' own control channel, often called AAP (the Apple Accessory
// Protocol): an L2CAP channel (PSM 0x1001) beside the audio, over which a
// phone reads the earbuds' and case's batteries, hears an earbud go in or
// out of an ear, and sets the listening mode. Written from protocol facts
// only (docs/ACCESSORIES.md, "Sources"); no other project's code or text.
//
// What each fact rests on:
//
//   [AAP-defs]  tyalie/AAP-Protocol-Defintion (README, FINDINGS.md,
//               defintion/aap.ksy, and its captures in examples/, each with
//               what Apple's PacketLogger reads in it): PSM 0x1001; a packet
//               begins with its kind (two bytes, little-endian: 0 connect,
//               1 connect response, 2 disconnect, 4 a message) and the
//               service ID 4; connect is major 1, minor 2 and eight bytes of
//               features (all zero); a message carries a two-byte opcode
//               and its data. Opcodes seen there: 0x01 read capabilities,
//               0x04 battery state (a count, then five bytes each: the
//               component, 0x01, the level in percent, the state, 0x01;
//               components 0x02 right, 0x04 left, 0x08 case; states 0x01
//               charging, 0x02 discharging), 0x05 get the in-ear state,
//               0x06 in-ear state (the primary earbud's, the secondary's;
//               0x02 in the case), 0x08 role state (0x01 first: the
//               primary is the left), 0x09 a setting (its ID, its value,
//               three zero bytes; 0x0D listening mode, 0x01 "Normal", i.e.
//               off; 0x0A in-ear detection, 0x02 "On"), 0x0F the
//               notification filter (ff ff ff ff: every notification), 0x1D
//               version information (strings, each ended by a zero byte).
//   [gist]      rithvikvibhu, "Apple Airpods Bluetooth Packets" (a public
//               gist of captured packets, September 2025): the listening
//               mode setting 0D 03 00 00 00 is Transparency.
//   [rs]        brianpht/librepods-rs README ("How It Works"): the setting
//               0x0D with 0x02 is Noise Cancellation; 0x28 is Conversation
//               Awareness, on or off; Hearing Aid, Customize Transparency
//               Mode and multipoint connection need the host to present
//               Apple's Bluetooth vendor ID, which Phoenix does not do.
//   [keys]      The AirPods' keys (lib/keys.js uses them): asked for with
//               04 00 04 00 30 00 05 00, which the AirPods answer once the
//               channel is connected [AAP-defs FINDINGS.md, "request magic
//               cloud keys"]; the answer is opcode 0x31: a count, then each
//               key as its type (0x01 the identity resolving key, 0x04 the
//               encryption key), a byte, its length, a byte, and the key
//               (CAPod's wiki, "AirPod Keys", d4rken-org/capod: facts only;
//               the project is GPL-3.0 and none of its code is used).
//   [rename]    Renaming the AirPods themselves: opcode 0x1A, then 0x01,
//               the name's length in bytes, 0x00 and the name in UTF-8
//               (LibrePods' docs/AAP Definitions.md, "Renaming AirPods":
//               the message's bytes only; LibrePods is GPL-3.0 and none of
//               its code or text is used). UNVERIFIED: no capture or second
//               source confirms it, and the AirPods give no answer to it,
//               so earbuds.js takes it as done only when they report the
//               new name (their version information, or their Bluetooth
//               name).
//
// Marked UNVERIFIED below: values those sources do not give, taken as the
// community reports them and not yet checked against a capture or a pair
// of AirPods (Adaptive 0x04; in ear 0x00, out of the ear 0x01; ear
// detection off 0x01; Conversation Awareness on 0x01, off 0x02; the
// single battery of AirPods Max 0x01; the role's 0x02 for a right primary).
// They are all in the tables here, to correct after testing on a device.

"use strict";

var PSM = 0x1001;
var SERVICE = 4;
var KIND = { connect: 0, connectResponse: 1, disconnect: 2, message: 4 };
var OP = { readCapabilities: 0x01, capabilities: 0x02, battery: 0x04, getInEar: 0x05, inEar: 0x06, role: 0x08,
           setting: 0x09, notificationFilter: 0x0f, rename: 0x1a /* UNVERIFIED */, version: 0x1d,
           keysRequest: 0x30, keys: 0x31 };
// The keys' types in the 0x31 answer [keys].
var KEY_TYPES = { 0x01: "irk", 0x04: "encKey" };
var SETTING = { listeningMode: 0x0d, earDetection: 0x0a, conversationAwareness: 0x28 };

var LISTENING_MODES = { off: 0x01, anc: 0x02, transparency: 0x03, adaptive: 0x04 /* UNVERIFIED */ };
var EAR_DETECTION = { on: 0x02, off: 0x01 /* UNVERIFIED */ };
var CONVERSATION_AWARENESS = { on: 0x01 /* UNVERIFIED */, off: 0x02 /* UNVERIFIED */ };
var EAR = { 0x00: "ear" /* UNVERIFIED */, 0x01: "out" /* UNVERIFIED */, 0x02: "case" };
var COMPONENTS = { 0x01: "single" /* UNVERIFIED */, 0x02: "right", 0x04: "left", 0x08: "case" };

function u16(n) { return [n & 0xff, (n >> 8) & 0xff]; }

// ---- Packets we send ------------------------------------------------------------------

function connectPacket() {
    return u16(KIND.connect).concat(u16(SERVICE), u16(1), u16(2), [0, 0, 0, 0, 0, 0, 0, 0]);
}
function message(op, data) {
    return u16(KIND.message).concat(u16(SERVICE), u16(op), data || []);
}
function notificationFilter() { return message(OP.notificationFilter, [0xff, 0xff, 0xff, 0xff]); }
function getInEar() { return message(OP.getInEar, []); }
function setting(id, value) { return message(OP.setting, [id, value, 0, 0, 0]); }

function setListeningMode(mode) {
    var v = LISTENING_MODES[mode];
    if (v === undefined) throw new Error("listening mode: off, transparency, adaptive or anc");
    return setting(SETTING.listeningMode, v);
}
function setEarDetection(on) { return setting(SETTING.earDetection, on ? EAR_DETECTION.on : EAR_DETECTION.off); }
function setConversationAwareness(on) {
    return setting(SETTING.conversationAwareness, on ? CONVERSATION_AWARENESS.on : CONVERSATION_AWARENESS.off);
}
// [keys]: 05 asks for both keys (types 0x01 and 0x04, as a mask).
function requestProximityKeys() { return message(OP.keysRequest, [0x05, 0x00]); }
// [rename], UNVERIFIED. At most 32 characters (Phoenix's limit, as the
// Settings page's) and 255 bytes (one length byte).
function rename(name) {
    var bytes = toUtf8(String(name || ""));
    if (!bytes.length || bytes.length > 255) throw new Error("rename: 1 to 255 bytes of UTF-8");
    return message(OP.rename, [0x01, bytes.length, 0x00].concat(bytes));
}
function toUtf8(str) {
    var enc = unescape(encodeURIComponent(str)), out = [];
    for (var i = 0; i < enc.length; ++i) out.push(enc.charCodeAt(i));
    return out;
}

// ---- Packets we receive ---------------------------------------------------------------

function nameOf(table, v) {
    for (var k in table) if (table[k] === v) return k;
    return "";
}

// {kind, ...}: "connectResponse" {status, major, minor}, "disconnect",
// "battery" {battery: {left, right, case, single}, charging: {...}},
// "inEar" {primary, secondary}, "role" {primary}, "setting" {id, value,
// listeningMode?, earDetection?, conversationAwareness?}, "version"
// {name, modelNumber, manufacturer, serial, firmware}, "keys" {irk,
// encKey} (byte arrays, [] if not sent), or "other" {op}.
function parse(bytes) {
    var b = Array.prototype.slice.call(bytes || []);
    if (b.length < 4) return null;
    var kind = b[0] | (b[1] << 8);
    if (kind === KIND.connectResponse)
        return { kind: "connectResponse", status: b.length >= 6 ? b[4] | (b[5] << 8) : -1,
                 major: b.length >= 8 ? b[6] | (b[7] << 8) : 0, minor: b.length >= 10 ? b[8] | (b[9] << 8) : 0 };
    if (kind === KIND.disconnect) return { kind: "disconnect" };
    if (kind !== KIND.message || b.length < 6) return { kind: "other", op: -1 };
    var op = b[4] | (b[5] << 8), d = b.slice(6);
    switch (op) {
    case OP.battery: {
        var out = { kind: "battery", battery: {}, charging: {} };
        var n = d[0] || 0;
        for (var i = 0; i < n; ++i) {
            var e = d.slice(1 + 5 * i, 6 + 5 * i);
            if (e.length < 4) break;
            var which = COMPONENTS[e[0]];
            if (!which) continue;
            // A level is a reading only while the part is charging or not
            // (states 1 and 2 [AAP-defs]); any other state has none.
            var reading = e[3] === 0x01 || e[3] === 0x02;
            out.battery[which] = reading ? Math.max(0, Math.min(100, e[2])) : -1;
            out.charging[which] = e[3] === 0x01;
        }
        return out;
    }
    case OP.inEar:
        return { kind: "inEar", primary: EAR[d[0]] || "", secondary: EAR[d[1]] || "" };
    case OP.role:
        // UNVERIFIED: 0x02 a right primary.
        return { kind: "role", primary: d[0] === 0x01 ? "left" : d[0] === 0x02 ? "right" : "" };
    case OP.setting: {
        var s = { kind: "setting", id: d[0], value: d[1] };
        if (d[0] === SETTING.listeningMode) s.listeningMode = nameOf(LISTENING_MODES, d[1]);
        if (d[0] === SETTING.earDetection) s.earDetection = d[1] === EAR_DETECTION.on;
        if (d[0] === SETTING.conversationAwareness) s.conversationAwareness = d[1] === CONVERSATION_AWARENESS.on;
        return s;
    }
    case OP.version: {
        // A few bytes before the strings, then strings ended by zero bytes:
        // the name, the model number, the maker, the serial number, the
        // firmware's version [AAP-defs examples/version-information].
        var start = 0;
        while (start < d.length && !(d[start] >= 0x20 && d[start] < 0x7f && d[start + 1] >= 0x20)) start++;
        var strs = [], cur = [];
        for (var j = start; j < d.length; ++j) {
            if (d[j] === 0) { strs.push(utf8(cur)); cur = []; } else cur.push(d[j]);
        }
        if (cur.length) strs.push(utf8(cur));
        return { kind: "version", name: strs[0] || "", modelNumber: strs[1] || "", manufacturer: strs[2] || "",
                 serial: strs[3] || "", firmware: strs[4] || "" };
    }
    case OP.keys: {
        // [keys]: a count, then [type, ?, length, ?, key...] each.
        var keys = { kind: "keys", irk: [], encKey: [] };
        var count = d[0] || 0, at = 1;
        for (var q = 0; q < count && at + 4 <= d.length; ++q) {
            var type = d[at], len = d[at + 2];
            var key = d.slice(at + 4, at + 4 + len);
            if (key.length !== len) break;
            if (KEY_TYPES[type]) keys[KEY_TYPES[type]] = key;
            at += 4 + len;
        }
        return keys;
    }
    default:
        return { kind: "other", op: op };
    }
}

function utf8(bytes) {
    try { return decodeURIComponent(bytes.map(function (c) { return "%" + (c < 16 ? "0" : "") + c.toString(16); }).join("")); }
    catch (e) { return String.fromCharCode.apply(null, bytes); }
}

// ---- A session ----------------------------------------------------------------------------
// session(transport, onState): transport {send(bytes), close()}; feed it
// each packet that comes (receive), and closed() when the channel goes.
// onState(state) after every change: {connected, battery, charging, inEar:
// {left, right}, listeningMode, earDetection, conversationAwareness,
// modelNumber, name, firmware, keys: {irk, encKey} | null}.

function session(transport, onState) {
    var st = { connected: false, battery: {}, charging: {}, inEar: { left: "", right: "" }, primary: "",
               listeningMode: "", earDetection: null, conversationAwareness: null, modelNumber: "", name: "", firmware: "",
               keys: null };
    var raw = { primary: "", secondary: "" };
    function emit() { if (onState) onState(JSON.parse(JSON.stringify(st))); }
    function ears() {
        // Primary and secondary are left and right by the role; until it is
        // known, the primary is taken as the left.
        var leftIsPrimary = st.primary !== "right";
        st.inEar = { left: leftIsPrimary ? raw.primary : raw.secondary, right: leftIsPrimary ? raw.secondary : raw.primary };
    }
    transport.send(connectPacket());
    return {
        state: function () { return st; },
        receive: function (bytes) {
            var p = parse(bytes);
            if (!p) return;
            if (p.kind === "connectResponse") {
                if (p.status !== 0) { transport.close(); return; }
                st.connected = true;
                transport.send(notificationFilter());
                transport.send(getInEar());
                // The keys, to know these AirPods' advertisements (keys.js).
                transport.send(requestProximityKeys());
            } else if (p.kind === "disconnect") {
                st.connected = false;
                transport.close();
            } else if (p.kind === "battery") {
                for (var k in p.battery) { st.battery[k] = p.battery[k]; st.charging[k] = p.charging[k]; }
            } else if (p.kind === "inEar") {
                raw = { primary: p.primary, secondary: p.secondary };
                ears();
            } else if (p.kind === "role") {
                st.primary = p.primary;
                ears();
            } else if (p.kind === "setting") {
                if (p.listeningMode !== undefined && p.listeningMode !== "") st.listeningMode = p.listeningMode;
                if (p.earDetection !== undefined) st.earDetection = p.earDetection;
                if (p.conversationAwareness !== undefined) st.conversationAwareness = p.conversationAwareness;
            } else if (p.kind === "version") {
                st.modelNumber = p.modelNumber;
                st.name = p.name;
                st.firmware = p.firmware;
            } else if (p.kind === "keys") {
                if (p.irk.length !== 16 && p.encKey.length !== 16) return;
                st.keys = { irk: p.irk.length === 16 ? p.irk : [], encKey: p.encKey.length === 16 ? p.encKey : [] };
            } else {
                return;
            }
            emit();
        },
        closed: function () { st.connected = false; emit(); },
        setListeningMode: function (mode) { transport.send(setListeningMode(mode)); st.listeningMode = mode; emit(); },
        setEarDetection: function (on) { transport.send(setEarDetection(on)); st.earDetection = !!on; emit(); },
        setConversationAwareness: function (on) {
            transport.send(setConversationAwareness(on)); st.conversationAwareness = !!on; emit();
        },
        rename: function (name) { transport.send(rename(name)); },
        close: function () { transport.close(); }
    };
}

module.exports = {
    PSM: PSM, OP: OP, SETTING: SETTING, LISTENING_MODES: LISTENING_MODES,
    connectPacket: connectPacket, notificationFilter: notificationFilter, getInEar: getInEar,
    setListeningMode: setListeningMode, setEarDetection: setEarDetection, setConversationAwareness: setConversationAwareness,
    requestProximityKeys: requestProximityKeys, rename: rename,
    parse: parse, session: session
};
