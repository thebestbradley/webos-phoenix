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
//                      across the area's centre over half a phone's width
//                      (longSwipe) is Key_CoreNavi_Previous (leftward) /
//                      Next (rightward): the app beside this one. Off, it is
//                      Back / forward, as the gesture driver reported it
//                      (setAdvancedGestures)
//   tap             -> toggle between the app and card view
//   hold and slide  -> with the keyboard up, moves the cursor a character
//                      per step (Phoenix, GAPS V4); slid up or down instead,
//                      it is the swipe after all
//   slide up from a side -> with the wave launcher on (Settings > Advanced;
//                      LunaCE's sysUiEnableWaveLauncher), a finger slid up
//                      from the area's left or right quarter raises the
//                      wave (waveStarted / waveMoved / waveEnded, in this
//                      item's coordinates); the shell decides on the release
//   hold            -> the meta key (Key_CoreNavi_Meta, MetaKeyManager): a
//                      finger resting on the area is a modifier; with it
//                      down, C, X, V and A typed are Copy, Cut, Paste and
//                      Select All (metaHeld). Held a moment the bar glows
//                      until it lifts (CoreNaviManager setMetaGlow)
//   two-finger swipe -> on a trackpad, with the pointer on the area: the
//                      same swipes, the way the fingers went (Phoenix; see
//                      trackpadSwipe)
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
    // The wave launcher (WaveLauncher.qml): the finger went up from a side,
    // then moved, then let go.
    signal waveStarted(real x, real y)
    signal waveMoved(real x, real y)
    signal waveEnded(real x, real y)
    signal waveCanceled
    property bool waveLauncher: false
    readonly property bool waveActive: mouse.wave
    // The share of the area's width at each end a wave starts from.
    readonly property real waveSide: 0.25

    // Settings > Screen & Lock > Advanced gestures
    // (sysUiEnableNextPrevGestures).
    property bool advancedGestures: false

    // The keyboard is up: a hold moves the cursor.
    property bool cursorControl: false
    readonly property bool cursorActive: mouse.cursor
    // A finger is on the area and has not swiped: the meta key is down.
    readonly property bool metaHeld: mouse.pressed && !mouse.swiped
    readonly property int holdDelay: 400
    readonly property real cursorStepWidth: Theme.px(10)

    // A short swipe; the legacy thresholds were tuned for a 320px wide area.
    // Settings > Advanced > Gesture sensitivity scales it (Theme.gestureScale).
    readonly property real threshold: Theme.px(30 * Theme.gestureScale)
    // A long swipe (advanced gestures): half the Pre's 320px wide area, the
    // whole of a phone's half. A tablet's bar is three times as wide; half
    // of it (512px) is more than a mouse or trackpad drag goes in one
    // stroke, and more than a thumb crosses, so the Pre's length holds there.
    readonly property real longSwipe: Math.min(width / 2, Theme.px(160 * Theme.gestureScale))

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
        property bool wave: false
        property bool swiped: false
        property bool glowing: false
        property real anchorX
        onPressed: (m) => {
            sx = m.x; sy = m.y;
            cursor = false;
            wave = false;
            swiped = false;
            hold.restart();
        }
        onPositionChanged: (m) => {
            if (wave) {
                area.waveMoved(m.x, m.y);
                return;
            }
            // Up from a side: the wave launcher.
            if (!cursor && area.waveLauncher && (sx < area.width * area.waveSide || sx > area.width * (1 - area.waveSide))
                    && sy - m.y > area.threshold && sy - m.y > Math.abs(m.x - sx)) {
                hold.stop();
                if (glowing) { glowing = false; glowFade.restart(); }
                swiped = true;
                wave = true;
                area.light("waterdrop");
                area.waveStarted(m.x, m.y);
                return;
            }
            // Held still a moment (cursor control) and then slid up or
            // down: a swipe after all, not the cursor. A mouse or trackpad
            // drag often rests a moment after the press before it moves.
            if (cursor && Math.abs(m.y - sy) > area.threshold && Math.abs(m.y - sy) > Math.abs(m.x - sx)) {
                cursor = false;
                swiped = true;
                return;
            }
            if (cursor) {
                var n = Math.trunc((m.x - anchorX) / area.cursorStepWidth);
                for (var i = 0; i < Math.abs(n); ++i)
                    area.cursorStep(n < 0 ? -1 : 1);
                anchorX += n * area.cursorStepWidth;
            } else if (Math.abs(m.x - sx) + Math.abs(m.y - sy) > area.threshold / 2) {
                hold.stop();      // a swipe
                swiped = true;
                if (glowing) { glowing = false; glowFade.restart(); }
            }
        }
        onCanceled: {
            hold.stop();
            cursor = false;
            swiped = false;
            if (wave) {
                wave = false;
                area.waveCanceled();
            }
            if (glowing) { glowing = false; glowFade.restart(); }
        }
        Timer {
            id: hold
            interval: area.holdDelay
            onTriggered: {
                if (area.cursorControl) {
                    mouse.cursor = true;
                    mouse.anchorX = mouse.mouseX;
                    area.flash();
                } else {
                    // The meta glow, steady while the finger stays.
                    glowFade.stop();
                    area.glow = 1;
                    mouse.glowing = true;
                }
            }
        }
        onReleased: (m) => {
            hold.stop();
            if (wave) {
                wave = false;
                area.waveEnded(m.x, m.y);
                return;
            }
            if (glowing) {
                glowing = false;
                glowFade.restart();
                return;       // a hold, not a tap
            }
            if (cursor) {
                cursor = false;
                return;
            }
            if (!area._swipe(sx, sy, m.x, m.y)
                    && Math.abs(m.x - sx) < area.threshold / 2 && Math.abs(m.y - sy) < area.threshold / 2) {
                area.flash(); area.tapped();
            }
        }

        // Trackpad (Phoenix): a two-finger swipe with the pointer on the
        // area. A mouse wheel's notches (no pixel delta) are not gestures.
        onWheel: (e) => {
            if (pressed || (e.pixelDelta.x === 0 && e.pixelDelta.y === 0 && e.phase === Qt.NoScrollPhase)) {
                e.accepted = false;
                return;
            }
            if (e.phase === Qt.ScrollBegin)
                area._pad = null;
            // The fingers lifted: the swipe is done; the momentum the
            // system sends after it is not part of it.
            if (e.phase === Qt.ScrollEnd || e.phase === Qt.ScrollMomentum) {
                area.trackpadEnd();
                return;
            }
            // The content follows the fingers with natural scrolling
            // (inverted); otherwise it goes the other way.
            var s = e.inverted ? 1 : -1;
            area.trackpadSwipe(e.x, s * e.pixelDelta.x, s * e.pixelDelta.y);
        }
    }

    // A swipe from (x0, y0) to (x1, y1) in this item: emits its gesture and
    // returns true, or false when it went too short a way to be one.
    // centred: a trackpad's swipe, which has no place on the area; a long
    // one need not cross the centre.
    function _swipe(x0, y0, x1, y1, centred) {
        var dx = x1 - x0, dy = y1 - y0;
        if (-dy > threshold && -dy > Math.abs(dx)) {
            light("waterdrop"); up();
        } else if (dy > threshold && dy > Math.abs(dx)) {
            light("reverse"); down();
        } else if (Math.abs(dx) > threshold && advancedGestures && Math.abs(dx) >= longSwipe
                   && (centred || (x0 - width / 2) * (x1 - width / 2) < 0)) {
            light(dx < 0 ? "left" : "right");
            if (dx < 0) previous(); else next();
        } else if (dx < -threshold) {
            light("left"); back();
        } else if (dx > threshold) {
            light("right"); forward();
        } else {
            return false;
        }
        return true;
    }

    // One step of a two-finger trackpad swipe at x, the fingers moving by
    // (dx, dy). It ends when they lift (trackpadEnd: the scroll's end phase,
    // or its events stop for Theme.wheelGestureEndDelay, as in card view).
    property var _pad: null
    function trackpadSwipe(x, dx, dy) {
        if (!_pad)
            _pad = { x: x, dx: 0, dy: 0 };
        _pad.dx += dx;
        _pad.dy += dy;
        padEnd.restart();
    }
    function trackpadEnd() {
        padEnd.stop();
        var p = _pad;
        _pad = null;
        if (p)
            _swipe(p.x, height / 2, p.x + p.dx, height / 2 + p.dy, true);
    }
    Timer {
        id: padEnd
        interval: Theme.wheelGestureEndDelay
        onTriggered: area.trackpadEnd()
    }
}
