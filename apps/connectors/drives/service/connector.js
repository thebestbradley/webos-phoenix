// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.drives: the drives, as Synergy accounts with the
// DOCUMENTS capability (docs/SYNERGY-CONNECTORS.md 7, "Drives and cloud
// storage"; docs/SYNERGY-SDK.md "Drives"). Each account is a place in
// Files, the file picker, the save picker and the share sheet's Save to
// Files (/media/drives/<accountId>, the kit's drives.ts), as webOS 3's Box
// and Dropbox accounts were QuickOffice's places.
//
// One account type per provider, one connector for them all:
//
//   com.webosphoenix.drive.nextcloud   Nextcloud: Login Flow v2 (the
//       server's own page in the browser gives an app password), or an
//       app password typed in; WebDAV with chunked upload and search
//   com.webosphoenix.drive.owncloud    ownCloud: an app password; WebDAV
//   com.webosphoenix.drive.webdav      any WebDAV server: its address, a user
//       name and (app) password
//   com.webosphoenix.drive.s3          S3-compatible storage (Backblaze B2,
//       Wasabi, MinIO, AWS, ...): endpoint, region, bucket, an access key
//   com.webosphoenix.drive.dropbox     Dropbox (OAuth, PKCE)
//   com.webosphoenix.drive.onedrive    OneDrive (Microsoft Graph; OAuth, PKCE)
//   com.webosphoenix.drive.googledrive Google Drive (OAuth; the drive.file
//       scope: the files Phoenix made or opened)
//   com.webosphoenix.drive.box         Box (OAuth)
//
// The OAuth providers need Phoenix's app registered with them; the client
// ids are not in the source tree but a setting of the image,
// /etc/palm/drives/clients.json ({"dropbox": {"clientId": "..."}, ...};
// docs/DEVELOPER-APPS.md). Without one the account type says "not
// available in this build" (providerInfo) instead of failing at sign-in.
// Tokens stay in the OAuth service's key store; the account keeps its key.

"use strict";

var kit = require("@phoenix/connector-kit");
var W = require("./lib/webdav");
var S3 = require("./lib/s3");
var DBX = require("./lib/dropbox");
var G = require("./lib/graph");
var GD = require("./lib/gdrive");
var BOX = require("./lib/box");
var N = require("./lib/net");

var SERVICE = "org.webosphoenix.service.drives";
var OAUTH = "luna://org.webosphoenix.service.oauth/";
var CLIENTS = "drives/clients.json";
var T = {
    nextcloud: "com.webosphoenix.drive.nextcloud", owncloud: "com.webosphoenix.drive.owncloud", webdav: "com.webosphoenix.drive.webdav",
    s3: "com.webosphoenix.drive.s3", dropbox: "com.webosphoenix.drive.dropbox", onedrive: "com.webosphoenix.drive.onedrive",
    googledrive: "com.webosphoenix.drive.googledrive", box: "com.webosphoenix.drive.box"
};
var NAMES = { nextcloud: "Nextcloud", owncloud: "ownCloud", webdav: "WebDAV", s3: "S3 storage", dropbox: "Dropbox", onedrive: "OneDrive",
              googledrive: "Google Drive", box: "Box" };
var OAUTH_PROVIDERS = {
    dropbox: { lib: DBX, endpoints: ["api", "content"] },
    onedrive: { lib: G, endpoints: ["graph"] },
    googledrive: { lib: GD, endpoints: ["api", "upload"] },
    box: { lib: BOX, endpoints: ["api", "upload"] }
};
// S3 providers the sign-in page offers, with their endpoints ({region}).
var S3_PRESETS = {
    b2: { name: "Backblaze B2", endpoint: "https://s3.{region}.backblazeb2.com", region: "us-west-004", pathStyle: false },
    wasabi: { name: "Wasabi", endpoint: "https://s3.{region}.wasabisys.com", region: "us-east-1", pathStyle: false },
    aws: { name: "Amazon S3", endpoint: "https://s3.{region}.amazonaws.com", region: "us-east-1", pathStyle: false },
    minio: { name: "MinIO or another server", endpoint: "", region: "us-east-1", pathStyle: true }
};

function providerOf(templateId) {
    var k = Object.keys(T).filter(function (x) { return T[x] === templateId; })[0];
    if (!k) throw Object.assign(new Error("Not a drive account type: " + templateId), { errorCode: "400_BAD_REQUEST" });
    return k;
}

function fail(message, errorCode) { var e = new Error(message); e.errorCode = errorCode; return e; }

function lunaOk(ctx, uri, params) {
    return ctx.luna.call(uri, params).then(function (r) {
        if (r && r.returnValue === false) throw fail(r.errorText || uri + " failed", r.errorCode || "UNKNOWN_ERROR");
        return r;
    });
}

// ---- The OAuth providers' registrations (the image's setting) ----------------------

function clientOf(ctx, provider) {
    return ctx.systemConfig(CLIENTS).then(function (all) {
        var c = all && all[provider];
        if (!c || typeof c.clientId !== "string" || !c.clientId) return null;
        var lib = OAUTH_PROVIDERS[provider].lib;
        var out = Object.assign({}, lib.OAUTH, c);
        if (provider === "googledrive" && c.scope === "drive") out.scope = lib.OAUTH.fullScope;
        else out.scope = lib.OAUTH.scope;
        // Endpoint addresses of the setting (a test server) may be reached.
        ["authorizationEndpoint", "tokenEndpoint", "revocationEndpoint"].concat(OAUTH_PROVIDERS[provider].endpoints).forEach(function (k) {
            if (c[k]) { try { ctx.http.allowHost(new URL(c[k]).host); } catch (e) { /* not an address */ } }
        });
        return out;
    });
}

function notAvailable(provider) {
    return fail(NAMES[provider] + " is not available in this build: Phoenix's app is not registered with " + NAMES[provider] +
                " here (docs/DEVELOPER-APPS.md)", "NOT_AVAILABLE");
}

// ---- Each account's drive (the DOCUMENTS capability's provider) ------------------------

// The account's settings: the validator's config, kept by the kit since
// onCreate, and also in the account's credentials (as the Fediverse keeps its
// server there), for an Accounts app that does not hand config to onCreate.
function settingsOf(ctx) {
    var cred = ctx.credentials || {};
    var c = Object.assign({}, cred.settings || {}, ctx.config || {});
    if (c.serverUrl) { try { ctx.http.allowHost(new URL(c.serverUrl).host); } catch (e) { /* not an address */ } }
    if (c.server && /^https?:/.test(c.server)) { try { ctx.http.allowHost(new URL(c.server).host); } catch (e) { /* not an address */ } }
    return c;
}

function driveFor(ctx) {
    var provider = providerOf(ctx.account.templateId);
    var c = settingsOf(ctx), cred = ctx.credentials || {};
    if (provider === "nextcloud" || provider === "owncloud" || provider === "webdav") {
        if (!cred.password) return Promise.reject(kit.fileError(kit.FILE_ERRORS.AUTH, "The account has no password: sign in again"));
        return Promise.resolve(W.createWebdav(ctx, { root: c.serverUrl, user: cred.user || c.user || ctx.account.username, password: cred.password,
                                                     flavor: provider }));
    }
    if (provider === "s3") {
        return Promise.resolve(S3.createS3(ctx, { endpoint: c.endpoint, region: c.region, bucket: c.bucket, pathStyle: !!c.pathStyle, prefix: c.prefix,
                                                  accessKeyId: cred.accessKeyId, secretAccessKey: cred.secretAccessKey }));
    }
    return clientOf(ctx, provider).then(function (client) {
        if (!client) throw kit.fileError(kit.FILE_ERRORS.NOT_AVAILABLE, notAvailable(provider).message);
        var key = cred.oauthKey || c.oauthKey;
        var token = function () { return ctx.oauth.token(key); };
        var o = Object.assign({ token: token }, client);
        if (provider === "dropbox") return DBX.createDropbox(ctx, o);
        if (provider === "onedrive") return G.createGraph(ctx, o);
        if (provider === "googledrive") return GD.createGdrive(ctx, o);
        return BOX.createBox(ctx, o);
    });
}

// ---- Signing in ----------------------------------------------------------------------

function serverOf(raw) {
    var s = String(raw || "").trim();
    if (!s) throw fail("The server's address is needed", "400_BAD_REQUEST");
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    var u;
    try { u = new URL(s); } catch (e) { throw fail("Not a server address: " + raw, "400_BAD_REQUEST"); }
    return u;
}

function davValidate(ctx, provider, p) {
    var user = String(p.username || "").trim(), password = p.password || "";
    var config = p.config || {};
    if (!user || !password) return Promise.reject(fail("The user name and app password are needed", "401_UNAUTHORIZED"));
    var u = serverOf(config.server || config.serverUrl);
    var origin = u.origin;
    // Nextcloud and ownCloud: the user's files root; any other: the address as given.
    var root = provider === "webdav" ? u.href.replace(/\/*$/, "/") : W.filesRoot(origin + u.pathname.replace(/\/+$/, "").replace(/\/(index\.php|remote\.php.*)$/, ""), user);
    ctx.http.allowHost(u.host);
    var drive = W.createWebdav(ctx, { root: root, user: user, password: password, flavor: provider });
    return drive.stat("/").then(function () {
        var config = { provider: provider, server: origin, serverUrl: root, user: user };
        return { username: user + "@" + u.host + (provider === "webdav" && u.pathname !== "/" ? u.pathname.replace(/\/$/, "") : ""),
                 credentials: { common: { user: user, password: password, settings: config } }, config: config };
    }, function (e) {
        if (e.code === kit.FILE_ERRORS.AUTH) throw fail("The server did not accept the user name and password", "401_UNAUTHORIZED");
        if (e.code === kit.FILE_ERRORS.NOT_FOUND || e.code === kit.FILE_ERRORS.UNSUPPORTED || e.status === 405)
            throw fail("No WebDAV files at " + root, "UNSUPPORTED_CAPABILITY");
        if (e.code === kit.FILE_ERRORS.OFFLINE) throw fail(e.message, "CONNECTION_FAILED");
        throw e;
    });
}

function s3Validate(ctx, p) {
    var c = p.config || {};
    var preset = S3_PRESETS[c.preset] || null;
    var region = String(c.region || (preset && preset.region) || "us-east-1").trim();
    var endpoint = String(c.endpoint || "").trim() || (preset && preset.endpoint ? preset.endpoint.replace("{region}", region) : "");
    var bucket = String(c.bucket || "").trim();
    if (!endpoint || !bucket) return Promise.reject(fail("The endpoint and the bucket are needed", "400_BAD_REQUEST"));
    var u = serverOf(endpoint);
    var pathStyle = c.pathStyle !== undefined ? !!c.pathStyle : preset ? preset.pathStyle : true;
    var accessKeyId = String(p.username || "").trim(), secretAccessKey = p.password || "";
    if (!accessKeyId || !secretAccessKey) return Promise.reject(fail("The key id and secret are needed", "401_UNAUTHORIZED"));
    var base = pathStyle ? u.origin : u.protocol + "//" + bucket + "." + u.host;
    ctx.http.allowHost(new URL(base).host);
    var prefix = String(c.prefix || "").replace(/^\/+|\/+$/g, "");
    var drive = S3.createS3(ctx, { endpoint: u.origin, region: region, bucket: bucket, pathStyle: pathStyle, prefix: prefix,
                                   accessKeyId: accessKeyId, secretAccessKey: secretAccessKey });
    return drive.list("/").then(function () {
        var config = { provider: "s3", preset: c.preset || "", endpoint: u.origin, region: region, bucket: bucket, pathStyle: pathStyle,
                       prefix: prefix, serverUrl: base };
        return { username: bucket + (prefix ? "/" + prefix : "") + "@" + u.host,
                 credentials: { common: { accessKeyId: accessKeyId, secretAccessKey: secretAccessKey, settings: config } }, config: config };
    }, function (e) {
        if (e.code === kit.FILE_ERRORS.AUTH) throw fail("The storage did not accept the key", "401_UNAUTHORIZED");
        if (e.code === kit.FILE_ERRORS.NOT_FOUND) throw fail("There is no bucket " + bucket + " there", "400_BAD_REQUEST");
        if (e.code === kit.FILE_ERRORS.PERMISSION) throw fail("The key may not list the bucket " + bucket, "401_UNAUTHORIZED");
        if (e.code === kit.FILE_ERRORS.OFFLINE) throw fail(e.message, "CONNECTION_FAILED");
        throw e;
    });
}

// Who the token belongs to: the account's name.
function whoAmI(ctx, provider, client, keyId) {
    return ctx.oauth.token(keyId).then(function (t) {
        var lib = OAUTH_PROVIDERS[provider].lib;
        var base = provider === "onedrive" ? client.graph : client.api;
        return lib.whoAmI(ctx, t, base);
    }).catch(function (e) {
        if (e.code === kit.FILE_ERRORS.AUTH || e.status === 401) throw fail("The sign-in was not accepted: sign in again", "401_UNAUTHORIZED");
        throw e;
    });
}

function oauthResult(provider, keyId, me) {
    return { username: me.username, credentials: { common: { oauthKey: keyId } }, config: { provider: provider, oauthKey: keyId } };
}

function signIn(ctx, p) {
    var provider = providerOf(p.templateId);
    if (!OAUTH_PROVIDERS[provider]) return Promise.reject(fail(NAMES[provider] + " signs in with a password", "400_BAD_REQUEST"));
    var client;
    return clientOf(ctx, provider).then(function (c) {
        if (!c) throw notAvailable(provider);
        client = c;
        return lunaOk(ctx, OAUTH + "redirectUri", {});
    }).then(function (r) {
        var req = { authorizationEndpoint: client.authorizationEndpoint, tokenEndpoint: client.tokenEndpoint, clientId: client.clientId,
                    scope: client.scope, redirectUri: client.redirectUri || r.redirectUri };
        if (client.clientSecret) req.clientSecret = client.clientSecret;
        if (client.revocationEndpoint) req.revocationEndpoint = client.revocationEndpoint;
        if (client.params) req.params = client.params;
        return lunaOk(ctx, OAUTH + "authorize", req);
    }).then(function (auth) {
        return whoAmI(ctx, provider, client, auth.keyId).then(function (me) {
            // Signing in again (the old token refused): the old key goes.
            var old = p.accountId ? lunaOk(ctx, "luna://com.palm.service.accounts/readCredentials", { accountId: p.accountId, name: "common" })
                .then(function (r) { var k = r.credentials && r.credentials.oauthKey; return k && k !== auth.keyId ? ctx.oauth.forget(k) : null; })
                .catch(function () {}) : Promise.resolve();
            return old.then(function () { return oauthResult(provider, auth.keyId, me); });
        });
    });
}

// Nextcloud's Login Flow v2: start, then poll until the user has signed in
// on the server's page (opened in the browser by the sign-in page).
function loginFlowStart(ctx, p) {
    var u = serverOf(p.server);
    var base = u.origin + u.pathname.replace(/\/+$/, "").replace(/\/index\.php.*$/, "");
    return N.send(ctx, { method: "POST", url: base + "/index.php/login/v2", headers: { "User-Agent": "webOS Phoenix (Files)", Accept: "application/json" } })
        .then(function (res) {
            var b = N.jsonOf(res) || {};
            if (res.status !== 200 || !b.login || !b.poll || !b.poll.token)
                throw fail("This is not a Nextcloud server (no Login Flow v2 at " + base + ")", "UNSUPPORTED_CAPABILITY");
            var poll = new URL(b.poll.endpoint, base);
            if (poll.host !== u.host) throw fail("The server's login answer points elsewhere", "400_BAD_REQUEST");
            return { loginUrl: b.login, pollEndpoint: poll.href, pollToken: b.poll.token, server: base };
        });
}

function loginFlowPoll(ctx, p) {
    var server = serverOf(p.server), poll = serverOf(p.pollEndpoint);
    if (poll.host !== server.host) return Promise.reject(fail("The poll address is not the server's", "400_BAD_REQUEST"));
    return N.send(ctx, { method: "POST", url: poll.href, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
                         body: "token=" + encodeURIComponent(p.pollToken || "") }).then(function (res) {
        if (res.status === 404) return { done: false };
        var b = N.jsonOf(res) || {};
        if (res.status !== 200 || !b.loginName || !b.appPassword) throw fail("The server's login did not finish (HTTP " + res.status + ")", "401_UNAUTHORIZED");
        return davValidate(ctx, "nextcloud", { username: b.loginName, password: b.appPassword, config: { server: b.server || p.server } })
            .then(function (r) { return Object.assign({ done: true }, r); });
    });
}

// ---- The definition ---------------------------------------------------------------------

var capabilities = {};
Object.keys(T).forEach(function (k) {
    capabilities[T[k] + ".files"] = { capability: "DOCUMENTS", files: driveFor };
});

module.exports = kit.defineConnector({
    service: SERVICE,
    templateIds: Object.keys(T).map(function (k) { return T[k]; }),
    kinds: { state: "org.webosphoenix.drives.state:1" },
    userAgent: "webOS-Phoenix-Drives/0.1",
    hosts: [].concat(DBX.HOSTS, G.HOSTS, GD.HOSTS, BOX.HOSTS),

    // Where a person without an account gets one: the provider's own sign-up
    // page; Nextcloud's list of providers (a free account on one of them).
    signUpByTemplate: (function () {
        var s = {};
        s[T.nextcloud] = "https://nextcloud.com/sign-up/";
        s[T.owncloud] = "https://owncloud.com/";
        s[T.s3] = { url: "https://www.backblaze.com/sign-up/cloud-storage",
                    servers: [{ name: "Backblaze B2", url: "https://www.backblaze.com/sign-up/cloud-storage" },
                              { name: "Wasabi", url: "https://console.wasabisys.com/signup" }] };
        s[T.dropbox] = "https://www.dropbox.com/register";
        s[T.onedrive] = "https://signup.live.com/";
        s[T.googledrive] = "https://accounts.google.com/signup";
        s[T.box] = "https://account.box.com/signup/personal";
        return s;
    })(),

    validate: function (ctx, p) {
        var provider = providerOf(p.templateId || ctx.templateId);
        if (provider === "nextcloud" || provider === "owncloud" || provider === "webdav") return davValidate(ctx, provider, p);
        if (provider === "s3") return s3Validate(ctx, p);
        var c = p.config || {};
        if (!c.oauthKey) return Promise.reject(fail("Sign in with " + NAMES[provider] + " first", "401_UNAUTHORIZED"));
        return clientOf(ctx, provider).then(function (client) {
            if (!client) throw notAvailable(provider);
            return whoAmI(ctx, provider, client, c.oauthKey);
        }).then(function (me) { return oauthResult(provider, c.oauthKey, me); });
    },

    capabilities: capabilities,

    onDelete: function (ctx) {
        var provider = providerOf(ctx.account.templateId);
        var cred = ctx.credentials || {};
        if (OAUTH_PROVIDERS[provider]) {
            var key = cred.oauthKey || settingsOf(ctx).oauthKey;
            // Dropbox revokes with its own call (not RFC 7009); the others with the OAuth service's forget.
            var revoke = provider === "dropbox" && key ? clientOf(ctx, provider).then(function (client) {
                if (!client) return null;
                return ctx.oauth.token(key).then(function (t) {
                    return N.send(ctx, { method: "POST", url: (client.api || "https://api.dropboxapi.com/2/") + "auth/token/revoke",
                                         headers: { Authorization: "Bearer " + t } });
                });
            }).catch(function () {}) : Promise.resolve();
            return revoke.then(function () { return ctx.oauth.forget(key); });
        }
        var settings = settingsOf(ctx);
        if (provider === "nextcloud" && cred.password && settings.server) {
            // The app password Login Flow made is deleted on the server too
            // (https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html#deleting-an-app-password).
            var H = require("./lib/hash");
            return N.send(ctx, { method: "DELETE", url: settings.server + "/ocs/v2.php/core/apppassword",
                                 headers: { "OCS-APIRequest": "true", Authorization: "Basic " + H.base64(H.utf8((cred.user || "") + ":" + cred.password)) } })
                .then(function () {}, function () {});
        }
        return Promise.resolve();
    },

    methods: {
        // {templateId} -> {available, reason?, provider, presets?}: what the sign-in page shows.
        providerInfo: function (ctx, p) {
            var provider = providerOf(p.templateId);
            var out = { provider: provider, name: NAMES[provider], available: true };
            if (provider === "s3") out.presets = Object.keys(S3_PRESETS).map(function (k) { return Object.assign({ id: k }, S3_PRESETS[k]); });
            if (!OAUTH_PROVIDERS[provider]) return Promise.resolve(out);
            return clientOf(ctx, provider).then(function (c) {
                if (!c) { out.available = false; out.reason = notAvailable(provider).message; }
                else if (provider === "googledrive") out.scope = c.scope === GD.OAUTH.fullScope ? "drive" : "drive.file";
                return out;
            });
        },
        // {templateId, accountId?} -> the validator's answer, after the provider's sign-in page.
        signIn: function (ctx, p) { return signIn(ctx, p); },
        // {server} -> {loginUrl, pollEndpoint, pollToken, server}
        loginFlowStart: function (ctx, p) { return loginFlowStart(ctx, p); },
        // {server, pollEndpoint, pollToken} -> {done: false} or {done: true, username, credentials, config}
        loginFlowPoll: function (ctx, p) { return loginFlowPoll(ctx, p); }
    }
});

module.exports.TEMPLATES = T;
module.exports.S3_PRESETS = S3_PRESETS;
