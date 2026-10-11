// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Emergencies (lib/commands-sos.js, lib/lang/en-sos.js) with the call
// command's emergency call (lib/emergency.js; its countdown: review.test.ts):
// more words for the call ("emergency", "SOS", "call 911 now"), more words
// that stop its countdown ("wait, no, stop", "false alarm") or hurry it
// ("hurry"), and the emergency contacts texted where the phone is, offered
// with the call and read back first. No call is ever placed for real: the
// test device only records.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { device, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(text: string, ctx?: object): { command: string; args: Record<string, any> } | null };
const parse = (t: string) => grammar.parse(t, { lang: "en", now: NOW });
const ICE = { emergencyInfo: { contacts: [{ name: "Mom", number: "(303) 555-0101", relation: "Parent" }, { name: "Sam Delgado", number: "(303) 555-0142" }] } };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Placed: Phone's emergency window, opened by the shell (review.test.ts).
const dialled = (d: ReturnType<typeof device>) => d.called("org.webosphoenix.system/emergencyCall").map((c) => c.params);

describe("the words", () => {
    it("an emergency call, said many ways, is the call command's", () => {
        expect(parse("emergency")).toEqual({ command: "call", args: { emergency: true, label: "" } });
        expect(parse("sos")?.args).toEqual({ emergency: true, label: "" });
        expect(parse("this is an emergency")?.args).toEqual({ emergency: true, label: "" });
        expect(parse("get the paramedics")?.args).toEqual({ emergency: true, label: "" });
        expect(parse("call 911 now")?.args).toEqual({ number: "911", label: "" });
        expect(parse("call nine one one please")?.args).toEqual({ emergency: true, label: "" });
        expect(parse("text my location to my emergency contacts")?.command).toBe("emergencyText");
        expect(parse("call mom")?.args).toMatchObject({ who: "mom" });
    });
});

describe("an emergency call's countdown", () => {
    it("is counted down for \"emergency\" and \"SOS\" as for \"call 911\"", async () => {
        const d = device({ deps: { countdownMs: 10000 } });
        const m = await d.ask("emergency");
        expect(m).toMatchObject({ command: "call", status: "pending", confirm: { countdown: 5, args: { number: "911", emergency: true } } });
        expect(m.text).toBe("Calling 911 in 5 seconds. Cancel to stop.");
        expect(dialled(d)).toEqual([]);
    });
    it("is stopped by any few words with a stop in them", async () => {
        for (const words of ["wait no stop", "false alarm", "never mind", "stop", "don't"]) {
            const d = device({ deps: { countdownMs: 40 } });
            await d.ask("call 911");
            expect((await d.ask(words)).status, words).toBe("cancelled");
            await wait(80);
            expect(dialled(d), words).toEqual([]);
        }
    });
    it("is placed at once for \"hurry\", spoken too", async () => {
        const d = device({ deps: { countdownMs: 10000 } });
        await d.ask("sos", { voice: true });
        await d.ask("hurry", { voice: true });
        expect(dialled(d)).toEqual([{ number: "911", countdown: 0 }]);
    });
    it("goes to the region's number, over the lock screen too", async () => {
        const d = device({ deps: { countdownMs: 10000, locale: () => "en-GB" } });
        expect(await d.ask("get the paramedics", { locked: true })).toMatchObject({ command: "call", status: "pending", confirm: { args: { number: "999" } } });
    });
});

describe("the emergency contacts", () => {
    it("are offered with the call placed, and texted where the phone is once read back", async () => {
        const d = device({ deps: { countdownMs: 10000 } });
        Object.assign(d.state.prefs, ICE);
        const m = await d.ask("call 911");
        const placed = await d.confirm(m);
        expect(placed).toMatchObject({ command: "call", status: "done" });
        expect(placed.choices?.map((c: { label: string }) => c.label)).toContain("Text My Location to My Emergency Contacts");
        const asked = await d.ask("text my location to my emergency contacts");
        expect(asked.status).toBe("pending");
        expect(asked.text).toMatch(/^Text Mom and Sam Delgado: “I need help\. I'm here: https:\/\/www\.openstreetmap\.org\/\?mlat=37\.370000&mlon=-122\.040000/);
        const done = await d.confirm(asked);
        expect(done.text).toBe("Texted Mom and Sam Delgado where you are.");
        const sent = d.called("messaging/putMessage").map((c: { params: { message: { to: { addr: string }[] } } }) => c.params.message.to[0].addr);
        expect(sent).toEqual(["(303) 555-0101", "(303) 555-0142"]);
    });
    it("the offer's button says which number was called", async () => {
        const d = device({ deps: { countdownMs: 10000 } });
        Object.assign(d.state.prefs, ICE);
        const placed = await d.confirm(await d.ask("call 911"));
        const r = await d.choose(placed, placed.choices!.find((c: { label: string }) => /^Text My Location/.test(c.label))!.id);
        expect(r.messages.at(-1).text).toMatch(/^Text Mom and Sam Delgado: “I've called 911\. I'm here: /);
    });
    it("says when there are none", async () => {
        expect((await device().ask("text my location to my emergency contacts")).text).toBe("You have no emergency contacts. Add them in Settings > Emergency Info.");
    });
});
