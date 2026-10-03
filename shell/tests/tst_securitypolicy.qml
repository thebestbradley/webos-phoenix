// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The lock screen under a device security policy (EAS): the "PIN Required"
// dialog and setting a new PIN or password, the tries left, the last-try
// warning and the wipe (LockWindow.h:129-137; EASPolicyManager.cpp).
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell

Item {
    id: root
    width: 320
    height: 480

    // Stands in for the device lock service (com.palm.systemmanager) with a
    // policy: maxRetries tries, then the device is wiped.
    QtObject {
        id: svc
        property string lockMode: "pin"
        property string passcode: "2468"
        property string policyState: "active"
        property bool alphaNumeric: false
        property int minLength: 4
        property int maxRetries: 3
        property int retriesLeft: 3
        property bool wiped: false
        property var setCalls: []
        function policy() {
            return { password: { enabled: true, minLength: minLength, maxRetries: maxRetries, alphaNumeric: alphaNumeric },
                     inactivityInSeconds: 0, id: "eas", status: { enforced: policyState === "active", retriesLeft: retriesLeft } };
        }
        function lunaCall(uri, params, callback) {
            if (/getDeviceLockMode$/.test(uri)) {
                callback({ returnValue: true, lockMode: lockMode, policyState: policyState,
                           retriesLeft: policyState === "active" ? retriesLeft : 0 });
            } else if (/getSecurityPolicy$/.test(uri)) {
                callback({ returnValue: true, policy: policy() });
            } else if (/matchDevicePasscode$/.test(uri)) {
                if (params.passCode === passcode) {
                    retriesLeft = maxRetries;
                    callback({ returnValue: true, succeeded: true });
                    return;
                }
                retriesLeft = Math.max(0, retriesLeft - 1);
                if (retriesLeft === 0)
                    wiped = true;
                callback({ returnValue: true, succeeded: false, lockedOut: false, retriesLeft: retriesLeft });
            } else if (/setDevicePasscode$/.test(uri)) {
                setCalls.push(params);
                if (params.passCode === "1234")
                    callback({ returnValue: false, errorCode: -9, errorText: "No sequential numbers (1234)" });
                else if (params.passCode.length < minLength)
                    callback({ returnValue: false, errorCode: -2, errorText: "Passcode not minimum length" });
                else {
                    lockMode = params.lockMode;
                    passcode = params.passCode;
                    policyState = "active";
                    callback({ returnValue: true });
                }
            } else {
                callback({ returnValue: false });
            }
        }
    }

    LockScreen {
        id: lock
        anchors.fill: parent
        source: svc
        onUnlockRequested: locked = false
    }
    SignalSpy { id: unlocked; target: lock; signalName: "unlockRequested" }

    TestCase {
        name: "SecurityPolicy"
        when: windowShown

        function init() {
            svc.lockMode = "pin";
            svc.passcode = "2468";
            svc.policyState = "active";
            svc.alphaNumeric = false;
            svc.minLength = 4;
            svc.retriesLeft = 3;
            svc.wiped = false;
            svc.setCalls = [];
            lock.locked = true;
            lock.unlockPanel.shown = false;
            lock._resetSecurityStates();
            unlocked.clear();
        }

        function type(text) {
            // Laid out and shown (as a finger would find it).
            tryCompare(findChild(lock, "unlockPanel"), "opacity", 1, 1000);
            for (var i = 0; i < text.length; ++i)
                mouseClick(findChild(lock, "pinKey" + text.charAt(i)));
            mouseClick(findChild(lock, "unlockDone"));
        }
        function dialog() { return findChild(lock, "messageDialog"); }
        function button(n) { return findChild(lock, "messageDialogButton" + n); }
        function clickButton(n) {
            tryCompare(dialog(), "opacity", 1, 1000);
            mouseClick(button(n));
        }

        // "%1 Tries Remaining", then the warning, "Final Try", then the wipe.
        function test_triesLeftLastTryAndWipe() {
            lock.requestUnlock();
            verify(lock.pinEntry);
            compare(lock.unlockPanel.hint, "Enter PIN");
            type("1111");
            compare(lock.unlockPanel.title, "PIN Incorrect");
            compare(lock.unlockPanel.hint, "2 Tries Remaining");
            type("1111");
            // One left: the panel goes, the warning comes.
            compare(lock.dialogState, "lastTry");
            verify(!lock.pinEntry);
            tryCompare(dialog(), "opacity", 1, 1000);
            compare(findChild(lock, "messageDialogTitle").text, "Warning");
            compare(findChild(lock, "messageDialogMessage").text,
                    "PIN incorrect. If you enter an incorrect PIN now your device will be erased");
            verify(button(1).shown);
            compare(button(1).caption, "Ok");
            verify(!button(2).shown && !button(3).shown);
            verify(!findChild(lock, "padlock").visible);
            clickButton(1);
            verify(lock.pinEntry);
            compare(lock.unlockPanel.hint, "Final Try");
            type("1111");
            compare(lock.dialogState, "wipe");
            compare(findChild(lock, "messageDialogTitle").text, "PIN Incorrect");
            compare(findChild(lock, "messageDialogMessage").text, "Your device will now be erased.");
            verify(!button(1).shown);
            verify(svc.wiped);
            compare(unlocked.count, 0);
        }

        function test_rightPinUnlocksAndResetsTheTries() {
            lock.requestUnlock();
            type("1111");
            type("2468");
            compare(unlocked.count, 1);
            compare(svc.retriesLeft, 3);
        }

        // A pending policy: "PIN Required", then a new PIN, twice.
        function test_newPinRequired() {
            svc.policyState = "pending";
            svc.lockMode = "none";
            svc.minLength = 6;
            lock.requestUnlock();
            compare(lock.dialogState, "newPin");
            verify(!lock.pinEntry);
            compare(findChild(lock, "messageDialogTitle").text, "PIN Required");
            compare(button(1).caption, "New PIN");
            compare(button(2).caption, "New Password");
            compare(button(3).caption, "Cancel");
            verify(button(1).affirmative && button(2).affirmative && !button(3).affirmative);
            clickButton(1);
            verify(lock.pinEntry);
            compare(lock.unlockPanel.title, "Enter PIN");
            compare(lock.unlockPanel.hint, "Must be at least 6 numbers");
            // Too short: Done stays off.
            tryCompare(findChild(lock, "unlockPanel"), "opacity", 1, 1000);
            for (var i = 0; i < 4; ++i)
                mouseClick(findChild(lock, "pinKey5"));
            mouseClick(findChild(lock, "unlockDone"));
            compare(lock.unlockPanel.title, "Enter PIN");
            mouseClick(findChild(lock, "pinKeyDelete"));
            for (i = 0; i < 3; ++i)
                mouseClick(findChild(lock, "pinKeyDelete"));
            type("135792");
            compare(lock.unlockPanel.title, "Enter PIN Again");
            type("135790");
            compare(lock.unlockPanel.title, "PIN Doesn't Match");
            compare(lock.unlockPanel.hint, "Try Again");
            type("135792");
            compare(lock.unlockPanel.title, "Enter PIN Again");
            type("135792");
            compare(svc.setCalls.length, 1);
            compare(svc.setCalls[0].lockMode, "pin");
            compare(unlocked.count, 1);
        }

        // A PIN the policy turns down: "PIN Not Secure" and its reason.
        function test_weakPinRefused() {
            svc.policyState = "pending";
            svc.minLength = 4;
            lock.requestUnlock();
            clickButton(1);
            type("1234");
            type("1234");
            compare(lock.unlockPanel.title, "PIN Not Secure");
            compare(lock.unlockPanel.hint, "No sequential numbers (1234)");
            compare(unlocked.count, 0);
            // The next key puts the title back.
            mouseClick(findChild(lock, "pinKey7"));
            compare(lock.unlockPanel.title, "Enter PIN");
        }

        // An alphanumeric policy offers a password only; Cancel locks again.
        function test_passwordRequiredAndCancel() {
            svc.policyState = "pending";
            svc.alphaNumeric = true;
            lock.requestUnlock();
            compare(findChild(lock, "messageDialogTitle").text, "Password Required");
            verify(!button(1).shown);
            compare(button(2).caption, "New Password");
            clickButton(3);
            compare(lock.dialogState, "");
            verify(!lock.pinEntry);
            verify(findChild(lock, "padlock").visible);
            compare(unlocked.count, 0);
            lock.requestUnlock();
            clickButton(2);
            verify(lock.pinEntry);
            verify(!lock.unlockPanel.isPINEntry);
            compare(lock.unlockPanel.title, "Enter Password");
        }

        // Without a policy, a wrong PIN only says "Try Again".
        function test_noPolicyTryAgain() {
            svc.policyState = "none";
            lock.requestUnlock();
            type("1111");
            compare(lock.unlockPanel.hint, "Try Again");
            compare(lock.dialogState, "");
        }

        // The policy's inactivity limit caps "Lock after".
        function test_inactivityCapsLockAfter() {
            lock.system = { lockTimeout: 600 };
            lock.locked = false;
            lock.locked = true;
            lock.lockedAt = Date.now() - 30000;
            svc.policyState = "none";
            lock.requestUnlock();
            compare(unlocked.count, 1, "no policy: within Lock after");
            lock.locked = true;
            lock.lockedAt = Date.now() - 30000;
            svc.policyState = "active";
            lock.requestUnlock();
            verify(lock.pinEntry, "the policy allows no time at all");
            lock.system = null;
        }
    }
}
