// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A Pre 3 (480x800 at 1.5) on its side: the launcher's columns, the lock
// screen's alerts and PIN pad, and the system menu fit the 320 legacy
// pixels the screen has, and upright nothing changes. (tst_rotation has
// the same for a 320x480 phone.)
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 480
    height: 800

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        density: 1.5
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    TestCase {
        name: "Landscape"
        when: windowShown

        readonly property var rot: shell.rotator
        readonly property var ui: shell.uiRoot
        readonly property var lock: findChild(shell, "lockScreen")

        function turn(orientation) {
            sys.deviceOrientation = orientation;
            tryCompare(shell, "uiOrientation", orientation, 1000);
            tryVerify(function() { return !rot.rotating; }, 3000);
        }

        function init() {
            shell.unlock();
            sys.rotationLocked = false;
            turn("up");
        }
        function cleanup() {
            var panel = findChild(lock, "unlockPanel");
            panel.shown = false;
            findChild(shell, "systemMenu").open = false;
            shell.unlock();
            turn("up");
        }

        // The rectangle of `item` in the lock screen's coordinates.
        function rectIn(item, target) {
            var p = item.mapToItem(target, 0, 0);
            return { x: p.x, y: p.y, w: item.width, h: item.height, right: p.x + item.width, bottom: p.y + item.height };
        }
        function verifyInside(r, w, h, top, what) {
            verify(r.x >= -0.5 && r.right <= w + 0.5, what + " fits across: " + JSON.stringify(r));
            verify(r.y >= top - 0.5 && r.bottom <= h + 0.5, what + " fits down: " + JSON.stringify(r));
        }

        function test_launcherColumns() {
            var launcher = findChild(shell, "launcher");
            compare(launcher.columns, 3);
            turn("left");
            // 533 legacy pixels across: five of the upright 106.7 px cells.
            compare(launcher.columns, 5);
            fuzzyCompare(launcher.cellWidth, ui.width / 5, 0.01);
            turn("up");
            compare(launcher.columns, 3);
        }

        function test_pinPadSideways() {
            shell.lock();
            var panel = findChild(lock, "unlockPanel");
            panel.setupDialog(true, "Device Locked", "Enter PIN", false, 0);
            panel.shown = true;
            // Upright: the original's stacked panel, centred.
            verify(!panel.sideBySide);
            var cancel = findChild(panel, "unlockCancel"), done = findChild(panel, "unlockDone");
            fuzzyCompare(rectIn(cancel, panel).y, rectIn(done, panel).y, 0.5);
            fuzzyCompare(panel.y + panel.height / 2, lock.height / 2, 1);

            turn("left");
            verify(lock.sideways);
            verify(panel.stackedHeight > lock.height - Theme.statusBarHeight, "the stacked panel would not fit");
            verify(panel.sideBySide);
            var r = rectIn(panel, lock);
            verifyInside(r, lock.width, lock.height, Theme.statusBarHeight, "the panel");
            // Everything on it shows: the title, the keys, the buttons.
            var key1 = findChild(panel, "pinKey1"), del = findChild(panel, "pinKeyDelete");
            var emergency = findChild(panel, "unlockEmergency");
            var items = [cancel, done, key1, del];
            if (emergency.visible)
                items.push(emergency);
            for (var i = 0; i < items.length; ++i)
                verifyInside(rectIn(items[i], lock), lock.width, lock.height, Theme.statusBarHeight, items[i].objectName);
            // The buttons in a column at the left, the keypad to their right.
            verify(rectIn(cancel, panel).right <= rectIn(key1, panel).x, "buttons left of the keypad");
            verify(rectIn(done, panel).y >= rectIn(cancel, panel).bottom, "Done under Cancel");
            // The clock steps back behind it.
            tryCompare(findChild(lock, "lockDate"), "opacity", 0, 2000);

            turn("up");
            verify(!panel.sideBySide);
            fuzzyCompare(panel.y + panel.height / 2, lock.height / 2, 1);
        }

        function test_alertsBetweenDateAndPadlock() {
            turn("left");
            shell.lock();
            var date = rectIn(findChild(lock, "lockDate"), lock);
            var pad = rectIn(findChild(lock, "padlock"), lock);
            var banner = rectIn(findChild(lock, "lockBanner"), lock);
            // The frames' shadow may reach over, what shows may not. The
            // padlock's disc is 18 px inside its 100 px art; on the Pre 3 the
            // banner keeps under the date and just clears the disc.
            verify(banner.y + Theme.lockAlertsShadow >= date.bottom, "the banner is under the date");
            verify(banner.bottom - Theme.lockAlertsShadow <= pad.y + Theme.px(18),
                   "the banner is over the padlock: " + JSON.stringify([banner, pad]));
            var dash = rectIn(findChild(lock, "lockDashboard"), lock);
            verify(dash.y + Theme.lockAlertsShadow >= date.bottom, "the dashboard is under the date");
        }

        function test_systemMenuFitsAndScrolls() {
            turn("left");
            shell.openSystemMenu();
            var menu = findChild(shell, "systemMenu");
            tryCompare(menu, "open", true, 1000);
            var flick = findChild(menu, "systemMenuFlickable");
            var r = rectIn(flick, ui);
            // At most the positive space plus 10 (SystemMenu.cpp:945-953),
            // less the art's bottom margin: within the screen.
            verify(r.y >= Theme.statusBarHeight - 0.5);
            verify(r.bottom <= ui.height, "the menu ends on the screen: " + JSON.stringify(r));
            // Taller than that, it scrolls, with the arrow showing more below.
            verify(flick.contentHeight > flick.height);
            tryCompare(findChild(menu, "systemMenuScrollDown"), "opacity", 1, 1000);
            flick.contentY = flick.contentHeight - flick.height;
            verify(flick.atYEnd);
        }
    }
}
