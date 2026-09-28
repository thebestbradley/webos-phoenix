// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The "Just type..." search pill above the cards (OverlayWindowManager_p.h
// SearchPill, OverlayWindowManager.cpp:1150-1177). Tapping it opens Just
// Type. It shows in card view and fades out (quickLaunchFadeDuration, curve
// 6 = OutCubic) while an app is maximized, the launcher is open or Just
// Type is showing (the search pill state machine, :494-561).

import QtQuick

Item {
    id: pill

    property bool shown: true

    signal tapped

    // 588 legacy px on the TouchPad (layoutsettings.cpp:91); a phone has
    // the screen width less a margin *(inferred: 2.x phones had no pill)*.
    width: Math.min(Theme.px(588), parent ? parent.width - Theme.px(20) : Theme.px(300))
    height: Theme.px(50)

    opacity: shown ? 1 : 0
    visible: opacity > 0
    enabled: shown
    Behavior on opacity { NumberAnimation { duration: Theme.searchPillFadeDuration; easing.type: Easing.OutCubic } }

    // Three-tiled background, 40 px caps (OverlayWindowManager.cpp:1152-1155).
    BorderImage {
        anchors.fill: parent
        source: Theme.asset("launcher3/search-field-bg-launcher.png")
        border { left: 40; right: 40; top: 0; bottom: 0 }
        horizontalTileMode: BorderImage.Stretch
    }

    // 18 px oblique quick launch font, white at 80%, 20 px in
    // (OverlayWindowManager_p.h:65-86).
    Text {
        anchors.left: parent.left
        anchors.leftMargin: Theme.px(20)
        anchors.right: icon.left
        anchors.rightMargin: Theme.px(10)
        anchors.verticalCenter: parent.verticalCenter
        anchors.verticalCenterOffset: -Theme.px(1)                 // searchPillInnerTextAdjust
        text: qsTr("Just type...")
        elide: Text.ElideRight
        color: "white"
        opacity: 0.8
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(18)
        font.italic: true
    }

    // Search icon, 15 px from the right (searchPillInnerIconRightOffset).
    Image {
        id: icon
        anchors.right: parent.right
        anchors.rightMargin: Theme.px(15)
        anchors.verticalCenter: parent.verticalCenter
        width: Theme.px(32)
        height: width
        source: Theme.asset("launcher3/search-button-launcher.png")
    }

    MouseArea {
        anchors.fill: parent
        onClicked: pill.tapped()
    }
}
