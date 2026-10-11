// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A screen with rounded corners and a camera cutout (device.json's
// displayCornerRadius and displayCutouts; phoenix-sim --device): the
// Fairphone 6's punch hole at the top centre (gmobile's panel data:
// a 90 px circle at x 513, y 16 on 1116x2484, corners of 100 px). While
// the UI is upright, the status bar holds the hole (Theme.safeAreaTop,
// as Android lays windows out below a cutout no system bar contains), the
// clock moves beside it and the bar's ends keep out of the corners (as
// Phosh's top bar does: layout-manager.c get_clock_pos,
// get_corner_shift). A square screen without a cutout keeps the
// original's 28 px bar and centred clock, to the pixel.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 1200
    height: 2600

    Item {
        id: screen
        width: 1116
        height: 2484

        Shell {
            id: shell
            anchors.fill: parent
            formFactor: "phone"
            density: 2.5
            source: SimWindowSource { id: windows }
            system: SimSystemStatus { id: sys; fixedTime: new Date(2009, 5, 6, 9, 41) }
        }
    }

    readonly property var fp6Hole: [{ shape: "circle", x: 513, y: 16, width: 90, height: 90 }]

    TestCase {
        name: "ScreenShape"
        when: windowShown

        function cleanup() {
            shell.displayCutouts = [];
            shell.displayCornerRadius = 0;
            sys.deviceOrientation = "up";
        }

        function overlaps(a, ax, aw, c) {
            return Math.min(ax + aw, c.x + c.width) - Math.max(ax, c.x) > 0;
        }

        function test_squareScreenIsTheOriginal() {
            shell.unlock();
            var bar = findChild(shell, "statusBar");
            var clock = findChild(bar, "centreClock");
            compare(Theme.safeAreaTop, 0);
            compare(bar.height, Theme.px(28));
            compare(bar.cornerInset, 0);
            compare(clock.x, Theme.centred(bar.width, clock.width));
            compare(findChild(bar, "statusBarTitle").x, 0);
        }

        function test_punchHole() {
            shell.unlock();
            shell.displayCutouts = root.fp6Hole;
            shell.displayCornerRadius = 100;
            var bar = findChild(shell, "statusBar");
            var clock = findChild(bar, "centreClock");
            var title = findChild(bar, "statusBarTitle");
            // The bar holds the hole: down to its bottom, 106 px.
            tryCompare(Theme, "safeAreaTop", 106);
            compare(bar.height, 106);
            // The clock beside the hole, not under it, clear of the title.
            verify(clock.visible);
            verify(!overlaps(clock, clock.x, clock.width, root.fp6Hole[0]), "clock at " + clock.x);
            verify(clock.x >= title.x + title.width, "clock " + clock.x + " title ends " + (title.x + title.width));
            // The ends keep out of the 100 px corners.
            verify(bar.cornerInset > 0);
            compare(title.x, bar.cornerInset);
            // Cards and apps start below the taller bar.
            compare(shell.cardView.topInset, 106);
        }

        function test_turnedUiLeavesTheTopEdge() {
            shell.unlock();
            shell.displayCutouts = root.fp6Hole;
            tryCompare(Theme, "safeAreaTop", 106);
            // Turned on its side, the hole is at a side, not under the bar.
            sys.deviceOrientation = "left";
            tryCompare(Theme, "safeAreaTop", 0, 3000);
            var bar = findChild(shell, "statusBar");
            compare(bar.cutouts.length, 0);
            sys.deviceOrientation = "up";
            tryCompare(Theme, "safeAreaTop", 106, 3000);
        }

        function test_cutoutBelowTheBarIsNotTheBars() {
            shell.unlock();
            // A cutout lower down the screen (not starting in the 28 px
            // bar) leaves the bar as it is.
            shell.displayCutouts = [{ shape: "rect", x: 500, y: 400, width: 100, height: 50 }];
            compare(Theme.safeAreaTop, 0);
            compare(findChild(shell, "statusBar").height, Theme.px(28));
        }
    }
}
