// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Albums are folders, as in the webOS 2.x Photos & Videos app: the camera's
// folder is the Camera Roll, and every other folder with pictures or videos
// is an album named after it.

import { CAMERA_DIR, MEDIA_ROOT, folderOf, type MediaItem } from "@phoenix/luna";

export interface Album {
    /** The folder, e.g. "/media/internal/DCIM/100PHNX". */
    id: string;
    name: string;
    /** Newest first. */
    items: MediaItem[];
}

const NAMED: Record<string, string> = {
    [CAMERA_DIR]: "Camera Roll",
    [MEDIA_ROOT + "/samples/photos"]: "Sample Photos",
    [MEDIA_ROOT + "/samples/videos"]: "Sample Videos",
    [MEDIA_ROOT + "/wallpapers"]: "Wallpapers",
    [MEDIA_ROOT + "/screencaptures"]: "Screen Captures",
    [MEDIA_ROOT + "/downloads"]: "Downloads",
};

export function albumName(folder: string): string {
    if (NAMED[folder]) return NAMED[folder];
    const last = folder.replace(/^.*\//, "");
    return last ? last.charAt(0).toUpperCase() + last.slice(1) : "Photos";
}

function time(item: MediaItem): number {
    return Date.parse(item.last_modified_date ?? "") || 0;
}

/** Newest first; ties by path so the order is stable. */
export function byNewest(a: MediaItem, b: MediaItem): number {
    return time(b) - time(a) || (a.file_path < b.file_path ? 1 : a.file_path > b.file_path ? -1 : 0);
}

/** Group pictures and videos into albums: Camera Roll first (even when empty), then by name. */
export function groupAlbums(items: MediaItem[]): Album[] {
    const folders = new Map<string, MediaItem[]>();
    folders.set(CAMERA_DIR, []);
    for (const it of items) {
        const f = folderOf(it.file_path);
        if (!folders.has(f)) folders.set(f, []);
        folders.get(f)!.push(it);
    }
    const albums = [...folders.entries()].map(([id, list]) => ({ id, name: albumName(id), items: list.sort(byNewest) }));
    return albums.sort((a, b) => (a.id === CAMERA_DIR ? -1 : b.id === CAMERA_DIR ? 1 : a.name.localeCompare(b.name)));
}

export function isVideo(item: MediaItem): boolean {
    return item.type === "video" || (item.mime ?? "").startsWith("video/");
}

/** "12 photos", "1 video", "3 photos, 1 video" */
export function countLabel(items: MediaItem[]): string {
    const v = items.filter(isVideo).length, p = items.length - v;
    const parts: string[] = [];
    if (p || !v) parts.push(`${p} ${p === 1 ? "photo" : "photos"}`);
    if (v) parts.push(`${v} ${v === 1 ? "video" : "videos"}`);
    return parts.join(", ");
}
