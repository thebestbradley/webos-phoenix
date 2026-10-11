// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The talk around the commands (lib/lang/en-talk.js, lib/grammar.js,
// assistant.js route), from the owner's tests in the simulator (10 October
// 2026) and the evaluation (apps/assistant/eval/cases.json): small talk,
// "don't", several requests in one, typos, the previous turn, which
// contact, an address said alone, and what the model is shown.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { device, at, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(t: string, c: object): { command: string; args: any; normalized?: string } | null };
const names = ["Sam", "Sam Delgado", "Mom", "Priya", "Priya Nair", "Chris Park", "Chris Moore", "Chris"];
const parse = (t: string) => grammar.parse(t, { now: NOW, names });

const CHRISES = (put: (o: any) => string) => {
    put({ _id: "p-chris1", _kind: "com.palm.person:1", name: { givenName: "Chris", familyName: "Park" }, phoneNumbers: [{ value: "(303) 555-0111", type: "type_mobile" }], emails: [] });
    put({ _id: "p-chris2", _kind: "com.palm.person:1", name: { givenName: "Chris", familyName: "Moore" }, phoneNumbers: [{ value: "(303) 555-0122", type: "type_mobile" }], emails: [] });
};

describe("small talk and help, in the grammar", () => {
    it("answers greetings, thanks and 'can you hear me' itself, never 'I can't do that'", () => {
        expect(parse("Hello, can you hear me?")).toEqual({ command: "chat", args: { kind: "hear" } });
        expect(parse("What's up?")).toEqual({ command: "chat", args: { kind: "howAreYou" } });
        expect(parse("Talk to me.")).toEqual({ command: "chat", args: { kind: "talk" } });
        expect(parse("thank you")).toEqual({ command: "chat", args: { kind: "thanks" } });
        expect(parse("I just gave it to you in the previous message. are you not reading my messages?")).toEqual({ command: "chat", args: { kind: "missed" } });
    });
    it("takes 'what all can you do', 'more suggestions' as help", () => {
        for (const t of ["What all can you do?", "more suggestions", "what else can you do", "help"]) expect(parse(t)?.command, t).toBe("help");
    });
    it("replies in words, with no command done", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        const m = await d.ask("Hello, can you hear me?");
        expect(m.text).toMatch(/hear you|listening|loud and clear/i);
        expect(m.kind).toBeUndefined();
    });
});

describe("don't", () => {
    it("parses what not to do, and does none of it", async () => {
        expect(parse("don't turn on wifi")).toMatchObject({ command: "negated", args: { command: "toggle", args: { setting: "wifi", state: "on" } } });
        expect(parse("dont let me forget to water the plants at 8")?.command).toBe("reminder");
        expect(parse("i don't want the flashlight on")).toEqual({ command: "toggle", args: { setting: "flashlight", state: "off" } });
        const d = device({ settings: { followUps: false, localModel: "off" } });
        const m = await d.ask("don't turn on wifi");
        expect(m.text).toBe("OK, I won't turn Wi-Fi on.");
        expect(d.called("wifi/setstate")).toEqual([]);
    });
    it("cancels the read-back it names", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        expect((await d.ask("text Sam I'm late")).status).toBe("pending");
        const m = await d.ask("no don't send that");
        expect(m).toMatchObject({ status: "cancelled", command: "text" });
        expect(d.called("putMessage")).toEqual([]);
    });
});

describe("several requests in one", () => {
    it("splits where each side is a request of its own", () => {
        expect(parse("turn off wifi and set an alarm for 6")?.args.parts.map((p: any) => p.command)).toEqual(["toggle", "alarm"]);
        expect(parse("turn off wifi and bluetooth")?.args.parts.map((p: any) => p.args.setting)).toEqual(["wifi", "bluetooth"]);
        expect(parse("set two timers one for 5 minutes and one for 10 minutes")?.args.parts.map((p: any) => p.args.seconds)).toEqual([300, 600]);
        expect(parse("text sam I am late and call mom")?.args.parts.map((p: any) => p.command)).toEqual(["text", "call"]);
    });
    it("keeps one request whole when the rest is no request of its own", () => {
        expect(parse("add eggs and bread to my grocery list")?.command).toBe("task");
        expect(parse("remind me to buy eggs and call the plumber")?.command).toBe("reminder");
        expect(parse("call sam and tell him i'm on my way")?.command).toBe("call");
    });
    it("does each, in turn", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        const list = await d.askAll("turn on do not disturb and set an alarm for 7am");
        expect(list.filter((m) => m.role === "assistant").map((m) => [m.command, m.status])).toEqual([["toggle", "done"], ["alarm", "done"]]);
    });
});

describe("typos and transcripts", () => {
    it("reads them on a second try, never a contact's name or an English word", () => {
        expect(parse("turn of wifi")).toMatchObject({ command: "toggle", args: { state: "off" }, normalized: "turn off wifi" });
        expect(parse("set an alrm for 7am")?.command).toBe("alarm");
        expect(parse("whats the wether tomorrow")).toMatchObject({ command: "weather", args: { day: "tomorrow" } });
        expect(parse("Calli Phoenix.")).toMatchObject({ command: "call", args: { who: "phoenix" } });
        expect(parse("kill time")).toBeNull();
        expect(parse("I need to talk to Sam")).toBeNull();
    });
    it("cleans fillers and spoken times", () => {
        expect(parse("um set an alarm for uh 7")?.command).toBe("alarm");
        expect(parse("set an alarm for seven a m")).toMatchObject({ command: "alarm", args: { time: at(8, 7) } });
        expect(parse("remind me to call mom at six p m")).toMatchObject({ command: "reminder", args: { text: "call mom", due: at(7, 18) } });
    });
});

describe("the previous turn", () => {
    it("'make it 8 instead' moves the alarm just made, not a second one", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        await d.ask("set an alarm for 7am");
        const m = await d.ask("make it 8 instead");
        expect(m).toMatchObject({ command: "alarm", status: "done" });
        const mine = d.of("com.palm.clock.alarm:1").filter((a) => a._id !== "alarm-7" && a._id !== "alarm-630");
        expect(mine.map((a) => [a.hour, a.minute])).toEqual([[8, 0]]);
    });
    it("'and tomorrow?', 'what about in London', 'turn it off', 'more'", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        await d.ask("what's the weather in Paris");
        expect((await d.askAll("and tomorrow?")).find((m) => m.command === "weather")?.trace?.args).toMatchObject({ place: "paris", day: "tomorrow" });
        await d.ask("turn on the flashlight");
        expect((await d.ask("turn it off")).trace?.args).toMatchObject({ setting: "flashlight", state: "off" });
        await d.ask("turn up the volume");
        expect((await d.ask("more")).trace?.args).toMatchObject({ action: "up" });
    });
    it("'actually text her instead saying ...' cancels the call waiting", async () => {
        const d = device({ seed: (put) => { put({ _id: "p-mom", _kind: "com.palm.person:1", name: { givenName: "Mom" }, phoneNumbers: [{ value: "(303) 555-0101", type: "type_mobile" }] }); },
                           settings: { followUps: false, localModel: "off" } });
        const call = await d.ask("call mom");
        expect(call.status).toBe("pending");
        const m = await d.ask("actually text her instead saying I'll call later");
        expect(m).toMatchObject({ command: "text", status: "pending", confirm: { args: { name: "Mom", message: "I'll call later" } } });
    });
});

describe("which one", () => {
    it("asks which contact when two share the name, and the answer picks", async () => {
        const d = device({ seed: CHRISES, settings: { followUps: false, localModel: "off" } });
        const q = await d.ask("call Chris");
        expect(q).toMatchObject({ status: "ask", text: "Which one: Chris Park or Chris Moore?" });
        expect(q.choices?.map((c) => c.label)).toEqual(["Chris Park", "Chris Moore"]);
        expect(await d.ask("the second one")).toMatchObject({ command: "call", status: "pending", confirm: { args: { name: "Chris Moore" } } });
    });
    it("asks what to say to someone, and takes the next words", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        expect(await d.ask("text sam")).toMatchObject({ status: "ask", text: "What should I say to Sam Delgado?" });
        expect(await d.ask("running late, be there soon")).toMatchObject({ command: "text", status: "pending", confirm: { args: { message: "Running late, be there soon" } } });
    });
    it("asks the time of a meeting said with a day only, and keeps the day", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        expect(await d.ask("add a meeting tomorrow")).toMatchObject({ status: "ask", text: "What time is “Meeting”?" });
        await d.ask("at 3");
        const ev = d.of("com.palm.calendarevent:1").find((e) => e.subject === "Meeting");
        expect(ev.dtstart).toBe(at(8, 15));
    });
});

describe("the owner's contact (10 October 2026)", () => {
    it("makes a card from a name alone, and an address said next goes on it: never an email sent", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        expect(await d.ask("I need to create a contact card for Megan E Weaver")).toMatchObject({ command: "contactAdd", status: "done" });
        const m = await d.ask("megweaver@icloud.com");
        expect(m).toMatchObject({ command: "contactAdd", status: "done" });
        expect(d.called("smtp")).toEqual([]);
        const people = d.of("com.palm.person:1").filter((p) => p.name.familyName === "Weaver");
        expect(people).toHaveLength(1);
        expect(people[0].emails.map((e: any) => e.value)).toEqual(["megweaver@icloud.com"]);
    });
    it("adds a number to the card there instead of a second card, and says what it has", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        await d.ask("add a contact Megan E Weaver with email megweaver@icloud.com");
        const m = await d.ask("add 8642526990 to Megan E Weaver's contact");
        expect(m.text).toBe("Added (864) 252-6990 to Megan E Weaver's card. It also has megweaver@icloud.com.");
        expect(d.of("com.palm.person:1").filter((p) => p.name.familyName === "Weaver")).toHaveLength(1);
    });
    it("says truthfully whether the number was added, from the card", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        await d.ask("I need to create a contact card for Megan E Weaver");
        const m = await d.ask("did you add the number to that contact like I asked?");
        expect(m.text).toBe("No, Megan E Weaver's card has no phone number yet. What is it?");
        await d.ask("864 252 6990");
        expect((await d.ask("did you add the number?")).text).toBe("Yes: Megan E Weaver's card has the number (864) 252-6990.");
    });
    it("asks what to do with an address said with nothing to put it on", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        const m = await d.ask("megweaver@icloud.com");
        expect(m).toMatchObject({ status: "ask" });
        expect(m.text).toMatch(/^What should I do with megweaver@icloud.com\?/);
    });
});

describe("email", () => {
    it("reads the email received, not the one the user just sent", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" },
                           seed: (put) => { put({ _id: "mail-sent", _kind: "com.palm.email:1", folderId: "sent-folder", subject: "", from: { addr: "jordan@example.com", name: "Jordan Avery" },
                                                  summary: "I need to create a contact card", timestamp: NOW - 60e3, flags: { read: true, visible: true } }); } });
        const acct = d.db.get("mail-acct");
        d.db.set("mail-acct", { ...acct, sentFolderId: "sent-folder" });
        const m = await d.ask("Read the last email I got.");
        expect(m.text).toMatch(/^From Alex Rivera/);
    });
    it("reads the last two", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        const m = await d.ask("Last two emails I got.");
        expect(m.text).toMatch(/^Your last 2 emails: from Alex Rivera.*then from Priya Nair/);
    });
    it("drafts an email to no one yet, never to the recipient of a failed one", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        expect((await d.ask("Email Priya saying see you soon")).status).toBe("failed");
        const m = await d.ask("create me a draft email announcing the new webos version.");
        expect(m).toMatchObject({ command: "email", status: "done" });
        expect(m.text).not.toMatch(/priya/i);
    });
});

describe("what a model is shown", () => {
    it("ends with the words it answers, so llama-server never takes an answer as its reply's start", async () => {
        // The owner's "Talk to me." asked twice: the first answer was saved
        // before the second's next step, and llama.cpp failed ("Failed to
        // initialize samplers").
        const bodies: any[] = [];
        let release: () => void = () => {};
        const held = new Promise<void>((r) => { release = r; });
        const llm = { status: () => Promise.resolve({ available: true, installed: [{ id: "qwen3-0.6b-q8_0" }] }), ensure: () => Promise.resolve({ baseUrl: "http://127.0.0.1:9/v1" }) };
        const reply = (o: object) => ({ status: 200, body: JSON.stringify({ choices: [{ message: o }] }) });
        const llmRequest = async (r: any) => {
            const b = JSON.parse(r.body);
            bodies.push(b);
            const user = b.messages.filter((m: any) => m.role === "user").pop()?.content;
            if (/quark/.test(user) && b.response_format) await held;
            if (b.response_format?.json_schema?.schema?.properties?.command) return reply({ content: JSON.stringify({ command: "none" }) });
            return reply({ content: "An answer." });
        };
        const d = device({ llm, llmRequest, settings: { followUps: false } });
        const first = d.svc.ask({ text: "what is a quark", newThread: true });
        await new Promise((r) => setTimeout(r, 10));
        const threadId = (await d.svc.threads({})).current;
        const second = d.svc.ask({ text: "what is a lepton", threadId });
        await second;
        release();
        await first;
        for (const b of bodies) {
            const said = b.messages.filter((m: any) => m.role !== "system");
            expect(said[said.length - 1].role).toBe("user");
        }
    });
    it("never offers the Assistant's own Quick Action as a command", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" },
                           apps: [{ id: "org.webosphoenix.assistant", title: "Assistant", universalSearch: { action: { displayName: "Ask Assistant", url: "org.webosphoenix.assistant", launchParam: "text" } } } as any] });
        const cmds = (await d.svc.commands({})).commands as { id: string }[];
        expect(cmds.filter((c) => /assistant/.test(c.id))).toEqual([]);
    });
});

describe("dates", () => {
    it("counts days, names weekdays, says the year", async () => {
        const d = device({ settings: { followUps: false, localModel: "off" } });
        expect((await d.ask("how many days until christmas")).text).toMatch(/^There are 79 days until Christmas/);
        expect((await d.ask("what day is october 20th")).text).toMatch(/Tuesday/);
        expect((await d.ask("what year is it")).text).toBe("It's 2026.");
    });
});
