// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings by voice (docs/AI-AND-MCP.md, "Everyday features"): the switches
// of Settings that the toggle command (lib/commands.js: Wi-Fi, Bluetooth,
// airplane mode, the flashlight, the ringer, Do Not Disturb, Location
// Services, rotation, the hotspot, VPN), volume and brightness do not have,
// each set where Settings sets it, so Settings shows it changed:
//
//   previews          Screen & Lock > Show previews when locked (lockScreenPreviews)
//   lockNotifications Screen & Lock > Show notifications when locked (showAlertsWhenLocked)
//   blink             Screen & Lock > Blink notifications (blinkNotifications)
//   screenTimeout     Screen & Lock > Turn off after (screenTimeout, its choices)
//   systemSounds      Sounds > System sounds (systemSounds)
//   keyboardClicks    Sounds > Keyboard clicks (x_palm_virtualkeyboard_prefs.TapSounds)
//   highContrast, reduceMotion, captions, monoAudio   Accessibility (accessibility)
//   dropShare         DropShare (dropShareEnabled)
//   networkTime       Date & Time > Network time (useNetworkTime)
//   nightMode         Exhibition > Night mode (exhibition.nightMode)
//   wakeWord, voiceReplies   Settings > Assistant ("Hey Phoenix", answers aloud)
//   darkMode          there is none (webOS's look has none; 2.0's design
//                     brings light and dark): said so, with High contrast offered
//
// All through com.webos.service.systemservice get/setPreferences (the
// Assistant's own two through its settings). Showing previews on the lock
// screen is read back first: it shows what messages say to anyone holding
// the phone.

"use strict";

var PREFS = "luna://com.webos.service.systemservice/";
var TIMEOUTS = [30, 60, 120, 180, 300];   // Settings > Screen & Lock's choices (Screen.tsx TIMEOUTS)

// How each is read and written: a preference (key, or key.field of an
// object preference, inverted when its switch is the other way), or the
// Assistant's own setting.
var SETTINGS = {
    previews: { key: "lockScreenPreviews", dflt: true },
    lockNotifications: { key: "showAlertsWhenLocked", dflt: true },
    blink: { key: "blinkNotifications", dflt: true },
    systemSounds: { key: "systemSounds", dflt: true },
    keyboardClicks: { key: "x_palm_virtualkeyboard_prefs", field: "TapSounds", dflt: true },
    highContrast: { key: "accessibility", field: "highContrast", dflt: false },
    reduceMotion: { key: "accessibility", field: "reduceMotion", dflt: false },
    captions: { key: "accessibility", field: "captions", dflt: false },
    monoAudio: { key: "accessibility", field: "monoAudio", dflt: false },
    dropShare: { key: "dropShareEnabled", dflt: false },
    networkTime: { key: "useNetworkTime", dflt: true },
    nightMode: { key: "exhibition", field: "nightMode", dflt: false },
    wakeWord: { assistant: "wakeWord" },
    voiceReplies: { assistant: "voiceReplies" }
};
var NAMES = Object.keys(SETTINGS).concat(["darkMode", "screenTimeout"]);

var COMMANDS = [
    { id: "deviceSetting", title: "Other settings", risk: "change",
      description: "Turn on or off, or tell, a setting of Settings: lock screen previews and notifications, the notification light, system sounds, keyboard clicks, high contrast, reduce motion, captions, mono audio, DropShare, network time, Exhibition's night mode, \"Hey Phoenix\", spoken answers, dark mode; or set how soon the screen turns off.",
      parameters: { type: "object", properties: {
          setting: { type: "string", enum: NAMES },
          state: { type: "string", enum: ["on", "off", "status", "set"] },
          seconds: { type: "integer", description: "screenTimeout: how long, in seconds" } }, required: ["setting", "state"] },
      examples: ["stop showing message text on my lock screen", "make the text easier to read", "turn the typing sounds off",
                 "switch to a dark theme"] }
];

module.exports = function (h) {
    function getPref(env, key) {
        return h.lunaCall(env, PREFS + "getPreferences", { keys: [key] }).then(function (r) { return r[key]; }, function () { return undefined; });
    }
    function read(env, name) {
        var s = SETTINGS[name];
        if (s.assistant) return Promise.resolve(!!(env.settings && env.settings[s.assistant]));
        return getPref(env, s.key).then(function (v) {
            var x = s.field ? (v && typeof v === "object" ? v[s.field] : undefined) : v;
            return typeof x === "boolean" ? x : s.dflt;
        });
    }
    function write(env, name, on) {
        var s = SETTINGS[name];
        if (s.assistant) {
            var c = {};
            c[s.assistant] = on;
            // Its answer has the settings as they are now: read back from there.
            return Promise.resolve(env.setSettings(c)).then(function (r) { if (r && r.settings) env.settings = r.settings; return r; });
        }
        if (!s.field) { var p = {}; p[s.key] = on; return h.lunaCall(env, PREFS + "setPreferences", p); }
        // An object preference: the rest of it kept (as Settings' accessibility.set).
        return getPref(env, s.key).then(function (v) {
            var o = Object.assign({}, v && typeof v === "object" ? v : {});
            o[s.field] = on;
            var p = {};
            p[s.key] = o;
            return h.lunaCall(env, PREFS + "setPreferences", p);
        });
    }
    var SETTINGS_APP = "org.webosphoenix.settings";
    var PAGE = { previews: "screen", lockNotifications: "screen", blink: "screen", screenTimeout: "screen", systemSounds: "sounds", keyboardClicks: "sounds",
                 highContrast: "accessibility", reduceMotion: "accessibility", captions: "accessibility", monoAudio: "accessibility",
                 dropShare: "dropshare", networkTime: "datetime", nightMode: "exhibition", wakeWord: "assistant", voiceReplies: "assistant", darkMode: "accessibility" };
    function open(name) { return { appId: SETTINGS_APP, params: { page: PAGE[name] || "" }, title: "Settings" }; }

    function run(args, env) {
        var say = env.lang.say, name = args.setting;
        if (name === "darkMode") {
            return read(env, "highContrast").then(function (hc) {
                return { text: say.noDarkMode(hc), open: open(name),
                         actions: hc ? undefined : [{ label: say.turnOnHighContrast(), answer: "yes", run: { command: "deviceSetting", args: { setting: "highContrast", state: "on" } } }] };
            });
        }
        if (name === "screenTimeout") {
            if (args.state === "status")
                return getPref(env, "screenTimeout").then(function (v) { return { text: say.screenTimeoutIs(Number(v) || 60), open: open(name) }; });
            var want = Number(args.seconds) || 0;
            if (!want) return Promise.resolve({ text: say.screenTimeoutChoices(TIMEOUTS) });
            // The nearest of Settings' choices (the screen cannot stay on for good: the battery).
            var to = TIMEOUTS.reduce(function (b, x) { return Math.abs(x - want) < Math.abs(b - want) ? x : b; }, TIMEOUTS[0]);
            return h.lunaCall(env, PREFS + "setPreferences", { screenTimeout: to }).then(function () {
                return getPref(env, "screenTimeout").then(function (v) {
                    if (Number(v) !== to) return { text: say.settingNotChanged(name), failed: true, open: open(name) };
                    return { text: say.screenTimeoutSet(to, to !== want), open: open(name) };
                });
            });
        }
        if (!SETTINGS[name]) return Promise.resolve({ text: say.noSuchSetting() });
        return read(env, name).then(function (cur) {
            if (args.state === "status")
                return { text: say.deviceSettingIs(name, cur), open: open(name),
                         actions: [{ label: say.turnSettingOn(name, !cur), run: { command: "deviceSetting", args: { setting: name, state: cur ? "off" : "on" } } }] };
            var on = args.state === "on", s = SETTINGS[name];
            if (cur === on) return { text: say.deviceSettingAlready(name, on), open: open(name) };
            // What it was, for "undo": the preference as a whole (an object one with its other fields).
            var before = s.assistant ? Promise.resolve(null) : getPref(env, s.key);
            return before.then(function (was) {
                return write(env, name, on).then(function () { return read(env, name); }).then(function (now) {
                    // Said only when it is so (read back from where Settings reads it).
                    if (now !== on) return { text: say.settingNotChanged(name), failed: true, open: open(name) };
                    var back = {};
                    if (s.assistant) back[s.assistant] = !on;
                    else back[s.key] = was === undefined ? (s.field ? {} : s.dflt) : was;
                    return { text: say.deviceSettingSet(name, on), open: open(name),
                             undo: s.assistant ? { kind: "settings", settings: back, what: say.undoSetting(name, on) }
                                               : { kind: "prefs", prefs: back, what: say.undoSetting(name, on) } };
                });
            });
        });
    }

    return {
        COMMANDS: COMMANDS,
        prepare: function (cmd, args, env) {
            if (cmd.id !== "deviceSetting") return null;
            if (NAMES.indexOf(args.setting) < 0) return Promise.resolve({ args: args, reply: env.lang.say.noSuchSetting() });
            // What messages say, shown to anyone holding the phone: read back first.
            if (args.setting === "previews" && args.state === "on") return Promise.resolve({ args: args, confirm: env.lang.say.confirmPreviews() });
            return null;
        },
        run: function (cmd, args, env) { return cmd.id === "deviceSetting" ? run(args, env) : null; },
        SETTINGS: SETTINGS
    };
};
