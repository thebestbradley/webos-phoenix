// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.hardware: the device's hardware, and the drivers and
// firmware it is missing (docs/HARDWARE.md, "Hardware support and the
// Hardware app"; docs/DRIVERS.md). What Ubuntu's "Additional Drivers"
// (ubuntu-drivers) and Windows' driver installer do, for Phoenix:
//
//   1. Lists the hardware: every device on the buses that say what they are
//      (PCI, USB, SDIO, and the device tree's and ACPI's named devices), each
//      with its IDs (modaliases), the driver bound to it and the firmware
//      files its driver asked for and did not get (lib/sysfs.js on a device).
//   2. Matches it against the signed driver catalog (lib/drivers.js; written
//      by server/drivers): kernel modules, firmware and services packaged as
//      .ipk, each with its licence, size and sources.
//   3. Installs what the user accepts with opkg, reloads the driver (or asks
//      for a restart), checks the device works, and puts things back as they
//      were if it does not.
//
// Firmware that may be redistributed but is not open source is not in the
// system image; it is offered here, with its licence, and downloaded only
// when the user says so (docs/LEGAL.md, "Firmware and drivers").
//
// Methods:
//   list {subscribe?}          -> {devices: [device], catalog, pendingRestart,
//                                  report: {enabled, lastSent}}; again after
//                                  every change with subscribe
//       device: {id, bus, name, vendor, category, ids, driver, firmwareMissing,
//                status: "working" | "needs-firmware" | "needs-driver" |
//                        "no-driver" | "restart", offers: [offer]}
//       offer: {driverId, kind, title, summary, optional, after, license:
//               {id, name, text, url, free}, size, installedSize, version,
//               available, reason, installed}
//   refresh {}                 reads the driver catalog again
//   install {driverId, deviceId?, acceptLicense?, subscribe?}
//       acceptLicense: the licence's id, when it is not a free licence (the
//       user saw it and agreed). Progress {state: "downloading" | "checking"
//       | "installing" | "activating" | "installed" | "restart" | "failed",
//       progress, errorCode, errorText, rolledBack}; also an ongoing activity
//       in the notification area while it runs
//   remove {driverId}
//   getReport {}               -> {report}: what sendReport would send (IDs only)
//   sendReport {}              sends it, now
//   setPreferences {reportEnabled}
//   scheduled {$activity}      after start-up and daily: tells the user about
//                              new hardware that needs something, and sends
//                              the report when they opted in
//
// Errors: {returnValue: false, errorCode, errorText}: NOT_FOUND, UNTRUSTED,
// BAD_SIGNATURE, EXPIRED, ROLLBACK, BAD_INDEX, CONNECTION_FAILED,
// DOWNLOAD_FAILED, BAD_DOWNLOAD, UNSUPPORTED, LICENSE_REQUIRED,
// INSTALL_FAILED, VERIFY_FAILED, NOT_INSTALLED, BUSY, BAD_PARAMS.
//
// Written against injected dependencies (createHardwareService), so it runs
// unchanged on a device (service.js, lib/node.js, lib/sysfs.js), in the
// simulator (runtime/phoenix-runtime.js, a simulated device) and in tests.

"use strict";

var drivers = require("./lib/drivers");

var SERVICE = "org.webosphoenix.hardware";
var METHODS = ["list", "refresh", "install", "remove", "getReport", "sendReport", "setPreferences", "scheduled"];
var ACTIVITY = "org.webosphoenix.hardware.check";
var SETTINGS_APP = "org.webosphoenix.settings";
var MAX_PACKAGE = 256 * 1024 * 1024;
// Report only the IDs of the devices on these buses: what a driver binds by.
// Not DMI or the board's own compatible string, which say which machine it is.
var REPORT_BUSES = ["pci", "usb", "sdio", "of", "acpi", "i2c", "spi", "platform", "hid"];

function fail(code, text) {
    return { returnValue: false, errorCode: code, errorText: text };
}
function err(code, text) {
    var e = new Error(text);
    e.code = code;
    return e;
}
function errorReply(e) {
    if (e && typeof e.code === "string" && /^[A-Z_]+$/.test(e.code)) return fail(e.code, e.message);
    return fail("UNKNOWN_ERROR", (e && e.message) || String(e));
}
function hex(bytes) {
    return Array.prototype.map.call(new Uint8Array(bytes), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
}

// deps:
//   system.scan() -> Promise<[{id, bus, name, vendor, category, modaliases,
//                    driver (null: none bound), firmwareMissing, hidden?}]>
//   system.info() -> Promise<{arch, kernel}>
//   system.activate({after, modules, deviceId}) -> Promise: load the new
//                    driver or firmware (reload the modules, rebind the device)
//   opkg.list() -> Promise<[{name, version}]>
//   opkg.install(paths, {downgrade}) / opkg.remove(names) -> Promise<{ok, error}>
//   request({method, url, headers, body}) -> Promise<{status, body}>
//   requestBytes({method, url}) -> Promise<{status, bytes}>
//   crypto: sha256(bytes), sha512(bytes) -> Promise<Uint8Array>
//   files.write(name, bytes) -> path; files.find(name) -> path | null;
//   files.remove(path): the packages it installed, kept to roll back to
//   state.load() / state.save(obj)
//   config() -> {sources: [{id, name, url, key}], reportUrl}
//   luna.call(uri, params) -> Promise<reply>
//   now(), log(msg) (optional)
function createHardwareService(deps) {
    var log = deps.log || function () {};
    var now = deps.now || function () { return new Date(); };
    var watchers = [];
    var busy = null;
    var installing = {};   // driverId -> the progress of its install

    function load() {
        var s = deps.state.load() || {};
        s.catalogs = s.catalogs || {};
        s.installed = s.installed || {};
        s.pendingRestart = s.pendingRestart || [];
        s.report = s.report || { enabled: false, lastSent: null, lastIds: null };
        s.notified = s.notified || [];
        return s;
    }
    function save(s) { deps.state.save(s); }
    function sources() {
        var c = deps.config() || {};
        return (Array.isArray(c.sources) ? c.sources : []).filter(function (x) { return x && x.id && x.url; });
    }

    // ---- The catalog -------------------------------------------------------------------

    function getText(u) {
        return Promise.resolve(deps.request({ method: "GET", url: u, headers: { Accept: "application/json, */*" } })).then(function (res) {
            if (res.status !== 200) throw err("CONNECTION_FAILED", "HTTP " + res.status + " from " + u);
            return res.body;
        }, function (e) {
            throw err("CONNECTION_FAILED", "Could not reach " + u + (e && e.message ? " (" + e.message + ")" : ""));
        });
    }

    function refreshOne(s, src) {
        var base = String(src.url).replace(/\/*$/, "/");
        var prev = s.catalogs[src.id] || {};
        if (!src.key) {
            s.catalogs[src.id] = Object.assign(prev, { error: { errorCode: "UNTRUSTED", errorText: "No key is set for the driver catalog" } });
            return Promise.resolve({ id: src.id, ok: false, errorCode: "UNTRUSTED" });
        }
        return Promise.all([
            Promise.resolve(deps.requestBytes({ method: "GET", url: base + "drivers.json" })),
            getText(base + "drivers.json.sig")
        ]).then(function (r) {
            if (r[0].status !== 200) throw err("CONNECTION_FAILED", "HTTP " + r[0].status + " from " + base + "drivers.json");
            return drivers.verifyIndex(r[0].bytes, r[1], src.key, {
                sha512: deps.crypto.sha512, now: now(), baseUrl: base,
                lastBuild: typeof prev.build === "number" ? prev.build : undefined
            });
        }, function (e) {
            throw e && e.code ? e : err("CONNECTION_FAILED", "Could not reach " + base + ((e && e.message) ? " (" + e.message + ")" : ""));
        }).then(function (idx) {
            s.catalogs[src.id] = { name: idx.name || src.name, build: idx.build, expires: idx.expires, drivers: idx.drivers,
                                   refreshed: now().toISOString(), error: null };
            return { id: src.id, ok: true };
        }, function (e) {
            // Keep the last good catalog; say why this one was not taken.
            var r = errorReply(e);
            s.catalogs[src.id] = Object.assign(prev, { error: { errorCode: r.errorCode, errorText: r.errorText } });
            log("catalog " + src.id + ": " + r.errorText);
            return { id: src.id, ok: false, errorCode: r.errorCode, errorText: r.errorText };
        });
    }

    function refresh() {
        var s = load();
        return sources().reduce(function (chain, src) {
            return chain.then(function (out) { return refreshOne(s, src).then(function (r) { out.push(r); return out; }); });
        }, Promise.resolve([])).then(function (results) {
            save(s);
            changed();
            return { returnValue: true, sources: results };
        });
    }

    // Every driver of every catalog (the first catalog's entry wins an id).
    function allDrivers(s) {
        var seen = {}, out = [];
        sources().forEach(function (src) {
            var c = s.catalogs[src.id];
            (c && c.drivers || []).forEach(function (d) {
                if (seen[d.id]) return;
                seen[d.id] = true;
                out.push(Object.assign({ sourceId: src.id }, d));
            });
        });
        return out;
    }
    function catalogInfo(s) {
        var src = sources()[0];
        var c = src && s.catalogs[src.id];
        if (!src) return { name: null, build: null, refreshed: null, error: { errorCode: "UNTRUSTED", errorText: "No driver catalog is set up" } };
        return { name: (c && c.name) || src.name || null, build: c ? c.build : null, refreshed: c ? c.refreshed : null,
                 error: c ? c.error : null };
    }

    // ---- The devices --------------------------------------------------------------------

    function offerOf(entry, system, s) {
        var pick = drivers.packagesFor(entry, system);
        var pk = pick.packages || entry.packages;
        var inst = s.installed[entry.id];
        return {
            driverId: entry.id, kind: entry.kind, title: entry.title, summary: entry.summary, description: entry.description,
            category: entry.category, optional: entry.optional, after: entry.after, source: entry.source,
            license: { id: entry.license.id, name: entry.license.name, text: entry.license.text, url: entry.license.url, free: entry.license.free },
            size: pk.reduce(function (t, p) { return t + p.size; }, 0),
            installedSize: pk.every(function (p) { return p.installedSize; }) ? pk.reduce(function (t, p) { return t + p.installedSize; }, 0) : null,
            version: pk.map(function (p) { return p.version; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(", "),
            packages: pk.map(function (p) { return p.name; }),
            available: !!pick.packages, reason: pick.reason,
            installed: !!inst, installedVersion: inst ? inst.packages.map(function (p) { return p.version; }).join(", ") : null,
            installing: installing[entry.id] || null
        };
    }

    function statusOf(raw, offers, s) {
        if (offers.some(function (o) { return o.installed && s.pendingRestart.indexOf(o.driverId) >= 0; })) return "restart";
        if ((raw.firmwareMissing || []).length) return "needs-firmware";
        if (!raw.driver) {
            var needed = offers.filter(function (o) { return !o.optional; });
            if (needed.some(function (o) { return o.kind === "firmware"; })) return "needs-firmware";
            // A driver built for another processor or kernel is no driver here.
            return needed.some(function (o) { return o.available; }) ? "needs-driver" : "no-driver";
        }
        return "working";
    }

    function devices() {
        var s = load();
        return Promise.all([deps.system.scan(), deps.system.info()]).then(function (r) {
            var system = r[1], all = allDrivers(s);
            var list = (r[0] || []).map(function (raw) {
                var offers = all.filter(function (e) { return drivers.matches(e, raw); }).map(function (e) { return offerOf(e, system, s); });
                // A device nobody needs to see, unless a catalog entry is for it.
                if (raw.hidden && !offers.length) return null;
                return {
                    id: raw.id, bus: raw.bus, name: raw.name || "Unknown device", vendor: raw.vendor || "", category: raw.category || "other",
                    ids: (raw.modaliases || []).slice(), driver: raw.driver || null, firmwareMissing: (raw.firmwareMissing || []).slice(),
                    status: statusOf(raw, offers, s), offers: offers
                };
            }).filter(Boolean);
            return { system: system, devices: list, state: s };
        });
    }

    // The first look reads the catalog; later ones use what was read.
    function withCatalog() {
        var s = load();
        return sources().some(function (src) { return !s.catalogs[src.id]; }) ? refresh() : Promise.resolve();
    }

    function list() {
        ensureSchedule();
        return withCatalog().then(devices).then(function (r) {
            return {
                returnValue: true, devices: r.devices, catalog: catalogInfo(r.state), system: r.system,
                pendingRestart: r.state.pendingRestart.slice(),
                report: { enabled: !!r.state.report.enabled, lastSent: r.state.report.lastSent || null }
            };
        }, errorReply);
    }

    function changed() {
        if (!watchers.length) return;
        list().then(function (r) { watchers.slice().forEach(function (w) { w(r); }); });
    }

    // ---- Installing -----------------------------------------------------------------------

    function findEntry(s, id) {
        var e = allDrivers(s).filter(function (d) { return d.id === id; })[0];
        if (!e) throw err("NOT_FOUND", "No driver " + id + " in the catalog");
        return e;
    }

    function fileName(p) { return p.name + "_" + p.version + "_" + p.arch + ".ipk"; }

    function download(pkgs, progress) {
        var done = 0, total = pkgs.reduce(function (t, p) { return t + p.size; }, 0) || 1;
        return pkgs.reduce(function (chain, p) {
            return chain.then(function (paths) {
                return Promise.resolve(deps.requestBytes({ method: "GET", url: p.url })).then(function (res) {
                    if (res.status !== 200) throw err("DOWNLOAD_FAILED", "HTTP " + res.status + " from " + p.url);
                    return res.bytes;
                }, function (e) {
                    throw err("DOWNLOAD_FAILED", "Could not download " + p.url + (e && e.message ? " (" + e.message + ")" : ""));
                }).then(function (bytes) {
                    if (bytes.length > MAX_PACKAGE || bytes.length !== p.size)
                        throw err("BAD_DOWNLOAD", p.name + " is not the size the catalog says (" + bytes.length + ", not " + p.size + ")");
                    done += p.size;
                    progress({ state: "checking", progress: Math.round(60 * done / total) });
                    return Promise.resolve(deps.crypto.sha256(bytes)).then(function (h) {
                        if (hex(h) !== p.sha256) throw err("BAD_DOWNLOAD", p.name + " is not the file the catalog signed (SHA-256 differs)");
                        return Promise.resolve(deps.files.write(fileName(p), bytes));
                    }).then(function (path) { paths.push(path); return paths; });
                });
            });
        }, Promise.resolve([]));
    }

    // Puts the packages back as they were: the versions installed before
    // (from the copies kept when Phoenix installed them), or none.
    function rollback(entry, pkgs, before, prevRecord) {
        var restore = [], removeNames = [];
        pkgs.forEach(function (p) {
            var old = before[p.name];
            if (!old) { removeNames.push(p.name); return; }
            if (old === p.version) return;
            var kept = prevRecord && prevRecord.packages.filter(function (q) { return q.name === p.name && q.version === old; })[0];
            var path = kept && deps.files.find(kept.file);
            if (path) restore.push(path);
            else log("rollback: no copy of " + p.name + " " + old + " to put back");
        });
        return Promise.resolve(removeNames.length ? deps.opkg.remove(removeNames) : { ok: true }).then(function (r1) {
            return Promise.resolve(restore.length ? deps.opkg.install(restore, { downgrade: true }) : { ok: true }).then(function (r2) {
                if (!r1.ok || !r2.ok) log("rollback: " + (r1.error || r2.error));
                return deps.system.activate({ after: entry.after, modules: entry.modules, deviceId: null }).then(null, function () {});
            });
        });
    }

    function install(p, push) {
        if (!p || !p.driverId) return Promise.resolve(fail("BAD_PARAMS", "driverId is required"));
        return withCatalog().then(function () { return installNow(p, push || function () {}); });
    }

    function installNow(p, push) {
        if (busy) return Promise.resolve(fail("BUSY", "Another driver is being installed"));
        var s = load(), entry, pkgs, system, before = {}, installedNow = false, rolledBack = false;
        try { entry = findEntry(s, p.driverId); } catch (e) { return Promise.resolve(errorReply(e)); }
        if (!entry.license.free && p.acceptLicense !== entry.license.id)
            return Promise.resolve(fail("LICENSE_REQUIRED", "Accept the licence of " + entry.title + " (" + entry.license.name + ") to install it"));
        busy = entry.id;
        var ongoingId = SERVICE + "/" + entry.id;
        var words = { downloading: "Downloading", checking: "Checking", installing: "Installing", activating: "Starting the driver" };
        var progress = function (st) {
            installing[entry.id] = { state: st.state, progress: st.progress };
            deps.luna.call("luna://org.webosphoenix.ongoing/set", {
                id: ongoingId, appId: SETTINGS_APP, title: entry.title, body: words[st.state] || "", progress: st.progress,
                params: { page: "hardware", driverId: entry.id }
            }).then(null, function () {});
            push(Object.assign({ returnValue: true, driverId: entry.id }, st));
        };
        var prevRecord = s.installed[entry.id] || null;
        return deps.system.info().then(function (info) {
            system = info;
            var pick = drivers.packagesFor(entry, system);
            if (!pick.packages) throw err("UNSUPPORTED", pick.reason);
            pkgs = pick.packages;
            progress({ state: "downloading", progress: 0 });
            return download(pkgs, progress);
        }).then(function (paths) {
            return Promise.resolve(deps.opkg.list()).then(function (have) {
                (have || []).forEach(function (x) { before[x.name] = x.version; });
                progress({ state: "installing", progress: 70 });
                return deps.opkg.install(paths, { downgrade: false });
            }).then(function (r) {
                installedNow = true;
                if (!r.ok) throw err("INSTALL_FAILED", r.error || "opkg could not install it");
                var s2 = load();
                s2.installed[entry.id] = {
                    sourceId: entry.sourceId, title: entry.title, kind: entry.kind, after: entry.after, licenseId: entry.license.id,
                    packages: pkgs.map(function (q, i) { return { name: q.name, version: q.version, file: fileName(q), path: paths[i] }; }),
                    installedAt: now().toISOString(), deviceId: p.deviceId || null
                };
                if (entry.after === "reboot" && s2.pendingRestart.indexOf(entry.id) < 0) s2.pendingRestart.push(entry.id);
                save(s2);
                if (entry.after === "reboot") return "restart";
                progress({ state: "activating", progress: 85 });
                return deps.system.activate({ after: entry.after, modules: entry.modules, deviceId: p.deviceId || null }).then(function () {
                    return verify(entry, p.deviceId);
                }).then(function () { return "installed"; });
            });
        }).then(function (state) {
            // Copies of versions replaced now are no longer needed to roll back to.
            if (prevRecord) prevRecord.packages.forEach(function (q) {
                if (!pkgs.some(function (n) { return fileName(n) === q.file; })) {
                    var path = deps.files.find(q.file);
                    if (path) deps.files.remove(path);
                }
            });
            var done = { returnValue: true, driverId: entry.id, state: state, progress: 100 };
            push(done);
            return done;
        }).then(null, function (e) {
            var r = errorReply(e);
            r.driverId = entry.id;
            r.state = "failed";
            var undo = installedNow ? rollback(entry, pkgs, before, prevRecord).then(function () {
                rolledBack = true;
                var s3 = load();
                if (prevRecord) s3.installed[entry.id] = prevRecord;
                else delete s3.installed[entry.id];
                s3.pendingRestart = s3.pendingRestart.filter(function (id) { return id !== entry.id || !!prevRecord; });
                save(s3);
            }) : Promise.resolve();
            return undo.then(function () {
                // Downloads that are not installed now are not kept.
                (pkgs || []).forEach(function (q) {
                    if (prevRecord && prevRecord.packages.some(function (x) { return x.file === fileName(q); })) return;
                    var path = deps.files.find(fileName(q));
                    if (path) deps.files.remove(path);
                });
                r.rolledBack = rolledBack;
                if (rolledBack) r.errorText += ". Your device was put back as it was.";
                push(r);
                log("install " + entry.id + ": " + r.errorText);
                return r;
            });
        }).then(function (r) {
            deps.luna.call("luna://org.webosphoenix.ongoing/clear", { id: ongoingId }).then(null, function () {});
            delete installing[entry.id];
            busy = null;
            changed();
            return r;
        });
    }

    // After a reload, the device the driver was for has to work.
    function verify(entry, deviceId) {
        if (!deviceId || entry.optional || entry.after === "none") return Promise.resolve();
        return devices().then(function (r) {
            var d = r.devices.filter(function (x) { return x.id === deviceId; })[0];
            if (!d) throw err("VERIFY_FAILED", "The device went away while its driver was installed");
            if (d.status !== "working") {
                throw err("VERIFY_FAILED", d.firmwareMissing.length ? d.name + " still cannot load " + d.firmwareMissing.join(", ")
                                                                   : d.name + " still has no working driver");
            }
        });
    }

    function remove(p) {
        if (!p || !p.driverId) return Promise.resolve(fail("BAD_PARAMS", "driverId is required"));
        if (busy) return Promise.resolve(fail("BUSY", "A driver is being installed"));
        var s = load(), rec = s.installed[p.driverId];
        if (!rec) return Promise.resolve(fail("NOT_INSTALLED", "That driver was not installed here"));
        busy = p.driverId;
        return Promise.resolve(deps.opkg.remove(rec.packages.map(function (q) { return q.name; }))).then(function (r) {
            if (!r.ok) throw err("INSTALL_FAILED", r.error || "opkg could not remove it");
            var s2 = load();
            delete s2.installed[p.driverId];
            var waiting = s2.pendingRestart.indexOf(p.driverId) >= 0;
            s2.pendingRestart = s2.pendingRestart.filter(function (id) { return id !== p.driverId; });
            save(s2);
            rec.packages.forEach(function (q) {
                var path = deps.files.find(q.file);
                if (path) deps.files.remove(path);
            });
            // A driver that needed a restart to start needs one to stop, unless it never started.
            if (rec.after === "reboot") return { returnValue: true, restart: !waiting };
            return deps.system.activate({ after: rec.after, modules: [], deviceId: rec.deviceId }).then(function () {
                return { returnValue: true, restart: false };
            }, function () { return { returnValue: true, restart: false }; });
        }).then(null, errorReply).then(function (r) {
            busy = null;
            changed();
            return r;
        });
    }

    // ---- The hardware report (opt-in) -------------------------------------------------------

    // Only the IDs of the devices nothing drives, for the people who add
    // drivers to know what to work on: no names, serial numbers, addresses,
    // or which machine it is.
    function reportOf(r) {
        var unmatched = r.devices.filter(function (d) {
            return REPORT_BUSES.indexOf(d.bus) >= 0 && (d.status === "no-driver" || ((d.status === "needs-firmware" || d.status === "needs-driver") &&
                   !d.offers.some(function (o) { return o.available; })));
        });
        return {
            format: 1, arch: r.system.arch, kernel: String(r.system.kernel || "").split("-")[0],
            devices: unmatched.map(function (d) {
                return { bus: d.bus, ids: d.ids.filter(function (id) { return id.split(":")[0] === d.bus; }), firmwareMissing: d.firmwareMissing };
            })
        };
    }

    function getReport() {
        return withCatalog().then(devices).then(function (r) { return { returnValue: true, report: reportOf(r) }; }, errorReply);
    }

    function sendReport() {
        var to = (deps.config() || {}).reportUrl;
        if (!to) return Promise.resolve(fail("UNSUPPORTED", "There is nowhere to send reports to"));
        return withCatalog().then(devices).then(function (r) {
            var rep = reportOf(r);
            if (!rep.devices.length) return { returnValue: true, sent: false, report: rep };
            return Promise.resolve(deps.request({ method: "POST", url: to, headers: { "Content-Type": "application/json" }, body: JSON.stringify(rep) }))
                .then(function (res) {
                    if (res.status !== 200 && res.status !== 201 && res.status !== 204) throw err("CONNECTION_FAILED", "HTTP " + res.status + " from " + to);
                    var s = load();
                    s.report.lastSent = now().toISOString();
                    s.report.lastIds = JSON.stringify(rep.devices);
                    save(s);
                    changed();
                    return { returnValue: true, sent: true, report: rep };
                }, function (e) {
                    throw e && e.code ? e : err("CONNECTION_FAILED", "Could not reach " + to);
                });
        }).then(null, errorReply);
    }

    // ---- Start-up and daily ---------------------------------------------------------------

    function scheduled(p) {
        var activityId = p && p.$activity && p.$activity.activityId;
        return refresh().then(devices).then(function (r) {
            var s = load();
            var fresh = r.devices.filter(function (d) {
                return (d.status === "needs-firmware" || d.status === "needs-driver") && d.offers.some(function (o) { return o.available && !o.installed; }) &&
                       s.notified.indexOf(d.id) < 0;
            });
            var tell = fresh.length ? deps.luna.call("luna://com.webos.notification/createToast", {
                message: fresh.length === 1 ? fresh[0].name + " needs " + (fresh[0].status === "needs-firmware" ? "firmware" : "a driver")
                                            : fresh.length + " devices need drivers or firmware",
                onclick: { appId: SETTINGS_APP, params: { page: "hardware" } }
            }) : Promise.resolve();
            s.notified = s.notified.concat(fresh.map(function (d) { return d.id; }));
            save(s);
            var rep = reportOf(r);
            var send = s.report.enabled && rep.devices.length && JSON.stringify(rep.devices) !== s.report.lastIds ? sendReport() : Promise.resolve();
            return Promise.all([Promise.resolve(tell).then(null, function () {}), send]).then(function () {
                return activityId ? deps.luna.call("luna://com.palm.activitymanager/complete", { activityId: activityId, restart: true }) : null;
            }).then(function () { return { returnValue: true, notified: fresh.length }; });
        }, errorReply);
    }

    var scheduledOnce = false;
    function ensureSchedule() {
        if (scheduledOnce) return;
        scheduledOnce = true;
        deps.luna.call("luna://com.palm.activitymanager/create", {
            start: true, replace: true,
            activity: { name: ACTIVITY, description: "Hardware check", type: { background: true, persist: true },
                        schedule: { interval: "24h" },
                        callback: { method: "luna://" + SERVICE + "/scheduled", params: {} } }
        }).then(null, function () {});
    }

    return {
        list: function () { return list(); },
        refresh: function () { return refresh().then(list); },
        install: install,
        remove: remove,
        getReport: getReport,
        sendReport: sendReport,
        setPreferences: function (p) {
            var s = load();
            if (p && typeof p.reportEnabled === "boolean") s.report.enabled = p.reportEnabled;
            save(s);
            changed();
            return Promise.resolve({ returnValue: true, report: { enabled: !!s.report.enabled, lastSent: s.report.lastSent || null } });
        },
        scheduled: scheduled,
        // list {subscribe}: every change after the first reply -> stop()
        watch: function (cb) {
            watchers.push(cb);
            return function () { watchers = watchers.filter(function (w) { return w !== cb; }); };
        }
    };
}

module.exports = { createHardwareService: createHardwareService, SERVICE: SERVICE, METHODS: METHODS };
