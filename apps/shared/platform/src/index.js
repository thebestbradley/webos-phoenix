// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// @phoenix/platform: the device's side of the Phoenix platform
// (docs/PLATFORM-CLIENT.md). Every service that talks to the platform
// (com.palm.update, org.webosphoenix.service.packages,
// org.webosphoenix.hardware, org.webosphoenix.service.account) reads its
// addresses and keys through load() below.

"use strict";

var servers = require("./servers");
var signed = require("./signed");
var rollout = require("./rollout");
var revocations = require("./revocations");
var http = require("./http");
var b64 = require("./b64");
var ed25519 = require("./ed25519");

// The image's servers.json (/etc/palm/phoenix/servers.json), with Developer
// Mode's override over it when Developer Mode is on.
//   env.image() -> text | object | null
//   env.override() -> object | null   (/var/lib/phoenix/servers.override.json)
//   env.devMode() -> Promise<bool> | bool
// -> Promise<resolved servers> (servers.resolve). A broken image file
// counts as none: every server is then "not set up", and log() says why.
function load(env) {
    var image = null;
    try {
        var t = env.image();
        image = t === null || t === undefined ? null : servers.parse(t);
    } catch (e) {
        if (env.log) env.log("servers.json: " + e.message);
    }
    var over = null;
    try { over = env.override ? env.override() : null; } catch (e) { over = null; }
    var dm = over ? Promise.resolve(env.devMode ? env.devMode() : false).then(null, function () { return false; }) : Promise.resolve(false);
    return dm.then(function (on) { return servers.resolve(image, over, on); });
}

// The driver catalog's configuration (org.webosphoenix.hardware's
// catalog.json: {sources: [{id, name, url, key, revoked}], reportUrl}) with
// servers.json's "drivers" over its "phoenix" source: the address, the
// pinned key and the report address. A value servers.json does not set
// stays as catalog.json has it (the revoked keys always do).
function driverConfig(catalogJson, resolved) {
    var c = JSON.parse(JSON.stringify(catalogJson || {}));
    var d = resolved && resolved.drivers;
    if (!Array.isArray(c.sources)) c.sources = [];
    if (!d) return c;
    var src = c.sources.filter(function (x) { return x && x.id === "phoenix"; })[0];
    if (!src) {
        src = { id: "phoenix", name: "Phoenix Drivers", url: null, key: null, revoked: [] };
        c.sources.unshift(src);
    }
    if (d.url) src.url = d.url;
    if (d.key) src.key = d.key;
    if (d.reportUrl) c.reportUrl = d.reportUrl;
    return c;
}

module.exports = { load: load, driverConfig: driverConfig, servers: servers, signed: signed, rollout: rollout, revocations: revocations, http: http,
                   b64: b64, ed25519: ed25519 };
