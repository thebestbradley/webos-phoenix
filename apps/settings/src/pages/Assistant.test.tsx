// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant's Voice group against the simulated
// org.webosphoenix.assistant (the runtime runs apps/assistant/service in
// the page): "Hey Phoenix" off until turned on, the lock screen only with
// it, voice replies, and the privacy note (docs/AI-AND-MCP.md, Voice).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { assistant, call } from "@phoenix/luna";
import { AssistantPage } from "./Assistant";

type PS = { getResource(p: string): string | undefined; appIdentifier: string };
const ps = () => (window as unknown as { PalmSystem: PS }).PalmSystem;
const REPO = resolve(__dirname, "../../../..");

beforeAll(() => {
    new Function(readFileSync(resolve(REPO, "runtime/phoenix-runtime.js"), "utf8")).call(window);
    // jsdom has no rootfs: the service's modules from the repository.
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

const toggle = (id: string) => screen.getByTestId(id) as HTMLButtonElement;
const checked = (id: string) => toggle(id).getAttribute("aria-checked") === "true";

describe("Settings > Assistant: Voice", () => {
    it("listens for \"Hey Phoenix\" only once turned on, and with the screen locked only with that", async () => {
        render(<AssistantPage />);
        await waitFor(() => expect(screen.getByTestId("as-wake")).toBeTruthy());
        expect(checked("as-wake")).toBe(false);
        expect(checked("as-wake-locked")).toBe(false);
        expect(toggle("as-wake-locked").disabled).toBe(true);
        expect(checked("as-voice-replies")).toBe(true);
        expect(screen.getByTestId("as-voice-privacy").textContent).toMatch(/happens on this phone.*nothing is recorded, sent or saved/);

        fireEvent.click(toggle("as-wake"));
        await waitFor(() => expect(checked("as-wake")).toBe(true));
        expect((await assistant.settings()).wakeWord).toBe(true);
        await waitFor(() => expect(toggle("as-wake-locked").disabled).toBe(false));
        fireEvent.click(toggle("as-wake-locked"));
        await waitFor(() => expect(checked("as-wake-locked")).toBe(true));
        fireEvent.click(toggle("as-voice-replies"));
        await waitFor(() => expect(checked("as-voice-replies")).toBe(false));
        expect(await assistant.settings()).toMatchObject({ wakeWord: true, wakeWhenLocked: true, voiceReplies: false });

        // The assistant off: none of it.
        fireEvent.click(toggle("as-enabled"));
        await waitFor(() => expect(toggle("as-wake").disabled).toBe(true));
        expect(toggle("as-wake-locked").disabled).toBe(true);
    });
});
