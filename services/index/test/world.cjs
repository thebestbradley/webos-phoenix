// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The index's tests' device: a db8 that keeps revisions as db8 does (each
// put, merge and del a new _rev; deleted objects kept with _del until
// purged; find by _rev with incDel, orderBy, limit and count; kinds that
// extend others), the file manager over a few files, the model already
// downloaded, files and storage in memory, and the fake embedder
// (fake-embedder.cjs). world({conditions}) -> {svc, put, merge, del, files,
// embedder, luna, ...}.

"use strict";

var path = require("path");
var createIndexService = require(path.join(__dirname, "..", "indexservice.js")).createIndexService;
var fake = require("./fake-embedder.cjs");
var modelLib = require(path.join(__dirname, "..", "lib", "model.js"));

var EXTENDS = { "com.palm.smsmessage:1": "com.palm.message:1", "com.palm.immessage.xmpp:1": "com.palm.message:1", "com.palm.imap.email:1": "com.palm.email:1" };

function world(opts) {
    opts = opts || {};
    var rev = 0, n = 0, db = new Map();
    function isOf(o, kind) { var k = o._kind; while (k) { if (k === kind) return true; k = EXTENDS[k]; } return false; }
    function put(o) { var id = o._id || "o" + ++n; db.set(id, Object.assign({}, o, { _id: id, _rev: ++rev })); return id; }
    function merge(o) { db.set(o._id, Object.assign({}, db.get(o._id), o, { _rev: ++rev })); }
    function del(id) { var o = db.get(id); if (o) db.set(id, Object.assign({}, o, { _del: true, _rev: ++rev })); }
    function purge(id) { db.delete(id); }
    var fileTree = opts.files || {};   // path -> {text?, bytes?, mtime}
    var calls = [];
    function ok(o) { return Promise.resolve(Object.assign({ returnValue: true }, o || {})); }
    var luna = {
        call: function (uri, p) {
            calls.push(uri);
            var m = uri.replace(/^luna:\/\//, "");
            if (m === "com.palm.db/find") {
                var q = p.query, start = Number(q.page) || 0, list = Array.from(db.values()).filter(function (o) { return isOf(o, q.from) && (q.incDel || !o._del); });
                (q.where || []).forEach(function (c) {
                    list = list.filter(function (o) { var v = o[c.prop]; return c.op === ">" ? v > c.val : c.op === "=" ? v === c.val : true; });
                });
                if (q.orderBy) list.sort(function (a, b) { return a[q.orderBy] - b[q.orderBy]; });
                var limit = q.limit || 500, out = { results: list.slice(start, start + limit) };
                if (start + limit < list.length) out.next = String(start + limit);
                if (q.select) out.results = out.results.map(function (o) { var x = {}; q.select.forEach(function (k) { x[k] = o[k]; }); return x; });
                if (p.count) out.count = list.length;
                return ok(out);
            }
            if (m === "com.palm.db/get") return ok({ results: p.ids.map(function (id) { return db.get(id); }).filter(function (o) { return o && !o._del; }) });
            if (m === "org.webosphoenix.filemanager/list") {
                var dir = p.path.replace(/\/$/, ""), seen = {}, entries = [];
                Object.keys(fileTree).forEach(function (f) {
                    if (f.indexOf(dir + "/") !== 0) return;
                    var rest = f.slice(dir.length + 1), first = rest.split("/")[0];
                    if (seen[first]) return;
                    seen[first] = true;
                    var isDir = rest.indexOf("/") >= 0, full = dir + "/" + first;
                    entries.push({ name: first, path: full, type: isDir ? "directory" : "file", size: isDir ? 0 : (fileTree[f].text || "").length, mtime: isDir ? 0 : fileTree[f].mtime || 1 });
                });
                return ok({ entries: entries });
            }
            if (m === "org.webosphoenix.filemanager/stat") {
                var f = fileTree[p.path];
                return f ? ok({ entry: { name: p.path.replace(/^.*\//, ""), path: p.path, type: "file", size: (f.text || "").length, mtime: f.mtime || 1 } })
                         : Promise.resolve({ returnValue: false, errorCode: 1, errorText: "not found" });
            }
            if (m === "com.palm.applicationManager/listLaunchPoints")
                return ok({ launchPoints: [{ id: "com.palm.app.notes", icon: "/usr/palm/applications/com.palm.app.notes/icon.png" },
                                           { id: "com.palm.app.email", icon: "/usr/palm/applications/com.palm.app.email/icon.png" }] });
            return ok();
        }
    };
    var kept = new Map(), stored = new Map();
    var files = {
        read: function (name) { return Promise.resolve(kept.has(name) ? kept.get(name).slice() : null); },
        write: function (name, bytes) { kept.set(name, bytes.slice()); return Promise.resolve(); },
        remove: function (name) { kept.delete(name); return Promise.resolve(); }
    };
    var storage = {
        get: function (k) { return stored.has(k) ? JSON.parse(stored.get(k)) : null; },
        set: function (k, v) { stored.set(k, JSON.stringify(v)); },
        remove: function (k) { stored.delete(k); }
    };
    var installed = opts.noModel ? [] : [{ id: modelLib.TEXT.id }].concat(opts.media ? [{ id: modelLib.MEDIA.id }] : []);
    var models = {
        status: function () { return Promise.resolve({ available: true, installed: installed.slice(), downloading: null }); },
        download: function (m) { installed.push({ id: m.id }); return Promise.resolve(); },
        cancel: function () { return Promise.resolve(); },
        remove: function (m) { installed = installed.filter(function (x) { return x.id !== m.id; }); return Promise.resolve(); },
        ensure: function () { return Promise.resolve({ baseUrl: "http://127.0.0.1:1/v1" }); }
    };
    var conditions = Object.assign({ charging: true, battery: 80, idle: false, saver: false }, opts.conditions || {});
    var embedder = opts.embedder || fake.createFakeEmbedder();
    var svc = createIndexService({
        luna: luna, storage: storage, files: files, models: models, embedder: embedder,
        conditions: function () { return Promise.resolve(conditions); },
        readText: function (p) { return Promise.resolve(fileTree[p] ? fileTree[p].text || "" : null); },
        readBytes: function (p) { var f = fileTree[p]; return Promise.resolve(f ? (f.bytes || Buffer.from(f.text || "", "latin1")) : null); },
        inflate: function (b) { return require("zlib").inflateSync(Buffer.from(b)); },
        now: opts.now || Date.now, setTimeout: function (fn) { return setTimeout(fn, 0); },
        // The fake embedder's scores are not the model's: its own floor, no margin.
        minScore: opts.minScore === undefined ? 0.5 : opts.minScore, margin: 1,
        caller: opts.guarded ? function () { return ""; } : undefined
    });
    function settle() {
        // Until no pass has run for a few turns (one may start another).
        return new Promise(function (resolve) {
            var quiet = 0;
            (function wait(k) {
                quiet = svc.running() ? 0 : quiet + 1;
                if (quiet >= 4 || k > 3000) return resolve();
                setTimeout(function () { wait(k + 1); }, 3);
            })(0);
        });
    }
    return { svc: svc, m: svc.methods, put: put, merge: merge, del: del, purge: purge, db: db, files: fileTree, kept: kept, storage: storage,
             embedder: embedder, conditions: conditions, luna: luna, calls: calls, models: models, settle: settle };
}

module.exports = { world: world };
