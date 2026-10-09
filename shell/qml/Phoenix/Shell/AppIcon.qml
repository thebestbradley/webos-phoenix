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
    // Window pixels per point: 2 on a Retina Mac, where Qt draws the
    // window at twice the size; 1 on a device (the shell scales by Theme.u).
    property real pixelRatio: Screen.devicePixelRatio
    // An app group (a launcher folder; docs/M6-PLAN.md F4): its first four
    // apps [{icon, largeIcon, color, glyph}] in a 2 x 2 grid on a dark
    // rounded tile with a grey edge (LunaCE, webOS CE 3.1.0's
    // Screenshots/Group-2.jpg), instead of an icon of its own.
    property var groupIcons: []
    readonly property bool isGroup: groupIcons && groupIcons.length > 0

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

        Rectangle {
            objectName: "groupTile"
            visible: icon.isGroup
            anchors.fill: parent
            anchors.margins: parent.width * 0.04
            radius: width * 0.14
            color: "#2A2D31"
            border.color: "#9AA0A7"
            border.width: Math.max(1, Math.round(icon.size / 32))
            Grid {
                anchors.centerIn: parent
                columns: 2
                spacing: parent.width * 0.06
                Repeater {
                    model: icon.isGroup ? icon.groupIcons.slice(0, 4) : []
                    // Each app small: its icon, or its drawn tile.
                    delegate: Item {
                        id: mini
                        required property var modelData
                        readonly property int pixels: Math.ceil(width * icon.pixelRatio)
                        width: Math.round(icon.size * 0.38)
                        height: width
                        Image {
                            anchors.fill: parent
                            visible: (mini.modelData.icon || "") !== ""
                            source: visible ? Theme.appIcon(mini.modelData.icon, mini.pixels, mini.modelData.largeIcon || "") : ""
                            sourceSize: Qt.size(mini.pixels, mini.pixels)
                            smooth: true
                        }
                        Rectangle {
                            visible: (mini.modelData.icon || "") === ""
                            anchors.fill: parent
                            anchors.margins: parent.width * 0.08
                            radius: width * 0.2
                            color: mini.modelData.color || "#666666"
                            Text {
                                anchors.centerIn: parent
                                text: mini.modelData.glyph || ""
                                color: "white"
                                font.pixelSize: parent.height * 0.55
                                font.bold: true
                            }
                        }
                    }
                }
            }
        }

        Image {
            id: iconImage
            objectName: "iconImage"
            anchors.fill: parent
            visible: icon.source != "" && !icon.isGroup && status !== Image.Error
            // The icon, or a bigger one the app ships once the icon would
            // be magnified (Theme.appIcon). A file bigger than the drawn
            // size (that bigger one, or the 64 px icon in a 22 px
            // notification) is decoded at the drawn size, smoothly scaled
            // down, rather than shrunk by the scene graph, which aliases.
            // The drawn size is in the window's pixels (pixelRatio): a
            // 64 px icon covers 128 on a Retina Mac. Qt takes a PNG's
            // sourceSize as the file's own pixels, not points.
            readonly property int pixels: Math.ceil(icon.size * icon.pixelRatio)
            readonly property url best: icon.source != "" ? Theme.appIcon(icon.source, pixels, icon.largeSource) : ""
            readonly property size fileSize: best != "" ? HiDpi.imageSize(best) : Qt.size(-1, -1)
            readonly property bool larger: Math.max(fileSize.width, fileSize.height) > pixels
            source: best
            sourceSize: larger ? Qt.size(pixels, pixels) : Qt.size(-1, -1)
            smooth: true
        }

        // No icon, or one that does not load (an icon address out of reach,
        // a package not installed yet): the app's initial on its colour.
        Rectangle {
            objectName: "iconGlyph"
            visible: (icon.source == "" || iconImage.status === Image.Error) && !icon.isGroup
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
