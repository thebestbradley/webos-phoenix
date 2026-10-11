// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Sign In card: how an OAuth sign-in shows the provider's page on a
// device (docs/SYNERGY-CONNECTORS.md 4.1, "a system browser sheet"; the
// owner's design, 11 October 2026: a system card rather than a sheet,
// since WebAppMgr has no web view to put in one, OPEN-QUESTIONS Q38).
//
// The original showed an account's sign-in inside Accounts: the
// template's validator.customUI page in a cross-app iframe
// (enyo-1.0 lib/accounts/source/entry-add.js:55-56, cross-app.js:17-26,
// palm/system/CrossAppUI.js), and a page that needed the provider's site
// put it in an embedded browser view (enyo.BasicWebView, an
// application/x-palm-browser object, palm/controls/BasicWebView.js:92),
// which the connector's page could script. Phoenix's simulator still has
// that look (the share sheet's "signin" page over the card, the provider's
// page in a web view the asking page cannot read). On a device the
// provider's page is the whole of a card of its own,
// org.webosphoenix.signin, which WebAppMgr loads like any web app's page:
//
//   1. show(url, redirectUri, pending) launches the card through the
//      application manager with only {session} (the address never travels
//      in launch params, which other apps may see); the card's page asks
//      pending(session) for the address and goes there (apps/signin);
//   2. the shell draws the card's bar (the provider's host, a lock for
//      https, Cancel) from what this service tells it (bar(info)), never
//      from the page: a page cannot draw a convincing address over itself;
//   3. it ends when the redirect arrives (pending.result: the loopback
//      listener, loopback.js), when the card closes (Cancel, a swipe:
//      appClosed(), from the application manager's life events), or after
//      timeoutMs (errorCode "TIMEOUT"). The card is closed in every case.
//
// A second sign-in while one is open replaces it, as a second sheet did:
// the first answers null (canceled), its card is closed and the new one
// launched once the old has gone (closing and launching the same app at
// once would let the old card's close event end the new sign-in; the same
// after a sign-in that ended by itself).
//
// createSignInCard({launch(params) -> Promise, close() -> Promise,
// bar(info | null), randomId(), appId, timeoutMs, setTimeout,
// clearTimeout, log}) -> {show, appClosed, pending, current}.

"use strict";

var APP_ID = "org.webosphoenix.signin";
var TIMEOUT_MS = 10 * 60 * 1000;
// How long a replaced card may take to go before the next is launched anyway.
var CLOSE_WAIT_MS = 3000;

function hostOf(url) {
    var m = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@\/?#]*@)?([^\/?#]+)/i.exec(String(url || ""));
    return m ? { host: m[2].toLowerCase(), secure: m[1].toLowerCase() === "https" } : { host: "", secure: false };
}

function createSignInCard(o) {
    var appId = o.appId || APP_ID;
    var timeoutMs = o.timeoutMs || TIMEOUT_MS;
    var setT = o.setTimeout || setTimeout, clearT = o.clearTimeout || clearTimeout;
    var log = o.log || function () {};
    var bar = o.bar || function () {};
    var current = null;     // {session, url, finish}
    var closing = null;     // {resolve, done}: a card this service closed, on its way out

    // The card this service closes: its close event is that one's, not the
    // next sign-in's; the next card is launched once it has come (or after
    // CLOSE_WAIT_MS: a card already gone sends none).
    function closeCard() {
        var c = { resolve: null };
        c.done = new Promise(function (resolve) {
            var t = setT(function () { if (closing === c) closing = null; resolve(); }, CLOSE_WAIT_MS);
            c.resolve = function () { clearT(t); if (closing === c) closing = null; resolve(); };
        });
        closing = c;
        Promise.resolve().then(o.close).catch(function (e) { log("the card did not close: " + (e && e.message)); });
    }

    function show(url, redirectUri, pending) {
        if (current) {
            log("a new sign-in replaces the open one");
            current.finish(null);
        }
        var before = closing ? closing.done : Promise.resolve();
        return before.then(function () {
            return new Promise(function (resolve, reject) {
                var session = o.randomId();
                var timer = null;
                var me = {
                    session: session, url: url, redirectUri: redirectUri,
                    finish: function (back, error, closed) {
                        if (current !== me) return;
                        current = null;
                        if (timer !== null) clearT(timer);
                        bar(null);
                        // The card goes, unless it is what ended the sign-in.
                        if (!closed) closeCard();
                        if (error) reject(error); else resolve(back);
                    }
                };
                current = me;
                timer = setT(function () {
                    me.finish(null, Object.assign(new Error("The sign-in took too long"), { errorCode: "TIMEOUT" }));
                }, timeoutMs);
                if (pending && pending.result) {
                    pending.result.then(function (back) { if (back) me.finish(back); });
                }
                var h = hostOf(url);
                bar({ appId: appId, session: session, host: h.host, secure: h.secure });
                Promise.resolve(o.launch({ session: session })).then(function (r) {
                    if (r && r.returnValue === false) throw new Error(r.errorText || "The application manager did not launch " + appId);
                }).catch(function (e) {
                    me.finish(null, Object.assign(new Error("The Sign In card did not open: " + (e && e.message || e)), { errorCode: "UNSUPPORTED" }));
                });
            });
        });
    }

    // The card closed (the application manager's "close" or "stop" for it).
    function appClosed() {
        if (closing) { closing.resolve(); return; }
        if (current) current.finish(null, null, true);
    }

    // The card's page asks for the address it is to show.
    function pendingFor(p, caller) {
        if (caller !== appId)
            return Promise.resolve({ returnValue: false, errorCode: "PERMISSION_DENIED", errorText: "Only the Sign In card asks for this" });
        if (!current || !p || p.session !== current.session)
            return Promise.resolve({ returnValue: false, errorCode: "NOT_FOUND", errorText: "No such sign-in (it has ended)" });
        var h = hostOf(current.url);
        return Promise.resolve({ returnValue: true, url: current.url, host: h.host, secure: h.secure });
    }

    return {
        show: show, appClosed: appClosed, pending: pendingFor,
        current: function () { return current ? { session: current.session, url: current.url } : null; },
        appId: appId
    };
}

module.exports = { createSignInCard: createSignInCard, hostOf: hostOf, APP_ID: APP_ID, TIMEOUT_MS: TIMEOUT_MS };
