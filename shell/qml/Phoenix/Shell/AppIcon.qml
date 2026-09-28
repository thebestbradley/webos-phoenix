// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// App icon with optional label. Apps that ship an icon file use it; the
// simulator's placeholder apps get a drawn glossy tile instead, since the
// original Palm app icons are not part of the open-source release.

import QtQuick

Item {
    id: icon

    property string title
    property url source: ""
    property color color: "#666666"
    property string glyph: ""
    property bool showLabel: true
    property int size: Theme.launcherIconSize
    // false: the icon only draws; its parent handles touches.
    property bool interactive: true
    property bool pressed: mouse.pressed

    signal clicked

    width: size
    height: size + (showLabel ? label.height + Theme.px(4) : 0)

    Item {
        id: tile
        width: icon.size
        height: icon.size
        scale: icon.pressed ? 0.92 : 1
        Behavior on scale { NumberAnimation { duration: 80 } }

        Image {
            anchors.fill: parent
            visible: icon.source != ""
            source: icon.source
            smooth: true
        }

        Rectangle {
            visible: icon.source == ""
            anchors.fill: parent
            anchors.margins: parent.width * 0.08
            radius: width * 0.2
            border.color: Qt.darker(icon.color, 1.5)
            border.width: Math.max(1, Theme.px(1))
            gradient: Gradient {
                GradientStop { position: 0.0; color: Qt.lighter(icon.color, 1.45) }
                GradientStop { position: 0.5; color: icon.color }
                GradientStop { position: 1.0; color: Qt.darker(icon.color, 1.3) }
            }

            // Glass highlight across the top half.
            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: parent.border.width
                height: parent.height * 0.48
                radius: parent.radius
                gradient: Gradient {
                    GradientStop { position: 0.0; color: "#80ffffff" }
                    GradientStop { position: 1.0; color: "#10ffffff" }
                }
            }

            Text {
                anchors.centerIn: parent
                text: icon.glyph
                color: "white"
                font.pixelSize: parent.height * 0.5
                font.bold: true
                style: Text.Raised
                styleColor: Qt.darker(icon.color, 1.8)
            }
        }
    }

    Text {
        id: label
        visible: icon.showLabel
        anchors.top: tile.bottom
        anchors.topMargin: Theme.px(2)
        anchors.horizontalCenter: tile.horizontalCenter
        width: icon.size * 1.4
        horizontalAlignment: Text.AlignHCenter
        elide: Text.ElideRight
        maximumLineCount: 2
        wrapMode: Text.WordWrap
        text: icon.title
        color: Theme.text
        font.family: Theme.fontFamily
        font.pixelSize: Theme.launcherLabelFontSize
        style: Text.Raised
        styleColor: "#000000"
    }

    MouseArea {
        id: mouse
        anchors.fill: tile
        enabled: icon.interactive
        onClicked: icon.clicked()
    }
}
