// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Naming a launcher tab (docs/M6-PLAN.md F4; LunaCE's launcher in webOS CE
// 3.1.0, Screenshots/TabEdit-1.jpg): a dark panel near the top of the
// launcher with its heading ("New Tab", "Rename Tab") in small grey type
// over a black field outlined in blue, the name in it bold, white and
// centred, the keyboard up below. Enter keeps the name; a tap outside, Back
// or Esc leaves it as it was. A tab the user added also shows a trash can,
// which removes the tab (LunaCE: the first four tabs are protected).
//
// open(heading, text, canDelete); accepted(text), deleteRequested(),
// closed().

import QtQuick

Item {
    id: dialog
    objectName: "launcherNameDialog"

    property bool open: false
    property string heading: ""
    property bool canDelete: false
    readonly property alias text: field.text
    readonly property alias field: field

    signal accepted(string text)
    signal deleteRequested
    signal closed

    visible: open
    z: 50

    function show(title, value, deletable) {
        heading = title;
        canDelete = !!deletable;
        field.text = value || "";
        open = true;
        field.selectAll();
        field.forceActiveFocus();
    }
    function close() {
        if (!open)
            return;
        open = false;
        field.focus = false;
        closed();
    }
    function accept() {
        var t = field.text.trim();
        if (t === "")
            return;
        open = false;
        field.focus = false;
        accepted(t);
    }

    // A tap outside the panel leaves the name as it was.
    MouseArea {
        objectName: "launcherNameScrim"
        anchors.fill: parent
        onPressed: dialog.close()
    }

    Rectangle {
        id: panel
        objectName: "launcherNamePanel"
        width: Math.min(dialog.width - Theme.px(32), Theme.px(520))
        height: headingText.height + fieldBox.height + Theme.px(36)
        x: (dialog.width - width) / 2
        y: Theme.px(Theme.tablet ? 104 : 24)
        radius: Theme.px(10)
        color: "#E6141618"
        border.color: "#6E737A"
        border.width: Math.max(1, Theme.px(1))
        MouseArea { anchors.fill: parent }   // taps on the panel stay here

        Text {
            id: headingText
            objectName: "launcherNameHeading"
            anchors.horizontalCenter: parent.horizontalCenter
            y: Theme.px(10)
            text: dialog.heading
            color: "#C8C8C8"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(17)
        }

        // The trash can, at the heading's right (a tab the user added).
        Item {
            id: trash
            objectName: "launcherNameDelete"
            visible: dialog.canDelete
            width: Theme.px(36)
            height: Theme.px(36)
            anchors.right: parent.right
            anchors.rightMargin: Theme.px(10)
            anchors.verticalCenter: headingText.verticalCenter
            opacity: trashMouse.pressed ? 0.6 : 1
            // Drawn: a lid with its handle, a can with three ribs.
            Rectangle { x: parent.width * 0.40; y: parent.height * 0.14; width: parent.width * 0.20; height: parent.height * 0.08; color: "#E8E8E8"; radius: height / 3 }
            Rectangle { x: parent.width * 0.20; y: parent.height * 0.22; width: parent.width * 0.60; height: parent.height * 0.09; color: "#E8E8E8"; radius: height / 3 }
            Rectangle {
                x: parent.width * 0.27; y: parent.height * 0.35; width: parent.width * 0.46; height: parent.height * 0.52
                color: "#E8E8E8"; radius: Theme.px(3)
                Row {
                    anchors.centerIn: parent
                    spacing: parent.width * 0.16
                    Repeater {
                        model: 3
                        Rectangle { width: Math.max(1, trash.width * 0.05); height: trash.height * 0.36; color: "#141618"; radius: width / 2 }
                    }
                }
            }
            MouseArea {
                id: trashMouse
                anchors.fill: parent
                anchors.margins: -Theme.px(6)
                onClicked: {
                    dialog.open = false;
                    field.focus = false;
                    dialog.deleteRequested();
                }
            }
        }

        Rectangle {
            id: fieldBox
            x: Theme.px(18)
            y: headingText.y + headingText.height + Theme.px(10)
            width: panel.width - 2 * x
            height: Theme.px(Theme.tablet ? 70 : 48)
            radius: Theme.px(6)
            color: "#000000"
            border.color: "#7FA6E8"
            border.width: Theme.px(2)
            TextInput {
                id: field
                objectName: "launcherNameField"
                anchors.fill: parent
                anchors.leftMargin: Theme.px(10)
                anchors.rightMargin: Theme.px(10)
                verticalAlignment: TextInput.AlignVCenter
                horizontalAlignment: TextInput.AlignHCenter
                color: "#FFFFFF"
                selectionColor: "#2C8CE0"
                font.family: Theme.fontFamily
                font.pixelSize: Theme.px(Theme.tablet ? 24 : 20)
                font.bold: true
                maximumLength: 24
                clip: true
                inputMethodHints: Qt.ImhNoPredictiveText
                Keys.onReturnPressed: dialog.accept()
                Keys.onEnterPressed: dialog.accept()
                Keys.onEscapePressed: dialog.close()
            }
        }
    }
}
