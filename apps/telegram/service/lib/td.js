// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// TDLib's JSON interface through phoenix-tdjson, the system helper
// (meta-phoenix/recipes-connectors/tdlib/files/phoenix-tdjson.c), one line
// each way:
//
//   C <extra>             -> {"@type":"phoenix.client","client_id":N,"@extra"}
//   S <client_id> <json>  td_send; the answer comes back through td_receive
//                         with the request's "@extra" and "@client_id"
//   E <extra> <json>      td_execute -> {"@type":"phoenix.executed","@extra","result"}
//
// and everything else td_receive gives: updates ("@client_id", no "@extra").
// The requests and updates are td_api.tl's (TDLib 1.8: setTdlibParameters
// with its fields inline, updateAuthorizationState, updateNewMessage, ...).
//
// One helper holds every account's client (td_create_client_id), so one
// of these per running helper.

"use strict";

var hubs = typeof WeakMap === "function" ? new WeakMap() : null;

function tdError(e, request) {
    var err = new Error((e && e.message) || "Telegram: " + request + " failed");
    err.tdCode = e && e.code;
    err.errorCode = e && e.code === 401 ? "401_UNAUTHORIZED" : e && e.code === 429 ? "503_SERVICE_UNAVAILABLE" : "TELEGRAM_ERROR";
    // FLOOD_WAIT: "Too Many Requests: retry after N"
    var wait = /retry after (\d+)/i.exec(err.message);
    if (wait) err.retryAfter = Number(wait[1]);
    return err;
}

function createHub(proc, log) {
    var seq = 0, waiting = {}, clients = {}, closed = false, dataDir = null, readyFns = [];
    proc.onLine(function (line) {
        var m;
        try { m = JSON.parse(line); } catch (e) { return; }
        if (!m) return;
        if (m["@type"] === "phoenix.ready") { dataDir = m.data_dir; readyFns.splice(0).forEach(function (f) { f(); }); return; }
        var extra = m["@extra"];
        if (extra !== undefined && waiting[extra]) {
            var w = waiting[extra];
            delete waiting[extra];
            if (m["@type"] === "error") w.reject(tdError(m, w.request));
            else if (m["@type"] === "phoenix.executed") w.resolve(m.result);
            else w.resolve(m);
            return;
        }
        var c = clients[m["@client_id"]];
        if (c) c.updates.forEach(function (f) { try { f(m); } catch (e) { if (log) log("update handler: " + e.message); } });
    });
    proc.onExit(function (code) {
        closed = true;
        Object.keys(waiting).forEach(function (k) {
            var e = new Error("Telegram's library stopped (" + code + ")");
            e.errorCode = "HELPER_EXITED";
            waiting[k].reject(e);
            delete waiting[k];
        });
        Object.keys(clients).forEach(function (id) { clients[id].exits.forEach(function (f) { f(); }); });
        if (hubs) hubs.delete(proc);
    });

    function ask(line, extra, request) {
        if (closed) {
            var e = new Error("Telegram's library is not running");
            e.errorCode = "HELPER_EXITED";
            return Promise.reject(e);
        }
        return new Promise(function (resolve, reject) {
            waiting[extra] = { resolve: resolve, reject: reject, request: request };
            proc.send(line);
        });
    }
    function ready() {
        return dataDir !== null ? Promise.resolve(dataDir) : new Promise(function (resolve) { readyFns.push(function () { resolve(dataDir); }); });
    }

    return {
        ready: ready,
        get closed() { return closed; },
        // A synchronous request (td_execute), with no client.
        execute: function (request) {
            var extra = "x" + (++seq);
            return ready().then(function () { return ask("E " + extra + " " + JSON.stringify(request), extra, request["@type"]); });
        },
        // A new TDLib client: {id, send(request) -> answer, onUpdate(fn), onExit(fn), forget()}.
        client: function () {
            var extra = "c" + (++seq);
            return ready().then(function () { return ask("C " + extra, extra, "createClient"); }).then(function (m) {
                var id = m.client_id;
                var c = clients[id] = { updates: [], exits: [] };
                return {
                    id: id,
                    send: function (request) {
                        var x = "r" + (++seq);
                        return ask("S " + id + " " + JSON.stringify(Object.assign({}, request, { "@extra": x })), x, request["@type"]);
                    },
                    onUpdate: function (f) { c.updates.push(f); },
                    onExit: function (f) { c.exits.push(f); },
                    forget: function () { delete clients[id]; }
                };
            });
        }
    };
}

// The hub of a running helper (ctx.helper gives every account the same process).
function hubOf(proc, log) {
    if (!hubs) return createHub(proc, log);
    var h = hubs.get(proc);
    if (!h) { h = createHub(proc, log); hubs.set(proc, h); }
    return h;
}

module.exports = { hubOf: hubOf, createHub: createHub, tdError: tdError };
