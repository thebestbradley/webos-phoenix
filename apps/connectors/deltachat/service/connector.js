// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Delta Chat account (template com.webosphoenix.deltachat), on the
// connector kit: chat over email, end-to-end encrypted by Delta Chat's
// core (Autocrypt; chatmail servers take nothing else). The IM transport
// webOS's libpurple accounts were, for a network with no company in the
// middle:
//
//   the core     Delta Chat's own Rust core (chatmail/core, MPL-2.0) does
//                the mail, the keys and the encryption, as a separate
//                program the image installs: deltachat-rpc-server, JSON-RPC
//                on its standard input and output (lib/rpc.js). The
//                connector starts it as a system helper (ctx.helper; the
//                kit's device.ts gives it DC_ACCOUNTS_PATH in the service's
//                own folder) and never links it: Phoenix's code stays
//                Apache-2.0, the core's files stay MPL-2.0 and unmodified
//                (meta-phoenix/recipes-connectors/deltachat-rpc-server).
//                A build without it says so on the sign-in page
//                (HELPER_NOT_AVAILABLE: "not available in this build").
//   sign-in      an email address and its password (the core finds the
//                servers), or a new address on a chatmail server
//                ("dcaccount:" + the server, as Delta Chat's own apps make one)
//   MESSAGING    chats as Messaging conversations, com.palm.immessage.deltachat:1
//                (the fields the libpurple transport wrote, imlibpurpleservice
//                src/IMMessage.cpp; chatType, channelName and
//                channelDisplayName for groups, inc/IMMessage.h): a one-to-one
//                chat by the other person's address, a group as its own
//                conversation with its people's names before their lines.
//                Pictures both ways; "Delivered" when the server took it,
//                "Read" when a read receipt came back; what is read here
//                sends read receipts (markseen_msgs)
//   CONTACTS     the people of your one-to-one chats (com.palm.contact.deltachat:1,
//                read only), their address as an IM address
//
// The connection (definition.connection) is the core's I/O for the
// account (start_io), and its events (get_next_event) while it runs.
// Delta Chat has no presence: the account is online while the core is
// connected, and "offline" stops its I/O.

"use strict";

var kit = require("@phoenix/connector-kit");
var R = require("./lib/rpc");

var SERVICE = "org.webosphoenix.service.deltachat";
var TEMPLATE = "com.webosphoenix.deltachat";
var HELPER = "deltachat-rpc-server";
var MESSAGING_APP = "org.webosphoenix.messaging";
var IM_SERVICE = "type_deltachat";
var MESSAGE_KIND = "com.palm.immessage.deltachat:1";
var CONTACT_KIND = "com.palm.contact.deltachat:1";
var LOGIN_KIND = "com.palm.imloginstate.deltachat:1";
var THREAD_KIND = "com.palm.chatthread:1";
var PROVIDERS = { contacts: TEMPLATE + ".contacts", messaging: TEMPLATE + ".im" };
var SELF = 1;                       // DC_CONTACT_ID_SELF
var FIRST_HISTORY = 10;
var MAX_PICTURE = 10 * 1024 * 1024;
var GROUP_PREFIX = "deltachat-group:";
var STATE = { OUT_FAILED: 24, OUT_DELIVERED: 26, OUT_MDN_RCVD: 28 };
var CONNECTED = 4000, CONNECTING = 2000;  // DC_CONNECTIVITY_*
var NOT_IN_BUILD = "Delta Chat is not available in this build: its core (deltachat-rpc-server) is not installed on this device.";

function fail(message, errorCode, extra) { return Object.assign(new Error(message), { errorCode: errorCode }, extra || {}); }

// The core, started once for every account of the service.
function coreOf(ctx) {
    return ctx.helper(HELPER).then(function (proc) { return R.rpcOf(proc, ctx.log); }, function (e) {
        if (e.errorCode === "HELPER_NOT_AVAILABLE") throw fail(NOT_IN_BUILD, "HELPER_NOT_AVAILABLE");
        throw e;
    });
}

// An address and password -> the core's transport for them (deltachat-jsonrpc
// add_or_update_transport; set_config and configure on a core before 2025-04).
function login(rpc, id, addr, password) {
    var param = { addr: addr, password: password, imapServer: null, imapPort: null, imapFolder: null, imapSecurity: null, imapUser: null,
                  smtpServer: null, smtpPort: null, smtpSecurity: null, smtpUser: null, smtpPassword: null, certificateChecks: null };
    return rpc.call("add_or_update_transport", [id, param]).catch(function (e) {
        if (e.errorCode !== "METHOD_NOT_FOUND") throw e;
        return rpc.call("batch_set_config", [id, { addr: addr, mail_pw: password }]).then(function () { return rpc.call("configure", [id]); });
    });
}

function signInError(e) {
    // The core's errors come as 'Error:\n\n“IMAP failed to connect ...”' (2.63): its words only.
    var m = String(e.message || "").replace(/^\s*Error:\s*/, "").replace(/^[“"]|[”"]$/g, "").trim();
    if (e.errorCode === "HELPER_NOT_AVAILABLE" || e.errorCode === "HELPER_EXITED") return e;
    if (/cannot log ?in|password|authenticat/i.test(m)) return fail("Wrong email address or password", "401_UNAUTHORIZED");
    if (/invalid email|bad address/i.test(m)) return fail("That is not an email address", "INVALID_USER");
    if (/not a chatmail|qr/i.test(m)) return fail("That is not a chatmail server", "INVALID_USER");
    return fail(m || "Delta Chat could not sign in", "DELTACHAT_ERROR");
}

// The core's account of a Phoenix account: by its address (the core keeps
// it across restarts); made again from the kept password if the core lost it.
function coreAccount(ctx, rpc) {
    var addr = String(ctx.config.addr || (ctx.account && ctx.account.username) || "").toLowerCase();
    var st = ctx.state;
    function addrOf(id) { return rpc.call("get_config", [id, "configured_addr"]).then(function (a) { return String(a || "").toLowerCase(); }, function () { return ""; }); }
    return rpc.call("get_all_account_ids", []).then(function (ids) {
        var chain = Promise.resolve(null);
        var order = (st.dc ? [st.dc.id] : []).concat(ctx.config.dcAccountId ? [ctx.config.dcAccountId] : []).concat(ids);
        order.filter(function (id, i) { return ids.indexOf(id) >= 0 && order.indexOf(id) === i; }).forEach(function (id) {
            chain = chain.then(function (found) { return found !== null ? found : addrOf(id).then(function (a) { return a && a === addr ? id : null; }); });
        });
        return chain;
    }).then(function (id) {
        if (id !== null) {
            if (!st.dc || st.dc.id !== id) st.dc = { id: id, tag: id + "." + ctx.now().toString(36) };
            return id;
        }
        var pw = ctx.credentials && ctx.credentials.password;
        if (!pw) throw fail("Delta Chat's core no longer has this account: sign in again", "401_UNAUTHORIZED");
        ctx.log("the core lost the account; signing in again");
        return rpc.call("add_account", []).then(function (nid) {
            return login(rpc, nid, addr, pw).then(function () {
                st.dc = { id: nid, tag: nid + "." + ctx.now().toString(36) };
                st.last = {};
                return nid;
            }, function (e) {
                return rpc.call("remove_account", [nid]).catch(function () {}).then(function () { throw signInError(e); });
            });
        });
    });
}

// ---- The connection ---------------------------------------------------------------------------

function createSession(ctx) {
    var own = String(ctx.config.addr || (ctx.account && ctx.account.username) || "").toLowerCase();
    var st = ctx.state;
    st.chats = st.chats || {};          // chatId -> {a: the other's address (one to one), n: name, g: 1 group}
    st.last = st.last || {};            // chatId -> the last message id filed
    var me = { closed: false, rpc: null, id: null, stop: null, offline: false, online: false, flushing: null, filing: Promise.resolve(),
               messaging: (ctx.account.capabilityProviders || []).some(function (c) { return c.id === PROVIDERS.messaging; }) };

    function log(m) { ctx.log(m); }
    function call(method, params) { return me.rpc.call(method, [me.id].concat(params || [])); }
    // A message's id in Messaging: its Message-ID, the same on every device
    // and in a core that fetched the mailbox again (get_message_info_object).
    function sid(msgId) {
        return call("get_message_info_object", [msgId]).then(function (i) { return (i && i.rfc724Mid) || null; }, function () { return null; })
            .then(function (mid) { return mid || "dc:" + st.dc.tag + ":" + msgId; });
    }

    function setLogin(fields) {
        if (!me.messaging) return Promise.resolve();
        return ctx.db.find({ from: LOGIN_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] }).then(function (r) {
            var cur = r[0];
            if (!cur) {
                if (me.closed) return null;
                return ctx.db.put([Object.assign({ _kind: LOGIN_KIND, accountId: ctx.accountId, username: own, serviceName: IM_SERVICE,
                                                   state: "offline", availability: 0, customMessage: "" }, fields)]);
            }
            var changed = Object.keys(fields).some(function (k) { return cur[k] !== fields[k]; });
            return changed ? ctx.db.merge([Object.assign({ _id: cur._id }, fields)]) : null;
        }).catch(function () {});
    }

    // A chat: one to one (the other person's address) or a group; skipped: the device's own chat, saved messages.
    function chatOf(chatId) {
        if (st.chats[chatId]) return Promise.resolve(st.chats[chatId]);
        return call("get_full_chat_by_id", [chatId]).then(function (c) {
            if (c.isDeviceChat || c.isSelfTalk) return (st.chats[chatId] = { skip: 1 });
            var single = c.chatType === "Single" || c.chatType === 100;
            if (!single) return (st.chats[chatId] = { g: 1, n: c.name || "Group" });
            var other = (c.contactIds || []).filter(function (x) { return x !== SELF; })[0];
            return call("get_contact", [other]).then(function (p) {
                return (st.chats[chatId] = { a: String(p.address).toLowerCase(), n: p.displayName || p.authName || p.address, r: c.isContactRequest ? 1 : undefined });
            });
        });
    }

    function known(serviceMessageId) {
        return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "username", op: "=", val: own }, { prop: "serviceMessageId", op: "=", val: serviceMessageId }] })
            .then(function (r) { return r[0] || null; });
    }

    function picture(m) {
        if (!m.file) return Promise.resolve(null);
        return ctx.readFile(m.file).then(function (f) {
            if (!f.bytes || f.bytes.length > MAX_PICTURE) return null;
            var name = String(m.fileName || m.file.replace(/^.*\//, "") || "picture").replace(/[^\w.-]+/g, "_").slice(0, 80);
            var type = m.fileMime || f.mimeType || "image/jpeg";
            return ctx.writeFile(Date.now().toString(36) + "-" + name, f.bytes, type).then(function (path) {
                return { path: path, mimeType: type, name: name };
            });
        }).catch(function (e) { log("picture not kept: " + e.message); return null; });
    }

    // A message of the core's into Messaging (once: by its id).
    function file(msgId, how) {
        if (!me.messaging) return Promise.resolve();
        var id;
        return sid(msgId).then(function (s) { id = s; return known(id); }).then(function (found) {
            if (found) return null;
            return call("get_message", [msgId]).then(function (m) {
                if (m.isInfo) return null;
                return chatOf(m.chatId).then(function (chat) {
                    if (chat.skip) return null;
                    var outgoing = m.fromId === SELF;
                    var isPicture = (m.viewType === "Image" || m.viewType === "Gif" || m.viewType === "Sticker") && !!m.file;
                    var text = String(m.text || "");
                    if (!isPicture && m.file) text = "File: " + (m.fileName || m.file.replace(/^.*\//, "")) + (text ? "\n" + text : "");
                    return (isPicture ? picture(m) : Promise.resolve(null)).then(function (part) {
                        if (isPicture && !part) text = "Picture" + (text ? ": " + text : "");
                        var senderName = (m.sender && (m.sender.displayName || m.sender.address)) || "";
                        if (chat.g && !outgoing && text) text = senderName + ": " + text;
                        var ts = (m.timestamp || Math.floor(ctx.now() / 1000)) * 1000;
                        var msg = {
                            _kind: MESSAGE_KIND, accountId: ctx.accountId, serviceName: IM_SERVICE, username: own,
                            folder: outgoing ? "outbox" : "inbox", status: "successful", messageText: text,
                            localTimestamp: how.history ? ts : ctx.now(), timestamp: ts, flags: { read: outgoing || !!how.read, visible: true },
                            serviceMessageId: id, deltachat: { chatId: m.chatId, msgId: msgId }
                        };
                        if (outgoing && m.state >= STATE.OUT_DELIVERED) msg.deliveryStatus = m.state === STATE.OUT_MDN_RCVD ? "read" : "delivered";
                        var addr = chat.g ? { addr: GROUP_PREFIX + m.chatId, name: chat.n } : { addr: chat.a, name: chat.n };
                        if (outgoing) msg.to = [addr];
                        else msg.from = chat.g ? addr : { addr: chat.a, name: senderName || chat.n };
                        if (chat.g) { msg.chatType = "groupchat"; msg.channelName = GROUP_PREFIX + m.chatId; msg.channelDisplayName = chat.n; }
                        if (part) msg.parts = [part];
                        return ctx.putMessage(msg).then(function (r) {
                            if (outgoing || how.read || how.quiet) return r;
                            return ctx.notify({ title: chat.g ? chat.n : msg.from.name, body: part ? "Picture" : text, appId: MESSAGING_APP,
                                                params: { threadId: (r && r.threadids && r.threadids[0]) || "" } });
                        });
                    });
                });
            });
        }).then(function () {
            return null;
        });
    }

    // Our message's state, from the core's events.
    function delivered(msgId, status, retry) {
        return sid(msgId).then(known).then(function (m) {
            // Sent a moment ago, its id not written yet: after the sending.
            if (!m && me.flushing && !retry) return me.flushing.then(function () { return delivered(msgId, status, true); });
            if (!m) return null;
            if (status === "failed") return ctx.db.merge([{ _id: m._id, status: "failed", errorText: "Not delivered" }]);
            if (m.deliveryStatus === "read" || m.deliveryStatus === status) return null;
            return ctx.db.merge([{ _id: m._id, deliveryStatus: status }]);
        });
    }

    // One event at a time, in order.
    function onEvent(ev) {
        if (me.closed) return;
        me.filing = me.filing.then(function () {
            switch (ev.kind) {
            case "IncomingMsg": return file(ev.msgId, {}).then(function () { return remember(ev.chatId, ev.msgId); });
            case "MsgDelivered": return delivered(ev.msgId, "delivered");
            case "MsgRead": return delivered(ev.msgId, "read");
            case "MsgFailed": return delivered(ev.msgId, "failed");
            case "ConnectivityChanged": return connectivity();
            case "ChatModified": delete st.chats[ev.chatId]; return null;
            default: return null;
            }
        }).catch(function (e) { log("event " + ev.kind + ": " + e.message); }).then(save);
    }
    function remember(chatId, msgId) { if ((st.last[chatId] || 0) < msgId) st.last[chatId] = msgId; }

    function connectivity() {
        if (me.offline) return setLogin({ state: "offline" });
        return call("get_connectivity").then(function (c) {
            me.online = c >= CONNECTED;
            return setLogin({ state: c >= CONNECTED ? "online" : c >= CONNECTING ? "logging-on" : "offline" });
        });
    }

    // What the core has that Messaging has not: the newest few of each chat the
    // first time, everything after the last one filed from then on.
    function catchUp(first) {
        return call("get_chatlist_entries", [0, null, null]).then(function (chats) {
            var chain = Promise.resolve();
            chats.forEach(function (chatId) {
                chain = chain.then(function () {
                    return chatOf(chatId).then(function (chat) {
                        if (chat.skip) return null;
                        return call("get_message_ids", [chatId, false, false]).then(function (ids) {
                            var since = st.last[chatId] || 0;
                            var todo = since ? ids.filter(function (x) { return x > since; }) : ids.slice(-FIRST_HISTORY);
                            var c2 = Promise.resolve();
                            todo.forEach(function (msgId) {
                                c2 = c2.then(function () { return file(msgId, first || !since ? { history: true, read: true } : {}); })
                                       .then(function () { remember(chatId, msgId); });
                            });
                            return c2;
                        });
                    });
                });
            });
            return chain;
        });
    }

    var saved = JSON.stringify(st);
    function save() {
        var now = JSON.stringify(st);
        if (now === saved) return Promise.resolve();
        saved = now;
        return ctx.saveState();
    }

    // The core's own account of how it is connected, as the sync's answer:
    // a refused password or a server's rate limit (Delta Chat's connectivity
    // view, get_connectivity_html, says which).
    function health() {
        return call("maybe_network").then(function () { return call("get_connectivity"); }).then(function (c) {
            if (c >= CONNECTING) return null;
            return call("get_connectivity_html").then(function (html) {
                // The page's words (it starts with a style sheet: deltachat-rpc-server 2.63).
                var text = String(html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
                if (/cannot log ?in|authentication failed|invalid credentials|password/i.test(text))
                    throw fail("The mail server refused the password: sign in again", "401_UNAUTHORIZED");
                var limit = /rate ?limit|too many/i.exec(text);
                if (limit) {
                    var secs = Number((/(\d+)\s*s(?:ec|econds)?\b/i.exec(text) || [])[1]) || 600;
                    throw fail("The mail server limits how often it is used", "503_SERVICE_UNAVAILABLE", { retryAt: ctx.now() + secs * 1000 });
                }
                return null;
            });
        });
    }

    // ---- What goes out -------------------------------------------------------------------------

    function chatFor(to) {
        if (to.indexOf(GROUP_PREFIX) === 0) return Promise.resolve(Number(to.slice(GROUP_PREFIX.length)));
        return call("lookup_contact_id_by_addr", [to]).then(function (cid) {
            return cid ? cid : call("create_contact", [to, null]);
        }).then(function (cid) { return call("create_chat_by_contact_id", [cid]); }).then(function (chatId) {
            // Writing to someone accepts their contact request.
            var c = st.chats[chatId];
            if (c && c.r) { delete c.r; return call("accept_chat", [chatId]).catch(function () {}).then(function () { return chatId; }); }
            return chatId;
        });
    }

    function sendOne(m) {
        var to = m.to && m.to[0] && String(m.to[0].addr || "").toLowerCase();
        if (!to) return ctx.db.merge([{ _id: m._id, status: "permanent-fail" }]);
        return ctx.db.merge([{ _id: m._id, status: "sending", accountId: ctx.accountId }]).then(function () {
            return chatFor(to);
        }).then(function (chatId) {
            var pictures = (m.parts || []).filter(function (p) { return /^image\//.test(p.mimeType || "") && p.path; });
            var chain = Promise.resolve(), last = null;
            pictures.forEach(function (p, i) {
                chain = chain.then(function () {
                    // The text goes with the last picture, as Delta Chat sends a captioned picture.
                    var caption = i === pictures.length - 1 ? m.messageText || null : null;
                    return call("send_msg", [chatId, { text: caption, html: null, viewtype: "Image", file: p.path, filename: p.name || null,
                                                       location: null, overrideSenderName: null, quotedMessageId: null, quotedText: null }]);
                }).then(function (id) { last = id; });
            });
            if (m.messageText && !pictures.length) chain = chain.then(function () {
                return call("misc_send_text_message", [chatId, m.messageText]).then(function (id) { last = id; });
            });
            return chain.then(function () {
                if (last) remember(chatId, last);
                return (last ? sid(last) : Promise.resolve("")).then(function (s) {
                    return ctx.db.merge([{ _id: m._id, status: "successful", serviceMessageId: s, deltachat: { chatId: chatId, msgId: last } }]);
                });
            });
        }).catch(function (e) {
            log("message not sent: " + e.message);
            var permanent = /bad address|invalid|no contact/i.test(e.message || "");
            return ctx.db.merge([{ _id: m._id, status: permanent ? "permanent-fail" : "failed", errorText: e.message }]);
        });
    }
    function flush(onlyId) {
        if (!me.messaging) return Promise.resolve({ sent: 0 });
        if (me.flushing) return me.flushing.then(function () { return flush(onlyId); });
        me.flushing = ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] })
            .then(function (pending) {
                pending = pending.filter(function (m) { return m.username === own && (!onlyId || m._id === onlyId); })
                    .sort(function (a, b) { return (a.localTimestamp || 0) - (b.localTimestamp || 0); });
                if (me.offline) {
                    return pending.length ? ctx.db.merge(pending.map(function (m) { return { _id: m._id, status: "failed", errorText: "Offline" }; }))
                        .then(function () { return { sent: 0 }; }) : { sent: 0 };
                }
                var chain = Promise.resolve();
                pending.forEach(function (m) { chain = chain.then(function () { return sendOne(m); }); });
                return chain.then(save).then(function () { return { sent: pending.length }; });
            }).then(function (r) { me.flushing = null; return r; }, function (e) { me.flushing = null; throw e; });
        return me.flushing;
    }

    var handle = {
        get closed() { return me.closed || !!(me.rpc && me.rpc.closed); },
        syncNow: function () {
            if (me.offline) return Promise.resolve();
            return health().then(function () {
                // In turn with the events; a failed catch-up fails this sync, not the next ones.
                var run = me.filing.then(function () { return catchUp(false); });
                me.filing = run.catch(function () {});
                return run;
            }).then(save).then(function () { return flush(); });
        },
        people: function () {
            var out = {};
            Object.keys(st.chats).forEach(function (id) {
                var c = st.chats[id];
                if (c.a && !out[c.a]) out[c.a] = c.n;
            });
            return Promise.resolve(out);
        },
        flush: flush,
        // Read here: read receipts to the senders (the core sends them, MDNs).
        markRead: function (threadId) {
            return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "conversations", op: "=", val: threadId }] }).then(function (msgs) {
                var ids = msgs.filter(function (m) { return m.folder === "inbox" && m.deltachat && m.deltachat.msgId && !(m.deltachat.seen); });
                if (!ids.length) return { marked: false };
                return call("markseen_msgs", [ids.map(function (m) { return m.deltachat.msgId; })]).then(function () {
                    return ctx.db.merge(ids.map(function (m) { return { _id: m._id, deltachat: Object.assign({}, m.deltachat, { seen: true }) }; }));
                }).then(function () { return { marked: true }; });
            });
        },
        // No presence in Delta Chat: offline stops the core's I/O for the account.
        setPresence: function (availability) {
            if (availability === 4) {
                me.offline = true;
                return call("stop_io").then(function () { return setLogin({ state: "offline", availability: 4 }); });
            }
            var was = me.offline;
            me.offline = false;
            return call("start_io").then(function () { return setLogin({ availability: availability }); })
                .then(connectivity).then(function () { return was ? handle.syncNow() : null; });
        },
        close: function () {
            me.closed = true;
            if (me.stop) me.stop();
            me.online = false;
            var stopped = me.rpc && !me.rpc.closed ? call("stop_io").catch(function () {}) : Promise.resolve();
            return stopped.then(function () { return setLogin({ state: "offline" }); });
        }
    };

    return coreOf(ctx).then(function (rpc) {
        me.rpc = rpc;
        return coreAccount(ctx, rpc);
    }).then(function (id) {
        me.id = id;
        me.stop = me.rpc.onEvent(id, onEvent);
        return ctx.db.find({ from: LOGIN_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] });
    }).then(function (s) {
        if (s[0] && s[0].availability === 4) me.offline = true;
        return setLogin({ state: me.offline ? "offline" : "logging-on" });
    }).then(function () {
        if (me.offline) return handle;
        return call("start_io").then(function () {
            me.filing = me.filing.then(function () { return catchUp(true); });
            return me.filing;
        }).then(save).then(connectivity).then(function () { return handle; });
    }).catch(function (e) {
        // Not opened: its events stop (the kit opens a new session next time).
        me.closed = true;
        if (me.stop) me.stop();
        throw e;
    });
}

// ---- Capabilities ---------------------------------------------------------------------------

function pullPeople(ctx) {
    return ctx.connect().then(function (live) { return live.people(); }).then(function (people) {
        return {
            full: true, nextToken: null,
            changes: Object.keys(people).map(function (addr) {
                return { remoteId: addr, etag: people[addr],
                         fields: { nickname: people[addr] === addr ? "" : people[addr], ims: [{ value: addr, type: IM_SERVICE }] } };
            })
        };
    });
}

function syncMessages(ctx) {
    return ctx.connect().then(function (live) { return live.syncNow(); });
}

function removeMessages(ctx) {
    var own = String(ctx.config.addr || (ctx.account && ctx.account.username) || "").toLowerCase();
    var live = ctx.live();
    return Promise.resolve(live && live.close()).then(function () {
        return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "username", op: "=", val: own }] });
    }).then(function (msgs) {
        var threads = {};
        msgs.forEach(function (m) { (m.conversations || []).forEach(function (t) { threads[t] = true; }); });
        return (msgs.length ? ctx.db.del(msgs.map(function (m) { return m._id; })) : Promise.resolve()).then(function () {
            return ctx.db.find({ from: THREAD_KIND, where: [{ prop: "replyService", op: "=", val: IM_SERVICE }] });
        }).then(function (all) {
            var ids = all.filter(function (t) { return threads[t._id] || (own && t.username === own); }).map(function (t) { return t._id; });
            return ids.length ? ctx.db.del(ids) : null;
        });
    }).then(function () {
        return ctx.db.find({ from: LOGIN_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] });
    }).then(function (s) { return s.length ? ctx.db.del(s.map(function (x) { return x._id; })) : null; });
}

// ---- Sign-in ---------------------------------------------------------------------------------

// {username: the address, password}, or {config: {chatmail: "server"}} for a new chatmail address.
function validate(ctx, p) {
    var c = p.config || {};
    var chatmail = c.chatmail ? String(c.chatmail).trim().replace(/^dcaccount:/i, "") : "";
    var addr = String(p.username || "").trim().toLowerCase();
    if (!chatmail && !/^[^@\s]+@[^@\s]+$/.test(addr)) return Promise.reject(fail("Enter your email address", "INVALID_USER"));
    if (!chatmail && !p.password) return Promise.reject(fail("Enter your password", "401_UNAUTHORIZED"));
    var rpc, id, made = false;
    return coreOf(ctx).then(function (r) {
        rpc = r;
        // Signing in again (a changed password): the core's account of that address.
        return chatmail ? null : rpc.call("get_all_account_ids", []).then(function (ids) {
            var chain = Promise.resolve(null);
            ids.forEach(function (x) {
                chain = chain.then(function (f) {
                    return f !== null ? f : rpc.call("get_config", [x, "configured_addr"]).then(function (a) { return String(a || "").toLowerCase() === addr ? x : null; });
                });
            });
            return chain;
        });
    }).then(function (existing) {
        if (existing !== null && existing !== undefined) return existing;
        made = true;
        return rpc.call("add_account", []);
    }).then(function (nid) {
        id = nid;
        return chatmail ? rpc.call("add_transport_from_qr", [id, "dcaccount:" + chatmail]) : login(rpc, id, addr, String(p.password));
    }).then(function () {
        return Promise.all([rpc.call("get_config", [id, "configured_addr"]), chatmail ? rpc.call("get_config", [id, "configured_mail_pw"]) : p.password]);
    }).then(function (r) {
        var got = String(r[0] || addr).toLowerCase();
        return {
            username: got,
            // The password stays with the account (as an email account's does): the core's
            // database lost, the account is set up again from it.
            credentials: { common: { password: String(r[1] || "") } },
            config: { addr: got, dcAccountId: id, chatmail: chatmail || undefined, e2ee: true }
        };
    }, function (e) {
        var undo = made && id !== undefined ? rpc.call("remove_account", [id]).catch(function () {}) : Promise.resolve();
        return undo.then(function () { throw signInError(e); });
    });
}

module.exports = kit.defineConnector({
    service: SERVICE,
    templateIds: [TEMPLATE],
    kinds: { state: "org.webosphoenix.deltachat.state:1", item: "org.webosphoenix.deltachat.item:1" },
    userAgent: "webOS-Phoenix-DeltaChat/0.1",
    helpers: [HELPER],
    // No account yet: a chatmail server makes one (the sign-in page), or Delta Chat's list of them.
    signUp: "https://chatmail.at/relays",

    validate: validate,

    capabilities: (function () {
        var caps = {};
        caps[PROVIDERS.contacts] = { capability: "CONTACTS", kind: CONTACT_KIND, fields: ["nickname", "ims"], pull: pullPeople, linkPersons: true };
        caps[PROVIDERS.messaging] = {
            capability: "MESSAGING", kind: MESSAGE_KIND, sync: syncMessages, remove: removeMessages,
            watch: { query: { from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] },
                     method: "outbox" }
        };
        return caps;
    })(),

    connection: { open: createSession },
    schedule: { every: "15m" },
    push: { unifiedPush: false },

    // The core's account goes too: its database, its keys.
    onDelete: function (ctx) {
        return coreOf(ctx).then(function (rpc) {
            return coreAccount(Object.assign({}, ctx, { credentials: {} }), rpc).then(function (id) {
                return rpc.call("stop_io", [id]).catch(function () {}).then(function () { return rpc.call("remove_account", [id]); });
            });
        }).catch(function (e) { ctx.log("the core's account not removed: " + e.message); });
    },

    methods: {
        // Whether this build has Delta Chat's core: the sign-in page asks first.
        available: function (ctx) {
            return coreOf(ctx).then(function (rpc) { return rpc.call("get_system_info", []); }).then(function (info) {
                return { available: true, core: (info && info.deltachat_core_version) || "" };
            }, function (e) {
                if (e.errorCode === "HELPER_NOT_AVAILABLE") return { available: false, reason: NOT_IN_BUILD };
                throw e;
            });
        },
        outbox: function (ctx, p) {
            if (p.accountId) return ctx.connect().then(function (live) { return live.flush(p.messageId); });
            return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] })
                .then(function (pending) {
                    var users = {};
                    pending.forEach(function (m) { if (!p.messageId || m._id === p.messageId) users[m.username] = true; });
                    return ctx.luna.call("luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE }).then(function (r) {
                        var chain = Promise.resolve(), sent = 0;
                        (r.results || []).filter(function (a) { return users[a.username]; }).forEach(function (a) {
                            chain = chain.then(function () {
                                return ctx.luna.call("luna://" + SERVICE + "/outbox", { accountId: a._id, messageId: p.messageId }).then(function (x) {
                                    if (x && x.returnValue === false) throw fail(x.errorText || "not sent", x.errorCode || "UNKNOWN_ERROR");
                                    sent += (x && x.sent) || 0;
                                });
                            });
                        });
                        return chain.then(function () { return { sent: sent }; });
                    });
                });
        },
        markRead: function (ctx, p) {
            var live = ctx.live();
            if (!live) return ctx.connectionsHere() ? Promise.resolve({ marked: false }) : Promise.reject(fail("Connections are kept elsewhere", "NOT_LIVE_HERE"));
            return live.markRead(p.threadId);
        },
        setPresence: function (ctx, p) {
            var a = Number(p.availability);
            if ([0, 1, 2, 3, 4].indexOf(a) < 0) return Promise.reject(fail("availability: 0, 2 or 4", "400_BAD_REQUEST"));
            return ctx.connect().then(function (live) { return live.setPresence(a === 4 ? 4 : 0); }).then(function () { return {}; });
        }
    }
});

module.exports.NOT_IN_BUILD = NOT_IN_BUILD;
