// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The decision model between the grammar and the general model
// (docs/AI-AND-MCP.md "A decision model: Laya"): Convai Innovations' Laya
// (Apache-2.0, ModernBERT-large, 421M), which answers typed questions
// about a state ("which of these?", "yes or no?") with calibrated
// probabilities in one forward pass, writing no words. It decides:
//
//   - the kind of request (DOMAINS), then the command among that kind's
//     (two small choices: Laya is weak past some 20 options, its model card
//     says), and the arguments that are a choice (which switch, on or off,
//     up or down, today or tomorrow)
//   - whether the general model is needed: a question or chat (words), or a
//     command whose arguments are free words (a message, a title, a time:
//     the general model fills them, told which command)
//   - "not sure": below the threshold it decides nothing, and the router
//     goes on as if it were not there
//
// createLayaDecider({predict(state, questions) -> Promise<{answers}>,
//   threshold}) -> the router's deps.decider (assistant.js decide):
//   decide({text, history, last, commands, now}) -> Promise<{command, args,
//     confidence, escalate, needsArgs} | null>
// predict is Laya's own call shape (laya Agent.predict, laya-serve's
// /v1/systemone): lib/node-device.js runs the ONNX export on a device,
// tools/decider-laya.cjs a laya-serve for the evaluation.

"use strict";

// Kinds of request, each with what it covers (Laya reads these as the
// options' descriptions) and its commands.
var DOMAINS = {
    clock: { text: "alarms, waking up, snooze, timers, countdowns, the stopwatch",
             commands: ["alarm", "alarmList", "alarmManage", "timer", "timerStatus", "timerCancel", "stopwatch"] },
    lists: { text: "reminders, to-do tasks, shopping and grocery lists, notes and memos",
             commands: ["reminder", "task", "taskList", "taskDone", "note", "findNotes", "noteAppend"] },
    calendar: { text: "calendar events, meetings, appointments, what is on the schedule, being free or busy",
                commands: ["event", "agenda", "eventMove", "eventCancel", "freeTime"] },
    people: { text: "calling someone, text messages, email, voicemail, missed calls, contacts and their numbers",
              commands: ["call", "text", "readMessages", "replyMessage", "email", "readEmail", "searchEmail", "emailReply", "callBack", "callLog", "voicemail", "contactAdd", "contactInfo"] },
    device: { text: "switching wifi, bluetooth, airplane mode, the flashlight, do not disturb, location or rotation lock on or off; the volume; the screen brightness; the battery; storage; locking the phone; screenshots",
              commands: ["toggle", "settingStatus", "volume", "brightness", "battery", "storage", "lock", "screenshot", "settings"] },
    music: { text: "playing, pausing or skipping music, songs and albums", commands: ["play", "media"] },
    weather: { text: "the weather, temperature, rain, snow, the forecast", commands: ["weather"] },
    places: { text: "directions, navigation, places nearby, how far a place is, travel time", commands: ["navigate", "nearby", "distance", "travelTime"] },
    sums: { text: "arithmetic, percentages, tips, converting units or currencies", commands: ["calculate", "convert"] },
    time: { text: "what time or date it is, the time in another city", commands: ["time", "worldTime"] },
    apps: { text: "opening an app, a website or a settings page, searching the web, finding files or photos, the app store",
            commands: ["open", "search", "website", "appStore", "photos", "findFiles", "help"] },
    question: { text: "a question about the world, general knowledge, a recipe, advice or an explanation", commands: [] },
    chat: { text: "a greeting, thanks, small talk, a joke, chatting", commands: [] },
    other: { text: "something a phone cannot do: smart home devices, payments, ordering food, booking travel, cars", commands: [] }
};
// Arguments that are a choice, per command: [argument, instructions, {value: description}].
var CHOICES = {
    toggle: [["setting", "Which setting?", { wifi: "Wi-Fi, wireless internet", bluetooth: "Bluetooth", airplane: "airplane mode, flight mode",
                                              flashlight: "the flashlight, torch, a light", dnd: "do not disturb, silence calls", location: "location services, GPS",
                                              rotationLock: "rotation lock, stop the screen turning", hotspot: "the hotspot, sharing the internet" }],
             ["state", "Should it be turned on or off?", { on: "on, enable, start, I need it", off: "off, disable, stop, kill, I don't need it" }]],
    settingStatus: [["setting", "Which setting is asked about?", { wifi: "Wi-Fi", bluetooth: "Bluetooth", airplane: "airplane mode", flashlight: "the flashlight",
                                                                  dnd: "do not disturb", location: "location services", rotationLock: "rotation lock" }]],
    volume: [["action", "What should the volume do?", { up: "louder, up, raise", down: "quieter, down, lower", mute: "mute, silence", unmute: "unmute, sound back on" }]],
    brightness: [["action", "What should the screen do?", { up: "brighter, the screen is too dark", down: "dimmer, darker, the screen is too bright" }]],
    media: [["action", "What should the music do?", { pause: "pause, stop", play: "resume, play again", next: "skip, next song", prev: "back, previous song", status: "what song is playing" }]],
    agenda: [["range", "Which time is asked about?", { today: "today", tomorrow: "tomorrow", "this week": "this week", "next week": "next week", next: "the next event" }]],
    weather: [["day", "When?", { "": "now, today", tomorrow: "tomorrow", "this week": "this week", "this weekend": "this weekend" }]],
    callBack: [["which", "Who to call?", { back: "call back the last person who called", redial: "redial the last number called" }]],
    stopwatch: [["action", "What should the stopwatch do?", { start: "start", stop: "stop, pause", reset: "reset", status: "how long it has run" }]],
    time: [["what", "What is asked?", { time: "the time", date: "the date, the day" }]],
    voicemail: [["action", "What about voicemail?", { status: "whether there is voicemail", call: "call voicemail" }]],
    timerCancel: [], alarmList: [], timerStatus: [], taskList: [], readMessages: [], readEmail: [], callLog: [], battery: [], storage: [],
    lock: [], screenshot: [], play: [], help: []
};
var CHAT_LIKE = { question: true, chat: true };

function sorted(probs) {
    return Object.keys(probs || {}).map(function (k) { return [k, probs[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
}
function choiceOf(a) {
    var p = sorted(a && a.probabilities);
    return p.length ? { value: p[0][0], p: p[0][1] } : a && a.choice !== undefined ? { value: a.choice, p: a.confidence || 0 } : null;
}

function createLayaDecider(opts) {
    var predict = opts.predict, threshold = opts.threshold || 0.9;
    function state(input) {
        var s = { request: String(input.text || "") };
        var before = (input.history || []).slice(-3, -1).map(function (m) { return (m.role === "user" ? "user: " : "assistant: ") + m.text; });
        if (before.length) s.before = before.join(" | ");
        return s;
    }
    return {
        name: "Laya",
        threshold: threshold,
        DOMAINS: DOMAINS,
        decide: function (input) {
            var st = state(input), usable = {};
            (input.commands || []).forEach(function (c) { usable[c.id] = c; });
            var crit = {};
            Object.keys(DOMAINS).forEach(function (k) { crit[k] = DOMAINS[k].text; });
            return predict(st, { kind: { type: "choice", instructions: "What does the user want from their phone's assistant?", criteria: crit } }).then(function (r1) {
                var kind = choiceOf(r1.answers && r1.answers.kind);
                if (!kind) return null;
                if (CHAT_LIKE[kind.value]) return { command: "none", escalate: true, confidence: kind.p, kind: kind.value };
                if (kind.value === "other") return { command: "none", escalate: false, confidence: kind.p, kind: kind.value };
                var cmds = DOMAINS[kind.value].commands.filter(function (id) { return usable[id]; });
                if (!cmds.length) return null;
                // The command, and the arguments that are a choice for each
                // command it may be: one forward pass for all of them.
                var q = {};
                if (cmds.length > 1) {
                    var cc = {};
                    cmds.forEach(function (id) { cc[id] = String(usable[id].description || usable[id].title).split(/\.\s/)[0]; });
                    q.command = { type: "choice", instructions: "Which of these does the user ask for?", criteria: cc };
                }
                cmds.forEach(function (id) {
                    (CHOICES[id] || []).forEach(function (e) { q[id + "." + e[0]] = { type: "choice", instructions: e[1], criteria: e[2] }; });
                });
                return (Object.keys(q).length ? predict(st, q) : Promise.resolve({ answers: {} })).then(function (r2) {
                    var a = (r2 && r2.answers) || {};
                    var cmd = cmds.length > 1 ? choiceOf(a.command) : { value: cmds[0], p: 1 };
                    if (!cmd) return null;
                    var conf = Math.min(kind.p, cmd.p), args = {}, extra = CHOICES[cmd.value];
                    // Arguments that are free words: the general model fills them.
                    if (!extra) return { command: cmd.value, args: {}, confidence: conf, needsArgs: true, kind: kind.value };
                    extra.forEach(function (e) {
                        var c = choiceOf(a[cmd.value + "." + e[0]]);
                        if (c) { args[e[0]] = c.value; conf = Math.min(conf, c.p); }
                    });
                    return { command: cmd.value, args: args, confidence: conf, kind: kind.value };
                });
            });
        },
        // An answer to a read-back ("Send it?") the words do not say plainly ("go for it", "nah, leave it").
        yesNo: function (text, question) {
            return predict({ question: String(question || ""), answer: String(text || "") },
                           { agree: { type: "choice", instructions: "Does the answer agree to the question?", criteria: { yes: "yes, agrees, go ahead", no: "no, refuses, cancel", other: "neither: something else" } } })
                .then(function (r) {
                    var c = choiceOf(r.answers && r.answers.agree);
                    return c && c.value !== "other" && c.p >= threshold ? c.value : null;
                });
        }
    };
}

module.exports = { createLayaDecider: createLayaDecider, DOMAINS: DOMAINS, CHOICES: CHOICES };
