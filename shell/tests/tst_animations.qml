// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The original's animations Phoenix had missing or different
// (docs/spec/ANIMATIONS.md), on a phone: their durations and curves as
// configured, and that Reduce motion and Animation speed reach them. The
// tablet's are in tst_tabletanimations.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    TestCase {
        name: "Animations"
        when: windowShown

        property var launcher: null

        function initTestCase() {
            launcher = findChild(shell, "launcher");
            verify(launcher);
            tryVerify(function() { return shell.launcherLayout !== null; }, 2000);
        }
        function init() {
            sys.tweaks = {};
            Theme.reduceMotion = false;
            shell.unlock();
            shell.notifications.dashboardOpen = false;
            shell.notifications.bannerActive = false;
            while (windows.notifications.count > 0)
                windows.notifications.remove(0);
        }
        function cleanup() {
            Theme.reduceMotion = false;
            sys.tweaks = {};
            if (shell.launcherOpen)
                shell.gestureUp();
            tryCompare(shell, "launcherOpen", false, 2000);
            launcher.showPage(0, true);
        }

        function pages() {
            for (var i = 0; i < launcher.children.length; ++i) {
                var c = launcher.children[i];
                if (c.orientation === ListView.Horizontal && c.hasOwnProperty("maximumFlickVelocity"))
                    return c;
            }
            return null;
        }

        // The menus, the status bar, the dashboard, banners, alerts and
        // rotation keep the original's times, and follow Reduce motion and
        // Animation speed as the cards and the launcher do.
        function test_durationsFollowReduceMotionAndSpeed() {
            var d = {
                statusBarMenuFadeDuration: 200, systemMenuFadeDuration: 200, systemMenuDrawerDuration: 350,
                systemMenuDrawerResizeDuration: 200, statusBarTabFadeDuration: 300, notificationIconsFadeDuration: 300,
                statusBarItemSlideDuration: 1000, bannerSlideDuration: 1000, alertFadeDuration: 400,
                positiveSpaceDuration: 400, dashboardDeleteDuration: 200, dashboardSnapDuration: 500,
                launcherPageSnapDuration: 250, appInfoDialogFadeInDuration: 400, appInfoDialogFadeOutDuration: 600
            };
            var k;
            for (k in d)
                compare(Theme[k], d[k], k);
            compare(shell.rotator.animationDuration, 300);
            sys.tweaks = { animationSpeed: "fast" };
            for (k in d)
                compare(Theme[k], Math.round(d[k] * 0.6), k + " fast");
            compare(shell.rotator.animationDuration, 180);
            sys.tweaks = {};
            Theme.reduceMotion = true;
            for (k in d)
                compare(Theme[k], 1, k + " reduced");
            compare(shell.rotator.animationDuration, 1);
            Theme.reduceMotion = false;
            // The flick's bounds (Phoenix's, snappier than the original's 200
            // to 1200 ms) clamp a time it works out; the time itself goes
            // through motion() as it is used.
            compare(Theme.launcherPageFlickMinDuration, 150);
            compare(Theme.launcherPageFlickMaxDuration, 400);
        }

        // A tab's tap (or the keyboard) makes the page current at once and
        // glides the pages there over 250 ms InQuad.
        function test_showPageGlidesInQuad() {
            shell.gestureUp();
            tryCompare(launcher, "hidden", 0, 2000);
            var view = pages();
            verify(view);
            var glide = findChild(launcher, "launcherPageGlide");
            verify(glide);
            launcher.showPage(1);
            compare(launcher.currentPage, 1);
            verify(glide.running);
            compare(glide.duration, 250);
            compare(glide.easing.type, Easing.InQuad);
            compare(glide.to, view.originX + view.width);
            tryCompare(view, "contentX", view.originX + view.width, 1000);
            launcher.showPage(0, true);
            compare(view.contentX, view.originX);
        }

        // A drag at the page's top or bottom scrolls it 150 px over 300 ms,
        // linear (page.cpp:1708-1711).
        function test_edgeAutoscrollIsLinear() {
            var scroll = findChild(launcher, "launcherPageScroll");
            verify(scroll);
            compare(scroll.duration, 300);
            compare(scroll.easing.type, Easing.Linear);
        }

        // A drag let go slowly goes back to the page nearest the middle,
        // 250 ms InQuad; a flick goes on to the page beside, OutCubic, in a
        // time worked out from its speed, 150 to 400 ms.
        function test_dragAndFlickBetweenPages() {
            shell.gestureUp();
            tryCompare(launcher, "hidden", 0, 2000);
            var view = pages();
            var glide = findChild(launcher, "launcherPageGlide");
            var y = view.mapToItem(root, 0, view.height / 2).y;
            // Slowly, a third of the way: back.
            mousePress(root, 250, y);
            for (var i = 1; i <= 10; ++i) {
                mouseMove(root, 250 - i * 10, y);
                wait(40);
            }
            mouseRelease(root, 150, y);
            compare(launcher.currentPage, 0);
            verify(glide.running);
            compare(glide.easing.type, Easing.InQuad);
            compare(glide.duration, 250);
            tryCompare(view, "contentX", view.originX, 1000);
            // A flick a third of the way (5 px/ms, as a finger's let go):
            // on to page 1.
            view.contentX = view.originX + view.width / 3;
            launcher._dragStartX = view.originX;
            launcher._dragStartTime = Date.now() - (view.width / 3) / 5;
            launcher._dragSamples = [[launcher._dragStartTime, view.originX]];
            launcher._dragStartPage = 0;
            launcher._pagesDragEnded();
            compare(launcher.currentPage, 1);
            verify(glide.running);
            compare(glide.easing.type, Easing.OutCubic);
            // distance / (5 x 100 / 1000) px/ms, within 150 to 400 ms.
            var expected = Math.max(150, Math.min(400, Math.round((view.width * 2 / 3) / 0.5)));
            verify(Math.abs(glide.duration - expected) <= expected * 0.2, "flick time " + glide.duration + " ~ " + expected);
            tryCompare(view, "contentX", view.originX + view.width, 2000);
        }

        // Phoenix's snappier flick: the finger's speed as it lets go counts,
        // so a slow drag that ends in a quick flick goes on to the next page
        // (the original's whole-drag average would have snapped it back).
        function test_launcherFlickAtTheEnd() {
            shell.gestureUp();
            tryCompare(launcher, "hidden", 0, 2000);
            var view = pages();
            launcher.showPage(0, true);
            var y = view.mapToItem(root, 0, view.height / 2).y;
            mousePress(root, 300, y);
            for (var i = 1; i <= 8; ++i) {          // slowly, 4 px a step
                mouseMove(root, 300 - i * 4, y);
                wait(60);
            }
            for (i = 1; i <= 4; ++i) {              // then quickly, 20 px a step
                mouseMove(root, 268 - i * 20, y);
                wait(10);
            }
            mouseRelease(root, 188, y);
            compare(launcher.currentPage, 1);
            launcher.showPage(0, true);
        }

        // A notification its app takes back slides out of the open dashboard
        // over 200 ms, linear, a width and a half (removeWindow).
        function test_rowRemovedByItsAppSlidesOut() {
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "One");
            windows.notify("org.webosphoenix.email", "Mail", "Two");
            shell.notifications.bannerActive = false;
            shell.notifications.dashboardOpen = true;
            var notes = shell.notifications;
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            var list = findChild(notes, "phoneDashboardList");
            verify(list);
            var row = null;
            for (var i = 0; i < list.contentItem.children.length && !row; ++i)
                if (list.contentItem.children[i].hasOwnProperty("leaveAnimation"))
                    row = list.contentItem.children[i];
            verify(row);
            var anim = row.leaveAnimation;
            compare(anim.property, "x");
            compare(anim.duration, Theme.dashboardDeleteDuration);
            compare(anim.easing.type, Easing.Linear);
            compare(anim.to, Theme.dashboardDeleteTravel * list.width);
            windows.notifications.remove(0);
            // The row stays while it slides off, then goes.
            function leaving() {
                for (var i = 0; i < list.contentItem.children.length; ++i) {
                    var c = list.contentItem.children[i];
                    if (c.hasOwnProperty("slidOut") && c.slidOut)
                        return c;
                }
                return null;
            }
            tryVerify(function() { return leaving() !== null; }, 1000, "slides out");
            tryVerify(function() { return leaving() === null; }, 2000, "and goes");
            compare(list.count, 1);
            notes.dashboardOpen = false;
        }

        // The launcher's Remove Application? fades in over 400 ms and out
        // over 600 (the app info dialog's, DynamicsSettings).
        function test_appInfoDialogFades() {
            var dialog = findChild(shell, "deleteDialog");
            verify(dialog);
            compare(dialog.fadeDuration, 600);
            dialog.appId = "org.webosphoenix.calculator";
            compare(dialog.fadeDuration, 400);
            tryCompare(dialog, "opacity", 1, 2000);
            dialog.appId = "";
            compare(dialog.fadeDuration, 600);
            tryCompare(dialog, "opacity", 0, 2000);
        }
    }
}
