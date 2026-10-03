// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { MediaItem } from "@phoenix/luna";
import { DEFAULT_INTERVAL, PREFS_KEY, loadPrefs, pictureAlbums, savePrefs, slides, step } from "./slideshow";

const item = (file_path: string, date: string, type: "image" | "video" = "image") =>
    ({ uri: "storage://" + file_path, file_path, title: file_path.replace(/^.*\//, ""), last_modified_date: date, type,
       mime: type === "image" ? "image/jpeg" : "video/mp4" }) as MediaItem;

const ITEMS = [
    item("/media/internal/DCIM/100PHNX/a.jpg", "2026-10-01T10:00:00Z"),
    item("/media/internal/DCIM/100PHNX/b.jpg", "2026-10-02T10:00:00Z"),
    item("/media/internal/DCIM/100PHNX/clip.mp4", "2026-10-03T10:00:00Z", "video"),
    item("/media/internal/samples/photos/flower.jpg", "2026-09-01T10:00:00Z"),
    item("/media/internal/samples/videos/demo.mp4", "2026-09-01T10:00:00Z", "video"),
];

describe("the exhibition's slideshow", () => {
    it("shows pictures only, newest first, album by album", () => {
        expect(slides(ITEMS, null).map((it) => it.title)).toEqual(["b.jpg", "a.jpg", "flower.jpg"]);
        expect(pictureAlbums(ITEMS).map((a) => a.name)).toEqual(["Camera Roll", "Sample Photos"]);
        expect(slides(ITEMS, "/media/internal/samples/photos").map((it) => it.title)).toEqual(["flower.jpg"]);
        // An album that is gone: all of them.
        expect(slides(ITEMS, "/media/internal/gone").length).toBe(3);
        expect(slides([], null)).toEqual([]);
    });

    it("goes round and round", () => {
        expect(step(0, 3)).toBe(1);
        expect(step(2, 3)).toBe(0);
        expect(step(0, 3, -1)).toBe(2);
        expect(step(0, 0)).toBe(-1);
    });

    it("keeps its choices, and ignores nonsense", () => {
        const store = new Map<string, string>();
        const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
        expect(loadPrefs(storage)).toEqual({ interval: DEFAULT_INTERVAL, album: null });
        savePrefs({ interval: 10, album: "/media/internal/samples/photos" }, storage);
        expect(loadPrefs(storage)).toEqual({ interval: 10, album: "/media/internal/samples/photos" });
        store.set(PREFS_KEY, JSON.stringify({ interval: 7, album: 3 }));
        expect(loadPrefs(storage)).toEqual({ interval: DEFAULT_INTERVAL, album: null });
        store.set(PREFS_KEY, "{not json");
        expect(loadPrefs(storage).interval).toBe(DEFAULT_INTERVAL);
        // Storage that throws: the defaults, and saving does not fail.
        const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
        expect(loadPrefs(broken)).toEqual({ interval: DEFAULT_INTERVAL, album: null });
        expect(() => savePrefs({ interval: 5, album: null }, broken)).not.toThrow();
    });
});
