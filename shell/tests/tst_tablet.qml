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
        system: SimSystemStatus {}
    }

    TestCase {
        name: "Tablet"
        when: windowShown

        function init() {
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
