// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The sync of one capability that is a set of objects (a kind and a pull):
// the pattern of apps/dav's lib/sync.js, written once for every connector.
//
//   1. pull: what changed on the server since the last token. New objects
//      are put in the capability's kind (accountId and remoteId on each);
//      changed ones replace the device's copy, or are merged with it field
//      by field (two-way, the item record's base copy: synckit merge3);
//      deleted ones (or, on a full pull, those not listed) are deleted.
//   2. push (two-way: the capability has push): objects new on the device,
//      edited since the last sync (their _rev is not the item's localRev)
//      or deleted, sent one by one.
//   3. The next token is kept in the account's state.
//
// Nothing is written when nothing changed: an object whose etag (or, without
// one, whose fields) match the item record is left alone. A field changed
// on both sides is a conflict: the winner's value is kept (the server's by
// default), and the loser's is recorded on the item record (conflicts) and
// counted, so a conflict never loses an edit silently.

import * as synckit from "@phoenix/synckit";
import type { DbObject, ItemStore } from "@phoenix/synckit";
import type { AccountContext, CapabilityDefinition, Json, RemoteObject } from "./types";


export interface CapabilityStats {
    created: number;
    updated: number;
    deleted: number;
    conflicts: number;
    pushed: { created: number; updated: number; deleted: number };
    errors: string[];
    /** CONTACTS: contacts written and removed (for the persons). */
    changedIds: string[];
    removedIds: string[];
}

export function emptyStats(): CapabilityStats {
    return { created: 0, updated: 0, deleted: 0, conflicts: 0, pushed: { created: 0, updated: 0, deleted: 0 }, errors: [],
             changedIds: [], removedIds: [] };
}

function fieldsOf(cap: CapabilityDefinition, obj: DbObject): Record<string, Json> {
    if (cap.fromDb) return cap.fromDb(obj);
    const out: Record<string, Json> = {};
    (cap.fields || Object.keys(obj).filter((k) => k.charAt(0) !== "_" && k !== "accountId" && k !== "remoteId"))
        .forEach((f) => { if (obj[f] !== undefined) out[f] = obj[f]; });
    return out;
}

async function dbFields(cap: CapabilityDefinition, ctx: AccountContext, remote: Record<string, Json>): Promise<Record<string, Json>> {
    return cap.toDb ? await cap.toDb(remote, ctx) : remote;
}

// Fields absent from a new copy are cleared on the device (db8 merge keeps
// what it is not given).
function withCleared(next: Record<string, Json>, before: Record<string, Json> | null): Record<string, Json> {
    const out = Object.assign({}, next);
    Object.keys(before || {}).forEach((k) => { if (!(k in out)) out[k] = null; });
    return out;
}

export async function syncObjects(ctx: AccountContext, providerId: string, cap: CapabilityDefinition, items: ItemStore,
                                  token: string | null): Promise<{ stats: CapabilityStats; nextToken: string | null }> {
    const stats = emptyStats();
    const kind = cap.kind as string;
    const twoWay = typeof cap.push === "function";
    const winner = cap.conflict || "remote";
    const db = ctx.db;

    const byRemote = await items.byRemoteId(providerId);
    const locals = await db.find({ from: kind, where: [{ prop: "accountId", op: "=", val: ctx.accountId }], incDel: true });
    const localById: Record<string, DbObject> = {};
    locals.forEach((o) => { localById[o._id as string] = o; });
    const touched: Record<string, boolean> = {};

    // ---- 1. Pull -------------------------------------------------------------------------
    const pulled = await (cap.pull as NonNullable<CapabilityDefinition["pull"]>)(ctx, token);
    const listed: Record<string, boolean> = {};
    // Local objects the pull deleted or replaced: not for the push.
    const settled: Record<string, boolean> = {};
    for (const change of pulled.changes || []) {
        listed[change.remoteId] = true;
        try {
            if (await applyRemote(change)) touched[change.remoteId] = true;
        } catch (e) {
            touched[change.remoteId] = true;
            const err = e as Error;
            stats.errors.push(change.remoteId + ": " + err.message);
            ctx.log("could not apply " + change.remoteId + ": " + err.message);
        }
    }
    const gone = (pulled.deleted || []).slice();
    if (pulled.full) Object.keys(byRemote).forEach((id) => { if (!listed[id] && byRemote[id].remoteId) gone.push(id); });
    for (const remoteId of gone) {
        const item = byRemote[remoteId];
        if (!item) continue;
        touched[remoteId] = true;
        const local = item.localId ? localById[item.localId] : null;
        if (twoWay && local && !local._del && local._rev !== item.localRev) {
            // Deleted on the server, edited on the device: the server wins (SYNERGY.md 3.3), the edit is recorded.
            stats.conflicts++;
            ctx.log("conflict on " + remoteId + ": deleted on the server, changed on the device; the server wins");
        }
        if (local && !local._del) {
            await db.del([local._id as string]);
            stats.deleted++;
            stats.removedIds.push(local._id as string);
        }
        if (local) settled[local._id as string] = true;
        await items.remove([item]);
        delete byRemote[remoteId];
    }

    // One server object -> db8. false: nothing to do here, the push decides
    // (an object deleted on the device and unchanged on the server).
    async function applyRemote(change: RemoteObject): Promise<boolean> {
        const item = byRemote[change.remoteId];
        const local = item && item.localId ? localById[item.localId] : null;
        const unchangedRemote = !!item && (change.etag !== undefined && item.etag !== undefined
            ? change.etag === item.etag : synckit.sameValue(change.fields, item.base));
        if (item && (!local || local._del)) {
            // Deleted on the device: sent by the push, unless the server changed
            // it meanwhile (then the server wins and it comes back, SYNERGY.md 3.3).
            if (twoWay && unchangedRemote) return false;
            if (twoWay) {
                stats.conflicts++;
                ctx.log("conflict on " + change.remoteId + ": deleted on the device, changed on the server; the server wins");
            }
            if (local) settled[local._id as string] = true;
        }
        if (item && local && !local._del) {
            const unchangedLocal = local._rev === item.localRev;
            if (unchangedRemote && (unchangedLocal || !twoWay)) return true;
            let next = change.fields;
            let base = change.fields;
            let pushUpdate = false;
            if (twoWay && !unchangedLocal) {
                const m = synckit.merge3(item.base || {}, fieldsOf(cap, local), change.fields, cap.fields || Object.keys(change.fields),
                                         { winner });
                next = m.merged;
                base = change.fields;
                if (m.conflicts.length) {
                    stats.conflicts += m.conflicts.length;
                    ctx.log("conflict on " + change.remoteId + ": " + m.conflicts.map((c) => c.field).join(", ") +
                            " changed on both sides; kept the " + (winner === "remote" ? "server's" : "device's"));
                    item.conflicts = (item.conflicts || []).concat(m.conflicts.map((c) => ({
                        field: c.field, lost: winner === "remote" ? c.local : c.remote, at: ctx.now() })));
                }
                pushUpdate = m.toRemote;
                if (!m.toLocal && !pushUpdate) {
                    // Both sides already agree: only the record moves on.
                    Object.assign(item, { etag: change.etag, base: change.fields, localRev: local._rev });
                    await items.save(item);
                    return true;
                }
            }
            const before = fieldsOf(cap, local);
            const write = withCleared(await dbFields(cap, ctx, next), cap.toDb ? null : before);
            const r = await db.merge([Object.assign({ _id: local._id }, write, { accountId: ctx.accountId, remoteId: change.remoteId })]);
            stats.updated++;
            stats.changedIds.push(local._id as string);
            Object.assign(item, { etag: change.etag, base, localRev: r[0].rev });
            if (pushUpdate && cap.push) {
                const res = await cap.push(ctx, { op: "update", remoteId: change.remoteId, etag: change.etag, fields: next, base: change.fields });
                stats.pushed.updated++;
                Object.assign(item, { etag: res && res.etag !== undefined ? res.etag : item.etag, base: next });
            }
            await items.save(item);
            return true;
        }
        const fields = await dbFields(cap, ctx, change.fields);
        const r = await db.put([Object.assign({ _kind: kind }, fields, { accountId: ctx.accountId, remoteId: change.remoteId })]);
        stats.created++;
        stats.changedIds.push(r[0].id);
        const rec = Object.assign(item || { capability: providerId, remoteId: change.remoteId }, {
            etag: change.etag, base: change.fields, localId: r[0].id, localRev: r[0].rev });
        byRemote[change.remoteId] = await items.save(rec);
        return true;
    }

    // ---- 2. Push (two-way) -----------------------------------------------------------------
    if (twoWay && cap.push) {
        const byLocal: Record<string, DbObject> = {};
        Object.keys(byRemote).forEach((id) => { const it = byRemote[id]; if (it.localId) byLocal[it.localId] = it; });
        for (const obj of locals) {
            const item = byLocal[obj._id as string];
            if (settled[obj._id as string] || (item && touched[item.remoteId])) continue;
            try {
                if (!item && !obj._del) {
                    const fields = fieldsOf(cap, obj);
                    const res = await cap.push(ctx, { op: "create", fields });
                    if (!res || !res.remoteId) throw new Error("push did not give the new object's remoteId");
                    stats.pushed.created++;
                    const m = await db.merge([{ _id: obj._id, remoteId: res.remoteId }]);
                    byRemote[res.remoteId] = await items.save({ capability: providerId, remoteId: res.remoteId, etag: res.etag,
                                                                base: fields, localId: obj._id, localRev: m[0].rev });
                } else if (item && obj._del) {
                    await cap.push(ctx, { op: "delete", remoteId: item.remoteId, etag: item.etag, base: item.base });
                    stats.pushed.deleted++;
                    await items.remove([item]);
                } else if (item && obj._rev !== item.localRev) {
                    const fields = fieldsOf(cap, obj);
                    const res = await cap.push(ctx, { op: "update", remoteId: item.remoteId, etag: item.etag, fields, base: item.base });
                    stats.pushed.updated++;
                    Object.assign(item, { etag: res && res.etag !== undefined ? res.etag : item.etag, base: fields, localRev: obj._rev });
                    await items.save(item);
                }
            } catch (e) {
                const err = e as Error & { status?: number };
                if (err.status === 401 || err.status === 429) throw err;
                stats.errors.push((item ? item.remoteId : obj._id) + ": " + err.message);
                ctx.log("upload of " + (item ? item.remoteId : obj._id) + " failed: " + err.message);
            }
        }
        // Item records whose object is gone altogether (purged).
        for (const id of Object.keys(byRemote)) {
            const it = byRemote[id];
            if (touched[id] || !it.localId || localById[it.localId]) continue;
            await cap.push(ctx, { op: "delete", remoteId: it.remoteId, etag: it.etag, base: it.base });
            stats.pushed.deleted++;
            await items.remove([it]);
        }
    }

    const next = pulled.nextToken === undefined ? token : pulled.nextToken;
    return { stats, nextToken: next };
}

/** Everything one capability wrote for the account: its kind's objects and item records. */
export async function removeObjects(ctx: AccountContext, providerId: string, cap: CapabilityDefinition,
                                    items: ItemStore | null): Promise<string[]> {
    let removed: string[] = [];
    if (cap.kind) {
        const objs = await ctx.db.find({ from: cap.kind, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] });
        removed = objs.map((o) => o._id as string);
        if (removed.length) await ctx.db.del(removed);
    }
    if (items) await items.removeAll(providerId);
    return removed;
}
