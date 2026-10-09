// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The tab behind the status bar's system icons while the system menu is
// open: its solid part holds every icon of the group, the microphone's
// too, with room on both sides, and reaches the screen's right edge, on a
// phone and a tablet, at the adaptive simulator's sizes, upright and on
// its side, at 1x and 2x (StatusBarItemGroup.cpp:358-366, the tab's 11 px
// caps). The phone's pressed art once stretched whole, its transparent
// sides with it: the microphone outside the tab, a gap after the battery.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 1600
    height: 1600

    Item {
        id: screen
        width: 320
        height: 480

        Shell {
            id: shell
            anchors.fill: parent
            formFactor: "auto"
            density: 1
            source: SimWindowSource { id: windows }
            system: SimSystemStatus { id: sys }
        }
    }

    TestCase {
        name: "StatusBarTab"
        when: windowShown

        function cleanup() {
            findChild(shell, "systemMenu").open = false;
            findChild(shell, "statusBar").microphone = "";
            sys.muted = false;
            sys.rotationLocked = false;
            sys.bluetoothOn = false;
            shell.density = 1;
        }

        function shownIcons(row) {
            var out = [];
            for (var i = 0; i < row.children.length; ++i) {
                var c = row.children[i];
                if (c.visible && c.width > 0 && c.opacity > 0)
                    out.push(c);
            }
            return out;
        }

        function test_tabHoldsTheIcons_data() {
            return [
                { tag: "phone 320x480", w: 320, h: 480, density: 1, tablet: false, mic: "", extras: false },
                { tag: "phone 320x480, microphone", w: 320, h: 480, density: 1, tablet: false, mic: "on", extras: false },
                { tag: "adaptive 393x702, microphone, many icons", w: 393, h: 702, density: 1, tablet: false, mic: "standby", extras: true },
                { tag: "phone on its side 702x393, microphone", w: 702, h: 393, density: 1, tablet: false, mic: "on", extras: true },
                { tag: "phone 2x 786x1404, microphone", w: 786, h: 1404, density: 2, tablet: false, mic: "on", extras: true },
                { tag: "adaptive 560x900", w: 560, h: 900, density: 1, tablet: false, mic: "on", extras: false },
                { tag: "tablet 1024x768, microphone", w: 1024, h: 768, density: 1, tablet: true, mic: "on", extras: true },
                { tag: "tablet 768x1024", w: 768, h: 1024, density: 1, tablet: true, mic: "", extras: false },
            ];
        }
        function test_tabHoldsTheIcons(data) {
            shell.density = data.density;
            screen.width = data.w;
            screen.height = data.h;
            tryCompare(shell, "tablet", data.tablet, 1000);
            shell.unlock();
            var bar = findChild(shell, "statusBar");
            bar.microphone = data.mic;
            sys.muted = data.extras;
            sys.rotationLocked = data.extras;
            sys.bluetoothOn = data.extras;
            // The icons slide in over a second (statusBarItemSlideDuration).
            wait(Theme.statusBarItemSlideDuration + 100);
            shell.openSystemMenu();
            var tab = findChild(bar, "systemMenuTab");
            tryCompare(tab, "opacity", 1, 1000);
            var row = findChild(bar, "wifiIcon").parent;
            var icons = shownIcons(row);
            if (data.mic !== "")
                verify(icons.indexOf(findChild(bar, "microphoneIcon")) >= 0, "the microphone shows");
            if (data.extras)
                verify(icons.length >= 6, "the extra icons show: " + icons.length);

            var cap = Theme.statusBarTabCap;
            var t = tab.mapToItem(bar, 0, 0);
            // The solid part, between the caps, reaches the right edge.
            var solidLeft = t.x + cap, solidRight = t.x + tab.width - cap;
            verify(Math.abs(solidRight - bar.width) < 0.5, "the tab reaches the edge: " + solidRight + " vs " + bar.width);
            compare(tab.height, bar.height);
            for (var i = 0; i < icons.length; ++i) {
                var ic = icons[i];
                var p = ic.mapToItem(bar, 0, 0);
                var name = ic.objectName || ic.toString();
                verify(p.x - solidLeft >= Theme.statusBarTabPadding - 0.5,
                       name + ": inside the tab on its left, " + (p.x - solidLeft));
                verify(p.x + ic.width <= solidRight + 0.5, name + ": inside the tab on its right");
                verify(p.y >= t.y - 0.5 && p.y + ic.height <= t.y + tab.height + 0.5, name + ": within its height");
            }
        }
    }
}
