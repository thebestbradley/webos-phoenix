// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// "Clear", in the shade a notification uncovers as it is swiped away
// (Phoenix: the original showed the shade alone). It fades in with the
// swipe, and brightens once letting go would clear the notification
// (Theme.dashboardDismissRatio of the row's width). "Clear", not "Delete":
// the notification goes, what it is about (the email, the event) stays.

import QtQuick

Text {
    id: label
    objectName: "swipeClearLabel"

    // How far the row has moved, and its width; fromRight: it moved left,
    // uncovering the right end.
    property real distance: 0
    property real rowWidth: 1
    property bool fromRight: false
    readonly property bool armed: distance > rowWidth * Theme.dashboardDismissRatio

    visible: distance > 0
    anchors.verticalCenter: parent.verticalCenter
    readonly property real _inset: Math.max(Theme.px(12), (distance - width) / 2)
    x: fromRight ? rowWidth - _inset - width : _inset
    text: qsTr("Clear")
    color: armed ? Theme.text : Theme.textDim
    opacity: Math.min(1, distance / (rowWidth * Theme.dashboardDismissRatio))
    font.family: Theme.fontFamily
    font.pixelSize: Theme.px(15)
    font.bold: armed
}
