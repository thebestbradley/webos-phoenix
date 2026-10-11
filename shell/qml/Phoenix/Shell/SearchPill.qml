// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The "Just type..." search pill above the cards (OverlayWindowManager_p.h
// SearchPill, OverlayWindowManager.cpp:1150-1177). Tapping it opens Just
// Type. It shows in card view and fades out (quickLaunchFadeDuration, curve
// 6 = OutCubic) while an app is maximized, the launcher is open or Just
// Type is showing (the search pill state machine, :494-561).
//
// In Ember Glass (Phoenix 2.0; docs/SYSTEM-UI-2.md, 5) it is the mock-ups'
// Just Type bar (cards.html .jt): a 50 px glass capsule 18 px in from each
// side, the magnifying glass, "Just type, or ask" and the Assistant's ember
// orb. What a tap and typing do is the same.

import QtQuick
import QtQuick.Shapes as Shapes
import Qt5Compat.GraphicalEffects

Item {
    id: pill

    property bool shown: true

    signal tapped

    // 588 legacy px on the TouchPad (layoutsettings.cpp:91); a phone has
    // the screen width less a margin *(inferred: 2.x phones had no pill)*.
    width: Math.min(Theme.px(588), parent ? parent.width - Theme.px(Theme.emberGlass ? 36 : 20) : Theme.px(300))
    height: Theme.px(50)

    opacity: shown ? 1 : 0
    visible: opacity > 0
    enabled: shown
    Behavior on opacity { NumberAnimation { duration: Theme.searchPillFadeDuration; easing.type: Easing.OutCubic } }

    // The scene behind the pill, blurred faintly within its shape.
    property Item backdrop: null
    BackdropBlur {
        anchors.fill: parent
        source: pill.backdrop
        mask: Theme.emberGlass ? egShape : pillShape
        // Ember Glass: blur(12px) (.jt).
        radius: Theme.emberGlass ? Theme.px(12) : Theme.px(Theme.backdropBlurRadius)
    }
    ArtBorderImage {
        id: pillShape
        visible: false
        anchors.fill: parent
        source: Theme.asset("launcher3/search-field-bg-launcher.png")
        border { left: Theme.artBorder(40, source); right: Theme.artBorder(40, source); top: 0; bottom: 0 }
    }

    // Three-tiled background, 40 px caps (OverlayWindowManager.cpp:1152-1155).
    ArtBorderImage {
        visible: !Theme.emberGlass
        anchors.fill: parent
        source: Theme.asset("launcher3/search-field-bg-launcher.png")
        border { left: Theme.artBorder(40, source); right: Theme.artBorder(40, source); top: 0; bottom: 0 }
        horizontalTileMode: BorderImage.Stretch
    }

    // ---- Ember Glass (cards.html .jt) ------------------------------------------
    // The capsule: rgb(20 18 20 / .38) over the blur, a white hairline at
    // 30%, a 1 px highlight at 12% inside its top.
    Rectangle {
        id: egShape
        objectName: "emberSearchPill"
        visible: Theme.emberGlass
        anchors.fill: parent
        radius: height / 2
        // Without live blur, the dark theme's 94% tint (glass.fallback).
        color: Theme.egLiveBlur ? Qt.rgba(20 / 255, 18 / 255, 20 / 255, 0.38) : EmberGlass.dark.glassFallback
        border.color: Qt.rgba(1, 1, 1, 0.3)
        border.width: Math.max(1, EmberGlass.hairline * Theme.u)
        layer.enabled: Theme.emberGlass
        Rectangle {
            x: parent.radius / 2
            width: parent.width - parent.radius
            y: parent.border.width
            height: Math.max(1, Theme.u)
            color: Qt.rgba(1, 1, 1, 0.12)
        }
    }
    Row {
        visible: Theme.emberGlass
        anchors.left: parent.left
        anchors.leftMargin: Theme.px(18)
        anchors.right: egOrb.left
        anchors.rightMargin: Theme.px(12)
        anchors.verticalCenter: parent.verticalCenter
        spacing: Theme.px(12)
        EgIcon {
            anchors.verticalCenter: parent.verticalCenter
            name: "magnifying-glass"
            width: Theme.px(19)
            height: width
            color: Qt.rgba(1, 1, 1, 0.7)
        }
        Text {
            anchors.verticalCenter: parent.verticalCenter
            text: qsTr("Just type, or ask")
            elide: Text.ElideRight
            color: Qt.rgba(1, 1, 1, 0.7)
            font: Qt.font({ family: Theme.egFontFamily, pixelSize: Math.round(15.5 * Theme.u), weight: Font.Medium })
        }
    }
    // The Assistant's ember orb (base.css .orb, ember.orb): 34 px, lit
    // from its top left, glowing.
    Item {
        id: egOrb
        visible: Theme.emberGlass
        anchors.right: parent.right
        anchors.rightMargin: Theme.px(8)
        anchors.verticalCenter: parent.verticalCenter
        width: Theme.px(EmberGlass.sizeOrb)
        height: width
        RectangularGlow {
            anchors.fill: parent
            visible: GraphicsInfo.api !== GraphicsInfo.Software
            glowRadius: Theme.px(9)
            spread: 0.1
            color: Qt.rgba(1, 110 / 255, 40 / 255, 0.45)
            cornerRadius: width / 2 + glowRadius
        }
        Shapes.Shape {
            anchors.fill: parent
            preferredRendererType: Shapes.Shape.CurveRenderer
            Shapes.ShapePath {
                strokeColor: "transparent"
                // ember.orb: a circle at 34% 30%, out to the farthest
                // corner (CSS's default size: 0.962 of the side).
                fillGradient: Shapes.RadialGradient {
                    centerX: egOrb.width * 0.34; centerY: egOrb.height * 0.30
                    centerRadius: egOrb.width * Math.sqrt(0.66 * 0.66 + 0.70 * 0.70)
                    focalX: centerX; focalY: centerY
                    GradientStop { position: 0; color: EmberGlass.emberOrb.stops[0].color }
                    GradientStop { position: EmberGlass.emberOrb.stops[1].position; color: EmberGlass.emberOrb.stops[1].color }
                    GradientStop { position: EmberGlass.emberOrb.stops[2].position; color: EmberGlass.emberOrb.stops[2].color }
                    GradientStop { position: EmberGlass.emberOrb.stops[3].position; color: EmberGlass.emberOrb.stops[3].color }
                    GradientStop { position: 1; color: EmberGlass.emberOrb.stops[4].color }
                }
                PathAngleArc { centerX: egOrb.width / 2; centerY: egOrb.height / 2; radiusX: egOrb.width / 2; radiusY: egOrb.height / 2; startAngle: 0; sweepAngle: 360 }
            }
        }
    }

    // 18 px oblique quick launch font, white at 80%, 20 px in
    // (OverlayWindowManager_p.h:65-86).
    Text {
        visible: !Theme.emberGlass
        anchors.left: parent.left
        anchors.leftMargin: Theme.px(20)
        anchors.right: icon.left
        anchors.rightMargin: Theme.px(10)
        anchors.verticalCenter: parent.verticalCenter
        anchors.verticalCenterOffset: -Theme.px(1)                 // searchPillInnerTextAdjust
        text: qsTr("Just type...")
        elide: Text.ElideRight
        color: "white"
        opacity: 0.8
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(18)
        font.italic: true
    }

    // Search icon, 15 px from the right (searchPillInnerIconRightOffset).
    Image {
        id: icon
        visible: !Theme.emberGlass
        anchors.right: parent.right
        anchors.rightMargin: Theme.px(15)
        anchors.verticalCenter: parent.verticalCenter
        width: Theme.px(32)
        height: width
        source: Theme.asset("launcher3/search-button-launcher.png")
    }

    MouseArea {
        anchors.fill: parent
        onClicked: pill.tapped()
    }
}
