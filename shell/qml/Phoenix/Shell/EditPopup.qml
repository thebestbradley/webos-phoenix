// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The edit popup: Select All, Cut, Copy, Paste over a selection or a
// text field, on a long press (touch: Chromium's own, which selects the
// word; mouse: press and hold, or a right click). The original's was drawn
// by webOS's WebKit layer, which was not released; this one uses the
// system's popup art (popup-bg.png, as the PIN pad and alerts) and sits
// above the selection, or below it when there is no room.
//
// Open it with open(rect, actions); it emits triggered(action) with
// "selectAll", "cut", "copy" or "paste" and closes.

import QtQuick

Item {
    id: popup

    // The rectangle to point at (the selection or the field), in the
    // parent's coordinates.
    property rect target: Qt.rect(0, 0, 0, 0)
    // The commands to offer, in the webOS order.
    property var actions: []
    readonly property bool shown: visible

    signal triggered(string action)

    readonly property var _labels: ({ selectAll: qsTr("Select All"), cut: qsTr("Cut"), copy: qsTr("Copy"), paste: qsTr("Paste") })
    readonly property real _gap: 8 * Theme.u
    readonly property real _arrow: 7 * Theme.u
    // Room above the target for the bubble and its arrow?
    readonly property bool _below: target.y - bubble.height - _arrow - _gap < 0

    visible: false
    z: 1000

    function open(rect, list) {
        var order = ["selectAll", "cut", "copy", "paste"];
        actions = order.filter(function (a) { return list.indexOf(a) >= 0; });
        if (!actions.length) {
            close();
            return;
        }
        target = rect;
        visible = true;
    }

    function close() {
        visible = false;
    }

    // A tap anywhere else closes it, as an Enyo popup's scrim does.
    MouseArea {
        objectName: "editPopupScrim"
        parent: popup.parent
        anchors.fill: parent
        z: popup.z - 1
        enabled: popup.visible
        visible: popup.visible
        onPressed: popup.close()
    }

    ArtBorderImage {
        id: bubble
        objectName: "editPopup"
        readonly property real pad: Theme.artBorder(10, source) // the art's shadow
        width: row.width + 2 * pad
        height: 44 * Theme.u + 2 * pad
        x: Math.max(0, Math.min(popup.parent.width - width, popup.target.x + popup.target.width / 2 - width / 2))
        y: popup._below
            ? Math.min(popup.parent.height - height, popup.target.y + popup.target.height + popup._arrow + popup._gap - pad)
            : popup.target.y - height - popup._arrow - popup._gap + pad
        source: Theme.asset("popup-bg.png")
        border { left: Theme.artBorder(19, source); top: Theme.artBorder(19, source); right: Theme.artBorder(19, source); bottom: Theme.artBorder(19, source) }

        // The arrow toward the selection, in the bubble's colour.
        Rectangle {
            width: popup._arrow * 2
            height: width
            rotation: 45
            color: "#3a3a3a"
            x: Math.max(bubble.pad + 12 * Theme.u,
                        Math.min(bubble.width - bubble.pad - 12 * Theme.u,
                                 popup.target.x + popup.target.width / 2 - bubble.x)) - width / 2
            y: popup._below ? bubble.pad - height / 2 : bubble.height - bubble.pad - height / 2
            z: -1
        }

        Row {
            id: row
            x: bubble.pad
            y: bubble.pad
            height: bubble.height - 2 * bubble.pad

            Repeater {
                model: popup.actions
                delegate: Item {
                    required property string modelData
                    required property int index
                    width: label.implicitWidth + 28 * Theme.u
                    height: row.height

                    // The divider between items (menu-divider.png's grey).
                    Rectangle {
                        visible: index > 0
                        width: Math.max(1, Theme.u)
                        height: parent.height - 16 * Theme.u
                        anchors.verticalCenter: parent.verticalCenter
                        color: "#5a5a5a"
                    }
                    Rectangle {
                        anchors.fill: parent
                        anchors.margins: 3 * Theme.u
                        radius: 6 * Theme.u
                        color: Theme.highlight
                        visible: area.pressed
                    }
                    Text {
                        id: label
                        anchors.centerIn: parent
                        text: popup._labels[modelData]
                        color: Theme.text
                        font.family: Theme.fontFamily
                        font.pixelSize: 16 * Theme.u
                    }
                    MouseArea {
                        id: area
                        objectName: "editPopup-" + modelData
                        anchors.fill: parent
                        onClicked: {
                            popup.close();
                            popup.triggered(modelData);
                        }
                    }
                }
            }
        }
    }
}
