// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sharing, both ways, and the system's file pickers (docs/SHARE-AND-FILES.md):
//
//   org.webosphoenix.share/open {title?, text?, url?, files?: [{path,
//       mimeType?}]} -> {action: "app" (appId) | "photos" | "files" (path)
//       | "copy" | "cancel"}: the system's share sheet over the app's card.
//   An app that takes shares says so in its appinfo.json:
//       "phoenix": {"shareTargets": [{"types": ["image/*", "text/plain"], "label": "Notes"}]}
//   and is launched (or relaunched) with {share: {title, text, url, files}}.
//   org.webosphoenix.filepicker/pick and /save: the file and picture
//       pickers and Save to Files.
//
// The requests are @phoenix/luna's shareSheet and filePicker. Without
// Phoenix (plain webOS OSE, a browser) share.open uses the browser's own
// share (navigator.share) or copies to the clipboard, and the pickers use
// the browser's file input and a download, each saying so once.

import { app } from "./app";
import { guard, hasDocument, request, toPhoenixError, warnOnce, PhoenixError } from "./core";
import { filePicker, shareSheet } from "../../luna/src/share";

export interface SharedFile {
    /** A device path (/media/internal/...). */
    path: string;
    mimeType?: string;
}

/** What is shared: any of a title, text, a link and files. */
export interface ShareContent {
    title?: string;
    text?: string;
    url?: string;
    files?: SharedFile[];
}

/** What the user did with the sheet; the system has done it. */
export type ShareResult =
    | { action: "app"; appId: string }
    | { action: "photos"; path: string; paths?: string[]; already?: boolean }
    | { action: "files"; path: string }
    | { action: "copy" | "cancel" }
    /** Off Phoenix: the browser's own share sheet took it. */
    | { action: "system" };

export interface ShareTarget {
    appId: string;
    title: string;
    icon?: string;
    label: string;
}

function unavailable(e: unknown): boolean {
    return toPhoenixError(e).code === "unavailable";
}

export const share = {
    /**
     * Show the system's share sheet with this content. Resolves with what
     * the user chose ({action: "cancel"} when they closed it).
     *
     *     await share.open({ title: note.title, text: note.body });
     *     await share.open({ files: [{ path: "/media/internal/Pictures/a.jpg", mimeType: "image/jpeg" }] });
     */
    async open(content: ShareContent): Promise<ShareResult> {
        if (!content.text && !content.url && !content.files?.length)
            throw new PhoenixError("share.open", { returnValue: false, errorCode: -1, errorText: "Nothing to share: files, text or url" }, "failed");
        try {
            return await guard(shareSheet.open(content) as Promise<ShareResult>, "luna://org.webosphoenix.share/open");
        } catch (e) {
            if (!unavailable(e)) throw e;
        }
        // Not Phoenix: the browser's share, else the clipboard.
        const nav = typeof navigator !== "undefined" ? navigator as Navigator & { share?: (d: object) => Promise<void> } : undefined;
        if (nav?.share && !content.files?.length) {
            warnOnce("share:browser", "share.open: no Phoenix share sheet here; using the browser's share.");
            try {
                await nav.share({ title: content.title, text: content.text, url: content.url });
                return { action: "system" };
            } catch (e) {
                if ((e as { name?: string })?.name === "AbortError") return { action: "cancel" };
                throw toPhoenixError(e, "share.open");
            }
        }
        const text = [content.text, content.url].filter(Boolean).join("\n");
        if (text && nav?.clipboard?.writeText) {
            warnOnce("share:clipboard", "share.open: no share sheet here; the text is copied to the clipboard instead.");
            await nav.clipboard.writeText(text);
            return { action: "copy" };
        }
        throw new PhoenixError("share.open", { returnValue: false, errorCode: -1, errorText: "No share sheet here (not Phoenix)" }, "unavailable");
    },

    /** The apps that take content of these MIME types ("image/png", "text/plain"), as the sheet lists them. */
    async targets(types: string[]): Promise<ShareTarget[]> {
        const r = await request<{ targets?: ShareTarget[] }>("luna://org.webosphoenix.share/targets", { types });
        return r.targets ?? [];
    },

    /** What the app was launched with to receive (its shareTargets), or null. */
    received(): ShareContent | null {
        const s = app.launchParams<{ share?: ShareContent }>().share;
        return s && typeof s === "object" ? s : null;
    },

    /**
     * Content shared to the app: at once if it was launched with some, then
     * on each relaunch that brings more. Returns a function that stops listening.
     *
     *     share.onReceive((s) => createNote(s.title, s.text ?? s.url));
     */
    onReceive(cb: (content: ShareContent) => void): () => void {
        const first = share.received();
        if (first) cb(first);
        return app.onRelaunch<{ share?: ShareContent }>((p) => { if (p.share && typeof p.share === "object") cb(p.share); });
    },
};

// ---- Pickers ------------------------------------------------------------------------------

/** The picker's kinds: pictures (by album), videos, music, documents, or any file by folder. */
export type PickKind = "image" | "video" | "audio" | "document" | "file";

export interface PickOptions {
    /** What may be picked (default pictures); with several, the user picks the kind first. */
    kinds?: PickKind[];
    multiple?: boolean;
    /** Crop one picture to this size (either side alone: a square). */
    cropWidth?: number;
    cropHeight?: number;
    /** Only these extensions ("pdf"). */
    extensions?: string[];
    title?: string;
}

export interface PickedFile {
    /** A device path; in a browser without Phoenix, a blob: URL. */
    fullPath: string;
    mimeType: string;
    name: string;
    size?: number;
    /** With a crop size: the crop at that size (a JPEG). */
    croppedPath?: string;
    /** In a browser without Phoenix: the File itself. */
    file?: File;
}

export interface SaveOptions {
    /** The file's name, which the user may change. */
    name: string;
    /** A file to copy there... */
    from?: string;
    /** ...or the bytes, base64, with their type. */
    data?: string;
    mimeType?: string;
    /** The picker's title ("Save to Files"). */
    title?: string;
}

const ACCEPT: Record<PickKind, string> = { image: "image/*", video: "video/*", audio: "audio/*", document: ".pdf,.txt,.doc,.docx,.odt,.rtf,.md", file: "" };

function browserPick(opts: PickOptions): Promise<PickedFile[] | null> {
    if (!hasDocument())
        return Promise.reject(new PhoenixError("pickers.open", { returnValue: false, errorText: "No file picker here" }, "unavailable"));
    warnOnce("pick:browser", "pickers.open: no Phoenix picker here; using the browser's file input.");
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = !!opts.multiple;
        const kinds = opts.kinds ?? ["image"];
        const accept = opts.extensions?.length ? opts.extensions.map((x) => "." + x.replace(/^\./, "")).join(",")
            : kinds.includes("file") ? "" : kinds.map((k) => ACCEPT[k]).join(",");
        if (accept) input.accept = accept;
        input.addEventListener("change", () => {
            const files = Array.from(input.files ?? []);
            resolve(files.length ? files.map((f) => ({ fullPath: URL.createObjectURL(f), mimeType: f.type, name: f.name, size: f.size, file: f })) : null);
        });
        input.addEventListener("cancel", () => resolve(null));
        input.click();
    });
}

export const pickers = {
    /**
     * The system's file picker. Resolves with the files picked, or null when
     * the user cancelled.
     *
     *     const files = await pickers.open({ kinds: ["document"], extensions: ["pdf"] });
     */
    async open(opts: PickOptions = {}): Promise<PickedFile[] | null> {
        try {
            const r = await guard(filePicker.pick(opts), "luna://org.webosphoenix.filepicker/pick");
            return "canceled" in r ? null : r.files;
        } catch (e) {
            if (!unavailable(e)) throw e;
            return browserPick(opts);
        }
    },

    /** One picture (optionally cropped to a size): the picture picker. Null when cancelled. */
    async picture(opts: Omit<PickOptions, "kinds" | "multiple"> = {}): Promise<PickedFile | null> {
        const files = await pickers.open({ ...opts, kinds: ["image"], multiple: false });
        return files?.[0] ?? null;
    },

    /**
     * Save to Files: the user picks a folder (the last one used first) and
     * a name; the system writes the file. Resolves with its path, or null
     * when cancelled. Without Phoenix, `data` is downloaded by the browser.
     */
    async save(opts: SaveOptions): Promise<string | null> {
        try {
            const r = await guard(filePicker.save(opts), "luna://org.webosphoenix.filepicker/save");
            return "canceled" in r ? null : r.path;
        } catch (e) {
            if (!unavailable(e) || !hasDocument() || opts.data === undefined) throw e;
            warnOnce("save:browser", "pickers.save: no Phoenix save picker here; the browser downloads the file.");
            const a = document.createElement("a");
            a.href = `data:${opts.mimeType ?? "application/octet-stream"};base64,${opts.data}`;
            a.download = opts.name;
            a.click();
            return opts.name;
        }
    },
};
