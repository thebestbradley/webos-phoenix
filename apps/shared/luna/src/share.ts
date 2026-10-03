// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system's share sheet and save picker (docs/SHARE-AND-FILES.md;
// runtime: org.webosphoenix.share, org.webosphoenix.filepicker). The same
// sheet in every app: what it offers (the apps that take what is shared,
// Save to Photos, Save to Files) is the system's.

import { call } from "./bridge";

export interface SharedFile { path: string; mimeType?: string }
export interface ShareRequest { title?: string; text?: string; url?: string; files?: SharedFile[] }
export type ShareResult =
    | { action: "app"; appId: string }
    | { action: "photos" | "files"; path: string; already?: boolean }
    | { action: "copy" | "cancel" };

export interface SaveRequest {
    /** The file's name, which the user may change. */
    name: string;
    /** A file to copy there, or the file's bytes (base64) with their type. */
    from?: string;
    data?: string;
    mimeType?: string;
    /** The picker's title ("Save to Files"). */
    title?: string;
}

export const shareSheet = {
    /** Show the share sheet; resolves with what the user chose (the system has done it). */
    async open(req: ShareRequest): Promise<ShareResult> {
        const r = await call("luna://org.webosphoenix.share/open", req);
        return r as unknown as ShareResult;
    },
};

export interface PickedFile {
    fullPath: string;
    mimeType: string;
    name: string;
}

export const filePicker = {
    /** Choose a picture (SF2: pictures only so far), from the pictures Photos has. */
    async pick(req: { kinds?: "image"[]; title?: string } = {}): Promise<{ files: PickedFile[] } | { canceled: true }> {
        const r = await call("luna://org.webosphoenix.filepicker/pick", { kinds: req.kinds ?? ["image"], ...(req.title ? { title: req.title } : {}) });
        return r.canceled ? { canceled: true } : { files: (r.files as PickedFile[]) ?? [] };
    },
    /** Save to Files: the user picks a folder (the last one used first) and a name. */
    async save(req: SaveRequest): Promise<{ path: string } | { canceled: true }> {
        const r = await call("luna://org.webosphoenix.filepicker/save", req);
        return r.canceled ? { canceled: true } : { path: r.path as string };
    },
};
