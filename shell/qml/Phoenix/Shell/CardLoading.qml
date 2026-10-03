// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What a card shows while its app is still loading (luna-sysmgr
// Src/lunaui/cards/CardLoading.cpp): loading-bg.png filling the card, the
// app's icon in the middle at one and a half times its launcher size (at
// most SplashIconSize: 128 px, 192 on tablets), and loading-glow.png behind
// it, pulsing. The pulse starts after 900 ms, rises over 500 ms, falls over
// 500 ms and rests for a second (slotPulseTimeout; lunaAnimations.conf
// cardLoading*). When the app is ready it cross-fades away over 300 ms.

import QtQuick
import Phoenix.Native

Item {
    id: loading

    // The app is still loading.
    property bool active: false
    property url icon: ""
    // Its bigger icon (appinfo.json "splashicon"), drawn in its place when
    // the icon would be magnified (Theme.appIcon).
    property url largeIcon: ""
    // Window pixels per point (AppIcon.pixelRatio).
    property real pixelRatio: Screen.devicePixelRatio

    // Shown at once; cross-fades away (CardLoading::finish).
    visible: opacity > 0
    opacity: active ? 1 : 0
    onActiveChanged: {
        if (active) {
            fade.stop();
            opacity = 1;
        } else {
            fade.start();
        }
    }
    NumberAnimation {
        id: fade
        target: loading
        property: "opacity"
        from: 1
        to: 0
        duration: Theme.cardLoadingCrossFadeDuration
    }

    Image {
        anchors.fill: parent
        source: Theme.asset("loading-bg.png")
    }

    Image {
        id: glow
        anchors.centerIn: parent
        source: Theme.asset("loading-glow.png")
        width: Theme.artWidth(source)
        height: Theme.artHeight(source)
        visible: icon.status === Image.Ready
        opacity: 0

        SequentialAnimation {
            running: loading.active && loading.visible
            onRunningChanged: if (!running) glow.opacity = 0
            PauseAnimation { duration: Theme.cardLoadingTimeBeforePulse }
            SequentialAnimation {
                loops: Animation.Infinite
                NumberAnimation { target: glow; property: "opacity"; from: 0; to: 1; duration: Theme.cardLoadingPulseDuration / 2 }
                NumberAnimation { target: glow; property: "opacity"; from: 1; to: 0; duration: Theme.cardLoadingPulseDuration / 2 }
                PauseAnimation { duration: Theme.cardLoadingPulsePause }
            }
        }
    }

    Image {
        id: icon
        anchors.centerIn: parent
        // The launcher icon, half as big again, no larger than the splash size.
        readonly property size iconSize: loading.icon != "" ? HiDpi.imageSize(loading.icon) : Qt.size(0, 0)
        readonly property real side: Math.min(Math.max(iconSize.width, iconSize.height) * 1.5, Theme.splashIconSize)
        // In the window's pixels (AppIcon.pixelRatio): two per point on a
        // Retina Mac.
        readonly property int pixels: Math.ceil(Theme.px(side) * loading.pixelRatio)
        readonly property url best: loading.icon != "" ? Theme.appIcon(loading.icon, pixels, loading.largeIcon) : ""
        source: best
        // A bigger icon is decoded at the drawn size, smoothly scaled down.
        sourceSize: best != loading.icon ? Qt.size(pixels, pixels) : Qt.size(-1, -1)
        width: Theme.px(side)
        height: Theme.px(side)
        fillMode: Image.PreserveAspectFit
        smooth: true
        mipmap: true
    }
}
