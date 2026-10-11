// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Replaces luna-surfacemanager's ViewsRoot with the Phoenix shell.
//
// The base controllers and services expect the aliases below, so the stock
// overlay / popup / notification / keyboard / system UI views are kept. Card
// surfaces are taken over by Phoenix; the stock FullscreenView stays for API
// compatibility but its model accepts nothing.
//
// STATUS: experimental, not yet run on a device.

import QtQuick
import WebOSCoreCompositor 1.0
import WebOSCompositorBase 1.0
import WebOSCompositor 1.0
import Phoenix.Shell
import Phoenix.Lsm
import Phoenix.Native

FocusScope {
    id: root
    focus: true

    property alias fullscreen: fullscreenViewId
    property alias overlay: overlayViewId
    property alias launcher: launcherId
    property alias popup: popupViewId
    property alias notification: notificationViewId
    property alias keyboard: keyboardViewId
    property alias spinner: spinnerId
    property alias systemUi: systemUiViewId
    property alias launcherHotspot: launcherHotspotId

    readonly property string suffix: compositorWindow.displayId > 0 ? compositorWindow.displayId : ""

    Shell {
        id: phoenix
        anchors.fill: parent
        focus: true
        formFactor: "auto"
        hardwareHomeButton: DeviceConfig.hardwareHomeButton
        homeButtonOrientationAngle: DeviceConfig.homeButtonOrientationAngle
        source: LsmWindowSource { id: windows }
        system: LsmSystemStatus {}
        // STATUS: the default wallpaper; the wallpaper preference is not
        // read on a device yet.
        wallpaper: "file://" + Theme.defaultWallpaperPath
        // OSE's own keyboard (Maliit through com.webos.service.ime, drawn in
        // the stock KeyboardView below) stays the device's IME for now; the
        // shell makes room for its panel as it did for its own keyboard
        // (positive space, the tablet's bezel flick). BaseView.isOpen
        // (luna-surfacemanager views/base/BaseView.qml:29).
        platformKeyboardHeight: keyboardViewId.isOpen ? keyboardViewId.height : 0
        // "Hey Phoenix" (docs/AI-AND-MCP.md, Voice): phoenix-wakeword (built
        // and installed with this shell) with the Vosk model meta-phoenix's
        // packagegroup-phoenix-assistant installs; it finds libvosk.so by
        // its usual name. Missing pieces: the spotter fails to start and
        // Settings > Assistant says what is not in the image.
        wakeWordCommand: ["/usr/bin/phoenix-wakeword", "--model", "/usr/share/phoenix/wakeword/vosk-model-small-en-us-0.15"]
        // The boot animation from the first frame (Shell.bootAnimation), in
        // the style Settings > Advanced chose (LsmSystemStatus reads the
        // start-up preferences before this frame), until the boot is over
        // (below). The lock screen is up from the start, as LockWindow was
        // at boot; com.palm.systemmanager (services/systemmanager) checks
        // its passcode.
        bootAnimation: true
    }

    // ---- The boot is over ----------------------------------------------------------
    // LunaSysMgr's bootupFinished came when the system UI had loaded; on OSE
    // bootd says so: com.webos.bootManager getBootStatus {subscribe} answers
    // {bootStatus, signals: {"boot-done": true, ...}} (bootd
    // src/bootd/service/BootManager.cpp:103-127, AbsBootSequencer.cpp:
    // 166-176; SignalManager.cpp:28 "boot-done"). The animation then ends,
    // once it has played at least the logo's first glow, 4 s
    // (BootupAnimation.cpp:44, kFirstGlowAnimDuration; as phoenix-sim's
    // bootMinimum). Without bootd's answer within 90 s the animation ends
    // anyway, and says why, rather than holding the device behind it.
    // STATUS: written against bootd's source; not yet run on a device.
    property bool _bootDone: false
    property bool _bootShown: false
    readonly property bool _bootOver: _bootDone && _bootShown
    on_BootOverChanged: if (_bootOver) phoenix.systemScreens.finishBoot()
    Timer { interval: 4000; running: true; onTriggered: root._bootShown = true }
    Timer {
        interval: 90000
        running: !root._bootDone
        onTriggered: {
            console.warn("phoenix: com.webos.bootManager did not say boot-done in 90 s; ending the boot animation");
            root._bootDone = true;
        }
    }
    function _bootStatus(r) {
        if (r && r.signals && r.signals["boot-done"] === true)
            _bootDone = true;
    }

    // State only the shell knows, for the apps (com.palm.systemmanager's
    // getLockStatus, getDockModeStatus, getSystemStatus; as sim.qml sends
    // it to the simulator's runtime).
    function _pushOrientation() {
        windows.pushSystemStatus({ orientation: { ui: phoenix.uiOrientation, device: phoenix.deviceOrientation } });
    }
    Connections {
        target: phoenix
        function onLockedChanged() { windows.pushSystemStatus({ deviceLocked: phoenix.locked }); }
        function onDockModeChanged() { windows.pushSystemStatus({ dockMode: phoenix.dockMode }); }
        function onKeyboardOpenChanged() { windows.pushSystemStatus({ ime: { visible: phoenix.keyboardOpen } }); }
        function onUiOrientationChanged() { root._pushOrientation(); }
        function onDeviceOrientationChanged() { root._pushOrientation(); }
    }
    // Which app is in front with the screen on, for Settings > Battery's
    // use (org.webosphoenix.battery, services/accessories): every minute
    // and when the app in front changes, as sim.qml ticks the simulator's.
    property string _usageApp: ""
    property real _usageSince: Date.now()
    function _usageTick() {
        var now = Date.now(), ms = Math.max(0, now - _usageSince);
        _usageSince = now;
        if (ms > 0 && phoenix.display.state !== "off")
            windows.pushSystemStatus({ usageTick: { appId: phoenix.locked ? "" : _usageApp, ms: ms, at: now } });
        var i = windows.cardIndex(windows.focusedUid);
        _usageApp = i >= 0 && phoenix.cardView.maximized ? windows.cards.get(i).appId : "";
    }
    Timer { interval: 60000; running: true; repeat: true; onTriggered: root._usageTick() }
    Connections {
        target: windows
        function onFocusedUidChanged() { root._usageTick(); }
    }

    // What the pages ask the shell for (org.webosphoenix.shellhost; as
    // sim.qml answers the simulator's window source).
    Connections {
        target: windows
        // The Assistant's "take a screenshot".
        function onScreenshotRequested() { phoenix.takeScreenshot(); }
        // com.palm.systemmanager enableFpsCounter / enableTouchPlot, runProgressAnimation.
        function onDebugOverlayRequested(request) { phoenix.systemScreens.debugOverlay(request); }
        function onProgressAnimationRequested(type, state) {
            if (state === "start")
                phoenix.systemScreens.startProgressAnimation(type);
            else
                phoenix.systemScreens.stopProgressAnimation();
        }
        // Off or restart (com.palm.power, phoenix-devices): the screen goes
        // dark as the shutdown sound plays, as phoenix-sim's power-off;
        // phoenix-devices turns the machine off after it.
        function onShutdownRequested(reason) { root._goingDown(); }
        function onRebootRequested(reason) { root._goingDown(); }
    }
    property bool _down: false
    function _goingDown() {
        if (_down)
            return;
        _down = true;
        if (phoenix.bootSound)
            phoenix.sounds.shutdown();
    }
    Rectangle {
        anchors.fill: parent
        z: 10000
        color: "black"
        visible: root._down
        MouseArea { anchors.fill: parent }
    }

    Component.onCompleted: {
        windows.lunaSubscribe("luna://com.webos.bootManager/getBootStatus", { subscribe: true }, root._bootStatus);
        windows.pushSystemStatus({ deviceLocked: phoenix.locked, dockMode: phoenix.dockMode,
                                   ime: { visible: phoenix.keyboardOpen } });
        root._pushOrientation();
    }

    // Kept for controller compatibility; Phoenix owns card surfaces.
    FullscreenView {
        id: fullscreenViewId
        objectName: "fullscreenView" + suffix
        anchors.fill: parent
        visible: false
        model: WindowModel {
            surfaceSource: compositor.surfaceModel
            acceptFunction: "filter"
            function filter(surfaceItem) { return false; }
        }
    }

    OverlayView {
        id: overlayViewId
        objectName: "overlayView" + suffix
        anchors.fill: parent
        model: OverlayWindowModel {}
    }

    // The stock launcher is replaced by Phoenix's; keep an inert instance.
    Item {
        id: launcherId
        objectName: "launcher" + suffix
        property bool isOpen: false
        function toggleHome() { phoenix.gestureUp(); }
        function openView() { if (!phoenix.launcherOpen) phoenix.gestureUp(); }
        function closeView() { if (phoenix.launcherOpen) phoenix.gestureUp(); }
    }

    PopupView {
        id: popupViewId
        objectName: "popupView" + suffix
        model: PopupWindowModel {}
    }

    // OSE's alerts and PIN prompts (com.webos.notification createAlert)
    // stay the stock view's; its toasts are the shell's banners
    // (LsmWindowSource.toast), so the stock view takes none.
    NotificationView {
        id: notificationViewId
        objectName: "notificationView" + suffix
        anchors.fill: parent
        acceptToasts: false
    }

    KeyboardView {
        id: keyboardViewId
        objectName: "keyboardView" + suffix
        model: KeyboardWindowModel {}
    }

    Spinner {
        id: spinnerId
        objectName: "spinner" + suffix
        anchors.fill: parent
    }

    SystemUIView {
        id: systemUiViewId
        objectName: "systemUiView" + suffix
        model: SystemUIWindowModel {}
    }

    // Phoenix uses the gesture area instead of the TV-style edge hotspot.
    Item {
        id: launcherHotspotId
        property bool enabled: false
    }
}
