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

    // Stands in for an app's web view, which takes every key it is given.
    TextInput {
        id: appField
        width: 100; height: 20
        // Not counting the modifier keys themselves, which apps do see.
        Keys.onPressed: (event) => {
            if ([Qt.Key_Control, Qt.Key_Alt, Qt.Key_Meta, Qt.Key_Shift].indexOf(event.key) < 0)
                appField.keysSeen++;
        }
        property int keysSeen: 0
    }

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

        // Regression: the keys reach the shell while an app has the
        // keyboard focus (they did not: the web view swallowed them), and
        // the app never sees them.
        function test_keysWhileAnAppHasTheFocus() {
            appField.forceActiveFocus();
            appField.keysSeen = 0;
            verify(appField.activeFocus);
            keyClick(Qt.Key_F9);
            tryCompare(taken, "count", 1, 2000);
            wait(50);
            keyClick(Qt.Key_P, Qt.ControlModifier | Qt.AltModifier);
            tryCompare(taken, "count", 2, 2000);
            wait(50);
            keyClick(Qt.Key_P, Qt.MetaModifier | Qt.AltModifier);    // Control+Option+P on a Mac
            tryCompare(taken, "count", 3, 2000);
            wait(50);
            keyPress(Qt.Key_Home);
            keyPress(Qt.Key_F3);
            keyRelease(Qt.Key_F3);
            keyRelease(Qt.Key_Home);
            tryCompare(taken, "count", 4, 2000);
            verify(!shell.locked, "the chord did not lock");
            compare(appField.keysSeen, 0, "the app saw none of them");
            // Other keys still go to the app.
            keyClick(Qt.Key_A);
            compare(appField.keysSeen, 1);
            compare(appField.text, "a");
            shell.forceActiveFocus();
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
