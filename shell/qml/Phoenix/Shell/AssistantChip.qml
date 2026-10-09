// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Something to ask, in the Assistant's view (AssistantOverlay.qml): a
// rounded chip with the words, lighter than the answers' buttons
// (ActionButton), for the examples on an empty conversation and the
// requests an answer suggests. A tap puts the words in the field.

import QtQuick
import Phoenix.Shell

Rectangle {
    id: chip
    property string text: ""
    // The widest it may be (the words are cut short beyond it).
    property real maxWidth: Theme.px(300)
    signal clicked()

    width: Math.min(maxWidth, label.implicitWidth + Theme.px(28))
    height: Theme.px(Theme.tablet ? 36 : 32)
    radius: height / 2
    color: area.pressed ? "#50FFFFFF" : "#26FFFFFF"
    border.color: "#60FFFFFF"
    border.width: Math.max(1, Theme.px(1))
    Text {
        id: label
        anchors.centerIn: parent
        width: Math.min(implicitWidth, chip.maxWidth - Theme.px(28))
        text: chip.text
        elide: Text.ElideRight
        color: "#FFFFFF"
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(Theme.tablet ? 16 : 14)
    }
    MouseArea {
        id: area
        anchors.fill: parent
        anchors.margins: -Theme.px(4)
        onClicked: chip.clicked()
    }
}
