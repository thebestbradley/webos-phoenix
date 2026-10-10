// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Lock screen and the PIN / password panel.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell

Item {
    id: root
    width: 320
    height: 480

    // Stands in for the device lock service (com.palm.systemmanager).
    QtObject {
        id: lockService
        property string lockMode: "none"
        property string passcode: ""
        property var calls: []
        function lunaCall(uri, params, callback) {
            calls.push(uri);
            if (/getDeviceLockMode$/.test(uri))
                callback({ returnValue: true, lockMode: lockMode });
            else if (/matchDevicePasscode$/.test(uri))
                callback({ returnValue: true, succeeded: params.passCode === passcode });
            else
                callback({ returnValue: false });
        }
    }

    LockScreen {
        id: lock
        anchors.fill: parent
        source: lockService
        onUnlockRequested: locked = false
    }

    SignalSpy { id: unlocked; target: lock; signalName: "unlockRequested" }

    TestCase {
        name: "Lock"
        when: windowShown

        function init() {
            lock.locked = true;
            // A test may leave the panel asking for the passcode; locking
            // again is no change, so close it here.
            lock.unlockPanel.shown = false;
            unlocked.clear();
            lockService.calls = [];
            tryCompare(findChild(lock, "unlockPanel"), "opacity", 0, 1000);
        }

        function tapKey(name) {
            var key = findChild(lock, "pinKey" + name);
            verify(key, name);
            mouseClick(key);
        }

        function dragPadlock(dx, dy) {
            var pad = findChild(lock, "padlock");
            var cx = pad.x + pad.width / 2, cy = pad.y + pad.height / 2;
            mousePress(lock, cx, cy);
            for (var i = 1; i <= 10; ++i)
                mouseMove(lock, cx + dx * i / 10, cy + dy * i / 10);
            var help = lock.helpShown;
            // The padlock is under the finger, in both directions.
            fuzzyCompare(pad.x + pad.width / 2, cx + dx, 1);
            fuzzyCompare(pad.y + pad.height / 2, cy + dy, 1);
            mouseRelease(lock, cx + dx, cy + dy);
            return help;
        }

        function test_padlockUnlocksPastTheSaucer() {
            lockService.lockMode = "none";
            // Short of the 146 px radius: stays locked, help showing.
            verify(dragPadlock(0, -120));
            compare(unlocked.count, 0);
            var pad = findChild(lock, "padlock");
            // Home at once, not animated.
            compare(pad.y, pad.homeY);
            // Help hides a second after the release.
            verify(lock.helpShown);
            tryCompare(lock, "helpShown", false, 1500);
            // Far to the side but not above where it rests: no.
            dragPadlock(150, 10);
            compare(unlocked.count, 0);
            // Up and to the side, past the radius: unlocks; help hid on the way out.
            verify(!dragPadlock(-110, -110));
            compare(unlocked.count, 1);
        }

        function test_noPasscodeUnlocksAtOnce() {
            lockService.lockMode = "none";
            lock.requestUnlock();
            compare(unlocked.count, 1);
            verify(!lock.pinEntry);
        }

        // "Lock after": within lockTimeout of locking, no passcode.
        function test_lockAfter() {
            lockService.lockMode = "pin";
            lock.system = { lockTimeout: 60 };
            lock.locked = false;
            lock.locked = true;
            lock.requestUnlock();
            compare(unlocked.count, 1, "locked a moment ago");
            verify(!lock.pinEntry);
            lock.locked = true;
            lock.lockedAt = Date.now() - 61000;
            lock.requestUnlock();
            compare(unlocked.count, 1);
            verify(lock.pinEntry, "locked for over a minute");
            // 0 (the default): always.
            lock.unlockPanel.shown = false;
            lock.system = { lockTimeout: 0 };
            lock.locked = false;
            lock.locked = true;
            lock.requestUnlock();
            verify(lock.pinEntry);
            lock.system = null;
        }

        function test_noLockServiceUnlocks() {
            lock.source = null;
            lock.requestUnlock();
            compare(unlocked.count, 1);
            lock.source = lockService;
        }

        function test_pinIsCheckedByTheService() {
            lockService.lockMode = "pin";
            lockService.passcode = "2468";
            lock.requestUnlock();
            verify(lock.pinEntry);
            var panel = findChild(lock, "unlockPanel");
            tryCompare(panel, "opacity", 1, 1000);
            compare(panel.title, "Device Locked");
            compare(panel.hint, "Enter PIN");

            // Wrong PIN: "PIN Incorrect", "Try Again", still locked.
            tapKey("1"); tapKey("2"); tapKey("3"); tapKey("5");
            compare(panel.enteredText, "1235");
            mouseClick(findChild(lock, "unlockDone"));
            compare(unlocked.count, 0);
            compare(panel.title, "PIN Incorrect");
            compare(panel.hint, "Try Again");
            compare(panel.enteredText, "");

            // The next key brings the title back; delete works.
            tapKey("2");
            compare(panel.title, "Device Locked");
            tapKey("9"); tapKey("Delete");
            tapKey("4"); tapKey("6"); tapKey("8");
            compare(panel.enteredText, "2468");
            mouseClick(findChild(lock, "unlockDone"));
            compare(unlocked.count, 1);
            verify(!lock.locked);
            // The passcode only went to the service.
            compare(lockService.calls.filter(function (u) { return /match/.test(u); }).length, 2);
        }

        function test_cancelReturnsToTheLockScreen() {
            lockService.lockMode = "pin";
            lock.requestUnlock();
            verify(lock.pinEntry);
            mouseClick(findChild(lock, "unlockCancel"));
            verify(!lock.pinEntry);
            verify(lock.locked);
            compare(unlocked.count, 0);
        }

        function test_passwordFromTheKeyboard() {
            lockService.lockMode = "password";
            lockService.passcode = "Hunter2";
            lock.requestUnlock();
            var panel = findChild(lock, "unlockPanel");
            compare(panel.hint, "Enter Password");
            verify(!panel.isPINEntry);
            keyClick("H");
            "unter2".split("").forEach(function (c) { keyClick(c); });
            compare(panel.enteredText, "Hunter2");
            keyClick(Qt.Key_Return);
            compare(unlocked.count, 1);
        }

        // GAPS V8: the PIN pad from a hardware keyboard, as the original's
        // Keys handlers (UnlockPanel.qml:191-230): digits, Backspace, Enter;
        // a letter types nothing into a PIN.
        function test_pinFromTheKeyboard() {
            lockService.lockMode = "pin";
            lockService.passcode = "2580";
            lock.requestUnlock();
            var panel = findChild(lock, "unlockPanel");
            verify(panel.activeFocus);
            keyClick(Qt.Key_2);
            keyClick(Qt.Key_5);
            keyClick("x");
            keyClick(Qt.Key_9);
            compare(panel.enteredText, "259");
            keyClick(Qt.Key_Backspace);
            keyClick(Qt.Key_8, Qt.KeypadModifier);
            keyClick(Qt.Key_0, Qt.KeypadModifier);
            compare(panel.enteredText, "2580");
            keyClick(Qt.Key_Enter, Qt.KeypadModifier);
            compare(unlocked.count, 1);
        }

        // However the panel is shown, it takes the keys (the simulator's
        // "pin" scene sets it up and shows it directly).
        function test_shownPanelTakesTheKeys() {
            var panel = findChild(lock, "unlockPanel");
            root.forceActiveFocus();
            panel.setupDialog(true, "Device Locked", "Enter PIN", false, 0);
            panel.shown = true;
            verify(panel.activeFocus);
            keyClick(Qt.Key_7);
            compare(panel.enteredText, "7");
            panel.shown = false;
        }

        // GAPS V8 (3): a focus ring over the keypad and the buttons.
        function test_pinPadFocusRing() {
            lockService.lockMode = "pin";
            lockService.passcode = "15";
            lock.emergencyAvailable = true;
            lock.requestUnlock();
            var panel = findChild(lock, "unlockPanel");
            compare(panel.keyItem, null);
            // The arrows: the first key, then the nearest each way.
            keyClick(Qt.Key_Down);
            compare(panel.keyItem.caption, "1");
            verify(findChild(panel.keyItem, "pinKeyFocus").visible);
            keyClick(Qt.Key_Return);
            compare(panel.enteredText, "1");
            keyClick(Qt.Key_Down);
            keyClick(Qt.Key_Right);
            compare(panel.keyItem.caption, "5");
            keyClick(Qt.Key_Space);
            compare(panel.enteredText, "15");
            // Past the right column it stays; down past the keys, the buttons.
            keyClick(Qt.Key_Right);
            keyClick(Qt.Key_Right);
            compare(panel.keyItem.caption, "6");
            keyClick(Qt.Key_Down);
            keyClick(Qt.Key_Down);
            compare(panel.keyItem.caption, "\b");
            keyClick(Qt.Key_Down);
            compare(panel.keyItem.objectName, "unlockEmergency");
            keyClick(Qt.Key_Down);
            compare(panel.keyItem.objectName, "unlockCancel");
            verify(findChild(panel.keyItem, "actionButtonKeyFocus").visible);
            keyClick(Qt.Key_Right);
            compare(panel.keyItem.objectName, "unlockDone");
            // Tab in reading order, wrapping: Cancel, then Done, then 1.
            keyClick(Qt.Key_Backtab);
            compare(panel.keyItem.objectName, "unlockCancel");
            keyClick(Qt.Key_Tab);
            keyClick(Qt.Key_Tab);
            compare(panel.keyItem.caption, "1");
            // Typing takes the ring away, so Enter submits.
            keyClick(Qt.Key_9);
            compare(panel.keyItem, null);
            keyClick(Qt.Key_Backspace);
            compare(panel.enteredText, "15");
            // Enter on the ringed Done submits.
            keyClick(Qt.Key_Backtab);
            compare(panel.keyItem.objectName, "unlockDone");
            keyClick(Qt.Key_Return);
            compare(unlocked.count, 1);
            compare(panel.keyItem, null);
            lock.emergencyAvailable = false;
        }

        function test_doneNeedsAKey() {
            lockService.lockMode = "pin";
            lock.requestUnlock();
            mouseClick(findChild(lock, "unlockDone"));
            verify(lock.pinEntry);
            compare(lockService.calls.filter(function (u) { return /match/.test(u); }).length, 0);
        }
    }

    // ---- Dashboard and banner on the lock screen ------------------------------

    ListModel { id: notes }
    QtObject { id: prefs; property bool showAlertsWhenLocked: true }
    // A dashboard window: counts the taps that reach it.
    Rectangle {
        id: dashWindow
        property int taps: 0
        color: "#333333"
        MouseArea { anchors.fill: parent; onClicked: dashWindow.taps++ }
    }
    QtObject {
        id: windows
        function windowFor(key) { return key === "w1" ? dashWindow : null; }
    }

    LockScreen {
        id: lock2
        anchors.fill: parent
        source: windows
        system: prefs
        notifications: notes
        visible: false
    }

    TestCase {
        name: "LockAlerts"
        when: windowShown

        function add(title, windowKey, clickable) {
            notes.append({ appId: "a", title: title, body: "", color: "#666666", glyph: "", icon: "",
                           params: "", windowKey: windowKey || "", clickableWhenLocked: !!clickable });
        }

        function init() {
            // Over the first lock screen (declared after it).
            lock2.visible = true;
            lock2.locked = true;
            lock2.alertShown = false;
            lock2.bannerActive = false;
            prefs.showAlertsWhenLocked = true;
            notes.clear();
            dashWindow.taps = 0;
        }
        function cleanup() {
            notes.clear();
            lock2.visible = false;
        }

        function items() {
            var out = [];
            var col = findChild(lock2, "lockDashboard");
            (function walk(o) {
                for (var i = 0; i < o.children.length; ++i) {
                    if (o.children[i].objectName === "lockDashboardItem")
                        out.push(o.children[i]);
                    walk(o.children[i]);
                }
            })(col);
            return out;
        }

        function test_dashboardNewestFirst() {
            add("One"); add("Two"); add("Three");
            var dash = findChild(lock2, "lockDashboard");
            tryCompare(dash, "opacity", 1, 1000);
            var rows = items();
            compare(rows.length, 3);
            compare(rows[0].title, "Three");
            compare(rows[2].title, "One");
            // Three 52 px rows, two 2 px dividers.
            compare(dash.contentHeight, 3 * 52 + 2 * 2);
            // Centred.
            fuzzyCompare(dash.y + dash.height / 2, lock2.height / 2 + (-1 + 3) / 2, 1);
        }

        function test_dashboardShowsFiveAndAHalf() {
            for (var i = 0; i < 8; ++i)
                add("N" + i);
            var dash = findChild(lock2, "lockDashboard");
            compare(dash.count, 6);
            compare(items().length, 6);
            compare(dash.contentHeight, 5.5 * 52 + 5 * 2);
        }

        function test_hiddenWhenTurnedOff() {
            add("One");
            prefs.showAlertsWhenLocked = false;
            tryCompare(findChild(lock2, "lockDashboard"), "opacity", 0, 1000);
            prefs.showAlertsWhenLocked = true;
            tryCompare(findChild(lock2, "lockDashboard"), "opacity", 1, 1000);
            // Not over a popup alert.
            lock2.alertShown = true;
            tryCompare(findChild(lock2, "lockDashboard"), "opacity", 0, 1000);
        }

        function test_bannerReplacesTheDashboard() {
            add("One");
            lock2.bannerText = "New message";
            lock2.bannerActive = true;
            tryCompare(findChild(lock2, "lockBanner"), "opacity", 1, 1000);
            tryCompare(findChild(lock2, "lockDashboard"), "opacity", 0, 1000);
            compare(findChild(lock2, "lockBannerText").text, "New message");
            lock2.bannerActive = false;
            tryCompare(findChild(lock2, "lockBanner"), "opacity", 0, 1000);
            tryCompare(findChild(lock2, "lockDashboard"), "opacity", 1, 1000);
        }

        function test_tapsOnlyWhenClickableWhenLocked() {
            add("Dash", "w1", false);
            var dash = findChild(lock2, "lockDashboard");
            tryCompare(dash, "opacity", 1, 1000);
            compare(dashWindow.parent.parent, items()[0]);
            mouseClick(dashWindow);
            compare(dashWindow.taps, 0);
            notes.clear();
            add("Dash", "w1", true);
            tryCompare(dashWindow.parent.parent, "objectName", "lockDashboardItem");
            mouseClick(dashWindow);
            compare(dashWindow.taps, 1);
        }
    }
}
