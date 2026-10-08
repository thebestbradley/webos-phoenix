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
        SignalSpy { id: previewOpened; target: shell; signalName: "capturePreviewOpened" }
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
            // The page saving it was handed the capture's id.
            verify(thumb.capture !== "");
            verify(windows._pendingCaptures[windows._pendingCaptures.length - 1].indexOf('"capture":"' + thumb.capture + '"') >= 0);
            // Another capture's notification (an earlier one, saved late)
            // is not this one's file.
            windows.notify("org.webosphoenix.screenshot", "Screen captured", "Older",
                           { path: "/media/internal/screencaptures/Older.png", capture: "capture-older" });
            compare(thumb.path, "");
            // The runtime saved it and posted its notification: the path.
            var path = "/media/internal/screencaptures/Card View 2026-10-02 at 01.05.09.png";
            windows.notify("org.webosphoenix.screenshot", "Screen captured", "Card View 2026-10-02 at 01.05.09",
                           { path: path, capture: thumb.capture });
            compare(thumb.path, path);
            previewOpened.clear();
            mouseClick(findChild(thumb, "screenCaptureThumbnailArea"));
            compare(thumbTapped.count, 1);
            compare(thumbTapped.signalArguments[0][0], path);
            verify(!thumb.shown);
            // The shell launches org.webosphoenix.screenshot with {path}
            // (this test's window source has no such app).
            compare(previewOpened.count, 1);
            compare(previewOpened.signalArguments[0][0], path);
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

        // Tapped before the capture is stored (a big one takes a moment to
        // encode and save): the preview opens on it once it is, not on
        // the newest capture saved before it.
        function test_thumbnailTappedBeforeTheCaptureIsSaved() {
            var thumb = findChild(shell, "screenCaptureThumbnail");
            previewOpened.clear();
            keyClick(Qt.Key_F9);
            tryCompare(taken, "count", 1, 2000);
            tryCompare(thumb, "x", Theme.px(16), 1000);
            var id = thumb.capture;
            compare(thumb.path, "");
            mouseClick(findChild(thumb, "screenCaptureThumbnailArea"));
            verify(!thumb.shown);
            compare(previewOpened.count, 0, "nothing to open yet");
            // Another capture's file: not it.
            windows.notify("org.webosphoenix.screenshot", "Screen captured", "Older",
                           { path: "/media/internal/screencaptures/Older.png", capture: "capture-older" });
            compare(previewOpened.count, 0);
            var path = "/media/internal/screencaptures/Card View 2026-10-08 at 02.00.04.png";
            windows.notify("org.webosphoenix.screenshot", "Screen captured", "Card View 2026-10-08 at 02.00.04",
                           { path: path, capture: id });
            compare(previewOpened.count, 1);
            compare(previewOpened.signalArguments[0][0], path);
            // Only once.
            windows.notify("org.webosphoenix.screenshot", "Screen captured", "again", { path: path, capture: id });
            compare(previewOpened.count, 1);
        }

        // The page that saves a capture has the runtime: never a site (an
        // https:// web app, whose page has none), and the next page when
        // the first turns out not to have it.
        Component {
            id: fakePage
            QtObject {
                property bool site: false
                property var scripts: []
                property var answer: true
                function runScript(js, done) {
                    scripts.push(js);
                    if (done)
                        done(answer);
                }
            }
        }
        function test_captureSavedOnAPageWithTheRuntime() {
            var site = createTemporaryObject(fakePage, root, { site: true });
            var loading = createTemporaryObject(fakePage, root, { answer: null });
            var app = createTemporaryObject(fakePage, root);
            windows._windows["fake-site"] = site;
            windows._windows["fake-loading"] = loading;
            windows._windows["fake-app"] = app;
            try {
                windows.saveScreenshot("iVBORw0KGgo=", "Site", "capture-x");
                compare(site.scripts.length, 0, "not the site");
                compare(loading.scripts.length, 1, "tried");
                compare(app.scripts.length, 1, "then the next page");
                verify(/__phoenixRuntime\.saveScreenshot\(.*"capture":"capture-x"/.test(app.scripts[0]));
                compare(windows._pendingCaptures.length, 0);
            } finally {
                delete windows._windows["fake-site"];
                delete windows._windows["fake-loading"];
                delete windows._windows["fake-app"];
            }
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
