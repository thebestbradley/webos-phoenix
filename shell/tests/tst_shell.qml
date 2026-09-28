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
            windows.bannerRequested("org.webosphoenix.email", "Charging Battery", "", "");
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
            windows.bannerRequested("org.webosphoenix.email", "New mail", "", "{\"folder\":\"inbox\"}");
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
            windows.bannerRequested("org.webosphoenix.email", "Charging Battery", "", "");
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
            // Phones: the rows and the 10 px above them.
            compare(notes.dashboardHeight, Theme.dashboardTopPadding + 3 * Theme.dashboardItemHeight);
            var rows = dashboardRows();
            compare(rows.length, 3);

            // A tenth of the width, slowly: back to where it was.
            var r = rows[0], y = r.height / 2;
            mousePress(r, 20, y);
            for (var i = 1; i <= 8; ++i) { wait(20); mouseMove(r, 20 + i * 4, y); }
            mouseRelease(r, 52, y);
            tryCompare(r.parent, "x", 0, 1500);
            compare(windows.notifications.count, 3);

            // Past a quarter, slowly: slides right, then goes.
            mousePress(r, 20, y);
            for (i = 1; i <= 10; ++i) { wait(30); mouseMove(r, 20 + i * 12, y); }
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

        // Phones: newest at the bottom; the scroll masks show only while
        // rows are out of view (setMaskVisibility).
        function test_dashboardMasks() {
            var notes = shell.notifications;
            for (var i = 0; i < 8; ++i)
                windows.notify("org.webosphoenix.messaging", "N" + i, "");
            notes.bannerActive = false;
            notes.dashboardOpen = true;
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            compare(notes.dashboardHeight, shell.height * Theme.maximumNegativeSpaceRatio);
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

        // PalmSystem.enableFullScreenMode: no status bar, no notification
        // area; the card gets the whole screen while maximized.
        function test_fullScreenApp() {
            var uid = windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximizeProgress = 1;
            var bar = findChild(shell, "statusBar");
            var normal = shell.cardView.windowHeight;
            windows._hostMessage("org.webosphoenix.email", uid, "fullScreen", { on: true });
            verify(shell.fullScreen);
            verify(!bar.visible);
            compare(shell.cardView.windowHeight, normal + Theme.statusBarHeight);
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "Hi");
            wait(500);
            compare(shell.notifications.negativeSpace, 0);
            // Back in card view the bar is back.
            shell.cardView.maximizeProgress = 0;
            verify(!shell.fullScreen);
            verify(bar.visible);
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
            // Leftmost of the indicators, as StatusBarInfo paints it last.
            compare(plane.x, 0);
            sys.rotationLocked = false;
            sys.muted = false;
            sys.airplaneMode = false;
            verify(!plane.visible);
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
            shell.cardView.maximizeProgress = 1;
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
