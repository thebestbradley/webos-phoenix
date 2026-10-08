// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant's note on what the voice is missing (AssistantVoice.tsx).

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistant, type VoicePart } from "@phoenix/luna";
import { VoiceMissing } from "./AssistantVoice";

const part = (id: VoicePart["id"], available: boolean, howToInstall = ""): VoicePart =>
    ({ id, name: { recognition: "Speech recognition (whisper.cpp)", wakeWord: "“Hey Phoenix” (Vosk)", speech: "Spoken answers" }[id],
       available, engine: "", howToInstall });

afterEach(() => { vi.restoreAllMocks(); });

describe("Settings > Assistant: what the voice is missing", () => {
    it("says each missing part and how to get it", async () => {
        vi.spyOn(assistant, "voice").mockResolvedValue([
            part("recognition", false, "its model is missing; run tools/get-whisper-model.py."),
            part("wakeWord", true),
            part("speech", false, "no speech program; sudo apt install espeak-ng."),
        ]);
        render(<VoiceMissing />);
        await waitFor(() => expect(screen.getByTestId("as-voice-missing")).toBeTruthy());
        expect(screen.getByTestId("as-voice-missing-recognition").textContent)
            .toBe("Speech recognition (whisper.cpp): its model is missing; run tools/get-whisper-model.py.");
        expect(screen.queryByTestId("as-voice-missing-wakeWord")).toBeNull();
        expect(screen.getByTestId("as-voice-missing-speech").textContent).toMatch(/apt install espeak-ng/);
    });

    it("shows nothing when everything is there, or nobody knows", async () => {
        const spy = vi.spyOn(assistant, "voice").mockResolvedValue([part("recognition", true), part("wakeWord", true), part("speech", true)]);
        const { container, unmount } = render(<VoiceMissing />);
        await waitFor(() => expect(spy).toHaveBeenCalled());
        expect(container.textContent).toBe("");
        unmount();
        vi.spyOn(assistant, "voice").mockRejectedValue(new Error("no service"));
        const other = render(<VoiceMissing />);
        await new Promise((r) => setTimeout(r, 20));
        expect(other.container.textContent).toBe("");
    });
});
