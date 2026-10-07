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
    // the icon in launcher coordinates (IconMenu.qml).
    signal menuRequested(string appId, string from, rect iconRect)

    onOpenChanged: {
        if (!open)
            editMode = false;
        keyIndex = -1;
    }
    onCurrentPageChanged: if (keyIndex >= 0) keyIndex = Math.min(keyIndex, Math.max(0, _pageCount(currentPage) - 1))

    // ---- Keyboard navigation (GAPS V8 (3)) -----------------------------------------
    // The arrows move a focus ring over the page's icons (past its left or
    // right edge to the page beside), Tab / Shift+Tab go to the next /
    // previous page (Home is the device's Home button), Enter or Space
    // opens the icon as a tap would, Esc closes the launcher.
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

    // The page titles, in LauncherLayout.PAGES order (apps, downloads,
    // favorites, prefs).
    readonly property var tabs: [qsTr("Apps"), qsTr("Downloads"), qsTr("Favorites"), qsTr("Settings")]

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
    Component.onCompleted: {
        var ms = [];
        for (var i = 0; i < tabs.length; ++i)
            ms.push(pageModelComponent.createObject(launcher));
        pageModels = ms;
        syncPages();
    }
    onLayoutChanged: syncPages()
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

    // What a page's icon shows of its entry.
    function _cellData(id) {
        var e = entry(id);
        return { appId: id, title: e ? e.title : id, color: e ? String(e.color) : "#666666",
                 glyph: e ? e.glyph : "", icon: e ? String(e.icon || "") : "",
                 largeIcon: e ? String(e.largeIcon || "") : "",
                 removable: e ? !!e.removable : false,
                 // A launch point an app added: the (x) remove decorator.
                 shortcut: e ? !!e.dynamic : false,
                 installState: e && e.installState ? String(e.installState) : "",
                 progress: e && typeof e.progress === "number" ? e.progress : -1 };
    }

    function syncPages() {
        if (!layout || pageModels.length === 0)
            return;
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
    readonly property int columns: Theme.tablet
        ? Math.max(1, Math.floor((pages.width - Theme.launcherRowLeftMargin) / Theme.launcherCellPitch))
        : Math.max(Theme.launcherColumns, Math.floor(pages.width / (Theme.px(320) / Theme.launcherColumns) + 0.001))
    readonly property real cellWidth: Theme.tablet ? Theme.launcherCellPitch : pages.width / columns
    readonly property real cellHeight: Theme.tablet ? Theme.launcherRowPitch : Theme.launcherIconSize + Theme.px(48)
    readonly property real rowLeft: Theme.tablet
        ? Math.max(Theme.launcherRowLeftMargin, Math.floor((pages.width - columns * Theme.launcherCellPitch) / 2))
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
    NumberAnimation {
        id: pageScroll
        property: "contentY"
        duration: Theme.launcherScrollDuration
        easing.type: Easing.OutCubic
    }

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
                    // Being installed, or the install failed: the icon and
                    // its label at half opacity under the status decorator
                    // (IconBase::paint, iconInstallModeOpacity 0.5).
                    readonly property bool notReady: installState !== ""
                    width: Theme.tablet ? Theme.launcherCellSize : launcher.cellWidth
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
                        x: Theme.tablet ? Theme.launcherCellSize / 2 + Theme.px(50) - width / 2
                                        : iconItem.x + iconItem.width - Theme.px(22)
                        y: Theme.tablet ? Theme.launcherCellSize / 2 - Theme.px(50) - height / 2
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
                // The icon at index, in launcher coordinates.
                function iconRect(i) {
                    var cellW = Theme.tablet ? Theme.launcherCellSize : launcher.cellWidth;
                    var x = launcher.rowLeft + (i % launcher.columns) * launcher.cellWidth + (cellW - Theme.launcherIconSize) / 2;
                    var y = launcher.pageTopMargin + Math.floor(i / launcher.columns) * launcher.cellHeight
                            + (Theme.tablet ? Theme.launcherCellSize / 2 + Theme.launcherIconOffsetY - Theme.launcherIconSize / 2 : 0);
                    var p = mapToItem(launcher, x, y);
                    return Qt.rect(p.x, p.y, Theme.launcherIconSize, Theme.launcherIconSize);
                }
                // The menu, unless the icon only moves (edit mode, an install).
                function openMenu(c) {
                    var item = page.model.get(c.index);
                    if (launcher.editMode || item.installState !== "")
                        return false;
                    launcher.menuRequested(item.appId, "page", iconRect(c.index));
                    return true;
                }

                onPressed: (mouse) => {
                    var c = cellAt(mouse.x, mouse.y);
                    pressedId = c ? page.model.get(c.index).appId : "";
                    heldId = "";
                    if (mouse.button === Qt.RightButton && c)
                        openMenu(c);
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
                    if (launcher.editMode) {
                        // The delete decorator, top left of the icon.
                        var cellW = Theme.tablet ? Theme.launcherCellSize : launcher.cellWidth;
                        var iconLeft = (cellW - Theme.launcherIconSize) / 2;
                        var iconTop = Theme.tablet ? Theme.launcherCellSize / 2 + Theme.launcherIconOffsetY - Theme.launcherIconSize / 2 : 0;
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
}
