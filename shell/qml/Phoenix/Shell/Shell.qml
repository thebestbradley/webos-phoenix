// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Top level of the Phoenix system UI. Owns the layer order and the
// navigation model; everything device-specific comes in through `source`
// (windows and apps) and `system` (status: battery, radios, clock).

import QtQuick
import Phoenix.Native
import "LauncherLayout.js" as LauncherLayout
import "KeyboardShortcuts.js" as KeyboardShortcuts

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
    // A maximized app in full-screen mode: no status bar or notification
    // area (SystemUiController::isInFullScreenMode).
    readonly property bool fullScreen: cards.maximized && cards.currentFullScreen
    readonly property bool launcherOpen: launcher.open
    readonly property bool justTypeOpen: justType.open
    property alias launcherEditMode: launcher.editMode
    // The launcher page shown (LauncherLayout.PAGES: apps 0, downloads 1,
    // favorites 2, prefs 3).
    function showLauncherPage(i) { launcher.showPage(i); }
    property alias cardView: cards
    property alias notifications: notes
    property alias searchPill: searchPill
    property alias lockScreen: lockScreen

    focus: true

    Binding { target: Theme; property: "tablet"; value: shell.tablet }
    // The device has a Home button its maker uses instead of the gesture
    // bar (a device's /etc/phoenix/device.json, phoenix-sim --home-button):
    // no gesture bar, and on a tablet the bottom-edge flick stands in for
    // its swipe up, as on the TouchPad.
    property bool hardwareHomeButton: false
    Binding { target: Theme; property: "hardwareHomeButton"; value: shell.hardwareHomeButton }
    // Settings > Accessibility > Reduce motion.
    Binding { target: Theme; property: "reduceMotion"; value: !!(shell.system && shell.system.reduceMotion) }
    // Tell the window source which card is in front (apps it launches join
    // its stack).
    Binding {
        target: shell.source
        property: "focusedUid"
        when: shell.source !== null && shell.source !== undefined && shell.source.focusedUid !== undefined
        value: cards.maximized ? cards.currentUid : ""
    }
    Binding { target: Theme; property: "u"; value: shell.effectiveDensity }

    // ---- Navigation -----------------------------------------------------------

    // params (optional): launch params, e.g. from a tapped notification.
    // Returns the card's uid ("" for apps without a card).
    function launch(appId, params) {
        if (!source)
            return "";
        // An app coming up ends dock mode (cardWindowAdded).
        if (dockMode)
            exitDockMode(true);
        launcher.open = false;
        justType.open = false;
        var uid = source.launch(appId, cards.currentUid, params || null);
        if (uid !== "")
            Qt.callLater(cards.focusLaunched, uid);
        return uid;
    }

    // A tap on an app the launcher shows as being installed: the original
    // sent the launch of an app not ready to Software Manager
    // (WebAppMgrProxy.cpp:544-559), where a failed install could be tried
    // again or removed. Here a failed one asks (Try Again, Remove); one
    // still installing opens what installs it (the Marketplace's page for
    // the app), when the window source says.
    function pendingAppTapped(appId) {
        var e = launcher.entry(appId);
        if (!e)
            return;
        if (e.installState === "failed") {
            deleteDialog.ask(appId);
            return;
        }
        var info = source && typeof source.installInfo === "function" ? source.installInfo(appId) : null;
        if (info && info.open && info.open.id)
            launch(info.open.id, info.open.params || null);
    }

    function startJustType(text) {
        launcher.open = false;
        justType.start(text);
    }

    // Not over the lock screen (LockWindow sits above the menus), nor in First Use.
    // In dock mode it opens over the exhibition (DockModeMenuManager's own).
    function openSystemMenu() { if ((!locked || dockMode) && !firstUse) systemMenu.open = true; }

    function lock() {
        if (firstUse)
            return;
        lockScreen.locked = true;
        systemMenu.open = false;
    }
    function unlock() {
        lockScreen.locked = false;
        closeEmergency();
        // Unlocked only with the screen on (a call answered from the
        // lock screen, say).
        backlight.turnOn();
    }

    // ---- The display (DisplayManager; Display.qml) ---------------------------------
    // It dims and turns off when left alone ("Turn off after", the system
    // preference screenTimeout), off on the lock screen after 5 s, and
    // turning off locks. Power turns it off, and Power or Home on again (to
    // the lock screen). Banners, popup alerts, calls and a charger plugged in
    // turn it on. The window source shows the state (the device's
    // backlight; the simulator's veil).
    readonly property alias display: backlight
    property alias stayAwake: backlight.stayAwake
    // A click on the dark screen wakes it (phoenix-sim; see UserActivity).
    property alias tapToWake: userActivity.tapToWake
    Display {
        id: backlight
        timeout: shell.system && shell.system.screenTimeout > 0 ? shell.system.screenTimeout : 60
        locked: shell.locked
        // An app in front keeping the screen on (blockScreenTimeout).
        blocked: cards.maximized && cards.currentBlocksScreenTimeout
        onTurnedOff: shell.lock()
        // On the Touchstone it waits for dock mode instead of dimming.
        onPuck: shell._exhibitionsOnPuck
        puckTimeout: shell.system && shell.system.exhibitionStartAfter > 0 ? shell.system.exhibitionStartAfter * 1000 : 0
        dockMode: shell.dockMode
        night: shell.dockMode && shell.nightModeNow
        onPuckTimedOut: shell.enterDockMode()
    }
    // Every touch and key resets its timers; while it is off the touch
    // panel takes nothing and only Power, Home and the volume keys get
    // through.
    UserActivity {
        id: userActivity
        asleep: !backlight.on
        onWakeRequested: backlight.turnOn()
        passKeys: [Qt.Key_Home, Qt.Key_F3, Qt.Key_PowerOff, Qt.Key_VolumeUp, Qt.Key_VolumeDown, Qt.Key_F10, Qt.Key_F11]
        onActivity: backlight.activity()
        tapRadius: Theme.tapRadius
        onTapped: (pos) => {
            var p = shell.mapFromItem(null, pos.x, pos.y);
            // Not over the keyboard, whose keys show their own
            // (InputWindowManager::doReticle).
            var k = ime.mapFromItem(shell, p.x, p.y);
            if (ime.visible && ime.contains(k))
                return;
            reticle.startAt(p.x, p.y);
        }
    }
    Connections {
        target: notes
        // DisplayManager::alert: a banner (shown on the lock screen only
        // with "Show notifications when locked"), a popup alert, a call
        // (on while it rings).
        function onBannerActiveChanged() {
            if (notes.bannerActive && (!shell.locked || lockScreen.showAlertsWhenLocked))
                backlight.alert(false);
        }
        function onAlertShownChanged() {
            if (notes.alertShown)
                backlight.alert(notes.incomingCall);
        }
        function onIncomingCallChanged() {
            if (notes.incomingCall)
                backlight.alert(true);
            else
                backlight.callDone();
        }
    }
    // A charger plugged in turns it on (DisplayOff: DisplayEventUsbIn).
    Connections {
        target: shell.system
        ignoreUnknownSignals: true
        function onChargingChanged() {
            // The Touchstone has its own rules (dock mode, below).
            if (shell.system.charging && backlight.state !== "on" && !shell.onPuck)
                backlight.turnOn();
        }
    }

    // ---- Dock mode, "Exhibition" (GAPS R5) ------------------------------------------
    // On a Touchstone, the inductive charger (powerd's DockConnected with
    // DockPower; system.onPuck), the device shows an exhibition: the Time
    // clocks, Photos' slideshow, ... (DockMode.qml). When, as DisplayManager's
    // states had it (Src/base/DisplayStates.cpp):
    //   - set on it with the screen off: at once (DisplayOff, DisplayEventOnPuck);
    //   - set on it with the screen on: the screen stays bright, and when it
    //     would have turned off (or after Settings > Exhibition's "Start
    //     after") the exhibition starts (DisplayOnPuck); locked, the lock
    //     screen first asks to unlock, as DisplayOnPuck's lock state did;
    //   - Power, or the shell locking, while on it (DisplayOn / DisplayOnPuck,
    //     DisplayEventPowerKeyPress, DisplayEventLockScreen);
    //   - not on a call, nor with one ringing (DisplayEventOnCall), nor in
    //     First Use or the emergency window; only with exhibitions on
    //     (Settings > Exhibition).
    // In dock mode the device is locked, in the lock screen's dock state
    // (LockWindow StateDockMode); the screen stays on (DisplayDockMode),
    // dimmed to the night brightness in night mode. It ends on Home, the
    // swipe up, Back with nothing to close, the tablet's edge flick
    // (SystemUiController.cpp:450-453, 529-532, 944-951, 2082-2085), an app
    // card coming up (a banner or dashboard tapped: cardWindowAdded,
    // setCardWindowMaximized) or lifting the device off; then the lock screen
    // asks to unlock (DisplayDockMode -> DisplayOnPuck / DisplayOn, lock state
    // Unlocked: LockWindow::tryUnlock), unless the screen is off. A call
    // coming in ends it too, to the lock screen and its call
    // (DisplayDockMode, DisplayEventOnCall). Power turns the screen off and
    // on again without leaving it (DisplayDockMode -> DisplayOff -> on the
    // puck, DisplayDockMode). The transition: the screen shrinks to nothing
    // as it fades over 900 ms while dock mode grows in from twice its size
    // over 500 ms after 270 ms, InOutQuad, and the reverse to leave
    // (WindowServerLuna::initDockModeAnimations; AnimationSettings
    // dockFade*); with the screen off, at once.
    readonly property bool onPuck: !!(system && system.onPuck)
    readonly property bool exhibitionEnabled: !system || system.exhibitionEnabled !== false
    readonly property bool _exhibitionsOnPuck: onPuck && exhibitionEnabled && !firstUse
    property bool dockMode: false
    property bool _dockTransition: false
    readonly property alias dock: dockLayer

    // Night mode (Settings > Exhibition): between nightStart and nightEnd.
    property bool nightModeNow: false
    function _minutesOf(hhmm) {
        var m = /^(\d\d):(\d\d)$/.exec(hhmm || "");
        return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : -1;
    }
    function _updateNightMode() {
        var s = system;
        if (!s || !s.exhibitionNightMode) {
            nightModeNow = false;
            return;
        }
        var now = s.fixedTime ? s.fixedTime : new Date();
        var t = now.getHours() * 60 + now.getMinutes();
        var a = _minutesOf(s.exhibitionNightStart), b = _minutesOf(s.exhibitionNightEnd);
        nightModeNow = a >= 0 && b >= 0 && a !== b && (a < b ? t >= a && t < b : t >= a || t < b);
    }
    Timer {
        interval: 30000
        repeat: true
        running: shell.dockMode
        triggeredOnStart: true
        onTriggered: shell._updateNightMode()
    }
    Connections {
        target: shell.system
        ignoreUnknownSignals: true
        function onExhibitionNightModeChanged() { shell._updateNightMode(); }
        function onExhibitionNightStartChanged() { shell._updateNightMode(); }
        function onExhibitionNightEndChanged() { shell._updateNightMode(); }
    }
    // The sound preference: "mute" keeps an exhibition quiet.
    Binding {
        target: shell.sounds
        property: "quiet"
        value: shell.dockMode && !!shell.system && shell.system.dockModeSound === "mute"
    }

    function _dockAllowed() {
        return _exhibitionsOnPuck && !emergencyShown && !notes.incomingCall
            && !(source && source.activeCallBanner);
    }

    // Returns whether dock mode is up.
    function enterDockMode() {
        if (dockMode)
            return true;
        if (!_dockAllowed())
            return false;
        var animate = backlight.on;
        systemMenu.open = false;
        siteMenu.open = false;
        notes.dashboardOpen = false;
        justType.open = false;
        launcher.open = false;
        lockScreen.locked = true;
        lockScreen.dockMode = true;
        dockMode = true;
        dockLayer.enter();
        _dockTransitionTo(true, animate);
        backlight.turnOn();
        return true;
    }

    // unlock: ask to unlock after (the lock screen's passcode if one is
    // needed), as leaving DisplayDockMode for DisplayOnPuck / DisplayOn did.
    function exitDockMode(unlock) {
        if (!dockMode)
            return;
        var animate = backlight.on;
        dockLayer.exit();
        dockMode = false;
        lockScreen.dockMode = false;
        _dockTransitionTo(false, animate);
        if (unlock && backlight.on)
            lockScreen.requestUnlock();
    }

    function _dockTransitionTo(entering, animate) {
        dockEnterAnimation.stop();
        dockExitAnimation.stop();
        if (!animate || Theme.reduceMotion) {
            _dockTransition = false;
            screenLayers.opacity = 1;
            screenLayers.scale = 1;
            screenLayers.visible = !entering;
            dockLayer.opacity = 1;
            dockLayer.scale = 1;
            return;
        }
        _dockTransition = true;
        screenLayers.visible = true;
        if (entering) {
            // From the first frame: not yet there, twice its size.
            dockLayer.opacity = 0;
            dockLayer.scale = 2;
        } else {
            screenLayers.opacity = 0;
            screenLayers.scale = 0;
        }
        (entering ? dockEnterAnimation : dockExitAnimation).start();
    }
    ParallelAnimation {
        id: dockEnterAnimation
        NumberAnimation { target: screenLayers; property: "opacity"; from: 1; to: 0; duration: Theme.dockScreenFadeDuration; easing.type: Easing.InOutQuad }
        NumberAnimation { target: screenLayers; property: "scale"; from: 1; to: 0; duration: Theme.dockScreenFadeDuration; easing.type: Easing.InOutQuad }
        SequentialAnimation {
            PauseAnimation { duration: Theme.dockStartDelay }
            ParallelAnimation {
                NumberAnimation { target: dockLayer; property: "opacity"; from: 0; to: 1; duration: Theme.dockFadeDuration; easing.type: Easing.InOutQuad }
                NumberAnimation { target: dockLayer; property: "scale"; from: 2; to: 1; duration: Theme.dockFadeDuration; easing.type: Easing.InOutQuad }
            }
        }
        onFinished: {
            shell._dockTransition = false;
            screenLayers.visible = !shell.dockMode;
            screenLayers.opacity = 1;
            screenLayers.scale = 1;
        }
    }
    // The same run backwards: the screen grows back over 900 ms, dock mode
    // shrinks away into twice its size from 130 ms to 630 ms.
    ParallelAnimation {
        id: dockExitAnimation
        NumberAnimation { target: screenLayers; property: "opacity"; from: 0; to: 1; duration: Theme.dockScreenFadeDuration; easing.type: Easing.InOutQuad }
        NumberAnimation { target: screenLayers; property: "scale"; from: 0; to: 1; duration: Theme.dockScreenFadeDuration; easing.type: Easing.InOutQuad }
        SequentialAnimation {
            PauseAnimation { duration: Theme.dockScreenFadeDuration - Theme.dockStartDelay - Theme.dockFadeDuration }
            ParallelAnimation {
                NumberAnimation { target: dockLayer; property: "opacity"; from: 1; to: 0; duration: Theme.dockFadeDuration; easing.type: Easing.InOutQuad }
                NumberAnimation { target: dockLayer; property: "scale"; from: 1; to: 2; duration: Theme.dockFadeDuration; easing.type: Easing.InOutQuad }
            }
        }
        onFinished: {
            shell._dockTransition = false;
            dockLayer.opacity = 1;
            dockLayer.scale = 1;
        }
    }

    // Set on or lifted off the Touchstone.
    on_ExhibitionsOnPuckChanged: {
        if (_exhibitionsOnPuck) {
            if (!backlight.on)
                enterDockMode();
            else if (locked && !dockMode)
                lockScreen.requestUnlock();
        } else if (dockMode) {
            exitDockMode(true);
        }
    }
    // A call ringing ends it, to the lock screen and the call.
    Connections {
        target: notes
        function onIncomingCallChanged() {
            if (notes.incomingCall && shell.dockMode)
                shell.exitDockMode(false);
        }
    }
    // An app's card coming up ends it (a banner tapped, a call answered).
    Connections {
        target: shell.source ? shell.source.cards : null
        function onRowsInserted() {
            if (shell.dockMode)
                shell.exitDockMode(true);
        }
    }

    // ---- First Use (LunaSysMgr's minimal UI) --------------------------------------
    // Until First Use has run, LunaSysMgr started in its minimal UI with
    // only com.palm.app.firstuse (LunaSysMgr.upstart: "-u minimal -a
    // com.palm.app.firstuse" while /var/luna/preferences/ran-first-use is
    // missing; WindowManagerMinimal): a status bar and the app, full screen,
    // no launcher, lock screen or system menu (SystemUiController ignores the
    // launcher key in UI_MINIMAL). Here the app is the one maximized card:
    // no dock, launcher, search pill or Just Type; swipe up shows card view
    // only when First Use opened another app (Accounts, Help), and First
    // Use's card cannot be flicked away. It ends when the app closes its
    // window (after setting the system preference firstUseComplete).
    property string firstUseAppId: "org.webosphoenix.firstuse"
    property string _firstUseUid: ""
    readonly property bool firstUse: _firstUseUid !== ""
    signal firstUseEnded

    function startFirstUse() {
        if (!source || firstUse)
            return firstUse;
        var uid = source.launch(firstUseAppId, "", { firstUse: true });
        if (uid === "")
            return false;
        lockScreen.locked = false;
        systemMenu.open = false;
        launcher.open = false;
        justType.open = false;
        notes.dashboardOpen = false;
        _firstUseUid = uid;
        dockShown = false;
        Qt.callLater(cards.focusLaunched, uid);
        return true;
    }
    function _checkFirstUseCard() {
        if (!firstUse || !source || !source.cards)
            return;
        for (var i = 0; i < source.cards.count; ++i)
            if (source.cards.get(i).uid === _firstUseUid)
                return;
        _firstUseUid = "";
        _showDock();
        firstUseEnded();
    }
    Connections {
        target: shell.source ? shell.source.cards : null
        function onRowsRemoved() { shell._checkFirstUseCard(); }
    }

    // ---- The emergency window (EmergencyWindowManager) ------------------------------
    // The PIN pad's Emergency Call opens Phone's restricted mode as the
    // emergency window, over the lock screen (EmergencyWindow.qml). The
    // window source makes it: openSystemWindow(appId, params, "emergency")
    // -> key, closeSystemWindow(key), systemWindowClosed(key) when the page
    // closes itself.
    property string emergencyAppId: "org.webosphoenix.phone"
    readonly property bool emergencyShown: emergencyWindow.windowKey !== ""
    readonly property bool emergencyAvailable: !!source && typeof source.openSystemWindow === "function"

    function openEmergency() {
        if (emergencyShown || !emergencyAvailable)
            return emergencyShown;
        var key = source.openSystemWindow(emergencyAppId, { emergency: true }, "emergency");
        emergencyWindow.windowKey = key || "";
        return emergencyShown;
    }
    // The Home button closes it (EmergencyWindowManager::slotHomeButtonPressed).
    function closeEmergency() {
        var key = emergencyWindow.windowKey;
        if (key === "")
            return;
        emergencyWindow.windowKey = "";
        if (source && typeof source.closeSystemWindow === "function")
            source.closeSystemWindow(key);
        _emergencyClosed();
    }
    // Back to the PIN pad, which takes the keys again.
    function _emergencyClosed() {
        if (lockScreen.pinEntry)
            lockScreen.unlockPanel.forceActiveFocus();
        else
            shell.forceActiveFocus();
    }
    Connections {
        target: shell.source
        ignoreUnknownSignals: true
        function onSystemWindowClosed(key) {
            if (key !== emergencyWindow.windowKey)
                return;
            emergencyWindow.windowKey = "";
            shell._emergencyClosed();
        }
    }

    // ---- The dock's state (OverlayWindowManager's dock state machine,
    // :340-395, and SystemUiController's show / hide calls) --------------
    // Hidden when a card is added or maximizes, when Just Type opens, and
    // on phones when the dashboard opens; shown as a card starts to
    // minimize, when the launcher opens, and when Just Type or the
    // dashboard closes in card view - never over Just Type (slotShowDock).
    property bool dockShown: true
    function _showDock() {
        if (!justType.open && !firstUse)
            dockShown = true;
    }
    Connections {
        target: cards
        function onMaximizeProgressChanged() {
            if (cards.maximizeProgress > 0 && !cards.minimizing)
                shell.dockShown = false;
        }
        function onMinimizingChanged() {
            if (cards.minimizing)
                shell._showDock();
        }
    }
    Connections {
        target: shell.source ? shell.source.cards : null
        function onRowsInserted() { shell.dockShown = false; }
    }
    Connections {
        target: justType
        function onOpenChanged() {
            if (justType.open)
                shell.dockShown = false;
            else if (!cards.maximized)
                shell._showDock();
        }
    }
    Connections {
        target: launcher
        function onOpenChanged() {
            if (launcher.open)
                shell._showDock();
            else if (cards.maximizeProgress > 0 && !cards.minimizing)
                shell.dockShown = false;
        }
    }
    Connections {
        target: notes
        // SystemUiController::setDashboardOpened (:896-925): phones' dashboard
        // owns the negative space.
        function onDashboardOpenChanged() {
            if (Theme.tablet)
                return;
            if (notes.dashboardOpen)
                shell.dockShown = false;
            else if (!cards.maximized && !launcher.open)
                shell._showDock();
        }
    }

    // The gesture area's swipe up, Key_CoreNavi_Launcher (SystemUiController
    // .cpp:445-495, sysUiNoHomeButtonMode): the dashboard and menu close,
    // then Just Type hides, or the launcher closes, or the app minimizes, or
    // the launcher opens.
    function gestureUp() {
        if (emergencyShown) {
            closeEmergency();
            return;
        }
        // Dock mode: out (SystemUiController.cpp:450-453).
        if (dockMode) {
            exitDockMode(true);
            return;
        }
        if (locked)
            return;
        // First Use: card view only to switch to an app it opened.
        if (firstUse) {
            if (cards.maximizeProgress > 0 && !cards.minimizing && cards.count > 1)
                cards.minimize();
            return;
        }
        systemMenu.open = false;
        notes.dashboardOpen = false;
        if (justType.open)
            justType.open = false;
        else if (launcher.open)
            launcher.open = false;
        else if (cards.maximizeProgress > 0 && !cards.minimizing)
            cards.minimize();
        else
            launcher.open = true;
    }

    // Settings > Text Assist > Hardware keyboard: "ipad" or "desktop"
    // (KeyboardShortcuts.js).
    readonly property string keyboardShortcuts: system && system.keyboardShortcuts === "desktop" ? "desktop" : "ipad"

    // The meta key's Edit commands (SystemUiController::slotCopy and the
    // rest): to Just Type while it is open, else to the app in front.
    function metaEdit(action) {
        if (locked)
            return;
        backlight.activity();
        if (justType.open) {
            justType.edit(action);
            return;
        }
        if (!cards.maximized || !source || !source.windowFor)
            return;
        var w = source.windowFor(cards.currentUid);
        if (w && typeof w.edit === "function")
            w.edit(action);
    }

    // A hardware keyboard shortcut's action (GAPS V8). Not over the lock
    // screen (but for nothing), First Use or the emergency window.
    function shortcut(action) {
        if (locked || firstUse || emergencyShown)
            return;
        shortcutSheet.shown = false;
        if (action === "next" || action === "previous") {
            justType.open = false;
            launcher.open = false;
            cards.switchApp(action === "next");
        } else if (action === "cardView") {
            justType.open = false;
            launcher.open = false;
            if (cards.maximizeProgress > 0 && !cards.minimizing)
                cards.minimize();
        } else if (action === "justType") {
            searchKey();
        } else if (action === "close") {
            if (cards.count > 0 && !launcher.open && !justType.open)
                cards.close(cards.currentUid, false);
        } else if (action === "launcher") {
            if (launcher.open) {
                launcher.open = false;
            } else {
                justType.open = false;
                if (cards.maximizeProgress > 0)
                    cards.minimize();
                launcher.open = true;
            }
        } else if (action === "maximize") {
            gestureDown();
        } else if (action === "notifications") {
            notes.dashboardOpen = !notes.dashboardOpen;
        } else if (action === "lock") {
            lock();
        }
    }

    // A keyboard's Search key: Just Type opens, or closes if it is open;
    // not over the lock screen or the emergency window (Qt::Key_Search,
    // SystemUiController.cpp:607-618).
    function searchKey() {
        if (locked || emergencyShown || firstUse)
            return;
        if (justType.open)
            justType.open = false;
        else
            startJustType("");
    }

    // The Home button, Key_CoreNavi_Home (:527-583): one thing per press -
    // the dashboard, the popup alert (closed, as signalCloseAlert did), the
    // menu, the launcher, Just Type - then the app minimizes; with nothing
    // left it toggles the launcher. A double press reaches the launcher: the
    // second arrives while the card is still minimizing (the original saw
    // it as the release's auto-repeat flag).
    function homeKey() {
        // Off, Home only turns the screen on (to the lock screen).
        if (!backlight.on) {
            backlight.turnOn();
            return;
        }
        if (emergencyShown) {
            closeEmergency();
            return;
        }
        // Dock mode: out (SystemUiController.cpp:529-532).
        if (dockMode) {
            exitDockMode(true);
            return;
        }
        if (locked || firstUse)
            return;
        if (notes.dashboardOpen) {
            notes.dashboardOpen = false;
        } else if (notes.alertShown) {
            if (source && typeof source.closeAlert === "function")
                source.closeAlert(notes.alertKey);
        } else if (systemMenu.open) {
            systemMenu.open = false;
        } else if (launcher.open) {
            launcher.open = false;
        } else if (justType.open) {
            justType.open = false;
        } else if (cards.maximizeProgress > 0 && !cards.minimizing) {
            cards.minimize();
        } else {
            launcher.open = !launcher.open;
        }
    }

    // Key_CoreNavi_SwipeDown (SystemUiController.cpp:498-525): in card view,
    // with nothing open over it, the active card comes up maximized.
    function gestureDown() {
        if (locked || emergencyShown || notes.dashboardOpen || systemMenu.open || launcher.open || justType.open)
            return;
        if (cards.count > 0 && cards.maximizeProgress === 0)
            cards.maximize();
    }

    // SystemUiController::handleEvent, Key_CoreNavi_Back (:424-443): the
    // dashboard, then the status bar menu, then the launcher (whose hiding
    // ends its edit mode, LauncherObject::slotSystemHidingLauncher), unless
    // Just Type is up: the key goes to its page, which closes it. Otherwise
    // the focused app gets it.
    function gestureBack() {
        if (emergencyShown) {
            source.back(emergencyWindow.windowKey);
            return;
        }
        // Dock mode (SystemUiController.cpp:424-443, 940-951): the dashboard,
        // then a menu, close; otherwise Back leaves it.
        if (dockMode) {
            if (notes.dashboardOpen)
                notes.dashboardOpen = false;
            else if (systemMenu.open)
                systemMenu.open = false;
            else if (dockLayer.menuOpen)
                dockLayer.appMenu.open = false;
            else
                exitDockMode(true);
            return;
        }
        if (locked) {
            // The back gesture (or Esc) on the passcode panel cancels it.
            if (lockScreen.unlockPanel.shown)
                lockScreen.unlockPanel.entryCanceled();
            return;
        }
        if (notes.dashboardOpen)
            notes.dashboardOpen = false;
        else if (siteMenu.open)
            siteMenu.open = false;
        else if (systemMenu.open)
            systemMenu.open = false;
        else if (justType.open)
            justType.open = false;
        else if (launcher.open)
            launcher.open = false;
        else if (cards.maximized)
            source.back(cards.currentUid);
    }

    // The forward swipe (left to right; Key_CoreNavi_Menu, or Next turned
    // into Menu while advanced gestures are off): on its release it closes
    // the dashboard and the menus, and is eaten while they or the launcher
    // are up (SystemUiController::handleKeyEvent, SystemUiController.cpp:
    // 306-337, 410-422). Otherwise it goes to the app; webOS apps had no
    // forward of their own (Enyo 1.0 has none, and the key it reached Mojo
    // as is not recorded), so a site or web app goes forward in its history,
    // as Back goes back.
    function gestureForward() {
        // Dock mode: it closes the dashboard and the menus (Key_CoreNavi_Menu).
        if (dockMode) {
            notes.dashboardOpen = false;
            systemMenu.open = false;
            dockLayer.appMenu.open = false;
            return;
        }
        if (locked || emergencyShown)
            return;
        if (notes.dashboardOpen || siteMenu.open || systemMenu.open) {
            notes.dashboardOpen = false;
            siteMenu.open = false;
            systemMenu.open = false;
            return;
        }
        if (justType.open || launcher.open || !cards.maximized || !source)
            return;
        if (typeof source.siteState !== "function")
            return;
        var st = source.siteState(cards.currentUid);
        if (st && st.canGoForward)
            source.siteAction(cards.currentUid, "forward");
    }

    // Advanced gestures' long swipes (Key_CoreNavi_Previous / Next): on
    // the release they close the dashboard and the menus and, unless the
    // launcher is up, show the app beside this one, maximized if this one
    // was (SystemUiController.cpp:394-408; MaximizeState / MinimizeState::
    // changeCardWindow, CardWindowManagerStates.cpp:173-179, 443-449: Next,
    // rightward, is the card to the left). toRight: the card to the right.
    function gestureSwitchApp(toRight) {
        if (locked || emergencyShown)
            return;
        notes.dashboardOpen = false;
        siteMenu.open = false;
        systemMenu.open = false;
        if (launcher.open || justType.open)
            return;
        cards.switchApp(toRight);
    }

    function gestureTap() {
        if (locked || emergencyShown || (firstUse && cards.count < 2))
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
        function onCardCloseRequested(uid) { cards.close(uid, true); }
        function onJustTypeDismissed() { justType.open = false; }
        function onBannerRequested(appId, text, icon, params, soundClass, soundFile, soundDuration, bannerId) {
            var a = null;
            for (var i = 0; shell.source.apps && i < shell.source.apps.count; ++i)
                if (shell.source.apps.get(i).appId === appId)
                    a = shell.source.apps.get(i);
            // BannerMessageHandler::aboutToShowBanner: its sound as it shows
            // (after the ones queued before it).
            notes.showBanner(text, icon, a ? a.color : "#666666", a ? a.glyph : "", appId, params || "", bannerId || "",
                             function () { sounds.notification(appId, soundClass || "", soundFile || "", soundDuration || 0, false); });
        }
        function onBannerRemoved(appId, bannerId) { notes.removeBanner(appId, bannerId); }
        function onBannersCleared(appId) { notes.clearBanners(appId); }
        // PalmSystem.playSoundNotification, or a notification with a sound.
        function onSoundRequested(appId, soundClass, soundFile, duration) {
            sounds.notification(appId, soundClass, soundFile, duration, false);
        }
    }

    // ---- System sounds -----------------------------------------------------------------
    // What plays for banners, popup alerts, the keyboard, closing a card and
    // the battery (SystemSounds.qml, SoundPolicy.js).
    readonly property SystemSounds sounds: SystemSounds {
        source: shell.source
        system: shell.system
        playBootSound: shell.bootSound
    }
    // WindowServer's boot and shutdown sounds (phoenix-sim turns them on
    // when interactive).
    property bool bootSound: false

    // The popup alert in front is the active one (AlertWindow::activate):
    // it sounds, and stops when it leaves the front or closes.
    property string _soundingAlert: ""
    function _updateAlertSound() {
        var key = notes.alertKey;
        if (key === _soundingAlert)
            return;
        var old = _soundingAlert;
        _soundingAlert = key;
        if (old !== "") {
            var open = false;
            for (var i = 0; notes.alerts && i < notes.alerts.count; ++i)
                if (notes.alerts.get(i).key === old)
                    open = true;
            if (open)
                sounds.alertDeactivated(old);
            else
                sounds.alertClosed(old);
        }
        if (key !== "") {
            var a = notes.alerts.get(0);
            sounds.alertActivated(key, a.appId, a.sound || "", a.soundClass || "");
        }
    }
    Connections {
        target: notes
        function onAlertKeyChanged() { Qt.callLater(shell._updateAlertSound); }
    }

    // An overlay that takes the keys while it is open (the system menu):
    // the item that had the keyboard gets it back when it closes.
    property Item _focusBeforeOverlay: null
    function _overlayFocus(opened) {
        if (opened) {
            if (Window.activeFocusItem !== shell)
                _focusBeforeOverlay = Window.activeFocusItem;
            shell.forceActiveFocus();
        } else if (_focusBeforeOverlay) {
            var f = _focusBeforeOverlay;
            _focusBeforeOverlay = null;
            if (Window.activeFocusItem === shell && f.visible)
                f.forceActiveFocus();
        }
    }

    // Desktop / hardware keyboard shortcuts.
    Keys.onPressed: (event) => {
        // The system menu's own keys (GAPS V8 (3)).
        if (systemMenu.handleKey(event)) {
            event.accepted = true;
            return;
        }
        // Typed while Just Type's page is still taking its first letter.
        if (justType.open && event.text.length === 1 && !(event.modifiers & Qt.ControlModifier)
                && justType.typeAhead(event.text)) {
            event.accepted = true;
            return;
        }
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
        if (!locked && !firstUse && !cards.maximized && !justType.open && event.text.length === 1
                   && event.text.trim() !== "" && !(event.modifiers & Qt.ControlModifier)) {
            // Just Type: typing in card view starts a search.
            startJustType(event.text);
            event.accepted = true;
        }
    }

    // The system's keys, whatever has the keyboard focus (an app's web
    // view takes every key it is given): Home and Power act on release, as
    // the original, and together are a screen capture; Print Screen, F9 (the
    // simulator, for keyboards without Home) and Ctrl+Alt+P (the phones'
    // Orange+Sym+P, WindowServer.cpp:687-697) capture at once. On a Mac,
    // Qt's Ctrl is Command and Meta is Control: both Command+Option+P and
    // Control+Option+P capture.
    SystemKeys {
        id: systemKeys
        // Also the simulator's gestures and demo keys (sim/main.cpp): Esc
        // (or Back) the back gesture, F1 the up gesture, F2 a notification.
        keys: [Qt.Key_Home, Qt.Key_F3, Qt.Key_PowerOff, Qt.Key_Print, Qt.Key_F9,
               Qt.Key_VolumeUp, Qt.Key_VolumeDown, Qt.Key_F10, Qt.Key_F11,
               Qt.Key_Escape, Qt.Key_Back, Qt.Key_F1, Qt.Key_F2,
               // A Bluetooth keyboard's (the TouchPad keyboard's): Search
               // opens or closes Just Type (SystemUiController.cpp:607-618).
               Qt.Key_Search]
        // Its card-view key, Super (Qt's Meta on Linux), is the swipe up
        // (Key_Super_L, :338-343) when pressed on its own; with another key
        // it is a modifier. On a Mac Meta is Control: not there.
        soloKeys: Qt.platform.os === "osx" ? [Qt.Key_Super_L, Qt.Key_Super_R]
                                           : [Qt.Key_Super_L, Qt.Key_Super_R, Qt.Key_Meta]
        onTapped: (key) => {
            if (!backlight.on)
                return;
            backlight.activity();
            shell.gestureUp();
        }
        // The screen capture's two, then the shortcut scheme's
        // (KeyboardShortcuts.js; Settings > Text Assist > Hardware keyboard).
        readonly property var captureChords: [{ key: Qt.Key_P, modifiers: Qt.ControlModifier | Qt.AltModifier },
                                              { key: Qt.Key_P, modifiers: Qt.MetaModifier | Qt.AltModifier }]
        readonly property var shortcuts: KeyboardShortcuts.scheme(shell.keyboardShortcuts)
        // With the gesture area held (the meta key), C, X, V and A are the
        // Edit commands (MetaKeyManager::handleEvent).
        readonly property var metaChords: [{ key: Qt.Key_C, modifiers: 0, action: "copy" },
                                           { key: Qt.Key_X, modifiers: 0, action: "cut" },
                                           { key: Qt.Key_V, modifiers: 0, action: "paste" },
                                           { key: Qt.Key_A, modifiers: 0, action: "selectAll" }]
        chords: captureChords.concat(shortcuts.map(function (s) { return { key: s.key, modifiers: s.modifiers }; }))
                             .concat(gesture.metaHeld ? metaChords.map(function (c) { return { key: c.key, modifiers: c.modifiers }; }) : [])
        // Held on its own, the scheme's modifier lists them (ShortcutSheet).
        watchKeys: [KeyboardShortcuts.sheetKey(shell.keyboardShortcuts)]
        onHolding: (key, down) => {
            if (down && !shell.locked && !shell.firstUse && backlight.on)
                sheetDelay.restart();
            else {
                sheetDelay.stop();
                shortcutSheet.shown = false;
            }
        }
        onPressed: (key, autoRepeat) => {
            // The volume keys repeat while held (the simulator's F10, F11).
            if (key === Qt.Key_VolumeUp || key === Qt.Key_VolumeDown || key === Qt.Key_F10 || key === Qt.Key_F11) {
                backlight.activity();
                shell.volumeKey(key === Qt.Key_VolumeUp || key === Qt.Key_F11);
                return;
            }
            if (autoRepeat)
                return;
            // The screen is off: only Power and Home do anything.
            if (!backlight.on && key !== Qt.Key_Home && !shell._isPowerKey(key))
                return;
            backlight.activity();
            if (key === Qt.Key_Print || key === Qt.Key_F9)
                shell.takeScreenshot();
            else if (key === Qt.Key_Escape || key === Qt.Key_Back)
                shell.gestureBack();
            else if (key === Qt.Key_F1)
                shell.gestureUp();
            else if (key === Qt.Key_Search)
                shell.searchKey();
            else if (key === Qt.Key_F2) {
                if (shell.source)
                    shell.source.notify("org.webosphoenix.messaging", "Palm Pre", "It's good to be back.");
            } else
                shell._buttonDown(key === Qt.Key_Home);
        }
        onReleased: (key, autoRepeat) => {
            if (!autoRepeat && (key === Qt.Key_Home || shell._isPowerKey(key)))
                shell._buttonUp(key === Qt.Key_Home);
        }
        onChord: (index) => {
            if (index < captureChords.length)
                shell.takeScreenshot();
            else if (index >= captureChords.length + shortcuts.length)
                shell.metaEdit(metaChords[index - captureChords.length - shortcuts.length].action);
            else if (backlight.on) {
                backlight.activity();
                shell.shortcut(shortcuts[index - captureChords.length].action);
            }
        }
    }

    // ---- Keyboard accessibility (GAPS V8 (4)) ------------------------------------
    // Settings > Accessibility > Keyboard: sticky, slow and bounce keys and
    // the key repeat, on the hardware keyboard's keys before SystemKeys
    // and the apps see them (created after SystemKeys, so its filter runs
    // first). Not over the lock screen's latches: locking drops them.
    readonly property KeyboardAccess keyboardAccess: KeyboardAccess {
        readonly property var prefs: shell.system && shell.system.keyboardAccess ? shell.system.keyboardAccess : ({})
        stickyKeys: !!prefs.stickyKeys
        slowKeys: (prefs.slowKeys || 0) > 0
        slowKeysDelay: prefs.slowKeys || 300
        bounceKeys: (prefs.bounceKeys || 0) > 0
        bounceKeysDelay: prefs.bounceKeys || 300
        customRepeat: !!prefs.customRepeat
        repeatDelay: prefs.repeatDelay !== undefined ? prefs.repeatDelay : 500
        repeatInterval: prefs.repeatInterval || 50
    }

    // ---- The volume keys ----------------------------------------------------------
    // They change the volume the system menu's slider shows, in steps of
    // 10, and the indicator shows it in the picture for what is playing
    // (audiod's scenario, from the system: a call, a ringing call, media,
    // else the ringer's). With the ringer switched off (Mute), the ringer's
    // volume is not changed: the bell, crossed out
    // (NativeAlertManager::actOnChanged). On the lock screen too
    // (LockWindow lets the volume keys through), and with the screen off
    // they change it without waking it.
    readonly property alias volumeIndicator: volumeIndicator
    function volumeKey(up) {
        var sys = shell.system;
        if (!sys || sys.volume === undefined)
            return;
        var scenario = sys.audioScenario || "system";
        if (sys.muted && (scenario === "ringtone" || scenario === "system")) {
            if (backlight.on)
                volumeIndicator.show("mute", 0);
            return;
        }
        sys.volume = Math.max(0, Math.min(100, sys.volume + (up ? 10 : -10)));
        if (backlight.on)
            volumeIndicator.show(scenario === "phone" ? "phone" : scenario === "media" ? "media" : "ringtone", sys.volume);
    }

    // ---- Home + Power: a screen capture -----------------------------------------
    // WindowServer.cpp:629-683: releasing one of the two while the other is
    // held, within 3 s of its press, takes the capture, and the other's
    // release is then eaten (no Home, no screen off). Alone, each does its
    // job on release. (The simulator's Power is F3.)
    property bool _homeDown: false
    property bool _powerDown: false
    property real _homeDownAt: 0
    property real _powerDownAt: 0
    property bool _eatHomeUp: false
    property bool _eatPowerUp: false
    function _isPowerKey(k) { return k === Qt.Key_F3 || k === Qt.Key_PowerOff; }
    function _buttonDown(home) {
        if (home) {
            _homeDown = true;
            _eatHomeUp = false;
            _homeDownAt = Date.now();
        } else {
            _powerDown = true;
            _eatPowerUp = false;
            _powerDownAt = Date.now();
        }
    }
    function _buttonUp(home) {
        var now = Date.now();
        if (home) {
            _homeDown = false;
            if (_eatHomeUp) {
                _eatHomeUp = false;
            } else if (_powerDown && now - _homeDownAt <= 3000) {
                takeScreenshot();
                _eatPowerUp = true;
            } else {
                homeKey();
            }
        } else {
            _powerDown = false;
            if (_eatPowerUp) {
                _eatPowerUp = false;
            } else if (_homeDown && now - _powerDownAt <= 3000) {
                takeScreenshot();
                _eatHomeUp = true;
            } else {
                // Power turns the screen off (and so locks), or on again to
                // the lock screen (DisplayManager: DisplayEventPowerKeyPress).
                // On the Touchstone it starts dock mode instead of turning
                // the screen off (DisplayOn / DisplayOnPuck), and on again,
                // locked, it is back in dock mode (DisplayOff on the puck).
                if (backlight.on) {
                    if (!dockMode && _exhibitionsOnPuck && enterDockMode())
                        return;
                    backlight.turnOff();
                } else {
                    backlight.turnOn();
                    if (!dockMode && _exhibitionsOnPuck && locked)
                        enterDockMode();
                }
            }
        }
    }

    // ---- Screen captures (docs/SCREENSHOTS.md SC1) ------------------------------
    // WindowServer::takeAndSaveScreenShot: the UI as it is, the "shutter"
    // feedback sound, then the flash; the window source saves the PNG
    // (the simulator: runtime.saveScreenshot, which files it under
    // /media/internal/screencaptures and posts the "Screen captured"
    // notification that opens the Screenshot app's preview), named after
    // the app in front.
    signal screenshotTaken(string name, int bytes)
    property bool _capturing: false
    function captureName() {
        if (locked)
            return qsTr("Lock Screen");
        // The card in front once it fills most of the screen: a capture
        // taken while it is still maximizing (or minimizing) shows it.
        if (cards.maximizeProgress > 0.5 && cards.currentUid !== "") {
            var c = cards.cardItem(cards.currentUid);
            if (c && c.title)
                return c.title;
        }
        return launcher.open ? qsTr("Launcher") : qsTr("Card View");
    }
    // Back in card view, or with the launcher or nothing in front, the
    // shell has the keyboard again (arrow keys, type to search): the card's
    // web view kept it otherwise.
    Connections {
        target: cards
        function onMaximizeProgressChanged() {
            if (cards.maximizeProgress === 0 && !shell.locked && !justType.open)
                shell.forceActiveFocus();
        }
    }
    property var _captureResult: null
    // The runtime's "Screen captured" notification names the file: the
    // thumbnail opens that one.
    Connections {
        target: shell.source && shell.source.notifications ? shell.source.notifications : null
        ignoreUnknownSignals: true
        function onRowsInserted(parent, first, last) {
            for (var i = first; i <= last; ++i) {
                var n = shell.source.notifications.get(i);
                if (n.appId !== "org.webosphoenix.screenshot" || !n.params)
                    continue;
                try {
                    var p = JSON.parse(n.params);
                    if (p.path && captureThumbnail.shown)
                        captureThumbnail.path = p.path;
                } catch (e) { /* not ours */ }
            }
        }
    }
    function takeScreenshot() {
        if (_capturing)
            return false;
        _capturing = true;
        var name = captureName();
        var ok = ui.grabToImage(function(result) {
            shell._capturing = false;
            sounds.feedback("shutter");
            captureFlash.start();
            // Kept while its thumbnail shows (the url lives as long as it).
            shell._captureResult = result;
            captureThumbnail.show(result.url);
            var png = ImageTools.pngBase64(result.image);
            if (png !== "" && source && typeof source.saveScreenshot === "function")
                source.saveScreenshot(png, name);
            shell.screenshotTaken(name, png.length);
        });
        if (!ok)
            _capturing = false;
        return ok;
    }

    // ---- Launcher layout: icon order on the pages and in the dock --------------
    // Built from the apps, kept across sessions when the window source can
    // store it (savedLauncherLayout / saveLauncherLayout).

    property var launcherLayout: null

    function _launcherEntries() {
        var entries = [];
        for (var i = 0; source && source.apps && i < source.apps.count; ++i) {
            var a = source.apps.get(i);
            // page: the page the app's appinfo.json names ("" for none);
            // dynamic: a launch point an app added (addLaunchPoint), for
            // Favorites; category, keywords and installed place the rest
            // (LauncherLayout.pageFor).
            entries.push({ id: a.appId, appId: a.webAppId || a.appId, title: a.title, tab: a.tab, quickLaunch: a.quickLaunch,
                           page: a.page || "", dynamic: !!a.dynamic, category: a.category || "",
                           keywords: a.keywords ? String(a.keywords).split("\n").filter(function(k) { return k !== ""; }) : [],
                           installed: !!a.installed });
        }
        return entries;
    }

    function rebuildLauncherLayout() {
        if (!source || !source.apps)
            return;
        var entries = _launcherEntries();
        var saved = launcherLayout;
        if (!saved && typeof source.savedLauncherLayout === "function") {
            try { saved = JSON.parse(source.savedLauncherLayout() || "null"); } catch (e) { saved = null; }
        }
        launcherLayout = LauncherLayout.build(entries, saved);
    }

    function setLauncherLayout(l) {
        launcherLayout = l;
        if (source && typeof source.saveLauncherLayout === "function")
            source.saveLauncherLayout(JSON.stringify(l));
    }

    // A backup brought a layout back: it replaces this one, for the apps
    // that are installed (LauncherLayout.build keeps those only).
    function restoreLauncherLayout(json) {
        var l;
        try { l = JSON.parse(json); } catch (e) { return; }
        if (!l || typeof l !== "object" || !source || !source.apps)
            return;
        setLauncherLayout(LauncherLayout.build(_launcherEntries(), l));
    }

    Connections {
        target: shell.source ? shell.source.apps : null
        function onCountChanged() { Qt.callLater(shell.rebuildLauncherLayout); }
    }
    Connections {
        target: shell.source
        ignoreUnknownSignals: true
        function onLauncherLayoutRestored(json) { shell.restoreLauncherLayout(json); }
    }
    onSourceChanged: Qt.callLater(rebuildLauncherLayout)

    // ---- Virtual keyboard (IMEController, InputWindowManager) --------------------------
    // [VirtualKeyboard] VirtualKeyboardEnabled: off in luna.conf (:116-117),
    // on for the phones and tablets that had one (luna-topaz.conf:48-49,
    // luna-pyramid.conf:99-100, ...). The simulator turns it on; a device
    // leaves it off and reports OSE's own keyboard (platformKeyboardHeight).
    property bool virtualKeyboard: false
    // A hardware keyboard is attached (the TouchPad's Bluetooth keyboard;
    // system.hardwareKeyboard): the virtual keyboard stays down when a
    // field takes the focus, as with webOS's keyboard-open state, and comes
    // up only when asked for (the keyboard button above the gesture bar,
    // the keyboard's own keyboard key); typing on the hardware keyboard
    // puts it away again (GAPS V8 (1)).
    readonly property bool hardwareKeyboard: !!(system && system.hardwareKeyboard)
    property bool _keyboardAskedFor: false
    function showVirtualKeyboard() {
        if (!imeClient)
            return;
        _keyboardAskedFor = true;
        _showIMEInternal(true);
    }
    onHardwareKeyboardChanged: {
        _keyboardAskedFor = false;
        Qt.callLater(_updateImeClient);
    }
    Connections {
        target: shell.keyboardAccess
        function onHardwareKeyPressed(key) {
            if (shell.hardwareKeyboard && shell._imeOpened && shell._keyboardAskedFor) {
                shell._keyboardAskedFor = false;
                shell._hideIMEInternal();
            }
        }
    }
    // The height of a keyboard the platform draws (OSE's IME panel on a
    // device, PhoenixViewsRoot): the shell makes room for it the same way.
    property real platformKeyboardHeight: 0
    // Dictation's transcriber (Phoenix.Native Dictation.command): [] for the
    // device's (luna-send to org.webosphoenix.transcriber); phoenix-sim runs
    // the same code on the computer.
    property var dictationCommand: []
    // IMEController::isIMEOpened (or the platform's keyboard is up). With
    // it the tablet's bezel flick must travel further.
    readonly property bool keyboardOpen: _imeOpened || platformKeyboardHeight > 0
    readonly property alias keyboard: ime
    // What the keyboard types into: {kind: "item", item} for a text field of
    // the shell's, {kind: "web", uid} for a web page's editable element
    // (source.inputFocusChanged; uid "justtype" for Just Type's page), with
    // its PalmIME::EditorState.
    property var imeClient: null
    property bool _imeOpened: false               // IMEController::m_imeOpened
    property string _pendingVisibility: ""        // m_pendingVisibility: "show", "hide"
    // The keyboard is on screen (it slides out with the negative space).
    property bool _imeOwnsSpace: false
    property string _keyboardShownUid: ""         // CardWindow::m_keyboardShownMessageSent
    property var _webInput: null                  // {uid, state}: the page's focused field
    readonly property Item _focusItem: Window.activeFocusItem
    // The window that has the keyboard focus: Just Type's, else the
    // maximized card's (CardWindow focus; a card in card view has none).
    readonly property string _focusedWindowUid: emergencyShown ? emergencyWindow.windowKey
        : justType.open ? "justtype" : (cards.maximized ? cards.currentUid : "")

    function _isTextField(item) {
        return item !== null && item !== undefined && item.inputMethodHints !== undefined
            && item.cursorPosition !== undefined && !item.readOnly;
    }
    // PalmIME::EditorState for a text field of the shell's.
    function _editorStateFor(item) {
        var h = item.inputMethodHints, type = 0;
        if (item.echoMode !== undefined && item.echoMode !== TextInput.Normal)
            type = 1;                                           // FieldType_Password
        else if (h & Qt.ImhEmailCharactersOnly)
            type = 4;                                           // FieldType_Email
        else if (h & Qt.ImhUrlCharactersOnly)
            type = 7;                                           // FieldType_URL
        else if (h & Qt.ImhDialableCharactersOnly)
            type = 6;                                           // FieldType_Phone
        else if (h & (Qt.ImhDigitsOnly | Qt.ImhFormattedNumbersOnly))
            type = 5;                                           // FieldType_Number
        return { type: type, actions: 0, flags: 0, enterKeyLabel: "" };
    }

    // Which client has the input focus now; IMEController::setClient /
    // notifyInputFocusChange on a change.
    function _updateImeClient() {
        if (!virtualKeyboard)
            return;
        var c = null;
        var panel = lockScreen.unlockPanel;
        if (locked) {
            // Only the lock screen's password panel (LockWindow).
            if (panel.inputClient)
                c = { kind: "item", item: panel, state: { type: 1, actions: 0, flags: 0, enterKeyLabel: "" } };
        } else if (_isTextField(_focusItem)) {
            c = { kind: "item", item: _focusItem, state: _editorStateFor(_focusItem) };
        } else if (_webInput && _webInput.uid === _focusedWindowUid) {
            c = { kind: "web", uid: _webInput.uid, state: _webInput.state };
        }
        var old = imeClient;
        var same = old !== null && c !== null && old.kind === c.kind && old.item === c.item && old.uid === c.uid;
        imeClient = c;
        if (!same)
            _keyboardAskedFor = false;
        if (c && hardwareKeyboard && !_keyboardAskedFor) {
            ime.editorState = c.state;
            _hideIMEInternal();
        } else if (c)
            _showIMEInternal(!same || JSON.stringify(old.state) !== JSON.stringify(c.state));
        else if (old)
            _hideIMEInternal();
    }
    on_FocusItemChanged: Qt.callLater(_updateImeClient)
    on_FocusedWindowUidChanged: Qt.callLater(_updateImeClient)
    Connections {
        target: lockScreen.unlockPanel
        function onInputClientChanged() { Qt.callLater(shell._updateImeClient); }
    }
    onVirtualKeyboardChanged: Qt.callLater(_updateImeClient)
    Connections {
        target: shell.source
        ignoreUnknownSignals: true
        // A page's editable element got or lost the focus (WebKit's IME
        // client), or the app showed or hid the keyboard itself
        // (PalmSystem.keyboardShow / keyboardHide in manual mode).
        function onInputFocusChanged(uid, focused, state) {
            if (focused)
                shell._webInput = { uid: uid, state: state || {} };
            else if (shell._webInput && shell._webInput.uid === uid)
                shell._webInput = null;
            Qt.callLater(shell._updateImeClient);
        }
    }

    // IMEController::showIMEInternal: not while a finger is on the screen
    // (then when it lifts); restartInput hands the field's state over.
    function _showIMEInternal(restart) {
        if (fingers.active) {
            _pendingVisibility = "show";
            return;
        }
        _pendingVisibility = "";
        // The field first: it decides the keyboard's height (the candidate bar).
        if (imeClient && restart)
            ime.editorState = imeClient.state;
        if (!_imeOpened) {
            _imeOpened = true;
            _slotShowIME();
        }
    }
    function _hideIMEInternal() {
        if (fingers.active) {
            _pendingVisibility = "hide";
            return;
        }
        _pendingVisibility = "";
        if (_imeOpened) {
            _imeOpened = false;
            _slotHideIME();
        }
    }
    // slotTouchesReleasedFromScreen
    Connections {
        target: fingers
        function onActiveChanged() {
            if (fingers.active)
                return;
            if (shell._pendingVisibility === "hide")
                shell._hideIMEInternal();
            else if (shell._pendingVisibility === "show")
                shell._showIMEInternal(true);
        }
    }
    // The hide key (IMEController::hideIME): the field loses the focus, and
    // with it the keyboard.
    function hideKeyboard() {
        var c = imeClient;
        // The lock screen's password panel keeps its focus.
        if (!c || c.item === lockScreen.unlockPanel) {
            _hideIMEInternal();
            return;
        }
        if (c.kind === "item") {
            c.item.focus = false;
        } else {
            if (source && typeof source.removeInputFocus === "function")
                source.removeInputFocus(c.uid);
            _webInput = null;
        }
        Qt.callLater(_updateImeClient);
    }

    // InputWindowManager::slotShowIME / slotHideIME: the keyboard's height
    // becomes the negative space, animated, and the app in front hears of it
    // (CardWindow::slotShowIME / slotHideIME -> Mojo.keyboardShown).
    function _slotShowIME() {
        ime.shown = true;
        _imeOwnsSpace = true;
        _setKeyboardSpace(ime.keyboardHeight, false);
        var uid = cards.maximized ? cards.currentUid : "";
        if (uid !== "" && source && typeof source.keyboardShown === "function") {
            _keyboardShownUid = uid;
            source.keyboardShown(uid, true);
        }
    }
    function _slotHideIME() {
        ime.shown = false;
        _setKeyboardSpace(0, false);
        if (_keyboardShownUid !== "" && source && typeof source.keyboardShown === "function")
            source.keyboardShown(_keyboardShownUid, false);
        _keyboardShownUid = "";
    }
    function _setKeyboardSpace(h, immediate) {
        notes.spaceImmediate = immediate;
        notes.keyboardHeight = h;
        notes.spaceImmediate = false;
    }
    // slotKeyboardHeightChanged: at once.
    Connections {
        target: ime
        function onKeyboardHeightChanged() {
            if (shell._imeOpened)
                shell._setKeyboardSpace(ime.keyboardHeight, true);
        }
    }
    // The platform's keyboard (a device): its panel's height, as it slides.
    onPlatformKeyboardHeightChanged: if (!_imeOpened) _setKeyboardSpace(platformKeyboardHeight, true)

    // The scene behind the overlays (wallpaper, cards, launcher): what the
    // translucent surfaces above blur (BackdropBlur).
    readonly property alias backdrop: sceneBackdrop
    // The UI root, which turns with the device.
    readonly property alias uiRoot: ui
    readonly property alias rotator: uiRotation

    // ---- Rotation (UiRotation; WindowServer.cpp:1646-2090) ---------------------------
    // The device's orientation comes from system.deviceOrientation ("up",
    // "down", "left", "right", "faceup", "facedown"). The UI follows it
    // unless the rotation lock or the maximized card holds it.

    // conf/luna.conf:121 DisplayUiRotates: phones and tablets alike
    // (luna-tuna.conf:27-28 turns the phone UI).
    property bool uiRotates: true
    // How the UI is turned now, and the device orientation it went with.
    readonly property string uiOrientation: uiRotation.uiOrientation
    readonly property string deviceOrientation: uiRotation.orientation
    // Preferences::rotationLock: the orientation the rotation lock holds,
    // "" when rotation is free. The system menu's toggle
    // (system.rotationLocked) locks the UI as it is turned now
    // (SystemMenu::slotRotationLockTriggered, SystemMenu.cpp:857-866).
    property string rotationLock: ""
    Connections {
        target: shell.system
        ignoreUnknownSignals: true
        function onRotationLockedChanged() { shell._followRotationLock(); }
    }
    function _followRotationLock() {
        var on = !!(system && system.rotationLocked);
        if (on && rotationLock === "")
            rotationLock = uiRotation.uiOrientation;
        else if (!on)
            rotationLock = "";
    }

    // The card in front, from when it starts to maximize until it starts to
    // minimize (CardWindowManager MaximizeState / MinimizeState onEntry ->
    // SystemUiController::setMaximizedCardWindow, SystemUiController.cpp:1008-1054):
    // the orientation its app asked for holds the UI.
    readonly property string maximizedCardUid: (cards.maximized || cards.maximizing) && !cards.minimizing ? cards.currentUid : ""
    function maximizedCardOrientation() {
        return maximizedCardUid !== "" ? cards.orientationOf(maximizedCardUid) : "free";
    }
    property string _modeUid: ""
    property string _modeOrientation: "free"
    function _applyRotationMode() {
        var uid = maximizedCardUid, o = maximizedCardOrientation();
        if (uid === _modeUid && o === _modeOrientation)
            return;
        // A card being maximized cross-fades to its orientation; the app
        // asking for another one while maximized turns the UI
        // (CardWindow::onSetAppFixedOrientation, CardWindow.cpp:2569-2576).
        var maximizing = uid !== "" && uid !== _modeUid;
        _modeUid = uid;
        _modeOrientation = o;
        uiRotation.setRotationMode(uid === "" ? "free" : o, maximizing);
    }
    onMaximizedCardUidChanged: Qt.callLater(_applyRotationMode)
    Connections {
        target: shell.source ? shell.source.cards : null
        function onDataChanged() { Qt.callLater(shell._applyRotationMode); }
    }
    // Unlocked over a card that is held the other way: back to its
    // orientation (CardWindow::setMaximized, CardWindow.cpp:1756-1760).
    onLockedChanged: {
        // Sticky keys' latched modifiers do not outlive the lock.
        if (locked)
            keyboardAccess.clearModifiers();
        var o = maximizedCardOrientation();
        if (!locked && o !== "free")
            uiRotation.setRotationMode(o, true);
        // The lock screen takes the input focus: the keyboard goes.
        Qt.callLater(_updateImeClient);
    }

    // Nothing is moving that a resize would upset (okToResizeUi:
    // CardWindowManager, OverlayWindowManager, DashboardWindowManager,
    // LockWindow; WindowServerLuna.cpp:243-280).
    readonly property bool okToResizeUi: !cards.animating
        && (launcher.hidden === 0 || launcher.hidden === 1)
        && (lockScreen.opacity === 0 || lockScreen.opacity === 1)
        && notes.negativeSpace === notes.negativeSpaceTarget

    Component.onCompleted: {
        Qt.callLater(rebuildLauncherLayout);
        // WindowServer::bootupFinished: straight to how the device is held.
        Qt.callLater(function() {
            shell._followRotationLock();
            uiRotation.bootupFinished(shell.system && shell.system.deviceOrientation ? shell.system.deviceOrientation : "up");
            // WindowServer::bootupFinished: the boot sound.
            sounds.bootFinished();
        });
    }

    // ---- Layers, bottom to top ----------------------------------------------------
    // Behind everything: what shows around the turning snapshots.
    Rectangle {
        anchors.fill: parent
        color: Theme.black
    }

    // The screen, less the gesture bar. The Pre's gesture area was hardware
    // under the glass and stayed put; Phoenix's is on the screen, so it goes
    // to the bottom of the UI as the UI turns (0: the device's bottom edge;
    // 90, the UI turned clockwise: the left edge; ...).
    readonly property int _barAngle: ((uiRotation.uiAngle % 360) + 360) % 360
    Item {
        id: display
        anchors.fill: parent
        anchors.bottomMargin: shell._barAngle === 0 ? Theme.gestureAreaHeight : 0
        anchors.leftMargin: shell._barAngle === 90 ? Theme.gestureAreaHeight : 0
        anchors.topMargin: shell._barAngle === 180 ? Theme.gestureAreaHeight : 0
        anchors.rightMargin: shell._barAngle === 270 ? Theme.gestureAreaHeight : 0

        // The UI root (WindowServer's m_uiRootItem): turned with the
        // device, at the swapped size when on its side
        // (SystemUiController::resizeAndRotateUi). Everything below lays
        // itself out from its width and height.
        Item {
            id: ui
            objectName: "uiRoot"
            anchors.centerIn: parent
            width: uiRotation.uiWidth
            height: uiRotation.uiHeight
            rotation: uiRotation.uiAngle

            // The screen as it is outside dock mode: everything under the
            // status bar and the alerts. Dock mode zooms it out and hides it,
            // as WindowServerLuna::reorderWindowManagersForDockMode hid the
            // window managers under DockModeWindowManager, and back in after.
            Item {
                id: screenLayers
                objectName: "screenLayers"
                anchors.fill: parent

                // The scene behind the overlays (wallpaper, cards, launcher): what the
                // translucent surfaces above blur (BackdropBlur).
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
                        onCardClosing: (uid, byApp) => { if (!byApp) shell.sounds.feedback("appclose"); }
                        topInset: shell.fullScreen ? 0 : Theme.statusBarHeight
                        // The app's positive space ends where the notifications' negative space begins.
                        bottomInset: notes.negativeSpace
                        uiOrientation: uiRotation.uiOrientation
                        uiPortrait: uiRotation.uiPortrait
                        // First Use's card stays until the app closes it.
                        pinnedUid: shell._firstUseUid
                    }

                    Launcher {
                        id: launcher
                        objectName: "launcher"
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.topMargin: Theme.statusBarHeight
                        anchors.bottom: parent.bottom
                        anchors.bottomMargin: notes.negativeSpace
                        dockHeight: quickLaunch.height
                        apps: shell.source ? shell.source.apps : null
                        layout: shell.launcherLayout
                        draggedId: iconDrag.appId
                        onLaunchRequested: (appId) => shell.launch(appId)
                        onCloseRequested: launcher.open = false
                        onDeleteRequested: (appId) => deleteDialog.ask(appId)
                        onPendingTapped: (appId) => shell.pendingAppTapped(appId)
                        // The page edge took the dragged icon to the page beside.
                        onDragPageChanged: (page) => {
                            if (iconDrag.appId !== "" && iconDrag.from === "page")
                                shell.setLauncherLayout(LauncherLayout.move(shell.launcherLayout, iconDrag.appId, page, -1));
                            iconDrag.lastIndex = -1;
                        }
                        onDragStarted: (appId, from, x, y) => iconDrag.start(appId, from, launcher.mapToItem(ui, x, y))
                        onDragMoved: (x, y) => iconDrag.move(launcher.mapToItem(ui, x, y))
                        onDragEnded: (x, y) => iconDrag.drop(launcher.mapToItem(ui, x, y))
                    }
                }

                SearchPill {
                    id: searchPill
                    anchors.horizontalCenter: parent.horizontalCenter
                    y: Theme.statusBarHeight + Theme.searchPillTopOffset
                    shown: !locked && !firstUse && cards.maximizeProgress === 0 && !launcher.open && !justType.open
                    onTapped: shell.startJustType("")
                    backdrop: sceneBackdrop
                }

                QuickLaunch {
                    id: quickLaunch
                    objectName: "quickLaunch"
                    anchors.left: parent.left
                    anchors.right: parent.right
                    // Its own show / hide, not the maximize's: a 350 ms OutCubic
                    // slide and a 200 ms OutCubic fade (slotAnimateShowDock /
                    // HideDock, OverlayWindowManager.cpp:282-292, 1480-1540).
                    property real shownProgress: shell.dockShown ? 1 : 0
                    Behavior on shownProgress { NumberAnimation { duration: Theme.quickLaunchDuration; easing.type: Easing.OutCubic } }
                    opacity: shell.dockShown ? 1 : 0
                    Behavior on opacity { NumberAnimation { duration: Theme.searchPillFadeDuration; easing.type: Easing.OutCubic } }
                    y: parent.height - notes.negativeSpace - height * shownProgress
                    visible: shownProgress > 0 || opacity > 0
                    apps: shell.source ? shell.source.apps : null
                    launcherOpen: launcher.open
                    backdrop: sceneBackdrop
                    dock: shell.launcherLayout ? shell.launcherLayout.dock : []
                    draggedId: iconDrag.appId
                    onLaunchRequested: (appId) => shell.launch(appId)
                    onLauncherToggled: launcher.open = !launcher.open
                    onDragStarted: (appId, from, x, y) => iconDrag.start(appId, from, quickLaunch.mapToItem(ui, x, y))
                    onDragMoved: (x, y) => iconDrag.move(quickLaunch.mapToItem(ui, x, y))
                    onDragEnded: (x, y) => iconDrag.drop(quickLaunch.mapToItem(ui, x, y))
                }

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
                        proxy.largeSource = e.largeIcon || "";
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
                        var lp = ui.mapToItem(launcher, p.x, p.y);
                        // At a page's edge: the launcher pans or scrolls.
                        if (from === "page" && launcher.dragOver(lp.x, lp.y))
                            return;
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
                        launcher.dragDone();
                        var l = shell.launcherLayout;
                        if (overDock(p)) {
                            var q = ui.mapToItem(quickLaunch, p.x, p.y);
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

                // Deleting an app asks first: the launcher's app info dialog
                // (uiComponents/AppInfoDialog; LauncherObject::appDeleteDecoratorActivated,
                // showAppInfoDialog): "Remove Application?", its title and
                // version, Cancel and Remove (both black: the launcher never set
                // their type), on popup-bg.png over the scrim, fading in and out
                // over 300 ms.
                Item {
                    id: deleteDialog
                    objectName: "deleteDialog"
                    property string appId: ""
                    // "app": Remove Application?; "shortcut": a launch point an
                    // app added, Remove Shortcut? (LauncherObject::
                    // appDeleteDecoratorActivated, dimensionslauncher.cpp:
                    // 3161-3198); "failed": an install that failed, with Try
                    // Again when it can be (Phoenix's stand-in for Software
                    // Manager's list).
                    property string mode: "app"
                    property string shownId: ""
                    anchors.fill: parent
                    visible: opacity > 0
                    opacity: appId !== "" ? 1 : 0
                    Behavior on opacity { NumberAnimation { duration: 300 } }
                    z: 1001
                    // What the dialog says, set when it opens.
                    property string titleText: ""
                    property string messageText: ""
                    property bool canRetry: false
                    function ask(id) {
                        var e = iconDrag.entry(id);
                        mode = e && e.installState === "failed" ? "failed" : e && e.dynamic ? "shortcut" : "app";
                        shownId = id;
                        titleText = title();
                        messageText = message();
                        var i = info();
                        canRetry = mode === "failed" && !!(i && i.retry);
                        appId = id;
                    }
                    function info() {
                        return shell.source && typeof shell.source.installInfo === "function" ? shell.source.installInfo(shownId) : null;
                    }
                    function title() {
                        return mode === "shortcut" ? qsTr("Remove Shortcut?")
                             : mode === "failed" ? qsTr("Installation Failed") : qsTr("Remove Application?");
                    }
                    // "Calculator - v.3.0.5" (the app's title and version);
                    // "Google (Web)" (the shortcut's title, its app's).
                    function message() {
                        var e = iconDrag.entry(shownId);
                        if (!e)
                            return shownId;
                        if (mode === "shortcut") {
                            var app = iconDrag.entry(e.webAppId);
                            return qsTr("%1 (%2)").arg(e.title).arg(app ? app.title : e.webAppId);
                        }
                        if (mode === "failed") {
                            var i = info();
                            return i && i.reason ? qsTr("%1: %2").arg(e.title).arg(i.reason) : e.title;
                        }
                        return e.version ? qsTr("%1 - v.%2").arg(e.title).arg(e.version) : e.title;
                    }
                    function remove() {
                        var id = deleteDialog.appId;
                        deleteDialog.appId = "";
                        if (mode === "failed") {
                            if (shell.source && typeof shell.source.dismissInstall === "function")
                                shell.source.dismissInstall(id);
                            return;
                        }
                        shell.setLauncherLayout(mode === "shortcut" ? LauncherLayout.drop(shell.launcherLayout, id)
                                                                    : LauncherLayout.remove(shell.launcherLayout, id));
                        if (shell.source && typeof shell.source.removeApp === "function")
                            shell.source.removeApp(id);
                    }
                    function retry() {
                        var id = deleteDialog.appId;
                        deleteDialog.appId = "";
                        if (shell.source && typeof shell.source.retryInstall === "function")
                            shell.source.retryInstall(id);
                    }
                    Rectangle { anchors.fill: parent; color: "#80000000" }
                    MouseArea { anchors.fill: parent; enabled: deleteDialog.appId !== ""; onClicked: deleteDialog.appId = "" }
                    // AppInfoDialog.qml: 320 + 2 x 11 wide; 11 px edge, 6 px margins,
                    // 4 px top offset; title 18 px bold, message 14 px bold;
                    // buttons 52 px, the full width.
                    ArtBorderImage {
                        id: appInfoDialog
                        readonly property real edge: Theme.px(11)
                        readonly property real margin: Theme.px(6)
                        anchors.centerIn: parent
                        width: Math.min(parent.width, Theme.px(320) + 2 * edge)
                        height: dialogColumn.height + 2 * edge + 2 * margin + Theme.px(4)
                        source: Theme.asset("popup-bg.png")
                        border { left: Theme.artBorder(35, source); right: Theme.artBorder(35, source); top: Theme.artBorder(40, source); bottom: Theme.artBorder(40, source) }
                        MouseArea { anchors.fill: parent }
                        Column {
                            id: dialogColumn
                            x: appInfoDialog.edge + appInfoDialog.margin
                            y: appInfoDialog.edge + appInfoDialog.margin + Theme.px(4)
                            width: parent.width - 2 * x
                            spacing: appInfoDialog.margin
                            Text {
                                objectName: "deleteDialogTitle"
                                width: parent.width
                                wrapMode: Text.Wrap
                                text: deleteDialog.titleText
                                color: "#FFFFFF"
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.px(18)
                                font.bold: true
                            }
                            Text {
                                objectName: "deleteDialogMessage"
                                width: parent.width
                                wrapMode: Text.Wrap
                                text: deleteDialog.messageText
                                color: "#FFFFFF"
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.px(14)
                                font.bold: true
                            }
                            Column {
                                width: parent.width
                                ActionButton {
                                    objectName: "deleteDialogCancel"
                                    width: parent.width
                                    height: Theme.px(52)
                                    caption: qsTr("Cancel")
                                    onAction: deleteDialog.appId = ""
                                }
                                ActionButton {
                                    objectName: "deleteDialogRetry"
                                    width: parent.width
                                    height: Theme.px(52)
                                    visible: deleteDialog.canRetry
                                    caption: qsTr("Try Again")
                                    onAction: deleteDialog.retry()
                                }
                                ActionButton {
                                    objectName: "deleteDialogRemove"
                                    width: parent.width
                                    height: Theme.px(52)
                                    caption: qsTr("Remove")
                                    onAction: deleteDialog.remove()
                                }
                            }
                        }
                    }
                }

                JustType {
                    id: justType
                    anchors.fill: parent
                    bottomInset: notes.negativeSpace
                    apps: shell.source ? shell.source.apps : null
                    source: shell.source
                    onLaunchRequested: (appId) => shell.launch(appId)
                    onCloseRequested: { justType.open = false; shell.forceActiveFocus(); }
                }

                // Phones round the corners of a maximized app (MenuWindowManager.cpp:126-146).
                // The phone's screen corners: always at the positive space's
                // corners (card view, launcher, Just Type too), hidden only while
                // a full-screen card covers the screen (MenuWindowManager.cpp:
                // 126-146, 492-517; CardWindow::enableFullScreen /
                // disableFullScreen, CardWindow.cpp:1274-1312). Under the lock
                // screen (TopLevelWindowManager), over the overlays.
                Item {
                    id: screenCorners
                    objectName: "screenCorners"
                    anchors.fill: parent
                    anchors.topMargin: Theme.statusBarHeight
                    anchors.bottomMargin: notes.negativeSpace
                    visible: !Theme.tablet && !shell.fullScreen
                    Image { anchors.left: parent.left; anchors.top: parent.top; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-top-left.png") }
                    Image { anchors.right: parent.right; anchors.top: parent.top; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-top-right.png") }
                    Image { anchors.left: parent.left; anchors.bottom: parent.bottom; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-bottom-left.png") }
                    Image { anchors.right: parent.right; anchors.bottom: parent.bottom; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-bottom-right.png") }
                }

                LockScreen {
                    id: lockScreen
                    objectName: "lockScreen"
                    anchors.fill: parent
                    system: shell.system
                    source: shell.source
                    wallpaper: shell.wallpaper
                    incomingCall: notes.incomingCall
                    alertShown: notes.alertShown
                    alertHeight: notes.alertHeight
                    notifications: notes.model
                    bannerActive: notes.bannerActive
                    bannerText: notes.bannerText
                    bannerColor: notes.bannerColor
                    bannerGlyph: notes.bannerGlyph
                    bannerIcon: notes.bannerIcon
                    bannerOpacity: notes.bannerOpacity
                    emergencyAvailable: shell.emergencyAvailable
                    onUnlockRequested: shell.unlock()
                    onEmergencyRequested: shell.openEmergency()
                }

                // Over the lock screen, under the status bar and the alerts. The
                // TouchPad release put the emergency window manager under the
                // lock window, "temporarily demoted" for full-screen Flash
                // (WindowServerLuna.cpp:163-169); before that it stood above it,
                // which an emergency call from the lock screen needs.
                EmergencyWindow {
                    id: emergencyWindow
                    objectName: "emergencyWindow"
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.topMargin: Theme.statusBarHeight
                    anchors.bottom: parent.bottom
                    anchors.bottomMargin: shell.locked ? 0 : notes.negativeSpace
                    source: shell.source
                }
            }

            // Dock mode, over the screen it hides, under the status bar, the
            // alerts and the menus (DockModeWindowManager; the dashboard
            // window manager went on top of it, reorderWindowManagersForDockMode).
            // The exhibition fills the positive space.
            DockMode {
                id: dockLayer
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.topMargin: Theme.statusBarHeight
                anchors.bottom: parent.bottom
                anchors.bottomMargin: notes.negativeSpace
                visible: shell.dockMode || shell._dockTransition
                source: shell.source
                system: shell.system
                running: backlight.on
                wallpaper: shell.system && shell.system.dockWallpaper !== undefined ? shell.system.dockWallpaper : ""
                puckId: shell.system && shell.system.puckId ? shell.system.puckId : ""
                fixedTime: shell.system && shell.system.fixedTime ? shell.system.fixedTime : null
                twelveHourClock: !(shell.system && shell.system.twentyFourHour)
            }

            // The volume keys' indicator, centred in the positive space;
            // over the lock screen too (where the original left it to do,
            // LockWindow::slotTransientAlertActivated).
            VolumeIndicator {
                id: volumeIndicator
                anchors.horizontalCenter: parent.horizontalCenter
                y: Math.round((Theme.statusBarHeight + parent.height - (shell.locked ? 0 : notes.negativeSpace) - height) / 2)
            }

            StatusBar {
                id: statusBar
                objectName: "statusBar"
                visible: !shell.fullScreen
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                system: shell.system
                // SystemUiController::updateStatusBarTitle: Just Type, then the
                // launcher ("Launcher", com.palm.launcher's title; not actionable),
                // then the maximized app; else the carrier. Our Just Type has no
                // app menu yet (the original's: Preferences, Help), so no arrow.
                // Dock mode (StatusBar::TypeDockMode): the exhibition's
                // title, "Choose an App" while its menu is open, which the
                // title opens (DockModeMenuManager::activateAppMenu).
                readonly property string _mode: shell.dockMode || shell._dockTransition ? "dock" : shell.locked || shell.firstUse ? "" : justType.open ? "justtype"
                    : launcher.open ? "launcher" : cards.maximized ? "app" : ""
                title: _mode === "dock" ? (dockLayer.menuOpen ? qsTr("Choose an App") : dockLayer.currentTitle)
                     : _mode === "justtype" ? qsTr("Just Type") : _mode === "launcher" ? qsTr("Launcher")
                     : _mode === "app" ? cards.currentTitle : (shell.system ? shell.system.carrier : "")
                titleBorder: _mode !== ""
                titleActionable: _mode === "app" || _mode === "dock"
                // A maximized app's own colour (setWindowProperties
                // statusBarColor; SystemUiController.cpp:820-827), faded to
                // over 300 ms (StatusBar::setBackgroundColor). Tablets only.
                fillColor: _mode === "justtype" || _mode === "launcher" ? Theme.statusBarLauncherFill
                         : _mode === "app" && cards.currentStatusBarColor !== "" ? cards.currentStatusBarColor
                         : Theme.statusBarFill
                systemMenuOpen: systemMenu.open
                lockScreen: shell.locked && !shell.dockMode && !shell._dockTransition
                filled: cards.maximized || launcher.open || justType.open || shell.dockMode || shell._dockTransition
                onSystemMenuRequested: {
                    if ((shell.locked && !shell.dockMode) || shell.firstUse)
                        return;
                    // One menu at a time (DockModeMenuManager::activateSystemMenu).
                    dockLayer.appMenu.open = false;
                    systemMenu.open = !systemMenu.open;
                }
                onAppMenuRequested: {
                    // Dock mode: its app menu (StatusBar::slotAppMenuMenuAction,
                    // signalDockModeMenuStateChanged); the system menu closes.
                    if (shell.dockMode) {
                        systemMenu.open = false;
                        dockLayer.appMenu.open = !dockLayer.appMenu.open;
                        return;
                    }
                    if (!cards.maximized || !shell.source || typeof shell.source.appMenu !== "function")
                        return;
                    if (siteMenu.open) {
                        siteMenu.open = false;
                        return;
                    }
                    if (shell.source.appMenu(cards.currentUid) === false && typeof shell.source.siteState === "function") {
                        // A site: the shell's menu (SiteMenu).
                        var st = shell.source.siteState(cards.currentUid);
                        if (st) {
                            siteMenu.canGoBack = st.canGoBack;
                            siteMenu.canGoForward = st.canGoForward;
                            siteMenu.url = st.url;
                            siteMenu.open = true;
                        }
                    }
                }
            }

            Notifications {
                fullScreen: shell.fullScreen
                // The phone's active-call banner (the window source's).
                activeCall: shell.source && shell.source.activeCallBanner !== undefined ? shell.source.activeCallBanner : null
                locked: shell.locked && !shell.dockMode
                lockAlertHost: lockScreen.alertHost
                id: notes
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: statusBar.bottom
                anchors.bottom: parent.bottom
                model: shell.source ? shell.source.notifications : null
                onDismissRequested: (index) => shell.source.dismissNotification(index)
                onActivated: (appId, params) => {
                    var p = null;
                    try { p = params ? JSON.parse(params) : null; } catch (e) { p = null; }
                    shell.launch(appId, p);
                }
                source: shell.source
                backdrop: sceneBackdrop
                // Locked: only its lock-screen alert shows (Notifications.locked).
                screenHeight: ui.height
                statusBarRightInset: statusBar.systemGroupWidth
            }

            SiteMenu {
                id: siteMenu
                anchors.fill: parent
                onCloseRequested: siteMenu.open = false
                onAction: (name) => shell.source.siteAction(cards.currentUid, name)
                Connections {
                    target: cards
                    function onMaximizedChanged() { if (!cards.maximized) siteMenu.open = false; }
                }
            }

            SystemMenu {
                id: systemMenu
                objectName: "systemMenu"
                backdrop: sceneBackdrop
                anchors.fill: parent
                system: shell.system
                // The positive space, plus 10 (SystemMenu.cpp:945-953).
                availableHeight: ui.height - Theme.statusBarHeight - notes.negativeSpace + Theme.px(10)
                onCloseRequested: systemMenu.open = false
                onLaunchRequested: (appId, params) => shell.launch(appId, params)
                // Keyboard navigation: the menu has the keyboard while open
                // (the app's page would take the keys), then hands it back.
                onOpenChanged: shell._overlayFocus(open)
            }

            // The virtual keyboard, above everything (InputWindowManager is the
            // top window manager, WindowServerLuna.cpp:133-136, 171-172). It
            // slides with the negative space (InputWindowManager::
            // slotNegativeSpaceChanged, InputWindowManager.cpp:131-139).
            // The keyboard's microphone (Text Assist, GAPS V2).
            Dictation {
                id: dictation
                command: shell.dictationCommand
            }
            VirtualKeyboard {
                id: ime
                objectName: "virtualKeyboard"
                dictation: dictation.available ? dictation : null
                tablet: shell.tablet
                pixelScale: Theme.keyboardScale
                availableWidth: ui.width
                availableHeight: ui.height
                y: ui.height - notes.negativeSpace
                visible: shell.virtualKeyboard && shell._imeOwnsSpace && notes.negativeSpace > 0 && !notes.alertShown
                acceptingInput: shell._imeOpened
                onKeyTyped: (key, modifiers) => {
                    var t = shell._imeTarget();
                    if (t)
                        KeyInjector.sendImeKey(t, key, modifiers);
                }
                onTextCommitted: (text) => {
                    // The meta key held: c, x, v and a are Edit commands.
                    var meta = { c: "copy", x: "cut", v: "paste", a: "selectAll" }[String(text).toLowerCase()];
                    if (gesture.metaHeld && meta) {
                        shell.metaEdit(meta);
                        return;
                    }
                    var t = shell._imeTarget();
                    if (t)
                        KeyInjector.commitText(t, text);
                }
                onHideRequested: shell.hideKeyboard()
                // VirtualKeyboardPreferences TapSounds: "Keyboard clicks".
                tapSounds: !shell.system || shell.system.tapSounds !== false
                // Settings > Text Assist.
                readonly property var _assistPrefs: shell.system && shell.system.textAssist ? shell.system.textAssist : ({})
                textSuggestions: _assistPrefs.suggestions !== false
                autoCorrect: _assistPrefs.autoCorrect !== false
                swipeTyping: _assistPrefs.swipe !== false
                spaces2period: _assistPrefs.spaces2period !== false
                forgetWordsAt: _assistPrefs.forgetWords || 0
                // Settings > Text Assist > Keyboards, and the one in use: the
                // language key's choice goes back to the system (kept as
                // x_palm_virtualkeyboard_settings).
                keyboards: shell.system && shell.system.keyboards && shell.system.keyboards.length ? shell.system.keyboards
                                                                                                  : [{ layout: "qwerty", language: "en" }]
                keyboard: shell.system && shell.system.keyboard ? shell.system.keyboard : ({ layout: "qwerty", language: "en" })
                onKeyboardSelected: (k) => { if (shell.system && shell.system.keyboard !== undefined) shell.system.keyboard = k; }
                onFeedback: (name) => shell.sounds.feedback(name)
            }
            Connections {
                target: notes
                function onNegativeSpaceChanged() {
                    if (!shell._imeOpened && notes.negativeSpace === notes.negativeSpaceTarget)
                        shell._imeOwnsSpace = false;
                }
            }

            // Tablet: a flick up from the bottom edge does what the phone's gesture
            // area swipe-up does (SystemUiController::handleScreenEdgeFlickGesture,
            // SystemUiController.cpp:2041-2121); with the keyboard up it must travel
            // at least 60 px (kFlickMinimumYLengthWithKeyboardUp, :72). The TouchPad's
            // panel reported the flick from its bezel; here a thin strip along the
            // bottom edge starts it.
            MouseArea {
                id: bezel
                objectName: "bezelSwipe"
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                height: Theme.bezelEdgeHeight
                // With the gesture bar its swipe up does this.
                enabled: shell.tablet && (!shell.locked || shell.dockMode) && Theme.gestureAreaHeight === 0
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
        }

        UiRotation {
            id: uiRotation
            objectName: "uiRotation"
            anchors.fill: parent
            ui: shell.uiRoot
            uiRotates: shell.uiRotates
            deviceOrientation: shell.system && shell.system.deviceOrientation !== undefined ? shell.system.deviceOrientation : "up"
            rotationLock: shell.rotationLock
            screenLocked: shell.locked
            fingerDown: fingers.active
            okToResize: shell.okToResizeUi
        }
    }

    // What the keyboard's keys go to: the focused text field, or the web
    // view whose page has the field (the window source's inputTarget).
    function _imeTarget() {
        var c = imeClient;
        if (!c)
            return null;
        if (c.kind === "item")
            return c.item;
        return source && typeof source.inputTarget === "function" ? source.inputTarget(c.uid) : null;
    }

    // The gesture bar, along the bottom of a screen-sized frame turned as
    // the UI is, so its swipes read in the UI's directions.
    Item {
        id: gestureFrame
        anchors.centerIn: parent
        width: shell._barAngle % 180 === 0 ? parent.width : parent.height
        height: shell._barAngle % 180 === 0 ? parent.height : parent.width
        rotation: shell._barAngle

        GestureArea {
            id: gesture
            objectName: "gestureBar"
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: Theme.gestureAreaHeight
            visible: height > 0
            onUp: shell.gestureUp()
            onDown: shell.gestureDown()
            onBack: shell.gestureBack()
            onForward: shell.gestureForward()
            onPrevious: shell.gestureSwitchApp(true)
            onNext: shell.gestureSwitchApp(false)
            advancedGestures: !!(shell.system && shell.system.advancedGestures)
            lit: cards.maximized && !shell.locked
            onTapped: shell.gestureTap()
            // With the keyboard up, hold and slide to move the cursor.
            cursorControl: ime.visible
            onCursorStep: (direction) => {
                var t = shell._imeTarget();
                if (t)
                    KeyInjector.sendImeKey(t, direction < 0 ? Qt.Key_Left : Qt.Key_Right, Qt.NoModifier);
            }
        }
    }

    // A finger on the screen holds a turn back (WindowServer::viewportEvent,
    // WindowServer.cpp:755-761). Above everything, it only watches: the
    // touch goes on to whatever is under it.
    Item {
        anchors.fill: parent
        z: 10000
        PointHandler {
            id: fingers
        }
    }

    // The shortcuts, listed while their modifier is held a second.
    Timer {
        id: sheetDelay
        interval: 1000
        onTriggered: shortcutSheet.shown = true
    }
    ShortcutSheet {
        id: shortcutSheet
        z: 99997
        scheme: shell.keyboardShortcuts
        anchors.centerIn: parent
    }

    // A hardware keyboard attached and a field with the focus: the button
    // that brings the virtual keyboard up (the iPad's keyboard bar), at the
    // bottom right above the gesture bar.
    Rectangle {
        id: keyboardButton
        objectName: "showKeyboardButton"
        z: 99996
        visible: shell.virtualKeyboard && shell.hardwareKeyboard && shell.imeClient !== null && !shell._imeOpened && !shell.locked
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.rightMargin: Theme.px(12)
        anchors.bottomMargin: Theme.gestureAreaHeight + Theme.px(10)
        width: Theme.px(56)
        height: Theme.px(40)
        radius: Theme.px(8)
        color: keyboardButtonArea.pressed ? "#e0505050" : "#d0202020"
        border.color: "#60ffffff"
        Item {
            anchors.centerIn: parent
            width: Theme.px(36)
            height: Theme.px(22)
            clip: true
            // icon-hide-keyboard.png without its arrow: just the keyboard.
            Image {
                source: Theme.asset("keyboard-tablet/icon-hide-keyboard.png")
                width: Theme.px(36)
                height: Theme.px(36) * Theme.artHeight(source) / Math.max(1, Theme.artWidth(source))
            }
        }
        MouseArea {
            id: keyboardButtonArea
            anchors.fill: parent
            onClicked: shell.showVirtualKeyboard()
        }
    }

    // Sticky keys: the modifiers waiting for the next key, and in bold
    // the ones locked down, in a chip above the gesture bar.
    Rectangle {
        id: stickyChip
        objectName: "stickyModifiers"
        readonly property int mods: shell.keyboardAccess.latchedModifiers | shell.keyboardAccess.lockedModifiers
        function names(m) {
            var out = [];
            if (m & Qt.ShiftModifier) out.push("Shift");
            if (m & Qt.ControlModifier) out.push(Qt.platform.os === "osx" ? "⌘" : "Ctrl");
            if (m & Qt.AltModifier) out.push(Qt.platform.os === "osx" ? "Option" : "Alt");
            if (m & Qt.MetaModifier) out.push(Qt.platform.os === "osx" ? "Control" : "Super");
            return out;
        }
        z: 99996
        visible: mods !== 0
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: Theme.gestureAreaHeight + Theme.px(12)
        width: chipText.implicitWidth + Theme.px(24)
        height: Theme.px(30)
        radius: height / 2
        color: "#d0202020"
        border.color: "#60ffffff"
        Text {
            id: chipText
            objectName: "stickyModifiersText"
            anchors.centerIn: parent
            textFormat: Text.StyledText
            color: Theme.text
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(15)
            text: {
                var locked = shell.keyboardAccess.lockedModifiers;
                return stickyChip.names(stickyChip.mods).map(function (n, i) {
                    var all = stickyChip.names(locked);
                    return all.indexOf(n) >= 0 ? "<b><u>" + n + "</u></b>" : n;
                }).join("  ");
            }
        }
    }

    // The reticle: penindicator-ripple.png where a tap lands, growing to
    // one and a half times as it fades over 200 ms (WindowServer::
    // gestureEvent, ReticleItem::startAt; lunaAnimations.conf Reticle).
    Image {
        id: reticle
        objectName: "reticle"
        z: 99998
        source: Theme.asset("penindicator-ripple.png")
        width: Theme.artWidth(source)
        height: Theme.artHeight(source)
        visible: false
        function startAt(x, y) {
            reticleAnim.stop();
            reticle.x = x - width / 2;
            reticle.y = y - height / 2;
            reticle.opacity = 1;
            reticle.scale = 1;
            reticle.visible = true;
            reticleAnim.start();
        }
        SequentialAnimation {
            id: reticleAnim
            ParallelAnimation {
                NumberAnimation { target: reticle; property: "opacity"; from: 1; to: 0; duration: Theme.reticleDuration }
                NumberAnimation { target: reticle; property: "scale"; from: 1; to: 1.5; duration: Theme.reticleDuration }
            }
            PropertyAction { target: reticle; property: "visible"; value: false }
        }
    }

    // The capture's thumbnail, in the corner above the gesture area; a tap
    // opens it in the preview.
    ScreenCaptureThumbnail {
        id: captureThumbnail
        anchors.bottom: parent.bottom
        // Above the phone's notification area (its banner says "Screen captured").
        anchors.bottomMargin: Theme.px(24) + notes.negativeSpaceTarget
        z: 99999
        onActivated: (path) => shell.launch("org.webosphoenix.screenshot", path ? { path: path } : null)
    }

    // Over everything, the gesture area too (WindowServer's UI elements group).
    ScreenCaptureFlash {
        id: captureFlash
        anchors.fill: parent
        z: 100000
    }
}
