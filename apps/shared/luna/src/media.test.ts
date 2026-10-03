// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The media client against the simulated media services in
// runtime/phoenix-runtime.js (media indexer, camera2, Phoenix media files,
// the legacy db8 media kinds and a media wallpaper).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "./bridge";
import { LunaError } from "./bridge";
import { CAMERA_DIR, cameraService, deleteMedia, folderOf, mediaFiles, mediaIndexer, mediaUrl, type ImageItem } from "./media";
import { system } from "./services";

const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }) };
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
});

beforeEach(() => {
    localStorage.clear();
    hostMessages.length = 0;
});

// A 1x1 JPEG is enough: the simulator stores bytes, it does not decode them in jsdom.
const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9])], { type: "image/jpeg" });

const nextImages = (pred: (items: ImageItem[]) => boolean) =>
    new Promise<ImageItem[]>((res) => {
        const sub = mediaIndexer.watchImages((items) => { if (pred(items)) { sub.cancel(); res(items); } });
    });

describe("simulated media services", () => {
    it("indexes a stored picture after a scan and forgets it on delete", async () => {
        const path = CAMERA_DIR + "/CIMG0001.jpg";
        const w = await mediaFiles.write(path, JPEG);
        expect(w.file_size).toBe(JPEG.size);
        expect(await mediaIndexer.images()).toEqual([]);
        const seen = nextImages((items) => items.length === 1);
        await mediaIndexer.scan();
        const [item] = await seen;
        expect(item).toMatchObject({ uri: "storage://" + path, file_path: path, type: "image", mime: "image/jpeg", file_size: JPEG.size });
        expect(folderOf(item.file_path)).toBe(CAMERA_DIR);

        // Mirrored into the legacy webOS 2.x kind.
        const legacy = await call("luna://com.palm.db/find", { query: { from: "com.palm.media.image.file:1" } });
        expect((legacy.results as { path: string }[]).map((o) => o.path)).toEqual([path]);

        const url = await mediaUrl(path);
        expect(url.startsWith("blob:") || url === path).toBe(true);

        await deleteMedia(item);
        expect(await mediaIndexer.images()).toEqual([]);
        await mediaIndexer.scan();
        expect(await mediaIndexer.images()).toEqual([]);
    });

    it("answers a subscription with {subscribed} first, as OSE does", async () => {
        const replies: Record<string, unknown>[] = [];
        const { subscribe } = await import("./bridge");
        const sub = subscribe("luna://com.webos.service.mediaindexer/getAudioList", { uri: "storage:///media/internal" }, (r) => replies.push(r));
        // The list follows once the store has been read: wait for it rather
        // than a fixed time, which a busy machine overruns.
        await vi.waitFor(() => expect(replies.length).toBeGreaterThanOrEqual(2), { timeout: 4000 });
        sub.cancel();
        expect(replies[0]).toMatchObject({ subscribed: true });
        expect(replies[1]).toHaveProperty("audioList.count");
    });

    it("refuses paths outside /media/internal and bad counts", async () => {
        await expect(mediaFiles.write("/etc/passwd", JPEG)).rejects.toBeInstanceOf(LunaError);
        await expect(mediaFiles.remove("/media/internal/../etc/x")).rejects.toBeInstanceOf(LunaError);
        await expect(call("luna://com.webos.service.mediaindexer/getImageList", { count: 501 })).rejects.toBeInstanceOf(LunaError);
    });

    it("lists no cameras without video inputs", async () => {
        expect(await cameraService.list()).toEqual([]);
    });

    it("sets a picture as the wallpaper and hands the shell its data", async () => {
        const path = CAMERA_DIR + "/CIMG0002.jpg";
        await mediaFiles.write(path, JPEG);
        await system.setPreferences({ wallpaper: { wallpaperName: "CIMG0002", wallpaperFile: path } });
        const status = [...hostMessages].reverse().find((m) => m.type === "systemStatus")?.payload;
        expect(status?.wallpaperFile).toBe(path);
        expect(String(status?.wallpaperUrl)).toMatch(/^data:image\/jpeg;base64,/);
    });
});
