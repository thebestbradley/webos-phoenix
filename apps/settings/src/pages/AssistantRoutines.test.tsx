// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant > Routines (AssistantRoutines.tsx), against the
// simulated services and the Assistant's own service code run in the page:
// a starter added and run by its phrase, a routine made from the editor's
// steps (one with a field filled in), a step that would send refused with
// the service's reason, and a routine deleted.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { assistant, call } from "@phoenix/luna";
import { RoutinesPage, routineSummary } from "./AssistantRoutines";

type PS = { getResource(p: string): string | undefined; appIdentifier: string };
type R = { returnValue: boolean; [k: string]: any };
const ps = () => (window as unknown as { PalmSystem: PS }).PalmSystem;
const REPO = resolve(__dirname, "../../../..");

beforeAll(() => {
    (window as unknown as Record<string, unknown>).phoenixHost = { postToHost: () => {} };
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
beforeAll(async () => { await call("luna://com.palm.applicationManager/listLaunchPoints", {}); }, 30000);

const ask = async (text: string) => ((await call("luna://org.webosphoenix.assistant/ask", { text, newThread: true })) as unknown as R).messages.at(-1);

describe("Settings > Assistant > Routines", () => {
    it("adds the Good night starter, which then runs on its words", async () => {
        render(<RoutinesPage onDone={() => undefined} />);
        fireEvent.click(await screen.findByTestId("rt-starter-goodnight"));
        expect((screen.getByTestId("rt-name") as HTMLInputElement).value).toBe("Good night");
        expect(screen.getByTestId("rt-step-0").textContent).toMatch(/turn on do not disturb/);
        fireEvent.click(screen.getByTestId("rt-save"));
        const row = await screen.findByText("Good night");
        expect(row).toBeTruthy();
        const saved = (await assistant.routines()).routines;
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ name: "Good night", starter: "goodnight", enabled: true });
        // No longer suggested once added.
        await waitFor(() => expect(screen.queryByTestId("rt-starter-goodnight")).toBeNull());
        const m = await ask("good night");
        expect(m.command).toBe("routine");
        expect(m.text).toMatch(/^Good night\. Do Not Disturb is on/);
    });
    it("makes a routine from the editor's steps, and says why a step can't be one", async () => {
        render(<RoutinesPage onDone={() => undefined} />);
        fireEvent.click(await screen.findByTestId("rt-new"));
        fireEvent.change(screen.getByTestId("rt-name"), { target: { value: "Work" } });
        fireEvent.change(screen.getByTestId("rt-phrases"), { target: { value: "work mode, focus time" } });
        // A step with something to fill in: Set the brightness, to 40%.
        fireEvent.click(screen.getByTestId("rt-add-step"));
        fireEvent.click(await screen.findByText("Set the brightness"));
        fireEvent.change(screen.getByTestId("rt-field-percent"), { target: { value: "40" } });
        fireEvent.click(screen.getByTestId("rt-field-add"));
        expect(screen.getByTestId("rt-step-0").textContent).toMatch(/set brightness to 40%/);
        // Anything else one would ask: here a text, which a routine may not send.
        fireEvent.click(screen.getByTestId("rt-add-step"));
        fireEvent.click(await screen.findByText("Something else you'd ask"));
        fireEvent.change(screen.getByTestId("rt-field-request"), { target: { value: "text Sam I'm busy" } });
        fireEvent.click(screen.getByTestId("rt-field-add"));
        fireEvent.click(screen.getByTestId("rt-save"));
        expect((await screen.findByTestId("rt-error")).textContent).toMatch(/“text Sam I'm busy” sends, calls or deletes/);
        fireEvent.click(within(screen.getByTestId("rt-step-1")).getByTestId("rt-step-remove-1"));
        // At a time on weekdays.
        fireEvent.click(screen.getByTestId("rt-timed"));
        for (const d of [1, 2, 3, 4, 5]) fireEvent.click(screen.getByTestId(`rt-day-${d}`));
        fireEvent.click(screen.getByTestId("rt-save"));
        await screen.findByText("Work");
        const work = (await assistant.routines()).routines.find((r) => r.name === "Work")!;
        expect(work).toMatchObject({ phrases: ["work mode", "focus time"], steps: [{ text: "set brightness to 40%", command: "brightness" }],
                                     time: "22:30", days: [1, 2, 3, 4, 5], events: [] });
        expect(routineSummary(work)).toBe("Say “work mode” · 10:30 PM weekdays");
        expect((await ask("focus time")).text).toMatch(/^Work\. /);
        // Its time is the activity manager's.
        const acts = ((await call("luna://com.palm.activitymanager/list", {})) as unknown as R).activities;
        expect(acts.some((a: R) => a.name === "assistant.routine." + work.id)).toBe(true);
    });
    it("deletes a routine", async () => {
        render(<RoutinesPage onDone={() => undefined} />);
        fireEvent.click(await screen.findByText("Work"));
        fireEvent.click(await screen.findByTestId("rt-delete"));
        fireEvent.click(await screen.findByTestId("rt-delete-confirm"));
        await waitFor(async () => expect((await assistant.routines()).routines.map((r) => r.name)).toEqual(["Good night"]));
    });
});
