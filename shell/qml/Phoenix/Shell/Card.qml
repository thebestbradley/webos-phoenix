// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One app card. The card is always laid out at full window size and scaled
// about its centre, exactly like LunaSysMgr's CardWindow, so the app surface
// never has to re-layout while it moves between card view and maximized.

import QtQuick
import Qt5Compat.GraphicalEffects

Item {
    id: card

    // Unique id of the window in the window source.
    property string uid
    property string title
    // The app surface (a compositor SurfaceItem or a simulator mock app).
    property Item window

    // Where the card's centre should be, in the card view's coordinates.
    property real centerX
    property real centerY
    // Scale relative to the full-size window (1.0 == maximized).
    property real cardScale: 1.0
    // True when the card is maximized and should get input.
    property bool interactive: false
    // Square corners when maximized, rounded in card view.
    property bool rounded: true
    // Vertical offset while the user is flicking the card away.
    property real flickOffset: 0
    // The app is still loading: CardLoading covers it.
    readonly property bool loading: window !== null && window.ready === false
    // The card has been prepared (a new card is not for its first
    // cardPrepareAddDuration): its loading screen shows only from then.
    property bool prepared: true
    // The app's launcher icon, for the loading card.
    property url icon: ""
    // Its bigger icon (appinfo.json "splashicon"), if any.
    property url largeIcon: ""
    // The loading card's icon (the splashicon) and background
    // (appinfo.json "splashBackground"), if the app names them.
    property url splashIcon: ""
    property url splashBackground: ""
    // Cards that have lost focus are darkened (CardWindow.cpp:211-213).
    property bool dimmed: false
    // The parent of a modal card: 60 % of #0f0f0f over it (CardWindow::paint,
    // CardWindow.cpp:1593-1599).
    property bool modalShade: false

    // ---- Ember Glass (Phoenix 2.0; docs/SYSTEM-UI-2.md, 4 and "The shell
    // contract") ------------------------------------------------------------
    // The card has Ember Glass's corners (radius.card), maximized too, and
    // its glass shadow, and its window gets what Ember Glass's L1 needs
    // (glass): the wallpaper blurred once (WallpaperBlur; the toned one for
    // the shell's own glass, the loading card), where the window lies on the
    // screen when the card is maximized (windowPlace, in the card view's
    // pixels), the screen it lies on (screenSize), its corners and whether
    // the device blurs live. In the card view the window's place stays where
    // it is when maximized: the card is the window scaled, so the blur is the
    // card's own and scales and moves with it, as the mock-ups draw it
    // (base.css html[data-embed] .device > .wall).
    property string wallpaperBlurred: ""
    property string wallpaperToned: ""
    property rect windowPlace: Qt.rect(0, 0, width, height)
    property size screenSize: Qt.size(width, height)
    property string glassBlur: "live"
    // In CSS px (the page's, Theme.u to the pixel); null in 1.0's look.
    readonly property var glass: {
        if (!Theme.emberGlass)
            return null;
        var u = Theme.u > 0 ? Theme.u : 1;
        var css = function (v) { return Math.round(v / u * 100) / 100; };
        return {
            wallpaperBlurred: wallpaperBlurred,
            window: { x: css(windowPlace.x), y: css(windowPlace.y), width: css(width), height: css(height) },
            screen: { width: css(screenSize.width), height: css(screenSize.height) },
            windowRadius: EmberGlass.radiusCard,
            blur: glassBlur === "none" ? "none" : "live"
        };
    }
    // Rounded now: in the card view; in Ember Glass always.
    readonly property bool _rounded: rounded || Theme.emberGlass

    // The orientation the app asked for (PalmSystem.setWindowOrientation):
    // "free", "up", "down", "left", "right", "landscape" or "portrait";
    // and how the UI is turned (UiRotation).
    property string appOrientation: "free"
    property string uiOrientation: "up"
    property bool uiPortrait: height > width
    // A card held in another orientation than the UI's is drawn turned by
    // this much, its window keeping the app's orientation and size
    // (CardWindow::refreshAdjustmentAngle, CardWindow.cpp:2586-2640; the
    // paint rotation, :1556-1700; View_Resize with width and height
    // swapped, :741-752).
    readonly property int adjustmentAngle: {
        if (appOrientation === "landscape")
            return uiPortrait ? 90 : 0;
        if (appOrientation === "portrait")
            return uiPortrait ? 0 : 90;
        var a = _angle(appOrientation), u = _angle(uiOrientation);
        if (a < 0 || u < 0)
            return 0;
        var d = a - u;
        if (d > 180)
            d -= 360;
        else if (d <= -180)
            d += 360;
        return d;
    }
    // How the app's window is turned: what the page is told
    // (PalmSystem.screenOrientation).
    readonly property string windowOrientation: {
        if (_angle(appOrientation) >= 0)
            return appOrientation;
        var u = Math.max(0, _angle(uiOrientation));
        var turned = (appOrientation === "landscape" && uiPortrait) || (appOrientation === "portrait" && !uiPortrait);
        return ["up", "left", "down", "right"][((u + (turned ? 90 : 0)) % 360) / 90];
    }
    // ---- Off screen as the UI turns: resized after the turn ----------------------
    // A card off screen when the UI turns keeps its window's size (and how
    // the page is turned) until the turn is over; meanwhile the card has its
    // new size and shows the window turned back by the UI's turn, so it looks
    // as it did (HostWindow::resizeEventSync queues a window not on screen,
    // HostWindow.cpp:150-170; CardWindow::queueUpWindowForFlip,
    // CardWindow.cpp:946-998, painting it with m_tempRotatedBrush turned by
    // -getRotationAngle()). WindowServer::rotatePendingWindows resizes them
    // once the turn's animation has finished (WindowServer.cpp:1990, 2084,
    // 2126-2139): flip() here. Only the cards on screen resize as it turns.
    property bool flipPending: false
    property real _heldWidth: 0
    property real _heldHeight: 0
    property string _heldOrientation: "up"
    property int _heldTurn: 0
    readonly property int _turn: Math.max(0, _angle(uiOrientation)) + adjustmentAngle
    // How much the held window is turned back in the card.
    readonly property int flipCompensation: {
        if (!flipPending)
            return 0;
        var d = ((_heldTurn - _turn) % 360 + 360) % 360;
        return d > 180 ? d - 360 : d;
    }
    function queueFlip() {
        if (flipPending || !window)
            return;
        _heldWidth = appHost.width;
        _heldHeight = appHost.height;
        _heldOrientation = windowOrientation;
        _heldTurn = _turn;
        flipPending = true;
    }
    function flip() { flipPending = false; }
    // What the page is told of how it is turned: as it was until it flips.
    readonly property string pageOrientation: flipPending ? _heldOrientation : windowOrientation

    function _angle(o) {
        switch (o) {
        case "up": return 0;
        case "left": return 90;
        case "down": return 180;
        case "right": return 270;
        }
        return -1;
    }

    // Lifted for reordering: translucent, no shadow (CardWindowManager.cpp:1888-1899).
    property bool reordering: false

    // When non-zero, layout changes (shuffles after a close or reorder)
    // animate over this many milliseconds; otherwise the card tracks its
    // layout directly, e.g. during drags.
    property int layoutAnimationDuration: 0

    x: centerX - width / 2
    y: centerY - height / 2 + flickOffset
    scale: cardScale
    transformOrigin: Item.Center

    Behavior on x {
        enabled: card.layoutAnimationDuration > 0
        NumberAnimation { duration: card.layoutAnimationDuration; easing.type: Easing.OutCubic }
    }
    Behavior on y {
        enabled: card.layoutAnimationDuration > 0
        NumberAnimation { duration: card.layoutAnimationDuration; easing.type: Easing.OutCubic }
    }
    Behavior on scale {
        enabled: card.layoutAnimationDuration > 0
        NumberAnimation { duration: card.layoutAnimationDuration; easing.type: Easing.OutCubic }
    }
    Behavior on rotation {
        enabled: card.layoutAnimationDuration > 0
        NumberAnimation { duration: card.layoutAnimationDuration; easing.type: Easing.OutCubic }
    }

    // Thrown off the top of the screen at full opacity (closeWindow).
    opacity: reordering ? 0.8 : 1

    // Drop shadow: images/card-shadow-tile.png as a 9-tile, 20px outside
    // the card and 5px lower (CardDropShadowEffect.cpp). Sizes are in window
    // coordinates, so the shadow scales with the card like the original.
    // BorderImage draws borders at source-pixel size; scale by Theme.u.
    BorderImage {
        id: shadow
        visible: card.rounded && !card.reordering && !Theme.emberGlass
        width: (card.width + 2 * Theme.cardShadowOutset) / Theme.u
        height: (card.height + 2 * Theme.cardShadowOutset) / Theme.u
        x: -Theme.cardShadowOutset
        y: -Theme.cardShadowOutset + Theme.cardShadowOffsetY
        scale: Theme.u
        transformOrigin: Item.TopLeft
        source: Theme.asset("card-shadow-tile.png")
        border { left: Theme.artBorder(43, source); top: Theme.artBorder(43, source); right: Theme.artBorder(43, source); bottom: Theme.artBorder(43, source) }
        horizontalTileMode: BorderImage.Stretch
        verticalTileMode: BorderImage.Stretch
    }

    // Ember Glass: the glass shadow (theme.*.shadow.card, base.css
    // --glass-shadow: 0 30px 60px -24px), its sizes the screen's whatever the
    // card's scale (cards.html's deck draws its cards' shadows so). CSS's box
    // shadow is the card's rectangle inset by the spread, moved down, blurred
    // by a Gaussian of half the blur, half dark at the rectangle's edge. Here
    // an approximation: RectangularGlow fades from its rectangle's edge over
    // glowRadius, so its rectangle is the shadow's inset by a quarter of the
    // blur and its glow half the blur: the fade is centred on the shadow's
    // edge, as the Gaussian's is.
    RectangularGlow {
        objectName: "emberCardShadow"
        readonly property var sh: Theme.eg.shadowCard
        // This item's pixels per CSS px on the screen.
        readonly property real k: Theme.u / Math.max(0.05, card.cardScale)
        visible: Theme.emberGlass && !card.reordering && GraphicsInfo.api !== GraphicsInfo.Software
        x: (-sh.spread + sh.blur / 4) * k
        y: (-sh.spread + sh.blur / 4 + sh.offsetY) * k
        width: card.width - 2 * (-sh.spread + sh.blur / 4) * k
        height: card.height - 2 * (-sh.spread + sh.blur / 4) * k
        glowRadius: sh.blur / 2 * k
        spread: 0.15
        color: sh.color
        cornerRadius: Theme.px(EmberGlass.radiusCard) + glowRadius
    }

    Item {
        id: contentHost
        anchors.fill: parent
        clip: true
        enabled: card.interactive

        // The app's window, turned when the app keeps another orientation
        // than the UI's.
        Item {
            id: appHost
            readonly property bool sideways: card.adjustmentAngle === 90 || card.adjustmentAngle === -90
            anchors.centerIn: parent
            width: sideways ? parent.height : parent.width
            height: sideways ? parent.width : parent.height
            rotation: card.adjustmentAngle

            // Under a scene transition: black (CardTransition.cpp:146).
            Rectangle {
                anchors.fill: parent
                z: -1
                color: "black"
                visible: card.sceneTransitionState === "running"
            }
            // The scene being left (a scene transition): over the window
            // while prepared, a pop and a cross-fade; under it for a
            // zoom-fade push.
            Image {
                objectName: "sceneSnapshot"
                anchors.fill: parent
                z: card.sceneTransitionState === "running" && card.sceneTransitionType === "zoom-fade"
                   && !card.sceneTransitionIsPop ? -0.5 : 0.5
                visible: card.sceneTransitionState !== "" && source != ""
                source: card._sceneSnapshot
                opacity: card._snapshotOpacity
                cache: false
                smooth: true
            }

            // Over the app's window until it is ready.
            CardLoading {
                anchors.fill: parent
                z: 1
                active: card.loading && card.prepared
                // Ember Glass: the shell's own glass under the icon.
                glassWallpaper: card.wallpaperToned
                glassPlace: card.windowPlace
                glassScreen: card.screenSize
                icon: card.icon
                largeIcon: card.largeIcon
                splashIcon: card.splashIcon
                splashBackground: card.splashBackground
            }
        }

        Rectangle {
            objectName: "modalShade"
            anchors.fill: parent
            z: 3
            color: "#0f0f0f"
            opacity: 0.6
            visible: card.modalShade
        }

        // Darkened when it has lost focus (CardWindow.cpp:211-213), inside
        // the corners, as the shader multiplied the colour by the dimming.
        Rectangle {
            anchors.fill: parent
            z: 2
            color: "black"
            opacity: card.dimmed ? 1 - Theme.cardDimming : 0
            Behavior on opacity { NumberAnimation { duration: Theme.cardDimmingDuration; easing.type: Easing.OutCubic } }
        }

        layer.enabled: card._rounded && GraphicsInfo.api !== GraphicsInfo.Software
        layer.smooth: true
        layer.effect: OpacityMask {
            maskSource: Theme.emberGlass ? egCorners : cornerMask
        }
    }

    // Ember Glass: in the card view a hairline of white at 25 % round the
    // card, one CSS px half wide on the screen (cards.html .cardv).
    Rectangle {
        objectName: "emberCardRim"
        anchors.fill: parent
        z: 4
        visible: Theme.emberGlass && card.rounded && !card.reordering
        radius: Theme.px(EmberGlass.radiusCard)
        color: "transparent"
        border.color: Qt.rgba(1, 1, 1, 0.25)
        border.width: Math.max(1, EmberGlass.hairline * Theme.u) / Math.max(0.05, card.cardScale)
        antialiasing: true
    }
    // Ember Glass's corners (radius.card, in the window's pixels: they
    // scale with the card), the mask for the card above.
    Rectangle {
        id: egCorners
        objectName: "emberCardCorners"
        anchors.fill: parent
        visible: false
        layer.enabled: Theme.emberGlass
        radius: Theme.px(EmberGlass.radiusCard)
        color: "white"
        antialiasing: true
    }

    // The corners (CardCornerMask: the devices' corner shader); rendered
    // only as a texture for the effect above.
    CardCornerMask {
        id: cornerMask
        objectName: "cardCornerMask"
        anchors.fill: parent
        visible: false
        layer.enabled: true
        fullSize: card.cardScale >= 0.999
    }

    // ---- Scene transitions -------------------------------------------------------
    // An app pushing or popping a scene (PalmSystem.prepareSceneTransition,
    // runSceneTransition): CardTransition.cpp. prepare takes a snapshot of
    // the window, which the card shows while the app builds the new scene;
    // run then animates from it to the live window over
    // cardTransitionDuration (300 ms), AS_EASEOUT(cardTransitionCurve = 20)
    // = easeOutQuad (lunaAnimations.conf:61-62; AnimationSettings.cpp:380-396),
    // on black:
    //  zoom-fade push: the snapshot fades out under the new scene, which
    //    zooms in from 0.75 while fading in (zoomAndCrossFadeTick, :155-194);
    //  zoom-fade pop: the new scene zooms down from 1.25 while fading in,
    //    under the snapshot fading out (:165-174);
    //  cross-fade: the snapshot fades out over the new scene (crossFadeTick).
    // The snapshot is never scaled (the "from" scale the constructor sets is
    // not drawn). The scaling is about the card's centre (the painter's
    // origin in CardWindow::paint).
    // "" | "prepared" (showing the snapshot) | "running".
    property string sceneTransitionState: ""
    property string sceneTransitionType: ""
    property bool sceneTransitionIsPop: false
    // The snapshot (an image URL from grabToImage).
    property url _sceneSnapshot: ""
    property var _sceneGrab: null
    // Live-scene scale and opacity, from-scene opacity while running.
    property real _sceneProgress: 0

    // done(): the snapshot is taken (the page may change its scene).
    function prepareSceneTransition(isPop, done) {
        _endSceneTransition();
        sceneTransitionIsPop = !!isPop;
        if (!window || typeof window.grabToImage !== "function" || window.width <= 0 || window.height <= 0) {
            if (done)
                done();
            return;
        }
        var self = card;
        var ok = window.grabToImage(function (result) {
            self._sceneGrab = result;
            self._sceneSnapshot = result.url;
            self.sceneTransitionState = "prepared";
            sceneSafety.restart();
            if (done)
                done();
        });
        if (!ok && done)
            done();
    }
    function runSceneTransition(type, isPop) {
        if (sceneTransitionState !== "prepared")
            return;
        sceneSafety.stop();
        if (type !== "zoom-fade" && type !== "cross-fade") {
            _endSceneTransition();
            return;
        }
        if (Theme.reduceMotion) {
            _endSceneTransition();
            return;
        }
        sceneTransitionType = type;
        sceneTransitionIsPop = !!isPop;
        sceneTransitionState = "running";
        _sceneProgress = 0;
        sceneAnim.restart();
    }
    function cancelSceneTransition() {
        _endSceneTransition();
    }
    function _endSceneTransition() {
        sceneAnim.stop();
        sceneSafety.stop();
        sceneTransitionState = "";
        sceneTransitionType = "";
        _sceneProgress = 0;
        _sceneSnapshot = "";
        _sceneGrab = null;
    }
    // The live window while running: from (1 - s) to 1 (CardTransition's
    // constructor: push 0.75, pop 1.25; cross-fade unscaled).
    readonly property real _liveScale: {
        if (sceneTransitionState !== "running" || sceneTransitionType !== "zoom-fade")
            return 1;
        var from = sceneTransitionIsPop ? 1.25 : 0.75;
        return from + (1 - from) * _sceneProgress;
    }
    readonly property real _liveOpacity: sceneTransitionState === "running" && sceneTransitionType === "zoom-fade" ? _sceneProgress : 1
    readonly property real _snapshotOpacity: sceneTransitionState === "running" ? 1 - _sceneProgress : 1
    NumberAnimation {
        id: sceneAnim
        target: card
        property: "_sceneProgress"
        from: 0
        to: 1
        duration: Theme.cardTransitionDuration
        easing.type: Easing.OutQuad
        onFinished: card._endSceneTransition()
    }
    // A page that prepared and never ran nor cancelled (Mojo always does
    // one or the other) gets its live window back.
    Timer {
        id: sceneSafety
        interval: 2000
        onTriggered: card._endSceneTransition()
    }
    Binding {
        target: card.window
        when: card.window !== null && card.sceneTransitionState === "running"
        property: "scale"
        value: card._liveScale
        restoreMode: Binding.RestoreBindingOrValue
    }
    Binding {
        target: card.window
        when: card.window !== null && card.sceneTransitionState === "running"
        property: "opacity"
        value: card._liveOpacity
        restoreMode: Binding.RestoreBindingOrValue
    }

    // A picture of the card as drawn, in its rounded outline (for
    // Touch to Share's ghost: CardWindow::createGhost). done(result) gets
    // the QQuickItemGrabResult; false if it cannot be taken.
    function grabCard(done) {
        if (contentHost.width <= 0 || contentHost.height <= 0)
            return false;
        return contentHost.grabToImage(done);
    }

    onWindowChanged: { _endSceneTransition(); attachWindow(); }
    Component.onCompleted: attachWindow()

    function attachWindow() {
        if (!window)
            return;
        window.parent = appHost;
        // The size the card gives it, or, while a flip is pending, the size
        // it had, centred and turned back (queueFlip).
        window.x = Qt.binding(function() { return card.flipPending ? (appHost.width - card._heldWidth) / 2 : 0; });
        window.y = Qt.binding(function() { return card.flipPending ? (appHost.height - card._heldHeight) / 2 : 0; });
        window.width = Qt.binding(function() { return card.flipPending ? card._heldWidth : appHost.width; });
        window.height = Qt.binding(function() { return card.flipPending ? card._heldHeight : appHost.height; });
        window.rotation = Qt.binding(function() { return card.flipCompensation; });
        // Windows that want to know how they are turned (web app windows).
        if ("orientation" in window)
            window.orientation = Qt.binding(function() { return card.pageOrientation; });
        // ... and what their glass needs (web app windows; Ember Glass).
        if ("glass" in window)
            window.glass = Qt.binding(function() { return card.glass; });
        window.visible = true;
    }
}
