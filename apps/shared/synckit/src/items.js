// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Item records and the three-way field merge (docs/SYNERGY-MODERN.md 4.2).
//
// An item record is the transport's bookkeeping for one remote object, in
// a db8 kind of the transport's own (as apps/dav keeps
// org.webosphoenix.dav.item:1): which account and capability it belongs
// to, the remote id and its change key (etag, version), the db8 object it
// maps to with that object's _rev as last synced (so an edit on the device
// shows as a different _rev), and the base copy: the mapped fields as both
// sides last agreed on them. The base copy is what makes a three-way merge
// possible: a field changed only on the device is sent, a field changed
// only on the server is taken, and only a field changed on both sides is a
// conflict.
//
//   createItemStore({db, kind, accountId}) -> {
//     all(capability?)            every record of the account
//     byRemoteId(capability)      {remoteId: record}
//     save(record)                put (new) or replace; -> record with _id
//     remove(records)             delete them
//     removeAll(capability?)      the account's (or one capability's)
//   }
//   merge3(base, local, remote, fields, {winner: "remote" | "local"})
//     -> {merged, conflicts: [{field, local, remote, kept}], toLocal, toRemote}
//        toLocal: the device's copy must change; toRemote: the server's must.
//        A field changed on both sides to different values keeps the
//        winner's (the server's by default: SYNERGY.md 3.3 "server wins")
//        and the other value is listed in conflicts, for the caller to keep
//        (in a contact's note, an event's description) or log.

"use strict";

function same(a, b) {
    return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

// Undefined, null, "", [] and {} are the same absence; object keys in order.
function normalize(v) {
    if (v === undefined || v === null || v === "") return null;
    if (Array.isArray(v)) return v.length ? v.map(normalize) : null;
    if (typeof v === "object") {
        var out = {};
        Object.keys(v).sort().forEach(function (k) {
            var n = normalize(v[k]);
            if (n !== null) out[k] = n;
        });
        return Object.keys(out).length ? out : null;
    }
    return v;
}

function merge3(base, local, remote, fields, opts) {
    base = base || {};
    local = local || {};
    remote = remote || {};
    var winner = (opts && opts.winner) || "remote";
    var merged = {}, conflicts = [], toLocal = false, toRemote = false;
    fields.forEach(function (f) {
        var b = base[f], l = local[f], r = remote[f], v;
        if (same(l, r)) v = r;
        else if (same(l, b)) v = r;             // only the server changed it
        else if (same(r, b)) v = l;             // only the device changed it
        else {
            v = winner === "local" ? l : r;
            conflicts.push({ field: f, local: l === undefined ? null : l, remote: r === undefined ? null : r,
                             kept: winner });
        }
        if (v !== undefined) merged[f] = v;
        if (!same(v, l)) toLocal = true;
        if (!same(v, r)) toRemote = true;
    });
    return { merged: merged, conflicts: conflicts, toLocal: toLocal, toRemote: toRemote };
}

function createItemStore(options) {
    var db = options.db, kind = options.kind, accountId = options.accountId;
    if (!kind) throw new Error("item store: a kind is required");

    function all(capability) {
        return db.find({ from: kind, where: [{ prop: "accountId", op: "=", val: accountId }] }).then(function (r) {
            return capability ? r.filter(function (it) { return it.capability === capability; }) : r;
        });
    }

    return {
        kind: kind,
        all: all,
        byRemoteId: function (capability) {
            return all(capability).then(function (r) {
                var m = {};
                r.forEach(function (it) { m[it.remoteId] = it; });
                return m;
            });
        },
        save: function (record) {
            var o = Object.assign({ _kind: kind, accountId: accountId }, record);
            return db.put([o]).then(function (res) { o._id = res[0].id; o._rev = res[0].rev; return o; });
        },
        remove: function (records) {
            var ids = records.map(function (r) { return r._id; }).filter(Boolean);
            return ids.length ? db.del(ids) : Promise.resolve([]);
        },
        removeAll: function (capability) {
            return all(capability).then(function (r) {
                var ids = r.map(function (it) { return it._id; });
                return ids.length ? db.del(ids) : [];
            });
        }
    };
}

module.exports = { createItemStore: createItemStore, merge3: merge3, same: same };
