// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Generic earbuds over their case, drawn here (Phoenix's own: plain shapes,
// no Apple artwork; docs/ACCESSORIES.md, "Art"), for the AirPods card
// (EarbudsAlert.qml). The same drawing as Settings' (apps/settings
// Earbuds.tsx EarbudsArt): two round heads on stems, mirrored, over a
// rounded case whose lid lifts when open. Over-ear headphones (AirPods
// Max) are a band and two cups.

import QtQuick

Canvas {
    id: art
    property bool lidOpen: true
    property string kind: ""
    // Hide one earbud (it is out of the case, in an ear).
    property bool leftShown: true
    property bool rightShown: true
    width: Theme.px(120)
    height: Theme.px(96)
    onLidOpenChanged: requestPaint()
    onKindChanged: requestPaint()
    onLeftShownChanged: requestPaint()
    onRightShownChanged: requestPaint()
    onWidthChanged: requestPaint()

    function _round(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.lineTo(x + w - r, y);
        c.arcTo(x + w, y, x + w, y + r, r);
        c.lineTo(x + w, y + h - r);
        c.arcTo(x + w, y + h, x + w - r, y + h, r);
        c.lineTo(x + r, y + h);
        c.arcTo(x, y + h, x, y + h - r, r);
        c.lineTo(x, y + r);
        c.arcTo(x, y, x + r, y, r);
        c.closePath();
    }

    onPaint: {
        var c = getContext("2d");
        c.reset();
        var s = width / 120;
        c.scale(s, s);
        var shine = c.createLinearGradient(0, 0, 120, 96);
        shine.addColorStop(0, "#ffffff");
        shine.addColorStop(1, "#d6d6d2");
        c.fillStyle = shine;
        c.strokeStyle = "#8c8c88";
        c.lineWidth = 1.5;
        if (kind === "airpodsmax") {
            c.lineWidth = 8;
            c.strokeStyle = "#d9d9d6";
            c.lineCap = "round";
            c.beginPath();
            c.moveTo(22, 60);
            c.bezierCurveTo(22, 18, 98, 18, 98, 60);
            c.stroke();
            c.lineWidth = 1.5;
            c.strokeStyle = "#8c8c88";
            _round(c, 10, 50, 26, 38, 11); c.fill(); c.stroke();
            _round(c, 84, 50, 26, 38, 11); c.fill(); c.stroke();
            return;
        }
        // The case, its lid tilted up when open.
        if (lidOpen) {
            c.save();
            c.translate(30, 50);
            c.rotate(-8 * Math.PI / 180);
            _round(c, 0, -16, 60, 16, 7);
            c.fill(); c.stroke();
            c.restore();
        }
        _round(c, 30, lidOpen ? 52 : 46, 60, lidOpen ? 40 : 46, 12);
        c.fill(); c.stroke();
        if (!lidOpen) {
            c.strokeStyle = "#b4b4b0";
            c.beginPath(); c.moveTo(31, 60); c.lineTo(89, 60); c.stroke();
            c.strokeStyle = "#8c8c88";
        }
        // The earbuds: a stem, a round head, its dark speaker.
        for (var i = 0; i < 2; ++i) {
            if ((i === 0 && !leftShown) || (i === 1 && !rightShown))
                continue;
            c.save();
            if (i === 1) { c.translate(120, 0); c.scale(-1, 1); }
            c.fillStyle = shine;
            c.lineWidth = 1.2;
            _round(c, 31, 14, 8, 30, 4); c.fill(); c.stroke();
            c.lineWidth = 1.4;
            c.beginPath(); c.ellipse(19, 2, 22, 20); c.fill(); c.stroke();
            c.fillStyle = "#55554f";
            c.beginPath(); c.ellipse(20.5, 8, 7, 8); c.fill();
            c.restore();
        }
    }
}
