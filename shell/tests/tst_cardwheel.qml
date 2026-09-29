// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Card view with a trackpad and a mouse wheel (Phoenix): a two-finger swipe
// sideways pans between stacks, up it throws the card away; a wheel notch
// moves one stack.
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
        name: "CardWheel"
        when: windowShown

        property var cv: shell.cardView
        property var wheel: findChild(shell, "cardWheel")

        function init() {
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.unlock();
            wheel.finish();
        }

        // Three apps in three stacks, card view on the middle one.
        function threeApps() {
            var a = windows.launch("org.webosphoenix.email", "");
            var b = windows.launch("org.webosphoenix.messaging", "");
            var c = windows.launch("org.webosphoenix.calendar", "");
            wait(0);
            cv.jumpTo(1);
            tryCompare(cv, "maximizeProgress", 0, 2000);
            return [a, b, c];
        }

        // A swipe of (dx, dy) in steps, with the events coming as a
        // trackpad's do, then the pause that ends it.
        function swipe(dx, dy) {
            var n = 10;
            for (var i = 0; i < n; ++i) {
                wheel.swipe(root.width / 2, root.height / 2, dx / n, dy / n);
                wait(8);
            }
            wait(Theme.wheelGestureEndDelay + 50);
        }

        function test_swipeLeftShowsTheNextStack() {
            threeApps();
            compare(cv.currentGroup, 1);
            swipe(-cv.groupSpacing() * 0.8, 0);
            tryCompare(cv, "position", 2, 2000);
            swipe(cv.groupSpacing() * 0.8, 0);
            tryCompare(cv, "position", 1, 2000);
        }

        function test_smallSwipeSettlesBack() {
            threeApps();
            swipe(-cv.groupSpacing() * 0.3, 0);
            tryCompare(cv, "position", 1, 2000);
        }

        function test_swipeUpClosesTheCard() {
            var u = threeApps();
            swipe(0, -root.height * 0.6);
            tryVerify(function() { return windows.cards.count === 2; }, 2000);
            verify(cv.indexOf(u[1]) < 0, "the middle card closed");
        }

        function test_shortSwipeUpSpringsBack() {
            var u = threeApps();
            swipe(0, -Theme.px(40));
            wait(Theme.cardSlideDuration + 100);
            compare(windows.cards.count, 3);
            tryCompare(cv.cardItem(u[1]), "flickOffset", 0, 1000);
        }

        function test_mouseWheelNotchMovesOneStack() {
            threeApps();
            mouseWheel(root, root.width / 2, root.height / 2, 0, -120);
            tryCompare(cv, "position", 2, 2000);
            mouseWheel(root, root.width / 2, root.height / 2, 0, 120);
            tryCompare(cv, "position", 1, 2000);
        }
    }
}
