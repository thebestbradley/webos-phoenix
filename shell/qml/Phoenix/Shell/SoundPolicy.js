// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Which system sound plays, on which stream, for how long, and whether at
// all: LunaSysMgr's rules, as pure functions (SystemSounds.qml plays them).
//
//   BannerMessageHandler::playSound  (BannerMessageHandler.cpp:696-773): a
//       banner's or PalmSystem.playSoundNotification's {soundClass, soundFile,
//       duration}; notifications are capped at 5 s (Settings
//       NotificationSoundDuration, Settings.cpp:108)
//   AlertWindow::extractSoundParams  (AlertWindow.cpp:166-229): a popup
//       alert's {sound, soundclass} window attributes; ringtones loop
//   SoundPlayerPool::playFeedback    (SoundPlayerPool.cpp:105-131): named
//       feedback sounds, silent when the "System Sounds" switch is off
//       (Preferences systemSounds)
//   SoundPlayer::healthCheck         (SoundPlayer.cpp:520-557): what plays
//       instead when a file cannot be played
//
// Paths are device paths (/usr/palm/sounds/...); the window source plays
// them (playSound) and says whether one exists (soundExists).

.pragma library

// Settings::lunaSystemSoundsPath and its defaults (Settings.cpp:103-108).
var systemSoundsPath = "/usr/palm/sounds";
var defaultAlertSound = systemSoundsPath + "/alert.wav";
var defaultNotificationSound = systemSoundsPath + "/notification.wav";
var defaultRingtoneSound = systemSoundsPath + "/phone.wav";
var notificationSoundDuration = 5000;

// The shipped sounds LunaSysMgr and luna-systemui played by path.
var bootSound = systemSoundsPath + "/boot.mp3";             // WindowServer.cpp:1246
var shutdownSound = systemSoundsPath + "/shutdown.mp3";
var batteryFullSound = systemSoundsPath + "/battery_full.mp3";   // StatusBarBattery.cpp:218
// Touch to Share's tone: LunaSysMgr shipped it (sounds/tap_to_share.mp3) for
// the tap2share service, which was not released; the shell plays it as a
// card is sent (the "taptoshare" feedback sound).
var tapToShareSound = systemSoundsPath + "/tap_to_share.mp3";

// Feedback sounds by name. audiod's own set was not open-sourced; Phoenix
// ships mimics for the names LunaSysMgr asked for (tools/make-feedback-sounds.py).
var feedbackSoundsPath = "/usr/share/phoenix/sounds/feedback";
var feedbackSounds = ["key", "space", "backspace", "return", "appclose", "shutter"];
// The keyboard's (SysmgrIMEDataInterface.cpp:199-205): the keyboard's
// "Keyboard clicks" (VirtualKeyboardPreferences TapSounds) silences them too.
var keyboardSounds = ["key", "space", "backspace", "return"];

var streamClasses = ["alerts", "alarm", "calendar", "notifications", "ringtones", "feedback"];

// The stream class a sound class asks for: "" (no sound), "vibrate", or one
// of streamClasses; misspellings as LunaSysMgr fixed them, anything else is
// "notifications". A popup alert (forAlert) has no feedback class.
function streamClass(soundClass, forAlert) {
    var c = soundClass === undefined || soundClass === null ? "" : String(soundClass);
    if (c === "none")
        return "";
    if (c === "vibrate")
        return "vibrate";
    if (c === "alert")
        c = "alerts";
    else if (c === "notification")
        c = "notifications";
    else if (c === "ringtone")
        c = "ringtones";
    if (streamClasses.indexOf(c) < 0 || (forAlert && c === "feedback"))
        c = "notifications";
    return c;
}

// The audiod stream whose volume applies (the Settings sliders: Ringer,
// Alerts & notifications, System sounds).
function sinkFor(stream) {
    return stream === "ringtones" ? "pringtones" : stream === "feedback" ? "pfeedback" : "palerts";
}

// getResourcePathFromString (LsmUtils.cpp:45-85): an absolute path that
// exists; a relative one in the app's folder, then in the system sounds.
// A URL ("file:///...") counts by its path, as popup alerts took it.
function resolve(file, appDir, exists) {
    if (!file)
        return "";
    file = String(file);
    var m = /^[a-z]+:\/\/[^\/]*(\/.*)$/i.exec(file);
    if (m)
        file = decodeURI(m[1]);
    if (file.charAt(0) === "/")
        return exists(file) ? file : "";
    if (appDir) {
        var inApp = appDir.replace(/\/+$/, "") + "/" + file;
        if (exists(inApp))
            return inApp;
    }
    var inSystem = systemSoundsPath + "/" + file;
    return exists(inSystem) ? inSystem : "";
}

// The user's tone for a stream (Preferences ringtone / alerttone /
// notificationtone), "" if none is set.
function preferredTone(stream, prefs) {
    prefs = prefs || {};
    if (stream === "ringtones")
        return prefs.ringtone || "";
    if (stream === "alerts" || stream === "alarm" || stream === "calendar")
        return prefs.alerttone || "";
    return prefs.notificationtone || "";
}

// What plays when the file cannot be (SoundPlayer::healthCheck): the default
// notification for ringtones and alarms, the default alert otherwise.
function fallbackSound(stream) {
    return stream === "ringtones" || stream === "alarm" ? defaultNotificationSound : defaultAlertSound;
}

// A banner or playSoundNotification: {file, stream, loop, duration} or null.
// env: {appDir, exists(path), prefs: {ringtone, alerttone, notificationtone}}.
function forBanner(soundClass, soundFile, duration, loop, env) {
    if (!soundClass && !soundFile)
        return null;
    var stream = streamClass(soundClass || "notifications", false);
    if (stream === "" || stream === "vibrate")
        return stream === "vibrate" ? { vibrate: true, stream: "notifications" } : null;
    var file = resolve(soundFile, env.appDir, env.exists);
    if (file === "")
        file = preferredTone(stream, env.prefs);
    if (file === "")
        file = defaultAlertSound;
    else if (!env.exists(file))
        file = fallbackSound(stream);
    var d = duration > 0 ? duration : -1;
    if (stream === "notifications" && d <= 0)
        d = notificationSoundDuration;
    return { file: file, stream: stream, loop: !!loop, duration: d };
}

// A popup alert as it becomes the active one: {file, stream, loop, duration}
// or null. sound, soundClass: its window attributes.
function forAlert(sound, soundClass, env) {
    var stream = streamClass(soundClass, true);
    if (stream === "")
        return null;
    if (stream === "vibrate")
        return { vibrate: true, stream: "notifications" };
    var file = resolve(sound, env.appDir, env.exists);
    if (file === "")
        file = preferredTone(stream, env.prefs);
    if (file === "" || !env.exists(file))
        file = stream === "ringtones" ? defaultRingtoneSound : defaultAlertSound;
    var d = stream === "notifications" ? notificationSoundDuration : -1;
    return { file: file, stream: stream, loop: stream === "ringtones", duration: d };
}

// A named feedback sound: its file, or "" when it stays silent: the "System
// Sounds" switch is off (unless a sink was named, as LunaSysMgr's own
// default tones were), the keyboard's clicks are off, or none ships.
function forFeedback(name, sink, prefs) {
    prefs = prefs || {};
    if (!sink && prefs.systemSounds === false)
        return "";
    if (keyboardSounds.indexOf(name) >= 0 && prefs.tapSounds === false)
        return "";
    if (name === "taptoshare")
        return tapToShareSound;
    return feedbackSounds.indexOf(name) >= 0 ? feedbackSoundsPath + "/" + name + ".wav" : "";
}

// Volume 0..1 for a stream: nothing while muted ("Mute all sounds"),
// else the master volume times the stream's (both 0..100; missing = 100).
function volume(stream, prefs) {
    prefs = prefs || {};
    if (prefs.muted)
        return 0;
    var master = prefs.volume === undefined ? 100 : prefs.volume;
    var streams = prefs.streams || {};
    var own = streams[sinkFor(stream)];
    if (own === undefined)
        own = 100;
    return Math.max(0, Math.min(1, master / 100 * own / 100));
}

// StatusBarBattery::updateBatteryLevel (StatusBarBattery.cpp:212-219): the
// battery-full sound plays once when it reaches 100 %, after having been
// below 95 %. Returns {armed, play}.
function batteryFull(armed, percent, bootFinished) {
    if (percent < 95)
        armed = true;
    if (armed && percent === 100 && bootFinished)
        return { armed: false, play: true };
    return { armed: armed, play: false };
}
