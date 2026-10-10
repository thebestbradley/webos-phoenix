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

    NotificationView {
        id: notificationViewId
        objectName: "notificationView" + suffix
        anchors.fill: parent
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
