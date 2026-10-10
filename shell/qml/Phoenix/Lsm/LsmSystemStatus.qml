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
import WebOSCompositorBase 1.0
import WebOSServices 1.0

QtObject {
    id: status
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
    // The orientation the rotation lock holds (Shell._followRotationLock
    // sets it); a placeholder until the preference is wired.
    property string rotationLockOrientation: ""
    // Unlocked, the orientation is forgotten (Orientation_Invalid).
    onRotationLockedChanged: if (!rotationLocked) rotationLockOrientation = ""
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

    // ---- Switches and the light sensor (Phoenix.Shell DeviceServices) -----------
    // From phoenix-devices (services/devices), which reads them from evdev
    // and IIO: the ringer switch ("up" on, "down" silent; only on a device
    // whose device.json names it), a headset ("none", "headset",
    // "headset-mic") and the light's region (0 undefined: no sensor).
    // automaticBrightness and onWhenConnected are the system's preferences.
    // STATUS: the subscriptions are written against phoenix-devices' API
    // (its tests); not yet run on a device. M1 keeps the preferences in the
    // system service (enableALS; com.palm.display's onWhenConnected).
    property string ringerSwitch: "up"
    property string headset: "none"
    property int lightLevel: -1
    property int lightRegion: 0
    property bool automaticBrightness: true
    property bool onWhenConnected: false

    property var _devices: Service {
        appId: LS.appId
        onResponse: (method, payload, token) => {
            var r = null;
            try { r = JSON.parse(payload); } catch (e) { return; }
            if (!r)
                return;
            // {current, region}: a reading.
            if (typeof r.current === "number" && typeof r.region === "number") {
                status.lightLevel = r.current;
                status.lightRegion = r.region;
            }
            // {key, state}: a switch, or a headset in or out.
            if (r.key === "ringer" && (r.state === "up" || r.state === "down"))
                status.ringerSwitch = r.state;
            if (r.key === "headset" || r.key === "headset-mic") {
                if (r.state === "down")
                    status.headset = r.key;
                else if (r.state === "up" && status.headset === r.key)
                    status.headset = "none";
            }
        }
        Component.onCompleted: {
            call("luna://com.palm.keys", "/switches/status", JSON.stringify({ subscribe: true }));
            call("luna://com.palm.keys", "/headset/status", JSON.stringify({ subscribe: true }));
            call("luna://com.palm.keys", "/switches/status", JSON.stringify({ get: "ringer" }));
            call("luna://com.palm.keys", "/switches/status", JSON.stringify({ get: "headset" }));
            call("luna://com.palm.keys", "/switches/status", JSON.stringify({ get: "headset-mic" }));
            call("luna://com.palm.ambientLightSensor", "/control/status", JSON.stringify({ subscribe: true }));
        }
    }
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

    // Developer Mode (OSE's com.webos.service.devmode getDevMode: its
    // setDevMode restarts the device, so reading it at start is enough) and
    // the devModeUnlocked system preference (Just Type's Konami code).
    // STATUS: written against the services' APIs, not yet run on a device;
    // LsmWindowSource's apps do not carry appinfo.json's phoenix.developer
    // yet (SAM's launch points have no such field), so every app shows.
    property bool devMode: false
    property bool devModeUnlocked: false
    property var _developer: Service {
        appId: LS.appId
        onResponse: (method, payload, token) => {
            var r = null;
            try { r = JSON.parse(payload); } catch (e) { return; }
            if (!r)
                return;
            if (r.status === "enabled" || r.status === "disabled")
                status.devMode = r.status === "enabled";
            if (r.devModeUnlocked !== undefined)
                status.devModeUnlocked = r.devModeUnlocked === true;
        }
        Component.onCompleted: {
            call("luna://com.webos.service.devmode", "/getDevMode", JSON.stringify({}));
            call("luna://com.webos.service.systemservice", "/getPreferences",
                 JSON.stringify({ keys: ["devModeUnlocked"], subscribe: true }));
        }
    }

    // Settings > Advanced (Shell.tweak(); SimSystemStatus.tweaks documents
    // them). STATUS: placeholder, the defaults (the start-up animation
    // "phoenix", animation speed "normal"). They must be known before the
    // boot animation's first frame: M1 reads the system service's
    // preferences (startupAnimation, animationSpeed, ...) synchronously as
    // the compositor starts, as LunaSysMgr read its preferences at start
    // (Preferences::instance), rather than from getPreferences' first reply.
    // PhoenixViewsRoot does not start the boot animation yet (bootAnimation
    // is false on a device).
    property var tweaks: ({})

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
