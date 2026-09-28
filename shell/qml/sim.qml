// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Desktop simulator entry point (loaded by phoenix-sim).
//
// Context properties set by phoenix-sim:
//   simScene       "locked" | "cards" | "stacks" | "reorder" | "maximized" | "heldcard" | "launcher" |
//                  "launcheredit" | "pin" | "lowbattery" | "banner" | "notified" | "dashboard" | "justtype" | "keyboard" |
//                  "systemmenu" | "empty"
//   simFormFactor  "auto" | "phone" | "tablet"
//   simDensity     device pixels per legacy pixel (--scale, default 1)
//   simLaunch      app ids to launch (--launch)
//   simOpen        a web address to open in the browser (--open)
//   simDisplayWidth, simDisplayHeight  the device's screen upright (--size)
//   simOrientation how the device is held at start-up (--orientation)
//   simTurn        an orientation to turn the device to after a second (--turn)

import QtQuick
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root

    // ---- The simulated device ----------------------------------------------------
    // The window shows the device as it is held: turned on its side it is a
    // landscape window with the device's screen turned in it, so a UI that
    // followed the turn reads upright, and one held by the rotation lock or
    // an app reads sideways, as it would in the hand.

    readonly property var orientations: ["up", "left", "down", "right"]   // counter-clockwise
    readonly property int deviceAngle: 90 * Math.max(0, orientations.indexOf(status.deviceOrientation))
    // The screen's shape upright (--size): its sides keep that shape
    // whatever the window does while it turns.
    readonly property bool displayPortrait: typeof simDisplayWidth === "undefined" || simDisplayWidth <= simDisplayHeight

    Item {
        id: device
        anchors.centerIn: parent
        width: root.displayPortrait ? Math.min(root.width, root.height) : Math.max(root.width, root.height)
        height: root.displayPortrait ? Math.max(root.width, root.height) : Math.min(root.width, root.height)
        rotation: -root.deviceAngle

        Shell {
            id: shell
            anchors.fill: parent
            formFactor: typeof simFormFactor !== "undefined" ? simFormFactor : "auto"
            density: typeof simDensity !== "undefined" ? simDensity : 1
            // The phones and the TouchPad of luna-sysmgr's day had one
            // ([VirtualKeyboard] VirtualKeyboardEnabled).
            virtualKeyboard: true
            source: SimWindowSource { id: windows }
            system: SimSystemStatus {
                id: status
                // Fixed clock for reproducible screenshots.
                fixedTime: typeof simScene !== "undefined" && simScene !== "" ? new Date(2009, 5, 6, 9, 41) : null
                deviceOrientation: typeof simOrientation !== "undefined" && simOrientation !== "" ? simOrientation : "up"
            }
        }
    }

    // Turn the device a quarter turn (steps: 1 counter-clockwise, -1
    // clockwise) or to an orientation; the window turns with it.
    function turnDevice(to) {
        var from = status.deviceOrientation;
        if (typeof to === "number")
            to = orientations[(orientations.indexOf(from) + to + 4) % 4];
        if (orientations.indexOf(to) < 0 || to === from)
            return;
        var win = root.Window.window;
        if (win && (orientations.indexOf(to) - orientations.indexOf(from)) % 2 !== 0) {
            var w = win.width;
            win.width = win.height;
            win.height = w;
        }
        status.deviceOrientation = to;
    }
    Shortcut {
        sequence: "Ctrl+Left"
        context: Qt.ApplicationShortcut
        onActivated: root.turnDevice(1)
    }
    Shortcut {
        sequence: "Ctrl+Right"
        context: Qt.ApplicationShortcut
        onActivated: root.turnDevice(-1)
    }
    // --turn: a second after start-up, for screenshots of the turn.
    Timer {
        running: typeof simTurn !== "undefined" && simTurn !== ""
        interval: 1000
        onTriggered: root.turnDevice(simTurn)
    }

    // How the UI and the device are turned, for the apps
    // (com.palm.systemmanager getSystemStatus).
    function pushOrientation() {
        windows.pushSystemStatus({ orientation: { ui: shell.uiOrientation, device: shell.deviceOrientation } });
    }
    Connections {
        target: shell
        function onUiOrientationChanged() { root.pushOrientation(); }
        function onDeviceOrientationChanged() { root.pushOrientation(); }
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
    // The lock screen, for the apps (com.palm.systemmanager getLockStatus):
    // the phone answers a ringing call when the user unlocks.
    Connections {
        target: shell
        function onLockedChanged() { windows.pushSystemStatus({ deviceLocked: shell.locked }); }
        // The keyboard is up (com.palm.systemmanager getSystemStatus ime.visible).
        function onKeyboardOpenChanged() { windows.pushSystemStatus({ ime: { visible: shell.keyboardOpen } }); }
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
    // F6: the battery runs low (5% and under: luna-systemui's Low Battery
    // alert). F7: plug a wall charger in or out ("Charging Battery").
    property string charger: "none"
    Shortcut {
        sequence: "F6"
        context: Qt.ApplicationShortcut
        onActivated: windows.simulatePower({ percent: 4, charger: "none" })
    }
    Shortcut {
        sequence: "F7"
        context: Qt.ApplicationShortcut
        onActivated: {
            root.charger = root.charger === "none" ? "wall" : "none";
            windows.simulatePower({ charger: root.charger, percent: root.charger === "none" ? 60 : 61 });
        }
    }

    // The launcher layout (icon order, dock) survives restarts (simSettings,
    // phoenix-sim's settings file).
    Connections {
        target: windows
        function onLauncherLayoutJsonChanged() {
            if (typeof simSettings !== "undefined" && windows.launcherLayoutJson !== "")
                simSettings.setValue("launcher/layout", windows.launcherLayoutJson);
        }
    }

    // Build a demo scene, as if the user had been using the phone for a bit.
    Component.onCompleted: {
        windows.pushSystemStatus({ deviceLocked: shell.locked });
        pushOrientation();
        if (typeof simSettings !== "undefined")
            windows.launcherLayoutJson = simSettings.value("launcher/layout");
        // --launch <appId>: open these apps, in card view, then stop.
        // --open <url>: open a web page in the browser, as a link would.
        var opening = typeof simOpen !== "undefined" && simOpen !== "";
        if (opening || (typeof simLaunch !== "undefined" && simLaunch.length > 0)) {
            shell.unlock();
            // After the window source has built its app list.
            Qt.callLater(function() {
                for (var j = 0; simLaunch && j < simLaunch.length; ++j)
                    shell.launch(simLaunch[j]);
                if (opening)
                    windows.openUrl(simOpen);
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
        if (scene !== "locked" && scene !== "pin")
            shell.unlock();
        // Real apps where the simulator has them (Memos, Calculator), placeholders otherwise.
        var ids = ["Messaging", "Memos", "Calculator", "Web"].map(windows.appIdByTitle);
        var last = "";
        for (var i = 0; i < ids.length; ++i)
            last = windows.launch(ids[i], "");
        // As after minimizing the last of them: the dock is back (adding the
        // cards hid it). Scenes that maximize hide it again.
        shell.dockShown = true;
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
        } else if (scene === "heldcard") {
            // Messaging keeps the upright orientation, as if it had called
            // PalmSystem.setWindowOrientation("up"): with the device on its
            // side it shows turned in card view (--orientation left). (Enyo
            // apps ask for "free" once loaded, so not one of those.)
            var held = windows.runningUid(ids[0]);
            windows.cards.setProperty(windows.cardIndex(held), "orientation", "up");
            shell.cardView.position = 0;
        } else if (scene === "systemmenu") {
            shell.openSystemMenu();
        } else if (scene === "launcher" || scene === "launcheredit") {
            shell.gestureUp();
            if (scene === "launcheredit")
                shell.launcherEditMode = true;
        } else if (scene === "lowbattery") {
            // An app is open; the battery drops to 4% and luna-systemui (booted
            // by the window source) raises its Low Battery alert.
            shell.cardView.maximizeProgress = 1;
            lowBatteryTimer.start();
        } else if (scene === "banner") {
            // An app is open; a notification comes in and the app makes room.
            shell.cardView.maximizeProgress = 1;
            windows.notify(windows.appIdByTitle("Messaging"), "Palm Pre", "It's good to be back.");
        } else if (scene === "dashboard" || scene === "notified" || scene === "locked") {
            if (scene !== "locked")
                shell.cardView.maximizeProgress = 1;
            windows.notify(windows.appIdByTitle("Messaging"), "Palm Pre", "It's good to be back.");
            windows.notify(windows.appIdByTitle("Email"), "3 new emails", "webOS Phoenix build passed");
            windows.notify(windows.appIdByTitle("Calendar"), "Launch party", "Tomorrow, 9:41 AM");
            if (scene === "dashboard")
                shell.notifications.dashboardOpen = true;
        } else if (scene === "pin") {
            // The PIN panel as it asks for the passcode (nothing is set: the
            // scene only shows it).
            var panel = shell.lockScreen.unlockPanel;
            panel.setupDialog(true, qsTr("Device Locked"), qsTr("Enter PIN"), false, 0);
            panel.shown = true;
        } else if (scene === "justtype") {
            shell.startJustType("m");
        } else if (scene === "keyboard") {
            // Just Type, its field focused: the keyboard comes up.
            shell.startJustType("");
        }
    }

    Timer {
        id: lowBatteryTimer
        interval: 3000
        onTriggered: windows.simulatePower({ percent: 4, charger: "none" })
    }
}
