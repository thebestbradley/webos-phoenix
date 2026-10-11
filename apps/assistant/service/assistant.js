// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant service, org.webosphoenix.assistant (docs/M6-PLAN.md
// F3). Each request goes down the layers in order:
//
//   1. speech to text: done before it gets here (the shell's dictation,
//      whisper.cpp; org.webosphoenix.dictation)
//   2. the command grammar (lib/grammar.js): instant, offline
//   3. the on-device model (llama.cpp, lib/models.js), when one is
//      installed and chosen: free-form answers, and it picks among the same
//      commands as tools
//   4. otherwise the assistant asks: "Ask <cloud model>" or "Search the web",
//      and "Connect model" while no cloud model is set up (the UI asks
//      which: on-device, cloud or both; connect takes it to Settings, and
//      retry asks the question again once one is there). Words nothing
//      understood get the commands they come close to ("Did you mean ...?")
//
// A thread the user took to a cloud model goes on with it. Cloud models may
// chat once a provider is set up; they get the commands as tools only when
// Settings > Assistant allows them to control the device
// (allowCloudControl, off by default), and a tool call from one is refused
// otherwise. Anything that sends, deletes or calls is read back and waits
// for confirm, whichever layer chose it.
//
// The same code runs on a device (service.js: run-js-service, Node's
// https, files) and in the simulator (runtime/phoenix-runtime.js block
// "Assistant": in the page, HTTP through the host's proxy, the shared store).
//
// createAssistantService(deps) -> methods, each (params) -> Promise<reply>:
//   ask {text, threadId?, newThread?, speak?, voice?, locked?}  -> {thread, messages}
//   vocabulary {} -> {words, prompt}: the wake phrase and contacts' names, and the transcriber's prompt
//     (voice: spoken, answered aloud with voiceReplies; locked: over the lock
//     screen, LOCKED_COMMANDS only; "yes" / "no" answer a read-back waiting)
//   choose {threadId, messageId, choice: "cloud:<id>" | "web" | "settings" | "open" | "connect"}
//     ("open": the app a command's answer offers, "Open Calendar"; "connect"
//     as connect without a mode)
//   connect {threadId?, messageId?, mode?: "local" | "cloud" | "both"}: Settings
//     > Assistant opens to set a model up (mode "": it asks which); the
//     question before messageId waits to be asked again
//   retry {threadId} -> {thread, messages}: that question asked again, of
//     the on-device model (first, unless mode was "cloud") or the cloud one
//   confirm {threadId, messageId, accept}
//   threads {} -> {threads, current}; thread {id?} -> {thread, messages}
//   newThread {} / setCurrent {id} / deleteThread {id} / clearHistory {}
//   getSettings {} / setSettings {...}
//   commands {} -> {commands: [{id, title, risk, enabled, builtIn}]}
//   providers {} -> {providers: [{id, type, name, model, baseUrl, hasKey, keyHint}], types}
//   setProvider {id?, type, name?, model?, baseUrl?, key?} / removeProvider {id}
//   testProvider {id | type, model, baseUrl, key} -> {ok, text | error}
//   listModels {id | ...} -> {models}
//   models {} -> {models: [catalogue + installed, fits, recommended], status, selected}
//   downloadModel {id} / cancelDownload {id} / removeModel {id} / selectModel {id}
//   speak {text} / stopSpeaking {}
//   voice {} -> {parts: [{id: "recognition" | "wakeWord" | "speech", name,
//     available, engine, howToInstall}]}: what the voice needs and whether
//     this device has it, with a one-line hint for what is missing
//     (deps.voice; Settings > Assistant shows it)
//   Follow-up questions (lib/followups.js; docs/AI-AND-MCP.md): after a command
//   made something, a message {followUp: {id, kind}, choices: [{id: "fu:<n>" |
//   "fu:skip", label}]} asks for a missing detail; choose answers it, and so
//   do the next words (ask) when they read as an answer.
//   followUps {} -> {followUps: [{id, kind, question, item, state, attempts, nextAt, choices}], muted: [kinds]}
//   answerFollowUp {id, action: "fu:<n>" | "fu:skip"} -> {text}: a notification's button
//   followUpOpen {id} -> {thread, messages}: a notification tapped, asked again in its conversation
//   followUpLeave {threadId?}: the assistant closed, its open question waits for later
//   followUpWake {at?}: the activity manager's call (at: the time to act as, system UI and tests only)
//   resetFollowUps {}: ask every kind again
//
// deps: {luna: {call(uri, params) -> Promise<reply>}, request(req) ->
//   Promise<{status, headers, body}>, storage: {get, set, remove, keys(prefix)}
//   (synchronous, one key per thread, message and provider), secrets:
//   {seal(text) -> Promise<sealed>, unseal(sealed) -> Promise<text>},
//   llm (the on-device model runner: status(), download(model), cancel(id),
//   remove(id), ensure(model) -> Promise<{baseUrl}>), tts: {speak(text,
//   lang, voice), stop()}, voice() -> parts as voice answers them (optional), caller() -> app id, now() -> ms, changed(what), log,
//   notify(n) (a notification: lib/followups.js), units() -> "metric" |
//   "imperial", the device's (lib/region.js; optional, else locale())}

"use strict";

var grammar = require("./lib/grammar");
var region = require("./lib/region");
var commands = require("./lib/commands");
var providers = require("./lib/providers");
var models = require("./lib/models");
var followups = require("./lib/followups");

var SERVICE = "org.webosphoenix.assistant";
var SETTINGS_APP = "org.webosphoenix.settings";
var SYSTEM_UI = "com.palm.systemui";
var ASSISTANT_APP = "org.webosphoenix.assistant";

var ERRORS = { BAD_PARAMS: -1, NOT_FOUND: -2, NOT_ALLOWED: -3, OFF: -4, FAILED: -5 };

var DEFAULTS = {
    enabled: true,              // the assistant at all (on by default: docs/AI-AND-MCP.md, 28 September)
    speak: false,               // answers to typed requests spoken too (on-device text to speech); spoken ones: voiceReplies
    language: "en",
    units: "auto",              // weather: "metric", "imperial", or from the language
    localModel: "",             // the chosen on-device model (lib/models.js id); "" the built-in one, "off" none
    speechVoice: "",            // the voice answers are spoken with (Kitten's, expr-voice-3-f ...), "" its default
    speechRate: 1,              // how fast it speaks (RATE_CHOICES: 0.8 slower ... 1.3 faster)
    personality: "friendly",    // how it talks (PERSONALITIES; its words in a voice session, lib/lang say.checkIn)
    voiceWait: 45,              // a spoken conversation stays open this many seconds after an answer (WAIT_CHOICES)
    defaultProvider: "",        // the cloud provider "Ask ..." offers
    allowCloudControl: false,   // cloud models may run commands
    voiceReplies: true,         // answers to spoken requests spoken (ask {voice})
    wakeWord: false,            // the shell listens for "Hey Phoenix" (docs/AI-AND-MCP.md, Voice)
    wakeWhenLocked: false,      // ... also while the screen is off or locked
    disabledCommands: [],       // command ids the assistant must not run
    followUps: true,            // questions after something is made (lib/followups.js)
    quietStart: "22:00",        // ... never asked later, in a notification, between these
    quietEnd: "08:00",
    followUpFirst: 60,          // ... a question left unanswered comes back this many minutes later
    followUpAgain: 240,         // ... and once more this many after that (0: not again)
    followUpTopicsOff: []       // follow-up topics turned off (Settings, or "Stop asking"): lib/followups.js KINDS
};
var HISTORY = 20;               // turns a model sees
var CALL_TOKENS = 160;          // the most a call of a command may say (its arguments)
// The on-device model's context is 4,096 tokens (lib/node-device.js): the
// shared prompt takes some 1,400, a tool 250 and the answer up to 512, so
// the conversation it sees is held to about 1,500 tokens (some 3.5
// characters each), the latest turns.
var LOCAL_HISTORY_CHARS = 5000;
// The on-device model's whole answer (starting it, choosing a command,
// calling it) within this; askLocal says why.
var LOCAL_DEADLINE_MS = 75000;
// What a request asked by voice over the lock screen (ask {locked}) may do:
// nothing that shows what is private, sends, or opens an app.
var LOCKED_COMMANDS = ["timer", "timerStatus", "timerCancel", "stopwatch", "alarm", "alarmList", "toggle", "media", "volume",
                       "brightness", "lock", "battery", "weather", "convert", "worldTime", "calculate", "time"];

// kind "fallback": layer 4's "nothing here can" (offer), never shown to a
// model as something the assistant said (history), so it is not copied.
var MESSAGE_FIELDS = ["id", "threadId", "role", "text", "time", "via", "source", "command", "status", "confirm", "choices", "chosen", "data", "followUp", "kind", "trace"];
var HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
// Settings > Assistant > First and Second follow-up (minutes): the reminder
// brackets offered (the owner's choice, 9 October 2026).
var FIRST_CHOICES = [15, 60, 180];
// Settings > Assistant > Speaking speed, Personality, Keep listening
// (the owner, 10 October 2026: "it shouldn't close so fast, it should wait
// 30-60 seconds", and the wait a setting).
var RATE_CHOICES = [0.8, 0.9, 1, 1.15, 1.3];
var WAIT_CHOICES = [15, 30, 45, 60, 90, 120];
// What each personality adds to what a model is told.
var PERSONALITIES = {
    friendly: "Be friendly and warm.",
    cheerful: "Be upbeat and cheerful, with a little enthusiasm.",
    calm: "Be calm, gentle and unhurried, and keep answers especially short.",
    professional: "Be precise and businesslike; no jokes or small talk unless asked.",
    playful: "Be playful and witty, with light humour, while still answering correctly."
};
var AGAIN_CHOICES = [0, 60, 240, 1440];
// Follow-up answers read even when the words could be a command too ("in
// an hour", "every day"); the others (a place, a label, a list, names)
// only when they are not one.
var STRICT_ANSWERS = ["duration", "alert", "due", "repeat", "email", "phone", "doubt"];
// Every follow-up topic (lib/followups.js KINDS), for followUpTopicsOff.
var TOPICS = ["location", "invitees", "duration", "alert", "due", "list", "repeat", "label", "email", "phone"];

function ok(o) { var r = { returnValue: true }; for (var k in o) r[k] = o[k]; return r; }
function fail(code, text) { return { returnValue: false, errorCode: code, errorText: text }; }

function createAssistantService(deps) {
    var storage = deps.storage;
    var now = deps.now || function () { return Date.now(); };
    var log = deps.log || function () {};
    var changed = deps.changed || function () {};
    var caller = deps.caller || function () { return ""; };
    var seq = 0;
    var lockedAsk = {};         // thread id -> a locked request is being answered

    // ---- Settings ----------------------------------------------------------------------------
    function settings() {
        var s = storage.get("assistant:settings") || {}, out = {};
        for (var k in DEFAULTS) out[k] = k in s ? s[k] : DEFAULTS[k];
        ["enabled", "speak", "allowCloudControl", "voiceReplies", "wakeWord", "wakeWhenLocked", "followUps"].forEach(function (b) { out[b] = !!out[b]; });
        if (!HHMM.test(out.quietStart)) out.quietStart = DEFAULTS.quietStart;
        if (!HHMM.test(out.quietEnd)) out.quietEnd = DEFAULTS.quietEnd;
        if (FIRST_CHOICES.indexOf(out.followUpFirst) < 0) out.followUpFirst = DEFAULTS.followUpFirst;
        if (AGAIN_CHOICES.indexOf(out.followUpAgain) < 0) out.followUpAgain = DEFAULTS.followUpAgain;
        out.followUpTopicsOff = Array.isArray(out.followUpTopicsOff) ? out.followUpTopicsOff.filter(function (k) { return TOPICS.indexOf(k) >= 0; }) : [];
        out.disabledCommands = Array.isArray(out.disabledCommands) ? out.disabledCommands.filter(function (x) { return typeof x === "string"; }) : [];
        if (["metric", "imperial", "auto"].indexOf(out.units) < 0) out.units = "auto";
        if (RATE_CHOICES.indexOf(out.speechRate) < 0) out.speechRate = DEFAULTS.speechRate;
        if (!PERSONALITIES[out.personality]) out.personality = DEFAULTS.personality;
        if (WAIT_CHOICES.indexOf(out.voiceWait) < 0) out.voiceWait = DEFAULTS.voiceWait;
        return out;
    }
    function lang() { return grammar.language(settings().language); }
    function units() {
        var u = settings().units;
        if (u !== "auto") return u;
        // The device's one setting, as every app reads it (lib/region.js:
        // Settings > Language & Region > Units, "auto" by the region).
        if (deps.units) return deps.units();
        return region.systemFor("auto", String(deps.locale ? deps.locale() : "en-US"));
    }

    // ---- Threads and messages (one key each) ---------------------------------------------------
    function newId() {
        var t = now().toString(36);
        return ("00000000000" + t).slice(-11) + "-" + ("000" + (seq++ % 46656).toString(36)).slice(-3) + Math.random().toString(36).slice(2, 6);
    }
    function threadKey(id) { return "assistant:thread:" + id; }
    function msgPrefix(tid) { return "assistant:msg:" + tid + ":"; }
    function getThread(id) {
        var t = id ? storage.get(threadKey(id)) : null;
        return t && t.id === id ? t : null;
    }
    function putThread(t) { storage.set(threadKey(t.id), t); }
    function messagesOf(tid) {
        return storage.keys(msgPrefix(tid)).map(function (k) { return storage.get(k); })
            .filter(function (m) { return m && m.id; })
            .sort(function (a, b) { return a.time - b.time || (a.id < b.id ? -1 : 1); });
    }
    function putMessage(m) {
        var o = {};
        MESSAGE_FIELDS.forEach(function (f) { if (m[f] !== undefined) o[f] = m[f]; });
        storage.set(msgPrefix(m.threadId) + m.id, o);
        return o;
    }
    function getMessage(tid, mid) { return storage.get(msgPrefix(tid) + mid); }
    function allThreads() {
        return storage.keys("assistant:thread:").map(function (k) { return storage.get(k); })
            .filter(function (t) { return t && t.id; })
            .sort(function (a, b) { return (b.updated || 0) - (a.updated || 0) || (a.id < b.id ? 1 : -1); });
    }
    function createThread() {
        var t = { id: newId(), title: "", created: now(), updated: now(), provider: "" };
        putThread(t);
        storage.set("assistant:current", t.id);
        return t;
    }
    function currentThread() {
        var id = storage.get("assistant:current");
        return getThread(id);
    }
    function deleteThread(id) {
        storage.keys(msgPrefix(id)).forEach(function (k) { storage.remove(k); });
        storage.remove(threadKey(id));
        if (storage.get("assistant:current") === id) storage.remove("assistant:current");
    }
    function summary(t) {
        var msgs = messagesOf(t.id), last = msgs[msgs.length - 1];
        var out = { id: t.id, title: t.title || (msgs[0] ? msgs[0].text : ""), created: t.created, updated: t.updated,
                    provider: t.provider || "", count: msgs.length, last: last ? last.text : "", unread: t.unread || 0 };
        // The on-device model at work on it: {stage: "starting" | "thinking", since, until} (ms).
        if (t.working) out.working = t.working;
        return out;
    }

    // ---- What answered, and how long it took (message trace) ----------------------------------
    // Each answer carries {path: "grammar" | "on-device" | "cloud" |
    // "fallback" | "follow-up", command, args (as the command was given
    // them), steps: [{step: "pick" | "call" | "answer" | "fill" | "compose",
    // ms, tokens?, choice?}], ms (since the words arrived)}: the
    // evaluation (tools/eval-assistant.cjs) reads it, and the app's Export
    // Conversation saves it. Wall-clock time, not deps.now (a test's clock).
    var turns = {};
    function turnOf(thread) { return thread && turns[thread.id]; }
    function startTurn(thread) { turns[thread.id] = { start: Date.now(), steps: [], args: null, command: "" }; }
    function endTurn(thread) { delete turns[thread.id]; }
    function noteArgs(thread, command, args) {
        var t = turnOf(thread);
        if (t) { t.command = command; t.args = args; }
    }
    // A model request's time, from llama-server's timings when it gives them.
    function noteStep(thread, step, t0, body, extra) {
        var t = turnOf(thread);
        if (!t) return;
        var o = { step: step, ms: Date.now() - t0 };
        try { var tm = JSON.parse(body || "{}").timings; if (tm && tm.predicted_n !== undefined) o.tokens = tm.predicted_n; } catch (e) { /* not JSON */ }
        t.steps.push(Object.assign(o, extra || {}));
    }
    function plainArgs(args) {
        try { return JSON.parse(JSON.stringify(args || {})); } catch (e) { return {}; }
    }
    function traced(thread, m) {
        var t = turnOf(thread);
        if (!t) return undefined;
        var path = m.kind === "fallback" ? "fallback" : m.followUp ? "follow-up" : m.via === "commands" || !m.via ? "grammar" : m.via;
        var out = { path: path, ms: Date.now() - t.start };
        if (m.command) {
            out.command = m.command;
            if (t.command === m.command && t.args) out.args = plainArgs(t.args);
        }
        if (t.steps.length) out.steps = t.steps.slice();
        return out;
    }

    function say(thread, text, extra) {
        var m = Object.assign({ id: newId(), threadId: thread.id, role: "assistant", text: text, time: now() }, extra || {});
        if (m.role === "assistant" && !m.trace) m.trace = traced(thread, m);
        thread.updated = m.time;
        putThread(thread);
        return putMessage(m);
    }

    // ---- Providers ---------------------------------------------------------------------------
    function providerKey(id) { return "assistant:provider:" + id; }
    function allProviders() {
        return storage.keys("assistant:provider:").map(function (k) { return storage.get(k); })
            .filter(function (p) { return p && p.id && providers.TYPES[p.type]; })
            .sort(function (a, b) { return (a.created || 0) - (b.created || 0); });
    }
    function getProvider(id) { var p = id ? storage.get(providerKey(id)) : null; return p && p.id === id ? p : null; }
    function shown(p) {
        return { id: p.id, type: p.type, name: p.name || providers.TYPES[p.type].label, model: p.model || "", baseUrl: p.baseUrl || "",
                 hasKey: !!p.keyEnc, keyHint: p.keyHint || "", label: providers.displayName(p) };
    }
    function keyOf(p) { return p && p.keyEnc ? deps.secrets.unseal(p.keyEnc) : Promise.resolve(""); }
    function defaultProvider() {
        var s = settings(), p = getProvider(s.defaultProvider);
        return p || allProviders()[0] || null;
    }

    // ---- Commands ----------------------------------------------------------------------------
    var appsCache = null, appsAt = 0;
    function apps() {
        if (appsCache && now() - appsAt < 30000) return Promise.resolve(appsCache);
        return deps.luna.call("luna://com.palm.applicationManager/listLaunchPoints", {}).then(function (r) {
            var list = (r && r.launchPoints) || [];
            appsCache = list.filter(function (a) { return a && a.title && (a.id || a.appId); }).map(function (a) {
                return { id: a.id || a.appId, title: a.title, keywords: a.keywords || [], assistant: a.assistant,
                         universalSearch: a.universalSearch, params: a.params || null };
            });
            appsAt = now();
            return appsCache;
        }, function () { return []; });
    }
    function catalogue() {
        return apps().then(function (list) {
            // Not the Assistant's own Just Type Quick Action ("Ask Assistant
            // {text}"): a model chose it for "Talk to me." three times, the
            // assistant asking itself (the owner's logs, 10 October 2026).
            var compiled = grammar.compileAppCommands(list.filter(function (a) { return a.id !== ASSISTANT_APP; }), settings().language);
            return { all: commands.catalogue(compiled), compiled: compiled, apps: list };
        });
    }
    function allowed(cmd) { return settings().disabledCommands.indexOf(cmd.id) < 0; }
    function env() {
        return { luna: deps.luna, request: deps.request, now: now, lang: lang(), units: units(), storage: storage,
                 apps: apps };
    }
    var followUps = followups.create({ storage: storage, now: now, env: env, settings: settings, log: log, changed: changed,
                                       notify: deps.notify || function () {},
                                       // "Stop asking": the topic off, as Settings would turn it off.
                                       stopTopic: function (kind) {
                                           var cur = storage.get("assistant:settings") || {};
                                           var off = Array.isArray(cur.followUpTopicsOff) ? cur.followUpTopicsOff : [];
                                           if (off.indexOf(kind) < 0) cur.followUpTopicsOff = off.concat([kind]);
                                           storage.set("assistant:settings", cur);
                                           changed("settings");
                                       },
                                       // A question sent later: said in its conversation, unread there.
                                       delivered: function (q, text, choices) {
                                           var thread = getThread(q.threadId);
                                           if (!thread) return "";
                                           var old = q.messageId ? getMessage(thread.id, q.messageId) : null;
                                           var msgs = messagesOf(thread.id), latest = msgs[msgs.length - 1];
                                           // Said already for this try (another copy of the service sent it): not again.
                                           var same = msgs.filter(function (x) { return x.followUp && x.followUp.id === q.id && x.followUp.attempt === q.attempts; })[0];
                                           if (same) return same.id;
                                           var m;
                                           // Still the last word there: it stands, and waits unread.
                                           if (old && !old.chosen && latest && latest.id === old.id) {
                                               m = old;
                                               m.choices = choices;   // the notification's (times as they are now)
                                               putMessage(m);
                                           }
                                           else {
                                               if (old && !old.chosen) { old.chosen = "later"; putMessage(old); }
                                               var command = { event: "event", reminder: "reminder", task: "task", alarm: "alarm", contact: "contactAdd" }[q.item.type];
                                               m = say(thread, text, { via: "commands", command: command, followUp: { id: q.id, kind: q.meta ? "doubt" : q.kind, attempt: q.attempts }, choices: choices });
                                           }
                                           thread = getThread(thread.id);
                                           thread.unread = (thread.unread || 0) + 1;
                                           putThread(thread);
                                           changed("threads");
                                           return m.id;
                                       } });

    // ---- Doing a command ---------------------------------------------------------------------
    // layer: "commands", "on-device" or "cloud"; source: who chose it.
    // asked: the words a model chose this from (a model's choice they do not
    // ground is read back first: lang grounded()).
    // The one item an answer showed ({kind, id, title}) is what "it" means next.
    // The command the last turn did or asked about: what "make it 8
    // instead", "and tomorrow?" or "turn it off" lean on (lang followOn).
    function keepLast(thread, last) {
        var t = getThread(thread.id);
        if (!t) return;
        last.at = now();
        t.last = last;
        thread.last = last;
        putThread(t);
    }
    // The words a model gave a command to work on, said by the user: a
    // task's, memo's, reminder's or event's text, a contact's name.
    function argsSaid(id, args, asked) {
        var key = { task: "text", note: "text", reminder: "text", event: "title", contactAdd: "name", noteAppend: "text" }[id];
        if (!key || !args || !args[key]) return true;
        return grounded(args[key], asked);
    }
    function keepFocus(thread, focus) {
        var t = getThread(thread.id);
        if (!t) return;
        t.focus = focus;
        thread.focus = focus;
        putThread(t);
    }
    function act(thread, cmd, args, layer, source, asked) {
        var e = env(), s = lang().say;
        // "it": the item the conversation is about (lib/details.js).
        e.focus = thread.focus || null;
        // Asked by voice over the lock screen: only what shows nothing
        // private and sends nothing; the rest waits for the unlock.
        if (lockedAsk[thread.id] && LOCKED_COMMANDS.indexOf(cmd.id) < 0)
            return Promise.resolve([say(thread, s.unlockFirst(), { via: layer, source: source, command: cmd.id, status: "locked" })]);
        if (!allowed(cmd)) return Promise.resolve([say(thread, s.notAllowed(cmd.title), { via: layer, source: source, command: cmd.id, status: "failed" })]);
        noteArgs(thread, cmd.id, args);
        // A model's choice for words that say not to ("don't turn on wifi"): never done.
        if (asked !== undefined && cmd.risk !== "read" && lang().negation && lang().negation(lang().clean(asked)))
            return Promise.resolve([say(thread, s.wontDo ? s.wontDo("") : s.cancelled(), { via: layer, source: source })]);
        return commands.prepare(cmd, args, e).then(function (p) {
            noteArgs(thread, cmd.id, p.args || args);
            // Something is missing: asked for, and the next words fill it (route()).
            if (p.awaiting) {
                keepLast(thread, { command: cmd.id, args: plainArgs(p.args || args), status: "ask" });
                var ch = (p.awaiting.options || []).map(function (o, i) { return { id: "pick:" + i, label: o }; });
                return [say(thread, p.reply, Object.assign({ via: layer, source: source, command: cmd.id, status: "ask", data: { awaiting: p.awaiting } },
                                                           ch.length ? { choices: ch } : {}))];
            }
            if (p.reply) return [say(thread, p.reply, { via: layer, source: source, command: cmd.id, status: "failed" })];
            var confirm = p.confirm;
            // A model's choice runs only when the words name it and what it
            // works on (a task's, memo's or event's words are in what was said):
            // otherwise it is read back first (the 0.6B model made "book a
            // flight to new york" an event, and "lock the front door" locked
            // the screen: docs/AI-AND-MCP.md "Evaluation").
            if (!confirm && asked !== undefined && cmd.builtIn && cmd.risk !== "read" && (!lang().grounded(cmd.id, p.args, asked) || !argsSaid(cmd.id, p.args, asked)))
                confirm = s.didYouMean(s.describe(cmd.id, p.args, cmd.title));
            if (confirm) {
                keepLast(thread, { command: cmd.id, args: plainArgs(p.args), status: "pending", name: p.args && p.args.name || "" });
                return [say(thread, confirm, { via: layer, source: source, command: cmd.id, status: "pending",
                                               confirm: { command: cmd.id, args: p.args } })];
            }
            return commands.run(cmd, p.args, e).then(function (r) {
                if (r.focus) keepFocus(thread, r.focus);
                if (!r.failed && !r.offerWeb) keepLast(thread, { command: cmd.id, args: plainArgs(p.args), status: "done", made: !!r.undo, name: p.args && p.args.name || "" });
                return withFollowUp(thread, cmd, p.args, r, [say(thread, r.text, outcome(r, layer, source, cmd))]);
            });
        }).catch(function (err) {
            log("command " + cmd.id + " failed: " + (err && err.message));
            return [say(thread, s.failed(err && err.message || String(err)), { via: layer, source: source, command: cmd.id, status: "failed" })];
        });
    }

    // ---- Follow-up questions (lib/followups.js) ----------------------------------------------
    // Something was made: the first question about it after the answer
    // (not over the lock screen).
    function withFollowUp(thread, cmd, args, r, out) {
        if (lockedAsk[thread.id]) return Promise.resolve(out);
        return followUps.afterCreate(cmd.id, args, r.data, thread.id).then(function (q) {
            if (q) out.push(askFollowUp(thread, q, cmd.id));
            return out;
        });
    }
    function askFollowUp(thread, q, command) {
        var m = say(thread, q.text, { via: "commands", command: command, followUp: { id: q.id, kind: q.meta ? "doubt" : q.kind }, choices: q.choices });
        followUps.attach(q.id, thread.id, m.id);
        return m;
    }
    // The question waiting in this conversation, if its message is the last
    // thing the assistant said.
    function openFollowUp(thread) {
        var msgs = messagesOf(thread.id);
        for (var i = msgs.length - 1; i >= 0; --i) {
            var m = msgs[i];
            if (m.role !== "assistant") continue;
            return m.followUp && !m.chosen && followUps.answerable(m.followUp.id) ? m : null;
        }
        return null;
    }
    // An answer to question message m (input: {choice} or {text, parsed}):
    // what changed, said back, and the next question.
    function answerFollowUp(thread, m, input) {
        return followUps.answer(m.followUp.id, input, true).then(function (out) {
            if (!out) return [];
            if (!m.chosen) { m.chosen = input.choice || "said"; putMessage(m); }
            // Not understood ("I couldn't find Gandalf"): still asked, with its answers.
            if (out.retry) {
                var again = say(thread, out.text, { via: "commands", command: m.command, status: "failed", followUp: m.followUp, choices: m.choices });
                followUps.attach(m.followUp.id, thread.id, again.id);
                return [again];
            }
            var list = [say(thread, out.text, { via: "commands", command: m.command, status: out.skipped || out.dropped ? "cancelled" : "done" })];
            if (out.next) list.push(askFollowUp(thread, out.next, m.command));
            return list;
        });
    }

    // A command's answer as a message: done, with the app it offers ("Open
    // Calendar", choice "open"), what takes it back (undo), and other things
    // to do next (r.actions: [{label, open: {appId, params, title}} | {label,
    // run: {command, args, then?}}], choices "open:<n>" and "do:<n>"; e.g.
    // "Turn On Location Services", then the weather asked again).
    function outcome(r, layer, source, cmd) {
        var data = r.data ? Object.assign({}, r.data) : {}, extra = {};
        if (r.open) data.open = r.open;
        if (r.undo) data.undo = r.undo;
        var choices = [];
        (r.actions || []).forEach(function (a, i) {
            choices.push({ id: (a.open ? "open:" : "do:") + i, label: a.label });
        });
        if (r.actions && r.actions.length) data.actions = r.actions;
        // What it found, shown in the conversation (pictures, cards); each
        // item's open is the app on it (choice "show:<n>", n across them all).
        if (r.attachments && r.attachments.length) data.attachments = r.attachments;
        if (r.open) choices.push({ id: "open", label: lang().say.openApp(r.open.title) });
        if (r.offerWeb) choices.push({ id: "web", label: lang().say.searchWeb() });
        if (choices.length) extra.choices = choices;
        return Object.assign({ via: layer, source: source, command: cmd.id, status: r.offerWeb || r.failed ? "failed" : "done",
                               data: Object.keys(data).length ? data : undefined }, extra);
    }
    // The last thing the assistant did that can be taken back.
    function lastUndoable(thread) {
        var msgs = messagesOf(thread.id);
        for (var i = msgs.length - 1; i >= 0; --i) {
            var m = msgs[i];
            if (m.role === "assistant" && m.status === "done" && m.data && m.data.undo && !m.data.undone) return m;
        }
        return null;
    }
    function lastPending(thread) {
        var msgs = messagesOf(thread.id);
        for (var i = msgs.length - 1; i >= 0; --i) {
            if (msgs[i].role === "assistant" && msgs[i].status === "pending" && msgs[i].confirm) return msgs[i];
            if (msgs[i].role === "assistant" && msgs[i].status) return null;
        }
        return null;
    }
    // "Undo", "cancel that": a read-back waiting is cancelled; else what was
    // just made is read back, and taken back on Yes.
    function undoLast(thread, cat, args) {
        var s = lang().say, pend = lastPending(thread);
        if (pend && args.pending !== undefined) {
            pend.status = "cancelled";
            putMessage(pend);
            return Promise.resolve([say(thread, s.cancelled(), { via: "commands", command: pend.command, status: "cancelled" })]);
        }
        var m = lastUndoable(thread);
        // "Never mind" with nothing waiting and nothing made: fine.
        if (!m && args.pending) return Promise.resolve([say(thread, s.chat ? s.chat("ok", 0) : s.cancelled(), { via: "commands" })]);
        return act(thread, commands.find(cat.all, "undo"), m ? { undo: m.data.undo, messageId: m.id } : {}, "commands", "");
    }
    // An action's command ({command, args, then?}), as if asked: its
    // permission and read-back as any; then the request it unblocked
    // ("then": the weather once location is allowed) when it went through.
    function runAction(thread, cat, run) {
        var cmd = run && commands.find(cat.all, run.command);
        if (!cmd) return Promise.resolve([say(thread, lang().say.failed("unknown command"), { via: "commands", status: "failed" })]);
        return act(thread, cmd, run.args || {}, "commands", "").then(function (out) {
            var last = out[out.length - 1];
            if (!run.then || !last || last.status !== "done") return out;
            return runAction(thread, cat, run.then).then(function (more) { return out.concat(more); });
        });
    }
    // The question the assistant's last word asks (a command's data.awaiting):
    // "When is it?", "What time is the meeting?", "Which one: Chris Park or
    // Chris Moore?", "What should I say to Sam?", "What should the memo say?".
    function lastAwaiting(thread) {
        var msgs = messagesOf(thread.id);
        for (var i = msgs.length - 1; i >= 0; --i) {
            if (msgs[i].role !== "assistant") continue;
            var w = msgs[i].data && msgs[i].data.awaiting;
            return w && !msgs[i].chosen ? { w: w, message: msgs[i] } : null;
        }
        return null;
    }
    // Which of the options the words mean: a name ("Chris Park", "Moore"),
    // or a place in the list ("the second one", "2"). -1: none.
    function pickOf(options, text) {
        var t = lang().clean(text).replace(/^(?:the |call |text |email |it's |its |i mean |i meant )/, "").replace(/ (?:one|please)$/, "").trim();
        var ord = { first: 0, "1st": 0, one: 0, "1": 0, second: 1, "2nd": 1, two: 1, "2": 1, third: 2, "3rd": 2, three: 2, "3": 2, fourth: 3, "4th": 3, four: 3, "4": 3, last: options.length - 1 };
        if (ord[t] !== undefined && ord[t] < options.length) return ord[t];
        for (var i = 0; i < options.length; ++i) if (String(options[i]).toLowerCase() === t) return i;
        var hits = options.map(function (o, i) { return String(o).toLowerCase().split(/\s+/).indexOf(t) >= 0 ? i : -1; }).filter(function (i) { return i >= 0; });
        return hits.length === 1 ? hits[0] : -1;
    }
    function fillAwaiting(thread, text, cat, parsed) {
        var a = lastAwaiting(thread);
        if (!a) return null;
        var w = a.w, l = lang(), t = l.clean(text);
        var done = function (args) { a.message.chosen = "said"; putMessage(a.message); return act(thread, commands.find(cat.all, w.command), args, "commands", ""); };
        if (w.options && w.field) {
            var n = pickOf(w.options, text);
            if (n < 0) return null;
            var picked = {};
            picked[w.field] = w.options[n];
            return done(Object.assign({}, w.args, picked));
        }
        // Free words (what to say, what the memo says): taken unless they are a request of their own.
        if (w.field === "message" || w.field === "text") {
            if (parsed && l.startsCommand && l.startsCommand(t)) return null;
            if (!t || (l.negation && l.negation(t)) || (l.answer && l.answer(t) === "no")) return null;
            var words = String(text).trim().replace(/[.!]+$/, "");
            var filled = {};
            filled[w.field] = w.command === "note" && w.args.topic ? w.args.topic + "\n" + words : words.charAt(0).toUpperCase() + words.slice(1);
            return done(Object.assign({}, w.args, filled));
        }
        if (w.command !== "event" || parsed) return null;
        var info = l.extract(t, now());
        if (info.rest.replace(/\b(?:at|on|for|the|it's|it is|its)\b/g, "").trim()) return null;
        // "What time is the meeting?" after "add a meeting tomorrow": that day.
        if (w.args.day && info.day === undefined && info.weekend === undefined && !info.week) info.day = w.args.day;
        var r = l.resolve(info, now(), "day");
        if (r.start === null) return null;
        var args = Object.assign({}, w.args, { start: r.start, end: r.end, allDay: r.allDay, repeat: r.repeat || w.args.repeat || null });
        delete args.day;
        return done(args);
    }

    // ---- Language models (layers 3 and 4) -------------------------------------------------------
    // What a model is told. It answers what it can in words: facts, how-tos,
    // recipes, advice, small talk; the phone's commands are tools for
    // what the user asks the phone to do. (The owner's report, 9 October
    // 2026: "You can't do that on the phone" was a model copying the
    // grammar's old refusal and this prompt's "one to three sentences".)
    // The personality chosen in Settings sets its tone (PERSONALITIES).
    function persona() {
        return "You are Assistant, the helpful assistant on a webOS Phoenix phone. " + PERSONALITIES[settings().personality] + " " +
            "Answer questions directly and accurately: facts, explanations, how-tos, recipes, advice, small talk and jokes. " +
            "Be concise, since answers may be read aloud, but give every step when steps are needed (a short numbered list is fine). " +
            "Write plain text without markdown headings or bold. If you are not sure of something, say so briefly.";
    }
    // What changes from request to request (the time, whether it has
    // tools): after the persona for a cloud model, in its own message after
    // the shared prefix for the on-device one (localPrefix).
    function nowText() { return "Today is " + new Date(now()).toDateString() + ", the time is " + lang().timeText(now()) + "."; }
    function promptTail(withTools) {
        return nowText() +
            (withTools ? " You can also control the device with the tools you are given. Call a tool only when the user asks the phone " +
             "to do the very thing the tool does (\"turn on the flashlight\" calls toggle with flashlight on); call at most one. " +
             "Never call a tool for a question you can answer in words."
                       : " In this conversation you cannot operate the phone; if asked to, say which app or setting does it.");
    }
    function systemPrompt(withTools) { return persona() + " " + promptTail(withTools); }
    // The conversation as a model sees it: not the "nothing here can"
    // fallbacks (kind "fallback") nor follow-up questions left unanswered.
    // It ends with the user's words: when the same words were asked twice
    // and the first answer was saved before the second was asked, a request
    // ending with an answer made llama-server take it as the start of its
    // reply, which a JSON schema's grammar refuses ("HTTP 400: Failed to
    // initialize samplers: std::exception", the owner's "Talk to me." with
    // Qwen3 4B; llama.cpp common/sampling.cpp rethrows the prefill's error).
    function history(thread) {
        var list = messagesOf(thread.id).filter(function (m) { return m.kind !== "fallback" && !(m.followUp && !m.chosen); });
        while (list.length && list[list.length - 1].role !== "user") list.pop();
        return list.slice(-HISTORY).map(function (m) { return { role: m.role, text: m.text }; });
    }
    // For a call's arguments: the words asked, and the turn before them only
    // when they lean on it ("text her too"). The whole conversation made the
    // model reuse an earlier, failed request's recipient (the owner's "create
    // me a draft email ..." answered "Priya Nair has no email address").
    function callHistory(thread) {
        var h = history(thread), last = h[h.length - 1];
        if (!last) return [];
        var leans = /\b(?:him|her|them|it|that|this|there|again|instead|same)\b/i.test(last.text);
        return leans ? h.slice(-3) : [last];
    }
    // The latest turns that fit in chars (the last one always, cut to fit).
    function fitted(list, chars) {
        var out = [], used = 0;
        for (var i = list.length - 1; i >= 0; --i) {
            var n = String(list[i].text || "").length;
            if (out.length && used + n > chars) break;
            out.unshift(n > chars ? { role: list[i].role, text: String(list[i].text).slice(0, chars) } : list[i]);
            used += n;
        }
        return out;
    }
    function lastAsked(thread) {
        var m = messagesOf(thread.id).filter(function (x) { return x.role === "user"; });
        return m.length ? m[m.length - 1].text : "";
    }
    // The commands a model is offered as tools: with the words asked, only
    // the ones they come near (MAX_TOOLS, by the words they share with a
    // command's title and description, and the words a command needs:
    // lang grounded()). All of them are some 5,000 tokens, more than the
    // on-device model's context (llama-server -c 4096) and a long wait on
    // a phone before the first word.
    var MAX_TOOLS = 10;
    var STOP = /^(?:the|and|for|with|from|that|this|what|when|where|which|your|have|does|will|can|could|would|should|please|tell|turn|make|about|into|onto|them|they|there|some|just|then|than|also|been|being|very|really|want|need|like)$/;
    function stems(text) {
        return String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
            .filter(function (w) { return w.length > 2 && !STOP.test(w); }).map(function (w) { return w.slice(0, 5); });
    }
    function toolsFor(list, asked) {
        var usable = list.filter(function (c) { return allowed(c) && !c.internal; });
        if (asked !== undefined) {
            var said = stems(asked), l = lang();
            usable = usable.map(function (c) {
                var known = stems(c.id.replace(/([A-Z])/g, " $1") + " " + c.title + " " + c.description), score = 0;
                said.forEach(function (w) { if (known.indexOf(w) >= 0) score++; });
                if (c.builtIn && l.mentions && l.mentions(c.id, asked)) score += 2;
                return { c: c, score: score };
            }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score; })
              .slice(0, MAX_TOOLS).map(function (x) { return x.c; });
        }
        return usable.map(function (c) {
            return { name: commands.toolName(c.id), description: c.description, parameters: c.parameters };
        });
    }
    // timeoutMs: the time left for it (the on-device model's deadline).
    // prefix: the on-device model's shared prefix (localPrefix): the
    // system prompt, the rest after it.
    function callModel(provider, key, thread, tools, toolChoice, timeoutMs, prefix) {
        var system = prefix ? prefix.text : systemPrompt(tools.length > 0);
        // After the choice's examples in the shared prompt, the model must
        // be told this is not a choice ("None." was its whole answer).
        var tail = promptTail(tools.length > 0) + (tools.length ? "" : " Now answer the user in words, as yourself: never with a command's name or \"none\".");
        var msgs = prefix ? [{ role: "system", text: tail }].concat(fitted(history(thread), LOCAL_HISTORY_CHARS)) : history(thread);
        var req = providers.chatRequest(provider, { system: system, messages: msgs, tools: tools, toolChoice: toolChoice }, key);
        if (timeoutMs) req.timeoutMs = timeoutMs;
        var t0 = Date.now();
        return deps.request(req).then(function (r) {
            noteStep(thread, "answer", t0, r.body, tools.length ? { tools: tools.length } : undefined);
            return providers.parseChat(provider.type, r.status, r.body);
        });
    }
    // The on-device model calls the command it chose: its arguments as JSON
    // held to the command's parameters (response_format: llama-server
    // turns the schema into a grammar, so generation ends with the JSON's
    // closing brace), the call made of it here. Offered as a tool with
    // tool_choice "required", Qwen3 0.6B often wrote the JSON, a full stop
    // and then went on until its 160 tokens (up to 30 s under load):
    // measured in docs/AI-AND-MCP.md ("A call held to its schema").
    // The commands whose argument names a thing that exists (a task, an
    // event, a memo), and whether a value has a word of what was said.
    var NAMED_ARG = { taskDone: "text", eventCancel: "query", eventMove: "query", noteAppend: "query" };
    function grounded(v, said) {
        var heard = " " + String(said).toLowerCase().replace(/[^a-z0-9']+/g, " ") + " ";
        return String(v || "").toLowerCase().split(/[^a-z0-9']+/).some(function (w) { return w.length > 2 && heard.indexOf(" " + w) >= 0; });
    }
    function callCommand(p, thread, cmd, timeoutMs, prefix) {
        var name = commands.toolName(cmd.id);
        // The schema holds the JSON's form; what each argument is, the
        // model reads here ("the task's name as it is in Tasks, not the
        // whole sentence").
        var props = (cmd.parameters && cmd.parameters.properties) || {};
        var said = Object.keys(props).filter(function (k) { return props[k].description; })
            .map(function (k) { return k + ": " + props[k].description; }).join("; ");
        var tail = nowText() + " The user asked the phone to do this: " + name + ": " + cmd.description +
            (said ? " Its arguments: " + said + "." : "") +
            " Write its arguments as JSON, from what the user said, in their words (times and dates as they said them, \"friday at 4 pm\").";
        var req = providers.chatRequest(p, { system: prefix.text, messages: [{ role: "system", text: tail }].concat(fitted(callHistory(thread), LOCAL_HISTORY_CHARS)),
                                             schema: cmd.parameters || { type: "object", properties: {} }, maxTokens: CALL_TOKENS, temperature: 0 }, "");
        if (timeoutMs) req.timeoutMs = timeoutMs;
        var t0 = Date.now();
        return deps.request(req).then(function (r) {
            noteStep(thread, "call", t0, r.body, { command: cmd.id });
            var out = providers.parseChat(p.type, r.status, r.body), args;
            try { args = JSON.parse(out.text); } catch (e) { throw new Error("its call of " + name + " could not be read"); }
            args = args && typeof args === "object" ? args : {};
            // A value that is the command's own description (the 0.6B model
            // wrote "Add an item to Tasks, ..." as a task) is no value.
            var desc = String(cmd.description || "").toLowerCase().slice(0, 24);
            Object.keys(args).forEach(function (k) { if (typeof args[k] === "string" && desc && args[k].toLowerCase().indexOf(desc) >= 0) delete args[k]; });
            // The name of a thing that exists, which the model must take from
            // the words: one with none of them (an example it made up) is
            // the words themselves, which the command matches against what
            // there is (lib/commands.js namedIn).
            var asked = lastAsked(thread), k = NAMED_ARG[cmd.id];
            if (k && !grounded(args[k], asked)) args[k] = asked;
            return { text: "", toolCalls: [{ name: name, args: args }] };
        });
    }
    // An answer: words, or a tool call to run (cloud ones only when allowed).
    function answer(thread, result, cat, layer, source, cloud, asked) {
        var s = lang().say;
        var call = result.toolCalls[0];
        if (call) {
            if (cloud && !settings().allowCloudControl)
                return Promise.resolve([say(thread, s.cloudNoControl(source), { via: layer, source: source, status: "failed" })]);
            var cmd = commands.fromToolName(cat.all, call.name);
            if (!cmd) return Promise.resolve([say(thread, s.unknownTool(call.name), { via: layer, source: source, status: "failed" })]);
            var args = commands.fromModel(cmd, call.args, env());
            if (cmd.id === "open" && call.args && call.args.name) args.name = call.args.name;
            return act(thread, cmd, args, layer, source, asked);
        }
        return withNext(asked, result.text || s.done()).then(function (next) {
            return [say(thread, result.text || s.done(), Object.assign({ via: layer, source: source }, next))];
        });
    }
    // What to offer after a model's answer to words: a web search for a
    // question about the world (not small talk), and what to do with the
    // answer (lang say.related: "Save as Memo" for a recipe, Maps for a place).
    function withNext(asked, text) {
        var s = lang().say;
        if (!asked || !s.context) return Promise.resolve({});
        var ctx = s.context(asked), rel = s.related(asked, text);
        return apps().then(function (list) {
            var choices = [], actions = [];
            rel.forEach(function (a) {
                if (a.run) actions.push({ label: a.label, run: a.run });
                else if (a.map) {
                    var maps = appByTitle(list, "Maps");
                    if (maps) actions.push({ label: a.label, open: { appId: maps.id, params: { query: a.map }, title: maps.title } });
                }
            });
            actions.forEach(function (a, i) { choices.push({ id: (a.open ? "open:" : "do:") + i, label: a.label }); });
            if (ctx.question) choices.push({ id: "web", label: s.searchWeb() });
            if (!choices.length) return {};
            var data = { webQuery: asked };
            if (actions.length) data.actions = actions;
            return { choices: choices, data: data };
        });
    }
    function appByTitle(list, title) {
        var t = String(title || "").toLowerCase();
        return t ? list.filter(function (a) { return String(a.title).toLowerCase() === t; })[0] || null : null;
    }

    // The on-device model in use: the one chosen, else the built-in one
    // (lib/models.js), unless "off".
    function localChoice() {
        var s = settings();
        return s.localModel === "off" ? "" : s.localModel || models.BUILT_IN;
    }
    function localReady() {
        if (!localChoice() || !deps.llm) return Promise.resolve(null);
        var m = models.find(localChoice());
        if (!m) return Promise.resolve(null);
        return Promise.resolve(deps.llm.status()).then(function (st) {
            var installed = st && (st.installed || []).some(function (i) { return i.id === m.id; });
            return installed && st.available ? m : null;
        }, function () { return null; });
    }
    // The commands as tools only for words that may ask the device to do
    // something: a question about the world or small talk goes without
    // them, which keeps a small model from calling one ("why is the sky
    // blue" playing music) and its prompt short (some 3,600 tokens of
    // tools: a minute on a slow phone before the first word).
    function mayAct(thread) {
        var s = lang().say, asked = lastAsked(thread);
        if (!s.context || !asked) return true;
        var c = s.context(asked);
        return !c.question && !c.smallTalk;
    }
    // Between the grammar and the model's choice: the grammar knew the
    // command but not all it needs ("add an event called dentist
    // friday-ish": no time it could read), or a language file marks its
    // parse {partial: true}. The on-device model, where there is one, fills
    // in what the words say: its answer held to the command's own
    // parameters (a JSON schema with nothing required), at temperature 0.
    // What the grammar read stays; a value from the model is kept only when
    // a word of it is in what was said (a small model left free invents
    // times); what is still missing is asked for as before, and what the
    // model filled is read back unless the words name it (act, grounded()).
    function empty(v) { return v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length); }
    function missingArgs(cmd, args, parsed) {
        if (!cmd.builtIn || !cmd.parameters) return false;
        if (cmd.id === "event" && args.day) return false;
        if (cmd.id === "contactAdd" || cmd.id === "text" || cmd.id === "email") return false;
        if (parsed.partial) return true;
        return (cmd.parameters.required || []).some(function (k) { return empty(args[k]); });
    }
    function fillArgs(thread, cmd, args, text) {
        var said = " " + String(text).toLowerCase().replace(/[^a-z0-9']+/g, " ") + " ";
        function inWords(v) {
            return String(v).toLowerCase().split(/[^a-z0-9']+/).some(function (w) { return w.length > 1 && said.indexOf(" " + w + " ") >= 0; });
        }
        return localReady().then(function (m) {
            if (!m) return null;
            return bounded(thread, function (left, stage) {
                return deps.llm.ensure(m).then(function (srv) {
                    stage("thinking");
                    var req = providers.chatRequest({ type: "local", baseUrl: srv.baseUrl, model: m.id }, {
                        system: "Fill in the arguments of the phone command " + commands.toolName(cmd.id) + ": " + cmd.description +
                            " Use only what the user said, in their words (times and dates as they said them, \"friday at 4 pm\"); " +
                            "leave out what they did not say.",
                        messages: [{ role: "user", text: text }],
                        schema: Object.assign({}, cmd.parameters, { required: [] }),
                        maxTokens: 200, temperature: 0
                    }, "");
                    req.timeoutMs = left();
                    var t0 = Date.now();
                    return deps.request(req).then(function (r) { noteStep(thread, "fill", t0, r.body, { command: cmd.id }); return r; });
                });
            }).then(function (r) {
                var got = {};
                try { got = JSON.parse(providers.parseChat("local", r.status, r.body).text) || {}; } catch (e) { return null; }
                var kept = {};
                Object.keys(got).forEach(function (k) { if (empty(args[k]) && !empty(got[k]) && inWords(got[k])) kept[k] = got[k]; });
                if (!Object.keys(kept).length) return null;
                var filled = commands.fromModel(cmd, kept, env());
                // The grammar's own values stay; what neither has keeps the grammar's default.
                Object.keys(args).forEach(function (k) { if ((!empty(args[k]) && !(k in kept)) || filled[k] === undefined) filled[k] = args[k]; });
                return { args: filled, model: m };
            });
        }).catch(function (e) { log("filling in arguments failed: " + (e && e.message)); return null; });
    }

    // The on-device model in two steps where the words may ask the phone to
    // do something. A small model (Qwen3 0.6B) offered tools often says
    // what it would do instead of calling one ("I'll turn off the Wi-Fi"),
    // or is not offered the right one by words it does not share with it
    // ("throw on some tunes"). So first it only chooses: every command by
    // its name and title, or "none", its answer held to that list (a JSON
    // schema llama-server turns into a grammar); then, with that one tool,
    // it must call it (tool_choice "required"), which fills in the
    // arguments. "none" (a question, chat) is answered in words, without
    // tools. Measured on 28 phrasings the grammar misses, with the real
    // model: 7 right before, 17 after (docs/AI-AND-MCP.md).
    // Examples for the choice (other words than the grammar's): with them
    // Qwen3 0.6B chose right 20 times in 28, without them 9.
    var PICK_EXAMPLES = [
        ["it's so dark, I need to see", "toggle"], ["switch Bluetooth off", "toggle"], ["wake me up at 7", "alarm"],
        ["10 minute timer please", "timer"], ["remind me to pay the bills on Monday", "reminder"],
        ["put a meeting with Ana on Thursday at 2 on my calendar", "event"], ["tell Ana I'm running late", "text"], ["phone Ana", "call"],
        ["it's too quiet, turn it up", "volume"], ["the screen is too dark", "brightness"], ["I want to hear some jazz", "play"],
        ["launch the calculator", "open"], ["will it be sunny tomorrow", "weather"], ["write down: the wifi password is on the fridge", "note"],
        ["why is the sky blue", "none"], ["tell me a joke", "none"]
    ];
    // The on-device model's prompt, the same for every request and both
    // steps (the choice, then the call or the answer in words), so that
    // llama-server reads it once and keeps it (cache_prompt, its one slot;
    // the Qwen3 template puts a call's one tool after it): the persona,
    // every command by its name and the first sentence of its description,
    // and the examples of a choice. What changes comes after it: the
    // examples of the commands that may fit and the words; a call's or an
    // answer's time and history. The commands' own examples for each were
    // some 2,000 of the choice's 3,000 tokens: only the likeliest few
    // commands' are given (pickCommand). The choice's examples as earlier
    // turns were read again after each call (some 350 tokens): in it, they
    // stay.
    // Measured in docs/AI-AND-MCP.md ("One prompt, read once").
    var prefixCache = null;
    function localPrefix(cat) {
        var usable = cat.all.filter(function (c) { return allowed(c) && !c.internal; });
        var names = usable.map(function (c) { return commands.toolName(c.id); });
        var key = settings().language + "|" + settings().personality + "|" + names.join(",");
        if (prefixCache && prefixCache.key === key) return prefixCache;
        var list = usable.map(function (c, i) { return names[i] + ": " + String(c.description || c.title).split(/\.\s/)[0].replace(/\.$/, ""); }).join("\n");
        var shots = PICK_EXAMPLES.filter(function (x) { return x[1] === "none" || names.indexOf(x[1]) >= 0; })
            .map(function (x) { return JSON.stringify(x[0]) + ": " + x[1]; }).join("\n");
        prefixCache = { key: key, usable: usable, names: names,
                        text: persona() + "\n\nThe phone's commands:\n" + list +
                              "\n\nWhich command does what was asked, for example (none: a question or chat, answered in words):\n" + shots };
        return prefixCache;
    }
    // The commands the words come nearest (words they share with a
    // command's name, title, description and examples; the language's
    // mentions), best first: whose examples the choice is shown.
    var PICK_CANDIDATES = 4;
    function candidates(usable, asked) {
        var said = stems(asked), l = lang();
        return usable.map(function (c) {
            var known = stems(c.id.replace(/([A-Z])/g, " $1") + " " + c.title + " " + c.description + " " + (c.examples || []).join(" ")), score = 0;
            said.forEach(function (w) { if (known.indexOf(w) >= 0) score++; });
            if (c.builtIn && l.mentions && l.mentions(c.id, asked)) score += 2;
            return { c: c, score: score };
        }).filter(function (x) { return x.score > 0 && (x.c.examples || []).length; })
          .sort(function (a, b) { return b.score - a.score; }).slice(0, PICK_CANDIDATES).map(function (x) { return x.c; });
    }
    function pickCommand(p, thread, cat, timeoutMs) {
        var pre = localPrefix(cat), usable = pre.usable, names = pre.names, asked = lastAsked(thread);
        var near = candidates(usable, asked).map(function (c) {
            return commands.toolName(c.id) + ": " + c.examples.slice(0, 2).map(function (e) { return JSON.stringify(e); }).join(", ");
        });
        var ask = "Pick the phone command that does what the user asks the phone to do, or \"none\" when they ask a question or chat." +
            (near.length ? " Commands that may fit, as people ask for them:\n" + near.join("\n") : "");
        var req = providers.chatRequest(p, {
            system: pre.text,
            messages: [{ role: "system", text: ask }, { role: "user", text: asked }],
            schema: { type: "object", properties: { command: { type: "string", "enum": names.concat(["none"]) } }, required: ["command"] },
            maxTokens: 40, temperature: 0
        }, "");
        if (timeoutMs) req.timeoutMs = timeoutMs;
        var t0 = Date.now();
        return deps.request(req).then(function (r) {
            var out = providers.parseChat(p.type, r.status, r.body), choice = "";
            try { choice = JSON.parse(out.text).command; } catch (e) { /* not JSON: none */ }
            noteStep(thread, "pick", t0, r.body, { choice: choice || "none" });
            var i = names.indexOf(choice);
            return i >= 0 ? usable[i] : null;
        });
    }
    // The on-device model's work, bounded as a whole. llama-server answers
    // a request only when it is done and serves one at a time (-np 1), so
    // on a busy computer or a slow phone starting it, the choice and the
    // call could each take their whole HTTP timeout (2 minutes on a
    // device, 3 in the simulator's proxy) one after the other: the spinner
    // for 7 minutes, then "Operation canceled". One deadline for all of it;
    // each request is given only the time left, so it is closed then and
    // llama-server drops it instead of keeping the next question waiting
    // behind it. Until then the thread says what is happening (summary
    // working, which the app shows under its dots); past it, the error has
    // {deadline: true} and the router offers what else can (localFailed).
    // run(left() -> ms, stage(name)) -> Promise; a late result is dropped.
    // left() is a moment more than the time left, so that the deadline,
    // not a request's own timeout ("Operation canceled"), ends it.
    function bounded(thread, run) {
        var ms = deps.localDeadlineMs || LOCAL_DEADLINE_MS, since = Date.now(), until = since + ms, timer = null, over = false;
        function stage(name) {
            if (over || !thread) return;
            thread.working = { stage: name, since: since, until: until };
            putThread(thread);
            changed("threads");
        }
        function end() {
            over = true;
            clearTimeout(timer);
            if (thread && thread.working) { delete thread.working; putThread(thread); changed("threads"); }
        }
        function outOfTime() {
            var e = new Error("no answer within " + Math.round(ms / 1000) + " seconds");
            e.deadline = true;
            return e;
        }
        var late = new Promise(function (resolve, reject) { timer = setTimeout(function () { reject(outOfTime()); }, ms); });
        stage("starting");
        var work = Promise.resolve().then(function () { return run(function () { return Math.max(1, until - Date.now()) + 500; }, stage); })
            .catch(function (e) { throw Date.now() >= until ? outOfTime() : e; });
        return Promise.race([work, late]).then(function (r) { end(); return r; }, function (e) { end(); throw e; });
    }
    // The on-device model failed or ran out of time: what else can.
    function localFailed(thread, e, asked) {
        log("on-device model failed: " + (e && e.message));
        var s = lang().say;
        if (e && e.deadline && s.localTimeout) return offer(thread, function (app) { return s.localTimeout(app); }, true, asked);
        return offer(thread, s.localFailed(e && e.message || "no answer"), false, asked);
    }
    function askLocal(thread, model, cat) {
        return bounded(thread, function (left, stage) {
            return deps.llm.ensure(model).then(function (srv) {
                stage("thinking");
                var p = { type: "local", baseUrl: srv.baseUrl, model: model.id };
                // Small talk is answered in words. A question goes to the choice
                // too ("is my thursday afternoon open", "how can I reach Priya"
                // are the calendar's and Contacts'), but only a command that
                // reads may answer it: "how do I make banana pudding" is never
                // made a memo (measured: docs/AI-AND-MCP.md).
                var ctx = lang().say.context ? lang().say.context(lastAsked(thread)) : { question: false, smallTalk: false };
                var pre = localPrefix(cat);
                if (ctx.smallTalk) return callModel(p, "", thread, [], undefined, left(), pre);
                return pickCommand(p, thread, cat, left()).then(function (c) {
                    if (c && ctx.question && c.risk !== "read") c = null;
                    if (!c) return callModel(p, "", thread, [], undefined, left(), pre);
                    return callCommand(p, thread, c, left(), pre);
                });
            });
        }).then(function (r) { return answer(thread, r, cat, "on-device", model.name, false, lastAsked(thread)); });
    }
    function askCloud(thread, p, cat) {
        var source = providers.displayName(p);
        var tools = settings().allowCloudControl && mayAct(thread) ? toolsFor(cat.all, lastAsked(thread)) : [];
        return keyOf(p).then(function (key) { return callModel(p, key, thread, tools); })
            .then(function (r) { return answer(thread, r, cat, "cloud", source, true, lastAsked(thread)); },
                  function (e) { return [say(thread, lang().say.cloudFailed(source, e.message), { via: "cloud", source: source, status: "failed" })]; });
    }
    // Layer 4: nothing here could answer; the user chooses. Never a dead
    // end: the app that does it ("I can open Phone for you"), a web search
    // for a question, a model; and the commands the words come close to.
    // instead: the note replaces the words (it says why and what instead).
    // asked: the words nothing understood (not after a model tried). note
    // may be a function (the app's title or "") -> the note.
    function offer(thread, note, instead, asked) {
        var s = lang().say, p = defaultProvider(), ctx = asked && s.context ? s.context(asked) : { app: "" };
        return apps().then(function (list) {
            var app = appByTitle(list, ctx.app), choices = [], data = {};
            if (typeof note === "function") note = note(app ? app.title : "");
            if (app) {
                data.actions = [{ label: s.openApp(app.title), open: { appId: app.id, params: app.params || {}, title: app.title } }];
                choices.push({ id: "open:0", label: s.openApp(app.title) });
            }
            if (p) choices.push({ id: "cloud:" + p.id, label: s.askCloud(providers.displayName(p)) });
            choices.push({ id: "web", label: s.searchWeb() });
            if (!p) choices.push({ id: "connect", label: s.connectModel() });
            var close = asked && !note && s.suggest ? s.suggest(asked) : [];
            if (close.length) data.suggest = close;
            var why = s.fallback(app ? "app" : ctx.question ? "question" : "other", app && app.title, close.length > 0);
            var text = instead ? note : (note ? note + " " : "") + why + (close.length ? " " + s.didYouMeanAny(close) : "");
            return [say(thread, text, { via: "commands", kind: "fallback", choices: choices,
                                        data: Object.keys(data).length ? data : undefined })];
        });
    }

    // ---- What the grammar found, done ----------------------------------------------------------
    // One command as the grammar gave it: {command, args} -> messages.
    function actParsed(thread, parsed, cat, text) {
        var id = parsed.command === "app" ? "app:" + parsed.args.key : parsed.command;
        var cmd = commands.find(cat.all, id);
        if (!cmd) return null;
        var args = parsed.command === "app" ? { text: parsed.args.text } : parsed.args;
        if (parsed.command === "open") args = { appId: parsed.args.appId, title: parsed.args.title, name: parsed.args.title, params: parsed.args.params };
        // A memo about a subject, an email to write: the on-device model
        // writes it where there is one (the owner's "make me a note about
        // the newest features ..." saved the request as the memo).
        if ((cmd.id === "note" && args.topic && !args.text) || (cmd.id === "email" && args.draft && args.topic && !args.body))
            return compose(thread, cmd, args).then(function (c) { return act(thread, cmd, c ? c.args : args, c ? "on-device" : "commands", c ? c.model.name : ""); });
        if (missingArgs(cmd, args, parsed)) {
            return fillArgs(thread, cmd, args, text).then(function (f) {
                return f ? act(thread, cmd, f.args, "on-device", f.model.name, text) : act(thread, cmd, args, "commands", "");
            });
        }
        return act(thread, cmd, args, "commands", "");
    }
    // Several requests in one ("turn off wifi and set an alarm for 6"), one after the other.
    function actParts(thread, parts, cat, text) {
        return parts.reduce(function (p, part) {
            return p.then(function (out) {
                var r = actParsed(thread, part, cat, text);
                return r ? r.then(function (more) { return out.concat(more); }) : out;
            });
        }, Promise.resolve([]));
    }
    // "Don't turn on wifi": nothing done; a read-back of it waiting is cancelled.
    function notThis(thread, n, cat) {
        var s = lang().say, pend = lastPending(thread);
        if (pend && (n.that || !n.command || pend.command === n.command)) {
            pend.status = "cancelled";
            putMessage(pend);
            return Promise.resolve([say(thread, s.cancelled(), { via: "commands", command: pend.command, status: "cancelled" })]);
        }
        if (n.need) return Promise.resolve([say(thread, s.dontNeed(n.need), { via: "commands", status: "ask" })]);
        var cmd = n.command ? commands.find(cat.all, n.command) : null;
        var what = cmd && cmd.builtIn ? s.describe(cmd.id, n.args || {}, cmd.title) : "";
        return Promise.resolve([say(thread, s.wontDo(what), { via: "commands" })]);
    }
    // Small talk: the grammar's words; a conversation ("talk to me", a
    // joke) the on-device model's, where there is one.
    function chatAnswer(thread, parsed, cat) {
        var kind = parsed.args.kind;
        if (/^(?:talk|joke)$/.test(kind)) {
            return localReady().then(function (m) {
                if (!m) return act(thread, commands.find(cat.all, "chat"), parsed.args, "commands", "");
                return askLocalWords(thread, m).catch(function () { return act(thread, commands.find(cat.all, "chat"), parsed.args, "commands", ""); });
            });
        }
        return act(thread, commands.find(cat.all, "chat"), parsed.args, "commands", "");
    }
    // "Did you add the number?": what the device has, never what a model
    // supposes (the owner's "Yes, I added the number" when it had not).
    function checkDone(thread, args, cat) {
        var s = lang().say, c = s.checked, f = thread.focus, last = thread.last, e = env();
        var reply = function (text, extra) { return [say(thread, text, Object.assign({ via: "commands", command: "checkDone", status: "done" }, extra || {}))]; };
        var pend = lastPending(thread);
        if (pend) return Promise.resolve(reply(c.pending(pend.text)));
        if (f && f.kind === "contact") {
            return commands.dbGet(e, f.id).then(function (p) {
                if (!p) return reply(c.gone(f.title || "that contact"));
                var name = commands.personName(p);
                var phones = (p.phoneNumbers || []).map(function (x) { return x.value; }), mails = (p.emails || []).map(function (x) { return x.value; });
                if (args.field === "phone") return phones.length ? reply(c.contactHas(name, "phone", phones))
                    : reply(c.contactLacks(name, "phone"), { status: "ask", data: { awaiting: { command: "contactAdd", args: { personId: p._id, name: name }, field: "number" } } });
                if (args.field === "email") return mails.length ? reply(c.contactHas(name, "email", mails))
                    : reply(c.contactLacks(name, "email"), { status: "ask", data: { awaiting: { command: "contactAdd", args: { personId: p._id, name: name }, field: "email" } } });
                return reply(c.contactSummary(name, phones.concat(mails)));
            });
        }
        if (f && (f.kind === "event" || f.kind === "memo" || f.kind === "task")) {
            return commands.dbGet(e, f.id).then(function (o) { return reply(o ? c.there(s.describeItem ? s.describeItem(f.kind, o, now()) : f.title) : c.gone(f.title || "it")); });
        }
        var msgs = messagesOf(thread.id).filter(function (m) { return m.role === "assistant" && m.command && m.status === "done" && m.command !== "checkDone"; });
        var lastDone = msgs[msgs.length - 1];
        void last;
        return Promise.resolve(reply(lastDone ? c.lastDid(lastDone.text) : c.nothing()));
    }
    // A bare address or number ("megweaver@icloud.com"): the contact in
    // focus gets it; with none, the assistant asks what to do with it. It is
    // never a request to send (the owner's became an email sent to her).
    function bareDetail(thread, text, cat) {
        var t = String(text).trim();
        var mail = /[^\s@,]+@[^\s@,]+\.[a-z]{2,}/i.exec(t);
        var num = /(?:^|[\s,:])(\+?\(?\d[\d\s().-]{5,}\d)(?=$|[\s,.?!])/.exec(t);
        if (!mail && !num) return null;
        var rest = t.replace(mail ? mail[0] : "", " ").replace(num ? num[1] : "", " ").replace(/[\s,.!?:;-]+/g, " ").trim();
        // More than an address or a number and a question about it: a request (the grammar's or a model's).
        if (rest && !/^(?:(?:it's|its|it is|here|this is|that's|his|her|their|the|my|number|e-?mail(?: address)?|address|is|and|also|too)\b ?)*(?:did you (?:add|save|get|put) .*|have you .*|is that .*)?$/i.test(rest)) return null;
        var f = thread.focus;
        if (f && f.kind === "contact") {
            var args = { personId: f.id, name: f.title || "" };
            if (mail) args.email = mail[0];
            if (num) args.number = num[1].trim();
            return act(thread, commands.find(cat.all, "contactAdd"), args, "commands", "");
        }
        var what = mail ? mail[0] : num[1].trim();
        return Promise.resolve([say(thread, lang().say.whatWith(what, !!mail), { via: "commands", status: "ask" })]);
    }
    // The words lean on the previous turn ("make it 8 instead", "and
    // tomorrow?", "turn it off", "text her too"): lang followOn.
    function followOn(thread, text, cat) {
        var l = lang();
        if (!l.followOn || !thread.last) return null;
        var fo = l.followOn(l.clean(text), thread.last, now());
        if (!fo) return null;
        var before = Promise.resolve([]);
        // "Instead": a read-back waiting is cancelled; what was just made is taken back.
        var pend = lastPending(thread);
        if ((fo.replace || fo.replacePending) && pend) { pend.status = "cancelled"; putMessage(pend); }
        else if (fo.replace) {
            var m = lastUndoable(thread);
            if (m && m.command === fo.command) {
                before = commands.run(commands.find(cat.all, "undo"), { undo: m.data.undo }, env()).then(function () {
                    m.data.undone = true;
                    putMessage(m);
                    return [];
                }, function () { return []; });
            }
        }
        return before.then(function () {
            if (fo.sentence) {
                var again = grammar.parse(fo.sentence, { lang: settings().language, now: now(), apps: cat.apps, names: cat.names || [], appCommands: cat.compiled, original: text });
                if (!again) return null;
                if (again.command === "multi") return actParts(thread, again.args.parts, cat, text);
                return actParsed(thread, again, cat, text);
            }
            var cmd = commands.find(cat.all, fo.command);
            return cmd ? act(thread, cmd, fo.args, "commands", "") : null;
        });
    }
    // A memo or an email the user asked to have written: the on-device
    // model's words (the topic, then what it wrote), or null without one.
    function compose(thread, cmd, args) {
        return localReady().then(function (m) {
            if (!m) return null;
            return bounded(thread, function (left, stage) {
                return deps.llm.ensure(m).then(function (srv) {
                    stage("thinking");
                    var what = cmd.id === "note" ? "a short memo about: " + args.topic + ". Plain text: a few short lines, no title, no markdown."
                        : "the body of a short email about: " + args.topic + ". Plain text, friendly, at most 120 words, no subject line, no placeholders like [Name].";
                    var req = providers.chatRequest({ type: "local", baseUrl: srv.baseUrl, model: m.id }, {
                        system: persona() + " " + nowText(), messages: [{ role: "user", text: "Write " + what }], maxTokens: 300, temperature: 0.3 }, "");
                    req.timeoutMs = left();
                    var t0 = Date.now();
                    return deps.request(req).then(function (r) { noteStep(thread, "compose", t0, r.body, { command: cmd.id }); return r; });
                });
            }).then(function (r) {
                var words = String(providers.parseChat("local", r.status, r.body).text || "").replace(/\*\*|^#+\s*/gm, "").trim();
                if (!words) return null;
                var out = Object.assign({}, args);
                if (cmd.id === "note") out.text = args.topic + "\n" + words;
                else out.body = words;
                return { args: out, model: m };
            });
        }).catch(function (e) { log("writing it failed: " + (e && e.message)); return null; });
    }
    // The on-device model's words for small talk (no command chosen).
    function askLocalWords(thread, model) {
        return bounded(thread, function (left, stage) {
            return deps.llm.ensure(model).then(function (srv) {
                stage("thinking");
                return catalogue().then(function (cat) {
                    return callModel({ type: "local", baseUrl: srv.baseUrl, model: model.id }, "", thread, [], undefined, left(), localPrefix(cat));
                });
            });
        }).then(function (r) { return [say(thread, r.text || lang().say.done(), { via: "on-device", source: model.name })]; });
    }
    // The decision model's slot (docs/AI-AND-MCP.md "A decision model"):
    // deps.decider.decide({text, history, last, commands, now}) ->
    // Promise<{command, args, confidence, escalate} | null>. Its choice runs
    // as a model's does (read back unless the words name it), and only
    // when it is sure; "escalate" (or not sure) goes on to the general model.
    function decide(thread, text, cat) {
        var d = deps.decider;
        if (!d || !d.decide || settings().decider === "off") return Promise.resolve(null);
        var usable = cat.all.filter(function (c) { return allowed(c) && !c.internal; });
        var t0 = Date.now();
        return Promise.resolve(d.decide({ text: text, history: fitted(history(thread), 1200), last: thread.last || null, now: now(),
                                          commands: usable.map(function (c) { return { id: c.id, title: c.title, description: c.description, examples: c.examples || [], parameters: c.parameters }; }) }))
            .then(function (r) {
                noteStep(thread, "decide", t0, "", r ? { choice: r.escalate ? "escalate" : r.command || "none", confidence: r.confidence } : { choice: "none" });
                if (!r || r.escalate || !r.command || !(r.confidence >= (d.threshold || 0.8))) return null;
                if (r.command === "none") return null;
                var cmd = commands.find(cat.all, r.command);
                if (!cmd || !allowed(cmd)) return null;
                return act(thread, cmd, commands.fromModel(cmd, r.args || {}, env()), "decider", d.name || "decision model", text);
            }, function (e) { log("decision model failed: " + (e && e.message)); return null; });
    }

    function route(thread, text, fq) {
        return Promise.all([catalogue(), commands.contactNames(env())]).then(function (got) {
            var cat = got[0];
            cat.names = got[1];
            var parsed = grammar.parse(text, { lang: settings().language, now: now(), apps: cat.apps, names: got[1], appCommands: cat.compiled });
            // A question waits: the words answer it, or it waits for later.
            if (fq) {
                var said = lang().followUp ? lang().followUp.answer(fq.followUp.kind, text, now()) : null;
                var command = parsed && parsed.command !== "beyond";
                if (said && (said.skip || !command || STRICT_ANSWERS.indexOf(fq.followUp.kind) >= 0))
                    return answerFollowUp(thread, fq, { text: text, parsed: said });
                followUps.leaveOne(fq.followUp.id);
            }
            // The assistant's own question waits (which one, what to say, what time): the words answer it.
            var filled = fillAwaiting(thread, text, cat, parsed);
            if (filled) return filled;
            if (!parsed) {
                var bare = bareDetail(thread, text, cat);
                if (bare) return bare;
            }
            // Words that lean on the last turn ("make it 8 instead", "and tomorrow?").
            var pronoun = parsed && (parsed.command === "text" || parsed.command === "call" || parsed.command === "email") && /^(?:him|her|them|he|she)$/.test(String(parsed.args.who || ""));
            // "reply thanks" after an email was read: to the email, not the last text.
            if (parsed && parsed.command === "replyMessage" && thread.last && /^(?:readEmail|searchEmail)$/.test(thread.last.command)) pronoun = true;
            return Promise.resolve(!parsed || pronoun ? followOn(thread, text, cat) : null).then(function (fo) {
                if (fo) return fo;
                return routeParsed(thread, text, parsed, cat);
            });
        });
    }
    function routeParsed(thread, text, parsed, cat) {
        if (parsed && parsed.command === "undo") return undoLast(thread, cat, parsed.args);
        if (parsed && parsed.command === "negated") return notThis(thread, parsed.args, cat);
        if (parsed && parsed.command === "multi") return actParts(thread, parsed.args.parts, cat, text);
        if (parsed && parsed.command === "chat") return chatAnswer(thread, parsed, cat);
        if (parsed && parsed.command === "checkDone") return checkDone(thread, parsed.args, cat);
        // Only a model or the web can: noted, and on to them.
        var note = parsed && parsed.command === "beyond" ? lang().say.beyond(parsed.args.what) : "";
        if (note) parsed = null;
        if (parsed) {
            var done = actParsed(thread, parsed, cat, text);
            if (done) return done;
        }
        var cloud = thread.provider ? getProvider(thread.provider) : null;
        if (cloud) return askCloud(thread, cloud, cat);
        return decide(thread, text, cat).then(function (d) {
            if (d) return d;
            return localReady().then(function (m) {
                if (!m) return offer(thread, note, !!note, text);
                return askLocal(thread, m, cat).catch(function (e) { return localFailed(thread, e, text); });
            });
        });
    }

    // The user's words before a message (what it answers).
    function askedBefore(thread, messageId) {
        var msgs = messagesOf(thread.id), asked = "";
        for (var i = 0; i < msgs.length && msgs[i].id !== messageId; ++i) if (msgs[i].role === "user") asked = msgs[i].text;
        return asked;
    }

    function speakLast(list, p) {
        // Spoken requests are answered aloud with Voice replies; typed ones with Speak answers.
        if (p.speak === false || !(p.voice ? settings().voiceReplies : settings().speak) || !deps.tts) return;
        var last = list[list.length - 1];
        if (last && last.role === "assistant" && last.text) {
            // A follow-up question is said after what was done.
            var before = list[list.length - 2], words = last.text;
            if (last.followUp && before && before.role === "assistant" && before.text) words = before.text + " " + last.text;
            try { Promise.resolve(deps.tts.speak(words, settings().language, settings().speechVoice, settings().speechRate)).catch(function () {}); } catch (e) { /* no speech */ }
        }
    }
    function privileged() {
        var c = caller();
        return c === SYSTEM_UI || c === ASSISTANT_APP || c === SETTINGS_APP || (deps.trusted && deps.trusted(c));
    }
    function threadFor(p) {
        if (p.newThread) return createThread();
        var t = p.threadId ? getThread(p.threadId) : currentThread();
        if (p.threadId && !t) return null;
        return t || createThread();
    }
    function done(thread, list, p) {
        endTurn(thread);
        speakLast(list, p);
        changed("threads");
        return ok({ thread: summary(thread), messages: list });
    }

    // ---- Methods ---------------------------------------------------------------------------------
    var methods = {
        ask: function (p) {
            var text = String(p.text || "").trim();
            if (!text) return Promise.resolve(fail(ERRORS.BAD_PARAMS, "need \"text\""));
            if (text.length > 4000) return Promise.resolve(fail(ERRORS.BAD_PARAMS, "\"text\" is too long"));
            if (!privileged()) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Only the system and the Assistant may ask"));
            if (!settings().enabled) return Promise.resolve(fail(ERRORS.OFF, lang().say.off()));
            var thread = threadFor(p);
            if (!thread) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such conversation: " + p.threadId));
            storage.set("assistant:current", thread.id);
            if (!thread.title) thread.title = text.slice(0, 80);
            var user = say(thread, text, { role: "user" });
            startTurn(thread);
            changed("threads");
            // "Yes" or "No" to a read-back waiting: its answer.
            var pend = lastPending(thread), yn = pend && lang().answer ? lang().answer(lang().clean(text)) : null;
            if (yn) {
                return methods.confirm({ threadId: thread.id, messageId: pend.id, accept: yn === "yes", voice: p.voice, speak: p.speak })
                    .then(function (r) {
                        if (r.returnValue !== false) r.messages = [user].concat(r.messages);
                        return r;
                    });
            }
            // "I'm done", "that's all" in a spoken conversation (after the
            // check-in, a plain "no" too): a goodbye, and the view closes
            // once it is said (status "goodbye", AssistantOverlay.qml).
            if (p.voice && lang().say.done && lang().say.done(text, !!p.checkIn))
                return Promise.resolve(done(thread, [user, say(thread, lang().say.goodbye(settings().personality), { status: "goodbye" })], p));
            if (p.locked) lockedAsk[thread.id] = true;
            var unlocked = function () { delete lockedAsk[thread.id]; };
            return route(thread, text, p.locked ? null : openFollowUp(thread)).then(function (out) { unlocked(); return done(thread, [user].concat(out), p); },
                                            function (e) { unlocked(); throw e; });
        },
        choose: function (p) {
            if (!privileged()) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Not allowed"));
            var thread = getThread(p.threadId), m = thread && getMessage(thread.id, p.messageId);
            var shows = /^show:\d+$/.test(String(p.choice));
            if (!m || (!m.choices && !shows)) return Promise.resolve(fail(ERRORS.NOT_FOUND, "Nothing to choose there"));
            if (!shows && !m.choices.some(function (c) { return c.id === p.choice; })) return Promise.resolve(fail(ERRORS.BAD_PARAMS, "No such choice"));
            if (shows) {
                // An item shown in the conversation, tapped: its app on it
                // (the buttons stay: nothing was chosen).
                var item = [].concat.apply([], ((m.data && m.data.attachments) || []).map(function (x) { return x.items || []; }))[Number(p.choice.slice(5))];
                if (!item || !item.open) return Promise.resolve(fail(ERRORS.NOT_FOUND, "Nothing to show there"));
                return deps.luna.call("luna://com.palm.applicationManager/launch", { id: item.open.appId, params: item.open.params || {}, returnToCaller: true })
                    .then(function () { return ok({ thread: summary(thread), messages: [] }); });
            }
            if (p.choice === "connect") return methods.connect({ threadId: thread.id, messageId: m.id });
            var asked = askedBefore(thread, m.id);
            m.chosen = p.choice;
            putMessage(m);
            startTurn(thread);
            var c = String(p.choice);
            var work;
            if (c.indexOf("cloud:") === 0) {
                var prov = getProvider(c.slice(6));
                if (!prov) return Promise.resolve(fail(ERRORS.NOT_FOUND, "That provider is gone"));
                thread.provider = prov.id;
                putThread(thread);
                work = catalogue().then(function (cat) { return askCloud(thread, prov, cat); });
            } else if (c === "open") {
                var o = m.data && m.data.open;
                if (!o || !o.appId) return Promise.resolve(fail(ERRORS.NOT_FOUND, "Nothing to open there"));
                work = deps.luna.call("luna://com.palm.applicationManager/launch", { id: o.appId, params: o.params || {}, returnToCaller: true })
                    .then(function () { return []; });
            } else if (/^(?:open|do):\d+$/.test(c)) {
                // One of the things to do next (outcome, offer, withNext).
                var a = ((m.data && m.data.actions) || [])[Number(c.split(":")[1])];
                if (!a) return Promise.resolve(fail(ERRORS.NOT_FOUND, "Nothing to do there"));
                if (a.open) {
                    work = deps.luna.call("luna://com.palm.applicationManager/launch", { id: a.open.appId, params: a.open.params || {}, returnToCaller: true })
                        .then(function () { return []; });
                } else {
                    work = catalogue().then(function (cat) { return runAction(thread, cat, a.run); });
                }
            } else if (/^pick:\d+$/.test(c) && m.data && m.data.awaiting && m.data.awaiting.options) {
                var w = m.data.awaiting, picked = {};
                picked[w.field] = w.options[Number(c.slice(5))];
                work = catalogue().then(function (cat) { return act(thread, commands.find(cat.all, w.command), Object.assign({}, w.args, picked), "commands", ""); });
            } else if (c.indexOf("fu:") === 0 && m.followUp) {
                work = answerFollowUp(thread, m, { choice: c });
            } else if (c === "web") {
                var query = (m.data && m.data.webQuery) || asked;
                work = catalogue().then(function (cat) { return act(thread, commands.find(cat.all, "search"), { query: query }, "commands", ""); });
            } else {
                work = deps.luna.call("luna://com.palm.applicationManager/launch", { id: SETTINGS_APP, params: { page: "assistant" } })
                    .then(function () { return []; });
            }
            return work.then(function (out) { return done(thread, out, p); });
        },
        // "Connect model": Settings > Assistant, to set up an on-device model,
        // a cloud one or both; the question waits on the thread (retry).
        connect: function (p) {
            if (!privileged()) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Not allowed"));
            var mode = ["local", "cloud", "both"].indexOf(p.mode) >= 0 ? p.mode : "";
            var thread = p.threadId ? getThread(p.threadId) : null;
            if (p.threadId && !thread) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such conversation: " + p.threadId));
            var m = thread && p.messageId ? getMessage(thread.id, p.messageId) : null;
            if (m) {
                var asked = askedBefore(thread, m.id);
                if (asked) {
                    thread.retry = { messageId: m.id, text: asked, mode: mode, time: now() };
                    putThread(thread);
                }
            }
            return deps.luna.call("luna://com.palm.applicationManager/launch",
                                  { id: SETTINGS_APP, params: { page: "assistant", connect: mode || "choose", threadId: thread ? thread.id : "" } })
                .then(function () { return ok({ mode: mode, waiting: !!(thread && thread.retry) }); },
                      function (e) { return fail(ERRORS.FAILED, e && e.message || String(e)); });
        },
        // The question that waited for a model (connect), asked again now
        // that one is there: the on-device model first (as the router
        // does), the cloud one when it is all there is or was asked for.
        retry: function (p) {
            if (!privileged()) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Not allowed"));
            var thread = getThread(p.threadId);
            if (!thread) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such conversation: " + p.threadId));
            var r = thread.retry;
            if (!r) return Promise.resolve(ok({ thread: summary(thread), messages: [] }));
            if (!settings().enabled) return Promise.resolve(fail(ERRORS.OFF, lang().say.off()));
            return Promise.all([localReady(), catalogue()]).then(function (got) {
                var local = got[0], cat = got[1], cloud = defaultProvider();
                if (!local && !cloud) return [say(thread, lang().say.noModelYet(), { via: "commands" })];
                delete thread.retry;
                var m = getMessage(thread.id, r.messageId);
                if (m && m.choices && !m.chosen) { m.chosen = "connect"; putMessage(m); }
                // Something else was asked since: the question again, last.
                var out = [];
                if (lastAsked(thread) !== r.text) out.push(say(thread, r.text, { role: "user" }));
                else putThread(thread);
                var answering;
                if (local && (r.mode !== "cloud" || !cloud)) {
                    answering = askLocal(thread, local, cat).catch(function (e) { return localFailed(thread, e, e && e.deadline ? r.text : undefined); });
                } else {
                    thread.provider = cloud.id;
                    putThread(thread);
                    answering = askCloud(thread, cloud, cat);
                }
                return answering.then(function (list) { return out.concat(list); });
            }).then(function (out) { return done(thread, out, p); });
        },
        confirm: function (p) {
            if (!privileged()) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Not allowed"));
            var thread = getThread(p.threadId), m = thread && getMessage(thread.id, p.messageId);
            if (!m || !m.confirm || m.status !== "pending") return Promise.resolve(fail(ERRORS.NOT_FOUND, "Nothing waits for an answer there"));
            if (!turnOf(thread)) startTurn(thread);
            if (!p.accept) {
                m.status = "cancelled";
                putMessage(m);
                return Promise.resolve(done(thread, [say(thread, lang().say.cancelled(), { via: m.via, command: m.command, status: "cancelled" })], p));
            }
            return catalogue().then(function (cat) {
                var cmd = commands.find(cat.all, m.confirm.command);
                if (!cmd || !allowed(cmd)) {
                    m.status = "failed";
                    putMessage(m);
                    return [say(thread, lang().say.notAllowed(cmd ? cmd.title : m.confirm.command), { status: "failed" })];
                }
                noteArgs(thread, cmd.id, m.confirm.args);
                return commands.run(cmd, m.confirm.args, env()).then(function (r) {
                    m.status = "done";
                    putMessage(m);
                    if (cmd.id === "undo" && m.confirm.args.messageId) {
                        var target = getMessage(thread.id, m.confirm.args.messageId);
                        if (target && target.data) { target.data.undone = true; putMessage(target); }
                    }
                    return withFollowUp(thread, cmd, m.confirm.args, r, [say(thread, r.text, outcome(r, m.via, m.source, cmd))]);
                }, function (e) {
                    m.status = "failed";
                    putMessage(m);
                    return [say(thread, lang().say.failed(e.message), { via: m.via, command: cmd.id, status: "failed" })];
                });
            }).then(function (out) { return done(thread, out, p); });
        },
        threads: function () {
            var cur = currentThread();
            return Promise.resolve(ok({ threads: allThreads().map(summary), current: cur ? cur.id : "" }));
        },
        thread: function (p) {
            var t = p.id ? getThread(p.id) : currentThread();
            if (!t) return Promise.resolve(p.id ? fail(ERRORS.NOT_FOUND, "No such conversation: " + p.id) : ok({ thread: null, messages: [] }));
            return Promise.resolve(ok({ thread: summary(t), messages: messagesOf(t.id) }));
        },
        newThread: function () {
            var t = createThread();
            changed("threads");
            return Promise.resolve(ok({ thread: summary(t) }));
        },
        setCurrent: function (p) {
            if (!getThread(p.id)) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such conversation: " + p.id));
            storage.set("assistant:current", p.id);
            changed("threads");
            return Promise.resolve(ok({ current: p.id }));
        },
        deleteThread: function (p) {
            if (!getThread(p.id)) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such conversation: " + p.id));
            deleteThread(p.id);
            changed("threads");
            return Promise.resolve(ok({}));
        },
        clearHistory: function () {
            var n = 0;
            allThreads().forEach(function (t) { deleteThread(t.id); n++; });
            storage.remove("assistant:current");
            changed("threads");
            return Promise.resolve(ok({ deleted: n }));
        },
        getSettings: function () { return Promise.resolve(ok({ settings: settings() })); },
        setSettings: function (p) {
            var cur = storage.get("assistant:settings") || {}, bad = "";
            Object.keys(p).forEach(function (k) {
                if (!(k in DEFAULTS)) return;
                var v = p[k];
                if (/^(enabled|speak|allowCloudControl|voiceReplies|wakeWord|wakeWhenLocked|followUps)$/.test(k) && typeof v !== "boolean") bad = k + ": true or false";
                else if (k === "speechRate" && RATE_CHOICES.indexOf(v) < 0) bad = "speechRate: one of " + RATE_CHOICES.join(", ");
                else if (k === "personality" && !PERSONALITIES[v]) bad = "personality: one of " + Object.keys(PERSONALITIES).join(", ");
                else if (k === "voiceWait" && WAIT_CHOICES.indexOf(v) < 0) bad = "voiceWait: seconds, one of " + WAIT_CHOICES.join(", ");
                else if ((k === "quietStart" || k === "quietEnd") && !HHMM.test(String(v))) bad = k + ": a time, \"22:00\"";
                else if (k === "followUpFirst" && FIRST_CHOICES.indexOf(v) < 0) bad = "followUpFirst: minutes, one of " + FIRST_CHOICES.join(", ");
                else if (k === "followUpAgain" && AGAIN_CHOICES.indexOf(v) < 0) bad = "followUpAgain: minutes, one of " + AGAIN_CHOICES.join(", ");
                else if (k === "followUpTopicsOff" && !(Array.isArray(v) && v.every(function (x) { return TOPICS.indexOf(x) >= 0; }))) bad = "followUpTopicsOff: a list of " + TOPICS.join(", ");
                else if (k === "disabledCommands" && !Array.isArray(v)) bad = "disabledCommands: a list of command ids";
                else if (k === "localModel" && v !== "" && v !== "off" && !models.find(v)) bad = "localModel: unknown model";
                else if (k === "speechVoice" && !/^[A-Za-z0-9._-]{0,40}$/.test(String(v))) bad = "speechVoice: a voice name";
                else if (k === "defaultProvider" && v !== "" && !getProvider(v)) bad = "defaultProvider: unknown provider";
                else if (k === "units" && ["metric", "imperial", "auto"].indexOf(v) < 0) bad = "units: metric, imperial or auto";
                else if (k === "language" && grammar.LANGUAGES.indexOf(String(v)) < 0) bad = "language: one of " + grammar.LANGUAGES.join(", ");
                else cur[k] = v;
            });
            if (bad) return Promise.resolve(fail(ERRORS.BAD_PARAMS, bad));
            // Only Settings may let cloud models act.
            if (p.allowCloudControl === true && caller() !== SETTINGS_APP && !(deps.trusted && deps.trusted(caller())))
                return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Only Settings can allow cloud models to control the device"));
            storage.set("assistant:settings", cur);
            // Follow-up questions turned off: none waits any more.
            if (p.followUps === false) followUps.clear();
            changed("settings");
            return Promise.resolve(ok({ settings: settings() }));
        },
        // Words to expect in a spoken request, and the transcriber's prompt made of them
        // (whisper writes them as spelled): the wake phrase and the
        // contacts' names, as Voice Dial passes them. The system UI and the
        // Assistant only (names are private).
        vocabulary: function () {
            if (!privileged()) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Not allowed"));
            // The prompt as requests, not a bare list: a list of names makes
            // whisper hear names everywhere ("call Marcus" as "Karl Marcus").
            return commands.contactNames(env()).then(function (names) {
                var seen = {}, words = ["Hey Phoenix"], prompt = "Hey Phoenix, set a timer.";
                names.forEach(function (n) { if (!seen[n] && words.length < 101) { seen[n] = true; words.push(n); } });
                words.filter(function (n) { return n.indexOf(" ") > 0; }).slice(0, 30).forEach(function (n, i) {
                    prompt += (i % 2 ? " Text " : " Call ") + n + ".";
                });
                return ok({ words: words, prompt: prompt });
            }, function () { return ok({ words: ["Hey Phoenix"], prompt: "Hey Phoenix, set a timer." }); });
        },
        commands: function () {
            return catalogue().then(function (cat) {
                // Not locationAccess: Settings > Assistant > Permissions' Location row is it.
                return ok({ commands: cat.all.filter(function (c) { return c.id !== "locationAccess"; }).map(function (c) {
                    return { id: c.id, title: c.title, risk: c.risk, builtIn: !!c.builtIn, appId: c.appId || "",
                             enabled: allowed(c), confirms: commands.needsConfirm(c) };
                }) });
            });
        },
        providers: function () {
            var types = {};
            Object.keys(providers.TYPES).forEach(function (t) {
                if (t === "local") return;
                var x = providers.TYPES[t];
                types[t] = { label: x.label, base: x.base, needsKey: x.needsKey, model: x.model, models: x.models };
            });
            var d = defaultProvider();
            return Promise.resolve(ok({ providers: allProviders().map(shown), defaultProvider: d ? d.id : "", types: types }));
        },
        setProvider: function (p) {
            if (!(caller() === SETTINGS_APP || (deps.trusted && deps.trusted(caller()))))
                return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Only Settings can change providers"));
            var old = p.id ? getProvider(p.id) : null;
            if (p.id && !old) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such provider: " + p.id));
            var type = old ? old.type : String(p.type || "");
            if (!providers.TYPES[type] || type === "local") return Promise.resolve(fail(ERRORS.BAD_PARAMS, "type: anthropic, openai, gemini or compatible"));
            var base = p.baseUrl !== undefined ? String(p.baseUrl).trim() : (old ? old.baseUrl : "");
            if (base && !/^https?:\/\/[^\s]+$/.test(base)) return Promise.resolve(fail(ERRORS.BAD_PARAMS, "baseUrl: an http(s) address"));
            if (type === "compatible" && !base) return Promise.resolve(fail(ERRORS.BAD_PARAMS, "baseUrl: the server's address, e.g. http://192.168.1.5:11434/v1"));
            var rec = Object.assign({}, old || { id: newId(), type: type, created: now() });
            rec.name = p.name !== undefined ? String(p.name).trim().slice(0, 60) : rec.name || "";
            rec.model = p.model !== undefined ? String(p.model).trim().slice(0, 200) : rec.model || providers.TYPES[type].model;
            rec.baseUrl = base;
            var sealing = Promise.resolve();
            if (typeof p.key === "string" && p.key.trim()) {
                var key = p.key.trim();
                sealing = deps.secrets.seal(key).then(function (enc) {
                    rec.keyEnc = enc;
                    rec.keyHint = key.length > 8 ? key.slice(-4) : "";
                });
            } else if (p.key === null) { delete rec.keyEnc; delete rec.keyHint; }
            return sealing.then(function () {
                if (providers.TYPES[type].needsKey && !rec.keyEnc) return fail(ERRORS.BAD_PARAMS, "key: this provider needs an API key");
                storage.set(providerKey(rec.id), rec);
                if (!getProvider(settings().defaultProvider)) {
                    var s = storage.get("assistant:settings") || {};
                    s.defaultProvider = rec.id;
                    storage.set("assistant:settings", s);
                }
                changed("providers");
                return ok({ provider: shown(rec) });
            });
        },
        removeProvider: function (p) {
            if (!(caller() === SETTINGS_APP || (deps.trusted && deps.trusted(caller()))))
                return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Only Settings can change providers"));
            if (!getProvider(p.id)) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such provider: " + p.id));
            storage.remove(providerKey(p.id));
            var s = storage.get("assistant:settings") || {};
            if (s.defaultProvider === p.id) { s.defaultProvider = ""; storage.set("assistant:settings", s); }
            allThreads().forEach(function (t) { if (t.provider === p.id) { t.provider = ""; putThread(t); } });
            changed("providers");
            return Promise.resolve(ok({}));
        },
        // A saved provider ({id}), or one being set up ({type, model, baseUrl, key}).
        testProvider: function (p) {
            if (!(caller() === SETTINGS_APP || (deps.trusted && deps.trusted(caller()))))
                return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Only Settings can test providers"));
            return withProvider(p, function (prov, key) {
                var req = providers.chatRequest(prov, { system: "Reply with the single word OK.", messages: [{ role: "user", text: "Are you there?" }], tools: [] }, key);
                return deps.request(req).then(function (r) {
                    var res = providers.parseChat(prov.type, r.status, r.body);
                    return ok({ ok: true, text: res.text });
                });
            });
        },
        listModels: function (p) {
            if (!(caller() === SETTINGS_APP || (deps.trusted && deps.trusted(caller()))))
                return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Only Settings can list models"));
            return withProvider(p, function (prov, key) {
                return deps.request(providers.modelsRequest(prov, key)).then(function (r) {
                    return ok({ models: providers.parseModels(prov.type, r.status, r.body) });
                });
            });
        },
        models: function () {
            return Promise.resolve(deps.llm ? deps.llm.status() : null).then(function (st) {
                st = st || { available: false, installed: [], ramBytes: 0 };
                var installed = {};
                (st.installed || []).forEach(function (i) { installed[i.id] = i; });
                var list = models.forDevice(st.ramBytes || 0, Object.keys(installed)).map(function (m) {
                    var d = st.downloading && st.downloading.id === m.id ? st.downloading : null;
                    return { id: m.id, name: m.name, params: m.params, licence: m.licence, source: m.source, size: m.size, ram: m.ram,
                             note: m.note, fits: m.fits, recommended: m.recommended, installed: !!installed[m.id], builtIn: !!m.builtIn,
                             // No GGUF from the Qwen team: Phoenix's conversion of their weights.
                             converted: !!(m.sources[0] && m.sources[0].kind === "phoenix"),
                             downloading: d ? { received: d.received || 0, total: d.total || m.size } : null };
                });
                return ok({ models: list, selected: localChoice(),
                            status: { available: !!st.available, running: !!st.running, server: st.server || "", error: st.error || "",
                                      ramBytes: st.ramBytes || 0, howToInstall: st.howToInstall || "" } });
            });
        },
        downloadModel: function (p) {
            var m = models.find(p.id);
            if (!m) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such model: " + p.id));
            if (m.builtIn) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, m.name + " comes with the system"));
            if (!m.sources.length) return Promise.resolve(fail(ERRORS.NOT_FOUND, m.name + " cannot be downloaded yet"));
            if (!deps.llm) return Promise.resolve(fail(ERRORS.FAILED, "On-device models are not available here"));
            return Promise.resolve(deps.llm.download(m)).then(function () { changed("models"); return ok({}); },
                function (e) { return fail(ERRORS.FAILED, e.message); });
        },
        cancelDownload: function (p) {
            if (!deps.llm) return Promise.resolve(ok({}));
            return Promise.resolve(deps.llm.cancel(p.id)).then(function () { changed("models"); return ok({}); });
        },
        removeModel: function (p) {
            var m = models.find(p.id);
            if (!m) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such model: " + p.id));
            if (m.builtIn) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, m.name + " is built in and cannot be removed"));
            return Promise.resolve(deps.llm && deps.llm.remove(m)).then(function () {
                if (settings().localModel === m.id) {
                    var s = storage.get("assistant:settings") || {};
                    s.localModel = "";
                    storage.set("assistant:settings", s);
                }
                changed("models");
                return ok({});
            });
        },
        selectModel: function (p) { return methods.setSettings({ localModel: String(p.id || "") }); },
        // ---- Follow-up questions ----
        followUps: function () { return Promise.resolve(ok(followUps.list())); },
        // A notification's button: answered there, and said in its conversation too.
        answerFollowUp: function (p) {
            if (!privileged()) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Not allowed"));
            var choice = String(p.action || p.choice || "");
            if (!/^fu:(?:skip|\d+)$/.test(choice)) return Promise.resolve(fail(ERRORS.BAD_PARAMS, "action: fu:<n> or fu:skip"));
            var q = followUps.get(String(p.id || ""));
            if (!q) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such question: " + p.id));
            return followUps.answer(q.id, { choice: choice }, false).then(function (out) {
                var thread = getThread(q.threadId), m = thread && q.messageId ? getMessage(thread.id, q.messageId) : null;
                if (m && !m.chosen) {
                    m.chosen = choice;
                    putMessage(m);
                    say(thread, out.text, { via: "commands", command: m.command, status: out.skipped || out.dropped ? "cancelled" : "done" });
                    changed("threads");
                }
                return ok({ text: out.text, answered: !out.dropped && !out.skipped });
            });
        },
        followUpOpen: function (p) {
            if (!privileged()) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Not allowed"));
            var q0 = followUps.get(String(p.id || ""));
            if (!q0) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such question: " + p.id));
            return followUps.reopen(q0.id).then(function (q) {
                var thread = getThread(q0.threadId) || createThread();
                if (!thread.title) { thread.title = q.text || ""; putThread(thread); }
                storage.set("assistant:current", thread.id);
                var command = { event: "event", reminder: "reminder", task: "task", alarm: "alarm", contact: "contactAdd" }[q0.item.type];
                // Already waiting there (sent later): opened on it, not asked twice.
                var waiting = !q.why && q.messageId && getThread(q0.threadId) ? getMessage(thread.id, q.messageId) : null;
                var list = q.why ? [say(thread, q.why === "gone" ? lang().followUp.gone() : lang().followUp.alreadySet(), { via: "commands", command: command, status: "cancelled" })]
                         : waiting && !waiting.chosen ? [] : [askFollowUp(thread, q, command)];
                thread = getThread(thread.id);
                if (thread.unread) { thread.unread = 0; putThread(thread); }
                changed("threads");
                return ok({ thread: summary(thread), messages: list });
            });
        },
        // The conversation was read: nothing unread in it.
        markRead: function (p) {
            var t = getThread(String(p.id || ""));
            if (!t) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such conversation: " + p.id));
            if (t.unread) { t.unread = 0; putThread(t); changed("threads"); }
            return Promise.resolve(ok({}));
        },
        followUpLeave: function (p) {
            if (!privileged()) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Not allowed"));
            return Promise.resolve(ok({ queued: followUps.leave(p.threadId ? String(p.threadId) : "") }));
        },
        // The activity manager's wake-up. "at" moves the clock on (the
        // simulator's and the tests' fast-forward): the system UI only.
        followUpWake: function (p) {
            var at = typeof p.at === "number" && privileged() ? p.at : undefined;
            return followUps.wake(at).then(function (r) { return ok(r); });
        },
        resetFollowUps: function () {
            if (!privileged()) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Not allowed"));
            followUps.reset();
            return Promise.resolve(ok({}));
        },
        speak: function (p) {
            if (!deps.tts) return Promise.resolve(fail(ERRORS.FAILED, "No speech here"));
            // voice: this one (Settings' Play Sample), else the chosen one.
            var voice = typeof p.voice === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(p.voice) ? p.voice : settings().speechVoice;
            // rate: this speed (Settings' sample of a speed), else the chosen one.
            var rate = RATE_CHOICES.indexOf(p.rate) >= 0 ? p.rate : settings().speechRate;
            return Promise.resolve(deps.tts.speak(String(p.text || ""), settings().language, voice, rate)).then(function () { return ok({}); },
                function (e) { return fail(ERRORS.FAILED, e.message); });
        },
        // A voice session's words (AssistantOverlay.qml): kind "checkIn"
        // after the wait ("Anything else?"), "goodbye" when nothing more was
        // said; in the chosen personality. Put in the conversation (the
        // current one) and spoken unless speak is false.
        sessionPhrase: function (p) {
            if (!privileged()) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Not allowed"));
            var kind = p.kind, l = lang().say;
            if ((kind !== "checkIn" && kind !== "goodbye") || !l.checkIn) return Promise.resolve(fail(ERRORS.BAD_PARAMS, "kind: checkIn or goodbye"));
            var text = kind === "checkIn" ? l.checkIn(settings().personality) : l.goodbye(settings().personality);
            var thread = p.threadId ? getThread(p.threadId) : currentThread();
            var list = thread ? [say(thread, text, kind === "goodbye" ? { status: "goodbye" } : { kind: "checkIn" })] : [];
            if (p.speak !== false) speakLast([{ role: "assistant", text: text }], { voice: true });
            if (thread) changed("threads");
            return Promise.resolve(ok({ text: text, kind: kind, messages: list }));
        },
        stopSpeaking: function () {
            if (deps.tts) try { deps.tts.stop(); } catch (e) { /* nothing speaking */ }
            return Promise.resolve(ok({}));
        },
        voice: function () {
            return Promise.resolve(deps.voice ? deps.voice() : []).then(function (parts) {
                return ok({ parts: VOICE_PARTS.map(function (v) {
                    var p = (parts || []).filter(function (x) { return x && x.id === v.id; })[0];
                    return p ? { id: v.id, name: v.name, available: !!p.available, engine: String(p.engine || ""),
                                 howToInstall: p.available ? "" : String(p.howToInstall || "") } : null;
                }).filter(Boolean) });
            }, function () { return ok({ parts: [] }); });
        }
    };

    function withProvider(p, fn) {
        var saved = p.id ? getProvider(p.id) : null;
        if (p.id && !saved) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such provider: " + p.id));
        var prov = saved ? Object.assign({}, saved) : { type: String(p.type || ""), model: p.model, baseUrl: p.baseUrl };
        if (!saved && p.model !== undefined) prov.model = p.model;
        if (!providers.TYPES[prov.type] || prov.type === "local") return Promise.resolve(fail(ERRORS.BAD_PARAMS, "unknown provider type"));
        if (saved && p.model) prov.model = p.model;
        var key = typeof p.key === "string" && p.key ? Promise.resolve(p.key) : keyOf(saved);
        return key.then(function (k) { return fn(prov, k); }).catch(function (e) {
            return ok({ ok: false, error: e && e.message || String(e) });
        });
    }

    // Every method answers, whatever goes wrong inside.
    var safe = {};
    Object.keys(methods).forEach(function (name) {
        safe[name] = function (p) {
            try {
                return Promise.resolve(methods[name](p || {})).catch(function (e) {
                    log(name + " failed: " + (e && e.stack || e));
                    return fail(ERRORS.FAILED, String(e && e.message || e));
                });
            } catch (e) {
                return Promise.resolve(fail(ERRORS.FAILED, String(e && e.message || e)));
            }
        };
    });
    return safe;
}

// What the voice needs (voice), in the order Settings lists them.
var VOICE_PARTS = [
    { id: "recognition", name: "Speech recognition (whisper.cpp)" },
    { id: "wakeWord", name: "\u201cHey Phoenix\u201d (Vosk)" },
    { id: "speech", name: "Spoken answers" }
];

var METHODS = ["ask", "choose", "confirm", "threads", "thread", "newThread", "setCurrent", "deleteThread", "clearHistory",
               "getSettings", "setSettings", "commands", "providers", "setProvider", "removeProvider", "testProvider", "listModels",
               "models", "downloadModel", "cancelDownload", "removeModel", "selectModel", "speak", "stopSpeaking", "sessionPhrase", "vocabulary", "voice",
               "connect", "retry",
               "followUps", "answerFollowUp", "followUpOpen", "followUpLeave", "followUpWake", "resetFollowUps", "markRead"];

module.exports = { createAssistantService: createAssistantService, METHODS: METHODS, ERRORS: ERRORS, SERVICE: SERVICE, DEFAULTS: DEFAULTS };
