// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The simulator's link between web apps (Settings) and the shell: device
// state reported by the web runtime, system menu changes sent back, launch
// points and launch params. Runs without Qt WebEngine.

import QtQuick
import QtTest
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    SimWindowSource { id: windows }
    SimSystemStatus { id: status }
    // One that hears the runtime's Wi-Fi networks (test_wifiFromTheRuntime).
    SimSystemStatus { id: wifiStatus }
    SignalSpy { id: wifiAsked; target: wifiStatus; signalName: "wifiRequested" }

    SignalSpy { id: reported; target: windows; signalName: "systemStatusReported" }

    // Stands in for phoenix-sim's settings (simSettings).
    Component {
        id: fakeStore
        QtObject {
            property var values: ({})
            function value(key) { return values[key] || ""; }
            function setValue(key, v) { var o = Object.assign({}, values); o[key] = v; values = o; }
        }
    }
    Component {
        id: sourceComponent
        SimWindowSource {}
    }

    // Stands in for a WebAppWindow: records the scripts the shell runs in it.
    Component {
        id: fakePage
        QtObject {
            property var scripts: []
            function runScript(js) { scripts = scripts.concat([js]); }
        }
    }

    TestCase {
        name: "SimStatus"
        when: windowShown

        function initTestCase() {
            // What rootfs.cpp reports for Settings and one of its launch points.
            windows.apps.append({ appId: "org.webosphoenix.settings", title: "Settings", color: "#555c66", glyph: "S",
                                  tab: -1, quickLaunch: 0, icon: "", web: true, noWindow: false,
                                  main: "phoenix://rootfs/usr/palm/applications/org.webosphoenix.settings/index.html",
                                  webAppId: "org.webosphoenix.settings", params: "", dir: "file:///apps/settings/dist/" });
            windows.apps.append({ appId: "org.webosphoenix.settings.wifi", title: "Wi-Fi", color: "#555c66", glyph: "W",
                                  tab: 2, quickLaunch: 0, icon: "", web: true, noWindow: false,
                                  main: "phoenix://rootfs/usr/palm/applications/org.webosphoenix.settings/index.html?launchParams=%7B%22page%22%3A%22wifi%22%7D",
                                  webAppId: "org.webosphoenix.settings", params: "{\"page\":\"wifi\"}", dir: "file:///apps/settings/dist/" });
        }

        function init() {
            reported.clear();
            windows._pendingStatus = null;
            windows._pendingChanges = [];
        }

        function test_webAppReplacesPlaceholderInSettingsTab() {
            // The Wi-Fi launch point sits in the Settings tab; the hidden app does not.
            compare(windows.appInfo("org.webosphoenix.settings.wifi").tab, 2);
            compare(windows.appInfo("org.webosphoenix.settings").tab, -1);
        }

        function test_applyAppStatus() {
            status.applyAppStatus({ wifiEnabled: true, wifiConnected: true, wifiBars: 2, bluetoothOn: true,
                                    airplaneMode: false, brightness: 35, rotationLocked: true, muted: true });
            compare(status.wifiBars, 2);
            compare(status.bluetoothOn, true);
            fuzzyCompare(status.brightness, 0.35, 0.001);
            compare(status.rotationLocked, true);
            compare(status.muted, true);
            status.applyAppStatus({ wifiEnabled: true, wifiConnected: false });
            compare(status.wifiBars, 0);
            status.applyAppStatus({ wifiEnabled: false });
            compare(status.wifiBars, -1);
            // Keys that are missing stay as they are.
            status.applyAppStatus({ airplaneMode: true });
            compare(status.airplaneMode, true);
            compare(status.bluetoothOn, true);
            compare(status.applyingAppStatus, false);
        }

        // The system menu's Wi-Fi drawer lists the runtime's networks (those
        // of Settings > Wi-Fi), not a list of its own, and joining one asks
        // the runtime (the menu said "Phoenix" with Sunnyvale Cafe joined in
        // Settings, and listed a "Palm Guest" Settings had never seen).
        function test_wifiFromTheRuntime() {
            var nets = [{ ssid: "Phoenix", bars: 3, security: "psk", known: true, state: "" },
                        { ssid: "Sunnyvale Cafe", bars: 3, security: "", known: true, state: "ipConfigured" },
                        { ssid: "Lab 5G", bars: 2, security: "psk", known: false, state: "" }];
            wifiStatus.applyAppStatus({ wifiEnabled: true, wifiConnected: true, wifiBars: 3, wifiNetworks: nets });
            compare(wifiStatus.wifiNetworks.map(function (n) { return n.ssid; }), ["Phoenix", "Sunnyvale Cafe", "Lab 5G"]);
            compare(wifiStatus.wifiSsid, "Sunnyvale Cafe");
            wifiStatus.connectWifi("Phoenix");
            compare(wifiAsked.count, 1);
            compare(wifiAsked.signalArguments[0][0], { wifiConnect: "Phoenix" });
            compare(wifiStatus.wifiNetworks[0].state, "connecting", "shown joining at once");
            // The radio off: no networks reported, the list kept for when it is back.
            wifiStatus.applyAppStatus({ wifiEnabled: false, wifiNetworks: [] });
            compare(wifiStatus.wifiNetworks.length, 3);
            compare(wifiStatus.wifiBars, -1);
        }

        function test_appStatusFor() {
            status.wifiBars = -1;
            compare(status.appStatusFor("wifiBars"), { wifiEnabled: false });
            status.wifiBars = 3;
            compare(status.appStatusFor("wifiBars"), { wifiEnabled: true });
            status.brightness = 0.42;
            compare(status.appStatusFor("brightness"), { brightness: 42 });
            compare(status.appStatusFor("muted"), { muted: status.muted });
        }

        function test_hostMessageReportsStatusAndResolvesWallpaper() {
            windows._hostMessage("org.webosphoenix.settings.wifi", "w1", "systemStatus", {
                wifiEnabled: false, bluetoothOn: true,
                wallpaperFile: "/usr/palm/applications/org.webosphoenix.settings/wallpapers/aurora.jpg"
            });
            compare(reported.count, 1);
            var s = reported.signalArguments[0][0];
            compare(s.wifiEnabled, false);
            compare(s.bluetoothOn, true);
            compare(s.wallpaperUrl, "file:///apps/settings/dist/wallpapers/aurora.jpg");
            windows._hostMessage("x", "w1", "systemStatus", { wallpaperFile: "" });
            compare(reported.signalArguments[1][0].wallpaperUrl, "");
            compare(windows.resolveDevicePath("/usr/palm/applications/unknown.app/x.jpg"), "");
            compare(windows.resolveDevicePath("/etc/passwd"), "");
        }

        function test_pushWaitsForAPageWhenNoneIsRunning() {
            windows.pushSystemStatus({ wifiEnabled: false });
            windows.pushSystemStatus({ muted: true });
            compare(windows._pendingStatus, { wifiEnabled: false, muted: true });
            var page = fakePage.createObject(root);
            windows._pageLoaded(page);
            compare(page.scripts.length, 1);
            verify(page.scripts[0].indexOf("applyHostStatus({\"wifiEnabled\":false,\"muted\":true}, {\"writer\":true})") > 0);
            compare(windows._pendingStatus, null);
            // A report from a page means they are in step again.
            windows.pushSystemStatus({ bluetoothOn: true });
            windows._hostMessage("a", "w1", "systemStatus", { bluetoothOn: true });
            compare(windows._pendingStatus, null);
            page.destroy();
        }

        // Pushed while no page runs, then the simulator quits before one
        // loads: the next start hands it on, in order, an event pushed
        // twice (two words added to the dictionary) both times; the
        // shell's own state (pushed afresh at each start) is not kept.
        function test_pendingPushesOutliveAQuit() {
            var store = fakeStore.createObject(root);
            var first = sourceComponent.createObject(root, { pendingStore: store });
            first.pushSystemStatus({ dictionaryWordAdded: "Phoenix" });
            first.pushSystemStatus({ keyboard: "de" });
            first.pushSystemStatus({ dictionaryWordAdded: "Lunasys", deviceLocked: true });
            verify(store.value(first.pendingStoreKey) !== "", "kept in the settings");
            first.destroy();

            var next = sourceComponent.createObject(root, { pendingStore: store });
            var page = fakePage.createObject(root);
            next._pageLoaded(page);
            var js = page.scripts.join("\n");
            var a = js.indexOf("{\"dictionaryWordAdded\":\"Phoenix\",\"keyboard\":\"de\"}");
            var b = js.indexOf("{\"dictionaryWordAdded\":\"Lunasys\"}");
            verify(a > 0 && b > a, "both words, in order: " + js);
            verify(js.indexOf("deviceLocked") < 0, "not the shell's own state");
            compare(store.value(next.pendingStoreKey), "", "handed on: gone from the settings");
            next.destroy();

            // A third start has nothing to hand on.
            var third = sourceComponent.createObject(root, { pendingStore: store });
            var page2 = fakePage.createObject(root);
            third._pageLoaded(page2);
            compare(page2.scripts.length, 0);
            third.destroy();
            page.destroy();
            page2.destroy();
            store.destroy();
        }

        function test_pushGoesToRunningPages() {
            var page = fakePage.createObject(root);
            windows._headless["test.app"] = page;
            windows.pushSystemStatus({ airplaneMode: true });
            compare(page.scripts.length, 1);
            verify(page.scripts[0].indexOf("{\"airplaneMode\":true}") > 0);
            compare(windows._pendingStatus, null);
            delete windows._headless["test.app"];
            page.destroy();
        }

        // Every page hears each change, but only the system UI page stores it
        // (applyHostStatus's writer): pages writing their copies of the shared
        // state over one another could undo a setting just changed.
        function test_onlyOnePageStoresAChange() {
            var ui = fakePage.createObject(root), app = fakePage.createObject(root);
            windows._headless["test.app"] = app;
            windows._headless["com.palm.systemui"] = ui;
            var oldUi = windows._systemUiPage;
            windows._systemUiPage = ui;
            windows.pushSystemStatus({ brightness: 40 });
            compare(ui.scripts.length, 1);
            compare(app.scripts.length, 1);
            verify(ui.scripts[0].indexOf("{\"writer\":true}") > 0, ui.scripts[0]);
            verify(app.scripts[0].indexOf("{\"writer\":false}") > 0, app.scripts[0]);
            windows._systemUiPage = oldUi;
            delete windows._headless["test.app"];
            delete windows._headless["com.palm.systemui"];
            ui.destroy();
            app.destroy();
        }

        function test_launchParamsPickTheLaunchPoint() {
            compare(windows._launchTarget("org.webosphoenix.settings", { page: "wifi" }), "org.webosphoenix.settings.wifi");
            compare(windows._launchTarget("org.webosphoenix.settings", { page: "sounds" }), "org.webosphoenix.settings");
            compare(windows._launchTarget("org.webosphoenix.settings", {}), "org.webosphoenix.settings");
            compare(windows._launchTarget("com.palm.app.notes", { page: "wifi" }), "com.palm.app.notes");
        }

        function test_mainUrlCarriesLaunchParams() {
            compare(windows.mainUrl("org.webosphoenix.settings", { page: "screen" }),
                    "phoenix://rootfs/usr/palm/applications/org.webosphoenix.settings/index.html?launchParams=%7B%22page%22%3A%22screen%22%7D");
            compare(windows.mainUrl("org.webosphoenix.settings", {}),
                    "phoenix://rootfs/usr/palm/applications/org.webosphoenix.settings/index.html");
            compare(windows.mainUrl("org.webosphoenix.email", { a: 1 }), "");
        }
    }
}
