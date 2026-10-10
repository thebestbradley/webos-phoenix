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
    property int batteryPercent: 76  // -1: no reading (powerd not answering; the status bar shows battery-error)
    property bool charging: false
    // What it charges on: "none", "wall" or "pc" (USB), or "inductive", the
    // Touchstone (powerd's chargerStatus type; phoenix-sim F7, F12,
    // --touchstone). On a Touchstone, puckId is its serial number
    // (DockSerialNo), so dock mode remembers which exhibition each one
    // showed (DockModeWindowManager's m_puckIdToDlpIndex).
    property string charger: "none"
    property string puckId: ""
    readonly property bool onPuck: charger === "inductive"

    // ---- Dock mode (Settings > Exhibition; the runtime's preferences) ----------
    // Exhibitions on the Touchstone at all; how long on it with the screen
    // on before one starts (0: when the screen would turn off); the
    // exhibitions turned on, in the menu's order (after Time); sounds while
    // one shows ("systemsettings" or "mute"); night mode, its brightness
    // from nightStart to nightEnd ("HH:MM"); dock mode's own wallpaper.
    property bool exhibitionEnabled: true
    property int exhibitionStartAfter: 0
    property var exhibitionApps: ["org.webosphoenix.photos"]
    property string dockModeSound: "systemsettings"
    property bool exhibitionNightMode: false
    property string exhibitionNightStart: "22:00"
    property string exhibitionNightEnd: "07:00"
    property url dockWallpaper: ""

    // ---- Developer Mode (com.webos.service.devmode; the runtime's devMode) -----
    // On: the developer apps show (docs/APP-RUNTIME.md "Developer apps").
    // devModeUnlocked: Developer Mode was revealed (Just Type's Konami code;
    // the system preference), so Settings' Developer Mode shows.
    property bool devMode: false
    property bool devModeUnlocked: false
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
    // The orientation the rotation lock holds ("up", "down", "left",
    // "right"; "" not known yet: the shell locks the UI as it is turned and
    // says so here). Kept across restarts, as LunaSysMgr's rotationLock
    // preference kept the orientation (Preferences.cpp:196-201).
    property string rotationLockOrientation: ""
    // Unlocked, the orientation is forgotten (Orientation_Invalid).
    onRotationLockedChanged: if (!rotationLocked) rotationLockOrientation = ""
    // How the simulated device is held: "up", "down", "left" (turned
    // counter-clockwise) or "right" (phoenix-sim --orientation, Ctrl+Left /
    // Ctrl+Right). The shell turns the UI to follow (UiRotation).
    property string deviceOrientation: "up"
    property bool muted: false
    // Unconditional call forwarding is on (Settings > Phone; the runtime's
    // com.palm.telephony forwardQuery), for the status bar's icon.
    property bool callForwarding: false
    // System sounds (SystemSounds.qml), as the runtime reports them
    // (Settings > Sounds & Ringtones): the master and stream volumes
    // (0..100), "System Sounds", "Keyboard clicks" and the tones' paths.
    property int volume: 60
    // What the volume keys adjust (audiod's scenario, from the runtime):
    // "phone", "ringtone" (a call ringing), "media" or "system".
    property string audioScenario: "system"
    property var streams: ({ pringtones: 80, palerts: 70, pfeedback: 50 })
    property bool systemSounds: true
    property bool tapSounds: true
    // Settings > Text Assist: {suggestions, autoCorrect, swipe, spaces2period,
    // forgetWords (when the learned words were forgotten, ms)}.
    // userWords (the personal dictionary), removedWords (learned words
    // deleted there: lower case -> ms).
    property var textAssist: ({ suggestions: true, autoCorrect: true, swipe: true, spaces2period: true, forgetWords: 0,
                                shortcuts: {}, shortcutsOn: true, userWords: [], removedWords: {} })
    // The keyboard's "Add" (after backspace put back a corrected word): the
    // word joins the personal dictionary here at once, and goes to the
    // runtime (dictionaryWordAdded: sim.qml sends it on), which keeps it in
    // x_palm_textinput.userWords.
    signal dictionaryWordAdded(string word)
    function addDictionaryWord(word) {
        var w = String(word || "").trim();
        if (!w)
            return;
        var t = {};
        for (var k in textAssist)
            t[k] = textAssist[k];
        var words = (t.userWords || []).filter(function (x) { return x.toLowerCase() !== w.toLowerCase(); });
        t.userWords = words.concat([w]);
        textAssist = t;
        dictionaryWordAdded(w);
    }
    // Settings > Text Assist > Keyboards: [{layout, language}] turned on,
    // and the one in use (the keyboard's language key picks another).
    property var keyboards: [{ layout: "qwerty", language: "en" }]
    property var keyboard: ({ layout: "qwerty", language: "en" })
    // Settings > Text Assist > Keyboards (GAPS V7): the keyboards installed,
    // in the user's order ("classic", "phoenix", "ose"), and the one in use
    // (the globe key picks another).
    property var installedKeyboards: ["classic"]
    // Settings > Text Assist > Hardware Keyboard: {layout ("auto",
    // "qwertz", "azerty"), remap {capslock, control, alt, meta}}.
    property var hardwareKeyboardPrefs: ({ layout: "auto", remap: {} })
    property string keyboardId: "classic"
    property string ringtone: "/usr/palm/sounds/ringtone.mp3"
    property string alerttone: "/usr/palm/sounds/alert.wav"
    property string notificationtone: "/usr/palm/sounds/notification.wav"
    // The clock's format (system preference timeFormat "HH24").
    property bool twentyFourHour: false
    // Settings > Screen & Lock: "Turn off after" (seconds) and "Lock after"
    // (seconds locked before the passcode is asked for; 0 at once).
    property int screenTimeout: 60
    property int lockTimeout: 0
    // Screen & Lock > Advanced gestures (sysUiEnableNextPrevGestures): a
    // long swipe across the gesture area switches apps. On by default
    // (Phoenix; the runtime's defaultPrefs).
    property bool advancedGestures: true
    // Settings > Apps > Opening a running app (appRelaunch): "front",
    // "refresh" or "new" (the window source's appRelaunch).
    property string appRelaunch: "front"
    // Settings > Text Assist > Hardware keyboard: "ipad" or "desktop".
    property string keyboardShortcuts: "ipad"
    // Settings > Screen & Lock "Show notifications when locked"
    // (system preference showAlertsWhenLocked).
    property bool showAlertsWhenLocked: true
    // Settings > Screen & Lock > Show previews (lockScreenPreviews, Phoenix):
    // off, the lock screen says "New Message" instead (docs/M6-PLAN.md F4).
    property bool lockScreenPreviews: true
    // Settings > Sounds & Ringtones > Repeat alerts (notificationRepeat):
    // {enabled, minutes, apps: {appId: false}} (docs/M6-PLAN.md F4).
    property var notificationRepeat: ({ enabled: false, minutes: 2, apps: {} })
    // Settings > Accessibility "Reduce motion" (system preference
    // accessibility.reduceMotion): the shell's animations (Theme.reduceMotion).
    property bool reduceMotion: false
    // Settings > Accessibility > Keyboard (the runtime's keyboardAccess):
    // {stickyKeys, slowKeys, bounceKeys (ms, 0 off), customRepeat,
    // repeatDelay, repeatInterval}.
    property var keyboardAccess: ({})
    // Settings > Advanced (the runtime's tweaks; docs/M6-PLAN.md F4):
    // {infiniteCardCycling, maximizeEdges, waveLauncher, tapRipple,
    // animationSpeed ("normal", "fast"), gestureSensitivity ("low",
    // "normal", "high"), haptics, gridDensity ("normal", "dense"),
    // batteryPercent, numberRow, keyboardStyle ("auto", "black",
    // "touchpad")}. Missing keys are the defaults
    // (Shell.tweak()).
    property var tweaks: ({})
    // The browser's page views (its Preferences: browserContentBlocker,
    // browserUserAgent) and the system proxy (Settings > Wi-Fi > Proxy,
    // networkProxy), for phoenix-sim's simBrowser (sim.qml).
    property var browser: ({ contentBlocker: false, userAgent: "mobile" })
    property var proxy: ({ type: "none", host: "", port: 0 })

    // Accessories and health (docs/M6-PLAN.md F4 items 8-9), the
    // simulator's own (sim.qml simActions), told to the pages:
    //   gamepads   game controllers connected: [{index, id, name,
    //              connection ("bluetooth" | "usb"), mapping, buttons
    //              (pressed, by the standard mapping's index), axes}]
    //   usbDrives  USB drives on the device's USB port (host / OTG):
    //              [{id, label, vendor, size, used, fs}]
    //   temperature the battery's temperature, °C (powerd's temperature_C)
    property var gamepads: []
    property var usbDrives: []
    property int temperature: 31
    // A hardware keyboard is attached (phoenix-sim --hardware-keyboard,
    // Ctrl+Shift+K): the virtual keyboard stays down unless asked for.
    property bool hardwareKeyboard: typeof simHardwareKeyboard !== "undefined" && simHardwareKeyboard === true
    property real brightness: 0.7     // 0.10 (the floor, Theme.minimumBrightness) .. 1
    // ---- The device's switches and sensors (DeviceServices) ---------------------
    // The backlight follows the light sensor (the enableALS preference), and
    // stays on while a USB charger is in (com.palm.display onWhenConnected).
    property bool automaticBrightness: true
    property bool onWhenConnected: false
    // The simulated light on the sensor, in lux (phoenix-sim Ctrl+Shift+L
    // cycles dark 1, dim 50, indoor 300, outdoor 20000).
    property int lightLevel: 300
    // The ringer switch: "up" sound on, "down" silent (Ctrl+Shift+R); a
    // headset: "none", "headset" or "headset-mic" (Ctrl+Shift+H).
    property string ringerSwitch: "up"
    property string headset: "none"
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
    // | "connectfailed". A demo profile until the web runtime reports its
    // own (Settings > VPN, com.webos.service.vpn); from then on the runtime
    // has them, and connecting one asks it (vpnRequested). needsCredentials:
    // it asks for a user name and password, which Settings > VPN answers.
    property var vpnProfiles: [
        { name: "Office", state: "disconnected" }
    ]
    property bool _runtimeVpn: false
    // The web runtime has reported its Wi-Fi networks: joining one asks it
    // (wifiRequested), the system menu and Settings > Wi-Fi then agree.
    property bool _runtimeWifi: false
    // {wifiConnect: ssid}, for the web pages.
    signal wifiRequested(var request)
    // The system menu connects or disconnects a profile the runtime has:
    // {vpnConnect: name} or {vpnDisconnect: name}, for the web pages.
    signal vpnRequested(var request)

    // The network, device and profile in use ("" for none): the drawers'
    // headers show them (SystemMenu.cpp:397-412, 568-610, 776-800).
    readonly property string wifiSsid: _named(wifiNetworks, "ssid", "ipConfigured")
    readonly property string bluetoothDevice: _named(bluetoothDevices, "name", "connected")
    // How many devices Settings > Bluetooth has paired, as the runtime
    // reports it (-1 until it has: then the sample devices above count).
    // None: the system menu turning Bluetooth on opens its preferences
    // (SystemMenu::slotBluetoothTurnedOn).
    property int bluetoothPairedCount: -1
    readonly property bool bluetoothPairedDevicesAvailable: bluetoothPairedCount < 0 ? bluetoothDevices.length > 0
                                                                                     : bluetoothPairedCount > 0
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
        // The runtime joins a known network itself as the radio comes on.
        if (_runtimeWifi)
            return;
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
        if (_runtimeWifi) {
            wifiNetworks = wifiNetworks.map(function(n) {
                return _with(n, { state: n.ssid === ssid ? "connecting" : n.state === "ipConfigured" ? "" : n.state });
            });
            wifiRequested({ wifiConnect: ssid });
            return;
        }
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
        if (_runtimeVpn) {
            var p = vpnProfiles.filter(function(v) { return v.name === name; })[0];
            if (p)
                vpnRequested(p.state === "connected" ? { vpnDisconnect: name } : { vpnConnect: name });
            return;
        }
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
        } else if (!_runtimeWifi && _named(wifiNetworks, "ssid", "ipConfigured") === "") {
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
    // screenTimeout, lockTimeout, advancedGestures, appRelaunch, keyboardShortcuts,
    // volume, streams, systemSounds, tapSounds, textAssist, keyboards,
    // keyboard, ringtone, alerttone,
    // notificationtone, callForwarding, reduceMotion, keyboardAccess, tweaks, browser, proxy,
    // vpnProfiles, exhibitionApps, devMode, devModeUnlocked, dockModeSound, exhibition {enabled,
    // startAfter, nightMode, nightStart, nightEnd}, dockWallpaperUrl,
    // automaticBrightness, displayOnWhenConnected.
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
        if (s.automaticBrightness !== undefined)
            automaticBrightness = !!s.automaticBrightness;
        if (s.displayOnWhenConnected !== undefined)
            onWhenConnected = !!s.displayOnWhenConnected;
        if (s.rotationLockOrientation !== undefined && s.rotationLockOrientation !== "")
            rotationLockOrientation = s.rotationLockOrientation;
        if (s.rotationLocked !== undefined) {
            rotationLocked = !!s.rotationLocked;
            if (!rotationLocked)
                rotationLockOrientation = "";
        }
        if (s.bluetoothPairedCount !== undefined)
            bluetoothPairedCount = s.bluetoothPairedCount;
        if (s.muted !== undefined)
            muted = !!s.muted;
        if (s.callForwarding !== undefined)
            callForwarding = !!s.callForwarding;
        if (s.timeFormat !== undefined)
            twentyFourHour = s.timeFormat === "HH24";
        if (s.showAlertsWhenLocked !== undefined)
            showAlertsWhenLocked = !!s.showAlertsWhenLocked;
        if (s.lockScreenPreviews !== undefined)
            lockScreenPreviews = s.lockScreenPreviews !== false;
        if (s.notificationRepeat !== undefined && s.notificationRepeat !== null)
            notificationRepeat = s.notificationRepeat;
        if (s.screenTimeout !== undefined)
            screenTimeout = s.screenTimeout;
        if (s.lockTimeout !== undefined)
            lockTimeout = s.lockTimeout;
        if (s.advancedGestures !== undefined)
            advancedGestures = !!s.advancedGestures;
        if (s.appRelaunch !== undefined)
            appRelaunch = s.appRelaunch === "refresh" || s.appRelaunch === "new" ? s.appRelaunch : "front";
        if (s.keyboardShortcuts !== undefined)
            keyboardShortcuts = s.keyboardShortcuts === "desktop" ? "desktop" : "ipad";
        if (s.volume !== undefined)
            volume = s.volume;
        if (s.audioScenario !== undefined)
            audioScenario = s.audioScenario;
        if (s.streams !== undefined)
            streams = s.streams;
        if (s.systemSounds !== undefined)
            systemSounds = !!s.systemSounds;
        if (s.tapSounds !== undefined)
            tapSounds = !!s.tapSounds;
        if (s.textAssist !== undefined && s.textAssist !== null)
            textAssist = s.textAssist;
        if (s.keyboards !== undefined && s.keyboards !== null)
            keyboards = s.keyboards;
        if (s.keyboard !== undefined && s.keyboard !== null)
            keyboard = s.keyboard;
        if (s.hardwareKeyboard && typeof s.hardwareKeyboard === "object")
            hardwareKeyboardPrefs = s.hardwareKeyboard;
        if (Array.isArray(s.installedKeyboards) && s.installedKeyboards.length)
            installedKeyboards = s.installedKeyboards;
        if (typeof s.keyboardId === "string" && s.keyboardId !== "")
            keyboardId = s.keyboardId;
        if (s.ringtone !== undefined)
            ringtone = s.ringtone;
        if (s.alerttone !== undefined)
            alerttone = s.alerttone;
        if (s.notificationtone !== undefined)
            notificationtone = s.notificationtone;
        if (s.reduceMotion !== undefined)
            reduceMotion = !!s.reduceMotion;
        if (s.keyboardAccess !== undefined)
            keyboardAccess = s.keyboardAccess || ({});
        if (s.tweaks !== undefined && s.tweaks !== null)
            tweaks = s.tweaks;
        if (s.browser !== undefined && s.browser !== null)
            browser = s.browser;
        if (s.proxy !== undefined && s.proxy !== null && JSON.stringify(s.proxy) !== JSON.stringify(proxy))
            proxy = s.proxy;
        if (s.vpnProfiles !== undefined) {
            _runtimeVpn = true;
            vpnProfiles = s.vpnProfiles;
        }
        // The runtime's networks (Settings > Wi-Fi's), in place of the demo
        // list; with the radio off it has none, and the list stays.
        if (s.wifiNetworks !== undefined) {
            _runtimeWifi = true;
            if (s.wifiNetworks.length > 0)
                wifiNetworks = s.wifiNetworks;
        }
        if (s.exhibitionApps !== undefined && s.exhibitionApps !== null)
            exhibitionApps = s.exhibitionApps;
        if (s.devMode !== undefined)
            devMode = !!s.devMode;
        if (s.devModeUnlocked !== undefined)
            devModeUnlocked = !!s.devModeUnlocked;
        if (s.dockModeSound !== undefined)
            dockModeSound = s.dockModeSound === "mute" ? "mute" : "systemsettings";
        if (s.exhibition !== undefined && s.exhibition !== null) {
            exhibitionEnabled = s.exhibition.enabled !== false;
            exhibitionStartAfter = s.exhibition.startAfter > 0 ? s.exhibition.startAfter : 0;
            exhibitionNightMode = !!s.exhibition.nightMode;
            exhibitionNightStart = s.exhibition.nightStart || "22:00";
            exhibitionNightEnd = s.exhibition.nightEnd || "07:00";
        }
        if (s.dockWallpaperUrl !== undefined)
            dockWallpaper = s.dockWallpaperUrl;
        applyingAppStatus = false;
    }

    // One property in the runtime's terms, for pushing a change to the apps.
    function appStatusFor(name) {
        switch (name) {
        case "wifiBars": return { wifiEnabled: wifiBars >= 0 };
        case "airplaneMode": return { airplaneMode: airplaneMode };
        case "bluetoothOn": return { bluetoothOn: bluetoothOn };
        case "brightness": return { brightness: Math.round(brightness * 100) };
        case "rotationLocked":
        case "rotationLockOrientation":
            return { rotationLocked: rotationLocked, rotationLockOrientation: rotationLockOrientation };
        case "muted": return { muted: muted };
        case "volume": return { volume: volume };
        case "keyboard": return { keyboard: keyboard };
        case "keyboardId": return { keyboardId: keyboardId };
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
