// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A fake deltachat-rpc-server for the Delta Chat account's tests, its
// conformance fixture and the simulator's demo (runtime/phoenix-runtime.js
// registers it as the "deltachat-rpc-server" helper, for addresses at
// chatmail.example only). It answers the JSON-RPC methods the connector
// calls, with the shapes deltachat-jsonrpc gives (@deltachat/jsonrpc-client
// 2.x, dist/generated/types.d.ts: Event {contextId, event: {kind, ...}},
// Message, BasicChat, FullChat, Contact; DC_CONTACT_ID_SELF 1, message
// states 10-28), and stands in for the mail servers and the people on them:
// a person answers a message, and reads it (MsgRead, as a read receipt
// would).
//
// It runs in a page too (the simulator): no Node modules, no Buffer.
//
// createFakeRpcServer({domain, users: {addr: password}, acceptAny,
//                      people: [{addr, name, greeting?, replies?}],
//                      groups: [{name, members: [addr], messages: [[addr, text]]}],
//                      replyDelay})
//   .process()            a HelperProcess (send, onLine, onExit, kill)
//   .deliver(from, user, text, {picture?, group?})   a message arrives
//   .signedIn()           the address configured first, or null
//   .unauthorized(on)     the server refuses the password from now
//   .throttle(seconds)    the server limits the rate (0: no more)
//   .requests()           how many calls reached it (events not counted)
//   .sent()               what was sent: [{from, to, text, file}]
//   .close()

"use strict";

var SELF = 1, DEVICE = 2;
var STATE = { IN_FRESH: 10, IN_NOTICED: 13, IN_SEEN: 16, OUT_PENDING: 20, OUT_FAILED: 24, OUT_DELIVERED: 26, OUT_MDN_RCVD: 28 };

function createFakeRpcServer(o) {
    o = o || {};
    var domain = o.domain || "chat.test";
    var users = Object.assign({}, o.users || {});
    var people = o.people || [];
    var replyDelay = o.replyDelay === undefined ? 30 : o.replyDelay;
    var accounts = {};       // id -> account
    var nextAccount = 1;
    var procs = [];
    var unauthorized = false, throttled = 0, count = 0, sentLog = [], closed = false;
    var timers = [];

    function later(fn, ms) {
        var t = setTimeout(function () { timers.splice(timers.indexOf(t), 1); if (!closed) fn(); }, ms);
        timers.push(t);
    }
    function err(message, code) { var e = new Error(message); e.code = code || -1; return e; }
    function hash(s) {
        var h = 5381, g = 52711;
        for (var i = 0; i < s.length; i++) { h = (h * 33) ^ s.charCodeAt(i); g = (g * 31) ^ s.charCodeAt(i); }
        return (h >>> 0).toString(36) + "." + (g >>> 0).toString(36);
    }

    function newAccount() {
        var a = { id: nextAccount++, config: {}, configured: false, io: false, contacts: {}, chats: {}, msgs: {},
                  nextContact: 10, nextChat: 10, nextMsg: 10, created: Date.now() };
        accounts[a.id] = a;
        return a;
    }
    function acct(id) {
        var a = accounts[id];
        if (!a) throw err("account " + id + " does not exist");
        return a;
    }
    function addrOf(a) { return a.config.configured_addr || null; }

    // ---- Events ----------------------------------------------------------------------------
    var events = [], waiters = [];
    function emit(accountId, event) {
        var ev = { contextId: accountId, event: event };
        if (waiters.length) waiters.shift()(ev);
        else events.push(ev);
    }

    // ---- Contacts and chats ----------------------------------------------------------------
    function contactFor(a, addr, name) {
        addr = String(addr).toLowerCase();
        var found = Object.keys(a.contacts).map(function (k) { return a.contacts[k]; }).filter(function (c) { return c.address === addr; })[0];
        if (found) { if (name && !found.authName) found.authName = name; return found; }
        var person = people.filter(function (p) { return p.addr === addr; })[0];
        var c = { id: a.nextContact++, address: addr, authName: name || (person && person.name) || "", name: "" };
        a.contacts[c.id] = c;
        return c;
    }
    function contactJson(c) {
        return { id: c.id, address: c.address, authName: c.authName, name: c.name, displayName: c.name || c.authName || c.address,
                 color: "#2f7fd0", status: "", profileImage: null, isBlocked: false, isVerified: false, isKeyContact: true,
                 e2eeAvail: true, lastSeen: 0, wasSeenRecently: false, isBot: false };
    }
    function chatWith(a, contact, request) {
        var found = Object.keys(a.chats).map(function (k) { return a.chats[k]; })
            .filter(function (c) { return c.type === "Single" && c.contactIds[0] === contact.id; })[0];
        if (found) return found;
        var c = { id: a.nextChat++, type: "Single", name: contact.authName || contact.address, contactIds: [contact.id], isContactRequest: !!request };
        a.chats[c.id] = c;
        return c;
    }
    function groupNamed(a, name, members) {
        var found = Object.keys(a.chats).map(function (k) { return a.chats[k]; }).filter(function (c) { return c.type === "Group" && c.name === name; })[0];
        if (found) return found;
        var c = { id: a.nextChat++, type: "Group", name: name, contactIds: [SELF].concat(members.map(function (m) { return contactFor(a, m).id; })),
                  isContactRequest: false };
        a.chats[c.id] = c;
        return c;
    }
    function chatJson(c, full) {
        var j = { id: c.id, name: c.name, chatType: c.type, isEncrypted: true, profileImage: null, archived: false, pinned: false,
                  isUnpromoted: false, isSelfTalk: false, color: "#2f7fd0", isContactRequest: c.isContactRequest, isDeviceChat: false, isMuted: false };
        if (full) j.contactIds = c.contactIds.slice();
        return j;
    }
    function addMsg(a, chat, fromId, text, extra) {
        var m = Object.assign({ id: a.nextMsg++, chatId: chat.id, fromId: fromId, text: text || "", viewType: "Text",
                                state: fromId === SELF ? STATE.OUT_PENDING : STATE.IN_FRESH,
                                timestamp: Math.floor(Date.now() / 1000), file: null, fileMime: null, fileName: null, isInfo: false }, extra || {});
        m.sortTimestamp = m.timestamp;
        m.receivedTimestamp = m.timestamp;
        a.msgs[m.id] = m;
        return m;
    }
    function msgJson(a, m) {
        var sender = m.fromId === SELF ? { id: SELF, address: addrOf(a), authName: "", name: "", displayName: "Me" } : contactJson(a.contacts[m.fromId]);
        return Object.assign({}, m, { sender: sender, showPadlock: true, isForwarded: false, hasLocation: false, hasHtml: false, isBot: false,
                                      quote: null, parentId: null, isEdited: false, error: null, subject: "", overrideSenderName: null,
                                      systemMessageType: "Unknown", downloadState: "Done", reactions: null, isPinned: false });
    }

    // The mail servers' mailboxes, by address: what a newly set up account
    // of the same address fetches again (with the same Message-IDs).
    var mailboxes = {};
    var midSeq = 0;

    // A message from someone at the mail servers into a user's mailbox, and
    // into the account of that address the core has.
    function arrive(user, from, text, opts, mail) {
        opts = opts || {};
        if (!mail) {
            // The Message-ID from what the mail is and where it is in the mailbox: the
            // same in another fake (the simulator's next page) that gets the same mail.
            var box = mailboxes[user] = mailboxes[user] || [];
            mail = { from: from, text: text, opts: opts, mid: "Mr." + hash([user, from, text, opts.file || "", box.length].join("|")) + "@" + domain };
            box.push(mail);
        }
        var a = Object.keys(accounts).map(function (k) { return accounts[k]; }).filter(function (x) { return addrOf(x) === user; })[0];
        if (!a) return null;
        var person = people.filter(function (p) { return p.addr === from; })[0];
        var c = contactFor(a, from, person && person.name);
        var chat = opts.group ? groupNamed(a, opts.group, opts.members || [from]) : chatWith(a, c, !person);
        var m = addMsg(a, chat, c.id, text, opts.file ? { viewType: "Image", file: opts.file, fileMime: opts.fileMime || "image/jpeg",
                                                           fileName: opts.file.replace(/^.*\//, "") } : null);
        m.rfc724Mid = mail.mid;
        if (a.io) { m.announced = true; emit(a.id, { kind: "IncomingMsg", chatId: chat.id, msgId: m.id }); }
        return m;
    }

    // Someone the user wrote to: delivered, read, answered.
    function answer(a, chat, m) {
        var contact = a.contacts[chat.contactIds[chat.type === "Single" ? 0 : 1]];
        later(function () {
            if (!accounts[a.id]) return;
            m.state = STATE.OUT_DELIVERED;
            emit(a.id, { kind: "MsgDelivered", chatId: chat.id, msgId: m.id });
            var person = contact && people.filter(function (p) { return p.addr === contact.address; })[0];
            if (!person || !person.replies || !person.replies.length) return;
            later(function () {
                if (!accounts[a.id]) return;
                m.state = STATE.OUT_MDN_RCVD;
                emit(a.id, { kind: "MsgRead", chatId: chat.id, msgId: m.id });
                var n = person.replied || 0;
                person.replied = n + 1;
                var text = person.replies[n % person.replies.length];
                arrive(addrOf(a), person.addr, text, chat.type === "Group" ? { group: chat.name } : null);
            }, replyDelay);
        }, replyDelay);
    }

    // The new account's first messages: the people's greetings, the groups' talk.
    function welcome(a) {
        var me = addrOf(a);
        people.forEach(function (p) { if (p.greeting) arrive(me, p.addr, p.greeting); });
        (o.groups || []).forEach(function (g) {
            g.messages.forEach(function (x) { arrive(me, x[0], x[1], { group: g.name, members: g.members }); });
        });
    }

    function configure(a, addr, password) {
        addr = String(addr || "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw err("Invalid email address: " + addr);
        var dom = addr.slice(addr.indexOf("@") + 1);
        if (dom !== domain) throw err(o.elsewhere || "Could not find your mail server for " + dom + ": connection refused");
        if (unauthorized || !(o.acceptAny ? password : users[addr] === password))
            throw err("Cannot login as \"" + addr + "\". Please check if the email address and the password are correct.");
        var first = !a.configured;
        a.config.addr = addr;
        a.config.configured_addr = addr;
        a.config.mail_pw = password;
        a.config.configured_mail_pw = password;
        a.configured = true;
        if (first) {
            // A new address is welcomed; a known one's mailbox is fetched again.
            if (!mailboxes[addr]) welcome(a);
            else mailboxes[addr].forEach(function (mail) { arrive(addr, mail.from, mail.text, mail.opts, mail); });
        }
        return null;
    }

    // ---- The methods -----------------------------------------------------------------------
    var methods = {
        get_system_info: function () { return { deltachat_core_version: o.coreVersion || "v2.63.0 (fake)", arch: "fake", num_cpus: "1" }; },
        get_all_account_ids: function () { return Object.keys(accounts).map(Number); },
        add_account: function () { return newAccount().id; },
        remove_account: function (id) { acct(id); delete accounts[id]; return null; },
        is_configured: function (id) { return acct(id).configured; },
        get_config: function (id, key) { var v = acct(id).config[key]; return v === undefined ? null : String(v); },
        set_config: function (id, key, value) { acct(id).config[key] = value; return null; },
        batch_set_config: function (id, cfg) { Object.assign(acct(id).config, cfg); return null; },
        configure: function (id) { var a = acct(id); return configure(a, a.config.addr, a.config.mail_pw); },
        add_or_update_transport: function (id, p) { return configure(acct(id), p && p.addr, p && p.password); },
        add_transport_from_qr: function (id, qr) {
            var m = /^dcaccount:(?:https:\/\/)?([^/]+)/i.exec(String(qr || ""));
            if (!m || m[1] !== domain) throw err("Not a chatmail server: " + qr);
            var addr = Math.random().toString(36).slice(2, 10) + "@" + domain;
            var pw = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
            users[addr] = pw;
            return configure(acct(id), addr, pw);
        },
        start_io: function (id) {
            var a = acct(id);
            if (a.io) return null;
            a.io = true;
            // What arrived while it was off.
            Object.keys(a.msgs).forEach(function (k) {
                var m = a.msgs[k];
                if (m.fromId !== SELF && m.state === STATE.IN_FRESH && !m.announced) { m.announced = true; emit(a.id, { kind: "IncomingMsg", chatId: m.chatId, msgId: m.id }); }
            });
            return null;
        },
        stop_io: function (id) { acct(id).io = false; return null; },
        maybe_network: function () { return null; },
        get_connectivity: function (id) { acct(id); return unauthorized || throttled ? 1000 : 4000; },
        get_connectivity_html: function (id) {
            acct(id);
            if (unauthorized) return "<html><body><ul><li>Inbox: Error: Cannot login as \"" + addrOf(accounts[id]) + "\". Please check if the email address and the password are correct.</li></ul></body></html>";
            if (throttled) return "<html><body><ul><li>Outgoing: Error: 450 4.7.1 Rate limit exceeded, try again in " + throttled + " seconds</li></ul></body></html>";
            return "<html><body><ul><li>Inbox: Connected</li><li>Outgoing: Connected</li></ul></body></html>";
        },
        get_chatlist_entries: function (id) {
            var a = acct(id);
            return Object.keys(a.chats).map(Number).sort(function (x, y) { return y - x; });
        },
        get_basic_chat_info: function (id, chatId) { var c = acct(id).chats[chatId]; if (!c) throw err("no chat " + chatId); return chatJson(c, false); },
        get_full_chat_by_id: function (id, chatId) { var c = acct(id).chats[chatId]; if (!c) throw err("no chat " + chatId); return chatJson(c, true); },
        accept_chat: function (id, chatId) { var c = acct(id).chats[chatId]; if (c) c.isContactRequest = false; return null; },
        get_message_ids: function (id, chatId) {
            var a = acct(id);
            return Object.keys(a.msgs).map(Number).filter(function (k) { return a.msgs[k].chatId === chatId; }).sort(function (x, y) { return x - y; });
        },
        get_message: function (id, msgId) { var a = acct(id); var m = a.msgs[msgId]; if (!m) throw err("no message " + msgId); return msgJson(a, m); },
        get_message_info_object: function (id, msgId) {
            var m = acct(id).msgs[msgId];
            if (!m) throw err("no message " + msgId);
            return { rfc724Mid: m.rfc724Mid, serverUrls: [], error: null, ephemeralTimer: { kind: "disabled" }, ephemeralTimestamp: null };
        },
        get_contact: function (id, contactId) { var c = acct(id).contacts[contactId]; if (!c) throw err("no contact " + contactId); return contactJson(c); },
        lookup_contact_id_by_addr: function (id, addr) {
            var a = acct(id);
            var c = Object.keys(a.contacts).map(function (k) { return a.contacts[k]; }).filter(function (x) { return x.address === String(addr).toLowerCase(); })[0];
            return c ? c.id : null;
        },
        create_contact: function (id, addr, name) {
            if (!/^[^@\s]+@[^@\s]+$/.test(String(addr))) throw err("Bad address: " + addr);
            return contactFor(acct(id), addr, name || "").id;
        },
        create_chat_by_contact_id: function (id, contactId) {
            var a = acct(id);
            if (!a.contacts[contactId]) throw err("no contact " + contactId);
            return chatWith(a, a.contacts[contactId], false).id;
        },
        markseen_msgs: function (id, ids) {
            var a = acct(id);
            (ids || []).forEach(function (k) { var m = a.msgs[k]; if (m && m.fromId !== SELF) { m.state = STATE.IN_SEEN; m.seen = true; } });
            return null;
        },
        misc_send_text_message: function (id, chatId, text) { return send(id, chatId, { text: text }); },
        send_msg: function (id, chatId, data) { return send(id, chatId, data || {}); }
    };
    function send(id, chatId, data) {
        var a = acct(id);
        var chat = a.chats[chatId];
        if (!chat) throw err("no chat " + chatId);
        if (!a.io) throw err("Delta Chat's I/O is not started");
        var extra = data.file ? { viewType: data.viewtype || "File", file: data.file, fileName: data.filename || data.file.replace(/^.*\//, ""),
                                  fileMime: /\.png$/i.test(data.file) ? "image/png" : "image/jpeg" } : null;
        var m = addMsg(a, chat, SELF, data.text || "", extra);
        m.rfc724Mid = "Mr." + (++midSeq).toString(36) + ".out@" + domain;
        sentLog.push({ from: addrOf(a), to: chat.type === "Single" ? a.contacts[chat.contactIds[0]].address : chat.name, text: m.text, file: m.file });
        answer(a, chat, m);
        return m.id;
    }

    function handle(proc, line) {
        var req;
        try { req = JSON.parse(line); } catch (e) { return; }
        var reply = function (result, error) {
            if (proc.dead) return;
            var out = { jsonrpc: "2.0", id: req.id };
            if (error) out.error = { code: error.code || -1, message: error.message };
            else out.result = result;
            proc.lines.forEach(function (f) { f(JSON.stringify(out)); });
        };
        if (req.method === "get_next_event") {
            if (events.length) return reply(events.shift());
            waiters.push(function (ev) { setTimeout(function () { reply(ev); }, 0); });
            return;
        }
        count++;
        var fn = methods[req.method];
        setTimeout(function () {
            if (!fn) return reply(null, { code: -32601, message: "Method not found: " + req.method });
            try { reply(fn.apply(null, req.params || [])); } catch (e) { reply(null, e); }
        }, 0);
    }

    var server = {
        process: function () {
            var proc = { lines: [], exits: [], dead: false };
            procs.push(proc);
            return {
                send: function (line) { if (!proc.dead) handle(proc, line); },
                onLine: function (f) { proc.lines.push(f); },
                onExit: function (f) { proc.exits.push(f); },
                kill: function () {
                    if (proc.dead) return;
                    proc.dead = true;
                    proc.exits.forEach(function (f) { f(0); });
                }
            };
        },
        deliver: function (from, user, text, opts) {
            opts = opts || {};
            user = user || server.signedIn();
            if (opts.picture) {
                var last = sentLog.filter(function (s) { return s.file; }).pop();
                if (!last) return null;
                return arrive(user, from, "", { file: last.file });
            }
            return arrive(user, from, text, opts);
        },
        signedIn: function () {
            var a = Object.keys(accounts).map(function (k) { return accounts[k]; }).filter(function (x) { return x.configured; })[0];
            return a ? addrOf(a) : null;
        },
        seen: function (user) {
            var a = Object.keys(accounts).map(function (k) { return accounts[k]; }).filter(function (x) { return addrOf(x) === user; })[0];
            return a ? Object.keys(a.msgs).map(function (k) { return a.msgs[k]; }).filter(function (m) { return m.seen; }).map(function (m) { return m.text; }) : [];
        },
        accounts: function () { return Object.keys(accounts).length; },
        unauthorized: function (on) { unauthorized = on !== false; },
        throttle: function (seconds) { throttled = seconds || 0; },
        requests: function () { return count; },
        sent: function () { return sentLog.slice(); },
        request: function () { return Promise.reject(new Error("Delta Chat does not use HTTP")); },
        close: function () {
            closed = true;
            timers.forEach(clearTimeout);
            procs.forEach(function (p) { if (!p.dead) { p.dead = true; p.exits.forEach(function (f) { f(0); }); } });
            return Promise.resolve();
        }
    };
    return server;
}

// The simulator's demo: chatmail.example, where any address signs in, and
// "dcaccount:chatmail.example" makes one, as a chatmail server does.
function demoRpcServer(o) {
    return createFakeRpcServer(Object.assign({
        domain: "chatmail.example", acceptAny: true, replyDelay: 1500, coreVersion: "simulator demo",
        elsewhere: "The simulator has no Delta Chat core: only its demo addresses, at chatmail.example, sign in.",
        people: [
            { addr: "sam.delgado@chatmail.example", name: "Sam Delgado", greeting: "Welcome to Delta Chat on Phoenix!",
              replies: ["Got it, end to end encrypted.", "Nice picture!"] },
            { addr: "priya@chatmail.example", name: "Priya Nair", greeting: "Hi! This came by email, encrypted." }
        ],
        groups: [{ name: "Phoenix Testers", members: ["sam.delgado@chatmail.example", "priya@chatmail.example"],
                   messages: [["sam.delgado@chatmail.example", "Build 42 boots on the Pre 3."], ["priya@chatmail.example", "Cards are back!"]] }]
    }, o || {}));
}

module.exports = { createFakeRpcServer: createFakeRpcServer, demoRpcServer: demoRpcServer, STATE: STATE, SELF: SELF, DEVICE: DEVICE };
