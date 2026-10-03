// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// luna-sysmgr's uiComponents/ActionButton (QtQuick 1) in Qt 6: a button on
// the PIN pad's art (images/pin/button-black, -green; pressed states), 16 px
// bold caption. The unlock panel and the launcher's app dialog use it.

import QtQuick

Item {
    id: actionButton
    property bool isPressed: false
    property bool active: true
    property string caption: ""
    property color captionColor: "#FFFFFF"
    property bool affirmative: false
    readonly property real inactiveOpacity: 0.70
    signal action()

    ArtBorderImage {
        anchors.fill: parent
        source: Theme.asset(actionButton.affirmative
                            ? (actionButton.isPressed ? "pin/button-green-press.png" : "pin/button-green.png")
                            : (actionButton.isPressed ? "pin/button-black-press.png" : "pin/button-black.png"))
        border { left: Theme.artBorder(10, source); top: Theme.artBorder(10, source); right: Theme.artBorder(10, source); bottom: Theme.artBorder(10, source) }
        opacity: actionButton.active ? 1.0 : actionButton.inactiveOpacity
    }
    Text {
        anchors.centerIn: parent
        text: actionButton.caption
        color: actionButton.captionColor
        font.bold: true
        font.pixelSize: Theme.px(16)
        font.family: Theme.fontFamily
        opacity: actionButton.active ? 1.0 : actionButton.inactiveOpacity
    }
    MouseArea {
        anchors.fill: parent
        onPressed: if (actionButton.active) actionButton.isPressed = true
        onReleased: actionButton.isPressed = false
        onCanceled: actionButton.isPressed = false
        onClicked: if (actionButton.active) actionButton.action()
    }
}
