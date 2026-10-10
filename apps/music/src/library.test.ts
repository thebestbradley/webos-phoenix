// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AudioItem } from "@phoenix/luna";
import { albums, artistOf, artists, artistSummary, playOrder, sharedSongs, songs, songsFor, titleOf, UNKNOWN_ARTIST } from "./library";

const song = (file: string, title: string, artist?: string, album?: string, track?: number): AudioItem =>
    ({ uri: "storage:///media/internal/" + file, file_path: "/media/internal/" + file, title, artist, album, track, thumbnail: album ? `/art/${album}.jpg` : undefined });

const LIB = [
    song("a.ogg", "Card Shuffle", "Pixel Sunrise", "Cartridge Dreams", 2),
    song("b.ogg", "Morning Boot", "Pixel Sunrise", "Cartridge Dreams", 1),
    song("c.ogg", "Just Type", "Luna Bus", "Service Calls", 1),
    song("d.ogg", "Harbor Lights", "The Chip Harbor", "Low Tide", 1),
    song("e.ogg", "untitled"),
];

describe("music library", () => {
    it("groups albums in track order with their art", () => {
        const a = albums(LIB);
        expect(a.map((x) => x.name)).toEqual(["Cartridge Dreams", "Low Tide", "Service Calls", "Unknown Album"]);
        expect(a[0].songs.map((s) => s.title)).toEqual(["Morning Boot", "Card Shuffle"]);
        expect(a[0].art).toBe("/art/Cartridge Dreams.jpg");
    });

    it("sorts artists ignoring a leading 'The'", () => {
        const ar = artists(LIB);
        expect(ar.map((x) => x.name)).toEqual(["The Chip Harbor", "Luna Bus", "Pixel Sunrise", UNKNOWN_ARTIST]);
        expect(artistSummary(ar[2])).toBe("1 album, 2 songs");
    });

    it("sorts songs by title", () => {
        expect(songs(LIB).map((s) => s.title)).toEqual(["Card Shuffle", "Harbor Lights", "Just Type", "Morning Boot", "untitled"]);
    });

    it("shuffles with the chosen song first", () => {
        expect(playOrder(4, 2, false)).toEqual([0, 1, 2, 3]);
        const o = playOrder(5, 3, true, () => 0.5);
        expect(o[0]).toBe(3);
        expect([...o].sort()).toEqual([0, 1, 2, 3, 4]);
    });

    it("finds what the Assistant's play command names", () => {
        expect(songsFor(LIB, "pixel sunrise")?.map((s) => s.title)).toEqual(["Morning Boot", "Card Shuffle"]);
        expect(songsFor(LIB, "Service Calls")?.map((s) => s.title)).toEqual(["Just Type"]);
        expect(songsFor(LIB, "chip harbor")?.map((s) => s.title)).toEqual(["Harbor Lights"]);
        expect(songsFor(LIB, "morning")?.map((s) => s.title)).toEqual(["Morning Boot"]);
        expect(songsFor(LIB, "")).toHaveLength(5);
        expect(songsFor(LIB, "nobody")).toBeNull();
    });
});

describe("songs shared to Music", () => {
    it("plays a shared recording under the share's title", () => {
        const got = sharedSongs({ title: "Garage sale", files: [{ path: "/media/internal/voicememos/memo-1.wav", mimeType: "audio/wav" }] }, LIB);
        expect(got).toHaveLength(1);
        expect(got[0].file_path).toBe("/media/internal/voicememos/memo-1.wav");
        expect(titleOf(got[0])).toBe("Garage sale");
        expect(artistOf(got[0])).toBe(UNKNOWN_ARTIST);
        // Indexed without a title tag (the indexer names it by its file):
        // still the share's title.
        const indexed = [{ uri: "storage:///media/internal/voicememos/memo-1.wav", file_path: "/media/internal/voicememos/memo-1.wav", title: "memo-1", duration: 3 }];
        const again = sharedSongs({ title: "Garage sale", files: [{ path: "/media/internal/voicememos/memo-1.wav", mimeType: "audio/wav" }] }, indexed);
        expect(titleOf(again[0])).toBe("Garage sale");
        expect(again[0].duration).toBe(3);
    });

    it("takes a library song's tags, and leaves out what is not audio", () => {
        const got = sharedSongs({ title: "Two things", files: [
            { path: "/media/internal/c.ogg", mimeType: "audio/ogg" },
            { path: "/media/internal/DCIM/x.jpg", mimeType: "image/jpeg" },
            { path: "/media/internal/new.mp3" },
        ] }, LIB);
        expect(got.map((s) => titleOf(s))).toEqual(["Just Type", "new"]);
        expect(got[0].artist).toBe("Luna Bus");
        expect(sharedSongs({ files: [{ path: "/media/internal/notes.txt", mimeType: "text/plain" }] }, LIB)).toEqual([]);
        expect(sharedSongs({}, LIB)).toEqual([]);
    });
});
