// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// English for lib/commands-settings.js: the switches of Settings the
// toggle command does not have, and dark mode. h: lib/lang/en.js's helpers.

"use strict";

module.exports = function (h) {
    // The words for each, as people say them. inverted: the switch is the
    // other way round ("turn off animations": Reduce motion on).
    var WORDS = [
        ["darkMode", "(?:the )?(?:dark|dark theme|dark appearance|black theme)(?: mode| theme)?"],
        ["nightMode", "(?:the )?night mode|(?:the )?exhibition(?:'s)? night mode"],
        ["previews", "(?:the )?(?:message |notification |lock screen )?previews(?: (?:on|of) (?:the |my )?lock screen| when (?:it's |the phone is )?locked| of (?:my )?(?:messages|notifications))?|(?:message|notification) (?:text|contents?) on (?:the |my )?lock screen"],
        ["lockNotifications", "(?:the )?notifications (?:on (?:the |my )?lock screen|when (?:it's |the phone is )?locked)|(?:the )?lock screen notifications"],
        ["blink", "(?:the )?(?:notification|blinking|message|led) light|(?:the )?(?:notification )?led(?: light)?|(?:the )?light for notifications|blink(?:ing)? notifications|(?:the )?blinking"],
        ["systemSounds", "(?:the )?system sounds"],
        ["keyboardClicks", "(?:the )?(?:keyboard (?:clicks|sounds|click sounds)|key ?(?:clicks|sounds)|typing sounds|keyboard clicking)"],
        ["highContrast", "high contrast(?: mode)?"],
        ["reduceMotion", "(?:reduce|reduced) motion"],
        ["animations", "(?:the )?animations"],
        ["captions", "(?:the )?(?:captions|closed captions|subtitles)(?: on videos)?"],
        ["monoAudio", "mono audio|mono sound"],
        ["dropShare", "dropshare|drop share"],
        ["networkTime", "(?:the )?(?:network time|automatic time|automatic date and time|network date and time)"],
        ["wakeWord", "hey phoenix|(?:the )?wake word|listening for hey phoenix"],
        ["voiceReplies", "(?:the )?(?:spoken answers|voice replies|spoken replies|talking back|answers aloud|voice answers)"]
    ];
    var ON = "(?:turn on|switch on|enable|activate|start|use|put on|show|allow)";
    var OFF = "(?:turn off|switch off|disable|deactivate|stop|hide|don't show|do not show|stop showing|no more|stop using)";
    function deviceSetting(t) {
        var m;
        for (var i = 0; i < WORDS.length; ++i) {
            var name = WORDS[i][0], w = WORDS[i][1];
            var set = name === "animations" ? "reduceMotion" : name;
            var flip = function (s) { return name === "animations" ? (s === "on" ? "off" : s === "off" ? "on" : s) : s; };
            if (new RegExp("^" + ON + " (?:the )?(?:" + w + ")$|^(?:" + w + ") on$|^(?:turn|switch) (?:the )?(?:" + w + ") on$").test(t)) return { setting: set, state: flip("on") };
            if (new RegExp("^" + OFF + " (?:the )?(?:" + w + ")$|^(?:" + w + ") off$|^(?:turn|switch) (?:the )?(?:" + w + ") off$").test(t)) return { setting: set, state: flip("off") };
            if (new RegExp("^(?:is|are) (?:the )?(?:" + w + ") (?:on|off|enabled|turned on|switched on)$|^(?:do i have|is there) (?:" + w + ")(?: on)?$").test(t)) return { setting: set, state: "status" };
        }
        // Dark mode, said other ways ("make the screen dark", "go dark").
        if (/^(?:dark mode|dark theme)(?: please)?$/.test(t)) return { setting: "darkMode", state: "on" };
        if (/^(?:make|switch|turn|change) (?:the )?(?:screen|phone|display|theme|apps?) (?:to )?(?:dark|darker|black)(?: mode)?$|^(?:go|switch to) dark(?: mode)?$/.test(t)) return { setting: "darkMode", state: "on" };
        // "Set the screen timeout to 2 minutes", "turn the screen off after 5 minutes".
        if ((m = /^(?:set|change|make) (?:the |my )?(?:screen )?(?:timeout|time ?out|screen off time|sleep time|auto ?lock)(?: to| at| for)? (.+)$|^(?:turn|switch) (?:the )?screen off after (.+)$|^keep the screen on (?:for )?(.+)$/.exec(t))) {
            var secs = h.duration(m[1] || m[2] || m[3]);
            if (secs) return { setting: "screenTimeout", state: "set", seconds: secs };
        }
        if (/^(?:how long|when) (?:is|does) (?:the |my )?screen (?:timeout|stay on|turn off)$|^what(?:'s| is) (?:the |my )?screen timeout$/.test(t)) return { setting: "screenTimeout", state: "status" };
        return null;
    }

    var NAME = {
        previews: "Previews on the lock screen", lockNotifications: "Notifications on the lock screen", blink: "The notification light",
        systemSounds: "System sounds", keyboardClicks: "Keyboard clicks", highContrast: "High contrast", reduceMotion: "Reduce motion",
        captions: "Captions", monoAudio: "Mono audio", dropShare: "DropShare", networkTime: "Network time", nightMode: "Exhibition's night mode",
        wakeWord: "Listening for “Hey Phoenix”", voiceReplies: "Answers aloud", screenTimeout: "The screen timeout"
    };
    var PLURAL = { previews: 1, lockNotifications: 1, systemSounds: 1, keyboardClicks: 1, captions: 1, voiceReplies: 1 };
    function is(n) { return PLURAL[n] ? "are" : "is"; }
    function seconds(s) { return s < 60 ? s + " seconds" : s === 60 ? "1 minute" : s / 60 + " minutes"; }
    var say = {
        deviceSettingIs: function (n, on) { return (on ? "Yes, " : "No, ") + NAME[n].charAt(0).toLowerCase() + NAME[n].slice(1) + " " + is(n) + (on ? " on." : " off."); },
        deviceSettingAlready: function (n, on) { return NAME[n] + " " + is(n) + " already " + (on ? "on." : "off."); },
        deviceSettingSet: function (n, on) { return NAME[n] + " " + is(n) + " " + (on ? "on." : "off."); },
        settingNotChanged: function (n) { return "I couldn't change that: " + NAME[n].charAt(0).toLowerCase() + NAME[n].slice(1) + " didn't change when I checked."; },
        turnSettingOn: function (n, on) { return on ? "Turn It On" : "Turn It Off"; },
        undoSetting: function (n, on) { return "turn " + NAME[n].charAt(0).toLowerCase() + NAME[n].slice(1) + " back " + (on ? "off" : "on"); },
        confirmPreviews: function () { return "Show what your messages say on the lock screen, to anyone holding the phone?"; },
        noDarkMode: function (highContrast) {
            return "Phoenix doesn't have a dark mode yet: webOS's look has none, and the 2.0 design brings light and dark." +
                   (highContrast ? " High contrast is on." : " Should I turn on high contrast instead, for darker text?");
        },
        turnOnHighContrast: function () { return "Turn On High Contrast"; },
        noSuchSetting: function () { return "I can't change that setting. It may be in Settings."; },
        screenTimeoutIs: function (s) { return "The screen turns off after " + seconds(s) + "."; },
        screenTimeoutSet: function (s, nearest) { return "The screen turns off after " + seconds(s) + " now." + (nearest ? " (That's the nearest Settings has.)" : ""); },
        screenTimeoutChoices: function (list) { return "How long? It can be " + h.list(list.map(seconds), "or") + "."; }
    };

    return {
        rules: [["deviceSetting", deviceSetting]],
        say: say,
        // A model's choice of these needs the words of one of them.
        MENTIONS: { deviceSetting: /\b(dark|night|preview\w*|lock screen|notification\w*|light|led|blink\w*|sounds?|click\w*|contrast|motion|animation\w*|captions?|subtitles?|mono|dropshare|time|phoenix|wake|answers?|replies|screen|timeout)\b/ },
        describe: function (command, args) {
            if (command !== "deviceSetting") return "";
            if (args.setting === "screenTimeout") return "set the screen to turn off after " + (args.seconds ? seconds(args.seconds) : "a while");
            var n = NAME[args.setting];
            if (!n) return "change a setting";
            return "turn " + n.charAt(0).toLowerCase() + n.slice(1) + " " + (args.state === "off" ? "off" : "on");
        },
        help: { title: "Settings", examples: ["Turn off the keyboard clicks", "Hide previews on the lock screen", "Set the screen timeout to 2 minutes", "Turn on high contrast"] }
    };
};
