// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.backup: backs the device up to one encrypted
// file, on the USB drive or a WebDAV server, and restores it.
//
// Legacy webOS's backup service (com.palm.service.backup) was never
// released, but the protocol its participants speak was, and OSE still
// ships it: each service that has something to back up installs a
// registration file in /etc/palm/backup/
//
//   {"id": "com.webos.service.systemservice",
//    "preBackup": "backup/preBackup", "postRestore": "backup/postRestore"}
//
// (luna-sysservice files/conf/*.backupRegistration.json). For a backup,
// each participant is called with
//
//   preBackup {tempDir, maxTempBytes, incrementalKey}   (+ dir and bytes, the
//             names db8's internal/preBackup takes for the same things)
//   -> {description, version, files: [paths, absolute or relative to tempDir]}
//
// and for a restore, its files are put back in a temporary folder and
//
//   postRestore {tempDir, dir, files: [names]}
//
// (luna-sysservice Src/BackupManager.cpp, luna-sysmgr Src/base/BackupManager.cpp,
// db8 src/db/MojDbServiceHandlerInternal.cpp). Phoenix ships the
// registrations for db8 (com.palm.db) and the shell (com.palm.sysMgrDataBackup);
// luna-sysservice brings its own.
//
// Methods:
//   getStatus {subscribe?}   -> the status below; with subscribe, again on
//                               every change
//   configure {destination?: {type: "usb"} | {type: "webdav", url, username,
//              password} | {type: "phoenix"}, passphrase?, auto?}
//                            a WebDAV folder is checked (and made) first; the
//                            passphrase is kept only as a derived key.
//                            "phoenix" is Phoenix Cloud Backup (PLATFORM.md
//                            6.5.1): a WebDAV folder per device on the
//                            platform, whose address and app password the
//                            Phoenix Account service gives this service
//                            (org.webosphoenix.service.account
//                            backupCredentials; NOT_SET_UP without an
//                            account server, SIGNED_OUT without a sign-in).
//                            The files are the same encrypted .pbak: the
//                            server stores ciphertext.
//   backupNow {}             -> {name, size, parts}
//   listBackups {}           -> {backups: [{name, size, created}]}, newest first
//   inspect {name}           -> {header}: when, from which device, which parts
//   restore {name, passphrase} -> {restored: [ids], skipped: [ids]}
//   deleteBackup {name}
//   scheduled {$activity}    the daily activity (configure {auto: true})
//
// Status: {state: "idle" | "backingUp" | "restoring", configured,
//   hasPassphrase, auto, destination (no password), last: {time, ok, name,
//   size, errorCode, errorText} | null, lastSuccess}
//
// Errors: {returnValue: false, errorCode, errorText}, errorCode one of
// NOT_CONFIGURED, NO_PASSPHRASE, BUSY, BAD_URL, UNAUTHORIZED,
// CONNECTION_FAILED, BAD_SERVER, NO_SPACE, NOT_FOUND, NOT_A_BACKUP,
// NEWER_VERSION, WRONG_PASSPHRASE, NOTHING_TO_BACK_UP, BAD_PARAMS.
//
// It is written against injected dependencies (createBackupService below),
// so it runs unchanged on a device (service.js), in the simulator
// (runtime/phoenix-runtime.js) and in tests.

"use strict";

var archiveLib = require("./lib/archive");
var webdav = require("./lib/webdav");

var SERVICE = "org.webosphoenix.service.backup";
var METHODS = ["getStatus", "configure", "backupNow", "listBackups", "inspect", "restore", "deleteBackup", "scheduled"];
var USB_FOLDER = "/media/internal/backups";
var KEEP = 5;                     // backups kept in the folder; older ones are deleted
var STALE_DAYS = 5;               // luna-systemui's BackupDashboard default
var ACTIVITY = "org.webosphoenix.backup.daily";
var MAX_TEMP_BYTES = 100 * 1024 * 1024;
var NAME_RE = /^phoenix-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.pbak$/;

function fail(code, text) {
    return { returnValue: false, errorCode: code, errorText: text };
}
function errorReply(e) {
    if (e && e.code && /^[A-Z_]+$/.test(e.code)) return fail(e.code, e.message);
    return fail("UNKNOWN_ERROR", (e && e.message) || String(e));
}
function pad(n) { return (n < 10 ? "0" : "") + n; }
function fileName(date) {
    return "phoenix-backup-" + date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) + "-" +
        pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + ".pbak";
}
function createdOf(name) {
    var m = NAME_RE.exec(name);
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString() : null;
}
function joinPath(dir, name) {
    return name.charAt(0) === "/" ? name : dir.replace(/\/$/, "") + "/" + name;
}
function baseName(path) { return String(path).split("/").pop(); }

// deps:
//   luna.call(uri, params) -> Promise<reply>
//   request                  lib/webdav.js's HTTP
//   crypto                   lib/archive.js's crypto, plus exportKey(key) and
//                            importKey(text) for the kept key
//   config.load() / config.save(obj)   the service's private settings
//   temp.make() -> dir, temp.read(path) -> Uint8Array,
//   temp.write(path, Uint8Array), temp.remove(dir)
//   usb.list(dir) -> [{name, size, modified}], usb.read(path) -> text,
//   usb.write(path, text), usb.remove(path), usb.mkdir(dir)
//   participants() -> [{id, preBackup, postRestore}]
//   now() -> Date (optional), log(msg) (optional)
function createBackupService(deps) {
    var archive = archiveLib.createArchive({ crypto: deps.crypto });
    var log = deps.log || function () {};
    var now = deps.now || function () { return new Date(); };
    var state = "idle";
    var watchers = [];

    function cfg() {
        var c = deps.config.load() || {};
        return { destination: c.destination || null, auto: !!c.auto, key: c.key || null, last: c.last || null,
                 lastSuccess: c.lastSuccess || null, warned: c.warned || null };
    }
    function save(c) { deps.config.save(c); }

    function status() {
        var c = cfg();
        var dest = c.destination ? (c.destination.type === "webdav" || c.destination.type === "phoenix"
            ? { type: c.destination.type, url: c.destination.url, username: c.destination.username || "" }
            : { type: "usb", folder: USB_FOLDER }) : null;
        return { returnValue: true, state: state, configured: !!(dest && c.key), hasPassphrase: !!c.key, auto: c.auto,
                 destination: dest, last: c.last, lastSuccess: c.lastSuccess };
    }
    function changed() {
        var s = status();
        watchers.slice().forEach(function (w) { w(s); });
    }
    function setState(s) { state = s; changed(); }

    // The place backups go: {list, read, write, remove, prepare}.
    function storeFor(dest) {
        if (!dest) throw Object.assign(new Error("Choose where backups go first"), { code: "NOT_CONFIGURED" });
        if (dest.type === "webdav" || dest.type === "phoenix") {
            var dav = webdav.createClient({ request: deps.request, url: dest.url, username: dest.username, password: dest.password });
            return { prepare: dav.ensureFolder, list: dav.list, read: dav.get, write: dav.put, remove: dav.remove };
        }
        return {
            prepare: function () { return Promise.resolve(deps.usb.mkdir(USB_FOLDER)); },
            list: function () { return Promise.resolve(deps.usb.list(USB_FOLDER)); },
            read: function (name) { return Promise.resolve(deps.usb.read(USB_FOLDER + "/" + name)); },
            write: function (name, text) { return Promise.resolve(deps.usb.write(USB_FOLDER + "/" + name, text)); },
            remove: function (name) { return Promise.resolve(deps.usb.remove(USB_FOLDER + "/" + name)); }
        };
    }
    function backupsIn(store) {
        return store.list().then(function (files) {
            return files.filter(function (f) { return NAME_RE.test(f.name); }).map(function (f) {
                return { name: f.name, size: f.size || 0, created: createdOf(f.name) };
            }).sort(function (a, b) { return a.name < b.name ? 1 : a.name > b.name ? -1 : 0; });
        });
    }

    function participants() {
        return Promise.resolve(deps.participants()).then(function (list) {
            return (list || []).filter(function (p) { return p && p.id; }).sort(function (a, b) { return a.id < b.id ? -1 : 1; });
        });
    }
    function uri(p, method) {
        return "luna://" + p.id + "/" + String(method).replace(/^\//, "");
    }

    function device() {
        return deps.luna.call("luna://com.webos.service.systemservice/deviceInfo/query", {}).then(function (r) {
            return { name: (r && (r.device_name || r.modelName)) || "", model: (r && r.modelName) || "" };
        }, function () { return {}; });
    }

    // Every participant's preBackup and its files -> parts.
    function collect(tempDir) {
        return participants().then(function (list) {
            var parts = [], failed = [];
            return list.reduce(function (chain, p) {
                if (!p.preBackup) return chain;
                return chain.then(function () {
                    return deps.luna.call(uri(p, p.preBackup), { tempDir: tempDir, dir: tempDir, maxTempBytes: MAX_TEMP_BYTES,
                                                                bytes: MAX_TEMP_BYTES, incrementalKey: {} });
                }).then(function (r) {
                    if (!r || r.returnValue === false) {
                        failed.push(p.id);
                        log("preBackup failed for " + p.id + ": " + JSON.stringify(r));
                        return;
                    }
                    return Promise.all((r.files || []).map(function (f) {
                        var path = joinPath(tempDir, String(f));
                        return Promise.resolve(deps.temp.read(path)).then(function (data) {
                            return { name: baseName(path), data: data };
                        });
                    })).then(function (files) {
                        parts.push({ id: p.id, description: r.description || "", version: String(r.version || ""), files: files });
                    });
                }, function (e) {
                    failed.push(p.id);
                    log("preBackup failed for " + p.id + ": " + e);
                });
            }, Promise.resolve()).then(function () { return { parts: parts, failed: failed }; });
        });
    }

    function record(c, last) {
        c.last = last;
        if (last.ok) {
            c.lastSuccess = last.time;
            c.warned = null;
        }
        save(c);
    }

    function backupNow() {
        if (state !== "idle") return Promise.resolve(fail("BUSY", "A backup or restore is running"));
        var c = cfg();
        if (!c.destination) return Promise.resolve(fail("NOT_CONFIGURED", "Choose where backups go first"));
        if (!c.key) return Promise.resolve(fail("NO_PASSPHRASE", "Set a backup passphrase first"));
        var started = now(), name = fileName(started), tempDir, store, size = 0, partIds = [];
        setState("backingUp");
        return Promise.resolve(deps.temp.make()).then(function (dir) {
            tempDir = dir;
            store = storeFor(c.destination);
            return store.prepare();
        }).then(function () {
            return collect(tempDir);
        }).then(function (got) {
            if (!got.parts.length) throw Object.assign(new Error("Nothing could be backed up"), { code: "NOTHING_TO_BACK_UP" });
            partIds = got.parts.map(function (p) { return p.id; });
            return Promise.all([deps.crypto.importKey(c.key.key), device()]).then(function (r) {
                return archive.seal({ key: r[0], salt: archiveLib.fromBase64(c.key.salt), iterations: c.key.iterations },
                                    got.parts, { created: started.toISOString(), device: r[1] });
            });
        }).then(function (text) {
            size = text.length;
            return store.write(name, text);
        }).then(function () {
            // Keep the newest few.
            return backupsIn(store).then(function (all) {
                return Promise.all(all.slice(KEEP).map(function (b) { return store.remove(b.name); }));
            });
        }).then(function () {
            record(cfg(), { time: started.toISOString(), ok: true, name: name, size: size });
            log("backed up " + partIds.join(", ") + " to " + name);
            return { returnValue: true, name: name, size: size, parts: partIds };
        }, function (e) {
            var r = errorReply(e);
            record(cfg(), { time: started.toISOString(), ok: false, errorCode: r.errorCode, errorText: r.errorText });
            log("backup failed: " + r.errorText);
            return r;
        }).then(function (r) {
            return Promise.resolve(tempDir && deps.temp.remove(tempDir)).then(function () {
                setState("idle");
                return r;
            }, function () {
                setState("idle");
                return r;
            });
        });
    }

    function restore(p) {
        if (state !== "idle") return Promise.resolve(fail("BUSY", "A backup or restore is running"));
        if (!p.name || !NAME_RE.test(p.name)) return Promise.resolve(fail("BAD_PARAMS", "name: a backup's file name"));
        if (!p.passphrase) return Promise.resolve(fail("BAD_PARAMS", "passphrase is required"));
        var c = cfg(), tempDir, restored = [], skipped = [];
        setState("restoring");
        return Promise.resolve().then(function () {
            return storeFor(p.destination || c.destination).read(p.name);
        }).then(function (text) {
            return archive.open(text, p.passphrase);
        }).then(function (opened) {
            return Promise.all([Promise.resolve(deps.temp.make()), participants()]).then(function (r) {
                tempDir = r[0];
                var byId = {};
                r[1].forEach(function (x) { byId[x.id] = x; });
                return opened.parts.reduce(function (chain, part) {
                    var who = byId[part.id];
                    if (!who || !who.postRestore) {
                        skipped.push(part.id);
                        return chain;
                    }
                    return chain.then(function () {
                        return Promise.all(part.files.map(function (f) {
                            return deps.temp.write(joinPath(tempDir, baseName(f.name)), f.data);
                        }));
                    }).then(function () {
                        return deps.luna.call(uri(who, who.postRestore), {
                            tempDir: tempDir, dir: tempDir, files: part.files.map(function (f) { return baseName(f.name); })
                        });
                    }).then(function (r2) {
                        if (r2 && r2.returnValue !== false) restored.push(part.id);
                        else {
                            skipped.push(part.id);
                            log("postRestore failed for " + part.id + ": " + JSON.stringify(r2));
                        }
                    }, function (e) {
                        skipped.push(part.id);
                        log("postRestore failed for " + part.id + ": " + e);
                    });
                }, Promise.resolve());
            });
        }).then(function () {
            return { returnValue: true, restored: restored, skipped: skipped };
        }, errorReply).then(function (r) {
            return Promise.resolve(tempDir && deps.temp.remove(tempDir)).then(null, function () {}).then(function () {
                setState("idle");
                return r;
            });
        });
    }

    function schedule(on, dest) {
        if (!on) return deps.luna.call("luna://com.palm.activitymanager/cancel", { activityName: ACTIVITY });
        var requirements = dest && (dest.type === "webdav" || dest.type === "phoenix") ? { internet: true } : {};
        return deps.luna.call("luna://com.palm.activitymanager/create", {
            start: true, replace: true,
            activity: {
                name: ACTIVITY, description: "Daily backup", type: { background: true, persist: true },
                schedule: { interval: "24h" }, requirements: requirements,
                callback: { method: "luna://" + SERVICE + "/scheduled", params: {} }
            }
        });
    }

    function configure(p) {
        if (state !== "idle") return Promise.resolve(fail("BUSY", "A backup or restore is running"));
        var c = cfg(), dest = c.destination;
        var steps = Promise.resolve();
        if (p.destination !== undefined) {
            var d = p.destination;
            if (!d || (d.type !== "usb" && d.type !== "webdav" && d.type !== "phoenix"))
                return Promise.resolve(fail("BAD_PARAMS", "destination.type: usb, webdav or phoenix"));
            if (d.type === "phoenix") {
                // Phoenix Cloud: this device's folder and app password from the account.
                steps = steps.then(function () {
                    return deps.luna.call("luna://org.webosphoenix.service.account/backupCredentials", {});
                }).then(function (r) {
                    if (!r || !r.returnValue) {
                        throw Object.assign(new Error((r && r.errorText) || "Phoenix Cloud is not available"),
                                            { code: (r && r.errorCode) || "NOT_SET_UP" });
                    }
                    dest = { type: "phoenix", url: r.url, username: r.username, password: r.password };
                    return webdav.createClient({ request: deps.request, url: dest.url, username: dest.username, password: dest.password }).ensureFolder();
                });
            } else if (d.type === "webdav") {
                var old = c.destination && c.destination.type === "webdav" ? c.destination : {};
                // A blank password keeps the one already stored for that server and user.
                var password = d.password !== undefined && d.password !== "" ? d.password
                    : (old.url === d.url && old.username === d.username ? old.password : "");
                dest = { type: "webdav", url: String(d.url || "").trim(), username: String(d.username || ""), password: password || "" };
                steps = steps.then(function () {
                    return webdav.createClient({ request: deps.request, url: dest.url, username: dest.username, password: dest.password }).ensureFolder();
                });
            } else {
                dest = { type: "usb" };
            }
        }
        var key = c.key;
        if (p.passphrase !== undefined) {
            if (typeof p.passphrase !== "string" || p.passphrase.length < 8)
                return Promise.resolve(fail("BAD_PARAMS", "The passphrase needs at least 8 characters"));
            steps = steps.then(function () {
                return archive.makeKey(p.passphrase).then(function (k) {
                    return deps.crypto.exportKey(k.key).then(function (text) {
                        key = { key: text, salt: archiveLib.toBase64(k.salt), iterations: k.iterations };
                    });
                });
            });
        }
        var auto = p.auto !== undefined ? !!p.auto : c.auto;
        return steps.then(function () {
            var c2 = cfg();
            c2.destination = dest;
            c2.key = key;
            c2.auto = auto;
            save(c2);
            return schedule(auto && !!dest, dest);
        }).then(function () {
            changed();
            return status();
        }, errorReply);
    }

    // The daily activity: back up, and when backups keep failing, say so
    // the way legacy webOS did (luna-systemui's "Backup Failure" dashboard,
    // through com.palm.systemmanager's subscribeToBackupStatus event).
    function scheduled(p) {
        var c = cfg();
        var activityId = p && p.$activity && p.$activity.activityId;
        var run = c.auto && c.destination && c.key ? backupNow() : Promise.resolve({ returnValue: true, skipped: true });
        return run.then(function (r) {
            var c2 = cfg();
            var since = c2.lastSuccess ? new Date(c2.lastSuccess).getTime() : null;
            var days = since === null ? null : Math.floor((now().getTime() - since) / 86400000);
            var warn = r.returnValue === false && (days === null || days >= STALE_DAYS) && c2.warned !== (c2.lastSuccess || "never");
            var told = warn ? deps.luna.call("luna://com.palm.systemmanager/publishToSystemUI", {
                event: "subscribeToBackupStatus",
                message: { returnValue: true, notify: true, duration: days === null ? STALE_DAYS : days }
            }).then(function () {
                c2.warned = c2.lastSuccess || "never";
                save(c2);
            }) : Promise.resolve();
            return told.then(function () {
                return activityId ? deps.luna.call("luna://com.palm.activitymanager/complete", { activityId: activityId, restart: true }) : null;
            }).then(function () { return r; });
        });
    }

    return {
        getStatus: function (p, push) {
            if (p && p.subscribe && push) {
                watchers.push(push);
                var s = status();
                s.subscribed = true;
                return Promise.resolve(s);
            }
            return Promise.resolve(status());
        },
        // A subscriber went away.
        unwatch: function (push) {
            watchers = watchers.filter(function (w) { return w !== push; });
        },
        configure: function (p) { return configure(p || {}); },
        backupNow: function () { return backupNow(); },
        listBackups: function () {
            return Promise.resolve().then(function () {
                return backupsIn(storeFor(cfg().destination));
            }).then(function (b) { return { returnValue: true, backups: b }; }, errorReply);
        },
        inspect: function (p) {
            if (!p || !NAME_RE.test(p.name || "")) return Promise.resolve(fail("BAD_PARAMS", "name: a backup's file name"));
            return Promise.resolve().then(function () {
                return storeFor(cfg().destination).read(p.name);
            }).then(function (text) {
                return { returnValue: true, header: archiveLib.headerOf(archiveLib.parse(text)) };
            }, errorReply);
        },
        restore: function (p) { return restore(p || {}); },
        deleteBackup: function (p) {
            if (!p || !NAME_RE.test(p.name || "")) return Promise.resolve(fail("BAD_PARAMS", "name: a backup's file name"));
            return Promise.resolve().then(function () {
                return storeFor(cfg().destination).remove(p.name);
            }).then(function () { return { returnValue: true }; }, errorReply);
        },
        scheduled: function (p) { return scheduled(p || {}); }
    };
}

module.exports = {
    SERVICE: SERVICE, METHODS: METHODS, USB_FOLDER: USB_FOLDER, KEEP: KEEP, ACTIVITY: ACTIVITY,
    createBackupService: createBackupService, fileName: fileName
};
