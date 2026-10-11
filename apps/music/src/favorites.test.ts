// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AudioItem } from "@phoenix/luna";
import { FAVORITE_KIND, favoriteOf, favoriteSongs, toFavorite, type Favorite } from "./favorites";

const song = (n: string, extra: Partial<AudioItem> = {}): AudioItem =>
    ({ uri: `storage:///media/internal/music/${n}.mp3`, file_path: `/media/internal/music/${n}.mp3`, type: "audio", title: n, artist: "Ada", album: "Lovelace", ...extra }) as AudioItem;

describe("Music's favorites", () => {
    it("keeps a song by its uri, with its words to tell it by", () => {
        expect(toFavorite(song("One"), 5)).toEqual({ _kind: FAVORITE_KIND, uri: "storage:///media/internal/music/One.mp3", path: "/media/internal/music/One.mp3",
                                                      title: "One", artist: "Ada", album: "Lovelace", added: 5 });
    });
    it("lists the library's favorites, the newest first, found by uri or else by path", () => {
        const lib = [song("One"), song("Two"), song("Three", { uri: "storage:///new/Three.mp3" })];
        const favs: Favorite[] = [
            { ...toFavorite(song("One"), 1), _id: "a" },
            { ...toFavorite(song("Three"), 3), _id: "b" },        // its uri changed since: found by path
            { ...toFavorite(song("Gone"), 2), _id: "c" },         // not in the library any more
        ];
        expect(favoriteSongs(lib, favs).map((s) => s.title)).toEqual(["Three", "One"]);
        expect(favoriteOf(favs, lib[0])?._id).toBe("a");
        expect(favoriteOf(favs, lib[1])).toBeUndefined();
    });
});
