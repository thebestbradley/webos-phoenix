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
            unlocked.clear();
            lockService.calls = [];
            tryCompare(findChild(lock, "unlockPanel"), "opacity", 0, 1000);
        }

        function tapKey(name) {
            var key = findChild(lock, "pinKey" + name);
            verify(key, name);
            mouseClick(key);
        }

        function test_noPasscodeUnlocksAtOnce() {
            lockService.lockMode = "none";
            lock.requestUnlock();
            compare(unlocked.count, 1);
            verify(!lock.pinEntry);
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

        function test_doneNeedsAKey() {
            lockService.lockMode = "pin";
            lock.requestUnlock();
            mouseClick(findChild(lock, "unlockDone"));
            verify(lock.pinEntry);
            compare(lockService.calls.filter(function (u) { return /match/.test(u); }).length, 0);
        }
    }
}
