// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ember Glass on a tablet (docs/SYSTEM-UI-2.md, 11; email.html's status
// bar): the app menu tab and the clock in the middle, no arrows nor
// separators; the notification group as small icons and the ember dot, lit
// as a tab while the drop-down is open; the banner a capsule in the bar;
// the drop-down an L4 sheet; the dock Ember's capsule. What the tablet's
// bar, drop-down and dock do is 1.0's (tst_tablet), and 1.0's look is
// unchanged.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 1280
    height: 800

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "tablet"
        density: 1
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    TestCase {
        name: "EmberGlassTablet"
        when: windowShown

        readonly property var notes: shell.notifications

        function init() {
            shell.unlock();
        }
        function cleanup() {
            notes.dashboardOpen = false;
            notes.bannerActive = false;
            while (windows.notifications.count > 0)
                windows.dismissNotification(0);
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.cardView.maximizeProgress = 0;
            shell.look = "";
        }
        function twoWaiting() {
            windows.notify(windows.appIdByTitle("Email"), "3 new emails", "webOS Phoenix build passed");
            windows.notify(windows.appIdByTitle("Messaging"), "Ada", "Running late");
        }

        function test_classicUnchanged() {
            verify(Theme.tablet);
            verify(findChild(shell, "tabletClock").visible);
            verify(!findChild(shell, "centreClock").visible);
            twoWaiting();
            notes.bannerActive = false;
            tryCompare(findChild(notes, "tabletNotificationIcons"), "opacity", 1, 2000);
            verify(findChild(notes, "notificationSeparator").visible);
            verify(!findChild(notes, "emberNotificationGroupDot").visible);
            compare(Theme.quickLaunchHeight, 100);
            compare(findChild(shell, "quickLaunch").slotCentre(0), Theme.quickLaunchCellWidth / 2);
        }

        // The bar: the clock in the middle, no arrows nor separators, the
        // app menu tab for an app.
        function test_statusBar() {
            shell.look = "ember-glass";
            verify(findChild(shell, "centreClock").visible);
            verify(!findChild(shell, "tabletClock").visible);
            verify(!findChild(shell, "systemGroupSeparator").visible);
            verify(!findChild(shell, "systemGroupArrow").visible);
            var uid = windows.launch(windows.appIdByTitle("Memos"), "");
            shell.cardView.maximize(uid);
            var title = findChild(shell, "statusBarTitle");
            tryVerify(function () { return findChild(title, "emberAppMenuTab").visible; }, 3000);
            verify(!findChild(shell, "statusBarTitleArrow").visible);
        }

        // The notification group: 16 px icons and the ember dot, lit as a
        // tab while the drop-down, an L4 sheet, is open; the banner a
        // capsule in the bar.
        function test_notifications() {
            shell.look = "ember-glass";
            twoWaiting();
            verify(notes.bannerActive);
            var banner = findChild(notes, "emberTabletBanner");
            verify(banner.visible);
            verify(!findChild(notes, "bannerContent").visible);
            compare(banner.height, 24);
            notes.bannerActive = false;
            var icons = findChild(notes, "tabletNotificationIcons");
            tryCompare(icons, "opacity", 1, 2000);
            var dot = findChild(notes, "emberNotificationGroupDot");
            verify(dot.visible);
            compare(dot.x, icons.x + icons.width + 8);
            verify(!findChild(notes, "notificationSeparator").visible);
            notes.dashboardOpen = true;
            var tab = findChild(notes, "emberNotificationTab");
            tryCompare(tab, "opacity", 1, 2000);
            verify(tab.visible);
            var sheet = findChild(notes, "emberDashboardMenu");
            verify(sheet.visible);
            compare(sheet.topRightRadius, 4);
            compare(sheet.radius, 20);
        }

        // The dock: Ember's capsule round the 64 px icons, 10 px over the
        // bottom; the slots inside it.
        function test_dock() {
            shell.look = "ember-glass";
            compare(Theme.quickLaunchHeight, 94);
            var ql = findChild(shell, "quickLaunch");
            var capsule = findChild(ql, "emberDock");
            verify(capsule.visible);
            compare(capsule.height, 84);
            compare(capsule.x, 34);
            compare(ql.iconY, 10);
            verify(ql.slotCentre(0) - ql.cellWidth / 2 >= capsule.x);
            verify(ql.slotCentre(ql.pinned.length) + ql.cellWidth / 2 <= capsule.x + capsule.width);
            for (var i = 0; i <= ql.pinned.length; ++i)
                compare(ql.slotAt(ql.slotCentre(i)), i);
        }
    }
}
