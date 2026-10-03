// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.dictation: the shell's microphone and transcriber (the
// keyboard's dictation, whisper.cpp through org.webosphoenix.transcriber)
// for an app that listens without a text field, such as Voice Dial. The
// runtime passes the calls to the shell (runtime/phoenix-runtime.js, block
// "Dictation for the apps").
//
//   start {prompt?, autoStop?, subscribe: true}
//       -> {state: "listening"}, {state: "transcribing"}, then
//          {state: "done", text}; cancel the subscription to stop listening
//          without a transcript
//   stop {}       the speaker is done: transcribe what was heard
//   getStatus {}  -> {available}

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

/** errorCode values of org.webosphoenix.dictation. */
export const DICTATION_ERRORS = {
    BAD_PARAMS: -1,
    /** No microphone or no transcriber here (a browser, a device without one). */
    NOT_AVAILABLE: 1,
    /** The microphone is listening for someone else (the keyboard, another app). */
    IN_USE: 2,
    /** The recording had no speech in it. */
    NOTHING_HEARD: 3,
    /** Recording or transcribing failed. */
    FAILED: 4,
} as const;

export type DictationState = "listening" | "transcribing";

interface StartReply { subscribed?: boolean; state?: DictationState | "done"; text?: string }

declare module "./types" {
    interface LunaApi {
        "luna://org.webosphoenix.dictation/start": {
            params: { prompt?: string; autoStop?: boolean; subscribe?: boolean };
            result: StartReply;
        };
        "luna://org.webosphoenix.dictation/stop": { params: Record<string, never>; result: Record<string, never> };
        "luna://org.webosphoenix.dictation/getStatus": { params: Record<string, never>; result: { available: boolean } };
    }
}

const DICTATION = "luna://org.webosphoenix.dictation";

export interface ListenOptions {
    /** Words to expect (the transcriber's initial prompt), e.g. contact names. */
    prompt?: string;
    /** End by itself once the speaker has finished. */
    autoStop?: boolean;
    onState?: (state: DictationState) => void;
}

export interface Listening {
    /** What was said; rejects with a LunaError (DICTATION_ERRORS). */
    result: Promise<string>;
    /** The speaker is done: transcribe now. */
    stop(): void;
    /** Stop without a transcript (the promise never settles). */
    cancel(): void;
}

export const dictation = {
    /** Listen to the microphone and transcribe what is said. */
    listen(opts: ListenOptions = {}): Listening {
        let sub: Subscription | null = null;
        const result = new Promise<string>((resolve, reject) => {
            sub = subscribe(`${DICTATION}/start`, { prompt: opts.prompt, autoStop: opts.autoStop }, (r) => {
                if (r.state === "done") {
                    sub?.cancel();
                    resolve((r.text ?? "").trim());
                } else if (r.state) {
                    opts.onState?.(r.state);
                }
            }, (e: LunaError) => { sub?.cancel(); reject(e); });
        });
        return {
            result,
            stop() { void call(`${DICTATION}/stop`, {}).catch(() => undefined); },
            cancel() { sub?.cancel(); },
        };
    },
    status(): Promise<{ available: boolean }> {
        return call(`${DICTATION}/getStatus`, {});
    },
};
