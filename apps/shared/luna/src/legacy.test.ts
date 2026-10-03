// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What legacy webOS apps of 2011 count on from the runtime
// (runtime/phoenix-runtime.js), found with Quickoffice (App Museum II):
// palmGetResource's "const json", Prototype.js's array methods in the same
// page as the services, and webOS 3's index of the documents on the USB
// drive (com.palm.media.misc.file:1).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { call } from "./bridge";

type Win = Record<string, unknown> & { palmGetResource(path: string, flags?: string): unknown };

beforeAll(() => {
    localStorage.clear();
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: () => {} };
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
});

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("legacy webOS apps", () => {
    it("palmGetResource parses JSON when asked ('const json'), as WebAppManager did", () => {
        const w = window as unknown as Win;
        const real = window.XMLHttpRequest;
        class FakeXhr {
            status = 0; responseText = "";
            open(_m: string, path: string) { this.path = path; }
            path = "";
            send() {
                this.status = this.path.endsWith("appinfo.json") ? 200 : 404;
                this.responseText = "﻿" + JSON.stringify({ id: "com.example.app", version: "2.2.247" });
            }
        }
        (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
        try {
            // Quickoffice: enyo.fetchAppInfo().version.charAt(0)
            expect(w.palmGetResource("appinfo.json", "const json")).toEqual({ id: "com.example.app", version: "2.2.247" });
            expect(typeof w.palmGetResource("appinfo.json")).toBe("string");
            expect(w.palmGetResource("missing.json", "const json")).toBeUndefined();
        } finally {
            (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = real;
        }
    });

    it("keeps the standard some, every and find when a page's Prototype.js replaces them", async () => {
        // QOWT's Prototype build: some/every/find throw $break, which its
        // Array#each (a plain loop) does not catch.
        const $break = {};
        const proto = Array.prototype as unknown as Record<string, unknown>;
        const broken = function (this: unknown[], f: (x: unknown) => boolean) {
            for (const x of this) if (f(x)) throw $break;
            return false;
        };
        proto.some = broken;
        proto.every = broken;
        proto.find = broken;
        expect([1, 2, 3].some((x) => x === 2)).toBe(true);
        expect([1, 2, 3].every((x) => x > 0)).toBe(true);
        expect([1, 2, 3].find((x) => x === 3)).toBe(3);
        expect(Object.keys(Array.prototype)).not.toContain("some");
        // The services that use them, as Quickoffice's account lookup does.
        const r = await call("luna://com.palm.db/find", { query: { from: "com.palm.account:1",
            where: [{ prop: "capabilityProviders.capability", op: "=", val: ["DOCUMENTS", "LOCAL.FILESTORAGE"] }] } });
        expect(r.returnValue).toBe(true);
    });

    it("lists the documents on the USB drive in com.palm.media.misc.file:1, as webOS 3's indexer did", async () => {
        await tick(10);
        const find = async () => (await call("luna://com.palm.db/find", { query: { from: "com.palm.media.misc.file:1" } }))
            .results as Record<string, unknown>[];
        const docs = await find();
        const list = docs.find((d) => d.path === "/media/internal/Documents/Shopping list.txt");
        expect(list).toMatchObject({ name: "Shopping list", extension: "txt", mimeType: "text/plain", searchKey: "shopping_list" });
        expect(list!.size).toBeGreaterThan(0);
        expect(typeof list!.modifiedTime).toBe("number");
        // Not pictures, nor hidden folders.
        expect(docs.every((d) => /\.(txt|pdf|docx?|xlsx?|pptx?|rtf|csv|od[tsp])$/.test(String(d.path)))).toBe(true);

        // A new document joins the list; a removed one leaves it.
        await call("luna://org.webosphoenix.filemanager/write", { path: "/media/internal/Documents/Budget.csv", data: "a,b\n1,2\n" });
        expect((await find()).some((d) => d.path === "/media/internal/Documents/Budget.csv")).toBe(true);
        await call("luna://org.webosphoenix.filemanager/remove", { path: "/media/internal/Documents/Budget.csv" });
        expect((await find()).some((d) => d.path === "/media/internal/Documents/Budget.csv")).toBe(false);
    });
});
