// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Emergency calls (docs/AI-AND-MCP.md, "Everyday features"):
//
//   emergency        "call 911", "call 112", "emergency", "call an
//                    ambulance": never behind a read-back. The shell opens
//                    Phone's emergency window over everything, the lock
//                    screen included (org.webosphoenix.system emergencyCall
//                    -> Shell openEmergency, the PIN pad's own Emergency
//                    Call window), which counts down COUNTDOWN seconds with
//                    Cancel and Call Now, then calls (apps/phone
//                    views/Emergency.tsx: emergency numbers only). Said
//                    aloud, with Cancel (a spoken "cancel" or "no": the
//                    hands-free choice path) and, when the user has
//                    emergency contacts (Settings > Emergency Info), Text My
//                    Location to them.
//   emergencyCancel  Cancel: the window closed while it still counts; after
//                    that the call is Phone's, hung up there.
//   emergencyText    "text my location to my emergency contacts": a text to
//                    each, with where the phone is (a map link, as Maps
//                    shares a place), read back first as any text.
//
// The number: the one said if it is an emergency number (3GPP's list,
// @phoenix/luna setup.ts EMERGENCY_NUMBERS), else the region's
// (primaryEmergencyNumber, from the locale).

"use strict";

var SYSTEM = "luna://org.webosphoenix.system/";
var PREFS = "luna://com.webos.service.systemservice/";
var MESSAGING = "luna://org.webosports.service.messaging/";
var SOS_KEY = "assistant:sos";
var COUNTDOWN = 5;
// 3GPP TS 22.101 10.1.1, as @phoenix/luna setup.ts has them, and the national ones.
var EMERGENCY = ["112", "911", "000", "08", "110", "118", "119", "999", "111", "100", "101", "102", "108", "15", "17", "18", "113", "115",
                 "061", "062", "080", "091", "092", "190", "192", "193", "120", "122", "065", "066", "10111", "10177", "117", "144", "133"];

var COMMANDS = [
    { id: "emergency", title: "Emergency calls", risk: "call", whenLocked: true,
      description: "Call the emergency services (911, 112, 999...) after a short countdown the user can cancel.",
      parameters: { type: "object", properties: { number: { type: "string", description: "The emergency number said, if one was" } } },
      examples: ["get me an ambulance", "I need the police", "dial emergency services"] },
    { id: "emergencyCancel", title: "Cancelling an emergency call", risk: "change", whenLocked: true, internal: true,
      description: "Stop the emergency call counting down.", parameters: { type: "object", properties: {} } },
    { id: "emergencyText", title: "Texting your emergency contacts", risk: "send", whenLocked: true,
      description: "Text the user's emergency contacts (Settings > Emergency Info) where they are.",
      parameters: { type: "object", properties: {} },
      examples: ["let my emergency contacts know where I am", "send my location to my emergency contacts"] }
];

function primary(locale) {
    var c = (String(locale || "en-US").split(/[-_]/)[1] || "us").toLowerCase();
    if (["us", "ca", "mx", "pr"].indexOf(c) >= 0) return "911";
    if (["gb", "ie", "hk", "sg", "my"].indexOf(c) >= 0) return "999";
    if (c === "au") return "000";
    if (c === "nz") return "111";
    if (["jp", "tw"].indexOf(c) >= 0) return "110";
    return "112";
}
function osmLink(lat, lon) {
    return "https://www.openstreetmap.org/?mlat=" + lat.toFixed(6) + "&mlon=" + lon.toFixed(6) + "#map=17/" + lat.toFixed(5) + "/" + lon.toFixed(5);
}

module.exports = function (h) {
    function contacts(env) {
        return h.lunaCall(env, PREFS + "getPreferences", { keys: ["emergencyInfo"] }).then(function (r) {
            var info = r.emergencyInfo || {};
            return (Array.isArray(info.contacts) ? info.contacts : []).filter(function (c) { return c && c.number; });
        }, function () { return []; });
    }
    function numberOf(args, env) {
        var said = String(args.number || "").replace(/[^0-9]/g, "");
        return EMERGENCY.indexOf(said) >= 0 ? said : primary(env.locale);
    }

    function call(args, env) {
        var say = env.lang.say, sos = env.storage.get(SOS_KEY);
        // "Call now" while it counts: the same number, at once.
        var now = args.now === true, n = now && sos ? sos.number : numberOf(args, env), secs = now ? 0 : COUNTDOWN;
        return h.lunaCall(env, SYSTEM + "emergencyCall", { number: n, countdown: secs }).then(function () {
            env.storage.set(SOS_KEY, { number: n, at: env.now(), countdown: secs });
            return contacts(env).then(function (ice) {
                var actions = secs ? [{ label: say.callNow(), answer: "yes", run: { command: "emergency", args: { number: n, now: true } } },
                                      { label: say.cancelCall(), answer: "no", run: { command: "emergencyCancel", args: {} } }] : [];
                if (ice.length) actions.push({ label: say.textLocationTo(ice.map(function (c) { return c.name; })), run: { command: "emergencyText", args: {} } });
                // The emergency window comes up over everything: the view makes way (data.opened).
                return { text: say.callingEmergency(n, secs), actions: actions.length ? actions : undefined, data: { opened: true, number: n } };
            });
        });
    }
    function cancel(args, env) {
        var say = env.lang.say, sos = env.storage.get(SOS_KEY);
        if (!sos) return Promise.resolve({ text: say.noEmergencyCall() });
        env.storage.remove(SOS_KEY);
        var counting = env.now() < sos.at + sos.countdown * 1000;
        return h.lunaCall(env, SYSTEM + "emergencyCall", { cancel: true }).catch(function () { return null; }).then(function () {
            return { text: counting ? say.emergencyCancelled(sos.number) : say.emergencyAlreadyCalling(sos.number) };
        });
    }

    // ---- Texting the emergency contacts ----
    function message(env) {
        var say = env.lang.say, sos = env.storage.get(SOS_KEY);
        return h.here(env, "sos").then(function (me) { return me; }, function () { return null; }).then(function (me) {
            return say.sosMessage(sos ? sos.number : "", me ? osmLink(me.lat, me.lon) : "");
        });
    }
    function prepare(cmd, args, env) {
        if (cmd.id === "emergency" || cmd.id === "emergencyCancel") return Promise.resolve({ args: args });   // never read back: the countdown is the asking
        if (cmd.id !== "emergencyText") return null;
        var say = env.lang.say;
        return contacts(env).then(function (ice) {
            if (!ice.length) return { args: args, reply: say.noEmergencyContacts() };
            return message(env).then(function (text) {
                var ready = { contacts: ice.map(function (c) { return { name: c.name, number: c.number }; }), message: text };
                return { args: ready, confirm: say.confirmSosText(ready.contacts.map(function (c) { return c.name; }), text) };
            });
        });
    }
    function text(args, env) {
        var say = env.lang.say, now = env.now(), list = Array.isArray(args.contacts) ? args.contacts : [];
        if (!list.length || !String(args.message || "").trim()) return Promise.resolve({ text: say.noEmergencyContacts(), failed: true });
        return list.reduce(function (p, c) {
            return p.then(function () {
                return h.lunaCall(env, MESSAGING + "putMessage", { message: {
                    _kind: "com.palm.smsmessage:1", folder: "outbox", status: "pending", serviceName: "sms",
                    messageText: String(args.message), to: [{ addr: c.number, name: c.name || "" }],
                    localTimestamp: now, timestamp: now, flags: { visible: true, read: true } } });
            });
        }, Promise.resolve()).then(function () {
            return { text: say.sosTexted(list.map(function (c) { return c.name; })), open: { appId: "org.webosphoenix.messaging", params: {}, title: "Messaging" } };
        });
    }

    return {
        COMMANDS: COMMANDS,
        prepare: prepare,
        // The grammar's: {sos} while one counts down (a little after, for the words to arrive).
        context: function (env) {
            var sos = env.storage.get(SOS_KEY);
            return { sos: !!(sos && sos.countdown && env.now() < sos.at + sos.countdown * 1000 + 3000) };
        },
        run: function (cmd, args, env) {
            if (cmd.id === "emergency") return call(args, env);
            if (cmd.id === "emergencyCancel") return cancel(args, env);
            if (cmd.id === "emergencyText") return text(args, env);
            return null;
        },
        primary: primary
    };
};
