// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What Videos, Podcasts, PDF View and Doc View use from the system, against
// the simulated services in runtime/phoenix-runtime.js: apps registered for
// file types (appinfo.json "mimeTypes"), Email's getResourceInfo and
// open {target}, HTTP through the dev server's proxy, the download
// manager, audio focus, and finding documents.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { call, subscribe } from "./bridge";
import { findFiles, isWebAddress, openTarget, readTarget, targetName } from "./documents";
import { openWith } from "./files";
import { apps } from "./services";
import { audioFocus } from "./playback";
import { downloadManager, httpRequest, httpText } from "./web";

const REPO = resolve(__dirname, "../../../..");
const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];

// Installed apps as phoenix-sim / serve-rootfs.py report them, with the types they open.
const APPS = [
    { id: "org.webosphoenix.videos", launchPointId: "org.webosphoenix.videos_default", title: "Videos",
      mimeTypes: [{ mime: "video/webm", extension: "webm", stream: true }, { mime: "video/mp4", extension: "mp4", stream: true }] },
    { id: "org.webosphoenix.pdfview", launchPointId: "org.webosphoenix.pdfview_default", title: "PDF View",
      mimeTypes: [{ mime: "application/pdf", extension: "pdf" }] },
    { id: "org.webosphoenix.docview", launchPointId: "org.webosphoenix.docview_default", title: "Doc View",
      mimeTypes: [{ mime: "application/epub+zip", extension: "epub" }, { mime: "text/plain", extension: "txt" }] },
    { id: "org.webosphoenix.photos", launchPointId: "org.webosphoenix.photos_default", title: "Photos" },
];

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }) };
    new Function(readFileSync(resolve(REPO, "runtime/phoenix-runtime.js"), "utf8")).call(window);
    const files: Record<string, string> = {
        "/usr/share/phoenix/apps.json": JSON.stringify(APPS),
        "/media/internal/samples/index.json": readFileSync(resolve(REPO, "apps/media-samples/media/index.json"), "utf8"),
        "/usr/share/phoenix/runtime/sample-data.js": readFileSync(resolve(REPO, "runtime/sample-data.js"), "utf8"),
    };
    (w.PalmSystem as { getResource: (p: string) => string | undefined }).getResource = (p: string) => files[p];
});

beforeEach(() => {
    localStorage.clear();
    hostMessages.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

const lastHost = (type: string) => [...hostMessages].reverse().find((m) => m.type === type);

describe("apps registered for file types", () => {
    it("lists the registered apps first, then the built-in ones", async () => {
        expect((await openWith.handlers("video/webm")).map((h) => h.appId)).toEqual(["org.webosphoenix.videos", "org.webosphoenix.photos"]);
        expect((await openWith.handlers("application/pdf")).map((h) => h.appId)).toEqual(["org.webosphoenix.pdfview"]);
        expect(await openWith.handlers("application/x-unknown")).toEqual([]);
    });

    it("answers Email's getResourceInfo by extension, and says what can stream", async () => {
        const pdf = await call("luna://com.webos.applicationManager/getResourceInfo", { uri: "file:///media/internal/Downloads/Report%20Q3.pdf", mime: "application/octet-stream" }) as Record<string, unknown>;
        expect(pdf).toMatchObject({ appIdByExtension: "org.webosphoenix.pdfview", mimeByExtension: "application/pdf", canStream: false });
        const web = await call("luna://com.webos.applicationManager/getResourceInfo", { uri: "https://example.org/clip.webm" }) as Record<string, unknown>;
        expect(web).toMatchObject({ appIdByExtension: "org.webosphoenix.videos", canStream: true });
        await expect(call("luna://com.webos.applicationManager/getResourceInfo", { uri: "file:///x.unknown" })).rejects.toThrow(/No handler/);
    });

    it("opens a file with the app for its type, and a web page in the browser", async () => {
        await call("luna://com.webos.applicationManager/open", { target: "file:///media/internal/samples/documents/the-lighthouse-cat.epub" });
        expect(lastHost("launch")?.payload).toEqual({ id: "org.webosphoenix.docview", params: { target: "file:///media/internal/samples/documents/the-lighthouse-cat.epub" } });
        await call("luna://com.webos.applicationManager/open", { target: "https://example.org/guide.pdf" });
        expect(lastHost("launch")?.payload.id).toBe("org.webosphoenix.pdfview");
        await call("luna://com.webos.applicationManager/open", { target: "https://example.org/index.html" });
        expect(lastHost("launch")?.payload.id).toBe("com.palm.app.browser");
    });
});

describe("launching an app", () => {
    it("asks for another card only when told ({newCard}: the Assistant's Open in New Card)", async () => {
        await apps.launch("org.webosphoenix.assistant", { conversationId: "t1" });
        expect(lastHost("launch")?.payload).toEqual({ id: "org.webosphoenix.assistant", params: { conversationId: "t1" } });
        await apps.launch("org.webosphoenix.assistant", { conversationId: "t2" }, { newCard: true });
        expect(lastHost("launch")?.payload).toEqual({ id: "org.webosphoenix.assistant", params: { conversationId: "t2" }, newCard: true });
    });
});

describe("launch targets", () => {
    it("turns file://, storage:// and plain paths into paths, and keeps web addresses", () => {
        expect(openTarget({ target: "file:///media/internal/My%20Book.epub" })).toBe("/media/internal/My Book.epub");
        expect(openTarget({ imageList: { results: [{ uri: "storage:///media/internal/DCIM/a.webm" }] } })).toBe("/media/internal/DCIM/a.webm");
        expect(openTarget({ target: "https://example.org/a.pdf?x=1" })).toBe("https://example.org/a.pdf?x=1");
        expect(openTarget({ target: "relative/path" })).toBeNull();
        expect(openTarget({})).toBeNull();
        expect(isWebAddress("http://x")).toBe(true);
        expect(targetName("https://example.org/files/Annual%20Report.pdf?dl=1")).toBe("Annual Report.pdf");
        expect(targetName("/a/b.txt", "Attachment.txt")).toBe("Attachment.txt");
    });

    it("finds documents on the device by extension, newest first", async () => {
        const found = await findFiles(["pdf", "epub"]);
        expect(found.map((f) => f.name)).toEqual(expect.arrayContaining(["field-guide.pdf", "the-lighthouse-cat.epub"]));
        expect(found.find((f) => f.name === "the-lighthouse-cat.epub")?.kind).toBe("book");
        expect(await findFiles(["nothing"])).toEqual([]);
    });

    it("reads a file through the file manager", async () => {
        const bytes = await readTarget("/media/internal/Documents/Welcome.txt");
        expect(new TextDecoder().decode(bytes)).toMatch(/^Welcome to webOS Phoenix/);
    });
});

describe("HTTP and downloads (through serve-rootfs.py's proxy)", () => {
    // The dev server's proxy; progress answers GET /__phoenix/proxy/progress
    // (the download manager asks while a body comes).
    const proxy = (answer: (req: Record<string, unknown>) => Record<string, unknown>,
                   progress: () => Record<string, unknown> = () => ({})) => {
        const seen: Record<string, unknown>[] = [];
        vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
            if (url.startsWith("/__phoenix/proxy/progress?id="))
                return { json: async () => progress() } as unknown as Response;
            expect(url).toBe("/__phoenix/proxy");
            const req = JSON.parse(init.body) as Record<string, unknown>;
            seen.push(req);
            return { json: async () => answer(req) } as unknown as Response;
        }));
        return seen;
    };

    it("sends requests through the proxy, following redirects", async () => {
        const seen = proxy(() => ({ status: 200, headers: { "content-type": "application/rss+xml" }, body: "<rss/>", url: "https://example.org/feed2" }));
        expect(await httpText("https://example.org/feed")).toBe("<rss/>");
        expect(seen[0]).toMatchObject({ url: "https://example.org/feed", method: "GET", follow: true, binary: false });
        const res = await httpRequest({ url: "https://example.org/feed" });
        expect(res.url).toBe("https://example.org/feed2");
    });

    it("rejects on an HTTP error, and passes the proxy's network errors on", async () => {
        proxy(() => ({ status: 404, headers: {}, body: "no" }));
        await expect(httpText("https://example.org/missing")).rejects.toThrow(/HTTP 404/);
        proxy(() => ({ error: "getaddrinfo ENOTFOUND", code: "ENOTFOUND" }));
        await expect(httpText("https://nowhere.invalid/")).rejects.toThrow(/ENOTFOUND/);
    });

    it("downloads into /media/internal and reports progress", async () => {
        const seen = proxy(() => ({ status: 200, headers: { "content-type": "audio/ogg" }, bodyBase64: btoa("OggS-episode-bytes"), url: "https://example.org/ep1.ogg" }));
        const progress: number[] = [];
        const h = downloadManager.download("https://example.org/ep1.ogg", "/media/internal/podcasts/test", "ep1.ogg", (f) => progress.push(f));
        await expect(h.done).resolves.toBe("/media/internal/podcasts/test/ep1.ogg");
        expect(seen[0]).toMatchObject({ binary: true, follow: true });
        expect(progress.length).toBeGreaterThan(0);
        const blob = await (window as unknown as { __phoenixRuntime: { mediaFiles: { read(p: string): Promise<Blob> } } })
            .__phoenixRuntime.mediaFiles.read("/media/internal/podcasts/test/ep1.ogg");
        expect(blob.size).toBe("OggS-episode-bytes".length);
        const hist = await call("luna://com.webos.service.downloadmanager/getAllHistory", {}) as unknown as { items: { destFile: string; completed: boolean }[] };
        expect(hist.items[0]).toMatchObject({ destFile: "ep1.ogg", completed: true });
    });

    it("shows a download as an ongoing activity with the proxy's progress, and lists it as the browser reads it", async () => {
        // The body takes a while; meanwhile the proxy says how far it is.
        let release: () => void = () => {};
        const arrived = new Promise<void>((r) => { release = r; });
        let received = 0;
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (url.startsWith("/__phoenix/proxy/progress?id="))
                return { json: async () => ({ received, total: 8192 }) } as unknown as Response;
            await arrived;
            return { json: async () => ({ status: 200, headers: { "content-type": "application/pdf" }, bodyBase64: btoa("%PDF".padEnd(8192, "x")), url: "https://example.org/r.pdf" }) } as unknown as Response;
        }));
        const progress: { amountReceived?: number; amountTotal?: number; completed?: boolean }[] = [];
        // As the browser asks (its ongoing activity opens its Downloads drawer).
        const ps = (window as unknown as { PalmSystem: { appIdentifier: string } }).PalmSystem;
        const appId = ps.appIdentifier;
        ps.appIdentifier = "com.palm.app.browser";
        onTestFinished(() => { ps.appIdentifier = appId; });
        const sub = subscribe("luna://com.palm.downloadmanager/download", { target: "https://example.org/r.pdf", mime: "application/pdf" },
            (r) => progress.push(r as never));
        await new Promise((r) => setTimeout(r, 20));
        expect(lastHost("ongoing")?.payload).toMatchObject({ id: "download-" + String((progress[0] as { ticket?: number }).ticket), title: "r.pdf", appId: "com.palm.app.browser", params: { toasterOpen: "downloads" } });
        received = 2048;
        await vi.waitFor(() => expect(lastHost("ongoing")?.payload).toMatchObject({ progress: 25, body: "Downloading 2 KB of 8 KB" }), { timeout: 2000 });
        expect(progress.some((p) => p.amountReceived === 2048 && p.amountTotal === 8192)).toBe(true);
        release();
        await vi.waitFor(() => expect(progress[progress.length - 1]).toMatchObject({ completed: true, completionStatusCode: 200,
            destPath: "/media/internal/Downloads/", destFile: "r.pdf" }), { timeout: 2000 });
        expect(lastHost("ongoing")?.payload).toMatchObject({ clear: true });
        sub.cancel();
        // Isis lists finished downloads from the history: state, fileExistsOnFilesys and the record.
        const hist = await call("luna://com.palm.downloadmanager/getAllHistory", {}) as unknown as
            { items: { state: string; fileExistsOnFilesys: boolean; recordString: string }[] };
        const item = hist.items[hist.items.length - 1];
        expect(item).toMatchObject({ state: "completed", fileExistsOnFilesys: true });
        expect(JSON.parse(item.recordString)).toMatchObject({ destFile: "r.pdf", destPath: "/media/internal/Downloads/" });
    });

    it("fails a download outside /media/internal, or of a missing file", async () => {
        await expect(downloadManager.download("https://example.org/a", "/etc", "a").done).rejects.toThrow(/under \/media\/internal/);
        proxy(() => ({ status: 404, headers: {}, bodyBase64: "" }));
        await expect(downloadManager.download("https://example.org/gone.mp3", "/media/internal/downloads", "gone.mp3").done).rejects.toThrow(/404/);
    });
});

describe("audio focus", () => {
    it("tells the app that had it when another takes it", async () => {
        const lost: string[] = [];
        const music = audioFocus.request(() => lost.push("music"));
        await new Promise((r) => setTimeout(r, 10));
        const videos = audioFocus.request(() => lost.push("videos"));
        await new Promise((r) => setTimeout(r, 10));
        expect(lost).toEqual(["music"]);
        const status = await call("luna://com.webos.service.audiofocusmanager/getStatus", {}) as unknown as { audioFocusStatus: { streamType: string }[] };
        expect(status.audioFocusStatus[0]).toMatchObject({ streamType: "pmedia" });
        const replies: string[] = [];
        const sub = subscribe("luna://com.webos.service.audiofocusmanager/requestFocus", { requestType: "AFREQUEST_GAIN", streamType: "pmedia", displayId: 0 },
            (r) => replies.push(String((r as { result?: string }).result)));
        await new Promise((r) => setTimeout(r, 10));
        expect(replies).toEqual(["AF_GRANTED"]);
        expect(lost).toEqual(["music", "videos"]);
        sub.cancel(); music.cancel(); videos.cancel();
        const released = await call("luna://com.webos.service.audiofocusmanager/releaseFocus", { streamType: "pmedia", displayId: 0 }) as unknown as { result: string };
        expect(released.result).toBe("AF_SUCCESSFULLY_RELEASED");
    });
});
