// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Where the save and pick sheets go: Internal Storage and each drive (a
// Synergy account with the DOCUMENTS capability, /media/drives/<account>),
// "Places" above them when there are drives, and the folders in each.

import { driveRootOf, parentOf } from "@phoenix/luna";
import { folderChain } from "@phoenix/ui";

export const MEDIA = "/media/internal";
/** The places above the folders: Internal Storage and each drive. */
export const PLACES = "";

/** Up from a folder: the places above Internal Storage and a drive's own folder (when there are drives). */
export function upOf(path: string, hasDrives: boolean): string {
    return path === MEDIA || driveRootOf(path) === path ? (hasDrives ? PLACES : path) : parentOf(path);
}

/**
 * The column view's folders for the folder the sheet is in: the places
 * (when there are drives), then the place's folders down to it: ["",
 * "/media/internal", "/media/internal/Documents"].
 */
export function pickerChain(folder: string, hasDrives: boolean): string[] {
    if (folder === PLACES) return [PLACES];
    const chain = folderChain(driveRootOf(folder) ?? MEDIA, folder);
    return hasDrives ? [PLACES, ...chain] : chain;
}
