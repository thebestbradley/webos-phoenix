// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim's scene (sim.qml): the device's screen is the window, so
// resizing the window resizes the screen and the shell lays itself out
// again, held upright or on its side; without --phone or --tablet it is
// adaptive: a phone or a tablet by the window's size, its View > Device
// Size presets each the layout they should be.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell

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
            sim.width = 1024; sim.height = 768;
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

        function test_adaptivePresets() {
            var it = sim.item;
            verify(it.adaptive, "no --phone or --tablet: adaptive");
            verify(it.simActionChecked("adaptive"));
            verify(!it.simActionChecked("phone") && !it.simActionChecked("tablet"));
            var expect = { pre: false, pre3: false, phone: false, folded: false, unfolded: true, touchpad: true, tablet: true };
            for (var i = 0; i < it.devicePresets.length; ++i) {
                var p = it.devicePresets[i];
                verify(p.id in expect, p.id);
                // The window at the preset's size (what resizeScreen asks of it).
                sim.width = p.width;
                sim.height = p.height;
                tryCompare(it, "screenWidth", p.width);
                tryCompare(it, "screenHeight", p.height);
                compare(Theme.tablet, expect[p.id], p.id + " is a " + (expect[p.id] ? "tablet" : "phone"));
                verify(it.simActionChecked("size-" + p.id), "View > Device Size shows " + p.id);
                compare(it.screenInfo, p.width + "x" + p.height + ", " + (expect[p.id] ? "tablet" : "phone") + " (adaptive)");
            }
            sim.width = 1024;
            sim.height = 768;
            tryCompare(Theme, "tablet", true);
        }
    }
}
