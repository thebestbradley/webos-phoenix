// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What a card shows while its app is still loading (luna-sysmgr
// Src/lunaui/cards/CardLoading.cpp): the app's splashBackground tiled from
// the card's top left, or loading-bg.png filling it; the app's splashicon in
// the middle, fitted to SplashIconSize (128 px, 192 on tablets), or its
// launcher icon at one and a half times its size (at most that); and
// loading-glow.png behind
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
    // The app's own (appinfo.json "splashicon", "splashBackground").
    property url splashIcon: ""
    property url splashBackground: ""
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
        visible: !splashBg.visible
        source: Theme.asset("loading-bg.png")
    }
    // The pixmap as a brush from the card's top left, at its own size
    // (CardLoading::paint, fillPath with the background).
    ArtTiledImage {
        id: splashBg
        objectName: "splashBackground"
        anchors.fill: parent
        visible: loading.splashBackground != "" && status === Image.Ready
        source: loading.splashBackground
        horizontalAlignment: Image.AlignLeft
        verticalAlignment: Image.AlignTop
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
        objectName: "loadingIcon"
        // The splashicon, fitted to the splash size; else the launcher
        // icon, half as big again, no larger than that (CardLoading.cpp:79-96).
        readonly property url own: loading.splashIcon != "" ? loading.splashIcon : loading.icon
        readonly property size iconSize: loading.icon != "" ? HiDpi.imageSize(loading.icon) : Qt.size(0, 0)
        readonly property real side: loading.splashIcon != "" ? Theme.splashIconSize
            : Math.min(Math.max(iconSize.width, iconSize.height) * 1.5, Theme.splashIconSize)
        // In the window's pixels (AppIcon.pixelRatio): two per point on a
        // Retina Mac.
        readonly property int pixels: Math.ceil(Theme.px(side) * loading.pixelRatio)
        readonly property url best: own != "" ? Theme.appIcon(own, pixels, loading.largeIcon) : ""
        readonly property size bestSize: best != "" ? HiDpi.imageSize(best) : Qt.size(-1, -1)
        source: best
        // A bigger file is decoded at the drawn size, smoothly scaled down.
        sourceSize: Math.max(bestSize.width, bestSize.height) > pixels ? Qt.size(pixels, pixels) : Qt.size(-1, -1)
        width: Theme.px(side)
        height: Theme.px(side)
        fillMode: Image.PreserveAspectFit
        smooth: true
        mipmap: true
    }
}
