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
    // Unconditional call forwarding on, for the status bar's icon.
    // STATUS: placeholder; M1 subscribes to com.palm.telephony forwardQuery
    // {condition: "unconditional", subscribe: true}, as LunaSysMgr's
    // StatusBarServicesConnector::requestCallForwardStatus did.
    property bool callForwarding: false
    // System sounds (SystemSounds.qml): volumes 0..100, "System Sounds",
    // the keyboard's clicks and the tones.
    // STATUS: placeholders; M1 reads them from com.webos.service.audio
    // (master/getVolume, getInputVolume; the system menu's volume slider
    // sets `volume`, which M1 sends as master/setVolume) and the system service's
    // preferences (systemSounds, x_palm_virtualkeyboard_prefs, ringtone,
    // alerttone, notificationtone).
    property int volume: 100
    property var streams: ({ pringtones: 100, palerts: 100, pfeedback: 100 })
    property bool systemSounds: true
    property bool tapSounds: true
    property string ringtone: "/usr/palm/sounds/ringtone.mp3"
    property string alerttone: "/usr/palm/sounds/alert.wav"
    property string notificationtone: "/usr/palm/sounds/notification.wav"
    property bool twentyFourHour: false
    property bool showAlertsWhenLocked: true
    property real brightness: 1.0
    property var fixedTime: null
    // The charger, and the Touchstone's serial number while on one (dock
    // mode). STATUS: placeholders; M1 reads powerd's chargerStatus /
    // USBDockStatus (DockConnected with DockPower, DockSerialNo) or the
    // device's charger driver.
    property string charger: "none"
    property string puckId: ""
    readonly property bool onPuck: charger === "inductive"
    // Settings > Exhibition. STATUS: the defaults; M1 reads the system
    // service's preferences (exhibition, dockModeSoundPref, dockwallpaper)
    // and the application manager's exhibitions (listDockModeLaunchPoints).
    property bool exhibitionEnabled: true
    property int exhibitionStartAfter: 0
    property var exhibitionApps: ["org.webosphoenix.photos"]
    property string dockModeSound: "systemsettings"
    property bool exhibitionNightMode: false
    property string exhibitionNightStart: "22:00"
    property string exhibitionNightEnd: "07:00"
    property url dockWallpaper: ""

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
