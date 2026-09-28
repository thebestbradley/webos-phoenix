// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shell's system sounds: LunaSysMgr's BannerMessageHandler, AlertWindow,
// SoundPlayerPool and StatusBarBattery sound rules (SoundPolicy.js), played
// by the window source (playSound / stopSound; Phoenix.Sim plays them with
// HTML audio in a runtime page, the device with audiod).
//
//   notification(appId, soundClass, soundFile, duration, loop)
//                       a banner's sound, or PalmSystem.playSoundNotification
//   alertActivated(key, appId, sound, soundClass), alertDeactivated(key)
//                       the popup alert in front changed: its sound plays
//                       once (ringtones loop) and stops when it goes
//   feedback(name, sink)  a named feedback sound (keyboard clicks, appclose)
//   bootFinished()      the boot sound, if playBootSound; battery-full from now on
//   shutdown()          the shutdown sound, if playBootSound
//
// system (SimSystemStatus / LsmSystemStatus) supplies muted, volume,
// streams {pringtones, palerts, pfeedback}, systemSounds, tapSounds,
// ringtone, alerttone, notificationtone and batteryPercent; any it lacks
// take LunaSysMgr's defaults.

import QtQuick
import "SoundPolicy.js" as Policy

QtObject {
    id: sounds

    property var source: null
    property var system: null

    // Boot and shutdown sounds (WindowServer.cpp:1246). Off by default:
    // phoenix-sim turns them on when it runs interactively.
    property bool playBootSound: false

    // The last decision, for tests and debugging: {kind, file, stream, loop,
    // duration, volume} or {kind, vibrate: true}.
    property var last: null
    // Vibrations asked for (soundClass "vibrate"); there is no motor here.
    property int vibrations: 0

    property bool _bootFinished: false
    property bool _batteryArmed: false
    property var _alertHandles: ({})    // alert key -> player handle
    property var _alertsPlayed: ({})    // alert key -> true once it has sounded

    function _prefs() {
        var s = system || {};
        return {
            muted: !!s.muted,
            volume: s.volume,
            streams: s.streams,
            systemSounds: s.systemSounds,
            tapSounds: s.tapSounds,
            ringtone: s.ringtone || "",
            alerttone: s.alerttone || "",
            notificationtone: s.notificationtone || ""
        };
    }

    function _env(appId) {
        var src = source;
        return {
            appDir: src && typeof src.appDir === "function" && appId ? src.appDir(appId) : "",
            exists: function(path) {
                return src && typeof src.soundExists === "function" ? !!src.soundExists(path) : true;
            },
            prefs: _prefs()
        };
    }

    // Play a decided sound: nothing while muted or at volume 0.
    function _play(kind, d) {
        if (!d)
            return "";
        if (d.vibrate) {
            vibrations++;
            last = { kind: kind, vibrate: true };
            return "";
        }
        var vol = Policy.volume(d.stream, _prefs());
        last = { kind: kind, file: d.file, stream: d.stream, loop: d.loop, duration: d.duration, volume: vol };
        if (vol <= 0 || !source || typeof source.playSound !== "function")
            return "";
        return source.playSound(d.file, d.stream, d.loop, d.duration, vol,
                                d.stream === "feedback" ? "" : Policy.fallbackSound(d.stream)) || "";
    }

    function stop(handle) {
        if (handle && source && typeof source.stopSound === "function")
            source.stopSound(handle);
    }

    function notification(appId, soundClass, soundFile, duration, loop) {
        return _play("notification", Policy.forBanner(soundClass, soundFile, duration, loop, _env(appId)));
    }

    function feedback(name, sink) {
        var file = Policy.forFeedback(name, sink || "", _prefs());
        if (file === "") {
            last = { kind: "feedback", name: name, file: "" };
            return "";
        }
        var h = _play("feedback", { file: file, stream: "feedback", loop: false, duration: -1 });
        if (last)
            last.name = name;
        return h;
    }

    // AlertWindow::activate / deactivate: a popup alert sounds when it comes
    // to the front, once (a persistent window would sound every time; the
    // simulator has none), and stops when it leaves the front or closes.
    function alertActivated(key, appId, sound, soundClass) {
        if (!key || _alertsPlayed[key] || _alertHandles[key] !== undefined)
            return;
        var played = Object.assign({}, _alertsPlayed);
        played[key] = true;
        _alertsPlayed = played;
        var h = _play("alert", Policy.forAlert(sound, soundClass, _env(appId)));
        var handles = Object.assign({}, _alertHandles);
        handles[key] = h;
        _alertHandles = handles;
    }

    function alertDeactivated(key) {
        var h = _alertHandles[key];
        if (h === undefined)
            return;
        var handles = Object.assign({}, _alertHandles);
        delete handles[key];
        _alertHandles = handles;
        stop(h);
    }

    // An alert window that closed will not come back: forget it.
    function alertClosed(key) {
        alertDeactivated(key);
        if (_alertsPlayed[key]) {
            var played = Object.assign({}, _alertsPlayed);
            delete played[key];
            _alertsPlayed = played;
        }
    }

    function bootFinished() {
        _bootFinished = true;
        _checkBattery();
        if (playBootSound)
            _play("boot", { file: Policy.bootSound, stream: "notifications", loop: false, duration: -1 });
    }

    function shutdown() {
        if (playBootSound)
            _play("shutdown", { file: Policy.shutdownSound, stream: "notifications", loop: false, duration: -1 });
    }

    function _checkBattery() {
        if (!system || system.batteryPercent === undefined)
            return;
        var r = Policy.batteryFull(_batteryArmed, system.batteryPercent, _bootFinished);
        _batteryArmed = r.armed;
        if (r.play)
            _play("batteryFull", { file: Policy.batteryFullSound, stream: "notifications", loop: false, duration: -1 });
    }

    property Connections _battery: Connections {
        target: sounds.system
        ignoreUnknownSignals: true
        function onBatteryPercentChanged() { sounds._checkBattery(); }
    }
}
