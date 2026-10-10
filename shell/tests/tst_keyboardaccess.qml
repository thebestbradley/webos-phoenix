// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Keyboard accessibility (GAPS V8 (4)): sticky, slow and bounce keys and
// the key repeat, on keys from the keyboard.
// Run: qmltestrunner -import qml -import build/qml -input tests

import QtQuick
import QtTest
import Phoenix.Native

Item {
    id: root
    width: 400
    height: 200

    KeyboardAccess { id: access }

    TextInput {
        id: field
        width: 300
        height: 40
        focus: true
    }

    TestCase {
        name: "KeyboardAccess"
        when: windowShown

        function init() {
            field.text = "";
            field.forceActiveFocus();
        }
        function cleanup() {
            access.stickyKeys = false;
            access.slowKeys = false;
            access.bounceKeys = false;
            access.customRepeat = false;
            wait(access.bounceKeysDelay + 50);
        }

        function test_offChangesNothing() {
            keyClick(Qt.Key_A);
            keyClick(Qt.Key_B);
            compare(field.text, "ab");
            verify(access.hardwareKeySeen);
        }

        // Shift alone holds for the next key; twice stays down until
        // pressed again.
        function test_stickyKeys() {
            access.stickyKeys = true;
            keyClick(Qt.Key_Shift);
            compare(access.latchedModifiers, Qt.ShiftModifier);
            keyClick(Qt.Key_A, Qt.NoModifier);
            keyClick(Qt.Key_B);
            compare(field.text, "Ab");
            compare(access.latchedModifiers, 0);
            keyClick(Qt.Key_Shift);
            keyClick(Qt.Key_Shift);
            compare(access.lockedModifiers, Qt.ShiftModifier);
            keyClick(Qt.Key_C);
            keyClick(Qt.Key_D);
            compare(field.text, "AbCD");
            keyClick(Qt.Key_Shift);
            compare(access.lockedModifiers, 0);
            keyClick(Qt.Key_E);
            compare(field.text, "AbCDe");
            // Held with the key, Shift is just Shift: nothing latches.
            // (QtTest types the letter in lower case whatever the Shift.)
            keyPress(Qt.Key_Shift);
            keyClick(Qt.Key_F, Qt.ShiftModifier);
            keyRelease(Qt.Key_Shift);
            compare(access.latchedModifiers, 0);
            compare(field.text.length, 6);
            // Turning it off lets go of anything latched.
            keyClick(Qt.Key_Shift);
            access.stickyKeys = false;
            compare(access.latchedModifiers, 0);
        }

        // A key counts only once held slowKeysDelay ms.
        function test_slowKeys() {
            access.slowKeys = true;
            access.slowKeysDelay = 200;
            var ignored = signalSpy.createObject(root, { target: access, signalName: "keyIgnored" });
            keyClick(Qt.Key_X);
            compare(field.text, "");
            compare(ignored.count, 1);
            keyPress(Qt.Key_Y);
            compare(field.text, "");
            wait(300);
            compare(field.text, "y");
            keyRelease(Qt.Key_Y);
            compare(field.text, "y");
            ignored.destroy();
        }

        // A key pressed again within bounceKeysDelay ms of its release is
        // dropped.
        function test_bounceKeys() {
            access.bounceKeys = true;
            access.bounceKeysDelay = 300;
            keyClick(Qt.Key_Q);
            keyClick(Qt.Key_Q);
            compare(field.text, "q");
            keyClick(Qt.Key_W);
            compare(field.text, "qw");
            wait(400);
            keyClick(Qt.Key_W);
            compare(field.text, "qww");
        }

        // A held key repeats after repeatDelay, then every repeatInterval.
        function test_customRepeat() {
            access.customRepeat = true;
            access.repeatDelay = 150;
            access.repeatInterval = 50;
            keyPress(Qt.Key_R);
            compare(field.text, "r");
            wait(100);
            compare(field.text, "r");
            wait(250);
            keyRelease(Qt.Key_R);
            var n = field.text.length;
            verify(n >= 3 && n <= 8, "repeated " + n + " times");
            wait(150);
            compare(field.text.length, n);
            // A delay of 0: no repeat at all.
            field.text = "";
            access.repeatDelay = 0;
            keyPress(Qt.Key_S);
            wait(300);
            keyRelease(Qt.Key_S);
            compare(field.text, "s");
        }

        // Settings > Text Assist > Hardware Keyboard (GAPS V8 (5)): the
        // layout, from a US keyboard's keys by their place.
        function test_layout() {
            access.layout = "qwertz";
            keyClick(Qt.Key_Y);
            keyClick(Qt.Key_Z);
            keyClick(Qt.Key_Semicolon);
            keyClick(Qt.Key_At, Qt.ShiftModifier);      // Shift+2
            compare(field.text, "zyö\"");
            field.text = "";
            access.layout = "azerty";
            keyClick(Qt.Key_Q);
            keyClick(Qt.Key_W);
            keyClick(Qt.Key_2);
            keyClick(Qt.Key_Semicolon);
            keyClick(Qt.Key_A, Qt.ShiftModifier);
            compare(field.text, "azémQ");
            // Shortcuts keep their keys' letters (Ctrl+A on its place).
            field.text = "select me";
            keyClick(Qt.Key_A, Qt.ControlModifier);
            compare(field.selectedText, "select me");
            access.layout = "auto";
            field.text = "";
            keyClick(Qt.Key_Y);
            compare(field.text, "y");
        }

        // The modifier keys remapped (as macOS's Modifier Keys), and the
        // TouchPad keyboard's keyboard key (here Caps Lock remapped to it).
        function test_keyRemap() {
            access.keyRemap = { capslock: "control" };
            field.text = "select me";
            keyPress(Qt.Key_CapsLock);
            keyClick(Qt.Key_A);
            keyRelease(Qt.Key_CapsLock);
            compare(field.selectedText, "select me", "Caps Lock as Ctrl: Ctrl+A");
            field.text = "";
            keyClick(Qt.Key_B);
            compare(field.text, "b", "let go: no Ctrl");
            // Ctrl made Meta: Ctrl+A no longer selects all.
            access.keyRemap = { control: "meta" };
            field.text = "abc";
            field.cursorPosition = 3;
            var spy = signalSpy.createObject(root, { target: access, signalName: "keyboardKeyPressed" });
            keyClick(Qt.Key_A, Qt.ControlModifier);
            compare(field.selectedText, "");
            // Caps Lock as the keyboard key: the signal, nothing typed.
            access.keyRemap = { capslock: "keyboard" };
            keyClick(Qt.Key_CapsLock);
            compare(spy.count, 1);
            // "none": the key does nothing.
            access.keyRemap = { alt: "none" };
            keyClick(Qt.Key_Alt);
            access.keyRemap = ({});
            spy.destroy();
        }
    }

    Component {
        id: signalSpy
        SignalSpy {}
    }
}
