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
    | { action: "photos"; path: string; paths?: string[]; already?: boolean }
    | { action: "files"; path: string }
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

/** Where a picture was cropped (Enyo 1's CroppableImage names, in the picture's pixels). */
export interface CropInfo {
    /** Displayed pixels per picture pixel. */
    scale: number;
    suggestedXtop: number;
    suggestedYtop: number;
    /** scale, in percent. */
    suggestedScale: number;
    suggestedXsize: number;
    suggestedYsize: number;
    sourceWidth: number;
    sourceHeight: number;
    sourceImage: string;
    /** The crop's centre, 0-1 of the picture's width and height. */
    focusX: number;
    focusY: number;
}

export interface PickedFile {
    fullPath: string;
    mimeType: string;
    name: string;
    size?: number;
    /** With a crop size: the part of the picture the user framed... */
    cropInfo?: CropInfo;
    /** ...and that part at the size asked (a JPEG). */
    croppedPath?: string;
}

/** The original picker's kinds (image, video, audio, document) and any file, by folder. */
export type PickKind = "image" | "video" | "audio" | "document" | "file";

export interface PickRequest {
    /** What may be picked (default pictures); with several, the user picks the kind first. */
    kinds?: PickKind[];
    /** Several files at once. */
    multiple?: boolean;
    /** A crop of this size for one picture (either side alone: a square). */
    cropWidth?: number;
    cropHeight?: number;
    /** Only files with these extensions ("pdf"), for documents and files. */
    extensions?: string[];
    title?: string;
}

export const filePicker = {
    /** The system's file picker (SF2): pictures by album, videos, music, documents or any file. */
    async pick(req: PickRequest = {}): Promise<{ files: PickedFile[] } | { canceled: true }> {
        const params: Record<string, unknown> = { kinds: req.kinds ?? ["image"] };
        if (req.multiple) params.multiple = true;
        if (req.cropWidth) params.cropWidth = req.cropWidth;
        if (req.cropHeight) params.cropHeight = req.cropHeight;
        if (req.extensions?.length) params.extensions = req.extensions;
        if (req.title) params.title = req.title;
        const r = await call("luna://org.webosphoenix.filepicker/pick", params);
        return r.canceled ? { canceled: true } : { files: (r.files as PickedFile[]) ?? [] };
    },
    /** Save to Files: the user picks a folder (the last one used first) and a name. */
    async save(req: SaveRequest): Promise<{ path: string } | { canceled: true }> {
        const r = await call("luna://org.webosphoenix.filepicker/save", req);
        return r.canceled ? { canceled: true } : { path: r.path as string };
    },
};
