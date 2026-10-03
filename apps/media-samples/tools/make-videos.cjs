#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Generates the demo videos that Videos and Photos find on a fresh device,
// into media/videos/ (mounted at /media/internal/samples/videos):
//
//   harbor-timelapse.webm   a harbor from dusk into night, 20 s, with an
//                           English WebVTT and a Spanish SRT subtitle file
//   card-shuffle.webm       webOS-style cards sliding and stacking, 12 s,
//                           with English SRT subtitles
//
// The frames are drawn with canvas in Chromium (Playwright), the sound is
// synthesized here (a soft pad and a few chimes), and ffmpeg encodes them
// as WebM (VP9 video, Opus sound), which every Chromium plays: HTML5 video
// in phoenix-sim's Qt WebEngine and in OSE's web runtime (uMediaServer
// with GStreamer's vp9 and opus decoders). Everything is drawn or
// synthesized by this script and dedicated to the public domain (CC0 1.0);
// the subtitles are written here too. The files are committed; rerun after
// a change:
//
//   node apps/media-samples/tools/make-videos.cjs
//
// Needs Playwright with Chromium and ffmpeg (libvpx-vp9, libopus). Updates
// the "videos" list of media/index.json, keeping the rest.

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* fall back to the global install */ }
    const root = require("child_process").execSync("npm root -g").toString().trim();
    return require(path.join(root, "playwright"));
}

const OUT = path.join(__dirname, "..", "media");
const DEVICE_DIR = "/media/internal/samples";
const W = 480, H = 270, FPS = 24, RATE = 48000;

// ---- Scenes: function bodies (ctx, w, h, t, T) run in the page for each frame -------------

const HARBOR = `
    const k = t / T;                                  // 0 dusk .. 1 night
    const mix = (a, b, f) => a.map((x, i) => Math.round(x + (b[i] - x) * f));
    const rgb = (c) => "rgb(" + c.join(",") + ")";
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.62);
    g.addColorStop(0, rgb(mix([40, 58, 120], [6, 10, 30], k)));
    g.addColorStop(0.55, rgb(mix([214, 110, 120], [34, 30, 70], k)));
    g.addColorStop(1, rgb(mix([255, 196, 128], [70, 50, 80], k)));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // Stars come out.
    for (let i = 0; i < 90; ++i) {
        const rnd = (n) => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };
        const x = rnd(i + 1) * w, y = rnd(i + 101) * h * 0.5, a = Math.max(0, k * 1.6 - 0.4) * (0.4 + 0.6 * ((i * 7) % 10) / 10);
        ctx.fillStyle = "rgba(255,255,255," + a.toFixed(2) + ")"; ctx.fillRect(x, y, 1.5, 1.5);
    }
    // The sun sets behind the water line.
    const sy = h * (0.42 + k * 0.35);
    const sg = ctx.createRadialGradient(w * 0.66, sy, 2, w * 0.66, sy, 70);
    sg.addColorStop(0, "rgba(255,236,170," + (1 - k).toFixed(2) + ")"); sg.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h * 0.62);
    ctx.fillStyle = "rgba(255,244,210," + (1 - k).toFixed(2) + ")"; ctx.beginPath(); ctx.arc(w * 0.66, sy, 18, 0, 7); ctx.fill();
    // Water with moving glints.
    const wg = ctx.createLinearGradient(0, h * 0.62, 0, h);
    wg.addColorStop(0, rgb(mix([110, 74, 100], [20, 22, 48], k))); wg.addColorStop(1, rgb(mix([24, 30, 60], [4, 6, 16], k)));
    ctx.fillStyle = wg; ctx.fillRect(0, h * 0.62, w, h * 0.38);
    for (let i = 0; i < 60; ++i) {
        const y = h * 0.63 + ((i * 37) % 100) / 100 * h * 0.36;
        const x = (i * 71 + t * (8 + (i % 5) * 3)) % (w + 40) - 20;
        ctx.fillStyle = "rgba(255,220,160," + (0.15 + (1 - k) * 0.35).toFixed(2) + ")"; ctx.fillRect(x, y, 12 + (i % 4) * 6, 1.5);
    }
    // The pier and its lamps, lit as night falls.
    ctx.fillStyle = "#0b0e1a"; ctx.fillRect(0, h * 0.64, w * 0.36, 7);
    for (let x = 6; x < w * 0.36; x += 26) ctx.fillRect(x, h * 0.64, 4, h * 0.16);
    for (let x = 30; x < w * 0.36; x += 52) {
        ctx.fillRect(x, h * 0.64 - 30, 3, 30);
        const lit = Math.max(0, Math.min(1, (k - 0.3) * 3));
        const lg = ctx.createRadialGradient(x + 1.5, h * 0.64 - 32, 1, x + 1.5, h * 0.64 - 32, 22);
        lg.addColorStop(0, "rgba(255,210,120," + lit.toFixed(2) + ")"); lg.addColorStop(1, "rgba(255,210,120,0)");
        ctx.fillStyle = lg; ctx.fillRect(x - 22, h * 0.64 - 54, 46, 46); ctx.fillStyle = "#0b0e1a";
    }
    // A boat crosses.
    const bx = -60 + (w + 120) * (t / T), by = h * 0.7;
    ctx.fillStyle = "#0a0c16";
    ctx.beginPath(); ctx.moveTo(bx - 34, by); ctx.lineTo(bx + 34, by); ctx.lineTo(bx + 24, by + 10); ctx.lineTo(bx - 26, by + 10); ctx.fill();
    ctx.fillRect(bx - 2, by - 44, 3, 44);
    ctx.beginPath(); ctx.moveTo(bx + 1, by - 42); ctx.lineTo(bx + 26, by - 4); ctx.lineTo(bx + 1, by - 4); ctx.fill();
    ctx.fillStyle = "rgba(255,220,140," + Math.min(1, k * 2).toFixed(2) + ")"; ctx.fillRect(bx - 12, by - 4, 3, 3);`;

const CARDS = `
    ctx.fillStyle = "#1b1b1b"; ctx.fillRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w / 2, h * 0.3, 10, w / 2, h / 2, w * 0.7);
    bg.addColorStop(0, "#3c4f6b"); bg.addColorStop(1, "#0d1118");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const ease = (x) => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
    const colors = ["#e0a23a", "#3b8fd6", "#b8322a", "#4a9a4f", "#7a4fc0"];
    const names = ["Photos", "Tasks", "Memos", "Music", "Videos"];
    // Five cards slide in one after another, then gather into a stack and fan out again.
    const gather = ease((t - 6) / 2) - ease((t - 9.5) / 2);
    for (let i = 0; i < 5; ++i) {
        const inAt = ease((t - i * 0.8) / 1.2);
        const cw = 110, ch = 170;
        const spread = (i - 2) * 125;
        const x = w / 2 - cw / 2 + spread * (1 - gather * 0.85) + (1 - inAt) * (w + 200);
        const y = h / 2 - ch / 2 + 6 + gather * (i - 2) * 3;
        ctx.save(); ctx.translate(x + cw / 2, y + ch / 2); ctx.rotate((1 - inAt) * 0.2 + gather * (i - 2) * 0.04);
        ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
        ctx.fillStyle = "#e8e6e1"; ctx.beginPath(); ctx.roundRect(-cw / 2, -ch / 2, cw, ch, 9); ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.fillStyle = colors[i]; ctx.beginPath(); ctx.roundRect(-cw / 2, -ch / 2, cw, 30, [9, 9, 0, 0]); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "bold 13px DejaVu Sans, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(names[i], 0, -ch / 2 + 20);
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        for (let r = 0; r < 6; ++r) ctx.fillRect(-cw / 2 + 12, -ch / 2 + 44 + r * 19, cw - 24 - (r % 3) * 14, 8);
        ctx.restore();
    }
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = "12px DejaVu Sans, sans-serif"; ctx.textAlign = "left";
    ctx.fillText("webOS Phoenix", 10, h - 10);`;

const VIDEOS = [
    {
        file: "harbor-timelapse.webm", title: "Harbor Timelapse", seconds: 20, scene: HARBOR, taken: "2012-07-14T21:10:00Z",
        chord: [220, 277.18, 329.63, 440], chimes: [2, 7, 12, 17],
        subtitles: {
            "harbor-timelapse.en.vtt": ["vtt", [
                [1, 4.5, "The harbor at dusk."],
                [5.5, 9.5, "The sun slips under the water line,"],
                [10, 14, "and the lamps on the pier come on."],
                [15, 19.5, "A last boat heads out for the night."],
            ]],
            "harbor-timelapse.es.srt": ["srt", [
                [1, 4.5, "El puerto al atardecer."],
                [5.5, 9.5, "El sol se esconde bajo el agua,"],
                [10, 14, "y se encienden las farolas del muelle."],
                [15, 19.5, "Un último barco sale de noche."],
            ]],
        },
    },
    {
        file: "card-shuffle.webm", title: "Card Shuffle", seconds: 12, scene: CARDS, taken: "2011-02-09T10:00:00Z",
        chord: [261.63, 329.63, 392, 523.25], chimes: [0.3, 1.1, 1.9, 2.7, 3.5, 6.5, 10],
        subtitles: {
            "card-shuffle.srt": ["srt", [
                [0.5, 4, "Every app is a card."],
                [5, 8.5, "Drag cards together to stack them,"],
                [9, 11.5, "and flick one up to close it."],
            ]],
        },
    },
];

// ---- Sound -------------------------------------------------------------------------

function synth(v) {
    const n = Math.round(v.seconds * RATE);
    const out = new Float32Array(n);
    for (let i = 0; i < n; ++i) {
        const t = i / RATE;
        const env = Math.min(1, t / 1.5) * Math.min(1, (v.seconds - t) / 1.5);
        let s = 0;
        v.chord.forEach((f, j) => { s += Math.sin(2 * Math.PI * f * t + j) * (0.05 + 0.02 * Math.sin(t * 0.7 + j)); });
        for (const c of v.chimes) {
            const d = t - c;
            if (d >= 0 && d < 2) s += Math.sin(2 * Math.PI * v.chord[3] * 2 * t) * 0.12 * Math.exp(-d * 3);
        }
        out[i] = s * env;
    }
    return out;
}

function wav(pcm) {
    const buf = Buffer.alloc(44 + pcm.length * 2);
    buf.write("RIFF", 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write("WAVE", 8);
    buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write("data", 36); buf.writeUInt32LE(pcm.length * 2, 40);
    for (let i = 0; i < pcm.length; ++i) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), 44 + i * 2);
    return buf;
}

// ---- Subtitles ---------------------------------------------------------------------

function stamp(s, sep) {
    const ms = Math.round(s * 1000);
    const p = (x, n = 2) => String(x).padStart(n, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
}
function subtitleFile(kind, cues) {
    if (kind === "vtt")
        return "WEBVTT\n\n" + cues.map(([a, b, text]) => `${stamp(a, ".")} --> ${stamp(b, ".")}\n${text}\n`).join("\n");
    return cues.map(([a, b, text], i) => `${i + 1}\n${stamp(a, ",")} --> ${stamp(b, ",")}\n${text}\n`).join("\n");
}

// ---- Main ---------------------------------------------------------------------------

async function main() {
    if (spawnSync("ffmpeg", ["-version"]).status !== 0) throw new Error("ffmpeg is needed");
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent("<canvas></canvas>");
    const dir = path.join(OUT, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-videos-"));
    const list = [];
    for (const v of VIDEOS) {
        const audio = path.join(tmp, "audio.wav");
        fs.writeFileSync(audio, wav(synth(v)));
        const out = path.join(dir, v.file);
        const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-i", audio,
            "-c:v", "libvpx-vp9", "-b:v", "90k", "-deadline", "good", "-cpu-used", "2", "-row-mt", "1", "-pix_fmt", "yuv420p",
            "-g", String(FPS * 2), "-c:a", "libopus", "-b:a", "32k", "-ac", "1", "-shortest", "-fflags", "+bitexact",
            "-map_metadata", "-1", "-metadata", `title=${v.title}`, "-metadata", "LICENSE=CC0 1.0 (generated by webOS Phoenix)", out],
            { stdio: ["pipe", "inherit", "inherit"] });
        const frames = v.seconds * FPS;
        for (let f = 0; f < frames; ++f) {
            const b64 = await page.evaluate(({ body, w, h, t, T }) => {
                const c = document.querySelector("canvas");
                c.width = w; c.height = h;
                new Function("ctx", "w", "h", "t", "T", body)(c.getContext("2d"), w, h, t, T);
                return c.toDataURL("image/png").split(",")[1];
            }, { body: v.scene, w: W, h: H, t: f / FPS, T: v.seconds });
            if (!ff.stdin.write(Buffer.from(b64, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
        }
        ff.stdin.end();
        const code = await new Promise((r) => ff.on("close", r));
        if (code !== 0) throw new Error(`ffmpeg failed for ${v.file}`);
        const size = fs.statSync(out).size;
        const subs = [];
        for (const [name, [kind, cues]] of Object.entries(v.subtitles)) {
            fs.writeFileSync(path.join(dir, name), subtitleFile(kind, cues));
            subs.push(`${DEVICE_DIR}/videos/${name}`);
        }
        list.push({
            file_path: `${DEVICE_DIR}/videos/${v.file}`, title: v.title, width: W, height: H, duration: v.seconds,
            mime: "video/webm", file_size: size, last_modified_date: v.taken, subtitles: subs,
        });
        console.log(`videos/${v.file} ${(size / 1024).toFixed(1)} KB, ${v.seconds} s`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    await browser.close();
    const indexFile = path.join(OUT, "index.json");
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    index.videos = list;
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
