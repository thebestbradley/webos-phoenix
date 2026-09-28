// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Top level of the Phoenix system UI. Owns the layer order and the
// navigation model; everything device-specific comes in through `source`
// (windows and apps) and `system` (status: battery, radios, clock).

import QtQuick

FocusScope {
    id: shell

    property var source
    property var system
    property url wallpaper: ""
    // "auto" picks tablet for landscape outputs.
    property string formFactor: "auto"

    readonly property bool tablet: formFactor === "tablet" || (formFactor === "auto" && width > height)
    readonly property bool locked: lockScreen.locked
    readonly property bool maximized: cards.maximized
    readonly property bool launcherOpen: launcher.open
    readonly property bool justTypeOpen: justType.open
    property alias cardView: cards
    property alias notifications: notes
    property alias searchPill: searchPill

    focus: true

    // Scale legacy pixels to this output: 320px-wide phone, 768px-tall tablet.
    Binding { target: Theme; property: "tablet"; value: shell.tablet }
    Binding {
        target: Theme; property: "u"
        value: shell.tablet ? Math.min(shell.width, shell.height) / Theme.tabletRefHeight
                            : Math.min(shell.width, shell.height) / Theme.phoneRefWidth
    }

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

    Wallpaper {
        anchors.fill: parent
        source: shell.wallpaper
    }

    CardView {
        id: cards
        anchors.fill: parent
        source: shell.source
        topInset: Theme.statusBarHeight
        bottomInset: gesture.height
    }

    SearchPill {
        id: searchPill
        anchors.horizontalCenter: parent.horizontalCenter
        y: Theme.statusBarHeight + Theme.searchPillTopOffset
        shown: !locked && cards.maximizeProgress === 0 && !launcher.open && !justType.open
        onTapped: shell.startJustType("")
    }

    QuickLaunch {
        id: quickLaunch
        anchors.left: parent.left
        anchors.right: parent.right
        y: parent.height - gesture.height - notes.barHeight - height
           + (height + gesture.height) * cards.maximizeProgress
        visible: cards.maximizeProgress < 1
        apps: shell.source ? shell.source.apps : null
        launcherOpen: launcher.open
        onLaunchRequested: (appId) => shell.launch(appId)
        onLauncherToggled: launcher.open = !launcher.open
    }

    Launcher {
        id: launcher
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: statusBar.bottom
        anchors.bottom: quickLaunch.top
        apps: shell.source ? shell.source.apps : null
        onLaunchRequested: (appId) => shell.launch(appId)
        onCloseRequested: launcher.open = false
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
        anchors.bottomMargin: gesture.height
        visible: !Theme.tablet && cards.maximized
        Image { anchors.left: parent.left; anchors.top: parent.top; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-top-left.png") }
        Image { anchors.right: parent.right; anchors.top: parent.top; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-top-right.png") }
        Image { anchors.left: parent.left; anchors.bottom: parent.bottom; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-bottom-left.png") }
        Image { anchors.right: parent.right; anchors.bottom: parent.bottom; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-bottom-right.png") }
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
    }

    SystemMenu {
        id: systemMenu
        anchors.fill: parent
        system: shell.system
        onCloseRequested: systemMenu.open = false
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
