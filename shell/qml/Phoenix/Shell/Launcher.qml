// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The launcher: tabbed pages of app icons ("Apps", "Downloads", "Settings",
// from conf/default-launcher-page-layout.json) over a dark translucent
// backdrop, swiped sideways between pages.
//
// It slides up from below the screen, behind the quick launch dock
// (OverlayWindowManager.cpp:102-104 Z_LAUNCHER_WIN 0 < Z_DOCK_WIN 20;
// :1451-1485, :1919-1955), over 350 ms with curve 15 = InOutQuint
// (conf/lunaAnimations.conf:83-84). The dock stays where it is, on top.

import QtQuick

Item {
    id: launcher

    property var apps
    property bool open: false

    signal launchRequested(string appId)
    signal closeRequested

    readonly property var tabs: ["Apps", "Downloads", "Settings"]

    // Room left at the bottom for the dock, which sits on top of the launcher.
    property real dockHeight: 0

    // 0 = shown, 1 = below the screen.
    property real hidden: open ? 0 : 1
    Behavior on hidden { NumberAnimation { duration: Theme.launcherDuration; easing.type: Easing.InOutQuint } }
    visible: hidden < 1

    transform: Translate { y: launcher.hidden * (launcher.height + Theme.statusBarHeight) }

    Rectangle {
        anchors.fill: parent
        color: Theme.launcherScrim
    }
    Image {
        anchors.fill: parent
        source: Theme.asset("launcher3/launcher-bg.png")
        fillMode: Image.Tile
        opacity: 0.35
    }

    // Swallow touches so they don't reach the cards underneath.
    MouseArea { anchors.fill: parent }

    // ---- Tab strip ---------------------------------------------------------

    BorderImage {
        id: tabBar
        width: parent.width
        height: Theme.launcherTabHeight
        source: Theme.asset("launcher3/tab-bg.png")
        border { left: 4; right: 4; top: 4; bottom: 4 }
        horizontalTileMode: BorderImage.Stretch

        Row {
            anchors.fill: parent
            Repeater {
                model: launcher.tabs
                delegate: Item {
                    required property string modelData
                    required property int index
                    width: tabBar.width / launcher.tabs.length
                    height: tabBar.height

                    BorderImage {
                        anchors.fill: parent
                        visible: pages.currentIndex === index
                        source: Theme.asset("launcher3/tab-selected-bg.png")
                        border { left: 4; right: 4; top: 4; bottom: 4 }
                    }
                    Text {
                        anchors.centerIn: parent
                        text: modelData
                        color: pages.currentIndex === index ? Theme.text : Theme.textDim
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.px(Theme.tablet ? 18 : 15)
                        font.bold: pages.currentIndex === index
                    }
                    Image {
                        visible: index > 0
                        anchors.left: parent.left
                        height: parent.height
                        source: Theme.asset("launcher3/tab-divider.png")
                    }
                    MouseArea {
                        anchors.fill: parent
                        onClicked: pages.currentIndex = index
                    }
                }
            }
        }
    }

    Image {
        anchors.top: tabBar.bottom
        width: parent.width
        z: 1
        source: Theme.asset("launcher3/tab-shadow.png")
        fillMode: Image.Stretch
    }

    // ---- Pages ------------------------------------------------------------------

    ListView {
        id: pages
        anchors.top: tabBar.bottom
        anchors.bottom: parent.bottom
        anchors.bottomMargin: launcher.dockHeight
        width: parent.width
        orientation: ListView.Horizontal
        snapMode: ListView.SnapOneItem
        highlightRangeMode: ListView.StrictlyEnforceRange
        highlightMoveDuration: Theme.cardSlideDuration
        boundsBehavior: Flickable.StopAtBounds
        clip: true
        model: launcher.tabs.length

        delegate: GridView {
            id: grid
            required property int index
            width: pages.width
            height: pages.height
            clip: true
            topMargin: Theme.px(16)
            readonly property int columns: Theme.launcherColumns
            cellWidth: width / columns
            cellHeight: Theme.launcherIconSize + Theme.px(48)

            model: {
                var list = [];
                if (!launcher.apps)
                    return list;
                for (var i = 0; i < launcher.apps.count; ++i) {
                    var a = launcher.apps.get(i);
                    if (a.tab === index)
                        list.push({ appId: a.appId, title: a.title, color: a.color, glyph: a.glyph, icon: a.icon });
                }
                list.sort(function(x, y) { return x.title.localeCompare(y.title); });
                return list;
            }

            delegate: Item {
                required property var modelData
                width: grid.cellWidth
                height: grid.cellHeight
                AppIcon {
                    anchors.horizontalCenter: parent.horizontalCenter
                    title: modelData.title
                    color: modelData.color
                    glyph: modelData.glyph
                    source: modelData.icon
                    onClicked: launcher.launchRequested(modelData.appId)
                }
            }
        }
    }

    Image {
        anchors.bottom: parent.bottom
        width: parent.width
        source: Theme.asset("launcher3/launcher-scrollfade-bottom.png")
        fillMode: Image.Stretch
    }
}
