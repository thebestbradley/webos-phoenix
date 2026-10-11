// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Bluesky account (template com.webosphoenix.bluesky;
// docs/SYNERGY-CONNECTORS.md 1 "Social and feeds", SYNERGY-MODERN.md 3.1),
// on the connector kit, for any account on the AT Protocol (Bluesky's own
// PDS or a self-hosted one): lib/atproto.js has the protocol.
//
// Sign-in (accounts/wizard.html):
//   - the handle and an app password (Bluesky's Settings, Privacy and
//     security, App passwords; "allow access to your direct messages" for
//     Messaging): the handle is resolved to its DID and PDS, and
//     com.atproto.server.createSession checks the password. Needs no
//     registration: works in every build.
//   - Sign In with Bluesky (AT Protocol OAuth, lib/oauth.js): PAR, PKCE and
//     DPoP, the client id being the address of the client metadata
//     document Phoenix hosts (oauth/client-metadata.json; no approval by
//     Bluesky). Offered when the image names that address
//     (/etc/palm/bluesky/clients.json) and the system's sign-in sheet can be
//     asked for the browser step alone (org.webosphoenix.service.oauth
//     "sheet"); otherwise "not available in this build".
//
// What the account brings, one capability each:
//   CONTACTS   the accounts you follow as contacts (read only,
//              com.palm.contact.bluesky:1): name, @handle, avatar, the
//              profile's link and description; the linker joins one to a
//              person you have by name
//   MESSAGING  Bluesky's direct messages (chat.bsky, through the PDS to the
//              chat service) in Messaging, one thread per person
//              (com.palm.immessage.bluesky:1, serviceName "type_bluesky",
//              labelled "not end-to-end encrypted"); a reply from Messaging
//              is sent to the conversation (outbox)
//   SOCIAL     likes, reposts, follows, mentions, replies and quotes as
//              notifications (polled every 15 minutes; Bluesky has no push
//              for other clients); a tap opens the post on bsky.app
//
// Sharing: the share sheet posts to the account (app.bsky.feed.post: text
// of up to 300 graphemes with its links as facets, up to four pictures of
// 1 MB with alt text), through the kit's compose page (index.html).

"use strict";

var kit = require("@phoenix/connector-kit");
var A = require("./lib/atproto");
var O = require("./lib/oauth");

var SERVICE = "org.webosphoenix.service.bluesky";
var TEMPLATE = "com.webosphoenix.bluesky";
var APP = "org.webosphoenix.bluesky";
var MESSAGING_APP = "org.webosphoenix.messaging";
var IM_SERVICE = "type_bluesky";
var CONTACT_KIND = "com.palm.contact.bluesky:1";
var MESSAGE_KIND = "com.palm.immessage.bluesky:1";
var THREAD_KIND = "com.palm.chatthread:1";
var CLIENTS = "bluesky/clients.json";
var OAUTH_SVC = "luna://org.webosphoenix.service.oauth/";
var PROVIDERS = { contacts: TEMPLATE + ".contacts", messaging: TEMPLATE + ".messaging", notifications: TEMPLATE + ".notifications" };
var CONTACT_FIELDS = ["name", "nickname", "urls", "photos", "note"];
var NOTIFY = ["like", "repost", "follow", "mention", "reply", "quote"];
var MAX_TOASTS = 5;

function fail(message, errorCode) { var e = new Error(message); e.errorCode = errorCode; return e; }

// The image's setting: the OAuth client's address and redirect, and (tests) the resolver's and directory's.
function settings(ctx) {
    return ctx.systemConfig(CLIENTS).then(function (all) {
        var c = (all && all.bluesky) || {};
        ["resolver", "plc", "wellKnown", "didWeb"].forEach(function (k) {
            if (c[k] && /^https?:/.test(c[k])) { try { ctx.http.allowHost(new URL(c[k].replace(/\{[a-z]+\}/g, "x")).host); } catch (e) { /* not an address */ } }
        });
        return c;
    });
}

// Sign In with Bluesky needs the client's address and the system's sheet for the browser step.
function oauthAvailable(ctx) {
    return settings(ctx).then(function (c) {
        if (!c.clientId || !c.redirectUri) return { available: false, reason: kit.notAvailable("Sign In with Bluesky").message + ". An app password works instead." };
        return Promise.resolve().then(function () { return ctx.luna.call(OAUTH_SVC + "sheet", { probe: true }); }).then(function (r) {
            if (r && r.returnValue !== false) return { available: true, client: c };
            throw new Error("no sheet");
        }).catch(function () {
            return { available: false, reason: "Sign In with Bluesky is not available in this build: the device's sign-in sheet cannot be lent for the AT Protocol's sign-in yet. An app password works instead." };
        });
    });
}

// ---- The account's client -------------------------------------------------------------------

function whoOf(ctx) {
    var c = ctx.config || {};
    if (!c.did || !c.pds) throw fail("The account has no DID or PDS: sign in again", "401_UNAUTHORIZED");
    ctx.http.allowHost(new URL(c.pds).host);
    return { did: c.did, handle: c.handle, pds: c.pds };
}

function session(ctx) {
    return settings(ctx).then(function (cfg) {
        var who = whoOf(ctx), cred = ctx.credentials || {};
        if (cred.appPassword) {
            var store = { get: function () { return ctx.state.session || null; }, set: function (s) { ctx.state.session = s; } };
            return { who: who, api: A.passwordClient(ctx, who, cred.appPassword, store) };
        }
        if (cred.oauth) {
            // The session from the sign-in, then the one refreshed since (refresh tokens are used once).
            var ostore = { get: function () { return ctx.state.oauth || cred.oauth; }, set: function (s) { ctx.state.oauth = s; } };
            return { who: who, api: O.oauthClient(ctx, ostore, cfg.clientId) };
        }
        throw fail("The account has no app password or sign-in: sign in again", "401_UNAUTHORIZED");
    });
}

function result(who, profile, credentials, mode) {
    return {
        username: who.handle,
        credentials: { common: credentials },
        config: { did: who.did, handle: who.handle, pds: who.pds, mode: mode, displayName: (profile && profile.displayName) || "" }
    };
}

// ---- Contacts: the accounts you follow -----------------------------------------------------

function nameOf(p) {
    var n = String(p.displayName || "").trim() || p.handle;
    var words = n.split(" ").filter(Boolean);
    if (words.length < 2) return { givenName: n, familyName: "" };
    return { givenName: words.slice(0, -1).join(" "), familyName: words[words.length - 1] };
}

function pullFollows(ctx) {
    return session(ctx).then(function (s) {
        var all = [];
        // https://docs.bsky.app/docs/api/app-bsky-graph-get-follows (limit 100, cursor)
        function page(cursor, n) {
            return s.api.get("app.bsky.graph.getFollows", { actor: s.who.did, limit: 100, cursor: cursor }).then(function (r) {
                all = all.concat(r.follows || []);
                return r.cursor && (r.follows || []).length && n < 50 ? page(r.cursor, n + 1) : all;
            });
        }
        return page(null, 0).then(function (follows) {
            var chain = Promise.resolve(), changes = [];
            follows.forEach(function (p) {
                chain = chain.then(function () {
                    return Promise.resolve(p.avatar ? ctx.cachePhoto("avatar:" + p.did, p.avatar) : "").then(function (photo) {
                        changes.push({
                            remoteId: p.did,
                            etag: JSON.stringify([p.handle, p.displayName || "", p.avatar || "", p.description || ""]),
                            fields: {
                                name: nameOf(p), nickname: "@" + p.handle,
                                urls: [{ value: "https://bsky.app/profile/" + p.handle, type: "type_profile" }],
                                note: String(p.description || "").slice(0, 1000),
                                photos: photo ? [{ value: photo, localPath: photo, type: "type_big", primary: true }] : []
                            }
                        });
                    });
                });
            });
            return chain.then(function () { return { full: true, changes: changes, nextToken: null }; });
        });
    });
}

// ---- Messaging: direct messages ------------------------------------------------------------

function memberOf(convo, ownDid) {
    return (convo.members || []).filter(function (m) { return m.did !== ownDid; })[0] || null;
}

function syncMessages(ctx) {
    return session(ctx).then(function (s) {
        var st = ctx.state.messaging = ctx.state.messaging || {};
        var first = !st.started;
        var revs = st.revs || {};
        var chat = { proxy: A.CHAT_PROXY };
        // https://docs.bsky.app/docs/api/chat-bsky-convo-list-convos
        return s.api.get("chat.bsky.convo.listConvos", { limit: 50 }, chat).then(function (r) {
            var convos = (r.convos || []).filter(function (c) { return c.rev !== revs[c.id]; });
            var chain = Promise.resolve(), stored = 0;
            convos.forEach(function (convo) {
                chain = chain.then(function () {
                    var other = memberOf(convo, s.who.did);
                    if (!other) { revs[convo.id] = convo.rev; return null; }
                    // https://docs.bsky.app/docs/api/chat-bsky-convo-get-messages (newest first)
                    return s.api.get("chat.bsky.convo.getMessages", { convoId: convo.id, limit: 30 }, chat).then(function (m) {
                        var seen = (st.last || {})[convo.id] || "";
                        var fresh = (m.messages || []).filter(function (x) {
                            return x.$type !== "chat.bsky.convo.defs#deletedMessageView" && x.sender && x.sender.did !== s.who.did &&
                                (!seen || String(x.rev || x.id) > seen);
                        }).reverse();
                        var inner = Promise.resolve();
                        fresh.forEach(function (x) {
                            inner = inner.then(function () {
                                var t = Date.parse(x.sentAt) || ctx.now();
                                var name = other.displayName || other.handle;
                                return ctx.putMessage({
                                    _kind: MESSAGE_KIND, accountId: ctx.accountId, folder: "inbox", status: "successful", serviceName: IM_SERVICE,
                                    username: s.who.handle, from: { addr: other.handle, name: name }, messageText: String(x.text || ""),
                                    localTimestamp: t, timestamp: t, flags: { read: first, visible: true },
                                    bluesky: { convoId: convo.id, messageId: x.id, did: other.did }
                                }).then(function (res) {
                                    stored++;
                                    if (first) return null;
                                    return ctx.notify({ title: name, body: String(x.text || ""), appId: MESSAGING_APP,
                                                        params: { threadId: (res && res.threadids && res.threadids[0]) || "" } });
                                });
                            });
                        });
                        return inner.then(function () {
                            var newest = (m.messages || []).reduce(function (a, x) { var k = String(x.rev || x.id || ""); return k > a ? k : a; }, seen);
                            st.last = Object.assign({}, st.last || {}, (function () { var o = {}; o[convo.id] = newest; return o; })());
                            revs[convo.id] = convo.rev;
                        });
                    });
                });
            });
            return chain.then(function () {
                st.revs = revs;
                st.started = true;
                return { directMessages: stored, first: first };
            });
        });
    }).catch(function (e) {
        // An app password made without "Allow access to your direct messages": the chat service refuses its token.
        if ((e.status === 400 || e.status === 401 || e.status === 403) && /scope|not allowed|forbidden/i.test(e.message || ""))
            throw fail("This app password may not read direct messages: make one with \"Allow access to your direct messages\" and sign in again", "401_UNAUTHORIZED");
        throw e;
    });
}

function removeMessages(ctx) {
    var own = (ctx.config && ctx.config.handle) || "";
    return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] }).then(function (msgs) {
        var threads = {};
        msgs.forEach(function (m) { (m.conversations || []).forEach(function (t) { threads[t] = true; }); });
        return (msgs.length ? ctx.db.del(msgs.map(function (m) { return m._id; })) : Promise.resolve()).then(function () {
            return ctx.db.find({ from: THREAD_KIND, where: [{ prop: "replyService", op: "=", val: IM_SERVICE }] });
        }).then(function (all) {
            var ids = all.filter(function (t) { return threads[t._id] || (own && t.username === own); }).map(function (t) { return t._id; });
            return ids.length ? ctx.db.del(ids) : null;
        });
    });
}

// Messaging's pending replies of this account: each to its conversation.
function sendOutbox(ctx, p) {
    var own = (ctx.config && ctx.config.handle) || ctx.account.username;
    return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] })
        .then(function (pending) {
            pending = pending.filter(function (m) { return m.username === own && (!p.messageId || m._id === p.messageId); });
            if (!pending.length) return { sent: 0 };
            return session(ctx).then(function (s) {
                var chain = Promise.resolve(), sent = 0, chat = { proxy: A.CHAT_PROXY };
                pending.forEach(function (m) {
                    chain = chain.then(function () {
                        var to = m.to && m.to[0] && m.to[0].addr;
                        return ctx.db.merge([{ _id: m._id, status: "sending", accountId: ctx.accountId }]).then(function () {
                            // Whom: the DID their messages came with, else their handle resolved.
                            return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "inbox" }, { prop: "from.addr", op: "=", val: to }] });
                        }).then(function (theirs) {
                            var known = theirs.filter(function (x) { return x.bluesky && x.bluesky.did; })[0];
                            if (known) return { did: known.bluesky.did };
                            return settings(ctx).then(function (cfg) { return A.resolve(ctx, to, cfg); }).catch(function () { return null; });
                        }).then(function (them) {
                            if (!them) throw fail("No Bluesky account @" + to, "INVALID_USER");
                            // https://docs.bsky.app/docs/api/chat-bsky-convo-get-convo-for-members
                            return s.api.get("chat.bsky.convo.getConvoForMembers", { members: [them.did] }, chat);
                        }).then(function (r) {
                            return s.api.post("chat.bsky.convo.sendMessage", { convoId: r.convo.id, message: { text: String(m.messageText || "") } }, chat)
                                .then(function (x) { return { convoId: r.convo.id, id: x.id }; });
                        }).then(function (x) {
                            sent++;
                            return ctx.db.merge([{ _id: m._id, status: "successful", accountId: ctx.accountId, bluesky: { convoId: x.convoId, messageId: x.id } }]);
                        }, function (e) {
                            ctx.log("message not sent: " + e.message);
                            return ctx.db.merge([{ _id: m._id, status: "failed" }]);
                        });
                    });
                });
                return chain.then(function () { return { sent: sent }; });
            });
        });
}

// ---- Notifications ---------------------------------------------------------------------------

function notificationText(n, own) {
    var who = (n.author && (n.author.displayName || n.author.handle)) || "Someone";
    var text = n.record && typeof n.record.text === "string" ? n.record.text.slice(0, 140) : "";
    var open = /app\.bsky\.feed\.post/.test(n.uri || "") ? A.postUrl(n.uri, n.author && n.author.handle)
        : n.reasonSubject ? A.postUrl(n.reasonSubject, own) : "https://bsky.app/profile/" + ((n.author && n.author.handle) || "");
    switch (n.reason) {
    case "like": return { title: who + " liked your post", body: "", open: n.reasonSubject ? A.postUrl(n.reasonSubject, own) : open };
    case "repost": return { title: who + " reposted your post", body: "", open: n.reasonSubject ? A.postUrl(n.reasonSubject, own) : open };
    case "follow": return { title: who + " followed you", body: "@" + ((n.author && n.author.handle) || ""), open: "https://bsky.app/profile/" + ((n.author && n.author.handle) || "") };
    case "mention": return { title: who + " mentioned you", body: text, open: open };
    case "reply": return { title: who + " replied to you", body: text, open: open };
    case "quote": return { title: who + " quoted your post", body: text, open: open };
    }
    return null;
}

function syncNotifications(ctx) {
    return session(ctx).then(function (s) {
        var st = ctx.state.notifications = ctx.state.notifications || {};
        var first = !st.started;
        // https://docs.bsky.app/docs/api/app-bsky-notification-list-notifications (newest first)
        return s.api.get("app.bsky.notification.listNotifications", { limit: 50, reasons: NOTIFY }).then(function (r) {
            var list = (r.notifications || []).filter(function (n) { return NOTIFY.indexOf(n.reason) >= 0; });
            var newer = list.filter(function (n) { return !st.seen || String(n.indexedAt) > st.seen; }).reverse();
            var shown = first ? [] : newer.map(function (n) { return notificationText(n, s.who.handle); }).filter(Boolean);
            var chain = Promise.resolve();
            shown.slice(-MAX_TOASTS).forEach(function (t) {
                chain = chain.then(function () { return ctx.notify({ title: t.title, body: t.body, appId: APP, params: t.open ? { open: t.open } : {} }); });
            });
            if (shown.length > MAX_TOASTS) {
                chain = chain.then(function () {
                    return ctx.notify({ title: (shown.length - MAX_TOASTS) + " more on Bluesky", appId: APP, params: { open: "https://bsky.app/notifications" } });
                });
            }
            return chain.then(function () {
                var newest = list.reduce(function (a, n) { return String(n.indexedAt) > a ? String(n.indexedAt) : a; }, st.seen || "");
                if (newest && newest !== st.seen) st.seen = newest;
                st.started = true;
                return { notified: shown.length, first: first };
            });
        });
    });
}

// ---- Posting -------------------------------------------------------------------------------

var SHARE = {
    label: "Bluesky",
    accountLabel: "@{username}",
    accepts: {
        text: { maxLength: 300 },
        link: true,
        image: { max: 4, maxBytes: 1000000, mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"], altText: { maxLength: 2000 } }
    },
    send: function (ctx, content) {
        var text = String(content.text || "").trim();
        if (content.url && text.indexOf(content.url) < 0) text = text ? text + "\n\n" + content.url : content.url;
        return post(ctx, { text: text, files: content.files, idempotencyKey: content.idempotencyKey });
    }
};

// com.atproto.repo.createRecord of an app.bsky.feed.post
// (https://docs.bsky.app/docs/advanced-guides/posts), with a record key
// made from the share's key, so a retry cannot post twice (the PDS refuses
// a second record of that key).
function post(ctx, p) {
    var text = String(p.text || "");
    var files = (p.files || []).slice(0, 4);
    if (!text.trim() && !files.length) return Promise.reject(fail("Nothing to post", "400_BAD_REQUEST"));
    if (A.graphemes(text) > 300) return Promise.reject(fail("A Bluesky post is 300 characters at most", "400_BAD_REQUEST"));
    return session(ctx).then(function (s) {
        var chain = Promise.resolve([]);
        files.forEach(function (f) {
            chain = chain.then(function (images) {
                return (f.read ? f.read() : ctx.readFile(f.path)).then(function (got) {
                    return s.api.upload(got.bytes, f.mimeType || got.mimeType);
                }).then(function (b) { return images.concat({ alt: f.description || "", image: b.blob }); });
            });
        });
        return chain.then(function (images) {
            var record = { $type: "app.bsky.feed.post", text: text, createdAt: new Date(ctx.now()).toISOString() };
            var facets = A.linkFacets(text);
            if (facets.length) record.facets = facets;
            if (images.length) record.embed = { $type: "app.bsky.embed.images", images: images };
            var body = { repo: s.who.did, collection: "app.bsky.feed.post", record: record };
            if (p.idempotencyKey) body.rkey = rkeyOf(p.idempotencyKey);
            return s.api.post("com.atproto.repo.createRecord", body).catch(function (e) {
                // Posted already (a retry of the same share): the same record.
                if (body.rkey && (e.status === 400 || e.status === 409) && /exist|conflict|duplicate/i.test(e.message || ""))
                    return { uri: "at://" + s.who.did + "/app.bsky.feed.post/" + body.rkey };
                throw e;
            });
        }).then(function (r) {
            return { id: r.uri, url: A.postUrl(r.uri, s.who.handle) };
        });
    });
}

// A record key (https://atproto.com/specs/record-key: 1-512 of [A-Za-z0-9._:~-]) from the share's key.
function rkeyOf(key) {
    var k = String(key).replace(/[^A-Za-z0-9._:~-]/g, "-").slice(0, 200);
    return k === "." || k === ".." || !k ? "phoenix-" + Date.now().toString(36) : k;
}

// ---- Sign-in -------------------------------------------------------------------------------

function profileOf(api, did) {
    return api.get("app.bsky.actor.getProfile", { actor: did }).catch(function () { return null; });
}

function passwordSignIn(ctx, p) {
    var handle = String(p.username || "").trim();
    var password = String(p.password || "").trim();
    if (!handle || !password) return Promise.reject(fail("Your handle and an app password are needed", "401_UNAUTHORIZED"));
    return settings(ctx).then(function (cfg) {
        return A.resolve(ctx, handle, cfg);
    }).then(function (who) {
        return A.createSession(ctx, who.pds, who.did, password).then(function (sess) {
            if (sess.did !== who.did) throw fail("The PDS signed in another account", "401_UNAUTHORIZED");
            var s = { accessJwt: sess.accessJwt, refreshJwt: sess.refreshJwt };
            var api = A.passwordClient(ctx, who, password, { get: function () { return s; }, set: function (n) { s = n; } });
            return profileOf(api, who.did).then(function (profile) {
                return result({ did: who.did, handle: sess.handle || who.handle, pds: who.pds }, profile, { appPassword: password }, "app-password");
            });
        });
    });
}

function oauthSignIn(ctx, p) {
    return oauthAvailable(ctx).then(function (o) {
        if (!o.available) throw fail(o.reason, "NOT_AVAILABLE");
        return settings(ctx).then(function (cfg) { return A.resolve(ctx, p.handle || p.username, cfg); }).then(function (who) {
            return O.signIn(ctx, {
                who: who, clientId: o.client.clientId, redirectUri: o.client.redirectUri,
                sheet: function (url, redirect) {
                    return Promise.resolve(ctx.luna.call(OAUTH_SVC + "sheet", { url: url, redirectUri: redirect })).then(function (r) {
                        if (r && r.returnValue === false) throw fail(r.errorText || "The sign-in was closed", r.errorCode || "CANCELED");
                        return r && r.redirect;
                    });
                }
            }).then(function (sess) {
                var s = sess;
                var api = O.oauthClient(ctx, { get: function () { return s; }, set: function (n) { s = n; } }, o.client.clientId);
                return profileOf(api, who.did).then(function (profile) {
                    return result(who, profile, { oauth: s }, "oauth");
                });
            });
        });
    });
}

module.exports = kit.defineConnector({
    service: SERVICE,
    templateIds: [TEMPLATE],
    kinds: { state: "org.webosphoenix.bluesky.state:1", item: "org.webosphoenix.bluesky.item:1" },
    userAgent: "webOS-Phoenix-Bluesky/0.1",
    // Bluesky's own services; a self-hosted PDS's host is added once known (its DID document).
    hosts: ["bsky.social", "*.bsky.network", "public.api.bsky.app", "api.bsky.app", "plc.directory", "api.bsky.chat", "*.bsky.app"],
    signUp: "https://bsky.app/",

    // {username: handle, password: app password} or {config: {oauth...}} (after signIn).
    validate: function (ctx, p) {
        var c = p.config || {};
        if (c.oauth && c.did) return Promise.resolve(result({ did: c.did, handle: c.handle, pds: c.pds }, null, { oauth: c.oauth }, "oauth"));
        return passwordSignIn(ctx, p);
    },

    capabilities: (function () {
        var caps = {};
        caps[PROVIDERS.contacts] = { capability: "CONTACTS", kind: CONTACT_KIND, fields: CONTACT_FIELDS, pull: pullFollows };
        caps[PROVIDERS.messaging] = {
            capability: "MESSAGING", kind: MESSAGE_KIND, sync: syncMessages, remove: removeMessages,
            watch: { query: { from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] },
                     method: "outbox" }
        };
        caps[PROVIDERS.notifications] = { capability: "SOCIAL", sync: syncNotifications };
        return caps;
    })(),

    schedule: { every: "15m" },

    // An OAuth session is revoked with the account; an app password is the user's to revoke on Bluesky.
    onDelete: function (ctx) {
        var cred = ctx.credentials || {};
        if (!cred.oauth) return Promise.resolve();
        return settings(ctx).then(function (cfg) { return O.revoke(ctx, ctx.state.oauth || cred.oauth, cfg.clientId); });
    },

    share: SHARE,

    methods: {
        // {templateId} -> what the sign-in page (accounts/ConnectorWizard.js) offers.
        providerInfo: function (ctx) {
            return oauthAvailable(ctx).then(function (o) {
                return {
                    name: "Bluesky",
                    help: "The people you follow on contact cards, your direct messages in Messaging, and your notifications. " +
                          "Sign in with your handle and an app password from Bluesky's settings (Privacy and security, App passwords); allow it your direct messages for Messaging.",
                    oauth: o.available ? { available: true, label: "Sign In with Bluesky" } : { available: false, reason: o.reason },
                    fields: [{ name: "username", caption: "HANDLE", hint: "anna.bsky.social", type: "email", both: true },
                             { name: "password", caption: "APP PASSWORD", hint: "xxxx-xxxx-xxxx-xxxx", type: "password" }],
                    fieldsCaption: "Use an App Password Instead",
                    link: { caption: "Make an App Password", url: "https://bsky.app/settings/app-passwords" },
                    privacy: "Your data goes between this device and your Bluesky server only; no Phoenix server is in between. Direct messages are not end-to-end encrypted."
                };
            });
        },
        // {handle, accountId?} -> the validator's answer, after Bluesky's page (AT Protocol OAuth).
        signIn: function (ctx, p) { return oauthSignIn(ctx, p); },
        // {accountId?, messageId?}: Messaging's pending replies (the db8 watch, the simulator's IM transport).
        outbox: function (ctx, p) {
            if (p.accountId) return sendOutbox(ctx, p);
            return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] })
                .then(function (pending) {
                    var users = {};
                    pending.forEach(function (m) { if (!p.messageId || m._id === p.messageId) users[m.username] = true; });
                    return Promise.resolve(ctx.luna.call("luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE })).then(function (r) {
                        var chain = Promise.resolve(), sent = 0;
                        ((r && r.results) || []).filter(function (a) { return users[a.username]; }).forEach(function (a) {
                            chain = chain.then(function () {
                                return Promise.resolve(ctx.luna.call("luna://" + SERVICE + "/outbox", { accountId: a._id, messageId: p.messageId }))
                                    .then(function (x) { sent += (x && x.sent) || 0; });
                            });
                        });
                        return chain.then(function () { return { sent: sent }; });
                    });
                });
        }
    }
});

module.exports.TEMPLATE = TEMPLATE;
module.exports.PROVIDERS = PROVIDERS;
