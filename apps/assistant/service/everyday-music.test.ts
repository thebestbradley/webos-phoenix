// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Music and podcasts (lib/commands-music.js, lib/lang/en-music.js): shuffle
// and repeat through Music's launch params, favorite songs in Music's own
// kind (the song as Music says it plays), the sleep timer (an activity,
// then pause), and podcasts: the episode chosen from Podcasts' own,
// played by Podcasts.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { device, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(text: string, ctx?: object): { command: string; args: Record<string, any> } | null };
const parse = (t: string) => grammar.parse(t, { lang: "en", now: NOW });
const MUSIC = "org.webosphoenix.music";
const FAV = "org.webosphoenix.music.favorite:1";
const SONG = { title: "Blue in Green", artist: "Miles Davis", album: "Kind of Blue", playing: true, appId: MUSIC,
               uri: "storage:///media/internal/music/blue.mp3", shuffle: false, repeat: "off" };

function podcasts() {
    return device({ seed: (put: (o: object) => string) => {
        put({ _id: "pod-daily", _kind: "org.webosphoenix.podcast:1", title: "The Daily", subscribed: true });
        put({ _id: "pod-fork", _kind: "org.webosphoenix.podcast:1", title: "Hard Fork", subscribed: true });
        put({ _id: "ep-d1", _kind: "org.webosphoenix.podcast.episode:1", podcastId: "pod-daily", title: "Monday's news", published: NOW - 2 * 86400e3, position: 0, played: true });
        put({ _id: "ep-d2", _kind: "org.webosphoenix.podcast.episode:1", podcastId: "pod-daily", title: "Tuesday's news", published: NOW - 86400e3, position: 0, played: false });
        put({ _id: "ep-f1", _kind: "org.webosphoenix.podcast.episode:1", podcastId: "pod-fork", title: "AI and you", published: NOW - 3 * 86400e3, position: 754, played: false });
    } });
}

describe("the words", () => {
    it("shuffle and repeat", () => {
        expect(parse("shuffle my music")).toEqual({ command: "musicMode", args: { mode: "shuffle", state: "on", all: true } });
        expect(parse("turn on shuffle")).toEqual({ command: "musicMode", args: { mode: "shuffle", state: "on" } });
        expect(parse("stop shuffling")?.args).toEqual({ mode: "shuffle", state: "off" });
        expect(parse("repeat this song")?.args).toEqual({ mode: "repeat", state: "one" });
        expect(parse("repeat all")?.args).toEqual({ mode: "repeat", state: "all" });
        expect(parse("stop repeating")?.args).toEqual({ mode: "repeat", state: "off" });
        expect(parse("is shuffle on")?.args).toEqual({ mode: "shuffle", state: "status" });
        expect(parse("repeat that")?.command).not.toBe("musicMode");
    });
    it("favorites, the sleep timer and podcasts", () => {
        expect(parse("like this song")).toEqual({ command: "favorites", args: { action: "add" } });
        expect(parse("add this song to my favorites")?.args).toEqual({ action: "add" });
        expect(parse("remove this from my favorites")?.args).toEqual({ action: "remove" });
        expect(parse("shuffle my favorites")?.args).toEqual({ action: "play", shuffle: true });
        expect(parse("stop the music in 30 minutes")).toEqual({ command: "sleepTimer", args: { action: "set", minutes: 30 } });
        expect(parse("set a sleep timer for an hour")?.args).toEqual({ action: "set", minutes: 60 });
        expect(parse("cancel the sleep timer")?.args).toEqual({ action: "cancel" });
        expect(parse("set a timer for 20 minutes")?.command).toBe("timer");
        expect(parse("play the latest episode of The Daily")).toEqual({ command: "podcast", args: { name: "The Daily", action: "latest" } });
        expect(parse("resume my podcast")?.args).toEqual({ name: "", action: "resume" });
        expect(parse("play the Hard Fork podcast")?.args).toEqual({ name: "Hard Fork", action: "play" });
        expect(parse("play some jazz")?.command).toBe("play");
    });
});

describe("shuffle and repeat", () => {
    it("shuffles everything, or what plays, and repeats the song", async () => {
        const d = device();
        expect((await d.ask("shuffle my music")).text).toBe("Shuffling all your music.");
        expect(d.state.launched.at(-1)).toMatchObject({ id: MUSIC, params: { play: "", shuffle: true }, behind: true });
        d.state.nowPlaying = { ...SONG };
        expect((await d.ask("turn on shuffle")).text).toBe("Shuffle is on.");
        expect(d.state.launched.at(-1)).toMatchObject({ id: MUSIC, params: { shuffle: true } });
        expect((await d.ask("repeat this song")).text).toBe("Repeating “Blue in Green”.");
        expect(d.state.launched.at(-1)).toMatchObject({ id: MUSIC, params: { repeat: "one" } });
        d.state.nowPlaying = { ...SONG, shuffle: true };
        expect((await d.ask("is shuffle on")).text).toBe("Yes, shuffle is on.");
    });
    it("is Music's: not for a podcast, and nothing to repeat when nothing plays", async () => {
        const d = device();
        expect((await d.ask("repeat this song")).text).toBe("Nothing's playing in Music right now.");
        d.state.nowPlaying = { title: "AI and you", playing: true, appId: "org.webosphoenix.podcasts" };
        expect((await d.ask("turn on shuffle")).text).toBe("Shuffle and repeat are Music's. Your podcast plays on.");
        expect(d.state.launched).toEqual([]);
    });
});

describe("favorites", () => {
    it("adds the song that plays to Music's favorites, once, and takes it out", async () => {
        const d = device();
        d.state.nowPlaying = { ...SONG };
        const m = await d.ask("like this song");
        expect(m).toMatchObject({ command: "favorites", status: "done", text: "Added “Blue in Green” by Miles Davis to your favorites in Music." });
        expect(d.of(FAV)).toMatchObject([{ uri: SONG.uri, title: "Blue in Green", artist: "Miles Davis", album: "Kind of Blue" }]);
        expect((await d.ask("add this song to my favorites")).text).toBe("“Blue in Green” is already one of your favorites.");
        expect(d.of(FAV)).toHaveLength(1);
        expect((await d.ask("play my favorites")).text).toBe("Playing your favorites (1 song).");
        expect(d.state.launched.at(-1)).toMatchObject({ id: MUSIC, params: { favorites: true } });
        expect((await d.ask("remove this from my favorites")).text).toBe("Removed “Blue in Green” from your favorites.");
        expect(d.of(FAV)).toEqual([]);
    });
    it("says when nothing plays in Music, or there are none", async () => {
        const d = device();
        expect((await d.ask("like this song")).text).toBe("Nothing's playing in Music right now.");
        expect((await d.ask("play my favorites")).text).toBe("You have no favorite songs yet. Say “like this song” while one plays.");
    });
});

describe("the sleep timer", () => {
    it("pauses whatever plays at its time, through an activity", async () => {
        const d = device();
        expect((await d.ask("set a sleep timer")).text).toBe("For how long? Say it with the time, like “set a sleep timer for 30 minutes”.");
        const m = await d.ask("stop the music in 30 minutes");
        expect(m.text).toMatch(/^OK, I'll stop the music in 30 minutes, at \d+:\d\d [AP]M\.$/);
        const a = d.state.activities.get("assistant.sleepTimer");
        expect(a.callback).toMatchObject({ method: "luna://org.webosphoenix.assistant/sleepWake", params: { at: NOW + 30 * 60000 } });
        d.setNow(NOW + 18 * 60000);
        expect((await d.ask("how long is left on the sleep timer")).text).toMatch(/^The music stops in 12 minutes/);
        expect(await d.svc.sleepWake({ at: NOW + 30 * 60000 })).toMatchObject({ paused: true });
        expect(d.called("mediaKey").at(-1)?.params).toEqual({ key: "pause" });
        // Once: a second call (or an old one) does nothing.
        expect(await d.svc.sleepWake({ at: NOW + 30 * 60000 })).toMatchObject({ paused: false });
    });
    it("is cancelled", async () => {
        const d = device();
        await d.ask("set a sleep timer for 20 minutes");
        expect((await d.ask("cancel the sleep timer")).text).toBe("OK, the sleep timer is off. The music plays on.");
        expect(d.state.activities.has("assistant.sleepTimer")).toBe(false);
        expect((await d.ask("cancel the sleep timer")).text).toBe("There's no sleep timer set.");
    });
});

describe("podcasts", () => {
    it("plays the latest episode of a podcast followed, by its name", async () => {
        const d = podcasts();
        const m = await d.ask("play the latest episode of The Daily");
        expect(m.text).toBe("Playing the latest episode of The Daily: “Tuesday's news”.");
        expect(d.state.launched.at(-1)).toMatchObject({ id: "org.webosphoenix.podcasts", params: { playEpisode: "ep-d2" }, behind: true });
    });
    it("picks up the episode left part-way", async () => {
        const d = podcasts();
        expect((await d.ask("resume my podcast")).text).toBe("Picking up “AI and you” from Hard Fork, 13 minutes in.");
        expect(d.state.launched.at(-1)).toMatchObject({ params: { playEpisode: "ep-f1" } });
        expect((await d.ask("play the Hard Fork podcast")).text).toBe("Picking up “AI and you” from Hard Fork, 13 minutes in.");
    });
    it("says which it does not follow, and when there are none", async () => {
        expect((await podcasts().ask("play the latest episode of Radiolab")).text).toBe("You don't follow a podcast called “Radiolab”. Yours: The Daily and Hard Fork.");
        expect((await device().ask("resume my podcast")).text).toBe("You don't follow any podcasts yet. I've opened Podcasts to find some.");
    });
});
