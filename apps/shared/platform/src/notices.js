// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system notices feed (docs/NOTICES.md): short messages the project's
// staff publish once for every device ("Phoenix 1.0.3 is ready", "Sync is
// down; we're on it"), which each device shows once as a system
// notification. On the feeds host (servers.json "notices.url"), with a
// detached signature by one of the notices keys servers.json pins
// ("notices.keys": a key of its own, not the catalog's, so a leak of one
// cannot forge the other; two while the key changes):
//
//   notices.json      {"format": 1, "sequence": n, "generated", "expires",
//                      "notices": [{"id", "severity": "info" | "important" | "critical",
//                                   "title" (60 characters at most), "body" (300),
//                                   "starts"?, "ends"? (ISO 8601 times),
//                                   "audience"?: {"channels"?: ["beta", ...],
//                                                 "compatible"?: ["phoenix-vm-arm64", ...],
//                                                 "minBuild"?, "maxBuild"?,
//                                                 "locales"?: ["de", "en-GB", ...]},
//                                   "action"?: {"kind": "update"}
//                                            | {"kind": "app", "appId", "params"?: {...}}
//                                            | {"kind": "url", "url": "https://..."},
//                                   "dismissible"?: true}]}
//   notices.json.sig  base64 Ed25519 signature of notices.json's bytes
//
// The file is checked as the revocation list is (revocations.js): the
// signature over the exact bytes before anything is read, format 1,
// "expires" in the future, "sequence" never lower than one already taken.
// Then each notice on its own: one that is not a notice is left out and the
// others stay; an action this device does not allow is left out and the
// notice stays, without it. The text is plain text, never HTML: control
// characters and the invisible characters that turn text around are taken
// out, and the shell shows it as text. An audience field that is there but
// not understood leaves the notice out (it narrows; it never widens to
// everyone). At most 20 notices are read, and a file over 64 KB is refused.

"use strict";

var b64 = require("./b64");
var signed = require("./signed");

var FORMAT = 1;
var MAX_BYTES = 64 * 1024;
var MAX_NOTICES = 20;
var TITLE_MAX = 60;
var BODY_MAX = 300;
var SEVERITIES = ["info", "important", "critical"];
var SETTINGS = "org.webosphoenix.settings";
var MARKETPLACE = "org.webosphoenix.marketplace";
var BROWSER = "com.palm.app.browser";
// The apps a notice may open ("app"): Settings (any pane: {page}), the
// Marketplace ({appId} of an app's page), and the browser, whose one
// param, "target", must pass the same check as a "url" action.
var APPS = [SETTINGS, MARKETPLACE, BROWSER];
var MAX_PARAMS = 2048;   // bytes of an app action's params, as JSON

function err(code, text) {
    var e = new Error(text);
    e.code = code;
    return e;
}
function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

// Plain text: control characters (C0, DEL, C1: a newline too) become a
// space; zero-width characters and the bidirectional overrides and isolates
// (which can make a link or a name read backwards) go; then at most max
// characters, never half a surrogate pair.
function plain(s, max) {
    if (typeof s !== "string") return "";
    var t = s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
             .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
             .replace(/\s{2,}/g, " ").trim();
    if (t.length > max) {
        t = t.slice(0, max);
        if (/[\ud800-\udbff]$/.test(t)) t = t.slice(0, -1);
        t = t.replace(/\s+$/, "");
    }
    return t;
}

// An ISO 8601 time -> ms; undefined when absent; NaN when not a time.
function time(v) {
    if (v === undefined || v === null) return undefined;
    return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? Date.parse(v) : NaN;
}
function badTime(t) { return t !== undefined && isNaN(t); }

function normLocale(s) {
    var p = String(s).replace(/_/g, "-").split("-");
    return p.map(function (x, i) { return i === 0 ? x.toLowerCase() : x.length === 2 ? x.toUpperCase() : x; }).join("-");
}

// A list field of the audience: absent or [] -> [] (everyone); a list of
// strings matching re -> it; anything else -> null (the notice is left out).
function list(v, re) {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > 100) return null;
    for (var i = 0; i < v.length; i++) if (typeof v[i] !== "string" || !re.test(v[i])) return null;
    return v.slice();
}
function build(v) {
    if (v === undefined || v === null) return null;
    return typeof v === "number" && v === Math.floor(v) && v >= 0 ? v : undefined;
}
function audienceOf(a) {
    if (a === undefined || a === null) a = {};
    if (!isObject(a)) return null;
    var out = {
        channels: list(a.channels, /^[a-z]{1,16}$/),
        compatible: list(a.compatible, /^[A-Za-z0-9._-]{1,64}$/),
        minBuild: build(a.minBuild),
        maxBuild: build(a.maxBuild),
        locales: list(a.locales, /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/)
    };
    if (!out.channels || !out.compatible || !out.locales || out.minBuild === undefined || out.maxBuild === undefined) return null;
    out.locales = out.locales.map(normLocale);
    return out;
}

// The origins a "url" action may point at: the platform's own, as
// servers.json names them (resolved: feeds, api, notices.site), https only.
function originsOf(resolved) {
    var out = [];
    [resolved && resolved.feeds, resolved && resolved.api, resolved && resolved.notices && resolved.notices.site].forEach(function (v) {
        if (typeof v !== "string") return;
        try {
            var u = new URL(v);
            if (u.protocol === "https:" && out.indexOf(u.origin) < 0) out.push(u.origin);
        } catch (e) { /* not an address */ }
    });
    return out;
}

// An https address on one of origins, without user name or password -> it; else null.
function safeUrl(v, origins) {
    if (typeof v !== "string" || !v || v.length > 2048) return null;
    var u;
    try { u = new URL(v); } catch (e) { return null; }
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return (origins || []).indexOf(u.origin) >= 0 ? u.href : null;
}

// What a tap does, as the application manager's launch: {kind, appId,
// params} (and url for a link), or null when this device does not allow it.
function actionOf(a, origins) {
    if (!isObject(a)) return null;
    if (a.kind === "update") return { kind: "update", appId: SETTINGS, params: { page: "updates" } };
    var url = a.kind === "url" ? a.url
        : a.kind === "app" && a.appId === BROWSER ? (isObject(a.params) ? a.params.target : null) : undefined;
    if (url !== undefined) {
        var u = safeUrl(url, origins);
        return u ? { kind: "url", url: u, appId: BROWSER, params: { target: u } } : null;
    }
    if (a.kind !== "app" || APPS.indexOf(a.appId) < 0) return null;
    var p = a.params === undefined || a.params === null ? {} : a.params;
    if (!isObject(p)) return null;
    var text;
    try { text = JSON.stringify(p); } catch (e) { return null; }
    if (text.length > MAX_PARAMS) return null;
    return { kind: "app", appId: a.appId, params: JSON.parse(text) };
}

// One notice of the feed -> the notice as the device keeps it, or null.
// opts: {origins} (originsOf)
function normalizeNotice(n, opts) {
    if (!isObject(n) || typeof n.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(n.id)) return null;
    if (SEVERITIES.indexOf(n.severity) < 0) return null;
    var title = plain(n.title, TITLE_MAX);
    if (!title) return null;
    var starts = time(n.starts), ends = time(n.ends);
    if (badTime(starts) || badTime(ends)) return null;
    var audience = audienceOf(n.audience);
    if (!audience) return null;
    return {
        id: n.id, severity: n.severity, title: title, body: plain(n.body, BODY_MAX),
        starts: starts === undefined ? null : new Date(starts).toISOString(),
        ends: ends === undefined ? null : new Date(ends).toISOString(),
        audience: audience,
        action: n.action === undefined || n.action === null ? null : actionOf(n.action, opts && opts.origins),
        dismissible: n.dismissible !== false
    };
}

// bytes, signature (base64 text), keys (the pinned notices keys) ->
// Promise<{sequence, generated, expires, notices}>: the notices that are
// notices and have not ended. opts {sha512, now, lastSequence, origins}
function verify(bytes, signatureB64, keys, opts) {
    opts = opts || {};
    if (!keys || !keys.length) return Promise.reject(err("UNTRUSTED", "No notices key to check the notices feed with"));
    if (!bytes || bytes.length > MAX_BYTES) return Promise.reject(err("BAD_FEED", "The notices feed is larger than 64 KB"));
    return signed.verifyWithAny(bytes, signatureB64, keys, opts.sha512, "notices feed").then(function () {
        var r;
        try { r = JSON.parse(b64.fromUtf8(bytes)); } catch (e) { throw err("BAD_FEED", "The notices feed is not JSON"); }
        if (!isObject(r) || r.format !== FORMAT || !Array.isArray(r.notices)) throw err("BAD_FEED", "Not a format 1 notices feed");
        if (typeof r.sequence !== "number" || r.sequence !== Math.floor(r.sequence) || r.sequence < 0)
            throw err("BAD_FEED", "The notices feed has no sequence");
        var exp = time(r.expires);
        if (exp === undefined || isNaN(exp)) throw err("BAD_FEED", "The notices feed has no expiry");
        var now = (opts.now || new Date()).getTime();
        if (exp < now) throw err("EXPIRED", "The notices feed expired on " + r.expires);
        if (typeof opts.lastSequence === "number" && r.sequence < opts.lastSequence)
            throw err("ROLLBACK", "The notices feed is older than one already seen (" + r.sequence + " < " + opts.lastSequence + ")");
        var ids = {};
        var notices = r.notices.slice(0, MAX_NOTICES).map(function (n) { return normalizeNotice(n, opts); }).filter(function (n) {
            if (!n || ids[n.id] || (n.ends && Date.parse(n.ends) <= now)) return false;
            ids[n.id] = true;
            return true;
        });
        return { sequence: r.sequence, generated: typeof r.generated === "string" ? r.generated : null, expires: r.expires, notices: notices };
    });
}

// Is the notice for this device now? device: {channel, compatible, build,
// locale ("en-US")}, each optional: a notice that asks for a field the
// device does not know is not for it.
function matches(n, device, now) {
    var t = (now || new Date()).getTime(), d = device || {}, a = n.audience || {};
    if (n.starts && Date.parse(n.starts) > t) return false;
    if (n.ends && Date.parse(n.ends) <= t) return false;
    if (a.channels && a.channels.length && a.channels.indexOf(d.channel) < 0) return false;
    if (a.compatible && a.compatible.length && a.compatible.indexOf(d.compatible) < 0) return false;
    var hasBuild = typeof d.build === "number";
    if (typeof a.minBuild === "number" && (!hasBuild || d.build < a.minBuild)) return false;
    if (typeof a.maxBuild === "number" && (!hasBuild || d.build > a.maxBuild)) return false;
    if (a.locales && a.locales.length) {
        if (typeof d.locale !== "string" || !d.locale) return false;
        var loc = normLocale(d.locale), lang = loc.split("-")[0];
        if (a.locales.indexOf(loc) < 0 && a.locales.indexOf(lang) < 0) return false;
    }
    return true;
}

// The notices for this device now, in the feed's order.
function active(notices, device, now) {
    return (notices || []).filter(function (n) { return matches(n, device, now); });
}

module.exports = { FORMAT: FORMAT, MAX_BYTES: MAX_BYTES, MAX_NOTICES: MAX_NOTICES, TITLE_MAX: TITLE_MAX, BODY_MAX: BODY_MAX,
                   SEVERITIES: SEVERITIES, APPS: APPS, plain: plain, originsOf: originsOf, actionOf: actionOf,
                   normalizeNotice: normalizeNotice, verify: verify, matches: matches, active: active };
