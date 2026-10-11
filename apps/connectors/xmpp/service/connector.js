// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Jabber (XMPP) account (template com.webosphoenix.xmpp;
// docs/SYNERGY-CONNECTORS.md 7, "Jabber (XMPP), a real account";
// docs/SYNERGY-MODERN.md 2.2, roadmap 6a), on the connector kit. It does
// what webOS's IM transports did (the libpurple transport, imlibpurpleservice,
// which wrote the kinds below; its sources are GPL-2.0 and were only read):
//
//   sign-in      the Jabber ID and its password (lib/client.js: the server
//                from the domain's SRV records, TLS, SASL SCRAM, stream
//                management); the password stays in the account's
//                credentials, as the original's did ("common")
//   CONTACTS     the roster as contacts (com.palm.contact.xmpp:1, read
//                only): the roster's name, the address as an IM address
//                ({value: jid, type: "type_jabber"}), linked to the people of
//                the address book by the linker's rules. The original wrote
//                one com.palm.contact.libpurple:1 per buddy with imBuddy,
//                remoteId = the buddy's address, nickname and ims
//                (imlibpurpleservice src/BuddyListConsolidator.cpp,
//                ContactConsolidationHelper::formatForDB)
//   MESSAGING    chats in Messaging: com.palm.immessage.xmpp:1, as the
//                original's IMMessage::createDBObject wrote
//                com.palm.immessage.libpurple:1 (src/IMMessage.cpp: from
//                {addr, name?}, to [{addr}], folder, status, messageText,
//                username = the account's own address, serviceName,
//                localTimestamp = the device's time, timestamp = the
//                server's); serviceMessageId and deliveryStatus
//                ("delivered", "read") named as LuneOS's version of it names
//                them (inc/IMMessage.h). The account's state is
//                com.palm.imloginstate.xmpp:1 (db8: accountId, username,
//                serviceName, state "logging-on" | "retrieving-buddies" |
//                "online" | "offline", availability, customMessage; the
//                original's com.palm.imloginstate.libpurple:1,
//                src/IMLoginState.cpp), each buddy's presence
//                com.palm.imbuddystatus.xmpp:1 (tempdb: accountId, username,
//                serviceName, availability, status, group, displayName,
//                personId; the original's BuddyStatusConsolidationHelper)
//
// The connection stays open while the account has a capability on
// (definition.connection): messages arrive as they are sent, as
// notifications; it is resumed after a drop (XEP-0198), and messages sent
// from the user's other clients (carbons, XEP-0280) and while the device
// was away (the archive, XEP-0313) are filed too. Pictures go up with HTTP
// upload (XEP-0363) and come down from the link (XEP-0066). Receipts
// (XEP-0184) and markers (XEP-0333) give an outgoing message "delivered"
// and "read"; chat states (XEP-0085) "typing". Push (XEP-0357) is ready to
// be enabled once the push service exists (enablePush; phase C6).
//
// Not end-to-end encrypted: messages are encrypted between this device and
// the server (TLS), and between servers, but the servers' admins can read
// them. OMEMO needs a permissively licensed implementation, which there is
// not yet (docs/OPEN-QUESTIONS.md); an OMEMO message from someone else is
// filed as "encrypted, can't be read on this device", never as its
// fallback text.

"use strict";

var kit = require("@phoenix/connector-kit");
var C = require("./lib/client");
var S = require("./lib/stanzas");
var X = require("./lib/xml");

var SERVICE = "org.webosphoenix.service.xmpp";
var TEMPLATE = "com.webosphoenix.xmpp";
var MESSAGING_APP = "org.webosphoenix.messaging";
var IM_SERVICE = "type_jabber";
var MESSAGE_KIND = "com.palm.immessage.xmpp:1";
var CONTACT_KIND = "com.palm.contact.xmpp:1";
var LOGIN_KIND = "com.palm.imloginstate.xmpp:1";
var BUDDY_KIND = "com.palm.imbuddystatus.xmpp:1";
var THREAD_KIND = "com.palm.chatthread:1";
var PERSON_KIND = "com.palm.person:1";
var PROVIDERS = { messaging: TEMPLATE + ".im", contacts: TEMPLATE + ".contacts" };
var AVAILABLE = 0, BUSY = 2, OFFLINE = 4;
var FIRST_HISTORY = 20;             // the archive's latest messages on a first sign-in
var MAX_PAGES = 10;                 // archive pages read per catch-up (50 each)
var MAX_PICTURE = 10 * 1024 * 1024;
var RECONNECT_MS = [2000, 10000, 30000, 120000, 300000];
var FEATURES = ["urn:xmpp:carbons:2", "urn:xmpp:receipts", "urn:xmpp:chat-markers:0", "http://jabber.org/protocol/chatstates",
                "jabber:x:oob", "urn:xmpp:sid:0", "urn:xmpp:mam:2"];
var NOT_E2EE = "Not end-to-end encrypted: messages are encrypted on the way to your server and between servers, but the servers' admins can read them.";

function fail(message, errorCode) { var e = new Error(message); e.errorCode = errorCode; return e; }
function bare(j) { return C.bare(j); }

function normalJid(username) {
    var j = String(username || "").trim().toLowerCase().replace(/^xmpp:/, "");
    if (!/^[^@\s\/]+@[^@\s\/]+\.[^@\s\/]+$/.test(j) && !/^[^@\s\/]+@(localhost|127\.0\.0\.1)(:\d+)?$/.test(j))
        throw fail("Enter your Jabber ID, like you@example.org", "INVALID_USER");
    return j;
}

function client(ctx, jid, password, resource) {
    return C.createClient({
        net: ctx.net, http: ctx.http, jid: jid, password: password, resource: resource, features: FEATURES,
        log: function (m) { ctx.log(m); }, now: ctx.now,
        timers: { setTimeout: ctx.setTimeout, clearTimeout: ctx.clearTimeout },
        host: ctx.config && ctx.config.host || undefined, port: ctx.config && ctx.config.port || undefined,
        directTls: ctx.config && ctx.config.directTls || undefined
    });
}

// ---- The account's state in db8 -----------------------------------------------------------

function loginState(ctx) {
    return ctx.db.find({ from: LOGIN_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] }).then(function (r) { return r[0] || null; });
}

function displayName(item) {
    return (item && item.name) || (item && item.jid) || "";
}

// "Ada Palmer" -> {givenName: "Ada", familyName: "Palmer"} (the roster's name is the user's own for the buddy).
function nameOf(display, jid) {
    var parts = String(display || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length || display === jid) return null;
    return { givenName: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0], familyName: parts.length > 1 ? parts[parts.length - 1] : "" };
}

// ---- The session: one per account, while connected --------------------------------------------

function createSession(ctx) {
    var own = bare(ctx.config.jid || ctx.account.username);
    // The account's own server: its Jabber ID's domain (and the host given for it).
    ctx.http.allowHost(C.domainOf(own));
    ctx.net.allowHost(C.domainOf(own).replace(/:\d+$/, ""));
    var me = {
        closed: false, client: null, online: false, wanted: AVAILABLE, status: "", roster: [], rosterByJid: {},
        attempt: null, retryTimer: null, failures: 0, authFailed: null, upload: undefined, catchingUp: false,
        pendingAcks: {}, messaging: true
    };
    var resource = ctx.state.resource || (ctx.state.resource = "phoenix-" + Math.random().toString(36).slice(2, 8));

    function log(m) { ctx.log(m); }

    function setLogin(fields) {
        return loginState(ctx).then(function (cur) {
            if (!cur) {
                if (me.closed) return null;
                return ctx.db.put([Object.assign({ _kind: LOGIN_KIND, accountId: ctx.accountId, username: own, serviceName: IM_SERVICE,
                                                   state: "offline", availability: AVAILABLE, customMessage: "" }, fields)]);
            }
            var changed = Object.keys(fields).some(function (k) { return JSON.stringify(cur[k]) !== JSON.stringify(fields[k]); });
            return changed ? ctx.db.merge([Object.assign({ _id: cur._id }, fields)]) : null;
        }).catch(function (e) { log("login state not written: " + e.message); });
    }

    // ---- Buddies (the roster with presence) ----------------------------------------------------

    function buddyRecords() {
        return ctx.tempdb.find({ from: BUDDY_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] });
    }
    // The person a buddy is: the contact this account wrote for that address, and the person it is in.
    function personIds() {
        return ctx.db.find({ from: CONTACT_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] }).then(function (contacts) {
            var out = {}, chain = Promise.resolve();
            contacts.forEach(function (c) {
                chain = chain.then(function () {
                    return ctx.db.find({ from: PERSON_KIND, where: [{ prop: "contactIds", op: "=", val: c._id }] }).then(function (p) {
                        if (p[0]) out[String(c.remoteId).toLowerCase()] = p[0]._id;
                    });
                });
            });
            return chain.then(function () { return out; });
        }).catch(function () { return {}; });
    }
    function writeBuddies() {
        return Promise.all([buddyRecords(), personIds()]).then(function (r) {
            var existing = {}, persons = r[1];
            r[0].forEach(function (b) { existing[b.username] = b; });
            var puts = [], merges = [], dels = [];
            me.roster.forEach(function (item) {
                var b = existing[item.jid];
                delete existing[item.jid];
                var fields = { displayName: displayName(item), group: (item.groups && item.groups[0]) || "Buddies" };
                if (persons[item.jid]) fields.personId = persons[item.jid];
                if (!b) {
                    puts.push(Object.assign({ _kind: BUDDY_KIND, accountId: ctx.accountId, serviceName: IM_SERVICE, username: item.jid,
                                              availability: OFFLINE, personAvailability: OFFLINE, status: "" }, fields));
                } else if (Object.keys(fields).some(function (k) { return b[k] !== fields[k]; })) {
                    merges.push(Object.assign({ _id: b._id }, fields));
                }
            });
            Object.keys(existing).forEach(function (k) { dels.push(existing[k]._id); });
            return Promise.all([puts.length ? ctx.tempdb.put(puts) : null, merges.length ? ctx.tempdb.merge(merges) : null,
                                dels.length ? ctx.tempdb.del(dels) : null]);
        });
    }
    function buddy(jid) {
        return ctx.tempdb.find({ from: BUDDY_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }, { prop: "username", op: "=", val: jid }] })
            .then(function (r) { return r[0] || null; });
    }
    function mergeBuddy(jid, fields) {
        return buddy(jid).then(function (b) {
            if (!b) return null;
            var changed = Object.keys(fields).some(function (k) { return b[k] !== fields[k]; });
            return changed ? ctx.tempdb.merge([Object.assign({ _id: b._id }, fields)]) : null;
        }).catch(function () {});
    }
    // Presence per resource: the best of a buddy's clients (available over busy).
    var resources = {};
    function onPresence(p) {
        var from = p.attrs.from || "";
        var jid = bare(from);
        var type = p.attrs.type;
        if (type === "subscribe") return onSubscribe(jid, p);
        if (type && type !== "unavailable") return;
        if (jid === own || !me.rosterByJid[jid]) return;
        var r = resources[jid] = resources[jid] || {};
        if (type === "unavailable") delete r[from];
        else r[from] = { availability: S.availabilityOf(p), status: p.getChildText("status") || "" };
        var best = Object.keys(r).map(function (k) { return r[k]; }).sort(function (a, b) { return a.availability - b.availability; })[0];
        var availability = best ? best.availability : OFFLINE;
        return mergeBuddy(jid, { availability: availability, personAvailability: availability, status: best ? best.status : "" });
    }
    // Someone asks to see our presence (RFC 6121 3.1): a buddy the user
    // added is approved; anyone else is a notification for now (an approval
    // screen is still to come: docs/spec/GAPS.md).
    function onSubscribe(jid, p) {
        var item = me.rosterByJid[jid];
        if (item && (item.subscription === "to" || item.subscription === "none")) {
            me.client.send(X.el("presence", { to: jid, type: "subscribed" }));
            return;
        }
        if (item && item.subscription === "both") return;
        return ctx.notify({ title: jid, body: "wants to add you on Jabber", appId: MESSAGING_APP, params: {} });
    }

    function fetchRoster() {
        return me.client.iq(X.el("iq", { type: "get" }, X.el("query", { xmlns: "jabber:iq:roster" }))).then(function (r) {
            var q = r.getChild("query", "jabber:iq:roster");
            me.roster = (q ? q.getChildren("item") : []).map(function (i) {
                return { jid: bare(i.attrs.jid), name: i.attrs.name || "", subscription: i.attrs.subscription || "none",
                         groups: i.getChildren("group").map(function (g) { return g.text(); }) };
            }).filter(function (i) { return i.jid && i.subscription !== "remove"; });
            me.rosterByJid = {};
            me.roster.forEach(function (i) { me.rosterByJid[i.jid] = i; });
            return me.roster;
        });
    }

    // A roster push (RFC 6121 2.1.6): only from our own server.
    function onIq(ev) {
        var q = ev.iq.getChild("query", "jabber:iq:roster");
        if (!q || ev.iq.attrs.type !== "set") return;
        if (ev.iq.attrs.from && bare(ev.iq.attrs.from) !== own) return;
        ev.reply();
        q.getChildren("item").forEach(function (i) {
            var jid = bare(i.attrs.jid);
            if (i.attrs.subscription === "remove") {
                me.roster = me.roster.filter(function (x) { return x.jid !== jid; });
                delete me.rosterByJid[jid];
            } else {
                var item = { jid: jid, name: i.attrs.name || "", subscription: i.attrs.subscription || "none",
                             groups: i.getChildren("group").map(function (g) { return g.text(); }) };
                me.roster = me.roster.filter(function (x) { return x.jid !== jid; }).concat([item]);
                me.rosterByJid[jid] = item;
            }
        });
        writeBuddies().catch(function (e) { log("buddies: " + e.message); });
    }

    // ---- Messages in -----------------------------------------------------------------------------

    function findMessage(where) {
        return ctx.db.find({ from: MESSAGE_KIND, where: where });
    }
    function known(p) {
        var ids = [p.stanzaId, p.originId, p.id].filter(Boolean);
        var chain = Promise.resolve(null);
        // Our own message coming back (a carbon of a copy, the archive): its id is our db8 id.
        if (p.outgoing && (p.originId || p.id)) chain = ctx.db.get([p.originId || p.id]).then(function (r) { return r && r[0] && r[0]._kind === MESSAGE_KIND ? r[0] : null; }).catch(function () { return null; });
        ids.forEach(function (id) {
            chain = chain.then(function (found) {
                return found || findMessage([{ prop: "username", op: "=", val: own }, { prop: "serviceMessageId", op: "=", val: id }])
                    .then(function (r) { return r.filter(function (m) { return (m.from && m.from.addr) === p.from || (m.to && m.to[0] && m.to[0].addr) === p.peer; })[0] || null; });
            });
        });
        return chain;
    }

    // A picture someone sent: its link (XEP-0066 / XEP-0363) fetched once and
    // kept as a file of the device, as the MMS store keeps an MMS's pictures.
    function fetchPicture(url) {
        if (!/^https:\/\//.test(url) && !(/^http:\/\//.test(url) && C.isLoopback(new URL(url).host))) return Promise.resolve(null);
        var host = new URL(url).host;
        ctx.http.allowHost(host);
        return ctx.http.request({ method: "GET", url: url, binary: true }).then(function (r) {
            var type = String((r.headers && r.headers["content-type"]) || "").split(";")[0].trim();
            if (r.status !== 200 || !r.bytes || !/^image\//.test(type) || r.bytes.length > MAX_PICTURE) return null;
            var name = decodeURIComponent(url.replace(/[?#].*$/, "").replace(/^.*\//, "")) || "picture";
            return ctx.writeFile(Date.now().toString(36) + "-" + name, r.bytes, type).then(function (path) {
                return { path: path, mimeType: type, name: name };
            });
        }).catch(function (e) { log("picture not fetched: " + e.message); return null; });
    }

    function storeMessage(p, how) {
        var text = p.body || "";
        var picture = p.url && (!text || text.trim() === p.url) ? p.url : "";
        if (picture) text = "";
        if (p.encrypted) text = "Encrypted message (" + (p.encryptionName === "urn:xmpp:openpgp:0" ? "OpenPGP" : "OMEMO") +
            "): end-to-end encrypted messages can't be read on this device yet.";
        if (!text && !picture) return Promise.resolve(null);
        return known(p).then(function (existing) {
            if (existing) {
                // Our own message back from the server: it has its archive id now.
                if (p.outgoing && p.stanzaId && existing.serviceMessageId !== p.stanzaId)
                    return ctx.db.merge([{ _id: existing._id, serviceMessageId: p.stanzaId }]).then(function () { return null; });
                return null;
            }
            return (picture && !p.encrypted ? fetchPicture(picture) : Promise.resolve(null)).then(function (part) {
                if (picture && !part) text = picture;       // not a picture after all (or not fetched): the link
                var item = me.rosterByJid[p.peer];
                var now = ctx.now();
                var msg = {
                    _kind: MESSAGE_KIND, accountId: ctx.accountId, serviceName: IM_SERVICE, username: own,
                    folder: p.outgoing ? "outbox" : "inbox", status: "successful", messageText: text,
                    localTimestamp: how.history && p.stamp ? p.stamp : now, timestamp: p.stamp || now,
                    flags: { read: p.outgoing || !!how.read, visible: true },
                    serviceMessageId: p.stanzaId || p.originId || p.id || "",
                    xmpp: { id: p.id || "", stanzaId: p.stanzaId || "", markable: !!p.markable }
                };
                if (p.outgoing) msg.to = [{ addr: p.peer, name: displayName(item) || p.peer }];
                else msg.from = { addr: p.from, name: displayName(item) || p.from };
                if (part) msg.parts = [part];
                if (p.encrypted) msg.xmpp.encrypted = true;
                return ctx.putMessage(msg).then(function (r) {
                    if (p.outgoing || how.read || how.quiet) return r;
                    return ctx.notify({ title: msg.from.name, body: part ? (text ? "Picture: " + text : "Picture") : text, appId: MESSAGING_APP,
                                        params: { threadId: (r && r.threadids && r.threadids[0]) || "" } }).then(function () { return r; });
                });
            });
        });
    }

    // Delivered (a receipt) and read (a marker) on the message they name: monotonic, read outranks delivered.
    function markOutgoing(id, status, from) {
        return ctx.db.get([id]).then(function (r) {
            var m = r && r[0];
            if (!m || m._kind !== MESSAGE_KIND || m.username !== own || (m.to && m.to[0] && m.to[0].addr) !== from) return null;
            if (m.deliveryStatus === "read" || m.deliveryStatus === status) return null;
            return ctx.db.merge([{ _id: m._id, deliveryStatus: status }]);
        }).catch(function () { return null; });
    }

    function onMessage(el) {
        var p = S.parseMessage(el, own);
        if (!p) return;
        if (p.receiptId && !p.outgoing) markOutgoing(p.receiptId, "delivered", p.from);
        if (p.markerId && !p.outgoing) markOutgoing(p.markerId, "read", p.from);
        // Someone's reading of our message on another of our clients: nothing to file.
        if (p.chatState && !p.outgoing && !p.carbon) mergeBuddy(p.from, { chatState: p.chatState === "composing" ? "composing" : "" });
        if (!p.body && !p.url) return;
        if (!p.outgoing && !p.carbon && p.chatState !== "composing") mergeBuddy(p.from, { chatState: "" });
        if (p.wantsReceipt && !p.outgoing && !p.carbon && p.id) {
            try { me.client.send(S.receiptFor(p)); } catch (e) { /* offline again */ }
        }
        if (me.catchingUp) return;
        if (!me.messaging) return;
        storeMessage(p, {}).catch(function (e) { log("message not filed: " + e.message); });
    }

    // ---- The archive (XEP-0313): what came while the device was away -------------------------------

    function catchUp() {
        if (!me.messaging) return Promise.resolve({ archived: 0 });
        var mam = ctx.state.mam = ctx.state.mam || {};
        var first = !mam.started;
        var filed = 0, pages = 0;
        function page(after) {
            var qid = "q" + Math.random().toString(36).slice(2, 10);
            var got = [];
            function collect(el) {
                if (!el.is("message")) return;
                var p = S.parseMessage(el, own, { queryId: qid });
                if (p && p.archiveId) got.push(p);
            }
            me.client.on("stanza", collect);
            var set = X.el("set", { xmlns: "http://jabber.org/protocol/rsm" }, X.el("max", {}, String(first ? FIRST_HISTORY : 50)));
            if (first) set.append(X.el("before"));
            else if (after) set.append(X.el("after", {}, after));
            var q = X.el("query", { xmlns: "urn:xmpp:mam:2", queryid: qid },
                         X.el("x", { xmlns: "jabber:x:data", type: "submit" }, X.el("field", { var: "FORM_TYPE", type: "hidden" }, X.el("value", {}, "urn:xmpp:mam:2"))), set);
            me.catchingUp = true;
            return me.client.iq(X.el("iq", { type: "set" }, q), 60000).then(function (fin) {
                me.catchingUp = false;
                stopCollecting(collect);
                var chain = Promise.resolve();
                got.forEach(function (p) {
                    chain = chain.then(function () { return storeMessage(p, { history: true, read: first, quiet: true }); })
                        .then(function (r) { if (r) filed++; });
                });
                return chain.then(function () {
                    var f = fin.getChild("fin", "urn:xmpp:mam:2");
                    var last = got.length ? got[got.length - 1].archiveId : null;
                    if (last) mam.last = last;
                    pages++;
                    var complete = !f || f.attrs.complete === "true" || !got.length;
                    if (first || complete || pages >= MAX_PAGES) return;
                    return page(mam.last);
                });
            }, function (e) {
                me.catchingUp = false;
                stopCollecting(collect);
                // A server without an archive (item-not-found, feature-not-implemented): nothing to catch up.
                if (e.errorCode === "UNSUPPORTED") return;
                throw e;
            });
        }
        return page(mam.last || null).then(function () {
            mam.started = true;
            if (!first && filed) {
                // Missed messages (not from the first sign-in): one notification for them all.
                return ctx.notify({ title: "Jabber", body: filed === 1 ? "1 new message" : filed + " new messages", appId: MESSAGING_APP, params: {} });
            }
        }).then(function () { return ctx.saveState(); }).then(function () { return { archived: filed }; });
    }
    function stopCollecting(fn) {
        // client.on has no off(): the collector checks its query id, so a stale one files nothing.
        void fn;
    }

    // ---- Messages out ----------------------------------------------------------------------------

    function uploadService() {
        if (me.upload !== undefined) return Promise.resolve(me.upload);
        var domain = C.domainOf(own);
        return me.client.iq(X.el("iq", { type: "get", to: domain }, X.el("query", { xmlns: "http://jabber.org/protocol/disco#items" }))).then(function (r) {
            var items = (r.getChild("query") || X.el("x")).getChildren("item").map(function (i) { return i.attrs.jid; });
            var found = null, chain = Promise.resolve();
            [domain].concat(items).forEach(function (j) {
                chain = chain.then(function () {
                    if (found) return;
                    return me.client.iq(X.el("iq", { type: "get", to: j }, X.el("query", { xmlns: "http://jabber.org/protocol/disco#info" }))).then(function (info) {
                        var q = info.getChild("query");
                        var has = q && q.getChildren("feature").some(function (f) { return f.attrs.var === "urn:xmpp:http:upload:0"; });
                        if (!has) return;
                        var max = 0;
                        (q.getChildren("x", "jabber:x:data")).forEach(function (x) {
                            x.getChildren("field").forEach(function (f) { if (f.attrs.var === "max-file-size") max = Number(f.getChildText("value")) || 0; });
                        });
                        found = { jid: j, max: max };
                    }, function () {});
                });
            });
            return chain.then(function () { me.upload = found; return found; });
        });
    }

    // XEP-0363: a slot, the bytes PUT to it with the headers the server
    // named (only Authorization, Cookie, Expires: section 5), the GET link.
    function upload(part) {
        return ctx.readFile(part.path).then(function (f) {
            return uploadService().then(function (svc) {
                if (!svc) throw fail("Your server takes no pictures (no HTTP upload)", "UNSUPPORTED");
                if (svc.max && f.bytes.length > svc.max) throw fail("The picture is larger than your server takes", "SHARE_TOO_LARGE");
                var name = String(part.name || part.path).replace(/^.*\//, "");
                var type = part.mimeType || f.mimeType || "application/octet-stream";
                return me.client.iq(X.el("iq", { type: "get", to: svc.jid },
                    X.el("request", { xmlns: "urn:xmpp:http:upload:0", filename: name, size: String(f.bytes.length), "content-type": type }))).then(function (r) {
                    var slot = r.getChild("slot", "urn:xmpp:http:upload:0");
                    var put = slot && slot.getChild("put"), get = slot && slot.getChild("get");
                    if (!put || !get) throw fail("The server gave no upload slot", "SERVER_ERROR");
                    var headers = { "Content-Type": type };
                    put.getChildren("header").forEach(function (h) {
                        if (["authorization", "cookie", "expires"].indexOf(String(h.attrs.name).toLowerCase()) >= 0) headers[h.attrs.name] = h.text().replace(/[\r\n]/g, "");
                    });
                    var putUrl = put.attrs.url, getUrl = get.attrs.url;
                    if (!/^https:\/\//.test(putUrl) && !C.isLoopback(new URL(putUrl).host)) throw fail("The upload link is not secure", "SERVER_ERROR");
                    ctx.http.allowHost(new URL(putUrl).host);
                    return ctx.http.request({ method: "PUT", url: putUrl, headers: headers, body: f.bytes }).then(function (res) {
                        if (res.status !== 200 && res.status !== 201) throw fail("The picture was not uploaded (" + res.status + ")", "SERVER_ERROR");
                        return getUrl;
                    });
                });
            });
        });
    }

    function sendOne(m) {
        var to = m.to && m.to[0] && m.to[0].addr;
        if (!to) return ctx.db.merge([{ _id: m._id, status: "permanent-fail" }]);
        var pictures = (m.parts || []).filter(function (p) { return /^image\//.test(p.mimeType || ""); });
        return ctx.db.merge([{ _id: m._id, status: "sending", accountId: ctx.accountId }]).then(function () {
            var chain = Promise.resolve(), urls = [];
            pictures.forEach(function (p) { chain = chain.then(function () { return upload(p).then(function (u) { urls.push(u); }); }); });
            return chain.then(function () {
                // A picture: its link alone (as clients show it inline), then the text if any.
                urls.forEach(function (u, i) { me.client.send(S.chatMessage({ to: to, id: i === 0 && !m.messageText ? m._id : m._id + "-p" + i, url: u })); });
                if (m.messageText) me.client.send(S.chatMessage({ to: to, id: m._id, body: m.messageText }));
                var sm = me.client.streamManagement;
                if (!sm.enabled) return ctx.db.merge([{ _id: m._id, status: "successful", serviceMessageId: m._id }]);
                // Successful once the server has it (XEP-0198's acknowledgement).
                me.pendingAcks[m._id] = true;
                return ctx.db.merge([{ _id: m._id, serviceMessageId: m._id }]);
            });
        }).catch(function (e) {
            log("message not sent: " + e.message);
            return ctx.db.merge([{ _id: m._id, status: e.errorCode === "UNSUPPORTED" || e.errorCode === "SHARE_TOO_LARGE" ? "permanent-fail" : "failed",
                                   errorText: e.message }]);
        });
    }
    function onAcked(stanzas) {
        stanzas.forEach(function (s) {
            var id = s.is && s.is("message") && s.attrs.id ? s.attrs.id.replace(/-p\d+$/, "") : null;
            if (!id || !me.pendingAcks[id]) return;
            delete me.pendingAcks[id];
            ctx.db.merge([{ _id: id, status: "successful" }]).catch(function () {});
        });
    }

    var flushing = null;
    function flush(onlyId) {
        if (flushing) return flushing.then(function () { return flush(onlyId); });
        flushing = findMessage([{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }]).then(function (pending) {
            pending = pending.filter(function (m) { return m.username === own && (!onlyId || m._id === onlyId); })
                .sort(function (a, b) { return (a.localTimestamp || 0) - (b.localTimestamp || 0); });
            if (!pending.length) return { sent: 0 };
            if (!me.online) {
                // Signed out on purpose: they fail, as the original's did; else they wait for the connection.
                if (me.wanted === OFFLINE || me.authFailed)
                    return ctx.db.merge(pending.map(function (m) { return { _id: m._id, status: "failed", errorText: "Not signed in" }; })).then(function () { return { sent: 0 }; });
                return { sent: 0, waiting: pending.length };
            }
            var chain = Promise.resolve();
            pending.forEach(function (m) { chain = chain.then(function () { return sendOne(m); }); });
            return chain.then(function () { return { sent: pending.length }; });
        }).then(function (r) { flushing = null; return r; }, function (e) { flushing = null; throw e; });
        return flushing;
    }

    // ---- Connecting and staying connected -----------------------------------------------------------

    function wire(c) {
        c.on("stanza", function (el) {
            if (el.is("message")) onMessage(el);
            else if (el.is("presence")) onPresence(el);
        });
        c.on("iq", onIq);
        c.on("acked", onAcked);
        c.on("resumeFailed", function (ev) {
            // Messages the server never confirmed: sent again on the new stream (receivers drop duplicates by id).
            (ev.unacked || []).forEach(function (s) {
                var id = s.is("message") && s.attrs.id ? s.attrs.id.replace(/-p\d+$/, "") : null;
                if (id && me.pendingAcks[id]) { delete me.pendingAcks[id]; ctx.db.merge([{ _id: id, status: "pending" }]).catch(function () {}); }
            });
        });
        c.on("close", function (ev) {
            me.online = false;
            resources = {};
            if (me.closed) return;
            setLogin({ state: "offline" });
            markBuddiesOffline();
            if (ev.error && ev.error.errorCode === "401_UNAUTHORIZED") { me.authFailed = ev.error; return; }
            if (me.wanted !== OFFLINE) scheduleReconnect(ev.resumable, ev.error && ev.error.retryAt);
        });
    }

    function markBuddiesOffline() {
        return buddyRecords().then(function (list) {
            var changes = list.filter(function (b) { return b.availability !== OFFLINE || b.chatState; })
                .map(function (b) { return { _id: b._id, availability: OFFLINE, personAvailability: OFFLINE, chatState: "" }; });
            return changes.length ? ctx.tempdb.merge(changes) : null;
        }).catch(function () {});
    }

    // One connection attempt at a time; the stream resumed when the server kept it.
    function connect(resume) {
        if (me.attempt) return me.attempt;
        if (me.closed) return Promise.reject(fail("The account is signed out", "CONNECTION_FAILED"));
        ctx.clearTimeout(me.retryTimer);
        me.retryTimer = null;
        var password = ctx.credentials && ctx.credentials.password;
        if (!password) return Promise.reject(fail("The account has no password (sign in again)", "401_UNAUTHORIZED"));
        if (!me.client) { me.client = client(ctx, own, password, resource); wire(me.client); }
        setLogin({ state: "logging-on" });
        me.attempt = (resume ? me.client.resume() : me.client.connect()).then(function (r) {
            me.online = true;
            me.failures = 0;
            me.authFailed = null;
            return afterOnline(r.resumed);
        }).then(function () {
            me.attempt = null;
            return me;
        }, function (e) {
            me.attempt = null;
            me.online = false;
            if (me.client && !me.client.online) { /* the client stays for the next attempt */ }
            setLogin({ state: "offline" });
            if (e.errorCode === "401_UNAUTHORIZED") me.authFailed = e;
            throw e;
        });
        return me.attempt;
    }

    function afterOnline(resumed) {
        var c = me.client;
        if (resumed) {
            return setLogin({ state: "online" }).then(function () { return flush(); });
        }
        return setLogin({ state: "retrieving-buddies" }).then(function () {
            // XEP-0280: copies of what our other clients send and receive.
            return c.iq(X.el("iq", { type: "set" }, X.el("enable", { xmlns: "urn:xmpp:carbons:2" }))).catch(function () {});
        }).then(fetchRoster).then(writeBuddies).then(function () {
            if (me.messaging) c.send(S.presenceFor(me.wanted, me.status));
            return setLogin({ state: "online" });
        }).then(function () {
            return catchUp().catch(function (e) { log("archive not read: " + e.message); });
        }).then(function () { return flush(); });
    }

    function scheduleReconnect(resumable, retryAt) {
        if (me.closed || me.retryTimer) return;
        var wait = retryAt ? Math.max(1000, retryAt - ctx.now()) : RECONNECT_MS[Math.min(me.failures, RECONNECT_MS.length - 1)];
        me.failures++;
        me.retryTimer = ctx.setTimeout(function () {
            me.retryTimer = null;
            connect(resumable).catch(function (e) {
                log("reconnect failed: " + e.message);
                if (e.errorCode !== "401_UNAUTHORIZED") scheduleReconnect(false, e.retryAt);
            });
        }, wait);
    }

    // ---- The handle the kit keeps ------------------------------------------------------------------

    var handle = {
        get closed() { return me.closed; },
        get online() { return me.online; },
        // Connected, now: a wait for the backoff is cut short (a sync, a send).
        ready: function () {
            if (me.online) return Promise.resolve(me);
            if (me.wanted === OFFLINE) return Promise.reject(fail("Signed out (your status is Offline)", "CONNECTION_FAILED"));
            return connect(false);
        },
        // The roster as the server has it now (a contacts sync), the buddies with it.
        roster: function () {
            return handle.ready().then(function (s) { return s === me && me.online ? fetchRoster().then(writeBuddies) : null; })
                .then(function () { return me.roster.slice(); });
        },
        catchUp: function () { return handle.ready().then(catchUp); },
        relink: function () { return me.online ? writeBuddies() : Promise.resolve(); },
        flush: function (id) {
            if (me.online || me.wanted === OFFLINE || me.authFailed) return flush(id);
            return handle.ready().then(function () { return flush(id); }, function () { return flush(id); });
        },
        setPresence: function (availability, status) {
            me.wanted = availability;
            me.status = status || "";
            if (availability === OFFLINE) {
                var c = me.client;
                me.client = null;
                me.online = false;
                return Promise.resolve(c && c.close()).then(function () { return setLogin({ state: "offline", availability: OFFLINE }); })
                    .then(markBuddiesOffline);
            }
            return setLogin({ availability: availability, customMessage: me.status }).then(function () {
                if (me.online) { me.client.send(S.presenceFor(availability, me.status)); return; }
                return connect(false).then(function () {});
            });
        },
        markDisplayed: function (to, id) {
            if (!me.online) return Promise.resolve(false);
            me.client.send(S.displayedFor(to, id));
            return Promise.resolve(true);
        },
        chatState: function (to, state) {
            if (!me.online) return Promise.resolve(false);
            me.client.send(S.chatState(to, state));
            return Promise.resolve(true);
        },
        // XEP-0357: the push service's app server (phase C6) when it exists.
        enablePush: function (jid, node, secret) {
            return handle.ready().then(function () {
                var e = X.el("enable", { xmlns: "urn:xmpp:push:0", jid: jid, node: node });
                if (secret) e.append(X.el("x", { xmlns: "jabber:x:data", type: "submit" },
                    X.el("field", { var: "FORM_TYPE" }, X.el("value", {}, "http://jabber.org/protocol/pubsub#publish-options")),
                    X.el("field", { var: "secret" }, X.el("value", {}, secret))));
                return me.client.iq(X.el("iq", { type: "set" }, e));
            });
        },
        close: function () {
            me.closed = true;
            ctx.clearTimeout(me.retryTimer);
            var c = me.client;
            me.client = null;
            me.online = false;
            return Promise.resolve(c && c.close()).then(function () {
                return loginState(ctx).then(function (s) { return s && s.state !== "offline" ? ctx.db.merge([{ _id: s._id, state: "offline" }]) : null; })
                    .catch(function () {});
            }).then(markBuddiesOffline);
        }
    };

    return loginState(ctx).then(function (s) {
        me.wanted = s && typeof s.availability === "number" ? s.availability : AVAILABLE;
        me.status = s && s.customMessage || "";
        me.messaging = (ctx.account.capabilityProviders || []).some(function (c) { return c.id === PROVIDERS.messaging; });
        if (!s && me.messaging) return setLogin({});
    }).then(function () {
        if (me.wanted === OFFLINE) return handle;
        return connect(false).then(function () { return handle; }, function (e) {
            // A refused sign-in or a server that asks to wait ends here (the sync says so);
            // anything else is tried again in a while.
            if (e.errorCode === "401_UNAUTHORIZED" || e.retryAt) { me.closed = true; throw e; }
            scheduleReconnect(false, null);
            throw e;
        });
    });
}

// ---- The capabilities ----------------------------------------------------------------------------

function pullRoster(ctx) {
    return ctx.connect().then(function (live) { return live.roster(); }).then(function (roster) {
        return {
            full: true, nextToken: null,
            changes: roster.map(function (item) {
                var name = nameOf(item.name, item.jid);
                var fields = { nickname: item.name || "", ims: [{ value: item.jid, type: IM_SERVICE }], imBuddy: true };
                if (name) fields.name = name;
                return { remoteId: item.jid, etag: JSON.stringify([item.name, item.jid]), fields: fields };
            })
        };
    });
}

function syncMessages(ctx) {
    return ctx.connect().then(function (live) {
        return live.ready().then(function () { return live.relink(); }).then(function () { return live.catchUp(); })
            .then(function (r) { return live.flush().then(function (f) { return Object.assign({}, r, f); }); });
    });
}

// Messaging turned off or the account deleted: its messages, its
// conversations, its state and its buddies (the connection closed first).
function removeMessages(ctx) {
    var own = bare(ctx.config.jid || (ctx.account && ctx.account.username) || "");
    var live = ctx.live();
    return Promise.resolve(live && live.close()).then(function () {
        return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "username", op: "=", val: own }] });
    }).then(function (msgs) {
        var threads = {};
        msgs = msgs.filter(function (m) { return !m.accountId || m.accountId === ctx.accountId; });
        msgs.forEach(function (m) { (m.conversations || []).forEach(function (t) { threads[t] = true; }); });
        return (msgs.length ? ctx.db.del(msgs.map(function (m) { return m._id; })) : Promise.resolve()).then(function () {
            return ctx.db.find({ from: THREAD_KIND, where: [{ prop: "replyService", op: "=", val: IM_SERVICE }] });
        }).then(function (all) {
            var ids = all.filter(function (t) { return threads[t._id] || (own && t.username === own); }).map(function (t) { return t._id; });
            return ids.length ? ctx.db.del(ids) : null;
        });
    }).then(function () {
        return ctx.db.find({ from: LOGIN_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] });
    }).then(function (s) {
        return s.length ? ctx.db.del(s.map(function (x) { return x._id; })) : null;
    }).then(function () {
        return ctx.tempdb.find({ from: BUDDY_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] });
    }).then(function (b) {
        return b.length ? ctx.tempdb.del(b.map(function (x) { return x._id; })) : null;
    });
}

// Which account a pending message is from: its username (the account's address).
function accountsFor(ctx, usernames) {
    return ctx.luna.call("luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE }).then(function (r) {
        return (r.results || []).filter(function (a) { return usernames[bare(a.username)]; });
    });
}

module.exports = kit.defineConnector({
    service: SERVICE,
    templateIds: [TEMPLATE],
    kinds: { state: "org.webosphoenix.xmpp.state:1", item: "org.webosphoenix.xmpp.item:1" },
    userAgent: "webOS-Phoenix-Jabber/0.2",
    // No account yet: the XMPP community's list of public servers, or Snikket
    // (a server for family and friends); no one server suggested by name (OPEN-QUESTIONS Q33).
    signUp: { url: "https://providers.xmpp.net/", servers: [{ name: "Snikket (run your own)", url: "https://snikket.org/" }] },

    // The template's validator: {username: the Jabber ID, password}.
    validate: function (ctx, p) {
        var jid;
        try { jid = normalJid(p.username || (p.config && p.config.jid)); } catch (e) { return Promise.reject(e); }
        var password = String(p.password || (p.config && p.config.password) || "");
        if (!password) return Promise.reject(fail("Enter your password", "401_UNAUTHORIZED"));
        var domain = C.domainOf(jid);
        ctx.net.allowHost(domain.replace(/:\d+$/, ""));
        ctx.http.allowHost(domain);
        // A server without SRV records on another port: the host and port given ("advanced").
        var given = p.config || {};
        var server = {};
        if (given.host) {
            server.host = String(given.host).trim().toLowerCase();
            server.port = Number(given.port) || 5222;
            if (given.directTls) server.directTls = true;
            if (!/^[a-z0-9.-]+$/.test(server.host) || !(server.port > 0 && server.port < 65536))
                return Promise.reject(fail("The server's host and port are not valid", "HOST_NOT_FOUND"));
            ctx.net.allowHost(server.host);
        }
        var c = client(Object.assign({}, ctx, { config: server }), jid, password, "phoenix-check");
        return c.connect().then(function (r) {
            var secure = c.secure;
            return c.close().then(function () {
                return {
                    username: jid,
                    credentials: { common: { password: password } },
                    config: Object.assign({ jid: jid, server: domain, tls: secure, e2ee: false, boundJid: r.jid }, server)
                };
            });
        });
    },

    capabilities: (function () {
        var caps = {};
        // CONTACTS first: the buddies' people are linked once the contacts are written.
        caps[PROVIDERS.contacts] = { capability: "CONTACTS", kind: CONTACT_KIND, fields: ["name", "nickname", "ims", "imBuddy"], pull: pullRoster };
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

    methods: {
        // {accountId?, messageId?}: Messaging's pending messages (the db8 watch; the simulator's IM transport).
        outbox: function (ctx, p) {
            if (p.accountId) return ctx.connect().then(function (live) { return live.flush(p.messageId); });
            return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] })
                .then(function (pending) {
                    var users = {};
                    pending.forEach(function (m) { if (!p.messageId || m._id === p.messageId) users[bare(m.username)] = true; });
                    return accountsFor(ctx, users);
                }).then(function (accounts) {
                    var chain = Promise.resolve(), sent = 0;
                    accounts.forEach(function (a) {
                        chain = chain.then(function () {
                            return ctx.luna.call("luna://" + SERVICE + "/outbox", { accountId: a._id, messageId: p.messageId }).then(function (r) {
                                if (r && r.returnValue === false) throw fail(r.errorText || "not sent", r.errorCode || "UNKNOWN_ERROR");
                                sent += (r && r.sent) || 0;
                            });
                        });
                    });
                    return chain.then(function () { return { sent: sent }; });
                });
        },
        // {accountId, availability, customMessage?}: your own status (Messaging's
        // status menu, as the original's wrote imloginstate.availability).
        setPresence: function (ctx, p) {
            var a = Number(p.availability);
            if ([AVAILABLE, 1, BUSY, 3, OFFLINE].indexOf(a) < 0) return Promise.reject(fail("availability: 0, 2 or 4", "400_BAD_REQUEST"));
            if (a === 1) a = AVAILABLE;
            if (a === 3) a = BUSY;
            var live = ctx.live();
            if (live) return live.setPresence(a, p.customMessage).then(function () { return {}; });
            if (!ctx.connectionsHere()) return Promise.reject(fail("Connections are kept elsewhere", "NOT_LIVE_HERE"));
            return loginState(ctx).then(function (s) {
                var fields = { availability: a };
                if (p.customMessage !== undefined) fields.customMessage = String(p.customMessage);
                return s ? ctx.db.merge([Object.assign({ _id: s._id }, fields)]) : null;
            }).then(function () { return a === OFFLINE ? null : ctx.connect(); }).then(function () { return {}; });
        },
        // {accountId, threadId}: the conversation was read: its last markable message marked displayed (XEP-0333).
        markRead: function (ctx, p) {
            return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "conversations", op: "=", val: p.threadId }] }).then(function (msgs) {
                var last = msgs.filter(function (m) { return m.folder === "inbox" && m.xmpp && m.xmpp.markable && m.xmpp.id; })
                    .sort(function (a, b) { return (b.localTimestamp || 0) - (a.localTimestamp || 0); })[0];
                if (!last) return { marked: false };
                var live = ctx.live();
                if (!live) return ctx.connectionsHere() ? { marked: false } : Promise.reject(fail("Connections are kept elsewhere", "NOT_LIVE_HERE"));
                return live.markDisplayed(last.from.addr, last.xmpp.id).then(function (ok) { return { marked: ok }; });
            });
        },
        // {accountId, to, state: "composing" | "paused" | "active"}: typing (XEP-0085).
        chatState: function (ctx, p) {
            var live = ctx.live();
            if (!live) return ctx.connectionsHere() ? Promise.resolve({ sent: false }) : Promise.reject(fail("Connections are kept elsewhere", "NOT_LIVE_HERE"));
            var state = ["composing", "paused", "active"].indexOf(p.state) >= 0 ? p.state : "active";
            return live.chatState(bare(p.to), state).then(function (ok) { return { sent: ok }; });
        },
        // {accountId, jid, node, secret?}: XEP-0357 push, for the push service (phase C6).
        enablePush: function (ctx, p) {
            return ctx.connect().then(function (live) { return live.enablePush(String(p.jid), String(p.node), p.secret); }).then(function () { return {}; });
        }
    }
});

module.exports.NOT_E2EE = NOT_E2EE;
