// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The library views: artists, albums and songs from the media indexer's
// audio list (com.webos.service.mediaindexer getAudioList).

import type { AudioItem } from "@phoenix/luna";

export const UNKNOWN_ARTIST = "Unknown Artist";
export const UNKNOWN_ALBUM = "Unknown Album";

export interface ArtistEntry {
    name: string;
    albums: AlbumEntry[];
    songs: AudioItem[];
}

export interface AlbumEntry {
    name: string;
    artist: string;
    /** Cover art path (the indexer's thumbnail). */
    art?: string;
    /** In track order. */
    songs: AudioItem[];
    year?: number;
}

const collator = typeof Intl !== "undefined" ? new Intl.Collator(undefined, { sensitivity: "base", numeric: true }) : null;
const cmp = (a: string, b: string) => (collator ? collator.compare(a, b) : a < b ? -1 : a > b ? 1 : 0);

/** Sort key without a leading "The " / "A ", as the webOS music app sorted artists. */
export function sortKey(s: string): string {
    return s.replace(/^(the|a|an)\s+/i, "");
}

export function artistOf(s: AudioItem): string {
    return s.artist || s.album_artist || UNKNOWN_ARTIST;
}

export function albumOf(s: AudioItem): string {
    return s.album || UNKNOWN_ALBUM;
}

export function titleOf(s: AudioItem): string {
    return s.title || s.file_path.replace(/^.*\//, "").replace(/\.[^.]*$/, "");
}

function byTrack(a: AudioItem, b: AudioItem): number {
    return (a.track ?? 0) - (b.track ?? 0) || cmp(titleOf(a), titleOf(b));
}

export function albums(items: AudioItem[]): AlbumEntry[] {
    const map = new Map<string, AlbumEntry>();
    for (const s of items) {
        const artist = s.album_artist || artistOf(s);
        const key = albumOf(s) + "\u0000" + artist;
        let a = map.get(key);
        if (!a) map.set(key, (a = { name: albumOf(s), artist, songs: [], year: s.year }));
        a.songs.push(s);
        if (!a.art && s.thumbnail) a.art = s.thumbnail;
    }
    const list = [...map.values()];
    list.forEach((a) => a.songs.sort(byTrack));
    return list.sort((x, y) => cmp(sortKey(x.name), sortKey(y.name)) || cmp(x.artist, y.artist));
}

export function artists(items: AudioItem[]): ArtistEntry[] {
    const map = new Map<string, AudioItem[]>();
    for (const s of items) {
        const n = artistOf(s);
        if (!map.has(n)) map.set(n, []);
        map.get(n)!.push(s);
    }
    return [...map.entries()]
        .map(([name, songs]) => {
            const al = albums(songs);
            return { name, albums: al, songs: al.flatMap((a) => a.songs) };
        })
        .sort((x, y) => cmp(sortKey(x.name), sortKey(y.name)));
}

export function songs(items: AudioItem[]): AudioItem[] {
    return [...items].sort((a, b) => cmp(sortKey(titleOf(a)), sortKey(titleOf(b))));
}

/** "2 albums, 5 songs" */
export function artistSummary(a: ArtistEntry): string {
    const n = a.albums.length, m = a.songs.length;
    return `${n} ${n === 1 ? "album" : "albums"}, ${m} ${m === 1 ? "song" : "songs"}`;
}

/** Play order for a queue of n songs: straight, or shuffled with `first` kept first. */
export function playOrder(n: number, first: number, shuffle: boolean, random: () => number = Math.random): number[] {
    const order = Array.from({ length: n }, (_, i) => i);
    if (!shuffle) return order;
    const rest = order.filter((i) => i !== first);
    for (let i = rest.length - 1; i > 0; --i) {
        const j = Math.floor(random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return n ? [first, ...rest] : [];
}
