// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A service's popup alert (com.webos.notification createAlert: a title, a
// message and one to three buttons), in the popup alert's place, as the
// simulator shows it (SimWindowSource's "alert"; on a device OSE's stock
// NotificationView shows them). It looks like the shell's other popup
// alerts, MemoryAlert and MsmEntryFailedAlert (LunaSysMgr's
// uiComponents/MsmEntryFailed/alert.qml): the title 18 px bold, the message
// 14 px bold, white, 6 px margins, then the buttons 52 px tall, stacked
// (luna-systemui's alerts stack theirs: app/SysUpdateAlerts). The first
// button is the affirmative one when there are two or more. The text is
// shown as plain text, never as markup. com.palm.update's critical system
// notices use it (docs/NOTICES.md).

import QtQuick

Item {
    id: dialog
    objectName: "serviceAlert"

    property string title: ""
    property string message: ""
    // [{label}], one to three.
    property var buttons: []
    signal buttonPressed(int index)
    // It is gone (a button, the Home button, or the service's closeAlert).
    signal closed()
    Component.onDestruction: dialog.closed()

    readonly property int margin: Theme.px(6)
    readonly property int topOffset: Theme.px(4)
    readonly property int buttonHeight: Theme.px(52)

    implicitHeight: column.y + column.height + dialog.margin

    Text {
        id: titleText
        objectName: "serviceAlertTitle"
        width: dialog.width - 2 * dialog.margin
        x: dialog.margin
        y: dialog.margin + dialog.topOffset
        visible: dialog.title !== ""
        height: visible ? implicitHeight : 0
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(18)
        font.bold: true
        wrapMode: Text.Wrap
        textFormat: Text.PlainText
        color: "#FFFFFF"
        text: dialog.title
    }

    Text {
        id: messageText
        objectName: "serviceAlertMessage"
        width: dialog.width - 2 * dialog.margin
        x: dialog.margin
        y: titleText.y + titleText.height + (titleText.visible ? dialog.margin : 0)
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(14)
        font.bold: true
        wrapMode: Text.Wrap
        textFormat: Text.PlainText
        color: "#FFFFFF"
        text: dialog.message
    }

    Column {
        id: column
        x: dialog.margin + 1
        y: messageText.y + messageText.height + dialog.margin
        width: dialog.width - 2 * dialog.margin - 1
        Repeater {
            model: dialog.buttons ? dialog.buttons.length : 0
            ActionButton {
                objectName: "serviceAlertButton" + index
                caption: String(dialog.buttons[index].label || "")
                affirmative: index === 0 && dialog.buttons.length > 1
                width: column.width
                height: dialog.buttonHeight
                onAction: dialog.buttonPressed(index)
            }
        }
    }
}
