// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A card's corners (CornerMask): luna-sysmgr's corner shader, with the
// corner worked out from the app's whole buffer (CardWindow.cpp:2491-2531).

import QtQuick
import QtTest
import Phoenix.Native
import Phoenix.Shell

Item {
    id: root
    width: 1100
    height: 1100

    // A TouchPad card in landscape: a 1024x768 buffer, 28 px of status bar.
    CornerMask {
        id: landscape
        width: 1024
        height: 740
        sourceWidth: 1024
        sourceHeight: 768
    }
    // In portrait: 768x1024, the card 996 high.
    CornerMask {
        id: portrait
        width: 768
        height: 996
        sourceWidth: 768
        sourceHeight: 1024
    }
    CardCornerMask {
        id: shellMask
        width: 1024
        height: 740
    }

    TestCase {
        name: "CornerMask"
        when: windowShown

        function test_cornersAreSmallAndNearlyRound() {
            // 0.009 of 1024 across; 370 - 0.473 * 768 down.
            fuzzyCompare(landscape.cornerWidth, 9.216, 0.01);
            fuzzyCompare(landscape.cornerHeight, 6.736, 0.01);
            // Portrait: 0.009 of 768; 498 - 0.478 * 1024.
            fuzzyCompare(portrait.cornerWidth, 6.912, 0.01);
            fuzzyCompare(portrait.cornerHeight, 8.528, 0.01);
        }

        function test_theShellsMaskAddsTheStatusBar() {
            compare(shellMask.sourceHeight, 740 + Theme.positiveSpaceTopPadding);
            compare(shellMask.sourceWidth, 1024);
        }

        function test_alphaFollowsTheShader() {
            landscape.fullSize = false;
            compare(landscape.alphaAt(512, 370), 1);           // the middle
            // Scaled down, the shader softens every edge over the corner's
            // band, not only the corners: |Coord| = 0.926 half a pixel in.
            fuzzyCompare(landscape.alphaAt(512, 0.5), 0.1534, 0.001);
            compare(landscape.alphaAt(0, 0), 0);               // the very corner
            compare(landscape.alphaAt(1024, 740), 0);
            // On the ellipse, |Coord| = 1: smoothstep(1, 0.7, 1) = 0.
            var rx = landscape.cornerWidth, ry = landscape.cornerHeight;
            var t = Math.SQRT1_2;
            fuzzyCompare(landscape.alphaAt(rx - rx * t, ry - ry * t), 0, 1e-6);
            // Halfway into the soft edge (|Coord| = 0.85): 0.5.
            fuzzyCompare(landscape.alphaAt(rx - 0.85 * rx * t, ry - 0.85 * ry * t), 0.5, 1e-6);
            // At full size the edge is 1 % wide: |Coord| = 0.98 is solid.
            landscape.fullSize = true;
            compare(landscape.alphaAt(512, 0.5), 1);
            compare(landscape.alphaAt(rx - 0.98 * rx * t, ry - 0.98 * ry * t), 1);
            landscape.fullSize = false;
        }

        function test_symmetricCorners() {
            var pts = [[2, 3], [1, 1], [4, 0.5]];
            for (var i = 0; i < pts.length; ++i) {
                var x = pts[i][0], y = pts[i][1], a = landscape.alphaAt(x, y);
                fuzzyCompare(landscape.alphaAt(1024 - x, y), a, 1e-9);
                fuzzyCompare(landscape.alphaAt(x, 740 - y), a, 1e-9);
                fuzzyCompare(landscape.alphaAt(1024 - x, 740 - y), a, 1e-9);
            }
        }
    }
}
