// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device shell's Phoenix.Lsm types over fake luna-surfacemanager modules
// (fakes/: the bus, LS, LaunchPointsModel, WebOS keys) and fake card
// surfaces with WebAppMgr's window properties:
//
//   QT_QPA_PLATFORM=offscreen qmltestrunner -import shell/qml -import build/qml \
//       -import shell/tests-device/fakes -input shell/tests-device
//
// (Not under shell/tests: those run without the fakes.)

import QtQuick
import QtTest
import WebOSServices 1.0
import Phoenix.Lsm

Item {
    id: root
    width: 400
    height: 600

    // A card surface as WebAppMgr makes it (WebOSSurfaceItem's appId, title,
    // windowProperties and windowPropertiesChanged).
    component FakeSurface: Item {
        property string appId: ""
        property string title: ""
        // Its change signal is windowPropertiesChanged, as WebOSSurfaceItem's NOTIFY.
        property var windowProperties: ({})
        property bool closed: false
        function close() { closed = true; }
        function setProperty(k, v) {
            var p = {};
            for (var x in windowProperties)
                p[x] = windowProperties[x];
            p[k] = v;
            windowProperties = p;
        }
    }
    Component {
        id: surface
        FakeSurface {}
    }
    function wam(appId, extra) {
        var p = { appId: appId, instanceId: "1", launchingAppId: "com.webos.surfacemanager", title: appId,
                  _WEBOS_ACCESS_POLICY_KEYS_BACK: "true" };
        for (var k in extra || {})
            p[k] = extra[k];
        return surface.createObject(root, { appId: appId, title: appId, windowProperties: p });
    }

    LsmWindowSource { id: windows }
    LsmSystemStatus { id: status }

    SignalSpy { id: focusSpy; target: windows; signalName: "cardFocusRequested" }
    SignalSpy { id: returnSpy; target: windows; signalName: "cardReturnRequested" }
    SignalSpy { id: unhandledSpy; target: windows; signalName: "backUnhandled" }

    TestCase {
        name: "LsmWindowSource"
        when: windowShown

        function init() {
            focusSpy.clear();
            returnSpy.clear();
            unhandledSpy.clear();
        }

        function test_cardsFromSurfaces() {
            var email = wam("org.webosphoenix.email");
            var uid = windows._adopt(email);
            compare(windows.cards.count, 1);
            compare(focusSpy.count, 1);
            compare(windows.cards.get(0).orientation, "free");
            compare(windows.cards.get(0).statusBarColor, -1);
            compare(windows.windowFor(uid).surface, email);
            // Launched by the card in front (Email): into its stack.
            windows.focusedUid = uid;
            var browser = wam("com.palm.app.browser", { launchingAppId: "org.webosphoenix.email" });
            var b = windows._adopt(browser);
            compare(windows.cards.get(1).uid, b);
            compare(windows.cards.get(1).groupId, windows.cards.get(0).groupId);
            // The shell's own launch: a stack of its own.
            windows.focusedUid = "";
            var music = wam("org.webosphoenix.music");
            windows._adopt(music);
            verify(windows.cards.get(2).groupId !== windows.cards.get(0).groupId);
            // The page's requests.
            music.setProperty("phoenixFullScreen", "true");
            music.setProperty("phoenixStatusBarColor", String(0x224466));
            music.setProperty("phoenixOrientation", "landscape");
            compare(windows.cards.get(2).fullScreen, true);
            compare(windows.cards.get(2).statusBarColor, 0x224466);
            compare(windows.cards.get(2).orientation, "landscape");
            [email, browser, music].forEach(function(s) { windows.removeSurface(s); s.destroy(); });
            compare(windows.cards.count, 0);
        }

        function test_back() {
            var assistant = wam("org.webosphoenix.assistant");
            var a = windows._adopt(assistant);
            var photos = wam("org.webosphoenix.photos", { launchingAppId: "org.webosphoenix.assistant",
                                                          phoenixReturnTo: "org.webosphoenix.assistant" });
            var p = windows._adopt(photos);
            // The page takes Back: the key goes to it, the shell waits.
            compare(windows.back(p), true);
            compare(returnSpy.count, 0);
            // It did not take it: back to the caller.
            photos.setProperty("phoenixBack", "1-1");
            compare(returnSpy.count, 1);
            compare(returnSpy.signalArguments[0][0], a);
            compare(returnSpy.signalArguments[0][1], p);
            // The same answer again is not news.
            photos.setProperty("title", "Photos");
            compare(returnSpy.count, 1);
            // WebAppMgr: the page cannot take it; no caller: minimize now.
            assistant.setProperty("_WEBOS_ACCESS_POLICY_KEYS_BACK", "false");
            compare(windows.back(a), false);
            // A page without a caller that did not take it: backUnhandled.
            assistant.setProperty("phoenixBack", "2-1");
            compare(unhandledSpy.count, 1);
            compare(unhandledSpy.signalArguments[0][0], a);
            [assistant, photos].forEach(function(s) { windows.removeSurface(s); s.destroy(); });
        }

        function test_launchAndStatusGoToTheBus() {
            FakeBus.clear();
            windows.launch("org.webosphoenix.memos", "", null);
            var l = FakeBus.last("com.webos.applicationManager", "/launch");
            verify(l);
            compare(l.params.id, "org.webosphoenix.memos");
            windows.pushSystemStatus({ deviceLocked: false, firstUse: true });
            var r = FakeBus.last("com.palm.systemmanager", "/phoenix/report");
            compare(JSON.stringify(r.params), JSON.stringify({ deviceLocked: false }));
        }

        function test_soundsPlayTheirPcmTwins() {
            FakeBus.clear();
            var h = windows.playSound("/usr/palm/sounds/ringtone.mp3", "ringtones", true, -1, 1, "/usr/palm/sounds/notification.wav");
            var c = FakeBus.last("com.webos.service.audio", "/playSound");
            compare(c.params.fileName, "/usr/palm/sounds/ringtone.mp3.pcm");
            compare(c.params.sink, "pringtones");
            compare(c.params.format, "PA_SAMPLE_S16LE");
            compare(c.params.sampleRate, 44100);
            compare(c.params.channels, 2);
            FakeBus.reply("com.webos.service.audio", "/playSound", { returnValue: true, playbackId: "p1" });
            // It loops: when audiod says it stopped, it plays again.
            var st = FakeBus.last("com.webos.service.audio", "/getPlaybackStatus");
            compare(st.params.playbackId, "p1");
            FakeBus.reply("com.webos.service.audio", "/getPlaybackStatus", { returnValue: true, playbackStatus: "stopped" });
            compare(FakeBus.find("com.webos.service.audio", "/playSound").length, 2);
            FakeBus.reply("com.webos.service.audio", "/playSound", { returnValue: true, playbackId: "p2" });
            windows.stopSound(h);
            var stop = FakeBus.last("com.webos.service.audio", "/controlPlayback");
            compare(stop.params.playbackId, "p2");
            compare(stop.params.requestType, "stop");
            // A sound without a twin: the fallback's.
            FakeBus.clear();
            windows.playSound("/media/internal/ringtones/Mine.mp3", "alerts", false, -1, 1, "/usr/palm/sounds/alert.wav");
            FakeBus.reply("com.webos.service.audio", "/playSound", { returnValue: false, errorCode: 19, errorText: "Invalid Params" });
            compare(FakeBus.last("com.webos.service.audio", "/playSound").params.fileName, "/usr/palm/sounds/alert.wav.pcm");
            // A duration: stopped after it.
            FakeBus.clear();
            windows.playSound("/usr/palm/sounds/notification.wav", "notifications", false, 50, 1, "");
            FakeBus.reply("com.webos.service.audio", "/playSound", { returnValue: true, playbackId: "p3" });
            tryVerify(function() { var s = FakeBus.last("com.webos.service.audio", "/controlPlayback"); return s && s.params.playbackId === "p3"; }, 1000);
        }
    }

    TestCase {
        name: "LsmSystemStatus"
        when: windowShown

        function test_wifi() {
            FakeBus.replyAll("com.webos.service.wifi", "/getstatus", { returnValue: true, status: "serviceEnabled" });
            compare(status.wifiBars, 0);
            status.scanWifi();
            verify(status.wifiScanning);
            FakeBus.reply("com.webos.service.wifi", "/findnetworks", { returnValue: true, foundNetworks: [
                { networkInfo: { ssid: "Home", availableSecurityTypes: ["psk"], signalBars: 3, profileId: 4 } },
                { networkInfo: { ssid: "Cafe", availableSecurityTypes: ["none"], signalBars: 1 } } ] });
            verify(!status.wifiScanning);
            compare(status.wifiNetworks.length, 2);
            status.connectWifi("Home");
            compare(FakeBus.last("com.webos.service.wifi", "/connect").params.profileId, 4);
            compare(status.wifiNetworks[0].state, "connecting");
            FakeBus.replyAll("com.webos.service.wifi", "/getstatus", { returnValue: true, status: "connectionStateChanged",
                                                                        networkInfo: { ssid: "Home", connectState: "ipConfigured", signalBars: 2 } });
            compare(status.wifiBars, 2);
            compare(status.wifiSsid, "Home");
            status.setWifiOn(false);
            compare(FakeBus.last("com.webos.service.wifi", "/setstate").params.state, "disabled");
            FakeBus.replyAll("com.webos.service.wifi", "/getstatus", { returnValue: true, status: "serviceDisabled" });
            compare(status.wifiBars, -1);
            compare(status.wifiNetworks.length, 0);
        }

        function test_bluetoothAndVpn() {
            status.setBluetoothOn(true);
            verify(status.bluetoothTurningOn);
            compare(FakeBus.last("com.webos.service.bluetooth2", "/adapter/setState").params.powered, true);
            FakeBus.replyAll("com.webos.service.bluetooth2", "/adapter/getStatus", { returnValue: true, adapters: [{ powered: true }] });
            verify(status.bluetoothOn && !status.bluetoothTurningOn);
            FakeBus.replyAll("com.webos.service.bluetooth2", "/device/getStatus", { returnValue: true, devices: [
                { name: "Car Kit", address: "00:11", paired: true, connectedProfiles: [] } ] });
            compare(status.bluetoothPairedCount, 1);
            status.connectBluetooth("00:11");
            compare(status.bluetoothDevices[0].state, "connecting");
            compare(FakeBus.last("com.webos.service.bluetooth2", "/a2dp/connect").params.address, "00:11");
            FakeBus.replyAll("com.webos.service.bluetooth2", "/device/getStatus", { returnValue: true, devices: [
                { name: "Car Kit", address: "00:11", paired: true, connectedProfiles: ["a2dp"] } ] });
            compare(status.bluetoothDevice, "Car Kit");
            FakeBus.replyAll("com.webos.service.vpn", "/getProfileList", { returnValue: true, vpnProfiles: [
                { vpnProfileName: "Office", vpnProfileConnectState: "disconnected" } ] });
            status.connectVpn("Office");
            compare(FakeBus.last("com.webos.service.vpn", "/connect").params.vpnProfileName, "Office");
            compare(status.vpnProfiles[0].state, "connecting");
        }

        function test_preferencesAndModem() {
            FakeBus.replyAll("com.webos.service.systemservice", "/getPreferences", {
                returnValue: true, subscribed: true, startupAnimation: "classic", animationSpeed: "fast", rotationLock: "left",
                ringtone: { name: "Pre", fullPath: "/media/internal/ringtones/Pre.mp3" }, timeFormat: "HH24" });
            compare(status.tweaks.startupAnimation, "classic");
            compare(status.tweaks.animationSpeed, "fast");
            verify(status.rotationLocked);
            compare(status.rotationLockOrientation, "left");
            compare(status.ringtone, "/media/internal/ringtones/Pre.mp3");
            verify(status.twentyFourHour);
            // The shell unlocks the rotation: saved as the preference.
            FakeBus.clear();
            status.rotationLocked = false;
            compare(FakeBus.last("com.webos.service.systemservice", "/setPreferences").params.rotationLock, false);
            // The volume: audiod's, and the slider's back to it.
            FakeBus.replyAll("com.webos.service.audio", "/master/getVolume", { returnValue: true, volumeStatus: { volume: 35, muted: false } });
            compare(status.volume, 35);
            status.volume = 50;
            compare(FakeBus.last("com.webos.service.audio", "/master/setVolume").params.volume, 50);
            // A modem's indicators, where there is one.
            FakeBus.replyAll("com.palm.telephony", "/ttyQuery", { returnValue: true, extended: { mode: "full" } });
            FakeBus.replyAll("com.palm.wan", "/getstatus", { returnValue: true, networkstatus: "attached", networktype: "umts",
                                                              dataaccess: "usable", connectedservices: [{ service: ["internet"], connectstatus: "active" }] });
            verify(status.tty);
            compare(status.wanType, "umts");
            FakeBus.replyAll("com.palm.display", "/phoenix/orientation", { returnValue: true, orientation: "right" });
            compare(status.deviceOrientation, "right");
        }
    }
}
