// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.index: a search of the user's own things by
// what they mean (the owner, 11 October 2026: "a layer in our assistant
// that can use [EmbeddingGemma 2] for advanced search"). Everything stays
// on the device: the model runs here (llama.cpp's llama-server, lib/model.js),
// and the index is files in the service's own folder, never backed up
// (no backup registration) and wiped by Full Erase (wipe).
//
// It is off until the user turns it on (Settings > Assistant > Search
// your phone), and each source is a switch of its own (lib/sources.js).
// While on, it keeps up with what changes: db8's revisions (each pass asks
// for what changed since the last one it saw, deletions included: the
// contacts linker's way, autolinker.js:1680-1760), and the files' size and
// time. A pass runs in the background, a page of records at a time, and
// only when the device can spare it (allowed(): never on a battery saver;
// a few changes at any time above 15% battery; a backlog, such as the
// first build, while charging, or while the screen is off with 30% or
// more). It stops between pages when that changes, and picks up where it
// left off: what was embedded is saved with the revision it reached.
//
// Methods (the requests and replies are the Luna ones):
//   getStatus {subscribe?}  -> {enabled, settings, state, progress, waiting,
//                              sources: [{id, title, enabled, records, passages, bytes}],
//                              records, passages, bytes, model: {...}, server: {...}}
//   setSettings {enabled?, sources?: {id: bool}, media?, answers?}  Settings
//   search {query, sources?: [id], limit?, from?: [address], minScore?,
//           skipLiteral?}   -> {results: [{source, sourceTitle, appId, icon, id,
//                              score, title, who, time, allDay, place, path,
//                              snippet, open: {appId, params}}], took}
//   sync {source?, full?}   a pass now (the activity manager's callback)
//   rebuild {}              every source again from nothing
//   deleteIndex {}          the index gone, and turned off
//   downloadModel {media?}, cancelDownload {}, removeModel {media?}
//   wipe {}                 Full Erase: the index and its settings gone
//
// createIndexService(deps): deps.luna {call(uri, params) -> Promise<reply>},
// deps.storage {get, set, remove} (settings and progress, small JSON),
// deps.files {read(name) -> Promise<Uint8Array|null>, write(name, bytes),
// remove(name)} (one file per source), deps.models {status(), download(m),
// cancel(id), remove(m), ensure(m, media) -> Promise<{baseUrl}>} (the
// model's llama-server), deps.request (HTTP to it), deps.conditions() ->
// Promise<{charging, battery, idle, saver}>, deps.readText(path, max),
// deps.readBytes(path, max) -> Promise<Uint8Array|null>, deps.inflate
// (bytes) -> Promise<bytes> (PDF text; optional), deps.caller(), deps.now(),
// deps.log(), deps.changed() (subscribers), deps.mayIndex() (whether this
// copy indexes: the simulator runs one per page), deps.embedder (tests: a
// fake with the same methods as lib/embedder.js), deps.maxAudioSeconds.

"use strict";

var sourcesLib = require("./lib/sources");
var storeLib = require("./lib/store");
var vectors = require("./lib/vectors");
var chunk = require("./lib/chunk");
var modelLib = require("./lib/model");
var embedderLib = require("./lib/embedder");
var pdftext = require("./lib/pdftext");
var wav = require("./lib/wav");

var SERVICE = "org.webosphoenix.service.index";
var METHODS = ["getStatus", "setSettings", "search", "sync", "rebuild", "deleteIndex", "downloadModel", "cancelDownload", "removeModel", "wipe"];
var DB = "luna://com.palm.db/";
var FILES = "luna://org.webosphoenix.filemanager/";
var SETTINGS_KEY = "index:settings", STATE_KEY = "index:state";

// Who may change it (Settings, the shell), search it (and the Assistant,
// Just Type), and erase it (Full Erase: the shell; the system manager's
// last try of a security policy).
var CHANGERS = ["org.webosphoenix.settings", "com.webos.surfacemanager", "com.palm.systemui"];
var SEARCHERS = CHANGERS.concat(["org.webosphoenix.assistant", "com.palm.launcher", "org.webosphoenix.justtype"]);
var SYNCERS = CHANGERS.concat(["com.palm.activitymanager", SERVICE]);
var ERASERS = ["com.webos.surfacemanager", "com.palm.systemmanager", "com.palm.systemui"];

var PAGE = 50;            // records asked of db8 at a time
var SMALL = 50;           // a backlog bigger than this waits for the charger (or the screen off)
var SAVE_MS = 60000;      // a pass saves at least this often (and at its end): flash is not written per page
var MIN_SCORE = 0.70;     // EmbeddingGemma 2 at 256 dimensions, the simulator's data: unrelated 0.6 to 0.78, asked for 0.8 to 0.9
var MARGIN = 0.10;        // and no more than this below the best
var FILE_ROOT = "/media/internal";
var FILE_SKIP = /^\/media\/internal\/(?:\.|DCIM\/|voicememos\/|samples\/music\/|samples\/videos\/|ringtones\/)|\/\.|\.(?:ipk|deb|apk|so|bin|gguf|part|tmp|db|sqlite|lock|crt|pem|key|p12|ogg|oga|mp3|m4a|wav|flac|aac|mp4|m4v|webm|mkv|mov|avi|jpe?g|png|gif|webp|heic|bmp)$/i;
var MAX_FILES = 3000, MAX_TEXT_BYTES = 262144, MAX_MEDIA_BYTES = 12 * 1024 * 1024;

var DEFAULTS = { enabled: false, sources: {}, media: false, answers: true };
sourcesLib.SOURCES.forEach(function (s) { DEFAULTS.sources[s.id] = true; });

var STOP = /^(?:the|and|for|with|from|that|this|what|when|where|which|about|have|has|did|does|was|were|are|is|my|me|our|your|a|an|of|to|in|on|at|it|its|that|any|show|find|search|look|get|say|said|note|notes|memo|email|emails|message|messages|photo|photos|picture|pictures)$/;

function ok(o) { return Object.assign({ returnValue: true }, o || {}); }
function fail(code, text) { return { returnValue: false, errorCode: code, errorText: text }; }
function b64(bytes) {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

function createIndexService(deps) {
    var log = deps.log || function () {};
    var now = deps.now || Date.now;
    var storage = deps.storage, files = deps.files;
    var changed = deps.changed || function () {};
    var mayIndex = deps.mayIndex || function () { return true; };
    var later = deps.setTimeout || setTimeout;

    function settings() {
        var s = storage.get(SETTINGS_KEY) || {};
        var out = Object.assign({}, DEFAULTS, s);
        out.sources = Object.assign({}, DEFAULTS.sources, s.sources || {});
        return out;
    }
    function state() { return Object.assign({ revs: {}, lastRun: 0, state: "idle", progress: null, waiting: "", error: "" }, storage.get(STATE_KEY) || {}); }
    function setState(changes) { storage.set(STATE_KEY, Object.assign(state(), changes)); changed(); }

    // ---- The model ------------------------------------------------------------------------
    function installedIds(st) { return (st && st.installed || []).map(function (x) { return x.id; }); }
    function modelStatus() {
        return Promise.resolve(deps.models ? deps.models.status() : { available: false, installed: [] }).then(function (st) {
            st = st || {};
            var ids = installedIds(st), dl = st.downloading || null;
            return {
                available: !!st.available, howToInstall: st.howToInstall || "", error: st.error || "",
                text: { id: modelLib.TEXT.id, name: modelLib.TEXT.name, size: modelLib.TEXT.size, licence: modelLib.TEXT.licence, source: modelLib.TEXT.source,
                        installed: ids.indexOf(modelLib.TEXT.id) >= 0, downloading: dl && dl.id === modelLib.TEXT.id ? dl : null },
                media: { id: modelLib.MEDIA.id, name: modelLib.MEDIA.name, size: modelLib.MEDIA.size, licence: modelLib.MEDIA.licence, source: modelLib.MEDIA.source,
                         installed: ids.indexOf(modelLib.MEDIA.id) >= 0, downloading: dl && dl.id === modelLib.MEDIA.id ? dl : null }
            };
        });
    }
    // Searches go first: the model's server reads one request at a time, and
    // a search waiting behind a pass's batches took 5 s on a busy computer;
    // the pass waits between its batches while one runs (gate).
    var searching = 0;
    function searchFirst() {
        if (!searching) return Promise.resolve();
        return new Promise(function (resolve) { (function wait() { if (!searching) return resolve(); later(wait, 20); })(); });
    }
    var embedder = deps.embedder || embedderLib.createEmbedder({
        request: deps.request, log: log, gate: searchFirst,
        ensure: function (media) {
            return modelStatus().then(function (m) {
                if (!m.text.installed) throw Object.assign(new Error("EmbeddingGemma 2 is not downloaded"), { code: "NO_MODEL" });
                return deps.models.ensure(Object.assign({}, modelLib.TEXT, { mediaFile: media && m.media.installed ? modelLib.MEDIA : null }), !!(media && m.media.installed));
            });
        }
    });

    // ---- The indexes, one per source --------------------------------------------------------
    var loaded = {};   // source -> {idx, stamp}
    function fileName(source) { return source + ".idx"; }
    function stampOf(source) { return storage.get("index:stamp:" + source) || 0; }
    function load(source) {
        var have = loaded[source], stamp = stampOf(source);
        if (have && have.stamp === stamp) return Promise.resolve(have.idx);
        return Promise.resolve(files.read(fileName(source))).then(function (bytes) {
            var idx = bytes ? storeLib.decode(bytes) : null;
            // Another model's vectors are no use to this one's queries.
            if (!idx || idx.model !== modelLib.TEXT.id || idx.dim !== vectors.DIM)
                idx = storeLib.createSourceIndex({ source: source, model: modelLib.TEXT.id, dim: vectors.DIM });
            loaded[source] = { idx: idx, stamp: stamp };
            return idx;
        }, function () {
            var idx = storeLib.createSourceIndex({ source: source, model: modelLib.TEXT.id, dim: vectors.DIM });
            loaded[source] = { idx: idx, stamp: stamp };
            return idx;
        });
    }
    function save(source, idx) {
        if (!idx.dirty) return Promise.resolve();
        var bytes = storeLib.encode(idx);
        return Promise.resolve(files.write(fileName(source), bytes)).then(function () {
            idx.dirty = false;
            var stamp = stampOf(source) + 1;
            storage.set("index:stamp:" + source, stamp);
            storage.set("index:size:" + source, { bytes: bytes.length, passages: idx.count(), records: idx.records().size });
            loaded[source] = { idx: idx, stamp: stamp };
        });
    }
    function drop(source) {
        delete loaded[source];
        storage.remove("index:size:" + source);
        storage.set("index:stamp:" + source, stampOf(source) + 1);
        var st = state();
        delete st.revs[source];
        storage.set(STATE_KEY, st);
        return Promise.resolve(files.remove(fileName(source))).catch(function () {});
    }
    function sizeOf(source) { return storage.get("index:size:" + source) || { bytes: 0, passages: 0, records: 0 }; }

    // ---- Reading the sources ----------------------------------------------------------------
    function call(uri, params) {
        return Promise.resolve(deps.luna.call(uri, params || {})).then(function (r) {
            if (!r || r.returnValue === false) throw new Error((r && r.errorText) || "failed: " + uri);
            return r;
        });
    }
    var names = null, namesAt = 0;
    function peopleNames() {
        if (names && now() - namesAt < 60000) return Promise.resolve(names);
        return call(DB + "find", { query: { from: "com.palm.person:1", limit: 500 } }).then(function (r) {
            names = sourcesLib.namesOf(r.results || []);
            namesAt = now();
            return names;
        }, function () { return names || new Map(); });
    }
    function readText(path, max) { return deps.readText ? Promise.resolve(deps.readText(path, max)).catch(function () { return null; }) : Promise.resolve(null); }
    function readBytes(path, max) { return deps.readBytes ? Promise.resolve(deps.readBytes(path, max)).catch(function () { return null; }) : Promise.resolve(null); }

    // The device can spare a pass now? backlog: how many records wait.
    function allowed(backlog) {
        if (!deps.conditions) return Promise.resolve({ ok: true });
        return Promise.resolve(deps.conditions()).then(function (c) {
            c = c || {};
            if (c.saver) return { ok: false, why: "saver" };
            if (c.charging) return { ok: true };
            var battery = typeof c.battery === "number" ? c.battery : 100;
            if (backlog > SMALL) return c.idle && battery >= 30 ? { ok: true } : { ok: false, why: "charging" };
            return battery >= 15 ? { ok: true } : { ok: false, why: "battery" };
        }, function () { return { ok: true }; });
    }

    // Passages (and, with media, the picture or recording) of one record,
    // embedded and put in idx in place of what it had, unless unchanged.
    function indexRecords(source, idx, records, ctx) {
        var s = settings(), def = sourcesLib.find(source), have = idx.hashes();
        var withMedia = s.media && !!def.media && ctx.mediaReady;
        var todo = [];
        return records.reduce(function (p, r) {
            return p.then(function () {
                return sourcesLib.passagesOf(source, r, ctx).then(function (list) {
                    var media = withMedia ? sourcesLib.mediaOf(source, r) : null;
                    var hashes = list.map(function (x) { return chunk.hash(x.input); });
                    if (media) hashes.push("m" + chunk.hash(media.path + ":" + (r.size || r._rev || "")));
                    var old = have.get(r._id || r.path);
                    if (old && old.length === hashes.length && old.every(function (h, i) { return h === hashes[i]; })) return;
                    todo.push({ r: r, list: list, media: media, hashes: hashes });
                });
            });
        }, Promise.resolve()).then(function () {
            if (!todo.length) return 0;
            var inputs = [];
            todo.forEach(function (t) { t.list.forEach(function (x) { inputs.push(x.input); }); });
            return embedder.documents(inputs).then(function (vecs) {
                var at = 0;
                return todo.reduce(function (p, t) {
                    return p.then(function () {
                        var mine = vecs.slice(at, at += t.list.length);
                        if (!t.media) return mine;
                        return mediaVector(t.media).then(function (v) { return v ? mine.concat([v]) : mine; });
                    }).then(function (mine) {
                        var id = t.r._id || t.r.path, time = sourcesLib.timeOf(source, t.r), a = sourcesLib.author(source, t.r);
                        idx.removeRecords([id]);
                        mine.forEach(function (v, c) {
                            if (!v) return;   // refused by the model (lib/embedder.js): left out
                            var q = new Int8Array(vectors.DIM), scale = vectors.quantize(v, q, 0);
                            var item = { r: id, c: c, h: t.hashes[c], t: time };
                            if (a) item.a = a;
                            if (c >= t.list.length) item.m = t.media.type === "image" ? "i" : "a";
                            idx.add(item, q, scale);
                        });
                    });
                }, Promise.resolve()).then(function () { return todo.length; });
            });
        });
    }
    function mediaVector(m) {
        return readBytes(m.path, MAX_MEDIA_BYTES).then(function (bytes) {
            if (!bytes || !bytes.length) return null;
            // A recording longer than the server reads at once: its start.
            if (m.type === "audio") bytes = wav.clip(bytes, deps.maxAudioSeconds || 300) || bytes;
            return embedder.media([{ type: m.type, base64: b64(bytes), mime: m.mime }]).then(function (v) { return v[0]; });
        }).catch(function (e) { log("no " + m.type + " embedding for " + m.path + ": " + e.message); return null; });
    }

    // One db8 source: what changed since idx.rev, a page at a time.
    function syncKind(source, idx, run) {
        var def = sourcesLib.find(source);
        var ctx = { names: null, readText: readText, mediaReady: run.mediaReady };
        var lastSave = now();
        function page() {
            if (run.stop) return Promise.resolve();
            var query = { from: def.kind, where: [{ prop: "_rev", op: ">", val: idx.rev }], orderBy: "_rev", incDel: true, limit: PAGE };
            return call(DB + "find", { query: query }).then(function (r) {
                var results = r.results || [];
                if (!results.length) return;
                // A db8 without revisions (the tests' stand-in): all of it, once.
                var revs = results.every(function (x) { return typeof x._rev === "number"; });
                if (!revs) return fullScan(source, idx, run, ctx);
                return peopleNames().then(function (n) {
                    ctx.names = n;
                    var gone = results.filter(function (x) { return x._del || sourcesLib.skip(source, x); }).map(function (x) { return x._id; });
                    idx.removeRecords(gone);
                    var live = results.filter(function (x) { return !x._del && !sourcesLib.skip(source, x); });
                    return indexRecords(source, idx, live, ctx);
                }).then(function (n) {
                    run.done += results.length;
                    run.embedded += n || 0;
                    idx.rev = Math.max(idx.rev, results.reduce(function (m, x) { return Math.max(m, x._rev); }, 0));
                    idx.dirty = true;
                    progress(run, source);
                    var saving = now() - lastSave >= SAVE_MS ? save(source, idx).then(function () { lastSave = now(); }) : Promise.resolve();
                    return saving.then(function () { return allowed(run.backlog); }).then(function (a) {
                        if (!a.ok) { run.stop = true; run.waiting = a.why; return; }
                        if (results.length === PAGE) return yieldThen(page);
                    });
                });
            });
        }
        return page();
    }
    // Everything of a kind at once, what is not there any more taken out.
    function fullScan(source, idx, run, ctx) {
        var def = sourcesLib.find(source);
        return Promise.all([call(DB + "find", { query: { from: def.kind, limit: 500 } }), peopleNames()]).then(function (got) {
            ctx.names = got[1];
            var all = (got[0].results || []).filter(function (x) { return !x._del; });
            var live = all.filter(function (x) { return !sourcesLib.skip(source, x); });
            var keep = new Set(live.map(function (x) { return x._id; }));
            var gone = [];
            idx.records().forEach(function (r) { if (!keep.has(r)) gone.push(r); });
            idx.removeRecords(gone);
            return indexRecords(source, idx, live, ctx).then(function (n) {
                run.done += all.length;
                run.embedded += n || 0;
                idx.dirty = idx.dirty || gone.length > 0;
                progress(run, source);
            });
        });
    }
    // Files under /media/internal: their names, and the words of text files and PDFs.
    function listFiles() {
        var out = [], seen = 0;
        function walk(dir, depth) {
            if (depth > 6 || seen > 20000 || out.length >= MAX_FILES) return Promise.resolve();
            return call(FILES + "list", { path: dir }).then(function (r) {
                var subdirs = [];
                (r.entries || []).forEach(function (e) {
                    seen++;
                    if (!e || !e.path || /^\./.test(e.name || "") || FILE_SKIP.test(e.path + (e.type === "directory" ? "/" : ""))) return;
                    if (e.type === "directory") subdirs.push(e.path);
                    else if (out.length < MAX_FILES) out.push(e);
                });
                return subdirs.reduce(function (p, d) { return p.then(function () { return walk(d, depth + 1); }); }, Promise.resolve());
            }, function () { /* not readable: skipped */ });
        }
        return walk(FILE_ROOT, 0).then(function () { return out; });
    }
    function fileRecord(e) {
        var r = { _id: e.path, path: e.path, name: e.name, mtime: e.mtime || 0, size: e.size || 0, text: "" };
        if (sourcesLib.TEXT_FILES.test(e.name) && e.size <= MAX_TEXT_BYTES * 4)
            return readText(e.path, MAX_TEXT_BYTES).then(function (t) {
                r.text = /\.html?$/i.test(e.name) ? chunk.htmlText(t || "") : chunk.clean(t || "");
                return r;
            });
        if (sourcesLib.PDF.test(e.name) && e.size <= MAX_MEDIA_BYTES)
            return readBytes(e.path, MAX_MEDIA_BYTES).then(function (bytes) {
                return bytes ? pdftext.extract(bytes, deps.inflate) : "";
            }).then(function (t) { r.text = chunk.clean(t || ""); return r; }, function () { return r; });
        return Promise.resolve(r);
    }
    function syncFiles(idx, run) {
        return listFiles().then(function (list) {
            var keep = new Set(list.map(function (e) { return e.path; }));
            var gone = Object.keys(idx.stamps).filter(function (p) { return !keep.has(p); });
            idx.removeRecords(gone);
            gone.forEach(function (p) { delete idx.stamps[p]; });
            if (gone.length) idx.dirty = true;
            var changedFiles = list.filter(function (e) { return idx.stamps[e.path] !== (e.size || 0) + ":" + (e.mtime || 0); });
            run.backlog += changedFiles.length;
            var i = 0;
            function next() {
                if (run.stop || i >= changedFiles.length) return Promise.resolve();
                var part = changedFiles.slice(i, i + 10);
                i += part.length;
                return Promise.all(part.map(fileRecord)).then(function (recs) {
                    return indexRecords("files", idx, recs, { readText: readText }).then(function (n) {
                        part.forEach(function (e) { idx.stamps[e.path] = (e.size || 0) + ":" + (e.mtime || 0); });
                        idx.dirty = true;
                        run.done += part.length;
                        run.embedded += n || 0;
                        progress(run, "files");
                        return allowed(run.backlog);
                    });
                }).then(function (a) {
                    if (!a.ok) { run.stop = true; run.waiting = a.why; return; }
                    return yieldThen(next);
                });
            }
            return next();
        });
    }
    function yieldThen(fn) { return new Promise(function (resolve) { later(function () { resolve(fn()); }, 0); }); }

    // Records gone without a trace (db8 purges what was deleted after a
    // while): every id the source still has, against the index. A full
    // pass does it (the daily activity, a rebuild); a search never shows
    // one meanwhile (describe reads each result again).
    function reconcile(source, idx) {
        var def = sourcesLib.find(source), have = new Set();
        function page(key) {
            var query = { from: def.kind, select: ["_id"], limit: 500 };
            if (key) query.page = key;
            return call(DB + "find", { query: query }).then(function (r) {
                (r.results || []).forEach(function (o) { have.add(o._id); });
                return r.next ? page(r.next) : null;
            });
        }
        return page(null).then(function () {
            var gone = [];
            idx.records().forEach(function (id) { if (!have.has(id)) gone.push(id); });
            idx.removeRecords(gone);
        }, function () { /* kept as it was */ });
    }

    // How many records wait in a source (for allowed()).
    function pendingIn(source, idx) {
        var def = sourcesLib.find(source);
        if (def.files) return Promise.resolve(0);
        return call(DB + "find", { query: { from: def.kind, where: [{ prop: "_rev", op: ">", val: idx.rev }], incDel: true, limit: 1 }, count: true })
            .then(function (r) { return typeof r.count === "number" ? r.count : (r.results || []).length; }, function () { return 0; });
    }

    // ---- A pass -------------------------------------------------------------------------------
    var running = null, again = false;
    function progress(run, source) {
        setState({ state: "indexing", progress: { source: source, done: run.done, embedded: run.embedded, backlog: run.backlog }, waiting: "" });
    }
    function pass(opts) {
        opts = opts || {};
        var s = settings();
        if (!s.enabled || !mayIndex()) return Promise.resolve({ ran: false });
        if (running) { again = true; return running; }
        var run = { done: 0, embedded: 0, backlog: 0, stop: false, waiting: "", mediaReady: false };
        var ids = sourcesLib.SOURCES.map(function (x) { return x.id; }).filter(function (id) { return s.sources[id] && (!opts.source || opts.source === id); });
        running = modelStatus().then(function (m) {
            if (!m.text.installed) { setState({ state: "needsModel", progress: null, waiting: "" }); return { ran: false }; }
            run.mediaReady = m.media.installed;
            return ids.reduce(function (p, id) {
                return p.then(function () {
                    if (run.stop) return;
                    return load(id).then(function (idx) {
                        return pendingIn(id, idx).then(function (n) {
                            run.backlog += n;
                            return allowed(run.backlog);
                        }).then(function (a) {
                            if (!a.ok) { run.stop = true; run.waiting = a.why; return; }
                            var def = sourcesLib.find(id);
                            var tidy = opts.full && !def.files ? reconcile(id, idx) : Promise.resolve();
                            return tidy.then(function () { return def.files ? syncFiles(idx, run) : syncKind(id, idx, run); }).then(function () { return save(id, idx); });
                        });
                    });
                });
            }, Promise.resolve()).then(function () {
                var st = state();
                ids.forEach(function (id) { if (loaded[id]) st.revs[id] = loaded[id].idx.rev; });
                setState({ revs: st.revs, state: run.waiting ? "waiting" : "idle", progress: null, waiting: run.waiting, lastRun: now(), error: "" });
                return { ran: true, records: run.done, embedded: run.embedded, waiting: run.waiting };
            });
        }).catch(function (e) {
            log("indexing stopped: " + (e && e.message));
            setState({ state: e && e.code === "NO_MODEL" ? "needsModel" : "error", progress: null, error: String(e && e.message || e) });
            return { ran: false, error: String(e && e.message || e) };
        }).then(function (r) {
            running = null;
            if (again) { again = false; later(function () { pass({}); }, 0); }
            return r;
        });
        return running;
    }

    // ---- Search ---------------------------------------------------------------------------------
    var icons = null;
    function iconOf(appId) {
        var get = icons ? Promise.resolve(icons) : call("luna://com.palm.applicationManager/listLaunchPoints", {}).then(function (r) {
            icons = {};
            (r.launchPoints || []).forEach(function (lp) { if (lp.id && lp.icon && !icons[lp.id]) icons[lp.id] = lp.icon; });
            return icons;
        }, function () { return {}; });
        return get.then(function (m) { return m[appId] || ""; });
    }
    function words(q) {
        return chunk.clean(q).toLowerCase().replace(/[^a-z0-9À-￿' ]+/g, " ").split(/\s+/)
            .filter(function (w) { return w.length > 2 && !STOP.test(w); });
    }
    // The records of these ids, read again (what a result shows).
    function recordsOf(source, ids) {
        if (sourcesLib.find(source).files) {
            return Promise.all(ids.map(function (path) {
                return call(FILES + "stat", { path: path }).then(function (r) { return r.entry ? fileRecord(r.entry) : null; }, function () { return null; });
            }));
        }
        return call(DB + "get", { ids: ids }).then(function (r) {
            var by = {};
            (r.results || []).forEach(function (o) { if (o && o._id && !o._del) by[o._id] = o; });
            return ids.map(function (id) { return by[id] || null; });
        }, function () { return ids.map(function () { return null; }); });
    }
    function search(p) {
        var s = settings(), t0 = now();
        var query = chunk.clean(p.query || "");
        if (!query) return Promise.resolve(fail(-1, "need \"query\""));
        if (!s.enabled) return Promise.resolve(ok({ enabled: false, results: [] }));
        var limit = Math.max(1, Math.min(50, Number(p.limit) || 8));
        var minScore = typeof p.minScore === "number" ? p.minScore : typeof deps.minScore === "number" ? deps.minScore : MIN_SCORE;
        var want = (Array.isArray(p.sources) && p.sources.length ? p.sources : sourcesLib.SOURCES.map(function (x) { return x.id; }))
            .filter(function (id) { return sourcesLib.find(id) && s.sources[id]; });
        var from = Array.isArray(p.from) && p.from.length ? new Set(p.from.map(sourcesLib.normAddr).filter(Boolean)) : null;
        var said = words(query);
        searching++;
        var done = function (r) { searching = Math.max(0, searching - 1); return r; };
        return embedder.query(query).then(function (qv) {
            return Promise.all(want.map(function (id) { return load(id).then(function (idx) { return { id: id, idx: idx }; }); })).then(function (all) {
                // The best passage of each record, every source together.
                var cands = [];
                all.forEach(function (x) {
                    var idx = x.idx, n = idx.count();
                    if (!n) return;
                    var sc = vectors.scores(qv, idx.vecs, idx.scales, n, idx.dim), best = new Map();
                    for (var k = 0; k < n; ++k) {
                        var it = idx.items[k];
                        if (from && !from.has(it.a)) continue;
                        var b = best.get(it.r);
                        if (!b || sc[k] > b.score) best.set(it.r, { source: x.id, r: it.r, c: it.c, m: it.m || "", t: it.t, score: sc[k] });
                    }
                    best.forEach(function (v) { if (v.score >= minScore - 0.12) cands.push(v); });
                });
                cands.sort(function (a, b) { return b.score - a.score || (b.t || 0) - (a.t || 0); });
                cands = cands.slice(0, limit * 3);
                return describe(cands, said, query, p).then(function (list) {
                    // At least minScore, and near the best: unrelated passages
                    // score 0.6 to 0.78, what was asked for 0.8 to 0.9 (measured,
                    // docs/AI-AND-MCP.md "Search your phone"), so a weak match is not shown
                    // beside a strong one.
                    var best = list.reduce(function (m, x) { return Math.max(m, x.score); }, 0);
                    var margin = typeof p.margin === "number" ? p.margin : typeof deps.margin === "number" ? deps.margin : MARGIN;
                    var floor = Math.max(minScore, best - margin);
                    var out = list.filter(function (x) { return x.score >= floor || (x.literal > 0 && x.vector >= minScore - 0.12 && x.score >= best - margin); })
                        .sort(function (a, b) { return b.score - a.score || (b.time || 0) - (a.time || 0); }).slice(0, limit);
                    out.forEach(function (x) { delete x.literal; delete x.vector; x.score = Math.round(x.score * 1000) / 1000; });
                    return ok({ results: out, answers: s.answers, took: now() - t0 });
                });
            });
        }).then(done, function (e) {
            done();
            return e && e.code === "NO_MODEL" ? ok({ results: [], needsModel: true }) : fail(-1, String(e && e.message || e));
        });
    }
    // Candidates as results: read again from their records (gone ones
    // dropped), a passage as the snippet, and a little more for the words
    // asked themselves (a name, a number): literal.
    function describe(cands, said, query, p) {
        var bySource = {};
        cands.forEach(function (c) { (bySource[c.source] = bySource[c.source] || []).push(c); });
        return Promise.all([peopleNames()].concat(Object.keys(bySource).map(function (source) {
            var list = bySource[source];
            return recordsOf(source, list.map(function (c) { return c.r; })).then(function (recs) { list.forEach(function (c, i) { c.rec = recs[i]; }); });
        }))).then(function (got) {
            var ctx = { names: got[0], readText: readText };
            var live = cands.filter(function (c) { return c.rec; });
            return Promise.all(live.map(function (c) {
                var def = sourcesLib.find(c.source);
                return Promise.all([sourcesLib.passagesOf(c.source, c.rec, ctx), iconOf(def.appId)]).then(function (x) {
                    var passages = x[0], shown = sourcesLib.show(c.source, c.rec, ctx);
                    var plain = c.m ? "" : (passages[c.c] || passages[0] || { plain: "" }).plain;
                    // Who wrote it is shown apart (who): the snippet is what they wrote.
                    var head = plain ? sourcesLib.headerOf(c.source, c.rec, ctx) : "";
                    var body = head && plain.indexOf(head) === 0 ? plain.slice(head.length).trim() : plain;
                    var text = (shown.title + " " + plain).toLowerCase();
                    var hits = said.filter(function (w) { return text.indexOf(w) >= 0; }).length;
                    var literal = said.length ? hits / said.length : 0;
                    if (p.skipLiteral && text.indexOf(chunk.clean(query).toLowerCase()) >= 0) return null;
                    return {
                        source: c.source, sourceTitle: def.title, appId: def.appId, icon: x[1], id: c.r,
                        score: c.score + 0.06 * literal, vector: c.score, literal: literal, media: c.m || undefined,
                        title: shown.title, who: shown.who || "", time: shown.time || 0, allDay: !!shown.allDay, place: shown.place || "",
                        path: shown.path || "", snippet: snippet(body, said),
                        open: { appId: def.appId, params: shown.params }
                    };
                });
            })).then(function (list) { return list.filter(Boolean); });
        });
    }
    // At most 200 characters of a passage, around the first word asked.
    function snippet(text, said) {
        text = chunk.clean(text).replace(/\s+/g, " ");
        if (text.length <= 200) return text;
        var low = text.toLowerCase(), at = -1;
        said.some(function (w) { at = low.indexOf(w); return at >= 0; });
        var start = Math.max(0, Math.min(text.length - 200, at < 0 ? 0 : at - 60));
        var cut = text.slice(start, start + 200);
        return (start > 0 ? "…" : "") + cut.replace(/\s+\S*$/, "") + "…";
    }

    // ---- Status ----------------------------------------------------------------------------------
    function getStatus() {
        var s = settings(), st = state();
        return modelStatus().then(function (m) {
            var total = { records: 0, passages: 0, bytes: 0 };
            var list = sourcesLib.SOURCES.map(function (x) {
                var z = s.sources[x.id] ? sizeOf(x.id) : { bytes: 0, passages: 0, records: 0 };
                total.records += z.records; total.passages += z.passages; total.bytes += z.bytes;
                return { id: x.id, title: x.title, enabled: !!s.sources[x.id], media: x.media || undefined, records: z.records, passages: z.passages, bytes: z.bytes };
            });
            var stateNow = !s.enabled ? "off" : !m.text.installed ? "needsModel" : running ? "indexing" : st.state === "indexing" ? "idle" : st.state;
            // The model came (a download finished): the first pass now.
            if (s.enabled && m.text.installed && st.state === "needsModel" && !running && mayIndex()) {
                stateNow = "indexing";
                later(function () { pass({}); }, 0);
            }
            return ok({ enabled: s.enabled, settings: s, state: stateNow, progress: running ? st.progress : null, waiting: st.waiting || "",
                        error: st.error || "", lastRun: st.lastRun || 0, sources: list, records: total.records, passages: total.passages, bytes: total.bytes,
                        model: { text: m.text, media: m.media }, server: { available: m.available, howToInstall: m.howToInstall, error: m.error } });
        });
    }

    // ---- The methods --------------------------------------------------------------------------------
    function may(list, caller) { return !deps.caller || caller === undefined || caller === null || list.indexOf(caller) >= 0; }
    var methods = {
        getStatus: function () { return getStatus(); },
        setSettings: function (p, caller) {
            if (!may(CHANGERS, caller)) return Promise.resolve(fail(-1, "only Settings changes the index"));
            var s = settings(), next = Object.assign({}, s), off = [];
            if (typeof p.enabled === "boolean") next.enabled = p.enabled;
            if (typeof p.media === "boolean") next.media = p.media;
            if (typeof p.answers === "boolean") next.answers = p.answers;
            if (p.sources && typeof p.sources === "object") {
                next.sources = Object.assign({}, s.sources);
                Object.keys(p.sources).forEach(function (id) {
                    if (!sourcesLib.find(id)) return;
                    var on = !!p.sources[id];
                    if (s.sources[id] && !on) off.push(id);
                    next.sources[id] = on;
                });
            }
            storage.set(SETTINGS_KEY, next);
            // A source turned off: what it put in the index goes with it.
            var dropping = Promise.all(off.map(drop));
            // Pictures and recordings no longer embedded themselves: their vectors out;
            // embedded from now on: every one looked at again (not only what changes).
            if (s.media && next.media === false) dropping = dropping.then(dropMedia);
            if (!s.media && next.media === true) dropping = dropping.then(rescanMedia);
            return dropping.then(function () {
                changed();
                if (next.enabled) later(function () { pass({}); }, 0);
                return getStatus();
            });
        },
        search: function (p, caller) {
            if (!may(SEARCHERS, caller)) return Promise.resolve(fail(-1, "not allowed to search the index"));
            return search(p || {});
        },
        sync: function (p, caller) {
            if (!may(SYNCERS, caller)) return Promise.resolve(fail(-1, "not allowed"));
            p = p || {};
            return pass({ source: p.source, full: !!p.full }).then(function (r) { return ok(r); });
        },
        rebuild: function (p, caller) {
            if (!may(CHANGERS, caller)) return Promise.resolve(fail(-1, "only Settings rebuilds the index"));
            return Promise.all(sourcesLib.SOURCES.map(function (x) { return drop(x.id); })).then(function () {
                setState({ revs: {}, state: "idle", progress: null, error: "" });
                if (settings().enabled) later(function () { pass({}); }, 0);
                return getStatus();
            });
        },
        deleteIndex: function (p, caller) {
            if (!may(CHANGERS, caller)) return Promise.resolve(fail(-1, "only Settings deletes the index"));
            storage.set(SETTINGS_KEY, Object.assign(settings(), { enabled: false }));
            return Promise.all(sourcesLib.SOURCES.map(function (x) { return drop(x.id); })).then(function () {
                setState({ revs: {}, state: "off", progress: null, waiting: "", error: "" });
                return getStatus();
            });
        },
        downloadModel: function (p, caller) {
            if (!may(CHANGERS, caller)) return Promise.resolve(fail(-1, "only Settings downloads models"));
            var m = p && p.media ? modelLib.MEDIA : modelLib.TEXT;
            return Promise.resolve(deps.models.download(m)).then(function () { changed(); return ok(); },
                                                                  function (e) { return fail(-1, String(e && e.message || e)); });
        },
        cancelDownload: function (p, caller) {
            if (!may(CHANGERS, caller)) return Promise.resolve(fail(-1, "only Settings downloads models"));
            return modelStatus().then(function (m) {
                var id = m.text.downloading ? m.text.id : m.media.downloading ? m.media.id : "";
                return id ? deps.models.cancel(id) : null;
            }).then(function () { changed(); return ok(); });
        },
        removeModel: function (p, caller) {
            if (!may(CHANGERS, caller)) return Promise.resolve(fail(-1, "only Settings removes models"));
            var m = p && p.media ? modelLib.MEDIA : modelLib.TEXT;
            return Promise.resolve(deps.models.remove(m)).then(function () { changed(); return ok(); });
        },
        wipe: function (p, caller) {
            if (!may(ERASERS, caller)) return Promise.resolve(fail(-1, "not allowed to erase the index"));
            return Promise.all(sourcesLib.SOURCES.map(function (x) { return drop(x.id); })).then(function () {
                storage.remove(SETTINGS_KEY);
                storage.remove(STATE_KEY);
                if (embedder.forget) embedder.forget();
                changed();
                return ok();
            });
        }
    };
    // The pictures' and recordings' own vectors out; their words stay
    // (the hashes then differ, so the next pass with media on embeds them again).
    function rescanMedia() {
        return Promise.all(sourcesLib.SOURCES.filter(function (x) { return x.media; }).map(function (x) {
            return load(x.id).then(function (idx) {
                if (!idx.rev) return;
                idx.rev = 0;
                idx.dirty = true;
                return save(x.id, idx);
            });
        }));
    }
    function dropMedia() {
        return Promise.all(sourcesLib.SOURCES.filter(function (x) { return x.media; }).map(function (x) {
            return load(x.id).then(function (idx) {
                if (!idx.removeWhere(function (it) { return !!it.m; })) return;
                return save(x.id, idx);
            });
        }));
    }

    return { methods: methods, pass: pass, settings: settings, load: load, embedder: embedder,
             running: function () { return !!running; } };
}

module.exports = { createIndexService: createIndexService, SERVICE: SERVICE, METHODS: METHODS, DEFAULTS: DEFAULTS, MIN_SCORE: MIN_SCORE,
                   SEARCHERS: SEARCHERS, CHANGERS: CHANGERS, ERASERS: ERASERS };
