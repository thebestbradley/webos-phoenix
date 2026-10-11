// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Export Conversation (the app menu): a conversation as JSON and as text,
// for the owner's test sessions (docs/AI-AND-MCP.md "Evaluation"): each
// request and reply, which path answered (the grammar, the on-device
// model, the decision model, a cloud model, or "nothing here can"), the
// command chosen with its arguments, its status, and the time each step
// took (the service's message trace). Shared with the share sheet, or
// saved through the save picker.

import type { AssistantMessage, AssistantSettings, AssistantThread } from "@phoenix/luna";

export interface ExportedConversation {
    format: "phoenix-assistant-conversation";
    version: 1;
    exported: string;
    thread: { id: string; title: string; created: number; provider: string };
    settings: Partial<AssistantSettings>;
    messages: {
        time: string; role: "user" | "assistant"; text: string; path?: string; via?: string; source?: string;
        command?: string; status?: string; args?: Record<string, unknown>; ms?: number;
        steps?: { step: string; ms: number; tokens?: number; choice?: string; command?: string; confidence?: number }[];
        choices?: string[]; chosen?: string; followUp?: string; kind?: string;
    }[];
}

// What helps read a session back, never a key or the like (Settings has no
// secrets here: the providers' keys never leave the service).
const SETTINGS_KEPT: (keyof AssistantSettings)[] = ["language", "localModel", "personality", "speak", "voiceReplies", "wakeWord",
                                                   "followUps", "allowCloudControl", "defaultProvider", "disabledCommands", "decider"];

export function exportConversation(thread: AssistantThread, messages: AssistantMessage[], settings: AssistantSettings | null, now = Date.now()): ExportedConversation {
    const kept: Partial<AssistantSettings> = {};
    if (settings) for (const k of SETTINGS_KEPT) if (settings[k] !== undefined) (kept as Record<string, unknown>)[k] = settings[k];
    return {
        format: "phoenix-assistant-conversation",
        version: 1,
        exported: new Date(now).toISOString(),
        thread: { id: thread.id, title: thread.title, created: thread.created, provider: thread.provider || "" },
        settings: kept,
        messages: messages.map((m) => {
            const kind = (m as AssistantMessage & { kind?: string }).kind;
            const out: ExportedConversation["messages"][number] = { time: new Date(m.time).toISOString(), role: m.role, text: m.text };
            if (m.trace?.path) out.path = m.trace.path;
            if (m.via) out.via = m.via;
            if (m.source) out.source = m.source;
            if (m.command) out.command = m.command;
            if (m.status) out.status = m.status;
            const args = m.confirm?.args ?? m.trace?.args;
            if (args) out.args = args;
            if (m.trace) out.ms = m.trace.ms;
            if (m.trace?.steps?.length) out.steps = m.trace.steps;
            if (m.choices?.length) out.choices = m.choices.map((c) => c.label);
            if (m.chosen) out.chosen = m.chosen;
            if (m.followUp) out.followUp = m.followUp.kind;
            if (kind) out.kind = kind;
            return out;
        }),
    };
}

function clock(iso: string) { return iso.slice(11, 19); }

/** The same as text: one block per message, readable in a mail or a bug report. */
export function conversationText(e: ExportedConversation): string {
    const lines = [`Assistant conversation "${e.thread.title || "(untitled)"}", exported ${e.exported}`,
                   `Settings: ${JSON.stringify(e.settings)}`, ""];
    for (const m of e.messages) {
        if (m.role === "user") { lines.push(`[${clock(m.time)}] You: ${m.text}`); continue; }
        const how = [m.path ?? m.via, m.source, m.command && `${m.command}${m.status ? "/" + m.status : ""}`, m.ms !== undefined && `${m.ms} ms`]
            .filter(Boolean).join(", ");
        lines.push(`[${clock(m.time)}] Assistant${how ? ` (${how})` : ""}: ${m.text}`);
        if (m.args) lines.push(`    arguments: ${JSON.stringify(m.args)}`);
        if (m.steps?.length) lines.push(`    steps: ${m.steps.map((s) => `${s.step}${s.choice ? " " + s.choice : ""} ${s.ms} ms${s.tokens !== undefined ? " " + s.tokens + " tokens" : ""}`).join("; ")}`);
        if (m.choices?.length) lines.push(`    choices: ${m.choices.join(" | ")}${m.chosen ? ` (chose ${m.chosen})` : ""}`);
    }
    return lines.join("\n") + "\n";
}

/** A file name for it: assistant-2026-10-11-1405. */
export function exportName(e: ExportedConversation, ext: "json" | "txt"): string {
    return `assistant-${e.exported.slice(0, 16).replace(/[T:]/g, "-")}.${ext}`;
}

/** base64 of UTF-8 text (the save picker takes a file's bytes as base64). */
export function base64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}
