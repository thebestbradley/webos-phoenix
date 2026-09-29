// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The PIN pad's Emergency Call and the emergency window over the lock
// screen (EmergencyWindow.qml; Phone's restricted mode).
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
        system: SimSystemStatus { id: status }
    }

    SignalSpy { id: closedSpy; target: windows; signalName: "systemWindowClosed" }

    TestCase {
        name: "Emergency"
        when: windowShown

        function init() {
            shell.closeEmergency();
            shell.lock();
            closedSpy.clear();
            var panel = shell.lockScreen.unlockPanel;
            panel.setupDialog(true, "Device Locked", "Enter PIN", false, 0);
            panel.shown = true;
            tryCompare(panel, "opacity", 1, 1000);
        }

        function cleanup() {
            shell.closeEmergency();
            shell.lockScreen.unlockPanel.shown = false;
            shell.unlock();
        }

        function test_pinPadOffersEmergencyCall() {
            var button = findChild(shell, "unlockEmergency");
            verify(button, "Emergency Call button");
            verify(button.visible);
            compare(button.caption, "Emergency Call");
            // Between the keypad and Cancel / Done, the panel on screen.
            var panel = shell.lockScreen.unlockPanel;
            var done = findChild(shell, "unlockDone");
            verify(button.mapToItem(panel, 0, 0).y < done.mapToItem(panel, 0, 0).y);
            var top = panel.mapToItem(root, 0, 0).y;
            verify(top >= 0 && top + panel.height <= root.height, "panel fits: " + top + " + " + panel.height);
        }

        function test_emergencyCallOpensPhoneOverTheLockScreen() {
            mouseClick(findChild(shell, "unlockEmergency"));
            verify(shell.emergencyShown);
            verify(shell.locked, "still locked");
            var key = findChild(shell, "emergencyWindow").windowKey;
            compare(windows.systemWindows.count, 1);
            compare(windows.systemWindows.get(0).appId, "org.webosphoenix.phone");
            compare(windows.systemWindows.get(0).kind, "emergency");
            // Not a card.
            compare(windows.cards.count, 0);
            // The phone's window fills the emergency window, which fades in
            // above the lock screen and under the status bar.
            var host = findChild(shell, "emergencyWindow");
            tryCompare(host, "opacity", 1, 1000);
            var w = windows.windowFor(key);
            compare(w.parent, findChild(shell, "emergencyContent"));
            compare(w.width, host.width);
            compare(host.y, Theme.statusBarHeight);
            compare(host.height, root.height - Theme.gestureAreaHeight - Theme.statusBarHeight);
            // Only one at a time.
            verify(shell.openEmergency());
            compare(windows.systemWindows.count, 1);
        }

        function test_homeAndUpCloseItBackToThePinPad() {
            shell.openEmergency();
            shell.homeKey();
            verify(!shell.emergencyShown);
            compare(windows.systemWindows.count, 0);
            compare(closedSpy.count, 1);
            verify(shell.lockScreen.pinEntry, "back on the PIN pad");
            shell.openEmergency();
            shell.gestureUp();
            verify(!shell.emergencyShown);
            verify(shell.locked);
            // Nothing else happens behind it: no launcher, no card view.
            verify(!shell.launcherOpen);
        }

        function test_theAppClosingItsWindowEndsIt() {
            shell.openEmergency();
            var key = findChild(shell, "emergencyWindow").windowKey;
            windows.closeSystemWindow(key);
            verify(!shell.emergencyShown);
            tryCompare(findChild(shell, "emergencyWindow"), "opacity", 0, 1000);
            verify(shell.lockScreen.pinEntry);
        }

        function test_backGoesToThePage() {
            shell.openEmergency();
            var key = findChild(shell, "emergencyWindow").windowKey;
            var w = windows.windowFor(key);
            // The mock app goes back from a detail page.
            w.detail = "Medical ID";
            shell.gestureBack();
            compare(w.detail, "");
            verify(shell.emergencyShown, "the page decides");
        }

        function test_unlockClosesIt() {
            shell.openEmergency();
            shell.unlock();
            verify(!shell.emergencyShown);
        }

        function test_noEmergencyCallWithoutASource() {
            var lock = shell.lockScreen;
            verify(lock.emergencyAvailable);
            shell.source = null;
            verify(!lock.emergencyAvailable);
            verify(!findChild(shell, "unlockEmergency").visible);
            verify(!shell.openEmergency());
            shell.source = windows;
        }
    }
}
