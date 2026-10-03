// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// App icon with optional label. Apps that ship an icon file use it; the
// simulator's placeholder apps get a drawn glossy tile instead, since the
// original Palm app icons are not part of the open-source release.

import QtQuick
import Phoenix.Native

Item {
    id: icon

    property string title
    property url source: ""
    // A bigger picture of the same icon, if the app names one (appinfo.json
    // "splashicon"); Theme.appIcon also finds icon-256x256.png beside it.
    property url largeSource: ""
    property color color: "#666666"
    property string glyph: ""
    property bool showLabel: true
    property int size: Theme.launcherIconSize
    // false: the icon only draws; its parent handles touches.
    property bool interactive: true
    // Launch feedback: launcher-touch-feedback.png behind the icon, centred
    // on it (icongeometrysettings.cpp:193-195 give the icon and the
    // feedback the same offset), from the tap until its app is up.
    property bool feedback: false

    signal clicked

    width: size
    height: size + (showLabel ? label.height + Theme.px(4) : 0)

    Item {
        id: tile
        width: icon.size
        height: icon.size

        Image {
            objectName: "launchFeedback"
            visible: icon.feedback
            anchors.centerIn: parent
            width: Theme.launchFeedbackSize
            height: Theme.launchFeedbackSize
            source: Theme.asset("launcher3/launcher-touch-feedback.png")
        }

        Image {
            objectName: "iconImage"
            anchors.fill: parent
            visible: icon.source != ""
            // The icon, or a bigger one the app ships once the icon would
            // be magnified (Theme.appIcon). A file bigger than the drawn
            // size (that bigger one, or the 64 px icon in a 22 px
            // notification) is decoded at the drawn size, smoothly scaled
            // down, rather than shrunk by the scene graph, which aliases.
            readonly property url best: icon.source != "" ? Theme.appIcon(icon.source, icon.size, icon.largeSource) : ""
            readonly property size fileSize: best != "" ? HiDpi.imageSize(best) : Qt.size(-1, -1)
            readonly property bool larger: Math.max(fileSize.width, fileSize.height) > icon.size
            source: best
            sourceSize: larger ? Qt.size(icon.size, icon.size) : Qt.size(-1, -1)
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
        anchors.topMargin: Theme.launcherLabelSpacing
        anchors.horizontalCenter: tile.horizontalCenter
        width: Theme.tablet ? Theme.launcherLabelWidth : icon.size * 1.4
        horizontalAlignment: Text.AlignHCenter
        elide: Text.ElideRight
        maximumLineCount: 2
        wrapMode: Text.WordWrap
        text: icon.title
        color: Theme.text
        font.family: Theme.fontFamily
        font.pixelSize: Theme.launcherLabelFontSize
        font.bold: Theme.launcherLabelBold
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
