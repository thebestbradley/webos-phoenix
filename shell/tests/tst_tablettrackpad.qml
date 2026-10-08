// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A trackpad's two-finger swipe and a mouse wheel on a tablet
// (TrackpadSwipe): the notification drop-down's rows are swiped away as a
// finger swipes them (rightwards only, past a quarter of the width, a live
// activity staying), its list scrolls; the launcher's pages snap to a page.
// The events go through the window as the platform's do (trackpad.js).
// Needs Phoenix.Native (KeyInjector): run with the build tree's modules.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim
import Phoenix.Native
import "trackpad.js" as Trackpad

Item {
    id: root
    width: 1024
    height: 768

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "tablet"
        density: 1
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    TestCase {
        id: testCase
        name: "TabletTrackpad"
        when: windowShown

        function init() {
            shell.unlock();
            shell.cardView.maximizeProgress = 0;
            shell.notifications.dashboardOpen = false;
            while (windows.notifications.count > 0)
                windows.dismissNotification(0);
        }

        function menuRows() {
            var out = [];
            (function walk(o) {
                for (var i = 0; i < o.children.length; ++i) {
                    if (o.children[i].objectName === "dashboardMenuRow")
                        out.push(o.children[i]);
                    walk(o.children[i]);
                }
            })(findChild(shell, "dashboardMenu"));
            out.sort(function(a, b) { return a.y - b.y; });
            return out;
        }
        function openMenu(titles) {
            var notes = shell.notifications;
            for (var i = 0; i < titles.length; ++i)
                windows.notify("org.webosphoenix.messaging", titles[i], "");
            notes.bannerActive = false;
            notes.dashboardOpen = true;
            var menu = findChild(shell, "dashboardMenu");
            tryCompare(menu, "opacity", 1, 1000);
            tryCompare(menu, "containerHeight", menu.rowsHeight, 1000);
            return menu;
        }
        function closeMenu() {
            shell.notifications.dashboardOpen = false;
            tryCompare(findChild(shell, "dashboardMenu"), "visible", false, 1000);
        }
        function rowCentre(r) { return r.mapToItem(root, r.width / 2, Theme.dashboardItemHeight / 2); }

        // Rightwards past a quarter of the width: gone. Short, or leftwards:
        // back in place.
        function test_menuRowSwipedAway() {
            var menu = openMenu(["One", "Two", "Three"]);
            var top = menuRows()[0];
            var p = rowCentre(top);
            Trackpad.swipe(testCase, KeyInjector, root, p.x, p.y, 50, 0, { steps: 20, interval: 30, settle: 0 });
            wait(Theme.wheelGestureEndDelay + 20);
            tryCompare(top, "swipeX", 0, 1500);
            Trackpad.swipe(testCase, KeyInjector, root, p.x, p.y, -150, 0, { momentum: 10 });
            compare(top.swipeX, 0);
            compare(windows.notifications.count, 3);
            Trackpad.swipe(testCase, KeyInjector, root, p.x, p.y, 120, 0, { steps: 20, interval: 30, momentum: 10 });
            tryCompare(windows.notifications, "count", 2, 1500);
            // The newest went (newest at the top).
            compare(windows.notifications.get(0).title, "One");
            compare(windows.notifications.get(1).title, "Two");
            closeMenu();
        }

        // A live activity is persistent: it goes back.
        function test_menuOngoingStays() {
            windows.notify("org.webosphoenix.messaging", "Busy", "");
            windows.notifications.setProperty(0, "ongoing", true);
            var menu = openMenu([]);
            var top = menuRows()[0];
            var p = rowCentre(top);
            Trackpad.swipe(testCase, KeyInjector, root, p.x, p.y, 200, 0, { momentum: 10 });
            tryCompare(top, "swipeX", 0, 1500);
            compare(windows.notifications.count, 1);
            windows.notifications.setProperty(0, "ongoing", false);
            closeMenu();
        }

        // Past five and a half rows the list scrolls, within its ends.
        function test_menuListScrolls() {
            var menu = openMenu(["1", "2", "3", "4", "5", "6", "7", "8"]);
            var flick = findChild(menu, "dashboardMenuFlickable");
            var maxY = flick.contentHeight - flick.height;
            verify(maxY > 50);
            var p = flick.mapToItem(root, flick.width / 2, flick.height / 2);
            Trackpad.swipe(testCase, KeyInjector, root, p.x, p.y, 0, -40, { momentum: 8 });
            verify(flick.contentY > 40, "scrolled: " + flick.contentY);
            Trackpad.swipe(testCase, KeyInjector, root, p.x, p.y, 0, -1000, {});
            compare(flick.contentY, maxY);
            Trackpad.notch(testCase, KeyInjector, root, p.x, p.y, 0, 1);
            fuzzyCompare(flick.contentY, maxY - menu.rowHeight, 0.5);
            compare(windows.notifications.count, 8);
            closeMenu();
        }

        // The launcher's pages: on to the page ahead, never past it.
        function test_launcherSnaps() {
            var launcher = findChild(shell, "launcherWheel").parent;
            var pages = null;
            (function walk(o) {
                for (var i = 0; i < o.children.length && !pages; ++i) {
                    if (o.children[i].orientation === ListView.Horizontal && o.children[i].hasOwnProperty("highlightRangeMode"))
                        pages = o.children[i];
                    else
                        walk(o.children[i]);
                }
            })(launcher);
            verify(pages);
            if (!shell.launcherOpen)
                shell.gestureUp();
            tryCompare(launcher, "hidden", 0, 2000);
            launcher.showPage(0);
            tryVerify(function() { return Math.abs(pages.contentX - pages.originX) < 0.5; }, 2000);
            var far = 0;
            function track() { far = Math.max(far, (pages.contentX - pages.originX) / pages.width); }
            pages.contentXChanged.connect(track);
            var p = pages.mapToItem(root, pages.width / 2, pages.height / 2);
            Trackpad.swipe(testCase, KeyInjector, root, p.x, p.y, -pages.width * 0.4, 0, { momentum: 14 });
            tryCompare(pages, "currentIndex", 1, 1000);
            wait(Theme.wheelSettleDuration + 100);
            pages.contentXChanged.disconnect(track);
            fuzzyCompare((pages.contentX - pages.originX) / pages.width, 1, 0.001);
            verify(far <= 1.0005, "never past the page: " + far);
            shell.gestureUp();
            tryCompare(launcher, "hidden", 1, 2000);
        }
    }
}
