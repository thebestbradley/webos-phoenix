// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.transcriber, the Phoenix speech-to-text service Voice
// Memos uses. On a device it is the Node.js service in
// apps/voicememos/service, which runs whisper.cpp (whisper-cli) on the
// file; the simulator implements it in runtime/phoenix-runtime.js (block
// "Voice memos"), with known transcripts for the demo memos only.
//
//   transcribe {path, language?, subscribe?}
//       -> with subscribe: {state: "queued" | "converting" | "transcribing",
//          progress: 0-100} while it works, then the result; without, the
//          result only
//       -> {state: "done", progress: 100, text, segments: [{start, end, text}]
//          (seconds), language, engine, placeholder?}
//   getStatus {} -> {engine, installed, model?, modelInstalled?, converter?, live?}
//   listen {language?, subscribe}: simulator only, live captions from the
//       browser's Web Speech API while recording, when getStatus says live
//       -> {text, final: true} per phrase until cancelled
//
// Errors are webOS style (returnValue false, errorCode, errorText);
// TRANSCRIBE_ERRORS lists the codes.

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

/** errorCode values of org.webosphoenix.transcriber. */
export const TRANSCRIBE_ERRORS = {
    /** Missing or bad parameter. */
    BAD_PARAMS: -1,
    /** The file does not exist or is not a file. */
    NOT_FOUND: 1,
    /** whisper.cpp (whisper-cli) is not installed. */
    ENGINE_NOT_INSTALLED: 2,
    /** The speech model file is missing. */
    MODEL_NOT_INSTALLED: 3,
    /** The audio needs converting and ffmpeg is not installed, or converting failed. */
    UNSUPPORTED_FORMAT: 4,
    /** The engine ran and failed. */
    FAILED: 5,
} as const;

export interface TranscriptSegment {
    /** Seconds from the start. */
    start: number;
    end: number;
    text: string;
}

export interface Transcript {
    text: string;
    segments: TranscriptSegment[];
    /** The spoken language ("en"). */
    language?: string;
    /** "whisper.cpp", "simulator", ... */
    engine?: string;
    /**
     * The text is a note about the engine, not what was said (the
     * simulator cannot transcribe a recording). Not shown as a transcript
     * or searched.
     */
    placeholder?: boolean;
}

export type TranscribeState = "queued" | "converting" | "transcribing" | "done";

export interface TranscribeProgress {
    state: TranscribeState;
    /** 0-100. */
    progress: number;
}

export interface TranscriberStatus {
    engine: string;
    installed: boolean;
    /** Path of the model file (whisper.cpp). */
    model?: string;
    modelInstalled?: boolean;
    /** ffmpeg, to convert audio whisper-cli cannot read. */
    converter?: boolean;
    /** listen works here (the simulator in a browser with the Web Speech API). */
    live?: boolean;
}

type TranscribeReply = Partial<Transcript> & Partial<TranscribeProgress> & { subscribed?: boolean };

declare module "./types" {
    interface LunaApi {
        "luna://org.webosphoenix.transcriber/transcribe": {
            params: { path: string; language?: string; subscribe?: boolean };
            result: TranscribeReply;
        };
        "luna://org.webosphoenix.transcriber/getStatus": { params: Record<string, never>; result: TranscriberStatus };
        "luna://org.webosphoenix.transcriber/listen": { params: { language?: string; subscribe?: boolean }; result: { text?: string; final?: boolean; listening?: boolean } };
    }
}

const TR = "luna://org.webosphoenix.transcriber";

/** A reply that carries the result (the last one). */
export function isTranscriptReply(r: TranscribeReply): boolean {
    return r.state === "done" || typeof r.text === "string";
}

export const transcriber = {
    /**
     * transcribe {path, language, subscribe}: onProgress gets every progress
     * reply; the promise settles with the transcript or the error reply.
     */
    transcribe(path: string, language = "en", onProgress?: (p: TranscribeProgress) => void): Promise<Transcript> {
        return new Promise((resolve, reject) => {
            const sub = subscribe(`${TR}/transcribe`, { path, language }, (r) => {
                if (isTranscriptReply(r)) {
                    sub.cancel();
                    resolve({
                        text: (r.text ?? "").trim(),
                        segments: r.segments ?? [],
                        language: r.language,
                        engine: r.engine,
                        ...(r.placeholder ? { placeholder: true } : {}),
                    });
                } else if (r.state) {
                    onProgress?.({ state: r.state, progress: r.progress ?? 0 });
                }
            }, (e: LunaError) => { sub.cancel(); reject(e); });
        });
    },
    /** getStatus: which engine answers and whether it can run. */
    status(): Promise<TranscriberStatus> {
        return call(`${TR}/getStatus`, {});
    },
    /**
     * listen {language, subscribe}: live captions while recording (simulator
     * with the Web Speech API only). onText gets each final phrase; cancel
     * the subscription to stop listening.
     */
    listen(language: string, onText: (text: string) => void, onError?: (e: LunaError) => void): Subscription {
        return subscribe(`${TR}/listen`, { language }, (r) => {
            if (r.final && r.text) onText(r.text);
        }, onError);
    },
};
