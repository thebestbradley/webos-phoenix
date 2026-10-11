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
        // Whether it can be used now (not Item.enabled, which it keeps).
        property bool available: true
        signal triggered
        objectName: "drawer_" + name
        anchors.verticalCenter: parent.verticalCenter
        // Ember Glass: in ink, 14.5 px semibold (type.label, a ghost
        // pill's: base.css .pill.ghost).
        color: available ? (Theme.emberGlass ? Theme.eg.colorInk : Theme.text) : (Theme.emberGlass ? Theme.eg.colorInk3 : Theme.textDim)
        opacity: available ? (tap.pressed ? 0.6 : 1) : 0.5
        font.family: Theme.emberGlass ? Theme.egFontFamily : Theme.fontFamily
        font.pixelSize: Theme.emberGlass ? Math.round(14.5 * Theme.u) : Theme.drawerHeaderFontSize
        font.weight: Theme.emberGlass ? 600 : Font.Bold
        // A little past the text, well inside the header, so a tap meant
        // for the handle next to it, or for a row, never lands here.
        MouseArea {
            id: tap
            anchors.fill: parent
            anchors.leftMargin: -Theme.px(8)
            anchors.rightMargin: -Theme.px(8)
            anchors.topMargin: -Theme.px(4)
            anchors.bottomMargin: -Theme.px(4)
            enabled: action.available
            onClicked: action.triggered()
        }
    }

    // Ember Glass: a group's heading (base.css .micro in ink-3: 11 px
    // bold capitals, 1.6 px apart).
    Text {
        objectName: "drawerTitle"
        anchors.left: parent.left
        anchors.leftMargin: Theme.emberGlass ? Theme.px(18) : Theme.px(12)
        anchors.verticalCenter: parent.verticalCenter
        text: header.selecting ? (header.selectedCount > 0 ? qsTr("%1 selected").arg(header.selectedCount) : qsTr("Select notifications"))
                               : qsTr("Notifications")
        color: Theme.emberGlass ? Theme.eg.colorInk3 : Theme.textDim
        font.family: Theme.emberGlass ? Theme.egFontFamily : Theme.fontFamily
        font.pixelSize: Theme.emberGlass ? Math.round(11 * Theme.u) : Theme.drawerHeaderFontSize
        font.weight: Theme.emberGlass ? Font.Bold : Font.Normal
        font.capitalization: Theme.emberGlass ? Font.AllUppercase : Font.MixedCase
        font.letterSpacing: Theme.emberGlass ? 1.6 * Theme.u : 0
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
            available: header.clearableCount > 0
            text: qsTr("Select")
            onTriggered: header.selectRequested()
        }
        Action {
            name: "clearAll"
            visible: !header.selecting
            available: header.clearableCount > 0
            text: header.confirmingClearAll ? qsTr("Clear %1?").arg(header.clearableCount) : qsTr("Clear All")
            color: header.confirmingClearAll ? (Theme.emberGlass ? Theme.eg.colorDanger : Theme.drawerConfirmColor)
                                             : available ? (Theme.emberGlass ? Theme.eg.colorInk : Theme.text)
                                             : (Theme.emberGlass ? Theme.eg.colorInk3 : Theme.textDim)
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
            available: header.selectedCount > 0
            text: header.selectedCount > 0 ? qsTr("Clear (%1)").arg(header.selectedCount) : qsTr("Clear")
            onTriggered: header.clearSelectedRequested()
        }
    }

    Rectangle {
        anchors.bottom: parent.bottom
        x: Theme.px(8)
        width: parent.width - 2 * x
        height: Theme.emberGlass ? Math.max(1, EmberGlass.hairline * Theme.u) : Math.max(1, Theme.px(1))
        color: Theme.emberGlass ? Theme.eg.colorLine2 : Theme.drawerRule
    }
}
