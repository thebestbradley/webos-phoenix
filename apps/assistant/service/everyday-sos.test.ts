// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Emergency calls (lib/commands-sos.js, lib/lang/en-sos.js): "call 911" is
// never read back; the shell's emergency window counts down with Cancel
// (org.webosphoenix.system emergencyCall), "cancel" or "no" stops it while
// it counts; the region's number when none is said; over the lock screen
// too; and the emergency contacts texted where the phone is, read back
// first. No call is ever placed here: the test device only records.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { device, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(text: string, ctx?: object): { command: string; args: Record<string, any> } | null };
const parse = (t: string) => grammar.parse(t, { lang: "en", now: NOW });
const ICE = { emergencyInfo: { contacts: [{ name: "Mom", number: "(303) 555-0101", relation: "Parent" }, { name: "Sam Delgado", number: "(303) 555-0142" }] } };

describe("the words", () => {
    it("emergency calls, never the call command's read-back", () => {
        expect(parse("call 911")).toEqual({ command: "emergency", args: { number: "911" } });
        expect(parse("call 9 1 1")?.args).toEqual({ number: "911" });
        expect(parse("emergency")).toEqual({ command: "emergency", args: { number: "" } });
        expect(parse("call an ambulance")?.command).toBe("emergency");
        expect(parse("false alarm")?.command).toBe("emergencyCancel");
        expect(parse("text my location to my emergency contacts")?.command).toBe("emergencyText");
        expect(parse("call mom")?.command).toBe("call");
        expect(parse("call 555 1234")?.command).toBe("call");
    });
});

describe("an emergency call", () => {
    it("asks the shell for the countdown at once, says how to cancel, and the view makes way", async () => {
        const d = device();
        const m = await d.ask("call 911");
        expect(m).toMatchObject({ command: "emergency", status: "done", text: "Calling 911 in 5 seconds. Call now, or cancel?" });
        expect(m.data.opened).toBe(true);
        expect(d.called("emergencyCall").at(-1)?.params).toEqual({ number: "911", countdown: 5 });
        // Not the call command: nothing dialled here.
        expect(d.state.launched.filter((l: { id: string }) => l.id === "org.webosphoenix.phone")).toEqual([]);
        expect(m.choices.map((c: { label: string }) => c.label)).toEqual(["Call Now", "Cancel"]);
    });
    it("is cancelled by “cancel” while it counts down", async () => {
        const d = device();
        await d.ask("call 911");
        d.setNow(NOW + 2000);
        const m = await d.ask("cancel");
        expect(m.text).toBe("Cancelled. I didn't call 911.");
        expect(d.called("emergencyCall").at(-1)?.params).toEqual({ cancel: true });
    });
    it("hands-free: “no” cancels, “call now” calls at once", async () => {
        const d = device();
        await d.ask("call 911", { voice: true });
        expect((await d.ask("no", { voice: true })).text).toBe("Cancelled. I didn't call 911.");
        await d.ask("emergency", { voice: true });
        expect((await d.ask("call now", { voice: true })).text).toBe("Calling 911.");
        expect(d.called("emergencyCall").at(-1)?.params).toEqual({ number: "911", countdown: 0 });
        // Not a countdown any more: "cancel" is the undo command's again.
        d.setNow(NOW + 60000);
        expect((await d.ask("cancel", { voice: true })).command).not.toBe("emergencyCancel");
    });
    it("says the call has started once the countdown is over", async () => {
        const d = device();
        await d.ask("emergency");
        d.setNow(NOW + 8000);
        expect((await d.ask("cancel the emergency call")).text).toBe("The call to 911 has started. Hang up in Phone if you need to.");
    });
    it("calls the region's number, and works over the lock screen", async () => {
        const d = device({ deps: { locale: () => "en-GB" } });
        const m = await d.ask("call an ambulance", { locked: true, voice: true });
        expect(m).toMatchObject({ command: "emergency", status: "done" });
        expect(d.called("emergencyCall").at(-1)?.params).toEqual({ number: "999", countdown: 5 });
    });
});

describe("the emergency contacts", () => {
    it("offers to text them, and texts them where the phone is once read back", async () => {
        const d = device();
        Object.assign(d.state.prefs, ICE);
        const m = await d.ask("call 911");
        expect(m.choices.map((c: { label: string }) => c.label)).toEqual(["Call Now", "Cancel", "Text My Location to My Emergency Contacts"]);
        const asked = await d.ask("text my location to my emergency contacts");
        expect(asked.status).toBe("pending");
        expect(asked.text).toMatch(/^Text Mom and Sam Delgado: “I've called 911\. I'm here: https:\/\/www\.openstreetmap\.org\/\?mlat=37\.370000&mlon=-122\.040000/);
        const done = await d.confirm(asked);
        expect(done.text).toBe("Texted Mom and Sam Delgado where you are.");
        const sent = d.called("messaging/putMessage").map((c: { params: { message: { to: { addr: string }[] } } }) => c.params.message.to[0].addr);
        expect(sent).toEqual(["(303) 555-0101", "(303) 555-0142"]);
    });
    it("says when there are none", async () => {
        expect((await device().ask("text my location to my emergency contacts")).text).toBe("You have no emergency contacts. Add them in Settings > Emergency Info.");
    });
});
