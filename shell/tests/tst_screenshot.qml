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
            shell.cardView.maximizeProgress = 0;
            shell.unlock();
            shell.forceActiveFocus();
            taken.clear();
            windows._pendingCaptures = [];
            // An earlier test's thumbnail is still up for a few seconds.
            var thumb = findChild(shell, "screenCaptureThumbnail");
            thumb.hide();
            tryCompare(thumb, "visible", false, 2000);
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

        // As iOS: the capture's thumbnail in the bottom left corner; a tap
        // opens the file the runtime saved in the preview, a swipe to the
        // left puts it away, and it goes by itself after a few seconds.
        SignalSpy { id: thumbTapped; signalName: "activated" }
        function test_thumbnail() {
            var thumb = findChild(shell, "screenCaptureThumbnail");
            thumbTapped.target = thumb;
            thumbTapped.clear();
            verify(!thumb.visible);
            keyClick(Qt.Key_F9);
            tryCompare(taken, "count", 1, 2000);
            tryCompare(thumb, "x", Theme.px(16), 1000);
            verify(thumb.visible && thumb.shown);
            verify(String(findChild(thumb, "screenCaptureThumbnailImage").source) !== "", "the capture in it");
            verify(thumb.x + thumb.width < root.width / 2 && thumb.y + thumb.height > root.height / 2, "bottom left");
            // The runtime saved it and posted its notification: the path.
            var path = "/media/internal/screencaptures/Card View 2026-10-02 at 01.05.09.png";
            windows.notify("org.webosphoenix.screenshot", "Screen captured", "Card View 2026-10-02 at 01.05.09", { path: path });
            compare(thumb.path, path);
            mouseClick(findChild(thumb, "screenCaptureThumbnailArea"));
            compare(thumbTapped.count, 1);
            compare(thumbTapped.signalArguments[0][0], path);
            verify(!thumb.shown);
            // (The shell then launches org.webosphoenix.screenshot with
            // {path}; this test's window source has no such app.)
            tryCompare(thumb, "visible", false, 2000);

            // Swiped to the left: gone, nothing opened.
            wait(50);
            keyClick(Qt.Key_F9);
            tryCompare(taken, "count", 2, 2000);
            tryCompare(thumb, "x", Theme.px(16), 1000);
            var area = findChild(thumb, "screenCaptureThumbnailArea");
            var c = area.mapToItem(root, area.width / 2, area.height / 2);
            mousePress(root, c.x, c.y);
            for (var i = 1; i <= 8; ++i) { wait(16); mouseMove(root, c.x - i * thumb.width / 6, c.y); }
            mouseRelease(root, c.x - thumb.width * 8 / 6, c.y);
            verify(!thumb.shown);
            tryCompare(thumb, "visible", false, 2000);
            compare(thumbTapped.count, 1, "the swipe opened nothing");

            // Left alone: gone after a few seconds.
            wait(50);
            keyClick(Qt.Key_F9);
            tryCompare(taken, "count", 3, 2000);
            tryVerify(function() { return thumb.shown; }, 1000);
            tryVerify(function() { return !thumb.visible; }, Theme.screenCaptureThumbnailDuration + 2000);
        }

        // The simulator's other keys work with an app's page focused too:
        // Esc the back gesture, F1 the up gesture, F2 a notification.
        function test_otherSimKeysWhileAnAppHasTheFocus() {
            appField.forceActiveFocus();
            appField.keysSeen = 0;
            var n = windows.notifications.count;
            keyClick(Qt.Key_F2);
            compare(windows.notifications.count, n + 1, "F2: a notification");
            while (windows.notifications.count) windows.dismissNotification(0);
            shell.notifications.bannerActive = false;
            appField.forceActiveFocus();
            verify(!shell.launcherOpen);
            // In card view the first up gesture shows the dock, the next one
            // the launcher (as the gesture bar does).
            keyClick(Qt.Key_F1);
            if (!shell.launcherOpen) {
                verify(shell.dockShown, "F1: the up gesture shows the dock");
                appField.forceActiveFocus();
                keyClick(Qt.Key_F1);
            }
            verify(shell.launcherOpen, "F1: the up gesture opens the launcher");
            appField.forceActiveFocus();
            keyClick(Qt.Key_Escape);
            verify(!shell.launcherOpen, "Esc: back closes it");
            compare(appField.keysSeen, 0, "the app saw none of them");
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
