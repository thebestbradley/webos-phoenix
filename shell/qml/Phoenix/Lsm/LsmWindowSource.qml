// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Window source backed by webOS OSE's luna-surfacemanager: card-type app
// surfaces become Phoenix cards, launch points become launcher icons.
// Implements the same interface as Phoenix.Sim.SimWindowSource.
//
// STATUS: experimental. Written against luna-surfacemanager 2.0.0-423
// (webOS OSE, Qt 6.8); it has not yet run on a device. See docs/ROADMAP.md.

import QtQuick
import WebOSCoreCompositor 1.0
import WebOSCompositorBase 1.0
import WebOSServices 1.0
import WebOS.Global 1.0
import Phoenix.Native
import "LsmCards.js" as LsmCards
import "../Shell/NotificationPolicy.js" as Policy

Item {
    id: source
    visible: false

    property ListModel apps: ListModel {}
    property ListModel cards: ListModel {}
    property ListModel notifications: ListModel {}

    // The shell connects to this to maximize a newly mapped card.
    signal cardFocusRequested(string uid)
    // Back in an app another one opened ({returnToCaller}): the caller's
    // card uid comes back to the front and fromUid goes behind it, as
    // SimWindowSource's (back(), and the page's phoenixBack below).
    signal cardReturnRequested(string uid, string fromUid)
    // The page in the card did not take the back gesture (its phoenixBack
    // window property): the shell minimizes the card (Shell._lateBackUnhandled).
    signal backUnhandled(string uid)

    // The card in front, maximized and focused ("" in card view): the shell
    // sets it (Shell.qml's Binding), and an app it launches joins its stack
    // (LsmCards.placement).
    property string focusedUid: ""

    property var _hosts: ({})       // uid -> SurfaceHost
    property var _surfaces: []      // [{ uid, item }]
    property int _nextUid: 1
    property int _nextGroup: 1
    property string _pendingAfterUid: ""

    function newGroupId() {
        return "g" + (_nextGroup++);
    }

    // ---- Apps ------------------------------------------------------------------

    LaunchPointsModel {
        id: launchPoints
        appId: LS.appId
    }

    // Copy launch points into a plain ListModel the shell can read with get().
    Instantiator {
        id: launchPointCopies
        model: launchPoints
        delegate: QtObject {
            required property string id
            required property string title
            required property string icon
        }
        onObjectAdded: rebuildApps.restart()
        onObjectRemoved: rebuildApps.restart()
    }

    Timer {
        id: rebuildApps
        interval: 0
        onTriggered: {
            source.apps.clear();
            for (var i = 0; i < launchPointCopies.count; ++i) {
                var lp = launchPointCopies.objectAt(i);
                if (!lp)
                    continue;
                source.apps.append({
                    appId: lp.id, title: lp.title, icon: lp.icon, largeIcon: "",
                    color: "#666666", glyph: lp.title.charAt(0),
                    tab: 0, quickLaunch: i < 4 ? i + 1 : 0
                });
            }
        }
    }

    // ---- Surfaces ------------------------------------------------------------------

    function isCard(item) {
        return item && !item.isProxy() && !item.isPartOfGroup()
               && item.type === "_WEBOS_WINDOW_TYPE_CARD"
               && item.displayAffinity === compositorWindow.displayId;
    }

    function uidOf(item) {
        for (var i = 0; i < _surfaces.length; ++i)
            if (_surfaces[i].item === item)
                return _surfaces[i].uid;
        return "";
    }

    function cardIndex(uid) {
        for (var i = 0; i < cards.count; ++i)
            if (cards.get(i).uid === uid)
                return i;
        return -1;
    }

    function _cardList() {
        var out = [];
        for (var i = 0; i < cards.count; ++i)
            out.push({ uid: cards.get(i).uid, appId: cards.get(i).appId, groupId: cards.get(i).groupId });
        return out;
    }

    function _props(item) {
        var p = item ? item.windowProperties : null;
        return p && typeof p === "object" ? p : {};
    }

    // A new card: where it goes is LsmCards.placement's (a further window
    // of an app joins its stack; an app launched by the card in front, by
    // WebAppMgr's launchingAppId, joins that one's, CardWindowManager.cpp:
    // 556-578; else a new stack right of the one the shell launched from).
    function addSurface(item) {
        if (item && item.appId === justTypeAppId && !item.isProxy() && !item.isPartOfGroup())
            _adoptJustType(item);
        else if (isCard(item))
            _adopt(item);
    }

    // A card surface becomes a card (shell/tests-device drives this with
    // fake surfaces). Returns its uid.
    function _adopt(item) {
        if (uidOf(item) !== "")
            return uidOf(item);
        var uid = "s" + (_nextUid++);
        _surfaces.push({ uid: uid, item: item });
        var host = hostComponent.createObject(source, { surface: item });
        _hosts[uid] = host;
        // The card's edit popup: the command goes back to its page.
        var appOfCard = item.appId;
        host.editTriggered.connect(function(action) { source.sendToApp(appOfCard, "editAction", { action: action }); });
        item.state = Qt.WindowFullScreen;
        var f = LsmCards.cardFields(_props(item));
        var place = LsmCards.placement(_cardList(), item.appId, f.launchingAppId, focusedUid, _pendingAfterUid);
        var groupId = place.groupOf !== "" ? cards.get(cardIndex(place.groupOf)).groupId : newGroupId();
        cards.insert(place.at, { uid: uid, appId: item.appId, title: item.title || item.appId, groupId: groupId,
                                 fullScreen: f.fullScreen, statusBarColor: f.statusBarColor, orientation: f.orientation,
                                 blockScreenTimeout: f.blockScreenTimeout, allowResize: true,
                                 launchingAppId: f.launchingAppId, returnTo: f.returnTo });
        _pendingAfterUid = "";
        _backSeen[uid] = f.back;
        // An app Just Type launched: its card comes, Just Type goes (as the
        // simulator's does on the page's launch).
        if (_justTypeShown)
            justTypeDismissed();
        // The page's later requests (orientation, full screen, status bar
        // colour, a Back it did not take) come as window properties
        // (WebOSSurfaceItem::windowPropertiesChanged, webossurfaceitem.cpp:930).
        item.windowPropertiesChanged.connect(function() { source._propertiesChanged(item); });
        cardFocusRequested(uid);
        return uid;
    }

    property var _backSeen: ({})    // uid -> the last phoenixBack heard

    function _propertiesChanged(item) {
        var uid = uidOf(item);
        var i = cardIndex(uid);
        if (i < 0)
            return;
        var f = LsmCards.cardFields(_props(item));
        var keys = ["fullScreen", "statusBarColor", "orientation", "blockScreenTimeout", "launchingAppId", "returnTo"];
        for (var k = 0; k < keys.length; ++k)
            if (cards.get(i)[keys[k]] !== f[keys[k]])
                cards.setProperty(i, keys[k], f[keys[k]]);
        if (f.back !== "" && f.back !== _backSeen[uid]) {
            _backSeen[uid] = f.back;
            _unhandledBack(uid, f, item.appId);
        }
    }

    function _unhandledBack(uid, fields, appId) {
        var caller = LsmCards.isCaller(fields.returnTo) ? runningUid(fields.returnTo) : "";
        if (LsmCards.unhandledBack(fields, appId, caller) === "return")
            cardReturnRequested(caller, uid);
        else
            backUnhandled(uid);
    }

    function removeSurface(item) {
        if (_justTypeHost && _justTypeHost.surface === item) {
            _justTypeHost.surface = null;
            return;
        }
        var uid = uidOf(item);
        if (uid === "")
            return;
        _surfaces = _surfaces.filter(function(s) { return s.uid !== uid; });
        var i = cardIndex(uid);
        if (i >= 0)
            cards.remove(i);
        delete _backSeen[uid];
        var host = _hosts[uid];
        delete _hosts[uid];
        if (host) {
            if (item.parent === host)
                item.parent = null;
            host.destroy();
        }
    }

    Connections {
        target: compositor
        function onSurfaceMapped(item) { source.addSurface(item); }
        function onSurfaceUnmapped(item) { source.removeSurface(item); }
        function onSurfaceDestroyed(item) { source.removeSurface(item); }
    }

    Component {
        id: hostComponent
        SurfaceHost {}
    }

    // ---- Window source interface ------------------------------------------------------

    function windowFor(uid) {
        return _hosts[uid] || null;
    }

    function runningUid(appId) {
        for (var i = 0; i < cards.count; ++i)
            if (cards.get(i).appId === appId)
                return cards.get(i).uid;
        return "";
    }

    // Launching is asynchronous: the card appears when the surface maps and
    // cardFocusRequested() fires. Returns the uid only if already running.
    // params: launch params (a tapped notification's); SAM relaunches a
    // running app with them.
    function launch(appId, afterUid, params) {
        var running = runningUid(appId);
        if (running !== "" && !params)
            return running;
        _pendingAfterUid = afterUid || "";
        LS.adhoc.call("luna://com.webos.applicationManager", "/launch",
                      JSON.stringify({ id: appId, params: params || {} }));
        return running;
    }

    function moveCard(from, to) {
        if (from !== to && from >= 0 && to >= 0 && from < cards.count && to < cards.count)
            cards.move(from, to, 1);
    }

    function setCardGroup(uid, groupId) {
        var i = cardIndex(uid);
        if (i >= 0)
            cards.setProperty(i, "groupId", groupId);
    }

    function close(uid) {
        for (var i = 0; i < _surfaces.length; ++i)
            if (_surfaces[i].uid === uid) {
                _surfaces[i].item.close();
                return;
            }
    }

    // One reply from a service on the bus: lunaCall(uri, params, callback);
    // callback(null) when the call cannot be made. The lock screen asks
    // com.palm.systemmanager for the device lock through this.
    Service {
        id: lunaBus
        appId: LS.appId
        property var pending: ({})
        property var subscriptions: ({})
        onResponse: (method, payload, token) => {
            var cb = pending[token];
            if (!cb)
                return;
            if (!subscriptions[token])
                delete pending[token];
            var r = null;
            try { r = JSON.parse(payload); } catch (e) { /* not JSON */ }
            cb(r);
        }
    }
    function lunaCall(uri, params, callback) {
        var m = /^(?:palm|luna):\/\/([^\/]+)(\/.*)$/.exec(uri);
        var token = m ? lunaBus.call("luna://" + m[1], m[2], JSON.stringify(params || {})) : 0;
        if (token > 0)
            lunaBus.pending[token] = callback;
        else
            callback(null);
    }

    // A subscription ({subscribe: true}): callback hears every reply.
    function lunaSubscribe(uri, params, callback) {
        var m = /^(?:palm|luna):\/\/([^\/]+)(\/.*)$/.exec(uri);
        var token = m ? lunaBus.call("luna://" + m[1], m[2], JSON.stringify(params || {})) : 0;
        if (token > 0) {
            lunaBus.pending[token] = callback;
            lunaBus.subscriptions[token] = true;
        } else {
            callback(null);
        }
    }

    // The back gesture. A page that can take it gets the webOS Back key,
    // delivered to the card's surface, which forwards it to the app by its
    // native scan code (WebOSSurfaceItem::processKeyEvent). webOS reads
    // evdev 412 as Back; on the wire that is XKB keycode 412 + 8. Web apps
    // get it as keyCode 461; one that does not take it says so through its
    // phoenixBack window property (phoenix-runtime.js), and the card then
    // returns to its caller or minimizes (cardReturnRequested /
    // backUnhandled). A page that cannot take it (WebAppMgr's
    // _WEBOS_ACCESS_POLICY_KEYS_BACK "false": its history is at its start
    // and its app does not handle Back, "LSM should handle it",
    // web_app_wayland.cc:725-733) is not sent the key: the card returns to
    // its caller ({returnToCaller}) or minimizes at once, as LunaSysMgr
    // did with a Back WebAppMgr handed back (SystemUiController::
    // slotKeyEventRejected, SystemUiController.cpp:941-954). Returns false
    // when the shell should minimize the card now.
    // STATUS: written against WebAppMgr's source; not yet run on a device.
    readonly property int backScanCode: 412 + 8
    function back(uid) {
        for (var i = 0; i < _surfaces.length; ++i) {
            if (_surfaces[i].uid !== uid)
                continue;
            var item = _surfaces[i].item;
            var f = LsmCards.cardFields(_props(item));
            var caller = LsmCards.isCaller(f.returnTo) ? runningUid(f.returnTo) : "";
            var action = LsmCards.backAction(f, item.appId, caller);
            if (action === "return") {
                cardReturnRequested(caller, uid);
                return true;
            }
            if (action === "minimize")
                return false;
            KeyInjector.sendKey(item, WebOS.Key_webOS_Back, backScanCode);
            return true;
        }
        return false;
    }

    // State only the shell knows, for the apps (SimWindowSource's
    // pushSystemStatus; PhoenixViewsRoot sends it): the lock screen, dock
    // mode, how the UI and the device are turned, the keyboard. On a device
    // it goes to com.palm.systemmanager (services/lock: /phoenix/report),
    // which answers the apps' getLockStatus, getDockModeStatus and
    // getSystemStatus. The simulator's other keys are not for it.
    // STATUS: written against services/lock's tests; not yet run on a device.
    function pushSystemStatus(changes) {
        var report = {};
        ["deviceLocked", "dockMode", "orientation", "ime"].forEach(function(k) {
            if (changes && changes[k] !== undefined)
                report[k] = changes[k];
        });
        if (Object.keys(report).length > 0)
            lunaCall("luna://com.palm.systemmanager/phoenix/report", report, function() {});
        // Which app was in front with the screen on, for Settings > Battery
        // (services/accessories; sim.qml's usageTick reaches the runtime).
        if (changes && changes.usageTick)
            lunaCall("luna://org.webosphoenix.battery/phoenix/usageTick", changes.usageTick, function() {});
    }

    function dismissNotification(index) {
        if (index >= 0 && index < notifications.count)
            notifications.remove(index);
    }

    // ---- System sounds (SystemSounds.qml decides; audiod plays) ------------------------
    // OSE's audiod-pro plays files by path: playSound {fileName, sink,
    // format, sampleRate, channels} -> {playbackId} (PlaybackManager::
    // _playSound, playbackManager.cpp:133-240), stopped with controlPlayback
    // {playbackId, requestType: "stop"}. It takes .wav and .pcm names only
    // and writes the file's bytes as they are, in the format the call names
    // (PlaybackThread::play, PulseAudioLink.cpp:925-960): no MP3, and a
    // WAV's header is played as sound. So the image carries a raw PCM twin
    // of every sound, "<file>.pcm", 16-bit, 44.1 kHz, stereo
    // (tools/sounds-to-pcm.sh, run by meta-phoenix's phoenix-apps), and this
    // plays the twin of the file SystemSounds chose; a file without one (a
    // ringtone copied to the device later) fails to open, and the
    // fallback's twin plays. Loops: getPlaybackStatus {playbackId,
    // subscribe} says "stopped" at the end (playbackManager.cpp:286-345),
    // and a looping sound (the incoming call's ringtone) starts again;
    // durations: stopped after durationMs. Per-sound volume is not in its
    // API: the stream's volume.
    // STATUS: written against audiod-pro's source; not yet run on a device.
    readonly property var pcmSpec: ({ format: "PA_SAMPLE_S16LE", sampleRate: 44100, channels: 2 })
    property var _playback: ({})     // handle -> {id, loop, stopped, timer}
    property int _nextSound: 1
    function pcmTwin(path) {
        return !path ? "" : /\.pcm$/i.test(path) ? path : path + ".pcm";
    }

    function playSound(path, stream, loop, duration, volume, fallback) {
        var handle = "snd" + (_nextSound++);
        var sink = stream === "ringtones" ? "pringtones" : stream === "feedback" ? "pfeedback" : "palerts";
        var p = { loop: !!loop, stopped: false, id: "" };
        _playback[handle] = p;
        if (duration > 0)
            p.timer = _later(duration, function() { source.stopSound(handle); });
        var start = function(file, second) {
            lunaCall("luna://com.webos.service.audio/playSound",
                     { fileName: file, sink: sink, format: pcmSpec.format, sampleRate: pcmSpec.sampleRate, channels: pcmSpec.channels },
                     function(r) {
                         if (p.stopped)
                             return r && r.playbackId ? source._stopPlayback(r.playbackId) : undefined;
                         if (r && r.playbackId) {
                             p.id = r.playbackId;
                             if (p.loop)
                                 source._watchLoop(handle, r.playbackId, function() { start(file, second); });
                         } else if (!second && fallback && pcmTwin(fallback) !== file) {
                             start(pcmTwin(fallback), true);
                         }
                     });
        };
        start(pcmTwin(path), false);
        return handle;
    }

    function _watchLoop(handle, playbackId, again) {
        var done = false;
        lunaSubscribe("luna://com.webos.service.audio/getPlaybackStatus", { playbackId: playbackId, subscribe: true }, function(r) {
            var p = source._playback[handle];
            if (done || !p || p.stopped || p.id !== playbackId || !r || r.playbackStatus !== "stopped")
                return;
            done = true;
            source._stopPlayback(playbackId);   // lets audiod drop its finished thread
            again();
        });
    }

    function _stopPlayback(id) {
        lunaCall("luna://com.webos.service.audio/controlPlayback", { playbackId: id, requestType: "stop" }, function() {});
    }

    function stopSound(handle) {
        var p = _playback[handle];
        delete _playback[handle];
        if (!p)
            return;
        p.stopped = true;
        if (p.timer) {
            p.timer.stop();
            p.timer.destroy();
        }
        if (p.id)
            _stopPlayback(p.id);
    }

    // A one-shot timer (sounds' durations).
    Component {
        id: laterTimer
        Timer { repeat: false }
    }
    function _later(ms, fn) {
        var t = laterTimer.createObject(source, { interval: ms });
        t.triggered.connect(fn);
        t.start();
        return t;
    }

    // ---- LunaSysMgr's device services (Phoenix.Shell DeviceServices) -----------------
    // OSE has no com.palm.display, .keys, .vibrate or .ambientLightSensor;
    // phoenix-devices (services/devices) is them on the bus. It reads the
    // keys, switches and light sensor and runs the motor itself; the display
    // is the shell's, so the shell reports it there and hears the apps'
    // requests (com.palm.display/phoenix/report and /phoenix/requests).
    // STATUS: not yet run on a device; checked against phoenix-devices'
    // tests (services/devices/tests) only. If the service restarts, the
    // subscription is not made again (registerServerStatus would).

    signal displayStateRequested(string state)
    signal vibrationRequested(var request)
    signal displayPropertiesRequested(var props)
    signal shutdownRequested(string reason)
    signal rebootRequested(string reason)
    property var displayHolds: ({ requestBlock: 0, powerKeyBlock: 0, proximity: 0, alsDisabled: 0 })

    // What the shell knows, for the services: only the display and the
    // Power key it kept from an app go to phoenix-devices (the keys, the
    // switches and the light it has first-hand).
    function deviceEvent(ev) {
        var report = null;
        if (ev.display)
            report = ev.display;
        if (ev.powerKey)
            report = Object.assign({}, report || {}, { powerKey: ev.powerKey });
        if (report)
            lunaCall("luna://com.palm.display/phoenix/report", report, function() {});
    }

    // The shell's own vibrations (a banner's "vibrate"): the motor.
    function vibrate(request) {
        if (request.name)
            lunaCall("luna://com.palm.vibrate/vibrateNamedEffect", { name: request.name }, function() {});
        else if (request.period !== undefined)
            lunaCall("luna://com.palm.vibrate/vibrate", { period: request.period, duration: request.duration || 0 }, function() {});
    }

    Service {
        id: deviceBus
        appId: LS.appId
        onResponse: (method, payload, token) => {
            var r = null;
            try { r = JSON.parse(payload); } catch (e) { return; }
            if (!r || r.returnValue === false)
                return;
            if (r.holds)
                source.displayHolds = r.holds;
            if (r.setState)
                source.displayStateRequested(r.setState);
            if (r.setProperty)
                source.displayPropertiesRequested(r.setProperty);
            // An app's vibration, already on the motor: counted by the shell.
            if (r.vibrated)
                source.vibrationRequested(Object.assign({ on: true, ran: true }, r.vibrated));
            // com.palm.power's machineOff / machineReboot (phoenix-devices):
            // the shell's moment before the machine goes.
            if (r.shutdown)
                source.shutdownRequested(String(r.shutdown.reason || ""));
            if (r.reboot)
                source.rebootRequested(String(r.reboot.reason || ""));
        }
        Component.onCompleted: call("luna://com.palm.display", "/phoenix/requests", JSON.stringify({ subscribe: true }))
    }

    // The sounds that ship (tools/install-rootfs.py installs them); anything
    // else is taken on trust, and audiod reports a missing file.
    function soundExists(path) {
        return !!path;
    }

    function appDir(appId) {
        return "/usr/palm/applications/" + appId;
    }

    // ---- The pages' messages (org.webosphoenix.shellhost) -------------------------------
    // docs/DEVICE-AUDIT.md, "The shell's messages". In phoenix-sim a page's
    // phoenixHost.postToHost reaches SimWindowSource._hostMessage as a
    // console message, and the shell runs script in the page to answer. On
    // a device the pages are WebAppMgr's, in processes of their own: what a
    // page posts comes from org.webosphoenix.shellhost (services/shellhost)
    // with the app id luna-service2 gave its call, and what the shell has
    // for a page goes back there (sendToApp: the page's runtime hears it as
    // an event, runtime.shellEvent). The same messages, handled as the
    // simulator handles them: banners, sounds, notifications, ongoing
    // activities, the active-call banner, the edit popup, scene
    // transitions, the Assistant's on-device model and speech, an app's
    // dictation, a screenshot, a media key.
    // STATUS: written against services/shellhost and the runtime's device
    // half (tools/test-runtime-device.cjs); not yet run on a device.

    signal bannerRequested(string appId, string text, url icon, string params, string soundClass, string soundFile, int soundDuration, string bannerId)
    signal bannerRemoved(string appId, string bannerId)
    signal bannersCleared(string appId)
    signal soundRequested(string appId, string soundClass, string soundFile, int duration)
    signal sceneTransitionRequested(string uid, string op, string transition, bool isPop)
    signal screenshotRequested
    signal mediaKeyRequested(string key)
    signal progressAnimationRequested(string type, string state)
    signal debugOverlayRequested(var request)
    property var activeCallBanner: null
    property string lastSceneTransitionPrepared: ""
    // The shell's engines (Shell.qml binds them when these exist).
    property var dictation: null
    property var localModels: null
    property var speech: null

    readonly property string shellHost: "luna://org.webosphoenix.shellhost"

    // A message for every page of appId (its runtime's shellEvent).
    function sendToApp(appId, type, payload) {
        if (!appId)
            return;
        lunaCall(shellHost + "/send", { appId: appId, type: type, payload: payload || {} }, function() {});
    }

    function _listenToPages() {
        lunaSubscribe(shellHost + "/listen", { subscribe: true }, function(r) {
            var m = r && r.message;
            if (m && typeof m.appId === "string" && typeof m.type === "string")
                source.pageMessage(m.appId, m.type, m.payload && typeof m.payload === "object" ? m.payload : {});
        });
    }

    // What the shell knows of an app (its launch point).
    function appInfo(appId) {
        for (var i = 0; i < apps.count; ++i) {
            var a = apps.get(i);
            if (a.appId === appId)
                return { appId: a.appId, title: a.title, icon: a.icon, color: a.color, glyph: a.glyph };
        }
        return null;
    }

    // A device path (or URL) the page named as an icon, else the app's.
    function _iconUrl(path, appId) {
        var p = path ? String(path) : "";
        if (p.charAt(0) === "/")
            return "file://" + p;
        if (/^(file|https?|data):/i.test(p))
            return p;
        var info = appInfo(appId);
        return info && info.icon ? info.icon : "";
    }

    function _soundArgs(payload) {
        return [payload.soundClass ? String(payload.soundClass) : "", payload.soundFile ? String(payload.soundFile) : "",
                payload.duration | 0];
    }

    // A page's message: appId is luna-service2's word for the sender, never
    // the payload's.
    function pageMessage(appId, type, payload) {
        var uid = runningUid(appId);
        if (type === "banner") {
            var bp = payload.params;
            var bs = _soundArgs(payload);
            bannerRequested(appId, payload.message || "", _iconUrl(payload.icon, appId),
                            bp === undefined || bp === null ? "" : typeof bp === "string" ? bp : JSON.stringify(bp),
                            bs[0], bs[1], bs[2], payload.id ? String(payload.id) : "");
        } else if (type === "removeBanner") {
            bannerRemoved(appId, payload.id ? String(payload.id) : "");
        } else if (type === "clearBanners") {
            bannersCleared(appId);
        } else if (type === "sound") {
            var ss = _soundArgs(payload);
            soundRequested(appId, ss[0], ss[1], ss[2]);
        } else if (type === "notification") {
            // A notification for this app or one it names (a text the
            // telephony service received for Messaging); {tag} replaces,
            // {tag, remove} takes back (tagPrefix: all starting with it).
            var target = payload.appId && appInfo(payload.appId) ? payload.appId : appId;
            if (payload.tag)
                removeTagged(target, String(payload.tag));
            if (payload.remove) {
                if (payload.tagPrefix)
                    removeTagged(target, String(payload.tagPrefix), true);
                return;
            }
            notify(target, payload.title || "", payload.body || "", payload.params,
                   { tag: payload.tag ? String(payload.tag) : "", actions: payload.actions || null });
            if (payload.soundClass || payload.soundFile) {
                var ns = _soundArgs(payload);
                soundRequested(target, ns[0], ns[1], ns[2]);
            }
        } else if (type === "ongoing") {
            setOngoing(appId, payload);
        } else if (type === "activeCallBanner") {
            var call = { appId: appId, icon: _iconUrl(payload.icon, appId), message: payload.message || "",
                         startTime: payload.startTime || 0 };
            if (payload.op === "add" && activeCallBanner === null)
                activeCallBanner = call;
            else if (payload.op === "update" && activeCallBanner !== null && activeCallBanner.appId === appId)
                activeCallBanner = call;
            else if (payload.op === "remove" && activeCallBanner !== null && activeCallBanner.appId === appId)
                activeCallBanner = null;
        } else if (type === "activate") {
            if (uid !== "")
                cardFocusRequested(uid);
        } else if (type === "launch" && payload.id) {
            // The runtime's own launches (a share target): SAM, as the shell's.
            var running = launch(String(payload.id), uid === focusedUid ? uid : "", payload.params || {});
            if (running !== "" && payload.behind !== true)
                cardFocusRequested(running);
        } else if (type === "open") {
            bannerRequested(appId, qsTr("No app can open this link"), _iconUrl("", appId), "", "", "", 0, "");
        } else if (type === "editMenu") {
            var host = uid !== "" ? _hosts[uid] : null;
            if (host)
                host.openEditPopup(payload);
        } else if (type === "sceneTransition") {
            if (uid !== "")
                sceneTransitionRequested(uid, String(payload.op || ""), String(payload.transition || ""), !!payload.isPop);
            else if (payload.op === "prepare")
                sendToApp(appId, "sceneTransitionPrepared", {});
        } else if (type === "dictation") {
            if (uid !== "")
                _dictationRequest(appId, uid, payload);
        } else if (type === "assistant") {
            _assistantRequest(appId, payload);
        } else if (type === "takeScreenshot") {
            screenshotRequested();
        } else if (type === "mediaKey") {
            // The Assistant's "pause" (org.webosphoenix.system/mediaKey):
            // pressed as the hardware key, phoenix-devices' /media events.
            mediaKeyRequested(String(payload.key || ""));
            lunaCall("luna://com.palm.display/phoenix/report", { mediaKey: String(payload.key || "") }, function() {});
        } else if (type === "progressAnimation") {
            progressAnimationRequested(String(payload.type || ""), String(payload.state || ""));
        } else if (type === "debugOverlay") {
            debugOverlayRequested(payload);
        } else if (type === "justTypeDismiss" && appId === justTypeAppId) {
            justTypeDismissed();
        }
        // Others are the simulator's (its installer, its storaged, its
        // preferences mirror) or reach the shell another way on a device
        // (window properties, the services' own subscriptions).
    }

    // The card has its snapshot: the page may change the scene.
    function sceneTransitionPrepared(uid) {
        lastSceneTransitionPrepared = uid;
        var i = cardIndex(uid);
        if (i >= 0)
            sendToApp(cards.get(i).appId, "sceneTransitionPrepared", {});
    }

    // The app menu (the status bar's app name): the page's own.
    function appMenu(uid) {
        var i = cardIndex(uid);
        if (i < 0)
            return false;
        sendToApp(cards.get(i).appId, "openAppMenu", {});
        return true;
    }

    // The card in front changed: the pages hear it (Mojo.stageActivated,
    // "phoenixcardactivation"), as the simulator's SimWindowSource tells them.
    property string _activeUid: ""
    onFocusedUidChanged: {
        var previous = _activeUid;
        _activeUid = focusedUid;
        if (previous === focusedUid)
            return;
        var tell = function(uid, active) {
            var i = cardIndex(uid);
            if (i >= 0)
                source.sendToApp(cards.get(i).appId, "cardActivation", { active: active });
        };
        if (previous !== "")
            tell(previous, false);
        if (focusedUid !== "")
            tell(focusedUid, true);
    }

    // ---- Screen captures (docs/SCREENSHOTS.md SC1) --------------------------------------
    // The shell's PNG (Shell.takeScreenshot) into /media/internal/screencaptures,
    // named as the simulator's runtime names it ("<app> 2026-10-10 at
    // 09.41.05.png"), written by the file manager's service
    // (org.webosphoenix.filemanager write, base64), then the "Screen
    // captured" notification that opens it in the Screenshot app, as the
    // runtime's saveScreenshot posts it in phoenix-sim.
    readonly property string captureDir: "/media/internal/screencaptures"
    function captureFileName(app, d) {
        function two(n) { return (n < 10 ? "0" : "") + n; }
        var safe = String(app || "Screen").replace(/[\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Screen";
        return safe + " " + d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate())
            + " at " + two(d.getHours()) + "." + two(d.getMinutes()) + "." + two(d.getSeconds()) + ".png";
    }
    function saveScreenshot(png, appTitle, captureId) {
        var path = captureDir + "/" + captureFileName(appTitle, new Date());
        var fm = "luna://org.webosphoenix.filemanager";
        lunaCall(fm + "/mkdir", { path: captureDir }, function() {
            source.lunaCall(fm + "/write", { path: path, data: String(png).replace(/^data:image\/png;base64,/, ""), encoding: "base64" }, function(r) {
                if (!r || r.returnValue === false) {
                    console.warn("phoenix: the screen capture could not be saved: " + JSON.stringify(r));
                    return;
                }
                var params = { path: path };
                if (captureId)
                    params.capture = String(captureId);
                source.notify("org.webosphoenix.screenshot", qsTr("Screen captured"),
                              path.slice(source.captureDir.length + 1).replace(/\.png$/, ""), params, { tag: "capture:" + path });
            });
        });
        return true;
    }

    // ---- Just Type (com.palm.launcher, luna-applauncher's page) ----------------------------
    // As SimWindowSource.justTypeWindow: the original Just Type page in the
    // shell's Just Type, given the typed text. On a device the page is a
    // WebAppMgr app: started hidden (SAM's preload) the first time the
    // shell asks for it, shown by a launch when Just Type opens, its surface
    // put in the shell's Just Type rather than in a card; the text, the
    // stop, Back and the app menu go to the page as its "justType" and
    // "openAppMenu" events (phoenix-runtime.js installDevice), and it says
    // when Back leaves Just Type ("justTypeDismiss").
    readonly property string justTypeAppId: "com.palm.launcher"
    signal justTypeDismissed
    property Item _justTypeHost: null
    property bool _justTypeShown: false
    function justTypeWindow() {
        if (!_justTypeHost) {
            _justTypeHost = hostComponent.createObject(source, {});
            lunaCall("luna://com.webos.applicationManager/launch", { id: justTypeAppId, preload: "partial", params: {} }, function() {});
        }
        return _justTypeHost;
    }
    function _adoptJustType(item) {
        justTypeWindow().surface = item;
        item.state = Qt.WindowFullScreen;
    }
    // done (optional): called once the text is on its way.
    function justTypeStart(text, done) {
        justTypeWindow();
        _justTypeShown = true;
        lunaCall("luna://com.webos.applicationManager/launch", { id: justTypeAppId, params: { justType: true } }, function() {});
        sendToApp(justTypeAppId, "justType", { op: "start", text: String(text || "") });
        if (done)
            done();
    }
    function justTypeType(text) {
        if (_justTypeShown)
            sendToApp(justTypeAppId, "justType", { op: "type", text: String(text || "") });
    }
    function justTypeStop() {
        if (!_justTypeShown)
            return;
        _justTypeShown = false;
        sendToApp(justTypeAppId, "justType", { op: "stop" });
    }
    function justTypeAppMenu() {
        if (!_justTypeShown)
            return false;
        sendToApp(justTypeAppId, "openAppMenu", {});
        return true;
    }
    // Back: an open app menu closes; otherwise the page says
    // justTypeDismiss (pageMessage) and Just Type goes.
    function justTypeBack() {
        if (!_justTypeShown) {
            justTypeDismissed();
            return;
        }
        sendToApp(justTypeAppId, "justType", { op: "back" });
    }

    // ---- Notifications ------------------------------------------------------------------
    // params: the app's launch params when it is tapped; extra: {tag, actions}.
    function notify(appId, title, body, params, extra) {
        var info = appInfo(appId) || { color: "#666666", glyph: "!", icon: "" };
        var acts = extra && extra.actions && Array.isArray(extra.actions.items) && extra.actions.items.length ? extra.actions : null;
        notifications.append({ id: "n" + Date.now() + "_" + notifications.count, appId: appId, title: title, body: body || "",
                               color: info.color || "#666666", glyph: info.glyph || "!", icon: info.icon || "",
                               params: params && typeof params === "object" ? JSON.stringify(params) : (typeof params === "string" ? params : ""),
                               windowKey: "", clickableWhenLocked: false, ongoing: false, progress: -1,
                               tag: extra && extra.tag ? extra.tag : "", actions: acts ? JSON.stringify(acts) : "" });
    }

    function removeTagged(appId, tag, prefix) {
        for (var i = notifications.count - 1; i >= 0; --i) {
            var n = notifications.get(i);
            if (n.appId === appId && (prefix ? n.tag !== "" && n.tag.indexOf(tag) === 0 : n.tag === tag))
                notifications.remove(i);
        }
    }

    // An ongoing activity: {id, title, body, icon?, progress, params?} or
    // {id, clear: true}; pinned above the notifications (SimWindowSource's).
    function setOngoing(appId, p) {
        var key = "ongoing:" + appId + ":" + p.id;
        var at = -1;
        for (var i = 0; i < notifications.count; ++i)
            if (notifications.get(i).id === key) { at = i; break; }
        if (p.clear) {
            if (at >= 0)
                notifications.remove(at);
            return;
        }
        var target = p.appId && appInfo(p.appId) ? p.appId : appId;
        var info = appInfo(target) || { color: "#666666", glyph: "!", icon: "" };
        var progress = typeof p.progress === "number" ? Math.max(-1, Math.min(100, p.progress)) : -1;
        var params = p.params && typeof p.params === "object" ? JSON.stringify(p.params) : "";
        if (at >= 0) {
            notifications.setProperty(at, "title", p.title || "");
            notifications.setProperty(at, "body", p.body || "");
            notifications.setProperty(at, "progress", progress);
            notifications.setProperty(at, "params", params);
            return;
        }
        var flags = [];
        for (var j = 0; j < notifications.count; ++j)
            flags.push(notifications.get(j).ongoing);
        notifications.insert(Policy.ongoingInsertIndex(flags), {
            id: key, appId: target, title: p.title || "", body: p.body || "",
            color: info.color || "#666666", glyph: info.glyph || "!", icon: p.icon ? _iconUrl(p.icon, target) : (info.icon || ""),
            params: params, windowKey: "", clickableWhenLocked: false, ongoing: true, progress: progress, tag: "", actions: ""
        });
    }

    // OSE's own notifications (com.webos.notification createToast, from
    // OSE's services and apps): the shell is the system UI notificationmgr
    // serves (PRIVILEGED_SYSTEM_UI_SOURCE "com.webos.surfacemanager",
    // NotificationService.cpp:51, 227-245), so its toasts become banners,
    // and those that are not only toasts stay as notifications; a tap runs
    // the toast's action (SAM's launch, NotificationService.cpp:686-729). The
    // stock NotificationView takes no toasts (PhoenixViewsRoot); its alerts
    // stay its own.
    function toast(t) {
        if (!t || typeof t.message !== "string" || t.message === "")
            return;
        var appId = String(t.sourceId || "");
        var lp = t.action && t.action.launchParams ? t.action.launchParams : null;
        var target = lp && lp.id ? String(lp.id) : appId;
        var params = lp && lp.params ? JSON.stringify(lp.params) : "";
        var text = t.title ? String(t.title) + ": " + t.message : t.message;
        bannerRequested(target, text, t.iconUrl ? String(t.iconUrl) : _iconUrl("", target), params, "notifications", "", 0,
                        "toast-" + String(t.timestamp || Date.now()));
        if (t.onlyToast === false)
            notify(target, t.title ? String(t.title) : t.message, t.title ? t.message : "", lp && lp.params ? lp.params : null);
    }

    // ---- An app's dictation (org.webosphoenix.dictation) ---------------------------------
    // The shell's recorder for a card's page, as SimWindowSource's: one at a
    // time; the page hears listening, transcribing, done or error.
    function _dictationEvent(appId, ev) { sendToApp(appId, "dictationEvent", ev); }
    function _dictationRequest(appId, uid, p) {
        var d = dictation;
        if (!d) {
            _dictationEvent(appId, { state: "error", errorText: qsTr("Dictation is not available on this device.") });
            return;
        }
        var mine = d.owner === uid;
        if (p.op === "start") {
            if ((d.listening || d.busy) && !mine) {
                _dictationEvent(appId, { state: "error", errorText: qsTr("The microphone is in use.") });
                return;
            }
            if (d.listening || d.busy)
                d.cancel();
            d.owner = uid;
            d.prompt = typeof p.prompt === "string" ? p.prompt.slice(0, 1000) : "";
            d.autoStop = !!p.autoStop;
            d.start();
            if (d.listening)
                _dictationEvent(appId, { state: "listening" });
        } else if (p.op === "stop" && mine) {
            d.stop();
        } else if (p.op === "cancel" && mine) {
            d.cancel();
            _dictationDone();
        }
    }
    function _dictationDone() {
        if (!dictation)
            return;
        dictation.owner = "";
        dictation.prompt = "";
        dictation.autoStop = false;
    }
    function _ownerApp(uid) {
        var i = cardIndex(uid);
        return i >= 0 ? cards.get(i).appId : "";
    }
    Connections {
        target: source.dictation
        ignoreUnknownSignals: true
        // Only an app's recording: the keyboard's (owner "") and the
        // Assistant view's are theirs.
        function onStateChanged() {
            var d = source.dictation;
            var app = d.owner !== "" ? source._ownerApp(d.owner) : "";
            if (app !== "" && d.busy)
                source._dictationEvent(app, { state: "transcribing" });
        }
        function onTranscribed(text, error) {
            var d = source.dictation;
            var app = d.owner !== "" ? source._ownerApp(d.owner) : "";
            if (app === "")
                return;
            source._dictationDone();
            source._dictationEvent(app, error ? { state: "error", errorText: error } : { state: "done", text: text });
        }
    }

    // ---- The Assistant's on-device model and speech ("assistant" messages) ---------------
    property var _assistantWaiting: ({})
    function _assistantEvent(appId, ev) { sendToApp(appId, "assistantHostEvent", ev); }
    function _assistantRequest(appId, p) {
        var answer = function(o) { o.requestId = p.requestId; source._assistantEvent(appId, o); };
        var lm = localModels, sp = speech;
        switch (p.op) {
        case "status":
            answer(lm ? lm.status() : { available: false, installed: [], ramBytes: 0, error: "" });
            break;
        case "download":
            if (!lm) { answer({ error: qsTr("Models cannot be downloaded here.") }); break; }
            if (p.sources && p.sources.length)
                lm.downloadFrom(String(p.id), p.sources);
            else
                lm.download(String(p.id), String(p.url), String(p.sha256 || ""), Number(p.size) || 0);
            answer(lm.error && lm.status().downloading === null ? { error: lm.error } : {});
            break;
        case "cancel":
            if (lm) lm.cancel(String(p.id));
            answer({});
            break;
        case "remove":
            if (lm) lm.remove(String(p.id));
            answer({});
            break;
        case "ensure":
            if (!lm) { answer({ error: qsTr("No on-device model here.") }); break; }
            var w = _assistantWaiting;
            w[p.requestId] = appId;
            _assistantWaiting = w;
            lm.ensure(String(p.id), String(p.requestId));
            break;
        case "speak":
            if (!sp || !sp.available) { answer({ error: qsTr("No text-to-speech here.") }); break; }
            sp.speak(String(p.text || ""), String(p.lang || "en"), String(p.voice || ""), Number(p.rate) || 1);
            answer({});
            break;
        case "stopSpeaking":
            if (sp) sp.stop();
            answer({});
            break;
        case "speechStatus":
            answer({ available: !!(sp && sp.available), engine: sp ? sp.engine : "", voices: sp ? sp.voices : [] });
            break;
        default:
            answer({ error: "unknown op " + p.op });
        }
    }
    function _assistantSettle(requestId, ev) {
        var appId = _assistantWaiting[requestId];
        if (!appId)
            return;
        var w = _assistantWaiting;
        delete w[requestId];
        _assistantWaiting = w;
        ev.requestId = requestId;
        _assistantEvent(appId, ev);
    }
    Connections {
        target: source.localModels
        ignoreUnknownSignals: true
        function onReady(requestId, baseUrl) { source._assistantSettle(requestId, { baseUrl: baseUrl }); }
        function onFailed(requestId, error) { source._assistantSettle(requestId, { error: error }); }
    }

    // The system's own headless apps, started at boot as LunaSysMgr started
    // com.palm.systemui (WebAppMgrProxy.cpp:88-97; SimWindowSource.bootApps):
    // hidden, through SAM's "preload" (WebAppMgr has no noWindow;
    // services/appmanager does the same for other apps without a window).
    // Its alerts and dashboards are windows it opens (window.open), which
    // WebAppMgr does not make yet: docs/DEVICE-AUDIT.md, "Windows an app opens".
    readonly property var bootApps: ["com.palm.systemui"]

    function startBootApps() {
        for (var b = 0; b < bootApps.length; ++b)
            lunaCall("luna://com.webos.applicationManager/launch",
                     { id: bootApps[b], preload: "partial", params: { launchedAtBoot: true } }, function() {});
    }

    Component.onCompleted: {
        startBootApps();
        _listenToPages();
        lunaSubscribe("luna://com.webos.notification/getToastNotification", { subscribe: true }, function(r) {
            if (r && r.returnValue !== false && typeof r.message === "string")
                source.toast(r);
        });
    }
}
