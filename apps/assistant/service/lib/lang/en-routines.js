// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// English for lib/commands-routines.js: running a routine by its phrase or
// name, listing them, turning one off or deleting it; the starters Settings
// offers ("Good night", "Good morning", off until added) and the steps its
// editor offers, as requests in words. h: lib/lang/en.js's helpers.

"use strict";

module.exports = function (h) {
    // A routine's phrase, as said ("good night"), or "run my good night routine".
    function routine(t, ctx) {
        var list = (ctx && ctx.routines) || [];
        if (!list.length) return null;
        var i, j;
        for (i = 0; i < list.length; ++i)
            for (j = 0; list[i].on !== false && j < (list[i].phrases || []).length; ++j)
                if (h.clean(list[i].phrases[j]) === t) return { name: list[i].name, id: list[i].id };
        var m = /^(?:run|start|do|begin|launch|activate|trigger|kick off|go|play) (?:my |the )?(.+?)(?: routine)?$/.exec(t) || /^(?:my |the )?(.+?) routine$/.exec(t);
        if (!m) return null;
        for (i = 0; i < list.length; ++i)
            if (h.clean(list[i].name) === m[1] || (list[i].phrases || []).some(function (p) { return h.clean(p) === m[1]; }))
                return { name: list[i].name, id: list[i].id };
        return null;
    }
    function routineList(t) {
        if (/^(?:make|create|add|set up|build|start|new)(?: me)? (?:a |my |another |one more )?(?:new )?routine\b.*$|^i (?:want|would like|'d like) (?:to (?:make|create|set up) )?a (?:new )?routine\b.*$/.test(t)) return { create: true };
        if (/^(?:what|which)(?: are)?(?: my| the)? routines(?: do i have| have i (?:got|set up|made))?$|^(?:list|show|tell)(?: me)? (?:all )?(?:my |the )?routines$|^(?:my )?routines$|^do i have any routines$/.test(t)) return { create: false };
        return null;
    }
    function routineManage(t) {
        var m = /^(turn off|disable|stop|pause|switch off|deactivate|turn on|enable|switch on|resume|reactivate|delete|remove|get rid of|erase|edit|change|update|modify|open) (?:my |the )?(.+?) routine$/.exec(t);
        if (!m) return null;
        var action = /^(?:delete|remove|get rid of|erase)$/.test(m[1]) ? "delete" : /^(?:turn on|enable|switch on|resume|reactivate)$/.test(m[1]) ? "on"
            : /^(?:edit|change|update|modify|open)$/.test(m[1]) ? "edit" : "off";
        return { name: m[2], action: action };
    }

    function sentence(s) { s = String(s || "").trim(); return /[.!?…]["”]?$/.test(s) ? s : s + "."; }
    function quoted(s) { return "“" + s + "”"; }
    var DAY = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

    var say = {
        // What each step said, together.
        routineRan: function (name, said) {
            if (!said.length) return "Your " + name + " routine has nothing in it yet.";
            return sentence(name) + " " + said.map(sentence).join(" ");
        },
        noRoutine: function (name) { return name ? "You don't have a routine called " + quoted(name) + "." : "You don't have that routine."; },
        routineIsOff: function (name) { return "Your " + name + " routine is off."; },
        turnRoutineOn: function () { return "Turn It On"; },
        routinesAre: function (list) {
            if (!list.length) return "You don't have any routines yet. You can make one in Settings, under Assistant.";
            return "You have " + (list.length === 1 ? "1 routine: " : list.length + " routines: ") +
                   h.list(list.map(function (r) { return r.name + (r.on ? "" : " (off)"); })) + ".";
        },
        routineMake: function () { return "Routines are made in Settings: give it a name, the words that start it, and what it does."; },
        routineDeleted: function (name) { return "Deleted your " + name + " routine."; },
        routineEdit: function (name) { return "Here's your " + name + " routine in Settings: change its words, its steps or when it runs."; },
        routineSwitched: function (name, on) { return on ? "Your " + name + " routine is on." : "Your " + name + " routine is off; it won't run until you turn it back on."; },
        confirmRoutineDelete: function (name) { return "Delete your " + name + " routine?"; },
        routineStepUnknown: function (text) { return "I couldn't do " + quoted(text) + "."; },
        routineStepOne: function (text) { return quoted(text) + " is more than one request: make each a step of its own."; },
        routineStepNotAllowed: function (text) { return quoted(text) + " can't be a routine's step."; },
        routineStepAsks: function (text) { return quoted(text) + " sends, calls or deletes, and that always asks first: it can't be a routine's step."; },
        routineStepNeedsMore: function (text, asked) { return quoted(text) + " needs more: " + (asked || "say all of it") + ""; },
        routineNeedsName: function () { return "A routine needs a name."; },
        routineNeedsSteps: function () { return "A routine needs at least one step."; },
        routineBadTime: function () { return "The time is a 24-hour time, “22:30”."; },
        routinePhraseTaken: function (phrase, other) { return quoted(phrase) + " already starts your " + other + " routine."; },
        routineDays: function (days) {
            if (!days || !days.length || days.length === 7) return "every day";
            var d = days.slice().sort().join(",");
            if (d === "1,2,3,4,5") return "on weekdays";
            if (d === "0,6") return "at weekends";
            return "on " + h.list(days.map(function (x) { return DAY[x]; }));
        }
    };

    return {
        rules: [["routine", routine], ["routineManage", routineManage], ["routineList", routineList]],
        say: say,
        MENTIONS: { routine: /\b(routine|good night|good morning|bedtime)\b/, routineManage: /\broutine\b/ },
        describe: function (command, args) {
            if (command === "routine") return "run your " + (args.name || "") + " routine";
            if (command === "routineManage") return (args.action === "delete" ? "delete" : args.action === "edit" ? "change" : "turn " + args.action) + " your " + (args.name || "") + " routine";
            return "";
        },
        help: { title: "Routines", examples: ["What routines do I have?", "Make a routine"] },
        lang: {
            // Settings > Assistant > Routines: starters (off until added) and
            // the steps it offers ({field}: filled in there, with its default).
            routineStarters: function () {
                return [
                    { starter: "goodnight", name: "Good night", phrases: ["good night", "bedtime"],
                      steps: [{ text: "turn on do not disturb" }, { text: "what alarms do I have" }, { text: "what's on my calendar tomorrow" }, { text: "lock the screen" }] },
                    { starter: "goodmorning", name: "Good morning", phrases: ["good morning"],
                      steps: [{ text: "turn off do not disturb" }, { text: "what's the weather today" }, { text: "what's on my calendar today" }, { text: "what did I miss" }] }
                ];
            },
            routineTemplates: function () {
                return [
                    { label: "Turn on Do Not Disturb", text: "turn on do not disturb" },
                    { label: "Turn off Do Not Disturb", text: "turn off do not disturb" },
                    { label: "Set an alarm", text: "set an alarm for {time}", fields: { time: "7am" } },
                    { label: "Tell me my alarms", text: "what alarms do I have" },
                    { label: "The weather", text: "what's the weather today" },
                    { label: "My calendar today", text: "what's on my calendar today" },
                    { label: "My calendar tomorrow", text: "what's on my calendar tomorrow" },
                    { label: "What I missed", text: "what did I miss" },
                    { label: "Turn Wi-Fi on", text: "turn on wifi" },
                    { label: "Turn Wi-Fi off", text: "turn off wifi" },
                    { label: "Turn Bluetooth on", text: "turn on bluetooth" },
                    { label: "Turn Bluetooth off", text: "turn off bluetooth" },
                    { label: "Set the brightness", text: "set brightness to {percent}%", fields: { percent: "30" } },
                    { label: "Set the volume", text: "set the volume to {percent}%", fields: { percent: "30" } },
                    { label: "Play music", text: "play {music}", fields: { music: "some music" } },
                    { label: "Open an app", text: "open {app}", fields: { app: "Calendar" } },
                    { label: "Turn on driving mode", text: "turn on driving mode" },
                    { label: "Lock the screen", text: "lock the screen" },
                    { label: "Something else you'd ask", text: "{request}", fields: { request: "" } }
                ];
            }
        }
    };
};
