// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Errors -> the codes the accounts library shows
// (third_party/enyo-1.0/framework/lib/accounts/source/errors.js lines
// 5-29: "401_UNAUTHORIZED", "HOST_NOT_FOUND", ...). A transport's
// validator answers {returnValue: false, errorCode} with one of them, and
// its sync state (syncstate.js) keeps one: "401_UNAUTHORIZED" puts the
// warning on the account in Accounts (accounts-list.js line 138).
// Extracted from apps/dav/service/davservice.js.
//
// The original list has no code for HTTP 429 ("too many requests"):
// it maps to "503_SERVICE_UNAVAILABLE" ("Server unavailable"), and the
// error keeps retryAt (ms since the epoch) for the kit's backoff (http.js).

"use strict";

// A thrown error -> an error code the Accounts app can show.
function errorCodeOf(e) {
    var code = e && (e.errorCode || e.code);
    if (e && e.status === 401) return "401_UNAUTHORIZED";
    if (e && (e.status === 429 || e.status === 503)) return "503_SERVICE_UNAVAILABLE";
    switch (code) {
    case "401_UNAUTHORIZED": case "503_SERVICE_UNAVAILABLE": case "UNSUPPORTED_CAPABILITY": case "400_BAD_REQUEST":
    case "HOST_NOT_FOUND": case "CONNECTION_FAILED": case "CONNECTION_TIMEOUT": case "CREDENTIALS_NOT_FOUND":
    case "INVALID_USER":
        return code;
    case "ENOTFOUND": case "EAI_AGAIN": return "HOST_NOT_FOUND";
    case "ECONNREFUSED": case "ECONNRESET": case "EHOSTUNREACH": case "ENETUNREACH": return "CONNECTION_FAILED";
    case "ETIMEDOUT": return "CONNECTION_TIMEOUT";
    case "CERT_HAS_EXPIRED": return "SSL_CERT_EXPIRED";
    case "DEPTH_ZERO_SELF_SIGNED_CERT": case "SELF_SIGNED_CERT_IN_CHAIN": case "UNABLE_TO_VERIFY_LEAF_SIGNATURE": return "SSL_CERT_UNTRUSTED";
    case "ERR_TLS_CERT_ALTNAME_INVALID": return "SSL_CERT_HOSTNAME_MISMATCH";
    case "NO_DAV_SERVICE": return "UNSUPPORTED_CAPABILITY";
    case "BAD_SERVER": return "400_BAD_REQUEST";
    }
    // A code the transport chose itself (its sign-in page knows it).
    if (e && typeof e.errorCode === "string" && /^[A-Z0-9_]+$/.test(e.errorCode)) return e.errorCode;
    if (e && e.status >= 500) return "500_SERVER_ERROR";
    if (e && e.status >= 400) return "400_BAD_REQUEST";
    if (e && /timed out/i.test(e.message || "")) return "CONNECTION_TIMEOUT";
    return "UNKNOWN_ERROR";
}

// {returnValue: false, errorCode, errorText} for a Luna reply.
function fail(e) {
    var r = { returnValue: false, errorCode: errorCodeOf(e), errorText: String(e && e.message || e) };
    if (e && e.retryAt) r.retryAt = e.retryAt;
    return r;
}

// An Error with an error code (and an HTTP status, if any).
function syncError(message, errorCode, status) {
    var e = new Error(message);
    if (errorCode) e.errorCode = errorCode;
    if (status) e.status = status;
    return e;
}

module.exports = { errorCodeOf: errorCodeOf, fail: fail, syncError: syncError };
