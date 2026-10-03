// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A card's corners, as the Palm devices drew them: luna-sysmgr's
// CardRoundedCornerShaderStage (USE_ROUNDEDCORNER_SHADER on every device
// build, device-known.pri), with the factors CardWindow's radius of 40
// selects (CardRoundedCornerShaderStage.h:64-127). Each corner is a quarter
// ellipse 0.5 - 0.491 of the card's width across and 0.5 - 0.478 of its
// height down (0.5 - 0.473 on a card wider than tall), so it follows the
// card's shape; its edge fades over the outer 30 % of the ellipse while the
// card is scaled down (card view) and 1 % at full size:
//     alpha = smoothstep(1, 1 - Delta, length(Coord)).
// Drawn as the mask OpacityMask applies to the card (Card.qml).

import QtQuick

Canvas {
    id: mask

    // The card at full size: the soft edge sharpens (Delta 0.01).
    property bool fullSize: false

    readonly property real horizontalFactor: 0.491
    readonly property real verticalFactor: width > height ? 0.473 : 0.478
    readonly property real cornerWidth: (0.5 - horizontalFactor) * width
    readonly property real cornerHeight: (0.5 - verticalFactor) * height
    readonly property real delta: fullSize ? 0.01 : 0.3

    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()
    onDeltaChanged: requestPaint()

    function smoothstep(e0, e1, x) {
        var t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
    }

    onPaint: {
        var ctx = getContext("2d");
        ctx.reset();
        var w = width, h = height, rx = cornerWidth, ry = cornerHeight;
        if (w <= 0 || h <= 0)
            return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        if (rx <= 0 || ry <= 0)
            return;
        // The corners: [ellipse centre, which way the corner lies].
        var corners = [[rx, ry, -1, -1], [w - rx, ry, 1, -1], [rx, h - ry, -1, 1], [w - rx, h - ry, 1, 1]];
        for (var i = 0; i < corners.length; ++i) {
            var c = corners[i];
            ctx.save();
            ctx.translate(c[0], c[1]);
            ctx.scale(rx, ry);
            // The corner box, in ellipse units: 0..1 toward the corner.
            var bx = c[2] < 0 ? -1 : 0, by = c[3] < 0 ? -1 : 0;
            ctx.clearRect(bx, by, 1, 1);
            var g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            for (var s = 0; s <= 16; ++s) {
                var r = 1 - delta + delta * s / 16;
                var a = smoothstep(1, 1 - delta, r);
                g.addColorStop(r, Qt.rgba(1, 1, 1, a));
            }
            g.addColorStop(0, "#ffffff");
            ctx.fillStyle = g;
            ctx.fillRect(bx, by, 1, 1);
            ctx.restore();
        }
    }
}
