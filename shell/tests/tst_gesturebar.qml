// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The gesture bar: on phones and tablets alike unless the device has a
// hardware Home button its maker uses instead (Shell.hardwareHomeButton).
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
        name: "GestureBar"
        when: windowShown

        function cleanup() {
            shell.hardwareHomeButton = false;
            sys.deviceOrientation = "up";
            tryCompare(shell, "uiOrientation", "up", 3000);
            tryVerify(function() { return !shell.rotator.rotating; }, 3000);
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.cardView.maximizeProgress = 0;
        }

        function test_tabletHasTheBarByDefault() {
            shell.unlock();
            compare(Theme.gestureAreaHeight, Theme.px(20));
            // The UI stops above it, and the bezel strip is off (the bar's
            // swipe up does its job).
            tryCompare(shell.uiRoot, "height", root.height - Theme.px(20));
            verify(!findChild(shell, "bezelSwipe").enabled);
        }

        function test_swipeUpOnTheBarLeavesTheApp() {
            shell.unlock();
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            var y = root.height - Theme.px(10);
            mousePress(root, 500, y);
            for (var d = 10; d <= 80; d += 10)
                mouseMove(root, 500, y - d);
            mouseRelease(root, 500, y - 80);
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
        }

        // Held upright, the bar goes to the bottom of the UI, not the side
        // the TouchPad's bottom edge is then on.
        function test_barFollowsTheUiToPortrait() {
            shell.unlock();
            sys.deviceOrientation = "right";
            tryCompare(shell, "uiOrientation", "right", 3000);
            tryVerify(function() { return !shell.rotator.rotating; }, 3000);
            compare(shell.uiRoot.width, 768);
            compare(shell.uiRoot.height, 1024 - Theme.px(20));
            // Its swipe up still reads as up, in the UI's frame.
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            var bar = findChild(shell, "gestureBar");
            var p = bar.mapToItem(root, bar.width / 2, bar.height / 2);
            var up = bar.mapToItem(root, bar.width / 2, bar.height / 2 - 80);
            mousePress(root, p.x, p.y);
            for (var i = 1; i <= 8; ++i)
                mouseMove(root, p.x + (up.x - p.x) * i / 8, p.y + (up.y - p.y) * i / 8);
            mouseRelease(root, up.x, up.y);
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
        }

        function test_hardwareHomeButtonRemovesTheBar() {
            shell.unlock();
            shell.hardwareHomeButton = true;
            compare(Theme.gestureAreaHeight, 0);
            tryCompare(shell.uiRoot, "height", root.height);
            verify(findChild(shell, "bezelSwipe").enabled);
        }
    }
}
