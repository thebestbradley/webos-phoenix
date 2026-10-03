// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The edit popup over a selection or text field: Select All, Cut, Copy,
// Paste in the webOS order, above the target or below it when there is no
// room, closed by a choice or by a tap anywhere else; and the popup on the
// shell's own text field (Just Type's built-in search).
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell

Item {
    id: root
    width: 320
    height: 480

    EditPopup {
        id: popup
        anchors.fill: parent
        onTriggered: (action) => spy.last = action
    }

    JustType {
        id: jt
        anchors.fill: parent
        visible: open
        open: false
    }

    QtObject {
        id: spy
        property string last: ""
    }

    TestCase {
        name: "EditPopup"
        when: windowShown

        property var bubble: findChild(popup, "editPopup")

        // The item for an action among the row's current delegates (a
        // rebuilt Repeater's old ones linger until deleted).
        function row() {
            return bubble.children[bubble.children.length - 1];
        }

        // Opened and laid out (a Row places its items when polished).
        function show(rect, list) {
            popup.open(rect, list);
            waitForItemPolished(row());
        }

        function item(action) {
            var row = this.row();
            for (var i = 0; i < row.children.length; ++i) {
                var d = row.children[i];
                if (d.modelData === action)
                    return d.children[d.children.length - 1];
            }
            return null;
        }

        function init() {
            popup.close();
            spy.last = "";
        }

        function test_order() {
            popup.open(Qt.rect(100, 200, 60, 20), ["paste", "copy", "selectAll", "bogus"]);
            compare(popup.actions, ["selectAll", "copy", "paste"]);
            verify(popup.visible);
            waitForItemPolished(row());
            compare(item("copy").objectName, "editPopup-copy");
            verify(!item("cut"));
        }

        function test_nothingToOffer() {
            popup.open(Qt.rect(100, 200, 60, 20), []);
            verify(!popup.visible);
        }

        function test_aboveOrBelow() {
            show(Qt.rect(100, 200, 60, 20), ["copy"]);
            verify(bubble.y + bubble.height <= 200);
            show(Qt.rect(100, 4, 60, 20), ["copy"]);
            verify(bubble.y >= 24 - bubble.pad);
        }

        function test_staysOnScreen() {
            show(Qt.rect(300, 200, 20, 20), ["selectAll", "cut", "copy", "paste"]);
            verify(bubble.x >= 0);
            verify(bubble.x + bubble.width <= root.width);
        }

        function test_choose() {
            show(Qt.rect(100, 200, 60, 20), ["cut", "copy"]);
            mouseClick(item("cut"));
            compare(spy.last, "cut");
            verify(!popup.visible);
        }

        function test_tapOutside() {
            show(Qt.rect(100, 200, 60, 20), ["copy"]);
            mousePress(root, 10, 460);
            mouseRelease(root, 10, 460);
            verify(!popup.visible);
            compare(spy.last, "");
        }

        function test_justType() {
            jt.open = true;
            jt.query = "hello world";
            var field = findChild(jt, "justTypeHold").parent;
            var jp = findChild(jt, "justTypeEditPopup");
            waitForItemPolished(field);
            var at = field.positionToRectangle(8);
            mousePress(field, at.x, field.height / 2);
            tryVerify(function () { return jp.visible; }, 3000);
            mouseRelease(field, at.x, field.height / 2);
            compare(field.selectedText, "world");
            compare(jp.actions.slice(0, 3), ["selectAll", "cut", "copy"]);
            // Copy, then Paste at the end: the system clipboard.
            jp.triggered("copy");
            field.deselect();
            field.cursorPosition = field.text.length;
            jp.triggered("paste");
            compare(jt.query, "hello worldworld");
            jt.open = false;
            verify(!jp.visible);
        }
    }
}
