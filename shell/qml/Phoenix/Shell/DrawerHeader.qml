// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The full-screen notification drawer's header (Phoenix): its title, then
// Select and Clear All (which asks once); while selecting, Cancel and Clear (n). Live
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

    // Clear All asks once ("Clear 3?"), as a second tap within a few
    // seconds: one stray tap never clears everything.
    property bool confirmingClearAll: false
    onVisibleChanged: confirmingClearAll = false
    onSelectingChanged: confirmingClearAll = false
    onClearableCountChanged: if (clearableCount === 0) confirmingClearAll = false
    Timer {
        running: header.confirmingClearAll
        interval: Theme.drawerConfirmTimeout
        onTriggered: header.confirmingClearAll = false
    }

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
        // A little past the text, well inside the header, so a tap meant
        // for the handle next to it, or for a row, never lands here.
        MouseArea {
            id: tap
            anchors.fill: parent
            anchors.leftMargin: -Theme.px(8)
            anchors.rightMargin: -Theme.px(8)
            anchors.topMargin: -Theme.px(4)
            anchors.bottomMargin: -Theme.px(4)
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
            text: header.confirmingClearAll ? qsTr("Clear %1?").arg(header.clearableCount) : qsTr("Clear All")
            color: header.confirmingClearAll ? Theme.drawerConfirmColor : (enabled ? Theme.text : Theme.textDim)
            onTriggered: {
                if (!header.confirmingClearAll) {
                    header.confirmingClearAll = true;
                    return;
                }
                header.confirmingClearAll = false;
                header.clearAllRequested();
            }
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
