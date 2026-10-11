// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Slack account (template com.webosphoenix.slack;
// docs/SYNERGY-CONNECTORS.md 7, "Slack"), on the connector kit, through
// Slack's Web API (https://api.slack.com/web) with the user's own token:
//
//   MESSAGING  direct messages, group messages and the channels you are in
//              as Messaging conversations (com.palm.immessage.slack:1,
//              serviceName "type_slack"): one per person, group or channel
//              ("#general"), a channel's messages with who wrote them; a
//              reply from Messaging is posted there (chat.postMessage);
//              direct messages and mentions of you as notifications
//                conversations.list (types im, mpim, public_channel,
//                private_channel; the ones you are in), conversations.history
//                (oldest: what came since)
//   CONTACTS   read only: your workspace's people (users.list), linked to
//              the people you have by name
//
// Slack's limits: since 2025, apps not in the Slack Marketplace may read a
// conversation's history once a minute, 15 messages at a time
// (https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq).
// Until Phoenix's Slack app is listed (Slack's review; OPEN-QUESTIONS Q17)
// each sync reads the history of one conversation, the next one at the
// next sync, newest first ("marketplace": true in the setting lifts it).
//
// Sign-in: Slack's page (OAuth v2 with user scopes). Slack's token exchange
// (oauth.v2.access) wants the app's client secret and answers with the
// user's token inside authed_user, so it goes through Phoenix's token relay
// (OPEN-QUESTIONS Q49, PLATFORM.md 6.5.4), named in the image's setting
// /etc/palm/slack/clients.json ({"slack": {"clientId": "...", "relay":
// "https://.../oauth-broker/slack"}}) and supported by the OAuth service
// (its broker option): neither is in this build, so "not available in
// this build".

"use strict";

var kit = require("@phoenix/connector-kit");

var SERVICE = "org.webosphoenix.service.slack";
var TEMPLATE = "com.webosphoenix.slack";
var CLIENTS = "slack/clients.json";
var API = "https://slack.com/api";
var MESSAGING_APP = "org.webosphoenix.messaging";
var IM_SERVICE = "type_slack";
var K = { contact: "com.palm.contact.slack:1", message: "com.palm.immessage.slack:1", item: "org.webosphoenix.slack.item:1" };
var P = { messaging: TEMPLATE + ".messaging", contacts: TEMPLATE + ".contacts" };
var THREAD_KIND = "com.palm.chatthread:1";
var USER_SCOPE = "channels:history,groups:history,im:history,mpim:history,channels:read,groups:read,im:read,mpim:read,users:read,users:read.email,chat:write";
var OAUTH = { authorizationEndpoint: "https://slack.com/oauth/v2/authorize", tokenEndpoint: "https://slack.com/api/oauth.v2.access",
              revocationEndpoint: "https://slack.com/api/auth.revoke", scope: "", params: { user_scope: USER_SCOPE } };

function fail(message, errorCode) { var e = new Error(message); e.errorCode = errorCode; return e; }

function settingOf(ctx) {
    return ctx.systemConfig(CLIENTS).then(function (all) {
        var c = (all && all.slack) || {};
        if (c.api) { try { ctx.http.allowHost(new URL(c.api).host); } catch (e) { /* not an address */ } }
        return c;
    });
}

// Sign In with Slack: Phoenix's app, the relay, and the OAuth service's broker.
function signInAvailable(ctx) {
    return settingOf(ctx).then(function () {
        return kit.registeredClient(ctx, CLIENTS, "slack", OAUTH);
    }).then(function (c) {
        return kit.viaRelay(ctx, c);
    }).then(function (c) {
        return c ? { available: true, client: c } : { available: false, reason: notAvailable().message };
    });
}
function notAvailable() {
    return fail("Slack is not available in this build: its sign-in goes through Phoenix's token relay, which this build does not have (docs/DEVELOPER-APPS.md)", "NOT_AVAILABLE");
}

/** The Web API: POST form calls, {ok, error}; HTTP 429 with Retry-After is the kit's backoff. */
function slack(ctx, token, base) {
    var rest = kit.restApi(ctx, { base: base || API, token: token });
    return function (method, args) {
        var form = {};
        Object.keys(args || {}).forEach(function (k) { if (args[k] !== undefined && args[k] !== null) form[k] = typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]; });
        return rest.send("POST", "/" + method, { form: form }).then(function (r) {
            if (r && r.ok) return r;
            var err = String((r && r.error) || "unknown_error");
            if (/^(invalid_auth|not_authed|token_revoked|token_expired|account_inactive)$/.test(err)) throw Object.assign(fail("Slack refused the sign-in (" + err + ")", "401_UNAUTHORIZED"), { status: 401 });
            if (err === "ratelimited") throw Object.assign(fail("Slack asked to slow down", "503_SERVICE_UNAVAILABLE"), { status: 429 });
            if (err === "missing_scope") throw fail("Slack did not give Phoenix this permission (" + ((r && r.needed) || "") + "): sign in again", "401_UNAUTHORIZED");
            throw fail("Slack: " + err + " (" + method + ")", "UNKNOWN_ERROR");
        });
    };
}

function session(ctx) {
    var key = (ctx.credentials && ctx.credentials.oauthKey) || (ctx.config && ctx.config.oauthKey);
    return settingOf(ctx).then(function (c) {
        return { call: slack(ctx, function () { return ctx.oauth.token(key); }, c.api), setting: c };
    });
}

function paged(call, method, args, key, max) {
    var out = [];
    function page(cursor, n) {
        return call(method, Object.assign({}, args, cursor ? { cursor: cursor } : {})).then(function (r) {
            out = out.concat(r[key] || []);
            var next = r.response_metadata && r.response_metadata.next_cursor;
            return next && n < (max || 20) ? page(next, n + 1) : out;
        });
    }
    return page(null, 0);
}

// Who wrote: the person's name; a mention: their handle, as Slack shows it.
function nameOfUser(u) {
    var p = u.profile || {};
    return p.real_name || u.real_name || p.display_name || u.name || u.id;
}
function handleOf(u) {
    var p = u.profile || {};
    return p.display_name || u.name || p.real_name || u.id;
}

// "<@U123>" mentions in a message's text as the people's names; Slack's &lt; &gt; &amp;.
function plain(text, users) {
    return String(text || "").replace(/<@([A-Z0-9]+)(\|[^>]+)?>/g, function (m, id) { return "@" + (users[id] ? handleOf(users[id]) : id); })
        .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1").replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)").replace(/<(https?:[^>]+)>/g, "$1")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// ---- Contacts: the workspace's people ------------------------------------------------------------

function pullPeople(ctx) {
    return session(ctx).then(function (s) {
        return paged(s.call, "users.list", { limit: 200 }, "members");
    }).then(function (members) {
        var team = (ctx.config && ctx.config.teamName) || "Slack";
        return { full: true, nextToken: null, changes: members.filter(function (u) { return !u.deleted && !u.is_bot && u.id !== "USLACKBOT"; }).map(function (u) {
            var p = u.profile || {};
            var name = p.real_name || u.real_name || nameOfUser(u);
            var words = String(name).split(" ").filter(Boolean);
            return {
                remoteId: u.id,
                etag: JSON.stringify([name, p.display_name || "", p.email || "", p.title || "", p.phone || ""]),
                fields: {
                    name: words.length < 2 ? { givenName: name, familyName: "" } : { givenName: words.slice(0, -1).join(" "), familyName: words[words.length - 1] },
                    nickname: p.display_name ? "@" + p.display_name : "",
                    emails: p.email ? [{ value: p.email, type: "type_work" }] : [],
                    phoneNumbers: p.phone ? [{ value: p.phone, type: "type_work" }] : [],
                    organizations: [{ name: team, title: p.title || "", type: "type_work" }]
                }
            };
        }) };
    });
}

// ---- Messaging -----------------------------------------------------------------------------------------

function syncMessages(ctx) {
    return session(ctx).then(function (s) {
        var st = ctx.state.messaging = ctx.state.messaging || {};
        var first = !st.started;
        var budget = s.setting.marketplace ? 50 : 1;
        var me = ctx.config && ctx.config.userId;
        var team = (ctx.config && ctx.config.teamId) || "slack";
        return paged(s.call, "users.list", { limit: 200 }, "members").then(function (members) {
            var users = {};
            members.forEach(function (u) { users[u.id] = u; });
            return paged(s.call, "conversations.list", { types: "im,mpim,public_channel,private_channel", exclude_archived: true, limit: 200 }, "channels")
                .then(function (convs) {
                    convs = convs.filter(function (c) { return c.is_im || c.is_member; });
                    // Round-robin: the conversations not read for longest first.
                    var read = st.readAt || {};
                    convs.sort(function (a, b) { return (read[a.id] || 0) - (read[b.id] || 0); });
                    var chain = Promise.resolve(), stored = 0;
                    convs.slice(0, budget).forEach(function (c) {
                        chain = chain.then(function () {
                            var since = (st.latest || {})[c.id];
                            return s.call("conversations.history", { channel: c.id, oldest: since || undefined, limit: 15 }).then(function (h) {
                                read[c.id] = ctx.now();
                                var msgs = (h.messages || []).filter(function (m) { return (!m.subtype || m.subtype === "thread_broadcast") && m.ts && (!since || m.ts > since); })
                                    .sort(function (a, b) { return a.ts < b.ts ? -1 : 1; });
                                var inner = Promise.resolve();
                                msgs.forEach(function (m) {
                                    if (m.user === me) return;
                                    inner = inner.then(function () {
                                        var who = users[m.user] ? nameOfUser(users[m.user]) : (m.username || m.user || "Slack");
                                        var dm = !!c.is_im;
                                        var addr = dm ? (users[c.user] ? users[c.user].name : c.user) + "@" + team : "#" + (c.name || c.id) + "@" + team;
                                        var text = plain(m.text, users);
                                        var t = Math.round(Number(m.ts) * 1000) || ctx.now();
                                        return ctx.putMessage({
                                            _kind: K.message, accountId: ctx.accountId, folder: "inbox", status: "successful", serviceName: IM_SERVICE,
                                            username: ctx.account.username, from: { addr: addr, name: dm ? who : "#" + (c.name || c.id) },
                                            messageText: dm ? text : who + ": " + text, localTimestamp: t, timestamp: t, flags: { read: first, visible: true },
                                            slack: { channel: c.id, ts: m.ts, user: m.user }
                                        }).then(function (r) {
                                            stored++;
                                            var mention = me && String(m.text || "").indexOf("<@" + me + ">") >= 0;
                                            if (first || !(dm || mention)) return null;
                                            return ctx.notify({ title: dm ? who : who + " in #" + (c.name || ""), body: text, appId: MESSAGING_APP,
                                                                params: { threadId: (r && r.threadids && r.threadids[0]) || "" },
                                                                group: (r && r.threadids && r.threadids[0]) || "" });
                                        });
                                    });
                                });
                                return inner.then(function () {
                                    var newest = msgs.reduce(function (a, m) { return m.ts > a ? m.ts : a; }, since || "");
                                    if (newest) st.latest = Object.assign({}, st.latest || {}, (function () { var o = {}; o[c.id] = newest; return o; })());
                                });
                            });
                        });
                    });
                    return chain.then(function () {
                        st.readAt = read;
                        st.started = true;
                        return { messages: stored, conversations: convs.length, read: Math.min(budget, convs.length) };
                    });
                });
        });
    });
}

function removeMessages(ctx) {
    return ctx.db.find({ from: K.message, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] }).then(function (msgs) {
        var threads = {};
        msgs.forEach(function (m) { (m.conversations || []).forEach(function (t) { threads[t] = true; }); });
        return (msgs.length ? ctx.db.del(msgs.map(function (m) { return m._id; })) : Promise.resolve()).then(function () {
            return ctx.db.find({ from: THREAD_KIND, where: [{ prop: "replyService", op: "=", val: IM_SERVICE }] });
        }).then(function (all) {
            var ids = all.filter(function (t) { return threads[t._id]; }).map(function (t) { return t._id; });
            return ids.length ? ctx.db.del(ids) : null;
        });
    });
}

// Messaging's pending replies of this account: to the conversation the thread's messages came from.
function sendOutbox(ctx, p) {
    var own = ctx.account.username;
    return ctx.db.find({ from: K.message, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] }).then(function (pending) {
        pending = pending.filter(function (m) { return m.username === own && (!p.messageId || m._id === p.messageId); });
        if (!pending.length) return { sent: 0 };
        return session(ctx).then(function (s) {
            var chain = Promise.resolve(), sent = 0;
            pending.forEach(function (m) {
                chain = chain.then(function () {
                    var to = m.to && m.to[0] && m.to[0].addr;
                    return ctx.db.find({ from: K.message, where: [{ prop: "folder", op: "=", val: "inbox" }, { prop: "from.addr", op: "=", val: to }] }).then(function (theirs) {
                        var known = theirs.filter(function (x) { return x.slack && x.slack.channel; })[0];
                        if (!known) throw fail("No Slack conversation with " + to, "400_BAD_REQUEST");
                        return s.call("chat.postMessage", { channel: known.slack.channel, text: String(m.messageText || "") });
                    }).then(function (r) {
                        sent++;
                        return ctx.db.merge([{ _id: m._id, status: "successful", accountId: ctx.accountId, slack: { channel: r.channel, ts: r.ts } }]);
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

// ---- The definition ----------------------------------------------------------------------------------------

function whoAmI(call) {
    return call("auth.test", {}).then(function (r) {
        return { userId: r.user_id, user: r.user, teamId: r.team_id, teamName: r.team, url: r.url };
    });
}

module.exports = kit.defineConnector({
    service: SERVICE,
    templateIds: [TEMPLATE],
    kinds: { state: "org.webosphoenix.slack.state:1", item: K.item },
    userAgent: "webOS-Phoenix-Slack/0.1",
    hosts: ["slack.com", "*.slack.com"],
    signUp: "https://slack.com/get-started",

    // {config: {oauthKey}} after the sign-in (through the relay).
    validate: function (ctx, p) {
        var c = p.config || {};
        if (!c.oauthKey) return Promise.reject(fail("Sign in with Slack first", "401_UNAUTHORIZED"));
        return settingOf(ctx).then(function (s) {
            return whoAmI(slack(ctx, function () { return ctx.oauth.token(c.oauthKey); }, s.api));
        }).then(function (me) {
            return { username: me.user + "@" + me.teamName, credentials: { common: { oauthKey: c.oauthKey } },
                     config: { oauthKey: c.oauthKey, userId: me.userId, teamId: me.teamId, teamName: me.teamName, url: me.url } };
        });
    },

    capabilities: (function () {
        var caps = {};
        caps[P.messaging] = {
            capability: "MESSAGING", kind: K.message, sync: syncMessages, remove: removeMessages,
            watch: { query: { from: K.message, where: [{ prop: "folder", op: "=", val: "outbox" }, { prop: "status", op: "=", val: "pending" }] }, method: "outbox" }
        };
        caps[P.contacts] = { capability: "CONTACTS", kind: K.contact, fields: ["name", "nickname", "emails", "phoneNumbers", "organizations"], pull: pullPeople };
        return caps;
    })(),
    schedule: { every: "15m" },

    onDelete: function (ctx) {
        var key = ctx.credentials && ctx.credentials.oauthKey;
        return key ? ctx.oauth.forget(key) : Promise.resolve();
    },

    methods: {
        providerInfo: function (ctx) {
            return signInAvailable(ctx).then(function (o) {
                return {
                    name: "Slack",
                    help: "Your Slack direct messages and channels in Messaging, and your workspace's people in Contacts. Until Phoenix's Slack app is in the Slack Marketplace, Slack lets it read one conversation a minute: new messages come in slowly.",
                    oauth: o.available ? { available: true, label: "Sign In with Slack" } : { available: false, reason: o.reason },
                    privacy: "Your messages go between this device and Slack. Slack's sign-in goes through Phoenix's token relay, which sees the sign-in's tokens as they pass and keeps nothing. Your workspace's admins can read what Slack keeps."
                };
            });
        },
        signIn: function (ctx, p) {
            return signInAvailable(ctx).then(function (o) {
                if (!o.available) throw notAvailable();
                // The relay's sign-in, through the OAuth service's broker (not in this build: signInAvailable says so).
                return kit.oauthSignIn(ctx, o.client, { accountId: p.accountId });
            }).then(function (keyId) {
                return module.exports.validate(ctx, { config: { oauthKey: keyId } });
            });
        },
        outbox: function (ctx, p) {
            if (p.accountId) return sendOutbox(ctx, p);
            return Promise.resolve(ctx.luna.call("luna://com.palm.service.accounts/listAccounts", { templateId: TEMPLATE })).then(function (r) {
                var chain = Promise.resolve(), sent = 0;
                ((r && r.results) || []).forEach(function (a) {
                    chain = chain.then(function () {
                        return Promise.resolve(ctx.luna.call("luna://" + SERVICE + "/outbox", { accountId: a._id, messageId: p.messageId })).then(function (x) { sent += (x && x.sent) || 0; });
                    });
                });
                return chain.then(function () { return { sent: sent }; });
            });
        }
    }
});

module.exports.TEMPLATE = TEMPLATE;
module.exports.KINDS = K;
module.exports.PROVIDERS = P;
module.exports.OAUTH = OAUTH;
