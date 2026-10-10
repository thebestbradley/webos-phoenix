// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Account types in a Phoenix catalog (docs/SYNERGY-CONNECTORS.md, 2.1): the
// index's "accounts" array, one entry per account template Phoenix can
// connect to (Synergy), built in or from a connector package. An entry:
//
//   {templateId, title, provider, icon, summary,
//    capabilities: [{capability, direction?}], protocols: [...],
//    auth: {type, registration}, server, privacy: {dataGoesTo, e2ee,
//    phoenixServers}, push, status, package: {id, builtin}, help?, signUp?,
//    featured?}
//
// signUp: where a person without an account gets one (an https page; the
// account type's page offers "Don't have an account? Sign up").
//
// Read loosely: an entry without a usable templateId is left out, a field
// that is not what it should be is dropped or given its plain default, so a
// newer catalog's additions do not hide the rest. An index without
// "accounts" (before C0) has none.

"use strict";

var AUTH = ["password", "app-password", "oauth", "api-key", "none"];
var REGISTRATION = ["none", "required"];
var SERVER = ["user", "fixed", "discovered"];
var PHOENIX_SERVERS = ["none", "push-relay", "token-relay"];
var PUSH = ["poll", "unifiedpush", "relay"];
var STATUS = ["stable", "beta", "experimental"];

function str(v, max) { return typeof v === "string" ? v.slice(0, max || 4000) : ""; }
function oneOf(v, list, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }
function httpUrl(v) { return typeof v === "string" && /^https?:\/\//i.test(v) ? v : ""; }
function httpsUrl(v) { return typeof v === "string" && v.length <= 500 && /^https:\/\/[^\s\/?#]+[^\s]*$/i.test(v) ? v : ""; }

// An icon: an address relative to the index (base) or absolute; or, as the
// draft feed has it, {"48": ..., "96": ...}: the largest.
function iconUrl(v, base) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
        var sizes = Object.keys(v).filter(function (k) { return typeof v[k] === "string"; })
            .sort(function (a, b) { return (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0); });
        v = sizes.length ? v[sizes[0]] : "";
    }
    if (typeof v !== "string" || !v) return "";
    try {
        var u = base ? new URL(v, base) : new URL(v);
        return /^https?:$/.test(u.protocol) ? u.href : "";
    } catch (e) { return ""; }
}

function capabilities(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    return list.map(function (c) {
        var name = typeof c === "string" ? c : c && c.capability;
        if (typeof name !== "string" || !/^[A-Z][A-Z0-9_.]*$/.test(name) || seen[name]) return null;
        seen[name] = true;
        var out = { capability: name };
        if (c && typeof c.direction === "string" && c.direction) out.direction = c.direction.slice(0, 20);
        return out;
    }).filter(Boolean).slice(0, 12);
}

// One entry as the client uses it; null when it is not usable.
function normalize(e, base, sourceId) {
    if (!e || typeof e.templateId !== "string" || !/^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$/.test(e.templateId)) return null;
    var auth = e.auth && typeof e.auth === "object" ? e.auth : {};
    var privacy = e.privacy && typeof e.privacy === "object" ? e.privacy : null;
    var pkg = e.package && typeof e.package === "object" ? e.package : {};
    return {
        templateId: e.templateId, sourceId: sourceId || "",
        title: str(e.title, 80) || e.templateId, provider: str(e.provider, 80),
        icon: iconUrl(e.icon, base), summary: str(e.summary, 300),
        capabilities: capabilities(e.capabilities),
        protocols: Array.isArray(e.protocols) ? e.protocols.filter(function (p) { return typeof p === "string"; }).map(function (p) { return p.slice(0, 40); }).slice(0, 12) : [],
        auth: { type: oneOf(auth.type, AUTH, ""), registration: oneOf(auth.registration, REGISTRATION, "none") },
        server: oneOf(e.server, SERVER, ""),
        privacy: privacy ? { dataGoesTo: str(privacy.dataGoesTo, 200), e2ee: privacy.e2ee === true,
                             phoenixServers: oneOf(privacy.phoenixServers, PHOENIX_SERVERS, "") } : null,
        push: oneOf(e.push, PUSH, "poll"),
        status: oneOf(e.status, STATUS, "stable"),
        package: { id: str(pkg.id, 120), builtin: pkg.builtin === true },
        help: httpUrl(e.help),
        signUp: httpsUrl(e.signUp),
        featured: e.featured === true
    };
}

// The index's "accounts" -> its usable entries, each template once.
function normalizeList(list, base, sourceId) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    return list.map(function (e) { return normalize(e, base, sourceId); }).filter(function (e) {
        if (!e || seen[e.templateId]) return false;
        seen[e.templateId] = true;
        return true;
    });
}

// Whether an account type has any of the capabilities (the original
// template names, as listAccountTemplates {capability} filters).
function hasCapability(t, caps) {
    if (!caps || !caps.length) return true;
    return t.capabilities.some(function (c) { return caps.indexOf(c.capability) >= 0; });
}

// Search: every word in its title, provider, capabilities or protocols.
function matches(t, terms) {
    var hay = [t.title, t.provider].concat(t.capabilities.map(function (c) { return c.capability; }), t.protocols).join(" ").toLowerCase();
    return terms.length > 0 && terms.every(function (w) { return hay.indexOf(w) >= 0; });
}

module.exports = { normalize: normalize, normalizeList: normalizeList, iconUrl: iconUrl, hasCapability: hasCapability, matches: matches };
