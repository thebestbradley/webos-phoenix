// Copyright (c) 2026 webOS Phoenix contributors
// Copyright (c) 2008-2013 LG Electronics, Inc. (the original)
// SPDX-License-Identifier: Apache-2.0
//
// luna-sysmgr's uiComponents/MessageDialog (QtQuick 1) in Qt 6: the lock
// screen's dialog for the security policy (LockWindow's StateLastTryDialog
// and StateNewPinDialog, LockWindow.h:129-137; LockWindow.cpp:466-505,
// 1065-1120). On popup-bg.png (35 / 40 px borders), 320 px wide plus 11 px
// edges: an 18 px bold title and a 14 px bold message, white, left-aligned,
// then up to three ActionButtons 52 px tall, stacked. LockWindow drives it
// as the original did: setupDialog(title, message, numberOfButtons), then
// setButton1..3(caption, "affirmative" | "normal" | "disabled"); a
// disabled button is hidden and takes no room. (The original also had
// "negative", red art that was never released and that LockWindow never
// asked for.)

import QtQuick

Item {
    id: dialog
    objectName: "messageDialog"

    readonly property int edgeOffset: Theme.px(11)
    readonly property int margin: Theme.px(6)
    readonly property int topOffset: Theme.px(4)

    property string dialogTitle: ""
    property string dialogMessage: ""
    property int numberOfButtons: 3     // 0 to 3

    signal button1Pressed()
    signal button2Pressed()
    signal button3Pressed()

    function setupDialog(title, message, numButtons) {
        dialogTitle = title;
        dialogMessage = message;
        numberOfButtons = numButtons;
    }
    function setButton1(caption, type) { _setupButton(button1, caption, type); }
    function setButton2(caption, type) { _setupButton(button2, caption, type); }
    function setButton3(caption, type) { _setupButton(button3, caption, type); }
    function _setupButton(button, caption, type) {
        button.caption = caption;
        button.affirmative = type === "affirmative";
        button.enabledType = type !== "disabled";
    }

    width: Theme.px(320) + 2 * edgeOffset
    height: titleText.height + msgText.height
            + (numberOfButtons > 0 ? button1.height + button2.height + button3.height : edgeOffset)
            + 2 * edgeOffset + 4 * margin + topOffset

    ArtBorderImage {
        anchors.fill: parent
        source: Theme.asset("popup-bg.png")
        border { left: Theme.artBorder(35, source); top: Theme.artBorder(40, source); right: Theme.artBorder(35, source); bottom: Theme.artBorder(40, source) }
    }

    // Taps between the buttons stay on the dialog.
    MouseArea { anchors.fill: parent }

    Text {
        id: titleText
        objectName: "messageDialogTitle"
        width: dialog.width - 2 * (dialog.edgeOffset + dialog.margin)
        anchors.horizontalCenter: parent.horizontalCenter
        y: dialog.edgeOffset + dialog.margin + dialog.topOffset
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(18)
        font.bold: true
        wrapMode: Text.Wrap
        color: "#FFFFFF"
        text: dialog.dialogTitle
    }

    Text {
        id: msgText
        objectName: "messageDialogMessage"
        width: dialog.width - 2 * (dialog.edgeOffset + dialog.margin)
        anchors.horizontalCenter: parent.horizontalCenter
        y: titleText.y + titleText.height + dialog.margin
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(14)
        font.bold: true
        wrapMode: Text.Wrap
        color: "#FFFFFF"
        text: dialog.dialogMessage
    }

    component DialogButton: ActionButton {
        property bool enabledType: true
        width: dialog.width - 2 * (dialog.edgeOffset + dialog.margin) - 1
        x: dialog.edgeOffset + dialog.margin + 1
        property bool shown: true
        visible: shown
        height: shown ? Theme.px(52) : 0
    }

    DialogButton {
        id: button1
        objectName: "messageDialogButton1"
        y: msgText.y + msgText.height + dialog.margin
        shown: dialog.numberOfButtons > 0 && enabledType
        onAction: dialog.button1Pressed()
    }
    DialogButton {
        id: button2
        objectName: "messageDialogButton2"
        y: button1.y + button1.height
        shown: dialog.numberOfButtons > 1 && enabledType
        onAction: dialog.button2Pressed()
    }
    DialogButton {
        id: button3
        objectName: "messageDialogButton3"
        y: button2.y + button2.height
        shown: dialog.numberOfButtons > 2 && enabledType
        onAction: dialog.button3Pressed()
    }
}
