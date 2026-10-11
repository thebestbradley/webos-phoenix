// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ember Glass's system menu (docs/SYSTEM-UI-2.md, 9; base.css .menu): an
// L4 sheet under the status bar's right end, 46 px rows with a glyph before
// the text, the pressed row's ember bar, Ember's sliders, a drawer's caret,
// and the status bar's lit tab while it is open. Its rows, labels and what
// they do are 1.0's (tst_systemmenu), and 1.0's look is unchanged.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 446
    height: 994

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        density: 1
        source: SimWindowSource { id: windows }
        system: SimSystemStatus {
            id: status
            fixedTime: new Date(2009, 5, 6, 9, 41)
            _scanTime: 100
            _connectTime: 150
        }
    }

    TestCase {
        name: "EmberGlassMenu"
        when: windowShown

        property var menu: findChild(shell, "systemMenu")

        function init() {
            shell.unlock();
            status.setWifiOn(true);
            status.brightness = 0.7;
            shell.openSystemMenu();
            tryCompare(menu, "opacity", 1, 1000);
        }
        function cleanup() {
            menu.open = false;
            tryCompare(menu, "visible", false, 1000);
            shell.look = "";
        }

        function test_classicUnchanged() {
            var panel = findChild(menu, "systemMenuPanel");
            verify(!findChild(menu, "emberSystemMenu").visible);
            compare(panel.x, menu.width - 300 + 11);
            compare(panel.y, 28);
            compare(findChild(menu, "systemMenuDate").height, 42);
            verify(!findChild(findChild(menu, "systemMenuDate"), "emberMenuGlyph").visible);
            verify(!findChild(shell, "emberSystemMenuTab").visible);
            verify(findChild(shell, "systemMenuTab").visible);
        }

        function test_sheet() {
            shell.look = "ember-glass";
            var panel = findChild(menu, "systemMenuPanel");
            var sheet = findChild(menu, "emberSystemMenu");
            verify(sheet.visible);
            // 10 px in from the edge, 2 under the bar; its corner there 4 px.
            compare(panel.x + panel.width, root.width - 10);
            compare(panel.y, 32 + 2);
            compare(sheet.topRightRadius, 4);
            compare(sheet.topLeftRadius, 20);
            compare(sheet.bottomLeftRadius, 20);
            compare(sheet.level, 4);
            verify(sheet.lifted);
            // The rows: 46 px, a glyph before the text, 6 px in (.menu's
            // padding).
            var date = findChild(menu, "systemMenuDate");
            compare(date.height, 46);
            var p = date.mapToItem(panel, 0, 0);
            compare(p.x, 6);
            compare(p.y, 6);
            var glyph = findChild(date, "emberMenuGlyph");
            verify(glyph.visible);
            compare(glyph.name, "calendar-blank");
            compare(glyph.x, 14);
            // Wi-Fi is on: its glyph is ember.
            var wifi = findChild(menu, "systemMenuWifi");
            var wifiGlyph = findChild(wifi, "emberMenuGlyph");
            compare(wifiGlyph.name, "wifi-high");
            verify(Qt.colorEqual(wifiGlyph.color, EmberGlass.emberMid));
            // The status bar's tab, lit.
            var tab = findChild(shell, "emberSystemMenuTab");
            tryCompare(tab, "opacity", 1, 1000);
            verify(tab.visible);
            verify(!findChild(shell, "systemMenuTab").visible);
        }

        // A drawer's caret turns as it opens; its entries line up with the
        // titles' text, the connected network checked in ember.
        function test_drawer() {
            shell.look = "ember-glass";
            var wifi = findChild(menu, "systemMenuWifi");
            var caret = findChild(wifi, "emberMenuDrawerCaret");
            compare(caret.rotation, 0);
            wifi.open();
            tryCompare(caret, "rotation", 180, 2000);
            tryVerify(function () { return findChild(wifi, "systemMenuWifiNetwork") !== null; }, 3000);
            var check = findChild(wifi, "emberMenuEntryCheck");
            tryCompare(check, "visible", true, 3000);
            verify(Qt.colorEqual(check.color, EmberGlass.dark.colorEmberText));
            compare(menu.subX, menu.textX);
            wifi.close(true);
        }

        // Ember's slider: the ember up to the knob, which sits where 1.0's
        // handle did (the handle still decides where a press takes hold).
        function test_slider() {
            shell.look = "ember-glass";
            var slider = findChild(menu, "systemMenuBrightness");
            var knob = findChild(slider, "emberSliderKnob");
            var fill = findChild(slider, "emberSliderFill");
            verify(knob.visible && fill.visible);
            compare(knob.width, 20);
            compare(fill.x + fill.width, knob.x + knob.width / 2);
            var before = knob.x;
            status.brightness = 1;
            verify(knob.x > before);
            compare(fill.x + fill.width, knob.x + knob.width / 2);
        }

        // The pressed (or focused) row: the sunk tint and the ember bar.
        function test_highlight() {
            shell.look = "ember-glass";
            var row = findChild(menu, "systemMenuAirplane");
            var hl = findChild(row, "emberMenuRowHighlight");
            verify(!hl.visible);
            row.keyFocused = true;
            verify(hl.visible);
            compare(hl.radius, EmberGlass.radiusMenuItem);
            row.keyFocused = false;
        }
    }
}
