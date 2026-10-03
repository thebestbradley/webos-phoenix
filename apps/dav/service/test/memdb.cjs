// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Test doubles for the DAV service: an in-memory db8 with the calls and
// query features the sync engine uses (kind inheritance, "=" on dotted and
// array paths, incDel, limit, _rev / _del bookkeeping, merge of nested
// objects), and a Luna bus that answers db8, tempdb, the accounts
// service's readCredentials / getAccountInfo and the activity manager.
// Not installed on devices (tools/install-rootfs.py skips test/).

"use strict";

function createMemDb(parents) {
    parents = parents || {};
    var objects = {};
    var rev = 100;
    var nextId = 1;

    function isOfKind(kind, from) {
        var k = kind, seen = 0;
        while (k && seen++ < 10) {
            if (k === from) return true;
            k = parents[k];
        }
        return false;
    }

    function values(obj, path) {
        var parts = path.split("."), cur = [obj];
        parts.forEach(function (p) {
            var next = [];
            cur.forEach(function (v) {
                if (v === undefined || v === null) return;
                var x = v[p];
                if (Array.isArray(x)) next.push.apply(next, x); else next.push(x);
            });
            cur = next;
        });
        // A bare array property matches on any element.
        return cur.reduce(function (a, v) { return a.concat(Array.isArray(v) ? v : [v]); }, []);
    }

    function query(q) {
        var out = Object.keys(objects).map(function (id) { return objects[id]; }).filter(function (o) {
            if (o._del && !q.incDel) return false;
            if (q.from && !isOfKind(o._kind, q.from)) return false;
            return (q.where || []).every(function (c) {
                var vs = values(o, c.prop);
                if (c.op === "=") return vs.some(function (v) { return v === c.val; });
                throw new Error("memdb: unsupported op " + c.op);
            });
        });
        if (q.limit) out = out.slice(0, q.limit);
        return out.map(function (o) { return JSON.parse(JSON.stringify(o)); });
    }

    function store(o) {
        o = JSON.parse(JSON.stringify(o));
        if (!o._id) o._id = "m" + (nextId++);
        o._rev = ++rev;
        objects[o._id] = o;
        return { id: o._id, rev: o._rev };
    }

    function deepMerge(target, src) {
        Object.keys(src).forEach(function (k) {
            var v = src[k];
            if (k === "_rev") return;
            if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k]))
                deepMerge(target[k], v);
            else if (v === null) delete target[k];
            else target[k] = JSON.parse(JSON.stringify(v));
        });
    }

    var api = {
        objects: objects,
        find: function (q) { return Promise.resolve(query(q)); },
        get: function (ids) {
            return Promise.resolve(ids.map(function (id) { return objects[id]; })
                .filter(function (o) { return o && !o._del; }).map(function (o) { return JSON.parse(JSON.stringify(o)); }));
        },
        put: function (list) { return Promise.resolve(list.map(store)); },
        merge: function (list) {
            return Promise.resolve(list.map(function (m) {
                var cur = objects[m._id];
                if (!cur) return store(m);
                deepMerge(cur, m);
                cur._rev = ++rev;
                return { id: cur._id, rev: cur._rev };
            }));
        },
        del: function (ids) {
            return Promise.resolve(ids.map(function (id) {
                if (objects[id]) { objects[id]._del = true; objects[id]._rev = ++rev; }
                return { id: id };
            }));
        },
        delQuery: function (q) {
            var found = query(q);
            return api.del(found.map(function (o) { return o._id; })).then(function () { return { count: found.length }; });
        }
    };
    return api;
}

// A Luna bus for davservice.js: db8 and tempdb in memory, accounts and
// credentials from the given tables, activity manager calls recorded.
function createFakeBus(options) {
    var db = options.db, tempdb = options.tempdb || createMemDb();
    var calls = [];
    function dbCall(d, method, p) {
        switch (method) {
        case "find": return d.find(p.query).then(function (r) { return { returnValue: true, results: r }; });
        case "get": return d.get(p.ids).then(function (r) { return { returnValue: true, results: r }; });
        case "put": return d.put(p.objects).then(function (r) { return { returnValue: true, results: r }; });
        case "merge": return d.merge(p.objects).then(function (r) { return { returnValue: true, results: r }; });
        case "del": return (p.ids ? d.del(p.ids) : d.delQuery(p.query)).then(function (r) { return { returnValue: true, results: r }; });
        }
        return Promise.resolve({ returnValue: false, errorText: "unknown db8 method " + method });
    }
    return {
        calls: calls,
        tempdb: tempdb,
        call: function (uri, params) {
            calls.push({ uri: uri, params: params });
            var m = /^luna:\/\/([^/]+)\/(.*)$/.exec(uri);
            var svc = m[1], method = m[2];
            if (svc === "com.palm.db") return dbCall(db, method, params);
            if (svc === "com.palm.tempdb") return dbCall(tempdb, method, params);
            if (svc === "com.palm.service.accounts" && method === "readCredentials") {
                var c = options.credentials[params.accountId];
                return Promise.resolve(c ? { returnValue: true, credentials: c[params.name] } : { returnValue: false, errorCode: "CREDENTIALS_NOT_FOUND" });
            }
            if (svc === "com.palm.service.accounts" && method === "getAccountInfo") {
                var a = options.accounts[params.accountId];
                return Promise.resolve(a ? { returnValue: true, result: a } : { returnValue: false });
            }
            if (svc === "com.palm.activitymanager") return Promise.resolve({ returnValue: true, activityId: calls.length });
            return Promise.resolve({ returnValue: false, errorText: "no such service in the fake bus: " + uri });
        }
    };
}

// The kinds the DAV transport and the apps use, and what they extend.
var KIND_PARENTS = {
    "com.palm.contact.dav:1": "com.palm.contact:1",
    "com.palm.calendar.dav:1": "com.palm.calendar:1",
    "com.palm.calendarevent.dav:1": "com.palm.calendarevent:1"
};

module.exports = { createMemDb: createMemDb, createFakeBus: createFakeBus, KIND_PARENTS: KIND_PARENTS };
