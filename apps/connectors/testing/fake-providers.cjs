// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Every provider's stand-in on one local server (tests only): for the
// Chromium tests (tools/test-connectors.cjs) and for trying the connectors
// in the simulator without the internet or Phoenix's registrations.
//
//   const fake = await createFakeProviders({autoApprove}).start(0);
//   fake.systemConfig()   {"<pkg>/clients.json": {...}} for every connector:
//                         the image's settings that point the connectors here
//   fake.todoist, fake.bluesky, ...   each stand-in's state (todoist.cjs, ...)
//
//   node apps/connectors/testing/fake-providers.cjs [port]
//       starts it and prints the settings, to put in the simulator's store
//       (localStorage "phoenix:systemConfig:<name>", docs/DEVELOPER-APPS.md)

"use strict";

const { createFakeBase } = require("./fake-base.cjs");
const PROVIDERS = {
    todoist: { file: "todoist/clients.json", add: () => require("./todoist.cjs").addTodoist },
    bluesky: { file: "bluesky/clients.json", add: () => require("./bluesky.cjs").addBluesky },
    microsoft: { file: "microsoft/clients.json", add: () => require("./graph.cjs").addGraph },
    google: { file: "google/clients.json", add: () => require("./google.cjs").addGoogle }
};

function createFakeProviders(options) {
    options = options || {};
    const base = createFakeBase(options);
    const names = Object.keys(PROVIDERS).filter((n) => !options.only || options.only.includes(n));
    names.forEach((n) => { base[n] = PROVIDERS[n].add()(base, options[n] || {}); });
    // The image's settings for the connectors: oauth names the providers whose registration the build has.
    base.systemConfig = (oauth) => {
        const out = {};
        names.forEach((n) => {
            const s = base[n];
            if (!s || typeof s.clients !== "function") return;
            const withClient = !oauth || oauth.includes(n);
            const c = s.clients(withClient);
            if (!withClient) Object.keys(c).forEach((k) => { ["clientId", "clientSecret", "authorizationEndpoint", "tokenEndpoint", "revocationEndpoint", "redirectUri"].forEach((x) => delete c[k][x]); });
            out[PROVIDERS[n].file] = c;
        });
        return out;
    };
    return base;
}

module.exports = { createFakeProviders, PROVIDERS };

if (require.main === module) {
    createFakeProviders().start(Number(process.argv[2]) || 8098).then((f) => {
        console.log("Stand-ins for " + Object.keys(PROVIDERS).join(", ") + " at " + f.origin);
        const cfg = f.systemConfig();
        Object.keys(cfg).forEach((name) => {
            console.log("localStorage.setItem(" + JSON.stringify("phoenix:systemConfig:" + name) + ", " + JSON.stringify(JSON.stringify(cfg[name])) + ");");
        });
        if (f.todoist) console.log("Todoist API token: " + f.todoist.token);
        if (f.bluesky) console.log("Bluesky: " + f.bluesky.handle + ", app password " + f.bluesky.appPassword);
    });
}
