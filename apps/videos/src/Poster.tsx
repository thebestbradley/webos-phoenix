// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A still of a video for the library: a frame a little way in, drawn once
// from a hidden <video> onto a canvas and kept (as a small JPEG) in the
// app's localStorage. The media indexer on OSE extracts no video
// thumbnails, so the app makes its own.

import { useEffect, useState } from "react";
import { Glyph } from "@phoenix/ui";
import { playableUrl } from "./platform";

const CACHE_KEY = "org.webosphoenix.videos:posters";
const MAX_POSTERS = 60;
const W = 192, H = 108;

type Cache = Record<string, { url: string; at: number }>;

function readCache(): Cache {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Cache; } catch { return {}; }
}
function remember(key: string, url: string) {
    const c = readCache();
    c[key] = { url, at: Date.now() };
    const keys = Object.keys(c);
    if (keys.length > MAX_POSTERS) keys.sort((a, b) => c[a].at - c[b].at).slice(0, keys.length - MAX_POSTERS).forEach((k) => delete c[k]);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* full: draw again next time */ }
}

// One at a time: decoding several videos at once is slow on a phone.
let queue: Promise<unknown> = Promise.resolve();

function grab(path: string, at: number): Promise<string> {
    const job = queue.then(() => playableUrl(path)).then((src) => new Promise<string>((resolve, reject) => {
        const v = document.createElement("video");
        v.muted = true;
        v.preload = "auto";
        v.playsInline = true;
        const done = () => { v.removeAttribute("src"); v.load(); };
        const timer = setTimeout(() => { done(); reject(new Error("timeout")); }, 8000);
        v.onloadedmetadata = () => { v.currentTime = Math.min(at, (v.duration || 2) / 3); };
        v.onseeked = () => {
            try {
                const c = document.createElement("canvas");
                c.width = W; c.height = H;
                const ctx = c.getContext("2d")!;
                const scale = Math.max(W / (v.videoWidth || W), H / (v.videoHeight || H));
                const w = (v.videoWidth || W) * scale, h = (v.videoHeight || H) * scale;
                ctx.drawImage(v, (W - w) / 2, (H - h) / 2, w, h);
                resolve(c.toDataURL("image/jpeg", 0.7));
            } catch (e) {
                reject(e);
            } finally {
                clearTimeout(timer);
                done();
            }
        };
        v.onerror = () => { clearTimeout(timer); reject(new Error("cannot decode")); };
        v.src = src;
    }));
    queue = job.catch(() => undefined);
    return job;
}

export function Poster({ path, stamp, duration }: { path: string; stamp: string; duration?: number }) {
    const key = `${path}@${stamp}`;
    const [url, setUrl] = useState<string | undefined>(() => readCache()[key]?.url);
    useEffect(() => {
        if (url) return;
        let live = true;
        grab(path, Math.min(3, (duration ?? 6) / 3)).then((u) => {
            remember(key, u);
            if (live) setUrl(u);
        }, () => {});
        return () => { live = false; };
    }, [key, path, duration, url]);
    return (
        <span className="vi-poster">
            {url ? <img src={url} alt="" draggable={false} /> : <Glyph name="video" size={36} />}
        </span>
    );
}
