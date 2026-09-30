// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { FOLDER_KIND, NOTE_KIND, type Folder, type Note } from "./model";
import { NotesStore, type LunaReply, type LunaTransport } from "./store";

// A small db8: put, merge, del, find (with watch), putKind, putPermissions.
function fakeDb(opts: { kindOwner?: string } = {}) {
    const objects = new Map<string, Record<string, unknown>>();
    const kinds = new Map<string, string>();
    const watchers: (() => void)[] = [];
    const calls: string[] = [];
    let next = 1;
    if (opts.kindOwner) { kinds.set(NOTE_KIND, opts.kindOwner); kinds.set(FOLDER_KIND, opts.kindOwner); }
    const fire = () => watchers.splice(0).forEach((w) => w());
    const handle = (uri: string, p: Record<string, any>): LunaReply => {
        const method = uri.split("/").pop()!;
        calls.push(method);
        switch (method) {
            case "putKind":
                if (kinds.has(p.id) && kinds.get(p.id) !== p.owner) throw { errorCode: -3963, errorText: "permission denied" };
                kinds.set(p.id, p.owner);
                return { returnValue: true };
            case "putPermissions":
                return { returnValue: true };
            case "put":
                return {
                    returnValue: true,
                    results: p.objects.map((o: Record<string, unknown>) => {
                        const id = String(next++);
                        objects.set(id, { ...o, _id: id, _rev: next });
                        return { id, rev: next };
                    }),
                };
            case "merge":
                p.objects.forEach((o: Record<string, unknown>) => objects.set(o._id as string, { ...objects.get(o._id as string), ...o }));
                return { returnValue: true };
            case "del":
                p.ids.forEach((id: string) => objects.delete(id));
                return { returnValue: true };
            case "find":
                return { returnValue: true, results: [...objects.values()].filter((o) => o._kind === p.query.from) };
            default:
                throw { errorCode: -1, errorText: "unknown " + method };
        }
    };
    const luna: LunaTransport = {
        async call(uri, params) {
            const r = handle(uri, params as Record<string, any>);
            if (/put|merge|del/.test(uri) && !/Kind|Permissions/.test(uri)) setTimeout(fire, 0);
            return r;
        },
        subscribe(uri, params, onReply) {
            let live = true;
            onReply(handle(uri, params as Record<string, any>));
            watchers.push(() => { if (live) onReply({ returnValue: true, fired: true }); });
            return { cancel: () => { live = false; } };
        },
    };
    return { luna, objects, kinds, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

describe("NotesStore", () => {
    it("registers the kinds and lets all the Notes demos use them", async () => {
        const db = fakeDb();
        await new NotesStore(db.luna).ensureKinds("org.webosphoenix.enactnotes.limestone");
        expect(db.kinds.get(NOTE_KIND)).toBe("org.webosphoenix.enactnotes.limestone");
        expect(db.calls.filter((c) => c === "putPermissions")).toHaveLength(2);
    });

    it("uses the kinds another demo registered", async () => {
        const db = fakeDb({ kindOwner: "org.webosphoenix.enactnotes.limestone" });
        await new NotesStore(db.luna).ensureKinds("org.webosphoenix.enactnotes.agate");
        expect(db.kinds.get(NOTE_KIND)).toBe("org.webosphoenix.enactnotes.limestone");
    });

    it("creates, edits, deletes and recovers notes", async () => {
        const db = fakeDb();
        let t = 1000;
        const store = new NotesStore(db.luna, () => t);
        const n = await store.createNote("notes", "# Hi");
        expect(n).toMatchObject({ _kind: NOTE_KIND, folderId: "notes", body: "# Hi", createdAt: 1000, deletedAt: null });
        t = 2000;
        await store.saveBody(n._id, "# Hello");
        await store.setPinned(n._id, true);
        expect(db.objects.get(n._id)).toMatchObject({ body: "# Hello", modifiedAt: 2000, pinned: true });
        await store.trash([n._id]);
        expect(db.objects.get(n._id)).toMatchObject({ deletedAt: 2000, pinned: false });
        await store.recover([{ ...(db.objects.get(n._id) as unknown as Note), folderId: "gone" }], []);
        expect(db.objects.get(n._id)).toMatchObject({ deletedAt: null, folderId: "notes" });
        await store.purge([n._id]);
        expect(db.objects.has(n._id)).toBe(false);
    });

    it("deletes a folder, sending its notes to Recently Deleted", async () => {
        const db = fakeDb();
        const store = new NotesStore(db.luna, () => 5);
        const f = await store.createFolder(" Work ");
        const n = await store.createNote(f, "x");
        const { notes, folders } = await store.load();
        expect((folders as Folder[])[0].name).toBe("Work");
        await store.deleteFolder(f, notes);
        expect(db.objects.has(f)).toBe(false);
        expect(db.objects.get(n._id)).toMatchObject({ deletedAt: 5 });
    });

    it("reports every change to the watcher", async () => {
        const db = fakeDb();
        const store = new NotesStore(db.luna);
        const seen: number[] = [];
        const w = store.watch((d) => seen.push(d.notes.length), () => {});
        await flush();
        await store.createNote("notes", "a");
        await flush();
        await store.createNote("notes", "b");
        await flush();
        w.cancel();
        await store.createNote("notes", "c");
        await flush();
        expect(seen[0]).toBe(0);
        expect(seen[seen.length - 1]).toBe(2);
    });
});
