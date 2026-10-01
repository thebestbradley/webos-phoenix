// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One 52 px row of the dashboard (DashboardWindowContainer.cpp:48): the
// app's own dashboard window when it opened one, otherwise its icon, title
// and message. The notification area and the lock screen both show these;
// a dashboard window is one live page, so whichever shows it calls claim().

import QtQuick

Item {
    id: item

    // The window source, for windowFor(windowKey).
    property var source
    property string windowKey: ""
    property string title: ""
    property string body: ""
    property color color: "#666666"
    property string glyph: ""
    property string icon: ""
    // An ongoing activity's progress, 0-100 (a download, an install); -1: none.
    property real progress: -1

    height: Theme.dashboardItemHeight

    // Show the app's dashboard window here.
    function claim() {
        var w = windowKey && source ? source.windowFor(windowKey) : null;
        if (!w)
            return;
        w.parent = host;
        w.x = 0;
        w.y = 0;
        w.width = Qt.binding(function() { return host.width; });
        w.height = Qt.binding(function() { return host.height; });
        w.visible = true;
    }
    Component.onCompleted: claim()

    Item {
        id: host
        anchors.fill: parent
        visible: item.windowKey !== ""
        z: 1
    }

    AppIcon {
        id: dIcon
        x: Theme.px(10)
        anchors.verticalCenter: parent.verticalCenter
        size: Theme.px(32)
        showLabel: false
        color: item.color
        glyph: item.glyph
        source: item.icon
    }
    Column {
        anchors.left: dIcon.right
        anchors.leftMargin: Theme.px(10)
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        Text {
            width: parent.width
            elide: Text.ElideRight
            text: item.title
            color: Theme.text
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(16)
            font.bold: true
        }
        Text {
            width: parent.width
            elide: Text.ElideRight
            text: item.body
            color: Theme.textDim
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(14)
        }
        // The progress of an ongoing activity.
        Rectangle {
            objectName: "dashboardProgress"
            visible: item.progress >= 0
            width: parent.width - Theme.px(10)
            height: Theme.px(4)
            radius: height / 2
            color: Qt.rgba(1, 1, 1, 0.2)
            Rectangle {
                width: parent.width * Math.max(0, Math.min(100, item.progress)) / 100
                height: parent.height
                radius: parent.radius
                color: Theme.text
            }
        }
    }
}
