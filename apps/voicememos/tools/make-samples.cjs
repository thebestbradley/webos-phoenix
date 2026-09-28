#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Generates the two demo memos Voice Memos puts in /media/internal/voicememos
// on first start, into public/samples/ (the app's samples/ folder):
//
//   *.wav          16 kHz mono 16-bit WAV, the format the app records and
//                  whisper.cpp reads; each sentence is spoken by eSpeak NG
//                  and joined with short pauses
//   samples.json   per memo: file, title, date, duration, the script as the
//                  known transcript (text and per-sentence segments), and
//                  the file's size and FNV-1a hash, by which the simulated
//                  org.webosphoenix.transcriber recognises a demo memo
//
// The speech is synthetic (no one's voice) and the scripts are ours;
// dedicated to the public domain (CC0 1.0). The files are committed; rerun
// after changing a script:
//
//   node apps/voicememos/tools/make-samples.cjs
//
// Needs espeak-ng and ffmpeg on the PATH.

"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "public", "samples");
const DEVICE_DIR = "/media/internal/voicememos";
const RATE = 16000;
const VOICE = "en-gb";   // the clearest for speech recognition of eSpeak NG's English voices
const SPEED = 140;       // words per minute

const MEMOS = [
    {
        title: "Welcome to Voice Memos",
        created: "2026-09-01T08:10:00Z",
        sentences: [
            "Welcome to Voice Memos.",
            "Record a memo with the red button, then tap Transcribe to turn it into text.",
        ],
    },
    {
        title: "Shopping list",
        created: "2026-09-20T17:40:00Z",
        sentences: [
            "Remember to pick up coffee beans and batteries on the way home.",
            "And a birthday card for Sam.",
        ],
    },
];

/** memo-YYYYMMDD-HHMMSS.wav, the name the app gives a recording (memos.ts memoFileName). */
function fileName(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `memo-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.wav`;
}

/** One sentence as 16 kHz mono samples, silence trimmed. */
function speak(text) {
    const wav = execFileSync("espeak-ng", ["-v", VOICE, "-s", String(SPEED), "--stdout", text]);
    const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", "pipe:0", "-ar", String(RATE), "-ac", "1", "-f", "s16le", "pipe:1"], { input: wav });
    const s = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
    let a = 0, b = s.length;
    while (a < b && Math.abs(s[a]) < 200) a++;
    while (b > a && Math.abs(s[b - 1]) < 200) b--;
    return s.slice(a, b);
}

function wavFile(samples) {
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + samples.length * 2, 4); h.write("WAVE", 8);
    h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write("data", 36); h.writeUInt32LE(samples.length * 2, 40);
    return Buffer.concat([h, Buffer.from(samples.buffer, samples.byteOffset, samples.length * 2)]);
}

/** 32-bit FNV-1a, hex (the simulated transcriber computes the same). */
function fnv1a(bytes) {
    let h = 0x811c9dc5;
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    return h.toString(16).padStart(8, "0");
}

const round = (s) => Math.round(s * 100) / 100;

fs.mkdirSync(OUT, { recursive: true });
const out = [];
for (const memo of MEMOS) {
    const lead = Math.round(RATE * 0.4), gap = Math.round(RATE * 0.45), tail = Math.round(RATE * 0.5);
    const parts = [new Int16Array(lead)];
    const segments = [];
    let at = lead;
    memo.sentences.forEach((text, i) => {
        if (i) { parts.push(new Int16Array(gap)); at += gap; }
        const s = speak(text);
        segments.push({ start: round(at / RATE), end: round((at + s.length) / RATE), text });
        parts.push(s);
        at += s.length;
    });
    parts.push(new Int16Array(tail));
    const all = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    const bytes = wavFile(all);
    const file = fileName(memo.created);
    fs.writeFileSync(path.join(OUT, file), bytes);
    out.push({
        file,
        path: `${DEVICE_DIR}/${file}`,
        title: memo.title,
        created: memo.created,
        duration: round(all.length / RATE),
        language: "en",
        text: memo.sentences.join(" "),
        segments,
        file_size: bytes.length,
        fnv1a: fnv1a(bytes),
    });
    console.log("wrote", path.relative(process.cwd(), path.join(OUT, file)), `${round(all.length / RATE)} s`);
}
fs.writeFileSync(path.join(OUT, "samples.json"), JSON.stringify({
    "//": "Generated by tools/make-samples.cjs. The demo memos Voice Memos copies to /media/internal/voicememos on first start, with their scripts; the simulated org.webosphoenix.transcriber (runtime/phoenix-runtime.js) knows them by file_size and fnv1a.",
    memos: out,
}, null, 2) + "\n");
console.log("wrote", path.relative(process.cwd(), path.join(OUT, "samples.json")));
