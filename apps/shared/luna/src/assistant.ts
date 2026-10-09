// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.assistant: the Assistant (docs/M6-PLAN.md F3).
// Conversations ("threads"), the router between the command grammar, the
// on-device model and cloud models, settings, providers and on-device
// models. The service is apps/assistant/service (assistant.js documents
// every request); the simulator runs that code in the page
// (runtime/phoenix-runtime.js, block "The Assistant").
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
    /** "cloud:<provider id>", "web", "open", "connect" (no model yet: ask which kind, then connect()) or "settings" (older messages). */
    id: string;
    label: string;
}

/** What "Connect model" sets up: an on-device model, a cloud one, or both (on-device first). */
export type ConnectMode = "local" | "cloud" | "both";

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
    /** A follow-up question about what a command just made; its choices
     *  ("fu:<n>", "fu:skip") are the answers, and so are the next words. */
    followUp?: { id: string; kind: FollowUpKind | "doubt" };
}

/** What a follow-up question asks for. */
export type FollowUpKind = "location" | "invitees" | "duration" | "alert" | "due" | "list" | "repeat" | "label" | "email" | "phone";

/** A follow-up question waiting (followUps()): in a conversation ("open"),
 *  for later ("queued") or shown as a notification ("delivered"). */
export interface FollowUp {
    id: string;
    kind: FollowUpKind;
    /** Whether this kind of question helps (asked after several Skips): Keep asking / Stop asking. */
    meta: boolean;
    /** The question as a notification asks it ("Where is “Dentist” (Friday at 3:00 PM)?"). */
    question: string;
    item: { type: "event" | "reminder" | "task" | "alarm" | "contact"; id: string; title: string; at: number | null };
    state: "open" | "queued" | "delivered";
    /** Notifications shown so far. */
    attempts: number;
    /** When it is next looked at (ms). */
    nextAt: number;
    threadId: string;
    choices: AssistantChoice[];
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
    /** Follow-up questions sent here later and not yet seen. */
    unread?: number;
    /** The on-device model at work on it: starting, then thinking, until the deadline (ms). */
    working?: { stage: "starting" | "thinking"; since: number; until: number };
}

export interface AssistantSettings {
    enabled: boolean;
    speak: boolean;
    language: string;
    units: "metric" | "imperial" | "auto";
    /** The on-device model chosen (an id from models()); "" the built-in one, "off" none. */
    localModel: string;
    /** The voice answers are spoken with (one of tts.status().voices), "" the default. */
    speechVoice: string;
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
    /** Questions after something is made, and later as notifications (on by default). */
    followUps: boolean;
    /** No follow-up notifications between these ("22:00" to "08:00" by default). */
    quietStart: string;
    quietEnd: string;
    /** Minutes until a question left unanswered comes back as a notification: 15, 60 (default) or 180. */
    followUpFirst: number;
    /** Minutes until it comes once more: 0 (not again), 60, 240 (default) or 1440 (the next day). */
    followUpAgain: number;
    /** Follow-up topics turned off (Settings, or "Stop asking" when it asked whether they help). */
    followUpTopicsOff: FollowUpKind[];
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
    /** Comes with the system (Qwen3 0.6B): in use until another is chosen, never removed. */
    builtIn?: boolean;
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

/** One thing the voice needs (voice): whether this device has it, and how to get it. */
export interface VoicePart {
    id: "recognition" | "wakeWord" | "speech";
    name: string;
    available: boolean;
    /** "whisper.cpp", "espeak-ng", "say", ... */
    engine: string;
    /** One line on how to get it, when it is missing. */
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
    /** "Connect model": Settings > Assistant sets one up ("" asks which); the question before messageId waits for retry(). */
    async connect(options: { threadId?: string; messageId?: string; mode?: ConnectMode } = {}): Promise<void> {
        await c("connect", options);
    },
    /** The question that waited for a model (connect), asked again; no messages if none waits. */
    async retry(threadId: string): Promise<AskResult> {
        const r = await c("retry", { threadId });
        return { thread: r.thread, messages: r.messages || [] };
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

    /** The follow-up questions waiting, and the topics turned off. */
    watchFollowUps(cb: (r: { followUps: FollowUp[]; topicsOff: FollowUpKind[] }) => void, onError?: OnError): Subscription {
        return s("followUps", {}, (r) => cb({ followUps: r.followUps || [], topicsOff: r.topicsOff || [] }), onError);
    },
    /** A conversation read: its unread follow-ups counted no more. */
    async markRead(id: string): Promise<void> { await c("markRead", { id }); },
    /** A notification tapped: the question asked again in its conversation. */
    async openFollowUp(id: string): Promise<AskResult> {
        const r = await c("followUpOpen", { id });
        return { thread: r.thread, messages: r.messages || [] };
    },
    /** Answer one without the conversation ("fu:<n>" or "fu:skip"): what changed, said. */
    async answerFollowUp(id: string, action: string): Promise<string> { return (await c("answerFollowUp", { id, action })).text || ""; },
    /** The assistant closed: the question it was asking waits for later. */
    async leaveFollowUps(threadId?: string): Promise<void> { await c("followUpLeave", threadId ? { threadId } : {}); },
    /** Forget the Skips counted. */
    async resetFollowUps(): Promise<void> { await c("resetFollowUps"); },

    /** What the voice needs and what this device is missing ([] where nobody knows, e.g. a browser). */
    async voice(): Promise<VoicePart[]> { return (await c("voice")).parts || []; },

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
    async speak(text: string, lang?: string, voice?: string): Promise<void> {
        await call("luna://org.webosphoenix.tts/speak", { text, ...(lang ? { lang } : {}), ...(voice ? { voice } : {}) });
    },
    async stop(): Promise<void> { await call("luna://org.webosphoenix.tts/stop", {}); },
    /** voices: the engine's (Kitten TTS's expr-voice-3-f, ...), [] when it has no choice. */
    async status(): Promise<{ available: boolean; engine: string; voices: string[] }> {
        const r: Any = await call("luna://org.webosphoenix.tts/getStatus", {});
        return { available: !!r.available, engine: r.engine || "", voices: Array.isArray(r.voices) ? r.voices : [] };
    },
};

/** "1.1 GB", "491 MB". */
export function formatBytes(n: number): string {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
    if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
    return `${Math.max(1, Math.round(n / 1e3))} KB`;
}
