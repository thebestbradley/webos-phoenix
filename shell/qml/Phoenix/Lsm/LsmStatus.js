// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device status's reading of OSE's services, without the bus, so it can
// be tested on any computer (shell/tests/tst_lsmstatus.qml).
// LsmSystemStatus.qml makes the calls and applies what these return, in the
// shapes SimSystemStatus documents.
//
// Each function takes a service's reply (parsed JSON) and returns what the
// shell's status gets from it, or null when the reply says nothing it uses.
// STATUS: written against the services' sources (cited per function); not
// yet run on a device.

.pragma library

function _num(v) {
    return typeof v === "number" && isFinite(v);
}

// ---- Settings > Advanced and Text Assist (the shell's tweaks) -----------------------
// The system preferences behind Shell.tweak(), and what they mean: the
// runtime's tweaks(p), runtime/phoenix-runtime.js (TWEAK_KEYS), the one list.
// Settings writes them with com.palm.systemservice setPreferences, which OSE's
// luna-sysservice keeps whatever the key (PrefsFactory.cpp:355-361, no handler:
// saved as it is) and posts to getPreferences subscribers one key at a time
// ({key: value}, :370).
var tweakKeys = ["infiniteCardCyclingEnabled", "sysUiEnableMaximizeEdges", "sysUiEnableWaveLauncher", "showReticleAnimation",
                 "animationSpeed", "gestureSensitivity", "hapticFeedback", "launcherGridDensity", "showBatteryPercent",
                 "keyboardNumberRow", "keyboardStyle", "startupAnimation",
                 "keyboardButton", "keyboardButtonSide", "keyboardButtonY", "keyboardButtonHintShown"];

// The preferences seen so far, with what reply adds (only tweakKeys).
function mergePrefs(prefs, reply) {
    var out = {};
    var k;
    for (k in prefs || {})
        out[k] = prefs[k];
    if (reply && typeof reply === "object")
        for (var i = 0; i < tweakKeys.length; ++i)
            if (reply[tweakKeys[i]] !== undefined)
                out[tweakKeys[i]] = reply[tweakKeys[i]];
    return out;
}

// runtime/phoenix-runtime.js tweaks(p), the same rules and defaults.
function tweaks(p) {
    p = p || {};
    var pick = function (v, allowed, d) { return allowed.indexOf(v) >= 0 ? v : d; };
    return {
        infiniteCardCycling: !!p.infiniteCardCyclingEnabled,
        maximizeEdges: !!p.sysUiEnableMaximizeEdges,
        waveLauncher: p.sysUiEnableWaveLauncher !== false,
        tapRipple: p.showReticleAnimation !== false,
        animationSpeed: pick(p.animationSpeed, ["normal", "fast"], "normal"),
        gestureSensitivity: pick(p.gestureSensitivity, ["low", "normal", "high"], "normal"),
        haptics: !!p.hapticFeedback,
        gridDensity: pick(p.launcherGridDensity, ["normal", "dense"], "normal"),
        batteryPercent: !!p.showBatteryPercent,
        numberRow: !!p.keyboardNumberRow,
        keyboardStyle: pick(p.keyboardStyle, ["auto", "black", "touchpad"], "auto"),
        startupAnimation: pick(p.startupAnimation, ["phoenix", "classic"], "phoenix"),
        keyboardButton: p.keyboardButton !== false,
        keyboardButtonSide: pick(p.keyboardButtonSide, ["left", "right"], "right"),
        keyboardButtonY: typeof p.keyboardButtonY === "number" && p.keyboardButtonY >= 0 && p.keyboardButtonY <= 1 ? p.keyboardButtonY : 1,
        keyboardButtonHintShown: !!p.keyboardButtonHintShown
    };
}

// The shell's tweak names back to their preferences (Shell.setTweaks writes
// them through lunaCall): {keyboardButtonY: 0.4} -> {keyboardButtonY: 0.4},
// {infiniteCardCycling: true} -> {infiniteCardCyclingEnabled: true}.
var _prefOf = { infiniteCardCycling: "infiniteCardCyclingEnabled", maximizeEdges: "sysUiEnableMaximizeEdges",
                waveLauncher: "sysUiEnableWaveLauncher", tapRipple: "showReticleAnimation", haptics: "hapticFeedback",
                gridDensity: "launcherGridDensity", batteryPercent: "showBatteryPercent", numberRow: "keyboardNumberRow" };
function prefsForTweaks(t) {
    var out = {};
    for (var k in t || {})
        out[_prefOf[k] || k] = t[k];
    return out;
}

// The start-up preferences file (services/systemmanager keeps it, as the
// shell cannot wait for the bus before its first frame; LunaSysMgr read its
// preferences before its first frame too, Preferences::instance):
// {prefs: {...}} with the startupKeys it last saw. Text in, those
// preferences out ({} for none or a broken file).
var startupKeys = tweakKeys.concat(["rotationLock"]);
var startupFile = "/var/lib/phoenix/systemmanager/startup.json";
function startupPrefs(text) {
    var out = {};
    try {
        var o = JSON.parse(text);
        var p = o && o.prefs && typeof o.prefs === "object" ? o.prefs : {};
        for (var i = 0; i < startupKeys.length; ++i)
            if (p[startupKeys[i]] !== undefined)
                out[startupKeys[i]] = p[startupKeys[i]];
    } catch (e) {
        return {};
    }
    return out;
}

// ---- The rotation lock -----------------------------------------------------------
// The rotationLock system preference: false (off), true (on, the orientation
// not known), or the orientation it holds, as the runtime keeps it (and as
// LunaSysMgr's rotationLock preference kept the orientation, an
// OrientationEvent value, Preferences.cpp:196-201). Returns {locked,
// orientation} or null.
function rotationLock(reply) {
    if (!reply || reply.rotationLock === undefined)
        return null;
    var v = reply.rotationLock;
    var four = ["up", "down", "left", "right"];
    if (four.indexOf(v) >= 0)
        return { locked: true, orientation: v };
    return { locked: v === true, orientation: "" };
}
function rotationLockPref(locked, orientation) {
    return !locked ? false : ["up", "down", "left", "right"].indexOf(orientation) >= 0 ? orientation : true;
}

// ---- System sounds ---------------------------------------------------------------
// The tones (ringtone, alerttone, notificationtone: {name, fullPath}, as
// luna-sysservice's RingtonePrefsHandler and the runtime keep them),
// "System Sounds" (systemSounds) and "Keyboard clicks"
// (x_palm_virtualkeyboard_prefs.TapSounds, luna-sysmgr's
// VirtualKeyboardPreferences). Returns the changes, or null.
function soundPrefs(reply) {
    if (!reply || typeof reply !== "object")
        return null;
    var out = {};
    ["ringtone", "alerttone", "notificationtone"].forEach(function (k) {
        var v = reply[k];
        if (v && typeof v === "object" && typeof v.fullPath === "string" && v.fullPath !== "")
            out[k] = v.fullPath;
        else if (typeof v === "string" && v !== "")
            out[k] = v;
    });
    if (typeof reply.systemSounds === "boolean")
        out.systemSounds = reply.systemSounds;
    var kb = reply.x_palm_virtualkeyboard_prefs;
    if (kb && typeof kb === "object" && typeof kb.TapSounds === "boolean")
        out.tapSounds = kb.TapSounds;
    return Object.keys(out).length ? out : null;
}

// audiod-pro's master/getVolume {soundOutput: "alsa", subscribe}: {volumeStatus:
// {volume, muted, soundOutput}} (OSEMasterVolumeManager::getVolumeInfo,
// OSEMasterVolumeManager.cpp:2245-2285). Returns {volume} (0-100) or null.
// Its mute is the output's; the shell's "Mute Sound" is the ringer's (the
// muteSound preference), as LunaSysMgr's was.
function masterVolume(reply) {
    if (!reply || reply.returnValue === false || !reply.volumeStatus || typeof reply.volumeStatus !== "object")
        return null;
    var v = reply.volumeStatus.volume;
    return _num(v) ? { volume: Math.max(0, Math.min(100, Math.round(v))) } : null;
}

// ---- Wi-Fi (OSE's com.webos.service.wifi, webos-connman-adapter) ----------------
// getstatus {subscribe}: status "serviceDisabled", "serviceEnabled" or
// "connectionStateChanged" with networkInfo {ssid, connectState, signalBars}
// (wifi_service.c:394-437, 247-305); connectState from connman's
// (connman_service.c:73-98): notAssociated, associating, associated,
// ipConfigured, ipFailed. signalBars 0-3 (signal_strength_to_bars,
// wifi_service.c:228-244). As LunaSysMgr read it (StatusBarServicesConnector::
// wifiEventsCallback, :2898-2998): associating / associated show the
// "connecting" icon, ipConfigured the bars (at least 1, at most 3), the rest
// the radio on. Returns {on, ssid, state, bars} (bars: SimSystemStatus's
// wifiBars: -1 off, 0 on without a network, 1-3).
function wifiStatus(reply) {
    if (!reply || reply.returnValue === false || typeof reply.status !== "string")
        return null;
    if (reply.status === "serviceDisabled")
        return { on: false, ssid: "", state: "", bars: -1 };
    if (reply.status === "serviceEnabled")
        return { on: true, ssid: "", state: "", bars: 0 };
    if (reply.status !== "connectionStateChanged")
        return null;
    var n = reply.networkInfo || {};
    var cs = String(n.connectState || "");
    var ssid = typeof n.ssid === "string" ? n.ssid : "";
    if (cs === "ipConfigured")
        return { on: true, ssid: ssid, state: "ipConfigured", bars: Math.max(1, Math.min(3, _num(n.signalBars) ? n.signalBars : 1)) };
    if (cs === "associating" || cs === "associated")
        return { on: true, ssid: ssid, state: "connecting", bars: 0 };
    if (cs === "ipFailed" || cs === "associationFailed")
        return { on: true, ssid: ssid, state: cs, bars: 0 };
    return { on: true, ssid: "", state: "", bars: 0 };
}

// The menu's state for a network from its connectState.
function _netState(cs) {
    cs = String(cs || "");
    return cs === "associating" || cs === "associated" ? "connecting"
         : cs === "ipConfigured" || cs === "ipFailed" || cs === "associationFailed" ? cs : "";
}

// findnetworks / getNetworks: foundNetworks [{networkInfo: {ssid,
// availableSecurityTypes, signalBars, profileId?, connectState?}}]
// (wifi_service.c:930-1000; LunaSysMgr's wifiAvailableNetworksListCallback,
// :3044-3116, read securityType, which OSE names availableSecurityTypes).
// status: wifiStatus()'s, so the network being joined shows so. Returns
// SimSystemStatus's wifiNetworks: [{ssid, bars, security ("" open), known,
// state, profileId}], in the service's order (connman's: the strongest
// first), or null.
function wifiNetworks(reply, status) {
    if (!reply || reply.returnValue === false || !Array.isArray(reply.foundNetworks))
        return null;
    var out = [];
    var seen = {};
    reply.foundNetworks.forEach(function (f) {
        var n = f && f.networkInfo ? f.networkInfo : f;
        if (!n || typeof n.ssid !== "string" || n.ssid === "" || seen[n.ssid])
            return;
        seen[n.ssid] = true;
        var sec = Array.isArray(n.availableSecurityTypes) && n.availableSecurityTypes.length ? n.availableSecurityTypes[0]
                : typeof n.securityType === "string" ? n.securityType : "";
        if (sec === "none")
            sec = "";
        var state = _netState(n.connectState);
        if (status && status.ssid === n.ssid && status.state !== "")
            state = status.state;
        out.push({ ssid: n.ssid, bars: _num(n.signalBars) ? Math.max(0, Math.min(3, n.signalBars)) : 0, security: sec,
                   known: _num(n.profileId) && n.profileId > 0, state: state, profileId: _num(n.profileId) ? n.profileId : 0 });
    });
    return out;
}

// connect's parameters for a network of the list (LunaSysMgr's
// connectToWifiNetwork, :3118-3141: a stored profile by its id, else the
// ssid; the menu sends a secured network without a profile to Settings, as
// SystemMenu::slotWifiNetworkSelected did, :359-391). null: not to join here.
function wifiConnectParams(network) {
    if (!network)
        return null;
    if (network.profileId > 0)
        return { profileId: network.profileId };
    if (network.security === "")
        return { ssid: network.ssid, wasCreatedWithJoinOther: false };
    return null;
}

// ---- Bluetooth (OSE's com.webos.service.bluetooth2) ------------------------------
// adapter/getStatus {subscribe}: adapters [{powered, ...}]
// (bluetoothmanagerservice.cpp:840-867). Returns {on} or null.
function bluetoothAdapter(reply) {
    if (!reply || reply.returnValue === false || !Array.isArray(reply.adapters))
        return null;
    var on = reply.adapters.some(function (a) { return a && a.powered === true; });
    return { on: on };
}

// device/getStatus {subscribe}: devices [{name, address, paired,
// connectedProfiles: [...]}] (bluetoothmanageradapter.cpp:820-850). The
// menu lists the paired ("trusted") ones (LunaSysMgr asked
// gap/gettrusteddevices, :2436-2571); a device with a profile connected is
// "connected". pending: address -> "connecting" / "connectfailed" (what the
// menu asked and the service has not answered yet). Returns
// SimSystemStatus's bluetoothDevices or null.
function bluetoothDevices(reply, pending) {
    if (!reply || reply.returnValue === false || !Array.isArray(reply.devices))
        return null;
    pending = pending || {};
    return reply.devices.filter(function (d) { return d && d.paired === true && typeof d.address === "string"; })
        .map(function (d) {
            var connected = Array.isArray(d.connectedProfiles) && d.connectedProfiles.length > 0;
            var state = connected ? "connected" : pending[d.address] || "disconnected";
            return { name: d.name || d.address, address: d.address, state: state };
        });
}

// ---- VPN (com.webos.service.vpn, LuneOS's luneos-vpn-adapter) ---------------------
// getProfileList {subscribe}: vpnProfiles [{vpnProfileName,
// vpnProfileConnectState: connected | connecting | disconnecting |
// disconnected}] (vpn_service.c; the runtime simulates it wire for wire).
// Returns SimSystemStatus's vpnProfiles or null.
function vpnProfiles(reply) {
    if (!reply || reply.returnValue === false || !Array.isArray(reply.vpnProfiles))
        return null;
    return reply.vpnProfiles.filter(function (p) { return p && typeof p.vpnProfileName === "string"; })
        .map(function (p) {
            var s = p.vpnProfileConnectState;
            return { name: p.vpnProfileName,
                     state: s === "connected" || s === "connecting" ? s : "disconnected" };
        });
}

// ---- Telephony (com.palm.telephony, where a device has a modem) -------------------
// OSE has no telephony service; a modem's (LuneOS's, or one written for the
// device) would answer webOS 2's API, which LunaSysMgr read
// (StatusBarServicesConnector.cpp):
//   ttyQuery {subscribe}  extended.mode "full": TTY on (:1463-1497)
//   hacQuery {subscribe}  extended.enabled: HAC on (:1507-1540)
//   forwardQuery          unconditional call forwarding (:1980-2050)
//   networkStatusQuery / subscribe {events: "network"}: extended.state and
//                         registration, extended.roaming (:1049-1169)
// Each returns the changes or null.
function telephonyTty(reply) {
    var e = reply && reply.returnValue !== false && reply.extended;
    return e && typeof e === "object" && typeof e.mode === "string" ? { tty: e.mode === "full" } : null;
}
// forwardQuery {condition: "unconditional", subscribe}
// (callForwardRequestCallback, :1980-2050): extended.condition
// "unconditional" or "allforwarding", and the first status whose bearer is
// "voice", "default" or "defaultbearer" says whether it is activated.
// Returns {callForwarding} or null.
function callForward(reply) {
    var e = reply && reply.returnValue === true && reply.extended;
    if (!e || typeof e !== "object" || (e.condition !== "unconditional" && e.condition !== "allforwarding")
        || !Array.isArray(e.status))
        return null;
    for (var i = 0; i < e.status.length; ++i) {
        var s = e.status[i];
        if (s && typeof s.activated === "boolean" && ["voice", "default", "defaultbearer"].indexOf(s.bearer) >= 0)
            return { callForwarding: s.activated };
    }
    return null;
}
function telephonyHac(reply) {
    var e = reply && reply.returnValue !== false && reply.extended;
    return e && typeof e === "object" ? { hac: e.enabled === true } : null;
}
// A network event ({eventNetwork: {...}}) or networkStatusQuery's reply
// ({extended: {...}}) (telephonyNetworkEventsCallback, :981-1037;
// handleNetworkStatus, :1049-1169): state "service" with registration
// "home" (not roaming) or "roaming" / "roamblink" (roaming), and the
// carrier's networkName; "noservice" and "limited" are not roaming.
// Returns {roaming?, carrier?} or null.
function telephonyNetwork(reply) {
    if (!reply || reply.returnValue === false)
        return null;
    var e = reply.eventNetwork && typeof reply.eventNetwork === "object" ? reply.eventNetwork
          : reply.extended && typeof reply.extended === "object" ? reply.extended : null;
    if (!e || typeof e.state !== "string")
        return null;
    var out = {};
    if (e.state === "service") {
        if (typeof e.networkName === "string" && e.networkName !== "")
            out.carrier = e.networkName;
        if (e.registration === "home")
            out.roaming = false;
        else if (e.registration === "roaming" || e.registration === "roamblink")
            out.roaming = true;
    } else if (e.state === "noservice" || e.state === "limited") {
        out.roaming = false;
    }
    return Object.keys(out).length ? out : null;
}

// The mobile data connection (com.palm.wan getstatus {subscribe},
// wanStatusEventsCallback, :1599-1700, getWanIndex, :1702-1731): attached,
// with a connected service carrying "internet" whose connectstatus is
// "active" (connected) or "dormant", and dataaccess "usable": the icon of
// its networktype ("1x", "edge", "evdo", "gprs", "umts", "hsdpa",
// "hspa-4g"; dormant only for 1x and evdo); anything else, none. Returns
// {wanType: "" (none) or the type, wanDormant} or null.
function wanStatus(reply) {
    if (!reply || reply.returnValue === false || typeof reply.networkstatus !== "string")
        return null;
    var none = { wanType: "", wanDormant: false };
    if (reply.networkstatus !== "attached" || !Array.isArray(reply.connectedservices))
        return none;
    var type = typeof reply.networktype === "string" ? reply.networktype : "";
    for (var i = 0; i < reply.connectedservices.length; ++i) {
        var c = reply.connectedservices[i];
        if (!c || !Array.isArray(c.service) || c.service.indexOf("internet") < 0)
            continue;
        if (reply.dataaccess !== "usable")
            return none;
        if (c.connectstatus === "active")
            return ["1x", "edge", "evdo", "gprs", "umts", "hsdpa", "hspa-4g"].indexOf(type) >= 0
                ? { wanType: type, wanDormant: false } : none;
        if (c.connectstatus === "dormant")
            return type === "1x" || type === "evdo" ? { wanType: type, wanDormant: true } : none;
        return none;
    }
    return none;
}

// ---- Orientation (phoenix-devices' com.palm.display/phoenix/orientation) --------
// {orientation: "up" | "down" | "left" | "right" | "faceup" | "facedown"}.
function orientation(reply) {
    var o = reply && reply.orientation;
    return ["up", "down", "left", "right", "faceup", "facedown"].indexOf(o) >= 0 ? o : null;
}
