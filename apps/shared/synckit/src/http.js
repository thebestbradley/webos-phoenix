// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An HTTP client for transports over a request() function ({method, url,
// headers, body, binary?} -> Promise<{status, headers, body | bytes}>:
// node-http.js on a device, the simulator's proxy, a fake server in tests)
// with what docs/SYNERGY-CONNECTORS.md 3.2 rule 8 and SYNERGY-MODERN.md 4.2
// ask of every transport:
//
//   - only the hosts allowed: the template's `hosts` and the server the user
//     entered (allowHost); anything else is refused before it is sent;
//   - backoff on 429 and 503, honouring Retry-After (seconds or an HTTP
//     date, RFC 9110 10.2.3): a short wait (up to maxWaitMs, 30 s) is waited
//     out and the request tried once more; a longer one ends the sync with a
//     rate-limit error whose retryAt the caller keeps, and every request
//     before that time fails at once without reaching the server
//     (backoff.retryAt, which the connector kit keeps per account);
//   - exponential retries (0.5 s, 1 s, ...) for network errors and 502 / 504;
//   - a timeout per request (timeoutMs, 60 s), by Promise.race on top of the
//     request's own.
//
//   createHttp({request, hosts?: [pattern], backoff?: {retryAt}, maxWaitMs?, retries?,
//               timeoutMs?, now?, sleep?, log?, userAgent?}) -> {
//     request(req)         -> the response, any status
//     json(req)            -> the parsed body; throws {status, body} for >= 400
//     allowHost(host)      -> adds a host to `hosts` (the user's server, once known)
//   }
//
// hosts: "example.social", "*.example.social" or "*"; without hosts any
// host may be reached.

"use strict";

var errors = require("./errors");

function retryAfterMs(value, now) {
    if (value === undefined || value === null || value === "") return null;
    var s = String(value).trim();
    if (/^\d+$/.test(s)) return Number(s) * 1000;
    var t = Date.parse(s);
    return isNaN(t) ? null : Math.max(0, t - now);
}

function hostOf(url) {
    try { return new URL(url).host.toLowerCase(); } catch (e) { return ""; }
}

// "example.social", "*.example.social" (any subdomain) or "*" (any).
function hostMatches(pattern, host) {
    pattern = String(pattern).toLowerCase();
    if (pattern === "*") return true;
    if (pattern.indexOf("*.") === 0) return host === pattern.slice(2) || host.slice(-(pattern.length - 1)) === pattern.slice(1);
    return host === pattern;
}

function createHttp(options) {
    var request = options.request;
    var log = options.log || function () {};
    var now = options.now || function () { return Date.now(); };
    var sleep = options.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var maxWaitMs = options.maxWaitMs === undefined ? 30000 : options.maxWaitMs;
    var retries = options.retries === undefined ? 2 : options.retries;
    var timeoutMs = options.timeoutMs || 60000;
    var backoff = options.backoff || { retryAt: 0 };
    var hosts = (options.hosts || []).slice();

    function allowed(url) {
        if (!options.hosts) return true;     // no list: any host (the DAV client's server is the user's)
        var h = hostOf(url);
        if (!h) return false;
        return hosts.some(function (p) { return hostMatches(p, h); });
    }

    function once(req) {
        var timer;
        var limit = new Promise(function (resolve, reject) {
            timer = setTimeout(function () {
                var e = new Error("request timed out: " + req.method + " " + req.url);
                e.code = "ETIMEDOUT";
                reject(e);
            }, req.timeoutMs || timeoutMs);
        });
        return Promise.race([Promise.resolve().then(function () { return request(req); }), limit])
            .then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
    }

    function rateLimited(res, until) {
        var e = errors.syncError("The server asked us to slow down (HTTP " + res.status + "); trying again after " +
                                 new Date(until).toISOString(), "503_SERVICE_UNAVAILABLE", res.status);
        e.retryAt = until;
        return e;
    }

    function send(req) {
        req = Object.assign({ method: "GET", headers: {} }, req);
        if (options.userAgent && !req.headers["User-Agent"]) req.headers["User-Agent"] = options.userAgent;
        if (!allowed(req.url)) {
            var bad = errors.syncError("Not a host this account may reach: " + hostOf(req.url), "400_BAD_REQUEST");
            bad.code = "HOST_NOT_ALLOWED";
            return Promise.reject(bad);
        }
        if (backoff.retryAt && backoff.retryAt > now())
            return Promise.reject(rateLimited({ status: 429 }, backoff.retryAt));
        var attempt = 0, waited = false;
        function go() {
            return once(req).then(function (res) {
                if (res.status === 429 || res.status === 503) {
                    var ms = retryAfterMs(res.headers && res.headers["retry-after"], now());
                    if (ms === null) ms = res.status === 429 ? 60000 : 0;
                    if (ms > 0 && ms <= maxWaitMs && !waited) {
                        waited = true;
                        log("HTTP " + res.status + " from " + hostOf(req.url) + ": waiting " + Math.round(ms / 1000) + " s");
                        return sleep(ms).then(go);
                    }
                    if (ms > 0 || res.status === 429) {
                        backoff.retryAt = now() + Math.max(ms, 1000);
                        throw rateLimited(res, backoff.retryAt);
                    }
                }
                if ((res.status === 502 || res.status === 504 || res.status === 503) && attempt < retries) {
                    return sleep(500 * Math.pow(2, attempt++)).then(go);
                }
                return res;
            }, function (e) {
                if (attempt < retries && e && /^(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED)$/.test(e.code || "")) {
                    return sleep(500 * Math.pow(2, attempt++)).then(go);
                }
                throw e;
            });
        }
        return go();
    }

    function json(req) {
        var r = Object.assign({}, req);
        r.headers = Object.assign({ Accept: "application/json" }, req.headers || {});
        if (r.json !== undefined) {
            r.body = JSON.stringify(r.json);
            r.headers["Content-Type"] = "application/json";
            delete r.json;
        }
        return send(r).then(function (res) {
            var body = null;
            try { body = res.body ? JSON.parse(res.body) : null; } catch (e) { body = null; }
            if (res.status >= 400) {
                var msg = (body && (body.error_description || body.error)) || ("HTTP " + res.status);
                var err = errors.syncError(msg + " (" + (r.method || "GET") + " " + r.url.replace(/\?.*$/, "") + ")",
                                           res.status === 401 ? "401_UNAUTHORIZED" : null, res.status);
                err.body = body;
                throw err;
            }
            if (r.withResponse) return { body: body, headers: res.headers || {}, status: res.status };
            return body;
        });
    }

    return {
        request: send,
        json: json,
        backoff: backoff,
        allowHost: function (h) {
            h = String(h || "").toLowerCase();
            if (h && hosts.indexOf(h) < 0) hosts.push(h);
        }
    };
}

// The next page of a Link header (RFC 8288), rel="next": Mastodon's
// paging (docs.joinmastodon.org/api/guidelines/#pagination).
function linkNext(header) {
    var m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(String(header || ""));
    return m ? m[1] : null;
}

module.exports = { createHttp: createHttp, retryAfterMs: retryAfterMs, hostMatches: hostMatches, linkNext: linkNext };
