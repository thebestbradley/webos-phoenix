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

/**
 * What "play <query>" plays (the Assistant's play command, launch params
 * {play}): an artist's songs, an album, a song, by name (whole, then
 * starting with it, then containing it); everything for "". null: nothing
 * matches.
 */
export function songsFor(items: AudioItem[], query: string): AudioItem[] | null {
    const q = query.trim().toLowerCase().replace(/^the\s+/, "");
    if (!q) return songs(items);
    const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, "");
    const tests: ((s: string) => boolean)[] = [(s) => norm(s) === q, (s) => norm(s).startsWith(q), (s) => norm(s).includes(q)];
    for (const t of tests) {
        const ar = artists(items).find((a) => t(a.name));
        if (ar) return ar.songs;
        const al = albums(items).find((a) => t(a.name));
        if (al) return al.songs;
        const so = songs(items).filter((s) => t(titleOf(s)));
        if (so.length) return so;
    }
    return null;
}

/** A file handed over by the share sheet ({share: {files}}, docs/SHARE-AND-FILES.md). */
export interface SharedFile {
    path: string;
    mimeType?: string;
}

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|amr|wma)$/i;

/**
 * The songs to play for what the share sheet gave Music ({share: {title,
 * files}}, appinfo.json shareTargets audio/*): its audio files in order,
 * as the library has them when it does (their tags and art), else from the
 * file alone. A single file without a title tag takes the share's title
 * (a voice memo's name, Voice Memos' Share).
 */
export function sharedSongs(share: { title?: string; files?: SharedFile[] }, library: AudioItem[]): AudioItem[] {
    const files = (share.files ?? []).filter((f) => f && typeof f.path === "string"
        && (/^audio\//.test(f.mimeType ?? "") || (!f.mimeType && AUDIO_EXT.test(f.path))));
    const one = files.length === 1 && share.title ? share.title : "";
    return files.map((f) => {
        const known = library.find((s) => s.file_path === f.path);
        const song: AudioItem = known ? { ...known } : { uri: "file://" + f.path, file_path: f.path, type: "audio", mime: f.mimeType };
        // (Without a title tag the indexer's title is the file's name.)
        const bare = f.path.replace(/^.*\//, "").replace(/\.[^.]*$/, "");
        if (one && (!song.title || song.title === bare)) song.title = one;
        return song;
    });
}
