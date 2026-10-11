// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Search your phone: org.webosphoenix.service.index (services/index), a
// search of the user's own memos, tasks, events, contacts, email,
// messages, files, photos and voice memos by what they mean, with
// EmbeddingGemma 2 on the device. Off until the user turns it on
// (Settings > Assistant > Search your phone). The requests and replies
// are documented in services/index/indexservice.js; the simulator runs the
// same code in the page (runtime/phoenix-runtime.js "Search your phone").

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

const SERVICE = "luna://org.webosphoenix.service.index";

export type IndexSourceId = "memos" | "tasks" | "events" | "contacts" | "email" | "messages" | "files" | "photos" | "voicememos";

export interface IndexSettings {
    enabled: boolean;
    sources: Record<IndexSourceId, boolean>;
    /** Photos and voice memos embedded themselves (the vision and audio encoders), not only by their words. */
    media: boolean;
    /** The Assistant may add what it finds to a model's question about your things. */
    answers: boolean;
}

export interface IndexSourceStatus {
    id: IndexSourceId;
    title: string;
    enabled: boolean;
    /** "image" or "audio": what "Include photos and voice memos" adds. */
    media?: "image" | "audio";
    records: number;
    passages: number;
    bytes: number;
}

export interface IndexModelInfo {
    id: string;
    name: string;
    size: number;
    licence: string;
    source: string;
    installed: boolean;
    downloading: { id: string; received: number; total: number } | null;
}

export type IndexState = "off" | "idle" | "indexing" | "waiting" | "needsModel" | "error";

export interface IndexStatus {
    enabled: boolean;
    settings: IndexSettings;
    state: IndexState;
    progress: { source: string; done: number; embedded: number; backlog: number } | null;
    /** Why it waits: "charging", "battery", "saver". */
    waiting: string;
    error: string;
    lastRun: number;
    sources: IndexSourceStatus[];
    records: number;
    passages: number;
    bytes: number;
    model: { text: IndexModelInfo; media: IndexModelInfo };
    server: { available: boolean; howToInstall: string; error: string };
}

export interface IndexResult {
    source: IndexSourceId;
    sourceTitle: string;
    appId: string;
    /** The source app's icon (a device path). */
    icon: string;
    id: string;
    score: number;
    title: string;
    who: string;
    time: number;
    allDay: boolean;
    place: string;
    /** A photo's or file's path. */
    path: string;
    snippet: string;
    /** "i": found by the picture itself, "a": by the recording. */
    media?: "i" | "a";
    open: { appId: string; params: Record<string, unknown> };
}

type OnError = (e: LunaError) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const c = (method: string, params: object = {}): Promise<Any> => call(`${SERVICE}/${method}`, params);

export const semanticIndex = {
    async status(): Promise<IndexStatus> { return c("getStatus"); },
    watchStatus(cb: (s: IndexStatus) => void, onError?: OnError): Subscription {
        return subscribe(`${SERVICE}/getStatus`, { subscribe: true }, (r: Any) => cb(r as IndexStatus), onError);
    },
    async setSettings(changes: Partial<Omit<IndexSettings, "sources">> & { sources?: Partial<Record<IndexSourceId, boolean>> }): Promise<IndexStatus> {
        return c("setSettings", changes);
    },
    async rebuild(): Promise<IndexStatus> { return c("rebuild"); },
    /** The index deleted from the device, and turned off. */
    async deleteIndex(): Promise<IndexStatus> { return c("deleteIndex"); },
    /** EmbeddingGemma 2 (text), or with media its vision and audio encoders. */
    async downloadModel(media = false): Promise<void> { await c("downloadModel", { media }); },
    async cancelDownload(): Promise<void> { await c("cancelDownload"); },
    async removeModel(media = false): Promise<void> { await c("removeModel", { media }); },
    async search(query: string, options: { sources?: IndexSourceId[]; limit?: number; from?: string[] } = {}): Promise<IndexResult[]> {
        const r = await c("search", { query, ...options });
        return r.results || [];
    },
};
