// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the player needs from the system, in one place.

import { fileManager, fileUrl, isWebAddress, mediaUrl, parentOf } from "@phoenix/luna";

export { audioFocus, fileManager, isWebAddress, setFullScreen, setWindowOrientation, type Subscription } from "@phoenix/luna";

/**
 * A URL the <video> element can play: the web address itself; for a file,
 * the media store's URL (a camera recording, a download) or else the file
 * manager's (a file copied in Files, the demo videos).
 */
export async function playableUrl(target: string): Promise<string> {
    if (isWebAddress(target)) return target;
    const media = await mediaUrl(target);
    if (media !== target) return media;
    return fileUrl(target);
}

/** The paths in the video's folder (to find its subtitles). */
export async function listFolderPaths(path: string): Promise<string[]> {
    return (await fileManager.list(parentOf(path))).map((e) => e.path);
}
