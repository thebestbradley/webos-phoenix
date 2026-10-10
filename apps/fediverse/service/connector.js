// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Fediverse account (template com.webosphoenix.fediverse; phase C2 of
// docs/SYNERGY-CONNECTORS.md, docs/SYNERGY-MODERN.md 3.1): one account type
// for any server with the Mastodon client API (Mastodon, GoToSocial,
// Akkoma / Pleroma, Pixelfed, Friendica), on the connector kit.
//
// Sign-in (signIn, from the account's page in Accounts, accounts/wizard.html):
// the handle (@anna@example.social) finds the server by WebFinger and NodeInfo
// (lib/mastodon.js); the app registers itself with that server once
// (POST /api/v1/apps, the registration kept by the OAuth service per server);
// the user signs in on the server's own page in the system's browser sheet
// (org.webosphoenix.service.oauth: authorization code with PKCE); the token
// stays in the key store, and the account's credentials keep only its key.
//
// What the account brings, one capability each (switches in Accounts):
//
//   CONTACTS  the accounts you follow as contacts (com.palm.contact.fediverse:1,
//             read only): name, @handle, avatar, profile link, and their
//             latest post in the note; the contacts linker's rules join one
//             to a person you have (same name), as Synergy linked a Facebook
//             friend to an address book entry
//   MESSAGING direct mentions (visibility "direct") in Messaging, one thread
//             per person (com.palm.immessage.fediverse:1, serviceName
//             "type_fediverse"), labelled "not private" there: the admins of
//             both servers can read them. A reply from Messaging is posted as
//             a direct mention back (outbox)
//   SOCIAL    mentions, follows, boosts and favourites as notifications;
//             a tap opens the post or profile in the browser
//
// Notifications are polled on the kit's schedule (every 15 minutes, when
// online); Web Push to UnifiedPush is phase C6 (SYNERGY-MODERN.md 4.8).
// Sharing to the account (the share sheet: a link, text, a photo with alt
// text, the visibility) is the app's page, index.html, calling post.

"use strict";

var kit = require("@phoenix/connector-kit");
var M = require("./lib/mastodon");
var T = require("./lib/text");

var SERVICE = "org.webosphoenix.service.fediverse";
var TEMPLATE = "com.webosphoenix.fediverse";
var APP = "org.webosphoenix.fediverse";
var MESSAGING_APP = "org.webosphoenix.messaging";
var IM_SERVICE = "type_fediverse";
var CONTACT_KIND = "com.palm.contact.fediverse:1";
var MESSAGE_KIND = "com.palm.immessage.fediverse:1";
var THREAD_KIND = "com.palm.chatthread:1";
var OAUTH = "luna://org.webosphoenix.service.oauth/";
var PROVIDERS = { contacts: TEMPLATE + ".contacts", messaging: TEMPLATE + ".messaging", notifications: TEMPLATE + ".notifications" };
var CONTACT_FIELDS = ["name", "nickname", "urls", "photos", "note"];
// Latest posts read per sync: the rest wait for the next one (Mastodon allows
// 300 calls in 5 minutes per account: https://docs.joinmastodon.org/api/rate-limits/).
var LATEST_PER_SYNC = 30;
var NOTIFY_TYPES = ["mention", "follow", "reblog", "favourite"];
var MAX_TOASTS = 5;

function fail(message, errorCode) { var e = new Error(message); e.errorCode = errorCode; return e; }

// The account's server and an API client with its token.
function session(ctx) {
    var server = ctx.config.server || (ctx.credentials && ctx.credentials.server);
    var key = ctx.credentials && ctx.credentials.oauthKey;
    if (!server) return Promise.reject(fail("The account has no server", "400_BAD_REQUEST"));
    return ctx.oauth.token(key).then(function (token) {
        return { server: server, domain: String(ctx.config.acct || "").split("@")[1] || new URL(server).host, api: M.api(ctx.http, server, token) };
    });
}

function lunaOk(ctx, uri, params) {
    return ctx.luna.call(uri, params).catch(function (e) { throw fail(e.message, e.errorCode || "UNKNOWN_ERROR"); });
}

// ---- Contacts: the accounts you follow ----------------------------------------------------

// Every page of GET /api/v1/accounts/:id/following
// (https://docs.joinmastodon.org/methods/accounts/#following: limit 80, Link paging).
function following(s, accountId) {
    var all = [];
    function next(url, n) {
        return (url ? s.api.page(url) : s.api.page("/api/v1/accounts/" + encodeURIComponent(accountId) + "/following", { limit: 80 }))
            .then(function (r) {
                all = all.concat(r.items);
                return r.next && n < 50 ? next(r.next, n + 1) : all;
            });
    }
    return next(null, 0);
}

// Their latest posts, from the state's copy unless they posted since
// (last_status_at); GET /api/v1/accounts/:id/statuses
// (https://docs.joinmastodon.org/methods/accounts/#statuses).
function latestPosts(ctx, s, accounts) {
    var known = ctx.state.latest || {};
    var fresh = {};
    var stale = accounts.filter(function (a) {
        var k = known[a.id];
        if (k && k.at === (a.last_status_at || "")) { fresh[a.id] = k; return false; }
        return !!a.last_status_at;
    }).sort(function (a, b) { return a.last_status_at < b.last_status_at ? 1 : -1; });
    var chain = Promise.resolve();
    stale.slice(0, LATEST_PER_SYNC).forEach(function (a) {
        chain = chain.then(function () {
            return s.api.get("/api/v1/accounts/" + encodeURIComponent(a.id) + "/statuses",
                             { limit: 1, exclude_replies: true, exclude_reblogs: true }).then(function (list) {
                var st = list && list[0];
                fresh[a.id] = { at: a.last_status_at || "", text: st ? T.shorten(T.plainText(st.content) || (st.spoiler_text || ""), 280) : "",
                                date: st ? st.created_at : "" };
            });
        });
    });
    // Those left for the next sync keep what was known of them.
    stale.slice(LATEST_PER_SYNC).forEach(function (a) { if (known[a.id]) fresh[a.id] = Object.assign({}, known[a.id], { at: "" }); });
    return chain.then(function () {
        if (JSON.stringify(fresh) !== JSON.stringify(known)) ctx.state.latest = fresh;
        return fresh;
    });
}

function shortDate(iso) {
    var t = Date.parse(iso || "");
    if (isNaN(t)) return "";
    var d = new Date(t);
    return d.getUTCDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()] + " " + d.getUTCFullYear();
}

function contactFields(ctx, s, a, latest) {
    var acct = T.fullAcct(a, s.domain);
    var urls = [{ value: a.url, type: "type_profile" }];
    // Links the server verified (rel="me"), as the person's own pages.
    (a.fields || []).forEach(function (f) {
        var m = /href="([^"]+)"/.exec(f.value || "");
        if (f.verified_at && m && /^https?:/.test(m[1])) urls.push({ value: T.decode(m[1]), type: "type_homepage" });
    });
    var note = latest && latest.text ? "Latest post" + (latest.date ? ", " + shortDate(latest.date) : "") + ": " + latest.text : "";
    var avatar = a.avatar_static || a.avatar || "";
    return Promise.resolve(avatar ? ctx.cachePhoto("avatar:" + acct, avatar) : "").then(function (photo) {
        return {
            name: T.nameOf(a), nickname: "@" + acct, urls: urls, note: note,
            photos: photo ? [{ value: photo, localPath: photo, type: "type_big", primary: true }] : []
        };
    });
}

function pullFollowing(ctx) {
    return session(ctx).then(function (s) {
        return following(s, ctx.config.accountId).then(function (accounts) {
            return latestPosts(ctx, s, accounts).then(function (latest) {
                var chain = Promise.resolve(), changes = [];
                accounts.forEach(function (a) {
                    chain = chain.then(function () {
                        return contactFields(ctx, s, a, latest[a.id]).then(function (fields) {
                            changes.push({
                                remoteId: a.url || T.fullAcct(a, s.domain),
                                etag: JSON.stringify([a.display_name, a.avatar_static || a.avatar, a.url, (latest[a.id] || {}).at || "",
                                                      (latest[a.id] || {}).text || "", (a.fields || []).length]),
                                fields: fields
                            });
                        });
                    });
                });
                return chain.then(function () { return { full: true, changes: changes, nextToken: null }; });
            });
        });
    });
}

// ---- Notifications, and direct mentions for Messaging ----------------------------------

// GET /api/v1/notifications (https://docs.joinmastodon.org/methods/notifications/#get),
// newest first, since since_id; one fetch per sync for both capabilities.
function notificationsSince(ctx, s, sinceId) {
    ctx.__notifications = ctx.__notifications || {};
    var key = sinceId || "";
    if (ctx.__notifications[key]) return ctx.__notifications[key];
    var all = [];
    function next(url, n) {
        return (url ? s.api.page(url) : s.api.page("/api/v1/notifications", { limit: 40, since_id: sinceId || undefined, "types[]": NOTIFY_TYPES }))
            .then(function (r) {
                all = all.concat(r.items);
                // A first sync reads one page; later ones page back to since_id.
                return sinceId && r.next && r.items.length >= 40 && n < 5 ? next(r.next, n + 1) : all;
            });
    }
    ctx.__notifications[key] = next(null, 0);
    return ctx.__notifications[key];
}

function newestId(list, before) {
    return list.reduce(function (m, n) { return compareIds(n.id, m) > 0 ? n.id : m; }, before || "");
}
// Mastodon's ids are numbers as strings (Snowflake-like); others' may be strings that sort.
function compareIds(a, b) {
    a = String(a || ""); b = String(b || "");
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) return a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0;
    return a < b ? -1 : a > b ? 1 : 0;
}

function isDirect(n) { return n.type === "mention" && n.status && n.status.visibility === "direct"; }

// The text of a direct mention without the leading @mention of you.
function dmText(status, ownUsername) {
    var text = T.plainText(status.content);
    var re = new RegExp("^(@" + ownUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(@[^\\s]+)?\\s+)+", "i");
    return text.replace(re, "").trim() || text;
}

function syncMessages(ctx) {
    return session(ctx).then(function (s) {
        var st = ctx.state.messaging = ctx.state.messaging || {};
        var first = !st.started;
        return notificationsSince(ctx, s, st.since).then(function (list) {
            var dms = list.filter(isDirect).filter(function (n) { return !st.since || compareIds(n.id, st.since) > 0; })
                .sort(function (a, b) { return compareIds(a.id, b.id); });
            var own = ctx.config.acct || ctx.account.username;
            var chain = Promise.resolve(), stored = 0;
            dms.forEach(function (n) {
                chain = chain.then(function () {
                    var t = Date.parse(n.status.created_at) || ctx.now();
                    var name = T.displayName(n.account);
                    var text = dmText(n.status, String(own).split("@")[0]);
                    return ctx.putMessage({
                        _kind: MESSAGE_KIND, accountId: ctx.accountId, folder: "inbox", status: "successful", serviceName: IM_SERVICE,
                        username: own, from: { addr: T.fullAcct(n.account, s.domain), name: name }, messageText: text,
                        localTimestamp: t, timestamp: t, flags: { read: first, visible: true },
                        fediverse: { statusId: n.status.id, url: n.status.url || n.status.uri || "" }
                    }).then(function (r) {
                        stored++;
                        if (first) return null;
                        return ctx.notify({ title: name, body: text, appId: MESSAGING_APP,
                                            params: { threadId: (r && r.threadids && r.threadids[0]) || "" } });
                    });
                });
            });
            return chain.then(function () {
                var newest = newestId(list, st.since);
                if (newest && newest !== st.since) st.since = newest;
                if (first) st.started = true;
                return { directMentions: stored, first: first };
            });
        });
    });
}

function notificationText(n) {
    var who = T.displayName(n.account);
    var post = n.status ? T.shorten(T.plainText(n.status.content), 140) : "";
    switch (n.type) {
    case "mention": return { title: who + " mentioned you", body: post, open: n.status && n.status.url };
    case "follow": return { title: who + " followed you", body: "@" + n.account.acct, open: n.account.url };
    case "reblog": return { title: who + " boosted your post", body: post, open: n.status && n.status.url };
    case "favourite": return { title: who + " favourited your post", body: post, open: n.status && n.status.url };
    }
    return null;
}

function syncNotifications(ctx) {
    return session(ctx).then(function (s) {
        var st = ctx.state.notifications = ctx.state.notifications || {};
        var first = !st.started;
        return notificationsSince(ctx, s, st.since).then(function (list) {
            var newer = list.filter(function (n) { return !isDirect(n) && (!st.since || compareIds(n.id, st.since) > 0); })
                .sort(function (a, b) { return compareIds(a.id, b.id); });
            // The first sync only notes where it is: old news is not news.
            var shown = first ? [] : newer.map(notificationText).filter(Boolean);
            var chain = Promise.resolve();
            shown.slice(-MAX_TOASTS).forEach(function (t) {
                chain = chain.then(function () {
                    return ctx.notify({ title: t.title, body: t.body, appId: APP, params: t.open ? { open: t.open } : {} });
                });
            });
            if (shown.length > MAX_TOASTS) {
                chain = chain.then(function () {
                    return ctx.notify({ title: (shown.length - MAX_TOASTS) + " more on the Fediverse", appId: APP, params: { open: s.server + "/notifications" } });
                });
            }
            return chain.then(function () {
                var newest = newestId(list, st.since);
                if (newest && newest !== st.since) st.since = newest;
                if (first) st.started = true;
                return { notified: shown.length, first: first };
            });
        });
    });
}

// The account's messages and their conversations, when Messaging is turned off or the account goes.
function removeMessages(ctx) {
    var own = ctx.config.acct || (ctx.account && ctx.account.username) || "";
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

// ---- Posting: sharing, and replies from Messaging --------------------------------------

// POST /api/v2/media (https://docs.joinmastodon.org/methods/media/#v2): 200 with
// the attachment, or 202 while the server still processes it, then GET
// /api/v1/media/:id until it has its url.
function uploadMedia(ctx, s, file) {
    return ctx.readFile(file.path).then(function (f) {
        return s.api.upload("/api/v2/media", { description: file.description || "" },
                            { name: String(file.path).replace(/^.*\//, ""), mimeType: file.mimeType || f.mimeType, bytes: f.bytes });
    }).then(function (r) {
        var media = r.body;
        if (r.status !== 202 || (media && media.url)) return media;
        var tries = 0;
        function poll() {
            return new Promise(function (res) { setTimeout(res, 1000); }).then(function () {
                return s.api.get("/api/v1/media/" + encodeURIComponent(media.id));
            }).then(function (m) {
                if (m && m.url) return m;
                if (++tries >= 15) throw fail("The server is still processing the picture", "500_SERVER_ERROR");
                return poll();
            });
        }
        return poll();
    });
}

var VISIBILITIES = ["public", "unlisted", "private", "direct"];

// POST /api/v1/statuses (https://docs.joinmastodon.org/methods/statuses/#create),
// with an Idempotency-Key, so a retry does not post twice.
function post(ctx, p) {
    var text = String(p.text || "").trim();
    var media = (p.media || []).filter(function (m) { return m && m.path; }).slice(0, 4);
    var visibility = VISIBILITIES.indexOf(p.visibility) >= 0 ? p.visibility : "public";
    if (!text && !media.length) return Promise.reject(fail("Nothing to post", "400_BAD_REQUEST"));
    if (text.length > 5000) return Promise.reject(fail("The post is too long", "400_BAD_REQUEST"));
    return session(ctx).then(function (s) {
        var chain = Promise.resolve([]);
        media.forEach(function (m) {
            chain = chain.then(function (ids) { return uploadMedia(ctx, s, m).then(function (a) { return ids.concat(a.id); }); });
        });
        return chain.then(function (ids) {
            var body = { status: text, visibility: visibility };
            if (ids.length) body.media_ids = ids;
            if (p.spoilerText) body.spoiler_text = String(p.spoilerText);
            if (p.inReplyToId) body.in_reply_to_id = String(p.inReplyToId);
            if (p.sensitive) body.sensitive = true;
            return s.api.post("/api/v1/statuses", body, p.idempotencyKey ? { "Idempotency-Key": String(p.idempotencyKey) } : {});
        }).then(function (status) {
            return { id: status.id, url: status.url || status.uri || "", visibility: status.visibility };
        });
    });
}

// Pending replies of this account in Messaging's outbox: each a direct
// mention of the other person, in reply to their last one.
function sendOutbox(ctx, p) {
    var own = ctx.config.acct || ctx.account.username;
    return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] })
        .then(function (pending) {
            pending = pending.filter(function (m) { return m.username === own && (!p.messageId || m._id === p.messageId); });
            var chain = Promise.resolve(), sent = 0;
            pending.forEach(function (m) {
                chain = chain.then(function () {
                    var to = m.to && m.to[0] && m.to[0].addr;
                    return ctx.db.merge([{ _id: m._id, status: "sending", accountId: ctx.accountId }]).then(function () {
                        return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "inbox" }, { prop: "from.addr", op: "=", val: to }] });
                    }).then(function (theirs) {
                        var last = theirs.filter(function (x) { return x.fediverse && x.fediverse.statusId; })
                            .sort(function (a, b) { return (b.localTimestamp || 0) - (a.localTimestamp || 0); })[0];
                        return post(ctx, { text: "@" + to + " " + (m.messageText || ""), visibility: "direct",
                                           inReplyToId: last ? last.fediverse.statusId : undefined, idempotencyKey: "phoenix-" + m._id });
                    }).then(function (r) {
                        sent++;
                        return ctx.db.merge([{ _id: m._id, status: "successful", accountId: ctx.accountId, fediverse: { statusId: r.id, url: r.url } }]);
                    }, function (e) {
                        ctx.log("reply not sent: " + e.message);
                        return ctx.db.merge([{ _id: m._id, status: "failed" }]);
                    });
                });
            });
            return chain.then(function () { return { sent: sent }; });
        });
}

// ---- Sign-in -------------------------------------------------------------------------------

function verify(ctx, server, keyId) {
    return ctx.oauth.token(keyId).then(function (token) {
        ctx.http.allowHost(new URL(server).host);
        // https://docs.joinmastodon.org/methods/accounts/#verify_credentials
        return M.api(ctx.http, server, token).get("/api/v1/accounts/verify_credentials");
    });
}

function result(server, keyId, me, software) {
    var acct = me.acct.indexOf("@") >= 0 ? me.acct : me.acct + "@" + (me.url ? new URL(me.url).host : new URL(server).host);
    return {
        username: acct,
        credentials: { common: { oauthKey: keyId, server: server } },
        config: { server: server, acct: acct, accountId: String(me.id), displayName: T.displayName(me), software: software || "" }
    };
}

function signIn(ctx, p) {
    var found;
    return M.discover(ctx.http, p.handle).then(function (f) {
        found = f;
        return lunaOk(ctx, OAUTH + "redirectUri", {});
    }).then(function (r) {
        var redirectUri = r.redirectUri;
        var name = found.server + " " + redirectUri;
        // The app's registration with this server, once (SYNERGY-MODERN.md 4.4).
        return lunaOk(ctx, OAUTH + "client", { name: name }).then(function (c) {
            if (c.value && c.value.clientId) return c.value;
            return M.registerApp(ctx.http, found.server, redirectUri, M.SCOPES).then(function (client) {
                return lunaOk(ctx, OAUTH + "client", { name: name, value: client }).then(function () { return client; });
            });
        }).then(function (client) {
            return M.endpoints(ctx.http, found.server).then(function (ep) {
                return lunaOk(ctx, OAUTH + "authorize", {
                    authorizationEndpoint: ep.authorize, tokenEndpoint: ep.token, revocationEndpoint: ep.revoke,
                    clientId: client.clientId, clientSecret: client.clientSecret, scope: M.SCOPES, redirectUri: redirectUri
                });
            });
        });
    }).then(function (auth) {
        return verify(ctx, found.server, auth.keyId).then(function (me) {
            // A new sign-in of an account (its token refused): the old key goes.
            var old = p.accountId ? lunaOk(ctx, "luna://com.palm.service.accounts/readCredentials", { accountId: p.accountId, name: "common" })
                .then(function (r) { var k = r.credentials && r.credentials.oauthKey; return k && k !== auth.keyId ? ctx.oauth.forget(k) : null; })
                .catch(function () {}) : Promise.resolve();
            return old.then(function () { return result(found.server, auth.keyId, me, found.software.name); });
        });
    });
}

module.exports = kit.defineConnector({
    service: SERVICE,
    templateIds: [TEMPLATE],
    kinds: { state: "org.webosphoenix.fediverse.state:1", item: "org.webosphoenix.fediverse.item:1" },
    userAgent: "webOS-Phoenix-Fediverse/0.1",

    // The template's validator: an account key the sign-in got ({config: {server, oauthKey}}).
    validate: function (ctx, p) {
        var c = p.config || {};
        if (!c.server || !c.oauthKey) return Promise.reject(fail("Sign in with your handle first", "401_UNAUTHORIZED"));
        return verify(ctx, c.server, c.oauthKey).then(function (me) { return result(c.server, c.oauthKey, me, c.software); });
    },

    capabilities: (function () {
        var caps = {};
        caps[PROVIDERS.contacts] = {
            capability: "CONTACTS", kind: CONTACT_KIND, fields: CONTACT_FIELDS,
            pull: pullFollowing
        };
        caps[PROVIDERS.messaging] = {
            capability: "MESSAGING", kind: MESSAGE_KIND,
            sync: syncMessages, remove: removeMessages,
            watch: { query: { from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] },
                     method: "outbox" }
        };
        caps[PROVIDERS.notifications] = { capability: "SOCIAL", sync: syncNotifications };
        return caps;
    })(),

    schedule: { every: "15m" },
    push: { unifiedPush: false },

    // The token is revoked and forgotten with the account.
    onDelete: function (ctx) {
        return ctx.oauth.forget(ctx.credentials && ctx.credentials.oauthKey);
    },

    methods: {
        // {handle, accountId?} -> what the validator gives, after the sign-in.
        signIn: function (ctx, p) { return signIn(ctx, p); },
        // {accountId, text, visibility?, media?: [{path, mimeType?, description}], spoilerText?, idempotencyKey?} -> {id, url}
        post: function (ctx, p) {
            if (!p.accountId) return Promise.reject(fail("accountId is required", "400_BAD_REQUEST"));
            return post(ctx, p);
        },
        // {accountId?, messageId?}: Messaging's pending replies (the db8 watch, the simulator's IM transport).
        outbox: function (ctx, p) {
            if (p.accountId) return sendOutbox(ctx, p);
            // Which account a message is from: its username.
            return ctx.db.find({ from: MESSAGE_KIND, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] })
                .then(function (pending) {
                    var users = {};
                    pending.forEach(function (m) { if (!p.messageId || m._id === p.messageId) users[m.username] = true; });
                    return lunaOk(ctx, "luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE }).then(function (r) {
                        var chain = Promise.resolve(), sent = 0;
                        (r.results || []).filter(function (a) { return users[a.username]; }).forEach(function (a) {
                            chain = chain.then(function () {
                                return lunaOk(ctx, "luna://" + SERVICE + "/outbox", { accountId: a._id, messageId: p.messageId })
                                    .then(function (x) { sent += x.sent || 0; });
                            });
                        });
                        return chain.then(function () { return { sent: sent }; });
                    });
                });
        }
    }
});
