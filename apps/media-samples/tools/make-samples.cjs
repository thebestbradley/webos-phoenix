#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Generates the demo media that Photos and Music find on a fresh device:
//
// into media/ (mounted at /media/internal/samples, runtime/rootfs.json):
//
//   photos/*.jpg        procedural landscapes (no people, no real photos)
//   music/*.ogg         short chiptunes, synthesized here and encoded as
//                       Ogg Opus (32 kbit/s mono)
//   music/art/*.jpg     album art
//   index.json          what a media indexer would extract from the files
//                       (title, artist, album, duration, size...), read by
//                       the simulated com.webos.service.mediaindexer
//
// Everything is drawn or synthesized by this script, deterministically, and
// dedicated to the public domain (CC0 1.0). The files are committed; rerun
// after changing a scene or a song:
//
//   node apps/media-samples/tools/make-samples.cjs
//
// Needs Playwright with Chromium (canvas for the pictures, WebCodecs'
// AudioEncoder for Opus). The Ogg container is written here.

"use strict";
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* fall back to the global install */ }
    const root = require("child_process").execSync("npm root -g").toString().trim();
    return require(path.join(root, "playwright"));
}

const OUT = path.join(__dirname, "..", "media");
const DEVICE_DIR = "/media/internal/samples";

// ---- Pictures (drawn in the page with canvas 2D) --------------------------------------

// Each scene is the body of function(ctx, w, h, rnd) run in the browser.
const PHOTOS = [
    { file: "harbor-dusk.jpg", title: "Harbor at Dusk", w: 640, h: 480, taken: "2011-06-18T20:41:00Z", draw: `
        let g = ctx.createLinearGradient(0, 0, 0, h * 0.62);
        g.addColorStop(0, "#1d2a5c"); g.addColorStop(0.45, "#b8566b"); g.addColorStop(0.8, "#f4a259"); g.addColorStop(1, "#ffd28a");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        glow(w * 0.62, h * 0.56, 90, "rgba(255,230,160,0.9)"); disc(w * 0.62, h * 0.56, 26, "#fff4d0");
        clouds(8, 0.1, 0.45, "rgba(120,60,90,0.45)");
        g = ctx.createLinearGradient(0, h * 0.6, 0, h);
        g.addColorStop(0, "#6d4a64"); g.addColorStop(1, "#131a33");
        ctx.fillStyle = g; ctx.fillRect(0, h * 0.6, w, h * 0.4);
        for (let i = 0; i < 70; ++i) { const y = h * 0.61 + Math.pow(rnd(), 1.6) * h * 0.38, x = w * 0.62 + (rnd() - 0.5) * (30 + (y - h * 0.6) * 1.2);
            ctx.fillStyle = "rgba(255,210,140," + (0.25 + rnd() * 0.5) + ")"; ctx.fillRect(x, y, 8 + rnd() * 30, 1.5 + rnd() * 2); }
        ctx.fillStyle = "#0c0f1c"; ctx.fillRect(0, h * 0.64, w * 0.34, 10);
        for (let x = 8; x < w * 0.34; x += 34) ctx.fillRect(x, h * 0.64, 5, h * 0.2);
        ctx.fillRect(w * 0.08, h * 0.64 - 40, 4, 40); ctx.fillRect(w * 0.08 - 14, h * 0.64 - 40, 30, 3);
        boat(w * 0.8, h * 0.66, 1.0); boat(w * 0.45, h * 0.7, 0.6);` },
    { file: "alpine-lake.jpg", title: "Alpine Lake", w: 640, h: 480, taken: "2011-08-02T10:12:00Z", draw: `
        let g = ctx.createLinearGradient(0, 0, 0, h * 0.55);
        g.addColorStop(0, "#2f6fb5"); g.addColorStop(1, "#bfe0f5");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        clouds(10, 0.05, 0.3, "rgba(255,255,255,0.8)");
        const ridge = (base, amp, col, snow) => { const pts = []; let y = base;
            for (let x = -10; x <= w + 10; x += 16) { y = base - amp * (0.5 + 0.5 * Math.sin(x / 90 + base)) - rnd() * amp * 0.5; pts.push([x, y]); }
            ctx.beginPath(); ctx.moveTo(-10, h * 0.62); pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(w + 10, h * 0.62); ctx.closePath();
            ctx.fillStyle = col; ctx.fill();
            if (snow) { ctx.save(); ctx.clip(); ctx.fillStyle = "rgba(255,255,255,0.85)"; pts.forEach(p => { if (p[1] < base - amp * 0.75) { ctx.beginPath(); ctx.moveTo(p[0] - 22, p[1] + 26); ctx.lineTo(p[0], p[1] - 2); ctx.lineTo(p[0] + 22, p[1] + 26); ctx.fill(); } }); ctx.restore(); } };
        ridge(h * 0.42, 110, "#6e7f9c", true); ridge(h * 0.52, 70, "#3f5a4c", false); ridge(h * 0.6, 30, "#24402f", false);
        const top = ctx.getImageData(0, 0, w, Math.floor(h * 0.62));
        ctx.save(); ctx.translate(0, h * 1.24); ctx.scale(1, -1); ctx.filter = "blur(2px)";
        const tmp = document.createElement("canvas"); tmp.width = w; tmp.height = top.height; tmp.getContext("2d").putImageData(top, 0, 0);
        ctx.globalAlpha = 0.75; ctx.drawImage(tmp, 0, 0); ctx.restore();
        ctx.fillStyle = "rgba(20,60,90,0.35)"; ctx.fillRect(0, h * 0.62, w, h * 0.38);
        for (let i = 0; i < 90; ++i) { ctx.fillStyle = "rgba(255,255,255," + rnd() * 0.25 + ")"; ctx.fillRect(rnd() * w, h * 0.63 + rnd() * h * 0.37, 10 + rnd() * 40, 1); }` },
    { file: "aurora.jpg", title: "Northern Lights", w: 640, h: 480, taken: "2012-01-22T23:05:00Z", draw: `
        let g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "#030712"); g.addColorStop(0.7, "#0b2233"); g.addColorStop(1, "#0d1f1c");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 260; ++i) disc(rnd() * w, rnd() * h * 0.8, rnd() * 1.3 + 0.2, "rgba(255,255,255," + (0.3 + rnd() * 0.7) + ")");
        ctx.save(); ctx.filter = "blur(10px)"; ctx.globalCompositeOperation = "lighter";
        for (let band = 0; band < 3; ++band) for (let x = 0; x < w; x += 5) {
            const y0 = h * (0.18 + band * 0.1) + Math.sin(x / (70 + band * 30) + band) * 40 + Math.sin(x / 23) * 8;
            const len = 90 + 60 * Math.sin(x / 50 + band * 2) + rnd() * 30;
            const gg = ctx.createLinearGradient(0, y0, 0, y0 + len);
            gg.addColorStop(0, band === 1 ? "rgba(170,90,255,0)" : "rgba(60,255,160,0)");
            gg.addColorStop(0.6, band === 1 ? "rgba(170,90,255,0.35)" : "rgba(60,255,160,0.4)");
            gg.addColorStop(1, "rgba(60,255,160,0)");
            ctx.fillStyle = gg; ctx.fillRect(x, y0, 6, len); }
        ctx.restore();
        ctx.fillStyle = "#02060a";
        for (let x = -10; x < w + 20; x += 14 + rnd() * 10) { const th = 40 + rnd() * 70, bw = 12 + rnd() * 10, by = h * 0.86;
            ctx.beginPath(); ctx.moveTo(x - bw, by); ctx.lineTo(x, by - th); ctx.lineTo(x + bw, by); ctx.fill(); }
        ctx.fillRect(0, h * 0.85, w, h * 0.15);` },
    { file: "dunes.jpg", title: "Dunes", w: 640, h: 480, taken: "2011-10-09T17:30:00Z", draw: `
        let g = ctx.createLinearGradient(0, 0, 0, h * 0.5);
        g.addColorStop(0, "#5b8fc9"); g.addColorStop(1, "#f3d3a1");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        glow(w * 0.2, h * 0.3, 70, "rgba(255,240,200,0.8)");
        for (let i = 0; i < 5; ++i) { const base = h * (0.45 + i * 0.12), amp = 40 - i * 4, ph = rnd() * 6;
            const crest = x => base - amp * Math.sin(x / (120 + i * 25) + ph) - 10;
            ctx.beginPath(); ctx.moveTo(0, h); for (let x = 0; x <= w; x += 4) ctx.lineTo(x, crest(x)); ctx.lineTo(w, h); ctx.closePath();
            const gg = ctx.createLinearGradient(0, base - amp, 0, base + 80);
            gg.addColorStop(0, ["#f0b46a", "#e59f55", "#d98a45", "#c97536", "#b8642c"][i]); gg.addColorStop(1, "#7a3d1c");
            ctx.fillStyle = gg; ctx.fill();
            ctx.save(); ctx.clip(); ctx.fillStyle = "rgba(90,40,20,0.35)";
            ctx.beginPath(); ctx.moveTo(0, h); for (let x = 0; x <= w; x += 4) ctx.lineTo(x + 30 + 20 * Math.sin(x / 80), crest(x) + 4); ctx.lineTo(w, h); ctx.fill(); ctx.restore(); }` },
    { file: "city-lights.jpg", title: "City Lights", w: 640, h: 480, taken: "2011-12-03T18:52:00Z", draw: `
        let g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "#0e1740"); g.addColorStop(0.55, "#553a7a"); g.addColorStop(0.8, "#e0766b"); g.addColorStop(1, "#1a1026");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        for (let layer = 0; layer < 3; ++layer) { let x = -20;
            while (x < w) { const bw = 30 + rnd() * 50, bh = (layer === 0 ? 120 : layer === 1 ? 180 : 110) + rnd() * (layer === 1 ? 200 : 110), by = h - bh;
                ctx.fillStyle = ["#2a2346", "#17142a", "#0a0914"][layer]; ctx.fillRect(x, by, bw, bh);
                if (layer > 0) for (let wy = by + 8; wy < h - 10; wy += 11) for (let wx = x + 5; wx < x + bw - 6; wx += 9)
                    if (rnd() < 0.35) { ctx.fillStyle = "rgba(255," + (190 + rnd() * 60 | 0) + ",120," + (0.5 + rnd() * 0.5) + ")"; ctx.fillRect(wx, wy, 4, 5); }
                x += bw + rnd() * 6; } }
        ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.filter = "blur(6px)";
        for (let i = 0; i < 26; ++i) disc(rnd() * w, h * 0.75 + rnd() * h * 0.25, 8 + rnd() * 18, "rgba(255," + (120 + rnd() * 100 | 0) + ",60,0.35)");
        ctx.restore();` },
    { file: "meadow.jpg", title: "Meadow", w: 640, h: 480, taken: "2011-05-14T14:20:00Z", draw: `
        let g = ctx.createLinearGradient(0, 0, 0, h * 0.5);
        g.addColorStop(0, "#3d86d6"); g.addColorStop(1, "#cfe8f7");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        clouds(9, 0.05, 0.35, "rgba(255,255,255,0.85)");
        const hill = (base, amp, fr, c0, c1) => { ctx.beginPath(); ctx.moveTo(0, h);
            for (let x = 0; x <= w; x += 4) ctx.lineTo(x, base - amp * Math.sin(x / fr + base));
            ctx.lineTo(w, h); ctx.closePath(); const gg = ctx.createLinearGradient(0, base - amp, 0, h); gg.addColorStop(0, c0); gg.addColorStop(1, c1); ctx.fillStyle = gg; ctx.fill(); };
        hill(h * 0.5, 30, 140, "#7fb069", "#4a7a3a"); hill(h * 0.62, 26, 110, "#6aa84f", "#2f5d23"); hill(h * 0.78, 20, 90, "#5b9a3c", "#24471a");
        for (let i = 0; i < 420; ++i) { const y = h * 0.62 + Math.pow(rnd(), 0.7) * h * 0.38, s = 1 + (y - h * 0.6) / 50;
            disc(rnd() * w, y, s, ["#fff6a8", "#ffffff", "#f7a1c4", "#c9a7ff", "#ffd166"][i % 5]); }
        ctx.save(); ctx.filter = "blur(3px)"; for (let i = 0; i < 40; ++i) disc(rnd() * w, h * 0.93 + rnd() * h * 0.07, 5 + rnd() * 6, i % 2 ? "#ffe066" : "#ffffff"); ctx.restore();` },
    { file: "petals.jpg", title: "Petals", w: 480, h: 640, taken: "2012-04-28T11:03:00Z", draw: `
        let g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, h * 0.7);
        g.addColorStop(0, "#35613a"); g.addColorStop(1, "#0f2413");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.save(); ctx.filter = "blur(14px)"; for (let i = 0; i < 18; ++i) disc(rnd() * w, rnd() * h, 20 + rnd() * 40, "rgba(" + (120 + rnd() * 120 | 0) + ",200,120,0.35)"); ctx.restore();
        const cx = w / 2, cy = h * 0.47;
        for (let ring = 0; ring < 3; ++ring) { const n = 12 - ring * 2, len = 170 - ring * 45, wid = 46 - ring * 8;
            for (let i = 0; i < n; ++i) { const a = (i / n) * Math.PI * 2 + ring * 0.3;
                ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
                const pg = ctx.createLinearGradient(0, 0, len, 0);
                pg.addColorStop(0, "#7a1036"); pg.addColorStop(0.35, "#e0457b"); pg.addColorStop(1, ring === 2 ? "#ffd0e0" : "#ff9cbf");
                ctx.fillStyle = pg; ctx.beginPath(); ctx.moveTo(0, 0);
                ctx.bezierCurveTo(len * 0.3, -wid, len * 0.9, -wid * 0.8, len, 0); ctx.bezierCurveTo(len * 0.9, wid * 0.8, len * 0.3, wid, 0, 0); ctx.fill();
                ctx.strokeStyle = "rgba(120,10,50,0.25)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(len * 0.85, 0); ctx.stroke();
                ctx.restore(); } }
        disc(cx, cy, 22, "#f5c542"); for (let i = 0; i < 60; ++i) { const a = rnd() * 6.28, r = rnd() * 20; disc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.6, "#8a5a00"); }` },
];

// Helpers available to every scene.
const SCENE_HELPERS = `
    const disc = (x, y, r, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    const glow = (x, y, r, c) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c); g.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); };
    const clouds = (n, y0, y1, c) => { ctx.save(); ctx.filter = "blur(8px)"; for (let i = 0; i < n; ++i) { const x = rnd() * w, y = h * (y0 + rnd() * (y1 - y0));
        for (let j = 0; j < 5; ++j) { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x + j * 18 - 36, y + (j % 2) * 6, 34, 14, 0, 0, Math.PI * 2); ctx.fill(); } } ctx.restore(); };
    const boat = (x, y, s) => { ctx.fillStyle = "#0b0e1a"; ctx.beginPath(); ctx.moveTo(x - 40 * s, y); ctx.lineTo(x + 40 * s, y); ctx.lineTo(x + 30 * s, y + 10 * s); ctx.lineTo(x - 30 * s, y + 10 * s); ctx.fill();
        ctx.fillRect(x - 2 * s, y - 70 * s, 3 * s, 70 * s); ctx.beginPath(); ctx.moveTo(x + 2 * s, y - 66 * s); ctx.lineTo(x + 34 * s, y - 6 * s); ctx.lineTo(x + 2 * s, y - 6 * s); ctx.fill(); };
`;

const GRAIN = `
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    ctx.putImageData(img, 0, 0);
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.35)"); ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
`;

// ---- Music ------------------------------------------------------------------------------

const ALBUMS = {
    "Cartridge Dreams": { artist: "Pixel Sunrise", art: "cartridge-dreams.jpg", colors: ["#ff6b6b", "#ffd93d", "#2b1055"], year: 2010 },
    "Service Calls": { artist: "Luna Bus", art: "service-calls.jpg", colors: ["#4cc9f0", "#4361ee", "#10002b"], year: 2011 },
    "Low Tide": { artist: "Chip Harbor", art: "low-tide.jpg", colors: ["#80ed99", "#22577a", "#0b132b"], year: 2012 },
};

// Songs: tempo (bpm), key (MIDI root), progression (scale degrees of a
// major/minor key), lead duty cycle, seed, bars.
const SONGS = [
    { file: "morning-boot.ogg", title: "Morning Boot", album: "Cartridge Dreams", track: 1, bpm: 132, root: 60, minor: false, prog: [0, 4, 5, 3], duty: 0.25, seed: 11, bars: 12 },
    { file: "card-shuffle.ogg", title: "Card Shuffle", album: "Cartridge Dreams", track: 2, bpm: 150, root: 62, minor: true, prog: [0, 5, 2, 6], duty: 0.5, seed: 23, bars: 14 },
    { file: "gesture-area.ogg", title: "Gesture Area", album: "Cartridge Dreams", track: 3, bpm: 118, root: 57, minor: true, prog: [0, 3, 4, 4], duty: 0.125, seed: 5, bars: 10 },
    { file: "just-type.ogg", title: "Just Type", album: "Service Calls", track: 1, bpm: 140, root: 64, minor: false, prog: [0, 3, 0, 4], duty: 0.25, seed: 42, bars: 12 },
    { file: "prelude.ogg", title: "Prelude", album: "Service Calls", track: 2, bpm: 96, root: 55, minor: false, prog: [0, 5, 3, 4], duty: 0.5, seed: 7, bars: 8 },
    { file: "harbor-lights.ogg", title: "Harbor Lights", album: "Low Tide", track: 1, bpm: 108, root: 59, minor: true, prog: [0, 6, 5, 4], duty: 0.25, seed: 99, bars: 10 },
];

const RATE = 48000;

function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function synth(song) {
    const rnd = rng(song.seed);
    const beat = 60 / song.bpm, bar = beat * 4;
    const total = Math.ceil((song.bars * bar + 1.5) * RATE);
    const out = new Float32Array(total);
    const major = [0, 2, 4, 5, 7, 9, 11], minor = [0, 2, 3, 5, 7, 8, 10];
    const scale = song.minor ? minor : major;
    const noteFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
    const deg = (d, oct) => song.root + 12 * (oct + Math.floor(d / 7)) + scale[((d % 7) + 7) % 7];

    // Oscillators write into out with a simple ADSR.
    function tone(t0, dur, freq, kind, vol, duty) {
        const a = 0.005, r = Math.min(0.08, dur * 0.4);
        const i0 = Math.floor(t0 * RATE), n = Math.floor((dur + r) * RATE);
        let ph = 0;
        for (let i = 0; i < n && i0 + i < total; ++i) {
            const t = i / RATE;
            const env = t < a ? t / a : t < dur ? 1 - 0.35 * (t - a) / dur : Math.max(0, (1 - 0.35) * (1 - (t - dur) / r));
            ph = (ph + freq / RATE) % 1;
            let v;
            if (kind === "pulse") v = ph < duty ? 1 : -1;
            else if (kind === "tri") v = 4 * Math.abs(ph - 0.5) - 1;
            else v = Math.sin(ph * 2 * Math.PI);
            out[i0 + i] += v * env * vol;
        }
    }
    let noiseState = 0x1234;
    function noise(t0, dur, vol, bright) {
        const i0 = Math.floor(t0 * RATE), n = Math.floor(dur * RATE);
        let last = 0, held = 0;
        for (let i = 0; i < n && i0 + i < total; ++i) {
            // NES-style LFSR noise, held for a few samples (lower = darker).
            if (i % bright === 0) { const bit = (noiseState ^ (noiseState >> 1)) & 1; noiseState = (noiseState >> 1) | (bit << 14); held = noiseState & 1 ? 1 : -1; }
            last = held;
            out[i0 + i] += last * vol * Math.pow(1 - i / n, 2);
        }
    }
    function kick(t0) {
        const i0 = Math.floor(t0 * RATE), n = Math.floor(0.14 * RATE);
        let ph = 0;
        for (let i = 0; i < n && i0 + i < total; ++i) {
            const f = 140 * Math.pow(0.25, i / n) + 40;
            ph = (ph + f / RATE) % 1;
            out[i0 + i] += (4 * Math.abs(ph - 0.5) - 1) * 0.55 * (1 - i / n);
        }
    }

    // A two-bar motif, varied every other phrase.
    const motif = [];
    for (let i = 0; i < 16; ++i) motif.push(rnd() < 0.18 ? null : Math.floor(rnd() * 5));
    const pent = [0, 1, 2, 4, 5];
    for (let b = 0; b < song.bars; ++b) {
        const t = b * bar;
        const chord = song.prog[b % song.prog.length];
        // Bass (triangle): root, fifth, octave.
        [0, 4, 7, 4].forEach((d, i) => tone(t + i * beat, beat * 0.8, noteFreq(deg(chord + (d === 7 ? 7 : d === 4 ? 4 : 0), -2)), "tri", 0.32));
        // Harmony (pulse 50%): arpeggio of the chord in 16ths, quiet.
        if (b >= 2) for (let i = 0; i < 16; ++i)
            tone(t + i * beat / 4, beat / 4 * 0.7, noteFreq(deg(chord + [0, 2, 4, 7][i % 4], 0)), "pulse", 0.05, 0.5);
        // Lead: the motif over the chord, 8th notes.
        if (b >= 1 && b < song.bars - 1) for (let i = 0; i < 8; ++i) {
            const m = motif[(b % 2) * 8 + i];
            if (m === null) continue;
            const vary = b % 4 >= 2 && i === 7 ? 2 : 0;
            const d = chord + pent[(m + vary) % 5] + (song.minor && pent[m] === 1 ? 0 : 0);
            const len = i % 2 === 0 && motif[(b % 2) * 8 + i + 1] === null ? beat : beat / 2;
            tone(t + i * beat / 2, len * 0.85, noteFreq(deg(d, 1)), "pulse", 0.11, song.duty);
        }
        // Drums.
        if (b >= 1) for (let i = 0; i < 8; ++i) {
            const tt = t + i * beat / 2;
            if (i % 4 === 0) kick(tt);
            if (i % 4 === 2) noise(tt, 0.12, 0.22, 2);
            noise(tt, 0.03, 0.06, 1);
        }
    }
    // Final chord.
    const end = song.bars * bar;
    [0, 2, 4].forEach((d) => tone(end, 1.2, noteFreq(deg(song.prog[0] + d, 0)), "pulse", 0.08, song.duty));
    tone(end, 1.2, noteFreq(deg(song.prog[0], -2)), "tri", 0.3);

    // Gentle low-pass, soft clip, fade in/out.
    let lp = 0;
    for (let i = 0; i < total; ++i) {
        lp += 0.45 * (out[i] - lp);
        let v = Math.tanh(lp * 1.1) * 0.9;
        const t = i / RATE, left = (total - i) / RATE;
        if (t < 0.02) v *= t / 0.02;
        if (left < 1.2) v *= left / 1.2;
        out[i] = v;
    }
    return out;
}

// ---- Ogg Opus container (RFC 7845) -----------------------------------------------------

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; ++i) {
        let r = i << 24;
        for (let j = 0; j < 8; ++j) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
        t[i] = r >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let crc = 0;
    for (let i = 0; i < buf.length; ++i) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0;
    return crc;
}

function oggPage(packets, granule, serial, seq, flags) {
    const lacing = [];
    packets.forEach((p) => {
        let n = p.length;
        while (n >= 255) { lacing.push(255); n -= 255; }
        lacing.push(n);
    });
    const header = Buffer.alloc(27 + lacing.length);
    header.write("OggS", 0, "ascii");
    header[4] = 0;
    header[5] = flags;
    header.writeBigInt64LE(BigInt(granule), 6);
    header.writeUInt32LE(serial, 14);
    header.writeUInt32LE(seq, 18);
    header.writeUInt32LE(0, 22);
    header[26] = lacing.length;
    lacing.forEach((l, i) => { header[27 + i] = l; });
    const page = Buffer.concat([header, ...packets]);
    page.writeUInt32LE(crc32(page), 22);
    return page;
}

function oggOpus(packets, samples, tags) {
    const PRESKIP = 312;
    const serial = 0x50484e58; // "PHNX"
    const head = Buffer.alloc(19);
    head.write("OpusHead", 0, "ascii");
    head[8] = 1; head[9] = 1;
    head.writeUInt16LE(PRESKIP, 10);
    head.writeUInt32LE(RATE, 12);
    head.writeInt16LE(0, 16);
    head[18] = 0;
    const vendor = Buffer.from("webOS Phoenix make-samples", "utf8");
    const comments = Object.entries(tags).map(([k, v]) => Buffer.from(`${k}=${v}`, "utf8"));
    const tagBuf = Buffer.concat([
        Buffer.from("OpusTags", "ascii"), u32(vendor.length), vendor, u32(comments.length),
        ...comments.flatMap((c) => [u32(c.length), c]),
    ]);
    const pages = [oggPage([head], 0, serial, 0, 0x02), oggPage([tagBuf], 0, serial, 1, 0)];
    let seq = 2, granule = PRESKIP;
    for (let i = 0; i < packets.length; i += 50) {
        const chunk = packets.slice(i, i + 50);
        const last = i + 50 >= packets.length;
        granule += chunk.length * 960;
        pages.push(oggPage(chunk, last ? PRESKIP + samples : granule, serial, seq++, last ? 0x04 : 0));
    }
    return Buffer.concat(pages);
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }

// ---- Main -----------------------------------------------------------------------------

async function main() {
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch();
    const page = await browser.newPage();
    // WebCodecs needs a secure context.
    await page.route("https://samples.invalid/**", (r) => r.fulfill({ body: "<!doctype html><body></body>", contentType: "text/html" }));
    await page.goto("https://samples.invalid/");
    fs.mkdirSync(path.join(OUT, "photos"), { recursive: true });
    fs.mkdirSync(path.join(OUT, "music", "art"), { recursive: true });

    const index = { "//": "Generated by tools/make-samples.cjs. What a media indexer extracts from these files; read by the simulated com.webos.service.mediaindexer in runtime/phoenix-runtime.js.", images: [], audios: [] };

    for (const [i, p] of PHOTOS.entries()) {
        const b64 = await page.evaluate(({ w, h, body, seed }) => {
            const c = document.createElement("canvas");
            c.width = w; c.height = h;
            const ctx = c.getContext("2d");
            let s = seed;
            const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
            new Function("ctx", "w", "h", "rnd", body)(ctx, w, h, rnd);
            return c.toDataURL("image/jpeg", 0.8).split(",")[1];
        }, { w: p.w, h: p.h, body: SCENE_HELPERS + p.draw + GRAIN, seed: 1000 + i * 77 });
        const buf = Buffer.from(b64, "base64");
        fs.writeFileSync(path.join(OUT, "photos", p.file), buf);
        index.images.push({
            file_path: `${DEVICE_DIR}/photos/${p.file}`, title: p.title, width: p.w, height: p.h,
            mime: "image/jpeg", file_size: buf.length, last_modified_date: p.taken,
        });
        console.log(`photos/${p.file} ${(buf.length / 1024).toFixed(1)} KB`);
    }

    for (const [name, a] of Object.entries(ALBUMS)) {
        const b64 = await page.evaluate(({ name, artist, colors }) => {
            const c = document.createElement("canvas");
            c.width = c.height = 256;
            const ctx = c.getContext("2d");
            const g = ctx.createLinearGradient(0, 0, 256, 256);
            g.addColorStop(0, colors[2]); g.addColorStop(1, "#000");
            ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
            // Big pixel sun / stripes.
            for (let i = 0; i < 8; ++i) {
                ctx.fillStyle = i % 2 ? colors[0] : colors[1];
                const y = 60 + i * 12;
                const half = Math.sqrt(Math.max(0, 70 * 70 - (y + 6 - 120) ** 2));
                ctx.fillRect(128 - half, y, half * 2, 8);
            }
            ctx.fillStyle = colors[1];
            for (let x = 0; x < 256; x += 16) ctx.fillRect(x, 176 + ((x / 16) % 2) * 4, 12, 4);
            ctx.fillStyle = "#fff";
            ctx.font = "bold 22px DejaVu Sans, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(name, 128, 216);
            ctx.font = "15px DejaVu Sans, sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.75)";
            ctx.fillText(artist, 128, 238);
            return c.toDataURL("image/jpeg", 0.85).split(",")[1];
        }, { name, artist: a.artist, colors: a.colors });
        fs.writeFileSync(path.join(OUT, "music", "art", a.art), Buffer.from(b64, "base64"));
        console.log(`music/art/${a.art}`);
    }

    for (const s of SONGS) {
        const pcm = synth(s);
        const packets = await page.evaluate(async ({ b64, rate }) => {
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; ++i) bytes[i] = bin.charCodeAt(i);
            const data = new Float32Array(bytes.buffer);
            const chunks = [];
            const enc = new AudioEncoder({
                output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); chunks.push(b); },
                error: (e) => { throw e; },
            });
            enc.configure({ codec: "opus", sampleRate: rate, numberOfChannels: 1, bitrate: 32000 });
            const FR = 960;
            for (let i = 0; i < data.length; i += FR) {
                const frame = new Float32Array(FR);
                frame.set(data.subarray(i, i + FR));
                enc.encode(new AudioData({ format: "f32", sampleRate: rate, numberOfFrames: FR, numberOfChannels: 1, timestamp: Math.round(i / rate * 1e6), data: frame }));
            }
            await enc.flush();
            return chunks.map((c) => { let s = ""; c.forEach((x) => { s += String.fromCharCode(x); }); return btoa(s); });
        }, { b64: Buffer.from(pcm.buffer).toString("base64"), rate: RATE });
        const album = ALBUMS[s.album];
        const ogg = oggOpus(packets.map((p) => Buffer.from(p, "base64")), pcm.length, {
            TITLE: s.title, ARTIST: album.artist, ALBUM: s.album, TRACKNUMBER: s.track, GENRE: "Chiptune",
            DATE: album.year, LICENSE: "CC0 1.0 (generated by webOS Phoenix)",
        });
        fs.writeFileSync(path.join(OUT, "music", s.file), ogg);
        index.audios.push({
            file_path: `${DEVICE_DIR}/music/${s.file}`, title: s.title, artist: album.artist, album: s.album,
            album_artist: album.artist, genre: "Chiptune", track: s.track,
            total_tracks: SONGS.filter((x) => x.album === s.album).length, year: album.year,
            duration: Math.round(pcm.length / RATE * 10) / 10, mime: "audio/ogg", file_size: ogg.length,
            thumbnail: `${DEVICE_DIR}/music/art/${album.art}`,
            last_modified_date: `${album.year}-03-0${s.track}T12:00:00Z`,
        });
        console.log(`music/${s.file} ${(ogg.length / 1024).toFixed(1)} KB, ${(pcm.length / RATE).toFixed(1)} s`);
    }

    // Keep what tools/make-videos.cjs and tools/make-documents.cjs added.
    try {
        const prev = JSON.parse(fs.readFileSync(path.join(OUT, "index.json"), "utf8"));
        for (const key of ["videos", "documents"]) if (prev[key]) index[key] = prev[key];
    } catch (e) { /* first run */ }
    fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2) + "\n");
    await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
