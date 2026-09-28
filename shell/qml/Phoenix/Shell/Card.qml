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
    // The app is still loading: CardLoading covers it.
    readonly property bool loading: window !== null && window.ready === false
    // The app's launcher icon, for the loading card.
    property url icon: ""
    // Its bigger icon (appinfo.json "splashicon"), if any.
    property url largeIcon: ""
    // Cards that have lost focus are darkened (CardWindow.cpp:211-213).
    property bool dimmed: false

    // The orientation the app asked for (PalmSystem.setWindowOrientation):
    // "free", "up", "down", "left", "right", "landscape" or "portrait";
    // and how the UI is turned (UiRotation).
    property string appOrientation: "free"
    property string uiOrientation: "up"
    property bool uiPortrait: height > width
    // A card held in another orientation than the UI's is drawn turned by
    // this much, its window keeping the app's orientation and size
    // (CardWindow::refreshAdjustmentAngle, CardWindow.cpp:2586-2640; the
    // paint rotation, :1556-1700; View_Resize with width and height
    // swapped, :741-752).
    readonly property int adjustmentAngle: {
        if (appOrientation === "landscape")
            return uiPortrait ? 90 : 0;
        if (appOrientation === "portrait")
            return uiPortrait ? 0 : 90;
        var a = _angle(appOrientation), u = _angle(uiOrientation);
        if (a < 0 || u < 0)
            return 0;
        var d = a - u;
        if (d > 180)
            d -= 360;
        else if (d <= -180)
            d += 360;
        return d;
    }
    // How the app's window is turned: what the page is told
    // (PalmSystem.screenOrientation).
    readonly property string windowOrientation: {
        if (_angle(appOrientation) >= 0)
            return appOrientation;
        var u = Math.max(0, _angle(uiOrientation));
        var turned = (appOrientation === "landscape" && uiPortrait) || (appOrientation === "portrait" && !uiPortrait);
        return ["up", "left", "down", "right"][((u + (turned ? 90 : 0)) % 360) / 90];
    }
    function _angle(o) {
        switch (o) {
        case "up": return 0;
        case "left": return 90;
        case "down": return 180;
        case "right": return 270;
        }
        return -1;
    }

    // Lifted for reordering: translucent, no shadow (CardWindowManager.cpp:1888-1899).
    property bool reordering: false

    // When non-zero, layout changes (shuffles after a close or reorder)
    // animate over this many milliseconds; otherwise the card tracks its
    // layout directly, e.g. during drags.
    property int layoutAnimationDuration: 0

    x: centerX - width / 2
    y: centerY - height / 2 + flickOffset
    scale: cardScale
    transformOrigin: Item.Center

    Behavior on x {
        enabled: card.layoutAnimationDuration > 0
        NumberAnimation { duration: card.layoutAnimationDuration; easing.type: Easing.OutCubic }
    }
    Behavior on y {
        enabled: card.layoutAnimationDuration > 0
        NumberAnimation { duration: card.layoutAnimationDuration; easing.type: Easing.OutCubic }
    }
    Behavior on scale {
        enabled: card.layoutAnimationDuration > 0
        NumberAnimation { duration: card.layoutAnimationDuration; easing.type: Easing.OutCubic }
    }
    Behavior on rotation {
        enabled: card.layoutAnimationDuration > 0
        NumberAnimation { duration: card.layoutAnimationDuration; easing.type: Easing.OutCubic }
    }

    // Thrown off the top of the screen at full opacity (closeWindow).
    opacity: reordering ? 0.8 : 1

    // Drop shadow: images/card-shadow-tile.png as a 9-tile, 20px outside
    // the card and 5px lower (CardDropShadowEffect.cpp). Sizes are in window
    // coordinates, so the shadow scales with the card like the original.
    // BorderImage draws borders at source-pixel size; scale by Theme.u.
    BorderImage {
        id: shadow
        visible: card.rounded && !card.reordering
        width: (card.width + 2 * Theme.cardShadowOutset) / Theme.u
        height: (card.height + 2 * Theme.cardShadowOutset) / Theme.u
        x: -Theme.cardShadowOutset
        y: -Theme.cardShadowOutset + Theme.cardShadowOffsetY
        scale: Theme.u
        transformOrigin: Item.TopLeft
        source: Theme.asset("card-shadow-tile.png")
        border { left: Theme.artBorder(43, source); top: Theme.artBorder(43, source); right: Theme.artBorder(43, source); bottom: Theme.artBorder(43, source) }
        horizontalTileMode: BorderImage.Stretch
        verticalTileMode: BorderImage.Stretch
    }

    Item {
        id: contentHost
        anchors.fill: parent
        clip: true
        enabled: card.interactive

        // The app's window, turned when the app keeps another orientation
        // than the UI's.
        Item {
            id: appHost
            readonly property bool sideways: card.adjustmentAngle === 90 || card.adjustmentAngle === -90
            anchors.centerIn: parent
            width: sideways ? parent.height : parent.width
            height: sideways ? parent.width : parent.height
            rotation: card.adjustmentAngle

            // Over the app's window until it is ready.
            CardLoading {
                anchors.fill: parent
                z: 1
                active: card.loading
                icon: card.icon
                largeIcon: card.largeIcon
            }
        }

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
        window.parent = appHost;
        window.x = 0;
        window.y = 0;
        window.width = Qt.binding(function() { return appHost.width; });
        window.height = Qt.binding(function() { return appHost.height; });
        // Windows that want to know how they are turned (web app windows).
        if ("orientation" in window)
            window.orientation = Qt.binding(function() { return card.windowOrientation; });
        window.visible = true;
    }
}
