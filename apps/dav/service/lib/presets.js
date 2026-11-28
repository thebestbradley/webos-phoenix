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
// The hosts of a preset can be changed by the image, or a test, without a
// new build: /etc/palm/dav/presets.json {"<templateId>": {"carddav", "caldav"}}
// (the simulator: its store "systemConfig:dav/presets.json", as the
// connectors' settings, docs/DEVELOPER-APPS.md).

"use strict";

var PRESETS = {
    "com.webosphoenix.icloud": {
        name: "iCloud",
        services: { carddav: "https://contacts.icloud.com/", caldav: "https://caldav.icloud.com/" },
        providers: { CONTACTS: "com.webosphoenix.icloud.contacts", CALENDAR: "com.webosphoenix.icloud.calendar" }
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
    return { templateId: templateId, name: p.name, services: services, providers: Object.assign({}, p.providers) };
}

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
