// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device status's reading of OSE's services (Phoenix.Lsm LsmStatus.js),
// driven with replies in the shapes the services' sources send (cited in
// LsmStatus.js): Wi-Fi (webos-connman-adapter), Bluetooth (bluetooth2), VPN
// (luneos-vpn-adapter), a modem's telephony and WAN (webOS 2's API, as
// LunaSysMgr read it), audiod's volume, the system preferences (tones,
// rotation lock, Settings > Advanced) and the start-up preferences file.
// LsmSystemStatus itself needs luna-surfacemanager's QML modules, which only
// a device has.

import QtQuick
import QtTest
import "../qml/Phoenix/Lsm/LsmStatus.js" as LsmStatus

TestCase {
    name: "LsmStatus"

    function test_tweaksAreTheRuntimes() {
        var d = LsmStatus.tweaks({});
        compare(d.startupAnimation, "phoenix");
        compare(d.animationSpeed, "normal");
        compare(d.waveLauncher, true);
        compare(d.keyboardButton, true);
        compare(d.keyboardButtonY, 1);
        var t = LsmStatus.tweaks({ startupAnimation: "classic", animationSpeed: "fast", sysUiEnableWaveLauncher: false,
                                   infiniteCardCyclingEnabled: true, launcherGridDensity: "dense", keyboardButtonY: 0.25,
                                   keyboardStyle: "nonsense" });
        compare(t.startupAnimation, "classic");
        compare(t.animationSpeed, "fast");
        compare(t.waveLauncher, false);
        compare(t.infiniteCardCycling, true);
        compare(t.gridDensity, "dense");
        compare(t.keyboardButtonY, 0.25);
        compare(t.keyboardStyle, "auto");
        // Every tweak the shell has a default for is read (Shell.tweakDefaults).
        compare(Object.keys(d).length, LsmStatus.tweakKeys.length);
    }

    function test_prefsArriveOneKeyAtATime() {
        // luna-sysservice posts each change as {key: value} (PrefsFactory.cpp:370).
        var p = LsmStatus.mergePrefs({}, { returnValue: true, subscribed: true, animationSpeed: "fast", unrelated: 1 });
        compare(p.animationSpeed, "fast");
        compare(p.unrelated, undefined);
        p = LsmStatus.mergePrefs(p, { startupAnimation: "classic" });
        compare(p.animationSpeed, "fast");
        compare(p.startupAnimation, "classic");
        var back = LsmStatus.prefsForTweaks({ infiniteCardCycling: true, keyboardButtonY: 0.5 });
        compare(back.infiniteCardCyclingEnabled, true);
        compare(back.keyboardButtonY, 0.5);
    }

    function test_startupFile() {
        var p = LsmStatus.startupPrefs(JSON.stringify({ prefs: { startupAnimation: "classic", rotationLock: "left", other: 1 } }));
        compare(p.startupAnimation, "classic");
        compare(p.rotationLock, "left");
        compare(p.other, undefined);
        compare(LsmStatus.tweaks(p).startupAnimation, "classic");
        compare(JSON.stringify(LsmStatus.startupPrefs("")), "{}");
        compare(JSON.stringify(LsmStatus.startupPrefs("{broken")), "{}");
    }

    function test_rotationLock() {
        compare(LsmStatus.rotationLock({ rotationLock: "right" }).orientation, "right");
        compare(LsmStatus.rotationLock({ rotationLock: "right" }).locked, true);
        compare(LsmStatus.rotationLock({ rotationLock: true }).locked, true);
        compare(LsmStatus.rotationLock({ rotationLock: true }).orientation, "");
        compare(LsmStatus.rotationLock({ rotationLock: false }).locked, false);
        compare(LsmStatus.rotationLock({ other: 1 }), null);
        compare(LsmStatus.rotationLockPref(true, "up"), "up");
        compare(LsmStatus.rotationLockPref(true, ""), true);
        compare(LsmStatus.rotationLockPref(false, "up"), false);
    }

    function test_soundsAndVolume() {
        var s = LsmStatus.soundPrefs({ ringtone: { name: "Pre", fullPath: "/media/internal/ringtones/Pre.mp3" },
                                       systemSounds: false, x_palm_virtualkeyboard_prefs: { TapSounds: false } });
        compare(s.ringtone, "/media/internal/ringtones/Pre.mp3");
        compare(s.systemSounds, false);
        compare(s.tapSounds, false);
        compare(LsmStatus.soundPrefs({ returnValue: true }), null);
        var v = LsmStatus.masterVolume({ returnValue: true, volumeStatus: { muted: false, volume: 42, soundOutput: "pcm_output" } });
        compare(v.volume, 42);
        compare(LsmStatus.masterVolume({ returnValue: false }), null);
    }

    function test_wifiStatus() {
        compare(LsmStatus.wifiStatus({ returnValue: true, status: "serviceDisabled" }).bars, -1);
        var on = LsmStatus.wifiStatus({ returnValue: true, status: "serviceEnabled" });
        compare(on.on, true);
        compare(on.bars, 0);
        var joining = LsmStatus.wifiStatus({ returnValue: true, status: "connectionStateChanged",
                                             networkInfo: { ssid: "Home", connectState: "associating", signalBars: 3 } });
        compare(joining.state, "connecting");
        compare(joining.bars, 0);
        var up = LsmStatus.wifiStatus({ returnValue: true, status: "connectionStateChanged",
                                        networkInfo: { ssid: "Home", connectState: "ipConfigured", signalBars: 2 } });
        compare(up.ssid, "Home");
        compare(up.state, "ipConfigured");
        compare(up.bars, 2);
        // Connected with no bars yet: at least one (wifiEventsCallback's clamp).
        compare(LsmStatus.wifiStatus({ status: "connectionStateChanged", networkInfo: { ssid: "X", connectState: "ipConfigured", signalBars: 0 } }).bars, 1);
        compare(LsmStatus.wifiStatus({ returnValue: false }), null);
    }

    function test_wifiNetworks() {
        var reply = { returnValue: true, foundNetworks: [
            { networkInfo: { ssid: "Home", availableSecurityTypes: ["psk"], signalBars: 3, profileId: 2, connectState: "ipConfigured" } },
            { networkInfo: { ssid: "Cafe", availableSecurityTypes: ["none"], signalBars: 1 } },
            { networkInfo: { ssid: "Office", availableSecurityTypes: ["ieee8021x"], signalBars: 2 } },
            { networkInfo: { ssid: "Cafe", availableSecurityTypes: ["none"], signalBars: 1 } },
            { networkInfo: { ssid: "", signalBars: 1 } }
        ] };
        var list = LsmStatus.wifiNetworks(reply, null);
        compare(list.length, 3);
        compare(list[0].ssid, "Home");
        compare(list[0].known, true);
        compare(list[0].state, "ipConfigured");
        compare(list[0].security, "psk");
        compare(list[1].security, "");
        compare(list[1].known, false);
        // The network being joined, from getstatus.
        list = LsmStatus.wifiNetworks(reply, { on: true, ssid: "Cafe", state: "connecting", bars: 0 });
        compare(list[1].state, "connecting");
        // Joining: a stored profile by its id, an open network by its ssid,
        // a secured unknown one not here (Settings asks for its key).
        compare(LsmStatus.wifiConnectParams(list[0]).profileId, 2);
        compare(LsmStatus.wifiConnectParams(list[1]).ssid, "Cafe");
        compare(LsmStatus.wifiConnectParams(list[2]), null);
    }

    function test_bluetooth() {
        compare(LsmStatus.bluetoothAdapter({ returnValue: true, adapters: [{ powered: true, name: "x" }] }).on, true);
        compare(LsmStatus.bluetoothAdapter({ returnValue: true, adapters: [{ powered: false }] }).on, false);
        var devs = LsmStatus.bluetoothDevices({ returnValue: true, devices: [
            { name: "Car Kit", address: "00:11", paired: true, connectedProfiles: ["a2dp"] },
            { name: "Headset", address: "00:22", paired: true, connectedProfiles: [] },
            { name: "Stranger", address: "00:33", paired: false, connectedProfiles: [] }
        ] }, { "00:22": "connecting" });
        compare(devs.length, 2);
        compare(devs[0].state, "connected");
        compare(devs[1].state, "connecting");
    }

    function test_vpn() {
        var p = LsmStatus.vpnProfiles({ returnValue: true, vpnProfiles: [
            { vpnProfileName: "Office", vpnProfileConnectState: "connected" },
            { vpnProfileName: "Home", vpnProfileConnectState: "disconnecting" }
        ] });
        compare(p.length, 2);
        compare(p[0].state, "connected");
        compare(p[1].state, "disconnected");
    }

    function test_modem() {
        compare(LsmStatus.telephonyTty({ returnValue: true, extended: { mode: "full" } }).tty, true);
        compare(LsmStatus.telephonyTty({ returnValue: true, extended: { mode: "off" } }).tty, false);
        compare(LsmStatus.telephonyHac({ returnValue: true, extended: { enabled: true } }).hac, true);
        var n = LsmStatus.telephonyNetwork({ eventNetwork: { state: "service", registration: "roaming", networkName: "Carrier" } });
        compare(n.roaming, true);
        compare(n.carrier, "Carrier");
        compare(LsmStatus.telephonyNetwork({ returnValue: true, extended: { state: "service", registration: "home" } }).roaming, false);
        compare(LsmStatus.telephonyNetwork({ returnValue: true, extended: { state: "noservice" } }).roaming, false);
        compare(LsmStatus.callForward({ returnValue: true, extended: { condition: "unconditional",
                                         status: [{ bearer: "defaultbearer", activated: true }] } }).callForwarding, true);
        compare(LsmStatus.callForward({ returnValue: true, extended: { condition: "busy", status: [] } }), null);
        var wan = { returnValue: true, networkstatus: "attached", networktype: "hsdpa", dataaccess: "usable",
                    connectedservices: [{ service: ["internet"], connectstatus: "active" }] };
        compare(LsmStatus.wanStatus(wan).wanType, "hsdpa");
        wan.networktype = "evdo";
        wan.connectedservices[0].connectstatus = "dormant";
        compare(LsmStatus.wanStatus(wan).wanDormant, true);
        wan.networktype = "umts";
        compare(LsmStatus.wanStatus(wan).wanType, "");
        compare(LsmStatus.wanStatus({ returnValue: true, networkstatus: "notattached" }).wanType, "");
    }

    function test_orientation() {
        compare(LsmStatus.orientation({ orientation: "left" }), "left");
        compare(LsmStatus.orientation({ orientation: "faceup" }), "faceup");
        compare(LsmStatus.orientation({ orientation: "sideways" }), null);
    }
}
