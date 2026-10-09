// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The launcher: tabbed pages of app icons ("Apps", "Downloads",
// "Favorites", "Settings": conf/default-launcher-page-layout.json and the
// Favorites page LauncherObject::initPages adds; LauncherLayout.PAGES)
// over a dark translucent backdrop, swiped sideways between pages.
//
// It slides up from below the screen, behind the quick launch dock
// (OverlayWindowManager.cpp:102-104 Z_LAUNCHER_WIN 0 < Z_DOCK_WIN 20;
// :1451-1485, :1919-1955), over 350 ms with curve 15 = InOutQuint
// (conf/lunaAnimations.conf:83-84). The dock stays where it is, on top.

import QtQuick
import "LauncherLayout.js" as LauncherLayout

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
    // A tap on an app still being installed, or whose install failed (the
    // original sent the launch of an app not ready to Software Manager,
    // WebAppMgrProxy.cpp:544-559).
    signal pendingTapped(string appId)
    // The dragged icon was taken to another page by the page edges.
    signal dragPageChanged(int page)
    // Press and hold picked an icon up; positions are in launcher coordinates.
    signal dragStarted(string appId, string from, real x, real y)
    signal dragMoved(real x, real y)
    signal dragEnded(real x, real y)
    // Press and hold or a right click asks for the icon's menu; iconRect is
    // the icon in launcher coordinates (IconMenu.qml). from: "page", or
    // "group" for an app in the open group.
    signal menuRequested(string appId, string from, rect iconRect)

    // ---- Groups and tabs (LunaCE; docs/M6-PLAN.md F4) ---------------------------
    // The shell changes the layout: a group renamed, a tab added, renamed
    // or removed; an app carried out of the open group (dragStarted from
    // "group" follows).
    signal groupRenamed(string groupId, string title)
    signal tabAdded(string title)
    signal tabRenamed(int index, string title)
    signal tabRemoved(int index)
    signal groupDragOut(string appId)

    // Settings > Advanced > Launcher grid: "dense" fits more icons (the
    // community's icon grid patches, 4 x 4 and 5 x 5 on the Pre).
    property string gridDensity: "normal"
    readonly property bool dense: gridDensity === "dense"

    // The open group's id ("" for none).
    property string openGroupId: ""
    function openGroup(id) {
        if (!layout || !layout.groups || !layout.groups[id])
            return;
        keyIndex = -1;
        openGroupId = id;
    }
    function closeGroup() { openGroupId = ""; }
    // The group shown: its title and its apps, as the page's icons show them.
    readonly property var openGroupData: {
        var g = layout && layout.groups && openGroupId !== "" ? layout.groups[openGroupId] : null;
        if (!g)
            return null;
        return { title: g.title, members: g.members.map(function(id) { return _cellData(id); }) };
    }

    // The tab strip's "+" (LunaCE: a press and hold on the empty part of
    // the strip shows it, while there is room for another tab). Phones have
    // no empty part: there, and on tablets too, edit mode shows it.
    property bool addTabShown: false
    readonly property bool canAddTab: !!layout && LauncherLayout.canAddTab(layout)
    readonly property bool addTabVisible: canAddTab && (addTabShown || editMode)
    readonly property real addTabWidth: addTabVisible ? Theme.px(Theme.tablet ? 70 : 44) : 0
    function askNewTab() {
        addTabShown = false;
        editMode = false;
        nameDialog.target = -1;
        nameDialog.show(qsTr("New Tab"), "", false);
    }
    function askRenameTab(i) {
        if (i < 0 || i >= tabs.length)
            return;
        addTabShown = false;
        nameDialog.target = i;
        nameDialog.show(qsTr("Rename Tab"), tabs[i], LauncherLayout.isUserTab(layout, i));
    }
    // Back or Esc: the name dialog, the open group, the "+" go first.
    function closeOverlay() {
        if (nameDialog.open) {
            nameDialog.close();
            return true;
        }
        if (groupView.editing) {
            groupView.finishRename();
            return true;
        }
        if (openGroupId !== "") {
            closeGroup();
            return true;
        }
        if (addTabShown) {
            addTabShown = false;
            return true;
        }
        return false;
    }

    onOpenChanged: {
        if (!open) {
            editMode = false;
            openGroupId = "";
            addTabShown = false;
            nameDialog.close();
        }
        keyIndex = -1;
    }
    onCurrentPageChanged: if (keyIndex >= 0) keyIndex = Math.min(keyIndex, Math.max(0, _pageCount(currentPage) - 1))

    // ---- Keyboard navigation (GAPS V8 (3)) -----------------------------------------
    // The arrows move a focus ring over the page's icons (past its left or
    // right edge to the page beside), Tab / Shift+Tab go to the next /
    // previous page (Home is the device's Home button), Enter or Space
    // opens the icon as a tap would, the Menu key (or Shift+F10) opens its
    // icon menu, Esc closes the launcher.
    property int keyIndex: -1
    function _pageCount(i) {
        var m = pageModels[i];
        return m ? m.count : 0;
    }
    function _keyActivate() {
        var m = pageModels[currentPage];
        if (!m || keyIndex < 0 || keyIndex >= m.count)
            return;
        var item = m.get(keyIndex);
        if (editMode)
            return;
        if (item.isGroup) {
            openGroup(item.appId);
            return;
        }
        if (item.installState !== "") {
            pendingTapped(item.appId);
            return;
        }
        feedbackId = item.appId;
        launchRequested(item.appId);
    }
    function handleKey(event) {
        if (!open || dragging)
            return false;
        var k = event.key, n = _pageCount(currentPage), cols = columns;
        var shift = (event.modifiers & Qt.ShiftModifier) || k === Qt.Key_Backtab;
        if (k === Qt.Key_Escape && closeOverlay())
            return true;
        if (openGroupId !== "" || nameDialog.open)
            return false;
        if (k === Qt.Key_Escape) {
            if (editMode)
                editMode = false;
            else
                closeRequested();
            return true;
        }
        if (k === Qt.Key_Tab || k === Qt.Key_Backtab) {
            showPage((currentPage + (shift ? tabs.length - 1 : 1)) % tabs.length);
            keyIndex = _pageCount(currentPage) > 0 ? 0 : -1;
            return true;
        }
        if (k === Qt.Key_Return || k === Qt.Key_Enter || k === Qt.Key_Space) {
            _keyActivate();
            return true;
        }
        if (k === Qt.Key_Menu || (k === Qt.Key_F10 && (event.modifiers & Qt.ShiftModifier))) {
            if (keyIndex >= 0)
                requestMenu(keyIndex);
            return true;
        }
        if ([Qt.Key_Left, Qt.Key_Right, Qt.Key_Up, Qt.Key_Down].indexOf(k) < 0)
            return false;
        if (keyIndex < 0) {
            keyIndex = n > 0 ? 0 : -1;
            return true;
        }
        var i = keyIndex;
        if (k === Qt.Key_Up) i = i - cols >= 0 ? i - cols : i;
        else if (k === Qt.Key_Down) i = i + cols < n ? i + cols : i;
        else if (k === Qt.Key_Left) {
            if (i % cols === 0 && currentPage > 0) {
                showPage(currentPage - 1);
                keyIndex = Math.max(0, _pageCount(currentPage) - 1);
                return true;
            }
            i = Math.max(0, i - 1);
        } else if (k === Qt.Key_Right) {
            if ((i % cols === cols - 1 || i === n - 1) && currentPage < tabs.length - 1) {
                showPage(currentPage + 1);
                keyIndex = _pageCount(currentPage) > 0 ? 0 : -1;
                return true;
            }
            i = Math.min(n - 1, i + 1);
        }
        keyIndex = i;
        return true;
    }

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

    // The icon at index on page (a page of the view), in launcher coordinates.
    function _iconRect(page, i) {
        var cellW = Theme.tablet ? cellSize : cellWidth;
        var x = rowLeft + (i % columns) * cellWidth + (cellW - Theme.launcherIconSize) / 2;
        var y = pageTopMargin + Math.floor(i / columns) * cellHeight
                + (Theme.tablet ? cellSize / 2 + Theme.launcherIconOffsetY - Theme.launcherIconSize / 2 : 0);
        var p = page.contentItem.mapToItem(launcher, x, y);
        return Qt.rect(p.x, p.y, Theme.launcherIconSize, Theme.launcherIconSize);
    }
    // The icon menu of the icon at index on the current page (the Menu key
    // on the keyboard's ring, or Shift+F10; the simulator's scene).
    function requestMenu(index) {
        var m = pageModels[currentPage];
        if (!m || index < 0 || index >= m.count || editMode || m.get(index).installState !== "" || m.get(index).isGroup || !pages.currentItem)
            return false;
        menuRequested(m.get(index).appId, "page", _iconRect(pages.currentItem, index));
        return true;
    }

    // The page titles, in LauncherLayout.PAGES order (apps, downloads,
    // favorites, prefs), then the tabs the user added; a tab the user
    // renamed has its own (LauncherLayout.tabTitle).
    readonly property var _builtInTabs: [qsTr("Apps"), qsTr("Downloads"), qsTr("Favorites"), qsTr("Settings")]
    readonly property var tabs: {
        if (!layout)
            return _builtInTabs;
        var out = [];
        for (var i = 0; i < layout.pages.length; ++i) {
            var d = layout.designators ? layout.designators[i] : "";
            var own = layout.titles && layout.titles[d];
            out.push(own ? own : i < _builtInTabs.length ? _builtInTabs[i] : qsTr("New Tab"));
        }
        return out;
    }

    // Room left at the bottom for the dock, which sits on top of the launcher.
    property real dockHeight: 0

    // 0 = shown, 1 = below the screen.
    property real hidden: open ? 0 : 1
    Behavior on hidden { NumberAnimation { duration: Theme.launcherDuration; easing.type: Easing.InOutQuint } }
    visible: hidden < 1

    transform: Translate { y: launcher.hidden * (launcher.height + Theme.statusBarHeight) }

    // Opaque tiled background (dimensionslauncher.cpp:1290, 1592).
    ArtTiledImage {
        anchors.fill: parent
        source: Theme.asset("launcher3/launcher-bg.png")
        fillMode: Image.Tile
    }

    // Swallow touches so they don't reach the cards underneath.
    MouseArea { anchors.fill: parent }

    // ---- Tab strip ---------------------------------------------------------

    ArtBorderImage {
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

                    ArtBorderImage {
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
                        // (the phone launcher is not in the open source);
                        // and on phones a title that does not fit its quarter
                        // of the bar ("Downloads") is made smaller to fit,
                        // down to 12 px (9 px beside Done).
                        font.pixelSize: !Theme.tablet && launcher.editMode ? Theme.px(12) : Theme.launcherTabFontSize
                        fontSizeMode: Theme.tablet ? Text.FixedSize : Text.HorizontalFit
                        minimumPixelSize: launcher.editMode ? Theme.px(9) : Theme.px(12)
                        font.bold: true
                    }
                    Image {
                        visible: index > 0
                        anchors.left: parent.left
                        width: Theme.artWidth(source)
                        height: parent.height
                        source: Theme.asset("launcher3/tab-divider.png")
                    }
                    // A tap shows the page; press and hold names the tab
                    // (LunaCE).
                    MouseArea {
                        objectName: "launcherTab_" + index
                        anchors.fill: parent
                        pressAndHoldInterval: Theme.iconMenuHoldInterval
                        onClicked: { launcher.addTabShown = false; launcher.showPage(index); }
                        onPressAndHold: launcher.askRenameTab(index)
                    }
                }
            }
            // "+": a new tab (LunaCE; drawn, a plus in a tab's place).
            Item {
                id: addTab
                objectName: "launcherAddTab"
                visible: launcher.addTabVisible
                width: launcher.addTabWidth
                height: tabBar.height
                Image {
                    anchors.left: parent.left
                    width: Theme.artWidth(source)
                    height: parent.height
                    source: Theme.asset("launcher3/tab-divider.png")
                }
                Rectangle {
                    anchors.centerIn: parent
                    width: Theme.px(22); height: Theme.px(4); radius: height / 2
                    color: addMouse.pressed ? Theme.launcherTabSelectedColor : Theme.launcherTabColor
                }
                Rectangle {
                    anchors.centerIn: parent
                    width: Theme.px(4); height: Theme.px(22); radius: width / 2
                    color: addMouse.pressed ? Theme.launcherTabSelectedColor : Theme.launcherTabColor
                }
                MouseArea {
                    id: addMouse
                    anchors.fill: parent
                    onClicked: launcher.askNewTab()
                }
            }
        }
        // Press and hold on the strip past the tabs: the "+".
        MouseArea {
            objectName: "launcherTabStripEmpty"
            x: launcher.tabWidth * launcher.tabs.length + launcher.addTabWidth
            width: Math.max(0, parent.width - x)
            height: parent.height
            enabled: !launcher.editMode
            pressAndHoldInterval: Theme.iconMenuHoldInterval
            onPressAndHold: if (launcher.canAddTab) launcher.addTabShown = true
            onClicked: launcher.addTabShown = false
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
        height: Theme.artHeight(source)
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
    // One model a page; tabs come and go (LunaCE).
    function _ensurePageModels(n) {
        if (pageModels.length === n)
            return;
        var ms = pageModels.slice();
        while (ms.length < n)
            ms.push(pageModelComponent.createObject(launcher));
        while (ms.length > n)
            ms.pop().destroy();
        pageModels = ms;
    }
    Component.onCompleted: {
        _ensurePageModels(tabs.length);
        syncPages();
    }
    onLayoutChanged: {
        // The open group went (dissolved, or its last apps deleted). Not
        // while an app is carried out of it: it keeps the finger until it
        // lifts (LauncherGroup.carrying).
        if (openGroupId !== "" && !groupView.carrying && !(layout && layout.groups && layout.groups[openGroupId]))
            openGroupId = "";
        syncPages();
    }
    onAppsChanged: syncPages()
    // An entry's title, icon or install state changed in place.
    Connections {
        target: launcher.apps
        function onDataChanged() { Qt.callLater(launcher.syncPages); }
    }

    function entry(id) {
        if (!apps)
            return null;
        for (var i = 0; i < apps.count; ++i)
            if (apps.get(i).appId === id)
                return apps.get(i);
        return null;
    }

    // What a page's icon shows of its entry; a group shows its first apps
    // (groupIcons, JSON: AppIcon.groupIcons) and its name.
    function _cellData(id) {
        if (LauncherLayout.isGroup(id)) {
            var g = layout && layout.groups ? layout.groups[id] : null;
            var icons = (g ? g.members : []).slice(0, 4).map(function(m) {
                var me = entry(m);
                return { icon: me ? String(me.icon || "") : "", largeIcon: me ? String(me.largeIcon || "") : "",
                         color: me ? String(me.color) : "#666666", glyph: me ? me.glyph : "" };
            });
            return { appId: id, title: g ? g.title : "", color: "#2A2D31", glyph: "", icon: "", largeIcon: "",
                     removable: false, shortcut: false, installState: "", progress: -1,
                     isGroup: true, groupIcons: JSON.stringify(icons) };
        }
        var e = entry(id);
        return { isGroup: false, groupIcons: "",
                 appId: id, title: e ? e.title : id, color: e ? String(e.color) : "#666666",
                 glyph: e ? e.glyph : "", icon: e ? String(e.icon || "") : "",
                 largeIcon: e ? String(e.largeIcon || "") : "",
                 removable: e ? !!e.removable : false,
                 // A launch point an app added: the (x) remove decorator.
                 shortcut: e ? !!e.dynamic : false,
                 installState: e && e.installState ? String(e.installState) : "",
                 progress: e && typeof e.progress === "number" ? e.progress : -1 };
    }

    function syncPages() {
        if (!layout)
            return;
        _ensurePageModels(layout.pages.length);
        if (pages.currentIndex >= layout.pages.length)
            showPage(layout.pages.length - 1, true);
        for (var p = 0; p < pageModels.length; ++p) {
            var m = pageModels[p], ids = layout.pages[p] || [];
            for (var i = 0; i < ids.length; ++i) {
                if (i < m.count && m.get(i).appId === ids[i]) {
                    var now = _cellData(ids[i]), was = m.get(i);
                    for (var key in now)
                        if (was[key] !== now[key])
                            m.setProperty(i, key, now[key]);
                    continue;
                }
                var j = -1;
                for (var k = i + 1; k < m.count; ++k)
                    if (m.get(k).appId === ids[i]) { j = k; break; }
                if (j >= 0)
                    m.move(j, i, 1);
                else
                    m.insert(i, _cellData(ids[i]));
                var d = _cellData(ids[i]), cur = m.get(i);
                for (var key2 in d)
                    if (cur[key2] !== d[key2])
                        m.setProperty(i, key2, d[key2]);
            }
            while (m.count > ids.length)
                m.remove(m.count - 1);
        }
    }

    // As many columns as fit at the TouchPad's cell pitch: 7 on the
    // TouchPad (launcherColumns, ReorderableIconLayout's maxIconsPerRow),
    // fewer in portrait, more on a screen wider than the TouchPad, where the
    // rows are centred. The original kept 7 and spread them apart
    // (calculateAndSetHorizontalSpaceParameters), which leaves wide gaps on
    // a big tablet.
    // Phones: 3 across the Pre's 320 upright, and as many of those cells as
    // fit when it is turned or wider (4 on its side); the original never
    // turned the phone's launcher.
    // Dense (Settings > Advanced): tablets at a 108 px pitch, 114 px rows,
    // in 100 px cells; phones 4 across the Pre's 320, the icon grid patches'
    // 4 x 4 (the icons keep their size).
    readonly property real cellPitch: dense ? Theme.px(108) : Theme.launcherCellPitch
    readonly property real cellSize: dense ? Theme.px(100) : Theme.launcherCellSize
    readonly property int phoneColumns: dense ? 4 : Theme.launcherColumns
    readonly property int columns: Theme.tablet
        ? Math.max(1, Math.floor((pages.width - Theme.launcherRowLeftMargin) / cellPitch))
        : Math.max(phoneColumns, Math.floor(pages.width / (Theme.px(320) / phoneColumns) + 0.001))
    readonly property real cellWidth: Theme.tablet ? cellPitch : pages.width / columns
    readonly property real cellHeight: Theme.tablet ? (dense ? Theme.px(114) : Theme.launcherRowPitch)
                                                    : Theme.launcherIconSize + Theme.px(dense ? 40 : 48)
    readonly property real rowLeft: Theme.tablet
        ? Math.max(Theme.launcherRowLeftMargin, Math.floor((pages.width - columns * cellPitch) / 2))
        : 0
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
    // The icon whose centre a dragged icon is over, for a group (LunaCE:
    // the centre of an icon groups, its outer edge reorders): its id, or
    // "". Not the dragged icon, and not a group dragged onto anything.
    function groupTargetAt(lx, ly) {
        var page = pages.currentItem;
        var m = pageModels[pages.currentIndex];
        if (!page || !m || !inPages(lx, ly) || LauncherLayout.isGroup(draggedId))
            return "";
        var p = launcher.mapToItem(page.contentItem, lx, ly);
        var col = Math.floor((p.x - rowLeft) / cellWidth), row = Math.floor((p.y - pageTopMargin) / cellHeight);
        var i = row * columns + col;
        if (col < 0 || col >= columns || row < 0 || i >= m.count)
            return "";
        var id = m.get(i).appId;
        if (id === draggedId || m.get(i).installState !== "")
            return "";
        var cellW = Theme.tablet ? cellSize : cellWidth;
        var cx = rowLeft + col * cellWidth + cellW / 2;
        var cy = pageTopMargin + row * cellHeight + (Theme.tablet ? cellSize / 2 + Theme.launcherIconOffsetY : Theme.launcherIconSize / 2);
        var r = Theme.launcherIconSize * Theme.launcherGroupCentre;
        return Math.abs(p.x - cx) <= r && Math.abs(p.y - cy) <= r ? id : "";
    }
    // The icon a dragged one would join, highlighted ("" for none).
    property string groupTarget: ""
    // Tabs share the bar from its left, each at most 150 px
    // (PageTabBar::newTabMaxSize, pagetabbar.cpp:85, 631-642); in edit mode
    // they leave room for Done.
    readonly property real tabWidth: Math.min(Theme.launcherTabMaxWidth,
        (tabBar.width - (editMode ? doneButton.width + Theme.px(12) : 0) - addTabWidth) / tabs.length)

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
    // Going to page i: it is the current page at once, and the pages glide
    // there over 250 ms InQuad (gotoPageIndex with no speed,
    // dimensionslauncher.cpp:3326-3329; Theme.launcherPageSnapDuration).
    // immediate: there at once (a page gone, the size changed).
    function showPage(i, immediate) {
        i = Math.max(0, i);
        pageSettle.stop();
        pages.currentIndex = i;
        _glideTo(i, immediate ? 0 : Theme.launcherPageSnapDuration, Easing.InQuad);
    }
    function _pageX(i) { return pages.originX + i * pages.width; }
    function _glideTo(i, duration, easing) {
        pageGlide.stop();
        if (duration <= 0 || Math.abs(pages.contentX - _pageX(i)) < 0.5) {
            pages.contentX = _pageX(i);
            return;
        }
        pageGlide.to = _pageX(i);
        pageGlide.duration = duration;
        pageGlide.easing.type = easing;
        pageGlide.start();
    }
    // A finger's drag across the pages, let go (LauncherObject's pan and
    // flick, dimensionslauncher.cpp:1990-2010, 3610-3645): a flick goes to
    // the page beside the one it began on, in the time the distance takes at
    // the flick's speed (px/ms x 100 / 1000), OutCubic (:3330-3339);
    // otherwise the page nearest the middle, as a tab's tap. Phoenix's flick
    // is snappier (Theme.launcherFlickMinVelocity): the finger's speed over
    // the last launcherFlickWindow ms, where the original took the whole
    // drag's (FlickGestureRecognizer.cpp:44-45, 95-104), so a slow start
    // ending in a flick still flicks, and 150 to 400 ms, not 200 to 1200.
    property real _dragStartX: 0
    property real _dragStartTime: 0
    property int _dragStartPage: 0
    // [time, contentX] while dragged, the last launcherFlickWindow ms of it.
    property var _dragSamples: []
    function _pagesDragStarted() {
        pageGlide.stop();
        pageSettle.stop();
        _dragStartX = pages.contentX;
        _dragStartTime = Date.now();
        _dragStartPage = pages.currentIndex;
        _dragSamples = [[_dragStartTime, _dragStartX]];
    }
    function _pagesDragMoved() {
        var now = Date.now();
        var s = _dragSamples;
        s.push([now, pages.contentX]);
        while (s.length > 2 && now - s[1][0] >= Theme.launcherFlickWindow)
            s.shift();
    }
    function _pagesDragEnded() {
        var w = Math.max(1, pages.width);
        var now = Date.now();
        var s = _dragSamples.length ? _dragSamples : [[_dragStartTime, _dragStartX]];
        // The window from the oldest sample still in it (or the drag's start).
        var dt = Math.max(1, now - s[0][0]);
        var vx = -(pages.contentX - s[0][1]) / dt;      // the finger's, px/ms
        var speed = Math.abs(vx);
        var to;
        if (speed >= Theme.launcherFlickMinVelocity) {
            to = Math.max(0, Math.min(tabs.length - 1, _dragStartPage + (vx > 0 ? -1 : 1)));
            if (to !== _dragStartPage) {
                pages.currentIndex = to;
                var ms = Math.abs(_pageX(to) - pages.contentX) / (speed * 100 / 1000);
                _glideTo(to, Theme.motion(Math.max(Theme.launcherPageFlickMinDuration,
                                                   Math.min(Theme.launcherPageFlickMaxDuration, Math.round(ms)))),
                         Easing.OutCubic);
                return;
            }
        }
        to = Math.max(0, Math.min(tabs.length - 1, Math.round((pages.contentX - pages.originX) / w)));
        pages.currentIndex = to;
        _glideTo(to, Theme.launcherPageSnapDuration, Easing.InQuad);
    }

    // ---- Page edges while an icon is dragged ------------------------------------
    // ReorderablePage::detectAndHandleSpecialMoveAreas: the icon at a page's
    // left or right border (Page::areaLeftBorder, 50 px) is handed to the
    // launcher, which pans to the page beside as soon as the page is still
    // (LauncherObject's redirected moves, dimensionslauncher.cpp:1775-1845);
    // the icon goes with it. Another pan the same way waits 1500 ms
    // (PageMovementControl, pagemovement.cpp: restrict_left / restrict_right
    // until pagePanForIconMoveDelayMs), and coming back inside the page lifts
    // that (signalPageMovementEnd). The original panned again on the next
    // move of the finger after that; a finger held on a screen always moves
    // a little, a mouse does not, so here the held icon pans again when the
    // 1500 ms are up. At the page's top or bottom border (20 px) it scrolls
    // the page 150 px over 300 ms (autoScrollUp / autoScrollDown), then not
    // for 800 ms (Page's scroll delay FSM).
    property string dragEdge: ""
    property bool _panLeftRestricted: false
    property bool _panRightRestricted: false
    property bool _scrollOk: true

    function edgeAt(lx, ly) {
        if (ly < pages.y || ly >= pages.y + pages.height)
            return "";
        if (lx < Theme.launcherEdgeWidth)
            return "left";
        if (lx >= width - Theme.launcherEdgeWidth)
            return "right";
        if (ly < pages.y + Theme.launcherEdgeHeight)
            return "top";
        if (ly >= pages.y + pages.height - Theme.launcherEdgeHeight)
            return "bottom";
        return "";
    }
    // The dragged icon is at (lx, ly), launcher coordinates: true when a
    // page edge has it (it is not dropped into the page meanwhile).
    function dragOver(lx, ly) {
        dragEdge = edgeAt(lx, ly);
        if (dragEdge === "") {
            _panLeftRestricted = false;
            _panRightRestricted = false;
            panTimer.stop();
            return false;
        }
        _edgeAction();
        return true;
    }
    function dragDone() {
        dragEdge = "";
        _panLeftRestricted = false;
        _panRightRestricted = false;
        panTimer.stop();
    }
    function _edgeAction() {
        if (dragEdge === "left" || dragEdge === "right") {
            // Only from a page at rest (centerPageIndex() >= 0).
            if (Math.abs(pages.contentX - pages.currentIndex * pages.width) > 1)
                return;
            var left = dragEdge === "left";
            if (left ? _panLeftRestricted : _panRightRestricted)
                return;
            var to = pages.currentIndex + (left ? -1 : 1);
            if (to < 0 || to >= tabs.length)
                return;
            showPage(to);
            dragPageChanged(to);
            _panLeftRestricted = left;
            _panRightRestricted = !left;
            panTimer.restart();
        } else if (dragEdge === "top" || dragEdge === "bottom") {
            var page = pages.currentItem;
            if (!_scrollOk || !page)
                return;
            var maxY = Math.max(0, page.contentHeight - page.height);
            var y = Math.max(0, Math.min(maxY, page.contentY + (dragEdge === "top" ? -1 : 1) * Theme.launcherScrollAmount));
            if (y === page.contentY)
                return;
            pageScroll.target = page;
            pageScroll.to = y;
            pageScroll.restart();
            _scrollOk = false;
            scrollTimer.restart();
        }
    }
    Timer {
        id: panTimer
        interval: Theme.launcherPagePanDelay
        onTriggered: {
            launcher._panLeftRestricted = false;
            launcher._panRightRestricted = false;
            if (launcher.dragging && launcher.dragEdge !== "")
                launcher._edgeAction();
        }
    }
    // Waits for the page to come to rest after a pan, then tries again.
    Timer {
        interval: 50
        repeat: true
        running: launcher.dragging && (launcher.dragEdge === "left" || launcher.dragEdge === "right") && !panTimer.running
        onTriggered: launcher._edgeAction()
    }
    Timer {
        id: scrollTimer
        interval: Theme.launcherScrollDelay
        onTriggered: {
            launcher._scrollOk = true;
            if (launcher.dragging && (launcher.dragEdge === "top" || launcher.dragEdge === "bottom"))
                launcher._edgeAction();
        }
    }
    // 150 px over 300 ms, linear: the original set only a duration
    // (page.cpp:1708-1711, 1748-1751; pageScrollAnimTime).
    NumberAnimation {
        id: pageScroll
        objectName: "launcherPageScroll"
        property: "contentY"
        duration: Theme.launcherScrollDuration
        easing.type: Easing.Linear
    }

    // The pages' glide to a page (showPage, a drag let go).
    NumberAnimation {
        id: pageGlide
        objectName: "launcherPageGlide"
        target: pages
        property: "contentX"
    }

    ListView {
        id: pages
        anchors.top: tabBar.bottom
        anchors.bottom: parent.bottom
        anchors.bottomMargin: launcher.dockHeight
        width: parent.width
        orientation: ListView.Horizontal
        // The launcher moves the pages itself (showPage, _pagesDragEnded):
        // the current page is what it says, the view does not follow it,
        // and a drag let go does not fly on.
        snapMode: ListView.NoSnap
        highlightRangeMode: ListView.NoHighlightRange
        highlightFollowsCurrentItem: false
        maximumFlickVelocity: 0
        onDragStarted: launcher._pagesDragStarted()
        onDragEnded: launcher._pagesDragEnded()
        onContentXChanged: if (dragging) launcher._pagesDragMoved()
        onWidthChanged: if (!pageGlide.running && !dragging) contentX = launcher._pageX(currentIndex)
        boundsBehavior: Flickable.StopAtBounds
        interactive: !launcher.dragging
        clip: true
        // Every page stays made: an icon dragged to an edge goes to the
        // page beside at once.
        cacheBuffer: width * launcher.tabs.length
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

            // An empty page says how to fill it (ReorderablePage: its picture
            // centred, the text 100 px above the centre, 24 px bold white;
            // iconlayoutsettings.cpp:163-170).
            Item {
                objectName: "launcherEmptyPage"
                visible: !page.model || page.model.count === 0
                width: page.width
                height: page.height
                Image {
                    source: Theme.asset("launcher3/launcher-empty-page.png")
                    width: Theme.artWidth(source)
                    height: Theme.artHeight(source)
                    x: (parent.width - width) / 2
                    y: (parent.height - height) / 2
                }
                Text {
                    width: Math.min(Theme.px(800), parent.width - Theme.px(32))
                    x: (parent.width - width) / 2
                    y: parent.height / 2 - Theme.px(100) - height / 2
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.WordWrap
                    text: qsTr("Tap and hold any app to drag it to this page.")
                    color: "#FFFFFF"
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.px(24)
                    font.bold: true
                }
            }

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
                    required property bool shortcut
                    required property string installState
                    required property real progress
                    required property bool isGroup
                    required property string groupIcons
                    // Being installed, or the install failed: the icon and
                    // its label at half opacity under the status decorator
                    // (IconBase::paint, iconInstallModeOpacity 0.5).
                    readonly property bool notReady: installState !== ""
                    width: Theme.tablet ? launcher.cellSize : launcher.cellWidth
                    height: launcher.cellHeight
                    x: launcher.rowLeft + (index % launcher.columns) * launcher.cellWidth
                    y: launcher.pageTopMargin + Math.floor(index / launcher.columns) * launcher.cellHeight
                    Behavior on x { NumberAnimation { duration: Theme.launcherReorderDuration; easing.type: Easing.InQuad } }
                    Behavior on y { NumberAnimation { duration: Theme.launcherReorderDuration; easing.type: Easing.InQuad } }
                    // The dragged icon travels under the finger (the shell's drag proxy).
                    opacity: launcher.draggedId === appId ? 0 : 1

                    // The keyboard's focus ring.
                    Rectangle {
                        objectName: "launcherFocusRing"
                        readonly property bool on: launcher.keyIndex === cell.index && page.index === launcher.currentPage
                        visible: on
                        anchors.horizontalCenter: iconItem.horizontalCenter
                        y: iconItem.y - Theme.px(6)
                        width: Math.min(parent.width - Theme.px(4), Theme.launcherIconSize + Theme.px(36))
                        height: iconItem.height + Theme.px(10)
                        radius: Theme.px(10)
                        color: "#302c8ce0"
                        border.color: "#2c8ce0"
                        border.width: Theme.px(2)
                    }

                    // The icon a dragged one would join: the launcher's touch
                    // feedback behind it, as under a tapped icon.
                    Image {
                        objectName: "launcherGroupTarget"
                        visible: launcher.groupTarget !== "" && launcher.groupTarget === cell.appId
                        width: Theme.launchFeedbackSize * 1.2
                        height: width
                        x: iconItem.x + (Theme.launcherIconSize - width) / 2
                        y: iconItem.y + (Theme.launcherIconSize - height) / 2
                        source: Theme.asset("launcher3/launcher-touch-feedback.png")
                    }
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
                        y: Theme.tablet ? launcher.cellSize / 2 + Theme.launcherIconOffsetY - Theme.launcherIconSize / 2 : 0
                        groupIcons: cell.isGroup ? JSON.parse(cell.groupIcons || "[]") : []
                        title: cell.title
                        color: cell.color
                        glyph: cell.glyph
                        source: cell.icon
                        largeSource: cell.largeIcon
                        interactive: false
                        feedback: launcher.feedbackId === cell.appId
                        opacity: cell.notReady ? Theme.launcherInstallingOpacity : 1
                    }
                    // Delete decorator at the icon's top left for apps that can
                    // be deleted, the remove decorator for launch points apps
                    // added (iconheap.cpp:35-39; icongeometrysettings.cpp:
                    // 190-197; the sprite's top half is the normal state).
                    // Never on an app being installed or whose install failed
                    // (LauncherObject::canShowRemoveDeleteDecoratorOnIcon).
                    Item {
                        objectName: "launcherRemoveDecorator"
                        visible: launcher.editMode && (cell.removable || cell.shortcut) && !cell.notReady
                        x: iconItem.x - Theme.px(8)
                        y: iconItem.y - Theme.px(8)
                        width: Theme.px(28)
                        height: width
                        clip: true
                        Image {
                            width: parent.width
                            height: parent.height * 2
                            source: Theme.asset(cell.shortcut ? "launcher3/edit-button-remove.png" : "launcher3/edit-button-delete.png")
                        }
                    }
                    // The install status decorator, 32 x 32 (iconheap.cpp:44-51;
                    // icongeometrysettings.cpp:198-202): while installing, a
                    // frame of loading-strip.png's 19 (32 x 32, top to
                    // bottom) for the progress; after a failure,
                    // warning-icon.png. Tablets: 50 px right of and above
                    // the cell's centre (launcher_icon_geom_settings.conf);
                    // phones: at the icon's top right, as the delete
                    // decorator is at its top left.
                    Item {
                        id: installBadge
                        objectName: "launcherInstallBadge"
                        readonly property int frame: Math.max(0, Math.min(Theme.launcherProgressFrames - 1,
                            Math.floor(Theme.launcherProgressFrames * Math.max(0, cell.progress) / 100)))
                        visible: cell.notReady
                        width: Theme.px(32)
                        height: width
                        x: Theme.tablet ? launcher.cellSize / 2 + Theme.px(50) - width / 2
                                        : iconItem.x + iconItem.width - Theme.px(22)
                        y: Theme.tablet ? launcher.cellSize / 2 - Theme.px(50) - height / 2
                                        : iconItem.y - Theme.px(10)
                        clip: true
                        Image {
                            visible: cell.installState === "installing"
                            y: -installBadge.frame * installBadge.height
                            width: installBadge.width
                            height: installBadge.height * Theme.launcherProgressFrames
                            source: Theme.asset("loading-strip.png")
                        }
                        Image {
                            visible: cell.installState === "failed"
                            anchors.fill: parent
                            source: Theme.asset("warning-icon.png")
                        }
                    }
                }
            }

            // One area for the whole page: tap launches; press and hold (or a
            // right click) opens the icon's menu (IconMenu.qml), and moving
            // the finger on from there enters edit mode with the icon picked
            // up, as the hold alone did (reorderablepage.cpp:450-540). In
            // edit mode, and on an icon still being installed, the hold
            // picks the icon up at once.
            MouseArea {
                id: pageMouse
                width: page.contentWidth
                height: Math.max(page.contentHeight, page.height)
                acceptedButtons: Qt.LeftButton | Qt.RightButton
                pressAndHoldInterval: launcher.editMode ? Theme.tapAndHoldInterval : Theme.iconMenuHoldInterval
                preventStealing: launcher.dragging || heldId !== ""
                property string pressedId: ""
                // The icon whose menu the hold opened, while the finger is down.
                property string heldId: ""
                property point heldAt

                function cellAt(mx, my) {
                    var col = Math.floor((mx - launcher.rowLeft) / launcher.cellWidth);
                    var row = Math.floor((my - launcher.pageTopMargin) / launcher.cellHeight);
                    var i = row * launcher.columns + col;
                    if (row < 0 || col < 0 || col >= launcher.columns || !page.model || i >= page.model.count)
                        return null;
                    return { index: i, x: mx - launcher.rowLeft - col * launcher.cellWidth, y: my - launcher.pageTopMargin - row * launcher.cellHeight };
                }
                // The menu, unless the icon only moves (edit mode, an install).
                function openMenu(c) {
                    var item = page.model.get(c.index);
                    if (launcher.editMode || item.installState !== "" || item.isGroup)
                        return false;
                    launcher.menuRequested(item.appId, "page", launcher._iconRect(page, c.index));
                    return true;
                }

                onPressed: (mouse) => {
                    var c = cellAt(mouse.x, mouse.y);
                    pressedId = c ? page.model.get(c.index).appId : "";
                    heldId = "";
                    if (mouse.button === Qt.RightButton && c)
                        openMenu(c);
                    launcher.addTabShown = false;
                }
                onPressAndHold: (mouse) => {
                    if (pressedId === "" || mouse.button !== Qt.LeftButton)
                        return;
                    var c = cellAt(mouse.x, mouse.y);
                    if (c && page.model.get(c.index).appId === pressedId && openMenu(c)) {
                        heldId = pressedId;
                        heldAt = Qt.point(mouse.x, mouse.y);
                        return;
                    }
                    launcher.editMode = true;
                    var sp = mapToItem(launcher, mouse.x, mouse.y);
                    launcher.dragStarted(pressedId, "page", sp.x, sp.y);
                }
                onPositionChanged: (mouse) => {
                    // Moved on from the hold: the menu gives way to the drag.
                    if (heldId !== "" && Math.hypot(mouse.x - heldAt.x, mouse.y - heldAt.y) > Qt.styleHints.startDragDistance) {
                        var id = heldId;
                        heldId = "";
                        launcher.editMode = true;
                        var hp = mapToItem(launcher, mouse.x, mouse.y);
                        launcher.dragStarted(id, "page", hp.x, hp.y);
                        return;
                    }
                    if (launcher.dragging) {
                        var sp = mapToItem(launcher, mouse.x, mouse.y);
                        launcher.dragMoved(sp.x, sp.y);
                    }
                }
                onReleased: (mouse) => {
                    heldId = "";
                    if (launcher.dragging) {
                        var sp = mapToItem(launcher, mouse.x, mouse.y);
                        launcher.dragEnded(sp.x, sp.y);
                    }
                }
                onClicked: (mouse) => {
                    var c = cellAt(mouse.x, mouse.y);
                    if (!c || mouse.button !== Qt.LeftButton)
                        return;
                    var item = page.model.get(c.index);
                    if (item.isGroup) {
                        if (!launcher.editMode)
                            launcher.openGroup(item.appId);
                        return;
                    }
                    if (launcher.editMode) {
                        // The delete decorator, top left of the icon.
                        var cellW = Theme.tablet ? launcher.cellSize : launcher.cellWidth;
                        var iconLeft = (cellW - Theme.launcherIconSize) / 2;
                        var iconTop = Theme.tablet ? launcher.cellSize / 2 + Theme.launcherIconOffsetY - Theme.launcherIconSize / 2 : 0;
                        if ((item.removable || item.shortcut) && item.installState === ""
                                && c.x < iconLeft + Theme.px(24) && c.x > iconLeft - Theme.px(12)
                                && c.y < iconTop + Theme.px(24) && c.y > iconTop - Theme.px(12))
                            launcher.deleteRequested(item.appId);
                        return;
                    }
                    if (item.installState !== "") {
                        launcher.pendingTapped(item.appId);
                        return;
                    }
                    launcher.feedbackId = item.appId;
                    launcher.launchRequested(item.appId);
                }
                onCanceled: {
                    pressedId = "";
                    heldId = "";
                }
            }
        }
    }

    Image {
        anchors.bottom: parent.bottom
        width: parent.width
        height: Theme.artHeight(source)
        source: Theme.asset("launcher3/launcher-scrollfade-bottom.png")
        fillMode: Image.Stretch
    }

    // ---- Trackpad and mouse wheel (Phoenix) ------------------------------------------
    // A two-finger swipe sideways over the tabs or the pages pans between
    // the pages as a finger does and, once the fingers lift, settles at once
    // on the page it was heading for (a quick one goes on to the next), as
    // card view's stacks do (TrackpadSwipe); the momentum that follows is
    // ignored, so the page neither runs past its neighbour nor drifts back.
    // Up or down it scrolls the page's icons, momentum and all, within
    // their bounds. A mouse wheel turned sideways (or a horizontal wheel)
    // moves a page a notch; turned up or down it scrolls the page a row.
    TrackpadSwipe {
        id: wheel
        objectName: "launcherWheel"
        anchors.top: tabBar.top
        anchors.bottom: pages.bottom
        width: parent.width
        enabled: launcher.open && !launcher.dragging && !groupView.open && !nameDialog.visible
        blocked: function () { return pages.dragging || pages.flicking; }
        verticalMomentum: true
        // The page the swipe began on, as a fractional index.
        property real startPosition: 0
        readonly property real pageWidth: Math.max(1, pages.width)

        onNotched: (dx, dy) => {
            if (Math.abs(dx) > Math.abs(dy)) {
                launcher.showPage(Math.max(0, Math.min(launcher.tabs.length - 1, pages.currentIndex + (dx < 0 ? 1 : -1))));
                return;
            }
            // Up or down: a row a notch, as the edge of a drag scrolls it
            // (pageScroll), within the page; it stays in the launcher.
            var page = pages.currentItem;
            if (!page)
                return;
            var from = pageScroll.running && pageScroll.target === page ? pageScroll.to : page.contentY;
            var y = Math.max(0, Math.min(Math.max(0, page.contentHeight - page.height), from - dy / 120 * launcher.cellHeight));
            if (y === page.contentY)
                return;
            pageScroll.stop();
            pageScroll.target = page;
            pageScroll.to = y;
            pageScroll.start();
        }
        onStarted: {
            pageSettle.stop();
            if (axis === "h") {
                startPosition = (pages.contentX - pages.originX) / pageWidth;
                launcher.addTabShown = false;
            } else if (!pages.currentItem) {
                axis = "done";
            }
        }
        onMoved: (dx, dy) => {
            if (axis === "h") {
                // Past the first or the last page it gives a little, as
                // card view's ends do.
                var pos = startPosition - sumX / pageWidth;
                var last = Math.max(0, launcher.tabs.length - 1);
                if (pos < 0) pos = pos / 3;
                if (pos > last) pos = last + (pos - last) / 3;
                pages.contentX = pages.originX + pos * pageWidth;
            } else {
                scrollBy(pages.currentItem, dy);
            }
        }
        onEnded: {
            if (axis !== "h")
                return;
            var pos = (pages.contentX - pages.originX) / pageWidth;
            var to = Math.max(0, Math.min(launcher.tabs.length - 1, settleTarget(startPosition, pos)));
            pageSettle.page = to;
            pageSettle.to = pages.originX + to * pageWidth;
            pageSettle.restart();
        }
    }
    NumberAnimation {
        id: pageSettle
        property int page: 0
        target: pages
        property: "contentX"
        duration: Theme.wheelSettleDuration
        easing.type: Theme.cardEasing
        onFinished: pages.currentIndex = page
    }

    // The open group, over the pages (and the dock's room).
    LauncherGroup {
        id: groupView
        anchors.fill: parent
        anchors.topMargin: tabBar.height
        anchors.bottomMargin: launcher.dockHeight
        z: 10
        open: launcher.openGroupId !== ""
        groupId: launcher.openGroupId
        title: launcher.openGroupData ? launcher.openGroupData.title : ""
        members: launcher.openGroupData ? launcher.openGroupData.members : []
        onCloseRequested: launcher.closeGroup()
        onCarryingChanged: if (!carrying && launcher.openGroupId !== "" && !launcher.openGroupData) launcher.closeGroup()
        onRenamed: (title) => launcher.groupRenamed(launcher.openGroupId, title)
        onLaunchRequested: (appId) => {
            var e = launcher.entry(appId);
            if (e && e.installState) {
                launcher.pendingTapped(appId);
                return;
            }
            launcher.feedbackId = appId;
            launcher.closeGroup();
            launcher.launchRequested(appId);
        }
        onMenuRequested: (appId, rect) => {
            var p = groupView.mapToItem(launcher, rect.x, rect.y);
            launcher.menuRequested(appId, "group", Qt.rect(p.x, p.y, rect.width, rect.height));
        }
        // Moved on from the hold: out of the group, onto this page, carried.
        onDragOutRequested: (appId, x, y) => {
            launcher.groupDragOut(appId);
            launcher.editMode = true;
            var p = groupView.mapToItem(launcher, x, y);
            launcher.dragStarted(appId, "page", p.x, p.y);
        }
        onDragMoved: (x, y) => {
            var p = groupView.mapToItem(launcher, x, y);
            launcher.dragMoved(p.x, p.y);
        }
        onDragEnded: (x, y) => {
            var p = groupView.mapToItem(launcher, x, y);
            launcher.dragEnded(p.x, p.y);
        }
    }

    // A tab's name (new, or renamed), over everything else here.
    LauncherNameDialog {
        id: nameDialog
        // The tab being renamed; -1 for a new one.
        property int target: -1
        anchors.fill: parent
        onAccepted: (text) => {
            if (target < 0)
                launcher.tabAdded(text);
            else
                launcher.tabRenamed(target, text);
        }
        onDeleteRequested: if (target >= 0) launcher.tabRemoved(target)
    }
    readonly property alias nameDialog: nameDialog
    readonly property alias groupView: groupView
}
