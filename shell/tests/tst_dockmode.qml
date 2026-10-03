// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Dock mode, "Exhibition" (GAPS R5): the Touchstone, when dock mode starts
// and ends (DisplayManager's dock states), its lock state, the exhibition
// menu, per-Touchstone memory, the Time clocks, night mode and sounds.
// Run: qmltestrunner -import qml -import ../build/qml -input tests

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
        system: SimSystemStatus { id: status }
    }

    TestCase {
        name: "DockMode"
        when: windowShown

        property var dock: null

        function initTestCase() {
            dock = findChild(shell, "dockMode");
            verify(dock);
            // An app that can be an exhibition (appinfo.json exhibitionMode),
            // as the window source lists it.
            windows.apps.append({ appId: "test.slides", title: "Slideshow Maker", color: "#336699", glyph: "S", tab: 0,
                                  quickLaunch: 0, icon: "", largeIcon: "", splashIcon: "", splashBackground: "",
                                  web: false, main: "", noWindow: false, orientation: "", webAppId: "", params: "",
                                  dir: "", removable: false, version: "", exhibition: true, exhibitionTitle: "Slides" });
        }

        function init() {
            if (shell.dockMode)
                shell.exitDockMode(false);
            status.charger = "none";
            status.puckId = "";
            status.charging = false;
            status.exhibitionEnabled = true;
            status.exhibitionStartAfter = 0;
            status.exhibitionApps = ["test.slides"];
            status.exhibitionNightMode = false;
            status.dockModeSound = "systemsettings";
            status.screenTimeout = 60;
            status.fixedTime = new Date(2009, 5, 6, 9, 41, 30);
            status.twentyFourHour = false;
            shell.display.turnOn();
            shell.unlock();
            shell.forceActiveFocus();
            tryCompare(shell, "_dockTransition", false, 2000);
            // A device that never was on a Touchstone.
            dock.switchTo(dock.timeAppId);
            dock._defaultAppId = dock.timeAppId;
            dock._knownPucks = ({});
            windows.dockModePositionsJson = "";
        }

        function cleanup() {
            if (shell.dockMode)
                shell.exitDockMode(false);
            status.charger = "none";
            tryCompare(shell, "_dockTransition", false, 2000);
        }

        function placeOnTouchstone(puck) {
            status.puckId = puck || "TS-A";
            status.charger = "inductive";
            status.charging = true;
        }
        function liftOff() {
            status.charger = "none";
            status.puckId = "";
            status.charging = false;
        }

        // ---- When it starts --------------------------------------------------------

        function test_screenOffOnTheTouchstoneStartsIt() {
            shell.display.turnOff();
            verify(shell.locked);
            placeOnTouchstone();
            verify(shell.dockMode, "DisplayOff + OnPuck: DisplayStateDockMode");
            compare(shell.display.state, "on");
            verify(shell.locked, "locked, in the dock state");
            verify(shell.lockScreen.dockMode);
            compare(dock.currentAppId, "com.palm.app.dockmodetime", "Time first");
            // No animation with the screen off.
            verify(!shell._dockTransition);
            verify(!findChild(shell, "screenLayers").visible);
            verify(dock.visible);
        }

        function test_screenOnWaitsForTheTimeout() {
            status.screenTimeout = 1;
            placeOnTouchstone();
            verify(!shell.dockMode);
            // It does not dim on the Touchstone (DisplayOnPuck): when it would
            // have turned off, dock mode.
            wait(800);
            compare(shell.display.state, "on");
            verify(!shell.dockMode);
            tryCompare(shell, "dockMode", true, 1000);
            compare(shell.display.state, "on");
        }

        function test_startAfter() {
            // Settings > Exhibition "Start after" 1 s, the screen timeout a minute.
            status.exhibitionStartAfter = 1;
            placeOnTouchstone();
            wait(700);
            verify(!shell.dockMode);
            tryCompare(shell, "dockMode", true, 1000);
        }

        function test_lockedOnTheTouchstoneAsksToUnlock() {
            shell.lock();
            verify(shell.locked);
            placeOnTouchstone();
            // DisplayOnLocked + OnPuck: DisplayOnPuck, the lock state Unlocked
            // (no passcode in the simulator's lock service without a page).
            tryCompare(shell, "locked", false, 1000);
            verify(!shell.dockMode);
        }

        function test_powerOnTheTouchstoneStartsIt() {
            placeOnTouchstone();
            verify(!shell.dockMode);
            keyClick(Qt.Key_F3);
            verify(shell.dockMode, "Power on the puck: dock mode, not off");
            compare(shell.display.state, "on");
            // Power in dock mode: off, still in dock mode on the puck.
            keyClick(Qt.Key_F3);
            compare(shell.display.state, "off");
            verify(shell.dockMode);
            // And on again: dock mode.
            keyClick(Qt.Key_F3);
            compare(shell.display.state, "on");
            verify(shell.dockMode);
        }

        function test_exhibitionsOff() {
            status.exhibitionEnabled = false;
            status.screenTimeout = 1;
            shell.display.turnOff();
            placeOnTouchstone();
            verify(!shell.dockMode, "only charging");
            verify(!shell.enterDockMode());
            // It dims as on any charger.
            shell.display.turnOn();
            shell.unlock();
            tryCompare(shell.display, "state", "dim", 1500);
        }

        function test_notOnACallNorInFirstUse() {
            liftOff();
            verify(!shell.enterDockMode(), "not on a Touchstone");
            windows.activeCallBanner = { appId: "org.webosphoenix.phone", icon: "", message: "Call", startTime: 0 };
            placeOnTouchstone();
            verify(!shell.enterDockMode(), "on a call");
            windows.activeCallBanner = null;
            verify(shell.enterDockMode());
        }

        // ---- How it ends -----------------------------------------------------------

        function enterNow() {
            placeOnTouchstone();
            verify(shell.enterDockMode());
            tryCompare(shell, "_dockTransition", false, 2000);
        }

        function test_homeEndsItAndUnlocks() {
            enterNow();
            keyClick(Qt.Key_Home);
            verify(!shell.dockMode);
            verify(!shell.lockScreen.dockMode);
            // No passcode: unlocked (LockWindow::tryUnlock).
            tryCompare(shell, "locked", false, 1000);
            tryCompare(shell, "_dockTransition", false, 2000);
            verify(findChild(shell, "screenLayers").visible);
            verify(!dock.visible);
        }

        function test_swipeUpAndBackEndIt() {
            enterNow();
            shell.gestureUp();
            verify(!shell.dockMode);
            tryCompare(shell, "_dockTransition", false, 2000);
            enterNow();
            // Back closes the menu first, then leaves.
            dock.appMenu.open = true;
            shell.gestureBack();
            verify(shell.dockMode);
            verify(!dock.menuOpen);
            shell.gestureBack();
            verify(!shell.dockMode);
        }

        function test_liftingItOffEndsIt() {
            enterNow();
            liftOff();
            verify(!shell.dockMode);
            tryCompare(shell, "locked", false, 1000);
            // Lifted with the screen off: dock mode ends, the screen stays off
            // and locked.
            enterNow();
            keyClick(Qt.Key_F3);
            compare(shell.display.state, "off");
            liftOff();
            verify(!shell.dockMode);
            compare(shell.display.state, "off");
            verify(shell.locked);
        }

        function test_aCallEndsItToTheLockScreen() {
            enterNow();
            // The phone's incoming call alert (its popup alert window).
            windows.alerts.append({ key: "call-dock", appId: "org.webosphoenix.phone", name: "incoming-known", height: 150 });
            verify(shell.notifications.incomingCall);
            verify(!shell.dockMode, "DisplayDockMode, DisplayEventOnCall");
            verify(shell.locked, "to the lock screen and the call");
            verify(shell.lockScreen.incomingCall);
            // Not again while it rings.
            verify(!shell.enterDockMode());
            windows.alerts.clear();
        }

        function test_usbDriveModeEndsIt() {
            enterNow();
            var screens = shell.systemScreens;
            screens.brickMode = true;
            verify(!shell.dockMode, "slotEnterBrickMode: out of dock mode");
            verify(!shell.enterDockMode(), "not while the screen is the USB drive's");
            screens.brickMode = false;
            verify(shell.enterDockMode());
        }

        function test_anAppComingUpEndsIt() {
            enterNow();
            shell.launch(windows.appIdByTitle("Memos"));
            verify(!shell.dockMode);
        }

        function test_transition() {
            placeOnTouchstone();
            var screen = findChild(shell, "screenLayers");
            verify(shell.enterDockMode());
            verify(shell._dockTransition);
            // Dock mode starts at twice its size, unseen, for 270 ms.
            compare(dock.scale, 2);
            compare(dock.opacity, 0);
            wait(150);
            verify(screen.scale < 1 && screen.scale > 0, "the screen shrinks");
            compare(dock.scale, 2);
            tryCompare(shell, "_dockTransition", false, 1500);
            compare(dock.scale, 1);
            compare(dock.opacity, 1);
            verify(!screen.visible);
            // Out: the screen grows back.
            shell.exitDockMode(true);
            verify(screen.visible);
            verify(dock.visible);
            wait(200);
            verify(screen.scale > 0 && screen.scale < 1);
            tryCompare(shell, "_dockTransition", false, 1500);
            compare(screen.scale, 1);
            verify(!dock.visible);
        }

        // ---- The status bar and the menu ---------------------------------------------

        function test_statusBarAndMenu() {
            enterNow();
            var title = findChild(shell, "statusBarTitle");
            compare(title.text, "Time");
            // The title opens the exhibitions menu: Time and the apps turned on.
            var bar = findChild(shell, "statusBar");
            mouseClick(bar, 20, bar.height / 2);
            verify(dock.menuOpen);
            tryCompare(title, "text", "Choose an App", 1000);
            var row = findChild(shell, "dockModeMenuItem_test.slides");
            verify(row);
            // 70 px rows, a divider under all but the last.
            compare(findChild(shell, "dockModeMenuItem_com.palm.app.dockmodetime").height, 70 + 2);
            compare(row.height, 70);
            mouseClick(row);
            verify(!dock.menuOpen);
            compare(dock.currentAppId, "test.slides");
            tryCompare(title, "text", "Slides", 1000);
            // Its window, launched for dock mode, cross-fades in.
            var key = dock.windowKey("test.slides");
            verify(key !== "");
            var slot = findChild(shell, "dockSlot_test.slides");
            verify(slot.visible);
            tryCompare(slot, "opacity", 1, 1000);
            // The system menu closes the app menu (one menu at a time).
            mouseClick(bar, 20, bar.height / 2);
            verify(dock.menuOpen);
            mouseClick(bar, bar.width - 10, bar.height / 2);
            verify(!dock.menuOpen);
            verify(findChild(shell, "systemMenu").open);
            shell.gestureBack();
            verify(!findChild(shell, "systemMenu").open);
            verify(shell.dockMode);
        }

        function test_leavingClosesTheOthers() {
            enterNow();
            dock.switchTo("test.slides");
            var key = dock.windowKey("test.slides");
            verify(key !== "");
            dock.switchTo(dock.timeAppId);
            shell.exitDockMode(false);
            compare(dock.windowKey("test.slides"), "", "dockModeCloseOnExit");
            // The one in front stays for next time.
            enterNow();
            dock.switchTo("test.slides");
            shell.exitDockMode(false);
            verify(dock.windowKey("test.slides") !== "");
            tryCompare(shell, "_dockTransition", false, 2000);
            enterNow();
            compare(dock.currentAppId, "test.slides", "back on the last one (m_defaultIndex)");
        }

        function test_eachTouchstoneRemembers() {
            // On A, Slides; on B, Time.
            enterNow();
            dock.switchTo("test.slides");
            liftOff();
            placeOnTouchstone("TS-B");
            shell.display.turnOff();
            shell.display.turnOn();
            verify(shell.enterDockMode());
            dock.switchTo(dock.timeAppId);
            liftOff();
            tryCompare(shell, "_dockTransition", false, 2000);
            placeOnTouchstone("TS-A");
            verify(shell.enterDockMode());
            compare(dock.currentAppId, "test.slides");
            liftOff();
            tryCompare(shell, "_dockTransition", false, 2000);
            placeOnTouchstone("TS-B");
            verify(shell.enterDockMode());
            compare(dock.currentAppId, dock.timeAppId);
            // Kept by the window source (knownPucks).
            var saved = JSON.parse(windows.savedDockModePositions());
            compare(saved.knownPucks["TS-A"], "test.slides");
            compare(saved.knownPucks["TS-B"], dock.timeAppId);
        }

        // At start-up the exhibitions that are on come from the system a
        // moment later: the Touchstone's own shows as soon as it is known,
        // and is not forgotten meanwhile.
        function test_theTouchstonesExhibitionWhenKnown() {
            dock._knownPucks = ({ "TS-A": "test.slides" });
            status.exhibitionApps = [];
            enterNow();
            compare(dock.currentAppId, dock.timeAppId);
            compare(dock.knownPucks()["TS-A"], "test.slides");
            status.exhibitionApps = ["test.slides"];
            tryCompare(dock, "currentAppId", "test.slides", 1000);
            // Unless the user picked one first.
            shell.exitDockMode(false);
            tryCompare(shell, "_dockTransition", false, 2000);
            status.exhibitionApps = [];
            verify(shell.enterDockMode());
            dock.switchTo(dock.timeAppId);
            status.exhibitionApps = ["test.slides"];
            wait(50);
            compare(dock.currentAppId, dock.timeAppId);
        }

        function test_turnedOffExhibitionGoes() {
            enterNow();
            dock.switchTo("test.slides");
            status.exhibitionApps = [];
            tryCompare(dock, "currentAppId", dock.timeAppId, 1000);
            compare(dock.windowKey("test.slides"), "");
            compare(dock.exhibitions.length, 1);
        }

        function test_onlyTheOneInFrontRuns() {
            enterNow();
            var time = findChild(shell, "dockModeTime");
            verify(time.mainTimerRunning);
            keyClick(Qt.Key_F3);
            verify(!time.mainTimerRunning, "screen off");
            keyClick(Qt.Key_F3);
            verify(time.mainTimerRunning);
            dock.switchTo("test.slides");
            verify(!time.mainTimerRunning);
        }

        // ---- Lock state, night mode, sounds ------------------------------------------

        function test_lockStateDockMode() {
            enterNow();
            // No unlocking while docked (LockWindow StateDockMode).
            shell.lockScreen.requestUnlock();
            wait(50);
            verify(shell.locked);
            verify(!shell.lockScreen.pinEntry);
            verify(!findChild(shell, "padlock").visible);
            // Keys typed go nowhere (no Just Type over the exhibition).
            keyClick(Qt.Key_M);
            verify(!shell.justTypeOpen);
        }

        function test_nightMode() {
            status.exhibitionNightMode = true;
            status.exhibitionNightStart = "22:00";
            status.exhibitionNightEnd = "07:00";
            status.fixedTime = new Date(2009, 5, 6, 23, 15);
            enterNow();
            tryCompare(shell.display, "night", true, 1000);
            status.fixedTime = new Date(2009, 5, 6, 9, 41);
            shell._updateNightMode();
            compare(shell.display.night, false);
            status.exhibitionNightStart = "09:00";
            status.exhibitionNightEnd = "10:00";
            compare(shell.display.night, true);
            shell.exitDockMode(false);
            compare(shell.display.night, false, "only in dock mode");
        }

        function test_dockSoundPreference() {
            enterNow();
            verify(!shell.sounds.quiet);
            status.dockModeSound = "mute";
            verify(shell.sounds.quiet);
            shell.sounds.notification("org.webosphoenix.messaging", "notifications", "", 0, false);
            compare(shell.sounds.last.volume, 0, "quiet in dock mode");
            shell.exitDockMode(false);
            verify(!shell.sounds.quiet);
        }

        // ---- The Time exhibition -----------------------------------------------------

        function test_timeClocks() {
            enterNow();
            var time = findChild(shell, "dockModeTime");
            compare(time.count, 3);
            compare(time.currentIndex, 0, "analog glass first");
            var dots = findChild(time, "clockDots");
            compare(dots.children.length, 4, "three dots (and the Repeater)");
            // The glass clock: 9:41:30, the long date under it.
            var glass = findChild(time, "glassClock");
            compare(glass.hours, 9);
            compare(glass.minutes, 41);
            verify(!findChild(glass, "secondHand").visible, "no second hand");
            verify(findChild(glass, "analogDate").text.indexOf("2009") >= 0);
            // The flip clock: 09 41, AM, JUN 06 2009.
            time.showClock(1);
            compare(time.currentIndex, 1);
            var flip = findChild(time, "flipClock");
            compare(findChild(flip, "hourTens").text, "0");
            compare(findChild(flip, "hourOnes").text, "9");
            compare(findChild(flip, "minuteTens").text, "4");
            compare(findChild(flip, "minuteOnes").text, "1");
            compare(findChild(flip, "ampm").text, Qt.locale().amText);
            compare(flip.month, Qt.locale().monthName(5, Locale.ShortFormat).toUpperCase());
            // 24 hours: no AM / PM.
            status.twentyFourHour = true;
            compare(findChild(flip, "ampm").text, "");
            // The matte clock: a second hand, the day in its window.
            time.showClock(2);
            var matte = findChild(time, "matteClock");
            verify(findChild(matte, "secondHand").visible);
            compare(findChild(matte, "analogDate").text, "6");
            compare(findChild(matte, "analogWeekday").text, Qt.locale().dayName(6, Locale.ShortFormat));
            time.showClock(0);
        }

        function test_timeClocksSwipe() {
            enterNow();
            var time = findChild(shell, "dockModeTime");
            var pages = findChild(time, "clockPages");
            time.showClock(0);
            var y = pages.height / 2;
            mousePress(pages, pages.width - 20, y);
            for (var i = 1; i <= 8; ++i)
                mouseMove(pages, pages.width - 20 - i * pages.width / 10, y);
            mouseRelease(pages, 20, y);
            tryCompare(time, "currentIndex", 1, 2000);
            time.showClock(0);
        }

        function test_timeFitsTheScreen() {
            enterNow();
            var time = findChild(shell, "dockModeTime");
            // A phone: the TouchPad's clocks scaled down to fit.
            verify(time.fit < 1);
            var face = findChild(findChild(time, "glassClock"), "analogFace");
            var r = face.mapToItem(time, 0, 0, face.width, face.height);
            verify(r.x >= 0 && r.x + r.width <= time.width, "the face fits across");
            // A clock wallpaper replaces clock_bg.png.
            verify(findChild(time, "clockBackground").visible);
            status.dockWallpaper = "file:///nowhere.png";
            verify(!findChild(time, "clockBackground").visible);
            status.dockWallpaper = "";
        }
    }
}
