// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device API's conventions on the client side (PLATFORM.md 5;
// docs/platform-api/openapi.yaml): JSON bodies, errors as
// {"error": text, "code": MACHINE_CODE, "details"?} with the HTTP status,
// 429 and 503 with Retry-After, and the backoff a device keeps between
// attempts at a feed or the API when the server is away.

"use strict";

function err(code, text, extra) {
    var e = new Error(text);
    e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
}

function header(res, name) {
    var h = (res && res.headers) || {};
    var want = name.toLowerCase();
    var found = null;
    Object.keys(h).forEach(function (k) { if (k.toLowerCase() === want) found = h[k]; });
    return Array.isArray(found) ? found[0] : found;
}

// Retry-After: seconds or an HTTP date -> milliseconds (0: none).
function retryAfter(res, now) {
    var v = header(res, "Retry-After");
    if (v === null || v === undefined || v === "") return 0;
    if (/^\d+$/.test(String(v).trim())) return parseInt(v, 10) * 1000;
    var t = Date.parse(String(v));
    return isNaN(t) ? 0 : Math.max(0, t - (now || Date.now()));
}

// A status and body that are not a success -> the Error a service replies
// with: errorCode from the server's "code" (else by status), errorText the
// server's sentence.
function apiError(res, what, now) {
    var body = null;
    try { body = typeof res.body === "string" ? JSON.parse(res.body) : res.body; } catch (e) { body = null; }
    var text = body && typeof body.error === "string" ? body.error : (what || "The server") + " answered " + res.status;
    var byStatus = res.status === 401 ? "UNAUTHORIZED" : res.status === 403 ? "FORBIDDEN" : res.status === 404 ? "NOT_FOUND"
        : res.status === 409 ? "CONFLICT" : res.status === 413 ? "TOO_LARGE" : res.status === 422 || res.status === 400 ? "BAD_REQUEST"
        : res.status === 429 ? "RATE_LIMITED" : res.status === 507 ? "QUOTA" : res.status >= 500 ? "SERVER_ERROR" : "BAD_SERVER";
    var code = body && typeof body.code === "string" && /^[A-Z][A-Z0-9_]*$/.test(body.code) ? body.code : byStatus;
    return err(code, text, { status: res.status, details: body && body.details || null, retryAfter: retryAfter(res, now) });
}

// Exponential backoff for repeated failures: 1 min, 2, 4 ... capped at
// 6 hours, with up to 20% jitter (random() injected), never below the
// server's Retry-After.
function backoff(failures, retryAfterMs, random) {
    var n = Math.max(0, Math.min(16, failures | 0));
    var ms = Math.min(6 * 3600 * 1000, 60000 * Math.pow(2, n));
    ms = ms + Math.floor(ms * 0.2 * (random ? random() : 0));
    return Math.max(ms, retryAfterMs || 0);
}

function json(res, what) {
    try { return typeof res.body === "string" ? JSON.parse(res.body) : res.body; }
    catch (e) { throw err("BAD_SERVER", (what || "The server") + " did not answer JSON"); }
}

module.exports = { header: header, retryAfter: retryAfter, apiError: apiError, backoff: backoff, json: json };
