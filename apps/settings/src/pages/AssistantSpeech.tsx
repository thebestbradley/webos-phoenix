// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant, Voice: the voice answers are spoken with, how fast,
// and Play Sample to hear them (org.webosphoenix.tts speak with the voice
// and the speed). The voice only where the speech engine has voices to
// choose from: Kitten TTS's eight (docs/AI-AND-MCP.md, Speech); the speed
// wherever there is speech (every engine takes one: shell/native/speech.cpp).
// The choices are the assistant's speechVoice and speechRate settings.

import { useEffect, useState } from "react";
import { SPEECH_RATES, tts, type AssistantSettings } from "@phoenix/luna";
import { Button, ListSelector, Row } from "@phoenix/ui";

/** Kitten's voices by the names KittenML gave them (its 0.8 model's voice_aliases). */
const NAMES: Record<string, string> = {
    "expr-voice-2-f": "Bella", "expr-voice-2-m": "Jasper", "expr-voice-3-f": "Luna", "expr-voice-3-m": "Bruno",
    "expr-voice-4-f": "Rosie", "expr-voice-4-m": "Hugo", "expr-voice-5-f": "Kiki", "expr-voice-5-m": "Leo",
};
/** phoenix-tts's default: the warmest of them (the lowest spectral centroid of
 *  the women's voices, an unhurried pace; measured, docs/AI-AND-MCP.md). */
export const DEFAULT_VOICE = "expr-voice-3-f";
export const SAMPLE = "Hi, I'm your assistant. Ask me to set an alarm, call a friend, or check the weather.";

export function voiceLabel(id: string): string {
    const name = NAMES[id] || id;
    return id === DEFAULT_VOICE ? `${name} (warm, the default)` : name;
}

export function SpeakingVoice({ settings, set, off }: { settings: AssistantSettings; set: (c: Partial<AssistantSettings>) => void; off: boolean }) {
    const [speech, setSpeech] = useState<{ available: boolean; voices: string[] }>({ available: false, voices: [] });
    const [playing, setPlaying] = useState(false);
    useEffect(() => {
        let live = true;
        tts.status().then((s) => { if (live) setSpeech({ available: s.available, voices: s.voices }); }, () => {});
        return () => { live = false; };
    }, []);
    const { voices } = speech;
    if (!speech.available && !voices.length) return null;
    const value = settings.speechVoice && voices.includes(settings.speechVoice) ? settings.speechVoice
        : voices.includes(DEFAULT_VOICE) ? DEFAULT_VOICE : voices[0];
    const rate = SPEECH_RATES.some((r) => r.value === settings.speechRate) ? settings.speechRate : 1;
    const play = () => {
        setPlaying(true);
        tts.speak(SAMPLE, "en", value, rate).catch(() => {}).finally(() => setPlaying(false));
    };
    return (
        <>
            {voices.length > 0 && (
                <ListSelector title="Speaking voice" value={value} disabled={off} testId="as-speech-voice"
                              options={voices.map((v) => ({ label: voiceLabel(v), value: v }))}
                              onChange={(v) => set({ speechVoice: v })} />
            )}
            <ListSelector title="Speaking speed" value={rate} disabled={off} testId="as-speech-rate"
                          options={SPEECH_RATES} onChange={(v) => set({ speechRate: v })} />
            <Row title="Hear it" disabled={off}>
                <Button data-testid="as-speech-sample" busy={playing} disabled={off} onClick={play}>Play Sample</Button>
            </Row>
        </>
    );
}
