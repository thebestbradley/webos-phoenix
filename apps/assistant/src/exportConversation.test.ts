// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AssistantMessage, AssistantSettings, AssistantThread } from "@phoenix/luna";
import { base64, conversationText, exportConversation, exportName } from "./exportConversation";

const T0 = Date.UTC(2026, 9, 11, 14, 5, 0);
const thread: AssistantThread = { id: "t1", title: "set an alarm for 7am", created: T0, updated: T0, provider: "", count: 4, last: "" };
const messages: AssistantMessage[] = [
    { id: "m1", threadId: "t1", role: "user", text: "set an alarm for 7am", time: T0 },
    { id: "m2", threadId: "t1", role: "assistant", text: "Alarm set for 7:00 AM tomorrow.", time: T0 + 20, via: "commands", command: "alarm", status: "done",
      trace: { path: "grammar", command: "alarm", args: { time: T0 + 3600e3, label: "" }, ms: 18 } },
    { id: "m3", threadId: "t1", role: "user", text: "kill the lights", time: T0 + 60e3 },
    { id: "m4", threadId: "t1", role: "assistant", text: "I'm not sure how to help with that yet.", time: T0 + 62e3, via: "on-device", source: "Qwen3 0.6B",
      choices: [{ id: "web", label: "Search the web" }], trace: { path: "on-device", ms: 2100, steps: [{ step: "pick", ms: 900, tokens: 6, choice: "none" }, { step: "answer", ms: 1200, tokens: 40 }] } },
];
const settings = { language: "en", localModel: "", personality: "friendly", speak: false, voiceReplies: true, wakeWord: true, followUps: true,
                   allowCloudControl: false, defaultProvider: "", disabledCommands: [], decider: "off" } as unknown as AssistantSettings;

describe("Export Conversation", () => {
    it("keeps each message's path, command, arguments and timings, and no secrets", () => {
        const e = exportConversation(thread, messages, settings, T0 + 120e3);
        expect(e.format).toBe("phoenix-assistant-conversation");
        expect(e.messages[1]).toMatchObject({ role: "assistant", path: "grammar", command: "alarm", status: "done", args: { label: "" }, ms: 18 });
        expect(e.messages[3]).toMatchObject({ path: "on-device", source: "Qwen3 0.6B", choices: ["Search the web"], steps: [{ step: "pick", choice: "none" }, { step: "answer" }] });
        expect(Object.keys(e.settings).sort()).toEqual(["allowCloudControl", "decider", "defaultProvider", "disabledCommands", "followUps", "language", "localModel", "personality", "speak", "voiceReplies", "wakeWord"]);
        expect(exportName(e, "json")).toBe("assistant-2026-10-11-14-07.json");
    });
    it("reads as text, and encodes for the save picker", () => {
        const text = conversationText(exportConversation(thread, messages, settings, T0));
        expect(text).toContain("You: set an alarm for 7am");
        expect(text).toContain("Assistant (grammar, alarm/done, 18 ms): Alarm set for 7:00 AM tomorrow.");
        expect(text).toContain("steps: pick none 900 ms 6 tokens; answer 1200 ms 40 tokens");
        expect(atob(base64("Café ✓"))).toBe(unescape(encodeURIComponent("Café ✓")));
    });
});
