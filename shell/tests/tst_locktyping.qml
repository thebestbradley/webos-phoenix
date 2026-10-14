// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Type to unlock (the owner, 14 October 2026): with a PIN or password set,
// typing on a hardware keyboard on the lock screen opens the panel with
// the key in it; a PIN whose length the lock service knows unlocks as its
// last digit goes in, with no Done, and a wrong one of that length is one
// failed try (LockScreen.typeKey, UnlockPanel.autoSubmitLength). Also: the
// lock screen has the keyboard while locked (an app under it gets nothing
// typed there), and with the screen off a typed key wakes it.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    // Stands in for the device lock service (com.palm.systemmanager): its
    // pinLength as the device's service tells the shell, and the tries it
    // counts (three wrong in a row hold the next off, Security.cpp:43-44).
    QtObject {
        id: lockService
        property string lockMode: "pin"
        property string passcode: "2580"
        // 0: not known (a PIN set before its length was kept).
        property int pinLength: 4
        property var matched: []
        property int failures: 0
        function lunaCall(uri, params, callback) {
            if (/getDeviceLockMode$/.test(uri)) {
                var r = { returnValue: true, lockMode: lockMode, policyState: "none", retriesLeft: 0 };
                if (lockMode === "pin" && pinLength > 0)
                    r.pinLength = pinLength;
                callback(r);
            } else if (/matchDevicePasscode$/.test(uri)) {
                matched.push(params.passCode);
                var good = params.passCode === passcode;
                if (!good)
                    failures++;
                callback(good ? { returnValue: true, succeeded: true }
                              : { returnValue: true, succeeded: false, lockedOut: false, retriesLeft: Math.max(0, 3 - failures) });
            } else {
                callback({ returnValue: false });
            }
        }
    }

    // An app's field under the lock screen.
    TextInput {
        id: appField
        width: 100
        height: 20
    }

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: status }
    }

    SignalSpy { id: unlocked; target: shell.lockScreen; signalName: "unlockRequested" }

    TestCase {
        name: "TypeToUnlock"
        when: windowShown

        readonly property var lock: shell.lockScreen
        readonly property var panel: shell.lockScreen.unlockPanel

        function init() {
            lock.source = lockService;
            lockService.lockMode = "pin";
            lockService.passcode = "2580";
            lockService.pinLength = 4;
            lockService.matched = [];
            lockService.failures = 0;
            appField.text = "";
            shell.unlock();
            shell.lock();
            shell.display.turnOn();
            unlocked.clear();
            tryCompare(panel, "opacity", 0, 1000);
        }
        function cleanup() {
            panel.shown = false;
            shell.unlock();
        }

        function done() { return findChild(shell, "unlockDone"); }

        // Digits open the PIN pad, each typed in; the fourth unlocks, with
        // no Done shown.
        function test_digitsOpenThePinPadAndTheLastUnlocks() {
            verify(!lock.pinEntry);
            keyClick(Qt.Key_2);
            verify(lock.pinEntry, "the first digit opens the pad");
            verify(panel.isPINEntry);
            compare(panel.enteredText, "2");
            verify(panel.activeFocus, "the pad has the keyboard");
            verify(!done().visible, "no Done for a PIN of a known length");
            compare(panel.autoSubmitLength, 4);
            // Cancel alone has the row.
            var cancel = findChild(shell, "unlockCancel");
            compare(cancel.width, cancel.parent.width);
            keyClick(Qt.Key_5);
            keyClick(Qt.Key_8);
            compare(panel.enteredText, "258");
            compare(lockService.matched.length, 0, "nothing checked before the last digit");
            keyClick(Qt.Key_0);
            compare(lockService.matched, ["2580"]);
            compare(unlocked.count, 1);
            verify(!shell.locked);
            compare(panel.enteredText, "", "nothing of it left in the field");
        }

        // A PIN takes digits only: a letter opens nothing, and in the pad
        // types nothing.
        function test_lettersDoNothingForAPin() {
            keyClick("a");
            keyClick("Q");
            verify(!lock.pinEntry);
            keyClick(Qt.Key_7);
            verify(lock.pinEntry);
            keyClick("x");
            compare(panel.enteredText, "7");
            // Space opens nothing either (pressed to wake the screen).
            keyClick(Qt.Key_Escape);
            verify(!lock.pinEntry);
            keyClick(Qt.Key_Space);
            verify(!lock.pinEntry);
            verify(shell.locked);
        }

        // The numeric keypad's digits (Qt.KeypadModifier) are digits.
        function test_numericKeypad() {
            keyClick(Qt.Key_2, Qt.KeypadModifier);
            verify(lock.pinEntry);
            keyClick(Qt.Key_5, Qt.KeypadModifier);
            keyClick(Qt.Key_8, Qt.KeypadModifier);
            keyClick(Qt.Key_0, Qt.KeypadModifier);
            compare(unlocked.count, 1);
        }

        // Backspace takes one off; Esc closes the pad and what was typed
        // goes.
        function test_backspaceAndEscape() {
            keyClick(Qt.Key_1);
            keyClick(Qt.Key_9);
            keyClick(Qt.Key_Backspace);
            compare(panel.enteredText, "1");
            keyClick(Qt.Key_Escape);
            verify(!lock.pinEntry);
            compare(panel.enteredText, "");
            verify(shell.locked);
            // Typing again starts afresh.
            keyClick(Qt.Key_2);
            compare(panel.enteredText, "2");
            compare(lockService.matched.length, 0);
        }

        // A wrong PIN as long as the right one is one failed try: checked
        // once, "PIN Incorrect", the panel shakes and is empty; the next
        // try goes on as usual.
        function test_wrongPinAtFullLengthCountsOneTry() {
            "1111".split("").forEach(function (d) { keyClick(d); });
            compare(lockService.matched, ["1111"]);
            compare(lockService.failures, 1);
            verify(lock.pinEntry, "still asking");
            compare(panel.title, "PIN Incorrect");
            compare(panel.hint, "Try Again");
            compare(panel.enteredText, "");
            verify(panel.shaking, "it shakes");
            verify(!panel.checking);
            // Three, as the service counts them: each one try.
            "12".split("").forEach(function (d) { keyClick(d); });
            compare(lockService.matched.length, 1, "short of the length: not a try");
            "34".split("").forEach(function (d) { keyClick(d); });
            compare(lockService.matched, ["1111", "1234"]);
            compare(lockService.failures, 2);
            "2580".split("").forEach(function (d) { keyClick(d); });
            compare(unlocked.count, 1);
            compare(lockService.matched.length, 3);
        }

        // No more digits than the PIN has, while it is checked or after.
        function test_noMoreThanItsLength() {
            lockService.pinLength = 6;
            lockService.passcode = "135790";
            "1357".split("").forEach(function (d) { keyClick(d); });
            compare(panel.autoSubmitLength, 6);
            keyClick(Qt.Key_9);
            keyClick(Qt.Key_0);
            compare(unlocked.count, 1);
            compare(lockService.matched, ["135790"]);
        }

        // Return submits a PIN as Done did: a PIN set before its length was
        // kept (none told) keeps Done, and four digits check nothing.
        function test_pinOfUnknownLengthKeepsDone() {
            lockService.pinLength = 0;
            "2580".split("").forEach(function (d) { keyClick(d); });
            verify(lock.pinEntry);
            verify(done().visible, "Done for a PIN of unknown length");
            compare(panel.autoSubmitLength, 0);
            compare(lockService.matched.length, 0);
            keyClick(Qt.Key_Return);
            compare(unlocked.count, 1);
        }

        // Return, with a PIN of a known length, submits what is in as Done
        // did: a wrong try.
        function test_returnSubmitsAPin() {
            keyClick(Qt.Key_2);
            keyClick(Qt.Key_5);
            keyClick(Qt.Key_Return);
            compare(lockService.matched, ["25"]);
            compare(panel.title, "PIN Incorrect");
            verify(lock.pinEntry);
        }

        // A password: any character opens it and goes in; Done is there,
        // and Return submits.
        function test_passwordKeepsDoneAndReturnSubmits() {
            lockService.lockMode = "password";
            lockService.passcode = "Hunter 2";
            keyClick(Qt.Key_Space);
            verify(!lock.pinEntry, "a space opens nothing");
            keyClick("H");
            verify(lock.pinEntry);
            verify(!panel.isPINEntry);
            verify(done().visible, "a password keeps Done");
            compare(panel.autoSubmitLength, 0);
            "unter 2".split("").forEach(function (c) { keyClick(c); });
            compare(panel.enteredText, "Hunter 2");
            compare(lockService.matched.length, 0);
            keyClick(Qt.Key_Return);
            compare(lockService.matched, ["Hunter 2"]);
            compare(unlocked.count, 1);
        }

        // A wrong password shakes too and starts empty.
        function test_wrongPassword() {
            lockService.lockMode = "password";
            lockService.passcode = "secret";
            "nope".split("").forEach(function (c) { keyClick(c); });
            keyClick(Qt.Key_Return);
            compare(panel.title, "Password Incorrect");
            compare(panel.enteredText, "");
            verify(panel.shaking);
        }

        // Without a passcode keys do nothing new: no panel, still locked.
        function test_noPasscodeKeysDoNothing() {
            lockService.lockMode = "none";
            keyClick(Qt.Key_1);
            keyClick("a");
            verify(!lock.pinEntry);
            verify(shell.locked);
            compare(unlocked.count, 0);
        }

        // The screen off: a digit wakes it and goes in; without a passcode
        // it stays off. A letter, for a PIN, wakes nothing.
        function test_screenOffWakesAndTypes() {
            shell.display.turnOff();
            compare(shell.display.state, "off");
            keyClick("a");
            compare(shell.display.state, "off", "a letter is no PIN");
            keyClick(Qt.Key_2);
            compare(shell.display.state, "on");
            verify(lock.pinEntry);
            compare(panel.enteredText, "2");
            "580".split("").forEach(function (d) { keyClick(d); });
            compare(unlocked.count, 1);

            shell.lock();
            lockService.lockMode = "none";
            shell.display.turnOff();
            keyClick(Qt.Key_2);
            compare(shell.display.state, "off");
            verify(!lock.pinEntry);
        }

        // Dimmed, the key brings it back on and is typed too.
        function test_dimmedWakesAndTypes() {
            shell.display.state = "dim";
            keyClick(Qt.Key_2);
            compare(shell.display.state, "on");
            compare(panel.enteredText, "2");
        }

        // The screen turning off with the pad up goes back to the lock
        // screen, what was typed gone (the original's display going off
        // locked again, LockWindow.cpp:711-718): typing then opens it afresh.
        function test_screenOffClosesThePad() {
            keyClick(Qt.Key_1);
            verify(lock.pinEntry);
            shell.display.turnOff();
            verify(!lock.pinEntry);
            compare(panel.enteredText, "");
            keyClick(Qt.Key_2);
            compare(shell.display.state, "on");
            compare(panel.enteredText, "2");
        }

        // An app's field under the lock screen gets nothing typed on it, and
        // has the keyboard again once unlocked.
        function test_appUnderTheLockGetsNoKeys() {
            shell.unlock();
            appField.forceActiveFocus();
            keyClick("z");
            compare(appField.text, "z");
            shell.lock();
            verify(!appField.activeFocus);
            keyClick("z");
            "2580".split("").forEach(function (d) { keyClick(d); });
            compare(unlocked.count, 1);
            compare(appField.text, "z", "nothing typed on the lock screen reached the app");
            verify(appField.activeFocus, "the app has the keyboard back");
        }

        // A screen reader: the panel opened by a key has the focus, read as
        // a dialog with its title and what it asks; the field as a PIN.
        function test_accessibility() {
            keyClick(Qt.Key_4);
            verify(panel.activeFocus);
            compare(panel.Accessible.role, Accessible.Dialog);
            compare(panel.Accessible.name, "Device Locked");
            compare(panel.Accessible.description, "Enter PIN");
            var field = findChild(panel, "unlockField");
            compare(field.Accessible.name, "PIN");
            compare(field.echoMode, TextInput.Password);
            compare(field.Accessible.description, "1 digit(s) entered");
            compare(findChild(shell, "unlockCancel").Accessible.name, "Cancel");
            keyClick(Qt.Key_Escape);
            lockService.lockMode = "password";
            keyClick("p");
            compare(findChild(panel, "unlockField").Accessible.name, "Password");
        }

        // Dock mode and a ringing call take no typing.
        function test_notInDockModeOrACall() {
            shell.lockScreen.incomingCall = true;
            keyClick(Qt.Key_2);
            verify(!lock.pinEntry);
            shell.lockScreen.incomingCall = false;
        }
    }
}
