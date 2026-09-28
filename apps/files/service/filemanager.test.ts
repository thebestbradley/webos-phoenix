// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device service's methods (filemanager.js) on a temporary folder:
// the same requests and replies as the simulated service.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Reply = { returnValue: boolean; errorCode?: number; errorText?: string; [k: string]: unknown };
type Api = Record<"list" | "stat" | "mkdir" | "copy" | "move" | "remove" | "read" | "write", (p: object) => Promise<Reply>>;
const { createFileManager, ERRORS, METHODS } = createRequire(import.meta.url)("./filemanager.js") as {
    createFileManager(o: { writableRoots: string[] }): Api;
    ERRORS: Record<string, number>;
    METHODS: string[];
};

let root: string, home: string, fm: Api;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "phoenix-files-"));
    home = join(root, "internal");
    mkdirSync(join(home, "Documents"), { recursive: true });
    mkdirSync(join(root, "system"));
    writeFileSync(join(home, "Documents", "a.txt"), "alpha\n");
    writeFileSync(join(root, "system", "hostname"), "phoenix\n");
    fm = createFileManager({ writableRoots: [home] });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const names = (r: Reply) => (r.entries as { name: string }[]).map((e) => e.name).sort();

describe("org.webosphoenix.filemanager (device service)", () => {
    it("has the eight methods", () => {
        expect(METHODS).toEqual(["list", "stat", "mkdir", "copy", "move", "remove", "read", "write"]);
    });

    it("lists and stats", async () => {
        symlinkSync(join(home, "Documents"), join(home, "Docs"));
        const r = await fm.list({ path: home });
        expect(r.returnValue).toBe(true);
        expect(names(r)).toEqual(["Docs", "Documents"]);
        const link = (r.entries as { name: string; link?: boolean; type: string }[]).find((e) => e.name === "Docs");
        expect(link).toMatchObject({ link: true, type: "directory" });
        const s = await fm.stat({ path: join(home, "Documents") });
        expect(s.entry).toMatchObject({ type: "directory", count: 1, name: "Documents" });
        const f = await fm.stat({ path: join(home, "Documents", "a.txt") });
        expect(f.entry).toMatchObject({ type: "file", size: 6 });
        expect((f.entry as { readOnly?: boolean }).readOnly).toBeUndefined();
        expect(((await fm.stat({ path: join(root, "system", "hostname") })).entry as { readOnly?: boolean }).readOnly).toBe(true);
        expect(await fm.list({ path: join(home, "nope") })).toMatchObject({ returnValue: false, errorCode: ERRORS.NOT_FOUND });
        expect(await fm.list({ path: join(home, "Documents", "a.txt") })).toMatchObject({ errorCode: ERRORS.NOT_DIR });
        expect(await fm.list({ path: "relative" })).toMatchObject({ returnValue: false, errorCode: ERRORS.BAD_PARAMS });
    });

    it("makes folders and writes, reads and renames files", async () => {
        expect(await fm.mkdir({ path: join(home, "New") })).toMatchObject({ returnValue: true });
        expect(await fm.mkdir({ path: join(home, "New") })).toMatchObject({ errorCode: ERRORS.EXISTS });
        expect(await fm.write({ path: join(home, "New", "n.txt"), data: "héllo" })).toMatchObject({ size: 6 });
        expect(await fm.write({ path: join(home, "New", "n.txt"), data: "x", overwrite: false })).toMatchObject({ errorCode: ERRORS.EXISTS });
        expect(await fm.read({ path: join(home, "New", "n.txt") })).toMatchObject({ data: "héllo", encoding: "utf8", size: 6 });
        await fm.write({ path: join(home, "b.bin"), data: Buffer.from([0, 1, 255]).toString("base64"), encoding: "base64" });
        expect((await fm.read({ path: join(home, "b.bin"), encoding: "base64" })).data).toBe("AAH/");
        expect(await fm.read({ path: join(home, "b.bin"), maxBytes: 2 })).toMatchObject({ errorCode: ERRORS.TOO_LARGE });
        expect(await fm.read({ path: home })).toMatchObject({ errorCode: ERRORS.IS_DIR });
        await fm.move({ from: join(home, "New", "n.txt"), to: join(home, "New", "m.txt") });
        expect(names(await fm.list({ path: join(home, "New") }))).toEqual(["m.txt"]);
    });

    it("copies and moves folders, and removes them", async () => {
        await fm.copy({ from: join(home, "Documents"), to: join(home, "Backup") });
        expect(readFileSync(join(home, "Backup", "a.txt"), "utf8")).toBe("alpha\n");
        expect(await fm.copy({ from: join(home, "Documents"), to: join(home, "Backup") })).toMatchObject({ errorCode: ERRORS.EXISTS });
        expect(await fm.copy({ from: join(home, "Documents"), to: join(home, "Documents", "x") })).toMatchObject({ errorCode: ERRORS.INVALID });
        expect(await fm.copy({ from: join(home, "Documents"), to: join(home, "Backup"), overwrite: true })).toMatchObject({ returnValue: true });
        await fm.move({ from: join(home, "Backup"), to: join(home, "Documents", "Backup") });
        expect(names(await fm.list({ path: join(home, "Documents") }))).toEqual(["Backup", "a.txt"]);
        expect(await fm.remove({ path: join(home, "Documents") })).toMatchObject({ errorCode: ERRORS.NOT_EMPTY });
        expect(await fm.remove({ path: join(home, "Documents"), recursive: true })).toMatchObject({ returnValue: true });
        expect(names(await fm.list({ path: home }))).toEqual([]);
    });

    it("leaves everything outside the writable roots alone", async () => {
        const denied = { returnValue: false, errorCode: ERRORS.PERMISSION };
        expect(await fm.write({ path: join(root, "system", "hostname"), data: "x" })).toMatchObject(denied);
        expect(await fm.remove({ path: join(root, "system"), recursive: true })).toMatchObject(denied);
        expect(await fm.remove({ path: home, recursive: true })).toMatchObject(denied);
        expect(await fm.move({ from: join(root, "system", "hostname"), to: join(home, "hostname") })).toMatchObject(denied);
        expect(await fm.copy({ from: join(root, "system", "hostname"), to: join(home, "hostname") })).toMatchObject({ returnValue: true });
        expect(readFileSync(join(root, "system", "hostname"), "utf8")).toBe("phoenix\n");
    });
});
