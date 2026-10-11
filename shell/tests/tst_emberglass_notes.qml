// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ember Glass's notifications on a phone (docs/SYSTEM-UI-2.md, 8): the
// notification bar under the dock (cards.html .notes), its banner as an L4
// sheet (base.css .banner), the dock 10 px over it, and 1.0's look
// unchanged. What the notifications do is 1.0's (Notifications.qml); only
// the drawing differs.
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
        name: "EmberGlassNotes"
        when: windowShown

        readonly property var notes: shell.notifications

        function init() {
            shell.unlock();
        }
        function cleanup() {
            notes.dashboardOpen = false;
            notes.bannerActive = false;
            notes.activeCall = null;
            while (windows.notifications.count > 0)
                windows.dismissNotification(0);
            shell.look = "";
            sys.tweaks = {};
            tryCompare(notes, "negativeSpace", 0, 2000);
        }
        function threeWaiting() {
            windows.notify(windows.appIdByTitle("Calendar"), "Launch party", "Tomorrow, 9:41 AM");
            windows.notify(windows.appIdByTitle("Email"), "3 new emails", "webOS Phoenix build passed");
            windows.notify(windows.appIdByTitle("Messaging"), "Ada", "Running late, grab us a table by the window?");
        }
        // The icons a row shows (not its Repeater).
        function visibleIcons(row) {
            var n = 0;
            for (var i = 0; i < row.children.length; ++i)
                if (row.children[i].visible && row.children[i].size !== undefined)
                    ++n;
            return n;
        }

        // 1.0: the 28 px bar, black, the banner on its art, the icons.
        function test_classicBar() {
            compare(Theme.notificationBarHeight, Theme.bannerHeight);
            compare(Theme.notificationBarHeight, 28);
            threeWaiting();
            tryCompare(notes, "negativeSpace", 28, 2000);
            verify(notes.bannerActive);
            verify(findChild(notes, "bannerContent").visible);
            verify(!findChild(notes, "emberBanner").visible);
            notes.bannerActive = false;
            verify(findChild(notes, "phoneNotificationIcons").visible);
            verify(!findChild(notes, "emberNotificationBar").visible);
            verify(!findChild(notes, "emberNotificationScrim").visible);
        }

        // Ember Glass: 44 px over the wallpaper; the banner an L4 sheet in
        // it, sliding up as 1.0's; then the newest's text after the ember
        // dot and the others' icons at the right.
        function test_emberGlassBar() {
            shell.look = "ember-glass";
            compare(Theme.notificationBarHeight, 44);
            threeWaiting();
            tryCompare(notes, "negativeSpace", 44, 2000);
            verify(notes.bannerActive);
            var sheet = findChild(notes, "emberBanner");
            verify(sheet.visible);
            verify(!findChild(notes, "bannerContent").visible);
            compare(findChild(sheet, "emberBannerText").text, "Launch party: Tomorrow, 9:41 AM");
            compare(sheet.height, 44 - 2 * 3);
            compare(sheet.radius, sheet.height / 2);
            // It slides in from below and fades as 1.0's banner.
            tryCompare(notes, "bannerProgress", 1, 3000);
            compare(sheet.y, 3);
            compare(sheet.opacity, findChild(notes, "bannerContent").opacity);
            var glass = findChild(sheet, "emberSheetGlass");
            verify(Qt.colorEqual(glass.color, GraphicsInfo.api === GraphicsInfo.Software ? EmberGlass.dark.glassFallback
                                                                                       : EmberGlass.dark.glassL4Tint));

            notes.bannerActive = false;
            var bar = findChild(notes, "emberNotificationBar");
            verify(bar.visible);
            verify(!findChild(notes, "phoneNotificationIcons").visible);
            verify(findChild(notes, "emberNotificationScrim").visible);
            compare(findChild(bar, "emberNotificationText").text, "Ada: Running late, grab us a table by the window?");
            verify(findChild(bar, "emberNotificationDot").visible);
            // The other two, as icons.
            compare(visibleIcons(findChild(bar, "emberNotificationIcons")), 2);
            compare(bar.x, 20);
            // Over the wallpaper: the bar is not black.
            compare(bar.parent.color.a, 0);
        }

        // The dock sits 10 px over the bar (cards.html .dock: bottom 76 =
        // the gesture strip's 22, .notes' 44 and 10), and with nothing
        // waiting 10 px over the gesture strip.
        function test_dockOverTheBar() {
            shell.look = "ember-glass";
            var ql = findChild(shell, "quickLaunch");
            var capsule = findChild(ql, "emberDock");
            shell.dockShown = true;
            tryCompare(ql, "shownProgress", 1, 2000);
            var bottom = function () { return ql.mapToItem(root, 0, capsule.y + capsule.height).y; };
            compare(bottom(), root.height - Theme.gestureAreaHeight - 10);
            threeWaiting();
            tryCompare(notes, "negativeSpace", 44, 2000);
            compare(bottom(), root.height - 22 - 44 - 10);
            // The icons are centred in the capsule.
            compare(ql.iconY, Math.round(capsule.y + (capsule.height - ql.iconSize) / 2));
        }

        // The phone's active call: the banner's sheet, its icon and text.
        function test_activeCall() {
            shell.look = "ember-glass";
            notes.activeCall = { appId: "com.palm.app.phone", icon: "", message: "Ada Palmer", startTime: Math.floor(Date.now() / 1000) };
            tryCompare(notes, "negativeSpace", 44, 2000);
            verify(findChild(notes, "emberActiveCall").visible);
            verify(findChild(notes, "activeCallText").text.indexOf("Ada Palmer") === 0);
            verify(Qt.colorEqual(findChild(notes, "activeCallText").color, EmberGlass.dark.colorInk));
            shell.look = "classic";
            verify(!findChild(notes, "emberActiveCall").visible);
        }

        // A glass surface blurs all of what is behind it: the blur's mask is
        // opaque and the surface's shape (the pill's tint is 38%, the dock's
        // 34%: as masks they let most of the scene through unblurred).
        function test_blurMasksAreOpaque() {
            shell.look = "ember-glass";
            var pillBlur = findChild(shell, "searchPillBlur");
            compare(pillBlur.mask.color.a, 1);
            compare(pillBlur.mask.width, pillBlur.width);
            compare(pillBlur.mask.radius, findChild(shell, "emberSearchPill").radius);
            var ql = findChild(shell, "quickLaunch");
            var dockBlur = findChild(ql, "quickLaunchBlur");
            var capsule = findChild(ql, "emberDock");
            compare(dockBlur.mask.color.a, 1);
            compare(dockBlur.y, capsule.y);
            compare(dockBlur.height, capsule.height);
            compare(dockBlur.mask.radius, capsule.radius);
        }
    }
}
