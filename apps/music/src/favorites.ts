// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Favorite songs, in db8 (org.webosphoenix.music.favorite:1, see
// public/configuration/db/kinds), so they back up with the rest of the
// user's data and the Assistant's "like this song" adds to the same list
// (apps/assistant/service lib/commands-music.js): the star on Now Playing,
// the Favorites tab, "play my favorites" ({favorites: true}).
//
//   {uri, path, title, artist, album, added (ms)}: a song by its media
//   indexer uri; the path, title and artist so it can be told and found
//   again if the indexer's uri changes.

import { db, type AudioItem, type DbObject, type Subscription } from "@phoenix/luna";
import { artistOf, titleOf } from "./library";

export const FAVORITE_KIND = "org.webosphoenix.music.favorite:1";

export interface Favorite extends DbObject {
    uri: string;
    path: string;
    title: string;
    artist: string;
    album: string;
    added: number;
}

export function toFavorite(song: AudioItem, now = Date.now()): Favorite {
    return { _kind: FAVORITE_KIND, uri: song.uri, path: song.file_path ?? "", title: titleOf(song), artist: artistOf(song), album: song.album ?? "", added: now };
}

/** The favorite for a song: by its uri, else its path. */
export function favoriteOf(list: readonly Favorite[], song: Pick<AudioItem, "uri" | "file_path">): Favorite | undefined {
    return list.find((f) => f.uri === song.uri) ?? (song.file_path ? list.find((f) => f.path === song.file_path) : undefined);
}

/** The library's songs that are favorites, newest favorite first. */
export function favoriteSongs(items: readonly AudioItem[], list: readonly Favorite[]): AudioItem[] {
    return [...list].sort((a, b) => b.added - a.added)
        .map((f) => items.find((s) => s.uri === f.uri) ?? items.find((s) => !!f.path && s.file_path === f.path))
        .filter((s): s is AudioItem => !!s);
}

export const favorites = {
    watch(cb: (list: Favorite[]) => void): Subscription {
        return db.watch<Favorite>({ from: FAVORITE_KIND, orderBy: "added", desc: true }, cb, () => cb([]));
    },
    async add(song: AudioItem): Promise<void> {
        await db.put([toFavorite(song)]);
    },
    async remove(f: Favorite): Promise<void> {
        if (f._id) await db.del([f._id]);
    },
};
