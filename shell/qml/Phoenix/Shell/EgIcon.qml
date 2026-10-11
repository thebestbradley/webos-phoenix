// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One of Ember Glass's glyphs (Phosphor, light: EmberGlassIcons.js, MIT),
// filled in a colour, as large as the item (the mock-ups' .ic: 22 px unless
// a part says otherwise). Path data through QtQuick.Shapes' curve renderer,
// so it is sharp and smooth at any density without art files.

import QtQuick
import QtQuick.Shapes
import "EmberGlassIcons.js" as Icons

Item {
    id: icon

    property string name
    property color color: "white"
    readonly property var glyph: Icons.glyphs[name] || null

    implicitWidth: Theme.px(22)
    implicitHeight: implicitWidth

    Shape {
        visible: icon.glyph !== null
        width: icon.glyph ? icon.glyph.viewBox[2] : 1
        height: icon.glyph ? icon.glyph.viewBox[3] : 1
        x: icon.glyph ? -icon.glyph.viewBox[0] * scale : 0
        y: icon.glyph ? -icon.glyph.viewBox[1] * scale : 0
        transformOrigin: Item.TopLeft
        scale: icon.glyph ? Math.min(icon.width / icon.glyph.viewBox[2], icon.height / icon.glyph.viewBox[3]) : 1
        preferredRendererType: Shape.CurveRenderer
        ShapePath {
            fillColor: icon.color
            strokeColor: "transparent"
            strokeWidth: 0
            fillRule: ShapePath.WindingFill
            PathSvg { path: icon.glyph ? icon.glyph.paths.join(" ") : "" }
        }
    }
}
