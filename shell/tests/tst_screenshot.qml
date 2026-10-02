// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Screen captures (docs/SCREENSHOTS.md SC1): Home + Power together, as
// WindowServer.cpp:629-683 had it, and the keyboard's keys; the flash; the
// picture handed to the window source. Home and Power alone still do their
// jobs, on release.
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
        system: SimSystemStatus {}
    }

    SignalSpy { id: taken; target: shell; signalName: "screenshotTaken" }

    TestCase {
        name: "Screenshot"
        when: windowShown

        function init() {
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.unlock();
            shell.forceActiveFocus();
            taken.clear();
            windows._pendingCaptures = [];
        }

        function test_homeAndPowerTakeACapture() {
            var uid = shell.launch("org.webosphoenix.email");
            // Its card up and still: maximizeProgress alone can read 1 from
            // the test before, ahead of the new card's rise.
            tryVerify(function() { var cv = shell.cardView; return cv.currentUid === uid && cv.maximized && !cv.animating; }, 3000);
            keyPress(Qt.Key_Home);
            keyPress(Qt.Key_F3);                // the simulator's Power
            keyRelease(Qt.Key_F3);
            keyRelease(Qt.Key_Home);
            tryCompare(taken, "count", 1, 2000);
            compare(taken.signalArguments[0][0], "Email", "named after the app in front");
            verify(taken.signalArguments[0][1] > 0, "a PNG");
            verify(findChild(shell, "screenCaptureFlash").opacity > 0, "the flash");
            // Neither key did its own job: still unlocked, the card still up.
            verify(!shell.locked);
            compare(shell.cardView.maximizeProgress, 1);
            // No web page runs here: the capture waits for one.
            compare(windows._pendingCaptures.length, 1);
            verify(/__phoenixRuntime\.saveScreenshot\(.*"app":"Email"/.test(windows._pendingCaptures[0]));
            tryCompare(findChild(shell, "screenCaptureFlash"), "visible", false, 2000);
        }

        function test_powerFirstAlsoWorks() {
            keyPress(Qt.Key_F3);
            keyPress(Qt.Key_Home);
            keyRelease(Qt.Key_Home);
            keyRelease(Qt.Key_F3);
            tryCompare(taken, "count", 1, 2000);
            compare(taken.signalArguments[0][0], "Card View");
            verify(!shell.locked);
        }

        function test_keyboardKeys() {
            keyClick(Qt.Key_F9);
            tryCompare(taken, "count", 1, 2000);
            wait(50);
            keyClick(Qt.Key_P, Qt.ControlModifier | Qt.AltModifier);
            tryCompare(taken, "count", 2, 2000);
        }

        function test_homeAndPowerAloneStillWork() {
            keyClick(Qt.Key_F3);
            verify(shell.locked, "Power alone locks");
            shell.unlock();
            shell.forceActiveFocus();
            verify(!shell.launcherOpen);
            keyClick(Qt.Key_Home);
            verify(shell.launcherOpen, "Home alone, with no app up, opens the launcher");
            keyClick(Qt.Key_Home);
            verify(!shell.launcherOpen);
            compare(taken.count, 0);
        }
    }
}
