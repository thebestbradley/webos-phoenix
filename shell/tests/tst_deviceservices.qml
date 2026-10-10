// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shell's side of LunaSysMgr's device services (DeviceServices.qml,
// Display.qml): com.palm.display (held on, setState, the Power key),
// com.palm.keys (keys, the headset button's clicks, the ringer and headset
// switches), com.palm.vibrate (the counter and the cue) and the light
// sensor (regions, automatic brightness). Against a recording source, and
// through the shell with phoenix-sim's window source.
// Run: qmltestrunner -import qml -import build/qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    // ---- On their own, with a recording source ----------------------------------

    QtObject {
        id: fakeSource
        property var events: []
        property var displayHolds: ({ requestBlock: 0, powerKeyBlock: 0, proximity: 0, alsDisabled: 0 })
        property var motor: []
        signal displayStateRequested(string state)
        signal vibrationRequested(var request)
        function deviceEvent(ev) { events.push(ev); }
        function vibrate(request) { motor.push(request); }
        function keys() { return events.filter(function (e) { return !!e.key; }).map(function (e) { return e.key; }); }
    }
    QtObject {
        id: fakeSystem
        property real brightness: 0.8
        property bool automaticBrightness: true
        property bool onWhenConnected: false
        property string charger: "none"
        property int lightLevel: 300
        property string ringerSwitch: "up"
        property string headset: "none"
        property bool muted: false
    }
    SystemSounds { id: sounds }
    // Before the Display that binds to it: declared after, the Display's
    // held would read its holdsDisplay while that is still being set up
    // (source not yet assigned), which Qt reports as a binding loop.
    DeviceServices {
        id: devices
        source: fakeSource
        system: fakeSystem
        display: display
        sounds: sounds
    }

    Display {
        id: display
        timeout: 1
        lockedOffTimeout: 200
        held: devices.holdsDisplay
        maximumBrightness: Math.round(fakeSystem.brightness * 100)
        automaticBrightness: fakeSystem.automaticBrightness
        lightRegion: devices.lightRegion
    }
    // ---- Through the shell -------------------------------------------------------

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: status }
    }

    TestCase {
        name: "DeviceServices"
        when: windowShown

        function init() {
            fakeSource.events = [];
            fakeSource.motor = [];
            fakeSource.displayHolds = { requestBlock: 0, powerKeyBlock: 0, proximity: 0, alsDisabled: 0 };
            fakeSystem.lightLevel = 300;
            fakeSystem.automaticBrightness = true;
            fakeSystem.onWhenConnected = false;
            fakeSystem.charger = "none";
            display.locked = false;
            display.timeout = 1;
            display.turnOn();
            shell.unlock();
            shell.display.turnOn();
            shell.forceActiveFocus();
        }

        // ---- com.palm.display -------------------------------------------------

        function test_heldOnEvenLocked() {
            display.locked = true;
            display.turnOff();
            fakeSource.displayHolds = { requestBlock: 1, powerKeyBlock: 0, proximity: 0, alsDisabled: 0 };
            verify(display.held);
            compare(display.state, "on", "pushDNAST turns it on");
            wait(400);
            compare(display.state, "on", "and the lock screen's 5 s do not run");
            fakeSource.displayHolds = { requestBlock: 0, powerKeyBlock: 0, proximity: 0, alsDisabled: 0 };
            tryCompare(display, "state", "off", 500);
        }

        function test_heldAfterAnAlert() {
            // An alarm: its popup alert turns the screen on first, then the
            // Clock holds it; the alert's time running out must not turn it off.
            display.alertTimeout = 150;
            display.locked = true;
            display.turnOff();
            display.alert(false);
            compare(display.state, "on");
            fakeSource.displayHolds = { requestBlock: 1, powerKeyBlock: 0, proximity: 0, alsDisabled: 0 };
            wait(450);
            compare(display.state, "on", "held: on past the alert's time and the lock screen's");
            fakeSource.displayHolds = { requestBlock: 0, powerKeyBlock: 0, proximity: 0, alsDisabled: 0 };
            tryCompare(display, "state", "off", 500);
            display.alertTimeout = 6000;
        }

        function test_heldWhileAUsbChargerIsIn() {
            fakeSystem.onWhenConnected = true;
            verify(!devices.holdsDisplay);
            fakeSystem.charger = "wall";
            verify(devices.holdsDisplay);
            fakeSystem.charger = "inductive";
            verify(!devices.holdsDisplay, "the Touchstone is not USB");
        }

        function test_reportsTheDisplay() {
            fakeSource.events = [];
            display.timeout = 30;
            var last = fakeSource.events.filter(function (e) { return !!e.display; }).pop();
            compare(last.display.timeout, 30);
            compare(last.display.state, "on");
            display.dim();
            last = fakeSource.events.filter(function (e) { return !!e.display; }).pop();
            compare(last.display.state, "dimmed");
            display.turnOff();
            last = fakeSource.events.filter(function (e) { return !!e.display; }).pop();
            compare(last.display.state, "off");
        }

        function test_setState() {
            fakeSource.displayStateRequested("dimmed");
            compare(display.state, "dim");
            fakeSource.displayStateRequested("on");
            compare(display.state, "on");
            fakeSource.displayStateRequested("off");
            compare(display.state, "off");
            fakeSource.displayStateRequested("dimmed");
            compare(display.state, "off", "not from off");
            fakeSource.displayStateRequested("on");
            display.locked = true;
            fakeSource.displayStateRequested("dimmed");
            compare(display.state, "on", "not on the lock screen");
        }

        function test_brightnessFollowsTheLight() {
            compare(devices.lightRegion, 3);
            compare(display.brightness, 80);
            fakeSystem.lightLevel = 50;
            compare(devices.lightRegion, 2);
            compare(display.brightness, 24);
            fakeSystem.lightLevel = 1;
            compare(devices.lightRegion, 1);
            compare(display.brightness, 8);
            fakeSystem.lightLevel = 20000;
            compare(devices.lightRegion, 4);
            compare(display.brightness, 100);
            fakeSystem.automaticBrightness = false;
            compare(display.brightness, 80);
            fakeSystem.automaticBrightness = true;
            fakeSystem.lightLevel = 300;
            display.dim();
            compare(display.brightness, 8, "dimmed: a tenth");
            display.turnOff();
            compare(display.brightness, 0);
            var light = fakeSource.events.filter(function (e) { return !!e.light; }).pop();
            compare(light.light.current, 300);
            compare(light.light.region, 3);
        }

        function test_regionsHaveMargins() {
            // AmbientLightSensor's borders 6/100/1000 lux, margins 4/10/100.
            compare(devices.regionFor(95, 3), 3, "indoor until under 90");
            compare(devices.regionFor(89, 3), 2);
            compare(devices.regionFor(105, 2), 2, "dim until over 110");
            compare(devices.regionFor(111, 2), 3);
            compare(devices.regionFor(2, 2), 2);
            compare(devices.regionFor(1, 2), 1);
            compare(devices.regionFor(1100, 3), 3);
            compare(devices.regionFor(1101, 3), 4);
            compare(devices.regionFor(-1, 3), 0, "no sensor");
            compare(devices.regionFor(5, 0), 2, "it starts indoor");
        }

        function test_anAppHoldsTheSensorOff() {
            fakeSystem.lightLevel = 1;
            compare(devices.lightRegion, 1);
            fakeSource.displayHolds = { requestBlock: 0, powerKeyBlock: 0, proximity: 0, alsDisabled: 1 };
            compare(devices.lightRegion, 0);
            compare(display.brightness, 80, "undefined: the user's brightness");
        }

        // ---- com.palm.keys ------------------------------------------------------

        function test_keysByCategory() {
            devices.hardwareKey(Qt.Key_VolumeUp, true);
            devices.hardwareKey(Qt.Key_VolumeUp, false);
            devices.hardwareKey(Qt.Key_F10, true);
            devices.hardwareKey(Qt.Key_F3, true);
            devices.hardwareKey(Qt.Key_MediaNext, true);
            devices.hardwareKey(Qt.Key_A, true);
            compare(JSON.stringify(fakeSource.keys()), JSON.stringify([
                { category: "/audio", key: "volume_up", state: "down" },
                { category: "/audio", key: "volume_up", state: "up" },
                { category: "/audio", key: "volume_down", state: "down" },
                { category: "/switches", key: "power", state: "down" },
                { category: "/media", key: "next", state: "down" }]));
        }

        function headsetStates() {
            return fakeSource.keys().filter(function (k) { return k.key === "headset_button"; })
                                    .map(function (k) { return k.state; });
        }

        function test_headsetButtonClicks() {
            devices.headsetButton(true);
            devices.headsetButton(false);
            compare(JSON.stringify(headsetStates()), JSON.stringify(["down", "single_click", "up"]));
            devices.headsetButton(true);
            devices.headsetButton(false);
            compare(JSON.stringify(headsetStates()), JSON.stringify(["down", "single_click", "up", "down", "double_click", "up"]));
        }

        function test_headsetButtonHeld() {
            devices.headsetButton(true);
            tryVerify(function () { return headsetStates().indexOf("hold") >= 0; }, 3000);
            devices.headsetButton(false);
            compare(JSON.stringify(headsetStates()), JSON.stringify(["down", "hold", "up"]));
            // Back at the start: the next press is a click again.
            devices.headsetButton(true);
            devices.headsetButton(false);
            compare(JSON.stringify(headsetStates().slice(-3)), JSON.stringify(["down", "single_click", "up"]));
            wait(devices.doublePressTime + 50);
        }

        function test_ringerSwitchMutes() {
            fakeSystem.ringerSwitch = "down";
            verify(fakeSystem.muted);
            compare(JSON.stringify(fakeSource.keys().pop()), JSON.stringify({ category: "/switches", key: "ringer", state: "down" }));
            fakeSystem.ringerSwitch = "up";
            verify(!fakeSystem.muted);
        }

        // The system menu's Mute Sound sends the ringer key, down when
        // muted and up when not (SystemMenu::slotMuteSoundChanged,
        // SystemMenu.cpp:900-915): com.palm.keys reports the ringer off.
        // The switch muting the system does not send it twice.
        function test_muteSendsTheRingerKey() {
            var n = fakeSource.keys().length;
            fakeSystem.muted = true;
            compare(devices.ringerState, "down");
            compare(fakeSource.keys().length, n + 1);
            compare(JSON.stringify(fakeSource.keys().pop()), JSON.stringify({ category: "/switches", key: "ringer", state: "down" }));
            fakeSystem.muted = false;
            compare(devices.ringerState, "up");
            compare(JSON.stringify(fakeSource.keys().pop()), JSON.stringify({ category: "/switches", key: "ringer", state: "up" }));
            n = fakeSource.keys().length;
            fakeSystem.ringerSwitch = "down";
            verify(fakeSystem.muted);
            compare(fakeSource.keys().length, n + 1, "one ringer key for the switch");
            fakeSystem.ringerSwitch = "up";
            verify(!fakeSystem.muted);
            compare(fakeSource.keys().length, n + 2);
        }

        function test_headsetInAndOut() {
            fakeSystem.headset = "headset-mic";
            compare(JSON.stringify(fakeSource.keys().pop()), JSON.stringify({ category: "/headset", key: "headset-mic", state: "down" }));
            fakeSystem.headset = "none";
            compare(JSON.stringify(fakeSource.keys().pop()), JSON.stringify({ category: "/headset", key: "headset-mic", state: "up" }));
        }

        // ---- com.palm.vibrate ---------------------------------------------------

        function test_vibrationsAreCountedAndShown() {
            var n = sounds.vibrations;
            fakeSource.vibrationRequested({ id: "a:1", on: true, name: "notification" });
            compare(sounds.vibrations, n + 1);
            verify(devices.vibrating);
            compare(devices.vibration, "notification");
            compare(fakeSource.motor.length, 1, "the motor runs");
            tryCompare(devices, "vibrating", false, 1000);
            // Until cancelled.
            fakeSource.vibrationRequested({ id: "a:2", on: true, period: 250, duration: 0 });
            wait(400);
            verify(devices.vibrating);
            fakeSource.vibrationRequested({ id: "a:2", on: false });
            verify(!devices.vibrating);
            // A banner's "vibrate" is one too (SystemService::vibrate).
            sounds.notification("com.palm.app.email", "vibrate", "", 0, false);
            compare(sounds.vibrations, n + 3);
            compare(devices.vibration, "notification");
        }

        // ---- Through the shell and phoenix-sim's window source -------------------

        function test_pagesHoldTheShellsDisplay() {
            windows._deviceMessage("p-test", "com.palm.app.clock", "displayHolds", { requestBlock: 1, powerKeyBlock: 0, proximity: 0, alsDisabled: 0 });
            compare(windows.displayHolds.requestBlock, 1);
            verify(shell.display.held);
            shell.lock();
            compare(shell.display.state, "on");
            windows._pageGone("p-test");
            compare(windows.displayHolds.requestBlock, 0);
            verify(!shell.display.held);
        }

        function test_setStateFromAPage() {
            windows._deviceMessage("p-test", "com.palm.app.clock", "displayState", { state: "off" });
            compare(shell.display.state, "off");
            verify(shell.locked, "off locks");
            windows._deviceMessage("p-test", "com.palm.app.clock", "displayState", { state: "unlock" });
            compare(shell.display.state, "on");
        }

        function test_blockedPowerKey() {
            windows._deviceMessage("p-test", "com.palm.app.phone", "displayHolds", { requestBlock: 0, powerKeyBlock: 1, proximity: 0, alsDisabled: 0 });
            verify(shell.deviceServices.powerKeyBlocked);
            keyPress(Qt.Key_F3);
            keyRelease(Qt.Key_F3);
            compare(shell.display.state, "on", "Power went to the app");
            windows._pageGone("p-test");
            keyPress(Qt.Key_F3);
            keyRelease(Qt.Key_F3);
            compare(shell.display.state, "off");
            shell.display.turnOn();
        }

        function test_keysAndSwitchesReachLaterPages() {
            status.ringerSwitch = "down";
            verify(status.muted);
            compare(windows._deviceState.switches.ringer, "down");
            status.headset = "headset-mic";
            compare(windows._deviceState.switches["headset-mic"], "down");
            status.headset = "none";
            status.ringerSwitch = "up";
            verify(!status.muted);
            compare(windows._deviceState.switches.ringer, "up");
            compare(windows._deviceState.display.state, "on");
        }

        function test_aPageGoneStopsItsVibration() {
            var n = shell.sounds.vibrations;
            windows._deviceMessage("p-test", "com.palm.app.clock", "vibrate", { id: "c:1", on: true, name: "ringtone", continous: true });
            compare(shell.sounds.vibrations, n + 1);
            verify(shell.deviceServices.vibrating);
            windows._pageGone("p-test");
            verify(!shell.deviceServices.vibrating);
        }
    }
}
