// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Two-way sync between a CardDAV / CalDAV account and db8, in the shape of a
// legacy Synergy transport: synced data lives in the capability's db8
// kinds from the account template (dbkinds: com.palm.contact.dav:1,
// com.palm.calendar.dav:1, com.palm.calendarevent.dav:1), each object
// carries accountId (and calendarId for events) so the Contacts and Calendar
// apps and com.palm.service.accounts' deleteAccount find it, and the
// transport's own bookkeeping sits in kinds of its own:
//
//   org.webosphoenix.dav.account:1     server URL, principal, home sets
//   org.webosphoenix.dav.collection:1  one per address book / calendar:
//                                      url, sync-token, ctag, calendarId
//   org.webosphoenix.dav.item:1        one per server resource: href, etag,
//                                      the last server copy (raw), the db8
//                                      object it maps to and that object's
//                                      _rev (and its children's) as last synced
//
// A sync of one collection:
//   1. pull: what changed on the server since the last sync, by RFC 6578
//      sync-collection with the stored sync-token; without it, or when the
//      server rejects the token, by comparing every resource's etag (and
//      nothing at all when the ctag has not moved);
//   2. push: what changed in db8 since the last sync. An object whose _rev
//      differs from the item's localRev was edited on the device; an object
//      of the account without an item is new; an item whose object is gone
//      or _del was deleted. New resources are PUT with If-None-Match: *,
//      changes with If-Match: <etag>, deletions DELETE with If-Match;
//   3. pull again, which stores the new sync-token (or ctag) and picks up
//      anything that changed on the server meanwhile. Our own uploads come
//      back with the etag we already have and are skipped.
//
// Conflicts: THE SERVER WINS. If a resource changed on the server and in db8
// since the last sync, the server's copy replaces the device's (step 1
// runs before step 2, and the local edit is dropped). If an upload is
// refused because the etag no longer matches (HTTP 412: someone changed it
// in between), the server's copy is fetched and replaces the device's
// likewise; a refused DELETE brings the server's copy back. Each such case
// is counted in the result's conflicts and logged. Nothing is merged
// field by field; see docs/SYNERGY.md.
//
// A collection the user may only read (a calendar shared with them
// read-only: its privileges say so, or the server answers a change with
// 403) takes no change from the device: an edit or a deletion made there
// anyway is undone with the server's copy, a new object removed, and each
// is counted in the result's refused and named in its errors.
//
// Uploads that may have reached the server without us hearing back (the
// connection dropped) make no second copy: a new resource's href is kept
// on its object (remoteId) before it is sent, the same href is used to
// send it again, and a server resource found at it is that object's.
//
// db is a promise API over db8 (find(query) -> all results, get(ids),
// put(objects) / merge(objects) -> [{id, rev}], del(ids)); the device
// service backs it with Luna calls, the simulator with its in-page db8,
// the tests with an in-memory one.

"use strict";

var synckit = require("@phoenix/synckit");
var davclient = require("./davclient");

var vcard = synckit.vcard;
var ical = synckit.ical;
var DT = synckit.datetime;
var linker = synckit.linker;

var KINDS = {
    account: "org.webosphoenix.dav.account:1",
    collection: "org.webosphoenix.dav.collection:1",
    item: "org.webosphoenix.dav.item:1",
    contact: "com.palm.contact.dav:1",
    calendar: "com.palm.calendar.dav:1",
    event: "com.palm.calendarevent.dav:1",
    syncState: synckit.syncstate.KIND
};

var CAPABILITY_PROVIDERS = {
    CONTACTS: "com.webosphoenix.dav.contacts",
    CALENDAR: "com.webosphoenix.dav.calendar"
};

var CONTACT_FIELDS = ["name", "nickname", "birthday", "anniversary", "note", "phoneNumbers", "emails", "addresses",
                      "organizations", "urls", "ims", "photos"];
var EVENT_FIELDS = ["subject", "location", "note", "allDay", "tzId", "dtstart", "dtend", "rrule", "exdates", "alarm",
                    "attendees", "transp", "classification", "status", "url", "categories", "sequence", "recurrenceId"];

// Calendar colours the Calendar app knows (CalendarsManager colorList).
var COLORS = ["blue", "green", "yellow", "gray", "orange", "purple", "red", "pink", "teal"];

function pick(o, fields) {
    var out = {};
    fields.forEach(function (f) { out[f] = o[f] === undefined ? null : o[f]; });
    return out;
}

function stripNulls(o) {
    Object.keys(o).forEach(function (k) { if (o[k] === null) delete o[k]; });
    return o;
}

// The same path, whatever the host (and its percent-encoding, a trailing slash).
function samePath(a, b) {
    var norm = function (u) {
        var p = new URL(u).pathname.replace(/\/+$/, "");
        try { return decodeURIComponent(p); } catch (e) { return p; }
    };
    try { return norm(a) === norm(b); } catch (e) { return false; }
}

// An error that ends the sync rather than one upload: the password refused,
// the server asking us to wait, or no answer at all.
function fatal(e) {
    return !!e && (e.status === 401 || e.status === 429 || e.status === 503 || e.errorCode === "503_SERVICE_UNAVAILABLE" ||
                   e.code === "HOST_NOT_ALLOWED" || (!e.status && /^E[A-Z_]+$/.test(e.code || "")));
}

function fileName(href) {
    try { return decodeURIComponent(new URL(href).pathname.split("/").pop()); } catch (e) { return href; }
}

// ---- The engine ---------------------------------------------------------------------

// ctx: { db, request, accountId, username, password, localTz?, log?,
//        services? ({carddav, caldav}: a preset's hosts, lib/presets.js),
//        checkUrl?(url) (a preset's: throws for a host not its own),
//        passwordRefused? (a preset's text for a 401 in a sync),
//        providers? ({CONTACTS, CALENDAR}: a preset's capability provider ids),
//        tempdb? (for com.palm.account.syncstate:1), linkPersons? (default true),
//        savePhoto?(key, dataUrl) -> Promise<localPath> }
function createEngine(ctx) {
    var db = ctx.db;
    var log = ctx.log || function () {};
    var localTz = ctx.localTz || DT.localZone();
    var accountId = ctx.accountId;
    var stats;

    function client(serverUrl) {
        return davclient.createClient({ request: ctx.request, serverUrl: ctx.services ? null : serverUrl,
                                        services: ctx.services, username: ctx.username, password: ctx.password, log: log,
                                        checkUrl: ctx.checkUrl });
    }

    function one(query) { return db.find(query).then(function (r) { return r[0] || null; }); }

    function accountRecord() {
        return one({ from: KINDS.account, where: [{ prop: "accountId", op: "=", val: accountId }] });
    }

    function setSyncState(capability, state, error) {
        return synckit.setSyncState(ctx.tempdb, accountId, (ctx.providers || CAPABILITY_PROVIDERS)[capability], state, error, log);
    }

    // Stores the server, principal and home sets (after checkCredentials /
    // onCreate). Returns the discovery result.
    function setup(serverUrl) {
        return client(serverUrl).discover().then(function (found) {
            return accountRecord().then(function (rec) {
                var o = Object.assign(rec || { _kind: KINDS.account, accountId: accountId }, {
                    serverUrl: found.serverUrl, username: ctx.username, principalUrl: found.principalUrl || "",
                    addressbookHome: found.addressbookHome || "", calendarHome: found.calendarHome || ""
                });
                return db.put([o]).then(function () { return found; });
            });
        });
    }

    // ---- Collections ------------------------------------------------------------

    function reconcileCollections(capability, found) {
        var kind = capability === "CONTACTS" ? "addressbook" : "calendar";
        var remote = (capability === "CONTACTS" ? found.addressbooks : found.calendars).filter(function (c) {
            return kind === "addressbook" || c.components.indexOf("VEVENT") >= 0;
        });
        return db.find({ from: KINDS.collection, where: [{ prop: "accountId", op: "=", val: accountId }] }).then(function (local) {
            local = local.filter(function (c) { return c.capability === capability; });
            var chain = Promise.resolve();
            // A provider's collection at the same path on another host is the
            // same one, moved: iCloud moves an account to another partition
            // (pNN-contacts.icloud.com -> pMM-...), keeping the paths.
            if (ctx.services) {
                local.forEach(function (l) {
                    if (remote.some(function (r) { return davclient.sameUrl(r.url, l.url); })) return;
                    var moved = remote.filter(function (r) {
                        return samePath(r.url, l.url) && !local.some(function (o) { return davclient.sameUrl(r.url, o.url); });
                    })[0];
                    if (moved) chain = chain.then(function () { return moveCollection(l, moved.url); });
                });
            }
            var gone;
            chain = chain.then(function () {
                gone = local.filter(function (l) { return !remote.some(function (r) { return davclient.sameUrl(r.url, l.url); }); });
            });
            chain = chain.then(function () {
                return gone.reduce(function (p, col) {
                    return p.then(function () { return dropCollection(col, "removed on the server"); });
                }, Promise.resolve());
            });
            var result = [];
            remote.forEach(function (r, i) {
                chain = chain.then(function () {
                    var col = local.filter(function (l) { return davclient.sameUrl(r.url, l.url); })[0];
                    col = col || { _kind: KINDS.collection, accountId: accountId, capability: capability, url: r.url };
                    col.displayName = r.displayName;
                    // A server that refused a change (403) is believed over its privileges.
                    col.readOnly = !!r.readOnly || !!col.refusedWrites;
                    col.supportsSync = !!r.supportsSync;
                    col.isDefault = i === 0;
                    var ensureCalendar = capability === "CALENDAR" ? ensureCalendarObject(col, r, i) : Promise.resolve();
                    return ensureCalendar.then(function () {
                        return db.put([col]).then(function (res) {
                            col._id = res[0].id;
                            result.push(col);
                        });
                    });
                });
            });
            return chain.then(function () { return result; });
        });
    }

    function ensureCalendarObject(col, remote, index) {
        var cal = {
            _kind: KINDS.calendar, accountId: accountId, name: remote.displayName || "Calendar",
            isReadOnly: !!col.readOnly, syncSource: "CalDAV", excludeFromAll: false,
            color: COLORS[index % COLORS.length], remoteId: col.url
        };
        if (col.calendarId) {
            return db.get([col.calendarId]).then(function (r) {
                if (r[0]) {
                    // Keep the user's colour and show/hide choices.
                    return db.merge([{ _id: col.calendarId, name: cal.name, isReadOnly: cal.isReadOnly }]);
                }
                return db.put([cal]).then(function (res) { col.calendarId = res[0].id; });
            });
        }
        return db.put([cal]).then(function (res) { col.calendarId = res[0].id; });
    }

    // The collection l, now at url (the same path on another host): its
    // record, its items' hrefs and its objects' remoteIds follow it, so
    // nothing is dropped and fetched again, and nothing changed on the
    // device meanwhile is lost.
    function moveCollection(col, url) {
        var from = new URL(col.url).origin, to = new URL(url).origin;
        log("moved: " + col.url + " -> " + url);
        var re = function (h) { return h && h.indexOf(from) === 0 ? to + h.slice(from.length) : h; };
        return db.find({ from: KINDS.item, where: [{ prop: "collectionId", op: "=", val: col._id }] }).then(function (items) {
            var objs = items.filter(function (it) { return it.localId; }).map(function (it) { return it.localId; });
            return (objs.length ? db.get(objs) : Promise.resolve([])).then(function (found) {
                // A merge changes _rev: an object unchanged since the last sync stays so.
                var unchanged = {};
                items.forEach(function (it) {
                    var o = found.filter(function (f) { return f._id === it.localId; })[0];
                    if (o && o._rev === it.localRev) unchanged[o._id] = true;
                });
                var moves = found.filter(function (o) { return o.remoteId; }).map(function (o) { return { _id: o._id, remoteId: re(o.remoteId) }; });
                return (moves.length ? db.merge(moves) : Promise.resolve([])).then(function (res) {
                    var revs = {};
                    (res || []).forEach(function (r) { revs[r.id] = r.rev; });
                    items.forEach(function (it) {
                        it.href = re(it.href);
                        if (unchanged[it.localId] && revs[it.localId]) it.localRev = revs[it.localId];
                    });
                    return items.length ? db.put(items) : null;
                });
            });
        }).then(function () {
            col.url = url;
            var upd = [{ _id: col._id, url: url }];
            if (col.calendarId) upd.push({ _id: col.calendarId, remoteId: url });
            return db.merge(upd);
        });
    }

    // A collection and everything synced from it: it disappeared from the
    // server, or its capability was turned off, or the account deleted.
    function dropCollection(col, why) {
        log("dropping " + col.url + ": " + why);
        return db.find({ from: KINDS.item, where: [{ prop: "collectionId", op: "=", val: col._id }] }).then(function (items) {
            var ids = [];
            items.forEach(function (it) {
                if (it.localId) ids.push(it.localId);
                ids = ids.concat(Object.keys(it.childRevs || {}));
            });
            var chain = ids.length ? db.del(ids) : Promise.resolve();
            return chain.then(function () {
                if (col.capability === "CONTACTS" && ctx.linkPersons !== false)
                    return linker.updatePersons(db, [], items.map(function (it) { return it.localId; }).filter(Boolean));
            }).then(function () {
                return items.length ? db.del(items.map(function (it) { return it._id; })) : null;
            }).then(function () {
                return col.calendarId ? db.del([col.calendarId]) : null;
            }).then(function () { return db.del([col._id]); });
        });
    }

    // ---- Local objects -----------------------------------------------------------

    // Groups of db8 objects that each map to one server resource:
    // { key (parent id), parent, children: [..] }.
    function localGroups(capability, col, allItems) {
        if (capability === "CONTACTS") {
            return db.find({ from: KINDS.contact, where: [{ prop: "accountId", op: "=", val: accountId }], incDel: true })
                .then(function (objs) {
                    var mine = {};
                    allItems.forEach(function (it) { mine[it.localId] = it.collectionId; });
                    return objs.filter(function (o) {
                        return mine[o._id] ? mine[o._id] === col._id : col.isDefault;
                    }).map(function (o) { return { key: o._id, parent: o, children: [] }; });
                });
        }
        return db.find({ from: KINDS.event, where: [{ prop: "calendarId", op: "=", val: col.calendarId }], incDel: true })
            .then(function (objs) {
                var groups = {};
                objs.forEach(function (o) {
                    if (!o.parentId) groups[o._id] = groups[o._id] || { key: o._id, parent: null, children: [] };
                    if (!o.parentId) groups[o._id].parent = o;
                });
                objs.forEach(function (o) {
                    if (!o.parentId) return;
                    groups[o.parentId] = groups[o.parentId] || { key: o.parentId, parent: null, children: [] };
                    groups[o.parentId].children.push(o);
                });
                return Object.keys(groups).map(function (k) { return groups[k]; });
            });
    }

    function liveChildren(group) { return group.children.filter(function (c) { return !c._del; }); }

    function childRevs(group) {
        var r = {};
        liveChildren(group).forEach(function (c) { r[c._id] = c._rev; });
        return r;
    }

    // "new", "modified", "deleted" or null.
    function localState(group, item) {
        var p = group.parent;
        if (!item) return p && !p._del ? "new" : null;
        if (!p || p._del) return "deleted";
        if (p._rev !== item.localRev) return "modified";
        if (JSON.stringify(sortObj(childRevs(group))) !== JSON.stringify(sortObj(item.childRevs || {}))) return "modified";
        return null;
    }

    function sortObj(o) {
        var out = {};
        Object.keys(o).sort().forEach(function (k) { out[k] = o[k]; });
        return out;
    }

    // ---- Applying server copies ----------------------------------------------------

    // A contact group kept as a vCard of its own (Apple's way: iCloud, and
    // macOS Contacts on any CardDAV server: X-ADDRESSBOOKSERVER-KIND:group with
    // its members as X-ADDRESSBOOKSERVER-MEMBER; vCard 4's KIND:group, RFC 6350
    // 6.1.4). Contacts has no groups, so it is kept as it is on the server and
    // never shown as a person.
    function isGroupCard(data) {
        return /^(?:[A-Za-z0-9-]+\.)?(?:X-ADDRESSBOOKSERVER-KIND|KIND)[;:](?:[^\r\n]*:)?\s*group\s*$/im.test(String(data || ""));
    }

    function applyContact(col, res, item, existing) {
        if (isGroupCard(res.data)) {
            var drop = existing && !existing._del ? db.del([existing._id]) : Promise.resolve();
            return drop.then(function () {
                if (existing && !existing._del) stats.contactsRemoved.push(existing._id);
                return saveItem(col, res, item, "", 0, {}, true);
            });
        }
        var parsed = vcard.toContact(res.data);
        var fields = parsed.contact;
        var photo = fields.photos[0];
        var photoStep = photo && ctx.savePhoto && /^data:/.test(photo.value)
            // Keyed by the contact, or for a new one by the account and the card:
            // two accounts may have the same card (one UID), each with its photo.
            ? ctx.savePhoto(existing ? existing._id : accountId + "-" + (parsed.uid || fileName(res.href)), photo.value)
                .then(function (p) { photo.localPath = p; })
            : Promise.resolve(photo ? (photo.localPath = photo.value) : null);
        return photoStep.then(function () {
            var obj = Object.assign(pick(fields, CONTACT_FIELDS), { accountId: accountId, remoteId: res.href });
            stripNulls(obj);
            var write = existing && !existing._del
                ? db.merge([Object.assign({ _id: existing._id }, obj)])
                : db.put([Object.assign({ _kind: KINDS.contact }, obj)]);
            return write.then(function (r) {
                stats.contactsChanged.push(r[0].id);
                return saveItem(col, res, item, r[0].id, r[0].rev, {});
            });
        });
    }

    function eventObject(col, ev, extra) {
        var o = pick(ev, EVENT_FIELDS);
        stripNulls(o);
        // Clear fields the server copy no longer has.
        ["rrule", "exdates", "alarm", "attendees", "recurrenceId"].forEach(function (f) { if (!(f in o)) o[f] = null; });
        return Object.assign(o, { accountId: accountId, calendarId: col.calendarId }, extra || {});
    }

    function applyEvent(col, res, item, group) {
        var parsed = ical.toEvents(res.data, { localTz: localTz });
        if (!parsed.master) {
            // Only VTODOs (or a lone override): nothing for the Calendar app.
            return saveItem(col, res, item, item ? item.localId : "", item ? item.localRev : 0, item ? item.childRevs : {}, true);
        }
        var parent = group && group.parent && !group.parent._del ? group.parent : null;
        var master = eventObject(col, parsed.master, { remoteId: res.href });
        var write = parent ? db.merge([Object.assign({ _id: parent._id }, master)])
                           : db.put([Object.assign({ _kind: KINDS.event }, master)]);
        return write.then(function (r) {
            var parentId = r[0].id, parentRev = r[0].rev;
            stats.eventsChanged++;
            var existingKids = group ? liveChildren(group) : [];
            var revs = {};
            var chain = Promise.resolve();
            parsed.overrides.forEach(function (ov) {
                chain = chain.then(function () {
                    var kid = existingKids.filter(function (k) { return k.recurrenceId === ov.recurrenceId; })[0];
                    var obj = eventObject(col, ov, { parentId: parentId, parentDtstart: parsed.master.dtstart });
                    var w = kid ? db.merge([Object.assign({ _id: kid._id }, obj)])
                                : db.put([Object.assign({ _kind: KINDS.event }, obj)]);
                    return w.then(function (rr) { revs[rr[0].id] = rr[0].rev; });
                });
            });
            return chain.then(function () {
                var stale = existingKids.filter(function (k) { return !revs[k._id]; }).map(function (k) { return k._id; });
                return stale.length ? db.del(stale) : null;
            }).then(function () {
                return saveItem(col, res, item, parentId, parentRev, revs);
            });
        });
    }

    function saveItem(col, res, item, localId, localRev, kidRevs, ignored) {
        var o = Object.assign(item || { _kind: KINDS.item, accountId: accountId }, {
            collectionId: col._id, href: res.href, etag: res.etag, raw: res.data,
            localId: localId, localRev: localRev, childRevs: kidRevs || {}, ignored: !!ignored
        });
        return db.put([o]).then(function (r) { o._id = r[0].id; return o; });
    }

    function removeLocal(col, item, group) {
        var ids = [];
        if (group) {
            if (group.parent && !group.parent._del) ids.push(group.parent._id);
            liveChildren(group).forEach(function (c) { ids.push(c._id); });
        } else if (item.localId) {
            ids.push(item.localId);
        }
        return (ids.length ? db.del(ids) : Promise.resolve()).then(function () {
            if (col.capability === "CONTACTS" && item.localId) stats.contactsRemoved.push(item.localId);
            if (col.capability === "CALENDAR" && ids.length) stats.eventsRemoved++;
            return item._id ? db.del([item._id]) : null;
        });
    }

    // ---- Pull --------------------------------------------------------------------

    // -> { changed: [{href, etag}], removed: [href], state: {syncToken?, ctag?} }
    function remoteChanges(c, col, items) {
        function full() {
            if (col.supportsSync) {
                return collectAll(c, col.url, "").then(function (r) {
                    var present = {};
                    r.changed.forEach(function (ch) { present[ch.href] = true; });
                    // Only a whole listing says what is gone.
                    var removed = r.truncated ? [] : items.filter(function (it) { return !present[it.href]; }).map(function (it) { return it.href; });
                    return { changed: r.changed, removed: removed, state: { syncToken: r.syncToken } };
                });
            }
            return c.collectionState(col.url).then(function (st) {
                if (st.ctag && col.ctag && st.ctag === col.ctag && items.length) {
                    return { changed: [], removed: [], state: { ctag: st.ctag } };
                }
                return c.listEtags(col.url).then(function (list) {
                    var present = {};
                    list.forEach(function (x) { present[x.href] = true; });
                    return { changed: list, removed: items.filter(function (it) { return !present[it.href]; }).map(function (it) { return it.href; }),
                             state: { ctag: st.ctag } };
                });
            });
        }
        if (col.supportsSync && col.syncToken) {
            return collectAll(c, col.url, col.syncToken).then(function (r) {
                return { changed: r.changed, removed: r.removed, state: { syncToken: r.syncToken } };
            }, function (e) {
                if (!e.invalidSyncToken) throw e;
                log("sync-token no longer valid for " + col.url + ": full sync");
                return full();
            });
        }
        return full();
    }

    // sync-collection, repeated while the server truncates (507, RFC 6578
    // 3.6: the rest comes with the token it gave): a page at a time, as
    // many as it takes, while the token moves on. acc.truncated: the
    // server stopped giving the rest (the next sync goes on from there).
    var MAX_PAGES = 10000;
    function collectAll(c, url, token) {
        var acc = { changed: [], removed: [], truncated: false };
        function step(t, rounds) {
            return c.syncCollection(url, t).then(function (r) {
                acc.changed = acc.changed.concat(r.changed);
                acc.removed = acc.removed.concat(r.removed);
                acc.syncToken = r.syncToken;
                if (!r.truncated) return acc;
                if (r.syncToken && r.syncToken !== t && rounds < MAX_PAGES) return step(r.syncToken, rounds + 1);
                log("sync-collection of " + url + " stopped after " + (rounds + 1) + " pages");
                acc.truncated = true;
                return acc;
            });
        }
        return step(token, 0);
    }

    function pull(c, col, capability, ctxState) {
        return itemsOf(col).then(function (items) {
            return remoteChanges(c, col, items).then(function (changes) {
                var byHref = {};
                items.forEach(function (it) { byHref[it.href] = it; });
                // Resources whose etag we already have (including our own uploads).
                var wanted = changes.changed.filter(function (ch) {
                    var it = byHref[ch.href];
                    return !(it && ch.etag && it.etag === ch.etag);
                });
                var hrefs = wanted.map(function (w) { return w.href; });
                var fetch = hrefs.length ? c.multiget(col.url, capability === "CONTACTS" ? "addressbook" : "calendar", hrefs)
                                         : Promise.resolve([]);
                return fetch.then(function (resources) {
                    return applyRemote(col, capability, items, resources, changes.removed, ctxState);
                }).then(function () {
                    var upd = { _id: col._id };
                    if (changes.state.syncToken !== undefined) upd.syncToken = changes.state.syncToken;
                    if (changes.state.ctag !== undefined) upd.ctag = changes.state.ctag;
                    Object.assign(col, upd);
                    return db.merge([upd]);
                });
            });
        });
    }

    function itemsOf(col) {
        return db.find({ from: KINDS.item, where: [{ prop: "collectionId", op: "=", val: col._id }] });
    }

    function groupsByKey(groups) {
        var m = {};
        groups.forEach(function (g) { m[g.key] = g; });
        return m;
    }

    function applyRemote(col, capability, items, resources, removed, ctxState) {
        var byHref = {};
        items.forEach(function (it) { byHref[it.href] = it; });
        return localGroups(capability, col, ctxState.allItems).then(function (groups) {
            var byKey = groupsByKey(groups);
            // Objects sent up whose answer never came: no item yet, their href kept.
            var linked = {};
            ctxState.allItems.forEach(function (it) { if (it.localId) linked[it.localId] = true; });
            var unlinked = {};
            groups.forEach(function (g) {
                if (g.parent && !g.parent._del && g.parent.remoteId && !linked[g.key]) unlinked[g.parent.remoteId] = g;
            });
            var chain = Promise.resolve();
            resources.forEach(function (res) {
                chain = chain.then(function () {
                    var item = byHref[res.href];
                    var mine = !item && (unlinked[res.href] || Object.keys(unlinked).filter(function (h) {
                        return davclient.sameUrl(h, res.href);
                    }).map(function (h) { return unlinked[h]; })[0]);
                    if (mine) {
                        // Ours: linked to its object, which is then sent again
                        // over it (If-Match), as it may have changed since.
                        log(res.href + " is " + mine.key + ", sent up before without an answer");
                        return saveItem(col, res, null, mine.key, -1, {});
                    }
                    var group = item ? byKey[item.localId] : null;
                    if (item && group && localState(group, item) === "modified") {
                        stats.conflicts++;
                        log("conflict on " + res.href + ": changed on the server and the device; the server wins");
                    }
                    ctxState.touched[res.href] = true;
                    var p = capability === "CONTACTS"
                        ? applyContact(col, res, item, group ? group.parent : null)
                        : applyEvent(col, res, item, group);
                    return p.catch(function (e) {
                        stats.errors.push(res.href + ": " + e.message);
                        log("could not read " + res.href + ": " + e.message);
                    });
                });
            });
            removed.forEach(function (href) {
                chain = chain.then(function () {
                    var item = byHref[href];
                    if (!item) return null;
                    ctxState.touched[href] = true;
                    var group = byKey[item.localId];
                    if (group && localState(group, item) === "modified") {
                        stats.conflicts++;
                        log("conflict on " + href + ": deleted on the server, changed on the device; the server wins");
                    }
                    return removeLocal(col, item, group);
                });
            });
            return chain;
        });
    }

    // ---- Push --------------------------------------------------------------------

    function push(c, col, capability, ctxState) {
        return itemsOf(col).then(function (items) {
            var byLocal = {};
            items.forEach(function (it) { byLocal[it.localId] = it; });
            return localGroups(capability, col, ctxState.allItems).then(function (groups) {
                var chain = Promise.resolve();
                var seen = {};
                groups.forEach(function (g) {
                    var item = byLocal[g.key];
                    seen[g.key] = true;
                    var state = localState(g, item);
                    if (!state || (item && ctxState.touched[item.href]) || (item && item.ignored)) return;
                    chain = chain.then(function () {
                        if (col.readOnly) return refuse(c, col, capability, g, item, state);
                        return pushGroup(c, col, capability, g, item, state).catch(function (e) {
                            if (e.readOnly) return markReadOnly(col).then(function () { return refuse(c, col, capability, g, item, state); });
                            if (fatal(e)) throw e;
                            stats.errors.push(g.key + ": " + e.message);
                            log("upload of " + g.key + " failed: " + e.message);
                        });
                    });
                });
                // Items whose object no longer exists at all (purged).
                items.forEach(function (it) {
                    if (seen[it.localId] || it.ignored || ctxState.touched[it.href]) return;
                    var g = { key: it.localId, parent: null, children: [] };
                    chain = chain.then(function () {
                        if (col.readOnly) return refuse(c, col, capability, g, it, "deleted");
                        return pushGroup(c, col, capability, g, it, "deleted").catch(function (e) {
                            if (e.readOnly) return markReadOnly(col).then(function () { return refuse(c, col, capability, g, it, "deleted"); });
                            if (fatal(e)) throw e;
                            stats.errors.push(it.href + ": " + e.message);
                        });
                    });
                });
                return chain;
            });
        });
    }

    // A change the collection does not take (read-only): undone, and said.
    function refuse(c, col, capability, group, item, state) {
        stats.refused++;
        var what = capability === "CONTACTS" ? "contact" : "event";
        var name = (group.parent && (group.parent.subject || (group.parent.name && [group.parent.name.givenName, group.parent.name.familyName]
            .filter(Boolean).join(" ")))) || group.key;
        var msg = (col.displayName || col.url) + " is read-only (shared with you, or not yours to change): the " +
            (state === "new" ? "new " + what + " \u201c" + name + "\u201d was removed" :
             state === "deleted" ? "deleted " + what + " was brought back" : "change to \u201c" + name + "\u201d was undone") +
            ", as it was not saved there.";
        stats.errors.push(msg);
        log(msg);
        if (state === "new") return removeLocal(col, { localId: "" }, group);
        return restoreFromServer(c, col, capability, item, group);
    }

    // The server refused a change (403): the collection is read-only to us,
    // whatever its privileges said; kept so (refusedWrites) on later syncs.
    function markReadOnly(col) {
        if (col.readOnly) return Promise.resolve();
        col.readOnly = true;
        col.refusedWrites = true;
        var upd = [{ _id: col._id, readOnly: true, refusedWrites: true }];
        if (col.calendarId) upd.push({ _id: col.calendarId, isReadOnly: true });
        return db.merge(upd);
    }

    function serialize(capability, group, item) {
        if (capability === "CONTACTS") return vcard.fromContact(group.parent, item ? item.raw : null, { uid: group.uid });
        return ical.fromEvents(group.parent, liveChildren(group), item ? item.raw : null, { localTz: localTz, uid: group.uid });
    }

    function pushGroup(c, col, capability, group, item, state) {
        var ext = capability === "CONTACTS" ? ".vcf" : ".ics";
        var ctype = capability === "CONTACTS" ? "text/vcard" : "text/calendar";
        if (state === "deleted") {
            return c.del(item.href, item.etag).then(function () {
                stats.uploaded.deleted++;
                if (capability === "CONTACTS") stats.contactsRemoved.push(item.localId);
                var kids = Object.keys(item.childRevs || {});
                return (kids.length ? db.del(kids) : Promise.resolve()).then(function () { return db.del([item._id]); });
            }, function (e) {
                if (!e.conflict) throw e;
                stats.conflicts++;
                log("conflict on " + item.href + ": deleted on the device, changed on the server; the server wins");
                return restoreFromServer(c, col, capability, item, null);
            });
        }
        if (state === "new") {
            // Sent before without an answer: the same href (and UID) again.
            var dir = col.url.replace(/\/?$/, "/");
            var kept = group.parent.remoteId;
            var again = kept && kept.indexOf(dir) === 0 && /^[^/]+$/.test(kept.slice(dir.length)) ? kept : null;
            group.uid = again ? decodeURIComponent(kept.slice(dir.length)).replace(/\.(vcf|ics)$/i, "") : vcard.newUid();
            var href = again || new URL(encodeURIComponent(group.uid) + ext, dir).href;
            var data = serialize(capability, group, null);
            // The href first, then the upload: if its answer is lost, the next
            // sync knows the server's resource for this object's.
            return db.merge([{ _id: group.parent._id, remoteId: href }]).then(function (m) {
                var rev = m[0].rev;
                return c.put(href, data, ctype, { create: true }).catch(function (e) {
                    // Already there: ours, sent before (or by a retry) and its answer lost.
                    if (!e.conflict) throw e;
                    log(href + " is already on the server: sent before; sending it again over it");
                    return c.get(href).then(function (res) {
                        if (!res) throw e;
                        return c.put(href, data, ctype, { etag: res.etag });
                    });
                }).then(function (r) {
                    stats.uploaded.created++;
                    if (capability === "CONTACTS") stats.contactsChanged.push(group.parent._id);
                    var o = { _kind: KINDS.item, accountId: accountId, collectionId: col._id, href: href, etag: r.etag,
                              raw: data, localId: group.parent._id, localRev: rev, childRevs: childRevs(group) };
                    return db.put([o]);
                });
            });
        }
        var body = serialize(capability, group, item);
        return c.put(item.href, body, ctype, { etag: item.etag }).then(function (r) {
            stats.uploaded.modified++;
            return db.put([Object.assign(item, { etag: r.etag, raw: body, localRev: group.parent._rev, childRevs: childRevs(group) })]);
        }, function (e) {
            if (!e.conflict) throw e;
            stats.conflicts++;
            log("conflict on " + item.href + ": changed on the server since the last sync; the server wins");
            return restoreFromServer(c, col, capability, item, group);
        });
    }

    // Server wins: replace (or bring back) the device's copy with the server's.
    function restoreFromServer(c, col, capability, item, group) {
        return c.get(item.href).then(function (res) {
            if (!res) return removeLocal(col, item, group);
            if (capability === "CONTACTS") return applyContact(col, res, item, group ? group.parent : null);
            return applyEvent(col, res, item, group);
        });
    }

    // ---- Account sync -----------------------------------------------------------------

    function syncCollection(c, col, capability, ctxState) {
        return pull(c, col, capability, ctxState)
            .then(function () { return refreshAllItems(ctxState); })
            .then(function () { return push(c, col, capability, ctxState); })
            .then(function () { return refreshAllItems(ctxState); })
            .then(function () { ctxState.touched = {}; return pull(c, col, capability, ctxState); });
    }

    function refreshAllItems(ctxState) {
        return db.find({ from: KINDS.item, where: [{ prop: "accountId", op: "=", val: accountId }] }).then(function (all) {
            ctxState.allItems = all;
        });
    }

    // options.capabilities: which to sync (default both).
    function sync(options) {
        options = options || {};
        var capabilities = options.capabilities || ["CONTACTS", "CALENDAR"];
        stats = { contactsChanged: [], contactsRemoved: [], eventsChanged: 0, eventsRemoved: 0, conflicts: 0, refused: 0,
                  uploaded: { created: 0, modified: 0, deleted: 0 }, errors: [], collections: 0 };
        var started = Date.now();
        return accountRecord().then(function (rec) {
            if (!rec) throw davclient.DavError("The account has not been set up (no server address)", 0, "NOT_SET_UP");
            var c = client(rec.serverUrl);
            return Promise.all(capabilities.map(function (cap) { return setSyncState(cap, "INCREMENTAL_SYNC"); }))
                .then(function () { return c.discover(); })
                .then(function (found) {
                    var chain = Promise.resolve();
                    capabilities.forEach(function (cap) {
                        chain = chain.then(function () {
                            return reconcileCollections(cap, found).then(function (cols) {
                                var ctxState = { allItems: [], touched: {} };
                                var inner = refreshAllItems(ctxState);
                                cols.forEach(function (col) {
                                    inner = inner.then(function () { stats.collections++; return syncCollection(c, col, cap, ctxState); });
                                });
                                return inner;
                            });
                        });
                    });
                    return chain;
                })
                .then(function () {
                    if (ctx.linkPersons === false) return null;
                    var removed = stats.contactsRemoved;
                    var changed = stats.contactsChanged.filter(function (id, i, a) { return a.indexOf(id) === i && removed.indexOf(id) < 0; });
                    return linker.updatePersons(db, changed, removed);
                })
                .then(function () {
                    return db.merge([{ _id: rec._id, lastSync: Date.now() }]);
                })
                .then(function () {
                    return Promise.all(capabilities.map(function (cap) { return setSyncState(cap, "IDLE"); }));
                })
                .then(function () {
                    stats.ms = Date.now() - started;
                    log("sync of " + accountId + " done: " + JSON.stringify(summary(stats)));
                    return summary(stats);
                }, function (e) {
                    // The provider's own words for a password it no longer takes (an app-specific one revoked).
                    if (e && e.status === 401 && ctx.passwordRefused) e.message = ctx.passwordRefused;
                    return Promise.all(capabilities.map(function (cap) { return setSyncState(cap, "ERROR", e); }))
                        .then(function () { throw e; });
                });
        });
    }

    function summary(s) {
        return { collections: s.collections, contactsChanged: s.contactsChanged.length, contactsRemoved: s.contactsRemoved.length,
                 eventsChanged: s.eventsChanged, eventsRemoved: s.eventsRemoved, uploaded: s.uploaded,
                 conflicts: s.conflicts, refused: s.refused, errors: s.errors, ms: s.ms };
    }

    // The account's data for one capability (capability turned off,
    // account deleted), or all of it.
    function removeData(capability) {
        var caps = capability ? [capability] : ["CONTACTS", "CALENDAR"];
        return db.find({ from: KINDS.collection, where: [{ prop: "accountId", op: "=", val: accountId }] }).then(function (cols) {
            var chain = Promise.resolve();
            cols.filter(function (c) { return caps.indexOf(c.capability) >= 0; }).forEach(function (col) {
                chain = chain.then(function () { return dropCollection(col, capability ? capability + " turned off" : "account deleted"); });
            });
            return chain;
        }).then(function () {
            // Anything left without an item (created on the device, never uploaded).
            var kinds = [];
            if (caps.indexOf("CONTACTS") >= 0) kinds.push(KINDS.contact);
            if (caps.indexOf("CALENDAR") >= 0) kinds.push(KINDS.event, KINDS.calendar);
            var chain = Promise.resolve();
            kinds.forEach(function (k) {
                chain = chain.then(function () {
                    return db.find({ from: k, where: [{ prop: "accountId", op: "=", val: accountId }] }).then(function (objs) {
                        var ids = objs.map(function (o) { return o._id; });
                        if (!ids.length) return null;
                        return db.del(ids).then(function () {
                            if (k === KINDS.contact && ctx.linkPersons !== false) return linker.updatePersons(db, [], ids);
                        });
                    });
                });
            });
            return chain;
        }).then(function () {
            if (capability) return null;
            return accountRecord().then(function (rec) { return rec ? db.del([rec._id]) : null; });
        });
    }

    return { setup: setup, sync: sync, removeData: removeData, accountRecord: accountRecord };
}

module.exports = { createEngine: createEngine, KINDS: KINDS, CAPABILITY_PROVIDERS: CAPABILITY_PROVIDERS };
