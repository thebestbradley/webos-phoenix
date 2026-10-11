// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The LinkedIn account (template com.webosphoenix.linkedin;
// docs/SYNERGY-CONNECTORS.md 7, "LinkedIn"), on the connector kit. LinkedIn's
// connections API is closed to all but paid partner programmes, so the
// account brings what any app may:
//
//   sign-in   Sign In with LinkedIn (OpenID Connect: openid profile email):
//             your name, photo and email address (GET /v2/userinfo)
//   sharing   Share on LinkedIn (w_member_social, open to any app): the share
//             sheet posts text and a link as you (POST /rest/posts,
//             https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api)
//   CONTACTS  read only: the people of your own data export's
//             Connections.csv, imported (importConnections, from the app's
//             page): name, company and position, the profile's link, the
//             email address when they allowed it; the linker joins them to
//             the people you have. Repeatable, not live: no feed, messages
//             or connection updates. Each sync checks the sign-in still
//             holds (LinkedIn's tokens last 60 days, with no refresh for
//             most apps: Accounts then asks to sign in again).
//
// LinkedIn's token exchange wants the app's client secret: Phoenix's
// LinkedIn app (registered by the project account; docs/DEVELOPER-APPS.md)
// signs in through the token relay (OPEN-QUESTIONS Q49), or with the secret
// in the image's setting /etc/palm/linkedin/clients.json ({"linkedin":
// {"clientId": "...", "clientSecret": "..."}}). Without: "not available in
// this build".

"use strict";

var kit = require("@phoenix/connector-kit");
var C = require("./lib/connections");

var SERVICE = "org.webosphoenix.service.linkedin";
var TEMPLATE = "com.webosphoenix.linkedin";
var CLIENTS = "linkedin/clients.json";
var API = "https://api.linkedin.com";
var VERSION = "202509";     // LinkedIn-Version of the Posts API (YYYYMM; LinkedIn keeps each a year)
var K = { contact: "com.palm.contact.linkedin:1", item: "org.webosphoenix.linkedin.item:1" };
var PROVIDER = TEMPLATE + ".contacts";
var OAUTH = {
    authorizationEndpoint: "https://www.linkedin.com/oauth/v2/authorization",
    tokenEndpoint: "https://www.linkedin.com/oauth/v2/accessToken",
    revocationEndpoint: "https://www.linkedin.com/oauth/v2/revoke",
    scope: "openid profile email w_member_social"
};

function fail(message, errorCode) { var e = new Error(message); e.errorCode = errorCode; return e; }

function clientOf(ctx) {
    return kit.registeredClient(ctx, CLIENTS, "linkedin", OAUTH).then(function (c) { return c && c.clientSecret ? c : kit.viaRelay(ctx, c); });
}
function notAvailable() {
    return fail("LinkedIn is not available in this build: Phoenix's LinkedIn app is not registered here, and LinkedIn's sign-in needs its client secret, " +
                "kept by Phoenix's token relay (docs/DEVELOPER-APPS.md)", "NOT_AVAILABLE");
}

function api(ctx, token, client) {
    return kit.restApi(ctx, { base: (client && client.api) || API, token: token,
                              headers: { "LinkedIn-Version": VERSION, "X-Restli-Protocol-Version": "2.0.0" },
                              describe: function (b) { return b && b.message ? String(b.message) : ""; } });
}

// A signed-in account's API calls need only the registration (the OAuth service refreshes its token).
function session(ctx) {
    var key = (ctx.credentials && ctx.credentials.oauthKey) || (ctx.config && ctx.config.oauthKey);
    return kit.registeredClient(ctx, CLIENTS, "linkedin", OAUTH).then(function (c) {
        if (!c) throw notAvailable();
        return api(ctx, function () { return ctx.oauth.token(key); }, c);
    });
}

// OpenID Connect's userinfo: {sub, name, given_name, family_name, picture, email}.
function whoAmI(a) {
    return a.get("/v2/userinfo").then(function (u) {
        if (!u || !u.sub) throw fail("LinkedIn did not say who signed in", "401_UNAUTHORIZED");
        return { id: u.sub, username: u.email || u.name || u.sub, name: u.name || "", picture: u.picture || "" };
    });
}

function result(me, keyId) {
    return { username: me.username, credentials: { common: { oauthKey: keyId } },
             config: { userId: me.id, name: me.name, picture: me.picture, oauthKey: keyId } };
}

// ---- Contacts: the imported connections ------------------------------------------------------

function pullConnections(ctx) {
    return session(ctx).then(function (a) {
        // The sign-in still holds (a 401 here puts the warning on the account).
        return whoAmI(a);
    }).then(function () {
        var list = ctx.state.connections || [];
        return { full: true, nextToken: null, changes: list.map(function (c) { return { remoteId: c.remoteId, fields: c.fields }; }) };
    });
}

function importConnections(ctx, p) {
    var path = String(p.path || "");
    var read = p.csv !== undefined ? Promise.resolve(String(p.csv))
        : !/\.csv$/i.test(path) ? Promise.reject(fail("Choose LinkedIn's Connections.csv", "400_BAD_REQUEST"))
        : ctx.readFile(path).then(function (f) { return new TextDecoder("utf-8").decode(f.bytes); });
    return read.then(function (text) {
        var list = C.readConnections(text);
        ctx.state.connections = list;
        ctx.state.importedAt = ctx.now();
        // Into Contacts now: a sync of the account.
        Promise.resolve(ctx.luna.call("luna://" + SERVICE + "/sync", { accountId: ctx.accountId })).catch(function () {});
        return { imported: list.length };
    });
}

// ---- Sharing --------------------------------------------------------------------------------------

var SHARE = {
    label: "LinkedIn",
    accepts: { text: { maxLength: 3000 }, link: true },
    audience: {
        label: "Who can see it",
        options: [{ value: "PUBLIC", label: "Anyone", hint: "Anyone on or off LinkedIn." },
                  { value: "CONNECTIONS", label: "Connections", hint: "Your connections only." }],
        "default": "PUBLIC"
    },
    send: function (ctx, content) {
        var text = String(content.text || "").trim();
        var url = String(content.url || "").trim();
        if (!text && !url) return Promise.reject(fail("Nothing to share", "400_BAD_REQUEST"));
        var sub = ctx.config && ctx.config.userId;
        if (!sub) return Promise.reject(fail("Sign in with LinkedIn again", "401_UNAUTHORIZED"));
        return session(ctx).then(function (a) {
            var post = {
                author: "urn:li:person:" + sub, commentary: text, visibility: content.audience === "CONNECTIONS" ? "CONNECTIONS" : "PUBLIC",
                distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
                lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false
            };
            if (url) post.content = { article: { source: url, title: String(content.title || url).slice(0, 400) } };
            return a.send("POST", "/rest/posts", { body: post, raw: true });
        }).then(function (r) {
            var id = (r.headers && (r.headers["x-restli-id"] || r.headers["X-RestLi-Id"])) || "";
            return { id: id, url: id ? "https://www.linkedin.com/feed/update/" + encodeURIComponent(id) + "/" : "" };
        });
    }
};

// ---- The definition ------------------------------------------------------------------------------

function signIn(ctx, p) {
    var client;
    return clientOf(ctx).then(function (c) {
        if (!c) throw notAvailable();
        client = c;
        return kit.oauthSignIn(ctx, client, { accountId: p.accountId });
    }).then(function (keyId) {
        return whoAmI(api(ctx, function () { return ctx.oauth.token(keyId); }, client)).then(function (me) {
            return kit.forgetOldKey(ctx, p.accountId, keyId).then(function () { return result(me, keyId); });
        });
    });
}

var capabilities = {};
capabilities[PROVIDER] = { capability: "CONTACTS", kind: K.contact, fields: ["name", "organizations", "urls", "emails", "note"], pull: pullConnections };

module.exports = kit.defineConnector({
    service: SERVICE,
    templateIds: [TEMPLATE],
    kinds: { state: "org.webosphoenix.linkedin.state:1", item: K.item },
    userAgent: "webOS-Phoenix-LinkedIn/0.1",
    hosts: ["api.linkedin.com", "www.linkedin.com"],
    signUp: "https://www.linkedin.com/signup",

    validate: function (ctx, p) {
        var c = p.config || {};
        if (!c.oauthKey) return Promise.reject(fail("Sign in with LinkedIn first", "401_UNAUTHORIZED"));
        return kit.registeredClient(ctx, CLIENTS, "linkedin", OAUTH).then(function (client) {
            if (!client) throw notAvailable();
            return whoAmI(api(ctx, function () { return ctx.oauth.token(c.oauthKey); }, client));
        }).then(function (me) { return result(me, c.oauthKey); });
    },

    capabilities: capabilities,
    schedule: { every: "1d" },

    onDelete: function (ctx) {
        var key = ctx.credentials && ctx.credentials.oauthKey;
        return key ? ctx.oauth.forget(key) : Promise.resolve();
    },

    share: SHARE,

    methods: {
        providerInfo: function (ctx) {
            return clientOf(ctx).then(function (c) {
                return {
                    name: "LinkedIn",
                    help: "Sign In with LinkedIn shares from the share sheet as you. Your connections come to Contacts from your own data export (LinkedIn's Settings, Data privacy, Get a copy of your data: Connections), imported on the LinkedIn page.",
                    oauth: c ? { available: true, label: "Sign In with LinkedIn" } : { available: false, reason: notAvailable().message },
                    privacy: "What you share goes between this device and LinkedIn." + (c && c.broker ? " LinkedIn's sign-in goes through Phoenix's token relay, which sees the sign-in's tokens as they pass and keeps nothing." : "") +
                             " Your Connections.csv stays on this device."
                };
            });
        },
        signIn: function (ctx, p) { return signIn(ctx, p); },
        // {accountId, path: a Connections.csv on the device | csv: its text} -> {imported}
        importConnections: function (ctx, p) {
            if (!p.accountId) return Promise.reject(fail("accountId is required", "400_BAD_REQUEST"));
            return importConnections(ctx, p);
        }
    }
});

module.exports.TEMPLATE = TEMPLATE;
module.exports.KINDS = K;
module.exports.PROVIDER = PROVIDER;
