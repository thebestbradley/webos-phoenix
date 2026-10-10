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
        function isProxy() { return false; }
        function isPartOfGroup() { return false; }
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

        function test_systemUiStartsHidden() {
            FakeBus.clear();
            windows.startBootApps();
            var boot = FakeBus.find("com.webos.applicationManager", "/launch").filter(function(c) { return c.params.id === "com.palm.systemui"; });
            compare(boot.length, 1);
            compare(boot[0].params.preload, "partial");
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

        // ---- The pages' messages (org.webosphoenix.shellhost) ------------------------

        // A page's message as the relay hands it to the shell.
        function post(appId, type, payload) {
            return FakeBus.reply("org.webosphoenix.shellhost", "/listen",
                                 { returnValue: true, subscribed: true, message: { appId: appId, type: type, payload: payload || {} } });
        }
        function sent(type) {
            return FakeBus.find("org.webosphoenix.shellhost", "/send").filter(function(c) { return !type || c.params.type === type; });
        }

        function test_pagesMessagesReachTheShell() {
            var l = FakeBus.last("org.webosphoenix.shellhost", "/listen");
            verify(l && l.params.subscribe === true, "the shell listens to the pages from its start");
            windows.apps.append({ appId: "com.palm.app.email", title: "Email", icon: "file:///usr/palm/applications/com.palm.app.email/icon.png",
                                  largeIcon: "", color: "#336699", glyph: "E", tab: 0, quickLaunch: 0 });
            // Banners: the page's, with its app id from the bus, never the payload's.
            bannerSpy.clear();
            verify(post("com.palm.app.email", "banner", { id: "b1", appId: "com.evil", message: "2 new messages", params: "{\"f\":1}",
                                                          icon: "/usr/palm/applications/com.palm.app.email/images/n.png",
                                                          soundClass: "notifications", soundFile: "", duration: 0 }));
            compare(bannerSpy.count, 1);
            compare(bannerSpy.signalArguments[0][0], "com.palm.app.email");
            compare(bannerSpy.signalArguments[0][1], "2 new messages");
            compare(String(bannerSpy.signalArguments[0][2]), "file:///usr/palm/applications/com.palm.app.email/images/n.png");
            compare(bannerSpy.signalArguments[0][3], "{\"f\":1}");
            compare(bannerSpy.signalArguments[0][7], "b1");
            post("com.palm.app.email", "removeBanner", { id: "b1" });
            compare(removedSpy.count, 1);
            compare(removedSpy.signalArguments[0][1], "b1");
            post("com.palm.app.email", "sound", { soundClass: "alerts", soundFile: "/usr/palm/sounds/alert.wav", duration: 5 });
            compare(soundSpy.signalArguments[0][2], "/usr/palm/sounds/alert.wav");

            // Notifications: tagged ones replace each other; ongoing ones stay on top.
            var before = windows.notifications.count;
            post("com.palm.app.email", "notification", { title: "Ada", body: "Lunch?", tag: "t1", params: { id: 7 } });
            post("com.palm.app.email", "notification", { title: "Ada", body: "Lunch today?", tag: "t1" });
            compare(windows.notifications.count, before + 1);
            compare(windows.notifications.get(windows.notifications.count - 1).body, "Lunch today?");
            compare(windows.notifications.get(windows.notifications.count - 1).color, "#336699");
            post("com.palm.app.email", "ongoing", { id: "sync", title: "Syncing", progress: 40 });
            compare(windows.notifications.get(0).id, "ongoing:com.palm.app.email:sync");
            compare(windows.notifications.get(0).progress, 40);
            post("com.palm.app.email", "ongoing", { id: "sync", clear: true });
            post("com.palm.app.email", "notification", { tag: "t1", remove: true });
            compare(windows.notifications.count, before);

            // The active-call banner is its app's alone.
            post("org.webosphoenix.phone", "activeCallBanner", { op: "add", message: "Ada", startTime: 5 });
            compare(windows.activeCallBanner.message, "Ada");
            post("com.palm.app.email", "activeCallBanner", { op: "remove" });
            verify(windows.activeCallBanner !== null);
            post("org.webosphoenix.phone", "activeCallBanner", { op: "remove" });
            compare(windows.activeCallBanner, null);

            // OSE's own toasts (notificationmgr) are banners too.
            bannerSpy.clear();
            FakeBus.reply("com.webos.notification", "/getToastNotification", { returnValue: true, sourceId: "com.webos.app.settings",
                          message: "Updated", title: "", iconUrl: "file:///usr/share/icon.png",
                          action: { launchParams: { id: "com.webos.app.settings", params: { page: "about" } } } });
            compare(bannerSpy.count, 1);
            compare(bannerSpy.signalArguments[0][0], "com.webos.app.settings");
            compare(bannerSpy.signalArguments[0][3], "{\"page\":\"about\"}");
        }

        function test_editPopupAndEventsGoToThePage() {
            FakeBus.clear();
            var memos = wam("com.palm.app.memos");
            memos.width = 320;
            memos.height = 480;
            var uid = windows._adopt(memos);
            var host = windows.windowFor(uid);
            // In a card, as the shell shows it.
            host.parent = root;
            host.width = 160;
            host.height = 240;
            // The page's selection, in its CSS pixels (a 320-wide viewport).
            post("com.palm.app.memos", "editMenu", { x: 100, y: 200, width: 40, height: 20, viewportWidth: 320,
                                                     canSelectAll: true, canCut: true, canCopy: true, canPaste: true });
            var popup = host.editPopupItem;
            verify(popup.visible);
            compare(popup.target.x, 50);
            compare(popup.target.y, 100);
            compare(popup.actions.length, 4);
            popup.triggered("copy");
            var s = sent("editAction");
            compare(s.length, 1);
            compare(s[0].params.appId, "com.palm.app.memos");
            compare(s[0].params.payload.action, "copy");
            // The card in front: its page hears it.
            windows.focusedUid = uid;
            compare(sent("cardActivation")[0].params.payload.active, true);
            windows.focusedUid = "";
            compare(sent("cardActivation")[1].params.payload.active, false);
            // The app menu, and a scene's snapshot.
            verify(windows.appMenu(uid));
            compare(sent("openAppMenu")[0].params.appId, "com.palm.app.memos");
            sceneSpy.clear();
            post("com.palm.app.memos", "sceneTransition", { op: "prepare", isPop: false });
            compare(sceneSpy.count, 1);
            compare(sceneSpy.signalArguments[0][0], uid);
            windows.sceneTransitionPrepared(uid);
            compare(sent("sceneTransitionPrepared").length, 1);
            // The Assistant's on-device model: no engine here, said so.
            post("org.webosphoenix.assistant", "assistant", { op: "speechStatus", requestId: "r1" });
            var a = sent("assistantHostEvent")[0];
            compare(a.params.appId, "org.webosphoenix.assistant");
            compare(a.params.payload.requestId, "r1");
            compare(a.params.payload.available, false);
            windows.removeSurface(memos);
            memos.destroy();
        }

        function test_mediaKeyIsPressedByPhoenixDevices() {
            FakeBus.clear();
            post("org.webosphoenix.assistant", "mediaKey", { key: "pause" });
            compare(FakeBus.last("com.palm.display", "/phoenix/report").params.mediaKey, "pause");
        }

        function test_shutdownFromPowerd() {
            shutdownSpy.clear();
            FakeBus.replyAll("com.palm.display", "/phoenix/requests", { returnValue: true, shutdown: { reason: "power menu" } });
            compare(shutdownSpy.count, 1);
            compare(shutdownSpy.signalArguments[0][0], "power menu");
        }

        function test_usageTicksGoToTheBatteryService() {
            FakeBus.clear();
            windows.pushSystemStatus({ usageTick: { appId: "com.palm.app.email", ms: 60000, at: 5 } });
            var c = FakeBus.last("org.webosphoenix.battery", "/phoenix/usageTick");
            compare(c.params.appId, "com.palm.app.email");
            compare(c.params.ms, 60000);
        }

        function test_justTypeIsThePagesSurface() {
            FakeBus.clear();
            jtSpy.clear();
            var host = windows.justTypeWindow();
            verify(host);
            compare(FakeBus.last("com.webos.applicationManager", "/launch").params.preload, "partial");
            compare(windows.justTypeWindow(), host);
            var page = wam("com.palm.launcher");
            var cards = windows.cards.count;
            windows.addSurface(page);
            compare(host.surface, page);
            compare(windows.cards.count, cards);
            var done = false;
            windows.justTypeStart("p", function() { done = true; });
            verify(done);
            var start = sent("justType");
            compare(start[start.length - 1].params.appId, "com.palm.launcher");
            compare(start[start.length - 1].params.payload.text, "p");
            windows.justTypeType("hoe");
            compare(sent("justType").pop().params.payload, { op: "type", text: "hoe" });
            // An app it launches: its card comes, Just Type goes.
            var app = wam("org.webosphoenix.phone");
            var uid = windows._adopt(app);
            compare(jtSpy.count, 1);
            windows.justTypeStop();
            compare(sent("justType").pop().params.payload.op, "stop");
            post("com.palm.launcher", "justTypeDismiss", {});
            compare(jtSpy.count, 2);
            post("com.evil", "justTypeDismiss", {});
            compare(jtSpy.count, 2);
            windows.removeSurface(page);
            compare(host.surface, null);
            windows.removeSurface(app);
            [page, app].forEach(function(x) { x.destroy(); });
        }

        function test_screenCapturesAreFiled() {
            FakeBus.clear();
            var before = windows.notifications.count;
            windows.saveScreenshot("iVBORw0KGgo=", "Memos", "capture-1");
            var mk = FakeBus.last("org.webosphoenix.filemanager", "/mkdir");
            compare(mk.params.path, "/media/internal/screencaptures");
            FakeBus.reply("org.webosphoenix.filemanager", "/mkdir", { returnValue: false, errorCode: 2 });
            var w = FakeBus.last("org.webosphoenix.filemanager", "/write");
            verify(/^\/media\/internal\/screencaptures\/Memos \d{4}-\d\d-\d\d at \d\d\.\d\d\.\d\d\.png$/.test(w.params.path), w.params.path);
            compare(w.params.encoding, "base64");
            compare(w.params.data, "iVBORw0KGgo=");
            FakeBus.reply("org.webosphoenix.filemanager", "/write", { returnValue: true, path: w.params.path, size: 8 });
            compare(windows.notifications.count, before + 1);
            var n = windows.notifications.get(windows.notifications.count - 1);
            compare(n.appId, "org.webosphoenix.screenshot");
            compare(JSON.parse(n.params).capture, "capture-1");
            windows.notifications.remove(windows.notifications.count - 1);
        }
    }
    SignalSpy { id: bannerSpy; target: windows; signalName: "bannerRequested" }
    SignalSpy { id: removedSpy; target: windows; signalName: "bannerRemoved" }
    SignalSpy { id: soundSpy; target: windows; signalName: "soundRequested" }
    SignalSpy { id: sceneSpy; target: windows; signalName: "sceneTransitionRequested" }
    SignalSpy { id: shutdownSpy; target: windows; signalName: "shutdownRequested" }
    SignalSpy { id: jtSpy; target: windows; signalName: "justTypeDismissed" }

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

        function test_batteryFromPowerd() {
            var q = FakeBus.last("com.palm.power", "/com/palm/power/batteryStatusQuery");
            verify(q, "the battery is asked of powerd");
            verify(FakeBus.find("com.webos.service.bus", "/signal/addmatch").some(function(c) {
                return c.params.category === "/com/palm/power" && c.params.method === "batteryStatus"; }), "and its signal followed");
            FakeBus.reply("com.palm.power", "/com/palm/power/batteryStatusQuery", { returnValue: true, percent: 42, percent_ui: 41, temperature_C: 30 });
            compare(status.batteryPercent, 41);
            FakeBus.reply("com.palm.power", "/com/palm/power/chargerStatusQuery", { returnValue: true, Charging: false, Connected: false, type: "none" });
            verify(!status.charging);
            compare(status.charger, "none");
            // The signal: a wall charger in.
            FakeBus.replyAll("com.webos.service.bus", "/signal/addmatch", { Charging: true, Connected: true, USBConnected: true, type: "wall",
                                                                           DockConnected: false });
            verify(status.charging);
            compare(status.charger, "wall");
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
