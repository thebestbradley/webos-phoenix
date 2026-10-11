// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Unofficial Telegram account (template com.webosphoenix.telegram;
// docs/SYNERGY-CONNECTORS.md 7, "Telegram"), on the connector kit. The IM
// transport webOS's libpurple accounts were, for the network most of its
// old users moved to:
//
//   the library  TDLib, Telegram's own client library (BSL-1.0), through its
//                JSON interface (td_json_client.h) put on standard input and
//                output by phoenix-tdjson, a system helper the image installs
//                (meta-phoenix/recipes-connectors/tdlib; lib/td.js). Each
//                account is one TDLib client with its own database folder
//                and encryption key (the key in the account's credentials).
//   the app id   Telegram's api_id and api_hash for Phoenix, a build-time
//                setting (/etc/phoenix/connectors/org.webosphoenix.service.
//                telegram.json, written by phoenix-tdjson's recipe from
//                local.conf; never in the source tree: docs/OPEN-QUESTIONS.md
//                Q16). A build without them, or without TDLib, says
//                "not available in this build" before asking anything.
//   the name     "Unofficial Telegram", not "Telegram", and its own picture,
//                not Telegram's (Telegram's API terms for third-party clients,
//                docs/SYNERGY-MODERN.md [T1]).
//   sign-in      the phone number, the code Telegram sends, and the two-step
//                password where there is one (signIn, then checkCredentials
//                with the finished session); a new number signs up in a
//                Telegram app, not here.
//   MESSAGING    private chats as the person's conversations (by their phone
//                number, else their username), groups as their own (chatType,
//                channelName, channelDisplayName, as LuneOS's imlibpurple
//                names them, inc/IMMessage.h), secret chats as their own
//                conversations on this device only, as in Telegram's apps.
//                Channels are not shown: Telegram's terms ask a client that
//                shows them to show their sponsored messages too, which
//                Messaging does not (docs/OPEN-QUESTIONS.md). Pictures both
//                ways; read receipts both ways (viewMessages,
//                updateChatReadOutbox). Not end-to-end encrypted but in
//                secret chats: Messaging says so (IM_SERVICES notPrivate).
//   CONTACTS     the people of your private chats (com.palm.contact.telegram:1,
//                read only), their phone number where Telegram shares it
//                (which links them to your address book), their username.

"use strict";

var kit = require("@phoenix/connector-kit");
var T = require("./lib/td");

var SERVICE = "org.webosphoenix.service.telegram";
var TEMPLATE = "com.webosphoenix.telegram";
var HELPER = "phoenix-tdjson";
var MESSAGING_APP = "org.webosphoenix.messaging";
var IM_SERVICE = "type_telegram";
var MESSAGE_KIND = "com.palm.immessage.telegram:1";
var CONTACT_KIND = "com.palm.contact.telegram:1";
var LOGIN_KIND = "com.palm.imloginstate.telegram:1";
var THREAD_KIND = "com.palm.chatthread:1";
var PROVIDERS = { contacts: TEMPLATE + ".contacts", messaging: TEMPLATE + ".im" };
var GROUP_PREFIX = "telegram-chat:";
var SECRET_PREFIX = "telegram-secret:";
var FIRST_HISTORY = 10;
var MAX_CHATS = 100;
var MAX_PICTURE = 10 * 1024 * 1024;
var SIGN_IN_MS = 10 * 60 * 1000;
var NO_APP_ID = "Unofficial Telegram is not available in this build: it was built without a Telegram app id.";
var NO_TDLIB = "Unofficial Telegram is not available in this build: Telegram's library (TDLib) is not installed on this device.";

function fail(message, errorCode, extra) { return Object.assign(new Error(message), { errorCode: errorCode }, extra || {}); }

function text(t) { return { "@type": "formattedText", text: String(t || ""), entities: [] }; }

function randomKey() {
    var b = new Uint8Array(32);
    var c = typeof globalThis !== "undefined" && globalThis.crypto;
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (var i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    var s = "";
    for (var j = 0; j < b.length; j++) s += String.fromCharCode(b[j]);
    return typeof btoa === "function" ? btoa(s) : Buffer.from(b).toString("base64");
}
function randomName() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

// This build's app id and TDLib, or why not.
function appOf(ctx) {
    return Promise.all([ctx.setting("apiId"), ctx.setting("apiHash")]).then(function (s) {
        if (!s[0] || !s[1]) throw fail(NO_APP_ID, "HELPER_NOT_AVAILABLE");
        return ctx.helper(HELPER).then(function (proc) {
            return { apiId: Number(s[0]), apiHash: String(s[1]), hub: T.hubOf(proc, ctx.log) };
        }, function (e) {
            if (e.errorCode === "HELPER_NOT_AVAILABLE") throw fail(NO_TDLIB, "HELPER_NOT_AVAILABLE");
            throw e;
        });
    });
}

// A TDLib client on its database folder: its authorization state followed
// (updateAuthorizationState), its parameters given when it asks.
function openClient(ctx, dir, dbKey) {
    return appOf(ctx).then(function (app) {
        return app.hub.ready().then(function (dataDir) {
            return app.hub.client().then(function (client) {
                var c = { app: app, client: client, state: null, waits: [], updates: [], dir: dir };
                function settle() {
                    if (!c.state) return;
                    c.waits = c.waits.filter(function (w) {
                        if (w.types.indexOf(c.state["@type"]) >= 0) { w.resolve(c.state); return false; }
                        if (c.state["@type"] === "authorizationStateClosed") { w.reject(fail("Telegram's session closed", "401_UNAUTHORIZED")); return false; }
                        return true;
                    });
                }
                client.onUpdate(function (u) {
                    if (u["@type"] === "updateAuthorizationState") {
                        c.state = u.authorization_state;
                        if (c.state["@type"] === "authorizationStateWaitTdlibParameters") {
                            var base = dataDir.replace(/\/$/, "") + "/" + dir;
                            client.send({
                                "@type": "setTdlibParameters", use_test_dc: false, database_directory: base, files_directory: base + "/files",
                                database_encryption_key: dbKey, use_file_database: true, use_chat_info_database: true,
                                use_message_database: true, use_secret_chats: true, api_id: app.apiId, api_hash: app.apiHash,
                                system_language_code: "en", device_model: "webOS Phoenix", system_version: "", application_version: "0.1"
                            }).catch(function (e) { ctx.log("parameters refused: " + e.message); });
                        }
                        settle();
                        if (c.state["@type"] === "authorizationStateClosed") client.forget();
                    }
                    c.updates.forEach(function (f) { f(u); });
                });
                client.onExit(function () {
                    c.state = { "@type": "authorizationStateClosed" };
                    settle();
                });
                // -> the state, once it is one of types.
                c.until = function (types) {
                    if (c.state && types.indexOf(c.state["@type"]) >= 0) return Promise.resolve(c.state);
                    return new Promise(function (resolve, reject) { c.waits.push({ types: types, resolve: resolve, reject: reject }); settle(); });
                };
                c.close = function () {
                    if (!c.state || c.state["@type"] === "authorizationStateClosed") return Promise.resolve();
                    return client.send({ "@type": "close" }).catch(function () {}).then(function () { return c.until(["authorizationStateClosed"]); })
                        .catch(function () {});
                };
                // TDLib asks for something first: the version tells it is alive.
                return client.send({ "@type": "getOption", name: "version" }).catch(function () {}).then(function () { return c; });
            });
        });
    });
}

var AFTER_PHONE = ["authorizationStateWaitCode", "authorizationStateWaitPassword", "authorizationStateReady", "authorizationStateWaitRegistration",
                   "authorizationStateWaitEmailAddress", "authorizationStateWaitEmailCode", "authorizationStateWaitOtherDeviceConfirmation"];

function signInError(e) {
    var m = String(e.message || "");
    if (e.errorCode === "HELPER_NOT_AVAILABLE" || e.errorCode === "HELPER_EXITED") return e;
    if (/PHONE_NUMBER_INVALID|PHONE_NUMBER_BANNED/.test(m)) return fail("Telegram does not accept that phone number", "INVALID_USER");
    if (/PHONE_CODE_INVALID|PHONE_CODE_EMPTY/.test(m)) return fail("That code is not right", "WRONG_CODE");
    if (/PHONE_CODE_EXPIRED/.test(m)) return fail("That code expired: start again", "CODE_EXPIRED");
    if (/PASSWORD_HASH_INVALID/.test(m)) return fail("That is not your two-step password", "401_UNAUTHORIZED");
    if (e.retryAfter || e.tdCode === 429) return fail("Telegram asks to wait before trying again", "503_SERVICE_UNAVAILABLE",
                                                       { retryAt: Date.now() + (e.retryAfter || 60) * 1000 });
    return fail(m || "Telegram could not sign in", e.errorCode || "TELEGRAM_ERROR");
}

// Sign-in sessions between the page's steps (a TDLib client each), by key.
var pending = {};
function stateAnswer(key, st) {
    var t = st["@type"];
    if (t === "authorizationStateWaitCode") {
        var info = st.code_info || {};
        var how = info.type && info.type["@type"];
        return { key: key, state: "code", phone: info.phone_number || "",
                 sentBy: how === "authenticationCodeTypeTelegramMessage" ? "app" : how === "authenticationCodeTypeSms" ? "sms" : "other" };
    }
    if (t === "authorizationStateWaitPassword") return { key: key, state: "password", hint: st.password_hint || "" };
    if (t === "authorizationStateReady") return { key: key, state: "ready" };
    if (t === "authorizationStateWaitRegistration")
        throw fail("This number has no Telegram account: sign up in a Telegram app first", "NO_ACCOUNT");
    throw fail("Telegram asks for a way of signing in this device does not offer yet (" + t + ")", "UNSUPPORTED");
}
function dropPending(key) {
    var p = pending[key];
    delete pending[key];
    if (p) { p.client.client.send({ "@type": "logOut" }).catch(function () {}).then(function () { return p.client.close(); }); }
}

// {phone} -> {key, state: "code"|"password"|"ready"}; {key, code}; {key, password}; {key, cancel}.
function signIn(ctx, p) {
    Object.keys(pending).forEach(function (k) { if (pending[k].expires < Date.now()) dropPending(k); });
    if (p.key && p.cancel) { dropPending(p.key); return Promise.resolve({ state: "cancelled" }); }
    if (p.key) {
        var s = pending[p.key];
        if (!s) return Promise.reject(fail("The sign-in took too long: start again", "CODE_EXPIRED"));
        var c = s.client;
        var request = p.password !== undefined ? { "@type": "checkAuthenticationPassword", password: String(p.password) }
                                               : { "@type": "checkAuthenticationCode", code: String(p.code || "").replace(/\D/g, "") };
        var before = c.state;
        return c.client.send(request).then(function () {
            return c.state === before ? c.until(AFTER_PHONE.filter(function (t) { return t !== before["@type"]; })) : c.state;
        }).then(function (st) { return stateAnswer(p.key, st); }, function (e) { throw signInError(e); });
    }
    var phone = String(p.phone || "").replace(/[^\d+]/g, "");
    if (!/^\+?\d{6,15}$/.test(phone)) return Promise.reject(fail("Enter your phone number with its country code", "INVALID_USER"));
    var key = randomName(), dir = "a-" + randomName(), dbKey = randomKey();
    return openClient(ctx, dir, dbKey).then(function (c) {
        pending[key] = { client: c, dir: dir, dbKey: dbKey, expires: Date.now() + SIGN_IN_MS };
        return c.until(["authorizationStateWaitPhoneNumber"]).then(function () {
            return c.client.send({ "@type": "setAuthenticationPhoneNumber", phone_number: phone, settings: null });
        }).then(function () { return c.until(AFTER_PHONE); }).then(function (st) { return stateAnswer(key, st); });
    }).catch(function (e) {
        if (pending[key]) dropPending(key);
        throw signInError(e);
    });
}

// The account's TDLib session: {dir, dbKey}, or null.
function sessionOf(ctx) {
    var c = ctx.credentials || {};
    var dir = c.dir || (ctx.config && ctx.config.dir);
    return c.dbKey && dir ? { dir: dir, dbKey: c.dbKey } : null;
}

function userName(u) { return [u.first_name, u.last_name].filter(Boolean).join(" ") || (u.usernames && u.usernames.active_usernames && u.usernames.active_usernames[0]) || ""; }
function userAddress(u) {
    if (u.phone_number) return "+" + String(u.phone_number).replace(/^\+/, "");
    var names = (u.usernames && u.usernames.active_usernames) || [];
    if (names[0]) return "@" + names[0];
    return "tg:" + u.id;
}

// The finished sign-in -> the account; the session's client closed (the
// account's own opens the same database again).
function validate(ctx, p) {
    var key = p.config && p.config.key;
    var s = key && pending[key];
    if (!s) return appOf(ctx).then(function () { throw fail("Sign in on the Unofficial Telegram page", "UNSUPPORTED"); }, function (e) { throw e; });
    return s.client.until(["authorizationStateReady"]).then(function () {
        return s.client.client.send({ "@type": "getMe" });
    }).then(function (me) {
        delete pending[key];
        return s.client.close().then(function () {
            return {
                username: userAddress(me),
                // The session: its database folder and key (kept with the account,
                // as a password is; the config has the folder too).
                credentials: { common: { dbKey: s.dbKey, dir: s.dir } },
                config: { dir: s.dir, userId: me.id, name: userName(me) }
            };
        });
    }).catch(function (e) { throw signInError(e); });
}

// ---- The connection ---------------------------------------------------------------------------

function createSession(ctx) {
    var own = ctx.account && ctx.account.username;
    var st = ctx.state;
    st.users = st.users || {};       // userId -> {a: address, n: name}
    st.chats = st.chats || {};       // chatId -> {k: "p" private | "g" group | "s" secret | "c" channel, u: userId, n: name}
    st.last = st.last || {};         // chatId -> the last message id filed
    var me = { closed: false, c: null, filing: Promise.resolve(), flushing: null, offline: false, authFailed: null,
               messaging: (ctx.account.capabilityProviders || []).some(function (x) { return x.id === PROVIDERS.messaging; }) };
    function log(m) { ctx.log(m); }
    // A request of the account's client; FLOOD_WAIT's seconds as the kit's backoff.
    function send(r) {
        return me.c.client.send(r).catch(function (e) {
            if (e.retryAfter) e.retryAt = ctx.now() + e.retryAfter * 1000;
            throw e;
        });
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

    function userOf(userId) {
        if (st.users[userId]) return Promise.resolve(st.users[userId]);
        return send({ "@type": "getUser", user_id: userId }).then(function (u) {
            return (st.users[userId] = { a: userAddress(u), n: userName(u) || userAddress(u) });
        });
    }
    function chatOf(chatId) {
        if (st.chats[chatId]) return Promise.resolve(st.chats[chatId]);
        return send({ "@type": "getChat", chat_id: chatId }).then(function (c) {
            var t = c.type || {};
            var k = t["@type"] === "chatTypePrivate" ? "p" : t["@type"] === "chatTypeSecret" ? "s"
                  : t["@type"] === "chatTypeSupergroup" && t.is_channel ? "c" : "g";
            var x = { k: k, n: c.title || "" };
            if (k === "p" || k === "s") {
                x.u = t.user_id;
                return userOf(t.user_id).then(function () { return (st.chats[chatId] = x); });
            }
            return (st.chats[chatId] = x);
        });
    }

    function known(serviceMessageId) {
        return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "username", op: "=", val: own }, { prop: "serviceMessageId", op: "=", val: serviceMessageId }] })
            .then(function (r) { return r[0] || null; });
    }
    function sid(chatId, messageId) { return chatId + ":" + messageId; }

    // A picture: TDLib's file, downloaded, kept where Messaging can show it.
    function picture(photo) {
        var sizes = (photo && photo.sizes) || [];
        var best = sizes[sizes.length - 1];
        var f = best && best.photo;
        if (!f || (f.size && f.size > MAX_PICTURE)) return Promise.resolve(null);
        var got = f.local && f.local.is_downloading_completed ? Promise.resolve(f)
                : send({ "@type": "downloadFile", file_id: f.id, priority: 1, offset: 0, limit: 0, synchronous: true });
        return got.then(function (file) {
            return ctx.readFile(file.local.path).then(function (r) {
                if (!r.bytes || r.bytes.length > MAX_PICTURE) return null;
                var name = String(file.local.path).replace(/^.*\//, "").replace(/[^\w.-]+/g, "_").slice(0, 80) || "picture.jpg";
                var type = /\.png$/i.test(name) ? "image/png" : "image/jpeg";
                return ctx.writeFile(Date.now().toString(36) + "-" + name, r.bytes, type).then(function (path) { return { path: path, mimeType: type, name: name }; });
            });
        }).catch(function (e) { log("picture not kept: " + e.message); return null; });
    }

    function contentText(content) {
        var t = content["@type"];
        if (t === "messageText") return content.text.text;
        if (t === "messagePhoto") return (content.caption && content.caption.text) || "";
        if (t === "messageDocument") return "File: " + ((content.document && content.document.file_name) || "") + (content.caption && content.caption.text ? "\n" + content.caption.text : "");
        if (t === "messageVoiceNote") return "Voice message";
        if (t === "messageVideo" || t === "messageVideoNote") return "Video";
        if (t === "messageSticker") return (content.sticker && content.sticker.emoji) || "Sticker";
        if (t === "messageAnimation") return "GIF";
        if (t === "messageContact") return "Contact: " + ((content.contact && [content.contact.first_name, content.contact.last_name].filter(Boolean).join(" ")) || "");
        if (t === "messageLocation") return "Location";
        if (t === "messagePoll") return "Poll: " + ((content.poll && content.poll.question && (content.poll.question.text || content.poll.question)) || "");
        return null;    // service messages (joined, pinned, ...): not filed
    }

    // A message of TDLib's into Messaging, once (by chat and message id).
    function file(m, how) {
        if (!me.messaging) return Promise.resolve();
        var id = sid(m.chat_id, m.id);
        return known(id).then(function (found) {
            if (found) return null;
            // Ours, being sent from here: Messaging has it (its id comes with updateMessageSendSucceeded).
            if (m.sending_state) return null;
            var body = contentText(m.content || {});
            if (body === null) return null;
            return chatOf(m.chat_id).then(function (chat) {
                if (chat.k === "c") return null;
                var outgoing = !!m.is_outgoing;
                var senderId = m.sender_id && m.sender_id.user_id;
                return (senderId && !outgoing ? userOf(senderId) : Promise.resolve(null)).then(function (sender) {
                    var isPicture = m.content["@type"] === "messagePhoto";
                    return (isPicture ? picture(m.content.photo) : Promise.resolve(null)).then(function (part) {
                        if (isPicture && !part) body = "Picture" + (body ? ": " + body : "");
                        var partner = chat.u !== undefined ? st.users[chat.u] : null;
                        var group = chat.k === "g";
                        var name = group ? chat.n : chat.k === "s" ? (partner ? partner.n : chat.n) + " (secret chat)" : partner ? partner.n : chat.n;
                        var addr = group ? GROUP_PREFIX + m.chat_id : chat.k === "s" ? SECRET_PREFIX + m.chat_id : partner.a;
                        if (group && !outgoing && body) body = (sender ? sender.n : "") + ": " + body;
                        var ts = (m.date || Math.floor(ctx.now() / 1000)) * 1000;
                        var msg = {
                            _kind: MESSAGE_KIND, accountId: ctx.accountId, serviceName: IM_SERVICE, username: own,
                            folder: outgoing ? "outbox" : "inbox", status: "successful", messageText: body,
                            localTimestamp: how.history ? ts : ctx.now(), timestamp: ts, flags: { read: outgoing || !!how.read, visible: true },
                            serviceMessageId: id, telegram: { chatId: m.chat_id, id: m.id }
                        };
                        if (outgoing && how.readUpTo && m.id <= how.readUpTo) msg.deliveryStatus = "read";
                        if (outgoing) msg.to = [{ addr: addr, name: name }];
                        else msg.from = group || chat.k === "s" ? { addr: addr, name: name } : { addr: addr, name: (sender && sender.n) || name };
                        if (group) { msg.chatType = "groupchat"; msg.channelName = addr; msg.channelDisplayName = name; }
                        if (part) msg.parts = [part];
                        return ctx.putMessage(msg).then(function (r) {
                            if (outgoing || how.read || how.quiet) return r;
                            return ctx.notify({ title: name, body: part ? "Picture" : body, appId: MESSAGING_APP,
                                                params: { threadId: (r && r.threadids && r.threadids[0]) || "" } });
                        });
                    });
                });
            });
        }).then(function () {
            if ((st.last[m.chat_id] || 0) < m.id) st.last[m.chat_id] = m.id;
        });
    }

    // Our messages up to an id were read in the chat.
    function readUpTo(chatId, upto) {
        return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "username", op: "=", val: own }, { prop: "folder", op: "=", val: "outbox" }] }).then(function (all) {
            var ids = all.filter(function (x) { return x.telegram && x.telegram.chatId === chatId && x.telegram.id <= upto && x.deliveryStatus !== "read"; });
            return ids.length ? ctx.db.merge(ids.map(function (x) { return { _id: x._id, deliveryStatus: "read" }; })) : null;
        });
    }

    function onUpdate(u) {
        if (me.closed) return;
        var t = u["@type"];
        if (t === "updateAuthorizationState") {
            var s = u.authorization_state["@type"];
            if (s === "authorizationStateWaitPhoneNumber" || s === "authorizationStateLoggingOut") {
                me.authFailed = fail("Signed out of Telegram (on another device?): sign in again", "401_UNAUTHORIZED");
                setLogin({ state: "offline" });
            }
            return;
        }
        if (t === "updateConnectionState") {
            var cs = u.state && u.state["@type"];
            if (!me.offline) setLogin({ state: cs === "connectionStateReady" ? "online" : "logging-on" });
            return;
        }
        me.filing = me.filing.then(function () {
            switch (t) {
            case "updateNewMessage": return file(u.message, {});
            case "updateUser":
                if (st.users[u.user.id]) st.users[u.user.id].n = userName(u.user) || st.users[u.user.id].n;
                return null;
            case "updateChatTitle": if (st.chats[u.chat_id]) st.chats[u.chat_id].n = u.title; return null;
            case "updateMessageSendSucceeded":
                return known(sid(u.message.chat_id, u.old_message_id)).then(function (m) {
                    if (!m) return null;
                    if ((st.last[u.message.chat_id] || 0) < u.message.id) st.last[u.message.chat_id] = u.message.id;
                    return ctx.db.merge([{ _id: m._id, serviceMessageId: sid(u.message.chat_id, u.message.id), deliveryStatus: m.deliveryStatus || "delivered",
                                           telegram: { chatId: u.message.chat_id, id: u.message.id } }]);
                });
            case "updateMessageSendFailed":
                return known(sid(u.message.chat_id, u.old_message_id)).then(function (m) {
                    return m ? ctx.db.merge([{ _id: m._id, status: "failed", errorText: (u.error && u.error.message) || "Not sent" }]) : null;
                });
            case "updateChatReadOutbox": return readUpTo(u.chat_id, u.last_read_outbox_message_id);
            default: return null;
            }
        }).catch(function (e) { log(t + ": " + e.message); }).then(save);
    }

    // The chats (the main list, newest first) and what is new in them.
    function catchUp(first) {
        return send({ "@type": "loadChats", chat_list: { "@type": "chatListMain" }, limit: MAX_CHATS }).catch(function () {}).then(function () {
            return send({ "@type": "getChats", chat_list: { "@type": "chatListMain" }, limit: MAX_CHATS });
        }).then(function (r) {
            var chain = Promise.resolve();
            (r.chat_ids || []).forEach(function (chatId) {
                chain = chain.then(function () { return chatOf(chatId); }).then(function (chat) {
                    if (chat.k === "c") return null;
                    var since = st.last[chatId] || 0;
                    return send({ "@type": "getChat", chat_id: chatId }).then(function (c) {
                        var readOut = c.last_read_outbox_message_id || 0;
                        if (c.last_message && c.last_message.id <= since) return null;
                        return send({ "@type": "getChatHistory", chat_id: chatId, from_message_id: 0, offset: 0, limit: since ? 50 : FIRST_HISTORY, only_local: false })
                            .then(function (h) {
                                var msgs = (h.messages || []).filter(function (m) { return m.id > since; }).reverse();
                                var c2 = Promise.resolve();
                                msgs.forEach(function (m) {
                                    c2 = c2.then(function () { return file(m, first || !since ? { history: true, read: true, readUpTo: readOut } : { readUpTo: readOut }); });
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

    // ---- What goes out -------------------------------------------------------------------------

    function chatFor(to) {
        if (to.indexOf(GROUP_PREFIX) === 0) return Promise.resolve(Number(to.slice(GROUP_PREFIX.length)));
        if (to.indexOf(SECRET_PREFIX) === 0) return Promise.resolve(Number(to.slice(SECRET_PREFIX.length)));
        var userId = Object.keys(st.users).filter(function (id) { return st.users[id].a === to; })[0];
        var found = userId ? Promise.resolve(Number(userId))
            : /^\+\d+$/.test(to) ? send({ "@type": "searchUserByPhoneNumber", phone_number: to.slice(1), only_local: false }).then(function (u) {
                st.users[u.id] = st.users[u.id] || { a: to, n: userName(u) || to };
                return u.id;
            })
            : /^@\w+$/.test(to) ? send({ "@type": "searchPublicChat", username: to.slice(1) }).then(function (c) {
                if (!c.type || c.type["@type"] !== "chatTypePrivate") throw fail(to + " is not a person", "NOT_FOUND");
                return c.type.user_id;
            })
            : /^tg:\d+$/.test(to) ? Promise.resolve(Number(to.slice(3)))
            : Promise.reject(fail(to + " is not a Telegram phone number or username", "NOT_FOUND"));
        return found.catch(function (e) {
            if (e.tdCode === 404 || /USERNAME_NOT_OCCUPIED|USERNAME_INVALID/.test(e.message || "")) throw fail(to + " is not on Telegram", "NOT_FOUND");
            throw e;
        }).then(function (uid) { return send({ "@type": "createPrivateChat", user_id: uid, force: false }); }).then(function (c) { return c.id; });
    }

    function sendOne(m) {
        var to = m.to && m.to[0] && String(m.to[0].addr || "");
        if (!to) return ctx.db.merge([{ _id: m._id, status: "permanent-fail" }]);
        return ctx.db.merge([{ _id: m._id, status: "sending", accountId: ctx.accountId }]).then(function () { return chatFor(to); }).then(function (chatId) {
            var pictures = (m.parts || []).filter(function (p) { return /^image\//.test(p.mimeType || "") && p.path; });
            var chain = Promise.resolve(), last = null;
            pictures.forEach(function (p, i) {
                chain = chain.then(function () {
                    var caption = i === pictures.length - 1 ? m.messageText : "";
                    return send({ "@type": "sendMessage", chat_id: chatId, message_thread_id: 0, reply_to: null, options: null, reply_markup: null,
                                  input_message_content: { "@type": "inputMessagePhoto", photo: { "@type": "inputFileLocal", path: p.path }, thumbnail: null,
                                                           added_sticker_file_ids: [], width: 0, height: 0, caption: text(caption), self_destruct_type: null, has_spoiler: false } });
                }).then(function (r) { last = r; });
            });
            if (m.messageText && !pictures.length) chain = chain.then(function () {
                return send({ "@type": "sendMessage", chat_id: chatId, message_thread_id: 0, reply_to: null, options: null, reply_markup: null,
                              input_message_content: { "@type": "inputMessageText", text: text(m.messageText), link_preview_options: null, clear_draft: true } })
                    .then(function (r) { last = r; });
            });
            return chain.then(function () {
                // Sent when TDLib says so (updateMessageSendSucceeded gives the id for good).
                return ctx.db.merge([{ _id: m._id, status: "successful", serviceMessageId: last ? sid(chatId, last.id) : "",
                                       telegram: last ? { chatId: chatId, id: last.id } : { chatId: chatId } }]);
            });
        }).catch(function (e) {
            log("message not sent: " + e.message);
            var permanent = e.errorCode === "NOT_FOUND" || /CHAT_WRITE_FORBIDDEN|USER_IS_BLOCKED|PEER_ID_INVALID|Have no write access/i.test(e.message || "");
            return ctx.db.merge([{ _id: m._id, status: permanent ? "permanent-fail" : "failed", errorText: e.message }]);
        });
    }
    function flush(onlyId) {
        if (!me.messaging) return Promise.resolve({ sent: 0 });
        if (me.flushing) return me.flushing.then(function () { return flush(onlyId); });
        me.flushing = ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] })
            .then(function (pend) {
                pend = pend.filter(function (m) { return m.username === own && (!onlyId || m._id === onlyId); })
                    .sort(function (a, b) { return (a.localTimestamp || 0) - (b.localTimestamp || 0); });
                if (me.offline || me.authFailed) {
                    return pend.length ? ctx.db.merge(pend.map(function (m) { return { _id: m._id, status: "failed", errorText: me.offline ? "Offline" : "Not signed in" }; }))
                        .then(function () { return { sent: 0 }; }) : { sent: 0 };
                }
                var chain = Promise.resolve();
                pend.forEach(function (m) { chain = chain.then(function () { return sendOne(m); }); });
                return chain.then(save).then(function () { return { sent: pend.length }; });
            }).then(function (r) { me.flushing = null; return r; }, function (e) { me.flushing = null; throw e; });
        return me.flushing;
    }

    var handle = {
        get closed() { return me.closed || !!(me.c && me.c.state && me.c.state["@type"] === "authorizationStateClosed"); },
        syncNow: function () {
            if (me.authFailed) return Promise.reject(me.authFailed);
            if (me.offline) return Promise.resolve();
            // In turn with the updates; a failed catch-up fails this sync, not the next ones.
            var run = me.filing.then(function () { return catchUp(false); });
            me.filing = run.catch(function () {});
            return run.then(save).then(function () { return flush(); });
        },
        people: function () {
            var out = {};
            Object.keys(st.chats).forEach(function (id) {
                var c = st.chats[id];
                if (c.k === "p" && st.users[c.u]) out[st.users[c.u].a] = st.users[c.u].n;
            });
            return Promise.resolve(out);
        },
        flush: flush,
        // Read here: Telegram's read receipts (viewMessages).
        markRead: function (threadId) {
            return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "conversations", op: "=", val: threadId }] }).then(function (msgs) {
                var unread = msgs.filter(function (m) { return m.folder === "inbox" && m.telegram && !m.telegram.viewed; });
                if (!unread.length) return { marked: false };
                var byChat = {};
                unread.forEach(function (m) { (byChat[m.telegram.chatId] = byChat[m.telegram.chatId] || []).push(m.telegram.id); });
                return Promise.all(Object.keys(byChat).map(function (chatId) {
                    return send({ "@type": "viewMessages", chat_id: Number(chatId), message_ids: byChat[chatId], source: null, force_read: true });
                })).then(function () {
                    return ctx.db.merge(unread.map(function (m) { return { _id: m._id, telegram: Object.assign({}, m.telegram, { viewed: true }) }; }));
                }).then(function () { return { marked: true }; });
            });
        },
        // Telegram's "online" (the option TDLib sends); offline: no sending from here either.
        setPresence: function (availability) {
            me.offline = availability === 4;
            return send({ "@type": "setOption", name: "online", value: { "@type": "optionValueBoolean", value: !me.offline } }).catch(function () {})
                .then(function () { return setLogin({ state: me.offline ? "offline" : "online", availability: availability }); });
        },
        close: function () {
            me.closed = true;
            return Promise.resolve(me.c && me.c.close()).then(function () { return setLogin({ state: "offline" }); });
        }
    };

    if (!sessionOf(ctx))
        return Promise.reject(fail("The account has no Telegram session: sign in again", "401_UNAUTHORIZED"));
    return openClient(ctx, sessionOf(ctx).dir, sessionOf(ctx).dbKey).then(function (c) {
        me.c = c;
        c.updates.push(onUpdate);
        return c.until(["authorizationStateReady", "authorizationStateWaitPhoneNumber"]);
    }).then(function (s) {
        if (s["@type"] !== "authorizationStateReady") {
            me.c.close();
            throw fail("Signed out of Telegram (on another device?): sign in again", "401_UNAUTHORIZED");
        }
        return ctx.db.find({ from: LOGIN_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] });
    }).then(function (s) {
        if (s[0] && s[0].availability === 4) me.offline = true;
        return setLogin({ state: me.offline ? "offline" : "online" });
    }).then(function () {
        me.filing = me.filing.then(function () { return catchUp(true); });
        return me.filing;
    }).then(save).then(function () { return handle; }, function (e) {
        // Not opened: this client goes (the kit opens a new session next time).
        me.closed = true;
        return Promise.resolve(me.c && me.c.close()).then(function () { throw e; });
    });
}

// ---- Capabilities ---------------------------------------------------------------------------

function pullPeople(ctx) {
    return ctx.connect().then(function (live) { return live.people(); }).then(function (people) {
        return {
            full: true, nextToken: null,
            changes: Object.keys(people).map(function (addr) {
                var f = { nickname: people[addr] === addr ? "" : people[addr], ims: [{ value: addr, type: IM_SERVICE }] };
                // A phone number Telegram shares links the person to the address book's.
                if (/^\+\d+$/.test(addr)) f.phoneNumbers = [{ value: addr, type: "mobile" }];
                return { remoteId: addr, etag: people[addr], fields: f };
            })
        };
    });
}

function syncMessages(ctx) {
    return ctx.connect().then(function (live) { return live.syncNow(); });
}

function removeMessages(ctx) {
    var own = ctx.account && ctx.account.username;
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

module.exports = kit.defineConnector({
    service: SERVICE,
    templateIds: [TEMPLATE],
    kinds: { state: "org.webosphoenix.telegram.state:1", item: "org.webosphoenix.telegram.item:1" },
    userAgent: "webOS-Phoenix-UnofficialTelegram/0.1",
    settings: ["apiId", "apiHash"],
    helpers: [HELPER],
    signUp: "https://telegram.org/apps",

    validate: validate,

    capabilities: (function () {
        var caps = {};
        caps[PROVIDERS.contacts] = { capability: "CONTACTS", kind: CONTACT_KIND, fields: ["nickname", "ims", "phoneNumbers"], pull: pullPeople, linkPersons: true };
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

    // Signed out on Telegram too: the device's session ends, TDLib's database goes.
    onDelete: function (ctx) {
        if (!sessionOf(ctx)) return Promise.resolve();
        var live = ctx.live();
        return Promise.resolve(live && live.close()).then(function () {
            return openClient(ctx, sessionOf(ctx).dir, sessionOf(ctx).dbKey);
        }).then(function (c) {
            return c.until(["authorizationStateReady", "authorizationStateWaitPhoneNumber"]).then(function () {
                return c.client.send({ "@type": "logOut" });
            }).then(function () { return c.until(["authorizationStateClosed"]); });
        }).catch(function (e) { ctx.log("not signed out of Telegram: " + e.message); });
    },

    methods: {
        // Whether this build has Telegram's app id and TDLib: the sign-in page asks first.
        available: function (ctx) {
            return appOf(ctx).then(function (app) {
                return app.hub.execute({ "@type": "getOption", name: "version" }).then(function (v) {
                    return { available: true, tdlib: (v && v.value) || "" };
                }, function () { return { available: true, tdlib: "" }; });
            }, function (e) {
                if (e.errorCode === "HELPER_NOT_AVAILABLE") return { available: false, reason: e.message };
                throw e;
            });
        },
        signIn: function (ctx, p) { return signIn(ctx, p); },
        outbox: function (ctx, p) {
            if (p.accountId) return ctx.connect().then(function (live) { return live.flush(p.messageId); });
            return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] })
                .then(function (pend) {
                    var users = {};
                    pend.forEach(function (m) { if (!p.messageId || m._id === p.messageId) users[m.username] = true; });
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

module.exports.NO_APP_ID = NO_APP_ID;
module.exports.NO_TDLIB = NO_TDLIB;
