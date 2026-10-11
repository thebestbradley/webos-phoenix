// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Emergencies (docs/AI-AND-MCP.md, "Everyday features"). The call itself
// is the call command's (lib/commands.js, lib/emergency.js): "call 911",
// "call an ambulance", "emergency", "SOS" (lib/lang/en-sos.js's words) are
// placed after a five-second countdown with Cancel and Call Now, never
// held for a yes, over the lock screen too. Here, what goes with it:
//
//   emergencyText    "text my location to my emergency contacts": a text to
//                    each of the user's emergency contacts (Settings >
//                    Emergency Info), with where the phone is (a map link,
//                    as Maps shares a place), read back first as any text.
//   sosOffer         the button the emergency call's answer carries when
//                    the user has emergency contacts: Text My Location to
//                    them (lib/commands.js call).

"use strict";

var PREFS = "luna://com.webos.service.systemservice/";
var MESSAGING = "luna://org.webosports.service.messaging/";

var COMMANDS = [
    { id: "emergencyText", title: "Texting your emergency contacts", risk: "send", whenLocked: true,
      description: "Text the user's emergency contacts (Settings > Emergency Info) where they are.",
      parameters: { type: "object", properties: {} },
      examples: ["let my emergency contacts know where I am", "send my location to my emergency contacts"] }
];

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
    // number: the emergency number just called, when this follows the call.
    function message(env, number) {
        var say = env.lang.say;
        return h.here(env, "sos").then(function (me) { return me; }, function () { return null; }).then(function (me) {
            return say.sosMessage(number || "", me ? osmLink(me.lat, me.lon) : "");
        });
    }
    function prepare(cmd, args, env) {
        if (cmd.id !== "emergencyText") return null;
        var say = env.lang.say;
        return contacts(env).then(function (ice) {
            if (!ice.length) return { args: args, reply: say.noEmergencyContacts() };
            return message(env, args.number).then(function (text) {
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
        run: function (cmd, args, env) {
            return cmd.id === "emergencyText" ? text(args, env) : null;
        },
        // The emergency call's button (lib/commands.js call): Text My Location
        // to the emergency contacts, read back when tapped; [] without any.
        sosOffer: function (env, number) {
            return contacts(env).then(function (ice) {
                if (!ice.length) return [];
                return [{ label: env.lang.say.textLocationTo(ice.map(function (c) { return c.name; })),
                          run: { command: "emergencyText", args: { number: number } } }];
            });
        }
    };
};
