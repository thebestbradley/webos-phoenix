// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Matrix account (template com.webosphoenix.matrix;
// docs/SYNERGY-MODERN.md 2.4, docs/SYNERGY.md 2.8), on the connector kit.
// The IM transport webOS's libpurple accounts were, for today's open
// network (and the bridged ones a user's homeserver brings):
//
//   sign-in      the Matrix ID finds the homeserver (/.well-known/matrix/client);
//                with a password (m.login.password), or, where the server
//                signs in through OAuth 2.0 (Matrix Authentication Service,
//                spec 1.15), on the server's own page in the system's
//                browser sheet (org.webosphoenix.service.oauth: PKCE,
//                the client registered dynamically, RFC 7591)
//   MESSAGING    rooms as Messaging conversations, com.palm.immessage.matrix:1
//                (the fields the libpurple transport wrote, imlibpurpleservice
//                src/IMMessage.cpp; chatType, channelName and
//                channelDisplayName for rooms with more than two people, as
//                LuneOS's version names them, inc/IMMessage.h): a direct
//                chat (m.direct) is the other person's conversation, by
//                their Matrix ID; a room is its own, its people's names
//                before their lines. Pictures both ways (media upload,
//                authenticated download); read receipts both ways
//   CONTACTS     the people of your direct chats (com.palm.contact.matrix:1,
//                read only): their Matrix ID as an IM address. Display names
//                are chosen by their owners, so they are not used to link
//                them to your address book (docs/SYNERGY-MODERN.md 2.5 rule 3)
//
// The connection is a sync loop that stays open while the account has a
// capability on (definition.connection): simplified sliding sync (MSC4186,
// native in Synapse since 1.114) where the server has it, /v3/sync
// otherwise, long-polling.
//
// End-to-end encryption: not yet. matrix-sdk-crypto (Apache-2.0) through
// its WebAssembly build fits the size budget (about 9 MB) but needs a
// device store, key backup and a verification screen
// (docs/OPEN-QUESTIONS.md). Until then an encrypted room's messages show
// "Encrypted: can't be read on this device yet", and nothing is sent into
// an encrypted room (it would go unencrypted).

"use strict";

var kit = require("@phoenix/connector-kit");
var M = require("./lib/matrix");

var SERVICE = "org.webosphoenix.service.matrix";
var TEMPLATE = "com.webosphoenix.matrix";
var MESSAGING_APP = "org.webosphoenix.messaging";
var IM_SERVICE = "type_matrix";
var MESSAGE_KIND = "com.palm.immessage.matrix:1";
var CONTACT_KIND = "com.palm.contact.matrix:1";
var LOGIN_KIND = "com.palm.imloginstate.matrix:1";
var THREAD_KIND = "com.palm.chatthread:1";
var OAUTH = "luna://org.webosphoenix.service.oauth/";
var PROVIDERS = { contacts: TEMPLATE + ".contacts", messaging: TEMPLATE + ".im" };
var POLL_MS = 30000;
var FIRST_HISTORY = 10;
var MAX_PICTURE = 10 * 1024 * 1024;
var RETRY_MS = [3000, 15000, 60000, 300000];
var ENCRYPTED_TEXT = "Encrypted message: end-to-end encrypted rooms can't be read on this device yet.";

function fail(message, errorCode, extra) { return M.fail(message, errorCode, extra); }
function lunaOk(ctx, uri, params) {
    return ctx.luna.call(uri, params).catch(function (e) { throw fail(e.message, e.errorCode || "UNKNOWN_ERROR"); });
}

// The account's token: a password sign-in's (credentials), or the OAuth service's (its key).
function tokenOf(ctx) {
    var c = ctx.credentials || {};
    if (c.accessToken) return Promise.resolve(c.accessToken);
    if (c.oauthKey) return ctx.oauth.token(c.oauthKey);
    return Promise.reject(fail("The account has no sign-in (sign in again)", "401_UNAUTHORIZED"));
}

function apiFor(ctx) {
    // The sign-in's config (onCreate) not kept (the simulator's Accounts card
    // closed before it ran): found again from the account's Matrix ID.
    var found = ctx.config.homeserver ? Promise.resolve() : M.discover(ctx.http, ctx.account && ctx.account.username).then(function (f) {
        ctx.config.homeserver = f.homeserver;
        ctx.config.serverName = f.serverName;
        ctx.config.slidingSync = f.slidingSync;
        ctx.config.userId = ctx.config.userId || ctx.account.username;
    });
    return found.then(function () {
        ctx.http.allowHost(new URL(ctx.config.homeserver).host);
        return tokenOf(ctx);
    }).then(function (t) { return M.createApi(ctx.http, ctx.config.homeserver, t); });
}

// ---- The sync loop ----------------------------------------------------------------------------

function createSession(ctx) {
    var own = ctx.config.userId || (ctx.account && ctx.account.username);
    var st = ctx.state;
    st.rooms = st.rooms || {};          // roomId -> {n: name, d: the other person of a direct chat, e: 1 encrypted}
    var members = {};                   // roomId -> {userId: displayname}  (this run)
    var me = { closed: false, api: null, inflight: null, loopTimer: null, failures: 0, ready: null, online: false, authFailed: null,
               messaging: (ctx.account.capabilityProviders || []).some(function (c) { return c.id === PROVIDERS.messaging; }),
               flushing: null, offline: false };

    function log(m) { ctx.log(m); }
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

    function nameIn(roomId, userId) {
        return (members[roomId] && members[roomId][userId]) || ((st.rooms[roomId] || {}).m || {})[userId] || userId;
    }
    function roomName(roomId) {
        var r = st.rooms[roomId] || {};
        if (r.n) return r.n;
        var others = Object.keys(members[roomId] || {}).filter(function (u) { return u !== own; }).map(function (u) { return nameIn(roomId, u); });
        return others.slice(0, 3).join(", ") || roomId;
    }
    function partnerOf(roomId) {
        var r = st.rooms[roomId] || {};
        return r.d || null;
    }

    // ---- What comes in -------------------------------------------------------------------------

    function known(eventId) {
        return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "username", op: "=", val: own }, { prop: "serviceMessageId", op: "=", val: eventId }] })
            .then(function (r) { return r[0] || null; });
    }
    function picture(content) {
        if (!/^mxc:\/\//.test(content.url || "")) return Promise.resolve(null);
        var type = (content.info && content.info.mimetype) || "image/jpeg";
        if (content.info && content.info.size > MAX_PICTURE) return Promise.resolve(null);
        return me.api.download(content.url).then(function (r) {
            var bytes = r.bytes;
            if (!bytes || bytes.length > MAX_PICTURE) return null;
            var name = String(content.body || "picture").replace(/[^\w.-]+/g, "_").slice(0, 80) || "picture";
            return ctx.writeFile(Date.now().toString(36) + "-" + name, bytes, type).then(function (path) {
                return { path: path, mimeType: (r.headers && String(r.headers["content-type"] || "").split(";")[0]) || type, name: name };
            });
        }).catch(function (e) { log("picture not fetched: " + e.message); return null; });
    }

    function onEvent(roomId, ev, how) {
        if (!me.messaging) return Promise.resolve();
        var encrypted = ev.type === "m.room.encrypted";
        if (ev.type !== "m.room.message" && !encrypted) return Promise.resolve();
        var c = ev.content || {};
        if (!encrypted && !c.msgtype) return Promise.resolve();     // redacted
        return known(ev.event_id).then(function (found) {
            if (found) return null;
            var outgoing = ev.sender === own;
            var txn = ev.unsigned && ev.unsigned.transaction_id;
            // Our own message back from the sync: it has its event id now.
            var mine = outgoing && txn ? ctx.db.get([String(txn).replace(/-p\d+$/, "")]).then(function (r) { return r && r[0] && r[0]._kind === MESSAGE_KIND ? r[0] : null; }, function () { return null; })
                                       : Promise.resolve(null);
            return mine.then(function (m) {
                if (m) return m.serviceMessageId ? null : ctx.db.merge([{ _id: m._id, serviceMessageId: ev.event_id }]);
                var text = encrypted ? ENCRYPTED_TEXT : String(c.body || "");
                var isPicture = !encrypted && c.msgtype === "m.image";
                if (!encrypted && c.msgtype === "m.emote") text = "* " + nameIn(roomId, ev.sender) + " " + text;
                if (!encrypted && (c.msgtype === "m.file" || c.msgtype === "m.video" || c.msgtype === "m.audio")) text = "File: " + text;
                return (isPicture ? picture(c) : Promise.resolve(null)).then(function (part) {
                    if (isPicture) text = part ? "" : "Picture: " + text;
                    var partner = partnerOf(roomId);
                    var group = !partner;
                    var name = group ? roomName(roomId) : nameIn(roomId, partner);
                    if (group && !outgoing && text) text = nameIn(roomId, ev.sender) + ": " + text;
                    var ts = ev.origin_server_ts || ctx.now();
                    var msg = {
                        _kind: MESSAGE_KIND, accountId: ctx.accountId, serviceName: IM_SERVICE, username: own,
                        folder: outgoing ? "outbox" : "inbox", status: "successful", messageText: text,
                        localTimestamp: how.history ? ts : ctx.now(), timestamp: ts, flags: { read: outgoing || !!how.read, visible: true },
                        serviceMessageId: ev.event_id, matrix: { roomId: roomId, sender: ev.sender, encrypted: encrypted }
                    };
                    var addr = group ? { addr: roomId, name: name } : { addr: partner, name: name };
                    if (outgoing) msg.to = [addr];
                    else msg.from = group ? addr : { addr: ev.sender, name: nameIn(roomId, ev.sender) };
                    if (group) { msg.chatType = "groupchat"; msg.channelName = roomId; msg.channelDisplayName = name; }
                    if (part) msg.parts = [part];
                    return ctx.putMessage(msg).then(function (r) {
                        if (outgoing || how.read || how.quiet) return r;
                        var body = part ? "Picture" : text;
                        return ctx.notify({ title: group ? name : msg.from.name, body: body, appId: MESSAGING_APP,
                                            params: { threadId: (r && r.threadids && r.threadids[0]) || "" } });
                    });
                });
            });
        });
    }

    // Someone read up to an event of ours: it and our earlier ones in the room are read.
    function onReceipt(roomId, content) {
        var chain = Promise.resolve();
        Object.keys(content || {}).forEach(function (eventId) {
            var readers = Object.keys((content[eventId] || {})["m.read"] || {}).filter(function (u) { return u !== own; });
            if (!readers.length) return;
            chain = chain.then(function () {
                return known(eventId).then(function (m) {
                    if (!m || m.folder !== "outbox") return null;
                    return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "username", op: "=", val: own }, { prop: "folder", op: "=", val: "outbox" }] })
                        .then(function (all) {
                            var upto = all.filter(function (x) { return x.matrix && x.matrix.roomId === roomId && x.timestamp <= m.timestamp && x.deliveryStatus !== "read"; });
                            return upto.length ? ctx.db.merge(upto.map(function (x) { return { _id: x._id, deliveryStatus: "read" }; })) : null;
                        });
                });
            });
        });
        return chain;
    }

    function onStateEvent(roomId, ev) {
        var r = st.rooms[roomId] = st.rooms[roomId] || {};
        if (ev.type === "m.room.name") r.n = (ev.content && ev.content.name) || "";
        if (ev.type === "m.room.encryption") r.e = 1;
        if (ev.type === "m.room.member") {
            var m = members[roomId] = members[roomId] || {};
            if (ev.content && (ev.content.membership === "join" || ev.content.membership === "invite")) m[ev.state_key] = ev.content.displayname || ev.state_key;
            else delete m[ev.state_key];
            // The names kept for the next run (a sliding sync sends a room's state once): a few per room.
            var kept = r.m = r.m || {};
            if (m[ev.state_key] && m[ev.state_key] !== ev.state_key && (kept[ev.state_key] || Object.keys(kept).length < 30))
                kept[ev.state_key] = m[ev.state_key];
        }
    }
    function onDirect(content) {
        Object.keys(content || {}).forEach(function (userId) {
            (content[userId] || []).forEach(function (roomId) { (st.rooms[roomId] = st.rooms[roomId] || {}).d = userId; });
        });
    }

    // A sync's answer, in order: who is who first, then what was said.
    function process(res, first) {
        var chain = Promise.resolve();
        var rooms = res.rooms || {};
        (res.accountData || []).forEach(function (e) { if (e.type === "m.direct") onDirect(e.content); });
        Object.keys(rooms).forEach(function (roomId) {
            var r = rooms[roomId];
            (r.state || []).forEach(function (e) { onStateEvent(roomId, e); });
            if (r.name) (st.rooms[roomId] = st.rooms[roomId] || {}).n = r.name;
            (r.timeline || []).forEach(function (e) { if (e.state_key !== undefined) onStateEvent(roomId, e); });
        });
        Object.keys(rooms).forEach(function (roomId) {
            (rooms[roomId].timeline || []).forEach(function (e) {
                chain = chain.then(function () { return onEvent(roomId, e, first ? { history: true, read: true } : {}); });
            });
            if (rooms[roomId].receipts) chain = chain.then(function () { return onReceipt(roomId, rooms[roomId].receipts); });
        });
        return chain;
    }

    // One sync: sliding (MSC4186) where the server has it, else /v3/sync.
    function syncOnce(timeoutMs) {
        var first = !st.pos && !st.since;
        if (ctx.config.slidingSync && !st.v3) {
            var body = {
                lists: { all: { ranges: [[0, 99]], timeline_limit: first ? FIRST_HISTORY : 50,
                                required_state: [["m.room.create", ""], ["m.room.name", ""], ["m.room.encryption", ""], ["m.room.member", "$LAZY"], ["m.room.member", "$ME"]] } },
                extensions: { account_data: { enabled: true }, receipts: { enabled: true } }
            };
            return me.api.slidingSync(body, st.pos || undefined, timeoutMs).then(function (r) {
                var rooms = {};
                Object.keys(r.rooms || {}).forEach(function (id) {
                    var x = r.rooms[id];
                    rooms[id] = { name: x.name, state: x.required_state || [], timeline: x.timeline || [] };
                });
                var rc = (r.extensions && r.extensions.receipts && r.extensions.receipts.rooms) || {};
                Object.keys(rc).forEach(function (id) {
                    (rooms[id] = rooms[id] || { state: [], timeline: [] }).receipts = rc[id].content || {};
                });
                var ad = (r.extensions && r.extensions.account_data && r.extensions.account_data.global) || [];
                return process({ rooms: rooms, accountData: ad }, first).then(function () { return r.pos; });
            }, function (e) {
                // The server stopped offering it (M_UNRECOGNIZED, or an expired pos): /v3/sync from here.
                if (e.status === 404 || e.matrix === "M_UNRECOGNIZED") { st.v3 = true; delete st.pos; return syncOnce(timeoutMs); }
                if (e.matrix === "M_UNKNOWN_POS") { delete st.pos; return syncOnce(0); }
                throw e;
            }).then(function (pos) {
                if (pos !== undefined && pos !== st.pos) st.pos = pos;
            });
        }
        var filter = { room: { timeline: { limit: first ? FIRST_HISTORY : 50 }, state: { lazy_load_members: true } } };
        return me.api.sync(st.since || undefined, timeoutMs, filter).then(function (r) {
            var rooms = {};
            var joined = (r.rooms && r.rooms.join) || {};
            Object.keys(joined).forEach(function (id) {
                var x = joined[id];
                var receipt = ((x.ephemeral && x.ephemeral.events) || []).filter(function (e) { return e.type === "m.receipt"; })
                    .reduce(function (a, e) { return Object.assign(a, e.content); }, {});
                rooms[id] = { state: (x.state && x.state.events) || [], timeline: (x.timeline && x.timeline.events) || [], receipts: receipt };
            });
            return process({ rooms: rooms, accountData: (r.account_data && r.account_data.events) || [] }, first).then(function () {
                if (r.next_batch && r.next_batch !== st.since) st.since = r.next_batch;
            });
        });
    }

    var saved = JSON.stringify(st);
    function save() {
        var now = JSON.stringify(st);
        if (now === saved) return Promise.resolve();
        saved = now;
        return ctx.saveState();
    }

    // One sync at a time: the loop's long poll and a sync asked for share it.
    function syncSerial(timeoutMs) {
        if (me.inflight) return me.inflight.then(function () { return syncSerial(timeoutMs); }, function () { return syncSerial(timeoutMs); });
        me.inflight = syncOnce(timeoutMs).then(save).then(function () { me.inflight = null; }, function (e) { me.inflight = null; throw e; });
        return me.inflight;
    }

    function loop() {
        if (me.closed || me.offline || me.authFailed) return;
        syncSerial(POLL_MS).then(function () {
            me.failures = 0;
            if (!me.online) { me.online = true; setLogin({ state: "online" }); }
            return flush();
        }).then(function () {
            if (!me.closed) me.loopTimer = ctx.setTimeout(loop, 0);
        }, function (e) {
            me.online = false;
            setLogin({ state: "offline" });
            if (e.errorCode === "401_UNAUTHORIZED") { me.authFailed = e; log("signed out on the server: " + e.message); return; }
            var wait = e.retryAt ? Math.max(1000, e.retryAt - ctx.now()) : RETRY_MS[Math.min(me.failures++, RETRY_MS.length - 1)];
            log("sync failed (" + (e.errorCode || e.message) + "), again in " + Math.round(wait / 1000) + " s");
            if (!me.closed) me.loopTimer = ctx.setTimeout(loop, wait);
        });
    }

    // ---- What goes out -------------------------------------------------------------------------

    function directRoomFor(userId) {
        var id = Object.keys(st.rooms).filter(function (r) { return st.rooms[r].d === userId; })[0];
        if (id) return Promise.resolve(id);
        // A new direct chat (spec 11.15: is_direct, and m.direct updated).
        return me.api.createDirect(userId).then(function (r) {
            st.rooms[r.room_id] = { d: userId };
            return me.api.accountData(own, "m.direct").then(function (d) {
                var content = Object.assign({}, d);
                content[userId] = (content[userId] || []).concat([r.room_id]);
                return me.api.setAccountData(own, "m.direct", content);
            }).then(function () { return r.room_id; });
        });
    }

    function sendOne(m) {
        var to = m.to && m.to[0] && m.to[0].addr;
        if (!to) return ctx.db.merge([{ _id: m._id, status: "permanent-fail" }]);
        return ctx.db.merge([{ _id: m._id, status: "sending", accountId: ctx.accountId }]).then(function () {
            return to.charAt(0) === "!" ? to : directRoomFor(to);
        }).then(function (roomId) {
            if ((st.rooms[roomId] || {}).e)
                throw fail("This conversation is end-to-end encrypted, which this device can't do yet: the message was not sent.", "E2EE_NOT_SUPPORTED");
            var pictures = (m.parts || []).filter(function (p) { return /^image\//.test(p.mimeType || ""); });
            var chain = Promise.resolve(), last = null;
            pictures.forEach(function (p, i) {
                chain = chain.then(function () {
                    return ctx.readFile(p.path).then(function (f) {
                        var name = String(p.name || p.path).replace(/^.*\//, "");
                        var type = p.mimeType || f.mimeType;
                        return me.api.upload(f.bytes, name, type).then(function (u) {
                            return me.api.send(roomId, m._id + "-p" + i, { msgtype: "m.image", body: name, url: u.content_uri,
                                                                           info: { mimetype: type, size: f.bytes.length } });
                        });
                    }).then(function (r) { last = r.event_id; });
                });
            });
            if (m.messageText) chain = chain.then(function () {
                return me.api.send(roomId, m._id, { msgtype: "m.text", body: m.messageText }).then(function (r) { last = r.event_id; });
            });
            return chain.then(function () {
                return ctx.db.merge([{ _id: m._id, status: "successful", serviceMessageId: last || "", matrix: { roomId: roomId } }]);
            });
        }).catch(function (e) {
            log("message not sent: " + e.message);
            var permanent = ["E2EE_NOT_SUPPORTED", "PERMISSION_DENIED", "NOT_FOUND", "400_BAD_REQUEST"].indexOf(e.errorCode) >= 0;
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
                if (me.offline || me.authFailed) {
                    return pending.length ? ctx.db.merge(pending.map(function (m) { return { _id: m._id, status: "failed", errorText: "Not signed in" }; }))
                        .then(function () { return { sent: 0 }; }) : { sent: 0 };
                }
                var chain = Promise.resolve();
                pending.forEach(function (m) { chain = chain.then(function () { return sendOne(m); }); });
                return chain.then(function () { return { sent: pending.length }; });
            }).then(function (r) { me.flushing = null; return r; }, function (e) { me.flushing = null; throw e; });
        return me.flushing;
    }

    var handle = {
        get closed() { return me.closed; },
        // The first sync done (the rooms known), and after a stop, again.
        ready: function () {
            if (me.authFailed) {
                // A new attempt (a sync asked by the user): the token may work again.
                me.authFailed = null;
                me.ready = syncSerial(0).then(function () { loop(); });
            }
            return me.ready;
        },
        syncNow: function () {
            return handle.ready().then(function () { return syncSerial(0); }).then(function () { return flush(); });
        },
        people: function () {
            return handle.ready().then(function () {
                var out = {};
                Object.keys(st.rooms).forEach(function (id) {
                    var d = st.rooms[id].d;
                    if (d && !out[d]) out[d] = nameIn(id, d);
                });
                return out;
            });
        },
        flush: flush,
        markRead: function (threadId) {
            return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "conversations", op: "=", val: threadId }] }).then(function (msgs) {
                var last = msgs.filter(function (m) { return m.folder === "inbox" && m.matrix && m.matrix.roomId && m.serviceMessageId; })
                    .sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); })[0];
                if (!last) return { marked: false };
                return me.api.receipt(last.matrix.roomId, last.serviceMessageId).then(function () { return { marked: true }; });
            });
        },
        // Matrix presence (spec 11.9): online, unavailable; offline stops syncing (signed out here).
        setPresence: function (availability, status) {
            if (availability === 4) {
                me.offline = true;
                ctx.clearTimeout(me.loopTimer);
                return setLogin({ state: "offline", availability: 4 });
            }
            var wasOffline = me.offline;
            me.offline = false;
            return me.api.call("PUT", "/_matrix/client/v3/presence/" + encodeURIComponent(own) + "/status",
                               { presence: availability === 2 ? "unavailable" : "online", status_msg: status || "" }).catch(function () {})
                .then(function () { return setLogin({ availability: availability, customMessage: status || "", state: "online" }); })
                .then(function () { if (wasOffline) loop(); });
        },
        close: function () {
            me.closed = true;
            ctx.clearTimeout(me.loopTimer);
            me.online = false;
            return setLogin({ state: "offline" });
        }
    };

    return apiFor(ctx).then(function (api) {
        me.api = api;
        return ctx.db.find({ from: LOGIN_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] });
    }).then(function (s) {
        if (s[0] && s[0].availability === 4) me.offline = true;
        return setLogin({ state: me.offline ? "offline" : "logging-on" });
    }).then(function () {
        if (me.offline) { me.ready = Promise.resolve(); return handle; }
        me.ready = syncSerial(0);
        return me.ready.then(function () {
            me.online = true;
            return setLogin({ state: "online" });
        }).then(function () {
            loop();
            return handle;
        }, function (e) {
            me.closed = true;
            throw e;
        });
    });
}

// ---- Capabilities ---------------------------------------------------------------------------

function pullPeople(ctx) {
    return ctx.connect().then(function (live) { return live.people(); }).then(function (people) {
        return {
            full: true, nextToken: null,
            changes: Object.keys(people).map(function (id) {
                return { remoteId: id, etag: people[id],
                         fields: { nickname: people[id] === id ? "" : people[id], ims: [{ value: id, type: IM_SERVICE }] } };
            })
        };
    });
}

function syncMessages(ctx) {
    return ctx.connect().then(function (live) { return live.syncNow(); });
}

function removeMessages(ctx) {
    var own = ctx.config.userId || (ctx.account && ctx.account.username) || "";
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

function verified(ctx, found, token, credentials) {
    var api = M.createApi(ctx.http, found.homeserver, token);
    return api.whoami().then(function (w) {
        return {
            username: w.user_id,
            credentials: { common: credentials },
            config: { homeserver: found.homeserver, serverName: found.serverName, userId: w.user_id, deviceId: w.device_id || "",
                      slidingSync: !!found.slidingSync, e2ee: false }
        };
    });
}

// How a homeserver signs in: {password, oauth}.
function signInOptions(ctx, p) {
    return M.discover(ctx.http, p.user || p.username).then(function (found) {
        var api = M.createApi(ctx.http, found.homeserver);
        return Promise.all([api.loginFlows().catch(function () { return { flows: [] }; }), api.authMetadata()]).then(function (r) {
            var flows = (r[0].flows || []).map(function (f) { return f.type; });
            return { homeserver: found.homeserver, serverName: found.serverName, slidingSync: found.slidingSync,
                     password: flows.indexOf("m.login.password") >= 0, oauth: !!(r[1] && r[1].authorization_endpoint && r[1].registration_endpoint) };
        });
    });
}

// The server's own page (OAuth 2.0 with PKCE; the client registered once per
// server, RFC 7591), as the Fediverse account signs in.
function signInOAuth(ctx, p) {
    var found, meta;
    return M.discover(ctx.http, p.user).then(function (f) {
        found = f;
        return M.createApi(ctx.http, f.homeserver).authMetadata();
    }).then(function (m) {
        meta = m;
        if (!meta || !meta.authorization_endpoint) throw fail("This homeserver does not sign in through OAuth", "UNSUPPORTED");
        [meta.authorization_endpoint, meta.token_endpoint, meta.registration_endpoint].forEach(function (u) { if (u) ctx.http.allowHost(new URL(u).host); });
        return lunaOk(ctx, OAUTH + "redirectUri", {});
    }).then(function (r) {
        var redirectUri = r.redirectUri, name = "matrix " + found.homeserver + " " + redirectUri;
        return lunaOk(ctx, OAUTH + "client", { name: name }).then(function (c) {
            if (c.value && c.value.clientId) return c.value;
            return ctx.http.json({ method: "POST", url: meta.registration_endpoint, json: {
                client_name: "webOS Phoenix", client_uri: "https://webosphoenix.org/", redirect_uris: [redirectUri], application_type: "native",
                grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none"
            } }).then(function (reg) {
                var client = { clientId: reg.client_id };
                return lunaOk(ctx, OAUTH + "client", { name: name, value: client }).then(function () { return client; });
            });
        }).then(function (client) {
            var device = "PHX" + Math.random().toString(36).slice(2, 10).toUpperCase();
            return lunaOk(ctx, OAUTH + "authorize", {
                authorizationEndpoint: meta.authorization_endpoint, tokenEndpoint: meta.token_endpoint, revocationEndpoint: meta.revocation_endpoint,
                clientId: client.clientId, redirectUri: redirectUri,
                scope: "urn:matrix:client:api:* urn:matrix:client:device:" + device
            });
        });
    }).then(function (auth) {
        return ctx.oauth.token(auth.keyId).then(function (token) { return verified(ctx, found, token, { oauthKey: auth.keyId }); });
    });
}

module.exports = kit.defineConnector({
    service: SERVICE,
    templateIds: [TEMPLATE],
    kinds: { state: "org.webosphoenix.matrix.state:1", item: "org.webosphoenix.matrix.item:1" },
    userAgent: "webOS-Phoenix-Matrix/0.1",
    // No account yet: Matrix.org's list of servers (no one server suggested by name, OPEN-QUESTIONS Q33).
    signUp: "https://matrix.org/ecosystem/hosting/",

    // {username: the Matrix ID, password} or {config: {oauthKey, homeserver}} after signIn.
    validate: function (ctx, p) {
        var c = p.config || {};
        if (c.oauthKey && c.homeserver) {
            return M.discover(ctx.http, c.userId || c.homeserver).then(function (found) {
                return ctx.oauth.token(c.oauthKey).then(function (t) { return verified(ctx, found, t, { oauthKey: c.oauthKey }); });
            });
        }
        if (!p.password) return Promise.reject(fail("Enter your password", "401_UNAUTHORIZED"));
        return M.discover(ctx.http, p.username).then(function (found) {
            var user = /^@/.test(p.username) ? p.username.trim() : String(p.username).trim();
            return M.createApi(ctx.http, found.homeserver).loginPassword(user, String(p.password)).then(function (r) {
                return verified(ctx, found, r.access_token, { accessToken: r.access_token, deviceId: r.device_id });
            }, function (e) {
                if (e.matrix === "M_FORBIDDEN" || e.status === 403) throw fail("Wrong Matrix ID or password", "401_UNAUTHORIZED");
                throw e;
            });
        });
    },

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

    // Signed out on the server too (the device's session ends), and an OAuth key forgotten.
    onDelete: function (ctx) {
        return apiFor(ctx).then(function (api) { return api.logout(); }).catch(function () {}).then(function () {
            return ctx.credentials && ctx.credentials.oauthKey ? ctx.oauth.forget(ctx.credentials.oauthKey) : null;
        });
    },

    methods: {
        signInOptions: function (ctx, p) { return signInOptions(ctx, p); },
        signIn: function (ctx, p) { return signInOAuth(ctx, p); },
        outbox: function (ctx, p) {
            if (p.accountId) return ctx.connect().then(function (live) { return live.flush(p.messageId); });
            return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] })
                .then(function (pending) {
                    var users = {};
                    pending.forEach(function (m) { if (!p.messageId || m._id === p.messageId) users[m.username] = true; });
                    return lunaOk(ctx, "luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE }).then(function (r) {
                        var chain = Promise.resolve(), sent = 0;
                        (r.results || []).filter(function (a) { return users[a.username]; }).forEach(function (a) {
                            chain = chain.then(function () {
                                return lunaOk(ctx, "luna://" + SERVICE + "/outbox", { accountId: a._id, messageId: p.messageId }).then(function (x) {
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
            if (a === 1) a = 0;
            if (a === 3) a = 2;
            return ctx.connect().then(function (live) { return live.setPresence(a, p.customMessage); }).then(function () { return {}; });
        }
    }
});

module.exports.ENCRYPTED_TEXT = ENCRYPTED_TEXT;
