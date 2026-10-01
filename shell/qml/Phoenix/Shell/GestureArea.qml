// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// On-screen stand-in for the Pre's capacitive gesture area below the screen
// (Src/base/CoreNaviManager.cpp):
//   swipe up        -> card view (or launcher when already in card view)
//   swipe down      -> the active card, maximized, from card view
//   swipe left      -> back
//   tap             -> toggle between the app and card view
//   hold and slide  -> with the keyboard up, moves the cursor a character
//                      per step (Phoenix, GAPS V4); with it down the hold
//                      is left free
// A thin glowing bar hints where it is, like the Pre 2 / Pre 3 light bar.

import QtQuick

Item {
    id: area

    signal up
    signal down
    signal back
    signal forward
    signal tapped
    // Cursor control: -1 left, 1 right, a character at a time.
    signal cursorStep(int direction)

    // The keyboard is up: a hold moves the cursor.
    property bool cursorControl: false
    readonly property bool cursorActive: mouse.cursor
    readonly property int holdDelay: 400
    readonly property real cursorStepWidth: Theme.px(10)

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
        id: mouse
        objectName: "gestureMouse"
        anchors.fill: parent
        // Gestures often start in the gesture area and travel onto the screen.
        preventStealing: true
        property real sx
        property real sy
        property bool cursor: false
        property real anchorX
        onPressed: (m) => {
            sx = m.x; sy = m.y;
            cursor = false;
            if (area.cursorControl)
                hold.restart();
        }
        onPositionChanged: (m) => {
            if (cursor) {
                var n = Math.trunc((m.x - anchorX) / area.cursorStepWidth);
                for (var i = 0; i < Math.abs(n); ++i)
                    area.cursorStep(n < 0 ? -1 : 1);
                anchorX += n * area.cursorStepWidth;
            } else if (Math.abs(m.x - sx) + Math.abs(m.y - sy) > area.threshold / 2) {
                hold.stop();      // a swipe
            }
        }
        onCanceled: { hold.stop(); cursor = false; }
        Timer {
            id: hold
            interval: area.holdDelay
            onTriggered: {
                mouse.cursor = true;
                mouse.anchorX = mouse.mouseX;
                area.flash();
            }
        }
        onReleased: (m) => {
            hold.stop();
            if (cursor) {
                cursor = false;
                return;
            }
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
