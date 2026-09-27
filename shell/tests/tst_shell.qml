// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Behaviour tests for the card view and shell navigation.
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

    TestCase {
        name: "Shell"
        when: windowShown

        function init() {
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            while (windows.notifications.count > 0)
                windows.dismissNotification(0);
            shell.cardView.position = 0;
            shell.cardView.maximizeProgress = 0;
            shell.unlock();
        }

        function test_scaleMatchesLegacy() {
            // 320px wide phone: 1 legacy px == 1 device px.
            compare(Theme.u, 1.0);
            compare(Theme.statusBarHeight, 28);
            compare(Theme.activeCardRatio, 0.659);
            compare(Theme.nonActiveCardRatio, 0.61);
            // Pre: 452px window area minus the gesture strip, less the 48px pill.
            var cv = shell.cardView;
            fuzzyCompare(cv.baseActiveScale, (cv.windowHeight - 48) * 0.659 / cv.windowHeight, 0.0001);
        }

        function test_launchInsertsNextToCurrentCard() {
            var a = windows.launch("org.webosphoenix.email", "");
            var b = windows.launch("org.webosphoenix.calendar", a);
            var c = windows.launch("org.webosphoenix.memos", a);
            compare(windows.cards.count, 3);
            compare(windows.cards.get(0).uid, a);
            compare(windows.cards.get(1).uid, c);
            compare(windows.cards.get(2).uid, b);
        }

        function test_relaunchFocusesExistingCard() {
            var a = windows.launch("org.webosphoenix.email", "");
            compare(windows.launch("org.webosphoenix.email", ""), a);
            compare(windows.cards.count, 1);
        }

        function test_shellLaunchMaximizes() {
            shell.launch("org.webosphoenix.email");
            // maximized flips only when the animation lands exactly on 1.
            tryVerify(function() { return shell.maximized; }, 2000);
            shell.gestureUp();
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
        }

        function test_closeLastCardSlidesLeft() {
            windows.launch("org.webosphoenix.email", "");
            windows.launch("org.webosphoenix.calendar", "");
            var last = windows.launch("org.webosphoenix.memos", "");
            shell.cardView.position = 2;
            shell.cardView.close(last);
            compare(windows.cards.count, 2);
            tryCompare(shell.cardView, "position", 1, 2000);
        }

        function test_closeMiddleKeepsPosition() {
            windows.launch("org.webosphoenix.email", "");
            var mid = windows.launch("org.webosphoenix.calendar", "");
            var last = windows.launch("org.webosphoenix.memos", "");
            shell.cardView.position = 1;
            shell.cardView.close(mid);
            compare(shell.cardView.position, 1);
            compare(shell.cardView.currentUid, last);
        }

        function test_flickUpClosesCard() {
            windows.launch("org.webosphoenix.email", "");
            wait(50);
            var cv = shell.cardView;
            var x = cv.width / 2, y = cv.cardOriginY;
            mousePress(cv, x, y);
            for (var i = 1; i <= 10; ++i)
                mouseMove(cv, x, y - i * 25, 5);
            mouseRelease(cv, x, y - 250);
            tryCompare(windows.cards, "count", 0, 2000);
        }

        function test_tapCardMaximizes() {
            windows.launch("org.webosphoenix.email", "");
            wait(50);
            mouseClick(shell.cardView, shell.cardView.width / 2, shell.cardView.cardOriginY);
            tryCompare(shell.cardView, "maximizeProgress", 1, 2000);
        }

        function test_backGoesToApp() {
            var uid = windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximizeProgress = 1;
            windows.windowFor(uid).detail = "Inbox";
            shell.gestureBack();
            compare(windows.windowFor(uid).detail, "");
        }

        function test_upGestureTogglesLauncherInCardView() {
            verify(!shell.launcherOpen);
            shell.gestureUp();
            verify(shell.launcherOpen);
            shell.gestureUp();
            verify(!shell.launcherOpen);
        }

        function test_lockedIgnoresGestures() {
            shell.lock();
            shell.gestureUp();
            verify(!shell.launcherOpen);
            shell.unlock();
        }
    }
}
