// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// SystemKeys (shell/native/systemkeys.cpp) takes its keys with any
// modifiers, but for the combinations given as passChords: those go on to
// the program's own shortcuts. phoenix-sim's Shift+F3 (Hold Power Button)
// pressed Power, and Shift+F2 (Assistant Follow-ups Now) showed the demo
// notification of F2.

import QtQuick
import QtTest
import Phoenix.Native

Item {
    id: root
    width: 200
    height: 200

    SystemKeys {
        id: keys
        keys: [Qt.Key_F2, Qt.Key_F3]
        passChords: [{ key: Qt.Key_F3, modifiers: Qt.ShiftModifier }]
    }
    SignalSpy { id: pressed; target: keys; signalName: "pressed" }
    SignalSpy { id: released; target: keys; signalName: "released" }
    Shortcut {
        id: holdPower
        property int fired: 0
        sequences: ["Shift+F3"]
        context: Qt.ApplicationShortcut
        onActivated: ++fired
    }

    TestCase {
        name: "SystemKeys"
        when: windowShown

        function init() { pressed.clear(); released.clear(); holdPower.fired = 0; }

        function test_passChordsGoToTheShortcuts() {
            keyClick(Qt.Key_F3, Qt.ShiftModifier);
            compare(pressed.count, 0, "Shift+F3 is not Power");
            compare(holdPower.fired, 1, "it reaches its shortcut");
            keyClick(Qt.Key_F3);
            compare(pressed.count, 1, "F3 alone is Power");
            compare(pressed.signalArguments[0][0], Qt.Key_F3);
        }

        // Shift let go before F3: F3's release, without Shift, is not
        // Power let go (it turned the screen off after the power menu).
        function test_aPassedKeysReleaseIsNotTaken() {
            keyPress(Qt.Key_Shift);
            keyPress(Qt.Key_F3, Qt.ShiftModifier);
            keyRelease(Qt.Key_Shift);
            keyRelease(Qt.Key_F3);
            compare(holdPower.fired, 1);
            compare(pressed.count, 0);
            compare(released.count, 0);
            keyClick(Qt.Key_F3);
            compare(pressed.count, 1);
            compare(released.count, 1);
        }

        function test_otherModifiersStillTaken() {
            // Not given: still the key, as before (Power whatever is held).
            keyClick(Qt.Key_F2, Qt.ShiftModifier);
            compare(pressed.count, 1);
            compare(holdPower.fired, 0);
        }
    }
}
