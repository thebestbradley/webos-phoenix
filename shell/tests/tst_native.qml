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
}
