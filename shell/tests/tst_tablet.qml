// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Tablet-only behaviour.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

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
        name: "Tablet"
        when: windowShown

        function init() {
            sys.deviceOrientation = "up";
            tryCompare(shell, "uiOrientation", "up", 3000);
            tryVerify(function() { return !shell.rotator.rotating; }, 3000);
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.cardView.maximizeProgress = 0;
            shell.keyboardOpen = false;
            // A failed test must not leave its notifications to the next.
            shell.notifications.dashboardOpen = false;
            while (windows.notifications.count > 0)
                windows.dismissNotification(0);
            shell.unlock();
            if (shell.launcherOpen)
                shell.gestureUp();
            tryCompare(shell, "launcherOpen", false, 2000);
        }

        function flickUp(distance) {
            var x = root.width / 2, y = root.height - 2;
            mousePress(root, x, y);
            for (var d = 10; d <= distance; d += 10)
                mouseMove(root, x, y - d);
            mouseRelease(root, x, y - distance);
        }

        function test_bottomEdgeFlickLeavesTheApp() {
            verify(shell.tablet);
            compare(Theme.gestureAreaHeight, 0);
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            flickUp(80);
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
            // In card view it opens the launcher, and again closes it.
            flickUp(80);
            tryCompare(shell, "launcherOpen", true, 2000);
            flickUp(80);
            tryCompare(shell, "launcherOpen", false, 2000);
        }

        // S7: the clock at the right end; the bar's fill fades in while an
        // app is up and out in card view.
        function test_statusBar() {
            verify(findChild(shell, "tabletClock").visible);
            verify(!findChild(shell, "centreClock").visible);
            var fill = findChild(shell, "statusBarFill");
            tryCompare(fill, "opacity", 0, 1000);
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            tryCompare(fill, "opacity", 1, 1000);
            // No pill on tablets; the arrow and the separator after the title.
            var bar = findChild(shell, "statusBar");
            var title = findChild(bar, "statusBarTitle");
            verify(!bar._shownBorder);
            var arrow = findChild(bar, "statusBarTitleArrow");
            tryCompare(arrow, "opacity", 1, 1500);
            verify(arrow.visible);
            fuzzyCompare(arrow.x, title.width + Theme.px(5), 0.5);
            verify(findChild(bar, "statusBarTitleSeparator").visible);
            compare(fill.color, Theme.statusBarFill);
            shell.cardView.minimize();
            tryCompare(fill, "opacity", 0, 1500);
        }

        // Turned to portrait (the TouchPad held with its home button down):
        // still the tablet layout, laid out 768 wide; the bottom-edge flick
        // comes from the UI's bottom edge, wherever that is on the screen
        // (handleScreenEdgeFlickGesture, SystemUiController.cpp:2041-2070).
        function test_portrait() {
            sys.deviceOrientation = "right";
            tryCompare(shell, "uiOrientation", "right", 1000);
            tryVerify(function() { return !shell.rotator.rotating; }, 2000);
            var ui = shell.uiRoot;
            compare(ui.width, 768);
            compare(ui.height, 1024);
            verify(shell.tablet);
            compare(findChild(shell, "statusBar").width, 768);
            verify(findChild(shell, "tabletClock").visible);
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            // Up from the UI's bottom edge: on the screen, its right edge.
            var from = ui.mapToItem(root, ui.width / 2, ui.height - 2);
            verify(from.x > root.width - 10);
            mousePress(root, from.x, from.y);
            for (var d = 10; d <= 80; d += 10) {
                var p = ui.mapToItem(root, ui.width / 2, ui.height - 2 - d);
                mouseMove(root, p.x, p.y);
            }
            var to = ui.mapToItem(root, ui.width / 2, ui.height - 82);
            mouseRelease(root, to.x, to.y);
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
            // The launcher fits as many 140 px columns as the width takes.
            shell.gestureUp();
            tryCompare(shell, "launcherOpen", true, 2000);
            compare(findChild(shell, "launcher").columns, 5);
        }

        function test_shortFlicksAndTheKeyboard() {
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            flickUp(20);
            wait(500);
            verify(shell.maximized);
            // With the keyboard up it must go at least 60 px.
            shell.keyboardOpen = true;
            flickUp(50);
            wait(500);
            verify(shell.maximized);
            flickUp(70);
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
        }

        // ---- The notification drop-down (uiComponents/DashboardMenu) ----------------

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

        function visibleGapShades(menu) {
            var n = 0;
            (function walk(o) {
                for (var i = 0; i < o.children.length; ++i) {
                    if (o.children[i].objectName === "dashboardMenuGapShade" && o.children[i].visible)
                        ++n;
                    walk(o.children[i]);
                }
            })(menu);
            return n;
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
            while (windows.notifications.count > 0)
                windows.dismissNotification(0);
        }

        // Drags a row sideways by dx in steps, `ms` apart (0: a quick
        // flick), in the shell's coordinates since the row moves.
        function dragRow(r, dx, steps, ms) {
            var p = r.mapToItem(root, 20, r.height / 2);
            mousePress(root, p.x, p.y);
            for (var i = 1; i <= steps; ++i) {
                if (ms > 0)
                    wait(ms);
                mouseMove(root, p.x + dx * i / steps, p.y, ms > 0 ? -1 : 5);
            }
            mouseRelease(root, p.x + dx, p.y, Qt.LeftButton, Qt.NoModifier, ms > 0 ? -1 : 5);
        }

        // Newest at the top (layoutAllWindowsInMenu), a 2 px divider above
        // every row but the top one; the art 15 px taller than the rows.
        function test_dashboardMenuNewestAtTop() {
            var menu = openMenu(["One", "Two", "Three"]);
            var rows = menuRows();
            compare(rows.length, 3);
            compare(rows[0].title, "Three");
            compare(rows[1].title, "Two");
            compare(rows[2].title, "One");
            compare(rows[0].y, 0);
            compare(rows[1].y, 52 + 2);
            compare(rows[2].y, 2 * (52 + 2));
            verify(!rows[0].divided);
            verify(rows[1].divided);
            verify(rows[2].divided);
            compare(visibleGapShades(menu), 0);
            compare(menu.containerHeight, 3 * 52 + 2 * 2);
            compare(findChild(menu, "dashboardMenuBorder").height, 3 * 52 + 2 * 2 + 15);
            // 342 wide, its right edge 11 px past the notification area's,
            // under the status bar.
            compare(menu.width, 342);
            compare(menu.mapToItem(root, menu.width, 0).x,
                    root.width - shell.notifications.statusBarRightInset + 11);
            compare(menu.mapToItem(root, 0, 0).y, Theme.statusBarHeight);
            // No fades: it all fits.
            compare(findChild(menu, "dashboardMenuScrollUp").opacity, 0);
            compare(findChild(menu, "dashboardMenuScrollDown").opacity, 0);
            closeMenu();
        }

        // At most 5 1/2 rows and their dividers (295 px), then it scrolls
        // under the fades and arrows.
        function test_dashboardMenuScrollsPastFiveAndAHalf() {
            var menu = openMenu(["1", "2", "3", "4", "5", "6", "7", "8"]);
            var flick = findChild(menu, "dashboardMenuFlickable");
            compare(menu.containerHeight, 8 * 52 + 7 * 2);
            compare(flick.height, 295);
            compare(findChild(menu, "dashboardMenuBorder").height, 295 + 15);
            tryCompare(findChild(menu, "dashboardMenuScrollDown"), "opacity", 1, 500);
            compare(findChild(menu, "dashboardMenuScrollUp").opacity, 0);
            flick.contentY = flick.contentHeight - flick.height;
            tryCompare(findChild(menu, "dashboardMenuScrollUp"), "opacity", 1, 500);
            tryCompare(findChild(menu, "dashboardMenuScrollDown"), "opacity", 0, 500);
            // Back at the top once closed.
            closeMenu();
            compare(flick.contentY, 0);
        }

        // The menu's rules (DashboardWindowContainer.cpp:292-296, 356-365,
        // 421): a row follows the finger rightwards only, over the swipe
        // shading; past a quarter of the width it slides off and goes,
        // otherwise back over 500 ms; a quick flick alone does nothing.
        function test_dashboardMenuSwipe() {
            var menu = openMenu(["One", "Two", "Three"]);
            var rows = menuRows();
            var top = rows[0];
            var shade = findChild(top, "dashboardMenuSwipeShade");

            // Slowly, 60 px (under a quarter of 320): the shading follows,
            // then the row goes back.
            var p = top.mapToItem(root, 20, 26);
            mousePress(root, p.x, p.y);
            for (var d = 10; d <= 60; d += 10) { wait(20); mouseMove(root, p.x + d, p.y); }
            verify(menu.dragging);
            verify(top.swipeX > 20);
            verify(shade.visible);
            compare(shade.width, top.swipeX);
            // Row height only: the top row has no divider.
            compare(shade.height, 52);
            mouseRelease(root, p.x + 60, p.y);
            verify(!menu.dragging);
            tryCompare(top, "swipeX", 0, 1500);
            // The row itself may still be a frame from home.
            tryVerify(function() { return !shade.visible; }, 1000);
            compare(windows.notifications.count, 3);

            // Leftwards it stays in place.
            dragRow(top, -120, 10, 20);
            compare(top.swipeX, 0);
            compare(windows.notifications.count, 3);

            // A quick sideways flick of 40 px: the phone's dashboard would
            // dismiss it; the menu puts it back.
            dragRow(top, 40, 2, 0);
            tryCompare(top, "swipeX", 0, 1500);
            compare(windows.notifications.count, 3);

            // The middle row, divider and all, 120 px: past a quarter.
            var mid = rows[1];
            p = mid.mapToItem(root, 20, 26);
            mousePress(root, p.x, p.y);
            for (d = 12; d <= 120; d += 12) { wait(20); mouseMove(root, p.x + d, p.y); }
            compare(findChild(mid, "dashboardMenuSwipeShade").height, 52 + 2);
            mouseRelease(root, p.x + 120, p.y);
            tryCompare(windows.notifications, "count", 2, 1000);
            compare(windows.notifications.get(0).title, "One");
            compare(windows.notifications.get(1).title, "Three");

            // The row below closes up and the list shrinks, over 500 ms
            // OutCubic, the gap shaded meanwhile.
            rows = menuRows();
            compare(rows.length, 2);
            verify(rows[1].y > 52 + 2);
            verify(menu.containerHeight > 2 * 52 + 2);
            verify(visibleGapShades(menu) > 0);
            tryCompare(rows[1], "y", 52 + 2, 1000);
            tryCompare(menu, "containerHeight", 2 * 52 + 2, 1000);
            // The shading goes with the last frame, which the fuzzy compares
            // above may not have reached yet.
            tryVerify(function() { return visibleGapShades(menu) === 0; }, 1000);
            compare(findChild(menu, "dashboardMenuBorder").height, 2 * 52 + 2 + 15);
            closeMenu();
        }

        // A new notification comes in from above the top while it shows.
        function test_dashboardMenuAddsAtTheTop() {
            var menu = openMenu(["One"]);
            windows.notify("org.webosphoenix.messaging", "Two", "");
            var rows = menuRows();
            compare(rows.length, 2);
            compare(rows[0].title, "Two");
            verify(rows[0].y < 0);
            tryCompare(rows[0], "y", 0, 1000);
            tryCompare(rows[1], "y", 52 + 2, 1000);
            tryCompare(menu, "containerHeight", 2 * 52 + 2, 1000);
            closeMenu();
        }

        // A tap on a row opens its app; a tap outside closes the menu.
        SignalSpy { id: activatedSpy; target: shell.notifications; signalName: "activated" }
        function test_dashboardMenuTap() {
            var menu = openMenu(["One"]);
            mouseClick(root, 100, 400);
            tryCompare(shell.notifications, "dashboardOpen", false, 1000);
            tryCompare(menu, "visible", false, 1000);
            shell.notifications.dashboardOpen = true;
            tryCompare(menu, "opacity", 1, 1000);
            activatedSpy.clear();
            mouseClick(menuRows()[0], 100, 26);
            compare(activatedSpy.count, 1);
            compare(activatedSpy.signalArguments[0][0], "org.webosphoenix.messaging");
            tryCompare(windows.notifications, "count", 0, 1000);
            tryCompare(menu, "visible", false, 1000);
            // Settle the app it launched.
            tryVerify(function() { return shell.maximized; }, 2000);
        }
    }
}
