// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Memos are saved as 16 kHz mono 16-bit WAV: what whisper.cpp reads
// without converting (so the device needs no ffmpeg for them), plenty for
// speech, and a file every player and the media indexer know. MediaRecorder
// gives WebM/Opus; recorder.ts decodes and resamples it, and this writes
// the file.

export const MEMO_RATE = 16000;

/** A PCM WAV file of mono samples (-1..1). */
export function encodeWav(samples: Float32Array, rate = MEMO_RATE): Uint8Array {
    const bytes = new Uint8Array(44 + samples.length * 2);
    const v = new DataView(bytes.buffer);
    const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
    ascii(0, "RIFF");
    v.setUint32(4, 36 + samples.length * 2, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    v.setUint32(16, 16, true);          // fmt chunk size
    v.setUint16(20, 1, true);           // PCM
    v.setUint16(22, 1, true);           // mono
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);    // bytes per second
    v.setUint16(32, 2, true);           // block align
    v.setUint16(34, 16, true);          // bits per sample
    ascii(36, "data");
    v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        v.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
    }
    return bytes;
}

export interface WavInfo {
    rate: number;
    channels: number;
    bits: number;
    /** Seconds. */
    duration: number;
}

/** Format and length of a PCM WAV file, or null if it is not one. */
export function wavInfo(bytes: Uint8Array): WavInfo | null {
    if (bytes.length < 44) return null;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
    let fmt: Omit<WavInfo, "duration"> | null = null;
    for (let at = 12; at + 8 <= bytes.length;) {
        const size = v.getUint32(at + 4, true);
        if (tag(at) === "fmt " && at + 24 <= bytes.length) {
            if (v.getUint16(at + 8, true) !== 1) return null;
            fmt = { channels: v.getUint16(at + 10, true), rate: v.getUint32(at + 12, true), bits: v.getUint16(at + 22, true) };
        } else if (tag(at) === "data" && fmt) {
            const frames = Math.min(size, bytes.length - at - 8) / (fmt.channels * fmt.bits / 8);
            return { ...fmt, duration: frames / fmt.rate };
        }
        at += 8 + size + (size & 1);
    }
    return null;
}

/**
 * How loud a block of samples is, 0-1 for the level meter: the RMS in
 * decibels, -54 dBFS (and quieter) at 0, full scale at 1.
 */
export function levelOf(samples: Float32Array): number {
    if (!samples.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    if (rms <= 0) return 0;
    const db = 20 * Math.log10(rms);
    return Math.max(0, Math.min(1, (db + 54) / 54));
}
