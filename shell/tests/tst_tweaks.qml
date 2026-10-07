// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Advanced (docs/M6-PLAN.md F4; the community's Tweaks): the
// shell follows the system's tweaks. Cards: infinite cycling, a tap on a
// side card maximizes it; the wave launcher; the tap ripple, haptics,
// animation speed and gesture sensitivity.
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

    TestCase {
        name: "Tweaks"
        when: windowShown

        property var cv: shell.cardView

        function init() {
            sys.tweaks = {};
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.unlock();
            cv.clock = function () { return Date.now(); };
        }
        function cleanup() {
            sys.tweaks = {};
            var wave = findChild(shell, "waveLauncher");
            if (wave)
                wave.cancel();
            if (shell.launcherOpen)
                shell.gestureUp();
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            cv.jumpTo(0);
        }

        // Three apps in three stacks, card view on the last.
        function threeApps() {
            var a = windows.launch("org.webosphoenix.email", "");
            var b = windows.launch("org.webosphoenix.messaging", "");
            var c = windows.launch("org.webosphoenix.calendar", "");
            wait(0);
            cv.jumpTo(2);
            tryCompare(cv, "maximizeProgress", 0, 2000);
            return [a, b, c];
        }

        // A quick sideways swipe on the centre card (5 px/ms on the view's
        // own clock, so a busy machine does not change it).
        function flickSideways(dx) {
            var t = 1000;
            cv.clock = function () { return t; };
            var x = cv.width / 2, y = cv.cardOriginY;
            mousePress(cv, x, y);
            for (var i = 1; i <= 5; ++i) {
                t += 8;
                mouseMove(cv, x + dx * i / 5, y);
            }
            mouseRelease(cv, x + dx, y);
        }

        // LunaCE's infinite card cycling: past the last stack is the first,
        // and before the first the last; off, the ends stay ends.
        function test_infiniteCardCycling() {
            threeApps();
            flickSideways(-200);
            tryCompare(cv, "position", 2, 2000);
            sys.tweaks = { infiniteCardCycling: true };
            flickSideways(-200);
            tryCompare(cv, "position", 0, 3000);
            flickSideways(200);
            tryCompare(cv, "position", 2, 3000);
            // The keyboard's arrows and the advanced gestures wrap too.
            shell.forceActiveFocus();
            keyClick(Qt.Key_Right);
            tryCompare(cv, "position", 0, 3000);
            verify(cv.switchApp(false));
            tryCompare(cv, "position", 2, 3000);
        }

        // LunaCE's tap-to-maximize edge cards: a tap on the card peeking in
        // beside the centre one maximizes it; off, it comes to the centre.
        function test_tapSideCardMaximizes() {
            var uids = threeApps();
            cv.jumpTo(1);
            wait(50);
            var p = cv.layout.cards[uids[2]];
            verify(p.cx - cv.windowWidth * p.scale / 2 < cv.width - 10, "the next card shows at the edge");
            mouseClick(cv, cv.width - 5, cv.cardOriginY);
            tryCompare(cv, "position", 2, 2000);
            verify(!cv.maximized);
            cv.jumpTo(1);
            wait(50);
            sys.tweaks = { maximizeEdges: true };
            mouseClick(cv, cv.width - 5, cv.cardOriginY);
            tryCompare(cv, "maximizeProgress", 1, 2000);
            compare(cv.currentUid, uids[2]);
        }

        // The wave launcher: off, a slide up from the gesture area's side is
        // the swipe up; on, it raises the wave of the dock's apps and the
        // launcher button, the one under the finger lifted and named;
        // letting go there opens it.
        function test_waveLauncher() {
            var m = findChild(shell, "gestureMouse");
            var wave = findChild(shell, "waveLauncher");
            verify(m && wave);
            var dock = shell.launcherLayout.dock;
            verify(dock.length >= 2, "the dock has apps");
            sys.tweaks = { waveLauncher: true };
            var x0 = m.width * 0.1;
            mousePress(m, x0, m.height / 2);
            mouseMove(m, x0, -20);
            mouseMove(m, x0, -40);
            verify(wave.open, "a slide up from the side raises the wave");
            compare(wave.items.length, Math.min(dock.length, Theme.quickLaunchMaxItems - 1) + 1);
            compare(wave.items[wave.items.length - 1].appId, "");
            // Along the wave to the second app.
            var c = wave.mapToItem(m, wave._centre(1), wave.height - wave.baseHeight / 2);
            mouseMove(m, c.x, c.y);
            compare(wave.selected, 1);
            compare(findChild(wave, "waveTitle").text, wave.items[1].title);
            mouseRelease(m, c.x, c.y);
            verify(!wave.open);
            tryVerify(function() { return windows.runningUid(dock[1]) !== ""; }, 2000);
            // The launcher button opens the launcher.
            mousePress(m, m.width * 0.9, m.height / 2);
            mouseMove(m, m.width * 0.9, -40);
            var l = wave.mapToItem(m, wave._centre(wave.items.length - 1), wave.height - wave.baseHeight / 2);
            mouseMove(m, l.x, l.y);
            mouseRelease(m, l.x, l.y);
            tryVerify(function() { return shell.launcherOpen; }, 2000);
            shell.gestureUp();
            tryVerify(function() { return !shell.launcherOpen; }, 2000);
            // Let go far above the wave: the swipe up (card view), no app.
            var before = windows.cards.count;
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            mousePress(m, x0, m.height / 2);
            mouseMove(m, x0, -40);
            mouseMove(m, x0, -300);
            compare(wave.selected, -1);
            mouseRelease(m, x0, -300);
            tryVerify(function() { return !shell.maximized; }, 2000);
            compare(windows.cards.count, before);
            // Off: the same slide is the swipe up, no wave.
            sys.tweaks = {};
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            mousePress(m, x0, m.height / 2);
            mouseMove(m, x0, -40);
            verify(!wave.open);
            mouseRelease(m, x0, -40);
            tryVerify(function() { return !shell.maximized; }, 2000);
        }

        // The tap ripple (LunaCE's showReticleAnimation) and a buzz on
        // every tap (the Haptic Feedback Manager).
        function test_tapRippleAndHaptics() {
            var r = findChild(shell, "reticle");
            mouseClick(shell, 100, 200);
            verify(r.visible);
            tryCompare(r, "visible", false, 1000);
            var buzzes = shell.tapHaptics;
            sys.tweaks = { tapRipple: false, haptics: true };
            mouseClick(shell, 100, 200);
            verify(!r.visible);
            compare(shell.tapHaptics, buzzes + 1);
            sys.tweaks = {};
            mouseClick(shell, 100, 200);
            compare(shell.tapHaptics, buzzes + 1);
        }

        // Animation speed: Fast runs the shell's animations in 60% of the
        // time; gesture sensitivity scales how far a swipe must go.
        function test_animationSpeedAndGestureSensitivity() {
            compare(Theme.cardSlideDuration, 300);
            sys.tweaks = { animationSpeed: "fast" };
            compare(Theme.cardSlideDuration, 180);
            compare(Theme.launcherDuration, 210);
            var g = findChild(shell, "gestureBar");
            var normal = g.threshold;
            sys.tweaks = { gestureSensitivity: "high" };
            compare(g.threshold, Math.round(normal * 0.6));
            sys.tweaks = { gestureSensitivity: "low" };
            compare(g.threshold, Math.round(normal * 1.5));
            sys.tweaks = {};
            compare(Theme.cardSlideDuration, 300);
            compare(g.threshold, normal);
        }
    }
}
