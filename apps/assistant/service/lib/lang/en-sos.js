// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// English for emergencies: the words for an emergency call the call
// command's own words leave out ("emergency", "SOS", "call 911 now", "get
// the paramedics"; the call is the call command's, with its countdown:
// lib/emergency.js), the words that stop or hurry its countdown, and
// texting the emergency contacts where the phone is (lib/commands-sos.js).
// h: lib/lang/en.js's helpers.

"use strict";

module.exports = function (h) {
    var NUMBER = "(911|112|999|000|110|119|111|9 1 1|1 1 2|9 9 9|nine one one|one one two|nine nine nine)";
    function digitsOf(s) {
        return String(s).replace(/nine/g, "9").replace(/one/g, "1").replace(/two/g, "2").replace(/\s+/g, "");
    }
    // -> the call command's arguments: {number} said, or {emergency} (the region's number).
    function emergency(t) {
        var m;
        if ((m = new RegExp("^(?:call|dial|ring|phone|get me)(?: the)? " + NUMBER + "(?: now| please| right now)$").exec(t))) return { number: digitsOf(m[1]), label: "" };
        if (/^(?:get|contact)(?: me)?(?: the| an| a)? (?:emergency services|emergency|ambulance|police|cops|fire department|fire brigade|paramedics|emergency number)(?: now| please)?$|^(?:call|dial|ring|phone)(?: me)?(?: the| an| a)? (?:emergency services|emergency|ambulance|police|cops|fire department|fire brigade|paramedics|emergency number) (?:now|please|right now)$|^(?:emergency|sos|emergency call|this is an emergency|it's an emergency|i need an ambulance|i need the police|i need emergency help|call for help|send help)$/.test(t))
            return { emergency: true, label: "" };
        return null;
    }
    // An emergency call counting down (assistant.js confirmAnswer): any few
    // words with a stop in them cancel it ("wait, no, stop", "false alarm":
    // a call no one wants is worse than one asked again), "call now" and
    // "hurry" place it at once.
    function countdownAnswer(t) {
        t = String(t || "").replace(/[,.!?]+/g, " ").replace(/\s+/g, " ").trim();
        if (/^(?:never ?mind|false alarm|i'm ok|i'm okay|i'm fine|i'm alright|hang on|hold on)$/.test(t)) return "no";
        if (t.split(" ").length <= 5 && /\b(?:cancel|stop|no|nope|don't|do not|abort|wait)\b/.test(t)) return "no";
        if (/^(?:call now|call them now|call right now|go ahead|do it|yes|yes call|hurry|hurry up|call|call it|please hurry)$/.test(t)) return "yes";
        return null;
    }
    function emergencyText(t) {
        return /^(?:text|send|share|message)(?: my)? (?:location|where i am) (?:to|with) (?:my )?emergency contacts?$|^(?:text|tell|alert|notify|message) my emergency contacts?(?: where i am| my location)?$/.test(t) ? {} : null;
    }

    var say = {
        textLocationTo: function (names) { return "Text My Location to " + (names.length === 1 ? names[0] : "My Emergency Contacts"); },
        noEmergencyContacts: function () { return "You have no emergency contacts. Add them in Settings > Emergency Info."; },
        sosMessage: function (n, link) {
            return (n ? "I've called " + n + ". " : "I need help. ") + (link ? "I'm here: " + link : "I couldn't get my location.");
        },
        confirmSosText: function (names, text) { return "Text " + h.list(names) + ": “" + text + "”?"; },
        sosTexted: function (names) { return "Texted " + h.list(names) + " where you are."; }
    };

    return {
        // Before the call command's own words.
        rules: [["call", emergency], ["emergencyText", emergencyText]],
        say: say,
        MENTIONS: { emergencyText: /\b(emergency|location|where)\b/ },
        describe: function (command) {
            return command === "emergencyText" ? "text your emergency contacts where you are" : "";
        },
        help: { title: "Emergency", examples: ["Call 911", "Emergency", "Text my location to my emergency contacts"] },
        lang: { countdownAnswer: countdownAnswer }
    };
};
