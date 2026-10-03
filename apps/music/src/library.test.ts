// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AudioItem } from "@phoenix/luna";
import { albums, artists, artistSummary, playOrder, songs, UNKNOWN_ARTIST } from "./library";

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
});
