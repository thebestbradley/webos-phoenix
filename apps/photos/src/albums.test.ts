// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CAMERA_DIR, type MediaItem } from "@phoenix/luna";
import { albumName, countLabel, groupAlbums } from "./albums";

const item = (path: string, date: string, type: "image" | "video" = "image"): MediaItem =>
    ({ uri: "storage://" + path, file_path: path, type, last_modified_date: date });

describe("albums", () => {
    it("puts the Camera Roll first, even when it is empty", () => {
        const a = groupAlbums([item("/media/internal/samples/photos/a.jpg", "2011-01-01T00:00:00Z")]);
        expect(a.map((x) => x.name)).toEqual(["Camera Roll", "Sample Photos"]);
        expect(a[0].items).toEqual([]);
    });

    it("groups by folder, newest first, and names unknown folders after them", () => {
        const a = groupAlbums([
            item(CAMERA_DIR + "/CIMG0001.jpg", "2012-01-01T00:00:00Z"),
            item(CAMERA_DIR + "/CIMG0002.webm", "2012-02-01T00:00:00Z", "video"),
            item("/media/internal/holiday/beach.jpg", "2011-07-01T00:00:00Z"),
        ]);
        expect(a.map((x) => x.name)).toEqual(["Camera Roll", "Holiday"]);
        expect(a[0].items.map((i) => i.file_path)).toEqual([CAMERA_DIR + "/CIMG0002.webm", CAMERA_DIR + "/CIMG0001.jpg"]);
        expect(countLabel(a[0].items)).toBe("1 photo, 1 video");
        expect(countLabel(a[1].items)).toBe("1 photo");
        expect(albumName("/media/internal/wallpapers")).toBe("Wallpapers");
    });
});
