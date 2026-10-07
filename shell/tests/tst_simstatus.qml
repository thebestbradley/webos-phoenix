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

    SignalSpy { id: reported; target: windows; signalName: "systemStatusReported" }

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
