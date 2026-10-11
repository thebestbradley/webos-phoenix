// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ember Glass's L1, the heavy glass, drawn by the shell for a surface of
// its own (the launcher; docs/SYSTEM-UI-2.md, "Glass in the shell"): the
// wallpaper blurred once and tone-mapped (WallpaperBlur.tonedUrl), placed
// as the wallpaper lies under this item on the screen, then the theme's L1
// tint and Ember's light on it (base.css .card::before, ::after: the
// --bg-light glow, then --glass). Before the picture is made: the theme's
// ground.

import QtQuick

Item {
    id: l1

    // The blurred, tone-mapped wallpaper, and the screen it covers.
    property url picture: ""
    property size screen: Qt.size(0, 0)
    // Where this item's top left lies on that screen.
    property point place: Qt.point(0, 0)

    clip: true

    Rectangle {
        anchors.fill: parent
        color: Theme.eg.colorBg
    }
    Image {
        objectName: "emberL1Picture"
        x: -l1.place.x
        y: -l1.place.y
        width: l1.screen.width
        height: l1.screen.height
        source: l1.picture
        visible: source != ""
        smooth: true
        cache: false
    }
    Rectangle {
        objectName: "emberL1Tint"
        anchors.fill: parent
        color: Theme.eg.glassL1Tint
    }
    // Ember's light on the glass: dark, the ember's glow rising from below
    // (radial-gradient(120% 55% at 50% 112%, rgb(255 90 30 / .13), 0 at
    // 60%)); light, white from the top left. As a vertical gradient over the
    // part it reaches.
    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: parent.height * 0.4
        visible: Theme.egTheme === "dark"
        gradient: Gradient {
            GradientStop { position: 0; color: Qt.rgba(1, 90 / 255, 30 / 255, 0) }
            GradientStop { position: 1; color: Qt.rgba(1, 90 / 255, 30 / 255, 0.10) }
        }
    }
    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        height: parent.height * 0.45
        visible: Theme.egTheme === "light"
        gradient: Gradient {
            GradientStop { position: 0; color: Qt.rgba(1, 1, 1, 0.6) }
            GradientStop { position: 1; color: Qt.rgba(1, 1, 1, 0) }
        }
    }
}
