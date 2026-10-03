// Copyright (c) 2026 webOS Phoenix contributors
// Copyright (c) 2010-2013 Hewlett-Packard Development Company, L.P. (the original)
// SPDX-License-Identifier: Apache-2.0
//
// Dock mode, "Exhibition": the full-screen surface that shows one
// exhibition while the device sits on a Touchstone. After luna-sysmgr's
// DockModeWindowManager (Src/lunaui/dock/DockModeWindowManager.cpp), with
// DockModeMenuManager's app menu (DockModeAppMenu.qml) and
// DockModePositionManager's memory of what each Touchstone showed.
//
//   - The exhibitions: the built-in Time (DockModeClock, always first and
//     never closed) then the apps the user turned on (Settings >
//     Exhibition; at first Photos, conf/default-exhibition-apps.json), each
//     an app whose appinfo.json says "exhibitionMode" (or "dockMode").
//   - An app's exhibition is its own window, launched with
//     {"dockMode": true, "windowType": "dockModeWindow"}
//     (DockModeWindowManager::launchApp, :582-603), the size of the screen
//     under the status bar; dock-loading-glow.png pulses while it loads
//     (DockModeWindow.cpp:50-116, giving up after 60 s).
//   - Switching (the status bar menu) cross-fades the two windows over
//     500 ms, InOutQuad (animateWindowChange, dockFadeDockAnimationDuration).
//     Only the one in front runs: it is told it is active
//     (DockModeWindow::focusEvent; source.activateWindow), the others that
//     it is not; the Time clocks tick only in front.
//   - Leaving dock mode keeps the exhibition in front and closes the other
//     apps' windows (dockModeCloseOnExit, setDockModeState, :509-540); the
//     next time it opens on that one again (m_defaultIndex).
//   - Each Touchstone (puckId, DockSerialNo) remembers the exhibition it
//     showed: set on a known one, that one shows (slotDockModeAnimation-
//     Complete, findDefaultDlpIndex); picking another remembers it
//     (switchApplication, :444-467). The window source keeps the list
//     (savedDockModePositions / saveDockModePositions: knownPucks).
//   - Behind the exhibitions: black (DockModeWindowManager::paint), or dock
//     mode's own wallpaper (the dockwallpaper preference) when one is set.
//
// The shell owns entering and leaving (Shell.enterDockMode / exitDockMode)
// and the transition; this item is what shows.

import QtQuick

Item {
    id: dock
    objectName: "dockMode"

    property var source: null
    property var system: null
    // In dock mode (DockModeWindowManager::m_inDockMode).
    property bool active: false
    // The screen is on: the exhibition in front runs.
    property bool running: true
    property url wallpaper: ""
    // The Touchstone the device is on ("" for none, or not known).
    property string puckId: ""
    property var fixedTime: null
    property bool twelveHourClock: true

    readonly property string timeAppId: "com.palm.app.dockmodetime"
    // What shows, and its row's title (the status bar's title).
    property string currentAppId: ""
    readonly property string currentTitle: {
        var e = exhibitionFor(currentAppId);
        return e ? e.title : "";
    }
    readonly property alias menuOpen: appMenu.open
    readonly property alias appMenu: appMenu
    readonly property alias time: timeExhibition

    // ---- The exhibitions ------------------------------------------------------

    // Bumped when the source's app list changes.
    property int _appsVersion: 0
    Connections {
        target: dock.source && dock.source.apps ? dock.source.apps : null
        function onCountChanged() { dock._appsVersion++; }
        function onDataChanged() { dock._appsVersion++; }
    }

    // [{appId, title, icon, builtIn}]: Time, then the apps turned on that
    // can be exhibitions, in the user's order.
    readonly property var exhibitions: {
        void _appsVersion;
        var list = [{ appId: timeAppId, title: qsTr("Time"), icon: String(Theme.asset("dockmode/time-icon-48x48.png")), builtIn: true }];
        var on = system && system.exhibitionApps ? system.exhibitionApps : [];
        var apps = source && source.apps ? source.apps : null;
        for (var i = 0; i < on.length; ++i) {
            for (var j = 0; apps && j < apps.count; ++j) {
                var a = apps.get(j);
                if (a.appId === on[i] && a.exhibition) {
                    list.push({ appId: a.appId, title: a.exhibitionTitle || a.title, icon: String(a.icon || ""), builtIn: false });
                    break;
                }
            }
        }
        return list;
    }
    function exhibitionFor(appId) {
        for (var i = 0; i < exhibitions.length; ++i)
            if (exhibitions[i].appId === appId)
                return exhibitions[i];
        return null;
    }

    // The exhibition in front when dock mode last ended (m_defaultIndex).
    property string _defaultAppId: timeAppId

    // ---- Touchstones (DockModePositionManager knownPucks) --------------------------

    property var _knownPucks: null
    function knownPucks() {
        if (_knownPucks === null) {
            var saved = null;
            try {
                saved = source && typeof source.savedDockModePositions === "function"
                        ? JSON.parse(source.savedDockModePositions() || "null") : null;
            } catch (e) { saved = null; }
            _knownPucks = saved && saved.knownPucks && typeof saved.knownPucks === "object" ? saved.knownPucks : {};
        }
        return _knownPucks;
    }
    function rememberPuck(puck, appId) {
        if (!puck || !appId)
            return;
        var k = knownPucks();
        if (k[puck] === appId)
            return;
        var copy = {};
        for (var p in k)
            copy[p] = k[p];
        copy[puck] = appId;
        _knownPucks = copy;
        if (source && typeof source.saveDockModePositions === "function")
            source.saveDockModePositions(JSON.stringify({ knownPucks: copy }));
    }

    // ---- Entering and leaving (setDockModeState) ----------------------------------

    // What shows on entering: the Touchstone's own, else the last one, else Time.
    function startingAppId() {
        var known = puckId !== "" ? knownPucks()[puckId] : undefined;
        if (known && exhibitionFor(known))
            return known;
        return exhibitionFor(_defaultAppId) ? _defaultAppId : timeAppId;
    }

    function enter() {
        appMenu.open = false;
        var id = startingAppId();
        // The Touchstone's exhibition may not be known yet (the list of
        // exhibitions comes from the system a moment after start-up): it
        // shows as soon as it is, unless the user picks another first.
        var known = puckId !== "" ? knownPucks()[puckId] : undefined;
        _awaitedAppId = known && known !== id ? known : "";
        // An unknown Touchstone remembers what it shows (slotPuckConnected).
        if (!known)
            rememberPuck(puckId, id);
        _show(id, false);
        active = true;
        _updateActivation();
    }
    property string _awaitedAppId: ""

    function exit() {
        appMenu.open = false;
        _awaitedAppId = "";
        active = false;
        if (currentAppId !== "") {
            _defaultAppId = currentAppId;
            rememberPuck(puckId, currentAppId);
        }
        _updateActivation();
        // dockModeCloseOnExit: the others' windows close.
        for (var id in _keys)
            if (id !== currentAppId)
                _closeWindow(id);
    }

    // The menu picked an exhibition (switchApplication).
    function switchTo(appId) {
        if (!exhibitionFor(appId))
            return;
        _awaitedAppId = "";
        rememberPuck(puckId, appId);
        if (appId === currentAppId)
            return;
        _show(appId, active && running);
    }

    // ---- Windows -------------------------------------------------------------------

    // appId -> the window source's key for its exhibition window.
    property var _keys: ({})
    // appId -> its slot (host item) on the stage.
    property var _slots: ({})
    property string _previousAppId: ""

    function windowKey(appId) { return _keys[appId] || ""; }

    function _openWindow(appId) {
        if (appId === timeAppId || _keys[appId])
            return;
        if (!source || typeof source.openSystemWindow !== "function")
            return;
        // DockModeWindowManager::launchApp's launch params.
        var key = source.openSystemWindow(appId, { dockMode: true, windowType: "dockModeWindow" }, "dockmode");
        if (!key)
            return;
        var keys = {};
        for (var k in _keys)
            keys[k] = _keys[k];
        keys[appId] = key;
        _keys = keys;
    }
    function _closeWindow(appId) {
        var key = _keys[appId];
        if (!key)
            return;
        var keys = {};
        for (var k in _keys)
            if (k !== appId)
                keys[k] = _keys[k];
        _keys = keys;
        if (source && typeof source.closeSystemWindow === "function")
            source.closeSystemWindow(key);
    }
    // The page closed its own window.
    Connections {
        target: dock.source
        ignoreUnknownSignals: true
        function onSystemWindowClosed(key) {
            for (var id in dock._keys) {
                if (dock._keys[id] !== key)
                    continue;
                var keys = {};
                for (var k in dock._keys)
                    if (k !== id)
                        keys[k] = dock._keys[k];
                dock._keys = keys;
                if (id === dock.currentAppId)
                    dock._show(dock.timeAppId, dock.active && dock.running);
                return;
            }
        }
    }

    function _show(appId, animate) {
        _openWindow(appId);
        var old = currentAppId;
        if (old === appId)
            return;
        crossFade.stop();
        _fade = animate && old !== "" ? 0 : 1;
        _previousAppId = animate ? old : "";
        currentAppId = appId;
        if (_previousAppId !== "")
            crossFade.start();
        _updateActivation();
    }

    // Only the one in front, in dock mode, with the screen on, runs.
    property string _activeKey: ""
    function _updateActivation() {
        var key = active && running ? (_keys[currentAppId] || "") : "";
        if (key === _activeKey)
            return;
        if (_activeKey !== "" && source && typeof source.activateWindow === "function")
            source.activateWindow(_activeKey, false);
        _activeKey = key;
        if (key !== "" && source && typeof source.activateWindow === "function")
            source.activateWindow(key, true);
    }
    onRunningChanged: _updateActivation()
    on_KeysChanged: _updateActivation()

    // An exhibition turned off (or its app removed) goes; Time takes its place.
    onExhibitionsChanged: Qt.callLater(_dropRemoved)
    function _dropRemoved() {
        if (active && _awaitedAppId !== "" && exhibitionFor(_awaitedAppId)) {
            var awaited = _awaitedAppId;
            _awaitedAppId = "";
            _show(awaited, running);
        }
        for (var id in _keys)
            if (!exhibitionFor(id))
                _closeWindow(id);
        if (currentAppId !== "" && !exhibitionFor(currentAppId))
            _show(timeAppId, false);
        if (!exhibitionFor(_defaultAppId))
            _defaultAppId = timeAppId;
    }

    // ---- What shows -----------------------------------------------------------------

    Rectangle {
        anchors.fill: parent
        color: "black"
    }
    Wallpaper {
        objectName: "dockWallpaper"
        anchors.fill: parent
        visible: String(dock.wallpaper) !== ""
        source: dock.wallpaper
    }

    Item {
        id: stage
        objectName: "dockStage"
        anchors.fill: parent

        // The Time exhibition, always there.
        DockModeTime {
            id: timeExhibition
            objectName: "dockModeTime"
            anchors.fill: parent
            readonly property bool front: dock.currentAppId === dock.timeAppId
            visible: front || dock._previousAppId === dock.timeAppId
            opacity: front ? dock._fade : 1 - dock._fade
            mainTimerRunning: front && dock.active && dock.running
            twelveHourClock: dock.twelveHourClock
            fixedTime: dock.fixedTime
            wallpaperBehind: String(dock.wallpaper) !== ""
        }

        // The apps' windows.
        Repeater {
            model: dock.exhibitions
            delegate: Item {
                id: slot
                required property var modelData
                readonly property string appId: modelData.appId
                readonly property string key: dock._keys[appId] || ""
                readonly property bool front: dock.currentAppId === appId
                objectName: "dockSlot_" + appId
                anchors.fill: parent
                visible: !modelData.builtIn && key !== "" && (front || dock._previousAppId === appId)
                opacity: front ? dock._fade : 1 - dock._fade

                Item {
                    id: host
                    anchors.fill: parent
                }
                property Item window: null
                onKeyChanged: Qt.callLater(attach)
                Component.onCompleted: Qt.callLater(attach)
                function attach() {
                    var w = key !== "" && dock.source ? dock.source.windowFor(key) : null;
                    if (w === window)
                        return;
                    window = w;
                    if (!w)
                        return;
                    w.parent = host;
                    w.x = 0;
                    w.y = 0;
                    w.width = Qt.binding(function() { return host.width; });
                    w.height = Qt.binding(function() { return host.height; });
                    w.visible = true;
                }

                // Loading: the glow pulses until the page is up (60 s at most).
                readonly property bool loading: window !== null && window.ready === false && !loadTimeout.done
                Timer {
                    id: loadTimeout
                    property bool done: false
                    interval: 60000
                    running: slot.window !== null && slot.window.ready === false
                    onTriggered: done = true
                }
                Image {
                    objectName: "dockLoadingGlow"
                    anchors.centerIn: parent
                    visible: slot.loading
                    source: Theme.asset("dockmode/dock-loading-glow.png")
                    width: Theme.artWidth(source)
                    height: Theme.artHeight(source)
                    SequentialAnimation on opacity {
                        running: slot.loading && slot.visible
                        loops: Animation.Infinite
                        NumberAnimation { from: 0.25; to: 1; duration: 900; easing.type: Easing.InOutQuad }
                        NumberAnimation { from: 1; to: 0.25; duration: 900; easing.type: Easing.InOutQuad }
                    }
                }
            }
        }
    }

    // The cross-fade between exhibitions: _fade 0 -> 1 is the newcomer's
    // opacity (the other's is 1 - _fade).
    property real _fade: 1
    NumberAnimation {
        id: crossFade
        target: dock
        property: "_fade"
        from: 0
        to: 1
        duration: Theme.motion(500)
        easing.type: Easing.InOutQuad
        onFinished: dock._previousAppId = ""
    }

    // A tap on an exhibition goes to it; while the menu is open it closes
    // the menu (DockModeMenuManager::handleMousePress).
    DockModeAppMenu {
        id: appMenu
        anchors.fill: parent
        apps: dock.exhibitions
        onSelected: (appId) => dock.switchTo(appId)
        onCloseRequested: appMenu.open = false
    }
    onActiveChanged: if (!active) appMenu.open = false
}
