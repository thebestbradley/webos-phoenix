// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// On-screen stand-in for the Pre's capacitive gesture area below the screen
// (Src/base/CoreNaviManager.cpp):
//   swipe up        -> card view (or launcher when already in card view)
//   swipe down      -> the active card, maximized, from card view
//   swipe left      -> back
//   swipe right     -> forward (Key_CoreNavi_Menu): closes the dashboard
//                      and menus; a site goes forward
//   long swipe      -> with advanced gestures on (Screen & Lock), a swipe
//                      across the area's centre over half its width is
//                      Key_CoreNavi_Previous (leftward) / Next (rightward):
//                      the app beside this one. Off, it is Back / forward,
//                      as the gesture driver reported it (setAdvancedGestures)
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
    // Advanced gestures: leftward (Key_CoreNavi_Previous) and rightward
    // (Key_CoreNavi_Next) long swipes.
    signal previous
    signal next
    signal tapped
    // Cursor control: -1 left, 1 right, a character at a time.
    signal cursorStep(int direction)

    // Settings > Screen & Lock > Advanced gestures
    // (sysUiEnableNextPrevGestures).
    property bool advancedGestures: false

    // The keyboard is up: a hold moves the cursor.
    property bool cursorControl: false
    readonly property bool cursorActive: mouse.cursor
    readonly property int holdDelay: 400
    readonly property real cursorStepWidth: Theme.px(10)

    // A short swipe; the legacy thresholds were tuned for a 320px wide area.
    readonly property real threshold: Theme.px(30)

    // The light bar is on while an app is maximized (and the screen
    // unlocked), off in card view (CoreNaviManager::restoreLightbar).
    property bool lit: false

    // A tap or the cursor hold: the bar brightens and fades.
    property real glow: 0
    NumberAnimation on glow { id: glowFade; to: 0; duration: 600; running: false }
    function flash() { glow = 1; glowFade.restart(); }

    // Each gesture's own light (CoreNaviManager::renderGestureOnLightbar):
    // the launcher's swipe up a "waterdrop" from the centre outwards, a
    // swipe down the reverse; Back / Previous runs to the left, forward /
    // Next to the right. Over a lit bar it runs dark, as the LEDs went out
    // and back on (ledLightbarFullSwipe).
    readonly property string lastLight: _lastLight
    property string _lastLight: ""
    function light(kind) {
        _lastLight = kind;
        lightAnim.stop();
        sweep.color = lit ? Qt.rgba(0, 0, 0, 0.75) : "#FFFFFF";
        var w = bar.width;
        if (kind === "waterdrop" || kind === "reverse") {
            var out = kind === "waterdrop";
            spreadFrom.value = out ? 0 : w;
            spreadTo.value = out ? w : 0;
            runFrom.value = runTo.value = 0;
            spreadAnim.duration = Theme.motion(400);
        } else {
            var left = kind === "left";
            spreadFrom.value = spreadTo.value = w * 0.35;
            runFrom.value = left ? w : -w * 0.35;
            runTo.value = left ? -w * 0.35 : w;
            spreadAnim.duration = Theme.motion(500);
        }
        lightAnim.start();
    }

    Rectangle {
        anchors.fill: parent
        color: Theme.black
    }

    Rectangle {
        id: bar
        objectName: "lightBar"
        anchors.centerIn: parent
        width: parent.width * 0.3
        height: Math.max(2, Theme.px(3))
        radius: height / 2
        color: Qt.rgba(1, 1, 1, area.lit ? 1 : 0.25 + 0.75 * area.glow)
        Behavior on color { ColorAnimation { duration: Theme.motion(300) } }
        clip: true

        Rectangle {
            id: sweep
            objectName: "lightSweep"
            property real spread: 0
            property real run: 0
            height: parent.height
            radius: height / 2
            width: spread
            // A drop spreads from the centre; a run moves along the bar.
            x: spreadTo.value === spreadFrom.value ? run : (parent.width - spread) / 2
            opacity: 0
        }
        SequentialAnimation {
            id: lightAnim
            PropertyAction { target: sweep; property: "opacity"; value: 1 }
            ParallelAnimation {
                NumberAnimation { id: spreadAnim; target: sweep; property: "spread"; from: spreadFrom.value; to: spreadTo.value; easing.type: Easing.OutQuad }
                NumberAnimation { target: sweep; property: "run"; from: runFrom.value; to: runTo.value; duration: spreadAnim.duration; easing.type: Easing.InOutQuad }
            }
            NumberAnimation { target: sweep; property: "opacity"; to: 0; duration: Theme.motion(300) }
        }
        QtObject { id: spreadFrom; property real value: 0 }
        QtObject { id: spreadTo; property real value: 0 }
        QtObject { id: runFrom; property real value: 0 }
        QtObject { id: runTo; property real value: 0 }
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
                area.light("waterdrop"); area.up();
            } else if (dy > area.threshold && dy > Math.abs(dx)) {
                area.light("reverse"); area.down();
            } else if (Math.abs(dx) > area.threshold && area.advancedGestures && Math.abs(dx) >= area.width / 2
                       && (sx - area.width / 2) * (m.x - area.width / 2) < 0) {
                area.light(dx < 0 ? "left" : "right");
                if (dx < 0) area.previous(); else area.next();
            } else if (dx < -area.threshold) {
                area.light("left"); area.back();
            } else if (dx > area.threshold) {
                area.light("right"); area.forward();
            } else if (Math.abs(dx) < area.threshold / 2 && Math.abs(dy) < area.threshold / 2) {
                area.flash(); area.tapped();
            }
        }
    }
}
