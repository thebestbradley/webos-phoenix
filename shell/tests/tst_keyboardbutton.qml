// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The keyboard button (KeyboardButton.qml; GAPS V8 (1)): with a hardware
// keyboard attached and a field in use, the button that brings the virtual
// keyboard up. It never covers the notification area (the phone's banner
// and dashboard at the bottom, the tablet's drop-down at the top right), so
// a tap there reaches the notification; dragged, it snaps to the nearer
// edge and its place is saved as system preferences (setPreferences) and
// read back from the tweaks; held, its menu hides it (Settings > Text
// Assist > Keyboard button brings it back). A tap still brings the
// keyboard up.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    // The system preferences the shells write (the window source's lunaCall).
    property var prefCalls: []

    Shell {
        id: phone
        anchors.fill: parent
        formFactor: "phone"
        density: 1
        virtualKeyboard: true
        source: SimWindowSource {
            id: phoneWindows
            function lunaCall(uri, params, callback) {
                root.prefCalls = root.prefCalls.concat([{ uri: uri, params: params }]);
                callback(null);
            }
        }
        system: SimSystemStatus { id: phoneSys }
    }

    TextInput {
        id: field
        // Under the shell: it takes the focus, not the taps meant for the button.
        z: -1
        x: 10
        y: 40
        width: 200
        height: 20
    }

    TestCase {
        name: "KeyboardButton"
        when: windowShown

        readonly property var shell: phone
        readonly property var sys: phoneSys
        readonly property var windows: phoneWindows

        function reset() {
            sys.deviceOrientation = "up";
            tryCompare(shell, "uiOrientation", "up", 3000);
            tryVerify(function() { return !shell.rotator.rotating; }, 3000);
            sys.hardwareKeyboard = false;
            sys.tweaks = {};
            field.focus = false;
            shell.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", false, 2000);
            var notes = shell.notifications;
            notes.dashboardOpen = false;
            notes.bannerActive = false;
            while (windows.notifications.count > 0)
                windows.dismissNotification(0);
            tryCompare(notes, "negativeSpace", 0, 2000);
            shell.unlock();
            root.prefCalls = [];
        }

        function cleanup() {
            sys.hardwareKeyboard = false;
            field.focus = false;
        }

        // The button, shown for the field with a hardware keyboard attached.
        function showButton() {
            sys.hardwareKeyboard = true;
            field.forceActiveFocus();
            var b = findChild(shell, "showKeyboardButton");
            tryCompare(b, "visible", true, 1000);
            return b;
        }

        // Its rectangle in the shell's coordinates.
        function rectOf(item) {
            var p = item.mapToItem(shell, 0, 0);
            return Qt.rect(p.x, p.y, item.width, item.height);
        }
        function overlaps(a, b) {
            return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        }
        function lastPrefs() {
            for (var i = root.prefCalls.length - 1; i >= 0; --i)
                if (/setPreferences$/.test(root.prefCalls[i].uri))
                    return root.prefCalls[i].params;
            return null;
        }

        function test_aTapStillShowsTheKeyboard() {
            reset();
            var b = showButton();
            // Where it always was: the bottom right, above the gesture bar.
            var r = rectOf(b);
            compare(r.x + r.width, phone.width - Theme.px(12));
            compare(r.y + r.height, phone.height - Theme.gestureAreaHeight - Theme.px(10));
            mouseClick(b);
            tryCompare(shell, "keyboardOpen", true, 1000);
            verify(!b.visible);
        }

        function test_hiddenWhenTheSettingIsOff() {
            reset();
            sys.tweaks = { keyboardButton: false };
            sys.hardwareKeyboard = true;
            field.forceActiveFocus();
            wait(200);
            verify(!findChild(shell, "showKeyboardButton").visible);
            verify(!shell.keyboardOpen, "the keyboard stays down all the same");
            sys.tweaks = { keyboardButton: true };
            tryCompare(findChild(shell, "showKeyboardButton"), "visible", true, 1000);
        }

        // Phone: the banner bar and the dashboard at the bottom push it up;
        // a tap where it used to be reaches the notification bar.
        function test_phoneMovesAboveTheNotificationArea() {
            reset();
            var b = showButton();
            var notes = shell.notifications;
            var bottom = rectOf(b).y;
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "It's good to be back.");
            tryCompare(notes, "negativeSpace", Theme.bannerHeight, 2000);
            notes.bannerActive = false;
            var space = Qt.rect(0, phone.height - Theme.gestureAreaHeight - notes.negativeSpace, phone.width, notes.negativeSpace);
            tryVerify(function() { return !overlaps(rectOf(b), space); }, 1000, "clear of the bar");
            compare(rectOf(b).y + b.height, space.y - Theme.px(8));
            verify(rectOf(b).y < bottom);
            // The bar under where the button was takes the tap: the dashboard opens.
            mouseClick(shell, phone.width - Theme.px(30), space.y + space.height / 2);
            tryCompare(notes, "dashboardOpen", true, 1000);
            tryCompare(notes, "negativeSpace", notes.dashboardHeight, 2000);
            space = Qt.rect(0, phone.height - Theme.gestureAreaHeight - notes.negativeSpace, phone.width, notes.negativeSpace);
            tryVerify(function() { return !b.visible || !overlaps(rectOf(b), space); }, 1000, "above the dashboard");
            // (The open dashboard takes the keyboard focus, so with no field in use the button may go.)
            notes.dashboardOpen = false;
            windows.dismissNotification(0);
            tryCompare(notes, "negativeSpace", 0, 2000);
            tryCompare(b, "y", bottom, 1000);
        }

        // A popup alert takes more of the bottom: the button rises with it,
        // and comes back down after.
        function test_phoneRisesWithAPopupAlert() {
            reset();
            var b = showButton();
            var bottom = b.y;
            var notes = shell.notifications;
            windows.showMemoryAlert();
            tryVerify(function() { return notes.negativeSpace > Theme.bannerHeight && notes.negativeSpace === notes.negativeSpaceTarget; }, 2000);
            verify(b.visible);
            tryCompare(b, "y", shell.uiRoot.height - notes.negativeSpace - Theme.px(8) - b.height, 1000);
            while (windows.alerts.count > 0)
                windows.closeAlert(windows.alerts.get(0).key);
            tryCompare(notes, "negativeSpace", 0, 2000);
            tryCompare(b, "y", bottom, 1000);
        }

        // Landscape: the bottom of the turned UI.
        function test_phoneLandscape() {
            reset();
            sys.deviceOrientation = "right";
            tryVerify(function() { return shell.uiOrientation !== "up" && !shell.rotator.rotating; }, 3000);
            var b = showButton();
            var notes = shell.notifications;
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "Turned.");
            tryCompare(notes, "negativeSpace", Theme.bannerHeight, 2000);
            var ui = shell.uiRoot;
            tryCompare(b, "y", ui.height - notes.negativeSpace - Theme.px(8) - b.height, 1000);
            compare(b.x + b.width, ui.width - Theme.px(12));
            sys.deviceOrientation = "up";
        }

        // Dragged to the left, it snaps to the left edge at that height, and
        // the place is saved; read back from the tweaks after a restart.
        function test_dragSnapsToTheNearestEdgeAndIsSaved() {
            reset();
            var b = showButton();
            var start = rectOf(b);
            var cx = b.width / 2, cy = b.height / 2;
            var s0 = b.mapToItem(shell, cx, cy);
            mousePress(shell, s0.x, s0.y);
            for (var i = 1; i <= 10; ++i)
                mouseMove(shell, s0.x - i * 22, s0.y - i * 15);
            mouseRelease(shell, s0.x - 220, s0.y - 150);
            var prefs;
            tryVerify(function() { prefs = lastPrefs(); return prefs !== null; }, 1000, "setPreferences");
            compare(prefs.keyboardButtonSide, "left");
            verify(prefs.keyboardButtonY > 0 && prefs.keyboardButtonY < 1, "height kept: " + prefs.keyboardButtonY);
            compare(sys.tweaks.keyboardButtonSide, "left");
            tryCompare(b, "x", Theme.px(12), 1000);
            verify(!shell.keyboardOpen, "a drag is no tap");
            var top = Theme.statusBarHeight + Theme.px(10);
            var bottom = shell.uiRoot.height - Theme.px(10) - b.height;
            fuzzyCompare(b.y, top + prefs.keyboardButtonY * (bottom - top), 1);
            fuzzyCompare(b.y, start.y - 150, 2);

            // Restored from the tweaks (as the runtime hands them back).
            sys.tweaks = {};
            tryCompare(b, "x", phone.width - Theme.px(12) - b.width, 1000);
            sys.tweaks = { keyboardButtonSide: "left", keyboardButtonY: 0 };
            tryCompare(b, "x", Theme.px(12), 1000);
            tryCompare(b, "y", top, 1000);
            // Dropped right of the middle: the right edge.
            s0 = b.mapToItem(shell, cx, cy);
            mousePress(shell, s0.x, s0.y);
            for (i = 1; i <= 10; ++i)
                mouseMove(shell, s0.x + i * 25, s0.y + i * 2);
            mouseRelease(shell, s0.x + 250, s0.y + 20);
            tryVerify(function() { return lastPrefs().keyboardButtonSide === "right"; }, 1000, "saved on the right");
            tryCompare(b, "x", phone.width - Theme.px(12) - b.width, 1000);
        }

        // Held, a menu: Cancel keeps it; Hide Keyboard Button hides it, saved,
        // and the first time a banner says where it comes back.
        function test_holdOpensTheMenuAndHideTurnsItOff() {
            reset();
            var b = showButton();
            var kbButton = b.parent;
            mousePress(b);
            wait(800);
            mouseRelease(b);
            verify(kbButton.menuOpen);
            verify(!shell.keyboardOpen, "a hold is no tap");
            var menu = findChild(shell, "keyboardButtonMenu");
            tryCompare(menu, "opacity", 1, 1000);
            mouseClick(findChild(shell, "keyboardButtonCancel"));
            verify(!kbButton.menuOpen);
            verify(b.visible);

            mousePress(b);
            wait(800);
            mouseRelease(b);
            verify(kbButton.menuOpen);
            tryCompare(menu, "opacity", 1, 1000);
            mouseClick(findChild(shell, "keyboardButtonHide"));
            tryCompare(b, "visible", false, 1000);
            compare(sys.tweaks.keyboardButton, false);
            var prefs = lastPrefs();
            compare(prefs.keyboardButton, false);
            compare(prefs.keyboardButtonHintShown, true);
            var notes = shell.notifications;
            tryCompare(notes, "bannerActive", true, 1000);
            verify(notes.bannerText.indexOf("Text Assist") >= 0, notes.bannerText);
            compare(notes.bannerAppId, "org.webosphoenix.settings");
            // Still hidden with the next field, and the keyboard stays down.
            field.focus = false;
            shell.forceActiveFocus();
            field.forceActiveFocus();
            wait(200);
            verify(!b.visible);
            verify(!shell.keyboardOpen);
            // Turned back on (Settings): back, and a second hide has no banner.
            notes.bannerActive = false;
            sys.tweaks = { keyboardButton: true, keyboardButtonHintShown: true };
            tryCompare(b, "visible", true, 1000);
            mousePress(b);
            wait(800);
            mouseRelease(b);
            tryCompare(menu, "opacity", 1, 1000);
            mouseClick(findChild(shell, "keyboardButtonHide"));
            tryCompare(b, "visible", false, 1000);
            wait(100);
            verify(!notes.bannerActive);
        }
    }
}
