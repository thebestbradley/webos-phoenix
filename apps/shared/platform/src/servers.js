// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The one place a device learns where the Phoenix platform is and which
// keys it trusts: /etc/palm/phoenix/servers.json (docs/PLATFORM-CLIENT.md,
// "The configuration"; schema docs/platform-api/servers.schema.json).
// The image's file is written at build time (meta-phoenix,
// tools/servers-json.py, from PHOENIX_FEEDS_URL and the other PHOENIX_*
// settings); the checkout's own (services/account/etc/palm/phoenix/
// servers.json) is the simulator's and points at this computer's servers.
// With Developer Mode on, an override (Settings > Developer Mode >
// Platform servers; org.webosphoenix.service.account/setServers) is laid
// over it, section by section, for testing a staging server. Nothing in
// the code names a production host: every service reads its addresses
// and trust anchors through resolve().
//
//   {"format": 1, "name", "feeds": base URL of the static feeds,
//    "api": base URL of the device API (null: no account, backup, push or
//           assistant services: they say "not set up"),
//    "catalog":     {"url", "key", "root"},
//    "updates":     {"url", "channel", "channels", "key", "root"},
//    "revocations": {"url"},
//    "drivers":     {"url", "key", "reportUrl"},
//    "account":     {"issuer", "clientId", "scope", "key" (the API's
//                    Ed25519 key that signs entitlements)},
//    "push":        {"server"},
//    "assistant":   {"url"},
//    "connectivity": {"probe"}}
//
// A "url" may be relative: catalog, updates, revocations and drivers to
// "feeds", the others to "api". "key" pins a feed's online Ed25519 key;
// "root" pins the offline root key that delegates to the online one
// (lib delegation.js); both null on a feed that has signatures means a
// development setup (the catalog's key is then checked by the user, an
// update feed is taken unsigned).

"use strict";

var b64 = require("./b64");

var FORMAT = 1;
var CHANNELS = ["stable", "beta", "dev"];
var FEED_SECTIONS = ["catalog", "updates", "revocations", "drivers"];
var API_SECTIONS = ["account", "assistant"];
var SECTIONS = ["catalog", "updates", "revocations", "drivers", "account", "push", "assistant", "connectivity", "backup"];

function err(code, text) {
    var e = new Error(text);
    e.code = code;
    return e;
}

function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

// A base address: absolute http(s), ending in "/". Plain http only for
// this computer (the simulator's servers, the tests' mock platform) or
// when Developer Mode's override says so.
function base(v, insecureOk) {
    if (v === null || v === undefined || v === "") return null;
    var u;
    try { u = new URL(String(v)); } catch (e) { return null; }
    if (u.protocol !== "https:" && !(u.protocol === "http:" && (insecureOk || isLoopback(u.hostname)))) return null;
    var s = u.href;
    return s.charAt(s.length - 1) === "/" ? s : s + "/";
}
function isLoopback(host) {
    return host === "localhost" || host === "[::1]" || /^127\./.test(host);
}
function under(rel, root, insecureOk) {
    if (rel === null || rel === undefined || rel === "") return null;
    var s = String(rel);
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
        if (/^file:/i.test(s)) return s;   // the simulator's sample driver catalog
        var u;
        try { u = new URL(s); } catch (e) { return null; }
        if (u.protocol === "https:" || (u.protocol === "http:" && (insecureOk || isLoopback(u.hostname)))) return u.href;
        return null;
    }
    if (!root) return null;
    return new URL(s, root).href;
}
function key(v) {
    if (typeof v !== "string" || !v) return null;
    var k = b64.fromBase64(v);
    return k.length === 32 ? b64.toBase64(k) : null;
}

// Parse the file's text; throws BAD_CONFIG.
function parse(text) {
    var c;
    try { c = typeof text === "string" ? JSON.parse(text) : text; } catch (e) { throw err("BAD_CONFIG", "servers.json is not JSON"); }
    if (!isObject(c)) throw err("BAD_CONFIG", "servers.json is not an object");
    if (c.format !== undefined && c.format !== FORMAT) throw err("BAD_CONFIG", "servers.json format " + c.format + " is not " + FORMAT);
    return c;
}

// The override over the image's file: top-level values and each section's
// fields replace the image's ("null" too: a section switched off).
function merge(image, over) {
    var out = JSON.parse(JSON.stringify(image || {}));
    if (!isObject(over)) return out;
    Object.keys(over).forEach(function (k) {
        if (k === "//" || k === "format") return;
        if (isObject(over[k]) && isObject(out[k])) Object.keys(over[k]).forEach(function (f) { out[k][f] = over[k][f]; });
        else out[k] = over[k];
    });
    return out;
}

// image: the parsed servers.json (or null: no file). override: Developer
// Mode's, used only when devMode is true. -> the addresses and keys every
// client uses, with null for what is not set up.
function resolve(image, override, devMode) {
    var useOverride = !!devMode && isObject(override) && Object.keys(override).length > 0;
    var c = useOverride ? merge(image, override) : (image || {});
    var insecure = useOverride;
    var feeds = base(c.feeds, insecure), api = base(c.api, insecure);
    var sec = function (name) { return isObject(c[name]) ? c[name] : {}; };

    var catalog = sec("catalog"), updates = sec("updates"), revocations = sec("revocations"), drivers = sec("drivers");
    var account = sec("account"), push = sec("push"), assistant = sec("assistant"), connectivity = sec("connectivity");
    var channels = Array.isArray(updates.channels) ? updates.channels.filter(function (x) { return CHANNELS.indexOf(x) >= 0; }) : CHANNELS.slice();
    if (!channels.length) channels = ["stable"];

    var out = {
        format: FORMAT,
        name: typeof c.name === "string" ? c.name : "",
        overridden: useOverride,
        feeds: feeds,
        api: api,
        catalog: null, updates: null, revocations: null, drivers: null,
        account: null, push: null, assistant: null, connectivity: null, backup: null
    };
    var u = under(catalog.url, feeds, insecure);
    if (u) out.catalog = { url: slash(u), key: key(catalog.key), root: key(catalog.root) };
    u = under(updates.url, feeds, insecure);
    if (u) out.updates = { url: slash(u), channel: channels.indexOf(updates.channel) >= 0 ? updates.channel : channels[0],
                           channels: channels, key: key(updates.key), root: key(updates.root) };
    u = under(revocations.url, feeds, insecure);
    if (u) out.revocations = { url: u };
    u = under(drivers.url, feeds, insecure);
    if (u) out.drivers = { url: slash(u), key: key(drivers.key), reportUrl: under(drivers.reportUrl, api, insecure) };
    u = under(account.issuer, api, insecure);
    if (u && api) out.account = { issuer: u.replace(/\/+$/, ""), clientId: typeof account.clientId === "string" && account.clientId ? account.clientId : "phoenix-device",
                                  scope: typeof account.scope === "string" && account.scope ? account.scope : "openid account backup push reviews assistant",
                                  key: key(account.key) };
    // Cloud backup, push relay and the assistant go through the account:
    // without one they are not set up.
    if (out.account) {
        out.backup = { credentials: api + "v1/backup/credentials", summary: api + "v1/backup/summary" };
        u = under(push.server, api, insecure);
        out.push = { server: u ? slash(u) : null, channels: api + "v1/push/channels" };
        u = under(assistant.url, api, insecure);
        if (u) out.assistant = { url: slash(u) };
    }
    u = under(connectivity.probe, feeds, insecure);
    if (u) out.connectivity = { probe: u };
    return out;
}
function slash(u) { return u.charAt(u.length - 1) === "/" ? u : u + "/"; }

// What a page may see (Settings > Developer Mode, Device Info): the
// addresses, the keys' fingerprints left to the caller.
function summary(r) {
    var s = {};
    ["name", "overridden", "feeds", "api"].forEach(function (k) { s[k] = r[k]; });
    SECTIONS.forEach(function (k) { s[k] = r[k] ? JSON.parse(JSON.stringify(r[k])) : null; });
    return s;
}

// Checks an override before it is kept (setServers): only known sections
// and fields, addresses that parse, keys that are Ed25519 keys.
function checkOverride(o) {
    if (!isObject(o)) throw err("BAD_PARAMS", "servers: an object");
    var known = { name: 1, feeds: 1, api: 1, format: 1, "//": 1 };
    SECTIONS.forEach(function (k) { known[k] = 1; });
    Object.keys(o).forEach(function (k) {
        if (!known[k]) throw err("BAD_PARAMS", "servers: unknown field " + k);
        if ((k === "feeds" || k === "api") && o[k] !== null && !base(o[k], true)) throw err("BAD_PARAMS", k + ": an http(s) address");
        if (SECTIONS.indexOf(k) >= 0 && o[k] !== null && !isObject(o[k])) throw err("BAD_PARAMS", k + ": an object or null");
        if (isObject(o[k])) Object.keys(o[k]).forEach(function (f) {
            var v = o[k][f];
            if ((f === "key" || f === "root") && v !== null && !key(v)) throw err("BAD_PARAMS", k + "." + f + ": a base64 Ed25519 public key");
        });
    });
    return o;
}

module.exports = { FORMAT: FORMAT, CHANNELS: CHANNELS, SECTIONS: SECTIONS, FEED_SECTIONS: FEED_SECTIONS, API_SECTIONS: API_SECTIONS,
                   parse: parse, merge: merge, resolve: resolve, summary: summary, checkOverride: checkOverride, isLoopback: isLoopback };
