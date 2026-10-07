// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.clipboard: Phoenix's clipboard history (docs/M6-PLAN.md
// F2). Every copy in every app is recorded with the app it came from; the
// keyboard's clip strip, the Clipboard app and Settings > Clipboard read and
// change the one history. The simulator implements it in
// runtime/phoenix-runtime.js (block "Clipboard history"), with the
// requests and replies documented there and in docs/APP-RUNTIME.md.
//
// A sensitive clip (a password, a one-time code, an otpauth:// link) comes
// masked: no text, only its kind and length. reveal() gives its text after
// the device passcode.

import { call, subscribe, type LunaError, type LunaResult, type Subscription } from "./bridge";

export type ClipType = "text" | "link" | "image";
/** What a sensitive clip is: decides "Save to Passwords" or "Add to Authenticator". */
export type SensitiveKind = "password" | "otp" | "otpauth" | "totp" | "secret";
export type KeepFor = "hour" | "day" | "week" | "month" | "forever";

export interface Clip {
    id: string;
    type: ClipType;
    /** Not for a sensitive clip (see reveal) nor an image. */
    text?: string;
    /** A link's title, or an image's alt text, when known. */
    title?: string;
    /** An image: a data: URL or the address it was copied from. */
    image?: string;
    /** The app it was copied in. */
    source: string;
    /** When it was copied (ms since the epoch); copying it again moves it up. */
    time: number;
    pinned: boolean;
    /** A category id, or "". */
    category: string;
    sensitive: boolean;
    kind?: SensitiveKind;
    /** A sensitive clip's length, for its mask. */
    length?: number;
}

export interface ClipCategory {
    id: string;
    name: string;
}

export interface ClipboardSettings {
    /** Off: nothing is recorded, the history goes (saved clips stay), no keyboard key. */
    enabled: boolean;
    keyboardKey: boolean;
    /** How many clips the history keeps (pinned and categorized clips are not counted). */
    maxItems: number;
    keepFor: KeepFor;
    clearOnLock: boolean;
    /** "mask": recorded, encrypted and masked; "skip": not recorded. */
    sensitive: "mask" | "skip";
    /** One-time codes and password-like text count as sensitive. */
    detectSecrets: boolean;
    excludedApps: string[];
}

export interface ClipboardHistory {
    clips: Clip[];
    categories: ClipCategory[];
    settings: ClipboardSettings;
}

/** "recent" (everything), "pinned", or a category id. */
export type ClipFilter = string;

export interface HistoryQuery {
    category?: ClipFilter;
    query?: string;
    limit?: number;
}

const SERVICE = "luna://org.webosphoenix.clipboard";

declare module "./types" {
    interface LunaApi {
        "luna://org.webosphoenix.clipboard/history": { params: HistoryQuery & { subscribe?: boolean }; result: ClipboardHistory };
        "luna://org.webosphoenix.clipboard/add": {
            params: { text?: string; image?: string; title?: string; source?: string; sensitive?: boolean; kind?: SensitiveKind };
            result: { clip?: Clip; skipped?: string };
        };
        "luna://org.webosphoenix.clipboard/pin": { params: { id: string }; result: { clip: Clip } };
        "luna://org.webosphoenix.clipboard/unpin": { params: { id: string }; result: { clip: Clip } };
        "luna://org.webosphoenix.clipboard/setCategory": { params: { id: string; category: string }; result: { clip: Clip } };
        "luna://org.webosphoenix.clipboard/update": { params: { id: string; text: string }; result: { clip: Clip } };
        "luna://org.webosphoenix.clipboard/delete": { params: { id?: string; ids?: string[] }; result: { deleted: number } };
        "luna://org.webosphoenix.clipboard/clear": { params: { all?: boolean }; result: { deleted: number } };
        "luna://org.webosphoenix.clipboard/paste": { params: { id: string }; result: { clip: Clip } };
        "luna://org.webosphoenix.clipboard/reveal": { params: { id: string; passCode: string }; result: { text: string } };
        "luna://org.webosphoenix.clipboard/addCategory": { params: { name: string }; result: { category: ClipCategory; categories: ClipCategory[] } };
        "luna://org.webosphoenix.clipboard/renameCategory": { params: { id: string; name: string }; result: { category: ClipCategory; categories: ClipCategory[] } };
        "luna://org.webosphoenix.clipboard/deleteCategory": { params: { id: string }; result: { categories: ClipCategory[] } };
        "luna://org.webosphoenix.clipboard/reorderCategories": { params: { ids: string[] }; result: { categories: ClipCategory[] } };
        "luna://org.webosphoenix.clipboard/getSettings": { params: { subscribe?: boolean }; result: { settings: ClipboardSettings } };
        "luna://org.webosphoenix.clipboard/setSettings": { params: Partial<ClipboardSettings>; result: { settings: ClipboardSettings } };
    }
}

const history = (r: ClipboardHistory): ClipboardHistory => ({ clips: r.clips || [], categories: r.categories || [], settings: r.settings });

export const clipboard = {
    async history(q: HistoryQuery = {}): Promise<ClipboardHistory> {
        const r = await call<"luna://org.webosphoenix.clipboard/history">(`${SERVICE}/history`, q);
        return history(r);
    },
    /** history {subscribe}: the clips now and after every change, from any app. */
    watch(q: HistoryQuery, cb: (h: ClipboardHistory) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${SERVICE}/history`, q, (r: LunaResult<"luna://org.webosphoenix.clipboard/history">) => cb(history(r)), onError);
    },
    /** Record a clip by hand (copies are recorded by the runtime). */
    async add(item: { text?: string; image?: string; title?: string; sensitive?: boolean; kind?: SensitiveKind }): Promise<Clip | null> {
        const r = await call<"luna://org.webosphoenix.clipboard/add">(`${SERVICE}/add`, item);
        return r.clip || null;
    },
    async setPinned(id: string, pinned: boolean): Promise<Clip> {
        return (await call(pinned ? `${SERVICE}/pin` : `${SERVICE}/unpin`, { id })).clip;
    },
    async setCategory(id: string, category: string): Promise<Clip> {
        return (await call(`${SERVICE}/setCategory`, { id, category })).clip;
    },
    async update(id: string, text: string): Promise<Clip> {
        return (await call(`${SERVICE}/update`, { id, text })).clip;
    },
    async remove(ids: string | string[]): Promise<number> {
        return (await call(`${SERVICE}/delete`, Array.isArray(ids) ? { ids } : { id: ids })).deleted;
    },
    /** The history; with all, pinned and saved clips too. */
    async clear(all = false): Promise<number> {
        return (await call(`${SERVICE}/clear`, { all })).deleted;
    },
    /** A clip with its text, to paste (not a sensitive one: see reveal). */
    async paste(id: string): Promise<Clip> {
        return (await call(`${SERVICE}/paste`, { id })).clip;
    },
    /** A sensitive clip's text, after the device passcode (rejects when it is wrong). */
    async reveal(id: string, passCode: string): Promise<string> {
        return (await call(`${SERVICE}/reveal`, { id, passCode })).text;
    },
    async addCategory(name: string): Promise<ClipCategory> {
        return (await call(`${SERVICE}/addCategory`, { name })).category;
    },
    async renameCategory(id: string, name: string): Promise<ClipCategory> {
        return (await call(`${SERVICE}/renameCategory`, { id, name })).category;
    },
    async deleteCategory(id: string): Promise<ClipCategory[]> {
        return (await call(`${SERVICE}/deleteCategory`, { id })).categories;
    },
    async reorderCategories(ids: string[]): Promise<ClipCategory[]> {
        return (await call(`${SERVICE}/reorderCategories`, { ids })).categories;
    },
    async settings(): Promise<ClipboardSettings> {
        return (await call(`${SERVICE}/getSettings`, {})).settings;
    },
    watchSettings(cb: (s: ClipboardSettings) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${SERVICE}/getSettings`, {}, (r) => cb(r.settings), onError);
    },
    async setSettings(changes: Partial<ClipboardSettings>): Promise<ClipboardSettings> {
        return (await call(`${SERVICE}/setSettings`, changes)).settings;
    },
};

// ---- Helpers for the views --------------------------------------------------------------

/** A sensitive clip's mask: one dot a character, at most 12. */
export function clipMask(clip: Pick<Clip, "length">): string {
    return "•".repeat(Math.max(4, Math.min(12, clip.length || 8)));
}

/** Where a sensitive clip can go: an otpauth:// link or a TOTP key to the Authenticator, a password to Passwords; a one-time code nowhere. */
export function clipDestination(clip: Pick<Clip, "sensitive" | "kind">): "passwords" | "authenticator" | null {
    if (!clip.sensitive) return null;
    if (clip.kind === "otpauth" || clip.kind === "totp") return "authenticator";
    if (clip.kind === "password" || clip.kind === "secret") return "passwords";
    return null;
}

/** How long ago a clip was copied, in short words ("now", "5 min", "3 h", "2 d"). */
export function clipAge(time: number, now = Date.now()): string {
    const s = Math.max(0, Math.round((now - time) / 1000));
    if (s < 60) return "now";
    if (s < 3600) return `${Math.floor(s / 60)} min`;
    if (s < 86400) return `${Math.floor(s / 3600)} h`;
    return `${Math.floor(s / 86400)} d`;
}
