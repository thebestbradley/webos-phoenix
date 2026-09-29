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
//
// The system menu's drawers (Phoenix.Shell.SystemMenu) read the lists
// below and call the functions after them, which stand in for what
// luna-sysmgr's SystemMenu.cpp asked the connection manager, the
// Bluetooth service and the VPN service for (StatusBarServicesConnector:
// findnetworks, connect, setstate, trusted devices, VPN profiles). Here
// they answer after a short delay, as a radio would, so the menu's
// "Turning on…" and "Connecting…" states and its spinner can be seen.

import QtQuick

QtObject {
    id: status

    property string carrier: "Phoenix"
    property int batteryPercent: 76
    property bool charging: false
    property int wifiBars: 3          // 0..3 connected, 0 = on but not connected, -1 = off
    property int signalBars: 5        // 0..5, -1 = no modem
    property bool airplaneMode: false
    // Airplane mode is being switched (the radios take a moment): the menu
    // shows "Turning on/off Airplane Mode" and its radio drawers are
    // unavailable (SystemMenu.cpp:64-69, SystemMenu.qml:68-78). The
    // simulator switches at once, so it stays false.
    property bool airplaneModeInProgress: false
    property bool bluetoothOn: false
    // The Bluetooth radio is coming up ("Turning on Bluetooth...").
    property bool bluetoothTurningOn: false
    property bool rotationLocked: false
    // How the simulated device is held: "up", "down", "left" (turned
    // counter-clockwise) or "right" (phoenix-sim --orientation, Ctrl+Left /
    // Ctrl+Right). The shell turns the UI to follow (UiRotation).
    property string deviceOrientation: "up"
    property bool muted: false
    // The clock's format (system preference timeFormat "HH24").
    property bool twentyFourHour: false
    // Settings > Screen & Lock "Show notifications when locked"
    // (system preference showAlertsWhenLocked).
    property bool showAlertsWhenLocked: true
    // Settings > Accessibility "Reduce motion" (system preference
    // accessibility.reduceMotion): the shell's animations (Theme.reduceMotion).
    property bool reduceMotion: false
    property real brightness: 0.7     // 0.10 (the floor, Theme.minimumBrightness) .. 1
    // Fixed time for reproducible screenshots; null = live clock.
    property var fixedTime: null

    // ---- System menu lists --------------------------------------------------

    // Wi-Fi networks in range, strongest first (connection manager
    // findnetworks). ssid; bars 0-3; security "" (open) or e.g. "psk",
    // "wep"; known: a profile is stored, so it joins without asking;
    // state: "" | "connecting" | "ipConfigured" (connected) | "ipFailed" |
    // "associationFailed" (the connection manager's connectState).
    property var wifiNetworks: [
        { ssid: "Phoenix", bars: 3, security: "psk", known: true, state: "ipConfigured" },
        { ssid: "Palm Guest", bars: 2, security: "", known: false, state: "" },
        { ssid: "Sunnyvale Cafe", bars: 1, security: "wep", known: false, state: "" }
    ]
    // A scan for networks is running (the Wi-Fi drawer's spinner).
    property bool wifiScanning: false
    // Paired ("trusted") Bluetooth devices: name, address, state
    // "disconnected" | "connecting" | "connected" | "connectfailed".
    property var bluetoothDevices: [
        { name: "Palm Stereo Headset", address: "00:1d:fe:00:00:01", state: "disconnected" },
        { name: "Car Kit", address: "00:1d:fe:00:00:02", state: "disconnected" }
    ]
    // VPN profiles: name, state "disconnected" | "connecting" | "connected"
    // | "connectfailed".
    property var vpnProfiles: [
        { name: "Office", state: "disconnected" }
    ]

    // The network, device and profile in use ("" for none): the drawers'
    // headers show them (SystemMenu.cpp:397-412, 568-610, 776-800).
    readonly property string wifiSsid: _named(wifiNetworks, "ssid", "ipConfigured")
    readonly property string bluetoothDevice: _named(bluetoothDevices, "name", "connected")
    readonly property string vpnProfile: _named(vpnProfiles, "name", "connected")

    // Turn the Wi-Fi radio on or off. On, it looks for networks and joins a
    // known one.
    function setWifiOn(on) {
        if (on === (wifiBars >= 0))
            return;
        if (!on) {
            wifiBars = -1;
            return;
        }
        wifiBars = 0;
        scanWifi();
        _later(_scanTime, function() {
            for (var i = 0; i < wifiNetworks.length; ++i)
                if (wifiNetworks[i].known)
                    return connectWifi(wifiNetworks[i].ssid);
        });
    }

    // Look for networks (the list is already here; the scan only takes time).
    function scanWifi() {
        if (wifiBars < 0)
            return;
        var scan = ++_scans;
        wifiScanning = true;
        _later(_scanTime, function() {
            if (scan === _scans)
                wifiScanning = false;
        });
    }

    // Join a network: it is known from then on.
    function connectWifi(ssid) {
        if (wifiBars < 0)
            return;
        wifiBars = 0;
        wifiNetworks = wifiNetworks.map(function(n) {
            return _with(n, { state: n.ssid === ssid ? "connecting" : "" });
        });
        _later(_connectTime, function() {
            if (wifiBars < 0)
                return;
            var bars = 0;
            wifiNetworks = wifiNetworks.map(function(n) {
                if (n.ssid !== ssid || n.state !== "connecting")
                    return n;
                bars = n.bars;
                return _with(n, { state: "ipConfigured", known: true });
            });
            if (bars > 0 || _named(wifiNetworks, "ssid", "ipConfigured") !== "")
                wifiBars = Math.max(1, bars);
        });
    }

    // Turn Bluetooth on (it takes a moment) or off.
    function setBluetoothOn(on) {
        if (!on) {
            bluetoothTurningOn = false;
            bluetoothOn = false;
            return;
        }
        if (bluetoothOn || bluetoothTurningOn)
            return;
        bluetoothTurningOn = true;
        _later(_connectTime, function() {
            if (!bluetoothTurningOn)
                return;
            bluetoothTurningOn = false;
            bluetoothOn = true;
        });
    }

    // Connect a paired device, or disconnect it when it is connected. One
    // device at a time, as the menu connected audio devices
    // (SystemMenu.cpp:490-567).
    function connectBluetooth(address) {
        bluetoothDevices = _toggle(bluetoothDevices, "address", address, function() { return bluetoothOn; },
                                   function(v) { bluetoothDevices = v; });
    }

    // Connect a VPN profile, or disconnect it when it is connected.
    function connectVpn(name) {
        vpnProfiles = _toggle(vpnProfiles, "name", name, function() { return true; },
                              function(v) { vpnProfiles = v; });
    }

    // Leaving Wi-Fi on without a network, or turning it off, drops the
    // connection; a connection made elsewhere (Settings) is the first known
    // network.
    onWifiBarsChanged: {
        if (wifiBars <= 0) {
            var drop = wifiBars < 0 ? ["ipConfigured", "connecting"] : ["ipConfigured"];
            if (wifiNetworks.some(function(n) { return drop.indexOf(n.state) >= 0; }))
                wifiNetworks = wifiNetworks.map(function(n) {
                    return drop.indexOf(n.state) >= 0 ? _with(n, { state: "" }) : n;
                });
            if (wifiBars < 0)
                wifiScanning = false;
        } else if (_named(wifiNetworks, "ssid", "ipConfigured") === "") {
            var done = false;
            wifiNetworks = wifiNetworks.map(function(n) {
                if (done || !n.known)
                    return n;
                done = true;
                return _with(n, { state: "ipConfigured" });
            });
        }
    }
    onBluetoothOnChanged: {
        if (!bluetoothOn)
            bluetoothDevices = bluetoothDevices.map(function(d) { return _with(d, { state: "disconnected" }); });
    }

    // True while applying a state the apps reported, so it is not sent back.
    property bool applyingAppStatus: false

    // Apply a "systemStatus" report from the web runtime: wifiEnabled,
    // wifiConnected, wifiBars, bluetoothOn, airplaneMode, brightness
    // (0-100), rotationLocked, muted, timeFormat, showAlertsWhenLocked,
    // reduceMotion.
    // Missing keys are left alone.
    function applyAppStatus(s) {
        applyingAppStatus = true;
        if (s.wifiEnabled !== undefined)
            wifiBars = !s.wifiEnabled ? -1 : !s.wifiConnected ? 0 : Math.max(1, Math.min(3, s.wifiBars || 3));
        if (s.airplaneMode !== undefined)
            airplaneMode = !!s.airplaneMode;
        if (s.bluetoothOn !== undefined) {
            bluetoothTurningOn = false;
            bluetoothOn = !!s.bluetoothOn;
        }
        if (s.brightness !== undefined)
            brightness = Math.max(0.10, Math.min(1, s.brightness / 100));
        if (s.rotationLocked !== undefined)
            rotationLocked = !!s.rotationLocked;
        if (s.muted !== undefined)
            muted = !!s.muted;
        if (s.timeFormat !== undefined)
            twentyFourHour = s.timeFormat === "HH24";
        if (s.showAlertsWhenLocked !== undefined)
            showAlertsWhenLocked = !!s.showAlertsWhenLocked;
        if (s.reduceMotion !== undefined)
            reduceMotion = !!s.reduceMotion;
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

    // ---- Helpers ------------------------------------------------------------

    // How long the simulated radios take.
    property int _scanTime: 1000
    property int _connectTime: 1500
    property int _scans: 0

    function _named(list, key, state) {
        for (var i = 0; list && i < list.length; ++i)
            if (list[i].state === state)
                return list[i][key];
        return "";
    }

    function _with(o, changes) {
        var r = {};
        for (var k in o)
            r[k] = o[k];
        for (k in changes)
            r[k] = changes[k];
        return r;
    }

    // Disconnect `id` if connected; otherwise connect it (and drop the
    // others), connected after a moment. Returns the new list; `set`
    // stores the later one.
    function _toggle(list, key, id, allowed, set) {
        var target = null;
        for (var i = 0; i < list.length; ++i)
            if (list[i][key] === id)
                target = list[i];
        if (!target || !allowed())
            return list;
        if (target.state === "connected")
            return list.map(function(e) { return e[key] === id ? _with(e, { state: "disconnected" }) : e; });
        var owner = status;
        _later(_connectTime, function() {
            var now = key === "address" ? owner.bluetoothDevices : owner.vpnProfiles;
            set(now.map(function(e) {
                return e[key] === id && e.state === "connecting" ? _with(e, { state: "connected" }) : e;
            }));
        });
        return list.map(function(e) {
            return _with(e, { state: e[key] === id ? "connecting" : "disconnected" });
        });
    }

    property Component _timer: Component { Timer {} }
    function _later(ms, fn) {
        var t = _timer.createObject(status, { interval: ms });
        t.triggered.connect(function() { fn(); t.destroy(); });
        t.start();
    }
}
