// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the page views (enyo.WebView's BrowserAdapter stand-in,
// WebAppWindow.qml) share across the simulator's windows, and the rules
// the tests (tst_pageviews.qml) check:
//
//   - pages a page opened (a link with a target, window.open) that wait
//     for their card: BrowserAdapter asked the app for a new card
//     (createPage(identifier), enyo BasicWebView.js:459 -> isis-browser
//     Browser.js:331 openNewCardWithIdentifier), whose page view then
//     connected with that identifier (Browser.js:121 setIdentifier,
//     BasicWebView.js:158 setPageIdentifier) and showed the new page;
//   - the hosts whose certificate the user let through (Trust Once, Trust
//     Always): Chromium keeps the exception for the profile's life and
//     asks no more, and their pages are not secure (no padlock);
//   - BrowserServer's certificate error codes for the browser's dialog.

.pragma library

// identifier -> the parked view (a WebEngineView the new page was opened in).
var _parked = {};
var _next = 1;

function park(view) {
    var id = "phoenix-page-" + (_next++);
    _parked[id] = view;
    return id;
}

// The parked view for identifier, once; null when there is none (or the
// card that parked it is gone, and the view with it).
function take(id) {
    var v = _parked[id];
    delete _parked[id];
    try {
        return v && v.viewId !== undefined ? v : null;
    } catch (e) {
        return null;
    }
}

// The host of an http(s) address, lower case, with its port; "" otherwise.
function hostOf(url) {
    var m = /^https?:\/\/(?:[^@\/?#]*@)?([^\/?#]+)/i.exec(String(url));
    return m ? m[1].toLowerCase() : "";
}

// Hosts let through, per profile (the private one apart).
var _allowed = { normal: {}, "private": {} };

function allow(privateMode, host) {
    if (host)
        _allowed[privateMode ? "private" : "normal"][host] = true;
}

function allowed(privateMode, host) {
    return !!host && _allowed[privateMode ? "private" : "normal"][host] === true;
}

// A page is secure: https, and its host's certificate was not let through.
function secure(url, privateMode) {
    return /^https:/i.test(String(url)) && !allowed(privateMode, hostOf(url));
}

// Qt WebEngine's certificate error type (WebEngineCertificateError.type)
// as the code BrowserServer gave the browser's SSL dialog, OpenSSL's
// X509_V_ERR_* (x509_vfy.h), whose ranges isis-browser words
// (Browser.js:252-268): 0 its own "expired", 2-4 "didn't send a
// certificate", 5-9 "could not be read completely", 10-17 "invalid
// information", 18-23 "questionable signatures", 24-29 "invalid", 30, 31
// and 50 "inconsistent information".
//   CommonNameInvalid (-200)    50 X509_V_ERR_APPLICATION_VERIFICATION (the
//                                  host is not the certificate's)
//   DateInvalid (-201)           0 expired (or not yet valid)
//   AuthorityInvalid (-202)     18 X509_V_ERR_DEPTH_ZERO_SELF_SIGNED_CERT
//   NoRevocationMechanism,
//   UnableToCheckRevocation,
//   Revoked (-204..-206)        23 X509_V_ERR_CERT_REVOKED
//   ContainsErrors (-203),
//   Invalid (-207), and others  24 X509_V_ERR_INVALID_CA
function sslCode(type) {
    switch (type) {
    case -200: return 50;
    case -201: return 0;
    case -202: return 18;
    case -204: case -205: case -206: return 23;
    default: return 24;
    }
}
