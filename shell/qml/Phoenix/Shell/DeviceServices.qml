// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shell's side of LunaSysMgr's device services, which the apps call
// (luna-sysmgr README.md:24-128):
//
//   com.palm.display    the display's state (Display.qml) for the apps, and
//                       what they ask of it: setState, holding it on
//                       (requestBlock), the Power key (powerKeyBlock)
//   com.palm.keys       the keys and switches: volume, Power, media, the
//                       headset (in, out, its button) and the ringer switch
//   com.palm.vibrate    the motor; SystemSounds counts every vibration
//   com.palm.ambientLightSensor  the light, its region and the brightness
//                       that follows it (Display.brightness)
//
// The services themselves are the window source's: in phoenix-sim each
// page's runtime (runtime/phoenix-runtime.js, "LunaSysMgr's device
// services"), on a device phoenix-devices (services/devices). The source
// may have:
//
//   deviceEvent(ev)              tell the services what the shell knows:
//                                {display}, {key}, {switches}, {light}, {powerKey}
//   displayHolds                 {requestBlock, powerKeyBlock, proximity,
//                                alsDisabled}: what the apps hold
//   signal displayStateRequested(state)   setState from an app
//   signal vibrationRequested(request)    an app's vibration (simulator)
//   vibrate(request)             run the motor (a device)
//
// and the system status: brightness (0.1-1), automaticBrightness,
// onWhenConnected, charger, lightLevel (lux; -1 no sensor) or lightRegion,
// ringerSwitch ("up" on, "down" silent), headset ("none", "headset",
// "headset-mic"), muted.

import QtQuick

QtObject {
    id: devices

    property var shell: null
    property var source: null
    property var system: null
    property var display: null
    property var sounds: null

    function _publish(ev) {
        if (source && typeof source.deviceEvent === "function")
            source.deviceEvent(ev);
    }

    // ---- com.palm.display -------------------------------------------------------

    readonly property var holds: source && source.displayHolds ? source.displayHolds : ({})
    readonly property bool _usbCharger: !!system && (system.charger === "wall" || system.charger === "pc")
    // Held on (Display.held): an app's requestBlock, or a USB charger in
    // with onWhenConnected (DisplayManager :2516-2535).
    readonly property bool holdsDisplay: (holds.requestBlock || 0) > 0
                                         || (!!system && system.onWhenConnected === true && _usbCharger)
    // While an app blocks the Power key, it only goes to that app
    // (DisplayManager :2463-2476): the shell calls powerKeyReleased().
    readonly property bool powerKeyBlocked: (holds.powerKeyBlock || 0) > 0
    function powerKeyReleased() { _publish({ powerKey: "released" }); }

    // What the apps see: control/status's state, timeout, blockDisplay
    // (anything keeping it on) and dock mode; and for a device's service
    // the backlight's level and the user's brightness (getProperty
    // maximumBrightness). "active" goes with each change, not on its own:
    // it flips with every touch.
    readonly property var displayReport: display ? {
        state: display.state === "dim" ? "dimmed" : display.state,
        timeout: display.timeout > 0 ? display.timeout : 120,
        blockDisplay: display.blocked || display.held,
        dockMode: display.dockMode,
        brightness: display.brightness,
        maximumBrightness: display.maximumBrightness,
        onWhenConnected: !!system && system.onWhenConnected === true
    } : null
    onDisplayReportChanged: _reportDisplay()
    function _reportDisplay() {
        if (!displayReport)
            return;
        var r = Object.assign({}, displayReport);
        r.active = display.active;
        _publish({ display: r });
    }

    // setState (DisplayManager::controlSetState, :1225-1308).
    function setState(state) {
        if (!display)
            return;
        if (state === "on") {
            // Not out of dock mode (:1265-1270).
            if (!display.dockMode)
                display.turnOn();
        } else if (state === "dimmed") {
            display.dim();
        } else if (state === "off") {
            display.turnOff();
        } else if (state === "unlock") {
            // on() and unlock(): the lock screen goes as if the user slid
            // it open, so a passcode is still asked for.
            display.turnOn();
            if (shell && shell.locked && !shell.dockMode && shell.lockScreen)
                shell.lockScreen.requestUnlock();
        } else if (state === "dock") {
            if (shell)
                shell.enterDockMode();
        } else if (state === "undock") {
            if (shell)
                shell.exitDockMode(true);
        }
    }

    // setProperty's preferences, from a device's service: "Turn off after"
    // (seconds), the user's brightness (1-100) and onWhenConnected.
    function setProperties(props) {
        if (!system || !props)
            return;
        if (typeof props.timeout === "number" && system.screenTimeout !== undefined)
            system.screenTimeout = props.timeout;
        if (typeof props.maximumBrightness === "number" && system.brightness !== undefined)
            system.brightness = Math.max(0.10, Math.min(1, props.maximumBrightness / 100));
        if (typeof props.onWhenConnected === "boolean" && system.onWhenConnected !== undefined)
            system.onWhenConnected = props.onWhenConnected;
    }

    // ---- com.palm.keys ----------------------------------------------------------
    // InputManager's categories and names (InputManager.cpp:49-70,
    // keyToString :876-955): volume keys to /audio, Power (and the
    // switches) to /switches, media keys to /media, the headset to /headset.

    readonly property var _keyNames: (function () {
        var m = {};
        m[Qt.Key_VolumeUp] = ["/audio", "volume_up"];
        m[Qt.Key_F11] = ["/audio", "volume_up"];          // the simulator's
        m[Qt.Key_VolumeDown] = ["/audio", "volume_down"];
        m[Qt.Key_F10] = ["/audio", "volume_down"];        // the simulator's
        m[Qt.Key_PowerOff] = ["/switches", "power"];
        m[Qt.Key_F3] = ["/switches", "power"];            // the simulator's
        m[Qt.Key_MediaPlay] = ["/media", "play"];
        m[Qt.Key_MediaPause] = ["/media", "pause"];
        m[Qt.Key_MediaTogglePlayPause] = ["/media", "togglePausePlay"];
        m[Qt.Key_MediaStop] = ["/media", "stop"];
        m[Qt.Key_MediaNext] = ["/media", "next"];
        m[Qt.Key_MediaPrevious] = ["/media", "prev"];
        return m;
    })()

    // A key went down or up (the shell's SystemKeys).
    function hardwareKey(key, down) {
        var k = _keyNames[key];
        if (k)
            _publish({ key: { category: k[0], key: k[1], state: down ? "down" : "up" } });
    }

    // A media key pressed and let go (the simulator's): play, pause,
    // togglePausePlay, stop, next, prev.
    function mediaKey(name) {
        _publish({ key: { category: "/media", key: name, state: "down" } });
        _publish({ key: { category: "/media", key: name, state: "up" } });
    }

    // The headset's button (InputManager::headsetStateMachine, :254-330):
    // down and up go out as they are, and from them single_click (let go
    // within 2 s), double_click (pressed again within 1 s of that and let
    // go), or hold (held 2 s). The click goes out before the "up" that
    // made it: handleEvent runs the state machine before it posts the key
    // (InputManager.cpp:1145, :1173).
    readonly property int pressAndHoldTime: 2000   // PRESS_AND_HOLD_TIME_MS
    readonly property int doublePressTime: 1000    // DOUBLE_PRESS_TIME_MS
    property string _headsetButton: "start"
    function _headsetEvent(state) {
        _publish({ key: { category: "/headset", key: "headset_button", state: state } });
    }
    function headsetButton(down) {
        var s = _headsetButton;
        if (s === "start") {
            if (down) {
                _headsetButton = "singleOrHold";
                _headsetTimer.interval = pressAndHoldTime;
                _headsetTimer.restart();
            }
        } else if (s === "singleOrHold") {
            if (!down) {
                _headsetTimer.stop();
                _headsetEvent("single_click");
                _headsetButton = "maybeDouble";
                _headsetTimer.interval = doublePressTime;
                _headsetTimer.restart();
            }
        } else if (s === "hold") {
            if (!down) {
                _headsetTimer.stop();
                _headsetButton = "start";
            }
        } else if (s === "maybeDouble") {
            if (down) {
                _headsetTimer.stop();
                _headsetButton = "doubleOrHold";
                _headsetTimer.interval = pressAndHoldTime;
                _headsetTimer.restart();
            }
        } else if (s === "doubleOrHold") {
            if (!down) {
                _headsetTimer.stop();
                _headsetEvent("double_click");
                _headsetButton = "start";
            }
        }
        _headsetEvent(down ? "down" : "up");
    }
    property Timer _headsetTimer: Timer {
        onTriggered: {
            if (devices._headsetButton === "maybeDouble") {
                devices._headsetButton = "start";
            } else if (devices._headsetButton === "singleOrHold" || devices._headsetButton === "doubleOrHold") {
                devices._headsetEvent("hold");
                devices._headsetButton = "hold";
            }
        }
    }

    // The switches: the ringer ("up" sound on, "down" silent; the
    // emulator's reported "up", InputManager.cpp:772-777) mutes the
    // system; a headset in is "down" on /headset (Key_Headset /
    // Key_HeadsetMic, :784-795).
    readonly property string ringerSwitch: system && system.ringerSwitch === "down" ? "down" : "up"
    readonly property string headset: system && (system.headset === "headset" || system.headset === "headset-mic") ? system.headset : "none"
    property string _headsetWas: "none"
    onRingerSwitchChanged: {
        _publish({ key: { category: "/switches", key: "ringer", state: ringerSwitch } });
        if (system && system.muted !== undefined)
            system.muted = ringerSwitch === "down";
    }
    onHeadsetChanged: {
        if (_headsetWas !== "none")
            _publish({ key: { category: "/headset", key: _headsetWas, state: "up" } });
        if (headset !== "none")
            _publish({ key: { category: "/headset", key: headset, state: "down" } });
        _headsetWas = headset;
    }

    // ---- com.palm.ambientLightSensor ----------------------------------------------
    // The light's region (AmbientLightSensor::updateAls, :290-415): borders
    // at 6, 100 and 1000 lux, with margins of 4, 10 and 100 so it does not
    // flicker between two (:113-129); it starts indoor (:195). A device's
    // service gives the region itself (system.lightRegion); here it comes
    // from the simulated light (system.lightLevel). Held off by an app
    // (disableALS), or with no sensor, it is undefined (0).
    readonly property var _borders: [-1, 6, 100, 1000, Number.MAX_VALUE]
    readonly property var _margins: [0, 4, 10, 100, 0]
    function regionFor(lux, current) {
        if (lux < 0)
            return 0;
        var r = current >= 1 && current <= 4 ? current : 3;
        while (r > 1 && lux < _borders[r - 1] - _margins[r - 1])
            --r;
        while (r < 4 && lux > _borders[r] + _margins[r])
            ++r;
        return r;
    }
    readonly property int lightLevel: system && typeof system.lightLevel === "number" ? Math.round(system.lightLevel) : -1
    readonly property bool lightSensorDisabled: (holds.alsDisabled || 0) > 0
    property int _region: regionFor(lightLevel, 3)
    readonly property int lightRegion: lightSensorDisabled ? 0
        : system && typeof system.lightRegion === "number" ? system.lightRegion : _region
    onLightLevelChanged: {
        _region = regionFor(lightLevel, _region);
        _reportLight();
    }
    onLightRegionChanged: _reportLight()
    function _reportLight() {
        if (lightLevel >= 0)
            _publish({ light: { current: lightLevel, average: lightLevel, region: lightRegion } });
    }

    // ---- com.palm.vibrate ---------------------------------------------------------
    // Every vibration (an app's, a banner's) goes through SystemSounds,
    // which counts it; here it runs: the device's motor (source.vibrate),
    // and in the simulator a cue for as long as it lasts (vibrating).

    property bool vibrating: false
    property string vibration: ""     // what: an effect's name, or "period/duration ms"
    property var _endless: ({})       // id -> true, until the app lets go
    // How long the simulator shows a named effect, in ms (the Castle's
    // effects were its haptics driver's; these are Phoenix's).
    readonly property var effectLengths: ({ ringtone: 1500, alert: 800, notification: 300, tapdown: 40, tapup: 40 })

    property Connections _soundsVibrate: Connections {
        target: devices.sounds
        ignoreUnknownSignals: true
        function onVibrated(request) { devices._run(request); }
    }
    property Connections _sourceRequests: Connections {
        target: devices.source
        ignoreUnknownSignals: true
        function onDisplayStateRequested(state) { devices.setState(state); }
        function onVibrationRequested(request) { devices.vibrate(request); }
        // A device's service: setProperty's timeout, maximumBrightness and
        // onWhenConnected, for the system's preferences (in the simulator
        // the runtime keeps them).
        function onDisplayPropertiesRequested(props) { devices.setProperties(props); }
    }

    // An app's vibration ({id, on, name | period, duration, continous}).
    function vibrate(request) {
        if (!request)
            return;
        if (request.on === false) {
            if (request.id && _endless[request.id]) {
                var e = Object.assign({}, _endless);
                delete e[request.id];
                _endless = e;
                if (Object.keys(e).length === 0)
                    _stop();
            }
            return;
        }
        if (sounds)
            sounds.vibrate(request);
        else
            _run(request);
    }

    // A device's service ran the motor itself (ran: true); the shell counts
    // it and moves on.
    function _run(request) {
        if (!request.ran && source && typeof source.vibrate === "function")
            source.vibrate(request);
        // Until the app lets go (by its id).
        var endless = !!request.id && (request.continous === true || (request.period !== undefined && !(request.duration > 0)));
        if (endless && request.id) {
            var e = Object.assign({}, _endless);
            e[request.id] = true;
            _endless = e;
        }
        vibration = request.name ? String(request.name)
                  : (request.period || 0) + "/" + (request.duration > 0 ? request.duration : "∞") + " ms";
        vibrating = true;
        _vibrationTimer.stop();
        if (!endless) {
            _vibrationTimer.interval = request.name ? (effectLengths[request.name] || 300) : Math.max(1, request.duration);
            _vibrationTimer.start();
        }
        console.info("Phoenix: vibrate " + vibration + (request.appId ? " (" + request.appId + ")" : ""));
    }
    function _stop() {
        _vibrationTimer.stop();
        vibrating = false;
    }
    property Timer _vibrationTimer: Timer {
        onTriggered: if (Object.keys(devices._endless).length === 0) devices._stop()
    }

    Component.onCompleted: {
        _headsetWas = headset;
        _publish({ switches: { ringer: ringerSwitch, headset: headset === "headset" ? "down" : "up",
                               "headset-mic": headset === "headset-mic" ? "down" : "up" } });
        _reportDisplay();
        _reportLight();
    }
}
