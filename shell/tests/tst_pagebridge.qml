// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A script of an app's own in its page view (PageBridge.js, used by
// WebAppWindow.qml's native views): the origin it is kept to, the secret
// its messages carry, what the app may send into the page, and the wrapped
// script itself, run here against a stand-in page.

import QtQuick
import QtTest
import "../qml/Phoenix/Sim/PageBridge.js" as PageBridge

Item {
    TestCase {
        name: "PageBridge"

        readonly property string nonce: "0123456789abcdef0123"

        function test_originOf() {
            compare(PageBridge.originOf("http://homeassistant.local:8123/lovelace/0?x=1"), "http://homeassistant.local:8123");
            compare(PageBridge.originOf("HTTPS://HA.Example.com/"), "https://ha.example.com");
            compare(PageBridge.originOf("https://ha.example.com:443/x"), "https://ha.example.com");
            compare(PageBridge.originOf("http://ha.example.com:80"), "http://ha.example.com");
            compare(PageBridge.originOf("https://ha.example.com:8443#y"), "https://ha.example.com:8443");
            // Who signs in is not where it is.
            compare(PageBridge.originOf("https://user:pw@ha.example.com/"), "https://ha.example.com");
            compare(PageBridge.originOf("phoenix://rootfs/usr/palm/applications/x/index.html"), "");
            compare(PageBridge.originOf("about:blank"), "");
            compare(PageBridge.originOf(""), "");
        }

        function test_valid() {
            verify(PageBridge.validOrigin("http://192.168.1.20:8123"));
            verify(PageBridge.validOrigin("https://ha.example.com"));
            verify(!PageBridge.validOrigin("https://ha.example.com/"));
            verify(!PageBridge.validOrigin("https://ha.example.com:443"));
            verify(!PageBridge.validOrigin("HTTPS://ha.example.com"));
            verify(!PageBridge.validOrigin("file:///etc"));
            verify(!PageBridge.validOrigin(""));
            verify(!PageBridge.validOrigin(null));
            verify(PageBridge.validNonce(nonce));
            verify(!PageBridge.validNonce("short"));
            verify(!PageBridge.validNonce("abc'def;0123456789"));
        }

        function test_message() {
            const tag = PageBridge.PREFIX + nonce + ":";
            compare(PageBridge.message(tag + '{"type":"config/get","id":1}', nonce), '{"type":"config/get","id":1}');
            // Another view's (or a forgery without the secret), or not JSON.
            compare(PageBridge.message(PageBridge.PREFIX + "ffffffffffffffffffff:{}", nonce), null);
            compare(PageBridge.message(tag + "{not json", nonce), null);
            compare(PageBridge.message('{"type":"x"}', nonce), null);
            compare(PageBridge.message(tag + "{}", ""), null);
            verify(PageBridge.isBridgeMessage(tag + "{}"));
            verify(!PageBridge.isBridgeMessage("__phoenix_link__mailto:a@b"));
        }

        function test_deliver() {
            compare(PageBridge.deliverScript('{"a": 1}'), 'window.__phoenixPageBridge && window.__phoenixPageBridge.receive({"a":1})');
            compare(PageBridge.deliverScript('"text"'), 'window.__phoenixPageBridge && window.__phoenixPageBridge.receive("text")');
            // Code is never run: what is not JSON is not sent.
            compare(PageBridge.deliverScript("alert(1)"), "");
            compare(PageBridge.deliverScript('{"a": 1}); alert(1); ({'), "");
            compare(PageBridge.deliverScript(""), "");
        }

        // The wrapped script against a stand-in page: window, location and
        // console as a page of that origin (or another) would have them.
        function page(origin, top) {
            const logged = [];
            const win = {};
            win.top = top === false ? {} : win;
            const env = { win: win, logged: logged, location: { origin: origin },
                          console: { log: function (m) { logged.push(m); } } };
            return env;
        }
        function run(env, script) {
            const src = PageBridge.wrap(script, "http://ha.local:8123", nonce);
            const f = new Function("window", "location", "console", src);
            f(env.win, env.location, env.console);
        }

        function test_wrapped() {
            const app = "window.seen = []; bridge.onMessage(function (m) { window.seen.push(m); });"
                + " window.externalApp = { externalBus: function (s) { bridge.post({ bus: JSON.parse(s) }); } };";
            const p = page("http://ha.local:8123");
            run(p, app);
            verify(p.win.externalApp !== undefined, "the page's own world sees what the script defines");
            p.win.externalApp.externalBus('{"type":"config/get","id":1}');
            compare(p.logged.length, 1);
            compare(PageBridge.message(p.logged[0], nonce), '{"bus":{"type":"config/get","id":1}}');
            // The app's message, as the shell hands it over.
            const js = PageBridge.deliverScript('{"id":1,"type":"result","success":true}');
            new Function("window", js)(p.win);
            compare(p.win.seen.length, 1);
            compare(p.win.seen[0].type, "result");

            // Another origin, or a frame inside the page: nothing runs.
            const other = page("http://evil.example");
            run(other, app);
            compare(other.win.externalApp, undefined);
            const frame = page("http://ha.local:8123", false);
            run(frame, app);
            compare(frame.win.externalApp, undefined);
        }
    }
}
