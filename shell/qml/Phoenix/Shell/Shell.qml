// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Top level of the Phoenix system UI. Owns the layer order and the
// navigation model; everything device-specific comes in through `source`
// (windows and apps) and `system` (status: battery, radios, clock).

import QtQuick
import "LauncherLayout.js" as LauncherLayout

FocusScope {
    id: shell

    property var source
    property var system
    property url wallpaper: ""
    // "auto" picks the tablet layout when the screen's shorter side is at
    // least Theme.tabletMinSide legacy pixels (TouchPad 768; Pre 3 320), so a
    // phone turned sideways stays a phone.
    property string formFactor: "auto"
    // Device pixels per legacy pixel, as webOS scaled for screen density:
    // 1.0 on the Pre and TouchPad, 1.5 on the Pre 3. 0 derives it from the
    // output's pixel density (Theme.densityFor). The size of the output
    // does not change it: a larger screen shows more, not larger, UI.
    property real density: 0

    readonly property real effectiveDensity: density > 0 ? density : Theme.densityFor(Screen.pixelDensity * 25.4)
    readonly property bool tablet: formFactor === "tablet"
        || (formFactor === "auto" && Theme.tabletLayoutFor(width, height, effectiveDensity))
    readonly property bool locked: lockScreen.locked
    readonly property bool maximized: cards.maximized
    readonly property bool launcherOpen: launcher.open
    readonly property bool justTypeOpen: justType.open
    property alias launcherEditMode: launcher.editMode
    property alias cardView: cards
    property alias notifications: notes
    property alias searchPill: searchPill

    focus: true

    Binding { target: Theme; property: "tablet"; value: shell.tablet }
    Binding { target: Theme; property: "u"; value: shell.effectiveDensity }

    // ---- Navigation -----------------------------------------------------------

    // params (optional): launch params, e.g. from a tapped notification.
    function launch(appId, params) {
        if (!source)
            return;
        launcher.open = false;
        justType.open = false;
        var uid = source.launch(appId, cards.currentUid, params || null);
        if (uid !== "")
            Qt.callLater(cards.focusLaunched, uid);
    }

    function startJustType(text) {
        launcher.open = false;
        justType.start(text);
    }

    function openSystemMenu() { systemMenu.open = true; }

    function lock() { lockScreen.locked = true; systemMenu.open = false; }
    function unlock() { lockScreen.locked = false; }

    function gestureUp() {
        if (locked)
            return;
        systemMenu.open = false;
        notes.dashboardOpen = false;
        if (justType.open)
            justType.open = false;
        else if (cards.maximizeProgress > 0)
            cards.minimize();
        else
            launcher.open = !launcher.open;
    }

    function gestureBack() {
        if (locked)
            return;
        if (systemMenu.open)
            systemMenu.open = false;
        else if (notes.dashboardOpen)
            notes.dashboardOpen = false;
        else if (justType.open)
            justType.open = false;
        else if (launcher.editMode)
            launcher.editMode = false;
        else if (launcher.open)
            launcher.open = false;
        else if (cards.maximized)
            source.back(cards.currentUid);
    }

    function gestureTap() {
        if (locked)
            return;
        if (cards.maximizeProgress > 0)
            cards.minimize();
        else if (launcher.open)
            launcher.open = false;
        else if (cards.count > 0)
            cards.maximize();
    }

    // Apps opening a second window (e.g. compose) ask for it to be shown.
    Connections {
        target: shell.source
        ignoreUnknownSignals: true
        function onCardFocusRequested(uid) { Qt.callLater(cards.focusLaunched, uid); }
        function onCardCloseRequested(uid) { cards.close(uid); }
        function onJustTypeDismissed() { justType.open = false; }
        function onBannerRequested(appId, text, icon) {
            var a = null;
            for (var i = 0; shell.source.apps && i < shell.source.apps.count; ++i)
                if (shell.source.apps.get(i).appId === appId)
                    a = shell.source.apps.get(i);
            notes.showBanner(text, icon, a ? a.color : "#666666", a ? a.glyph : "");
        }
    }

    // Desktop / hardware keyboard shortcuts.
    Keys.onPressed: (event) => {
        // Card view keys (CardWindowManager.cpp:1189-1212).
        if (!locked && cards.maximizeProgress === 0 && !launcher.open && !justType.open) {
            if (event.key === Qt.Key_Left || event.key === Qt.Key_Right) {
                cards.slideTo(cards.currentGroup + (event.key === Qt.Key_Left ? -1 : 1));
                event.accepted = true;
                return;
            }
            if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && cards.count > 0) {
                cards.maximize();
                event.accepted = true;
                return;
            }
            if (event.key === Qt.Key_Backspace && (event.modifiers & Qt.ControlModifier) && cards.count > 0) {
                cards.close(cards.currentUid);
                event.accepted = true;
                return;
            }
        }
        if (event.key === Qt.Key_Escape || event.key === Qt.Key_Back) {
            gestureBack(); event.accepted = true;
        } else if (event.key === Qt.Key_Home || event.key === Qt.Key_F1) {
            gestureUp(); event.accepted = true;
        } else if (event.key === Qt.Key_F2 && source) {
            source.notify("org.webosphoenix.messaging", "Palm Pre", "It's good to be back.");
            event.accepted = true;
        } else if (event.key === Qt.Key_F3 || event.key === Qt.Key_PowerOff) {
            locked ? unlock() : lock(); event.accepted = true;
        } else if (!locked && !cards.maximized && !justType.open && event.text.length === 1
                   && event.text.trim() !== "" && !(event.modifiers & Qt.ControlModifier)) {
            // Just Type: typing in card view starts a search.
            startJustType(event.text);
            event.accepted = true;
        }
    }

    // ---- Layers, bottom to top ----------------------------------------------------

    // The scene behind the overlays (wallpaper, cards, launcher): what the
    // translucent surfaces above blur (BackdropBlur).
    readonly property alias backdrop: sceneBackdrop
    Item {
        id: sceneBackdrop
        anchors.fill: parent

        Wallpaper {
            anchors.fill: parent
            source: shell.wallpaper
        }

        CardView {
            id: cards
            anchors.fill: parent
            source: shell.source
            topInset: Theme.statusBarHeight
            // The app's positive space ends where the notifications' negative space begins.
            bottomInset: gesture.height + notes.negativeSpace
        }

        Launcher {
            id: launcher
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.topMargin: Theme.statusBarHeight
            anchors.bottom: parent.bottom
            anchors.bottomMargin: gesture.height + notes.negativeSpace
            dockHeight: quickLaunch.height
            apps: shell.source ? shell.source.apps : null
            layout: shell.launcherLayout
            draggedId: iconDrag.appId
            onLaunchRequested: (appId) => shell.launch(appId)
            onCloseRequested: launcher.open = false
            onDeleteRequested: (appId) => deleteDialog.ask(appId)
            onDragStarted: (appId, from, x, y) => iconDrag.start(appId, from, launcher.mapToItem(shell, x, y))
            onDragMoved: (x, y) => iconDrag.move(launcher.mapToItem(shell, x, y))
            onDragEnded: (x, y) => iconDrag.drop(launcher.mapToItem(shell, x, y))
        }
    }

    SearchPill {
        id: searchPill
        anchors.horizontalCenter: parent.horizontalCenter
        y: Theme.statusBarHeight + Theme.searchPillTopOffset
        shown: !locked && cards.maximizeProgress === 0 && !launcher.open && !justType.open
        onTapped: shell.startJustType("")
        backdrop: sceneBackdrop
    }

    QuickLaunch {
        id: quickLaunch
        anchors.left: parent.left
        anchors.right: parent.right
        y: parent.height - gesture.height - notes.negativeSpace - height
           + (height + gesture.height) * cards.maximizeProgress
        visible: cards.maximizeProgress < 1
        apps: shell.source ? shell.source.apps : null
        launcherOpen: launcher.open
        backdrop: sceneBackdrop
        dock: shell.launcherLayout ? shell.launcherLayout.dock : []
        draggedId: iconDrag.appId
        onLaunchRequested: (appId) => shell.launch(appId)
        onLauncherToggled: launcher.open = !launcher.open
        onDragStarted: (appId, from, x, y) => iconDrag.start(appId, from, quickLaunch.mapToItem(shell, x, y))
        onDragMoved: (x, y) => iconDrag.move(quickLaunch.mapToItem(shell, x, y))
        onDragEnded: (x, y) => iconDrag.drop(quickLaunch.mapToItem(shell, x, y))
    }

    // ---- Launcher layout: icon order on the pages and in the dock --------------
    // Built from the apps, kept across sessions when the window source can
    // store it (savedLauncherLayout / saveLauncherLayout).

    property var launcherLayout: null

    function rebuildLauncherLayout() {
        if (!source || !source.apps)
            return;
        var entries = [];
        for (var i = 0; i < source.apps.count; ++i) {
            var a = source.apps.get(i);
            entries.push({ id: a.appId, title: a.title, tab: a.tab, quickLaunch: a.quickLaunch });
        }
        var saved = launcherLayout;
        if (!saved && typeof source.savedLauncherLayout === "function") {
            try { saved = JSON.parse(source.savedLauncherLayout() || "null"); } catch (e) { saved = null; }
        }
        launcherLayout = LauncherLayout.build(entries, launcher.tabs.length, saved);
    }

    function setLauncherLayout(l) {
        launcherLayout = l;
        if (source && typeof source.saveLauncherLayout === "function")
            source.saveLauncherLayout(JSON.stringify(l));
    }

    Connections {
        target: shell.source ? shell.source.apps : null
        function onCountChanged() { Qt.callLater(shell.rebuildLauncherLayout); }
    }
    onSourceChanged: Qt.callLater(rebuildLauncherLayout)
    Component.onCompleted: Qt.callLater(rebuildLauncherLayout)

    // ---- Dragging an icon (launcher pages and dock) ----------------------------------
    // Press and hold picks an icon up; it follows the finger above everything.
    // Over the current page the others make room; on a tab it moves to that
    // page; on the dock it joins it (swapping out the app in that slot when
    // the dock is full); a dock icon dropped anywhere else leaves the dock.

    Item {
        id: iconDrag
        property string appId: ""
        property string from: ""
        property int lastIndex: -1
        z: 1000
        visible: appId !== ""
        width: Theme.launcherIconSize
        height: Theme.launcherIconSize

        function entry(id) {
            for (var i = 0; shell.source && i < shell.source.apps.count; ++i)
                if (shell.source.apps.get(i).appId === id)
                    return shell.source.apps.get(i);
            return null;
        }
        function place(p) {
            x = p.x - width / 2;
            y = p.y - height / 2;
        }
        function start(id, source, p) {
            var e = entry(id);
            if (!e)
                return;
            proxy.title = e.title;
            proxy.color = e.color;
            proxy.glyph = e.glyph;
            proxy.source = e.icon || "";
            from = source;
            lastIndex = -1;
            appId = id;
            place(p);
        }
        function overDock(p) {
            return quickLaunch.visible && p.y >= quickLaunch.y && p.y < quickLaunch.y + quickLaunch.height;
        }
        function move(p) {
            if (appId === "")
                return;
            place(p);
            if (!launcher.open || overDock(p))
                return;
            var lp = shell.mapToItem(launcher, p.x, p.y);
            var tab = launcher.tabAt(lp.x, lp.y);
            if (tab >= 0 && tab !== launcher.currentPage) {
                shell.setLauncherLayout(LauncherLayout.move(shell.launcherLayout, appId, tab, -1));
                launcher.showPage(tab);
                lastIndex = -1;
                return;
            }
            if (from === "page" && launcher.inPages(lp.x, lp.y)) {
                var page = LauncherLayout.pageOf(shell.launcherLayout, appId);
                var idx = launcher.indexAt(lp.x, lp.y);
                if (page !== launcher.currentPage) {
                    shell.setLauncherLayout(LauncherLayout.move(shell.launcherLayout, appId, launcher.currentPage, idx));
                } else if (idx >= 0 && idx !== lastIndex
                           && shell.launcherLayout.pages[page].indexOf(appId) !== idx) {
                    shell.setLauncherLayout(LauncherLayout.move(shell.launcherLayout, appId, page, idx));
                }
                lastIndex = idx;
            }
        }
        function drop(p) {
            if (appId === "")
                return;
            var l = shell.launcherLayout;
            if (overDock(p)) {
                var q = shell.mapToItem(quickLaunch, p.x, p.y);
                l = LauncherLayout.addToDock(l, appId, quickLaunch.slotAt(q.x), Theme.quickLaunchMaxItems - 1);
            } else if (from === "dock") {
                l = LauncherLayout.removeFromDock(l, appId);
            }
            shell.setLauncherLayout(l);
            appId = "";
        }

        AppIcon {
            id: proxy
            anchors.centerIn: parent
            size: Theme.launcherIconSize
            showLabel: false
            interactive: false
            scale: 1.15
            opacity: 0.9
        }
    }

    // Deleting an app asks first.
    Item {
        id: deleteDialog
        property string appId: ""
        anchors.fill: parent
        visible: appId !== ""
        z: 1001
        function ask(id) { appId = id; }
        function title() {
            var e = iconDrag.entry(appId);
            return e ? e.title : appId;
        }
        Rectangle { anchors.fill: parent; color: "#80000000" }
        MouseArea { anchors.fill: parent; onClicked: deleteDialog.appId = "" }
        BorderImage {
            anchors.centerIn: parent
            width: Math.min(parent.width - Theme.px(20), Theme.px(320))
            height: dialogColumn.height + Theme.px(40)
            source: Theme.asset("menu-dropdown-bg.png")
            border { left: 30; right: 30; top: 30; bottom: 30 }
            MouseArea { anchors.fill: parent }
            BackdropBlur {
                anchors.fill: parent
                z: -1
                source: sceneBackdrop
                mask: dialogShape
            }
            BorderImage {
                id: dialogShape
                visible: false
                anchors.fill: parent
                source: Theme.asset("menu-dropdown-bg.png")
                border { left: 30; right: 30; top: 30; bottom: 30 }
            }
            Column {
                id: dialogColumn
                x: Theme.px(20)
                y: Theme.px(20)
                width: parent.width - Theme.px(40)
                spacing: Theme.px(12)
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: qsTr("Delete %1?").arg(deleteDialog.title())
                    color: Theme.text
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.px(18)
                    font.bold: true
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: qsTr("The app and its data will be removed from this device.")
                    color: Theme.textDim
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.px(15)
                }
                Row {
                    spacing: Theme.px(10)
                    Repeater {
                        model: [qsTr("Delete"), qsTr("Cancel")]
                        delegate: Rectangle {
                            required property string modelData
                            required property int index
                            width: (dialogColumn.width - Theme.px(10)) / 2
                            height: Theme.px(40)
                            radius: Theme.px(8)
                            color: index === 0 ? "#b53a2f" : "#555a60"
                            border.color: "#20000000"
                            Text {
                                anchors.centerIn: parent
                                text: parent.modelData
                                color: "white"
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.px(16)
                                font.bold: true
                            }
                            MouseArea {
                                anchors.fill: parent
                                objectName: "deleteDialogButton" + parent.index
                                onClicked: {
                                    var id = deleteDialog.appId;
                                    deleteDialog.appId = "";
                                    if (parent.index !== 0)
                                        return;
                                    shell.setLauncherLayout(LauncherLayout.remove(shell.launcherLayout, id));
                                    if (shell.source && typeof shell.source.removeApp === "function")
                                        shell.source.removeApp(id);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    JustType {
        id: justType
        anchors.fill: parent
        apps: shell.source ? shell.source.apps : null
        source: shell.source
        onLaunchRequested: (appId) => shell.launch(appId)
        onCloseRequested: { justType.open = false; shell.forceActiveFocus(); }
    }

    // Phones round the corners of a maximized app (MenuWindowManager.cpp:126-146).
    Item {
        id: screenCorners
        anchors.fill: parent
        anchors.topMargin: Theme.statusBarHeight
        anchors.bottomMargin: gesture.height + notes.negativeSpace
        visible: !Theme.tablet && cards.maximized
        Image { anchors.left: parent.left; anchors.top: parent.top; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-top-left.png") }
        Image { anchors.right: parent.right; anchors.top: parent.top; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-top-right.png") }
        Image { anchors.left: parent.left; anchors.bottom: parent.bottom; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-bottom-left.png") }
        Image { anchors.right: parent.right; anchors.bottom: parent.bottom; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-bottom-right.png") }
    }

    LockScreen {
        id: lockScreen
        anchors.fill: parent
        system: shell.system
        wallpaper: shell.wallpaper
        onUnlockRequested: shell.unlock()
    }

    StatusBar {
        id: statusBar
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        system: shell.system
        appTitle: cards.maximized && !shell.locked
        title: appTitle ? cards.currentTitle : (shell.system ? shell.system.carrier : "")
        systemMenuOpen: systemMenu.open
        onSystemMenuRequested: systemMenu.open = !systemMenu.open
        onAppMenuRequested: {
            if (cards.maximized && shell.source && typeof shell.source.appMenu === "function")
                shell.source.appMenu(cards.currentUid);
        }
    }

    Notifications {
        id: notes
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: statusBar.bottom
        anchors.bottom: gesture.top
        model: shell.source ? shell.source.notifications : null
        onDismissRequested: (index) => shell.source.dismissNotification(index)
        onActivated: (appId, params) => shell.launch(appId, params ? JSON.parse(params) : null)
        source: shell.source
        backdrop: sceneBackdrop
        visible: !shell.locked
        screenHeight: shell.height
        statusBarRightInset: statusBar.systemGroupWidth
    }

    SystemMenu {
        id: systemMenu
        backdrop: sceneBackdrop
        anchors.fill: parent
        system: shell.system
        onCloseRequested: systemMenu.open = false
    }

    // Tablet: a flick up from the bottom edge does what the phone's gesture
    // area swipe-up does (SystemUiController::handleScreenEdgeFlickGesture,
    // SystemUiController.cpp:2041-2121); with the keyboard up it must travel
    // at least 60 px (kFlickMinimumYLengthWithKeyboardUp, :72). The TouchPad's
    // panel reported the flick from its bezel; here a thin strip along the
    // bottom edge starts it.
    property bool keyboardOpen: false
    MouseArea {
        id: bezel
        objectName: "bezelSwipe"
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: Theme.bezelEdgeHeight
        enabled: shell.tablet && !shell.locked
        preventStealing: true
        property real sx
        property real sy
        onPressed: (m) => { sx = m.x; sy = m.y; }
        onReleased: (m) => {
            var dy = sy - m.y;
            var min = shell.keyboardOpen ? Theme.px(Theme.bezelFlickMinimumWithKeyboard) : Theme.px(Theme.bezelFlickMinimum);
            if (dy >= min && dy > Math.abs(m.x - sx))
                shell.gestureUp();
        }
    }

    GestureArea {
        id: gesture
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: Theme.gestureAreaHeight
        visible: height > 0
        onUp: shell.gestureUp()
        onBack: shell.gestureBack()
        onTapped: shell.gestureTap()
    }
}
