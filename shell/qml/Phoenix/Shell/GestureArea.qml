// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// On-screen stand-in for the Pre's capacitive gesture area below the screen
// (Src/base/CoreNaviManager.cpp):
//   swipe up        -> card view (or launcher when already in card view)
//   swipe down      -> the active card, maximized, from card view
//   swipe left      -> back
//   tap             -> toggle between the app and card view
// A thin glowing bar hints where it is, like the Pre 2 / Pre 3 light bar.

import QtQuick

Item {
    id: area

    signal up
    signal down
    signal back
    signal forward
    signal tapped

    // A short swipe; the legacy thresholds were tuned for a 320px wide area.
    readonly property real threshold: Theme.px(30)

    // Light bar feedback: brightens on each gesture.
    property real glow: 0
    NumberAnimation on glow { id: glowFade; to: 0; duration: 600; running: false }
    function flash() { glow = 1; glowFade.restart(); }

    Rectangle {
        anchors.fill: parent
        color: Theme.black
    }

    Rectangle {
        anchors.centerIn: parent
        width: parent.width * 0.3
        height: Math.max(2, Theme.px(3))
        radius: height / 2
        color: Qt.rgba(1, 1, 1, 0.25 + 0.75 * area.glow)
    }

    MouseArea {
        anchors.fill: parent
        // Gestures often start in the gesture area and travel onto the screen.
        preventStealing: true
        property real sx
        property real sy
        onPressed: (m) => { sx = m.x; sy = m.y; }
        onReleased: (m) => {
            var dx = m.x - sx, dy = m.y - sy;
            if (-dy > area.threshold && -dy > Math.abs(dx)) {
                area.flash(); area.up();
            } else if (dy > area.threshold && dy > Math.abs(dx)) {
                area.flash(); area.down();
            } else if (dx < -area.threshold) {
                area.flash(); area.back();
            } else if (dx > area.threshold) {
                area.flash(); area.forward();
            } else if (Math.abs(dx) < area.threshold / 2 && Math.abs(dy) < area.threshold / 2) {
                area.flash(); area.tapped();
            }
        }
    }
}
