// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The bus, for the device shell's tests: every Service's call is recorded,
// and a test answers it as the service would (reply / replyAll).

pragma Singleton
import QtQuick

QtObject {
    property var calls: []      // {service, method, params, token, svc}
    property int _next: 1

    function register(svc, service, method, payload) {
        var p = null;
        try { p = JSON.parse(payload); } catch (e) { p = payload; }
        var c = { service: String(service).replace(/^luna:\/\//, ""), method: String(method), params: p, token: _next++, svc: svc };
        calls.push(c);
        return c.token;
    }

    // The calls to service + method ("com.webos.service.wifi", "/getstatus").
    function find(service, method) {
        return calls.filter(function(c) { return c.service === service && c.method === method; });
    }
    function last(service, method) {
        var f = find(service, method);
        return f.length ? f[f.length - 1] : null;
    }
    // Answer a call (or every call) to service + method with obj.
    function reply(service, method, obj) {
        var c = last(service, method);
        if (c)
            c.svc.response(c.method, JSON.stringify(obj), c.token);
        return !!c;
    }
    function replyAll(service, method, obj) {
        find(service, method).forEach(function(c) { c.svc.response(c.method, JSON.stringify(obj), c.token); });
    }
    // Forget the calls made so far, but not the subscriptions (they stay
    // open, as on the bus).
    function clear() {
        calls = calls.filter(function(c) { return c.params && c.params.subscribe === true; });
    }
}
