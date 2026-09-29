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
        source: LsmWindowSource { id: windows }
        system: LsmSystemStatus {}
        // OSE's own keyboard (Maliit through com.webos.service.ime, drawn in
        // the stock KeyboardView below) stays the device's IME for now; the
        // shell makes room for its panel as it did for its own keyboard
        // (positive space, the tablet's bezel flick). BaseView.isOpen
        // (luna-surfacemanager views/base/BaseView.qml:29).
        platformKeyboardHeight: keyboardViewId.isOpen ? keyboardViewId.height : 0
        Component.onCompleted: phoenix.unlock()
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
