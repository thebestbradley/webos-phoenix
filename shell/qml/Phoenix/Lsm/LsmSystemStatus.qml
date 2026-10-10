// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Device status for the status bar and system menu. Same properties and
// functions as Phoenix.Sim.SimSystemStatus, which documents them, read from
// webOS OSE's services (LsmStatus.js reads their replies; cited there):
//
//   com.webos.service.wifi          Wi-Fi: getstatus, findnetworks, connect,
//                                   setstate (webos-connman-adapter)
//   com.webos.service.bluetooth2    adapter/getStatus, adapter/setState,
//                                   device/getStatus, a2dp/connect, a2dp/disconnect
//   com.webos.service.vpn           getProfileList, connect, disconnect
//                                   (LuneOS's luneos-vpn-adapter; OSE has none)
//   com.palm.telephony, com.palm.wan  a modem's (OSE has none): TTY, HAC,
//                                   roaming, call forwarding, mobile data
//   com.webos.service.audio         master/getVolume, master/setVolume
//   com.webos.service.systemservice the preferences: the tones, system and
//                                   keyboard sounds, the time format, alerts
//                                   when locked, airplane mode, the rotation
//                                   lock, Settings > Advanced (the tweaks)
//   com.palm.display (phoenix-devices) the orientation sensor; com.palm.keys
//                                   and com.palm.ambientLightSensor, the
//                                   switches and the light
//
// A service a device does not have never answers, and what it would give
// keeps its default (no modem: no WAN, TTY, HAC or roaming icon). Brightness
// and the exhibitions are still placeholders (M1).
//
// STATUS: written against the services' sources and their replies
// (tst_lsmstatus drives LsmStatus.js with them); not yet run on a device.

import QtQuick
import WebOSCompositorBase 1.0
import WebOSServices 1.0
import "LsmStatus.js" as LsmStatus

QtObject {
    id: status
    property string carrier: "webOS Phoenix"
    // powerd's (com.palm.power: phoenix-devices over the kernel's power
    // supplies): batteryStatusQuery, then its batteryStatus and USBDockStatus
    // signals (_power below). Until it answers: full, on mains (a device
    // without a battery, as QEMU, stays so).
    property int batteryPercent: 100
    property bool charging: true
    // -1 off, 0 on without a network, 1-3 connected (com.webos.service.wifi).
    property int wifiBars: -1
    // -1: no modem (OSE has no telephony service; a modem's would set it).
    property int signalBars: -1
    // The airplaneMode preference; turning it on turns the Wi-Fi and
    // Bluetooth radios off, as StatusBarServicesConnector::setAirplaneMode
    // did (:306-383), and back on as they were.
    property bool airplaneMode: false
    property bool airplaneModeInProgress: false
    property bool bluetoothOn: false
    property bool bluetoothTurningOn: false
    // The rotation lock, kept in the rotationLock preference with the
    // orientation it holds (as LunaSysMgr's Preferences.cpp:196-201 kept
    // it; LsmStatus.rotationLock), read before the first frame from the
    // start-up preferences, so the UI comes up locked that way.
    property bool rotationLocked: false
    property string rotationLockOrientation: ""
    // Unlocked, the orientation is forgotten (Orientation_Invalid).
    onRotationLockedChanged: {
        if (!rotationLocked)
            rotationLockOrientation = "";
        _saveRotationLock();
    }
    onRotationLockOrientationChanged: _saveRotationLock()
    // The accelerometer's orientation ("up", "down", "left", "right",
    // "faceup", "facedown"), which the shell's UI follows (UiRotation):
    // phoenix-devices reads the IIO accelerometer (com.palm.display/phoenix/
    // orientation; services/devices). "up" on a device without one.
    property string deviceOrientation: "up"
    // "Mute Sound" (the muteSound preference; the ringer).
    property bool muted: false
    onMutedChanged: _savePref("muteSound", muted)
    // Unconditional call forwarding on (com.palm.telephony forwardQuery
    // {condition: "unconditional", subscribe: true}, as LunaSysMgr's
    // StatusBarServicesConnector::requestCallForwardStatus did, :1956-2050).
    property bool callForwarding: false
    // A modem's indicators (SimSystemStatus documents them): from
    // com.palm.wan and com.palm.telephony where the device has them.
    property string wanType: ""
    property bool wanDormant: false
    property bool roaming: false
    property bool tty: false
    property bool hac: false
    property bool show3GForEvdo: false
    // System sounds (SystemSounds.qml): the master volume (audiod's; the
    // system menu's slider and the volume keys set it), "System Sounds",
    // the keyboard's clicks and the tones (the preferences). The streams'
    // own volumes stay at 100: audiod-pro has no per-stream volume for
    // these sinks.
    property int volume: 100
    onVolumeChanged: {
        if (!_applying)
            _call("luna://com.webos.service.audio/master/setVolume", { soundOutput: "alsa", volume: volume });
    }
    property var streams: ({ pringtones: 100, palerts: 100, pfeedback: 100 })
    property bool systemSounds: true
    property bool tapSounds: true
    property string ringtone: "/usr/palm/sounds/ringtone.mp3"
    property string alerttone: "/usr/palm/sounds/alert.wav"
    property string notificationtone: "/usr/palm/sounds/notification.wav"
    // timeFormat "HH24" (luna-sysservice's TimePrefsHandler).
    property bool twentyFourHour: false
    property bool showAlertsWhenLocked: true
    // STATUS: placeholder (the shell sets the backlight through phoenix-devices).
    property real brightness: 1.0
    property var fixedTime: null

    // ---- The bus -------------------------------------------------------------------
    // One call or subscription: handler(reply) for each reply (parsed);
    // replies that are not JSON are dropped.
    property bool _applying: false
    property var _bus: Service {
        appId: LS.appId
        property var handlers: ({})
        onResponse: (method, payload, token) => {
            var h = handlers[token];
            if (!h)
                return;
            if (!h.subscribe)
                delete handlers[token];
            var r = null;
            try { r = JSON.parse(payload); } catch (e) { return; }
            status._applying = true;
            try { h.fn(r); } finally { status._applying = false; }
        }
    }
    function _call(uri, params, fn, subscribe) {
        var m = /^luna:\/\/([^\/]+)(\/.*)$/.exec(uri);
        if (!m)
            return 0;
        var p = params || {};
        if (subscribe)
            p.subscribe = true;
        var token = _bus.call("luna://" + m[1], m[2], JSON.stringify(p));
        if (token > 0)
            _bus.handlers[token] = { fn: fn || function() {}, subscribe: !!subscribe };
        return token;
    }
    function _savePref(key, value) {
        if (_applying || !_started)
            return;
        var p = {};
        p[key] = value;
        _call("luna://com.webos.service.systemservice/setPreferences", p);
    }
    function _saveRotationLock() {
        _savePref("rotationLock", LsmStatus.rotationLockPref(rotationLocked, rotationLockOrientation));
    }
    // Saves begin once the start-up state is in (not the defaults over it).
    property bool _started: false

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
    // mode): powerd's USBDockStatus ("type"; DockConnected with DockPower,
    // DockSerialNo), as _power hears it. phoenix-devices knows no
    // Touchstone (no inductive charger driver yet).
    property string charger: "none"
    property string puckId: ""
    readonly property bool onPuck: charger === "inductive"
    property real batteryTemperature: NaN

    function _battery(r) {
        if (!r || typeof r.percent !== "number" || r.present === false)
            return;
        batteryPercent = Math.max(0, Math.min(100, Math.round(r.percent_ui !== undefined ? r.percent_ui : r.percent)));
        if (typeof r.temperature_C === "number")
            batteryTemperature = r.temperature_C;
    }
    function _charger(r) {
        if (!r || typeof r.Connected !== "boolean")
            return;
        charger = r.DockConnected ? "inductive" : (r.type && r.type !== "none" ? String(r.type) : r.Connected ? "wall" : "none");
        puckId = r.DockConnected ? String(r.DockSerialNo || "") : "";
        charging = !!(r.Charging || r.Connected);
    }
    property var _power: Service {
        appId: LS.appId
        property int batteryToken: 0
        property int chargerToken: 0
        onResponse: (method, payload, token) => {
            var r = null;
            try { r = JSON.parse(payload); } catch (e) { return; }
            if (token === chargerToken || (r && typeof r.Connected === "boolean"))
                status._charger(r);
            else
                status._battery(r);
        }
        Component.onCompleted: {
            // The signals (luna-service2's addmatch, as luna-systemui's
            // PowerdService.js listens), then the state now.
            batteryToken = call("luna://com.webos.service.bus", "/signal/addmatch",
                                JSON.stringify({ category: "/com/palm/power", method: "batteryStatus", subscribe: true }));
            chargerToken = call("luna://com.webos.service.bus", "/signal/addmatch",
                                JSON.stringify({ category: "/com/palm/power", method: "USBDockStatus", subscribe: true }));
            call("luna://com.palm.power", "/com/palm/power/batteryStatusQuery", "{}");
            call("luna://com.palm.power", "/com/palm/power/chargerStatusQuery", "{}");
        }
    }    // Settings > Exhibition. STATUS: the defaults; M1 reads the system
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

    // ---- Settings > Advanced and Text Assist (Shell.tweak()) ----------------------
    // The system preferences behind them (LsmStatus.tweakKeys, the runtime's
    // tweaks() rules; Shell.setTweaks writes them with lunaCall). The
    // start-up animation's (startupAnimation) and the rest are known before
    // the first frame: services/systemmanager keeps the ones the start needs
    // in a file (LsmStatus.startupFile), read here as the object is made
    // (QML_XHR_ALLOW_FILE_READ, set by meta-phoenix's product.env), as
    // LunaSysMgr read its preferences before its first frame
    // (Preferences::instance). getPreferences {subscribe} then keeps them
    // up to date. Without the file (the first start) they are the defaults.
    // Shell.setTweaks sets tweaks at once too; the preferences' echo then
    // agrees with it.
    property var tweaks: LsmStatus.tweaks({})
    property var _prefs: ({})
    on_PrefsChanged: tweaks = LsmStatus.tweaks(_prefs)
    function _readStartup() {
        var text = "";
        try {
            var x = new XMLHttpRequest();
            x.open("GET", "file://" + LsmStatus.startupFile, false);
            x.send();
            text = x.responseText || "";
        } catch (e) {
            text = "";
        }
        var p = LsmStatus.startupPrefs(text);
        _prefs = LsmStatus.mergePrefs({}, p);
        var lock = LsmStatus.rotationLock(p);
        if (lock) {
            rotationLocked = lock.locked;
            rotationLockOrientation = lock.orientation;
        }
    }

    // ---- Wi-Fi, Bluetooth and VPN (the system menu's drawers) ---------------------
    property var wifiNetworks: []
    property bool wifiScanning: false
    property var bluetoothDevices: []
    property var vpnProfiles: []
    readonly property string wifiSsid: _named(wifiNetworks, "ssid", "ipConfigured")
    readonly property string bluetoothDevice: _named(bluetoothDevices, "name", "connected")
    // -1 until bluetooth2 has listed the devices (taken as some, as
    // LunaSysMgr did on an error), then how many are paired: none, and
    // turning Bluetooth on from the menu opens Settings > Bluetooth
    // (SystemMenu::slotBluetoothTurnedOn).
    property int bluetoothPairedCount: -1
    readonly property bool bluetoothPairedDevicesAvailable: bluetoothPairedCount !== 0
    readonly property string vpnProfile: _named(vpnProfiles, "name", "connected")
    property var _wifi: ({ on: false, ssid: "", state: "", bars: -1 })
    property var _btPending: ({})
    property var _airplaneRadios: null

    function _named(list, key, state) {
        for (var i = 0; i < list.length; ++i)
            if (list[i].state === state)
                return list[i][key];
        return "";
    }

    function _applyWifi(s) {
        _wifi = s;
        wifiBars = s.bars;
        if (!s.on) {
            wifiScanning = false;
            wifiNetworks = [];
            return;
        }
        // The network being joined or joined shows so in the list.
        wifiNetworks = wifiNetworks.map(function(n) {
            var st = n.ssid === s.ssid && s.state !== "" ? s.state : n.state === "connecting" || n.state === "ipConfigured" ? "" : n.state;
            return { ssid: n.ssid, bars: n.bars, security: n.security, known: n.known, state: st, profileId: n.profileId };
        });
    }

    function setWifiOn(on) {
        _call("luna://com.webos.service.wifi/setstate", { state: on ? "enabled" : "disabled" });
        if (on)
            scanWifi();
    }
    function scanWifi() {
        if (wifiBars < 0 && !_wifi.on)
            return;
        wifiScanning = true;
        _call("luna://com.webos.service.wifi/findnetworks", {}, function(r) {
            status.wifiScanning = false;
            var list = LsmStatus.wifiNetworks(r, status._wifi);
            if (list)
                status.wifiNetworks = list;
        });
    }
    function connectWifi(ssid) {
        var n = wifiNetworks.filter(function(x) { return x.ssid === ssid; })[0];
        var params = LsmStatus.wifiConnectParams(n);
        if (!params)
            return;
        wifiNetworks = wifiNetworks.map(function(x) {
            return { ssid: x.ssid, bars: x.bars, security: x.security, known: x.known, profileId: x.profileId,
                     state: x.ssid === ssid ? "connecting" : x.state === "ipConfigured" ? "" : x.state };
        });
        _call("luna://com.webos.service.wifi/connect", params, function(r) {
            if (r && r.returnValue === false)
                status.wifiNetworks = status.wifiNetworks.map(function(x) {
                    return x.ssid !== ssid || x.state !== "connecting" ? x
                        : { ssid: x.ssid, bars: x.bars, security: x.security, known: x.known, profileId: x.profileId,
                            state: "associationFailed" };
                });
        });
    }

    function setBluetoothOn(on) {
        if (on && (bluetoothOn || bluetoothTurningOn))
            return;
        bluetoothTurningOn = on;
        _call("luna://com.webos.service.bluetooth2/adapter/setState", { powered: on }, function(r) {
            if (r && r.returnValue === false)
                status.bluetoothTurningOn = false;
        });
    }
    // The menu connected and disconnected audio devices (SystemMenu.cpp:
    // 490-567; profconnect / profdisconnect, StatusBarServicesConnector.cpp:
    // 2645-2673): bluetooth2's A2DP.
    function connectBluetooth(address) {
        var d = bluetoothDevices.filter(function(x) { return x.address === address; })[0];
        if (!d || !bluetoothOn)
            return;
        var p = {};
        for (var k in _btPending)
            p[k] = _btPending[k];
        if (d.state === "connected") {
            delete p[address];
            _btPending = p;
            _call("luna://com.webos.service.bluetooth2/a2dp/disconnect", { address: address });
            return;
        }
        p[address] = "connecting";
        _btPending = p;
        _setBtState(address, "connecting");
        _call("luna://com.webos.service.bluetooth2/a2dp/connect", { address: address, subscribe: true }, function(r) {
            if (r && r.returnValue === false) {
                var q = {};
                for (var k2 in status._btPending)
                    q[k2] = status._btPending[k2];
                q[address] = "connectfailed";
                status._btPending = q;
                status._setBtState(address, "connectfailed");
            }
        }, true);
    }
    function _setBtState(address, state) {
        bluetoothDevices = bluetoothDevices.map(function(x) {
            return x.address === address ? { name: x.name, address: x.address, state: state } : x;
        });
    }

    function connectVpn(name) {
        var p = vpnProfiles.filter(function(v) { return v.name === name; })[0];
        if (!p)
            return;
        var connect = p.state !== "connected";
        if (connect)
            vpnProfiles = vpnProfiles.map(function(v) { return v.name === name ? { name: v.name, state: "connecting" } : v; });
        _call("luna://com.webos.service.vpn/" + (connect ? "connect" : "disconnect"), { vpnProfileName: name }, function(r) {
            if (connect && r && r.returnValue === false)
                status.vpnProfiles = status.vpnProfiles.map(function(v) {
                    return v.name === name ? { name: v.name, state: "connectfailed" } : v;
                });
        });
    }

    onAirplaneModeChanged: {
        if (_applying || !_started)
            return;
        _savePref("airplaneMode", airplaneMode);
        if (airplaneMode) {
            _airplaneRadios = { wifi: _wifi.on, bluetooth: bluetoothOn || bluetoothTurningOn };
            if (_airplaneRadios.bluetooth)
                setBluetoothOn(false);
            if (_airplaneRadios.wifi)
                setWifiOn(false);
        } else if (_airplaneRadios) {
            if (_airplaneRadios.wifi)
                setWifiOn(true);
            if (_airplaneRadios.bluetooth)
                setBluetoothOn(true);
            _airplaneRadios = null;
        }
    }

    // ---- The subscriptions ------------------------------------------------------------
    Component.onCompleted: {
        _readStartup();
        var prefKeys = LsmStatus.tweakKeys.concat(["rotationLock", "airplaneMode", "muteSound", "ringtone", "alerttone",
                                                   "notificationtone", "systemSounds", "x_palm_virtualkeyboard_prefs",
                                                   "timeFormat", "showAlertsWhenLocked", "show3GForEvdo"]);
        _call("luna://com.webos.service.systemservice/getPreferences", { keys: prefKeys }, function(r) {
            if (!r || r.returnValue === false)
                return;
            var merged = LsmStatus.mergePrefs(status._prefs, r);
            if (JSON.stringify(merged) !== JSON.stringify(status._prefs))
                status._prefs = merged;
            var lock = LsmStatus.rotationLock(r);
            if (lock) {
                status.rotationLocked = lock.locked;
                if (lock.orientation !== "" || !lock.locked)
                    status.rotationLockOrientation = lock.orientation;
            }
            if (typeof r.airplaneMode === "boolean")
                status.airplaneMode = r.airplaneMode;
            if (typeof r.muteSound === "boolean")
                status.muted = r.muteSound;
            var s = LsmStatus.soundPrefs(r);
            for (var k in s || {})
                status[k] = s[k];
            if (typeof r.timeFormat === "string")
                status.twentyFourHour = r.timeFormat === "HH24";
            if (typeof r.showAlertsWhenLocked === "boolean")
                status.showAlertsWhenLocked = r.showAlertsWhenLocked;
            if (typeof r.show3GForEvdo === "boolean")
                status.show3GForEvdo = r.show3GForEvdo;
        }, true);
        _call("luna://com.webos.service.audio/master/getVolume", { soundOutput: "alsa" }, function(r) {
            var v = LsmStatus.masterVolume(r);
            if (v)
                status.volume = v.volume;
        }, true);
        _call("luna://com.palm.display/phoenix/orientation", {}, function(r) {
            var o = LsmStatus.orientation(r);
            if (o)
                status.deviceOrientation = o;
        }, true);
        _call("luna://com.webos.service.wifi/getstatus", {}, function(r) {
            var s = LsmStatus.wifiStatus(r);
            if (s)
                status._applyWifi(s);
        }, true);
        _call("luna://com.webos.service.bluetooth2/adapter/getStatus", {}, function(r) {
            var a = LsmStatus.bluetoothAdapter(r);
            if (!a)
                return;
            status.bluetoothOn = a.on;
            // On: no longer turning on ("Turning on Bluetooth..." until the
            // adapter says it is powered; setState's failure ends it too).
            if (a.on)
                status.bluetoothTurningOn = false;
            if (!a.on) {
                status._btPending = {};
                status.bluetoothDevices = status.bluetoothDevices.map(function(d) {
                    return { name: d.name, address: d.address, state: "disconnected" };
                });
            }
        }, true);
        _call("luna://com.webos.service.bluetooth2/device/getStatus", {}, function(r) {
            var p = {};
            var list = LsmStatus.bluetoothDevices(r, status._btPending);
            if (!list)
                return;
            // A device that connected (or went) is no longer pending.
            list.forEach(function(d) {
                if (d.state !== "connected" && status._btPending[d.address])
                    p[d.address] = status._btPending[d.address];
            });
            status._btPending = p;
            status.bluetoothDevices = list;
            status.bluetoothPairedCount = list.length;
        }, true);
        _call("luna://com.webos.service.vpn/getProfileList", {}, function(r) {
            var list = LsmStatus.vpnProfiles(r);
            if (list)
                status.vpnProfiles = list;
        }, true);
        // A modem's (where the device has one).
        _call("luna://com.palm.telephony/ttyQuery", {}, function(r) {
            var t = LsmStatus.telephonyTty(r);
            if (t)
                status.tty = t.tty;
        }, true);
        _call("luna://com.palm.telephony/hacQuery", {}, function(r) {
            var h = LsmStatus.telephonyHac(r);
            if (h)
                status.hac = h.hac;
        }, true);
        var network = function(r) {
            var n = LsmStatus.telephonyNetwork(r);
            if (!n)
                return;
            if (n.carrier !== undefined)
                status.carrier = n.carrier;
            if (n.roaming !== undefined)
                status.roaming = n.roaming;
        };
        _call("luna://com.palm.telephony/networkStatusQuery", {}, network);
        _call("luna://com.palm.telephony/subscribe", { events: "network" }, network, true);
        _call("luna://com.palm.telephony/forwardQuery", { condition: "unconditional", bearer: "defaultbearer", network: false }, function(r) {
            var f = LsmStatus.callForward(r);
            if (f)
                status.callForwarding = f.callForwarding;
        }, true);
        _call("luna://com.palm.wan/getstatus", {}, function(r) {
            var w = LsmStatus.wanStatus(r);
            if (w) {
                status.wanType = w.wanType;
                status.wanDormant = w.wanDormant;
            }
        }, true);
        _started = true;
    }
}
