// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant, Messages & Driving (AssistantEveryday.tsx), against
// the simulated services and the Assistant's own service code run in the
// page: Announce Messages is the setting the Assistant reads, and Driving
// Mode the same mode "I'm driving" turns on (Do Not Disturb with it).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useEffect, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { assistant, call, type AssistantSettings } from "@phoenix/luna";
import { MessagesAndDriving } from "./AssistantEveryday";

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

function Page() {
    const [s, setS] = useState<AssistantSettings | null>(null);
    useEffect(() => { void assistant.settings().then(setS); }, []);
    if (!s) return null;
    return <MessagesAndDriving settings={s} off={false} set={(c) => { void assistant.setSettings(c).then(setS); }} />;
}

describe("Settings > Assistant: Messages & Driving", () => {
    it("turns announcing messages on, as the Assistant reads it", async () => {
        render(<Page />);
        const toggle = await screen.findByTestId("as-announce-toggle");
        expect(toggle.getAttribute("aria-checked")).toBe("false");
        fireEvent.click(toggle);
        await waitFor(async () => expect((await assistant.settings()).announceMessages).toBe(true));
        // The Assistant says so when asked.
        const r = (await call("luna://org.webosphoenix.assistant/ask", { text: "are you announcing my messages", newThread: true })) as unknown as R;
        expect(r.messages.at(-1).text).toMatch(/^Yes/);
    });
    it("turns driving mode on and off, the same mode the Assistant's words do", async () => {
        render(<Page />);
        const toggle = await screen.findByTestId("as-driving-toggle");
        await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(toggle);
        await waitFor(async () => expect((await assistant.driving()).on).toBe(true));
        const r = (await call("luna://org.webosphoenix.assistant/ask", { text: "am I in driving mode", newThread: true })) as unknown as R;
        expect(r.messages.at(-1).text).toMatch(/^Yes, driving mode has been on/);
        await call("luna://org.webosphoenix.assistant/ask", { text: "I'm done driving", newThread: true });
        expect((await assistant.driving()).on).toBe(false);
    });
});
