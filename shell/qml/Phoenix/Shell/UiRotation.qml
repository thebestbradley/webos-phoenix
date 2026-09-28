// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Turning the UI with the device: luna-sysmgr's WindowServer orientation
// handling (Src/base/WindowServer.cpp, cited as WS:line), with the rules
// it followed:
//
//  * the accelerometer's orientation is taken 200 ms after it last changed
//    (kDeferredNewOrientationIntervalMs, WS:130, 977-1012);
//  * rotation lock holds the orientation the UI was locked in and remembers
//    the device's, to turn to when the lock is lifted (WS:1735-1743,
//    2018-2030);
//  * a maximized card that asked for an orientation holds the UI there,
//    and the device's orientation waits until the card is minimized
//    (WS:1744-1751); maximizing such a card turns the UI to it with a
//    cross-fade only (WS:1774-1839);
//  * nothing turns while a finger is on the screen or the UI is animating;
//    it retries every 100 ms (kResizePendingTickIntervalInMS, WS:129,
//    1752-1758, 2008-2011);
//  * rotateUi (WS:1841-1960): a snapshot of the screen before, the UI
//    root resized to the swapped width and height and turned, a snapshot
//    after; the after-shot fades in turning from -angle while the
//    before-shot turns to +angle and fades out, 300 ms InOutCubic
//    (conf/lunaAnimations.conf:128 rotationAnimationDuration,
//    rotationValueChanged WS:1962-1978); then the live UI shows again
//    (slotRotationAnimFinished WS:2032-2090), or it turns on at once if
//    the device moved again meanwhile.
//
// This item is the screen the UI root (`ui`) turns in: it draws the
// snapshots over it while turning. Orientations are the names the apps
// use (PalmSystem.screenOrientation, com.palm.systemmanager
// getSystemStatus): "up", "down", "left", "right" (and "faceup",
// "facedown" from the accelerometer). "left" is the device turned
// counter-clockwise, its top to the left: the UI turns 90 degrees
// clockwise to stay upright (WindowServer::angleForOrientation, WS:1621).

import QtQuick

Item {
    id: rot

    // The UI root that turns. The shell binds its size to uiWidth x
    // uiHeight and its rotation to uiAngle, centred on this item.
    property Item ui: null
    // conf/luna.conf:121 DisplayUiRotates=true; so do the phone UI's
    // conf/luna-tuna.conf:27-28. False: the UI stays upright.
    property bool uiRotates: true
    // What the accelerometer says now.
    property string deviceOrientation: "up"
    // Preferences::rotationLock (Preferences.cpp:190-201): the orientation
    // the UI is locked to, "" when rotation is free (Orientation_Invalid).
    property string rotationLock: ""
    // The lock screen is up: a maximized card does not hold the UI then
    // (WS:1744).
    property bool screenLocked: false
    // A finger is on the screen (WindowServer::viewportEvent, WS:755-761).
    property bool fingerDown: false
    // Nothing is animating that a resize would upset
    // (WindowServerLuna::okToResizeUi: cards, launcher, dashboard, lock).
    property bool okToResize: true

    // Animation types (WindowServer.h:252-254).
    readonly property int noAnimation: 0
    readonly property int rotateAndCrossFade: 1
    readonly property int crossFadeOnly: 2
    readonly property int animationDuration: 300          // conf/lunaAnimations.conf:128
    readonly property int deferredOrientationInterval: 200 // WS:130
    readonly property int resizePendingInterval: 100       // WS:129

    // m_deviceIsPortraitType (WS:404-408): the screen is taller than wide
    // when not turned.
    readonly property bool deviceIsPortraitType: !(width > height)

    // m_orientation: the device orientation the system went with.
    property string orientation: "up"
    // m_currentUiOrientation: how the UI is turned.
    property string uiOrientation: "up"
    readonly property int uiAngle: angleFor(uiOrientation)
    readonly property real uiWidth: uiAngle % 180 === 0 ? width : height
    readonly property real uiHeight: uiAngle % 180 === 0 ? height : width
    // SystemUiController::isUiInPortraitMode (SystemUiController.h:187).
    readonly property bool uiPortrait: uiWidth < uiHeight
    // m_pendingOrientation / m_pendingRotationType.
    property string pendingOrientation: "up"
    property int pendingRotationType: rotateAndCrossFade
    // m_uiRotationMode, as the orientation the maximized card asked for:
    // "free" (RotationMode_FreeRotation), "up" / "down" / "left" / "right"
    // (FixedPortrait, FixedPortraitInverted, FixedLandscape,
    // FixedLandscapeInverted) or "landscape" / "portrait" (Limited*)
    // (SystemUiController::setRequestedSystemOrientation,
    // SystemUiController.cpp:1056-1072).
    property string rotationMode: "free"
    // Until bootupFinished() (m_bootingUp).
    property bool booting: true
    // m_inRotationAnimation, and the snapshots being taken before it.
    readonly property int animation: _phase === 3 ? _type : noAnimation
    readonly property bool rotating: _phase !== 0

    // SystemUiController::rotationStarting / rotationComplete, and
    // WindowServer::signalUiRotated (the UI has its new size).
    signal rotationStarting
    signal rotationComplete
    signal uiRotated

    function angleFor(o) {
        switch (o) {
        case "up": return 0;
        case "left": return 90;
        case "down": return 180;
        case "right": return 270;
        }
        return -1;
    }
    function isFourWay(o) { return angleFor(o) >= 0; }

    // WindowServer::bootupFinished (WS:1187-1208): straight to the device's
    // orientation, or to the locked one, without animating.
    function bootupFinished(initialOrientation) {
        if (!booting)
            return;
        var initial = isFourWay(initialOrientation) ? initialOrientation : "up";
        if (rotationLock === "") {
            setUiOrientation(initial, noAnimation);
            setOrientation(initial);
        } else if (rotationLock !== uiOrientation) {
            pendingOrientation = rotationLock;
            setUiOrientation(rotationLock, noAnimation);
            setOrientation(rotationLock);
        }
        _deferred = orientation;
        booting = false;
    }

    // ---- Device orientation (WS:977-1012) -------------------------------------

    property string _deferred: "up"      // m_deferredNewOrientation
    onDeviceOrientationChanged: {
        var o = deviceOrientation;
        if (o !== "" && _deferred !== o) {
            _deferred = o;
            deferredTimer.restart();
        }
    }
    Timer {
        id: deferredTimer
        interval: rot.deferredOrientationInterval
        onTriggered: {
            if (rot._deferred !== "" && rot._deferred !== rot.orientation)
                rot.setOrientation(rot._deferred);
        }
    }

    // WindowServer::setOrientation (WS:1694-1705).
    function setOrientation(o) {
        orientation = o;
        setUiOrientation(o, rotateAndCrossFade);
    }

    // WindowServer::isOrientationAllowed (WS:1646-1692).
    function isOrientationAllowed(o) {
        switch (rotationMode) {
        case "free":
            return true;
        case "landscape":
            return deviceIsPortraitType ? (o === "left" || o === "right") : (o === "up" || o === "down");
        case "portrait":
            return deviceIsPortraitType ? (o === "up" || o === "down") : (o === "left" || o === "right");
        }
        return o === rotationMode;
    }

    // WindowServer::okToResizeUi (WindowServerLuna.cpp:243-280).
    function okToResizeUi() {
        return _phase === 0 && okToResize;
    }

    // WindowServer::setUiOrientation (WS:1707-1772).
    function setUiOrientation(o, animation) {
        if (!uiRotates)
            return;
        if (animation === undefined)
            animation = rotateAndCrossFade;
        if (o === uiOrientation) {
            pendingTimer.stop();
            pendingOrientation = uiOrientation;
            pendingRotationType = rotateAndCrossFade;
            return;
        }
        if (!isFourWay(o)) {
            // Face up or down: a turn waiting on the rotation lock is dropped.
            if (pendingOrientation !== uiOrientation && rotationLock !== pendingOrientation) {
                pendingTimer.stop();
                pendingOrientation = uiOrientation;
                pendingRotationType = rotateAndCrossFade;
            }
            return;
        }
        if (rotationLock !== "" && rotationLock !== o && !booting && isOrientationAllowed(uiOrientation)) {
            // Locked: turn when the lock is lifted.
            pendingOrientation = o;
            pendingRotationType = rotateAndCrossFade;
            pendingTimer.stop();
            return;
        } else if (!isOrientationAllowed(o) && !screenLocked) {
            // Held by a maximized card: turn when it is minimized.
            pendingOrientation = o;
            pendingRotationType = rotateAndCrossFade;
            pendingTimer.stop();
            return;
        } else if ((fingerDown && isOrientationAllowed(uiOrientation)) || !okToResizeUi()) {
            // Not now: try again every 100 ms.
            pendingOrientation = o;
            pendingRotationType = animation;
            if (!pendingTimer.running)
                pendingTimer.start();
            return;
        }
        pendingTimer.stop();
        rotateUi(o, animation);
        pendingOrientation = o;
    }

    Timer {
        id: pendingTimer
        interval: rot.resizePendingInterval
        repeat: true
        // WindowServer::slotResizePendingTimerTicked (WS:2008-2011).
        onTriggered: rot.setUiOrientation(rot.pendingOrientation, rot.pendingRotationType)
    }

    // WindowServer::setUiRotationMode (WS:1774-1839). cardMaximizing: a
    // card with a fixed orientation is being maximized, so the UI only
    // cross-fades to it (or, skipAnimation, jumps).
    function setRotationMode(requested, cardMaximizing, skipAnimation) {
        rotationMode = requested && requested !== "" ? requested : "free";
        var type = !cardMaximizing ? rotateAndCrossFade : (!skipAnimation ? crossFadeOnly : noAnimation);
        var o = orientation;
        switch (rotationMode) {
        case "free":
            if (rotationLock !== "" && rotationLock !== uiOrientation) {
                setUiOrientation(rotationLock);
                pendingOrientation = orientation;
                setOrientation(rotationLock);
            } else if (orientation !== uiOrientation && isFourWay(orientation)) {
                setUiOrientation(orientation);
            }
            break;
        case "landscape":
            if (uiPortrait) {
                if (deviceIsPortraitType)
                    setUiOrientation(o === "right" || o === "down" ? "right" : "left", type);
                else
                    setUiOrientation(o === "down" || o === "left" ? "down" : "up", type);
            }
            break;
        case "portrait":
            if (!uiPortrait) {
                if (deviceIsPortraitType)
                    setUiOrientation(o === "down" || o === "left" ? "down" : "up", type);
                else
                    setUiOrientation(o === "right" || o === "down" ? "right" : "left", type);
            }
            break;
        default:
            if (isFourWay(rotationMode) && uiOrientation !== rotationMode)
                setUiOrientation(rotationMode, type);
        }
    }

    // WindowServer::slotRotationLockChanged (WS:2018-2030).
    onRotationLockChanged: {
        if (booting)
            return;
        if (rotationLock === "" && pendingOrientation !== uiOrientation) {
            setUiOrientation(pendingOrientation);
        } else if (rotationLock !== "" && rotationLock !== uiOrientation) {
            pendingOrientation = rotationLock;
            setUiOrientation(rotationLock);
            setOrientation(rotationLock);
        }
    }

    // ---- rotateUi (WS:1841-1960) ---------------------------------------------------
    // 0 idle, 1 taking the before-shot, 2 taking the after-shot, 3 animating.
    property int _phase: 0
    property int _type: noAnimation
    property string _target: ""
    property real _delta: 0
    property real _fromAngle: 0
    property real progress: 0

    function rotateUi(o, animation) {
        if (!uiRotates || !isFourWay(o))
            return;
        var delta = angleFor(o) - angleFor(uiOrientation);
        if (delta > 180)
            delta -= 360;
        else if (delta < -180)
            delta += 360;
        rotationStarting();
        var win = ui ? ui.Window.window : null;
        if (animation === noAnimation || !ui || !win || !win.visible) {
            _finishNow(o);
            return;
        }
        _type = animation;
        _target = o;
        _delta = delta;
        _fromAngle = uiAngle;
        progress = 0;
        // The screen as it is (getScreenShotImageFromFb).
        _capture(before, 2);
        _phase = 1;
        before.scheduleUpdate();
        captureTimeout.restart();
    }

    function _capture(shot, z) {
        shot.sourceItem = ui;
        shot.sourceRect = Qt.rect(0, 0, ui.width, ui.height);
        shot.width = ui.width;
        shot.height = ui.height;
        shot.z = z;
        shot.visible = true;
    }

    function _finishNow(o) {
        captureTimeout.stop();
        rotationAnim.stop();
        if (o !== uiOrientation) {
            uiOrientation = o;
            uiRotated();
        }
        _release();
        rotationComplete();
    }

    function _release() {
        before.visible = false;
        after.visible = false;
        before.sourceItem = null;
        after.sourceItem = null;
        _phase = 0;
    }

    Connections {
        target: before
        function onScheduledUpdateCompleted() {
            if (rot._phase !== 1)
                return;
            // Resize the UI to the swapped size and turn it
            // (SystemUiController::resizeAndRotateUi); the layout follows.
            rot.uiOrientation = rot._target;
            rot.uiRotated();
            // The screen as it will be (takeScreenShot), under the before-shot.
            rot._capture(after, 1);
            rot._phase = 2;
            after.scheduleUpdate();
        }
    }
    Connections {
        target: after
        function onScheduledUpdateCompleted() {
            if (rot._phase !== 2)
                return;
            captureTimeout.stop();
            rot._phase = 3;
            rotationAnim.restart();
        }
    }
    // A window that is not drawing never completes the snapshots: turn
    // without animating.
    Timer {
        id: captureTimeout
        interval: 1000
        onTriggered: if (rot._phase === 1 || rot._phase === 2) rot._finishNow(rot._target)
    }

    NumberAnimation {
        id: rotationAnim
        target: rot
        property: "progress"
        from: 0
        to: 1
        duration: rot.animationDuration
        easing.type: Easing.InOutCubic
        onFinished: rot._animationFinished()
    }

    // WindowServer::slotRotationAnimFinished (WS:2032-2090).
    function _animationFinished() {
        if (_phase !== 3)
            return;
        if (pendingOrientation !== uiOrientation && rotationLock === "" && okToResize) {
            // The device turned again meanwhile: on to that. The after-shot
            // stays up (it is the UI as it is) until the next before-shot.
            before.visible = false;
            _phase = 0;
            pendingTimer.stop();
            rotateUi(pendingOrientation, rotateAndCrossFade);
            return;
        }
        _release();
        rotationComplete();
    }

    // The snapshots, centred on the screen like the original's pixmap
    // items (WS:1920-1935). Before: turns from where the UI was by the
    // rotation angle and fades out. After: starts turned back by that
    // angle, invisible, and turns into place as it fades in; with a
    // cross-fade only it waits, in place, under the fading before-shot.
    ShaderEffectSource {
        id: before
        anchors.centerIn: parent
        visible: false
        live: false
        hideSource: true
        rotation: rot._fromAngle + (rot._phase === 3 && rot._type === rot.rotateAndCrossFade ? rot.progress * rot._delta : 0)
        opacity: rot._phase === 3 ? 1 - rot.progress : 1
    }
    ShaderEffectSource {
        id: after
        anchors.centerIn: parent
        visible: false
        live: false
        hideSource: true
        rotation: rot.angleFor(rot._target) - (rot._phase === 3 && rot._type === rot.rotateAndCrossFade ? (1 - rot.progress) * rot._delta : 0)
        opacity: rot._phase === 3 && rot._type === rot.rotateAndCrossFade ? rot.progress : 1
    }

    // The UI root is hidden while it turns (WS:1916-1918): nothing reaches it.
    MouseArea {
        anchors.fill: parent
        z: 3
        enabled: rot._phase !== 0
        visible: enabled
    }
}
