// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phoenix.Native. Needs the build tree's compiled modules:
// Run: qmltestrunner -import qml -import ../build/qml -input tests

import QtQuick
import QtTest
import Phoenix.Native

Item {
    id: root
    width: 320
    height: 480

    Item {
        id: target
        property var pressed: []
        property int released: 0
        property bool accept: true
        Keys.onPressed: (e) => { pressed.push({ key: e.key, scan: e.nativeScanCode }); e.accepted = accept; }
        Keys.onReleased: released++
    }

    TestCase {
        name: "KeyInjector"
        when: windowShown

        function test_sendsPressAndReleaseWithScanCode() {
            target.pressed = [];
            target.released = 0;
            target.accept = true;
            // Key_webOS_Back exists only in webOS's qtbase; any key will do here.
            verify(KeyInjector.sendKey(target, Qt.Key_Back, 420));
            verify(target.activeFocus);
            compare(target.pressed.length, 1);
            compare(target.pressed[0].key, Qt.Key_Back);
            compare(target.pressed[0].scan, 420);
            compare(target.released, 1);
        }

        function test_reportsWhetherAccepted() {
            target.accept = false;
            verify(!KeyInjector.sendKey(target, Qt.Key_Back, 420));
            verify(!KeyInjector.sendKey(null, Qt.Key_Back, 420));
        }
    }

    TextInput {
        id: field
        y: 100
        width: 200
        height: 20
    }

    // The virtual keyboard's keystrokes (SysmgrIMEModel::sendKeyEvent).
    TestCase {
        name: "ImeKeys"
        when: windowShown

        function test_typesIntoTheFocusedField() {
            field.text = "";
            verify(KeyInjector.sendImeKey(field, Qt.Key_A, Qt.NoModifier));
            verify(field.activeFocus);
            compare(field.text, "a");
            // Shift: the upper case letter.
            KeyInjector.sendImeKey(field, Qt.Key_B, Qt.ShiftModifier);
            // Other characters come with their case (é, 0xe9).
            KeyInjector.sendImeKey(field, 0xe9, Qt.NoModifier);
            compare(field.text, "aBé");
            KeyInjector.sendImeKey(field, Qt.Key_Backspace, Qt.NoModifier);
            compare(field.text, "aB");
            KeyInjector.sendImeKey(field, Qt.Key_Left, Qt.NoModifier);
            KeyInjector.sendImeKey(field, Qt.Key_Period, Qt.NoModifier);
            compare(field.text, "a.B");
        }

        function test_commitsText() {
            field.text = "x";
            field.cursorPosition = 1;
            verify(KeyInjector.commitText(field, ".com"));
            compare(field.text, "x.com");
            verify(!KeyInjector.commitText(null, ".com"));
        }

        // The text around the cursor, as an input method asks the field
        // with the focus (ImSurroundingText, ImCursorPosition): the field
        // itself, or the one inside the client (a web view and its page).
        function test_surroundingText() {
            field.text = "Hello world";
            field.cursorPosition = 5;
            field.forceActiveFocus();
            var s = KeyInjector.surroundingText(field);
            compare(s.text, "Hello world");
            compare(s.cursor, 5);
            inner.text = "Dear Sir";
            inner.cursorPosition = 4;
            // Asking moves no focus: the view's field has none yet.
            compare(Object.keys(KeyInjector.surroundingText(view)).length, 0);
            verify(field.activeFocus);
            inner.forceActiveFocus();
            s = KeyInjector.surroundingText(view);
            compare(s.text, "Dear Sir");
            compare(s.cursor, 4);
            // Only the client's own: not a field elsewhere in the window.
            compare(Object.keys(KeyInjector.surroundingText(field)).length, 0);
            compare(Object.keys(KeyInjector.surroundingText(target)).length, 0);
            compare(Object.keys(KeyInjector.surroundingText(null)).length, 0);
        }
    }

    // A view with a field inside it, as a web view has its page's.
    FocusScope {
        id: view
        y: 140
        width: 200
        height: 20
        TextInput {
            id: inner
            anchors.fill: parent
            focus: true
        }
    }
}
