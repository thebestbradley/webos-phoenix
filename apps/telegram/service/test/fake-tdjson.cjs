// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A fake phoenix-tdjson (TDLib's JSON interface behind the bridge's line
// protocol, meta-phoenix/recipes-connectors/tdlib/files/phoenix-tdjson.c)
// for the Unofficial Telegram account's tests, its conformance fixture and
// the simulator's demo. It answers the td_api requests the connector sends
// with the objects TDLib 1.8 gives (td_api.tl: authorizationState*, user,
// chat, chatType*, message, messageText, messagePhoto, file, error {code,
// message}; updates with "@client_id", answers with the request's
// "@extra"), and stands in for Telegram's servers and the people on them:
// a person answers a message and reads it (updateChatReadOutbox).
//
// TDLib keeps a signed-in session in its database folder: so does this,
// by folder and key, in memory or (the simulator's pages) in the storage
// given, so another page's fake finds the session.
//
// It runs in a page too: no Node modules, no Buffer.
//
// createFakeTdjson({accounts: [{phone, code, password?, firstName}], acceptAny,
//                   people: [{id, phone, firstName, lastName?, username?, greeting?, replies?}],
//                   groups: [{id, title, members: [ids], messages: [[id, text]]}],
//                   channels: [{id, title, messages: [text]}], replyDelay, storage})
//   .process()          a HelperProcess (send, onLine, onExit, kill)
//   .deliver(fromPhoneOrId, ownPhone, text, {picture?})
//   .signedIn()         the phone signed in first, or null
//   .unauthorized(on)   every session ended on the server (another device signed it out)
//   .throttle(seconds)  FLOOD_WAIT on every request
//   .requests()         requests made (getOption not counted)
//   .sent()             [{to: chatId, text, photo}]
//   .viewed()           message ids read here
//   .close()

"use strict";

var DATA_DIR = "/var/lib/phoenix/connector-data/org.webosphoenix.service.telegram/phoenix-tdjson";
var STEP = 1048576;     // TDLib's message ids: the server's id << 20

function createFakeTdjson(o) {
    o = o || {};
    var replyDelay = o.replyDelay === undefined ? 30 : o.replyDelay;
    var people = o.people || [];
    var store = o.storage || null;
    var dbs = {};                       // folder -> {userId, key}
    try { if (store) dbs = JSON.parse(store.getItem("fake-tdjson:dbs") || "{}") || {}; } catch (e) { dbs = {}; }
    function saveDbs() { try { if (store) store.setItem("fake-tdjson:dbs", JSON.stringify(dbs)); } catch (e) { /* none */ } }
    var accounts = (o.accounts || []).map(function (a, i) { return Object.assign({ id: 5000001 + i }, a); });
    var worlds = {};                    // own userId -> {chats: {chatId: {...}}, msgs: {chatId: [message]}}
    var clients = {}, nextClient = 1, procs = [], timers = [];
    var unauthorized = false, throttled = 0, count = 0, sentLog = [], viewedLog = [], nextFile = 100, closed = false;
    var files = {};                     // file id -> path

    function later(fn, ms) {
        var t = setTimeout(function () { timers.splice(timers.indexOf(t), 1); if (!closed) fn(); }, ms);
        timers.push(t);
    }
    function error(code, message) { return { "@type": "error", code: code, message: message }; }
    function digits(p) { return String(p || "").replace(/\D/g, ""); }
    function accountByPhone(phone) {
        var d = digits(phone);
        var a = accounts.filter(function (x) { return digits(x.phone) === d; })[0];
        if (!a && o.acceptAny && d.length >= 6) {
            a = { id: 5000000 + Number(d.slice(-6)), phone: "+" + d, code: o.acceptAny.code || "12345", firstName: "Me" };
            accounts.push(a);
        }
        return a || null;
    }
    function accountById(id) { return accounts.filter(function (x) { return x.id === id; })[0] || null; }
    function personById(id) { return people.filter(function (p) { return p.id === id; })[0] || null; }

    function userJson(u, contact) {
        return { "@type": "user", id: u.id, first_name: u.firstName || "", last_name: u.lastName || "",
                 usernames: u.username ? { "@type": "usernames", active_usernames: [u.username], disabled_usernames: [], editable_username: u.username } : null,
                 phone_number: contact === false ? "" : digits(u.phone), status: { "@type": "userStatusRecently" }, is_contact: !!u.phone,
                 type: { "@type": "userTypeRegular" } };
    }

    // ---- Telegram's side: each signed-in user's chats --------------------------------------
    function world(userId) {
        if (worlds[userId]) return worlds[userId];
        var w = worlds[userId] = { chats: {}, msgs: {}, readOut: {} };
        people.forEach(function (p) {
            if (!p.greeting) return;
            privateChat(w, p.id);
            add(w, p.id, p.id, p.greeting);
        });
        (o.groups || []).forEach(function (g) {
            w.chats[g.id] = { "@type": "chat", id: g.id, title: g.title, type: { "@type": "chatTypeBasicGroup", basic_group_id: -g.id } };
            g.messages.forEach(function (m) { add(w, g.id, m[0], m[1]); });
        });
        (o.channels || []).forEach(function (c) {
            w.chats[c.id] = { "@type": "chat", id: c.id, title: c.title, type: { "@type": "chatTypeSupergroup", supergroup_id: -c.id, is_channel: true } };
            c.messages.forEach(function (t) { add(w, c.id, null, t); });
        });
        return w;
    }
    function privateChat(w, userId) {
        if (!w.chats[userId]) {
            var p = personById(userId) || accountById(userId) || {};
            w.chats[userId] = { "@type": "chat", id: userId, title: [p.firstName, p.lastName].filter(Boolean).join(" "), type: { "@type": "chatTypePrivate", user_id: userId } };
        }
        return w.chats[userId];
    }
    function add(w, chatId, senderId, text, extra, outgoing) {
        var list = w.msgs[chatId] = w.msgs[chatId] || [];
        var m = Object.assign({
            "@type": "message", id: (list.length + 1) * STEP, chat_id: chatId, is_outgoing: !!outgoing, date: Math.floor(Date.now() / 1000),
            sender_id: senderId ? { "@type": "messageSenderUser", user_id: senderId } : { "@type": "messageSenderChat", chat_id: chatId },
            content: { "@type": "messageText", text: { "@type": "formattedText", text: text, entities: [] } }
        }, extra || {});
        list.push(m);
        return m;
    }
    function chatJson(w, chatId) {
        var c = w.chats[chatId];
        var list = w.msgs[chatId] || [];
        return Object.assign({}, c, { last_message: list[list.length - 1] || null, last_read_outbox_message_id: w.readOut[chatId] || 0 });
    }
    // To every client signed in as userId.
    function broadcast(userId, update) {
        Object.keys(clients).forEach(function (id) {
            var c = clients[id];
            if (c.userId === userId && c.state === "authorizationStateReady") push(c, update);
        });
    }
    function push(c, obj) {
        var line = JSON.stringify(Object.assign({ "@client_id": c.id }, obj));
        if (!c.proc.dead) setTimeout(function () { if (!c.proc.dead) c.proc.lines.forEach(function (f) { f(line); }); }, 0);
    }
    function setState(c, type, extra) {
        c.state = type;
        push(c, { "@type": "updateAuthorizationState", authorization_state: Object.assign({ "@type": type }, extra || {}) });
        if (type === "authorizationStateReady") {
            push(c, { "@type": "updateUser", user: userJson(accountById(c.userId)) });
            push(c, { "@type": "updateConnectionState", state: { "@type": "connectionStateReady" } });
        }
    }

    // A message from someone to a signed-in user; they read and answer what they are sent.
    function arrive(userId, fromId, text, extra) {
        var w = world(userId);
        privateChat(w, fromId);
        var m = add(w, fromId, fromId, text, extra);
        broadcast(userId, { "@type": "updateNewMessage", message: m });
        return m;
    }
    function answer(userId, chatId, m) {
        var w = world(userId);
        later(function () {
            w.readOut[chatId] = m.id;
            broadcast(userId, { "@type": "updateChatReadOutbox", chat_id: chatId, last_read_outbox_message_id: m.id });
            var p = personById(chatId);
            var group = (o.groups || []).filter(function (g) { return g.id === chatId; })[0];
            if (group) p = personById(group.members[0]);
            if (!p || !p.replies || !p.replies.length) return;
            var n = p.replied || 0;
            p.replied = n + 1;
            var text = p.replies[n % p.replies.length];
            if (group) broadcast(userId, { "@type": "updateNewMessage", message: add(w, chatId, p.id, text) });
            else arrive(userId, p.id, text);
        }, replyDelay);
    }

    // ---- The requests --------------------------------------------------------------------------
    function handle(c, r) {
        var t = r["@type"];
        if (t === "getOption") return r.name === "version" ? { "@type": "optionValueString", value: "1.8.68 (fake)" } : { "@type": "optionValueEmpty" };
        if (throttled && t !== "close") return error(429, "Too Many Requests: retry after " + throttled);
        var me = c.userId;
        switch (t) {
        case "setTdlibParameters": {
            if (!r.api_id || !r.api_hash) return error(400, "Valid api_id must be provided. Can be obtained at https://my.telegram.org");
            c.dir = r.database_directory;
            var db = dbs[c.dir];
            if (db && db.key !== r.database_encryption_key) return error(401, "Wrong database encryption key");
            if (db && !unauthorized) { if (db.phone) accountByPhone(db.phone); c.userId = db.userId; later(function () { setState(c, "authorizationStateReady"); }, 0); }
            else later(function () { setState(c, "authorizationStateWaitPhoneNumber"); }, 0);
            c.key = r.database_encryption_key;
            return { "@type": "ok" };
        }
        case "setAuthenticationPhoneNumber": {
            if (c.state !== "authorizationStateWaitPhoneNumber") return error(400, "Call to setAuthenticationPhoneNumber unexpected");
            if (!/^\+?\d{6,15}$/.test(String(r.phone_number))) return error(400, "PHONE_NUMBER_INVALID");
            var a = accountByPhone(r.phone_number);
            c.pending = a;
            later(function () {
                if (!a) setState(c, "authorizationStateWaitRegistration", { terms_of_service: null });
                else setState(c, "authorizationStateWaitCode", { code_info: { "@type": "authenticationCodeInfo", phone_number: digits(a.phone),
                    type: { "@type": "authenticationCodeTypeTelegramMessage", length: String(a.code).length }, next_type: null, timeout: 0 } });
            }, 0);
            return { "@type": "ok" };
        }
        case "checkAuthenticationCode": {
            if (c.state !== "authorizationStateWaitCode") return error(400, "Call to checkAuthenticationCode unexpected");
            if (String(r.code) !== String(c.pending.code)) return error(400, "PHONE_CODE_INVALID");
            if (c.pending.password) { later(function () { setState(c, "authorizationStateWaitPassword", { password_hint: c.pending.hint || "", has_recovery_email_address: false }); }, 0); return { "@type": "ok" }; }
            signedIn(c);
            return { "@type": "ok" };
        }
        case "checkAuthenticationPassword": {
            if (c.state !== "authorizationStateWaitPassword") return error(400, "Call to checkAuthenticationPassword unexpected");
            if (String(r.password) !== String(c.pending.password)) return error(400, "PASSWORD_HASH_INVALID");
            signedIn(c);
            return { "@type": "ok" };
        }
        case "close":
            later(function () { setState(c, "authorizationStateClosing"); setState(c, "authorizationStateClosed"); delete clients[c.id]; }, 0);
            return { "@type": "ok" };
        case "logOut":
            delete dbs[c.dir];
            saveDbs();
            later(function () { setState(c, "authorizationStateLoggingOut"); setState(c, "authorizationStateClosed"); delete clients[c.id]; }, 0);
            return { "@type": "ok" };
        }
        if (c.state !== "authorizationStateReady") return error(401, "Unauthorized");
        var w = world(me);
        switch (t) {
        case "getMe": return userJson(accountById(me));
        case "getUser": {
            var u = personById(r.user_id) || accountById(r.user_id);
            return u ? userJson(u) : error(404, "User not found");
        }
        case "loadChats": return { "@type": "ok" };
        case "getChats": {
            var ids = Object.keys(w.chats).map(Number).sort(function (x, y) {
                var lx = (w.msgs[x] || []).length ? w.msgs[x][w.msgs[x].length - 1].date : 0;
                var ly = (w.msgs[y] || []).length ? w.msgs[y][w.msgs[y].length - 1].date : 0;
                return ly - lx || y - x;
            });
            return { "@type": "chats", total_count: ids.length, chat_ids: ids.slice(0, r.limit || 100) };
        }
        case "getChat": return w.chats[r.chat_id] ? chatJson(w, r.chat_id) : error(400, "Chat not found");
        case "getChatHistory": {
            var list = (w.msgs[r.chat_id] || []).slice().reverse();
            if (r.from_message_id) list = list.filter(function (m) { return m.id < r.from_message_id; });
            return { "@type": "messages", total_count: list.length, messages: list.slice(0, r.limit || 50) };
        }
        case "createPrivateChat": {
            if (!personById(r.user_id) && !accountById(r.user_id)) return error(400, "PEER_ID_INVALID");
            return chatJson(w, privateChat(w, r.user_id).id);
        }
        case "searchUserByPhoneNumber": {
            var p = people.filter(function (x) { return digits(x.phone) === digits(r.phone_number); })[0];
            return p ? userJson(p) : error(404, "User not found");
        }
        case "searchPublicChat": {
            var q = people.filter(function (x) { return x.username === r.username; })[0];
            return q ? chatJson(w, privateChat(w, q.id).id) : error(400, "USERNAME_NOT_OCCUPIED");
        }
        case "sendMessage": {
            var chat = w.chats[r.chat_id];
            if (!chat) return error(400, "Chat not found");
            if (chat.type.is_channel) return error(400, "Have no write access to the chat");
            var ic = r.input_message_content;
            var content = ic["@type"] === "inputMessagePhoto"
                ? { "@type": "messagePhoto", photo: { "@type": "photo", sizes: [{ "@type": "photoSize", type: "x", width: 800, height: 600,
                      photo: fileJson(fileFor(ic.photo.path), true) }] }, caption: ic.caption }
                : { "@type": "messageText", text: ic.text };
            var m = add(w, r.chat_id, me, "", { content: content }, true);
            sentLog.push({ to: r.chat_id, text: ic["@type"] === "inputMessagePhoto" ? ic.caption.text : ic.text.text, photo: ic.photo ? ic.photo.path : null });
            // TDLib's temporary message first, the server's id when it is sent.
            var tmp = Object.assign({}, m, { id: m.id + 1, sending_state: { "@type": "messageSendingStatePending" } });
            later(function () {
                broadcast(me, { "@type": "updateMessageSendSucceeded", message: m, old_message_id: tmp.id });
                answer(me, r.chat_id, m);
            }, Math.max(1, replyDelay / 3));
            return tmp;
        }
        case "viewMessages": viewedLog.push.apply(viewedLog, r.message_ids); return { "@type": "ok" };
        case "downloadFile": return files[r.file_id] ? fileJson(r.file_id, true) : error(400, "Invalid file identifier");
        case "setOption": return { "@type": "ok" };
        default: return error(400, "Unknown method " + t);
        }
    }
    function fileFor(path) { var id = nextFile++; files[id] = path; return id; }
    function fileJson(id, done) {
        return { "@type": "file", id: id, size: 1000, expected_size: 1000,
                 local: { "@type": "localFile", path: done ? files[id] : "", is_downloading_completed: !!done } };
    }
    function signedIn(c) {
        c.userId = c.pending.id;
        dbs[c.dir] = { userId: c.userId, key: c.key, phone: c.pending.phone };
        saveDbs();
        later(function () { setState(c, "authorizationStateReady"); }, 0);
    }

    function onLine(proc, line) {
        var m = /^([CSE]) (.*)$/.exec(line);
        if (!m) return;
        if (m[1] === "C") {
            var c = { id: nextClient++, proc: proc, state: null };
            clients[c.id] = c;
            proc.lines.forEach(function (f) { f(JSON.stringify({ "@type": "phoenix.client", client_id: c.id, "@extra": m[2] })); });
            later(function () { setState(c, "authorizationStateWaitTdlibParameters"); }, 0);
            return;
        }
        if (m[1] === "E") {
            var sp = m[2].indexOf(" ");
            var extra = m[2].slice(0, sp), req = JSON.parse(m[2].slice(sp + 1));
            var res = req["@type"] === "getOption" ? { "@type": "optionValueString", value: "1.8.68 (fake)" } : error(400, "not executable");
            proc.lines.forEach(function (f) { f(JSON.stringify({ "@type": "phoenix.executed", "@extra": extra, result: res })); });
            return;
        }
        var s = /^(\d+) (.*)$/.exec(m[2]);
        var client = s && clients[Number(s[1])];
        if (!client) return;
        var r = JSON.parse(s[2]);
        if (r["@type"] !== "getOption") count++;
        var out;
        try { out = handle(client, r); } catch (e) { out = error(500, String(e && e.message || e)); }
        push(client, Object.assign({}, out, { "@extra": r["@extra"] }));
    }

    var server = {
        process: function () {
            var proc = { lines: [], exits: [], dead: false };
            procs.push(proc);
            setTimeout(function () { proc.lines.forEach(function (f) { f(JSON.stringify({ "@type": "phoenix.ready", data_dir: DATA_DIR })); }); }, 0);
            return {
                send: function (line) { if (!proc.dead) onLine(proc, line); },
                onLine: function (f) { proc.lines.push(f); },
                onExit: function (f) { proc.exits.push(f); },
                kill: function () { if (!proc.dead) { proc.dead = true; proc.exits.forEach(function (f) { f(0); }); } }
            };
        },
        deliver: function (from, ownPhone, text, opts) {
            opts = opts || {};
            var who = typeof from === "number" ? personById(from) : people.filter(function (p) { return digits(p.phone) === digits(from) || p.username === String(from).replace(/^@/, ""); })[0];
            var meAcc = ownPhone ? accountByPhone(ownPhone) : accountById(Object.keys(clients).map(function (k) { return clients[k].userId; }).filter(Boolean)[0]);
            if (!who || !meAcc) return null;
            if (opts.picture) {
                var last = sentLog.filter(function (x) { return x.photo; }).pop();
                if (!last) return null;
                return arrive(meAcc.id, who.id, "", { content: { "@type": "messagePhoto", photo: { "@type": "photo", sizes: [{ "@type": "photoSize", type: "x",
                    width: 800, height: 600, photo: fileJson(fileFor(last.photo), false) }] }, caption: { "@type": "formattedText", text: "", entities: [] } } });
            }
            return arrive(meAcc.id, who.id, text);
        },
        signedIn: function () {
            var c = Object.keys(clients).map(function (k) { return clients[k]; }).filter(function (x) { return x.userId && x.state === "authorizationStateReady"; })[0];
            var a = c && accountById(c.userId);
            return a ? a.phone : null;
        },
        sessions: function () { return Object.keys(dbs).length; },
        unauthorized: function (on) {
            unauthorized = on !== false;
            if (unauthorized) Object.keys(clients).forEach(function (k) {
                var c = clients[k];
                if (c.state === "authorizationStateReady") setState(c, "authorizationStateWaitPhoneNumber");
            });
        },
        throttle: function (seconds) { throttled = seconds || 0; },
        requests: function () { return count; },
        sent: function () { return sentLog.slice(); },
        viewed: function () { return viewedLog.slice(); },
        request: function () { return Promise.reject(new Error("Telegram's connector does not use HTTP")); },
        close: function () {
            closed = true;
            timers.forEach(clearTimeout);
            procs.forEach(function (p) { if (!p.dead) { p.dead = true; p.exits.forEach(function (f) { f(0); }); } });
            return Promise.resolve();
        }
    };
    return server;
}

// The simulator's demo: any phone number signs in with the code 12345.
function demoTdjson(o) {
    var storage = null;
    try { storage = typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { storage = null; }
    return createFakeTdjson(Object.assign({
        acceptAny: { code: "12345" }, replyDelay: 1500, storage: storage,
        people: [
            { id: 7000001, phone: "+15550101", firstName: "Sam", lastName: "Delgado", username: "samdelgado", greeting: "Welcome to Telegram on Phoenix!",
              replies: ["Got it, from a Pre!", "Nice picture!"] },
            { id: 7000002, phone: "+15550102", firstName: "Priya", lastName: "Nair", greeting: "Hi! Cards on Telegram, nice." }
        ],
        groups: [{ id: -100001, title: "Phoenix Testers", members: [7000001, 7000002],
                   messages: [[7000001, "Build 42 boots on the Pre 3."], [7000002, "Cards are back!"]] }],
        channels: [{ id: -100002, title: "Phoenix News", messages: ["A channel: not shown in Messaging."] }]
    }, o || {}));
}

module.exports = { createFakeTdjson: createFakeTdjson, demoTdjson: demoTdjson, DATA_DIR: DATA_DIR };
