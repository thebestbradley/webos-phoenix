// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Spoken directions. webOS OSE has com.webos.service.tts (speak {text,
// language, clear}), but its engine is Google Cloud Text-to-Speech, which
// needs credentials set up on the device
// (https://www.webosose.org/docs/reference/ls2-api/com-webos-service-tts/).
// So: the TTS service when it answers, else the web runtime's
// speechSynthesis when it has a voice, else nothing (the directions are
// still on screen). An on-device engine (Piper, eSpeak NG) behind the same
// service is future work; see docs/MAPS.md.

import { call } from "@phoenix/luna";

let serviceWorks: boolean | null = null;

function synth(text: string): boolean {
    const s = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    if (!s || !s.getVoices().length) return false;
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    s.speak(u);
    return true;
}

/** Say a direction; resolves to how it was said ("tts", "speechSynthesis" or "none"). */
export async function speak(text: string): Promise<"tts" | "speechSynthesis" | "none"> {
    if (serviceWorks !== false) {
        try {
            await call("luna://com.webos.service.tts/speak", { text, language: "en-US", clear: true }, { timeoutMs: 3000 });
            serviceWorks = true;
            return "tts";
        } catch {
            serviceWorks = false;
        }
    }
    return synth(text) ? "speechSynthesis" : "none";
}

export function stopSpeaking(): void {
    if (serviceWorks) void call("luna://com.webos.service.tts/stop", {}).catch(() => {});
    (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis?.cancel();
}
