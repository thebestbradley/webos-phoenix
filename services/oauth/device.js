// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.oauth's pieces on a device, put together around
// oauthservice.js: the sealed key store (keystore.js), the loopback
// redirect (loopback.js) and the Sign In card (signincard.js). service.js
// gives it the bus; the tests give it fakes of the bus and run the rest for
// real (services/oauth/oauth.test.ts, tools/test-signin-card.cjs).
//
//   createDeviceOAuth({
//       request,                    HTTP for the token and revocation calls
//       fs, path, crypto, http,     Node's
//       dir,                        the key store's folder
//       launchCard(params), closeCard()  the application manager's launch
//                                   and closeByAppId of the card -> Promise
//       bar(info | null),           the card's bar for the shell
//       mayWipe(caller), fixedPort, timeoutMs, log })
//     -> {methods, card, keystore}
//   methods: oauthservice.js's, by name, (params, caller) -> Promise<reply>;
//   card.appClosed(): call it when the application manager says the card
//   closed.
//
// Redirects: a sign-in's redirect must be the loopback address, with this
// service's path; without a port (http://127.0.0.1/oauth/callback) the
// listener takes an ephemeral one and the sign-in uses it, for providers
// that match loopback redirects on any port (RFC 8252 7.3, 8.4: Google's
// desktop clients, Microsoft Entra, Mastodon's Doorkeeper since 5.2,
// Bluesky's atproto OAuth); with one (fixedRedirectUri, FIXED_PORT) it
// listens there, for providers that match exactly (Dropbox, Box, and any
// server not known to match loosely: docs/DEVELOPER-APPS.md).

"use strict";

var oauth = require("./oauthservice");
var loopbackLib = require("./loopback");
var cardLib = require("./signincard");
var keystoreLib = require("./keystore");

// The fixed port, for providers that need the exact redirect registered.
// In the dynamic range (RFC 6335 6), and only open while a sign-in waits.
var FIXED_PORT = 47613;

function createDeviceOAuth(o) {
    var log = o.log || function () {};
    var fixedPort = o.fixedPort || FIXED_PORT;
    var keystore = o.keystore || keystoreLib.createFileKeyStore({ fs: o.fs, crypto: o.crypto, path: o.path, dir: o.dir, log: log });
    var loopback = loopbackLib.createLoopback({ http: o.http, log: log });
    var card = cardLib.createSignInCard({
        launch: o.launchCard, close: o.closeCard, bar: o.bar,
        randomId: function () { return oauth.b64url(new Uint8Array(o.crypto.randomBytes(12))); },
        timeoutMs: o.timeoutMs, log: log
    });

    var methods = oauth.createOAuthService({
        request: o.request,
        keystore: keystore,
        redirect: function (requested, opts) {
            if (!loopbackLib.isLoopback(requested))
                return Promise.reject(Object.assign(new Error("A sign-in on this device comes back to " + loopbackLib.HOST + loopbackLib.PATH +
                                                              " (RFC 8252 7.3), not " + requested), { errorCode: "BAD_PARAMS" }));
            return loopback.open({ port: loopbackLib.portOf(requested), state: opts && opts.state });
        },
        sheet: function (url, redirectUri, pending) { return card.show(url, redirectUri, pending); },
        card: card,
        crypto: {
            randomBytes: function (n) { return new Uint8Array(o.crypto.randomBytes(n)); },
            sha256: function (bytes) { return Promise.resolve(new Uint8Array(o.crypto.createHash("sha256").update(Buffer.from(bytes)).digest())); }
        },
        redirectUri: "http://" + loopbackLib.HOST + loopbackLib.PATH,
        fixedRedirectUri: "http://" + loopbackLib.HOST + ":" + fixedPort + loopbackLib.PATH,
        mayActFor: o.mayActFor,
        mayWipe: o.mayWipe || function () { return false; },
        now: o.now,
        log: log
    });

    return { methods: methods, card: card, keystore: keystore, FIXED_PORT: fixedPort };
}

module.exports = { createDeviceOAuth: createDeviceOAuth, FIXED_PORT: FIXED_PORT, SIGNIN_APP: cardLib.APP_ID };
