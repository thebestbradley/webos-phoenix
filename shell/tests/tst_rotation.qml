// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The UI turning with the device (UiRotation; luna-sysmgr WindowServer):
// the 200 ms wait, the 300 ms turn and where it ends, rotation lock, a
// finger on the screen, a maximized card holding its orientation.
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
        density: 1
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    TestCase {
        name: "Rotation"
        when: windowShown

        readonly property var rot: shell.rotator
        readonly property var ui: shell.uiRoot

        function settle() {
            tryVerify(function() { return !rot.rotating; }, 3000);
        }

        function init() {
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.cardView.maximizeProgress = 0;
            shell.unlock();
            sys.rotationLocked = false;
            sys.deviceOrientation = "up";
            tryCompare(shell, "uiOrientation", "up", 3000);
            settle();
            tryCompare(shell, "okToResizeUi", true, 3000);
        }

        function launchMaximized(orientation) {
            var uid = windows.launch("org.webosphoenix.email", "");
            windows.cards.setProperty(windows.cardIndex(uid), "orientation", orientation);
            shell.cardView.maximize(uid);
            tryVerify(function() { return shell.maximized; }, 2000);
            tryCompare(shell, "maximizedCardUid", uid, 1000);
            return uid;
        }

        function test_bootsUpright() {
            compare(shell.uiOrientation, "up");
            compare(ui.width, 320);
            // The gesture bar is below the UI, not part of it.
            compare(ui.height, 480 - Theme.gestureAreaHeight);
            compare(ui.rotation, 0);
        }

        function test_turnsAfter200msThenAnimates300ms() {
            sys.deviceOrientation = "left";
            // The accelerometer settles for 200 ms first (WindowServer.cpp:130).
            wait(120);
            compare(shell.uiOrientation, "up");
            verify(!rot.rotating);
            tryVerify(function() { return rot.rotating; }, 400);
            // Mid-turn: the cross-fade runs, InOutCubic over 300 ms.
            tryCompare(rot, "animation", rot.rotateAndCrossFade, 500);
            var started = Date.now();
            compare(shell.uiOrientation, "left");
            tryVerify(function() { return !rot.rotating; }, 1000);
            verify(Date.now() - started >= 250, "the turn takes 300 ms");
            compare(shell.deviceOrientation, "left");
        }

        function test_endStateIsTheUiAtTheSwappedSize() {
            sys.deviceOrientation = "left";
            tryCompare(shell, "uiOrientation", "left", 1000);
            settle();
            // Resized to the swapped size and turned a quarter clockwise; the
            // gesture bar goes with it, to the UI's bottom (the device's left
            // edge), so the UI is the full length and the bar's height less.
            compare(ui.width, 480);
            compare(ui.height, 320 - Theme.gestureAreaHeight);
            var bar = findChild(shell, "gestureBar");
            var barAt = bar.mapToItem(root, 0, 0);
            fuzzyCompare(barAt.x, Theme.gestureAreaHeight, 0.5);   // its left end, turned: at the top of the left edge
            fuzzyCompare(barAt.y, 0, 0.5);
            compare(ui.rotation, 90);
            var topLeft = ui.mapToItem(root, 0, 0);
            fuzzyCompare(topLeft.x, 320, 0.5);
            fuzzyCompare(topLeft.y, 0, 0.5);
            // The layers lay themselves out at that size.
            compare(findChild(shell, "statusBar").width, ui.width);
            compare(shell.cardView.width, ui.width);
            compare(shell.cardView.windowHeight, 320 - Theme.gestureAreaHeight - Theme.statusBarHeight - shell.notifications.negativeSpace);
            // A phone on its side stays a phone.
            verify(!shell.tablet);
            // The snapshots are gone: the live UI shows and takes input.
            verify(!rot.rotating);
            compare(rot.animation, rot.noAnimation);
            // Half a turn, the other way up.
            sys.deviceOrientation = "right";
            tryCompare(shell, "uiOrientation", "right", 1000);
            settle();
            compare(ui.rotation, 270);
            compare(ui.width, 480);
            compare(ui.height, 320 - Theme.gestureAreaHeight);
        }

        // Sideways the phone's launcher has room for a fourth column, and the
        // lock screen keeps its alerts between the date and the padlock.
        function test_sidewaysLayouts() {
            var launcher = findChild(shell, "launcher");
            compare(launcher.columns, 3);
            sys.deviceOrientation = "left";
            tryCompare(shell, "uiOrientation", "left", 1000);
            settle();
            compare(launcher.columns, 4);
            shell.lock();
            var lock = findChild(shell, "lockScreen");
            verify(lock.sideways);
            var date = findChild(lock, "lockDate");
            var dash = findChild(lock, "lockDashboard");
            verify(dash.y + Theme.lockAlertsShadow >= date.y + date.height, "under the date");
            shell.unlock();
            sys.deviceOrientation = "up";
            tryCompare(shell, "uiOrientation", "up", 1000);
            settle();
            compare(launcher.columns, 3);
        }

        // Sideways (292 px under the status bar) the PIN panel, 430 px
        // stacked, lays itself out side by side, all of it on the screen;
        // the system menu stops at the screen's bottom and scrolls.
        // (tst_landscape: the same on a Pre 3.)
        function test_sidewaysPinPadAndSystemMenu() {
            sys.deviceOrientation = "left";
            tryCompare(shell, "uiOrientation", "left", 1000);
            settle();
            shell.lock();
            var lock = findChild(shell, "lockScreen");
            var panel = findChild(lock, "unlockPanel");
            panel.setupDialog(true, "Device Locked", "Enter PIN", false, 0);
            panel.shown = true;
            verify(panel.sideBySide);
            verify(panel.y >= Theme.statusBarHeight && panel.y + panel.height <= lock.height,
                   "the panel fits down: " + panel.y + " + " + panel.height);
            verify(panel.x >= 0 && panel.x + panel.width <= lock.width, "the panel fits across");
            var names = ["unlockCancel", "unlockDone", "pinKey1", "pinKeyDelete"];
            for (var i = 0; i < names.length; ++i) {
                var it = findChild(panel, names[i]);
                var p = it.mapToItem(lock, 0, 0);
                verify(p.y >= Theme.statusBarHeight - 0.5 && p.y + it.height <= lock.height + 0.5, names[i] + " shows");
            }
            panel.shown = false;
            shell.unlock();
            // Upright again: the original's stacked panel.
            sys.deviceOrientation = "up";
            tryCompare(shell, "uiOrientation", "up", 1000);
            settle();
            verify(!panel.sideBySide);
            sys.deviceOrientation = "left";
            tryCompare(shell, "uiOrientation", "left", 1000);
            settle();

            shell.openSystemMenu();
            var menu = findChild(shell, "systemMenu");
            tryCompare(menu, "open", true, 1000);
            var flick = findChild(menu, "systemMenuFlickable");
            var at = flick.mapToItem(ui, 0, 0);
            verify(at.y + flick.height <= ui.height, "the menu ends on the screen");
            verify(flick.contentHeight > flick.height, "and scrolls");
            menu.open = false;
            sys.deviceOrientation = "up";
            tryCompare(shell, "uiOrientation", "up", 1000);
            settle();
        }

        function test_faceUpDoesNotTurn() {
            sys.deviceOrientation = "faceup";
            wait(400);
            compare(shell.uiOrientation, "up");
            verify(!rot.rotating);
        }

        function test_rotationLockHoldsAndRemembers() {
            sys.rotationLocked = true;
            // Locked as the UI is now (SystemMenu.cpp:864).
            compare(shell.rotationLock, "up");
            sys.deviceOrientation = "left";
            wait(500);
            compare(shell.uiOrientation, "up");
            compare(rot.pendingOrientation, "left");
            // Unlocked: it turns to how the device is held.
            sys.rotationLocked = false;
            compare(shell.rotationLock, "");
            tryCompare(shell, "uiOrientation", "left", 1000);
            settle();
        }

        function test_rotationLockLocksTheTurnedUi() {
            sys.deviceOrientation = "left";
            tryCompare(shell, "uiOrientation", "left", 1000);
            settle();
            sys.rotationLocked = true;
            compare(shell.rotationLock, "left");
            sys.deviceOrientation = "up";
            wait(500);
            compare(shell.uiOrientation, "left");
            sys.rotationLocked = false;
            tryCompare(shell, "uiOrientation", "up", 1000);
        }

        function test_fingerOnTheScreenDefers() {
            mousePress(root, 160, 200);
            sys.deviceOrientation = "left";
            wait(500);
            compare(shell.uiOrientation, "up");
            compare(rot.pendingOrientation, "left");
            mouseRelease(root, 160, 200);
            // Retried every 100 ms (WindowServer.cpp:129).
            tryCompare(shell, "uiOrientation", "left", 400);
            settle();
        }

        function test_maximizedCardHoldsItsOrientation() {
            launchMaximized("up");
            sys.deviceOrientation = "left";
            wait(500);
            compare(shell.uiOrientation, "up");
            compare(rot.pendingOrientation, "left");
            // Minimized, the UI turns (once the cards have stopped moving).
            shell.cardView.minimize();
            tryCompare(shell, "uiOrientation", "left", 2000);
            settle();
        }

        function test_freeCardTurns() {
            launchMaximized("free");
            sys.deviceOrientation = "right";
            tryCompare(shell, "uiOrientation", "right", 1000);
            settle();
            verify(shell.maximized);
            // The maximized card fills the turned UI.
            var card = shell.cardView.cardItem(shell.cardView.currentUid);
            compare(card.width, ui.width);
            compare(card.windowOrientation, "right");
        }

        function test_maximizingAFixedCardCrossFades() {
            sys.deviceOrientation = "left";
            tryCompare(shell, "uiOrientation", "left", 1000);
            settle();
            var uid = windows.launch("org.webosphoenix.email", "");
            windows.cards.setProperty(windows.cardIndex(uid), "orientation", "up");
            // In card view it is drawn turned, its window upright on the device
            // (CardWindow::refreshAdjustmentAngle).
            var card = shell.cardView.cardItem(uid);
            compare(card.adjustmentAngle, -90);
            compare(card.windowOrientation, "up");
            shell.cardView.maximize(uid);
            // Once maximized the UI cross-fades to the card's orientation
            // without turning (Rotation_CrossFadeOnly, WindowServer.cpp:1782).
            tryCompare(rot, "animation", rot.crossFadeOnly, 2000);
            tryCompare(shell, "uiOrientation", "up", 1000);
            settle();
            compare(card.adjustmentAngle, 0);
            verify(shell.maximized);
        }

        function test_appChangesOrientationWhileMaximized() {
            var uid = launchMaximized("free");
            // PalmSystem.setWindowOrientation("left") from the page.
            windows._hostMessage("org.webosphoenix.email", uid, "windowOrientation", { orientation: "left" });
            compare(windows.cards.get(windows.cardIndex(uid)).orientation, "left");
            tryCompare(rot, "animation", rot.rotateAndCrossFade, 1000);
            tryCompare(shell, "uiOrientation", "left", 1000);
            settle();
            // Back to free: the UI follows the device again.
            windows._hostMessage("org.webosphoenix.email", uid, "windowOrientation", { orientation: "free" });
            tryCompare(shell, "uiOrientation", "up", 2000);
            settle();
        }

        function test_landscapeCardOnThePortraitUi() {
            var uid = windows.launch("org.webosphoenix.email", "");
            windows.cards.setProperty(windows.cardIndex(uid), "orientation", "landscape");
            var card = shell.cardView.cardItem(uid);
            compare(card.adjustmentAngle, 90);
            compare(card.windowOrientation, "left");
            shell.cardView.maximize(uid);
            // Held landscape, the phone turns to the side the device is
            // nearer (up -> left, WindowServer.cpp:1803-1816).
            tryCompare(shell, "uiOrientation", "left", 2000);
            settle();
            compare(card.adjustmentAngle, 0);
        }

        function test_lockScreenTurnsOverAHeldCard() {
            launchMaximized("up");
            shell.lock();
            sys.deviceOrientation = "left";
            tryCompare(shell, "uiOrientation", "left", 2000);
            settle();
            // Unlocked, the card's orientation holds the UI again.
            shell.unlock();
            tryCompare(shell, "uiOrientation", "up", 2000);
            settle();
        }

        function test_inputBlockedWhileTurning() {
            var uid = windows.launch("org.webosphoenix.email", "");
            sys.deviceOrientation = "down";
            tryVerify(function() { return rot.rotating; }, 1000);
            // A tap while the snapshots turn does not reach the cards.
            mouseClick(root, 160, 200);
            compare(shell.cardView.maximizeProgress, 0);
            settle();
            compare(shell.uiOrientation, "down");
            compare(ui.rotation, 180);
        }
    }
}
