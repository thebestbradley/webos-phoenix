// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Generic earbuds in their case, drawn here (Phoenix's own: plain shapes,
// no Apple artwork; docs/ACCESSORIES.md, "Art"), for the AirPods card
// (EarbudsAlert.qml). The same drawing as Settings' (apps/settings
// Earbuds.tsx EarbudsArt), in a 120 x 96 box: a rounded case, its lid
// standing open behind it, the two earbuds' heads showing in their wells;
// closed, the lid on top with its seam. Over-ear headphones (AirPods Max)
// are a band and two cups.

import QtQuick

Canvas {
    id: art
    property bool lidOpen: true
    property string kind: ""
    width: Theme.px(120)
    height: Theme.px(96)
    onLidOpenChanged: requestPaint()
    onKindChanged: requestPaint()
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
    function _white(c, y0, y1) {
        var g = c.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(1, "#d4d4cf");
        return g;
    }

    onPaint: {
        var c = getContext("2d");
        c.reset();
        var s = width / 120;
        c.scale(s, s);
        c.lineWidth = 1.5;
        c.strokeStyle = "#8a8a85";
        if (kind === "airpodsmax") {
            c.lineWidth = 8;
            c.lineCap = "round";
            c.strokeStyle = "#d9d9d6";
            c.beginPath(); c.moveTo(26, 58); c.bezierCurveTo(26, 14, 94, 14, 94, 58); c.stroke();
            c.lineWidth = 1.5;
            c.strokeStyle = "#8a8a85";
            c.fillStyle = _white(c, 46, 90);
            _round(c, 12, 46, 28, 42, 12); c.fill(); c.stroke();
            _round(c, 80, 46, 28, 42, 12); c.fill(); c.stroke();
            return;
        }
        if (lidOpen) {
            // The lid, open behind: its outside rim and its inside.
            c.fillStyle = _white(c, 8, 46);
            _round(c, 24, 8, 72, 40, 16); c.fill(); c.stroke();
            c.fillStyle = "#c9c9c4";
            _round(c, 30, 13, 60, 30, 12); c.fill();
            // The earbuds' heads in their wells, over the case's rim.
            for (var i = 0; i < 2; ++i) {
                var cx = i === 0 ? 47 : 73;
                c.fillStyle = _white(c, 36, 56);
                c.beginPath(); c.ellipse(cx - 10, 37, 20, 18); c.fill(); c.stroke();
                c.fillStyle = "#4f4f4a";
                c.beginPath(); c.ellipse(cx + (i === 0 ? -3.5 : 3.5) - 2.5, 41, 5, 6); c.fill();
            }
        }
        // The case.
        c.fillStyle = _white(c, 46, 92);
        _round(c, 20, lidOpen ? 48 : 30, 80, lidOpen ? 44 : 62, 18);
        c.fill(); c.stroke();
        c.strokeStyle = "#b0b0aa";
        c.beginPath();
        if (lidOpen) {
            // The wells' edge.
            c.moveTo(28, 52); c.lineTo(92, 52);
        } else {
            // The lid's seam.
            c.moveTo(21, 50); c.lineTo(99, 50);
        }
        c.stroke();
        // The status light.
        c.fillStyle = "#9fd88a";
        c.beginPath(); c.ellipse(58, lidOpen ? 74 : 70, 4, 4); c.fill();
    }
}
