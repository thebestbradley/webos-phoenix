// Copyright (c) 2026 webOS Phoenix contributors
// Copyright (c) 2010-2013 Hewlett-Packard Development Company, L.P. (the original)
// SPDX-License-Identifier: Apache-2.0
//
// The tablet's notification drop-down: a port of luna-sysmgr's
// uiComponents/DashboardMenu (DashboardMenu.qml) and the
// uiComponents/MenuContainer it is built on (MenuContainer.qml) from
// QtQuick 1 to Qt 6, with the part DashboardWindowContainer drew and
// handled in C++ when it lived inside the menu (m_isMenu,
// Src/lunaui/notifications/DashboardWindowContainer.cpp) done here in QML:
//
//   - newest at the top (layoutAllWindowsInMenu, :541-560), 52 px rows,
//     menu-divider.png above every row but the top one (paintInsideMenu,
//     :1357-1371); at most 5 1/2 rows showing, then the list scrolls under
//     MenuContainer's fades and arrows (getMaximumHeightForMenu, :152-155)
//   - a row follows the finger to the right, never left of its place
//     (:292-296); dropped more than a quarter of the width away it slides
//     a width and a half on over 200 ms, linear, and is dismissed
//     (:356-365, 1149-1180); otherwise every row goes back to its place over
//     500 ms, OutCubic (restoreNonDeletedItems, :921-933;
//     animateWindowsToFinalDestinationInMenu, :863-894). The menu, unlike
//     the phone's dashboard, takes no flick to dismiss (sceneEvent, :421)
//   - menu-dropdown-swipe-bg.png with its -highlight.png edge behind a row
//     being swiped, and the same shading in the gaps rows leave while they
//     close up after a removal (:1373-1433)
//   - the list's height animating to fit its rows as they come and go,
//     500 ms OutCubic (animateResize, :456-483)
//   - opening and closing with the status bar group's 200 ms linear fade
//     (StatusBarItemGroup.cpp:243-306; StatusBar.cpp:273-278)
//
// The app's own dashboard window fills its row when it has one
// (DashboardItem, source.windowFor): taps on it are its own, as
// handleTap (:1104-1146) passed them on.
//
// Not reproduced: a row removed by its app rather than by a swipe does not
// slide out first (removeWindow, :653-709): the Repeater drops it at once
// and the rows below close up as after a swipe. Grouped notification
// windows that take their own horizontal drags (isManualDragWindow,
// :194-222) are not known here.

import QtQuick

Item {
    id: menu
    objectName: "dashboardMenu"

    property var model            // Notifications.model
    property var source           // the window source, for windowFor(key)
    property Item backdrop: null  // the scene behind, for the blur
    property bool open: false
    // The lock screen has the dashboard windows while locked; they come
    // back to the rows on unlock.
    property bool locked: false

    signal activated(string appId, string params)
    signal dismissRequested(int index)

    readonly property int count: model ? model.count : 0
    readonly property int rowHeight: Theme.dashboardItemHeight
    readonly property int dividerHeight: Theme.dashboardMenuDividerHeight

    // MenuContainer.qml:14-19: the rows' width and the side margins; as
    // tall as setMaximumHeight made it, the art only as tall as the rows.
    width: Theme.dashboardMenuWidth + 2 * Theme.dashboardMenuSideMargin
    height: Theme.dashboardMenuMaxContentHeight + Theme.dashboardMenuBottomMargin
    clip: true                                                  // MenuContainer.qml:5

    // The rows and the dividers between them
    // (DashboardWindowContainer.cpp:625, 675, 747).
    readonly property real rowsHeight: count > 0 ? count * rowHeight + (count - 1) * dividerHeight : 0
    // The container's height, animated while the menu shows and set while
    // it does not (animateResize, :456-473).
    property real containerHeight: rowsHeight
    Behavior on containerHeight {
        enabled: menu.shown
        NumberAnimation { duration: Theme.dashboardSnapDuration; easing.type: Easing.OutCubic }
    }

    // A row is being dragged sideways: the list does not scroll meanwhile
    // (signalItemDragState, DashboardMenu.qml:21-23).
    property bool dragging: false

    // Shown, or fading: rows animate into place only then (isVisible()).
    readonly property bool shown: opacity > 0
    visible: shown
    opacity: open ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: Theme.systemMenuFadeDuration } }

    // DashboardMenu.qml:26-35: back to the top once hidden.
    onVisibleChanged: if (!visible) flick.contentY = 0

    // Bumped as rows come and go, so each row finds the one below it.
    property int rowsRevision: 0

    // menu-dropdown-swipe-bg.png, stretched over a gap (paintHoriz3Tile, :1444-1464).
    component GapShade: BorderImage {
        objectName: "dashboardMenuGapShade"
        width: Theme.dashboardMenuWidth
        visible: height > 0
        source: Theme.asset("menu-dropdown-swipe-bg.png")
        border { left: Theme.artBorder(Theme.dashboardMenuSwipeCap, source); right: Theme.artBorder(Theme.dashboardMenuSwipeCap, source) }
    }

    // ---- One row: a dashboard window with its divider and shading ----------------
    component MenuRow: Item {
        id: row
        objectName: "dashboardMenuRow"
        required property int index
        required property string appId
        required property string title
        required property string body
        required property color color
        required property string glyph
        required property string icon
        required property string params
        required property string windowKey
        required property bool ongoing
        required property real progress

        // Ongoing activities (a download, an install) are persistent: they
        // stay until they end (DashboardWindow::persistent, honoured at
        // :345-347; the window attribute that made one was set in the closed
        // WebAppManager, and its name is not in the open sources).
        readonly property bool persistent: ongoing

        // Where the row goes back to: newest at the top (:541-560, 863-894).
        readonly property real slotY: (menu.count - 1 - index) * (menu.rowHeight + menu.dividerHeight)
        readonly property bool isTop: index === menu.count - 1
        readonly property bool isBottom: index === 0
        // The window's sideways offset from its place.
        readonly property alias swipeX: content.x
        readonly property bool removing: remove.running

        // The next row down, whose top closes the gap under this one.
        readonly property Item below: {
            var deps = menu.rowsRevision;
            return index > 0 ? rows.itemAt(index - 1) : null;
        }

        width: menu.width - 2 * Theme.dashboardMenuSideMargin
        height: menu.rowHeight
        z: removing ? 1 : 0                                    // raiseChild, :1166

        property bool entered: false
        y: slotY
        Behavior on y {
            enabled: menu.shown && row.entered
            NumberAnimation { duration: Theme.dashboardSnapDuration; easing.type: Easing.OutCubic }
        }
        // A new row comes down from above the list into its place
        // (addWindow, :636-642) while the menu shows.
        Component.onCompleted: {
            if (menu.shown)
                y = -menu.rowHeight - menu.rowHeight / 2;
            entered = true;
            y = Qt.binding(function() { return row.slotY; });
        }

        // The divider above it, unless it is the top row in its place
        // (:1357, 1369-1371); it moves with the window.
        readonly property bool divided: !isTop || y > 0
        Image {
            objectName: "dashboardMenuDivider"
            visible: row.divided
            x: content.x
            y: -menu.dividerHeight
            width: row.width
            height: menu.dividerHeight
            source: Theme.asset("menu-divider.png")
            fillMode: Image.Stretch
        }

        // Behind a window moved off its place, from the left edge up to it,
        // divider and all (:1373-1387).
        BorderImage {
            id: swipeShade
            objectName: "dashboardMenuSwipeShade"
            visible: content.x > 0
            y: row.divided ? -menu.dividerHeight : 0
            width: Math.min(content.x, row.width)
            height: row.height + (row.divided ? menu.dividerHeight : 0)
            source: Theme.asset("menu-dropdown-swipe-bg.png")
            border { left: Theme.artBorder(Theme.dashboardMenuSwipeCap, source); right: Theme.artBorder(Theme.dashboardMenuSwipeCap, source) }
            horizontalTileMode: BorderImage.Stretch
            verticalTileMode: BorderImage.Stretch
            Image {
                x: parent.width - width
                width: Theme.artWidth(source)
                height: parent.height
                source: Theme.asset("menu-dropdown-swipe-highlight.png")
                fillMode: Image.Stretch
            }
        }

        // The gaps rows leave while they close up (:1403-1428): above the
        // top row, below the bottom one, and between this row and the next.
        // The gaps rows leave while they close up (:1403-1428): above the
        // top row, below the bottom one, and between this row and the next.
        GapShade {
            // above the top row
            y: -row.y
            height: row.isTop && row.y > 0 ? row.y - menu.dividerHeight : 0
        }
        GapShade {
            // below the bottom row (unless it is also the top one, shaded above)
            y: row.height
            height: row.isBottom && !(row.isTop && row.y > 0)
                    ? menu.containerHeight - row.y - row.height : 0
        }
        GapShade {
            // down to the next row's divider
            y: row.height
            height: row.below ? row.below.y - menu.dividerHeight - row.y - row.height : 0
        }

        DashboardItem {
            id: content
            width: row.width
            height: row.height
            source: menu.source
            windowKey: row.windowKey
            title: row.title
            body: row.body
            color: row.color
            glyph: row.glyph
            icon: row.icon
            progress: row.progress

            Connections {
                target: menu
                function onLockedChanged() { if (!menu.locked) content.claim(); }
            }

            MouseArea {
                id: swipe
                objectName: "dashboardSwipe"
                anchors.fill: parent
                enabled: !remove.running
                // 0: not yet past the tap radius, a tap; 1: sideways, the
                // row follows; 2: up or down, the list's (:231-257).
                property int mode: 0
                property point start
                property real lastX: 0

                onPressed: (m) => {
                    snap.stop();
                    var p = mapToItem(menu, m.x, m.y);
                    start = p;
                    lastX = p.x;
                    mode = 0;
                }
                onPositionChanged: (m) => {
                    var p = mapToItem(menu, m.x, m.y);
                    if (mode === 0) {
                        var dx = p.x - start.x, dy = p.y - start.y;
                        if (dx * dx + dy * dy < Theme.tapRadius * Theme.tapRadius) {
                            lastX = p.x;
                            return;
                        }
                        if (Math.abs(dx) > Math.abs(dy)) {
                            mode = 1;
                            preventStealing = true;
                            menu.dragging = true;
                        } else {
                            mode = 2;
                        }
                    }
                    if (mode === 1)
                        content.x = Math.max(0, content.x + p.x - lastX);
                    lastX = p.x;
                }
                // :329-400: dropped past a quarter of the width, gone;
                // otherwise back to its place. Taken by the list (a scroll,
                // mouseWasGrabbedByParent, DashboardMenu.qml:9-11): back.
                onReleased: {
                    preventStealing = false;
                    menu.dragging = false;
                    if (mode === 1 && !row.persistent
                            && Math.abs(content.x) > content.width * Theme.dashboardDismissRatio)
                        remove.start();
                    else if (content.x !== 0)
                        snap.start();
                }
                onCanceled: {
                    mode = 2;
                    preventStealing = false;
                    menu.dragging = false;
                    if (content.x !== 0)
                        snap.start();
                }
                // A tap: its app, and the notification is done with.
                onClicked: {
                    if (mode !== 0 || content.x !== 0)
                        return;
                    menu.activated(row.appId, row.params);
                    if (!row.persistent)
                        menu.dismissRequested(row.index);
                }
            }
            // triggerItemDelete (:1149-1180): a width and a half on, linear.
            NumberAnimation {
                id: remove
                target: content
                property: "x"
                to: content.x + Theme.dashboardDeleteTravel * content.width
                duration: Theme.dashboardDeleteDuration
                onFinished: menu.dismissRequested(row.index)
            }
            NumberAnimation {
                id: snap
                target: content
                property: "x"
                to: 0
                duration: Theme.dashboardSnapDuration
                easing.type: Easing.OutCubic
            }
        }
    }

    // ---- MenuContainer.qml ----------------------------------------------------------

    // The art, only as tall as the rows need (MenuContainer.qml:35-41).
    BorderImage {
        id: menuBorder
        objectName: "dashboardMenuBorder"
        width: parent.width
        height: Math.max(Theme.px(40), Math.min(menu.height, menu.containerHeight + Theme.dashboardMenuBottomMargin))
        source: Theme.asset("menu-dropdown-bg.png")
        border { left: Theme.artBorder(30, source); top: Theme.artBorder(10, source); right: Theme.artBorder(30, source); bottom: Theme.artBorder(30, source) }

        MouseArea { anchors.fill: parent }  // taps on the menu stay in it

        // The scene behind, blurred faintly within the art's shape.
        BackdropBlur {
            anchors.fill: parent
            z: -1
            source: menu.backdrop
            mask: menuShape
        }
        BorderImage {
            id: menuShape
            visible: false
            anchors.fill: parent
            source: Theme.asset("menu-dropdown-bg.png")
            border { left: Theme.artBorder(30, source); top: Theme.artBorder(10, source); right: Theme.artBorder(30, source); bottom: Theme.artBorder(30, source) }
        }
    }

    // MenuContainer.qml:43-68: the list, clipped inside the art.
    Item {
        id: clipRect
        x: Theme.dashboardMenuSideMargin
        width: parent.width - 2 * Theme.dashboardMenuSideMargin
        height: parent.height - Theme.dashboardMenuBottomMargin
        clip: true

        Flickable {
            id: flick
            objectName: "dashboardMenuFlickable"
            width: parent.width
            height: Math.min(clipRect.height, container.height)
            contentWidth: width
            contentHeight: container.height
            interactive: !menu.dragging                         // DashboardMenu.qml:21-23

            // DashboardWindowContainer, top left in the menu (:596-603),
            // clipped to its height (paintInsideMenu, :1352).
            Item {
                id: container
                objectName: "dashboardMenuContainer"
                width: Theme.dashboardMenuWidth
                height: menu.containerHeight
                clip: true

                Repeater {
                    id: rows
                    // The rows exist while the menu is open or fading, as
                    // the windows are laid out on opening (DWMStateOpen,
                    // DashboardWindowManagerStates.cpp:194-202); the lock
                    // screen shows them otherwise.
                    model: menu.open || menu.shown ? menu.model : null
                    delegate: MenuRow {}
                    onItemAdded: Qt.callLater(function() { menu.rowsRevision++; })
                    onItemRemoved: Qt.callLater(function() { menu.rowsRevision++; })
                }
            }
        }
    }

    // ---- Scroll fades and arrows (MenuContainer.qml:71-115) ----
    Item {
        objectName: "dashboardMenuScrollUp"
        z: 10
        width: parent.width - 2 * Theme.dashboardMenuSideMargin
        x: (parent.width - width) / 2
        opacity: !flick.atYBeginning ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.systemMenuScrollFadeDuration } }
        BorderImage {
            width: parent.width
            height: Theme.artHeight(source)
            source: Theme.asset("menu-dropdown-scrollfade-top.png")
            border { left: Theme.artBorder(20, source); right: Theme.artBorder(20, source) }
        }
        Image {
            x: (parent.width - width) / 2
            width: Theme.artWidth(source); height: Theme.artHeight(source)
            source: Theme.asset("menu-arrow-up.png")
        }
    }
    Item {
        objectName: "dashboardMenuScrollDown"
        z: 10
        width: parent.width - 2 * Theme.dashboardMenuSideMargin
        x: (parent.width - width) / 2
        y: flick.height - Theme.dashboardMenuScrollFadeBottomOffset
        opacity: !flick.atYEnd ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.systemMenuScrollFadeDuration } }
        BorderImage {
            width: parent.width
            height: Theme.artHeight(source)
            source: Theme.asset("menu-dropdown-scrollfade-bottom.png")
            border { left: Theme.artBorder(20, source); right: Theme.artBorder(20, source) }
        }
        Image {
            x: (parent.width - width) / 2
            y: Theme.px(10)
            width: Theme.artWidth(source); height: Theme.artHeight(source)
            source: Theme.asset("menu-arrow-down.png")
        }
    }
}
