// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Recording: the web runtime's getUserMedia and MediaRecorder (WebAppMgr
// is Chromium, as for the Camera's videos), with an AnalyserNode on the
// same stream for the level meter. Pause and resume are MediaRecorder's
// own; the elapsed time leaves the paused stretches out. When it stops,
// toWav() turns the WebM/Opus into the 16 kHz WAV memos are kept in
// (wav.ts).

import { encodeWav, levelOf, MEMO_RATE } from "./wav";

export type RecorderState = "recording" | "paused" | "stopped";

/** The best audio type MediaRecorder offers here, if any. */
export function recorderType(): string | undefined {
    const MR = (globalThis as { MediaRecorder?: { isTypeSupported(t: string): boolean } }).MediaRecorder;
    if (!MR) return undefined;
    return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MR.isTypeSupported(t));
}

export class VoiceRecorder {
    state: RecorderState = "stopped";
    private stream: MediaStream | null = null;
    private recorder: MediaRecorder | null = null;
    private chunks: Blob[] = [];
    private ctx: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private buf: Float32Array<ArrayBuffer> | null = null;
    private startedAt = 0;
    private before = 0;

    /** Ask for the microphone and start. Rejects with the getUserMedia error (NotAllowedError, NotFoundError...). */
    async start(): Promise<void> {
        const md = navigator.mediaDevices;
        if (!md?.getUserMedia) throw Object.assign(new Error("No microphone"), { name: "NotFoundError" });
        this.stream = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        try {
            const AC = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            this.ctx = new AC();
            this.analyser = this.ctx.createAnalyser();
            this.analyser.fftSize = 1024;
            this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
            this.buf = new Float32Array(this.analyser.fftSize);
            void this.ctx.resume().catch(() => {});
        } catch {
            this.analyser = null;   // no meter, the recording still works
        }
        const type = recorderType();
        this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
        this.chunks = [];
        this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
        this.recorder.start(250);
        this.before = 0;
        this.startedAt = performance.now();
        this.state = "recording";
    }

    pause(): void {
        if (this.state !== "recording" || !this.recorder) return;
        this.recorder.pause();
        this.before += performance.now() - this.startedAt;
        this.state = "paused";
    }

    resume(): void {
        if (this.state !== "paused" || !this.recorder) return;
        this.recorder.resume();
        this.startedAt = performance.now();
        this.state = "recording";
    }

    /** Seconds recorded so far, pauses left out. */
    elapsed(): number {
        return (this.before + (this.state === "recording" ? performance.now() - this.startedAt : 0)) / 1000;
    }

    /** The input level now, 0-1 (0 while paused). */
    level(): number {
        if (this.state !== "recording" || !this.analyser || !this.buf) return 0;
        this.analyser.getFloatTimeDomainData(this.buf);
        return levelOf(this.buf);
    }

    /** Stop and hand over what was recorded (null when discarded). */
    stop(keep = true): Promise<Blob | null> {
        const r = this.recorder;
        return new Promise((resolve) => {
            const finish = () => {
                this.release();
                resolve(keep && this.chunks.length ? new Blob(this.chunks, { type: r?.mimeType || "audio/webm" }) : null);
            };
            if (!r || r.state === "inactive") { finish(); return; }
            r.onstop = finish;
            try { r.stop(); } catch { finish(); }
        });
    }

    private release(): void {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
        void this.ctx?.close().catch(() => {});
        this.ctx = null;
        this.analyser = null;
        this.recorder = null;
        this.state = "stopped";
    }
}

/**
 * The recording as a 16 kHz mono WAV: decoded with Web Audio and resampled
 * with an OfflineAudioContext.
 */
export async function toWav(recorded: Blob): Promise<{ blob: Blob; duration: number }> {
    const data = await recorded.arrayBuffer();
    const Offline = globalThis.OfflineAudioContext;
    // decodeAudioData resamples to the context's rate.
    const decoded = await new Offline(1, 1, MEMO_RATE).decodeAudioData(data);
    const frames = Math.max(1, Math.ceil(decoded.duration * MEMO_RATE));
    const mix = new Offline(1, frames, MEMO_RATE);
    const src = mix.createBufferSource();
    src.buffer = decoded;
    src.connect(mix.destination);
    src.start();
    const out = await mix.startRendering();
    const samples = out.getChannelData(0);
    const wav = encodeWav(samples, MEMO_RATE);
    return { blob: new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }), duration: Math.round(samples.length / MEMO_RATE * 100) / 100 };
}
