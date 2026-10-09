// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Developer Mode (docs/APP-RUNTIME.md "Developer apps"): developer apps
// (appinfo.json "phoenix": {"developer": true}) are in the launcher, the
// dock and Just Type, and open, only while it is on, following it at once;
// Settings' Developer Mode launch point ("developer": "unlock") only once
// Just Type's Konami code revealed it (luna-applauncher
// app/LaunchPointSearch.js:30-36: "Developer Mode Enabler", chosen with a
// tap or Enter). Here Just Type is the shell's built-in stand-in; the
// original page's path is runtime/phoenix-runtime.js's (devmode.test.ts).

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim
import "../qml/Phoenix/Shell/LauncherLayout.js" as LauncherLayout

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: status }
    }

    readonly property string devApp: "org.example.devtool"
    readonly property string devPane: "org.webosphoenix.settings.devmode"

    function inLauncher(id) {
        return LauncherLayout.pageOf(shell.launcherLayout, id) >= 0;
    }
    function inDock(id) {
        return shell.launcherLayout.dock.indexOf(id) >= 0;
    }

    TestCase {
        name: "DeveloperMode"
        when: windowShown

        function initTestCase() {
            windows.apps.append(Object.assign(windows._launcherFields(), {
                appId: root.devApp, title: "Dev Tool", color: "#333333", glyph: "D", tab: 0, quickLaunch: 0,
                icon: "", largeIcon: "", splashIcon: "", splashBackground: "", web: false, main: "", noWindow: false,
                orientation: "", developer: "devmode" }));
            windows.apps.append(Object.assign(windows._launcherFields(), {
                appId: root.devPane, title: "Developer Mode", color: "#333333", glyph: "{", tab: 2, quickLaunch: 0,
                icon: "", largeIcon: "", splashIcon: "", splashBackground: "", web: false, main: "", noWindow: false,
                orientation: "", developer: "unlock" }));
            tryVerify(function() { return shell.launcherLayout !== null && root.inLauncher("org.webosphoenix.phone"); }, 2000);
        }

        function init() {
            shell.unlock();
            status.devMode = false;
            status.devModeUnlocked = false;
            shell.cardView.maximizeProgress = 0;
            var dialog = findChild(shell, "deleteDialog");
            dialog.appId = "";
        }

        function test_launcherFollowsDeveloperMode() {
            tryVerify(function() { return !root.inLauncher(root.devApp); }, 1000, "hidden while off");
            tryVerify(function() { return !root.inLauncher(root.devPane); }, 1000, "Developer Mode itself hidden until revealed");
            status.devMode = true;
            tryVerify(function() { return root.inLauncher(root.devApp); }, 1000, "shown as it turns on, no restart");
            verify(root.inLauncher(root.devPane));
            // In the dock too, while on.
            shell.setLauncherLayout(LauncherLayout.addToDock(shell.launcherLayout, root.devApp, 0, 4));
            verify(root.inDock(root.devApp));
            status.devMode = false;
            tryVerify(function() { return !root.inLauncher(root.devApp); }, 1000, "gone as it turns off");
            verify(!root.inDock(root.devApp));
            verify(!root.inLauncher(root.devPane));
            status.devModeUnlocked = true;
            tryVerify(function() { return root.inLauncher(root.devPane); }, 1000, "the pane once revealed");
            verify(!root.inLauncher(root.devApp), "but not the developer apps");
        }

        function test_launchingWhileOff() {
            var dialog = findChild(shell, "deleteDialog");
            // Not revealed: as if it were not there.
            compare(shell.launch(root.devApp), "");
            verify(dialog.appId === "");
            // Revealed: the user is told, and offered Developer Mode.
            status.devModeUnlocked = true;
            compare(shell.launch(root.devApp), "");
            compare(dialog.appId, root.devApp);
            compare(dialog.mode, "developer");
            compare(findChild(shell, "deleteDialogMessage").text, "Turn on Developer Mode to use Dev Tool.");
            tryVerify(function() { return findChild(shell, "deleteDialogDevMode").visible; }, 1000);
            verify(!findChild(shell, "deleteDialogRemove").visible);
            findChild(shell, "deleteDialogDevMode").action();
            verify(dialog.appId === "");
            // On: it opens; off again: its card closes (OSE restarts the device).
            status.devMode = true;
            var uid = shell.launch(root.devApp);
            verify(uid !== "");
            tryVerify(function() { return windows.runningUid(root.devApp) !== ""; }, 1000);
            status.devMode = false;
            tryVerify(function() { return windows.runningUid(root.devApp) === ""; }, 1000);
        }

        function test_justTypeHidesDeveloperApps() {
            shell.startJustType("D");
            var input = findChild(shell, "justTypeInput");
            input.text = "Dev Tool";
            var results = findChild(shell, "justTypeResults");
            compare(results.count, 0);
            status.devMode = true;
            input.text = "Dev To";
            compare(results.count, 1);
            compare(results.itemAt(0).model.appId, root.devApp);
            shell.gestureBack();
            tryVerify(function() { return !shell.justTypeOpen; }, 1000);
        }

        function test_konamiCodeRevealsDeveloperMode() {
            var results = findChild(shell, "justTypeResults");
            var input = findChild(shell, "justTypeInput");
            shell.startJustType("u");
            // Only exactly the code, as typed (case and all).
            input.text = "UPUPDOWNDOWNLEFTRIGHTLEFTRIGHTBASTART";
            compare(results.count, 0);
            input.text = "upupdowndownleftrightleftrightbastar";
            compare(results.count, 0);
            input.text = "upupdowndownleftrightleftrightbastart";
            compare(results.count, 1);
            compare(results.itemAt(0).model.title, "Developer Mode Enabler");
            // webOS 1.x's code too.
            input.text = "webos20090606";
            compare(results.count, 1);
            compare(results.itemAt(0).model.appId, shell.devModeSwitcherId);
            // Enter chooses it (LaunchPointSearch.js:226-231).
            input.forceActiveFocus();
            keyClick(Qt.Key_Return);
            verify(status.devModeUnlocked, "revealed for good (the system preference)");
            tryVerify(function() { return !shell.justTypeOpen; }, 1000);
            tryVerify(function() { return root.inLauncher(root.devPane); }, 1000, "its launch point shows");
            verify(!status.devMode, "Developer Mode itself is still off");
        }
    }
}
