// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// How the simulated db8 (runtime/phoenix-runtime.js) keeps its data in the
// localStorage every page shares: each object and kind under a key of its
// own, written only when it changes, so a page whose copy of the store is
// behind cannot put back what another page changed in the meantime
// (tools/test-db8-pages.cjs drives that with real pages).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "./bridge";

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: () => {} };
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

const OBJ = "phoenix:db8:com.palm.db/obj/";
const objectKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(OBJ)).sort();

describe("db8 in the shared store", () => {
    it("keeps each object under a key of its own", async () => {
        const r = await call("luna://com.palm.db/put", { objects: [{ _kind: "org.example.a:1", n: 1 }, { _kind: "org.example.a:1", n: 2 }] });
        const ids = (r.results as { id: string }[]).map((x) => x.id);
        expect(objectKeys().filter((k) => k.includes("++"))).toEqual(ids.map((id) => OBJ + id).sort());
        expect(JSON.parse(localStorage.getItem(OBJ + ids[0])!)).toMatchObject({ _id: ids[0], n: 1 });
        const meta = JSON.parse(localStorage.getItem("phoenix:db8:com.palm.db")!);
        expect(meta.objects).toBeUndefined();
        expect(meta.rev).toBeGreaterThanOrEqual(2);
    });

    it("writes only what changed, and always the counters (other pages' watches hear of it)", async () => {
        const r = await call("luna://com.palm.db/put", { objects: [{ _kind: "org.example.a:1", n: 1 }, { _kind: "org.example.a:1", n: 2 }] });
        const [a, b] = (r.results as { id: string }[]).map((x) => x.id);
        const set = vi.spyOn(Storage.prototype, "setItem");
        const removed = vi.spyOn(Storage.prototype, "removeItem");
        await call("luna://com.palm.db/merge", { objects: [{ _id: a, n: 10 }] });
        expect(set.mock.calls.map((c) => c[0]).sort()).toEqual([OBJ + a, "phoenix:db8:com.palm.db"].sort());
        set.mockClear();
        const before = localStorage.getItem("phoenix:db8:com.palm.db");
        await call("luna://com.palm.db/del", { ids: [b], purge: true });
        expect(removed.mock.calls.map((c) => c[0])).toEqual([OBJ + b]);
        expect(set.mock.calls.map((c) => c[0])).toEqual(["phoenix:db8:com.palm.db"]);
        expect(localStorage.getItem("phoenix:db8:com.palm.db")).not.toBe(before);
        set.mockClear();
        await call("luna://com.palm.db/find", { query: { from: "org.example.a:1" } });
        expect(set).not.toHaveBeenCalled();
    });

    it("leaves alone objects another page stored", async () => {
        localStorage.setItem(OBJ + "other", JSON.stringify({ _id: "other", _kind: "org.example.a:1", _rev: 50, by: "another page" }));
        const r = await call("luna://com.palm.db/put", { objects: [{ _kind: "org.example.a:1", by: "this page" }] });
        expect((r.results as { rev: number }[])[0].rev).toBeGreaterThan(50);
        const found = await call("luna://com.palm.db/find", { query: { from: "org.example.a:1" } });
        expect((found.results as { by: string }[]).map((o) => o.by).sort()).toEqual(["another page", "this page"]);
    });

    it("splits the single value of earlier runtimes into keys", async () => {
        localStorage.setItem("phoenix:db8:com.palm.db", JSON.stringify({
            rev: 9, nextId: 4,
            objects: { "++x": { _id: "++x", _kind: "org.example.old:1", _rev: 8, title: "kept" } },
            kinds: { "org.example.old:1": { extends: [], indexes: [], revSets: [], sync: true } },
        }));
        const found = await call("luna://com.palm.db/find", { query: { from: "org.example.old:1" } });
        expect((found.results as { title: string }[])[0].title).toBe("kept");
        expect(JSON.parse(localStorage.getItem(OBJ + "++x")!)).toMatchObject({ title: "kept" });
        expect(JSON.parse(localStorage.getItem("phoenix:db8:com.palm.db/kind/org.example.old:1")!)).toMatchObject({ sync: true });
        expect(JSON.parse(localStorage.getItem("phoenix:db8:com.palm.db")!)).toMatchObject({ rev: 9, nextId: 4 });
    });
});
