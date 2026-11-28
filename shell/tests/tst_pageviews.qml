// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the browser's page views share (PageViews.js, WebAppWindow.qml):
// a page another page opened waits for its card's view by identifier; a
// host whose certificate the user let through has no padlock; Qt's
// certificate errors become the codes isis-browser's SSL dialog words
// (Browser.js:252-268).

import QtQuick
import QtTest
import "../qml/Phoenix/Sim/PageViews.js" as PageViews

Item {
    id: root

    Component { id: fakeView; QtObject { property string viewId: "" } }

    TestCase {
        name: "PageViews"

        function test_park() {
            const a = fakeView.createObject(root), b = fakeView.createObject(root);
            const ia = PageViews.park(a), ib = PageViews.park(b);
            verify(ia !== ib);
            verify(/^phoenix-page-\d+$/.test(ia));
            compare(PageViews.take(ib), b);
            compare(PageViews.take(ib), null, "taken once");
            compare(PageViews.take("phoenix-page-nope"), null);
            compare(PageViews.take(""), null);
            compare(PageViews.take(ia), a);
        }

        function test_hostOf() {
            compare(PageViews.hostOf("https://Example.COM:8443/a?b#c"), "example.com:8443");
            compare(PageViews.hostOf("http://user@example.com/"), "example.com");
            compare(PageViews.hostOf("file:///usr/palm"), "");
            compare(PageViews.hostOf("about:blank"), "");
        }

        function test_secure() {
            verify(PageViews.secure("https://bank.example/", false));
            verify(!PageViews.secure("http://bank.example/", false));
            PageViews.allow(false, "selfsigned.example:4443");
            verify(!PageViews.secure("https://selfsigned.example:4443/page", false), "let through: no padlock");
            verify(PageViews.secure("https://selfsigned.example:4443/page", true), "the private profile asks for itself");
            verify(PageViews.secure("https://selfsigned.example/", false), "another port is another host");
        }

        function test_sslCode() {
            // Expired (BrowserServer's 0, "is expired").
            compare(PageViews.sslCode(-201), 0);
            // Self-signed or an unknown authority: "questionable signatures" (18-23).
            compare(PageViews.sslCode(-202), 18);
            // Another host's: "inconsistent information" (50).
            compare(PageViews.sslCode(-200), 50);
            compare(PageViews.sslCode(-206), 23);
            // The rest: "invalid" (24-29).
            compare(PageViews.sslCode(-207), 24);
            compare(PageViews.sslCode(-208), 24);
        }
    }
}
