// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant > Follow-up questions against the simulated
// org.webosphoenix.assistant (the runtime runs apps/assistant/service in
// the page): on by default, the quiet hours, a question waiting for later,
// and the topics' switches (one off after "Stop asking").

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { assistant, call, type AssistantSettings } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { FollowUpQuestions } from "./AssistantFollowUps";

type PS = { getResource(p: string): string | undefined; appIdentifier: string };
const ps = () => (window as unknown as { PalmSystem: PS }).PalmSystem;
const REPO = resolve(__dirname, "../../../..");

beforeAll(() => {
    new Function(readFileSync(resolve(REPO, "runtime/phoenix-runtime.js"), "utf8")).call(window);
    const base = ps().getResource.bind(ps());
    ps().getResource = (p) => {
        const m = /^\/usr\/palm\/services\/org\.webosphoenix\.assistant\/(.+)$/.exec(p);
        if (m) {
            try { return readFileSync(resolve(REPO, "apps/assistant/service", m[1]), "utf8"); } catch { return undefined; }
        }
        return base(p);
    };
    ps().appIdentifier = "org.webosphoenix.settings";
});
beforeAll(async () => {
    await call("luna://com.palm.applicationManager/listLaunchPoints", {});
    // A calendar for the events (jsdom has none yet).
    await call("luna://com.palm.db/put", { objects: [{ _kind: "com.palm.calendar:1", syncSource: "Local", name: "Phoenix", accountId: "" }] });
}, 30000);

function Page() {
    const s = useLuna<AssistantSettings>((cb, err) => assistant.watchSettings(cb, err), []).value;
    return s ? <FollowUpQuestions settings={s} set={(c) => void assistant.setSettings(c)} off={!s.enabled} /> : null;
}
const toggle = (id: string) => screen.getByTestId(id) as HTMLButtonElement;
const checked = (id: string) => toggle(id).getAttribute("aria-checked") === "true";
// What the system UI asks (only it, the Assistant and Settings may).
async function asSystem<T>(f: () => Promise<T>): Promise<T> {
    ps().appIdentifier = "com.palm.systemui";
    try { return await f(); } finally { ps().appIdentifier = "org.webosphoenix.settings"; }
}

describe("Settings > Assistant: Follow-up questions", () => {
    it("is on, quiet from 10 PM to 8 AM, and shows a question waiting for later", async () => {
        render(<Page />);
        await waitFor(() => expect(screen.getByTestId("as-followups")).toBeTruthy());
        expect(checked("as-followups")).toBe(true);
        expect(screen.getByTestId("as-quiet-start").textContent).toContain("10 PM");
        expect(screen.getByTestId("as-quiet-end").textContent).toContain("8 AM");

        const r = await asSystem(() => assistant.ask("add a meeting on the 20th at 3pm", { newThread: true }));
        const q = r.messages[r.messages.length - 1];
        expect(q.followUp?.kind).toBe("location");
        await asSystem(() => assistant.leaveFollowUps());
        await waitFor(() => expect(screen.getByTestId(`as-followup-${q.followUp!.id}`).textContent).toMatch(/meeting.*Asks at/));

        // Off: nothing waits.
        fireEvent.click(toggle("as-followups"));
        await waitFor(() => expect(checked("as-followups")).toBe(false));
        expect((await assistant.settings()).followUps).toBe(false);
        expect(screen.queryByTestId(`as-followup-${q.followUp!.id}`)).toBeNull();
        expect(toggle("as-quiet-start").getAttribute("aria-disabled")).toBe("true");
        await assistant.setSettings({ followUps: true });
    });

    it("chooses when a question comes back: first after 1 hour, again 4 hours later, by default", async () => {
        render(<Page />);
        await waitFor(() => expect(screen.getByTestId("as-followup-first")).toBeTruthy());
        expect(screen.getByTestId("as-followup-first").textContent).toContain("1 hour");
        expect(screen.getByTestId("as-followup-again").textContent).toContain("4 hours later");
        fireEvent.click(screen.getByTestId("as-followup-first"));
        fireEvent.click(screen.getByRole("option", { name: "After 15 minutes" }));
        await waitFor(async () => expect((await assistant.settings()).followUpFirst).toBe(15));
        fireEvent.click(screen.getByTestId("as-followup-again"));
        fireEvent.click(screen.getByRole("option", { name: "Off" }));
        await waitFor(async () => expect((await assistant.settings()).followUpAgain).toBe(0));
        await waitFor(() => expect(screen.getByTestId("as-followup-again").textContent).toContain("Off"));
        await assistant.setSettings({ followUpFirst: 60, followUpAgain: 240 });
    });

    it("has a switch for every topic, off for one the assistant was told to stop asking", async () => {
        render(<Page />);
        await waitFor(() => expect(screen.getByTestId("as-topic-location")).toBeTruthy());
        expect(checked("as-topic-location")).toBe(true);
        for (const day of ["21st", "22nd", "23rd"]) {
            const r = await asSystem(() => assistant.ask(`add a meeting on the ${day} at 9am`, { newThread: true }));
            const q = r.messages[r.messages.length - 1];
            expect(q.followUp?.kind).toBe("location");
            await asSystem(() => assistant.choose(q.threadId, q.id, "fu:skip"));
        }
        // It asks before it stops.
        const r = await asSystem(() => assistant.ask("add a meeting on the 24th at 9am", { newThread: true }));
        const doubt = r.messages[r.messages.length - 1];
        expect(doubt.followUp?.kind).toBe("doubt");
        await asSystem(() => assistant.choose(doubt.threadId, doubt.id, doubt.choices!.find((c) => c.label === "Stop asking")!.id));
        await waitFor(() => expect(checked("as-topic-location")).toBe(false));
        fireEvent.click(toggle("as-topic-location"));
        await waitFor(() => expect(checked("as-topic-location")).toBe(true));
        expect((await assistant.settings()).followUpTopicsOff).toEqual([]);
        fireEvent.click(toggle("as-topic-duration"));
        await waitFor(() => expect(checked("as-topic-duration")).toBe(false));
        expect((await assistant.settings()).followUpTopicsOff).toEqual(["duration"]);
    });
});
