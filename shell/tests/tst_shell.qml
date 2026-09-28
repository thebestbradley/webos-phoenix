// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Behaviour tests for the card view and shell navigation.
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
        system: SimSystemStatus {}
    }

    TestCase {
        name: "Shell"
        when: windowShown

        function init() {
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            while (windows.notifications.count > 0)
                windows.dismissNotification(0);
            shell.cardView.position = 0;
            shell.cardView.maximizeProgress = 0;
            shell.unlock();
        }

        function test_scaleMatchesLegacy() {
            // 320px wide phone: 1 legacy px == 1 device px.
            compare(Theme.u, 1.0);
            compare(Theme.statusBarHeight, 28);
            compare(Theme.activeCardRatio, 0.659);
            compare(Theme.nonActiveCardRatio, 0.61);
            // Pre: 452px window area minus the gesture strip, less the 48px pill.
            var cv = shell.cardView;
            fuzzyCompare(cv.baseActiveScale, (cv.windowHeight - 48) * 0.659 / cv.windowHeight, 0.0001);
        }

        function test_launchInsertsNextToCurrentCard() {
            var a = windows.launch("org.webosphoenix.email", "");
            var b = windows.launch("org.webosphoenix.calendar", a);
            var c = windows.launch("org.webosphoenix.memos", a);
            compare(windows.cards.count, 3);
            compare(windows.cards.get(0).uid, a);
            compare(windows.cards.get(1).uid, c);
            compare(windows.cards.get(2).uid, b);
        }

        function test_relaunchFocusesExistingCard() {
            var a = windows.launch("org.webosphoenix.email", "");
            compare(windows.launch("org.webosphoenix.email", ""), a);
            compare(windows.cards.count, 1);
        }

        function test_shellLaunchMaximizes() {
            shell.launch("org.webosphoenix.email");
            // maximized flips only when the animation lands exactly on 1.
            tryVerify(function() { return shell.maximized; }, 2000);
            shell.gestureUp();
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
        }

        function test_closeLastCardSlidesLeft() {
            windows.launch("org.webosphoenix.email", "");
            windows.launch("org.webosphoenix.calendar", "");
            var last = windows.launch("org.webosphoenix.memos", "");
            shell.cardView.position = 2;
            shell.cardView.close(last);
            compare(windows.cards.count, 2);
            tryCompare(shell.cardView, "position", 1, 2000);
        }

        function test_closeMiddleKeepsPosition() {
            windows.launch("org.webosphoenix.email", "");
            var mid = windows.launch("org.webosphoenix.calendar", "");
            var last = windows.launch("org.webosphoenix.memos", "");
            shell.cardView.position = 1;
            shell.cardView.close(mid);
            compare(shell.cardView.position, 1);
            compare(shell.cardView.currentUid, last);
        }

        function test_flickUpClosesCard() {
            windows.launch("org.webosphoenix.email", "");
            wait(50);
            var cv = shell.cardView;
            var x = cv.width / 2, y = cv.cardOriginY;
            mousePress(cv, x, y);
            for (var i = 1; i <= 10; ++i)
                mouseMove(cv, x, y - i * 25, 5);
            mouseRelease(cv, x, y - 250);
            tryCompare(windows.cards, "count", 0, 2000);
        }

        // Flick a card up with one finger at (x, y).
        function flickUp(x, y) {
            var cv = shell.cardView;
            mousePress(cv, x, y);
            for (var i = 1; i <= 10; ++i)
                mouseMove(cv, x, y - i * 25, 5);
            mouseRelease(cv, x, y - 250);
        }

        // The angry card: pulled down until its centre leaves the bottom of
        // the screen, it is slung up off the top and closed.
        function test_pullingACardOffTheBottomSlingshotsItClosed() {
            windows.launch("org.webosphoenix.email", "");
            wait(50);
            var cv = shell.cardView;
            var x = cv.width / 2, y = cv.cardOriginY;
            var slung = false;
            var watch = function() { slung = true; };
            cv.angryCardClosed.connect(watch);
            mousePress(cv, x, y);
            for (var i = 1; i <= 12; ++i)
                mouseMove(cv, x, y + i * 25, 10);
            mouseRelease(cv, x, y + 300);
            cv.angryCardClosed.disconnect(watch);
            verify(slung, "released below the screen: angry close");
            tryCompare(windows.cards, "count", 0, 2000);
        }

        function test_pullingACardDownALittleSpringsBack() {
            windows.launch("org.webosphoenix.email", "");
            wait(50);
            var cv = shell.cardView;
            var x = cv.width / 2, y = cv.cardOriginY;
            mousePress(cv, x, y);
            for (var i = 1; i <= 4; ++i)
                mouseMove(cv, x, y + i * 15, 10);
            mouseRelease(cv, x, y + 60);
            wait(Theme.cardSlideDuration + 100);
            compare(windows.cards.count, 1);
        }

        function test_flickUpClosesCardBesideTheCurrentOne() {
            // The neighbouring card peeks in at the right edge; it can be
            // flicked away without sliding to it first.
            windows.launch("org.webosphoenix.email", "");
            var right = windows.launch("org.webosphoenix.calendar", "");
            wait(50);
            var cv = shell.cardView;
            compare(cv.currentGroup, 0);
            var p = cv.layout.cards[right];
            verify(p.cx - cv.windowWidth * p.scale / 2 < cv.width, "the next card shows at the edge");
            flickUp(cv.width - 5, cv.cardOriginY);
            tryCompare(windows.cards, "count", 1, 2000);
            compare(windows.cards.get(0).appId, "org.webosphoenix.email");
        }

        function test_twoFingersCloseTwoCardsAtOnce() {
            windows.launch("org.webosphoenix.email", "");
            windows.launch("org.webosphoenix.calendar", "");
            windows.launch("org.webosphoenix.memos", "");
            shell.cardView.position = 1;
            wait(50);
            var cv = shell.cardView;
            var y = cv.cardOriginY;
            var t = touchEvent(cv);
            t.press(0, cv, cv.width / 2, y).press(1, cv, cv.width - 5, y).commit();
            for (var i = 1; i <= 10; ++i) {
                t.move(0, cv, cv.width / 2, y - i * 25).move(1, cv, cv.width - 5, y - i * 25).commit();
                wait(5);
            }
            t.release(0, cv, cv.width / 2, y - 250).release(1, cv, cv.width - 5, y - 250).commit();
            tryCompare(windows.cards, "count", 1, 2000);
            compare(windows.cards.get(0).appId, "org.webosphoenix.email");
        }

        function test_searchPillShowsInCardViewAndOpensJustType() {
            var pill = shell.searchPill;
            tryCompare(pill, "opacity", 1, 1000);
            mouseClick(pill, pill.width / 2, pill.height / 2);
            verify(shell.justTypeOpen);
            tryCompare(pill, "opacity", 0, 1000);
            shell.gestureBack();
            verify(!shell.justTypeOpen);
            shell.launch("org.webosphoenix.email");
            tryVerify(function() { return shell.maximized; }, 2000);
            tryCompare(pill, "opacity", 0, 1000);
        }

        // Phones: notifications take space from the bottom of the app, never
        // cover it (SystemUiController::changeNegativeSpace).
        function test_notificationShrinksTheAppInsteadOfCoveringIt() {
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximizeProgress = 1;
            var notes = shell.notifications;
            var fullHeight = shell.cardView.windowHeight;
            compare(notes.negativeSpace, 0);
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "It's good to be back.");
            tryCompare(notes, "negativeSpace", Theme.bannerHeight, 2000);
            compare(shell.cardView.windowHeight, fullHeight - Theme.bannerHeight);
            // The dashboard grows upward and the app moves up with it.
            notes.dashboardOpen = true;
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            verify(notes.dashboardHeight > Theme.bannerHeight);
            compare(shell.cardView.windowHeight, fullHeight - notes.dashboardHeight);
            verify(notes.dashboardHeight <= shell.height * Theme.maximumNegativeSpaceRatio);
            // Nothing left: the app gets its space back.
            notes.dashboardOpen = false;
            windows.dismissNotification(0);
            notes.bannerActive = false;
            tryCompare(notes, "negativeSpace", 0, 2000);
            compare(shell.cardView.windowHeight, fullHeight);
        }

        function test_appNameOpensTheAppMenu() {
            var uid = windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximizeProgress = 1;
            var app = windows.windowFor(uid);
            verify(!app.appMenuOpen);
            // The app name, at the top left of the status bar.
            mouseClick(shell, 30, Theme.statusBarHeight / 2);
            verify(app.appMenuOpen);
            // The back gesture closes it first.
            shell.gestureBack();
            verify(!app.appMenuOpen);
            // In card view the name is not shown and nothing opens.
            shell.cardView.maximizeProgress = 0;
            mouseClick(shell, 30, Theme.statusBarHeight / 2);
            verify(!app.appMenuOpen);
        }

        // A popup alert takes the negative space (phones), above the bar.
        function test_popupAlertTakesTheNegativeSpace() {
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximizeProgress = 1;
            var notes = shell.notifications;
            var fullHeight = shell.cardView.windowHeight;
            windows.alerts.append({ key: "alert-test", appId: "org.webosphoenix.email", height: 150 });
            tryCompare(notes, "negativeSpace", Theme.px(150), 2000);
            compare(shell.cardView.windowHeight, fullHeight - Theme.px(150));
            windows.alerts.clear();
            notes.bannerActive = false;
            tryCompare(notes, "negativeSpace", 0, 2000);
        }

        // PalmSystem.addBannerMessage: the banner scrolls by and leaves
        // nothing in the dashboard.
        function test_bannerMessageIsTransient() {
            var notes = shell.notifications;
            windows.bannerRequested("org.webosphoenix.email", "Charging Battery", "");
            verify(notes.bannerActive);
            compare(notes.bannerText, "Charging Battery");
            compare(windows.notifications.count, 0);
            notes.bannerActive = false;
        }

        function test_tapCardMaximizes() {
            windows.launch("org.webosphoenix.email", "");
            wait(50);
            mouseClick(shell.cardView, shell.cardView.width / 2, shell.cardView.cardOriginY);
            tryCompare(shell.cardView, "maximizeProgress", 1, 2000);
        }

        function test_backGoesToApp() {
            var uid = windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximizeProgress = 1;
            windows.windowFor(uid).detail = "Inbox";
            shell.gestureBack();
            compare(windows.windowFor(uid).detail, "");
        }

        function test_upGestureTogglesLauncherInCardView() {
            verify(!shell.launcherOpen);
            shell.gestureUp();
            verify(shell.launcherOpen);
            shell.gestureUp();
            verify(!shell.launcherOpen);
        }

        function test_lockedIgnoresGestures() {
            shell.lock();
            shell.gestureUp();
            verify(!shell.launcherOpen);
            shell.unlock();
        }

        function test_tappedNotificationLaunchesWithItsParams() {
            windows.notify("org.webosphoenix.email", "Call Ada", "Due Today", { taskId: "t1" });
            windows.notify("org.webosphoenix.email", "Plain", "No params");
            compare(windows.notifications.get(0).params, '{"taskId":"t1"}');
            compare(windows.notifications.get(1).params, "");
            shell.notifications.activated("org.webosphoenix.email", windows.notifications.get(0).params);
            compare(windows.cards.count, 1);
            compare(windows.cards.get(0).appId, "org.webosphoenix.email");
            // Like any launch it maximizes the card; settle before the next test.
            tryVerify(function() { return shell.maximized; }, 2000);
            shell.gestureUp();
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
        }

        SignalSpy { id: focusSpy; target: windows; signalName: "cardFocusRequested" }

        function test_activityLaunchStaysInTheBackground() {
            focusSpy.clear();
            windows._hostMessage("org.webosphoenix.calendar", "", "launch",
                                 { id: "org.webosphoenix.email", params: { reminder: "t1", $activity: { activityId: 1 } } });
            compare(windows.cards.count, 1);
            compare(focusSpy.count, 0);
            compare(shell.cardView.maximizeProgress, 0);
        }
    }
}
