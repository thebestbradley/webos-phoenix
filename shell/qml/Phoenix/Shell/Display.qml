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
// - A banner, a popup alert or a call turns it on (alert, :2920-2989): a
//   banner or an alert for 6 s (ALERT_TIMEOUT), a call while it rings; then
//   it goes back to how it was, unless the user touched it meanwhile.
// - Off, the shell locks (turnedOff).
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
    // Never dims or turns off by itself (phoenix-sim --stay-awake, and its
    // screenshots); Power still turns it off.
    property bool stayAwake: false
    property int lockedOffTimeout: 5000
    property int alertTimeout: 6000

    signal turnedOff()

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
        if (state === "off" || _restoreTo !== "" || stayAwake)
            return;
        if (locked) {
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
    onTimeoutChanged: _restart()
    onStayAwakeChanged: _restart()

    property Timer _idle: Timer {
        onTriggered: {
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
