// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Every button, asked aloud (docs/AI-AND-MCP.md): a reply that ends on
// buttons is one pending choice, answered by its button or in words, typed
// or spoken; in talk mode (ask {voice}) its question is asked aloud and an
// unclear answer asked again once, then dropped. And Settings > Assistant >
// Search the web automatically: what nothing here can answer searched at
// once, never words about the user's own things (assistant.js choiceOf,
// answerChoice, askAloud, looksPrivate; lib/lang/en.js choiceAnswer).

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { device, NOW, type Msg } from "./test/device";

const req = createRequire(import.meta.url);
const en = req("./lib/lang/en.js") as {
    choiceAnswer(t: string, options: object[], partial?: boolean, places?: number): { pick?: number; yes?: boolean; no?: boolean } | null;
    answer(t: string): string | null;
    personal(t: string): boolean;
    say: { askChoice(o: object[], n: number): string; withQuestion(t: string, q: string): string };
};
const grammar = req("./lib/grammar.js") as { parse(t: string, c: object): { command: string; args: any } | null };

const CHRISES = (put: (o: any) => string) => {
    put({ _id: "p-chris1", _kind: "com.palm.person:1", name: { givenName: "Chris", familyName: "Park" }, phoneNumbers: [{ value: "(303) 555-0111", type: "type_mobile" }], emails: [] });
    put({ _id: "p-chris2", _kind: "com.palm.person:1", name: { givenName: "Chris", familyName: "Moore" }, phoneNumbers: [{ value: "(303) 555-0122", type: "type_mobile" }], emails: [] });
};
const QUESTION = "who won the 1998 world series";
const last = (l: Msg[]) => l[l.length - 1];
const make = (settings: object = {}, more: object = {}) => device({ settings: { followUps: false, localModel: "off", ...settings }, ...more });
const voice = { voice: true };
const searched = (d: ReturnType<typeof device>) => d.called("applicationManager/open").map((c) => decodeURIComponent(String(c.params.target)));

describe("the words for a choice (lib/lang/en.js)", () => {
    const web = { label: "Search the web", kind: "web" }, connect = { label: "Connect model", kind: "connect" };
    const people = [{ label: "Chris Park", name: "Chris Park", kind: "item" }, { label: "Chris Moore", name: "Chris Moore", kind: "item" }];
    it("hears yes and no as people say them", () => {
        for (const t of ["yes", "yeah", "sure", "go ahead", "please", "do it", "yes please", "yeah go ahead", "go for it", "okay"]) expect(en.answer(t), t).toBe("yes");
        for (const t of ["no", "nope", "nah", "never mind", "cancel", "that's okay", "no thanks", "not now", "forget it", "no it's fine"]) expect(en.answer(t), t).toBe("no");
        for (const t of ["maybe", "hmm", "what", "send it to mom", "purple"]) expect(en.answer(t), t).toBe(null);
    });
    it("names the web search however it is asked for", () => {
        for (const t of ["search the web", "search it", "look it up", "google it", "search for that", "look that up", "search that", "do a web search", "the web", "yes, search the web"])
            expect(en.choiceAnswer(t, [web, connect]), t).toEqual({ pick: 0 });
        expect(en.choiceAnswer("search the web for cats", [web, connect])).toBe(null);
        expect(en.choiceAnswer("connect a model", [web, connect])).toEqual({ pick: 1 });
    });
    it("picks by name, a clear part of it, its place or its number", () => {
        expect(en.choiceAnswer("Chris Moore", people, true)).toEqual({ pick: 1 });
        expect(en.choiceAnswer("Moore", people, true)).toEqual({ pick: 1 });
        expect(en.choiceAnswer("Chris", people, true)).toEqual(null);
        expect(en.choiceAnswer("the second one", people, true)).toEqual({ pick: 1 });
        expect(en.choiceAnswer("number 1", people, true)).toEqual({ pick: 0 });
        expect(en.choiceAnswer("2", people, true)).toEqual({ pick: 1 });
        expect(en.choiceAnswer("the last one", people, true)).toEqual({ pick: 1 });
        // Only as many places as were asked aloud.
        expect(en.choiceAnswer("the second one", [web, connect], false, 1)).toBe(null);
        // A part of a name only where a "which one?" lists names.
        expect(en.choiceAnswer("Moore", people, false)).toBe(null);
    });
    it("asks one choice, or up to three by name and then something else", () => {
        expect(en.say.askChoice([web], 0)).toBe("Want me to search the web for that?");
        expect(en.say.askChoice([web], 1)).toBe("Should I look that up on the web?");
        expect(en.say.askChoice([{ label: "Open Calendar", kind: "open", name: "Calendar" }], 0)).toBe("Want me to open Calendar?");
        expect(en.say.askChoice([{ label: "Open Music", kind: "open", name: "Music" }, { label: "Ask Claude", kind: "cloud", name: "Claude" }, web], 0))
            .toBe("Want me to open Music, ask Claude or search the web?");
        const four = ["Ann Lee", "Ann Moss", "Ann Park", "Ann Roe"].map((n) => ({ label: n, name: n, kind: "item" }));
        expect(en.say.askChoice(four, 0)).toBe("Which one: Ann Lee, Ann Moss, Ann Park, or someone else?");
        expect(en.say.askChoice([{ label: "Turn Off Wi-Fi", kind: "action" }], 0)).toBe("Want me to turn off Wi-Fi?");
        expect(en.say.withQuestion("I can't answer that on my own yet, but I can search the web for it.", "Want me to search the web for that?"))
            .toBe("I can't answer that on my own yet. Want me to search the web for that?");
    });
    it("takes \"search the web\" with nothing to search for as just that, not a search for \"the web\"", () => {
        for (const t of ["search the web", "look it up", "google that", "search for that", "do a web search", "search online"])
            expect(grammar.parse(t, { now: NOW }), t).toEqual({ command: "search", args: { query: "" } });
        expect(grammar.parse("search the web for palm pre", { now: NOW })).toEqual({ command: "search", args: { query: "palm pre" } });
        expect(grammar.parse("look up webos history", { now: NOW })).toEqual({ command: "search", args: { query: "webos history" } });
    });
});

describe("a web search offered, answered in words", () => {
    it("searches the question before for \"yes\", \"look it up\", \"search the web\", typed", async () => {
        for (const said of ["yes", "look it up", "search the web", "google it", "search for that"]) {
            const d = make();
            const offer = await d.ask(QUESTION);
            expect(offer.choices!.map((c) => c.id)).toEqual(["web", "connect"]);
            const m = await d.ask(said);
            expect(m.command, said).toBe("search");
            expect(m.text).toBe("Searching the web for “who won the 1998 world series”.");
            expect(searched(d)).toEqual(["https://www.google.com/search?q=who won the 1998 world series"]);
            // The buttons go: it was answered.
            const t = (await d.svc.thread({ id: d.thread() })).messages as Msg[] & { chosen?: string }[];
            expect((t.find((x: Msg) => x.id === offer.id) as Msg & { chosen?: string }).chosen).toBe("web");
        }
    });
    it("leaves it at \"no\", and says so", async () => {
        const d = make();
        await d.ask(QUESTION);
        const m = await d.ask("no thanks");
        expect(m.text).toBe("OK, I won't search for it.");
        expect(searched(d)).toEqual([]);
    });
    it("takes anything else as a new request", async () => {
        const d = make();
        await d.ask(QUESTION);
        expect((await d.ask("set a timer for 5 minutes")).command).toBe("timer");
        expect(searched(d)).toEqual([]);
    });
    it("asks what to search for when nothing was asked before", async () => {
        const d = make();
        const q = await d.ask("search the web");
        expect(q.text).toBe("What should I search the web for?");
        expect(searched(d)).toEqual([]);
        expect((await d.ask("best hiking trails near Denver")).command).toBe("search");
        expect(searched(d)).toEqual(["https://www.google.com/search?q=best hiking trails near Denver"]);
    });
    it("searches with the engine Just Type uses", async () => {
        const d = make();
        d.luna.call = ((call) => (uri: string, p: any) => uri.endsWith("getUniversalSearchList")
            ? Promise.resolve({ returnValue: true, defaultSearchEngine: "duckduckgo", UniversalSearchList: [{ id: "google", url: "https://www.google.com/search?q=#{searchTerms}" },
                                                                                                             { id: "duckduckgo", url: "https://duckduckgo.com/?q=#{searchTerms}" }] })
            : call(uri, p))(d.luna.call.bind(d.luna));
        await d.ask(QUESTION);
        await d.ask("yes");
        expect(searched(d)).toEqual(["https://duckduckgo.com/?q=who won the 1998 world series"]);
    });
});

describe("talk mode: every button asked aloud", () => {
    it("asks the web search aloud, and shows the question", async () => {
        const d = make();
        const m = await d.ask(QUESTION, voice);
        expect(m.text).toBe("I can't answer that on my own yet. Want me to search the web for that?");
        expect(m.data.asked).toBe(true);
        // Typed, the words stay as they were.
        expect((await make().ask(QUESTION)).text).toBe("I can't answer that on my own yet, but I can search the web for it.");
        expect((await d.ask("sure", voice)).command).toBe("search");
    });
    it("names a cloud model's choice by its provider or its model, and asks which for a yes", async () => {
        const d = make();
        d.storage.set("assistant:provider:p1", { id: "p1", type: "anthropic", model: "claude-sonnet-5-5", keyEnc: {}, created: 1 });
        const m = await d.ask(QUESTION, voice);
        expect(m.text).toBe("I can't answer that on my own yet. Want me to ask Anthropic or search the web?");
        expect((await d.ask("yes", voice)).text).toBe("Sorry, want me to ask Anthropic or search the web?");
        await d.ask("ask Claude", voice);
        expect(d.requests.some((u: string) => u.indexOf("api.anthropic.com") >= 0)).toBe(true);
        expect(searched(d)).toEqual([]);
    });
    it("asks the next step a command offers, but not the app it already did it in", async () => {
        const d = make();
        expect((await d.ask("check my voicemail", voice)).text).toBe("You have 2 new voicemails. Want me to call voicemail?");
        // A yes to the offer is a read-back still: a call needs its own yes.
        const rb = await d.ask("yes", voice);
        expect(rb).toMatchObject({ command: "voicemail", status: "pending" });
        expect(d.state.launched).toEqual([]);
        expect((await d.ask("yes", voice)).text).toBe("Calling voicemail.");
        expect((await d.ask("add lunch with Sam tomorrow at noon", voice)).text).toBe("Added “Lunch with Sam” to your calendar, tomorrow at 12:00 PM.");
    });
    it("asks what to say for Reply, hands-free to the end", async () => {
        const d = make();
        expect((await d.ask("read my last message", voice)).text).toMatch(/Want me to reply to Sam Delgado\?$/);
        expect((await d.ask("yes", voice)).text).toBe("What should I say to Sam Delgado?");
        expect(await d.ask("on my way", voice)).toMatchObject({ command: "replyMessage", status: "pending", text: "Send \"On my way\" to Sam Delgado?" });
        expect((await d.ask("yes", voice)).status).toBe("done");
        expect(d.called("messaging/putMessage")).toHaveLength(1);
    });
    it("takes yes and no for Allow and Don't Allow", async () => {
        const d = make({}, { locationAllowed: null });
        expect((await d.ask("what's the weather", voice)).text).toMatch(/Is it OK if I use it\?$/);
        const yes = await d.askAll("yes", voice);
        expect(yes.map((m) => m.command)).toEqual([undefined, "locationAccess", "weather"]);
        const e = make({}, { locationAllowed: null });
        await e.ask("what's the weather", voice);
        expect((await e.ask("no", voice)).text).toMatch(/won't use your location/);
        expect(e.state.locationAllowed).toBe(false);
    });
    it("picks among names by name, part of one, place or number", async () => {
        for (const [said, who] of [["Chris Moore", "Chris Moore"], ["Moore", "Chris Moore"], ["the first one", "Chris Park"], ["2", "Chris Moore"]]) {
            const d = make({}, { seed: CHRISES });
            expect((await d.ask("text Chris I'm on my way", voice)).text).toBe("Which one: Chris Park or Chris Moore?");
            const m = await d.ask(said, voice);
            expect(m.status, said).toBe("pending");
            expect(m.confirm.args.name, said).toBe(who);
        }
    });
});

describe("talk mode: safety", () => {
    it("sends only on a plain yes to what was just read back", async () => {
        const d = make();
        const rb = await d.ask("text Sam I'm late", voice);
        expect(rb.status).toBe("pending");
        // Something else asked between: a yes no longer answers the read-back.
        expect((await d.ask("what time is it", voice)).command).toBe("time");
        await d.ask("yes", voice);
        expect(d.called("messaging/putMessage")).toHaveLength(0);
        // Typed too.
        const t = make();
        await t.ask("text Sam I'm late");
        await t.ask("tell me a joke");
        await t.ask("yes");
        expect(t.called("messaging/putMessage")).toHaveLength(0);
    });
    it("asks again once when the answer is not clear, then leaves it, saying so", async () => {
        const d = make();
        await d.ask("text Sam I'm late", voice);
        const again = await d.ask("hmm, maybe", voice);
        expect(again).toMatchObject({ status: "pending", command: "text", text: "Sorry, should I send it? Yes or no." });
        expect((await d.ask("purple", voice)).text).toBe("I didn't catch that, so I won't send it.");
        expect((await d.ask("yes", voice)).command).not.toBe("text");
        expect(d.called("messaging/putMessage")).toHaveLength(0);
        // Asked again, a yes sends.
        const e = make();
        await e.ask("text Sam I'm late", voice);
        await e.ask("hmm", voice);
        expect((await e.ask("yes", voice)).text).toBe("Sent to Sam Delgado.");
    });
    it("cancels on no, never mind, stop", async () => {
        for (const said of ["no", "never mind", "stop", "cancel"]) {
            const d = make();
            await d.ask("call Mom", voice);
            await d.ask(said, voice);
            expect(d.state.launched, said).toEqual([]);
        }
    });
    it("cancels a read-back nobody answered when the wait is over, and never does it", async () => {
        const d = make();
        const rb = await d.ask("text Sam I'm late", voice);
        const r = await d.svc.sessionPhrase({ kind: "checkIn", threadId: d.thread(), speak: false });
        expect(r.text).toMatch(/^I didn't hear an answer, so I won't send it\. /);
        await d.ask("yes", voice);
        expect(d.called("messaging/putMessage")).toHaveLength(0);
        // The buttons go with it.
        await expect(d.svc.confirm({ threadId: d.thread(), messageId: rb.id, accept: true })).resolves.toMatchObject({ returnValue: false });
    });
    it("\"I'm done\" with a read-back waiting: not done, and goodbye", async () => {
        const d = make();
        await d.ask("delete all my alarms", voice);
        const bye = await d.ask("I'm done", voice);
        expect(bye.status).toBe("goodbye");
        expect(bye.text).toMatch(/^OK, I won't do that\. /);
        expect(d.of("com.palm.clock.alarm:1")).toHaveLength(2);
    });
    it("never sends on the decision model's guess, but takes its no", async () => {
        const yesNo = (said: string) => ({ name: "Test", threshold: 0.9, decide: () => Promise.resolve(null), yesNo: () => Promise.resolve(said) });
        const d = make({ decider: "on" }, { deps: { decider: yesNo("yes") } });
        await d.ask("text Sam I'm late", voice);
        await d.ask("ya know what, fire away", voice);
        expect(d.called("messaging/putMessage")).toHaveLength(0);
        const e = make({ decider: "on" }, { deps: { decider: yesNo("no") } });
        await e.ask("text Sam I'm late", voice);
        expect((await e.ask("nah leave it be", voice)).status).toBe("cancelled");
    });
});

describe("Search the web automatically (Settings > Assistant)", () => {
    it("is off by default, and only Settings may turn it on", async () => {
        const d = make();
        expect((await d.svc.getSettings()).settings.autoSearch).toBe(false);
        expect(await d.svc.setSettings({ autoSearch: "yes" })).toMatchObject({ returnValue: false, errorText: "autoSearch: true or false" });
        expect(await d.svc.setSettings({ autoSearch: true })).toMatchObject({ returnValue: false, errorText: "Only Settings can turn on searching the web automatically" });
    });
    it("searches what nothing here can answer at once: one line, spoken in talk mode", async () => {
        for (const v of [undefined, voice]) {
            const d = make({ autoSearch: true });
            const list = await d.askAll(QUESTION, v);
            expect(list.map((m) => m.text)).toEqual([QUESTION, "Searching the web for “who won the 1998 world series”."]);
            expect(last(list).data).toMatchObject({ autoSearch: true, opened: true });
            expect(searched(d)).toEqual(["https://www.google.com/search?q=who won the 1998 world series"]);
        }
        const t = make({ autoSearch: true });
        expect((await t.ask("translate good morning into Spanish")).command).toBe("search");
    });
    it("never for a command that did something or failed for another reason", async () => {
        const d = make({ autoSearch: true });
        expect((await d.ask("set an alarm for 6am")).command).toBe("alarm");
        expect((await d.ask("turn on the living room lights")).kind).toBe("fallback");
        expect((await d.ask("call Bob")).text).toBe("I couldn't find bob in your contacts.");
        expect(searched(d)).toEqual([]);
    });
    it("never for words about the user's own things", async () => {
        for (const said of ["how old is my dog in human years", "is Priya allergic to peanuts", "what did alex@example.com say about the invoice",
                            "who has the number 303 555 0199", "did I leave the stove on", "what is Sam's favourite colour"]) {
            const d = make({ autoSearch: true });
            const m = await d.ask(said);
            expect(m.command, said).not.toBe("search");
            expect(m.choices!.some((c) => c.id === "web"), said).toBe(true);
            expect(searched(d), said).toEqual([]);
        }
        expect(en.personal("what's my blood type")).toBe(true);
        expect(en.personal("what's the tallest mountain")).toBe(false);
    });
});
