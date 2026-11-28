// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Account presets of the CardDAV / CalDAV transport: a provider's own
// account type (its template in apps/dav/public/accounts/<templateId>/)
// whose servers are fixed, so its sign-in page asks only for a user name
// and a password. The sync is the transport's own (lib/sync.js,
// lib/davclient.js); a preset only names the hosts and its capability
// providers. This is how webOS did provider accounts: one transport, one
// template per provider (the original release's mail templates,
// com.palm.imap and com.palm.othermail, share mojomail's IMAP transport the
// same way; third_party/app-services/mojomail/imap/files/usr/palm/public/accounts).
//
// iCloud (com.webosphoenix.icloud): contacts over CardDAV at
// contacts.icloud.com and calendars over CalDAV at caldav.icloud.com, both
// signed in to with the Apple Account's email address and an app-specific
// password (Apple: "Sign in to apps with your Apple Account using
// app-specific passwords", support.apple.com/102654: made at
// account.apple.com, Sign-In and Security, App-Specific Passwords; two-factor
// authentication must be on; the account's own password is refused by
// apps that are not Apple's). Each host answers current-user-principal
// with /<dsid>/principal/ and the principal's home sets are on the
// account's partition (https://pNN-contacts.icloud.com:443/<dsid>/carddavhome/,
// https://pNN-caldav.icloud.com:443/<dsid>/calendars/), which davclient
// follows. Apple does not document its CalDAV and CardDAV servers; this is
// what DAVx5 (davx5.com/tested-with/icloud) and other clients report, and
// what tools/test-icloud-sync.cjs's stand-in does (apps/dav/service/test/icloud.cjs).
//
// Only the provider's hosts are reached: discovery, redirects and the home
// sets may lead to any host of its domain (*.icloud.com), and nowhere
// else, so the app-specific password is never sent to another host.
// iCloud in mainland China is run apart, by GCBD (Apple's iCloud terms
// for China mainland), on hosts of its own (*.icloud.com.cn); this preset does not know them, so an account of it that iCloud sends
// there is told so at once (REGION_NOT_SUPPORTED) instead of a long wait
// on hosts nobody tried it with.
//
// The hosts of a preset can be changed by the image, or a test, without a
// new build: /etc/palm/dav/presets.json {"<templateId>": {"carddav", "caldav"}}
// (the simulator: its store "systemConfig:dav/presets.json", as the
// connectors' settings, docs/DEVELOPER-APPS.md).

"use strict";

var PRESETS = {
    "com.webosphoenix.icloud": {
        name: "iCloud",
        services: { carddav: "https://contacts.icloud.com/", caldav: "https://caldav.icloud.com/" },
        providers: { CONTACTS: "com.webosphoenix.icloud.contacts", CALENDAR: "com.webosphoenix.icloud.calendar" },
        domains: ["icloud.com"],
        unsupported: [{
            domains: ["icloud.com.cn"], errorCode: "REGION_NOT_SUPPORTED",
            text: "iCloud accounts of mainland China (iCloud operated by GCBD) are not supported yet: their contacts and " +
                  "calendars are on other servers, which this device does not know."
        }],
        // The validator's answer to a 401: iCloud answers the Apple Account's
        // own password like a wrong one (and an account without two-factor
        // authentication has no other).
        signInRefused: "iCloud did not accept this email address and password. Use an app-specific password made at " +
            "account.apple.com (Sign-In and Security, App-Specific Passwords; two-factor authentication must be on), " +
            "not your Apple Account's own password.",
        // A sync's: the password worked before.
        passwordRefused: "iCloud no longer accepts this account's app-specific password: it may have been revoked at " +
            "account.apple.com, or the Apple Account's password changed (which revokes them all). Make a new " +
            "app-specific password and sign in again."
    }
};

var CONFIG_FILE = "dav/presets.json";

// The preset of a template, with the image's hosts if it names any; null
// for a template that is not a preset (com.webosphoenix.dav: the server
// the user enters).
function presetFor(templateId, overrides) {
    var p = PRESETS[templateId];
    if (!p) return null;
    var services = Object.assign({}, p.services);
    var o = overrides && overrides[templateId];
    if (o && typeof o === "object") {
        Object.keys(services).forEach(function (k) {
            if (typeof o[k] === "string" && /^https?:\/\//.test(o[k])) services[k] = o[k];
        });
    }
    // Hosts of the domains, and the image's own hosts (whatever their port).
    var allowed = Object.keys(services).map(function (k) { return new URL(services[k]).hostname.toLowerCase(); })
        .filter(function (h) { return !(p.domains || []).some(function (d) { return inDomain(h, d); }); });
    function checkUrl(url) {
        var host = "";
        try { host = new URL(url).hostname.toLowerCase(); } catch (e) { /* refused below */ }
        var why = (p.unsupported || []).filter(function (u) { return u.domains.some(function (d) { return inDomain(host, d); }); })[0];
        var e;
        if (why) {
            e = new Error(why.text);
            e.errorCode = why.errorCode;
            throw e;
        }
        if (host && ((p.domains || []).some(function (d) { return inDomain(host, d); }) || allowed.indexOf(host) >= 0)) return;
        e = new Error(p.name + " sent this device to " + (host || url) + ", which is not one of its servers");
        e.errorCode = "400_BAD_REQUEST";
        e.code = "HOST_NOT_ALLOWED";
        throw e;
    }
    return { templateId: templateId, name: p.name, services: services, providers: Object.assign({}, p.providers),
             checkUrl: checkUrl, signInRefused: p.signInRefused, passwordRefused: p.passwordRefused };
}

function inDomain(host, domain) { return host === domain || host.slice(-(domain.length + 1)) === "." + domain; }

// Every preset's capability provider id -> its capability.
function providerCapabilities() {
    var out = {};
    Object.keys(PRESETS).forEach(function (t) {
        var providers = PRESETS[t].providers;
        Object.keys(providers).forEach(function (cap) { out[providers[cap]] = cap; });
    });
    return out;
}

module.exports = { PRESETS: PRESETS, CONFIG_FILE: CONFIG_FILE, presetFor: presetFor, providerCapabilities: providerCapabilities };
