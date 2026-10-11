// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The theme of Ember Glass's sheets (docs/SYSTEM-UI-2.md, owner question
// 8): dark by default; the system preference "glassTheme" (Settings >
// Advanced > Menus and sheets) or phoenix-sim's --glass-theme makes them
// light. The sheets (the system menu, the dashboard, the launcher) take the
// light theme's tints and ink; what lies on the wallpaper (the status bar,
// Just Type, the dock, the notification bar) and the lock screen's
// dashboard stay as they are.
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
    }

    TestCase {
        name: "EmberGlassTheme"
        when: windowShown

        function init() {
            shell.unlock();
            shell.look = "ember-glass";
        }
        function cleanup() {
            shell.notifications.dashboardOpen = false;
            while (windows.notifications.count > 0)
                windows.dismissNotification(0);
            findChild(shell, "systemMenu").open = false;
            sys.tweaks = {};
            shell.glassTheme = "";
            shell.look = "";
        }

        function test_darkByDefault() {
            compare(shell.effectiveGlassTheme, "dark");
            compare(Theme.egTheme, "dark");
            verify(Theme.eg === EmberGlass.dark);
        }

        // The preference, and this run's choice over it.
        function test_preference() {
            sys.tweaks = { glassTheme: "light" };
            compare(Theme.egTheme, "light");
            verify(Theme.eg === EmberGlass.light);
            shell.glassTheme = "dark";
            compare(Theme.egTheme, "dark");
            shell.glassTheme = "";
            compare(Theme.egTheme, "light");
            sys.tweaks = { glassTheme: "sepia" };
            compare(Theme.egTheme, "dark");
        }

        // The sheets: the light theme's tint, rim and ink.
        function test_lightSheets() {
            sys.tweaks = { glassTheme: "light" };
            shell.openSystemMenu();
            var menu = findChild(shell, "systemMenu");
            tryCompare(menu, "opacity", 1, 1000);
            var sheet = findChild(menu, "emberSystemMenu");
            verify(Qt.colorEqual(findChild(sheet, "emberSheetGlass").color,
                                 Theme.egLiveBlur ? EmberGlass.light.glassL4Tint : EmberGlass.light.glassFallback));
            verify(Qt.colorEqual(findChild(sheet, "emberSheetGlass").border.color, EmberGlass.light.colorLine2));
            compare(menu.ink, EmberGlass.light.colorInk);
            menu.open = false;
            windows.notify(windows.appIdByTitle("Email"), "3 new emails", "webOS Phoenix build passed");
            shell.notifications.bannerActive = false;
            shell.notifications.dashboardOpen = true;
            var list = findChild(shell.notifications, "phoneDashboardList");
            tryVerify(function () { return findChild(list, "dashboardTitle") !== null; }, 2000);
            verify(Qt.colorEqual(findChild(list, "dashboardTitle").color, EmberGlass.light.colorInk));
            // The notification bar lies on the wallpaper: white whatever
            // the sheets' theme.
            shell.notifications.dashboardOpen = false;
            var bar = findChild(shell.notifications, "emberNotificationText");
            compare(String(bar.color), "#e6ffffff");
        }

        // The lock screen's dashboard stays dark.
        function test_lockScreenStaysDark() {
            sys.tweaks = { glassTheme: "light" };
            windows.notify(windows.appIdByTitle("Email"), "3 new emails", "webOS Phoenix build passed");
            shell.lock();
            var row = null;
            tryVerify(function () { row = findChild(shell.lockScreen, "lockDashboardItem"); return row !== null; }, 3000);
            verify(row.egColors === EmberGlass.dark);
            shell.unlock();
        }
    }
}
