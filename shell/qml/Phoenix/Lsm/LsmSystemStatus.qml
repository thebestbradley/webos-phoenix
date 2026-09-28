// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Device status for the status bar and system menu. Same properties and
// functions as Phoenix.Sim.SimSystemStatus, which documents them.
//
// STATUS: placeholder values. M1 wires these to OSE Luna services
// (com.webos.service.connectionmanager, com.webos.service.bluetooth2,
// com.webos.service.battery where the device provides it, and the
// settings service's time format for twentyFourHour and its
// showAlertsWhenLocked preference). The system menu's lists
// (wifiNetworks, bluetoothDevices, vpnProfiles) and the functions its
// drawers call (setWifiOn, scanWifi, connectWifi, setBluetoothOn,
// connectBluetooth, connectVpn) are placeholders too: the lists stay
// empty and the functions only flip the radio properties.

import QtQuick

QtObject {
    property string carrier: "webOS Phoenix"
    property int batteryPercent: 100
    property bool charging: true
    property int wifiBars: -1
    property int signalBars: -1
    property bool airplaneMode: false
    property bool airplaneModeInProgress: false
    property bool bluetoothOn: false
    property bool bluetoothTurningOn: false
    property bool rotationLocked: false
    // The accelerometer's orientation ("up", "down", "left", "right",
    // "faceup", "facedown"), which the shell's UI follows (UiRotation).
    // STATUS: placeholder, always "up". M1 feeds it from the device's
    // orientation sensor (OSE's sensor service, or Qt Sensors'
    // QOrientationSensor where the device provides one).
    property string deviceOrientation: "up"
    property bool muted: false
    property bool twentyFourHour: false
    property bool showAlertsWhenLocked: true
    property real brightness: 1.0
    property var fixedTime: null

    property var wifiNetworks: []
    property bool wifiScanning: false
    property var bluetoothDevices: []
    property var vpnProfiles: []
    readonly property string wifiSsid: ""
    readonly property string bluetoothDevice: ""
    readonly property string vpnProfile: ""

    function setWifiOn(on) { wifiBars = on ? 0 : -1; }
    function scanWifi() {}
    function connectWifi(ssid) {}
    function setBluetoothOn(on) { bluetoothOn = on; }
    function connectBluetooth(address) {}
    function connectVpn(name) {}
}
