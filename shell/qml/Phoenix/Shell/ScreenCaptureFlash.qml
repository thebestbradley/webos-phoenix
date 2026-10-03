// Copyright (c) 2026 webOS Phoenix contributors
// Copyright (c) 2010-2013 Hewlett-Packard Development Company, L.P. (the original)
// SPDX-License-Identifier: Apache-2.0
//
// The flash after a screen capture: luna-sysmgr's
// WSOverlayScreenShotAnimation (Src/base/visual/). The screen dims to
// #000000 at 0x88 under a radial glow from its centre, white to pale
// yellow, gone at half the shorter side; it all fades out over 900 ms.

import QtQuick

Item {
    id: flash
    objectName: "screenCaptureFlash"
    visible: opacity > 0
    opacity: 0
    enabled: false                       // never takes a touch

    function start() {
        fade.stop();
        opacity = 1;
        fade.start();
    }

    NumberAnimation {
        id: fade
        target: flash
        property: "opacity"
        from: 1
        to: 0
        duration: Theme.motion(900)
    }

    Rectangle {
        anchors.fill: parent
        color: Qt.rgba(0, 0, 0, 0x88 / 255)
    }
    Canvas {
        id: glow
        anchors.fill: parent
        onWidthChanged: requestPaint()
        onHeightChanged: requestPaint()
        onPaint: {
            var c = getContext("2d");
            c.reset();
            var r = Math.min(width, height) / 2;
            var g = c.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, r);
            g.addColorStop(0, "rgba(255,255,255,1)");
            g.addColorStop(0.15, "rgba(255,255,255," + (0xC0 / 255) + ")");
            g.addColorStop(0.5, "rgba(255,255,208," + (0xF0 / 255) + ")");
            g.addColorStop(0.75, "rgba(255,255,208," + (0x0F / 255) + ")");
            g.addColorStop(1, "rgba(255,255,208,0)");
            c.fillStyle = g;
            c.fillRect(0, 0, width, height);
        }
    }
}
