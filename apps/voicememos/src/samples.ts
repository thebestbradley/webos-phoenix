// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The demo memos: on first start the app copies the two WAV files it ships
// in samples/ (tools/make-samples.cjs) to /media/internal/voicememos and
// stores them as memos, without transcripts; "Transcribe" makes those, on
// a device with whisper.cpp and in the simulator from the known scripts
// in samples.json. Once only: a memo deleted later stays deleted. A start
// that was stopped part way through (the app closed) finishes the job next
// time, installing only the demo memos not yet there.

import { db, mediaFiles, mediaIndexer } from "@phoenix/luna";
import { MEMO_DIR, MEMO_KIND, MEMO_MIME, searchTextOf, type Memo } from "./memos";

const SEEDED_KEY = "org.webosphoenix.voicememos.seeded";
// Set while the demo memos are being installed.
const SEEDING_KEY = "org.webosphoenix.voicememos.seeding";

export interface SampleMemo {
    file: string;
    path: string;
    title: string;
    created: string;
    duration: number;
    file_size: number;
}

// XHR rather than fetch: phoenix-sim's phoenix:// scheme only serves XHR and elements.
function get(url: string, type: "json" | "blob"): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const req = new XMLHttpRequest();
        req.open("GET", url, true);
        req.responseType = type === "json" ? "text" : "blob";
        req.onload = () => {
            if (req.status >= 200 && req.status < 300 || req.status === 0)
                resolve(type === "json" ? JSON.parse(req.responseText) : req.response);
            else reject(new Error(`${url}: ${req.status}`));
        };
        req.onerror = () => reject(new Error(`${url}: not found`));
        req.send();
    });
}

let seeding: Promise<void> | null = null;

/** Install the demo memos if this is the first start (and there are no memos). */
export function seedDemoMemos(): Promise<void> {
    if (!seeding) seeding = seed().catch((e) => console.warn("[voicememos] the demo memos were not installed", e));
    return seeding;
}

async function seed(): Promise<void> {
    let resuming: boolean;
    try {
        if (localStorage.getItem(SEEDED_KEY)) return;
        resuming = !!localStorage.getItem(SEEDING_KEY);
    } catch { return; }
    const existing = await db.find<Memo>({ from: MEMO_KIND });
    // Someone's own memos, from before this app installed demo ones.
    if (existing.length && !resuming) {
        localStorage.setItem(SEEDED_KEY, "1");
        return;
    }
    localStorage.setItem(SEEDING_KEY, "1");
    const have = new Set(existing.map((m) => m.path));
    const { memos } = await get("samples/samples.json", "json") as { memos: SampleMemo[] };
    for (const s of memos) {
        if (!s.path.startsWith(MEMO_DIR + "/") || have.has(s.path)) continue;
        const blob = await get("samples/" + s.file, "blob") as Blob;
        await mediaFiles.write(s.path, new Blob([blob], { type: MEMO_MIME }));
        const memo: Omit<Memo, "_id"> = {
            _kind: MEMO_KIND, title: s.title, path: s.path, duration: s.duration, size: s.file_size, created: s.created,
            mimeType: MEMO_MIME, searchText: searchTextOf(s.title), sample: true,
        };
        await db.put([memo]);
    }
    localStorage.setItem(SEEDED_KEY, "1");
    localStorage.removeItem(SEEDING_KEY);
    await mediaIndexer.scan(MEMO_DIR);
}
