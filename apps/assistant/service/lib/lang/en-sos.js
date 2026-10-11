// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// English for lib/commands-sos.js: emergency calls, cancelling one, and
// texting the emergency contacts where the phone is. h: lib/lang/en.js's helpers.

"use strict";

module.exports = function (h) {
    var NUMBER = "(911|112|999|000|110|119|111|9 1 1|1 1 2|9 9 9|nine one one|one one two|nine nine nine)";
    function digitsOf(s) {
        return String(s).replace(/nine/g, "9").replace(/one/g, "1").replace(/two/g, "2").replace(/\s+/g, "");
    }
    function emergency(t) {
        var m;
        if ((m = new RegExp("^(?:call|dial|ring|phone|get me)(?: the)? " + NUMBER + "(?: now| please)?$").exec(t))) return { number: digitsOf(m[1]) };
        if (/^(?:call|dial|ring|phone|get|contact)(?: me)?(?: the| an| a)? (?:emergency services|emergency|ambulance|police|cops|fire department|fire brigade|paramedics|emergency number)(?: now| please)?$|^(?:emergency|sos|emergency call|this is an emergency|it's an emergency|i need an ambulance|i need the police|i need emergency help|call for help|send help)$/.test(t))
            return { number: "" };
        return null;
    }
    function emergencyCancel(t) {
        return /^(?:cancel|stop|abort|don't make|do not make|call off)(?: the| that)? (?:emergency call|sos|call to (?:911|112|999)|emergency)$|^(?:don't|do not) call (?:911|112|999|emergency services|the police|an ambulance)$|^false alarm$/.test(t) ? {} : null;
    }
    // While an emergency call counts down (ctx.sos), before every other rule:
    // "cancel", "stop", "no" stop it (not the undo command's "cancel"); "call
    // now", "go ahead" call at once.
    // Any few words with a "stop" in them: a call no one wants is worse than one asked again.
    function sosCancel(t, ctx) {
        if (!ctx.sos) return null;
        if (/^(?:never ?mind|false alarm|i'm ok|i'm okay|i'm fine|i'm alright|hang on|hold on)$/.test(t)) return {};
        return t.split(" ").length <= 5 && /\b(?:cancel|stop|no|nope|don't|do not|abort|wait)\b/.test(t) ? {} : null;
    }
    function sosNow(t, ctx) {
        return ctx.sos && /^(?:call now|call them now|call right now|go ahead|do it|yes|yes call|hurry|call)$/.test(t) ? { number: "", now: true } : null;
    }
    function emergencyText(t) {
        return /^(?:text|send|share|message)(?: my)? (?:location|where i am) (?:to|with) (?:my )?emergency contacts?$|^(?:text|tell|alert|notify|message) my emergency contacts?(?: where i am| my location)?$/.test(t) ? {} : null;
    }

    var say = {
        // A question "no" answers by cancelling (assistant.js answerChoice: Cancel is the "no").
        callingEmergency: function (n, s) { return s ? "Calling " + n + " in " + s + " seconds. Call now, or cancel?" : "Calling " + n + "."; },
        callNow: function () { return "Call Now"; },
        cancelCall: function () { return "Cancel"; },
        textLocationTo: function (names) { return "Text My Location to " + (names.length === 1 ? names[0] : "My Emergency Contacts"); },
        noEmergencyCall: function () { return "There's no emergency call to cancel."; },
        emergencyCancelled: function (n) { return "Cancelled. I didn't call " + n + "."; },
        emergencyAlreadyCalling: function (n) { return "The call to " + n + " has started. Hang up in Phone if you need to."; },
        noEmergencyContacts: function () { return "You have no emergency contacts. Add them in Settings > Emergency Info."; },
        sosMessage: function (n, link) {
            return (n ? "I've called " + n + ". " : "I need help. ") + (link ? "I'm here: " + link : "I couldn't get my location.");
        },
        confirmSosText: function (names, text) { return "Text " + h.list(names) + ": “" + text + "”?"; },
        sosTexted: function (names) { return "Texted " + h.list(names) + " where you are."; }
    };

    return {
        // While one counts down, before help and undo (lang/en-everyday.js first).
        first: [["emergencyCancel", sosCancel], ["emergency", sosNow]],
        // First of all the rules ("call 911" is not the call command's read-back).
        rules: [["emergency", emergency], ["emergencyCancel", emergencyCancel], ["emergencyText", emergencyText]],
        say: say,
        MENTIONS: {
            emergency: /\b(911|112|999|emergency|sos|ambulance|police|cops|fire|paramedics)\b/,
            emergencyText: /\b(emergency|location|where)\b/
        },
        describe: function (command) {
            if (command === "emergency") return "call the emergency services";
            if (command === "emergencyText") return "text your emergency contacts where you are";
            if (command === "emergencyCancel") return "cancel the emergency call";
            return "";
        },
        help: { title: "Emergency", examples: ["Call 911", "Emergency", "Text my location to my emergency contacts"] }
    };
};
