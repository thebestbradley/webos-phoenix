// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One 52 px row of the dashboard (DashboardWindowContainer.cpp:48): the
// app's own dashboard window when it opened one, otherwise its icon, title
// and message. The notification area and the lock screen both show these;
// a dashboard window is one live page, so whichever shows it calls claim().
//
// Phoenix: a notification may carry answers as buttons ({actions}: the
// "notification" host message's, JSON {items: [{id, label}], ...}), shown
// on the row's second line in place of its message, e.g. the Assistant's
// follow-up questions ("Where is Dentist?" Office · Video call · Skip).
// A tap on one says actionTapped(id); the row's own tap still opens the app.

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
    // The answers offered ("" or the JSON above); none on the lock screen.
    property string actions: ""
    readonly property var _actionItems: {
        if (!actions)
            return [];
        try {
            var a = JSON.parse(actions);
            return a && Array.isArray(a.items) ? a.items : [];
        } catch (e) {
            return [];
        }
    }
    signal actionTapped(string actionId)

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

    // The row's own icon and text, when the app has no dashboard window
    // (the window draws its own; behind it they would show through).
    readonly property bool _own: item.windowKey === ""

    AppIcon {
        id: dIcon
        visible: item._own
        x: Theme.px(10)
        anchors.verticalCenter: parent.verticalCenter
        size: Theme.px(32)
        showLabel: false
        color: item.color
        glyph: item.glyph
        source: item.icon
    }
    Column {
        id: textColumn
        visible: item._own
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
            visible: item._actionItems.length === 0
            width: parent.width
            elide: Text.ElideRight
            text: item.body
            color: Theme.textDim
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(14)
        }
        // Room for the answers (actionRow, over the row's own tap area).
        Item {
            id: actionSpace
            visible: item._actionItems.length > 0
            width: parent.width
            height: Theme.px(24)
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

    // The answers: small pills on the second line, above the row's own
    // MouseArea (a tap on one is not a tap on the row).
    Row {
        id: actionRow
        objectName: "dashboardActions"
        visible: item._own && item._actionItems.length > 0
        z: 2
        x: textColumn.x
        y: textColumn.y + actionSpace.y + (actionSpace.height - height) / 2
        width: textColumn.width
        spacing: Theme.px(6)
        clip: true
        Repeater {
            model: item._actionItems
            delegate: Rectangle {
                id: pill
                required property var modelData
                objectName: "dashboardAction_" + modelData.id
                height: Theme.px(22)
                width: pillLabel.implicitWidth + Theme.px(18)
                radius: height / 2
                color: pillArea.pressed ? Qt.rgba(1, 1, 1, 0.32) : Qt.rgba(1, 1, 1, 0.12)
                border.width: Math.max(1, Theme.px(1))
                border.color: Qt.rgba(1, 1, 1, 0.35)
                Text {
                    id: pillLabel
                    anchors.centerIn: parent
                    text: pill.modelData.label
                    color: Theme.text
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.px(13)
                }
                MouseArea {
                    id: pillArea
                    anchors.fill: parent
                    preventStealing: true
                    onClicked: item.actionTapped(String(pill.modelData.id))
                }
            }
        }
    }
}
