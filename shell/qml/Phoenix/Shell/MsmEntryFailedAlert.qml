// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// "USB Drive connection failed": the popup alert LunaSysMgr raised when the
// storage daemon could not put the device into USB drive mode
// (WindowServerLuna::slotBrickModeFailed / createMsmEntryFailedAlertWindow,
// WindowServerLuna.cpp:1357-1371; uiComponents/MsmEntryFailed/alert.qml;
// 320 x 160 in the popup alert's place). As MemoryAlert: the title 18 px
// bold, the message 14 px bold, white, 6 px margins, an OK button 52 px
// tall, here at the bottom.

import QtQuick

Item {
    id: dialog
    objectName: "msmEntryFailedAlert"

    readonly property int margin: Theme.px(6)
    readonly property int topOffset: Theme.px(4)
    signal okButtonPressed

    Text {
        id: titleText
        objectName: "msmEntryFailedTitle"
        width: dialog.width - 2 * dialog.margin
        x: dialog.margin
        y: dialog.margin + dialog.topOffset
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(18)
        font.bold: true
        wrapMode: Text.Wrap
        color: "#FFFFFF"
        text: qsTr("USB Drive connection failed")
    }

    Text {
        width: dialog.width - 2 * dialog.margin
        x: dialog.margin
        y: titleText.y + titleText.height + dialog.margin
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(14)
        font.bold: true
        wrapMode: Text.Wrap
        color: "#FFFFFF"
        text: qsTr("Please toss away all cards and try again.")
    }

    ActionButton {
        objectName: "msmEntryFailedOk"
        caption: qsTr("OK")
        width: dialog.width - 2 * dialog.margin - 1
        height: Theme.px(52)
        x: dialog.margin + 1
        anchors.bottom: dialog.bottom
        onAction: dialog.okButtonPressed()
    }
}
