// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Desktop simulator entry point (loaded by phoenix-sim).
//
// Context properties set by phoenix-sim:
//   simScene       "locked" | "cards" | "stacks" | "reorder" | "maximized" | "launcher" |
//                  "dashboard" | "justtype" | "systemmenu" | "empty"
//   simFormFactor  "auto" | "phone" | "tablet"

import QtQuick
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: typeof simFormFactor !== "undefined" ? simFormFactor : "auto"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus {
            id: status
            // Fixed clock for reproducible screenshots.
            fixedTime: typeof simScene !== "undefined" && simScene !== "" ? new Date(2009, 5, 6, 9, 41) : null
        }
    }

    // Device state shared with the web apps (Settings, ...). Their simulated
    // services report changes as "systemStatus" host messages; the system
    // menu's toggles go back to them. See docs/APP-RUNTIME.md.
    Connections {
        target: windows
        function onSystemStatusReported(s) {
            status.applyAppStatus(s);
            if (s.wallpaperUrl !== undefined)
                shell.wallpaper = s.wallpaperUrl;
        }
    }
    Connections {
        target: status
        function onWifiBarsChanged() { root.statusChanged("wifiBars"); }
        function onAirplaneModeChanged() { root.statusChanged("airplaneMode"); }
        function onBluetoothOnChanged() { root.statusChanged("bluetoothOn"); }
        function onBrightnessChanged() { root.statusChanged("brightness"); }
        function onRotationLockedChanged() { root.statusChanged("rotationLocked"); }
        function onMutedChanged() { root.statusChanged("muted"); }
    }
    function statusChanged(name) {
        if (!status.applyingAppStatus)
            windows.pushSystemStatus(status.appStatusFor(name));
    }

    // Simulator only: F4 rings the phone, F5 delivers a text message
    // (SimWindowSource.simulateIncomingCall / simulateIncomingSms). Shortcuts,
    // so they work while a web app has keyboard focus.
    Shortcut {
        sequence: "F4"
        context: Qt.ApplicationShortcut
        onActivated: windows.simulateIncomingCall()
    }
    Shortcut {
        sequence: "F5"
        context: Qt.ApplicationShortcut
        onActivated: windows.simulateIncomingSms()
    }

    // Build a demo scene, as if the user had been using the phone for a bit.
    Component.onCompleted: {
        // --launch <appId>: open these apps, in card view, then stop.
        if (typeof simLaunch !== "undefined" && simLaunch.length > 0) {
            shell.unlock();
            // After the window source has built its app list.
            Qt.callLater(function() {
                for (var j = 0; j < simLaunch.length; ++j)
                    shell.launch(simLaunch[j]);
            });
            return;
        }
        // After the window source has built its app list.
        Qt.callLater(buildScene);
    }

    function buildScene() {
        var scene = typeof simScene !== "undefined" && simScene !== "" ? simScene : "locked";
        if (scene === "empty")
            return shell.unlock();
        if (scene !== "locked")
            shell.unlock();
        // Real apps where the simulator has them (Memos, Calculator), placeholders otherwise.
        var ids = ["Messaging", "Memos", "Calculator", "Web"].map(windows.appIdByTitle);
        var last = "";
        for (var i = 0; i < ids.length; ++i)
            last = windows.launch(ids[i], "");
        shell.cardView.position = 1;
        if (scene === "stacks" || scene === "reorder") {
            // Two extra Messaging windows stack with the first.
            var msg = windows.runningUid(windows.appIdByTitle("Messaging"));
            windows.openChild(msg);
            windows.openChild(msg);
            // After the child windows' own focus requests have run.
            Qt.callLater(function() {
                var cv = shell.cardView;
                cv.jumpTo(cv.groupIndexOf(msg));
                if (scene === "reorder") {
                    var uid = cv.currentUid;
                    var p = cv.layout.cards[uid];
                    cv.enterReorder(uid, p.cx, p.cy);
                    cv.moveReorder(p.cx + 20, p.cy - 30);
                }
            });
        } else if (scene === "maximized") {
            shell.cardView.maximizeProgress = 1;
        } else if (scene === "systemmenu") {
            shell.openSystemMenu();
        } else if (scene === "launcher") {
            shell.gestureUp();
        } else if (scene === "dashboard" || scene === "locked") {
            windows.notify(windows.appIdByTitle("Messaging"), "Palm Pre", "It's good to be back.");
            windows.notify(windows.appIdByTitle("Email"), "3 new emails", "webOS Phoenix build passed");
            windows.notify(windows.appIdByTitle("Calendar"), "Launch party", "Tomorrow, 9:41 AM");
            if (scene === "dashboard")
                shell.notifications.dashboardOpen = true;
        } else if (scene === "justtype") {
            shell.startJustType("m");
        }
    }
}
