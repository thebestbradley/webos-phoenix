// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim's scene (sim.qml): the device's screen is the window, so
// resizing the window resizes the screen and the shell lays itself out
// again, held upright or on its side.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest

Item {
    id: root
    width: 1024
    height: 768

    Loader {
        id: sim
        width: 1024
        height: 768
        source: Qt.resolvedUrl("../qml/sim.qml")
    }

    TestCase {
        name: "SimResize"
        when: windowShown && sim.status === Loader.Ready

        function device() { return findChild(sim.item, "uiRoot"); }

        function test_screenFollowsTheWindow() {
            var ui = device();
            verify(ui);
            tryCompare(ui, "width", 1024);
            // Wider and taller, then narrower than it started: no bars, no crop.
            sim.width = 1600; sim.height = 1000;
            tryCompare(ui, "width", 1600);
            var bar = findChild(sim.item, "gestureBar");
            tryCompare(ui, "height", 1000 - bar.height);
            sim.width = 700; sim.height = 1100;
            tryCompare(ui, "width", 700);
            tryCompare(ui, "height", 1100 - bar.height);
            var status = findChild(sim.item, "statusBar");
            compare(status.width, 700);
            var p = status.mapToItem(root, 0, 0);
            fuzzyCompare(p.y, 0, 0.5, "the status bar stays at the top of the window");
        }
    }
}
