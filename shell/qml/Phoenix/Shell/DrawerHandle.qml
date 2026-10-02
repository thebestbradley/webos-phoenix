// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The notification drawer's handle (Phoenix): a short pill on the
// dashboard's open edge. Pulled away from that edge the drawer follows the
// finger (pull) and, past Theme.drawerPullThreshold, opens to the whole
// screen; pulled back it returns, and on the phone a pull down from the
// normal size closes the dashboard. A tap toggles the whole screen.
// towardEdge: the pull that expands is toward the screen's top (phones,
// whose dashboard grows up from the bottom) or its bottom (tablets, whose
// drop-down hangs from the status bar).

import QtQuick

Item {
    id: handle
    objectName: "drawerHandle"

    property bool expanded: false
    property bool expandsUp: true
    // How far the drawer is being pulled toward expanding (negative: back);
    // 0 unless a finger is on the handle, so a press the handle never sees
    // end (its drawer closed under it) cannot leave the drawer pulled.
    readonly property real pull: area.pressed ? area.pull : 0

    signal expandRequested
    signal collapseRequested
    signal closeRequested

    height: Theme.drawerHandleHeight

    Rectangle {
        objectName: "drawerHandlePill"
        anchors.centerIn: parent
        width: Theme.drawerHandleWidth
        height: Theme.drawerHandleThickness
        radius: height / 2
        color: Theme.text
        opacity: area.pressed ? 0.7 : 0.35
        Behavior on opacity { NumberAnimation { duration: Theme.motion(120) } }
    }

    MouseArea {
        id: area
        objectName: "drawerHandleArea"
        anchors.fill: parent
        // A finger-sized target: the strip and a little past the drawer's
        // edge, never over the header or the rows on the other side.
        anchors.topMargin: handle.expandsUp ? -Theme.px(8) : 0
        anchors.bottomMargin: handle.expandsUp ? 0 : -Theme.px(8)
        preventStealing: true
        property real startY: 0
        property real pull: 0
        property bool moved: false
        onPressed: (m) => {
            startY = mapToItem(null, m.x, m.y).y;
            moved = false;
            pull = 0;
        }
        onPositionChanged: (m) => {
            var dy = mapToItem(null, m.x, m.y).y - startY;
            if (Math.abs(dy) > Theme.px(6))
                moved = true;
            if (moved)
                pull = handle.expandsUp ? -dy : dy;
        }
        onReleased: {
            var p = pull;
            pull = 0;
            if (!moved)
                return;
            if (p > Theme.drawerPullThreshold && !handle.expanded)
                handle.expandRequested();
            else if (p < -Theme.drawerPullThreshold)
                handle.expanded ? handle.collapseRequested() : handle.closeRequested();
            else if (handle.expanded)
                handle.expandRequested();       // back to where it was
            else
                handle.collapseRequested();
        }
        onCanceled: pull = 0
        onEnabledChanged: pull = 0
        onClicked: {
            if (moved)
                return;
            handle.expanded ? handle.collapseRequested() : handle.expandRequested();
        }
    }
}
