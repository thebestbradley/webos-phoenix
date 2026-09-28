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

    // Icon order on each page (LauncherLayout.js).
    property var layout: null
    // Edit mode: icons on edit tiles, delete decorators, a Done button.
    property bool editMode: false
    // The icon being dragged ("" when none); the shell moves it.
    property string draggedId: ""
    readonly property bool dragging: draggedId !== ""

    signal launchRequested(string appId)
    signal closeRequested
    signal deleteRequested(string appId)
    // Press and hold picked an icon up; positions are in launcher coordinates.
    signal dragStarted(string appId, string from, real x, real y)
    signal dragMoved(real x, real y)
    signal dragEnded(real x, real y)

    onOpenChanged: if (!open) editMode = false

    // The icon showing launch feedback, until the launcher has finished
    // hiding or the timeout (LauncherObject::setAppLaunchFeedback /
    // cancelLaunchFeedback, dimensionslauncher.cpp:2926-2995;
    // slotLauncherFullyClosed, :3505).
    property string feedbackId: ""
    onHiddenChanged: if (hidden === 1) feedbackId = ""
    Timer {
        running: launcher.feedbackId !== ""
        interval: Theme.launchFeedbackTimeout
        onTriggered: launcher.feedbackId = ""
    }

    readonly property var tabs: ["Apps", "Downloads", "Settings"]

    // Room left at the bottom for the dock, which sits on top of the launcher.
    property real dockHeight: 0

    // 0 = shown, 1 = below the screen.
    property real hidden: open ? 0 : 1
    Behavior on hidden { NumberAnimation { duration: Theme.launcherDuration; easing.type: Easing.InOutQuint } }
    visible: hidden < 1

    transform: Translate { y: launcher.hidden * (launcher.height + Theme.statusBarHeight) }

    // Opaque tiled background (dimensionslauncher.cpp:1290, 1592).
    Image {
        anchors.fill: parent
        source: Theme.asset("launcher3/launcher-bg.png")
        fillMode: Image.Tile
    }

    // Swallow touches so they don't reach the cards underneath.
    MouseArea { anchors.fill: parent }

    // ---- Tab strip ---------------------------------------------------------

    BorderImage {
        id: tabBar
        width: parent.width
        height: Theme.launcherTabHeight
        source: Theme.asset("launcher3/tab-bg.png")
        border { left: Theme.artBorder(4, source); right: Theme.artBorder(4, source); top: Theme.artBorder(4, source); bottom: Theme.artBorder(4, source) }
        horizontalTileMode: BorderImage.Stretch

        Row {
            anchors.fill: parent
            Repeater {
                model: launcher.tabs
                delegate: Item {
                    required property string modelData
                    required property int index
                    width: launcher.tabWidth
                    height: tabBar.height

                    BorderImage {
                        anchors.fill: parent
                        visible: pages.currentIndex === index
                        source: Theme.asset("launcher3/tab-selected-bg.png")
                        border { left: Theme.artBorder(4, source); right: Theme.artBorder(4, source); top: Theme.artBorder(4, source); bottom: Theme.artBorder(4, source) }
                    }
                    Text {
                        anchors.centerIn: parent
                        width: parent.width - Theme.px(6)
                        horizontalAlignment: Text.AlignHCenter
                        elide: Text.ElideRight
                        text: modelData
                        color: pages.currentIndex === index ? Theme.launcherTabSelectedColor : Theme.launcherTabColor
                        font.family: Theme.fontFamily
                        // Phones in edit mode: smaller, to leave Done its room
                        // (the phone launcher is not in the open source).
                        font.pixelSize: !Theme.tablet && launcher.editMode ? Theme.px(12) : Theme.launcherTabFontSize
                        font.bold: true
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

    // Done: leaves edit mode. Right end of the tab bar (dimensionslauncher.cpp:
    // 94-114, 1323-1331); a 98x34 sprite, normal at y 2, pressed at y 42.
    Item {
        id: doneButton
        visible: launcher.editMode
        anchors.right: tabBar.right
        anchors.rightMargin: Theme.px(6)
        anchors.verticalCenter: tabBar.verticalCenter
        width: Theme.px(98)
        height: Theme.px(34)
        z: 2
        clip: true
        Image {
            x: -Theme.px(1)
            y: doneMouse.pressed ? -Theme.px(42) : -Theme.px(2)
            width: Theme.px(100)
            height: Theme.px(80)
            source: Theme.asset("launcher3/edit-button-done.png")
        }
        Text {
            anchors.centerIn: parent
            text: qsTr("Done")
            color: Theme.text
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(16)
            font.bold: true
        }
        MouseArea {
            id: doneMouse
            anchors.fill: parent
            onClicked: launcher.editMode = false
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
    // Each page keeps its icons in a ListModel that follows the layout with
    // moves, so icons slide to their new places while one is dragged
    // (iconreorderanimation.cpp).

    property var pageModels: []
    Component { id: pageModelComponent; ListModel {} }
    Component.onCompleted: {
        var ms = [];
        for (var i = 0; i < tabs.length; ++i)
            ms.push(pageModelComponent.createObject(launcher));
        pageModels = ms;
        syncPages();
    }
    onLayoutChanged: syncPages()
    onAppsChanged: syncPages()

    function entry(id) {
        if (!apps)
            return null;
        for (var i = 0; i < apps.count; ++i)
            if (apps.get(i).appId === id)
                return apps.get(i);
        return null;
    }

    function syncPages() {
        if (!layout || pageModels.length === 0)
            return;
        for (var p = 0; p < pageModels.length; ++p) {
            var m = pageModels[p], ids = layout.pages[p] || [];
            for (var i = 0; i < ids.length; ++i) {
                if (i < m.count && m.get(i).appId === ids[i])
                    continue;
                var j = -1;
                for (var k = i + 1; k < m.count; ++k)
                    if (m.get(k).appId === ids[i]) { j = k; break; }
                if (j >= 0) {
                    m.move(j, i, 1);
                } else {
                    var e = entry(ids[i]);
                    m.insert(i, { appId: ids[i], title: e ? e.title : ids[i], color: e ? String(e.color) : "#666666",
                                  glyph: e ? e.glyph : "", icon: e ? String(e.icon || "") : "",
                                  largeIcon: e ? String(e.largeIcon || "") : "",
                                  removable: e ? !!e.removable : false });
                }
            }
            while (m.count > ids.length)
                m.remove(m.count - 1);
        }
    }

    // As many columns as fit, up to launcherColumns.
    readonly property int columns: Theme.tablet
        ? Math.max(1, Math.min(Theme.launcherColumns, Math.floor((pages.width - Theme.launcherRowLeftMargin) / Theme.launcherCellPitch)))
        : Theme.launcherColumns
    readonly property real cellWidth: Theme.tablet ? Theme.launcherCellPitch : pages.width / columns
    readonly property real cellHeight: Theme.tablet ? Theme.launcherRowPitch : Theme.launcherIconSize + Theme.px(48)
    readonly property real rowLeft: Theme.tablet ? Theme.launcherRowLeftMargin : 0
    readonly property real pageTopMargin: Theme.px(16)

    // Grid index at a point in the current page (launcher coordinates), for drops.
    function indexAt(lx, ly) {
        var page = pages.currentItem;
        if (!page)
            return -1;
        var p = launcher.mapToItem(page.contentItem, lx, ly);
        var col = Math.max(0, Math.min(launcher.columns - 1, Math.floor((p.x - rowLeft) / cellWidth)));
        var row = Math.max(0, Math.floor((p.y - pageTopMargin) / cellHeight));
        return Math.min(row * launcher.columns + col, pageModels[pages.currentIndex].count - 1);
    }
    // Tabs share the bar from its left, each at most 150 px
    // (PageTabBar::newTabMaxSize, pagetabbar.cpp:85, 631-642); in edit mode
    // they leave room for Done.
    readonly property real tabWidth: Math.min(Theme.launcherTabMaxWidth,
        (tabBar.width - (editMode ? doneButton.width + Theme.px(12) : 0)) / tabs.length)

    // Tab under a point (launcher coordinates), or -1.
    function tabAt(lx, ly) {
        if (ly < 0 || ly > tabBar.height || lx >= tabWidth * tabs.length)
            return -1;
        return Math.max(0, Math.min(tabs.length - 1, Math.floor(lx / tabWidth)));
    }
    // The page area, in launcher coordinates.
    function inPages(lx, ly) {
        return ly >= pages.y && ly < pages.y + pages.height;
    }
    readonly property int currentPage: pages.currentIndex
    function showPage(i) { pages.currentIndex = i; }

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
        interactive: !launcher.dragging
        clip: true
        model: launcher.tabs.length

        delegate: Flickable {
            id: page
            required property int index
            readonly property var model: launcher.pageModels[index] || null
            width: pages.width
            height: pages.height
            clip: true
            interactive: !launcher.dragging
            contentWidth: width
            contentHeight: launcher.pageTopMargin
                           + Math.ceil((model ? model.count : 0) / launcher.columns) * launcher.cellHeight

            Repeater {
                model: page.model
                delegate: Item {
                    id: cell
                    required property int index
                    required property string appId
                    required property string title
                    required property string color
                    required property string glyph
                    required property string icon
                    required property string largeIcon
                    required property bool removable
                    width: Theme.tablet ? Theme.launcherCellSize : launcher.cellWidth
                    height: launcher.cellHeight
                    x: launcher.rowLeft + (index % launcher.columns) * launcher.cellWidth
                    y: launcher.pageTopMargin + Math.floor(index / launcher.columns) * launcher.cellHeight
                    Behavior on x { NumberAnimation { duration: Theme.launcherReorderDuration; easing.type: Easing.InQuad } }
                    Behavior on y { NumberAnimation { duration: Theme.launcherReorderDuration; easing.type: Easing.InQuad } }
                    // The dragged icon travels under the finger (the shell's drag proxy).
                    opacity: launcher.draggedId === appId ? 0 : 1

                    // Edit mode: the icon sits on the edit tile (edit-icon-bg.png).
                    Image {
                        visible: launcher.editMode
                        anchors.horizontalCenter: iconItem.horizontalCenter
                        y: iconItem.y + (Theme.launcherIconSize - height) / 2
                        width: Theme.launcherIconSize * 1.5
                        height: width
                        source: Theme.asset("launcher3/edit-icon-bg.png")
                    }
                    AppIcon {
                        id: iconItem
                        anchors.horizontalCenter: parent.horizontalCenter
                        // Tablet: 11 px above the 128 px cell's centre.
                        y: Theme.tablet ? Theme.launcherCellSize / 2 + Theme.launcherIconOffsetY - Theme.launcherIconSize / 2 : 0
                        title: cell.title
                        color: cell.color
                        glyph: cell.glyph
                        source: cell.icon
                        largeSource: cell.largeIcon
                        interactive: false
                        feedback: launcher.feedbackId === cell.appId
                    }
                    // Delete decorator at the icon's top left for apps that can
                    // be deleted (icongeometrysettings.cpp:190-197; the sprite's
                    // top half is the normal state).
                    Item {
                        visible: launcher.editMode && cell.removable
                        x: iconItem.x - Theme.px(8)
                        y: iconItem.y - Theme.px(8)
                        width: Theme.px(28)
                        height: width
                        clip: true
                        Image {
                            width: parent.width
                            height: parent.height * 2
                            source: Theme.asset("launcher3/edit-button-delete.png")
                        }
                    }
                }
            }

            // One area for the whole page: tap launches, press and hold enters
            // edit mode and picks the icon up (reorderablepage.cpp:450-540).
            MouseArea {
                id: pageMouse
                width: page.contentWidth
                height: Math.max(page.contentHeight, page.height)
                pressAndHoldInterval: Theme.tapAndHoldInterval
                preventStealing: launcher.dragging
                property string pressedId: ""

                function cellAt(mx, my) {
                    var col = Math.floor((mx - launcher.rowLeft) / launcher.cellWidth);
                    var row = Math.floor((my - launcher.pageTopMargin) / launcher.cellHeight);
                    var i = row * launcher.columns + col;
                    if (row < 0 || col < 0 || col >= launcher.columns || !page.model || i >= page.model.count)
                        return null;
                    return { index: i, x: mx - launcher.rowLeft - col * launcher.cellWidth, y: my - launcher.pageTopMargin - row * launcher.cellHeight };
                }

                onPressed: (mouse) => {
                    var c = cellAt(mouse.x, mouse.y);
                    pressedId = c ? page.model.get(c.index).appId : "";
                }
                onPressAndHold: (mouse) => {
                    if (pressedId === "")
                        return;
                    launcher.editMode = true;
                    var sp = mapToItem(launcher, mouse.x, mouse.y);
                    launcher.dragStarted(pressedId, "page", sp.x, sp.y);
                }
                onPositionChanged: (mouse) => {
                    if (launcher.dragging) {
                        var sp = mapToItem(launcher, mouse.x, mouse.y);
                        launcher.dragMoved(sp.x, sp.y);
                    }
                }
                onReleased: (mouse) => {
                    if (launcher.dragging) {
                        var sp = mapToItem(launcher, mouse.x, mouse.y);
                        launcher.dragEnded(sp.x, sp.y);
                    }
                }
                onClicked: (mouse) => {
                    var c = cellAt(mouse.x, mouse.y);
                    if (!c)
                        return;
                    var item = page.model.get(c.index);
                    if (launcher.editMode) {
                        // The delete decorator, top left of the icon.
                        var cellW = Theme.tablet ? Theme.launcherCellSize : launcher.cellWidth;
                        var iconLeft = (cellW - Theme.launcherIconSize) / 2;
                        var iconTop = Theme.tablet ? Theme.launcherCellSize / 2 + Theme.launcherIconOffsetY - Theme.launcherIconSize / 2 : 0;
                        if (item.removable && c.x < iconLeft + Theme.px(24) && c.x > iconLeft - Theme.px(12)
                                && c.y < iconTop + Theme.px(24) && c.y > iconTop - Theme.px(12))
                            launcher.deleteRequested(item.appId);
                        return;
                    }
                    launcher.feedbackId = item.appId;
                    launcher.launchRequested(item.appId);
                }
                onCanceled: pressedId = ""
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
