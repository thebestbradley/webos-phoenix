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

    Component {
        id: spyComponent
        SignalSpy {}
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

        function test_scaleFollowsDensityNotSize() {
            // Pre, Pre 3, TouchPad, a ~460 ppi phone; desktops and virtual
            // machines (no size reported) stay 1.0.
            compare(Theme.densityFor(186), 1.0);
            compare(Theme.densityFor(260), 1.5);
            compare(Theme.densityFor(132), 1.0);
            compare(Theme.densityFor(460), 2.5);
            compare(Theme.densityFor(0), 1.0);
            compare(Theme.densityFor(NaN), 1.0);

            // Pre 3: a 320x533 canvas, a phone.
            verify(!Theme.tabletLayoutFor(480, 800, 1.5));
            // A bigger window shows more at the same scale; big enough, it
            // is a tablet.
            verify(Theme.tabletLayoutFor(900, 1400, 1));
            verify(Theme.tabletLayoutFor(1024, 768, 1));
            // A phone on its side stays a phone.
            verify(!Theme.tabletLayoutFor(480, 320, 1));
            verify(!Theme.tabletLayoutFor(2400, 1080, 2.5));
            // The live shell: forced phone, density from the output.
            verify(!shell.tablet);
            compare(Theme.u, shell.effectiveDensity);
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

        function test_newCardRisesFromBelow() {
            var uid = shell.launch("org.webosphoenix.email");
            wait(60);
            var card = shell.cardView.cardItem(uid);
            // Full size, below its maximized place, coming up.
            compare(card.cardScale, 1);
            verify(card.centerY > shell.cardView.maximizedCenterY + 20);
            tryVerify(function() { return shell.maximized; }, 2000);
            compare(shell.cardView.risingUid, "");
            fuzzyCompare(card.centerY, shell.cardView.maximizedCenterY, 0.5);
        }

        // Launching from a maximized app: that card zooms out to card view
        // while the new one waits below, then rises (prepareAddWindowSibling:
        // slideAllGroups, then maximizeActiveWindow).
        function test_launchFromAppZoomsOutThenRises() {
            var a = shell.launch("org.webosphoenix.email");
            tryVerify(function() { return shell.maximized; }, 2000);
            var old = shell.cardView.cardItem(a);
            var b = shell.launch("org.webosphoenix.calendar");
            wait(80);
            // Part way down to card view, not snapped there.
            verify(old.scale < 0.99 && old.scale > shell.cardView.activeScale + 0.01,
                   "the card in front zooms out (scale " + old.scale + ")");
            var card = shell.cardView.cardItem(b);
            verify(card.centerY > shell.cardView.maximizedCenterY + 20, "the new card waits below");
            tryVerify(function() { return shell.maximized && shell.cardView.currentUid === b; }, 3000);
            fuzzyCompare(card.centerY, shell.cardView.maximizedCenterY, 0.5);
        }

        // An app not ready after cardAddMaxDuration slides into its stack in
        // card view with its loading screen, and maximizes once it is ready
        // (addWindowTimedOutNormal, LoadingState).
        function test_slowAppLoadsInCardViewThenMaximizes() {
            var a = shell.launch("org.webosphoenix.email");
            tryVerify(function() { return shell.maximized; }, 2000);
            var b = shell.launch("org.webosphoenix.calendar");
            windows.windowFor(b).ready = false;
            var card = shell.cardView.cardItem(b);
            wait(Theme.cardAddMaxDuration + Theme.cardSlideDuration + 200);
            verify(!shell.maximized);
            compare(shell.cardView.risingUid, "");
            compare(shell.cardView.loadingUid, b);
            compare(shell.cardView.currentUid, b);
            verify(card.loading);
            fuzzyCompare(card.cardScale, shell.cardView.activeScale, 0.001);
            fuzzyCompare(card.scale, shell.cardView.activeScale, 0.01);
            fuzzyCompare(card.centerY, shell.cardView.cardOriginY, 1);
            windows.windowFor(b).ready = true;
            tryVerify(function() { return shell.maximized && shell.cardView.currentUid === b; }, 2000);
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
            // The stack slides over while the card is still flying off.
            compare(shell.cardView.groupCount, 2);
            tryCompare(shell.cardView, "position", 1, 2000);
            tryCompare(windows.cards, "count", 2, 2000);
        }

        function test_closeFliesOffTheTopWhileTheRestSlide() {
            windows.launch("org.webosphoenix.email", "");
            var mid = windows.launch("org.webosphoenix.calendar", "");
            windows.launch("org.webosphoenix.memos", "");
            shell.cardView.position = 1;
            wait(400);
            var card = shell.cardView.cardItem(mid);
            shell.cardView.close(mid);
            // Out of the layout at once; the window goes when it is off the top.
            compare(shell.cardView.groupCount, 2);
            compare(windows.cards.count, 3);
            wait(150);
            verify(card.flickOffset < 0);
            compare(card.opacity, 1);
            tryCompare(windows.cards, "count", 2, 1000);
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
            windows.bannerRequested("org.webosphoenix.email", "Charging Battery", "", "", "", "", 0);
            verify(notes.bannerActive);
            compare(notes.bannerText, "Charging Battery");
            compare(windows.notifications.count, 0);
            notes.bannerActive = false;
        }

        // Phones: the banner scrolls up from the bottom of the bar; a tap
        // launches its app with its params (BannerWindow::handleTap).
        function test_bannerRisesAndTapLaunches() {
            var notes = shell.notifications;
            var content = findChild(notes, "bannerContent");
            windows.bannerRequested("org.webosphoenix.email", "New mail", "", "{\"folder\":\"inbox\"}", "", "", 0);
            wait(100);
            // Still below its place, coming up; not from the side.
            verify(content.y > (Theme.bannerHeight - content.height) / 2);
            compare(content.x, Theme.px(5));
            tryCompare(notes, "bannerProgress", 1, 2000);
            var spy = createTemporaryObject(spyComponent, root, { target: notes, signalName: "activated" });
            notes.tapBanner();
            compare(spy.count, 1);
            compare(spy.signalArguments[0][0], "org.webosphoenix.email");
            compare(JSON.parse(spy.signalArguments[0][1]).folder, "inbox");
            // Without params a tap does nothing while the banner shows.
            windows.bannerRequested("org.webosphoenix.email", "Charging Battery", "", "", "", "", 0);
            notes.tapBanner();
            compare(spy.count, 1);
            verify(!notes.dashboardOpen);
            notes.bannerActive = false;
        }

        function dashboardRows() {
            var out = [];
            (function walk(o) {
                for (var i = 0; i < o.children.length; ++i) {
                    if (o.children[i].objectName === "dashboardSwipe")
                        out.push(o.children[i]);
                    walk(o.children[i]);
                }
            })(shell.notifications);
            return out;
        }

        // Phones: a dismissed row slides off to the right over 200 ms; a
        // short slow drag snaps back; a fast sideways flick dismisses
        // (DashboardWindowContainer.cpp:340-360, 426-440, 700-708).
        function test_dashboardDismiss() {
            var notes = shell.notifications;
            windows.notify("org.webosphoenix.messaging", "One", "");
            windows.notify("org.webosphoenix.messaging", "Two", "");
            windows.notify("org.webosphoenix.messaging", "Three", "");
            notes.bannerActive = false;
            notes.dashboardOpen = true;
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            // Phones: the rows and the 10 px above them (Phoenix: under the drawer's handle).
            compare(notes.dashboardHeight, Theme.drawerHandleHeight + Theme.dashboardTopPadding + 3 * Theme.dashboardItemHeight);
            var rows = dashboardRows();
            compare(rows.length, 3);

            // A tenth of the width, slowly: back to where it was.
            var r = rows[0], y = r.height / 2;
            mousePress(r, 20, y);
            for (var i = 1; i <= 8; ++i) { wait(20); mouseMove(r, 20 + i * 4, y); }
            mouseRelease(r, 52, y);
            tryCompare(r.parent, "x", 0, 1500);
            compare(windows.notifications.count, 3);

            // Past a quarter, slowly: slides right, then goes. "Clear" shows in
            // the space it leaves, bright once letting go clears it.
            mousePress(r, 20, y);
            for (i = 1; i <= 10; ++i) { wait(30); mouseMove(r, 20 + i * 12, y); }
            var clear = findChild(r.parent.parent, "swipeClearLabel");
            verify(clear && clear.visible && clear.armed, "Clear shows, armed");
            compare(clear.text, "Clear");
            mouseRelease(r, 140, y);
            tryCompare(windows.notifications, "count", 2, 1000);

            // A quick short flick sideways.
            rows = dashboardRows();
            r = rows[0];
            mousePress(r, 20, y);
            mouseMove(r, 40, y, 5);
            mouseMove(r, 60, y, 5);
            mouseRelease(r, 60, y, Qt.LeftButton, Qt.NoModifier, 5);
            tryCompare(windows.notifications, "count", 1, 1000);
            notes.dashboardOpen = false;
        }

        // An ongoing activity (a download, an install: org.webosphoenix.ongoing)
        // is one row per id with its progress; swiping does not dismiss it, a
        // tap opens its app and leaves it; it goes when cleared.
        function test_ongoingActivity() {
            var notes = shell.notifications;
            windows.setOngoing("org.webosphoenix.settings", { id: "com.palm.update", title: "Downloading webOS Phoenix 0.2.0",
                                                               body: "10%", progress: 10, params: { page: "updates" } });
            windows.setOngoing("org.webosphoenix.settings", { id: "com.palm.update", title: "Downloading webOS Phoenix 0.2.0",
                                                               body: "60%", progress: 60, params: { page: "updates" } });
            compare(windows.notifications.count, 1);
            compare(windows.notifications.get(0).progress, 60);
            compare(windows.notifications.get(0).ongoing, true);
            notes.bannerActive = false;
            notes.dashboardOpen = true;
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            var bar = findChild(notes, "dashboardProgress");
            verify(bar && bar.visible);

            var r = dashboardRows()[0], y = r.height / 2;
            mousePress(r, 20, y);
            for (var i = 1; i <= 10; ++i) { wait(30); mouseMove(r, 20 + i * 12, y); }
            mouseRelease(r, 140, y);
            wait(400);
            compare(windows.notifications.count, 1);

            var launched = [];
            var onActivated = function (appId, params) { launched.push([appId, params]); };
            notes.activated.connect(onActivated);
            mouseClick(r, 40, y);
            notes.activated.disconnect(onActivated);
            compare(launched.length, 1);
            compare(launched[0][0], "org.webosphoenix.settings");
            compare(JSON.parse(launched[0][1]).page, "updates");
            compare(windows.notifications.count, 1);

            windows.setOngoing("org.webosphoenix.settings", { id: "com.palm.update", clear: true });
            compare(windows.notifications.count, 0);
            notes.dashboardOpen = false;
            notes.bannerActive = false;
            tryCompare(notes, "negativeSpace", 0, 2000);
        }

        // An app's live activities go when its last card closes (their
        // work ran in its pages; they cannot be swiped away); another
        // app's stay.
        function test_ongoingGoesWithItsApp() {
            var a = windows.launch("org.webosphoenix.memos", "");
            var b = windows.launch("org.webosphoenix.memos", "");
            windows.setOngoing("org.webosphoenix.memos", { id: "one", title: "Syncing", progress: -1 });
            windows.setOngoing("org.webosphoenix.memos", { id: "two", title: "Uploading", progress: 40 });
            windows.setOngoing("org.webosphoenix.marketplace", { id: "dl", title: "Downloading Hooked", progress: 30 });
            compare(windows.notifications.count, 3);
            windows.close(a);
            if (b !== a) {
                compare(windows.notifications.count, 3, "a card of it still runs");
                windows.close(b);
            }
            compare(windows.notifications.count, 1);
            compare(windows.notifications.get(0).id, "ongoing:org.webosphoenix.marketplace:dl");
            windows.setOngoing("org.webosphoenix.marketplace", { id: "dl", clear: true });
            compare(windows.notifications.count, 0);
        }

        // Phones open the list at its end (the newest notification), but
        // with live activities, at its start: they are pinned on top and
        // must not open half hidden under the handle.
        function test_phoneDashboardOpensOnActivities() {
            var notes = shell.notifications;
            for (var i = 0; i < 6; ++i)
                windows.notify("org.webosphoenix.messaging", "Text " + i, "");
            windows.setOngoing("org.webosphoenix.marketplace", { id: "dl", title: "Downloading Hooked", progress: 30 });
            notes.bannerActive = false;
            notes.dashboardOpen = true;
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            var list = findChild(notes, "phoneDashboardList");
            verify(list && list.contentHeight > list.height, "more rows than fit");
            tryVerify(function() { return list.atYBeginning; }, 1000, "opens at the activity");
            var row = dashboardRows()[0];
            var top = row.mapToItem(list, 0, 0).y;
            verify(top >= -0.5, "the activity's row is whole (" + top + ")");
            notes.dashboardOpen = false;
            tryVerify(function() { return findChild(notes, "phoneDashboardList") === null; }, 2000);
            windows.setOngoing("org.webosphoenix.marketplace", { id: "dl", clear: true });
            // Without one: at the newest notification, as the original.
            notes.dashboardOpen = true;
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            list = findChild(notes, "phoneDashboardList");
            tryVerify(function() { return list.atYEnd; }, 1000, "opens at the newest");
            notes.dashboardOpen = false;
            while (windows.notifications.count > 0)
                windows.notifications.remove(0);
            notes.bannerActive = false;
            tryCompare(notes, "negativeSpace", 0, 2000);
        }

        function visibleChild(parentItem, name) {
            var found = null;
            (function walk(o) {
                for (var i = 0; i < o.children.length && !found; ++i) {
                    if (o.children[i].objectName === name && o.children[i].visible)
                        found = o.children[i];
                    walk(o.children[i]);
                }
            })(parentItem);
            return found;
        }

        // Phoenix: live activities are pinned at the top with a faint rule
        // under them; the handle pulls the dashboard up to the whole
        // screen, where Select and Clear All clear notifications but never
        // a live activity.
        function test_drawerPinsActivitiesSelectsAndClears() {
            var notes = shell.notifications;
            windows.notify("org.webosphoenix.messaging", "First", "");
            windows.notify("org.webosphoenix.messaging", "Second", "");
            windows.notify("org.webosphoenix.messaging", "Third", "");
            windows.setOngoing("org.webosphoenix.marketplace", { id: "dl", title: "Downloading Hooked", progress: 30 });
            compare(windows.notifications.get(0).ongoing, true, "the activity goes to the top");
            compare(notes.ongoingCount, 1);
            notes.bannerActive = false;
            notes.dashboardOpen = true;
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            verify(visibleChild(notes, "drawerRule") !== null, "a rule under the activity");

            // Pull the handle up past the threshold: the whole screen.
            var area = findChild(notes, "drawerHandleArea");
            var p = area.mapToItem(shell, area.width / 2, area.height / 2);
            mousePress(shell, p.x, p.y);
            for (var i = 1; i <= 10; ++i) { wait(16); mouseMove(shell, p.x, p.y - i * 12); }
            mouseRelease(shell, p.x, p.y - 120);
            verify(notes.drawerExpanded);
            tryCompare(notes, "phoneSpaceHeight", notes.drawerFullHeight, 2000);
            verify(visibleChild(notes, "drawerHeader") !== null);

            // Select one notification and clear it.
            mouseClick(visibleChild(notes, "drawer_select"));
            verify(notes.selecting);
            var rows = dashboardRows();
            compare(rows.length, 4);
            mouseClick(rows[0]);                    // the activity: not selectable
            compare(notes.selectedCount, 0);
            mouseClick(rows[2]);                    // "Second"
            compare(notes.selectedCount, 1);
            verify(visibleChild(notes, "drawerSelectMark") !== null);
            mouseClick(visibleChild(notes, "drawer_clearSelected"));
            compare(windows.notifications.count, 3);
            compare(windows.notifications.get(1).title, "First");
            compare(windows.notifications.get(2).title, "Third");
            verify(!notes.selecting);

            // Clear All asks once ("Clear 2?"); the second tap clears, and
            // the activity stays.
            var clearAll = visibleChild(notes, "drawer_clearAll");
            mouseClick(clearAll);
            compare(windows.notifications.count, 3);
            compare(clearAll.text, "Clear 2?");
            mouseClick(clearAll);
            compare(windows.notifications.count, 1);
            compare(windows.notifications.get(0).ongoing, true);

            // A tap on the handle goes back to the normal size.
            mouseClick(findChild(notes, "drawerHandleArea"));
            verify(!notes.drawerExpanded);
            tryVerify(function() { return Math.abs(notes.phoneSpaceHeight - notes.dashboardHeight) < 0.5; }, 2000);

            windows.setOngoing("org.webosphoenix.marketplace", { id: "dl", clear: true });
            compare(windows.notifications.count, 0);
            notes.dashboardOpen = false;
            notes.bannerActive = false;
            tryCompare(notes, "negativeSpace", 0, 2000);
        }

        // Regressions: a tap just under the handle (to put the drawer back)
        // never reaches Clear All; Clear All's first tap clears nothing and
        // lapses; a pull down longer than the dashboard closes it rather
        // than leaving it pulled to nothing with the cards and the quick
        // launch bar held above the space it took.
        function test_drawerCloseKeepsNotificationsAndSpace() {
            var notes = shell.notifications;
            windows.notify("org.webosphoenix.messaging", "First", "");
            windows.notify("org.webosphoenix.messaging", "Second", "");
            notes.bannerActive = false;
            notes.dashboardOpen = true;
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            mouseClick(findChild(notes, "drawerHandleArea"));
            verify(notes.drawerExpanded);
            tryCompare(notes, "phoneSpaceHeight", notes.drawerFullHeight, 2000);

            var handle = findChild(notes, "drawerHandle");
            var under = handle.mapToItem(shell, 0, handle.height);
            var clearAll = visibleChild(notes, "drawer_clearAll");
            var right = clearAll.mapToItem(shell, clearAll.width / 2, 0).x;
            // The handle's foot and just below it: neither is Clear All.
            var textTop = clearAll.mapToItem(shell, 0, 0).y;
            verify(textTop - Theme.px(4) > under.y, "a gap between the handle and the buttons");
            for (var y = under.y - 4; y < textTop - Theme.px(4); y += 2) {
                mouseClick(shell, right, y);
                compare(windows.notifications.count, 2, "a tap at " + y + " clears nothing");
                compare(clearAll.text, "Clear All", "a tap at " + y + " is not on Clear All");
                verify(!shell.justTypeOpen, "a tap at " + y + " stays in the drawer");
                if (!notes.drawerExpanded) {         // it was the handle: back up
                    mouseClick(findChild(notes, "drawerHandleArea"));
                    tryCompare(notes, "phoneSpaceHeight", notes.drawerFullHeight, 2000);
                }
            }

            // Nor does a tap on the empty space under the rows.
            mouseClick(shell, shell.width / 2, shell.height - Theme.px(60));
            compare(windows.notifications.count, 2);
            verify(notes.dashboardOpen && notes.drawerExpanded);
            compare(windows.cards.count, 0);
            verify(!shell.justTypeOpen && !shell.launcherOpen);

            mouseClick(clearAll);
            compare(clearAll.text, "Clear 2?");
            wait(Theme.drawerConfirmTimeout + 200);
            compare(clearAll.text, "Clear All", "the question lapses");
            compare(windows.notifications.count, 2);

            // Back to the normal size, then pulled down well past it.
            mouseClick(findChild(notes, "drawerHandleArea"));
            tryVerify(function() { return Math.abs(notes.phoneSpaceHeight - notes.dashboardHeight) < 0.5; }, 2000);
            var area = findChild(notes, "drawerHandleArea");
            var p = area.mapToItem(shell, area.width / 2, area.height / 2);
            var dist = notes.dashboardHeight + 100;
            mousePress(shell, p.x, p.y);
            for (var i = 1; i <= 10; ++i) {
                wait(16);
                mouseMove(shell, p.x, p.y + dist * i / 10);
                verify(notes.phoneSpaceHeight >= Theme.bannerHeight, "the drawer stays under the finger");
            }
            mouseRelease(shell, p.x, p.y + dist);
            verify(!notes.dashboardOpen);
            compare(notes.drawerPull, 0);
            compare(windows.notifications.count, 2);
            tryCompare(notes, "negativeSpace", Theme.bannerHeight, 2000);
            compare(notes.phoneSpaceHeight, Theme.bannerHeight);

            // Opened again, it is its normal size.
            notes.dashboardOpen = true;
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            compare(notes.phoneSpaceHeight, notes.dashboardHeight);

            notes.dashboardOpen = false;
            while (windows.notifications.count)
                windows.dismissNotification(0);
            notes.bannerActive = false;
            tryCompare(notes, "negativeSpace", 0, 2000);
        }

        // Phones: newest at the bottom; the scroll masks show only while
        // rows are out of view (setMaskVisibility).
        function test_dashboardMasks() {
            var notes = shell.notifications;
            for (var i = 0; i < 8; ++i)
                windows.notify("org.webosphoenix.messaging", "N" + i, "");
            notes.bannerActive = false;
            notes.dashboardOpen = true;
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            // 55% of the UI's height (the gesture strip stands in for
            // hardware below the screen, so it is not part of it).
            compare(notes.dashboardHeight, shell.uiRoot.height * Theme.maximumNegativeSpaceRatio);
            // Scrolled to the newest: rows hidden above only.
            tryVerify(function() { return findChild(notes, "dashboardMaskTop").visible; }, 1000);
            verify(!findChild(notes, "dashboardMaskBottom").visible);
            notes.dashboardOpen = false;
            while (windows.notifications.count > 1)
                windows.dismissNotification(0);
            notes.dashboardOpen = true;
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            verify(!findChild(notes, "dashboardMaskTop").visible);
            verify(!findChild(notes, "dashboardMaskBottom").visible);
            notes.dashboardOpen = false;
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

        function test_lockScreenStatusBar() {
            shell.lock();
            shell.openSystemMenu();
            verify(!findChild(shell, "systemMenu") || !findChild(shell, "systemMenu").open);
            var bar = findChild(shell, "statusBar");
            verify(bar.lockScreen);
            compare(bar.clockText, Qt.formatDate(bar.shownTime, Qt.locale().dateFormat(Locale.ShortFormat)));
            shell.unlock();
            verify(!bar.lockScreen);
            verify(/^\d+:\d\d$/.test(bar.clockText));
        }

        // Prelude if installed, else the bundled Open Sans (not the system's
        // default sans, which is much wider).
        function test_fontIsPreludeOrTheBundledOpenSans() {
            verify(Qt.fontFamilies().indexOf("Open Sans") >= 0);
            compare(Theme.fontFamily, Theme.preludeInstalled ? "Prelude" : "Open Sans");
        }

        // PalmSystem.addActiveCallBanner: the phone's banner strip shows the
        // call and its time; a tap goes back to it; removed, it goes.
        function test_activeCallBanner() {
            var notes = shell.notifications;
            var start = Math.floor(Date.now() / 1000) - 65;
            windows._hostMessage("org.webosphoenix.phone", "", "activeCallBanner",
                                 { op: "add", icon: "icon.png", message: "Ada Palmer", startTime: start });
            verify(notes.activeCallShown);
            var text = findChild(notes, "activeCallText");
            tryVerify(function() { return /^Ada Palmer \(1:0[56]\)$/.test(text.text); }, 1000, text.text);
            tryCompare(notes, "negativeSpace", Theme.bannerHeight, 2000);
            // Another app cannot change it; its own can.
            windows._hostMessage("org.webosphoenix.email", "", "activeCallBanner", { op: "remove" });
            verify(notes.activeCallShown);
            windows._hostMessage("org.webosphoenix.phone", "", "activeCallBanner",
                                 { op: "update", icon: "icon.png", message: "Ada Palmer (mobile)", startTime: start });
            tryVerify(function() { return /^Ada Palmer \(mobile\) \(1:0[5-7]\)$/.test(text.text); }, 1000, text.text);
            // A tap: the phone, {action: "activecall"}.
            mouseClick(findChild(notes, "bannerTap"));
            tryVerify(function() {
                for (var i = 0; i < windows.cards.count; ++i)
                    if (windows.cards.get(i).appId === "org.webosphoenix.phone")
                        return true;
                return false;
            }, 2000, "the phone opened");
            windows._hostMessage("org.webosphoenix.phone", "", "activeCallBanner", { op: "remove" });
            verify(!notes.activeCallShown);
            // The time as ActiveCallBanner.cpp wrote it.
            compare(notes.callTime(0, 3725 * 1000), "(1:02:05)");
            compare(notes.callTime(0, 59 * 1000), "(0:59)");
            compare(notes.callTime(0, 400000 * 1000), "(99:59:59)");
        }

        // PalmSystem.enableFullScreenMode: no status bar, no notification
        // area; the card gets the whole screen while maximized.
        function test_fullScreenApp() {
            var uid = windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximizeProgress = 1;
            var bar = findChild(shell, "statusBar");
            var corners = findChild(shell, "screenCorners");
            // R3: the phone's corners show in card view and maximized...
            verify(corners.visible);
            var normal = shell.cardView.windowHeight;
            windows._hostMessage("org.webosphoenix.email", uid, "fullScreen", { on: true });
            verify(shell.fullScreen);
            verify(!bar.visible);
            // ...and go only while a full-screen card covers the screen.
            verify(!corners.visible);
            compare(shell.cardView.windowHeight, normal + Theme.statusBarHeight);
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "Hi");
            wait(500);
            compare(shell.notifications.negativeSpace, 0);
            // Back in card view the bar is back.
            shell.cardView.maximizeProgress = 0;
            verify(!shell.fullScreen);
            verify(bar.visible);
            verify(corners.visible);
            windows.dismissNotification(0);
            shell.notifications.bannerActive = false;
        }

        // K2 / K3: while locked the front popup alert shows over the lock
        // screen; an incoming call turns the padlock into "Drag up to answer".
        function test_incomingCallOnTheLockScreen() {
            shell.lock();
            var notes = shell.notifications;
            windows.alerts.append({ key: "call-test", appId: "org.webosphoenix.phone", name: "incoming-known", height: 150 });
            verify(notes.incomingCall);
            var alert = findChild(shell.lockScreen, "lockAlert");
            tryCompare(alert, "opacity", 1, 2000);
            verify(shell.lockScreen.incomingCall);
            verify(shell.lockScreen.helpShown);
            compare(notes.negativeSpace, 0);
            // Other alerts show too, but keep the padlock.
            windows.alerts.clear();
            verify(!shell.lockScreen.incomingCall);
            windows.alerts.append({ key: "alarm-test", appId: "com.palm.app.clock", name: "com.palm.app.clock.alarm.1", height: 110 });
            tryCompare(alert, "opacity", 1, 2000);
            verify(!notes.incomingCall);
            windows.alerts.clear();
            shell.unlock();
            tryCompare(alert, "opacity", 0, 2000);
        }

        function test_batteryStates() {
            compare(Theme.batteryState(0), 0);
            compare(Theme.batteryState(12), 0);
            compare(Theme.batteryState(13), 1);
            compare(Theme.batteryState(50), 5);
            compare(Theme.batteryState(89), 11);
            compare(Theme.batteryState(99), 11);
            compare(Theme.batteryState(100), 12);
            var img = findChild(shell, "battery");
            shell.system.charging = false;
            shell.system.batteryPercent = 100;
            verify(/battery-11\.png$/.test(img.source));
            shell.system.charging = true;
            verify(/battery-charged\.png$/.test(img.source));
            shell.system.batteryPercent = 50;
            verify(/battery-charging-5\.png$/.test(img.source));
            shell.system.batteryPercent = 100;
        }

        function test_statusIndicators() {
            var sys = shell.system;
            sys.rotationLocked = true;
            sys.muted = true;
            sys.airplaneMode = true;
            verify(findChild(shell, "rotationLockIcon").visible);
            verify(findChild(shell, "muteIcon").visible);
            var plane = findChild(shell, "airplaneIcon");
            verify(plane.visible);
            // It slides in: narrow and faint at first, whole after a second
            // (StatusBarIcon, statusBarItemSlide 1000 ms).
            verify(plane.width < Theme.px(20));
            tryCompare(plane, "progress", 1, 2500);
            verify(plane.width > 0);
            compare(plane.opacity, 1);
            // Leftmost of the indicators, as StatusBarInfo paints it last.
            compare(plane.x, 0);
            sys.rotationLocked = false;
            sys.muted = false;
            sys.airplaneMode = false;
            // And slides out.
            verify(plane.visible);
            tryVerify(function() { return !plane.visible; }, 2500);
        }

        // The VPN icon while a profile is connected, between rotation lock
        // and Wi-Fi (StatusBarInfo.cpp:255-259).
        function test_vpnIndicator() {
            var sys = shell.system;
            var vpn = findChild(shell, "vpnIcon");
            verify(!vpn.visible);
            verify(/statusBar\/vpn-status-icon\.png$/.test(vpn.source));
            sys.vpnProfiles = [{ name: "Office", state: "connected" }];
            verify(vpn.visible);
            tryCompare(vpn, "progress", 1, 2500);
            sys.rotationLocked = true;
            tryCompare(findChild(shell, "rotationLockIcon"), "progress", 1, 2500);
            verify(vpn.x > findChild(shell, "rotationLockIcon").x);
            verify(vpn.x < findChild(shell, "wifiIcon").x);
            sys.rotationLocked = false;
            sys.vpnProfiles = [{ name: "Office", state: "disconnected" }];
            tryVerify(function() { return !vpn.visible; }, 2500);
        }

        // Back: the dashboard, then the menu, then the launcher
        // (SystemUiController.cpp:424-443).
        function test_backOrder() {
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "Hi");
            shell.notifications.bannerActive = false;
            shell.gestureUp();
            verify(shell.launcherOpen);
            shell.notifications.dashboardOpen = true;
            var menu = findChild(shell, "systemMenu");
            menu.open = true;
            shell.gestureBack();
            verify(!shell.notifications.dashboardOpen);
            verify(menu.open);
            verify(shell.launcherOpen);
            shell.gestureBack();
            verify(!menu.open);
            verify(shell.launcherOpen);
            shell.gestureBack();
            verify(!shell.launcherOpen);
        }

        // G4: the forward swipe closes the dashboard and the menus at once
        // and is eaten while the launcher is up (SystemUiController.cpp:
        // 410-422); it never closes the launcher, as Back does.
        function test_forwardSwipe() {
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "Hi");
            shell.notifications.bannerActive = false;
            shell.gestureUp();
            verify(shell.launcherOpen);
            shell.notifications.dashboardOpen = true;
            var menu = findChild(shell, "systemMenu");
            menu.open = true;
            var area = findChild(shell, "gestureMouse");
            // A swipe left to right in the gesture area.
            mouseDrag(area, area.width * 0.3, area.height / 2, area.width * 0.4, 0);
            verify(!shell.notifications.dashboardOpen);
            verify(!menu.open);
            verify(shell.launcherOpen);
            shell.gestureForward();
            verify(shell.launcherOpen);
            shell.gestureBack();
            verify(!shell.launcherOpen);
            windows.dismissNotification(0);
        }

        // The dock's own show / hide (OverlayWindowManager dock states).
        function test_dockShowHide() {
            var dock = findChild(shell, "quickLaunch");
            shell.dockShown = true;
            tryCompare(dock, "shownProgress", 1, 1500);
            // A card added: it hides, sliding and fading.
            windows.launch("org.webosphoenix.email", "");
            verify(!shell.dockShown);
            tryCompare(dock, "opacity", 0, 1000);
            tryCompare(dock, "shownProgress", 0, 1500);
            // Maximized, then minimizing: it comes back as the card goes.
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            verify(!shell.dockShown);
            shell.gestureUp();
            verify(shell.dockShown);
            tryCompare(dock, "shownProgress", 1, 1500);
            // Just Type hides it and, closed in card view, brings it back.
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
            shell.startJustType("m");
            verify(!shell.dockShown);
            shell.gestureBack();
            verify(shell.dockShown);
        }

        // The Home button (SystemUiController.cpp:527-583): one thing per
        // press; a double press from an app reaches the launcher.
        function test_homeKey() {
            var notes = shell.notifications;
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            windows.alerts.append({ key: "home-alert", appId: "org.webosphoenix.email", height: 150 });
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "Hi");
            notes.bannerActive = false;
            notes.dashboardOpen = true;
            shell.homeKey();
            verify(!notes.dashboardOpen);
            compare(windows.alerts.count, 1);
            shell.homeKey();
            compare(windows.alerts.count, 0);
            verify(shell.maximized);
            // Double press: minimize, then (still minimizing) the launcher.
            shell.homeKey();
            verify(shell.cardView.minimizing);
            shell.homeKey();
            verify(shell.launcherOpen);
            shell.homeKey();
            verify(!shell.launcherOpen);
            notes.bannerActive = false;
        }

        // SystemUiController::updateStatusBarTitle / StatusBarTitle.
        function test_statusBarTitle() {
            var bar = findChild(shell, "statusBar");
            var title = findChild(bar, "statusBarTitle");
            var arrow = findChild(bar, "statusBarTitleArrow");
            // The carrier: no pill, no arrow.
            compare(bar.title, shell.system.carrier);
            verify(!bar.titleBorder);
            verify(!bar.titleActionable);
            // An app: its title on the pill, the arrow fading in; the new
            // title cross-fades in over 300 ms.
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            compare(bar.title, "Email");
            verify(bar.titleBorder);
            verify(bar.titleActionable);
            verify(title.opacity < 1);
            tryCompare(title, "opacity", 1, 1000);
            // Phones: the pill's own arrow; no second one.
            for (var t = 0; t < 30 && bar._arrowProgress !== 1; ++t)
                wait(100);
            if (bar._arrowProgress !== 1)
                fail("arrow " + bar._arrowProgress + " title " + bar.title + " mode " + bar._mode
                     + " actionable " + bar.titleActionable + " locked " + bar.lockScreen
                     + " maximize " + shell.cardView.maximizeProgress);
            verify(!arrow.visible);
            // 14 px bold, letters at 90%.
            var label = title.children[1];
            compare(label.font.bold, true);
            compare(label.font.pixelSize, Theme.px(14));
            compare(label.font.letterSpacing, 90);
            // The launcher: "Launcher", no menu.
            shell.cardView.maximizeProgress = 0;
            shell.gestureUp();
            verify(shell.launcherOpen);
            compare(bar.title, "Launcher");
            verify(bar.titleBorder);
            verify(!bar.titleActionable);
            compare(bar.fillColor, Theme.statusBarLauncherFill);
            shell.gestureUp();
            compare(bar.title, shell.system.carrier);
        }

        function test_clockFollowsTheTimeFormat() {
            var bar = findChild(shell, "statusBar");
            shell.system.fixedTime = new Date(2009, 5, 6, 9, 5);
            compare(bar.clockText, "9:05");
            shell.system.twentyFourHour = true;
            compare(bar.clockText, "09:05");
            shell.system.fixedTime = new Date(2009, 5, 6, 21, 41);
            compare(bar.clockText, "21:41");
            shell.system.twentyFourHour = false;
            compare(bar.clockText, "9:41");
            shell.system.fixedTime = null;
        }

        function test_swipeDownMaximizesTheActiveCard() {
            windows.launch("org.webosphoenix.email", "");
            shell.cardView.jumpTo(0);
            shell.gestureDown();
            tryVerify(function() { return shell.maximized; }, 2000);
            // Not with the launcher over card view.
            shell.cardView.jumpTo(0);
            shell.gestureUp();
            verify(shell.launcherOpen);
            shell.gestureDown();
            wait(400);
            verify(!shell.maximized);
            shell.gestureUp();
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
