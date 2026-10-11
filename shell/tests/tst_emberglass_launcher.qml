// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ember Glass's launcher (docs/SYSTEM-UI-2.md, 7): the page on the shell's
// own L1 glass (the blurred wallpaper where it lies), the tabs as Ember's
// segmented capsule (base.css .seg), Done an ink pill, edit mode's tiles,
// the icon menu and the group as L4 sheets, the labels in the theme's ink.
// The pages, the grid and the gestures are 1.0's (tst_launcher), and 1.0's
// look is unchanged.
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
        system: SimSystemStatus { id: sys }
        wallpaper: Qt.resolvedUrl("../../apps/settings/public/wallpapers/phoenix.jpg")
    }

    TestCase {
        name: "EmberGlassLauncher"
        when: windowShown

        property var launcher: findChild(shell, "launcher")

        function init() {
            shell.unlock();
            launcher.open = true;
            tryCompare(launcher, "hidden", 0, 2000);
        }
        function cleanup() {
            launcher.editMode = false;
            findChild(shell, "iconMenu").open = false;
            launcher.closeOverlay();
            launcher.open = false;
            tryCompare(launcher, "visible", false, 2000);
            shell.look = "";
        }

        function test_classicUnchanged() {
            verify(!findChild(launcher, "emberLauncherGlass").visible);
            verify(!findChild(launcher, "emberLauncherTabs").visible);
            compare(launcher.tabsX, 0);
            compare(launcher.tabAt(1, 10), 0);
            compare(launcher.tabWidth, Math.min(Theme.launcherTabMaxWidth, root.width / launcher.tabs.length));
            var label = findChild(launcher, "appIconLabel");
            compare(label.style, Text.Raised);
            verify(Qt.colorEqual(label.color, Theme.text));
        }

        // The glass: the blurred wallpaper placed as the wallpaper lies
        // under the launcher, which starts under the status bar.
        function test_glass() {
            shell.look = "ember-glass";
            var glass = findChild(launcher, "emberLauncherGlass");
            verify(glass.visible);
            compare(String(glass.picture), String(shell.wallpaperBlur.tonedUrl));
            compare(glass.place.y, Theme.statusBarHeight);
            compare(glass.screen.height, root.height);
            verify(Qt.colorEqual(findChild(glass, "emberL1Tint").color, EmberGlass.dark.glassL1Tint));
            // As it slides down, the picture stays where the wallpaper is.
            launcher.open = false;
            tryVerify(function () { return launcher.hidden > 0.3 && launcher.hidden < 1; }, 2000);
            var p = findChild(glass, "emberL1Picture");
            fuzzyCompare(p.y, -(Theme.statusBarHeight + launcher.hidden * (launcher.height + Theme.statusBarHeight)), 0.5);
        }

        // The tabs: Ember's segmented capsule 18 px in, the tabs 3 inside,
        // the page's tab selected; a tap still finds its tab.
        function test_tabs() {
            shell.look = "ember-glass";
            var capsule = findChild(launcher, "emberLauncherTabs");
            verify(capsule.visible);
            compare(capsule.x, 18);
            compare(capsule.height, 40);
            compare(launcher.tabsX, 21);
            compare(launcher.tabAt(10, 10), -1);
            compare(launcher.tabAt(launcher.tabsX + launcher.tabWidth * 1.5, 10), 1);
            compare(launcher.tabAt(launcher.tabsX + launcher.tabWidth * launcher.tabs.length + 1, 10), -1);
            verify(findChild(launcher, "emberLauncherTabSelected").visible);
            var label = findChild(launcher, "appIconLabel");
            compare(label.style, Text.Normal);
            verify(Qt.colorEqual(label.color, EmberGlass.dark.colorInk));
        }

        // Edit mode: Done is an ink pill, the icons sit on L2 tiles, the
        // "+" is a ring button.
        function test_editMode() {
            shell.look = "ember-glass";
            launcher.editMode = true;
            var done = findChild(launcher, "emberLauncherDone");
            verify(done.visible);
            verify(Qt.colorEqual(done.color, EmberGlass.dark.colorInverse));
            verify(findChild(launcher, "emberLauncherEditTile").visible);
            verify(findChild(launcher, "emberLauncherAddTab").visible);
        }

        // The icon menu and the name dialog are L4 sheets with Ember's rows.
        function test_menus() {
            shell.look = "ember-glass";
            verify(launcher.requestMenu(0));
            var menu = findChild(shell, "iconMenu");
            tryCompare(menu, "open", true, 1000);
            var sheet = findChild(menu, "emberIconMenu");
            verify(sheet.visible);
            compare(sheet.radius, EmberGlass.radiusMenu);
            compare(findChild(menu, "iconMenu_move").height, 46);
            menu.open = false;
            launcher.askNewTab();
            verify(findChild(launcher, "emberLauncherNameDialog").visible);
            verify(Qt.colorEqual(findChild(launcher, "launcherNameHeading").color, EmberGlass.dark.colorInk));
        }
    }
}
