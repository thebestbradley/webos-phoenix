// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Where a link in a web app's window goes (Links.js, used by
// WebAppWindow.qml): an app's page keeps its own pages and hands the rest
// to the application manager; a site keeps its scope; the browser's page
// views follow BrowserAdapter's redirects. And the simulator's window
// source: a site launched for a page of its own opens it.

import QtQuick
import QtTest
import Phoenix.Sim
import "../qml/Phoenix/Sim/Links.js" as Links

Item {
    id: root
    width: 320
    height: 480

    SimWindowSource { id: windows }
    SignalSpy { id: banners; target: windows; signalName: "bannerRequested" }

    TestCase {
        name: "Links"

        function test_scope() {
            compare(Links.scopeOf("https://open.example.com/home?x=1", ""), "https://open.example.com/");
            compare(Links.scopeOf("https://a.example/", "https://a.example/app/"), "https://a.example/app/");
            verify(Links.inScope("https://open.example.com/track/1", "https://open.example.com/"));
            verify(Links.inScope("http://open.example.com", "https://open.example.com/"));
            // With or without www. / m.
            verify(Links.inScope("https://www.tube.example/watch?v=1", "https://m.tube.example/"));
            verify(Links.inScope("https://tube.example/", "https://m.tube.example/"));
            verify(!Links.inScope("https://tube.example.evil/", "https://m.tube.example/"));
            verify(!Links.inScope("https://other.example/", "https://open.example.com/"));
            // A path scope: the folder and what is in it.
            verify(Links.inScope("https://a.example/app", "https://a.example/app/"));
            verify(Links.inScope("https://a.example/app/x", "https://a.example/app/"));
            verify(!Links.inScope("https://a.example/apple", "https://a.example/app/"));
            verify(!Links.inScope("https://a.example/", ""));
        }

        function test_appPage() {
            // An app's own pages, and what the shell loads, stay.
            compare(Links.navigation("phoenix://rootfs/usr/palm/applications/x/index.html", "link", true, false, ""), "accept");
            compare(Links.navigation("data:text/html,hi", "other", true, false, ""), "accept");
            compare(Links.navigation("https://example.com/", "typed", true, false, ""), "accept");
            compare(Links.navigation("https://example.com/", "reload", true, false, ""), "accept");
            // A frame inside the page is the page's business.
            compare(Links.navigation("https://example.com/embed", "other", false, false, ""), "accept");
            // Leaving the app: a link, a form, a script.
            compare(Links.navigation("https://example.com/", "link", true, false, ""), "route");
            compare(Links.navigation("https://example.com/", "form", true, false, ""), "route");
            compare(Links.navigation("https://example.com/", "other", true, false, ""), "route");
            compare(Links.navigation("mailto:ada@example.com", "link", true, false, ""), "route");
            compare(Links.navigation("tel:5550100", "other", true, false, ""), "route");
        }

        function test_site() {
            const scope = "https://open.example.com/";
            compare(Links.navigation("https://open.example.com/album/7", "link", true, true, scope), "accept");
            // Its links out of its scope go to the browser (or another web app).
            compare(Links.navigation("https://news.example.org/", "link", true, true, scope), "route");
            // A redirect or script to another domain (signing in) stays.
            compare(Links.navigation("https://accounts.example.org/login", "redirect", true, true, scope), "accept");
            compare(Links.navigation("https://accounts.example.org/login", "other", true, true, scope), "accept");
            compare(Links.navigation("https://accounts.example.org/login", "form", true, true, scope), "accept");
            compare(Links.navigation("tel:5550100", "link", true, true, scope), "route");
        }

        function test_newWindow() {
            // The runtime's alerts and dashboards, and windows of its own pages.
            compare(Links.newWindow("", false, false, ""), "window");
            compare(Links.newWindow("phoenix://rootfs/usr/palm/applications/x/alert.html#phoenixWindow=popupalert", false, false, ""), "window");
            compare(Links.newWindow("about:blank", false, false, ""), "window");
            // target=_blank to the web: the browser, not a card of the app.
            compare(Links.newWindow("https://open-meteo.com/", false, false, ""), "route");
            compare(Links.newWindow("mailto:ada@example.com", false, false, ""), "route");
            // A site: its own pages and sign-in pop-ups stay with it.
            compare(Links.newWindow("https://open.example.com/x", false, true, "https://open.example.com/"), "window");
            compare(Links.newWindow("https://accounts.example.org/popup", true, true, "https://open.example.com/"), "window");
            compare(Links.newWindow("https://news.example.org/", false, true, "https://open.example.com/"), "route");
        }

        function test_redirects() {
            // The browser: the system's schemes (enyo WebView addSystemRedirects).
            const browser = [{ regex: "^mailto:", enable: true, cookie: "com.palm.app.email" },
                             { regex: "^tel:", enable: true, cookie: "org.webosphoenix.phone" }];
            compare(Links.redirectFor("mailto:ada@example.com", browser), "com.palm.app.email");
            compare(Links.redirectFor("MAILTO:ada@example.com", browser), "com.palm.app.email");
            compare(Links.redirectFor("https://example.com/", browser), null);
            // Email's message body: everything but its own file: pages
            // (MessageDisplay.js:906-909); the first that matches decides.
            const email = [{ regex: "^file:.*", enable: false, cookie: "" }, { regex: ".*", enable: true, cookie: "" }];
            compare(Links.redirectFor("file:///tmp/body.html", email), null);
            compare(Links.redirectFor("https://example.com/", email), "");
            // A broken pattern is skipped.
            compare(Links.redirectFor("x:y", [{ regex: "(", enable: true, cookie: "a" }, { regex: "^x:", enable: true, cookie: "b" }]), "b");
            compare(Links.redirectFor("x:y", []), null);
        }

        function test_linkScript() {
            verify(Links.linkScript.indexOf(Links.LINK_PREFIX) > 0);
            verify(Links.isLocal("phoenix://rootfs/a") && Links.isLocal("about:blank") && !Links.isLocal("mailto:x"));
            verify(Links.isWeb("HTTPS://a") && !Links.isWeb("ftp://a"));
        }

        // A link no app opens: the application manager says "No handler"
        // and the shell posts "open"; the user hears so in a banner.
        function test_noHandlerBanner() {
            banners.clear();
            // No page runs the application manager here: a scheme goes
            // straight to "open".
            windows.openLink("com.example.app", "", "nosuchscheme:42");
            compare(banners.count, 1);
            compare(banners.signalArguments[0][1], "No app can open this link");
            windows._hostMessage("com.palm.systemui", "", "open", { target: "nosuchscheme:42" });
            compare(banners.count, 2);
        }

        // A site launched for a page of its own (a link to it from another
        // app) opens that page; other params do not reach its address.
        function test_siteLaunchUrl() {
            windows.apps.append(Object.assign(windows._launcherFields(), {
                appId: "com.example.tunes", title: "Tunes", web: true, main: "https://m.tunes.example/home",
                scope: "https://m.tunes.example/", tab: 0, quickLaunch: 0, color: "#555c66", glyph: "T", icon: "", largeIcon: "",
                splashIcon: "", splashBackground: "", noWindow: false, orientation: "", webAppId: "com.example.tunes",
                params: "", dir: "", removable: true, version: "1.0" }));
            compare(windows.mainUrl("com.example.tunes", { target: "https://www.tunes.example/album/7" }), "https://www.tunes.example/album/7");
            compare(windows.mainUrl("com.example.tunes", { target: "https://elsewhere.example/" }), "https://m.tunes.example/home");
            compare(windows.mainUrl("com.example.tunes", { foo: 1 }), "https://m.tunes.example/home");
            compare(windows.mainUrl("com.example.tunes", {}), "https://m.tunes.example/home");
        }
    }
}
