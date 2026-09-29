// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Files client: path and formatting helpers, and the calls against the
// simulated org.webosphoenix.filemanager, com.palm.appinstaller and "Open
// with" in runtime/phoenix-runtime.js.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, LunaError } from "./bridge";
import {
    appInstaller, baseName, extensionOf, FILE_ERRORS, fileManager, fileUrl, formatMode, formatOctal, formatSize, isInside,
    joinPath, kindOf, looksLikeText, mimeOf, opensAsText, openWith, parentOf, sortEntries, uniqueName, validFileName,
    type FileEntry, type InstallStatus,
} from "./files";
import { mediaFiles } from "./media";

const REPO = resolve(__dirname, "../../../..");
const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }) };
    new Function(readFileSync(resolve(REPO, "runtime/phoenix-runtime.js"), "utf8")).call(window);
    // The seed reads the demo media index with PalmSystem.getResource (a
    // synchronous request jsdom cannot serve).
    const files: Record<string, string> = {
        "/media/internal/samples/index.json": readFileSync(resolve(REPO, "apps/media-samples/media/index.json"), "utf8"),
        "/usr/share/phoenix/runtime/sample-data.js": readFileSync(resolve(REPO, "runtime/sample-data.js"), "utf8"),
    };
    (w.PalmSystem as { getResource: (p: string) => string | undefined }).getResource = (p: string) => files[p];
});

beforeEach(() => {
    localStorage.clear();
    hostMessages.length = 0;
});

const code = (e: unknown) => (e instanceof LunaError ? e.errorCode : undefined);
const names = (entries: FileEntry[]) => entries.map((e) => e.name).sort();
const entry = (name: string, type: FileEntry["type"], size = 0, mtime = 0): FileEntry =>
    ({ name, path: "/x/" + name, type, size, mtime, mode: 0o644 });

describe("paths and formatting", () => {
    it("joins, splits and compares paths", () => {
        expect(joinPath("/media/internal", "Documents", "../Music/")).toBe("/media/internal/Music");
        expect(joinPath("/", "..")).toBe("/");
        expect(parentOf("/media/internal/a.txt")).toBe("/media/internal");
        expect(parentOf("/media")).toBe("/");
        expect(baseName("/media/internal/")).toBe("internal");
        expect(extensionOf("Photo.JPG")).toBe("jpg");
        expect(extensionOf(".bashrc")).toBe("");
        expect(isInside("/a/b/c", "/a/b")).toBe(true);
        expect(isInside("/a/bc", "/a/b")).toBe(false);
        expect(isInside("/anything", "/")).toBe(true);
    });

    it("makes unique names and checks them", () => {
        expect(uniqueName("notes.txt", ["notes.txt", "notes 2.txt"])).toBe("notes 3.txt");
        expect(uniqueName("Folder", ["Folder"])).toBe("Folder 2");
        expect(uniqueName("new.txt", [])).toBe("new.txt");
        expect(validFileName("ok name.txt")).toBe(true);
        for (const bad of ["", "  ", "a/b", ".", ".."]) expect(validFileName(bad)).toBe(false);
    });

    it("knows file kinds and MIME types", () => {
        expect(kindOf({ name: "x", type: "directory" })).toBe("folder");
        expect(kindOf({ name: "a.PNG", type: "file" })).toBe("image");
        expect(kindOf({ name: "song.ogg", type: "file" })).toBe("audio");
        expect(kindOf({ name: "app_1.0_all.ipk", type: "file" })).toBe("package");
        expect(kindOf({ name: "hostname", type: "file" })).toBe("text");
        expect(mimeOf("a.jpg")).toBe("image/jpeg");
        expect(mimeOf("blob.bin")).toBe("application/octet-stream");
        expect(mimeOf("Personal.kdbx")).toBe("application/x-keepass2");
        expect(opensAsText({ name: "a.txt", type: "file", size: 10 })).toBe(true);
        expect(opensAsText({ name: "a.jpg", type: "file", size: 10 })).toBe(false);
        expect(opensAsText({ name: "data", type: "file", size: 1 << 20 })).toBe(false);
        expect(looksLikeText("hello\nworld\t!")).toBe(true);
        expect(looksLikeText("PK\x03\x04\x00\x00")).toBe(false);
    });

    it("formats sizes and permissions", () => {
        expect(formatSize(0)).toBe("0 B");
        expect(formatSize(912)).toBe("912 B");
        expect(formatSize(1434)).toBe("1.4 KB");
        expect(formatSize(23 * 1024)).toBe("23 KB");
        expect(formatSize(4.2 * 1024 * 1024)).toBe("4.2 MB");
        expect(formatMode(0o755, "directory")).toBe("drwxr-xr-x");
        expect(formatMode(0o644, "file")).toBe("-rw-r--r--");
        expect(formatOctal(0o644)).toBe("0644");
    });

    it("sorts folders first, then by name, size or date", () => {
        const list = [entry("b.txt", "file", 5, 3), entry("Zed", "directory", 0, 1), entry("a10.txt", "file", 50, 1),
                      entry("a9.txt", "file", 1, 9), entry("apps", "directory", 0, 7)];
        expect(sortEntries(list, "name").map((e) => e.name)).toEqual(["apps", "Zed", "a9.txt", "a10.txt", "b.txt"]);
        expect(sortEntries(list, "size").map((e) => e.name)).toEqual(["apps", "Zed", "a10.txt", "b.txt", "a9.txt"]);
        expect(sortEntries(list, "date").map((e) => e.name)).toEqual(["apps", "Zed", "a9.txt", "b.txt", "a10.txt"]);
    });
});

describe("org.webosphoenix.filemanager (simulated)", () => {
    it("seeds /media/internal like a webOS phone", async () => {
        expect(names(await fileManager.list("/media/internal"))).toEqual(
            [".thumbnails", "Documents", "Downloads", "Music", "Pictures", "ringtones", "samples"]);
        const docs = await fileManager.list("/media/internal/Documents");
        expect(docs.map((e) => e.name)).toContain("Welcome.txt");
        expect(docs.every((e) => e.type === "file" && e.size > 0 && e.mtime > 0)).toBe(true);
        const pics = await fileManager.list("/media/internal/Pictures");
        expect(pics.length).toBe(3);
        expect(pics.every((e) => kindOf(e) === "image" && e.size > 1000)).toBe(true);
        const apps = await fileManager.list("/usr/palm/applications");
        expect(apps.map((e) => e.name)).toContain("org.webosphoenix.files");
        expect(apps.every((e) => e.readOnly)).toBe(true);
        expect(await fileManager.readText("/etc/hostname")).toBe("webos-phoenix\n");
    });

    it("stats files and folders", async () => {
        const f = await fileManager.stat("/media/internal/Documents/Welcome.txt");
        expect(f).toMatchObject({ name: "Welcome.txt", path: "/media/internal/Documents/Welcome.txt", type: "file", mode: 0o644 });
        const d = await fileManager.stat("/media/internal/Documents");
        expect(d).toMatchObject({ type: "directory", count: 3 });
        expect(code(await fileManager.stat("/nope").catch((e) => e))).toBe(FILE_ERRORS.NOT_FOUND);
    });

    it("makes folders, writes, reads and renames files", async () => {
        await fileManager.mkdir("/media/internal/Work");
        expect(code(await fileManager.mkdir("/media/internal/Work").catch((e) => e))).toBe(FILE_ERRORS.EXISTS);
        expect(code(await fileManager.mkdir("/media/internal/No/Such").catch((e) => e))).toBe(FILE_ERRORS.NOT_FOUND);
        const w = await fileManager.writeText("/media/internal/Work/café.txt", "crème brûlée\n");
        expect(w.size).toBe(16);
        expect(await fileManager.readText("/media/internal/Work/café.txt")).toBe("crème brûlée\n");
        expect(atob(await fileManager.readBase64("/media/internal/Work/café.txt")).length).toBe(16);
        expect(code(await fileManager.writeText("/media/internal/Work/café.txt", "x", false).catch((e) => e))).toBe(FILE_ERRORS.EXISTS);

        await fileManager.writeBase64("/media/internal/Work/bytes.bin", btoa("\x00\x01\x02\xff"));
        expect(await fileManager.readBase64("/media/internal/Work/bytes.bin")).toBe(btoa("\x00\x01\x02\xff"));

        await fileManager.move("/media/internal/Work/café.txt", "/media/internal/Work/menu.txt");
        expect(names(await fileManager.list("/media/internal/Work"))).toEqual(["bytes.bin", "menu.txt"]);
        expect(code(await fileManager.readText("/media/internal/Work").catch((e) => e))).toBe(FILE_ERRORS.IS_DIR);
        expect(code(await fileManager.list("/media/internal/Work/menu.txt").catch((e) => e))).toBe(FILE_ERRORS.NOT_DIR);
        expect(code(await fileManager.readText("/media/internal/Work/menu.txt", 4).catch((e) => e))).toBe(FILE_ERRORS.TOO_LARGE);
    });

    it("copies and moves folders recursively", async () => {
        await fileManager.copy("/media/internal/Documents", "/media/internal/Backup");
        expect(names(await fileManager.list("/media/internal/Backup"))).toEqual(names(await fileManager.list("/media/internal/Documents")));
        expect(code(await fileManager.copy("/media/internal/Documents", "/media/internal/Backup").catch((e) => e))).toBe(FILE_ERRORS.EXISTS);
        await fileManager.copy("/media/internal/Documents/Welcome.txt", "/media/internal/Backup/Welcome.txt", true);
        expect(code(await fileManager.copy("/media/internal/Backup", "/media/internal/Backup/inner").catch((e) => e))).toBe(FILE_ERRORS.INVALID);

        await fileManager.move("/media/internal/Backup", "/media/internal/Downloads/Backup");
        expect(code(await fileManager.stat("/media/internal/Backup").catch((e) => e))).toBe(FILE_ERRORS.NOT_FOUND);
        expect(await fileManager.readText("/media/internal/Downloads/Backup/Shopping list.txt")).toMatch(/Coffee/);

        // A copy of a demo photo still reads from the rootfs file.
        await fileManager.copy("/media/internal/Pictures/harbor-dusk.jpg", "/media/internal/Downloads/harbor.jpg");
        expect((await fileManager.stat("/media/internal/Downloads/harbor.jpg")).size).toBe(34221);
        expect(await fileUrl("/media/internal/Downloads/harbor.jpg")).toBe("/media/internal/samples/photos/harbor-dusk.jpg");
    });

    it("removes files and folders", async () => {
        await fileManager.mkdir("/media/internal/Tmp");
        await fileManager.writeText("/media/internal/Tmp/a.txt", "a");
        expect(code(await fileManager.remove("/media/internal/Tmp", false).catch((e) => e))).toBe(FILE_ERRORS.NOT_EMPTY);
        await fileManager.remove("/media/internal/Tmp");
        expect(names(await fileManager.list("/media/internal"))).not.toContain("Tmp");
        expect(code(await fileManager.remove("/media/internal/Tmp").catch((e) => e))).toBe(FILE_ERRORS.NOT_FOUND);
    });

    it("keeps system files read-only", async () => {
        const denied = FILE_ERRORS.PERMISSION;
        expect(code(await fileManager.writeText("/etc/hostname", "x").catch((e) => e))).toBe(denied);
        expect(code(await fileManager.mkdir("/usr/palm/applications/evil").catch((e) => e))).toBe(denied);
        expect(code(await fileManager.remove("/usr").catch((e) => e))).toBe(denied);
        expect(code(await fileManager.remove("/").catch((e) => e))).toBe(denied);
        expect(code(await fileManager.move("/etc/hosts", "/tmp/hosts").catch((e) => e))).toBe(denied);
        // Copies of system files are the user's.
        await fileManager.copy("/etc/hosts", "/tmp/hosts");
        await fileManager.writeText("/tmp/hosts", "127.0.0.1 phoenix\n");
        expect((await fileManager.stat("/tmp/hosts")).readOnly).toBeUndefined();
    });

    it("rejects bad parameters", async () => {
        expect(code(await call("luna://org.webosphoenix.filemanager/list", { path: "relative" }).catch((e) => e))).toBe(FILE_ERRORS.BAD_PARAMS);
        expect(code(await call("luna://org.webosphoenix.filemanager/write", { path: "/tmp/x" }).catch((e) => e))).toBe(FILE_ERRORS.BAD_PARAMS);
        expect(code(await call("luna://org.webosphoenix.filemanager/read", { path: "/etc/hosts", encoding: "latin1" }).catch((e) => e)))
            .toBe(FILE_ERRORS.BAD_PARAMS);
        const e = await call("luna://org.webosphoenix.filemanager/mkdir", {}).catch((x) => x);
        expect(e).toBeInstanceOf(LunaError);
        expect(e.reply).toMatchObject({ returnValue: false, errorCode: -1 });
        expect(typeof e.errorText).toBe("string");
    });

    it("lists the pictures other apps stored (Camera) and deletes them there too", async () => {
        const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
        await mediaFiles.write("/media/internal/DCIM/100PHNX/CIMG0001.jpg", jpeg);
        expect(names(await fileManager.list("/media/internal/DCIM/100PHNX"))).toEqual(["CIMG0001.jpg"]);
        expect(await fileManager.readBase64("/media/internal/DCIM/100PHNX/CIMG0001.jpg")).toBe(btoa("\xff\xd8\xff\xd9"));
        await fileManager.copy("/media/internal/DCIM/100PHNX/CIMG0001.jpg", "/media/internal/Pictures/shot.jpg");
        expect((await fileManager.stat("/media/internal/Pictures/shot.jpg")).size).toBe(4);
        await fileManager.remove("/media/internal/DCIM/100PHNX/CIMG0001.jpg");
        const rt = (window as unknown as { __phoenixRuntime: { mediaFiles: { list(p: string): Promise<string[]> } } }).__phoenixRuntime;
        expect(await rt.mediaFiles.list("/media/internal/DCIM/")).toEqual([]);
        expect(await fileManager.list("/media/internal/DCIM/100PHNX")).toEqual([]);
    });
});

describe("installing and opening files (simulated)", () => {
    it("installs an .ipk through com.palm.appinstaller", async () => {
        const seen: InstallStatus[] = [];
        const r = await appInstaller.install("/media/internal/Downloads/org.example.hello_1.0.0_all.ipk", (s) => seen.push(s));
        expect(r.status).toBe("SUCCESS");
        expect(seen.map((s) => s.status)).toEqual(["STARTING", "IPKG_INSTALL", "SUCCESS"]);
        expect(await appInstaller.install("/media/internal/Documents/Welcome.txt").catch((e) => e.message)).toMatch(/ipk/);
        expect(code(await appInstaller.install("/media/internal/none.ipk").catch((e) => e))).toBe(FILE_ERRORS.NOT_FOUND);
    });

    it("finds apps for a MIME type and opens files", async () => {
        expect((await openWith.handlers("image/jpeg")).map((h) => h.appId)).toEqual(["org.webosphoenix.photos"]);
        expect((await openWith.handlers("audio/ogg")).map((h) => h.appId)).toEqual(["org.webosphoenix.music"]);
        expect(await openWith.handlers("application/pdf")).toEqual([]);
        await openWith.launch("org.webosphoenix.photos", "/media/internal/Pictures/aurora.jpg");
        expect(hostMessages.find((m) => m.type === "launch")?.payload).toMatchObject(
            { id: "org.webosphoenix.photos", params: { target: "/media/internal/Pictures/aurora.jpg" } });
        await openWith.open("/media/internal/Documents/Trip notes.md");
        expect(hostMessages.find((m) => m.type === "open")?.payload.target).toBe("file:///media/internal/Documents/Trip%20notes.md");
    });
});
