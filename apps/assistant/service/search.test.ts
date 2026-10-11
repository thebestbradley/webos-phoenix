// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Search your phone through the Assistant (lib/commands-search.js,
// lib/lang/en-search.js), with the index service itself on the stand-in
// device (services/index/test/standin.cjs: the fake embedder, in which a
// furnace and a boiler share a concept): what someone said about
// something, a memo by what it is about, the older commands' layer
// (no email has the words: the index answers), the results as cards with
// their app, opening the item; the index off (the words themselves, and
// how to turn it on); and a question to a model about the user's things,
// which goes with what the index found, with no tools, and its sources
// shown under the answer.

import { describe, expect, it } from "vitest";
import { device, NOW } from "./test/device";

const FURNACE = { _id: "mail-furnace", _kind: "com.palm.email:1", subject: "Your furnace visit", from: { name: "Northside Heating", addr: "jobs@northside.example" },
                  timestamp: NOW - 3 * 86400e3, flags: { read: true, visible: true },
                  parts: [{ type: "body", mimeType: "text/plain", content: "Our engineer will service the radiators on Tuesday between 8 and 10." }] };
const CAKE = { _id: "sms-cake", _kind: "com.palm.smsmessage:1", folder: "inbox", messageText: "The surprise cake for Saturday is ordered", from: { addr: "3035550135" },
               localTimestamp: NOW - 86400e3, threadId: "t-sam", flags: { read: true, visible: true } };
const withIndex = (on = true, extra: object = {}) => {
    const d = device({ seed: (put) => { put(FURNACE); put(CAKE); } });
    d.state.index = { on, ...extra };
    return d;
};

describe("Search your phone", () => {
    it("tells what someone said about something, from their messages only", async () => {
        const d = withIndex();
        const m = await d.ask("what did Sam say about the party");
        expect(m.command).toBe("searchPhone");
        expect(m.text).toBe("Sam Delgado said, yesterday at 10:00 AM: “The surprise cake for Saturday is ordered”");
        expect(m.data.attachments[0].items[0]).toMatchObject({ title: "Sam Delgado", detail: expect.stringContaining("surprise cake"),
                                                               open: { appId: "org.webosphoenix.messaging", params: { threadId: "t-sam" } } });
        // Only Sam's: Priya's lunch message is not about a party anyway, and the email is not his.
        expect(m.data.attachments[0].items).toHaveLength(1);
    });

    it("finds a memo by what it is about, and opens it", async () => {
        const d = withIndex();
        const m = await d.ask("where's that note about the internet password");
        expect(m.text).toBe("Here's the memo about “internet password”: “Wi-Fi at the cabin: network Lakeview”.");
        const card = m.data.attachments[0].items[0];
        expect(card.open).toMatchObject({ appId: "com.palm.app.notes", params: { memoId: "memo-1" }, title: "Memos" });
        await d.choose(m, "show:0");
        expect(d.state.launched.at(-1)).toMatchObject({ id: "com.palm.app.notes", params: { memoId: "memo-1" } });
        // It: the memo it found.
        expect((await d.ask("what does it say")).text).toContain("Lakeview");
    });

    it("answers for the commands that look for words, when none has them", async () => {
        const d = withIndex();
        const m = await d.ask("find the email about the boiler");
        expect(m.command).toBe("searchEmail");
        expect(m.text).toBe("No emails have those words, but this one is about “boiler”. Here's the email about “boiler”: “Your furnace visit”.");
        expect(m.data.attachments[0].items[0]).toMatchObject({ title: "Your furnace visit", subtitle: expect.stringContaining("Northside Heating"),
                                                               open: { appId: "com.palm.app.email", params: { emailId: "mail-furnace" } } });
        // With the words: as it always was.
        expect((await d.ask("find the email about the invoice")).text).toBe("One email about “invoice”: “Invoice 2231” from Alex Rivera.");
    });

    it("looks everywhere, and says what each thing is", async () => {
        const d = withIndex();
        const m = await d.ask("find anything about the heating");
        expect(m.text).toMatch(/^About “heating”, I found an email “Your furnace visit” from Northside Heating/);
    });

    it("with the index off, looks for the words themselves and says how to search by meaning", async () => {
        const d = withIndex(false);
        const m = await d.ask("find anything about the boiler");
        expect(m.text).toBe("To find things by what they mean, not only their words, turn on Search your phone in Settings > Assistant.");
        expect(m.choices?.map((c) => c.label)).toContain("Search Settings");
        const said = await d.ask("what did Sam say about running late");
        expect(said.text).toMatch(/^Sam Delgado said, today at 9:50 AM: “Running 5 min late” To find things by what they mean/);
        // An older command answers as it did, the index not asked to.
        expect((await d.ask("find the email about the boiler")).text).toBe("I found no email about “boiler”.");
    });

    it("gives a model's answer about the user's things what the index found, with no tools, and shows where it came from", async () => {
        const bodies: any[] = [];
        const llm = { status: () => Promise.resolve({ available: true, installed: [{ id: "qwen3-0.6b-q8_0" }] }), ensure: () => Promise.resolve({ baseUrl: "http://127.0.0.1:9/v1" }) };
        const llmRequest = (r: { body: string }) => {
            const b = JSON.parse(r.body);
            bodies.push(b);
            const choosing = !!b.response_format;
            const content = choosing ? JSON.stringify({ command: "none" }) : "The password is on the fridge at the cabin.";
            return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }) });
        };
        const d = device({ llm, llmRequest, settings: { followUps: false } });
        d.state.index = { on: true };
        const m = await d.ask("what's my wifi password at the cabin");
        expect(m.text).toBe("The password is on the fridge at the cabin.");
        const words = bodies.find((b) => !b.response_format);
        const prompt = JSON.stringify(words.messages);
        expect(prompt).toContain("From the user's own phone");
        expect(prompt).toContain("Wi-Fi at the cabin: network Lakeview");
        expect(words.tools).toBeUndefined();
        expect(m.data.fromPhone).toBe(true);
        expect(m.data.attachments[0].items[0]).toMatchObject({ title: "Wi-Fi at the cabin: network Lakeview", open: { appId: "com.palm.app.notes" } });
        // "Use in answers" off: nothing goes with the question.
        bodies.length = 0;
        const e = device({ llm, llmRequest, settings: { followUps: false } });
        e.state.index = { on: true, answers: false };
        await e.ask("what's my wifi password at the cabin");
        expect(JSON.stringify(bodies.find((b) => !b.response_format).messages)).not.toContain("From the user's own phone");
    });
});
