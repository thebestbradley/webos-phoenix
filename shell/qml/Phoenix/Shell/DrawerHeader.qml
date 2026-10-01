// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The full-screen notification drawer's header (Phoenix): its title, then
// Select and Clear All; while selecting, Cancel and Clear (n). Live
// activities are never selected or cleared: they end on their own.

import QtQuick

Item {
    id: header
    objectName: "drawerHeader"

    property bool selecting: false
    property int selectedCount: 0
    // Notifications that can be cleared (not live activities).
    property int clearableCount: 0

    signal selectRequested
    signal cancelRequested
    signal clearSelectedRequested
    signal clearAllRequested

    height: Theme.drawerHeaderHeight

    component Action: Text {
        id: action
        property string name
        property bool enabled: true
        signal triggered
        objectName: "drawer_" + name
        anchors.verticalCenter: parent.verticalCenter
        color: enabled ? Theme.text : Theme.textDim
        opacity: enabled ? (tap.pressed ? 0.6 : 1) : 0.5
        font.family: Theme.fontFamily
        font.pixelSize: Theme.drawerHeaderFontSize
        font.bold: true
        MouseArea {
            id: tap
            anchors.fill: parent
            anchors.margins: -Theme.px(8)
            enabled: action.enabled
            onClicked: action.triggered()
        }
    }

    Text {
        anchors.left: parent.left
        anchors.leftMargin: Theme.px(12)
        anchors.verticalCenter: parent.verticalCenter
        text: header.selecting ? (header.selectedCount > 0 ? qsTr("%1 selected").arg(header.selectedCount) : qsTr("Select notifications"))
                               : qsTr("Notifications")
        color: Theme.textDim
        font.family: Theme.fontFamily
        font.pixelSize: Theme.drawerHeaderFontSize
    }

    Row {
        anchors.right: parent.right
        anchors.rightMargin: Theme.px(12)
        anchors.verticalCenter: parent.verticalCenter
        height: parent.height
        spacing: Theme.px(20)
        Action {
            name: "select"
            visible: !header.selecting
            enabled: header.clearableCount > 0
            text: qsTr("Select")
            onTriggered: header.selectRequested()
        }
        Action {
            name: "clearAll"
            visible: !header.selecting
            enabled: header.clearableCount > 0
            text: qsTr("Clear All")
            onTriggered: header.clearAllRequested()
        }
        Action {
            name: "cancel"
            visible: header.selecting
            text: qsTr("Cancel")
            onTriggered: header.cancelRequested()
        }
        Action {
            name: "clearSelected"
            visible: header.selecting
            enabled: header.selectedCount > 0
            text: header.selectedCount > 0 ? qsTr("Clear (%1)").arg(header.selectedCount) : qsTr("Clear")
            onTriggered: header.clearSelectedRequested()
        }
    }

    Rectangle {
        anchors.bottom: parent.bottom
        x: Theme.px(8)
        width: parent.width - 2 * x
        height: Math.max(1, Theme.px(1))
        color: Theme.drawerRule
    }
}
