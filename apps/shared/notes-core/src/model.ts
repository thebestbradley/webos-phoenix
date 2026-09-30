// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Notes and folders, as the Notes demos keep them in db8. The demos
// (Enact Limestone and Agate, Ionic, Flutter) share the kinds, so a note
// written in one shows in the others.

export const NOTE_KIND = "org.webosphoenix.enactnotes.note:1";
export const FOLDER_KIND = "org.webosphoenix.enactnotes.folder:1";

/** The apps allowed to use the kinds; the first owns them. */
export const APP_IDS = [
    "org.webosphoenix.enactnotes.limestone",
    "org.webosphoenix.enactnotes.agate",
    "org.webosphoenix.ionicnotes",
    "org.webosphoenix.flutternotes",
] as const;

/** The built-in folders, as in Apple Notes. Only user folders are stored. */
export const ALL_NOTES = "all";
export const DEFAULT_FOLDER = "notes";
export const RECENTLY_DELETED = "deleted";

/** Recently Deleted keeps a note this long, then removes it for good. */
export const DELETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface Note {
    _id: string;
    _kind: typeof NOTE_KIND;
    _rev?: number;
    /** DEFAULT_FOLDER or a Folder's _id. */
    folderId: string;
    /** The note's text, in Markdown (CommonMark with GitHub's extensions). */
    body: string;
    pinned: boolean;
    createdAt: number;
    modifiedAt: number;
    /** When it went to Recently Deleted; null while it is not deleted. */
    deletedAt: number | null;
}

export interface Folder {
    _id: string;
    _kind: typeof FOLDER_KIND;
    _rev?: number;
    name: string;
    createdAt: number;
}

export type SortOrder = "modified" | "created" | "title";

export function isDeleted(n: Note): boolean {
    return n.deletedAt !== null && n.deletedAt !== undefined;
}

/** The notes a folder (built-in or user) shows. */
export function notesInFolder(notes: readonly Note[], folderId: string): Note[] {
    if (folderId === RECENTLY_DELETED) return notes.filter(isDeleted);
    const live = notes.filter((n) => !isDeleted(n));
    return folderId === ALL_NOTES ? live : live.filter((n) => n.folderId === folderId);
}

/** Notes in Recently Deleted for longer than the retention period. */
export function expiredNotes(notes: readonly Note[], now: number): Note[] {
    return notes.filter((n) => isDeleted(n) && now - (n.deletedAt as number) >= DELETED_RETENTION_MS);
}

/** Days left before a deleted note is removed (Apple shows "30 days"). */
export function daysLeft(n: Note, now: number): number {
    if (!isDeleted(n)) return 0;
    return Math.max(0, Math.ceil((DELETED_RETENTION_MS - (now - (n.deletedAt as number))) / 86400000));
}

/** A folder name that is not empty and not taken (case-insensitive). */
export function folderNameProblem(name: string, folders: readonly Folder[], except?: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) return "Enter a name.";
    const lower = trimmed.toLocaleLowerCase();
    if (lower === "notes" || lower === "all notes" || lower === "recently deleted") return "That name is reserved.";
    if (folders.some((f) => f._id !== except && f.name.trim().toLocaleLowerCase() === lower))
        return "A folder with that name already exists.";
    return null;
}
