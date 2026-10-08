// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The gesture area driven as the simulator's users drive it: a mouse or a
// trackpad's click-drag, which often rests a moment after the press before
// it moves, and a trackpad's two-finger swipe (wheel events with a pixel
// delta and scroll phases) with the pointer on the area. The swipe up out
// of Just Type, the wave launcher and advanced gestures' long swipe; the
// plain swipes still what they were.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim
import Phoenix.Native

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        density: 1
        virtualKeyboard: true
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    Component {
        id: spyComponent
        SignalSpy {}
    }

    TestCase {
        name: "GestureMouse"
        when: windowShown

        readonly property var bar: findChild(shell, "gestureBar")
        readonly property var m: findChild(shell, "gestureMouse")
        readonly property var cv: shell.cardView

        function init() {
            shell.unlock();
            sys.tweaks = {};
            sys.advancedGestures = false;
        }

        function cleanup() {
            var wave = findChild(shell, "waveLauncher");
            if (wave)
                wave.cancel();
            if (shell.justTypeOpen)
                shell.gestureUp();
            tryVerify(function() { return !shell.justTypeOpen; }, 2000);
            shell.hideKeyboard();
            shell.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", false, 2000);
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            cv.maximizeProgress = 0;
            if (shell.launcherOpen)
                shell.gestureUp();
            tryVerify(function() { return !shell.launcherOpen; }, 2000);
        }

        function spy(signalName) {
            return createTemporaryObject(spyComponent, root, { target: bar, signalName: signalName });
        }

        // A drag in the gesture area from (x, y) by (dx, dy) in steps, as a
        // mouse drag comes; rest: ms the pointer stays still after the
        // press first (a trackpad's click, then the slide).
        function drag(x, y, dx, dy, rest) {
            mousePress(m, x, y);
            if (rest)
                wait(rest);
            var n = 10;
            for (var i = 1; i <= n; ++i) {
                mouseMove(m, x + dx * i / n, y + dy * i / n);
                wait(5);
            }
            mouseRelease(m, x + dx, y + dy);
        }

        function justTypeWithKeyboard() {
            shell.startJustType("abc");
            tryVerify(function() { return shell.justTypeOpen; }, 2000);
            tryCompare(shell, "keyboardOpen", true, 2000);
            tryVerify(function() { return bar.cursorControl; }, 2000);
        }

        function maximizedApp() {
            var uid = windows.launch("org.webosphoenix.email", "");
            cv.maximize(uid);
            tryVerify(function() { return shell.maximized; }, 2000);
            return uid;
        }

        // A two-finger trackpad swipe over the area by (dx, dy), the way the
        // fingers went, as macOS sends it (qnsview_mouse.mm): a begin, the
        // updates, then the momentum after the fingers lift (its first
        // event an update, the fingers' end dropped; or, endFirst, the
        // fingers' end and the momentum's begin), and the end.
        // natural: natural scrolling (the content follows the fingers; the
        // event says it is inverted); otherwise the deltas go the other way.
        function trackpad(x, dx, dy, natural, endFirst) {
            var y = m.height / 2, s = natural ? 1 : -1, n = 8;
            function send(px, py, phase) {
                KeyInjector.sendWheel(m, x, y, Qt.point(Math.round(s * px), Math.round(s * py)),
                                      Qt.point(Math.round(s * px * 2), Math.round(s * py * 2)), phase, natural);
            }
            send(0, 0, Qt.ScrollBegin);
            for (var i = 0; i < n; ++i) {
                send(dx / n, dy / n, Qt.ScrollUpdate);
                wait(8);
            }
            if (endFirst)
                send(0, 0, Qt.ScrollEnd);
            for (var k = 0; k < 4; ++k) {
                var f = Math.pow(0.85, k + 1);
                send(dx / n * f, dy / n * f, k > 0 ? Qt.ScrollMomentum : endFirst ? Qt.ScrollBegin : Qt.ScrollUpdate);
                wait(8);
            }
            send(0, 0, Qt.ScrollEnd);
        }

        // Just Type up: the swipe up leaves it (SystemUiController.cpp:
        // 473-476), quick or after the pointer rested a moment on the area,
        // which with the keyboard up starts cursor control (the bug: the
        // hold took the rest of the drag as cursor steps, and the release
        // did nothing).
        function test_swipeUpLeavesJustType() {
            justTypeWithKeyboard();
            drag(m.width / 2, m.height / 2, 0, -120);
            tryVerify(function() { return !shell.justTypeOpen; }, 2000);

            justTypeWithKeyboard();
            mousePress(m, m.width / 2, m.height / 2);
            tryCompare(bar, "cursorActive", true, 1000);
            for (var d = 10; d <= 120; d += 10)
                mouseMove(m, m.width / 2 + d / 10, m.height / 2 - d);
            verify(!bar.cursorActive, "slid up: not the cursor");
            mouseRelease(m, m.width / 2 + 12, m.height / 2 - 120);
            tryVerify(function() { return !shell.justTypeOpen; }, 2000);
            compare(shell.cardView.maximizeProgress, 0);
        }

        // The hold and slide sideways still moves the cursor, a little
        // drift up or down included.
        function test_holdAndSlideSidewaysIsStillTheCursor() {
            justTypeWithKeyboard();
            var steps = spy("cursorStep"), ups = spy("up");
            mousePress(m, m.width / 2, m.height / 2);
            tryCompare(bar, "cursorActive", true, 1000);
            for (var i = 1; i <= 6; ++i)
                mouseMove(m, m.width / 2 - i * bar.cursorStepWidth, m.height / 2 - i * 2);
            verify(bar.cursorActive);
            compare(steps.count, 6);
            mouseRelease(m, m.width / 2 - 6 * bar.cursorStepWidth, m.height / 2 - 12);
            compare(ups.count, 0);
            verify(shell.justTypeOpen);
        }

        // The wave launcher (Settings > Advanced, off by default): from a
        // side of the area, quick, or after a rest with the keyboard up.
        function test_waveFromASide() {
            var wave = findChild(shell, "waveLauncher");
            var ups = spy("up");
            maximizedApp();
            // Off: the slide is the swipe up.
            drag(m.width * 0.1, m.height / 2, 0, -60);
            verify(!wave.open);
            compare(ups.count, 1);
            tryCompare(cv, "maximizeProgress", 0, 2000);

            sys.tweaks = { waveLauncher: true };
            maximizedApp();
            mousePress(m, m.width * 0.1, m.height / 2);
            for (var d = 10; d <= 60; d += 10)
                mouseMove(m, m.width * 0.1, m.height / 2 - d);
            verify(wave.open, "a slide up from the side raises the wave");
            // Let go far above it: the swipe up.
            mouseRelease(m, m.width / 2, m.height / 2 - 300);
            tryVerify(function() { return !wave.open; }, 2000);
            tryCompare(cv, "maximizeProgress", 0, 2000);

            // From the centre it stays the swipe up.
            maximizedApp();
            drag(m.width / 2, m.height / 2, 0, -60);
            verify(!wave.open);
            tryCompare(cv, "maximizeProgress", 0, 2000);

            // A rest after the press with the keyboard up (cursor control).
            justTypeWithKeyboard();
            mousePress(m, m.width * 0.9, m.height / 2);
            tryCompare(bar, "cursorActive", true, 1000);
            for (d = 10; d <= 60; d += 10)
                mouseMove(m, m.width * 0.9, m.height / 2 - d);
            verify(wave.open, "the wave, not the cursor");
            mouseRelease(m, m.width / 2, m.height / 2 - 300);
            tryVerify(function() { return !wave.open; }, 2000);
        }

        // Advanced gestures (Screen & Lock, off by default): a swipe across
        // the centre over half the area is the app beside; shorter, or with
        // them off, it is back. Up and back are not taken by it.
        function test_longSwipeAndBack() {
            var prev = spy("previous"), next = spy("next"), backs = spy("back"), fwd = spy("forward"), ups = spy("up");
            drag(m.width * 0.9, m.height / 2, -m.width * 0.7, 0);
            compare(backs.count, 1);
            sys.advancedGestures = true;
            tryVerify(function() { return bar.advancedGestures; }, 1000);
            drag(m.width * 0.9, m.height / 2, -m.width * 0.7, 0);
            compare(prev.count, 1);
            drag(m.width * 0.1, m.height / 2, m.width * 0.7, -10, 500);
            compare(next.count, 1);
            // Short: back and forward still.
            drag(m.width * 0.7, m.height / 2, -m.width * 0.3, 0);
            compare(backs.count, 2);
            drag(m.width * 0.3, m.height / 2, m.width * 0.3, 0);
            compare(fwd.count, 1);
            // Up, from anywhere, even ending across the centre.
            drag(m.width * 0.3, m.height / 2, m.width * 0.2, -150);
            compare(ups.count, 1);
            compare(prev.count, 1);
            compare(next.count, 1);
        }

        // A trackpad's two-finger swipe with the pointer on the area: the
        // same swipes, the way the fingers went, natural scrolling or not.
        function test_trackpadSwipes() {
            var ups = spy("up"), downs = spy("down"), backs = spy("back"), fwd = spy("forward"), prev = spy("previous");
            maximizedApp();
            trackpad(m.width / 2, 0, -80, true);
            compare(ups.count, 1);
            tryCompare(cv, "maximizeProgress", 0, 2000);
            trackpad(m.width / 2, 0, 80, true, true);
            compare(downs.count, 1);
            trackpad(m.width / 2, 0, -80, false);
            compare(ups.count, 2);
            trackpad(m.width / 4, -80, 0, true);
            compare(backs.count, 1);
            trackpad(m.width / 4, 80, 0, false, true);
            compare(fwd.count, 1);
            // A long one: the app beside, with advanced gestures on.
            sys.advancedGestures = true;
            tryVerify(function() { return bar.advancedGestures; }, 1000);
            trackpad(m.width / 4, -200, 0, true);
            compare(prev.count, 1);
            compare(backs.count, 1);
            // Too short to be a gesture: nothing.
            trackpad(m.width / 2, 5, -5, true);
            compare(ups.count + downs.count + backs.count + fwd.count + prev.count, 6);
            // Without the end phase (a platform that sends none) it ends
            // when the events stop.
            for (var i = 0; i < 6; ++i)
                KeyInjector.sendWheel(m, m.width / 2, m.height / 2, Qt.point(0, -15), Qt.point(0, -60), Qt.NoScrollPhase, true);
            tryCompare(ups, "count", 3, 1000);
        }

        // A mouse wheel's notches over the area are not gestures.
        function test_mouseWheelIsNoGesture() {
            var ups = spy("up"), downs = spy("down");
            mouseWheel(m, m.width / 2, m.height / 2, 0, 120);
            mouseWheel(m, m.width / 2, m.height / 2, 0, -120);
            wait(Theme.wheelGestureEndDelay + 50);
            compare(ups.count + downs.count, 0);
        }
    }
}
