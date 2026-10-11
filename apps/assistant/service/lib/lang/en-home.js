// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// English for lib/commands-home.js: lights, switches, fans, the thermostat,
// locks, garage doors and scenes, through the user's Home Assistant. Every
// rule here waits for Home Assistant to be connected (ctx.home: its
// entities' names and kinds); until then "turn off the lights" is the
// grammar's "I can't control other devices" (lib/lang/en.js NOT_HERE),
// which says where to connect it. The phone's own come first: "turn on the
// light" is the flashlight, "lock the screen" the phone, "turn off the
// alarm" an alarm. h: lib/lang/en.js's helpers.

"use strict";

module.exports = function (h) {
    // What is the phone's, whatever a device in the house is called.
    var PHONE = /\b(?:phone|screen|display|flash ?light|torch|wi-?fi|bluetooth|hotspot|alarms?|timers?|stopwatch|music|songs?|podcasts?|volume|ringer|ringtone|notifications?|dnd|do not disturb|airplane|location|gps|vpn|keyboard|camera|recording|video|navigation|driving|assistant|routines?|reminders?)\b/;
    // The words for each kind of device, when no name in Home Assistant is said.
    var KINDS = {
        light: /\b(?:lights?|lamps?|bulbs?|chandeliers?|sconces?|light strips?|led strips?|lighting)\b/,
        climate: /\b(?:thermostat|heat|heating|heater|furnace|ac|a\/c|air ?con(?:ditioning|ditioner)?|hvac|temperature)\b/,
        lock: /\b(?:locks?|deadbolts?|doors?)\b/,
        cover: /\b(?:garage(?: doors?)?|blinds|shades|shutters|curtains|gate|awnings?|garage)\b/,
        fan: /\bfans?\b/,
        // The rest of what people switch (Home Assistant's switches and plugs).
        other: /\b(?:switch(?:es)?|plugs?|outlets?|sockets?|kettle|coffee (?:maker|machine)|tv|television|telly|heater|vacuum|roomba|oven|fridge|dishwasher|washing machine|dryer|sprinklers?|alarm system|security system|speakers?|pump|humidifier|dehumidifier|purifier|christmas tree|car)\b/
    };
    var ON_OFF = ["light", "switch", "fan", "input_boolean", "climate", "other"];
    function fold(s) {
        return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(?:the|my|all|our|of|in|at)\b/g, " ").replace(/\blights\b/g, "light")
            .replace(/\blamps\b/g, "lamp").replace(/\s+/g, " ").trim();
    }
    // A name in Home Assistant of one of these kinds: the words said are all in it.
    function named(target, ctx, kinds) {
        var t = fold(target), words = t.split(" ").filter(Boolean);
        if (!words.length) return null;
        return (ctx.home.entities || []).filter(function (e) {
            if (kinds.indexOf(e.domain) < 0) return false;
            var n = " " + fold(e.name) + " ";
            return words.every(function (w) { return n.indexOf(" " + w + " ") >= 0; });
        })[0] || null;
    }
    // The device said: one of the house's, not the phone's own ("the light"
    // alone is the house's, as the grammar has it without Home Assistant:
    // NOT_HERE; "the flashlight" the phone's).
    function device(target, ctx, kinds) {
        var t = String(target || "").trim();
        if (!t || PHONE.test(t) || (h.toggleTarget && h.toggleTarget(t) && !/^(?:the )?light$/.test(t))) return null;
        if (named(t, ctx, kinds)) return t;
        for (var i = 0; i < kinds.length; ++i) if (KINDS[kinds[i]] && KINDS[kinds[i]].test(t)) return t;
        if (kinds.indexOf("switch") >= 0 && KINDS.other.test(t)) return t;
        return null;
    }
    function strip(s) { return String(s).replace(/^(?:all (?:of )?)?(?:the |my |our )?/, "").replace(/ please$/, "").trim(); }
    function scene(t, ctx) {
        var m;
        if ((m = /^(?:activate|run|start|turn on|set|apply|switch to|go to|enable|trigger|put on) (?:the |my )?(.+?) scene$/.exec(t))) return { name: m[1] };
        if ((m = /^(?:activate|run|start|turn on|set|apply|switch to|enable|trigger) (?:the |my )?scene (?:called |named )?(.+)$/.exec(t))) return { name: m[1] };
        if ((m = /^scene (.+)$/.exec(t))) return { name: m[1] };
        // A scene's own name ("activate movie night", "movie night").
        if ((m = /^(?:(?:activate|run|start|turn on|set|apply|switch to|enable|trigger|it's|time for) )?(?:the |my )?(.+)$/.exec(t))) {
            var f = fold(m[1]);
            var s = (ctx.home.entities || []).filter(function (e) { return e.domain === "scene" && fold(e.name) === f; })[0];
            if (s) return { name: s.name };
        }
        return null;
    }
    function lock(t, ctx) {
        var m;
        if (/^lock (?:up|everything|the house|all the doors|the doors)$/.test(t)) return { action: "lock", target: "doors" };
        if ((m = /^(lock|unlock) (.+)$/.exec(t)) && device(strip(m[2]), ctx, ["lock"])) return { action: m[1], target: strip(m[2]) };
        return null;
    }
    function cover(t, ctx) {
        var m;
        if ((m = /^(open|close|shut|raise|lower|pull up|pull down|roll up|roll down) (.+)$/.exec(t)) && device(strip(m[2]), ctx, ["cover"]))
            return { action: /^(?:open|raise|pull up|roll up)$/.test(m[1]) ? "open" : "close", target: strip(m[2]) };
        return null;
    }
    function set(t, ctx) {
        var m, kinds = ["light", "climate", "fan"];
        var VALUE = " (?:up |down )?(?:to|at) (\\d+(?:\\.\\d+)?)(?: ?%| percent| degrees?(?: fahrenheit| celsius| f| c)?| brightness)?$";
        if ((m = new RegExp("^(?:set|turn|put|change|dim|brighten|raise|lower|bring|make) (.+?)" + VALUE).exec(t)) && device(strip(m[1]), ctx, kinds))
            return { action: "set", target: strip(m[1]), value: Number(m[2]) };
        // "Turn up the heat", "make it warmer": a step from where the thermostat is set.
        if ((m = /^(?:turn|crank|bump|put) (up|down) (?:the )?(heat|heating|thermostat|temperature|ac|air ?con(?:ditioning)?)$|^(?:turn|crank|bump) (?:the )?(heat|heating|thermostat|temperature) (up|down)$/.exec(t)))
            return { action: (m[1] || m[4]) === "up" ? "up" : "down", target: m[2] || m[3] };
        if ((m = /^(?:make it (warmer|cooler|colder)|it's too (hot|warm|cold|chilly)) ?(?:in here|inside|in the house)?$/.exec(t)))
            return { action: /^(?:warmer|cold|chilly)$/.test(m[1] || m[2]) ? "up" : "down", target: "thermostat" };
        // "Dim the lights": low; "brighten them": full.
        if ((m = /^(dim|brighten) (.+)$/.exec(t)) && device(strip(m[2]), ctx, ["light"])) return { action: "set", target: strip(m[2]), value: m[1] === "dim" ? 30 : 100 };
        return null;
    }
    function status(t, ctx) {
        var m;
        if (/^(?:what(?:'s| is) the (?:thermostat|heat|heating)(?: set to| at| on)?|what(?:'s| is) the (?:temperature|temp) (?:inside|in here|in the house|at home|in the living room)|what(?:'s| is) the (?:thermostat|temperature) set to|how (?:warm|hot|cold) is it (?:inside|in here|in the house|at home))$/.test(t))
            return { action: "status", target: "thermostat" };
        if ((m = /^(?:is|are) (.+?) (?:still )?(?:on|off|locked|unlocked|open|closed|shut|lit|running)$/.exec(t)) && device(strip(m[1]), ctx, ["light", "switch", "fan", "input_boolean", "climate", "lock", "cover", "other"]))
            return { action: "status", target: strip(m[1]) };
        if ((m = /^did i (?:leave|lock|close|shut) (.+?)(?: on| open| unlocked)?$/.exec(t)) && device(strip(m[1]), ctx, ["light", "switch", "fan", "lock", "cover", "other"]))
            return { action: "status", target: strip(m[1]) };
        return null;
    }
    function onOff(t, ctx) {
        var m, target = "", state = "";
        if ((m = /^(?:turn|switch|put|flip|shut) (on|off) (.+)$/.exec(t))) { state = m[1]; target = m[2]; }
        else if ((m = /^(?:turn|switch|put|flip|shut) (.+?) (on|off)$/.exec(t))) { state = m[2]; target = m[1]; }
        else if ((m = /^(.+?) (on|off|out)$/.exec(t)) && !/^(?:turn|switch|put|set|keep|leave|is|are)\b/.test(t)) { state = m[2] === "out" ? "off" : m[2]; target = m[1]; }
        else if ((m = /^(kill|cut|start|stop|enable|disable|power on|power off|power up|power down) (.+)$/.exec(t))) { state = /^(?:start|enable|power on|power up)$/.test(m[1]) ? "on" : "off"; target = m[2]; }
        if (!target || !device(strip(target), ctx, ON_OFF)) return null;
        return { action: state, target: strip(target) };
    }
    // Other words for the house's devices, with Home Assistant connected
    // ("preheat the oven", "arm the alarm system"): what it can do, not the
    // "I can't control other devices" without it (lib/lang/en.js NOT_HERE).
    function other(t) {
        if (!/^(?:turn|switch|set|put|lock|unlock|open|close|start|stop|dim|brighten|raise|lower|run|warm up|cool down|heat up|preheat|arm|disarm)\b/.test(t) || PHONE.test(t)) return null;
        for (var k in KINDS) if (KINDS[k].test(t)) return { what: "homeOther" };
        return null;
    }
    // Every one waits for Home Assistant (ctx.home).
    function when(fn) { return function (t, ctx) { return ctx.home ? fn(t, ctx) : null; }; }

    function names(list) { return h.list(list.map(function (n) { return "the " + n; })); }
    function degrees(v) { return Math.round(v * 10) / 10 + "°"; }
    var say = {
        homeNotConnected: function () { return "Connect your Home Assistant first, in Settings > Assistant > Smart Home."; },
        homeUnreachable: function () { return "I couldn't reach your Home Assistant. Check its address in Settings > Assistant > Smart Home, and that the phone is on a network that reaches it."; },
        homeAuth: function () { return "Home Assistant didn't take the access token. Make a new long-lived token in Home Assistant (your profile, Security) and enter it in Settings > Assistant > Smart Home."; },
        homeBadUrl: function () { return "That isn't a web address. Enter your Home Assistant's, like http://homeassistant.local:8123."; },
        homeNeedsToken: function () { return "Enter a long-lived access token: in Home Assistant, your profile, Security, Create Token."; },
        noSuchDevice: function (what) { return "I couldn't find “" + what + "” in your Home Assistant."; },
        noSuchScene: function (what) { return "I couldn't find a scene called “" + what + "” in your Home Assistant."; },
        homeSetWhat: function (name) { return "To what? Say, for example, “set the " + name + " to 50%”."; },
        confirmHome: function (action, list) { return (action === "unlock" ? "Unlock " : "Open ") + names(list) + "?"; },
        homeDone: function (list, action, value, moving, climate) {
            var n = names(list), many = list.length > 1;
            if (action === "lock") return moving ? "Locking " + n + "." : "Locked " + n + ".";
            if (action === "unlock") return moving ? "Unlocking " + n + "." : "Unlocked " + n + ".";
            if (action === "open") return moving ? "Opening " + n + "." : h.capital(n) + (many ? " are" : " is") + " open.";
            if (action === "close") return moving ? "Closing " + n + "." : h.capital(n) + (many ? " are" : " is") + " closed.";
            if (action === "set") return climate ? "Set " + n + " to " + degrees(value) + "."
                                  : "Set " + n + " to " + Math.round(value) + "%.";
            return "Turned " + (action === "off" ? "off " : "on ") + n + ".";
        },
        homeNotConfirmed: function (list, action) {
            return "I asked Home Assistant to " + ({ on: "turn on", off: "turn off", set: "change", lock: "lock", unlock: "unlock", open: "open", close: "close" }[action] || action) + " " +
                names(list) + ", but it doesn't say it did. Check it in Home Assistant.";
        },
        deviceState: function (list) {
            return list.map(function (d) {
                var a = d.attributes || {}, n = h.capital("the " + d.name);
                // A thermostat: its mode (Home Assistant's HVAC modes), what it is set to, and how warm it is.
                if (a.current_temperature !== undefined || a.temperature !== undefined) {
                    var mode = { heat: "heating", cool: "cooling", heat_cool: "on auto", auto: "on auto", dry: "drying", fan_only: "on fan only" }[d.state];
                    return n + " is " + (d.state === "off" ? "off" : (mode ? mode + ", " : "") + (a.temperature !== undefined && a.temperature !== null ? "set to " + degrees(Number(a.temperature)) : "on")) +
                        (a.current_temperature !== undefined ? "; it's " + degrees(Number(a.current_temperature)) + " inside" : "") + ".";
                }
                if (d.state === "on" && a.brightness !== undefined) return n + " is on, at " + Math.round(a.brightness / 2.55) + "%.";
                if (d.state === "unavailable" || d.state === "unknown") return "Home Assistant can't reach " + "the " + d.name + ".";
                return n + " is " + d.state + ".";
            }).join(" ");
        },
        sceneOn: function (name) { return "Turned on the " + name + " scene."; },
        undoHome: function (list) { return "put " + names(list) + " back as " + (list.length > 1 ? "they were" : "it was"); }
    };

    return {
        rules: [["homeScene", when(scene)], ["home", when(lock)], ["home", when(cover)], ["home", when(set)], ["home", when(status)], ["home", when(onOff)],
                ["beyond", when(other)]],
        say: say,
        MENTIONS: {
            home: /\b(lights?|lamps?|thermostat|heat\w*|temperature|ac|fans?|doors?|locks?|unlock|garage|blinds|shades|curtains|switch|plug|outlet|tv|kitchen|bedroom|living room|house|home)\b/,
            homeScene: /\b(scene|mood|movie|night|morning|dinner|relax\w*|party)\b/
        },
        describe: function (command, args) {
            if (command === "homeScene") return "turn on the " + (args.name || "") + " scene";
            if (command !== "home") return "";
            var what = "the " + (args.target || "device");
            return ({ on: "turn on " + what, off: "turn off " + what, lock: "lock " + what, unlock: "unlock " + what, open: "open " + what, close: "close " + what,
                      set: "set " + what + " to " + (args.value || ""), up: "turn up " + what, down: "turn down " + what, status: "check " + what }[args.action]) || "";
        },
        help: { title: "Smart Home", examples: ["Turn off the living room lights", "Set the thermostat to 70", "Is the front door locked?", "Activate movie night"] }
    };
};
