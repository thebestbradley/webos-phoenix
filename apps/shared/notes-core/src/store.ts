// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Notes and folders in db8 (com.palm.db). The Luna calls go through a
// transport each app supplies, so the Enact apps make them with Enact's own
// @enact/webos LS2Request.

import {
    APP_IDS, DEFAULT_FOLDER, FOLDER_KIND, NOTE_KIND,
    type Folder, type Note,
} from "./model";

export interface LunaReply {
    returnValue?: boolean;
    errorCode?: number;
    errorText?: string;
    [key: string]: unknown;
}

export interface LunaTransport {
    call(uri: string, params: object): Promise<LunaReply>;
    /** A subscription: onReply for every reply until cancel(). */
    subscribe(uri: string, params: object, onReply: (r: LunaReply) => void, onError: (e: LunaReply) => void): { cancel(): void };
}

const DB = "luna://com.palm.db";

interface Page<T> {
    results?: T[];
    next?: string;
}

export interface NotesData {
    notes: Note[];
    folders: Folder[];
}

export class NotesStore {
    private readonly luna: LunaTransport;
    private readonly now: () => number;

    constructor(luna: LunaTransport, now: () => number = Date.now) {
        this.luna = luna;
        this.now = now;
    }

    /**
     * Registers the kinds. The first of the apps to run owns them and lets
     * the others use them (APP_IDS); for the others, db8 refuses the putKind
     * because the kinds belong to the first, which is expected.
     */
    async ensureKinds(appId: string): Promise<void> {
        const kinds = [
            { id: FOLDER_KIND, indexes: [{ name: "name", props: [{ name: "name" }] }] },
            {
                id: NOTE_KIND,
                indexes: [
                    { name: "modified", props: [{ name: "modifiedAt" }] },
                    { name: "folder", props: [{ name: "folderId" }, { name: "modifiedAt" }] },
                ],
            },
        ];
        for (const k of kinds) {
            try {
                await this.luna.call(`${DB}/putKind`, { ...k, owner: appId });
            } catch (e) {
                if (!(await this.readable(k.id))) throw e;
                continue;
            }
            await this.luna.call(`${DB}/putPermissions`, {
                permissions: APP_IDS.map((caller) => ({
                    type: "db.kind",
                    object: k.id,
                    caller,
                    operations: { read: "allow", create: "allow", update: "allow", delete: "allow" },
                })),
            });
        }
    }

    private async readable(kind: string): Promise<boolean> {
        try {
            await this.luna.call(`${DB}/find`, { query: { from: kind, limit: 1 } });
            return true;
        } catch {
            return false;
        }
    }

    private async findAll<T>(kind: string): Promise<T[]> {
        const out: T[] = [];
        let page: string | undefined;
        do {
            const r = (await this.luna.call(`${DB}/find`, { query: { from: kind, limit: 500, ...(page ? { page } : {}) } })) as Page<T>;
            out.push(...(r.results ?? []));
            page = r.next;
        } while (page);
        return out;
    }

    async load(): Promise<NotesData> {
        const [notes, folders] = await Promise.all([this.findAll<Note>(NOTE_KIND), this.findAll<Folder>(FOLDER_KIND)]);
        return { notes, folders };
    }

    /**
     * Calls back with all notes and folders now and after every change, in
     * this app or the other (the db8 watch pattern: find with watch: true
     * answers once, then fires once when the results may have changed).
     */
    watch(cb: (data: NotesData) => void, onError: (e: LunaReply) => void): { cancel(): void } {
        let cancelled = false;
        const subs: { cancel(): void }[] = [];
        const reload = () => {
            if (!cancelled) this.load().then((d) => { if (!cancelled) cb(d); }, onError);
        };
        const watchKind = (kind: string) => {
            let sub: { cancel(): void } | null = null;
            const open = () => {
                if (cancelled) return;
                sub = this.luna.subscribe(`${DB}/find`, { query: { from: kind, limit: 1 }, watch: true }, (r) => {
                    if (r.fired) {
                        sub?.cancel();
                        open();
                        reload();
                    }
                }, onError);
            };
            open();
            subs.push({ cancel: () => sub?.cancel() });
        };
        watchKind(NOTE_KIND);
        watchKind(FOLDER_KIND);
        reload();
        return { cancel: () => { cancelled = true; subs.forEach((s) => s.cancel()); } };
    }

    async createNote(folderId: string, body = ""): Promise<Note> {
        const t = this.now();
        const fresh: Omit<Note, "_id"> = {
            _kind: NOTE_KIND,
            folderId: folderId || DEFAULT_FOLDER,
            body,
            pinned: false,
            createdAt: t,
            modifiedAt: t,
            deletedAt: null,
        };
        const r = (await this.luna.call(`${DB}/put`, { objects: [fresh] })) as { results?: { id: string; rev: number }[] };
        const saved = r.results?.[0];
        if (!saved) throw new Error("db8 put returned no id");
        return { ...fresh, _id: saved.id, _rev: saved.rev };
    }

    private merge(objects: object[]): Promise<LunaReply> {
        return this.luna.call(`${DB}/merge`, { objects });
    }

    saveBody(id: string, body: string): Promise<LunaReply> {
        return this.merge([{ _id: id, body, modifiedAt: this.now() }]);
    }

    setPinned(id: string, pinned: boolean): Promise<LunaReply> {
        return this.merge([{ _id: id, pinned }]);
    }

    move(ids: string[], folderId: string): Promise<LunaReply> {
        return this.merge(ids.map((_id) => ({ _id, folderId })));
    }

    /** To Recently Deleted (kept 30 days). */
    trash(ids: string[]): Promise<LunaReply> {
        const t = this.now();
        return this.merge(ids.map((_id) => ({ _id, deletedAt: t, pinned: false })));
    }

    /** Back from Recently Deleted, into Notes when its folder is gone. */
    recover(notes: Note[], folders: readonly Folder[]): Promise<LunaReply> {
        return this.merge(notes.map((n) => ({
            _id: n._id,
            deletedAt: null,
            folderId: n.folderId === DEFAULT_FOLDER || folders.some((f) => f._id === n.folderId) ? n.folderId : DEFAULT_FOLDER,
        })));
    }

    /** Gone for good. */
    purge(ids: string[]): Promise<LunaReply> {
        return this.luna.call(`${DB}/del`, { ids, purge: true });
    }

    async createFolder(name: string): Promise<string> {
        const r = (await this.luna.call(`${DB}/put`, {
            objects: [{ _kind: FOLDER_KIND, name: name.trim(), createdAt: this.now() }],
        })) as { results?: { id: string }[] };
        const id = r.results?.[0]?.id;
        if (!id) throw new Error("db8 put returned no id");
        return id;
    }

    renameFolder(id: string, name: string): Promise<LunaReply> {
        return this.merge([{ _id: id, name: name.trim() }]);
    }

    /** Deletes a folder; its notes go to Recently Deleted, as in Apple Notes. */
    async deleteFolder(id: string, notes: readonly Note[]): Promise<void> {
        const inside = notes.filter((n) => n.folderId === id && n.deletedAt === null).map((n) => n._id);
        if (inside.length) await this.trash(inside);
        await this.luna.call(`${DB}/del`, { ids: [id], purge: true });
    }
}
