// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// JSON-RPC 2.0 to deltachat-rpc-server, one request or answer per line on
// its standard input and output (deltachat-rpc-server/README.md in
// chatmail/core; the methods are deltachat-jsonrpc's, named as
// @deltachat/jsonrpc-client's generated client sends them: get_next_event,
// add_or_update_transport, misc_send_text_message, ...).
//
// One server holds every account (its accounts manager), so one client per
// running helper: the connector's accounts share it, and its events
// (get_next_event, each with the account's contextId) go to the account
// they name.

"use strict";

var clients = typeof WeakMap === "function" ? new WeakMap() : null;

function rpcError(e, method) {
    var message = (e && e.message) || "Delta Chat: " + method + " failed";
    var err = new Error(message);
    err.errorCode = e && e.code === -32601 ? "METHOD_NOT_FOUND" : "DELTACHAT_ERROR";
    err.rpcCode = e && e.code;
    return err;
}

function createRpc(proc, log) {
    var seq = 0, waiting = {}, listeners = {}, pumping = false, closed = false;
    proc.onLine(function (line) {
        var m;
        try { m = JSON.parse(line); } catch (e) { return; }
        if (!m || m.id === undefined || !waiting[m.id]) return;
        var w = waiting[m.id];
        delete waiting[m.id];
        if (m.error) w.reject(rpcError(m.error, w.method));
        else w.resolve(m.result === undefined ? null : m.result);
    });
    proc.onExit(function (code) {
        closed = true;
        Object.keys(waiting).forEach(function (id) {
            var w = waiting[id];
            delete waiting[id];
            var e = new Error("Delta Chat's core stopped (" + code + ")");
            e.errorCode = "HELPER_EXITED";
            w.reject(e);
        });
        if (clients) clients.delete(proc);
    });

    function call(method, params) {
        if (closed) {
            var e = new Error("Delta Chat's core is not running");
            e.errorCode = "HELPER_EXITED";
            return Promise.reject(e);
        }
        var id = ++seq;
        return new Promise(function (resolve, reject) {
            waiting[id] = { resolve: resolve, reject: reject, method: method };
            proc.send(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params || [] }));
        });
    }

    // The events, one at a time, for as long as an account listens.
    function pump() {
        if (pumping || closed) return;
        pumping = true;
        (function next() {
            if (closed || !Object.keys(listeners).length) { pumping = false; return; }
            call("get_next_event", []).then(function (ev) {
                var fns = ev && listeners[ev.contextId];
                (fns || []).slice().forEach(function (f) {
                    try { f(ev.event || {}); } catch (e) { if (log) log("event handler: " + e.message); }
                });
                next();
            }, function (e) {
                pumping = false;
                if (log && !closed) log("events stopped: " + e.message);
            });
        })();
    }

    return {
        call: call,
        get closed() { return closed; },
        // fn(event) for the account's events; -> a function that stops them.
        onEvent: function (accountId, fn) {
            (listeners[accountId] = listeners[accountId] || []).push(fn);
            pump();
            return function () {
                var l = listeners[accountId] || [];
                var i = l.indexOf(fn);
                if (i >= 0) l.splice(i, 1);
                if (!l.length) delete listeners[accountId];
            };
        },
        kill: function () { proc.kill(); }
    };
}

// The client of a running helper (ctx.helper gives the same process to every account).
function rpcOf(proc, log) {
    if (!clients) return createRpc(proc, log);
    var c = clients.get(proc);
    if (!c) { c = createRpc(proc, log); clients.set(proc, c); }
    return c;
}

module.exports = { createRpc: createRpc, rpcOf: rpcOf };
