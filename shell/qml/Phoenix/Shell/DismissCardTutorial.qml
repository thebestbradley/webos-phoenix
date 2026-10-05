// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// "Dismissing Cards": the tutorial LunaSysMgr raised the first time the user
// was in card view (CardWindowManager::firstCardAlert, CardWindowManager.cpp:
// 1167-1187 -> WindowServerLuna::createDismissCardWindow, WindowServerLuna.cpp:
// 1373-1387; uiComponents/DismissCardTutorial/dismissDialog.qml, 320 x 170
// in the popup alert's place). The title 18 px bold, the message 14 px bold,
// white, 6 px margins, an OK button 52 px tall at the bottom. The original
// has no pictures: the alert window's frame and the button are the art.

import QtQuick

Item {
    id: dialog
    objectName: "dismissCardTutorial"

    readonly property int margin: Theme.px(6)
    readonly property int topOffset: Theme.px(4)
    signal okButtonPressed

    Text {
        id: titleText
        objectName: "dismissCardTutorialTitle"
        width: dialog.width - 2 * dialog.margin
        x: dialog.margin
        y: dialog.margin + dialog.topOffset
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(18)
        font.bold: true
        wrapMode: Text.Wrap
        color: "#FFFFFF"
        text: qsTr("Dismissing Cards")
    }

    Text {
        id: msgText
        objectName: "dismissCardTutorialMessage"
        width: dialog.width - 2 * dialog.margin
        x: dialog.margin
        y: titleText.y + titleText.height + dialog.margin
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(14)
        font.bold: true
        wrapMode: Text.Wrap
        color: "#FFFFFF"
        text: qsTr("You can close an application by using your finger to flick it up and off screen while in Card View.")
    }

    // anchors.bottom: dialog.bottom (dismissDialog.qml).
    ActionButton {
        objectName: "dismissCardTutorialOk"
        caption: qsTr("OK")
        width: dialog.width - 2 * dialog.margin - 1
        height: Theme.px(52)
        x: dialog.margin + 1
        anchors.bottom: parent.bottom
        onAction: dialog.okButtonPressed()
    }
}
