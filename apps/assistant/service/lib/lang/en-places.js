// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// English for lib/commands-places.js: where I parked, reminders when I get
// to or leave a place, and home and work. h: lib/lang/en.js's helpers.

"use strict";

module.exports = function (h) {
    // ---- Parking ----
    var SPOT = "(?:(?:my|the) (?:parking (?:spot|space|place|location)|car(?:'s)? (?:location|spot|position)|parked car|car park(?:ing)? spot)|parking(?: spot| location)?)";
    var WHERE_I_PARKED = "where (?:i(?:'ve| have)?|we(?:'ve| have)?) (?:parked|left (?:the|my) car)";
    var PREP_NOTE = "((?:on|at|in|by|near|next to|outside|behind|across from|opposite|under|beside) .+)";
    function parking(t, ctx) {
        var m;
        if (new RegExp("^(?:remember|save|mark|note|store|record|keep track of|pin)(?: down)? (?:" + WHERE_I_PARKED + "|" + SPOT + ")(?: (?:here|now|for me))*$").test(t))
            return { action: "save", note: "" };
        // "I parked here", "I just parked", "remember I parked on level 3", "I parked in row F".
        if ((m = new RegExp("^(?:remember (?:that )?)?(?:i(?:'ve| have)?|we(?:'ve| have)?)(?: just)? (?:parked|left (?:the|my) car)(?: the car)?(?: here| right here| now)*(?: " + PREP_NOTE + ")?$").exec(t))
            && (m[1] || /\b(?:here|now|remember|just)\b/.test(t)))
            return { action: "save", note: m[1] ? h.cased(m[1].replace(/\s+/g, " ").trim(), ctx) : "" };
        if ((m = new RegExp("^remember (?:that )?(?:my|the) car is " + PREP_NOTE + "$").exec(t))) return { action: "save", note: h.cased(m[1], ctx) };
        if (new RegExp("^(?:forget|clear|delete|remove|erase|reset)(?: " + WHERE_I_PARKED + "| " + SPOT + "| where (?:my|the) car is)$").test(t) ||
            /^(?:i|we)(?:'ve| have)? (?:got|found|picked up|collected) (?:my|the|our) car(?: back)?$/.test(t))
            return { action: "forget", note: "" };
        return null;
    }
    function findParking(t) {
        if (/^(?:where (?:did|do|have) (?:i|we) (?:park|parked|leave (?:the|my|our) car|left (?:the|my|our) car)(?: (?:the|my|our) car)?(?: again| today)?|where(?:'s| is| was) (?:my|the|our) (?:car|parked car|parking (?:spot|space))(?: parked)?(?: again)?|where am i parked|where are we parked|(?:find|locate|show me|show) (?:my|the|our) (?:car|parked car|parking (?:spot|space))|(?:find|show me|show) where (?:i|we) (?:parked|left (?:the|my|our) car)|how far (?:away )?is (?:my|the|our) car|do you (?:know|remember) where (?:i|we) parked)$/.test(t))
            return { directions: false };
        if (/^(?:take me|get me|walk me|lead me|guide me|bring me)(?: back)? to (?:my|the|our) (?:car|parked car|parking spot)|^(?:directions|navigate|navigation|the way)(?: back)? to (?:my|the|our) (?:car|parked car|parking spot)$|^how do (?:i|we) get(?: back)? to (?:my|the|our) car$/.test(t))
            return { directions: true };
        return null;
    }

    // ---- Reminders at a place ----
    var LEAD = "(?:remind me|set a reminder|set up a reminder|create a reminder|add a reminder|make a reminder|new reminder|reminder|ping me|nudge me|alert me)";
    var WHEN = "(?:when|once|as soon as|whenever|the next time|next time|after)";
    var WHO = "((?:i|we)(?:'m|'re|'ve)? ";   // the clause: "i get home", "i'm leaving work"
    var LEAVE = /^i (?:leave|am leaving|head out(?: of| from)?|get out of|walk out of|step out of|go out of|depart(?: from)?|clock out(?: of| from| at)?|get off|finish(?: up)?(?: at)?|am done at|am finished at|drive away from|pull out of|exit)(?: (.+))?$/;
    var ARRIVE = /^i (?:get back|get|arrive back|arrive|come back|come|make it back|make it|am back|am|return|reach|show up|turn up|walk in|walk into|pull into|pull up)(?: (?:to|at|in|into|up to|up at|over to|home to))?(?: (.+))?$/;
    function placeWord(w, when) {
        w = String(w || "").trim().replace(/ (?:today|tonight|tomorrow|later|again|next|now)$/, "");
        if (!w || /^(?:back|here|back here|this place|this spot|in)$/.test(w)) return { place: "here", when: when };
        if (/^(?:home|back home|my house|my place|the house|my apartment|my flat|my home|the apartment)$/.test(w)) return { place: "home", when: when };
        if (/^(?:work|the office|my office|office|my work|my job|the job|my workplace)$/.test(w)) return { place: "work", when: when };
        if (/^(?:to|that|about|and|so|then|if|there|it|that|a|an|on|for|with|my way)\b/.test(w) || w.split(" ").length > 4) return null;
        if (/\b(?:remind|me|i|you|to)\b/.test(w)) return null;
        return { place: w.replace(/^(?:the|my) /, ""), when: when };   // a place saved in Maps, by its name
    }
    function clauseOf(c) {
        c = c.replace(/^we(?:'re| are)?\b/, "i").replace(/^i'm\b/, "i am").replace(/^i've\b/, "i have");
        var m;
        if ((m = LEAVE.exec(c))) return placeWord(m[1], "leave");
        if ((m = ARRIVE.exec(c))) return placeWord(m[1], "arrive");
        return null;
    }
    // "remind me to buy milk when I get home", "remind me when I get to work
    // to email Sam", "when I leave work remind me to call Mom".
    function placeReminder(t, ctx) {
        var m, at, text = "";
        if ((m = new RegExp("^" + WHEN + " " + WHO + "(?:.+?)),? " + LEAD + "(?: to| that| about)? (.+)$").exec(t)) && (at = clauseOf(m[1]))) text = m[2];
        else if ((m = new RegExp("^" + LEAD + " " + WHEN + " " + WHO + ".+)$").exec(t))) {
            // The words after the place: try the longest place first ("when I get to work to email Sam").
            var rest = m[1], cuts = [];
            var re = /,? (?:to|that|about) /g, x;
            while ((x = re.exec(rest))) cuts.push({ at: x.index, end: x.index + x[0].length });
            for (var i = cuts.length - 1; i >= 0 && !text; --i) {
                var c = clauseOf(rest.slice(0, cuts[i].at));
                if (c && rest.slice(cuts[i].end)) { at = c; text = rest.slice(cuts[i].end); }
            }
        } else if ((m = new RegExp("^" + LEAD + "(?: to| that| about| for)? (.+?),? " + WHEN + " " + WHO + ".+)$").exec(t)) && (at = clauseOf(m[2]))) text = m[1];
        if (!text || !at) return null;
        text = text.replace(/^(?:to|that|about) /, "").trim();
        if (!text || /^(?:me|it|this|that)$/.test(text)) return null;
        return { text: h.cased(text, ctx), place: at.place, when: at.when };
    }

    // ---- Home and work ----
    var PLACE = "(home|work|the office|my office|office)";
    var HERE = "(?:here|this(?: place| spot| location| address)?|where i am(?: now)?|my (?:current )?location|the current location)";
    function placeKey(w) { return /home/.test(w) ? "home" : "work"; }
    function setPlace(t, ctx) {
        var m;
        if ((m = new RegExp("^(?:this is|here is|here's) (?:my )?" + PLACE + "(?: now)?$").exec(t))) return { place: placeKey(m[1]) };
        if ((m = /^(?:this is where|here is where|i) (live|work)(?: here)?(?: now)?$/.exec(t)) && (/here|where/.test(t))) return { place: m[1] === "live" ? "home" : "work" };
        if ((m = new RegExp("^(?:set|save|make|mark|use|remember)(?: that)? " + HERE + "(?: as| to be| is)? (?:my )?" + PLACE + "(?: address| location)?$").exec(t))) return { place: placeKey(m[1]) };
        if ((m = new RegExp("^(?:set|save|change|update|make|put)(?: my)? " + PLACE + "(?: address| location)? (?:to|as|is|at) " + HERE + "$").exec(t))) return { place: placeKey(m[1]) };
        if ((m = new RegExp("^remember (?:that )?(?:this is|here is|here's) (?:my )?" + PLACE + "$").exec(t))) return { place: placeKey(m[1]) };
        if ((m = new RegExp("^(?:my )?" + PLACE + "(?: address| location)? is (?:here|this place|this spot)$").exec(t))) return { place: placeKey(m[1]) };
        // An address: Maps finds it (commands-places.js says how).
        if ((m = new RegExp("^(?:set|save|change|update|make|put)(?: my)? " + PLACE + " (?:address|location)(?: to| as| is)? (.+)$").exec(t)) && !new RegExp("^" + HERE + "$").test(m[2]))
            return { place: placeKey(m[1]), address: h.cased(m[2], ctx) };
        return null;
    }

    // ---- What it says ----
    function distanceText(m, imperial) {
        if (imperial) {
            var mi = m / 1609.344;
            if (mi < 0.1) return Math.max(10, Math.round(m * 3.28084 / 10) * 10) + " feet";
            var r = mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi);
            return r + (r === 1 ? " mile" : " miles");
        }
        if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + " meters";
        var km = m < 10000 ? Math.round(m / 100) / 10 : Math.round(m / 1000);
        return km + (km === 1 ? " kilometer" : " kilometers");
    }
    function ago(at, now) {
        var min = Math.round((now - at) / 60000);
        if (min < 1) return "just now";
        if (min < 60) return h.plural(min, "minute") + " ago";
        if (min < 360) return "about " + h.plural(Math.round(min / 60), "hour") + " ago";
        var day = h.dayText(at, now);
        return (day === "today" ? "" : day + " ") + "at " + h.timeText(at);
    }
    function placeName(place) { return place === "home" ? "home" : place === "work" ? "work" : place === "here" ? "here" : "“" + h.capital(place) + "”"; }
    function placePhrase(when, place) {
        if (when === "leave") return "when you leave " + (place === "here" ? "here" : place === "home" ? "home" : place === "work" ? "work" : h.capital(place));
        return place === "here" ? "when you get back here" : place === "home" ? "when you get home" : place === "work" ? "when you get to work" : "when you get to " + h.capital(place);
    }
    var say = {
        locationNeed: function (purpose) {
            return { parking: "remember where you parked", placeReminder: "remind you when you get there", home: "save where you are" }[purpose] || "";
        },
        yourCar: function () { return "Your car"; },
        parked: function (note) { return "Got it. I've saved where you parked" + (note ? ", " + note : "") + ". Ask me “where did I park?” to find it."; },
        parkingForgotten: function () { return "OK, I've forgotten where you parked."; },
        noParking: function () { return "I don't know where you parked. When you park, say “remember where I parked”."; },
        parkedAt: function (spot, m, dir, now, imperial) {
            var where = m < 0 ? "Your car is " + (spot.address ? "near " + spot.address : "where you saved it") + "."
                : m < 30 ? "Your car is right around here."
                : "Your car is about " + distanceText(m, imperial) + (dir ? " " + dir : "") + " of here.";
            return where + " You parked " + ago(spot.at, now) + (spot.note ? ", " + spot.note : "") + ".";
        },
        walkThere: function () { return "Walking Directions"; },
        placeNote: function (when, place) { var p = placePhrase(when, place); return p.charAt(0).toUpperCase() + p.slice(1); },
        placeReminderSet: function (text, when, place) { return "OK, I'll remind you to " + text + " " + placePhrase(when, place) + "."; },
        unknownPlace: function (text, name) {
            return "I've added “" + text + "” to Tasks, but I don't know where " + placeName(name) + " is, so I can't remind you there. " +
                   "Save it in Maps as “" + h.capital(name) + "” and ask me again.";
        },
        noHomeYet: function (place) { return "I don't know where your " + (place === "work" ? "work" : "home") + " is yet. Should I use where you are now?"; },
        setPlaceHere: function (place) { return place === "work" ? "Set Work to Here" : "Set Home to Here"; },
        homeWorkSettings: function () { return "Home & Work Settings"; },
        placeSaved: function (place, where, changed) {
            var label = place === "work" ? "Work" : "Home";
            return (changed ? "OK, I've moved your " + place + " to where you are now" : "OK, this is your " + place + " now") +
                   (where ? ", near " + where : "") + ". It's in Maps as “" + label + "”.";
        },
        placeByAddress: function (place) {
            var label = place === "work" ? "Work" : "Home";
            return "I can set your " + place + " to where you are now. For an address, find it in Maps and save it as “" + label + "”. I've looked it up there.";
        },
        undoPlace: function (place, moved) { return moved ? "put your " + place + " back where it was" : "forget your " + place + " location"; }
    };

    return {
        // Before the reminders' and notes' own ("remind me to ... when I get
        // home", "remember where I parked"), and the driving mode's "I've parked".
        rules: [["placeReminder", placeReminder], ["findParking", findParking], ["parking", parking], ["setPlace", setPlace]],
        say: say,
        MENTIONS: {
            parking: /\b(park\w*|car|spot)\b/,
            findParking: /\b(park\w*|car)\b/,
            placeReminder: /\b(remind\w*|when|once|leave|leaving|get|arrive|home|work)\b/,
            setPlace: /\b(home|work|office|live)\b/
        },
        describe: function (command, args) {
            if (command === "parking") return args.action === "forget" ? "forget where you parked" : "remember where you parked";
            if (command === "findParking") return "find where you parked";
            if (command === "placeReminder") return "remind you to " + String(args.text || "") + " " + placePhrase(args.when === "leave" ? "leave" : "arrive", String(args.place || "here"));
            if (command === "setPlace") return "save where you are as your " + (args.place === "work" ? "work" : "home");
            return "";
        },
        help: { title: "Places", examples: ["Remember where I parked", "Where did I park?", "Remind me to buy milk when I get home", "This is my work"] }
    };
};
