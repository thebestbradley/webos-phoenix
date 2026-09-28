// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fake device status for the simulator. On a device the same properties are
// fed from webOS OSE Luna services (battery, connection manager, etc.).
//
// In the simulator the web apps' simulated services own the radios,
// brightness and so on (runtime/phoenix-runtime.js): Settings changes
// arrive through applyAppStatus(), and changes made here (system menu)
// go back to the pages as appStatus() keys (see sim.qml).

import QtQuick

QtObject {
    property string carrier: "Phoenix"
    property int batteryPercent: 76
    property bool charging: false
    property int wifiBars: 3          // 0..3, -1 = off
    property int signalBars: 5        // 0..5, -1 = no modem
    property bool airplaneMode: false
    property bool bluetoothOn: false
    property bool rotationLocked: false
    property bool muted: false
    property real brightness: 0.7
    // Fixed time for reproducible screenshots; null = live clock.
    property var fixedTime: null

    // True while applying a state the apps reported, so it is not sent back.
    property bool applyingAppStatus: false

    // Apply a "systemStatus" report from the web runtime: wifiEnabled,
    // wifiConnected, wifiBars, bluetoothOn, airplaneMode, brightness
    // (0-100), rotationLocked, muted. Missing keys are left alone.
    function applyAppStatus(s) {
        applyingAppStatus = true;
        if (s.wifiEnabled !== undefined)
            wifiBars = !s.wifiEnabled ? -1 : !s.wifiConnected ? 0 : Math.max(1, Math.min(3, s.wifiBars || 3));
        if (s.airplaneMode !== undefined)
            airplaneMode = !!s.airplaneMode;
        if (s.bluetoothOn !== undefined)
            bluetoothOn = !!s.bluetoothOn;
        if (s.brightness !== undefined)
            brightness = Math.max(0.05, Math.min(1, s.brightness / 100));
        if (s.rotationLocked !== undefined)
            rotationLocked = !!s.rotationLocked;
        if (s.muted !== undefined)
            muted = !!s.muted;
        applyingAppStatus = false;
    }

    // One property in the runtime's terms, for pushing a change to the apps.
    function appStatusFor(name) {
        switch (name) {
        case "wifiBars": return { wifiEnabled: wifiBars >= 0 };
        case "airplaneMode": return { airplaneMode: airplaneMode };
        case "bluetoothOn": return { bluetoothOn: bluetoothOn };
        case "brightness": return { brightness: Math.round(brightness * 100) };
        case "rotationLocked": return { rotationLocked: rotationLocked };
        case "muted": return { muted: muted };
        }
        return {};
    }
}
