// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The keyboard's calls on the bus from inside maliit-server: the system's
// preferences (its settings), audiod (its key sounds), the clipboard
// history (its clip strip; ClipboardClient takes this as its source) and
// com.palm.systemmanager (the words it learned, for Settings). Through
// webOS's QML Service (WebOSServices, as OSE's own keyboard calls the bus:
// ime-manager maliit-plugin-global/view/main.qml:171-224), as maliit-server
// itself: its bus name, com.webos.service.ime, with ".phoenixKeyboard"
// (OSE's keyboard is ".globalPlugin", main.qml:34), which its role allows
// (com.webos.service.ime*). What it may call: meta-phoenix's
// phoenix-keyboard recipe (the client permissions) and its imemanager
// bbappend (the role's outbound services).
//
//   lunaCall(uri, params, done)       one reply: done(reply), or done(null)
//                                     when the service did not answer JSON
//   lunaSubscribe(uri, params, each)  each reply

import QtQuick
import WebOSServices 1.0

QtObject {
    id: bus
    property string appId: ""

    property var _handlers: ({})
    property var _service: Service {
        appId: bus.appId
        onResponse: (method, payload, token) => bus._reply(token, payload)
    }
    function _reply(token, payload) {
        var h = _handlers[token];
        if (!h)
            return;
        if (!h.subscribe)
            delete _handlers[token];
        var r = null;
        try { r = JSON.parse(payload); } catch (e) { r = null; }
        h.fn(r);
    }
    function _call(uri, params, fn, subscribe) {
        var m = /^luna:\/\/([^\/]+)(\/.*)$/.exec(uri);
        if (!m)
            return 0;
        var p = {};
        for (var k in params || {})
            p[k] = params[k];
        if (subscribe)
            p.subscribe = true;
        var token = _service.call("luna://" + m[1], m[2], JSON.stringify(p));
        if (token > 0)
            _handlers[token] = { fn: fn || function () {}, subscribe: !!subscribe };
        else if (fn)
            fn(null);
        return token;
    }
    function lunaCall(uri, params, done) { return _call(uri, params, done, false); }
    function lunaSubscribe(uri, params, each) { return _call(uri, params, each, true); }
}
