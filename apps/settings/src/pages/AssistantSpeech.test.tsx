// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant's speaking voice and Play Sample (AssistantSpeech.tsx).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tts, type AssistantSettings } from "@phoenix/luna";
import { SAMPLE, SpeakingVoice, voiceLabel } from "./AssistantSpeech";

const VOICES = ["expr-voice-2-f", "expr-voice-2-m", "expr-voice-3-f", "expr-voice-3-m"];
const settings = (speechVoice = "") => ({ speechVoice } as AssistantSettings);

afterEach(() => { vi.restoreAllMocks(); });

describe("Settings > Assistant: the speaking voice", () => {
    it("offers Kitten's voices, the warm one by default, and plays a sample with the one chosen", async () => {
        vi.spyOn(tts, "status").mockResolvedValue({ available: true, engine: "Kitten TTS", voices: VOICES });
        const speak = vi.spyOn(tts, "speak").mockResolvedValue();
        const set = vi.fn();
        const { rerender } = render(<SpeakingVoice settings={settings()} set={set} off={false} />);
        await waitFor(() => expect(screen.getByTestId("as-speech-voice")).toBeTruthy());
        expect(screen.getByTestId("as-speech-voice").textContent).toContain("Luna (warm, the default)");
        fireEvent.click(screen.getByTestId("as-speech-sample"));
        expect(speak).toHaveBeenCalledWith(SAMPLE, "en", "expr-voice-3-f");
        // Busy while it speaks, then ready again.
        await waitFor(() => expect((screen.getByTestId("as-speech-sample") as HTMLButtonElement).disabled).toBe(false));
        rerender(<SpeakingVoice settings={settings("expr-voice-2-m")} set={set} off={false} />);
        expect(screen.getByTestId("as-speech-voice").textContent).toContain("Jasper");
        fireEvent.click(screen.getByTestId("as-speech-sample"));
        await waitFor(() => expect(speak).toHaveBeenLastCalledWith(SAMPLE, "en", "expr-voice-2-m"));
    });

    it("shows nothing where the voice has no choices (Flite, espeak-ng) or nobody knows", async () => {
        const spy = vi.spyOn(tts, "status").mockResolvedValue({ available: true, engine: "flite", voices: [] });
        const { container, unmount } = render(<SpeakingVoice settings={settings()} set={vi.fn()} off={false} />);
        await waitFor(() => expect(spy).toHaveBeenCalled());
        expect(container.textContent).toBe("");
        unmount();
        vi.spyOn(tts, "status").mockRejectedValue(new Error("no service"));
        const other = render(<SpeakingVoice settings={settings()} set={vi.fn()} off={false} />);
        await new Promise((r) => setTimeout(r, 20));
        expect(other.container.textContent).toBe("");
    });

    it("names the voices as KittenML does", () => {
        expect(voiceLabel("expr-voice-5-m")).toBe("Leo");
        expect(voiceLabel("someone-else")).toBe("someone-else");
    });
});
