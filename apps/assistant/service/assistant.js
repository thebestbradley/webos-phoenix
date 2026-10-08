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
//   lang), stop()}, voice() -> parts as voice answers them (optional), caller() -> app id, now() -> ms, changed(what), log,
//   notify(n) (a notification: lib/followups.js)}

"use strict";

var grammar = require("./lib/grammar");
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
    speak: true,                // answers spoken (on-device text to speech)
    language: "en",
    units: "auto",              // weather: "metric", "imperial", or from the language
    localModel: "",             // the chosen on-device model (lib/models.js id), "" for none
    defaultProvider: "",        // the cloud provider "Ask ..." offers
    allowCloudControl: false,   // cloud models may run commands
    voiceReplies: true,         // answers to spoken requests spoken (ask {voice})
    wakeWord: false,            // the shell listens for "Hey Phoenix" (docs/AI-AND-MCP.md, Voice)
    wakeWhenLocked: false,      // ... also while the screen is off or locked
    disabledCommands: [],       // command ids the assistant must not run
    followUps: true,            // questions after something is made (lib/followups.js)
    quietStart: "22:00",        // ... never asked later, in a notification, between these
    quietEnd: "08:00",
    followUpTopicsOff: []       // follow-up topics turned off (Settings, or "Stop asking"): lib/followups.js KINDS
};
var HISTORY = 20;               // turns a model sees
// What a request asked by voice over the lock screen (ask {locked}) may do:
// nothing that shows what is private, sends, or opens an app.
var LOCKED_COMMANDS = ["timer", "timerStatus", "timerCancel", "stopwatch", "alarm", "alarmList", "toggle", "media", "volume",
                       "brightness", "lock", "battery", "weather", "convert", "worldTime", "calculate", "time"];

var MESSAGE_FIELDS = ["id", "threadId", "role", "text", "time", "via", "source", "command", "status", "confirm", "choices", "chosen", "data", "followUp"];
var HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
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
        out.followUpTopicsOff = Array.isArray(out.followUpTopicsOff) ? out.followUpTopicsOff.filter(function (k) { return TOPICS.indexOf(k) >= 0; }) : [];
        out.disabledCommands = Array.isArray(out.disabledCommands) ? out.disabledCommands.filter(function (x) { return typeof x === "string"; }) : [];
        if (["metric", "imperial", "auto"].indexOf(out.units) < 0) out.units = "auto";
        return out;
    }
    function lang() { return grammar.language(settings().language); }
    function units() {
        var u = settings().units;
        if (u !== "auto") return u;
        var loc = String(deps.locale ? deps.locale() : "en-US");
        return /-(US|LR|MM)$/i.test(loc) ? "imperial" : "metric";
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
        return { id: t.id, title: t.title || (msgs[0] ? msgs[0].text : ""), created: t.created, updated: t.updated,
                 provider: t.provider || "", count: msgs.length, last: last ? last.text : "", unread: t.unread || 0 };
    }

    function say(thread, text, extra) {
        var m = Object.assign({ id: newId(), threadId: thread.id, role: "assistant", text: text, time: now() }, extra || {});
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
            var compiled = grammar.compileAppCommands(list, settings().language);
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
                                           if (old && !old.chosen) { old.chosen = "later"; putMessage(old); }
                                           var command = { event: "event", reminder: "reminder", task: "task", alarm: "alarm", contact: "contactAdd" }[q.item.type];
                                           var m = say(thread, text, { via: "commands", command: command, followUp: { id: q.id, kind: q.kind }, choices: choices });
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
    function act(thread, cmd, args, layer, source, asked) {
        var e = env(), s = lang().say;
        // Asked by voice over the lock screen: only what shows nothing
        // private and sends nothing; the rest waits for the unlock.
        if (lockedAsk[thread.id] && LOCKED_COMMANDS.indexOf(cmd.id) < 0)
            return Promise.resolve([say(thread, s.unlockFirst(), { via: layer, source: source, command: cmd.id, status: "locked" })]);
        if (!allowed(cmd)) return Promise.resolve([say(thread, s.notAllowed(cmd.title), { via: layer, source: source, command: cmd.id, status: "failed" })]);
        return commands.prepare(cmd, args, e).then(function (p) {
            // Something is missing: asked for, and the next words fill it (route()).
            if (p.awaiting) return [say(thread, p.reply, { via: layer, source: source, command: cmd.id, data: { awaiting: p.awaiting } })];
            if (p.reply) return [say(thread, p.reply, { via: layer, source: source, command: cmd.id, status: "failed" })];
            var confirm = p.confirm;
            if (!confirm && asked !== undefined && cmd.builtIn && cmd.risk !== "read" && !lang().grounded(cmd.id, p.args, asked))
                confirm = s.didYouMean(s.describe(cmd.id, p.args, cmd.title));
            if (confirm) return [say(thread, confirm, { via: layer, source: source, command: cmd.id, status: "pending",
                                                        confirm: { command: cmd.id, args: p.args } })];
            return commands.run(cmd, p.args, e).then(function (r) {
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
    // Calendar", choice "open") and what takes it back (undo).
    function outcome(r, layer, source, cmd) {
        var data = r.data ? Object.assign({}, r.data) : {}, extra = {};
        if (r.open) data.open = r.open;
        if (r.undo) data.undo = r.undo;
        var choices = [];
        if (r.open) choices.push({ id: "open", label: lang().say.openApp(r.open.title) });
        if (r.offerWeb) choices.push({ id: "web", label: lang().say.searchWeb() });
        if (choices.length) extra.choices = choices;
        return Object.assign({ via: layer, source: source, command: cmd.id, status: r.offerWeb ? "failed" : "done",
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
        return act(thread, commands.find(cat.all, "undo"), m ? { undo: m.data.undo, messageId: m.id } : {}, "commands", "");
    }
    // The words after "When is it?": a time for the event asked about.
    function fillAwaiting(thread, text, cat) {
        var msgs = messagesOf(thread.id), last = null;
        for (var i = msgs.length - 1; i >= 0 && !last; --i) if (msgs[i].role === "assistant") last = msgs[i];
        var w = last && last.data && last.data.awaiting;
        if (!w || w.command !== "event") return null;
        var l = lang(), info = l.extract(l.clean(text), now());
        if (info.rest.replace(/\b(?:at|on|for|the|it's|it is|its)\b/g, "").trim()) return null;
        var r = l.resolve(info, now(), "day");
        if (r.start === null) return null;
        var args = Object.assign({}, w.args, { start: r.start, end: r.end, allDay: r.allDay, repeat: r.repeat || w.args.repeat || null });
        return act(thread, commands.find(cat.all, "event"), args, "commands", "");
    }

    // ---- Language models (layers 3 and 4) -------------------------------------------------------
    function systemPrompt(withTools) {
        var d = new Date(now());
        return "You are Assistant, the voice assistant on a webOS phone. Answer briefly, in one to three sentences, in plain text without markdown; " +
            "your answers are read aloud. Today is " + d.toDateString() + ", the time is " + lang().timeText(now()) + "." +
            (withTools ? " Most questions need no tool: answer them in words. Call a tool only when the user clearly asks the phone to do " +
             "the very thing the tool does (\"turn on the flashlight\" calls toggle with flashlight on); call at most one. " +
             "Never call a tool for a question about the world." : " You cannot control the phone; if asked to, say the user can do it themselves.");
    }
    function history(thread) {
        return messagesOf(thread.id).filter(function (m) { return !m.choices || m.chosen || m.status === "done"; }).slice(-HISTORY)
            .map(function (m) { return { role: m.role, text: m.text }; });
    }
    function lastAsked(thread) {
        var m = messagesOf(thread.id).filter(function (x) { return x.role === "user"; });
        return m.length ? m[m.length - 1].text : "";
    }
    function toolsFor(list) {
        return list.filter(function (c) { return allowed(c) && !c.internal; }).map(function (c) {
            return { name: commands.toolName(c.id), description: c.description, parameters: c.parameters };
        });
    }
    function callModel(provider, key, thread, tools) {
        var req = providers.chatRequest(provider, { system: systemPrompt(tools.length > 0), messages: history(thread), tools: tools }, key);
        return deps.request(req).then(function (r) { return providers.parseChat(provider.type, r.status, r.body); });
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
        return Promise.resolve([say(thread, result.text || s.done(), { via: layer, source: source })]);
    }

    function localReady() {
        var s = settings();
        if (!s.localModel || !deps.llm) return Promise.resolve(null);
        var m = models.find(s.localModel);
        if (!m) return Promise.resolve(null);
        return Promise.resolve(deps.llm.status()).then(function (st) {
            var installed = st && (st.installed || []).some(function (i) { return i.id === m.id; });
            return installed && st.available ? m : null;
        }, function () { return null; });
    }
    function askLocal(thread, model, cat) {
        return deps.llm.ensure(model).then(function (srv) {
            var p = { type: "local", baseUrl: srv.baseUrl, model: model.id };
            return callModel(p, "", thread, toolsFor(cat.all));
        }).then(function (r) { return answer(thread, r, cat, "on-device", model.name, false, lastAsked(thread)); });
    }
    function askCloud(thread, p, cat) {
        var source = providers.displayName(p);
        var tools = settings().allowCloudControl ? toolsFor(cat.all) : [];
        return keyOf(p).then(function (key) { return callModel(p, key, thread, tools); })
            .then(function (r) { return answer(thread, r, cat, "cloud", source, true, lastAsked(thread)); },
                  function (e) { return [say(thread, lang().say.cloudFailed(source, e.message), { via: "cloud", source: source, status: "failed" })]; });
    }
    // Layer 4: nothing here could answer; the user chooses.
    // instead: the note replaces "I can't do that on the phone" (it says why).
    // asked: the words nothing understood, for the commands they come
    // close to (not after a model tried).
    function offer(thread, note, instead, asked) {
        var s = lang().say, choices = [], p = defaultProvider();
        if (p) choices.push({ id: "cloud:" + p.id, label: s.askCloud(providers.displayName(p)) });
        choices.push({ id: "web", label: s.searchWeb() });
        if (!p) choices.push({ id: "connect", label: s.connectModel() });
        var close = asked && !note && s.suggest ? s.suggest(asked) : [];
        var text = instead ? note : (note ? note + " " : "") + s.cantDo() + (close.length ? " " + s.didYouMeanAny(close) : "");
        return [say(thread, text, { via: "commands", choices: choices, data: close.length ? { suggest: close } : undefined })];
    }

    function route(thread, text, fq) {
        return Promise.all([catalogue(), commands.contactNames(env())]).then(function (got) {
            var cat = got[0];
            var parsed = grammar.parse(text, { lang: settings().language, now: now(), apps: cat.apps, names: got[1], appCommands: cat.compiled });
            // A question waits: the words answer it, or it waits for later.
            if (fq) {
                var said = lang().followUp ? lang().followUp.answer(fq.followUp.kind, text, now()) : null;
                var command = parsed && parsed.command !== "beyond";
                if (said && (said.skip || !command || STRICT_ANSWERS.indexOf(fq.followUp.kind) >= 0))
                    return answerFollowUp(thread, fq, { text: text, parsed: said });
                followUps.leaveOne(fq.followUp.id);
            }
            if (!parsed) {
                var filled = fillAwaiting(thread, text, cat);
                if (filled) return filled;
            }
            if (parsed && parsed.command === "undo") return undoLast(thread, cat, parsed.args);
            // Only a model or the web can: noted, and on to them.
            var note = parsed && parsed.command === "beyond" ? lang().say.beyond(parsed.args.what) : "";
            if (note) parsed = null;
            if (parsed) {
                var id = parsed.command === "app" ? "app:" + parsed.args.key : parsed.command;
                var cmd = commands.find(cat.all, id);
                var args = parsed.command === "app" ? { text: parsed.args.text } : parsed.args;
                if (parsed.command === "open") args = { appId: parsed.args.appId, title: parsed.args.title, name: parsed.args.title, params: parsed.args.params };
                if (cmd) return act(thread, cmd, args, "commands", "");
            }
            var cloud = thread.provider ? getProvider(thread.provider) : null;
            if (cloud) return askCloud(thread, cloud, cat);
            return localReady().then(function (m) {
                if (!m) return offer(thread, note, !!note, text);
                return askLocal(thread, m, cat).catch(function (e) {
                    log("on-device model failed: " + (e && e.message));
                    return offer(thread, lang().say.localFailed(e && e.message || "no answer"));
                });
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
            try { Promise.resolve(deps.tts.speak(words, settings().language)).catch(function () {}); } catch (e) { /* no speech */ }
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
            if (p.locked) lockedAsk[thread.id] = true;
            var unlocked = function () { delete lockedAsk[thread.id]; };
            return route(thread, text, p.locked ? null : openFollowUp(thread)).then(function (out) { unlocked(); return done(thread, [user].concat(out), p); },
                                            function (e) { unlocked(); throw e; });
        },
        choose: function (p) {
            if (!privileged()) return Promise.resolve(fail(ERRORS.NOT_ALLOWED, "Not allowed"));
            var thread = getThread(p.threadId), m = thread && getMessage(thread.id, p.messageId);
            if (!m || !m.choices) return Promise.resolve(fail(ERRORS.NOT_FOUND, "Nothing to choose there"));
            if (!m.choices.some(function (c) { return c.id === p.choice; })) return Promise.resolve(fail(ERRORS.BAD_PARAMS, "No such choice"));
            if (p.choice === "connect") return methods.connect({ threadId: thread.id, messageId: m.id });
            var asked = askedBefore(thread, m.id);
            m.chosen = p.choice;
            putMessage(m);
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
                work = deps.luna.call("luna://com.palm.applicationManager/launch", { id: o.appId, params: o.params || {} })
                    .then(function () { return []; });
            } else if (c.indexOf("fu:") === 0 && m.followUp) {
                work = answerFollowUp(thread, m, { choice: c });
            } else if (c === "web") {
                work = catalogue().then(function (cat) { return act(thread, commands.find(cat.all, "search"), { query: asked }, "commands", ""); });
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
                    answering = askLocal(thread, local, cat).catch(function (e) {
                        log("on-device model failed: " + (e && e.message));
                        return offer(thread, lang().say.localFailed(e && e.message || "no answer"));
                    });
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
                else if ((k === "quietStart" || k === "quietEnd") && !HHMM.test(String(v))) bad = k + ": a time, \"22:00\"";
                else if (k === "followUpTopicsOff" && !(Array.isArray(v) && v.every(function (x) { return TOPICS.indexOf(x) >= 0; }))) bad = "followUpTopicsOff: a list of " + TOPICS.join(", ");
                else if (k === "disabledCommands" && !Array.isArray(v)) bad = "disabledCommands: a list of command ids";
                else if (k === "localModel" && v !== "" && !models.find(v)) bad = "localModel: unknown model";
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
                return ok({ commands: cat.all.map(function (c) {
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
                var list = models.forDevice(st.ramBytes || 0).map(function (m) {
                    var d = st.downloading && st.downloading.id === m.id ? st.downloading : null;
                    return { id: m.id, name: m.name, params: m.params, licence: m.licence, source: m.source, size: m.size, ram: m.ram,
                             note: m.note, fits: m.fits, recommended: m.recommended, installed: !!installed[m.id],
                             downloading: d ? { received: d.received || 0, total: d.total || m.size } : null };
                });
                return ok({ models: list, selected: settings().localModel,
                            status: { available: !!st.available, running: !!st.running, server: st.server || "", error: st.error || "",
                                      ramBytes: st.ramBytes || 0, howToInstall: st.howToInstall || "" } });
            });
        },
        downloadModel: function (p) {
            var m = models.find(p.id);
            if (!m) return Promise.resolve(fail(ERRORS.NOT_FOUND, "No such model: " + p.id));
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
            return Promise.resolve(deps.tts.speak(String(p.text || ""), settings().language)).then(function () { return ok({}); },
                function (e) { return fail(ERRORS.FAILED, e.message); });
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
               "models", "downloadModel", "cancelDownload", "removeModel", "selectModel", "speak", "stopSpeaking", "vocabulary", "voice",
               "connect", "retry",
               "followUps", "answerFollowUp", "followUpOpen", "followUpLeave", "followUpWake", "resetFollowUps", "markRead"];

module.exports = { createAssistantService: createAssistantService, METHODS: METHODS, ERRORS: ERRORS, SERVICE: SERVICE, DEFAULTS: DEFAULTS };
