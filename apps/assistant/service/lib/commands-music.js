// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Music and podcasts beyond "play", "pause" and "next" (lib/commands.js
// play, media; docs/AI-AND-MCP.md "Everyday features"):
//
//   musicMode    "shuffle my music" (everything, shuffled), "turn on
//                shuffle", "repeat this song", "repeat all", "stop
//                repeating", "is shuffle on": Music with {shuffle} or
//                {repeat} (its launch params, apps/music launchParams.ts),
//                as its own buttons set them
//   favorites    "like this song", "add this to my favorites", "unlike
//                this song", "play my favorites": Music's favorites
//                (org.webosphoenix.music.favorite:1, apps/music
//                favorites.ts), the song that plays as Music says it
//                (getNowPlaying uri); Music watches the list
//   sleepTimer   "stop the music in 30 minutes", "set a sleep timer for 20
//                minutes", "cancel the sleep timer", "how long is left on
//                the sleep timer": an activity at that time calls
//                sleepWake, which presses pause (org.webosphoenix.system
//                mediaKey), whatever plays (Music, Podcasts, Videos)
//   podcast      "play the latest episode of The Daily", "play the Daily
//                podcast", "resume my podcast": the episode chosen here
//                from Podcasts' own (org.webosphoenix.podcast:1 and
//                .episode:1: the one left part-way, else the newest not
//                played, else the newest), played by Podcasts
//                ({playEpisode: id}) from where it was left
//
// The service's methods: sleepWake {at, $activity} (the activity manager).

"use strict";

var MUSIC = "org.webosphoenix.music";
var PODCASTS = "org.webosphoenix.podcasts";
var FAVORITE_KIND = "org.webosphoenix.music.favorite:1";
var PODCAST_KIND = "org.webosphoenix.podcast:1";
var EPISODE_KIND = "org.webosphoenix.podcast.episode:1";
var DB = "luna://com.palm.db/";
var AM = "luna://com.palm.activitymanager/";
var SLEEP_KEY = "assistant:sleepTimer";
var SLEEP_ACTIVITY = "assistant.sleepTimer";
var SLEEP_WAKE = "luna://org.webosphoenix.assistant/sleepWake";
var STARTED = 30;   // seconds in: an episode begun, to pick up again

var COMMANDS = [
    { id: "musicMode", title: "Shuffle and repeat", risk: "change", whenLocked: true,
      description: "Shuffle or repeat what Music plays (or play all the music shuffled), turn them off, or tell whether they are on.",
      parameters: { type: "object", properties: {
          mode: { type: "string", enum: ["shuffle", "repeat"] },
          state: { type: "string", enum: ["on", "off", "one", "all", "status"], description: "repeat: one (this song) or all" },
          all: { type: "boolean", description: "Shuffle all the music, not just what plays" } }, required: ["mode", "state"] },
      examples: ["mix up the order of the songs", "play this one again and again", "loop the album", "go back to playing in order"] },
    { id: "favorites", title: "Favorite songs", risk: "change", whenLocked: true,
      description: "Add the song playing in Music to the user's favorites, take it out, or play the favorites.",
      parameters: { type: "object", properties: {
          action: { type: "string", enum: ["add", "remove", "play"] },
          shuffle: { type: "boolean", description: "Play them shuffled" } }, required: ["action"] },
      examples: ["this one's a keeper", "give this track a heart", "put on the songs I liked"] },
    { id: "sleepTimer", title: "Sleep timer", risk: "change", whenLocked: true,
      description: "Stop the music (or podcast) after some minutes, cancel that, or tell how long is left.",
      parameters: { type: "object", properties: {
          action: { type: "string", enum: ["set", "cancel", "status"] },
          minutes: { type: "number", description: "How long until it stops" } }, required: ["action"] },
      examples: ["turn the music off when I fall asleep in half an hour", "fade out the audio after 45 minutes", "don't stop the music after all"] },
    { id: "podcast", title: "Podcasts", risk: "open", whenLocked: true,
      description: "Play a podcast the user follows in Podcasts: its latest episode, or carry on with the one left part-way.",
      parameters: { type: "object", properties: {
          name: { type: "string", description: "The podcast's name; empty for whichever was left part-way" },
          action: { type: "string", enum: ["play", "latest", "resume"] } }, required: ["action"] },
      examples: ["catch me up on the news podcast", "put on the newest Hard Fork", "carry on with my episode"] }
];

function fold(s) { return String(s || "").toLowerCase().replace(/^(?:the|my) /, "").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim(); }

module.exports = function (h) {
    function nowPlaying(env) {
        return h.lunaCall(env, "luna://org.webosphoenix.system/getNowPlaying", {}).then(function (r) { return r.nowPlaying || null; }, function () { return null; });
    }
    function music(env, params) { return h.launch(env, MUSIC, params); }
    var openMusic = { appId: MUSIC, params: {}, title: "Music" };

    // ---- Shuffle and repeat ----
    function mode(args, env) {
        var say = env.lang.say;
        return nowPlaying(env).then(function (np) {
            var inMusic = !!(np && np.appId === MUSIC);
            if (args.state === "status") {
                if (!inMusic) return { text: say.musicNotPlaying() };
                return { text: say.modeStatus(args.mode, args.mode === "shuffle" ? !!np.shuffle : np.repeat || "off"), open: openMusic };
            }
            // A podcast plays: shuffle and repeat are Music's.
            if (np && np.playing && np.appId === PODCASTS) return { text: say.notForPodcasts() };
            if (args.mode === "shuffle") {
                var on = args.state !== "off";
                // Nothing of Music's to shuffle, or "shuffle my music": everything, shuffled.
                if (on && (args.all || !inMusic))
                    return music(env, { play: "", shuffle: true }).then(function () { return { text: say.shufflingAll(), open: openMusic }; });
                return music(env, { shuffle: on }).then(function () { return { text: say.shuffleSet(on), open: openMusic }; });
            }
            var r = args.state === "one" || args.state === "all" ? args.state : args.state === "on" ? "all" : "off";
            if (!inMusic && r !== "off") return { text: say.musicNotPlaying() };
            return music(env, { repeat: r }).then(function () { return { text: say.repeatSet(r, np && np.title), open: openMusic }; });
        });
    }

    // ---- Favorites ----
    function liked(env) { return h.dbFind(env, FAVORITE_KIND).catch(function () { return []; }); }
    function fav(args, env) {
        var say = env.lang.say;
        if (args.action === "play") {
            return liked(env).then(function (list) {
                if (!list.length) return { text: say.noFavorites(), open: openMusic };
                return music(env, args.shuffle ? { favorites: true, shuffle: true } : { favorites: true })
                    .then(function () { return { text: say.playingFavorites(list.length, !!args.shuffle), open: openMusic }; });
            });
        }
        return nowPlaying(env).then(function (np) {
            if (!np || np.appId !== MUSIC || !np.uri) return { text: say.musicNotPlaying() };
            return liked(env).then(function (list) {
                var had = list.filter(function (f) { return f.uri === np.uri; });
                if (args.action === "remove") {
                    if (!had.length) return { text: say.notAFavorite(np.title) };
                    return h.lunaCall(env, DB + "del", { ids: had.map(function (f) { return f._id; }) }).then(function () {
                        return { text: say.favoriteRemoved(np.title), open: openMusic };
                    });
                }
                if (had.length) return { text: say.alreadyFavorite(np.title), open: openMusic };
                var f = { _kind: FAVORITE_KIND, uri: np.uri, path: String(np.uri).replace(/^[a-z]+:\/\//, ""), title: np.title, artist: np.artist || "",
                          album: np.album || "", added: env.now() };
                return h.lunaCall(env, DB + "put", { objects: [f] }).then(function (r) {
                    var id = r.results && r.results[0] && r.results[0].id;
                    // Said only when it is there (as every write: lib/commands.js run).
                    return liked(env).then(function (now) {
                        if (!now.some(function (x) { return x.uri === np.uri; })) return { text: say.favoriteNotSaved(), failed: true };
                        return { text: say.favoriteAdded(np.title, np.artist), open: openMusic,
                                 undo: id ? { kind: "db", ids: [id], what: say.undoFavorite(np.title) } : undefined };
                    });
                });
            });
        });
    }

    // ---- Sleep timer ----
    function sleep(args, env) {
        var say = env.lang.say, cur = env.storage.get(SLEEP_KEY), now = env.now();
        var live = cur && cur.at > now ? cur : null;
        if (args.action === "status") return Promise.resolve({ text: live ? say.sleepLeft(live.at - now, live.at) : say.noSleepTimer() });
        if (args.action === "cancel") {
            env.storage.remove(SLEEP_KEY);
            return h.lunaCall(env, AM + "cancel", { activityName: SLEEP_ACTIVITY }).catch(function () { return null; })
                .then(function () { return { text: live ? say.sleepCancelled() : say.noSleepTimer() }; });
        }
        var minutes = Math.round(Number(args.minutes) || 0);
        if (minutes < 1 || minutes > 12 * 60) return Promise.resolve({ text: say.sleepHowLong() });
        var at = now + minutes * 60000;
        return h.lunaCall(env, AM + "create", { start: true, replace: true, activity: {
            name: SLEEP_ACTIVITY, description: "Assistant sleep timer", type: { foreground: true },
            schedule: { start: h.activityDate(at) }, callback: { method: SLEEP_WAKE, params: { at: at } } } }).then(function () {
            env.storage.set(SLEEP_KEY, { at: at, minutes: minutes });
            return { text: say.sleepSet(minutes, at), data: { at: at } };
        });
    }

    // ---- Podcasts ----
    function podcast(args, env) {
        var say = env.lang.say;
        var openPodcasts = { appId: PODCASTS, params: {}, title: "Podcasts" };
        return Promise.all([h.dbFind(env, PODCAST_KIND).catch(function () { return []; }), h.dbFind(env, EPISODE_KIND).catch(function () { return []; })]).then(function (got) {
            var shows = got[0].filter(function (p) { return p.subscribed !== false; }), eps = got[1];
            if (!shows.length) return { text: say.noPodcasts(), open: openPodcasts };
            var name = fold(args.name), show = null;
            if (name) {
                show = shows.filter(function (p) { return fold(p.title) === name; })[0] ||
                       shows.filter(function (p) { var t = fold(p.title); return t.indexOf(name) >= 0 || (name.length > 3 && name.indexOf(t) >= 0); })[0] || null;
                if (!show) return { text: say.noSuchPodcast(args.name, shows.map(function (p) { return p.title; })), open: openPodcasts };
            }
            var mine = eps.filter(function (e) { return (!show || e.podcastId === show._id) && shows.some(function (p) { return p._id === e.podcastId; }); })
                .sort(function (a, b) { return (b.published || 0) - (a.published || 0); });
            if (!mine.length) return { text: say.noEpisodes(show ? show.title : ""), open: openPodcasts };
            var begun = mine.filter(function (e) { return !e.played && (e.position || 0) >= STARTED; });
            var fresh = mine.filter(function (e) { return !e.played; });
            var e = args.action === "latest" ? mine[0] : begun[0] || (args.action === "resume" && !show ? null : fresh[0] || mine[0]);
            if (!e) return { text: say.nothingToResume(), open: openPodcasts };
            var p = shows.filter(function (x) { return x._id === e.podcastId; })[0];
            var picking = !e.played && (e.position || 0) >= STARTED;
            return h.launch(env, PODCASTS, { playEpisode: e._id }).then(function () {
                return { text: say.playingEpisode(p.title, e.title, picking ? e.position : 0, args.action === "latest" && e === mine[0]), open: openPodcasts,
                         data: { episodeId: e._id } };
            });
        });
    }

    function service(s) {
        function ok(o) { return Object.assign({ returnValue: true }, o || {}); }
        return {
            // The activity manager, at the sleep timer's time: pause whatever plays.
            sleepWake: function (p) {
                var e = s.env(), cur = e.storage.get(SLEEP_KEY);
                if (!cur || Math.abs(Number(p.at) - cur.at) > 1000) return Promise.resolve(ok({ paused: false }));
                e.storage.remove(SLEEP_KEY);
                return h.lunaCall(e, "luna://org.webosphoenix.system/mediaKey", { key: "pause" }).then(function () { return ok({ paused: true }); },
                    function () { return ok({ paused: false }); });
            }
        };
    }

    return {
        COMMANDS: COMMANDS,
        METHODS: ["sleepWake"],
        service: service,
        prepare: function (cmd, args, env) {
            // "Set a sleep timer" with no time: how long, before anything is set.
            if (cmd.id === "sleepTimer" && args.action === "set" && !(Number(args.minutes) >= 1))
                return Promise.resolve({ args: args, reply: env.lang.say.sleepHowLong() });
            return null;
        },
        run: function (cmd, args, env) {
            if (cmd.id === "musicMode") return mode(args, env);
            if (cmd.id === "favorites") return fav(args, env);
            if (cmd.id === "sleepTimer") return sleep(args, env);
            if (cmd.id === "podcast") return podcast(args, env);
            return null;
        }
    };
};
