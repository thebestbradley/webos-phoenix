// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The community's system options (docs/M6-PLAN.md F4 item 3): Power held
// 3 s asks luna-systemui for its power menu (com.palm.display
// powerKeyPressed {showDialog: true}); the system menu's Flashlight row
// (LuneOS's torchd); the battery's percentage in the status bar.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    // Stands in for org.webosports.service.torch.
    QtObject {
        id: torchd
        property bool available: true
        property bool on: false
        property var calls: []
        function lunaCall(uri, params, callback) {
            calls.push(uri);
            if (!available)
                return callback({ returnValue: false, errorText: "no torch on this device" });
            if (/\/set$/.test(uri))
                on = !!params.on;
            callback({ returnValue: true, available: true, on: on, brightness: on ? 100 : 0 });
        }
    }
    SystemMenu {
        id: menu
        width: 320
        height: 480
        system: SimSystemStatus { id: menuSys }
        source: torchd
        onCloseRequested: open = false
    }

    TestCase {
        name: "PowerMenu"
        when: windowShown

        function init() {
            shell.unlock();
            shell.display.turnOn();
            windows.displaySignals = [];
            sys.tweaks = {};
        }

        // Held 3 s, the screen on and unlocked: the signal, and the release
        // is eaten (the screen stays on). A press alone turns the screen off.
        function test_powerHeldAsksForThePowerMenu() {
            keyPress(Qt.Key_F3);
            wait(shell.powerHoldInterval / 2);
            compare(windows.displaySignals.length, 0);
            tryVerify(function() { return windows.displaySignals.length === 1; }, shell.powerHoldInterval * 2);
            compare(windows.displaySignals[0], "powerKeyPressed");
            keyRelease(Qt.Key_F3);
            compare(shell.display.state, "on");
            keyPress(Qt.Key_F3);
            keyRelease(Qt.Key_F3);
            compare(shell.display.state, "off");
            compare(windows.displaySignals.length, 1);
        }

        // Not while locked (DisplayManager starts its timer only with the
        // screen on and unlocked, or in dock mode), and not for a chord.
        function test_notLockedNorAChord() {
            verify(!shell.powerKeyHeld() || true);
            windows.displaySignals = [];
            shell.lock();
            verify(!shell.powerKeyHeld());
            compare(windows.displaySignals.length, 0);
            shell.unlock();
            // Power with Volume Up: the Full Erase chord's start.
            keyPress(Qt.Key_F3);
            keyPress(Qt.Key_F11);
            wait(shell.powerHoldInterval + 300);
            keyRelease(Qt.Key_F11);
            keyRelease(Qt.Key_F3);
            compare(windows.displaySignals.length, 0);
            shell.display.turnOn();
        }

        // The Flashlight row: shown where there is a torch, its label as
        // the rows above, a tap turns it on.
        function test_flashlightRow() {
            torchd.on = false;
            menu.open = true;
            var row = findChild(menu, "systemMenuFlashlight");
            tryCompare(row, "visible", true, 1000);
            compare(row.label, "Turn on Flashlight");
            // The row has just come into the menu's Column (placed on
            // polish), last, below the menu's 410 px: scrolled to.
            waitForItemPolished(row.parent);
            var flick = findChild(menu, "systemMenuFlickable");
            flick.contentY = Math.max(0, flick.contentHeight - flick.height);
            var p = row.mapToItem(menu, row.width / 2, row.height / 2);
            verify(p.y > 0 && p.y < flick.mapToItem(menu, 0, flick.height).y, "the row is in view: " + p.y);
            mouseClick(menu, p.x, p.y);
            verify(torchd.on);
            tryCompare(menu, "open", false, 2000);
            // The row keeps its label until the menu has faded out
            // (delayUpdate, as the rows above).
            tryCompare(menu, "visible", false, 2000);
            menu.open = true;
            tryCompare(row, "label", "Turn off Flashlight", 1000);
            menu.open = false;
            tryCompare(menu, "visible", false, 2000);
            torchd.available = false;
            menu.open = true;
            tryCompare(row, "visible", false, 1000);
            menu.open = false;
            torchd.available = true;
        }

        // Settings > Advanced > Battery percentage: the charge beside the
        // battery, red when low, amber to 20%, green while charging.
        function test_batteryPercent() {
            var t = findChild(shell, "batteryPercent");
            verify(!t.visible);
            sys.tweaks = { batteryPercent: true };
            verify(t.visible);
            compare(t.text, sys.batteryPercent + "%");
            sys.batteryPercent = 10;
            compare(t.text, "10%");
            compare(String(t.color), "#ff4d40");
            sys.batteryPercent = 18;
            compare(String(t.color), "#ffc21a");
            sys.charging = true;
            compare(String(t.color), "#8ce05a");
            sys.charging = false;
            sys.batteryPercent = 76;
        }
    }
}
