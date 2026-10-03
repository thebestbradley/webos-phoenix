// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// "Sorry, Too Many Cards": the popup alert LunaSysMgr raised when there was
// no memory left to launch another app (WindowServerLuna::
// createMemoryAlertWindow, uiComponents/MemoryAlert/alert.qml; 320 x 160 in
// the popup alert's place). The title 18 px bold, the message 14 px bold,
// white, 6 px margins, an OK button 52 px tall.

import QtQuick

Item {
    id: dialog
    objectName: "memoryAlert"

    readonly property int margin: Theme.px(6)
    readonly property int topOffset: Theme.px(4)
    signal okButtonPressed

    Text {
        id: titleText
        objectName: "memoryAlertTitle"
        width: dialog.width - 2 * dialog.margin
        x: dialog.margin
        y: dialog.margin + dialog.topOffset
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(18)
        font.bold: true
        wrapMode: Text.Wrap
        color: "#FFFFFF"
        text: qsTr("Sorry, Too Many Cards")
    }

    Text {
        id: msgText
        width: dialog.width - 2 * dialog.margin
        x: dialog.margin
        y: titleText.y + titleText.height + dialog.margin
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(14)
        font.bold: true
        wrapMode: Text.Wrap
        color: "#FFFFFF"
        text: qsTr("Please toss away any you're not using to make room for more.")
    }

    ActionButton {
        objectName: "memoryAlertOk"
        caption: qsTr("OK")
        width: dialog.width - 2 * dialog.margin - 1
        height: Theme.px(52)
        x: dialog.margin + 1
        y: msgText.y + msgText.height + dialog.margin
        onAction: dialog.okButtonPressed()
    }
}
