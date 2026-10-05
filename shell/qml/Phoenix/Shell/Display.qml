// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The display's state: on, dimmed or off, as LunaSysMgr's DisplayManager
// kept it (Src/base/DisplayManager.cpp).
//
// - Left alone, the screen dims after two thirds of the timeout ("Turn off
//   after" in Screen & Lock) and turns off a third later (:1552-1557).
//   Dimmed, it is a tenth as bright (displayDim, :3538-3546). Any input
//   brings it back on.
// - On the lock screen it turns off after 5 s alone (Settings
//   LockScreenTimeoutMs, the OnLocked state).
// - An app can keep it on while it is in front (blockScreenTimeout, e.g. a
//   video playing): blocked. Only while unlocked.
// - An app can also hold it on from anywhere, locked or not, until it lets
//   go (com.palm.display setProperty requestBlock, e.g. the Clock while an
//   alarm rings): held. Held, it comes on and stays on: luna-sysmgr's
//   "do not allow screen timeout" count (pushDNAST :615-640; every state's
//   startInactivityTimer, DisplayStates.cpp:823-868, 1102-1115, 1566-1579).
// - A banner, a popup alert or a call turns it on (alert, :2920-2989): a
//   banner or an alert for 6 s (ALERT_TIMEOUT), a call while it rings; then
//   it goes back to how it was, unless the user touched it meanwhile.
// - Off, the shell locks (turnedOff).
//
// - On a Touchstone (onPuck) with the screen on, locked or not, it does not
//   dim: when the screen would have turned off (the dim and off timeouts
//   together, DisplayOnPuck::startInactivityTimer, DisplayStates.cpp:
//   1567-1580) it asks for dock mode instead (puckTimeout; the shell starts
//   the exhibition, DisplayOnPuck::timeout -> DisplayStateDockMode), or
//   after puckTimeout ms when the user chose a time (Settings > Exhibition).
// - In dock mode it stays on (DisplayDockMode has no inactivity timer),
//   at the night brightness while night mode is on (night).
//
// The shell gives it the input (activity()); the window source applies the
// state: on a device the backlight, in the simulator a black veil.

import QtQuick

QtObject {
    id: display

    // "on", "dim" or "off".
    property string state: "on"
    readonly property bool on: state !== "off"
    readonly property bool dimmed: state === "dim"

    // Seconds from the last input until the screen is off. Nothing set (0
    // or less): DisplayManager's default, 120 s.
    property int timeout: 60
    property bool locked: false
    property bool blocked: false
    property bool held: false
    // Never dims or turns off by itself (phoenix-sim --stay-awake, and its
    // screenshots); Power still turns it off.
    property bool stayAwake: false
    property int lockedOffTimeout: 5000
    property int alertTimeout: 6000
    // On a Touchstone, exhibitions on (Settings > Exhibition): the
    // screen stays bright and puckTimedOut() comes instead of dimming.
    property bool onPuck: false
    // How long on the Touchstone before puckTimedOut(), in ms; 0: the
    // screen timeout (dim and off together).
    property int puckTimeout: 0
    // In dock mode: on until Power, whatever the timeouts.
    property bool dockMode: false
    // Dock mode's night mode: the backlight at its night brightness
    // (Settings.cpp:184 DockModeNightBrightness, 1 of 100).
    property bool night: false
    readonly property int nightBrightness: 1

    // The inactivity timer is running (com.palm.display control/status "active").
    readonly property bool active: _idle.running

    // ---- The backlight's level --------------------------------------------------
    // 0-100, as DisplayManager::getDisplayBrightness (:2043-2093) set it: the
    // user's brightness (maximumBrightness: Screen & Lock, the system menu),
    // scaled by the light sensor's region while automatic brightness is on
    // (the enableALS preference; outdoor 250%, dim 30%, dark 10%:
    // Settings.cpp:112-114), never under 1 (MINIMUM_ON_BRIGHTNESS); dimmed,
    // a tenth of it (displayDim, :3538-3546); off, 0; in night mode the night
    // brightness. (The original also took 5 to 20 off on a low battery
    // without a charger, :2053-2062; Phoenix does not.)
    property int maximumBrightness: 100
    property bool automaticBrightness: true
    // The light sensor's region (AmbientLightSensor.h:34-38): 0 undefined
    // (no sensor, or held off by an app), 1 dark, 2 dim, 3 indoor, 4 outdoor.
    property int lightRegion: 0
    readonly property int brightness: {
        if (state === "off")
            return 0;
        if (night)
            return nightBrightness;
        var b = maximumBrightness;
        if (automaticBrightness) {
            if (lightRegion === 4)
                b = 250 * b / 100;
            else if (lightRegion === 2)
                b = 30 * b / 100;
            else if (lightRegion === 1)
                b = 10 * b / 100;
        }
        b = Math.max(1, Math.min(100, Math.floor(b)));
        return state === "dim" ? Math.max(1, Math.floor(b / 10)) : b;
    }

    signal turnedOff()
    signal puckTimedOut()

    // Input: the screen is the user's again.
    function activity() {
        _restoreTo = "";
        _alertTimer.stop();
        if (state === "off")
            return;
        state = "on";
        _restart();
    }

    function turnOn() {
        _restoreTo = "";
        _alertTimer.stop();
        state = "on";
        _restart();
    }

    function turnOff() {
        _restoreTo = "";
        _alertTimer.stop();
        _idle.stop();
        if (state === "off")
            return;
        state = "off";
        turnedOff();
    }

    // com.palm.display setState "dimmed": only from on, unlocked and off
    // the Touchstone (DisplayOn's DisplayEventApiDim, DisplayStates.cpp:
    // 1012-1015; the other states ignore it). Held, it then stays dimmed.
    function dim() {
        if (state !== "on" || locked || onPuck || dockMode)
            return;
        _restoreTo = "";
        _alertTimer.stop();
        state = "dim";
        _restart();
    }

    // Something asks to be seen. call: until callDone(); otherwise for
    // alertTimeout.
    function alert(call) {
        if (state === "on")
            return;
        _restoreTo = state;
        state = "on";
        _idle.stop();
        if (call)
            _alertTimer.stop();
        else
            _alertTimer.restart();
    }
    function callDone() {
        if (_restoreTo !== "")
            _restore();
    }

    property string _restoreTo: ""
    function _restore() {
        var to = _restoreTo;
        _restoreTo = "";
        if (to === "off")
            turnOff();
        else if (to === "dim") {
            state = "dim";
            _restart();
        }
    }

    // When the next step comes: on to dim, dim to off, or on to off on the
    // lock screen.
    function _restart() {
        _idle.stop();
        if (state === "off" || _restoreTo !== "" || stayAwake || dockMode || held)
            return;
        if (onPuck) {
            // DisplayOnPuck, locked or not (the lock screen there is only
            // asking for the passcode): to dock mode, not off.
            _idle.interval = puckTimeout > 0 ? puckTimeout : (timeout > 0 ? timeout : 120) * 1000;
        } else if (locked) {
            _idle.interval = lockedOffTimeout;
        } else if (blocked) {
            return;
        } else {
            // Read here, not through a binding: onTimeoutChanged comes
            // before a binding on timeout would.
            var ms = (timeout > 0 ? timeout : 120) * 1000;
            _idle.interval = state === "dim" ? Math.round(ms / 3) : Math.round(ms * 2 / 3);
        }
        _idle.start();
    }

    onLockedChanged: if (state !== "off") _restart()
    onBlockedChanged: {
        if (state === "off")
            return;
        if (blocked && !locked)
            state = "on";
        _restart();
    }
    // Held: on (pushDNAST calls on(), :627-632), and on for good: an alert
    // that had turned it on (an alarm's popup comes before the Clock holds
    // the display) no longer puts it back off when its time is up. Let go,
    // the timers start again (popDNAST, :655-660).
    onHeldChanged: {
        if (held)
            turnOn();
        else if (state !== "off")
            _restart();
    }
    onTimeoutChanged: _restart()
    onStayAwakeChanged: _restart()
    onPuckTimeoutChanged: _restart()
    onOnPuckChanged: {
        // Set on the Touchstone dimmed: bright again (DisplayOnPuck::enter).
        if (onPuck && state === "dim")
            state = "on";
        if (state !== "off")
            _restart();
    }
    onDockModeChanged: {
        if (state !== "off")
            _restart();
    }

    property Timer _idle: Timer {
        onTriggered: {
            if (display.onPuck && !display.dockMode) {
                display.puckTimedOut();
                display._restart();
                return;
            }
            if (display.state === "on" && !display.locked)
                display.state = "dim";
            else
                display.turnOff();
            display._restart();
        }
    }
    property Timer _alertTimer: Timer {
        interval: display.alertTimeout
        onTriggered: display._restore()
    }

    Component.onCompleted: _restart()
}
