// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One of Ember Glass's glass sheets the shell draws itself
// (docs/SYSTEM-UI-2.md, "Glass in the shell"; SPEC.md, "Glass tokens"):
//   level 4, an overlay (the banner, the dashboard, the system menu, the
//     drop-down, dialogs: base.css .veil with .banner, .menu): the scene
//     behind blurred live, 30 px, under the theme's L4 tint;
//   level 3, a float (.float): 22 px, the L3 tint;
//   level 2, a plane in one of them (.plane): the L2 tint, no blur.
// Each with a 1 px highlight inside its top and a hairline rim (line-2),
// and an overlay with lift-high's shadow under it. Without live blur
// (Theme.egLiveBlur) a float or an overlay is its 94% tint (glass.fallback;
// SPEC.md, "GPU cost and fallback"). Each corner can have its own radius
// (the system menu's 4 px corner where it opens: .menu).
//
// Its children go on top of the glass.

import QtQuick
import Qt5Compat.GraphicalEffects

Item {
    id: sheet
    objectName: "emberSheet"

    property int level: 4
    // The scene behind (Shell's sceneBackdrop), for the live blur.
    property Item backdrop: null
    property real radius: Theme.px(EmberGlass.radiusBanner)
    property real topLeftRadius: radius
    property real topRightRadius: radius
    property real bottomLeftRadius: radius
    property real bottomRightRadius: radius
    // lift-high's shadow (an overlay's), or none.
    property bool lifted: level === 4
    // The tint, the rim and the highlight: the theme's.
    readonly property bool liveBlur: level >= 3 && Theme.egLiveBlur
    readonly property color tint: level === 2 ? Theme.eg.glassL2Tint
        : !Theme.egLiveBlur ? Theme.eg.glassFallback
        : level === 3 ? Theme.eg.glassL3Tint : Theme.eg.glassL4Tint
    default property alias content: contentItem.data

    // lift-high's outer shadow (theme.*.shadow.lift-high: dark 0 30 60 -20,
    // light 0 30 60 -24), approximated as the card's is (Card.qml,
    // emberCardShadow): RectangularGlow's rectangle inset by a quarter of the
    // blur, its glow half the blur, so the fade is centred on the shadow's
    // edge.
    RectangularGlow {
        objectName: "emberSheetShadow"
        readonly property var sh: Theme.eg.shadowLiftHigh[1]
        visible: sheet.lifted && GraphicsInfo.api !== GraphicsInfo.Software
        x: Theme.px(-sh.spread + sh.blur / 4)
        y: Theme.px(-sh.spread + sh.blur / 4 + sh.offsetY)
        width: Math.max(0, sheet.width - 2 * x)
        height: Math.max(0, sheet.height - 2 * Theme.px(-sh.spread + sh.blur / 4))
        glowRadius: Theme.px(sh.blur / 2)
        spread: 0.15
        color: sh.color
        cornerRadius: Math.max(sheet.topLeftRadius, sheet.bottomRightRadius) + glowRadius
    }

    // The blur keeps to this shape (opaque: the mask's alpha is the blur's).
    Rectangle {
        id: mask
        visible: false
        anchors.fill: parent
        topLeftRadius: Math.max(0, sheet.topLeftRadius)
        topRightRadius: Math.max(0, sheet.topRightRadius)
        bottomLeftRadius: Math.max(0, sheet.bottomLeftRadius)
        bottomRightRadius: Math.max(0, sheet.bottomRightRadius)
        color: "white"
    }
    BackdropBlur {
        objectName: "emberSheetBlur"
        anchors.fill: parent
        visible: sheet.liveBlur && source !== null && GraphicsInfo.api !== GraphicsInfo.Software
        source: sheet.backdrop
        mask: mask
        radius: Theme.px(sheet.level === 3 ? EmberGlass.glassL3Blur : EmberGlass.glassL4Blur)
    }
    Rectangle {
        id: glass
        objectName: "emberSheetGlass"
        anchors.fill: parent
        topLeftRadius: Math.max(0, sheet.topLeftRadius)
        topRightRadius: Math.max(0, sheet.topRightRadius)
        bottomLeftRadius: Math.max(0, sheet.bottomLeftRadius)
        bottomRightRadius: Math.max(0, sheet.bottomRightRadius)
        color: sheet.tint
        border.color: Theme.eg.colorLine2
        border.width: Math.max(1, EmberGlass.hairline * Theme.u)
        // The highlight inside the top (inset 0 1px 0 edge).
        EgHighlight {
            objectName: "emberSheetHighlight"
            visible: sheet.level !== 2
            width: parent.width
            topLeftRadius: Math.max(0, sheet.topLeftRadius)
            topRightRadius: Math.max(0, sheet.topRightRadius)
            inset: parent.border.width
            color: Theme.eg.glassHighlight
        }
    }
    Item {
        id: contentItem
        anchors.fill: parent
    }
}
