// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the player needs from the system, in one place.

import { accessibility, fileManager, fileUrl, isWebAddress, mediaUrl, parentOf, type Subscription } from "@phoenix/luna";

export { audioFocus, fileManager, isWebAddress, setFullScreen, setWindowOrientation, watchMediaKeys, type Subscription } from "@phoenix/luna";

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

/**
 * Settings > Accessibility > Captions (system preference
 * `accessibility.captions`): read once as a video opens; false when it
 * cannot be read (half a second at most).
 */
export function captionsOn(): Promise<boolean> {
    return new Promise((resolve) => {
        let finished = false;
        let sub: Subscription | null = null;
        const done = (v: boolean) => {
            clearTimeout(timer);
            finished = true;
            resolve(v);
            sub?.cancel();
        };
        const timer = setTimeout(() => done(false), 500);
        // (The answer may come before watch returns: cancelled just after.)
        const s = accessibility.watch((p) => done(!!p.captions), () => done(false));
        if (finished) s.cancel();
        else sub = s;
    });
}

/** The paths in the video's folder (to find its subtitles). */
export async function listFolderPaths(path: string): Promise<string[]> {
    return (await fileManager.list(parentOf(path))).map((e) => e.path);
}
