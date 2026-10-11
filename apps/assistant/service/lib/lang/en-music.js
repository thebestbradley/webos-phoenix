// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// English for lib/commands-music.js: shuffle and repeat, favorite songs,
// the sleep timer and podcasts. h: lib/lang/en.js's helpers.

"use strict";

module.exports = function (h) {
    var THE_MUSIC = "(?:it|this|the (?:songs?|music|playlist|album|queue|tracks?)|my (?:songs|music|playlist|library))";
    function musicMode(t) {
        var m;
        // "turn shuffle off", "switch repeat on"
        if ((m = /^(?:turn|switch|put|set) (shuffle|repeat)(?: mode)? (on|off)$/.exec(t)))
            return { mode: m[1], state: m[1] === "repeat" && m[2] === "on" ? "all" : m[2] };
        if (/^(?:shuffle|play|put on|start)(?: all(?: of)?)? (?:my|the) (?:music|songs|library|whole library)(?: on shuffle| shuffled| in shuffle)?$|^shuffle (?:all|everything|all my music|my whole library)$|^play (?:everything|all|some music|music) (?:on shuffle|shuffled|in shuffle mode)$/.test(t) &&
            /shuffl/.test(t))
            return { mode: "shuffle", state: "on", all: true };
        if (new RegExp("^(?:turn on|switch on|enable|start|put on) shuffle(?: mode)?$|^shuffle(?: (?:on|mode on|mode))?$|^shuffle " + THE_MUSIC + "$|^put " + THE_MUSIC + " on shuffle$|^(?:mix|mix up|jumble) (?:the )?(?:songs|order|playlist)$").test(t))
            return { mode: "shuffle", state: "on" };
        if (/^(?:turn off|switch off|disable|stop|no more|cancel) (?:the )?shuffl(?:e|ing)(?: mode)?$|^shuffle(?: mode)? off$|^(?:don't|do not) shuffle$|^(?:play|go back to playing|go) in order$|^unshuffle(?: it)?$/.test(t))
            return { mode: "shuffle", state: "off" };
        if (/^(?:repeat|loop)(?: this| the)? (?:song|track|one)$|^(?:put|play) (?:this|it|this song|the song|this track) on (?:repeat|a loop)$|^(?:repeat|loop) (?:it|this)$|^repeat one$|^(?:keep )?playing this (?:song|one) (?:on repeat|over and over|again and again)$/.test(t))
            return { mode: "repeat", state: "one" };
        if (/^(?:repeat|loop) (?:all|everything|the (?:album|playlist|queue))$|^(?:turn on|switch on|enable) (?:repeat|looping)$|^repeat(?: mode)? on$/.test(t))
            return { mode: "repeat", state: "all" };
        if (/^(?:turn off|switch off|stop|disable|no more|cancel) (?:the )?(?:repeat|repeating|looping|loop)(?: mode)?$|^repeat(?: mode)? off$|^(?:don't|do not|stop) repeat(?:ing)?(?: (?:this|it|the song))?$/.test(t))
            return { mode: "repeat", state: "off" };
        if ((m = /^is (shuffle|repeat)(?: mode)? (?:on|turned on|enabled)$|^am i (?:on )?(shuffl)ing$/.exec(t)))
            return { mode: m[1] === "repeat" ? "repeat" : "shuffle", state: "status" };
        return null;
    }
    var SONG = "(?:this|this song|this track|this one|the song|the track|it|what's playing|the current song|this tune)";
    var FAVES = "(?:my )?(?:favorites|favourites|favorite songs|favourite songs|liked songs|loved songs|likes)";
    function favorites(t) {
        var m;
        if (new RegExp("^(?:like|love|heart|star|favorite|favourite) " + SONG + "$|^i (?:like|love|really like) this (?:song|track|one)$|^(?:add|save|put) " + SONG + " (?:to|in|into|on) " + FAVES + "$|^(?:mark|make) " + SONG + " (?:as )?(?:a )?(?:favorite|favourite)$").test(t))
            return { action: "add" };
        if (new RegExp("^(?:unlike|unfavorite|unfavourite|unstar|unheart) " + SONG + "$|^(?:remove|take|delete) " + SONG + " (?:from|out of|off) " + FAVES + "$|^i don't like this (?:song|track|one)(?: any ?more)?$").test(t))
            return { action: "remove" };
        if ((m = new RegExp("^(play|shuffle|put on|start|listen to) " + FAVES + "(?: on shuffle| shuffled)?$").exec(t)))
            return { action: "play", shuffle: m[1] === "shuffle" || /shuffle/.test(t) };
        return null;
    }
    // "in 30 minutes", "after an hour", "for 20 minutes"
    function minutesOf(s) {
        var secs = h.duration(String(s || "").replace(/^(?:in|after|for|of) /, ""));
        return secs ? Math.max(1, Math.round(secs / 60)) : 0;
    }
    function sleepTimer(t) {
        var m;
        if ((m = /^(?:set (?:a |the |my )?|start (?:a |the )?)?sleep timer(?: (?:for|to|of|in))? (.+)$/.exec(t)) && minutesOf(m[1])) return { action: "set", minutes: minutesOf(m[1]) };
        if ((m = /^(?:stop|pause|turn off|switch off|fade out|end|shut off) (?:the |my |this )?(?:music|song|songs|podcast|playback|audio|it|player)(?: playing)? (?:in|after) (.+)$/.exec(t)) && minutesOf(m[1]))
            return { action: "set", minutes: minutesOf(m[1]) };
        if (/^(?:set (?:a |the |my )?|start (?:a |the )?)?sleep timer$/.test(t)) return { action: "set", minutes: 0 };
        if (/^(?:cancel|stop|turn off|switch off|remove|clear|delete|end) (?:the |my )?sleep timer$|^(?:don't|do not) stop the music$/.test(t)) return { action: "cancel" };
        if (/^how (?:long|much time)(?: is)? left on (?:the |my )?sleep timer$|^(?:when|what time) (?:does|will) the music stop$|^is (?:there )?(?:a |the )?sleep timer (?:set|on)$/.test(t)) return { action: "status" };
        return null;
    }
    function podcast(t, ctx) {
        var m;
        if ((m = /^(?:play|put on|start|listen to)(?: me)?(?: the)? (?:latest|newest|last|new|most recent) (?:episode )?(?:of |from )(?:the podcast )?(.+?)(?: podcast)?$/.exec(t)))
            return { name: h.cased(m[1], ctx), action: "latest" };
        if (/^(?:resume|continue|carry on with|pick up)(?: playing| listening to)? (?:my |the )?(?:podcasts?|episode|podcast episode)(?: where i left off)?$/.test(t))
            return { name: "", action: "resume" };
        if (/^(?:play|start|put on|listen to)(?: playing)? (?:my |a )?(?:podcasts?|podcast episode)$/.test(t))
            return { name: "", action: "play" };
        if ((m = /^(?:play|put on|start|listen to|resume|continue)(?: the)? (.+?) podcast$/.exec(t)) && !/^(?:my|a|some|the|latest|new)$/.test(m[1]))
            return { name: h.cased(m[1], ctx), action: /^(?:resume|continue)/.test(t) ? "resume" : "play" };
        return null;
    }

    function q(s) { return "“" + s + "”"; }
    function minutesText(n) { return n % 60 === 0 && n >= 60 ? h.plural(n / 60, "hour") : n > 60 ? h.plural(Math.floor(n / 60), "hour") + " and " + h.plural(n % 60, "minute") : h.plural(n, "minute"); }
    var say = {
        musicNotPlaying: function () { return "Nothing's playing in Music right now."; },
        notForPodcasts: function () { return "Shuffle and repeat are Music's. Your podcast plays on."; },
        modeStatus: function (mode, v) {
            if (mode === "shuffle") return v ? "Yes, shuffle is on." : "No, shuffle is off.";
            return v === "one" ? "Yes, it's repeating this song." : v === "all" ? "Yes, repeat all is on." : "No, repeat is off.";
        },
        shufflingAll: function () { return "Shuffling all your music."; },
        shuffleSet: function (on) { return on ? "Shuffle is on." : "Shuffle is off. Playing in order."; },
        repeatSet: function (r, title) { return r === "one" ? "Repeating " + (title ? q(title) : "this song") + "." : r === "all" ? "Repeating all." : "Repeat is off."; },
        noFavorites: function () { return "You have no favorite songs yet. Say “like this song” while one plays."; },
        playingFavorites: function (n, shuffled) { return "Playing your favorites" + (shuffled ? ", shuffled" : "") + " (" + h.plural(n, "song") + ")."; },
        notAFavorite: function (title) { return q(title) + " isn't one of your favorites."; },
        favoriteRemoved: function (title) { return "Removed " + q(title) + " from your favorites."; },
        alreadyFavorite: function (title) { return q(title) + " is already one of your favorites."; },
        favoriteAdded: function (title, artist) { return "Added " + q(title) + (artist ? " by " + artist : "") + " to your favorites in Music."; },
        favoriteNotSaved: function () { return "I couldn't add it to your favorites: it isn't there when I check."; },
        undoFavorite: function (title) { return "take " + q(title) + " out of your favorites"; },
        sleepHowLong: function () { return "For how long? Say it with the time, like “set a sleep timer for 30 minutes”."; },
        sleepSet: function (minutes, at) { return "OK, I'll stop the music in " + minutesText(minutes) + ", at " + h.timeText(at) + "."; },
        sleepLeft: function (ms, at) { return "The music stops in " + minutesText(Math.max(1, Math.round(ms / 60000))) + ", at " + h.timeText(at) + "."; },
        noSleepTimer: function () { return "There's no sleep timer set."; },
        sleepCancelled: function () { return "OK, the sleep timer is off. The music plays on."; },
        noPodcasts: function () { return "You don't follow any podcasts yet. I've opened Podcasts to find some."; },
        noSuchPodcast: function (name, titles) {
            return "You don't follow a podcast called " + q(name) + "." + (titles.length ? " Yours: " + h.list(titles.slice(0, 5)) + "." : "");
        },
        noEpisodes: function (title) { return title ? q(title) + " has no episodes yet. Podcasts may still be fetching them." : "Your podcasts have no episodes yet."; },
        nothingToResume: function () { return "You haven't started an episode. Say the podcast, like “play the latest episode of The Daily”."; },
        playingEpisode: function (show, episode, position, latest) {
            if (position) return "Picking up " + q(episode) + " from " + show + ", " + minutesText(Math.max(1, Math.round(position / 60))) + " in.";
            return (latest ? "Playing the latest episode of " : "Playing ") + show + ": " + q(episode) + ".";
        }
    };

    return {
        // Before "play ..." and the timers ("shuffle my music", "set a sleep timer for 20 minutes").
        rules: [["sleepTimer", sleepTimer], ["musicMode", musicMode], ["favorites", favorites], ["podcast", podcast]],
        say: say,
        MENTIONS: {
            musicMode: /\b(shuffl\w*|repeat\w*|loop\w*|order|again)\b/,
            favorites: /\b(like|love|favou?rites?|heart|star|liked|keeper)\b/,
            sleepTimer: /\b(sleep|stop|timer|fade|off)\b/
        },
        describe: function (command, args) {
            if (command === "musicMode") return args.mode === "shuffle" ? (args.state === "off" ? "turn shuffle off" : "shuffle the music") : args.state === "off" ? "turn repeat off" : "repeat " + (args.state === "one" ? "this song" : "all");
            if (command === "favorites") return args.action === "play" ? "play your favorite songs" : args.action === "remove" ? "take this song out of your favorites" : "add this song to your favorites";
            if (command === "sleepTimer") return args.action === "cancel" ? "turn off the sleep timer" : args.action === "status" ? "tell how long is left on the sleep timer" : "stop the music in " + minutesText(Math.round(Number(args.minutes) || 0));
            if (command === "podcast") return args.name ? "play " + args.name : "play your podcast";
            return "";
        },
        help: { title: "Music & Podcasts", examples: ["Shuffle my music", "Repeat this song", "Like this song", "Stop the music in 30 minutes", "Play the latest episode of The Daily"] }
    };
};
