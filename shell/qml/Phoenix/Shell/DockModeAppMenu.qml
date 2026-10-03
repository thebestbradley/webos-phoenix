// Copyright (c) 2026 webOS Phoenix contributors
// Copyright (c) 2010-2013 Hewlett-Packard Development Company, L.P. (the original)
// SPDX-License-Identifier: Apache-2.0
//
// Dock mode's app menu: the exhibitions to choose from, dropping from the
// status bar's title ("Choose an App" while it is open). A port of
// luna-sysmgr's uiComponents/DockModeAppMenu/DockModeAppMenu.qml on
// uiComponents/MenuContainer, with the rows DockModeAppMenuContainer drew
// in C++ (Src/lunaui/dock/DockModeAppMenuContainer.cpp):
//
//   - 320 px wide (kAppMenuWidth, DockModeMenuManager.cpp:60) inside
//     menu-dropdown-bg.png (borders 30/10/30/30, the contents 11 px in at
//     the sides and 15 px above the bottom), its left edge 11 px off the
//     screen (edgeOffset), under the status bar.
//   - rows of 70 px (ITEM_HEIGHT): the app's icon at 48 px, 10 px in and
//     centred, then its exhibition title (appinfo.json
//     exhibitionModeOptions.title) in 18 px bold Prelude, white, 10 px after
//     the icon; menu-divider.png under every row but the last
//     (setAsLast); menu-selection-gradient-default.png behind a row while
//     it is pressed.
//   - at most 5.5 rows showing (MAX_ITEMS_VISIBLE), then it scrolls; a
//     scroll lifts the press (mouseWasGrabbedByParent).
//   - a tap on a row picks that exhibition and closes the menu
//     (DockModeMenuManager::slotDockModeAppSelected); a tap outside closes
//     it (handleMousePress / mouseReleaseEvent).
//   - it fades in and out with the status bar group, 200 ms.

import QtQuick

Item {
    id: menu
    objectName: "dockModeAppMenu"

    // [{appId, title, icon}]
    property var apps: []
    property bool open: false
    signal selected(string appId)
    signal closeRequested

    readonly property real edgeOffset: Theme.px(11)
    readonly property real rowHeight: Theme.px(70)
    readonly property real dividerHeight: Theme.px(2)
    readonly property real maxHeight: 5.5 * rowHeight

    visible: open || panel.opacity > 0

    // A tap outside closes it.
    MouseArea {
        anchors.fill: parent
        enabled: menu.open
        onClicked: menu.closeRequested()
    }

    Item {
        id: panel
        objectName: "dockModeAppMenuPanel"
        x: -menu.edgeOffset
        // Right under the status bar: dock mode itself starts there.
        y: 0
        width: Math.min(Theme.px(320), menu.width) + 2 * menu.edgeOffset
        height: Math.max(Theme.px(40), Math.min(menu.maxHeight, column.height) + Theme.px(15))
        opacity: menu.open ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.statusBarMenuFadeDuration } }

        ArtBorderImage {
            anchors.fill: parent
            source: Theme.asset("menu-dropdown-bg.png")
            border { left: Theme.artBorder(30, source); top: Theme.artBorder(10, source); right: Theme.artBorder(30, source); bottom: Theme.artBorder(30, source) }
            MouseArea { anchors.fill: parent }   // swallow taps between rows
        }

        Flickable {
            id: flick
            x: menu.edgeOffset
            width: parent.width - 2 * menu.edgeOffset
            height: Math.min(menu.maxHeight, column.height)
            contentHeight: column.height
            clip: true
            interactive: column.height > height
            boundsBehavior: Flickable.StopAtBounds

            Column {
                id: column
                width: flick.width
                Repeater {
                    model: menu.apps
                    delegate: Item {
                        id: row
                        required property var modelData
                        required property int index
                        readonly property bool last: index === menu.apps.length - 1
                        objectName: "dockModeMenuItem_" + modelData.appId
                        width: column.width
                        height: menu.rowHeight + (last ? 0 : menu.dividerHeight)
                        Image {
                            anchors.fill: parent
                            anchors.bottomMargin: row.last ? 0 : menu.dividerHeight
                            visible: area.pressed && area.containsMouse && !flick.moving
                            source: Theme.asset("menu-selection-gradient-default.png")
                        }
                        AppIcon {
                            x: Theme.px(10)
                            y: (menu.rowHeight - height) / 2
                            size: Theme.px(48)
                            showLabel: false
                            interactive: false
                            source: row.modelData.icon || ""
                            glyph: (row.modelData.title || "").charAt(0)
                        }
                        Text {
                            x: Theme.px(10 + 48 + 10)
                            width: parent.width - x - Theme.px(10)
                            height: menu.rowHeight
                            verticalAlignment: Text.AlignVCenter
                            elide: Text.ElideRight
                            text: row.modelData.title
                            color: "#ffffff"
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.px(18)
                            font.bold: true
                        }
                        Image {
                            visible: !row.last
                            anchors.bottom: parent.bottom
                            width: parent.width
                            height: menu.dividerHeight
                            source: Theme.asset("menu-divider.png")
                        }
                        MouseArea {
                            id: area
                            anchors.fill: parent
                            enabled: menu.open
                            onClicked: {
                                if (flick.moving)
                                    return;
                                menu.selected(row.modelData.appId);
                                menu.closeRequested();
                            }
                        }
                    }
                }
            }
        }
    }
}
