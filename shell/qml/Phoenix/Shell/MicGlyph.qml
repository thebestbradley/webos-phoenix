// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A microphone, drawn as vectors on a 24-unit grid and scaled to the
// item: the capsule, the cradle under it (an open U, never a ring), its
// stem and foot. Crisp at any size and pixel ratio; the dictation keys
// and the assistant's microphone button all draw this one.

import QtQuick
import QtQuick.Shapes

Item {
    id: glyph

    property color color: "#202428"
    // The cradle, stem and foot's stroke, in grid units.
    property real lineWidth: 2

    implicitWidth: 24
    implicitHeight: 24

    Shape {
        width: 24
        height: 24
        scale: Math.min(glyph.width, glyph.height) / 24
        transformOrigin: Item.TopLeft
        x: (glyph.width - 24 * scale) / 2
        y: (glyph.height - 24 * scale) / 2
        preferredRendererType: Shape.CurveRenderer

        // The capsule.
        ShapePath {
            strokeWidth: -1
            fillColor: glyph.color
            PathSvg { path: "M12 2.5 C 13.93 2.5 15.5 4.07 15.5 6 L 15.5 11.5 C 15.5 13.43 13.93 15 12 15 C 10.07 15 8.5 13.43 8.5 11.5 L 8.5 6 C 8.5 4.07 10.07 2.5 12 2.5 Z" }
        }
        // The cradle, the stem and the foot.
        ShapePath {
            fillColor: "transparent"
            strokeColor: glyph.color
            strokeWidth: glyph.lineWidth
            capStyle: ShapePath.RoundCap
            joinStyle: ShapePath.RoundJoin
            PathSvg { path: "M5.5 11 C 5.5 14.59 8.41 17.5 12 17.5 C 15.59 17.5 18.5 14.59 18.5 11 M12 17.5 L 12 21 M8.5 21 L 15.5 21" }
        }
    }
}
