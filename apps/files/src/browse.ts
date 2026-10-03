// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the Files app works out without the service: the path bar, what a
// paste does, labels for dates and kinds, and the saved preferences
// (sort order, hidden files, favourite folders).

import { baseName, isInside, joinPath, kindOf, parentOf, uniqueName, type FileEntry, type FileKind, type SortKey } from "@phoenix/luna";
import { formatTime } from "@phoenix/ui";

export const HOME = "/media/internal";

/** Favourite folders on first start (legacy webOS's USB drive and its usual folders). */
export const DEFAULT_FAVORITES = [HOME, HOME + "/Downloads", HOME + "/Documents", HOME + "/Pictures", HOME + "/Music"];

/** A folder's name for headers and lists. */
export function folderTitle(path: string): string {
    if (path === "/") return "Device";
    if (path === HOME) return "Internal storage";
    return baseName(path);
}

/** The path bar: one segment per folder from the root. */
export function crumbs(path: string): { label: string; path: string }[] {
    const out = [{ label: "/", path: "/" }];
    let p = "";
    for (const seg of path.split("/").filter(Boolean)) {
        p += "/" + seg;
        out.push({ label: seg, path: p });
    }
    return out;
}

export interface Clipboard {
    mode: "copy" | "cut";
    paths: string[];
}

export interface PasteStep {
    from: string;
    to: string;
    move: boolean;
}

/**
 * What pasting the clipboard into `folder` does. Copies get a free name
 * ("notes 2.txt") when the name is taken; cutting into the folder the file
 * is already in does nothing; a folder cannot go into itself.
 */
export function planPaste(clip: Clipboard, folder: string, existing: Iterable<string>): { steps: PasteStep[]; skipped: string[] } {
    const taken = new Set(existing);
    const steps: PasteStep[] = [];
    const skipped: string[] = [];
    for (const from of clip.paths) {
        if (isInside(folder, from)) { skipped.push(from); continue; }
        if (clip.mode === "cut" && parentOf(from) === folder) continue;
        const name = uniqueName(baseName(from), taken);
        taken.add(name);
        steps.push({ from, to: joinPath(folder, name), move: clip.mode === "cut" });
    }
    return { steps, skipped };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A row's date: the time today, "Sep 3" this year, "Sep 3, 2025" before. */
export function shortDate(ms: number, now = Date.now()): string {
    const d = new Date(ms), n = new Date(now);
    if (d.toDateString() === n.toDateString()) return formatTime(ms);
    const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    return d.getFullYear() === n.getFullYear() ? md : `${md}, ${d.getFullYear()}`;
}

/** "Sep 3, 2026 4:05 PM" for the info sheet. */
export function longDate(ms: number): string {
    const d = new Date(ms);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${formatTime(ms)}`;
}

const KIND_LABELS: Record<FileKind, string> = {
    folder: "Folder", image: "Image", audio: "Audio", video: "Video", text: "Text document", code: "Source code",
    archive: "Archive", package: "webOS package", pdf: "PDF document", document: "Office document", book: "E-book", file: "File",
};

export function kindLabel(entry: Pick<FileEntry, "name" | "type">): string {
    return KIND_LABELS[kindOf(entry)];
}

// ---- Preferences ------------------------------------------------------------------

export interface Prefs {
    sort: SortKey;
    showHidden: boolean;
    favorites: string[];
}

const PREFS_KEY = "org.webosphoenix.files:prefs";

export function loadPrefs(): Prefs {
    const base: Prefs = { sort: "name", showHidden: false, favorites: DEFAULT_FAVORITES };
    try {
        const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
        if (!saved) return base;
        return {
            sort: saved.sort === "size" || saved.sort === "date" ? saved.sort : "name",
            showHidden: !!saved.showHidden,
            favorites: Array.isArray(saved.favorites) ? saved.favorites.filter((f) => typeof f === "string") : base.favorites,
        };
    } catch {
        return base;
    }
}

export function savePrefs(p: Prefs): void {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}
