// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant's Voice group against the simulated
// org.webosphoenix.assistant (the runtime runs apps/assistant/service in
// the page): "Hey Phoenix" off until turned on, the lock screen only with
// it, voice replies, and the privacy note (docs/AI-AND-MCP.md, Voice);
// opened by "Connect model", which kind of model, then the providers, and
// once one is there "Back to Your Question".

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { assistant, call } from "@phoenix/luna";
import { AssistantPage, waitLabel } from "./Assistant";

type PS = { getResource(p: string): string | undefined; appIdentifier: string };
const ps = () => (window as unknown as { PalmSystem: PS }).PalmSystem;
const REPO = resolve(__dirname, "../../../..");

const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];
beforeAll(() => {
    (window as unknown as Record<string, unknown>).phoenixHost = {
        postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }),
    };
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

describe("Settings > Assistant: personality and the wait after answering", () => {
    it("chooses a personality, friendly by default, and how long a spoken conversation waits, 45 seconds by default", async () => {
        // (The test before turns the assistant off.)
        await assistant.setSettings({ enabled: true });
        render(<AssistantPage />);
        await waitFor(() => expect(screen.getByTestId("as-personality")).toBeTruthy());
        expect(screen.getByTestId("as-personality").textContent).toContain("Friendly");
        expect(screen.getByTestId("as-voice-wait").textContent).toContain("45 seconds");
        expect(screen.getByTestId("as-voice-wait-note").textContent).toMatch(/anything else.*goodbye.*I\u2019m done/);
        fireEvent.click(screen.getByTestId("as-personality"));
        fireEvent.click(screen.getByRole("option", { name: "Playful" }));
        await waitFor(async () => expect((await assistant.settings()).personality).toBe("playful"));
        fireEvent.click(screen.getByTestId("as-voice-wait"));
        fireEvent.click(screen.getByRole("option", { name: "1 minute" }));
        await waitFor(async () => expect((await assistant.settings()).voiceWait).toBe(60));
        await assistant.setSettings({ personality: "friendly", voiceWait: 45 });
    });

    it("says the waits as people do", () => {
        expect(waitLabel(15)).toBe("15 seconds");
        expect(waitLabel(60)).toBe("1 minute");
        expect(waitLabel(120)).toBe("2 minutes");
    });
});

describe("Settings > Assistant: Connect model", () => {
    it("asks which kind, shows what it takes, and once a model is there goes back to the question", async () => {
        const ps2 = window as unknown as { PalmSystem: { launchParams: string } };
        ps2.PalmSystem.launchParams = JSON.stringify({ page: "assistant", connect: "choose", threadId: "t1" });
        try {
            render(<AssistantPage />);
            await waitFor(() => expect(screen.getByTestId("as-connect-both")).toBeTruthy());
            expect(screen.getByTestId("as-connect-local").textContent).toMatch(/Private and offline.*Qwen3 0\.6B comes with it.*1\.8 to 19 GB/);
            expect(screen.getByTestId("as-connect-cloud").textContent).toMatch(/Anthropic, OpenAI, Google Gemini or any OpenAI-compatible server/);
            fireEvent.click(screen.getByTestId("as-connect-cloud"));
            await waitFor(() => expect(screen.getByTestId("as-connect-add-anthropic")).toBeTruthy());
            expect(screen.queryByTestId("as-connect-back")).toBeNull();
            expect(screen.getByTestId("as-connect-cloud-control").getAttribute("aria-checked")).toBe("false");
            await act(async () => { await assistant.setProvider({ type: "anthropic", key: "sk-test-key-1234" }); });
            await waitFor(() => expect(screen.getByTestId("as-connect-ready").textContent).toMatch(/Anthropic \(claude-sonnet-5-5\) is ready/));
            hostMessages.length = 0;
            fireEvent.click(screen.getByTestId("as-connect-back"));
            await waitFor(() => expect(hostMessages.find((m) => m.type === "launch")?.payload)
                .toMatchObject({ id: "org.webosphoenix.assistant", params: { threadId: "t1", retry: true } }));
            // Closed: the whole page.
            await waitFor(() => expect(screen.getByTestId("as-wake")).toBeTruthy());
        } finally {
            ps2.PalmSystem.launchParams = "{}";
        }
    });
});
