// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The loopback redirect of an OAuth sign-in on a device (RFC 8252 7.3,
// "Loopback Interface Redirection"; docs/SYNERGY-MODERN.md 4.4: "the
// redirect listener binds to 127.0.0.1 only, accepts one request and
// closes"). The OAuth service opens one only while a sign-in is pending:
//
//   open({port, state}) -> Promise<{redirectUri, result, close()}>
//       listens on 127.0.0.1 (never another interface), on `port`, or on an
//       ephemeral port the system picks when port is 0 or missing (RFC 8252
//       7.3: "the client SHOULD use an ephemeral port"; providers that
//       match the registered redirect exactly get a fixed one,
//       docs/DEVELOPER-APPS.md). redirectUri is
//       http://127.0.0.1:<port><path>. `result` resolves with the address
//       the provider's redirect reached (path and query) once a request
//       comes to `path` with this sign-in's `state`; the answer is a short
//       page saying the sign-in is over. Requests to other paths get 404,
//       and a request with another state 400, and are otherwise ignored: a
//       local program guessing the port cannot end the sign-in (and a code
//       it might see is useless without the PKCE verifier, RFC 7636 1).
//       close() stops listening; `result` then resolves with null if
//       nothing came.
//
// Written against Node's http module, injected (createLoopback({http})),
// so tests run it for real on 127.0.0.1.

"use strict";

var HOST = "127.0.0.1";
var PATH = "/oauth/callback";

function page(title, text) {
    return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">" +
        "<title>" + title + "</title></head>" +
        "<body style=\"font-family: sans-serif; text-align: center; padding-top: 40px; color: #444\"><p>" + text + "</p></body></html>";
}

function stateOf(url) {
    var q = String(url).replace(/#.*$/, "").split("?")[1] || "";
    var parts = q.split("&");
    for (var i = 0; i < parts.length; i++) {
        var kv = parts[i], j = kv.indexOf("=");
        var k = j < 0 ? kv : kv.slice(0, j);
        if (k === "state") {
            try { return decodeURIComponent(kv.slice(j + 1).replace(/\+/g, " ")); } catch (e) { return null; }
        }
    }
    return null;
}

function createLoopback(opts) {
    var http = opts.http;
    var path = opts.path || PATH;
    var log = opts.log || function () {};

    function open(o) {
        o = o || {};
        return new Promise(function (resolve, reject) {
            var settled = false, resolveResult;
            var result = new Promise(function (r) { resolveResult = r; });
            var server = http.createServer(function (req, res) {
                var url = String(req.url || "");
                var p = url.split("?")[0];
                // Only this sign-in's answer ends it; nothing else is kept.
                var headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
                                "Referrer-Policy": "no-referrer", "Connection": "close" };
                if (req.method !== "GET" || p !== path) {
                    res.writeHead(404, headers);
                    res.end(page("Not found", "Not found."));
                    return;
                }
                if (settled || (o.state && stateOf(url) !== o.state)) {
                    res.writeHead(400, headers);
                    res.end(page("Not this sign-in", "This is not the sign-in Phoenix is waiting for."));
                    return;
                }
                settled = true;
                res.writeHead(200, headers);
                res.end(page("Signed in", "Signed in. Back to Phoenix…"), function () { stop(); });
                resolveResult(url);
            });
            // Stops listening at once (the port is free for anyone); the
            // answer being sent finishes ("Connection: close" ends its
            // socket after it), and sockets a browser opened ahead and left
            // idle are closed. Not closeAllConnections: destroying the
            // answer's socket can reset it before the card has read it.
            function stop() {
                try { server.close(); } catch (e) { /* closed */ }
                if (server.closeIdleConnections) server.closeIdleConnections();
            }
            server.keepAliveTimeout = 1;
            server.on("error", function (e) {
                if (!settled) {
                    settled = true;
                    resolveResult(null);
                }
                reject(Object.assign(new Error("Could not listen on " + HOST + ":" + (o.port || 0) + " (" + (e.code || e.message) + ")"),
                                     { errorCode: e.code === "EADDRINUSE" ? "BUSY" : "UNKNOWN_ERROR" }));
            });
            server.listen(o.port || 0, HOST, function () {
                var port = server.address().port;
                log("listening on " + HOST + ":" + port + path);
                resolve({
                    redirectUri: "http://" + HOST + ":" + port + path,
                    port: port,
                    result: result,
                    close: function () {
                        stop();
                        if (!settled) {
                            settled = true;
                            resolveResult(null);
                        }
                    }
                });
            });
        });
    }

    return { open: open };
}

// Whether an address is a loopback redirect this service serves: http on
// 127.0.0.1 with its path, any port or none (RFC 8252 7.3).
function isLoopback(uri, path) {
    var m = /^http:\/\/127\.0\.0\.1(?::(\d{1,5}))?(\/[^?#]*)$/.exec(String(uri || ""));
    return !!m && m[2] === (path || PATH);
}
function portOf(uri) {
    var m = /^http:\/\/127\.0\.0\.1:(\d{1,5})\//.exec(String(uri || ""));
    return m ? Number(m[1]) : 0;
}

module.exports = { createLoopback: createLoopback, isLoopback: isLoopback, portOf: portOf, HOST: HOST, PATH: PATH };
