// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Tablet-only behaviour.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 1024
    height: 768

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "tablet"
        density: 1
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    TestCase {
        name: "Tablet"
        when: windowShown

        function init() {
            sys.deviceOrientation = "up";
            tryCompare(shell, "uiOrientation", "up", 3000);
            tryVerify(function() { return !shell.rotator.rotating; }, 3000);
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.cardView.maximizeProgress = 0;
            shell.keyboardOpen = false;
            shell.unlock();
            if (shell.launcherOpen)
                shell.gestureUp();
            tryCompare(shell, "launcherOpen", false, 2000);
        }

        function flickUp(distance) {
            var x = root.width / 2, y = root.height - 2;
            mousePress(root, x, y);
            for (var d = 10; d <= distance; d += 10)
                mouseMove(root, x, y - d);
            mouseRelease(root, x, y - distance);
        }

        function test_bottomEdgeFlickLeavesTheApp() {
            verify(shell.tablet);
            compare(Theme.gestureAreaHeight, 0);
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            flickUp(80);
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
            // In card view it opens the launcher, and again closes it.
            flickUp(80);
            tryCompare(shell, "launcherOpen", true, 2000);
            flickUp(80);
            tryCompare(shell, "launcherOpen", false, 2000);
        }

        // S7: the clock at the right end; the bar's fill fades in while an
        // app is up and out in card view.
        function test_statusBar() {
            verify(findChild(shell, "tabletClock").visible);
            verify(!findChild(shell, "centreClock").visible);
            var fill = findChild(shell, "statusBarFill");
            tryCompare(fill, "opacity", 0, 1000);
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            tryCompare(fill, "opacity", 1, 1000);
            shell.cardView.minimize();
            tryCompare(fill, "opacity", 0, 1500);
        }

        // Turned to portrait (the TouchPad held with its home button down):
        // still the tablet layout, laid out 768 wide; the bottom-edge flick
        // comes from the UI's bottom edge, wherever that is on the screen
        // (handleScreenEdgeFlickGesture, SystemUiController.cpp:2041-2070).
        function test_portrait() {
            sys.deviceOrientation = "right";
            tryCompare(shell, "uiOrientation", "right", 1000);
            tryVerify(function() { return !shell.rotator.rotating; }, 2000);
            var ui = shell.uiRoot;
            compare(ui.width, 768);
            compare(ui.height, 1024);
            verify(shell.tablet);
            compare(findChild(shell, "statusBar").width, 768);
            verify(findChild(shell, "tabletClock").visible);
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            // Up from the UI's bottom edge: on the screen, its right edge.
            var from = ui.mapToItem(root, ui.width / 2, ui.height - 2);
            verify(from.x > root.width - 10);
            mousePress(root, from.x, from.y);
            for (var d = 10; d <= 80; d += 10) {
                var p = ui.mapToItem(root, ui.width / 2, ui.height - 2 - d);
                mouseMove(root, p.x, p.y);
            }
            var to = ui.mapToItem(root, ui.width / 2, ui.height - 82);
            mouseRelease(root, to.x, to.y);
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
            // The launcher fits as many 140 px columns as the width takes.
            shell.gestureUp();
            tryCompare(shell, "launcherOpen", true, 2000);
            compare(findChild(shell, "launcher").columns, 5);
        }

        function test_shortFlicksAndTheKeyboard() {
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            flickUp(20);
            wait(500);
            verify(shell.maximized);
            // With the keyboard up it must go at least 60 px.
            shell.keyboardOpen = true;
            flickUp(50);
            wait(500);
            verify(shell.maximized);
            flickUp(70);
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
        }
    }
}
