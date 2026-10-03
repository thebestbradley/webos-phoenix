// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The slideshow Photos shows as an exhibition (dock mode on the Touchstone):
// which pictures, in what order, how long each stays, and the choices it
// keeps between exhibitions (the TouchPad Photos app's SlideshowMode kept its
// sliding interval the same way, in the app's local storage).

import type { MediaItem } from "@phoenix/luna";
import { groupAlbums, isVideo, type Album } from "./albums";

/** Seconds a picture stays: the choices, and the one at first. */
export const INTERVALS = [3, 5, 10, 20, 30];
export const DEFAULT_INTERVAL = 5;

export interface SlideshowPrefs {
    /** Seconds per picture, one of INTERVALS. */
    interval: number;
    /** The album (its folder) to show, or null for every picture. */
    album: string | null;
}

export const PREFS_KEY = "org.webosphoenix.photos.exhibition";

/** The kept choices, checked; storage that fails or holds nonsense gives the defaults. */
export function loadPrefs(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): SlideshowPrefs {
    let raw: unknown = null;
    try { raw = JSON.parse(storage?.getItem(PREFS_KEY) ?? "null"); } catch { raw = null; }
    const p = (raw && typeof raw === "object" ? raw : {}) as Partial<SlideshowPrefs>;
    return {
        interval: INTERVALS.includes(p.interval as number) ? (p.interval as number) : DEFAULT_INTERVAL,
        album: typeof p.album === "string" && p.album !== "" ? p.album : null,
    };
}

export function savePrefs(prefs: SlideshowPrefs, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
    try { storage?.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* best effort: the slideshow still runs */ }
}

/** The albums that have pictures (videos are left out of a slideshow). */
export function pictureAlbums(items: MediaItem[]): Album[] {
    return groupAlbums(items.filter((it) => !isVideo(it))).filter((a) => a.items.length > 0);
}

/**
 * The pictures to show: the chosen album's, or all of them, newest first
 * album by album (Camera Roll first). An album that is gone shows them all.
 */
export function slides(items: MediaItem[], album: string | null): MediaItem[] {
    const albums = pictureAlbums(items);
    const chosen = album !== null ? albums.find((a) => a.id === album) : undefined;
    return chosen ? chosen.items : albums.flatMap((a) => a.items);
}

/** The next picture's index, round and round; -1 with none. */
export function step(index: number, count: number, by = 1): number {
    if (count <= 0) return -1;
    return (((index + by) % count) + count) % count;
}
