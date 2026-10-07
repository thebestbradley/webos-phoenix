// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An app group (folder) opened over the launcher page (docs/M6-PLAN.md F4;
// LunaCE's launcher in webOS CE 3.1.0, Screenshots/Group-1.jpg): a dark
// panel with a grey edge, the group's name across its top and its apps
// below in a grid, the page dimmed around it.
//   tap an app           launches it
//   tap the name         renames the group: the name becomes a field (a
//                        black box outlined in blue), Enter keeps it
//   press and hold       the icon menu, with Remove from Folder (LunaCE
//                        popped the app straight out; Phoenix's hold opens
//                        the menu, docs/M6-PLAN.md F1); moving on from the
//                        hold takes the app out onto the page, carried
//   a tap outside, Back  closes it
//
// members: [{appId, title, color, glyph, icon, largeIcon}].

import QtQuick

Item {
    id: overlay
    objectName: "launcherGroup"

    property bool open: false
    property string groupId: ""
    property string title: ""
    property var members: []
    readonly property bool editing: titleField.activeFocus
    // The app whose menu the hold opened, while the finger is down.
    property string heldId: ""

    signal launchRequested(string appId)
    signal renamed(string title)
    // rect: the icon, in this item's coordinates.
    signal menuRequested(string appId, rect iconRect)
    // The hold moved on: the app leaves the group, carried at (x, y);
    // then the finger's moves and its release (this item's coordinates).
    signal dragOutRequested(string appId, real x, real y)
    signal dragMoved(real x, real y)
    signal dragEnded(real x, real y)
    signal closeRequested
    // An app is being carried out: the group is hidden until the finger
    // lifts, then closes (it keeps the touch till then).
    property bool carrying: false
    onOpenChanged: if (!open) carrying = false

    visible: open || scrim.opacity > 0
    enabled: open

    readonly property int columns: Math.max(1, Math.min(4, Math.floor((width - Theme.px(48)) / cellWidth)))
    readonly property real cellWidth: Theme.tablet ? Theme.launcherCellPitch : Theme.px(92)
    readonly property real cellHeight: Theme.tablet ? Theme.launcherRowPitch - Theme.px(20) : Theme.launcherIconSize + Theme.px(48)

    function startRename() {
        titleField.text = overlay.title;
        titleField.selectAll();
        titleField.forceActiveFocus();
    }
    function finishRename() {
        var t = titleField.text.trim();
        titleField.focus = false;
        if (t !== "" && t !== overlay.title)
            renamed(t);
    }
    // The icon at index, in this item's coordinates.
    function iconRect(i) {
        var c = grid.children[i];
        if (!c)
            return Qt.rect(0, 0, 0, 0);
        var p = c.mapToItem(overlay, (c.width - Theme.launcherIconSize) / 2, 0);
        return Qt.rect(p.x, p.y, Theme.launcherIconSize, Theme.launcherIconSize);
    }

    Rectangle {
        id: scrim
        anchors.fill: parent
        color: "#000000"
        opacity: overlay.open && !overlay.carrying ? 0.55 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.motion(200) } }
    }
    MouseArea {
        objectName: "launcherGroupScrim"
        anchors.fill: parent
        onPressed: {
            if (overlay.editing)
                overlay.finishRename();
            else
                overlay.closeRequested();
        }
    }

    Rectangle {
        id: panel
        objectName: "launcherGroupPanel"
        readonly property int rows: Math.max(1, Math.ceil(overlay.members.length / overlay.columns))
        width: Math.min(overlay.width - Theme.px(16), Math.min(overlay.members.length, overlay.columns) * overlay.cellWidth + Theme.px(48))
        height: titleBox.height + rows * overlay.cellHeight + Theme.px(34)
        x: (overlay.width - width) / 2
        y: Math.max(Theme.px(16), Math.min((overlay.height - height) / 2 - Theme.px(40), Theme.px(Theme.tablet ? 70 : 40)))
        radius: Theme.px(10)
        color: "#E61A1C1F"
        border.color: "#8A8F96"
        border.width: Math.max(1, Theme.px(1))
        opacity: overlay.open && !overlay.carrying ? 1 : 0
        scale: overlay.open ? 1 : 0.9
        Behavior on opacity { NumberAnimation { duration: Theme.motion(200) } }
        Behavior on scale { NumberAnimation { duration: Theme.motion(200); easing.type: Easing.OutCubic } }
        MouseArea { anchors.fill: parent; onPressed: if (overlay.editing) overlay.finishRename() }

        // The name: a tap makes it a field.
        Rectangle {
            id: titleBox
            x: Theme.px(18)
            y: Theme.px(12)
            width: panel.width - 2 * x
            height: Theme.px(Theme.tablet ? 38 : 34)
            radius: Theme.px(6)
            color: overlay.editing ? "#000000" : "transparent"
            border.color: overlay.editing ? "#7FA6E8" : "transparent"
            border.width: Theme.px(2)
            Text {
                objectName: "launcherGroupTitle"
                anchors.fill: parent
                visible: !overlay.editing
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
                elide: Text.ElideRight
                text: overlay.title
                color: "#FFFFFF"
                font.family: Theme.fontFamily
                font.pixelSize: Theme.px(Theme.tablet ? 22 : 19)
                font.bold: true
            }
            MouseArea {
                objectName: "launcherGroupTitleArea"
                anchors.fill: parent
                enabled: !overlay.editing
                onClicked: overlay.startRename()
            }
            TextInput {
                id: titleField
                objectName: "launcherGroupTitleField"
                anchors.fill: parent
                anchors.leftMargin: Theme.px(8)
                anchors.rightMargin: Theme.px(8)
                visible: overlay.editing
                verticalAlignment: TextInput.AlignVCenter
                horizontalAlignment: TextInput.AlignHCenter
                color: "#FFFFFF"
                selectionColor: "#2C8CE0"
                font.family: Theme.fontFamily
                font.pixelSize: Theme.px(Theme.tablet ? 22 : 19)
                font.bold: true
                maximumLength: 24
                clip: true
                inputMethodHints: Qt.ImhNoPredictiveText
                Keys.onReturnPressed: overlay.finishRename()
                Keys.onEnterPressed: overlay.finishRename()
                Keys.onEscapePressed: { titleField.focus = false; }
            }
        }

        Item {
            id: grid
            x: (panel.width - Math.min(overlay.members.length, overlay.columns) * overlay.cellWidth) / 2
            y: titleBox.y + titleBox.height + Theme.px(12)
            width: Math.min(overlay.members.length, overlay.columns) * overlay.cellWidth
            height: panel.rows * overlay.cellHeight
            Repeater {
                model: overlay.members
                delegate: Item {
                    required property var modelData
                    required property int index
                    objectName: "launcherGroupMember_" + modelData.appId
                    width: overlay.cellWidth
                    height: overlay.cellHeight
                    x: (index % overlay.columns) * overlay.cellWidth
                    y: Math.floor(index / overlay.columns) * overlay.cellHeight
                    opacity: overlay.heldId === modelData.appId && memberMouse.dragged ? 0 : 1
                    AppIcon {
                        anchors.horizontalCenter: parent.horizontalCenter
                        title: modelData.title
                        color: modelData.color
                        glyph: modelData.glyph
                        source: modelData.icon
                        largeSource: modelData.largeIcon
                        interactive: false
                    }
                }
            }
            MouseArea {
                id: memberMouse
                anchors.fill: parent
                acceptedButtons: Qt.LeftButton | Qt.RightButton
                pressAndHoldInterval: Theme.iconMenuHoldInterval
                preventStealing: overlay.heldId !== ""
                property int pressed_: -1
                property point heldAt
                property bool dragged: false
                function indexAt(mx, my) {
                    var col = Math.floor(mx / overlay.cellWidth), row = Math.floor(my / overlay.cellHeight);
                    var i = row * overlay.columns + col;
                    return col >= 0 && col < overlay.columns && row >= 0 && i < overlay.members.length ? i : -1;
                }
                onPressed: (mouse) => {
                    if (overlay.editing)
                        overlay.finishRename();
                    pressed_ = indexAt(mouse.x, mouse.y);
                    dragged = false;
                    overlay.heldId = "";
                    if (mouse.button === Qt.RightButton && pressed_ >= 0)
                        overlay.menuRequested(overlay.members[pressed_].appId, overlay.iconRect(pressed_));
                }
                onPressAndHold: (mouse) => {
                    if (pressed_ < 0 || mouse.button !== Qt.LeftButton)
                        return;
                    overlay.heldId = overlay.members[pressed_].appId;
                    heldAt = Qt.point(mouse.x, mouse.y);
                    overlay.menuRequested(overlay.heldId, overlay.iconRect(pressed_));
                }
                onPositionChanged: (mouse) => {
                    if (overlay.heldId !== "" && !dragged
                            && Math.hypot(mouse.x - heldAt.x, mouse.y - heldAt.y) > Qt.styleHints.startDragDistance) {
                        dragged = true;
                        overlay.carrying = true;
                        var p = mapToItem(overlay, mouse.x, mouse.y);
                        overlay.dragOutRequested(overlay.heldId, p.x, p.y);
                    } else if (dragged) {
                        var q = mapToItem(overlay, mouse.x, mouse.y);
                        overlay.dragMoved(q.x, q.y);
                    }
                }
                onReleased: (mouse) => {
                    overlay.heldId = "";
                    if (dragged) {
                        dragged = false;
                        var p = mapToItem(overlay, mouse.x, mouse.y);
                        overlay.dragEnded(p.x, p.y);
                        overlay.closeRequested();
                    }
                }
                onCanceled: { overlay.heldId = ""; pressed_ = -1; dragged = false; overlay.carrying = false; }
                onClicked: (mouse) => {
                    var i = indexAt(mouse.x, mouse.y);
                    if (i < 0 || mouse.button !== Qt.LeftButton || i !== pressed_)
                        return;
                    overlay.launchRequested(overlay.members[i].appId);
                }
            }
        }
    }
}
