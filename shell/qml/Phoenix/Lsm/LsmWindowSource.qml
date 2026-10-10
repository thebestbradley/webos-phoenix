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
        if (!isCard(item) || uidOf(item) !== "")
            return;
        var uid = "s" + (_nextUid++);
        _surfaces.push({ uid: uid, item: item });
        _hosts[uid] = hostComponent.createObject(source, { surface: item });
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
        // The page's later requests (orientation, full screen, status bar
        // colour, a Back it did not take) come as window properties
        // (WebOSSurfaceItem::windowPropertiesChanged, webossurfaceitem.cpp:930).
        item.windowPropertiesChanged.connect(function() { source._propertiesChanged(item); });
        cardFocusRequested(uid);
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
    }

    function notify(appId, title, body, params) {
        notifications.append({ id: "n" + Date.now(), appId: appId, title: title, body: body || "",
                               color: "#666666", glyph: "!", icon: "", params: params ? JSON.stringify(params) : "",
                               windowKey: "", clickableWhenLocked: false, ongoing: false, progress: -1,
                               tag: "", actions: "" });
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
}
