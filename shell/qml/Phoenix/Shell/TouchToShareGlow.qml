// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Touch to Share's glow: while a phone is in range
// (com.palm.systemmanager/touchToShareDeviceInRange {inRange: true}), white
// rings pulse out from the middle of the bottom edge, where the phone is to
// touch (TouchToShareGlow.cpp; LunaSysMgr adds it to the UI elements group
// over everything, WindowServer.cpp:516). No art: LunaSysMgr painted it.
//  - a screen-sized rectangle centred on the bottom edge's middle
//    (:39-64, homeButtonOrientationAngle 0), filled with a radial gradient
//    of radius a quarter of the screen's height, its focus a quarter of
//    that above the centre, stops white at 0xAF, 0x1F, 0xFF, 0x1F, 0x01
//    alpha (:66-78);
//  - grown from 1 to 4 times while fading from 1 to 0, over 1000 ms,
//    reticleCurve (Linear), again and again (:99-127); hidden at once when
//    the phone goes (:129-134).
// Fill the screen with it (anchors.fill); it draws itself where it should.

import QtQuick

Item {
    id: glow
    objectName: "touchToShareGlow"

    // A phone is in range.
    property bool active: false
    readonly property bool running: pulse.running

    // TouchToShareGlow::m_boundingRect, centred on the bottom edge's middle.
    Item {
        id: rings
        objectName: "touchToShareGlowRings"
        width: glow.width
        height: glow.height
        x: 0
        y: glow.height / 2
        visible: glow.active
        transformOrigin: Item.Center

        readonly property real r: height / 4

        // QRadialGradient(0, 0, r, 0, -r/4): centre, radius, focus; the
        // canvas's form of it starts at the focus.
        Canvas {
            anchors.fill: parent
            onWidthChanged: requestPaint()
            onHeightChanged: requestPaint()
            onPaint: {
                var ctx = getContext("2d");
                ctx.reset();
                var cx = width / 2, cy = height / 2, r = rings.r;
                if (r <= 0)
                    return;
                var g = ctx.createRadialGradient(cx, cy - r / 4, 0, cx, cy, r);
                g.addColorStop(0.0, Qt.rgba(1, 1, 1, 0xAF / 255));
                g.addColorStop(0.25, Qt.rgba(1, 1, 1, 0x1F / 255));
                g.addColorStop(0.5, Qt.rgba(1, 1, 1, 1));
                g.addColorStop(0.75, Qt.rgba(1, 1, 1, 0x1F / 255));
                g.addColorStop(1.0, Qt.rgba(1, 1, 1, 0x01 / 255));
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, width, height);
            }
        }
    }

    ParallelAnimation {
        id: pulse
        running: glow.active && glow.visible
        loops: Animation.Infinite
        NumberAnimation { target: rings; property: "opacity"; from: 1; to: 0; duration: Theme.touchToShareGlowDuration; easing.type: Easing.Linear }
        NumberAnimation { target: rings; property: "scale"; from: 1; to: 4; duration: Theme.touchToShareGlowDuration; easing.type: Easing.Linear }
        onRunningChanged: if (!running) { rings.opacity = 1; rings.scale = 1; }
    }
}
