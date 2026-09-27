// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One app card. The card is always laid out at full window size and scaled
// about its centre, exactly like LunaSysMgr's CardWindow, so the app surface
// never has to re-layout while it moves between card view and maximized.

import QtQuick
import Qt5Compat.GraphicalEffects

Item {
    id: card

    // Unique id of the window in the window source.
    property string uid
    property string title
    // The app surface (a compositor SurfaceItem or a simulator mock app).
    property Item window

    // Where the card's centre should be, in the card view's coordinates.
    property real centerX
    property real centerY
    // Scale relative to the full-size window (1.0 == maximized).
    property real cardScale: 1.0
    // True when the card is maximized and should get input.
    property bool interactive: false
    // Square corners when maximized, rounded in card view.
    property bool rounded: true
    // Vertical offset while the user is flicking the card away.
    property real flickOffset: 0
    // Cards that have lost focus are darkened (CardWindow.cpp:211-213).
    property bool dimmed: false

    // Animate x/y changes (used when cards shuffle after a close).
    property bool shuffleAnimation: false

    x: centerX - width / 2
    y: centerY - height / 2 + flickOffset
    scale: cardScale
    transformOrigin: Item.Center

    Behavior on x {
        enabled: card.shuffleAnimation
        NumberAnimation { duration: Theme.cardShuffleReorderDuration; easing.type: Theme.cardEasing }
    }

    // Fades out as it is thrown off the top of the screen.
    opacity: flickOffset < 0 ? Math.max(0, 1 + flickOffset / (height * 0.9)) : 1

    // Drop shadow: images/card-shadow-tile.png as a 9-tile, 20px outside
    // the card and 5px lower (CardDropShadowEffect.cpp). Sizes are in window
    // coordinates, so the shadow scales with the card like the original.
    // BorderImage draws borders at source-pixel size; scale by Theme.u.
    BorderImage {
        id: shadow
        visible: card.rounded
        width: (card.width + 2 * Theme.cardShadowOutset) / Theme.u
        height: (card.height + 2 * Theme.cardShadowOutset) / Theme.u
        x: -Theme.cardShadowOutset
        y: -Theme.cardShadowOutset + Theme.cardShadowOffsetY
        scale: Theme.u
        transformOrigin: Item.TopLeft
        source: Theme.asset("card-shadow-tile.png")
        border { left: 43; top: 43; right: 43; bottom: 43 }
        horizontalTileMode: BorderImage.Stretch
        verticalTileMode: BorderImage.Stretch
    }

    Item {
        id: contentHost
        anchors.fill: parent
        clip: true
        enabled: card.interactive

        layer.enabled: card.rounded && GraphicsInfo.api !== GraphicsInfo.Software
        layer.smooth: true
        layer.effect: OpacityMask {
            maskSource: cornerMask
        }
    }

    // Rounded-corner mask; rendered only as a texture for the effect above.
    Rectangle {
        id: cornerMask
        anchors.fill: parent
        visible: false
        layer.enabled: true
        // Fixed radius in window coordinates (CardWindow.cpp:2515-2529).
        radius: Theme.cardCornerRadius
    }

    Rectangle {
        anchors.fill: parent
        radius: card.rounded ? Theme.cardCornerRadius : 0
        color: "black"
        opacity: card.dimmed ? 1 - Theme.cardDimming : 0
        Behavior on opacity { NumberAnimation { duration: Theme.cardDimmingDuration; easing.type: Easing.OutCubic } }
    }

    onWindowChanged: attachWindow()
    Component.onCompleted: attachWindow()

    function attachWindow() {
        if (!window)
            return;
        window.parent = contentHost;
        window.x = 0;
        window.y = 0;
        window.width = Qt.binding(function() { return contentHost.width; });
        window.height = Qt.binding(function() { return contentHost.height; });
        window.visible = true;
    }
}
