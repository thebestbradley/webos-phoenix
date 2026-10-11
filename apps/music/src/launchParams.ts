// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What other apps ask Music for, from its launch params: the one place they
// are read (docs/LAUNCH-CONTRACTS.md); appinfo.json "phoenix.launchParams"
// lists the keys (tools/check-launch-contracts.cjs checks every caller).
//
//   {play: "<artist, album or song>"}  the Assistant's "play ..."; with
//                                      shuffle: true, shuffled ("shuffle my
//                                      music": everything)
//   {favorites: true}                  the favorite songs (favorites.ts):
//                                      "play my favorites"
//   {shuffle: true | false}            alone: what plays shuffled, or not
//   {repeat: "off" | "all" | "one"}    alone (or with shuffle): repeating
//                                      ("repeat this song": one)
//   {share: {title, files}}            audio from the share sheet
//   {target, mimeType?, fileName?}     an audio file opened with Music: Files'
//                                      Open (luna files.ts openWith: {target:
//                                      path}), the application manager's open
//                                      of an audio file or link, and the
//                                      original Email's attachment, which
//                                      opened com.palm.app.streamingmusicplayer
//                                      with {target: uri, mimeType, fileName}
//                                      (core-apps com.palm.app.email
//                                      controls/AttachmentsDrawer.js:279-316).
//                                      It plays at once, as there.

import type { SharedFile } from "./library";
import type { Repeat } from "./player";

/** The keys read here: appinfo.json "phoenix.launchParams" must list the same. */
export const LAUNCH_PARAMS = ["play", "share", "target", "mimeType", "fileName", "shuffle", "repeat", "favorites"] as const;

export interface MusicLaunchParams {
    play?: string;
    share?: { title?: string; files?: SharedFile[] };
    target?: string;
    mimeType?: string;
    fileName?: string;
    shuffle?: boolean;
    repeat?: string;
    favorites?: boolean;
    [key: string]: unknown;
}

export type MusicIntent =
    | { kind: "none" }
    | { kind: "play"; query: string; shuffle?: boolean }
    | { kind: "favorites"; shuffle?: boolean }
    /** How what plays plays: shuffled or not, repeated or not. */
    | { kind: "mode"; shuffle?: boolean; repeat?: Repeat }
    | { kind: "share"; share: { title?: string; files?: SharedFile[] } }
    /** One file (a path) or a web address. */
    | { kind: "file"; path?: string; url?: string; mimeType?: string; title?: string };

const REPEATS: readonly string[] = ["off", "all", "one"];

export function parseLaunch(p: MusicLaunchParams | null | undefined): MusicIntent {
    if (!p || typeof p !== "object") return { kind: "none" };
    const shuffle = typeof p.shuffle === "boolean" ? { shuffle: p.shuffle } : {};
    if (p.share && typeof p.share === "object") return { kind: "share", share: p.share };
    if (typeof p.play === "string") return { kind: "play", query: p.play, ...shuffle };
    if (p.favorites === true) return { kind: "favorites", ...shuffle };
    const repeat = typeof p.repeat === "string" && REPEATS.includes(p.repeat) ? { repeat: p.repeat as Repeat } : {};
    if ("shuffle" in shuffle || "repeat" in repeat) return { kind: "mode", ...shuffle, ...repeat };
    const t = typeof p.target === "string" ? p.target.trim() : "";
    if (!t) return { kind: "none" };
    const title = typeof p.fileName === "string" && p.fileName.trim() ? p.fileName.trim().replace(/\.[^.]*$/, "") : undefined;
    const mimeType = typeof p.mimeType === "string" && p.mimeType ? p.mimeType : undefined;
    if (/^https?:\/\//i.test(t)) return { kind: "file", url: t, mimeType, title };
    let path = t.replace(/^file:\/\//i, "");
    try { path = decodeURIComponent(path); } catch { /* as it is */ }
    return path.startsWith("/") ? { kind: "file", path, mimeType, title } : { kind: "none" };
}
