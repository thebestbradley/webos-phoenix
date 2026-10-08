// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.assistant: the Phoenix Assistant (docs/M6-PLAN.md F3).
// Conversations ("threads"), the router between the command grammar, the
// on-device model and cloud models, settings, providers and on-device
// models. The service is apps/assistant/service (assistant.js documents
// every request); the simulator runs that code in the page
// (runtime/phoenix-runtime.js, block "The Phoenix Assistant").
//
// org.webosphoenix.tts: text to speech for any app.

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

const SERVICE = "luna://org.webosphoenix.assistant";

export const ASSISTANT_APP_ID = "org.webosphoenix.assistant";

/** errorCode values of org.webosphoenix.assistant. */
export const ASSISTANT_ERRORS = { BAD_PARAMS: -1, NOT_FOUND: -2, NOT_ALLOWED: -3, OFF: -4, FAILED: -5 } as const;

/** Which layer answered: the grammar, the on-device model, or a cloud model. */
export type AssistantVia = "commands" | "on-device" | "cloud";

export interface AssistantChoice {
    /** "cloud:<provider id>", "web" or "settings". */
    id: string;
    label: string;
}

export interface AssistantMessage {
    id: string;
    threadId: string;
    role: "user" | "assistant";
    text: string;
    time: number;
    via?: AssistantVia;
    /** The model that answered ("Anthropic (claude-sonnet-5-5)", "Qwen2.5 0.5B Instruct"). */
    source?: string;
    /** The command it ran or wants to run. */
    command?: string;
    /** "pending": waits for confirm (it sends, deletes or calls). */
    status?: "pending" | "done" | "cancelled" | "failed";
    confirm?: { command: string; args: Record<string, unknown> };
    /** Nothing on the phone could answer: what the user may do next. */
    choices?: AssistantChoice[];
    /** The choice taken. */
    chosen?: string;
    data?: Record<string, unknown>;
}

export interface AssistantThread {
    id: string;
    /** The first thing asked. */
    title: string;
    created: number;
    updated: number;
    /** The cloud provider the conversation went on with, or "". */
    provider: string;
    count: number;
    /** The last message's words. */
    last: string;
}

export interface AssistantSettings {
    enabled: boolean;
    speak: boolean;
    language: string;
    units: "metric" | "imperial" | "auto";
    /** The on-device model in use (an id from models()), or "". */
    localModel: string;
    defaultProvider: string;
    /** Cloud models may run commands (off by default). */
    allowCloudControl: boolean;
    disabledCommands: string[];
    /** Answers to spoken requests spoken (on by default). */
    voiceReplies: boolean;
    /** The shell listens for "Hey Phoenix" (off by default). */
    wakeWord: boolean;
    /** ... also while the screen is off or locked (off by default). */
    wakeWhenLocked: boolean;
}

export interface AssistantCommand {
    id: string;
    title: string;
    risk: "read" | "open" | "change" | "send" | "delete" | "call";
    builtIn: boolean;
    appId: string;
    enabled: boolean;
    /** Read back and confirmed before it runs. */
    confirms: boolean;
}

export type ProviderType = "anthropic" | "openai" | "gemini" | "compatible";

export interface AssistantProvider {
    id: string;
    type: ProviderType;
    name: string;
    model: string;
    baseUrl: string;
    hasKey: boolean;
    /** The key's last four characters ("" if short): all a page ever sees of it. */
    keyHint: string;
    /** "Anthropic (claude-sonnet-5-5)". */
    label: string;
}

export interface ProviderTypeInfo {
    label: string;
    base: string;
    needsKey: boolean;
    /** The suggested model, and others to pick from (the user may type any). */
    model: string;
    models: string[];
}

export interface LocalModel {
    id: string;
    name: string;
    params: string;
    licence: string;
    /** Its Hugging Face repository. */
    source: string;
    /** Bytes to download. */
    size: number;
    /** Device memory it wants (bytes). */
    ram: number;
    note: string;
    fits: boolean;
    recommended: boolean;
    installed: boolean;
    downloading: { received: number; total: number } | null;
}

export interface LocalModelStatus {
    /** llama.cpp's llama-server is there to run a model. */
    available: boolean;
    running: boolean;
    server: string;
    error: string;
    ramBytes: number;
    /** How to get llama-server, when it is missing. */
    howToInstall: string;
}

export interface AskResult {
    thread: AssistantThread;
    /** What this request added: the user's words and the answers. */
    messages: AssistantMessage[];
}

type OnError = (e: LunaError) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const c = (method: string, params: object = {}): Promise<Any> => call(`${SERVICE}/${method}`, params);
const s = (method: string, params: object, cb: (r: Any) => void, onError?: OnError): Subscription =>
    subscribe(`${SERVICE}/${method}`, { ...params, subscribe: true }, cb, onError);

export const assistant = {
    /** Ask: in the thread in use (or threadId, or a new one). */
    async ask(text: string, options: { threadId?: string; newThread?: boolean; speak?: boolean; voice?: boolean; locked?: boolean } = {}): Promise<AskResult> {
        const r = await c("ask", { text, ...options });
        return { thread: r.thread, messages: r.messages };
    },
    /** Take one of a message's choices ("Ask ...", "Search the web"). */
    async choose(threadId: string, messageId: string, choice: string): Promise<AskResult> {
        const r = await c("choose", { threadId, messageId, choice });
        return { thread: r.thread, messages: r.messages };
    },
    /** Answer a read-back: run it (accept) or not. */
    async confirm(threadId: string, messageId: string, accept: boolean): Promise<AskResult> {
        const r = await c("confirm", { threadId, messageId, accept });
        return { thread: r.thread, messages: r.messages };
    },
    watchThreads(cb: (threads: AssistantThread[], current: string) => void, onError?: OnError): Subscription {
        return s("threads", {}, (r) => cb(r.threads || [], r.current || ""), onError);
    },
    async threads(): Promise<{ threads: AssistantThread[]; current: string }> {
        const r = await c("threads");
        return { threads: r.threads || [], current: r.current || "" };
    },
    /** A thread with its messages (the one in use without an id; null if there is none). */
    watchThread(id: string | undefined, cb: (thread: AssistantThread | null, messages: AssistantMessage[]) => void, onError?: OnError): Subscription {
        return s("thread", id ? { id } : {}, (r) => cb(r.thread || null, r.messages || []), onError);
    },
    async thread(id?: string): Promise<{ thread: AssistantThread | null; messages: AssistantMessage[] }> {
        const r = await c("thread", id ? { id } : {});
        return { thread: r.thread || null, messages: r.messages || [] };
    },
    async newThread(): Promise<AssistantThread> { return (await c("newThread")).thread; },
    async setCurrent(id: string): Promise<void> { await c("setCurrent", { id }); },
    async deleteThread(id: string): Promise<void> { await c("deleteThread", { id }); },
    async clearHistory(): Promise<number> { return (await c("clearHistory")).deleted; },

    watchSettings(cb: (s: AssistantSettings) => void, onError?: OnError): Subscription {
        return s("getSettings", {}, (r) => cb(r.settings), onError);
    },
    async settings(): Promise<AssistantSettings> { return (await c("getSettings")).settings; },
    async setSettings(changes: Partial<AssistantSettings>): Promise<AssistantSettings> { return (await c("setSettings", changes)).settings; },

    watchCommands(cb: (commands: AssistantCommand[]) => void, onError?: OnError): Subscription {
        return s("commands", {}, (r) => cb(r.commands || []), onError);
    },

    watchProviders(cb: (r: { providers: AssistantProvider[]; defaultProvider: string; types: Record<ProviderType, ProviderTypeInfo> }) => void,
                   onError?: OnError): Subscription {
        return s("providers", {}, (r) => cb({ providers: r.providers || [], defaultProvider: r.defaultProvider || "", types: r.types }), onError);
    },
    /** Add (no id) or change a provider; key: only when given ("" keeps the old one). Settings only. */
    async setProvider(p: { id?: string; type?: ProviderType; name?: string; model?: string; baseUrl?: string; key?: string }): Promise<AssistantProvider> {
        return (await c("setProvider", p)).provider;
    },
    async removeProvider(id: string): Promise<void> { await c("removeProvider", { id }); },
    /** One short request: {ok, text} or {ok: false, error}. */
    async testProvider(p: { id?: string; type?: ProviderType; model?: string; baseUrl?: string; key?: string }): Promise<{ ok: boolean; text?: string; error?: string }> {
        const r = await c("testProvider", p);
        return { ok: !!r.ok, text: r.text, error: r.error };
    },
    async listModels(p: { id?: string; type?: ProviderType; baseUrl?: string; key?: string }): Promise<{ models?: string[]; error?: string }> {
        const r = await c("listModels", p);
        return r.ok === false ? { error: r.error } : { models: r.models || [] };
    },

    watchModels(cb: (r: { models: LocalModel[]; selected: string; status: LocalModelStatus }) => void, onError?: OnError): Subscription {
        return s("models", {}, (r) => cb({ models: r.models || [], selected: r.selected || "", status: r.status }), onError);
    },
    async models(): Promise<{ models: LocalModel[]; selected: string; status: LocalModelStatus }> {
        const r = await c("models");
        return { models: r.models || [], selected: r.selected || "", status: r.status };
    },
    async downloadModel(id: string): Promise<void> { await c("downloadModel", { id }); },
    async cancelDownload(id: string): Promise<void> { await c("cancelDownload", { id }); },
    async removeModel(id: string): Promise<void> { await c("removeModel", { id }); },
    async selectModel(id: string): Promise<void> { await c("selectModel", { id }); },
};

export const tts = {
    /** Say it with the device's voice (org.webosphoenix.tts). */
    async speak(text: string, lang?: string): Promise<void> { await call("luna://org.webosphoenix.tts/speak", { text, ...(lang ? { lang } : {}) }); },
    async stop(): Promise<void> { await call("luna://org.webosphoenix.tts/stop", {}); },
    async status(): Promise<{ available: boolean; engine: string }> {
        const r: Any = await call("luna://org.webosphoenix.tts/getStatus", {});
        return { available: !!r.available, engine: r.engine || "" };
    },
};

/** "1.1 GB", "491 MB". */
export function formatBytes(n: number): string {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
    if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
    return `${Math.max(1, Math.round(n / 1e3))} KB`;
}
