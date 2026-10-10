// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system's full-screen states, over everything: the boot animation,
// the progress animation, USB drive mode's "brick" screen, Full Erase's
// countdown, and the debugging overlays (frame rate counter, touch plot).
// luna-sysmgr kept them in WindowServer and WindowServerLuna
// (startProgressAnimation, the Full Erase key chord, enableFpsCounter,
// enableTouchPlotOption), TopLevelWindowManager (the brick window) and
// SystemService (storaged's signals, enterMSM).
//
// The shell gives it the system keys (systemKey) and the storage daemon's
// /storaged signals (storagedSignal); the window source (lunaCall) takes
// the erase and USB drive mode requests to the storage service.

import QtQuick

Item {
    id: screens
    objectName: "systemScreens"

    property var source
    property var system
    property bool locked: false
    property bool onCall: false
    property bool displayOn: true
    // The boot animation turned so it is upright with the Home button below
    // (Shell.homeButtonAngle).
    property int bootAngle: 0

    // Something here keeps the screen on (DisplayManager::pushDNAST:
    // "brickmode-local", "progress-sequence").
    readonly property bool holdsDisplay: brickMode || progress.running || boot.running || fullErase.shown
    // ... and takes the touches and keys meant for the UI under it.
    readonly property bool blocksInput: holdsDisplay

    readonly property alias boot: boot
    readonly property alias progress: progress
    readonly property alias fullErase: fullErase
    readonly property alias fpsCounter: fps
    readonly property alias touchPlot: plot
    readonly property alias brick: brickScreen

    signal bootFinished
    // storaged could not take the drive (SystemService signalBrickModeFailed).
    signal brickModeFailed

    // ---- Boot -------------------------------------------------------------------

    function startBoot(activity) { boot.start(activity); }
    function bootProgress(val, total) { boot.setProgress(val, total); }
    // WindowServer::bootupFinished: the boot sound as the logo goes.
    function finishBoot() {
        if (boot.mode === "")
            return;
        boot.finish();
        bootFinished();
    }

    // ---- Progress animation (com.palm.systemmanager runProgressAnimation) --------

    function startProgressAnimation(type) { progress.start(type); }
    function stopProgressAnimation() { progress.stop(); }

    // ---- Debugging overlays ------------------------------------------------------
    // enableFpsCounter {enable, reset, dump} as {fpsCounter: {...}} and
    // enableTouchPlot {collection, trails, crosshairs} as {touchPlot: {...}};
    // debugOverlays is what shows, for the pages (getDebugOverlays).
    readonly property var debugOverlays: ({ fpsCounter: fps.visible,
                                            touchPlot: { collection: plot.collection, trails: plot.trails, crosshairs: plot.crosshairs } })
    function debugOverlay(request) {
        var f = request ? request.fpsCounter : null;
        if (f) {
            if (f.enable !== undefined) {
                fps.visible = !!f.enable;
                if (fps.visible)
                    fps.reset(fps.historySize);
            }
            if (f.reset !== undefined)
                fps.reset(f.reset);
            if (f.dump)
                fps.dump();
        }
        if (request && request.touchPlot)
            plot.enable(request.touchPlot);
    }

    // ---- The Power + volume key chords (WindowServerLuna.cpp:1220-1280) -------------
    // Power with Volume Up held, then Home: Full Erase's countdown; letting
    // go of Power or Volume Up stops it (unless the erase has begun). Power
    // with Volume Down: USB drive mode (SystemService::enterMSM). The keys
    // that make a chord do nothing else, and neither do their releases.
    property bool _power: false
    property bool _volUp: false
    property bool _volDown: false
    property bool _eatPowerUp: false
    property bool _eatHomeUp: false
    readonly property bool fullEraseComboDown: _power && _volUp
    readonly property bool msmEntryComboDown: _power && _volDown
    readonly property bool comboDown: fullEraseComboDown || msmEntryComboDown

    function _kind(key) {
        if (key === Qt.Key_F3 || key === Qt.Key_PowerOff) return "power";
        if (key === Qt.Key_F11 || key === Qt.Key_VolumeUp) return "volUp";
        if (key === Qt.Key_F10 || key === Qt.Key_VolumeDown) return "volDown";
        if (key === Qt.Key_Home) return "home";
        return "";
    }
    function isChordKey(key) { return _kind(key) !== ""; }
    // A system key went down or up (not auto-repeated). True: it is the
    // chord's, and nothing else may act on it.
    function systemKey(key, pressed) {
        var kind = _kind(key);
        if (kind === "power") {
            _power = pressed;
            if (!pressed) {
                cancelFullErase();
                var eat = _eatPowerUp;
                _eatPowerUp = false;
                return eat;
            }
            if (msmEntryComboDown) {
                _eatPowerUp = true;
                enterMSM();
                return true;
            }
            if (comboDown) {
                _eatPowerUp = true;
                return true;
            }
        } else if (kind === "volDown") {
            _volDown = pressed;
            if (msmEntryComboDown) {
                _eatPowerUp = true;
                enterMSM();
                return true;
            }
        } else if (kind === "volUp") {
            _volUp = pressed;
            if (!pressed) {
                cancelFullErase();
            } else if (comboDown) {
                _eatPowerUp = true;
                return true;
            }
        } else if (kind === "home") {
            if (pressed && fullEraseComboDown) {
                if (!fullErase.shown)
                    fullErase.show();
                _eatHomeUp = true;
                return true;
            }
            if (!pressed && _eatHomeUp) {
                _eatHomeUp = false;
                return true;
            }
        }
        return false;
    }
    // The screen went off: the keys' state is lost with it (the release
    // may never come), and the countdown stops (slotDisplayStateChange).
    function resetKeys() {
        _power = _volUp = _volDown = false;
        _eatPowerUp = _eatHomeUp = false;
        cancelFullErase();
    }
    onDisplayOnChanged: if (!displayOn) resetKeys()

    // ---- Full Erase (FullEraseConfirmationWindow; slotFullEraseDevice) ----------------

    function cancelFullErase() { fullErase.cancel(); }
    function _call(uri, params, callback) {
        if (source && source.lunaCall)
            source.lunaCall(uri, params, callback);
        else
            callback(null);
    }
    // com.palm.storage/erase/EraseAll; the device restarts once it is done
    // (exit(-2)). If it fails, the countdown goes so it can be tried again
    // (cbFullEraseCallback, WindowServerLuna.cpp:847-879).
    function _eraseDevice() {
        _call("palm://com.palm.storage/erase/EraseAll", {}, function (r) {
            if (r && r.returnValue !== false)
                return;
            console.warn("Phoenix: Full Erase failed", r ? JSON.stringify(r) : "(no storage service)");
            fullErase.pending = false;
            screens._power = screens._volUp = screens._volDown = false;
            fullErase.cancel();
        });
    }

    // ---- USB drive mode (SystemService msmAvail / msmProgress / msmEntry /
    // msmFscking, SystemService.cpp:4643-4850; TopLevelWindowManager brick mode) ----

    property bool brickMode: false
    property bool fscking: false
    property bool msmExitClean: false

    // SystemService::enterMSM (:921-943): not with the UI minimal, in brick
    // mode already, off the USB charger, on a call or locked.
    function enterMSM() {
        if (brickMode || !(system && system.charging) || onCall || locked)
            return;
        _call("palm://com.palm.storage/diskmode/enterMSM", { "user-confirmed": true, enterIMasq: false }, function () {});
    }

    function _enterBrick() {
        if (brickMode)
            return;
        brickMode = true;
        msmExitClean = false;
    }
    function _exitBrick() {
        brickMode = false;
        if (fscking) {
            stopProgressAnimation();
            fscking = false;
        }
    }
    function storagedSignal(method, payload) {
        payload = payload || {};
        if (method === "MSMAvail") {
            if (payload["mode-avail"] === false && brickMode) {
                // Unplugged without being ejected (an unclean exit).
                if (!msmExitClean)
                    console.warn("Phoenix: the USB cable was pulled without ejecting the drive");
                _exitBrick();
            }
        } else if (method === "MSMProgress") {
            if (payload.stage === "attempting") {
                _enterBrick();
            } else if (payload.stage === "failed") {
                if (brickMode) {
                    brickMode = false;
                    brickModeFailed();
                }
                if (fscking) {
                    stopProgressAnimation();
                    fscking = false;
                }
            }
        } else if (method === "MSMEntry") {
            if (payload["new-mode"] === "phone") {
                msmExitClean = true;
                _exitBrick();
            } else if (payload["new-mode"] === "brick") {
                msmExitClean = false;
                _enterBrick();
            }
        } else if (method === "MSMFscking") {
            // storaged is checking the drive after an unclean exit.
            if (!brickMode)
                return;
            msmExitClean = false;
            fscking = true;
            startProgressAnimation("fsck");
        }
    }

    // ---- Layers, bottom to top ------------------------------------------------------

    // The brick window (TopLevelWindowManager::createBrickModeWindow,
    // :159-223): black, normal-bg.png and msm-usb.png centred; it fades in
    // and out over 300 ms, linear (brickDuration, brickCurve 0).
    Item {
        id: brickScreen
        objectName: "brickScreen"
        // The 768 px pictures were drawn for the TouchPad's screen: on a smaller
        // one they shrink with it (Phoenix), to its longer side.
        readonly property real fit: Math.min(1, Math.max(width, height) / Theme.px(768))
        anchors.fill: parent
        opacity: screens.brickMode ? 1 : 0
        visible: opacity > 0
        Behavior on opacity { NumberAnimation { duration: Theme.motion(300) } }
        MouseArea { anchors.fill: parent; enabled: screens.brickMode }
        Rectangle {
            anchors.fill: parent
            color: "black"
        }
        Image {
            anchors.centerIn: parent
            scale: brickScreen.fit
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
            source: Theme.asset("normal-bg.png")
        }
        Image {
            anchors.centerIn: parent
            scale: brickScreen.fit
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
            source: Theme.asset("msm-usb.png")
        }
    }

    ProgressAnimation {
        id: progress
        anchors.fill: parent
    }

    FullEraseConfirmation {
        id: fullErase
        anchors.fill: parent
        onConfirmed: screens._eraseDevice()
    }

    TouchPlot {
        id: plot
        anchors.fill: parent
    }

    FpsCounter {
        id: fps
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        visible: false
    }

    BootAnimation {
        id: boot
        anchors.fill: parent
        angle: screens.bootAngle
    }
}
