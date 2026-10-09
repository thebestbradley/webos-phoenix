// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A trackpad's two-finger swipe and a mouse wheel on a phone, beyond card
// view (tst_cardwheel.qml): the launcher's pages snap to a page as card
// view's stacks do, the momentum after the fingers lift neither running
// them past it nor pulling them back, and the page's icons scroll; the
// dashboard's rows are swiped away and its list scrolls (TrackpadSwipe).
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
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        density: 1
        source: SimWindowSource { id: windows }
        system: SimSystemStatus {}
    }

    TestCase {
        id: testCase
        name: "Trackpad"
        when: windowShown

        property var launcher: null
        property var pages: null

        function find(item, test) {
            if (test(item))
                return item;
            for (var i = 0; i < item.children.length; ++i) {
                var f = find(item.children[i], test);
                if (f)
                    return f;
            }
            return null;
        }

        function initTestCase() {
            launcher = find(shell, function(o) { return o.hasOwnProperty("editMode") && o.hasOwnProperty("tabs"); });
            pages = find(launcher, function(o) { return o.orientation === ListView.Horizontal && o.hasOwnProperty("highlightRangeMode"); });
            verify(launcher && pages);
            tryVerify(function() { return shell.launcherLayout !== null; }, 2000);
        }

        function init() {
            shell.unlock();
            shell.cardView.maximizeProgress = 0;
            shell.notifications.dashboardOpen = false;
            while (windows.notifications.count > 0)
                windows.notifications.remove(0);
        }

        function openLauncher() {
            launcher.editMode = false;
            if (!shell.launcherOpen)
                shell.gestureUp();
            tryCompare(launcher, "hidden", 0, 2000);
            launcher.showPage(0);
            restAt(0);
            for (var i = 0; i < pages.contentItem.children.length; ++i) {
                var page = pages.contentItem.children[i];
                if (page.hasOwnProperty("contentY"))
                    page.contentY = 0;
            }
        }
        function closeLauncher() {
            if (shell.launcherOpen)
                shell.gestureUp();
            tryCompare(launcher, "hidden", 1, 2000);
        }
        function pagePos() { return (pages.contentX - pages.originX) / pages.width; }
        // The pages at rest on page i: there exactly, not a frame of the
        // slide there that happens to be close (a slow machine samples
        // the slide's last frames).
        function restAt(i) {
            tryVerify(function() { return Math.abs(pagePos() - i) < 1e-6; }, 3000, "at rest on page " + i + ": " + pagePos());
        }
        // The pages' farthest positions while `fn` runs and the swipe
        // settles on page `to` (until they are at rest there).
        function farthest(to, fn) {
            var far = { max: pagePos(), min: pagePos() };
            function track() {
                far.max = Math.max(far.max, pagePos());
                far.min = Math.min(far.min, pagePos());
            }
            pages.contentXChanged.connect(track);
            fn();
            restAt(to);
            pages.contentXChanged.disconnect(track);
            return far;
        }
        function centre() { return Qt.point(pages.width / 2, pages.height / 2); }

        // Past a third of the way to the next page, the fingers stop and
        // lift, and the momentum carries on: the next page, at once, never
        // past it; and it stays.
        function test_launcherSwipeSnapsToThePageAhead() {
            openLauncher();
            var c = centre();
            var far = farthest(1, function () {
                Trackpad.swipe(testCase, KeyInjector, pages, c.x, c.y, -pages.width * 0.45, 0, { momentum: 12 });
            });
            tryCompare(pages, "currentIndex", 1, 1000);
            restAt(1);
            verify(far.max <= 1.0005, "never past the page it settles on: " + far.max);
            verify(far.min >= -0.0005, "never back before the page it left: " + far.min);
            // And back, with the fingers' ScrollEnd before the momentum
            // (the momentum begins with a ScrollBegin).
            far = farthest(0, function () {
                Trackpad.swipe(testCase, KeyInjector, pages, c.x, c.y, pages.width * 0.45, 0, { momentum: 12, endBeforeMomentum: true });
            });
            tryCompare(pages, "currentIndex", 0, 1000);
            restAt(0);
            verify(far.min >= -0.0005, "no overscroll past the first page: " + far.min);
            closeLauncher();
        }

        // A short slow swipe goes back to its page, with no bounce past it.
        function test_launcherShortSwipeSettlesBack() {
            openLauncher();
            launcher.showPage(1);
            restAt(1);
            var c = centre();
            var far = farthest(1, function () {
                Trackpad.swipe(testCase, KeyInjector, pages, c.x, c.y, -pages.width * 0.2, 0, { steps: 20, interval: 30, momentum: 6 });
            });
            compare(pages.currentIndex, 1);
            restAt(1);
            verify(far.min >= 0.9995, "never back past the page: " + far.min);
            closeLauncher();
        }

        // Past the last page it gives a little and comes back to it.
        function test_launcherLastPageHoldsAtTheEnd() {
            openLauncher();
            var last = launcher.tabs.length - 1;
            launcher.showPage(last);
            restAt(last);
            var c = centre();
            var far = farthest(last, function () {
                Trackpad.swipe(testCase, KeyInjector, pages, c.x, c.y, -pages.width * 0.6, 0, { momentum: 12 });
            });
            compare(pages.currentIndex, last);
            restAt(last);
            verify(far.max < last + 0.25, "a little give past the end: " + far.max);
            closeLauncher();
        }

        // Up and down the page's icons scroll with the fingers and the
        // momentum, never past their ends; the page stays.
        function test_launcherVerticalSwipeScrollsThePage() {
            // Enough icons for the first page to scroll.
            var page = null;
            openLauncher();
            page = pages.currentItem;
            var maxY = page.contentHeight - page.height;
            verify(maxY > 60, "the Apps page scrolls (" + maxY + ")");
            var c = centre();
            Trackpad.swipe(testCase, KeyInjector, pages, c.x, c.y, 0, -50, { settle: 0 });
            var afterFingers = page.contentY;
            verify(afterFingers >= 49 && afterFingers <= 51, "followed the fingers: " + afterFingers);
            page.contentY = 0;
            Trackpad.swipe(testCase, KeyInjector, pages, c.x, c.y, 0, -50, { momentum: 10 });
            verify(page.contentY > 65, "the momentum carries it on: " + page.contentY);
            compare(pages.currentIndex, 0);
            restAt(0);
            // A long one stops at the end, not past it.
            Trackpad.swipe(testCase, KeyInjector, pages, c.x, c.y, 0, -(maxY + 400), { momentum: 10 });
            compare(page.contentY, maxY);
            Trackpad.swipe(testCase, KeyInjector, pages, c.x, c.y, 0, maxY + 400, { momentum: 10 });
            compare(page.contentY, 0);
            closeLauncher();
        }

        // A mouse wheel: sideways a page a notch; up and down it scrolls the
        // page, and nothing behind the launcher moves.
        function test_launcherMouseWheel() {
            openLauncher();
            var c = centre();
            Trackpad.notch(testCase, KeyInjector, pages, c.x, c.y, -1, 0);
            tryCompare(pages, "currentIndex", 1, 1000);
            Trackpad.notch(testCase, KeyInjector, pages, c.x, c.y, 1, 0);
            tryCompare(pages, "currentIndex", 0, 1000);
            restAt(0);
            var page = pages.currentItem, cardPos = shell.cardView.position;
            Trackpad.notch(testCase, KeyInjector, pages, c.x, c.y, 0, -1);
            // Exactly there: the scroll's last frames are near enough for
            // tryCompare's fuzzy compare, and would overwrite contentY below.
            tryVerify(function() { return page.contentY === launcher.cellHeight; }, 2000, "a notch down scrolls the page a row: " + page.contentY);
            compare(pages.currentIndex, 0);
            // At the bottom it stays there, and the wheel stays in the launcher.
            var maxY = page.contentHeight - page.height;
            page.contentY = maxY;
            Trackpad.notch(testCase, KeyInjector, pages, c.x, c.y, 0, -1);
            wait(Theme.launcherScrollDuration + 100);
            compare(page.contentY, maxY);
            compare(shell.cardView.position, cardPos);
            closeLauncher();
        }

        // A finger's drag still pans between pages as it did. On an empty
        // page (Favorites): on an icon, a press that a slow machine holds
        // for iconMenuHoldInterval before the first move arrives opens the
        // icon's menu and keeps the finger (Launcher.qml pageMouse), and the
        // pages never move; on an empty page a hold does nothing. The drag
        // goes most of a page: the Flickable starts following only past its
        // drag threshold (a 0.6 page drag left the pages at 0.48 of the way,
        // so the next page came only from the release's flick speed), and
        // well past half way the next page is where the pages settle whether
        // the release is taken for a flick or not.
        function test_launcherFingerDragUnchanged() {
            openLauncher();
            var from = -1;
            for (var t = 0; t < launcher.tabs.length - 1 && from < 0; ++t)
                if (launcher.pageModels[t] && launcher.pageModels[t].count === 0)
                    from = t;
            verify(from >= 0, "an empty page with a page after it");
            launcher.showPage(from);
            restAt(from);
            var y = pages.height / 2, x0 = pages.width * 0.95, steps = 15;
            mousePress(pages, x0, y);
            // However long the machine takes, no hold gets in the way.
            wait(Theme.iconMenuHoldInterval + 100);
            for (var i = 1; i <= steps; ++i)
                mouseMove(pages, x0 - i * pages.width * 0.06, y, 16);
            var dragged = pagePos() - from;
            verify(dragged > 0.6, "the pages followed the finger: " + dragged);
            mouseRelease(pages, x0 - steps * pages.width * 0.06, y, Qt.LeftButton, Qt.NoModifier, 16);
            tryCompare(pages, "currentIndex", from + 1, 5000);
            restAt(from + 1);
            closeLauncher();
        }

        // ---- The phone's dashboard ----------------------------------------------

        function openDashboard(n) {
            for (var i = 0; i < n; ++i)
                windows.notify("org.webosphoenix.messaging", "Note " + i, "");
            var notes = shell.notifications;
            notes.bannerActive = false;
            notes.dashboardOpen = true;
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            var list = findChild(notes, "phoneDashboardList");
            verify(list);
            wait(50);
            return list;
        }
        function rowPoint(list, i) {
            var r = list.itemAt(10, i * Theme.dashboardItemHeight + Theme.dashboardItemHeight / 2);
            return Qt.point(list.width / 2, r.y - list.contentY + r.height / 2);
        }

        // Sideways past a quarter of the width: the row slides off and goes.
        // A short slow one comes back.
        function test_dashboardRowSwipedAway() {
            var list = openDashboard(3);
            var p = rowPoint(list, 0);
            Trackpad.swipe(testCase, KeyInjector, list, p.x, p.y, list.width * 0.12, 0, { steps: 20, interval: 30 });
            wait(Theme.dashboardSnapDuration + 100);
            compare(windows.notifications.count, 3);
            Trackpad.swipe(testCase, KeyInjector, list, p.x, p.y, list.width * 0.4, 0, { steps: 20, interval: 30, momentum: 10 });
            tryCompare(windows.notifications, "count", 2, 2000);
            // Leftwards too, as a finger may.
            Trackpad.swipe(testCase, KeyInjector, list, p.x, p.y, -list.width * 0.4, 0, { steps: 20, interval: 30 });
            tryCompare(windows.notifications, "count", 1, 2000);
        }

        // A live activity stays (it ends by itself), as under a finger.
        function test_dashboardOngoingStays() {
            var list = openDashboard(1);
            windows.notifications.setProperty(0, "ongoing", true);
            var p = rowPoint(list, 0);
            Trackpad.swipe(testCase, KeyInjector, list, p.x, p.y, list.width * 0.5, 0, { momentum: 10 });
            wait(Theme.dashboardDeleteDuration + 200);
            compare(windows.notifications.count, 1);
            windows.notifications.setProperty(0, "ongoing", false);
        }

        // Up and down the list scrolls when it is longer than its room.
        function test_dashboardListScrolls() {
            var list = openDashboard(12);
            shell.notifications.setDrawerExpanded(false);
            // The dashboard at its height and the list laid out, so its
            // ends stay where they are while it scrolls.
            tryCompare(shell.notifications, "negativeSpace", shell.notifications.dashboardHeight, 3000);
            waitForItemPolished(list, 2000);
            verify(list.contentHeight > list.height, "the list scrolls");
            list.contentY = list.originY;
            var p = Qt.point(list.width / 2, list.height / 2);
            var top = list.contentY;
            Trackpad.swipe(testCase, KeyInjector, list, p.x, p.y, 0, -60, { momentum: 8 });
            verify(list.contentY > top + 55, "scrolled down: " + (list.contentY - top));
            compare(windows.notifications.count, 12);
            Trackpad.swipe(testCase, KeyInjector, list, p.x, p.y, 0, 2000, { settle: 0 });
            compare(list.contentY, top);
            // A mouse wheel's notch: a row, even straight after the swipe,
            // before the swipe's end of events has passed.
            Trackpad.notch(testCase, KeyInjector, list, p.x, p.y, 0, -1);
            fuzzyCompare(list.contentY, top + Theme.dashboardItemHeight, 0.5);
        }
    }
}
