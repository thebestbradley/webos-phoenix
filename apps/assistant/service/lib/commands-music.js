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
//   podcast     "play the latest episode of The Daily", "play the Daily
//                podcast", "resume my podcast": the episode chosen here
//                from Podcasts' own (org.webosphoenix.podcast:1 and
//                .episode:1: the one left part-way, else the newest not
//                played, else the newest), played by Podcasts
//                ({playEpisode: id}) from where it was left
//
// The sleep timer is the timer command's ({sleep: true}: lib/commands.js).

"use strict";

var MUSIC = "org.webosphoenix.music";
var PODCASTS = "org.webosphoenix.podcasts";
var FAVORITE_KIND = "org.webosphoenix.music.favorite:1";
var PODCAST_KIND = "org.webosphoenix.podcast:1";
var EPISODE_KIND = "org.webosphoenix.podcast.episode:1";
var DB = "luna://com.palm.db/";
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

    return {
        COMMANDS: COMMANDS,
        // "Set a sleep timer" with no time (the timer command's): how long, before anything is set.
        prepare: function (cmd, args, env) {
            if (cmd.id === "timer" && args.sleep && !(Number(args.seconds) > 0))
                return Promise.resolve({ args: args, reply: env.lang.say.sleepHowLong(), awaiting: { command: "timer", args: args, field: "seconds" } });
            return null;
        },
        run: function (cmd, args, env) {
            if (cmd.id === "musicMode") return mode(args, env);
            if (cmd.id === "favorites") return fav(args, env);
            if (cmd.id === "podcast") return podcast(args, env);
            return null;
        }
    };
};
