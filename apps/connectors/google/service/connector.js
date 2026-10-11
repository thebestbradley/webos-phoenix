// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Google account (template com.webosphoenix.google;
// docs/SYNERGY-CONNECTORS.md 1, SYNERGY-MODERN.md 1.2), on the connector
// kit: Google Calendar, Contacts (the People API) and Tasks with one
// sign-in on Google's own page in the system's sign-in sheet (OAuth with
// PKCE, a desktop client; lib/google.js). Google Drive is the drives'
// package; Gmail is a mail account (IMAP with an app password, or later
// OAuth: SYNERGY-MODERN.md 1.2 on Gmail's restricted scope).
//
// Phoenix's Google Cloud project's client id and its non-secret secret are
// the image's setting /etc/palm/google/clients.json ({"google": {"clientId":
// "...", "clientSecret": "..."}}; docs/DEVELOPER-APPS.md); without them the
// account type says "not available in this build". Tokens stay in the
// OAuth service's key store.
//
//   CONTACTS  two-way: My Contacts (com.palm.contact.google:1), linked to
//             the people you have
//   CALENDAR  two-way: each calendar in the calendar list
//             (com.palm.calendar.google:1) and its events
//             (com.palm.calendarevent.google:1); after the first listing only
//             what changed (each calendar's sync token); a Google Meet's
//             address is the event's url and its note's first line
//   TASKS     two-way: Google Tasks' lists and tasks (com.palm.tasklist.google:1,
//             com.palm.task.google:1)

"use strict";

var kit = require("@phoenix/connector-kit");
var GG = require("./lib/google");

var SERVICE = "org.webosphoenix.service.google";
var TEMPLATE = "com.webosphoenix.google";
var CLIENTS = "google/clients.json";
var K = {
    contact: "com.palm.contact.google:1",
    calendar: "com.palm.calendar.google:1",
    event: "com.palm.calendarevent.google:1",
    list: "com.palm.tasklist.google:1",
    task: "com.palm.task.google:1",
    item: "org.webosphoenix.google.item:1"
};
var P = { contacts: TEMPLATE + ".contacts", calendar: TEMPLATE + ".calendar", tasks: TEMPLATE + ".tasks" };
var CONTACT_FIELDS = ["name", "nickname", "birthday", "note", "emails", "phoneNumbers", "addresses", "organizations", "urls", "ims"];
var EVENT_FIELDS = ["calendarId", "subject", "location", "note", "allDay", "tzId", "dtstart", "dtend", "rrule", "exdates", "alarm", "attendees",
                    "transp", "classification", "url", "joinUrl"];
var TASK_FIELDS = ["summary", "notes", "due", "allDay", "completed", "completedTime", "priority", "listId"];

function fail(message, errorCode) { var e = new Error(message); e.errorCode = errorCode; return e; }
function localTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; } }
function clientOf(ctx) { return kit.registeredClient(ctx, CLIENTS, "google", GG.OAUTH); }

function session(ctx) {
    var key = (ctx.credentials && ctx.credentials.oauthKey) || (ctx.config && ctx.config.oauthKey);
    return clientOf(ctx).then(function (c) {
        if (!c) throw fail(kit.notAvailable("Google").message, "NOT_AVAILABLE");
        return GG.apis(ctx, function () { return ctx.oauth.token(key); }, c);
    });
}

function result(me, keyId) {
    return { username: me.username, credentials: { common: { oauthKey: keyId } }, config: { userId: me.id, name: me.name, oauthKey: keyId } };
}

function gone(e) { if (e.status === 404 || e.status === 410) return null; throw e; }

// The id of a remote object that lives in a calendar or list: "<container>/<id>".
function joinId(container, id) { return container + "/" + id; }
function splitId(remoteId) {
    var i = String(remoteId).lastIndexOf("/");
    return { container: remoteId.slice(0, i), id: remoteId.slice(i + 1) };
}
function enc(s) { return encodeURIComponent(s); }

// ---- Contacts ---------------------------------------------------------------------------------

function pullContacts(ctx) {
    return session(ctx).then(function (g) {
        return GG.pages(g.people, "/people/me/connections", { personFields: GG.PERSON_FIELDS, pageSize: 1000 }, "connections");
    }).then(function (r) {
        return { full: true, nextToken: null, changes: r.items.filter(function (p) { return !(p.metadata && p.metadata.deleted); }).map(function (p) {
            return { remoteId: p.resourceName, etag: p.etag, fields: GG.contactFields(p) };
        }) };
    });
}

function pushContact(ctx, ch) {
    return session(ctx).then(function (g) {
        if (ch.op === "delete") return g.people.del("/" + ch.remoteId + ":deleteContact").catch(gone).then(function () { return { remoteId: ch.remoteId }; });
        var body = GG.person(ch.fields || {});
        if (ch.op === "create") {
            return g.people.send("POST", "/people:createContact", { body: body, query: { personFields: "names,metadata" } })
                .then(function (p) { return { remoteId: p.resourceName, etag: p.etag }; });
        }
        // updateContact wants the person's current etag.
        return g.people.get("/" + ch.remoteId, { personFields: "metadata" }).then(function (cur) {
            body.etag = cur.etag;
            return g.people.send("PATCH", "/" + ch.remoteId + ":updateContact", {
                body: body, query: { updatePersonFields: "names,nicknames,biographies,emailAddresses,phoneNumbers,addresses,organizations,urls,birthdays",
                                     personFields: "metadata" } });
        }).then(function (p) { return { remoteId: ch.remoteId, etag: p.etag }; });
    });
}

// ---- Calendar --------------------------------------------------------------------------------------

function pullEvents(ctx, token) {
    var tz = localTz();
    return session(ctx).then(function (g) {
        return GG.pages(g.calendar, "/users/me/calendarList", { maxResults: 250 }).then(function (list) {
            var cals = list.items.filter(function (c) { return !c.deleted && !c.hidden; });
            return kit.syncContainers(ctx, K.calendar, cals.map(function (c, i) { return { remoteId: c.id, fields: GG.calendarFields(c, i) }; }),
                                      { createOnly: ["color"] }).then(function (ids) {
                var tokens = ctx.state.calendarTokens || {};
                var full = !token || cals.some(function (c) { return !tokens[c.id]; }) || Object.keys(tokens).some(function (k) { return !ids[k]; });
                var next = {}, changes = [], deleted = [];
                function listCalendar(c, incremental) {
                    var q = incremental ? { syncToken: tokens[c.id], maxResults: 250 } : { maxResults: 250, singleEvents: false };
                    return GG.pages(g.calendar, "/calendars/" + enc(c.id) + "/events", q, "items", 40).then(function (r) {
                        next[c.id] = r.syncToken || "";
                        r.items.forEach(function (e) {
                            // An edited or cancelled occurrence of a repeat: its series is what the device keeps.
                            if (e.recurringEventId) return;
                            if (e.status === "cancelled") { if (incremental) deleted.push(joinId(c.id, e.id)); return; }
                            changes.push({ remoteId: joinId(c.id, e.id), etag: e.etag, fields: GG.eventFields(e, ids[c.id], tz) });
                        });
                    });
                }
                function all(incremental) {
                    var chain = Promise.resolve();
                    cals.forEach(function (c) { chain = chain.then(function () { return listCalendar(c, incremental); }); });
                    return chain;
                }
                return (full ? all(false) : all(true).catch(function (e) {
                    // The sync token expired (410 Gone): list everything again.
                    if (e.status !== 410) throw e;
                    full = true; changes = []; deleted = []; next = {};
                    return all(false);
                })).then(function () {
                    ctx.state.calendarTokens = next;
                    return { full: full, changes: changes, deleted: deleted, nextToken: "calendar-tokens" };
                });
            });
        });
    });
}

// The user's answer to an invitation (their attendee entry, as Calendar or
// the Assistant sets it): their responseStatus on the event's attendees,
// with sendUpdates=all so the organizer is told
// (https://developers.google.com/calendar/api/guides/manage-attendees);
// a guest changes nothing else on the organizer's event.
var RESPONSE = { ACCEPTED: "accepted", DECLINED: "declined", TENTATIVE: "tentative", "NEEDS-ACTION": "needsAction" };
function answeredGuests(f) {
    return (f.attendees || []).filter(function (a) { return a && a.email; }).map(function (a) {
        var out = { email: a.email, responseStatus: RESPONSE[a.participationStatus || "NEEDS-ACTION"] || "needsAction" };
        if (a.commonName) out.displayName = a.commonName;
        if (a.organizer) out.organizer = true;
        if (a.role === "OPT-PARTICIPANT") out.optional = true;
        return out;
    });
}

function pushEvent(ctx, ch) {
    var tz = localTz();
    return session(ctx).then(function (g) {
        if (ch.op === "delete") {
            var d = splitId(ch.remoteId);
            return g.calendar.del("/calendars/" + enc(d.container) + "/events/" + enc(d.id)).catch(gone).then(function () { return { remoteId: ch.remoteId }; });
        }
        var f = ch.fields || {};
        var body = GG.googleEvent(f, tz);
        if (kit.answerChanged(ch, ctx.account && ctx.account.username)) {
            var y = splitId(ch.remoteId);
            return g.calendar.patch("/calendars/" + enc(y.container) + "/events/" + enc(y.id) + "?sendUpdates=all", { attendees: answeredGuests(f) })
                .then(function (e) { return { remoteId: ch.remoteId, etag: e.etag }; });
        }
        return kit.containerRemoteIds(ctx, K.calendar).then(function (cals) {
            if (ch.op === "create") {
                var cal = cals[f.calendarId] || "primary";
                return g.calendar.post("/calendars/" + enc(cal) + "/events", body).then(function (e) { return { remoteId: joinId(cal, e.id), etag: e.etag }; });
            }
            var x = splitId(ch.remoteId);
            return g.calendar.patch("/calendars/" + enc(x.container) + "/events/" + enc(x.id), body).then(function (e) { return { remoteId: ch.remoteId, etag: e.etag }; });
        });
    });
}

function removeAll(ctx, kinds) {
    var chain = Promise.resolve();
    kinds.forEach(function (kind) {
        chain = chain.then(function () {
            return ctx.db.find({ from: kind, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] }).then(function (objs) {
                return objs.length ? ctx.db.del(objs.map(function (o) { return o._id; })) : null;
            });
        });
    });
    return chain;
}

// ---- Tasks ---------------------------------------------------------------------------------------------

function pullTasks(ctx) {
    return session(ctx).then(function (g) {
        return GG.pages(g.tasks, "/users/@me/lists", { maxResults: 100 }).then(function (r) {
            var lists = r.items;
            return kit.syncContainers(ctx, K.list, lists.map(function (l, i) {
                return { remoteId: l.id, fields: { name: l.title || "Tasks", sortOrder: 300 + i, taskKind: K.task } };
            }), { createOnly: ["sortOrder"] }).then(function (ids) {
                var changes = [], chain = Promise.resolve();
                lists.forEach(function (l) {
                    chain = chain.then(function () {
                        return GG.pages(g.tasks, "/lists/" + enc(l.id) + "/tasks", { maxResults: 100, showCompleted: true, showHidden: true }, "items", 20).then(function (t) {
                            t.items.filter(function (x) { return !x.deleted; }).forEach(function (x) {
                                changes.push({ remoteId: x.id, etag: x.etag, fields: GG.taskFields(x, ids[l.id]) });
                            });
                        });
                    });
                });
                return chain.then(function () { return { full: true, nextToken: null, changes: changes }; });
            });
        });
    });
}

// A task's remote id is its own (Google's task ids are the user's, not the
// list's), so a task moved to another list stays the same task on the
// device; the list it is in on the server is the one both sides last
// agreed on (the change's base).
function pushTask(ctx, ch) {
    return session(ctx).then(function (g) {
        return kit.containerRemoteIds(ctx, K.list).then(function (lists) {
            var f = ch.fields || {}, base = ch.base || {};
            var from = lists[base.listId];
            if (ch.op === "delete") {
                if (!from) return { remoteId: ch.remoteId };
                return g.tasks.del("/lists/" + enc(from) + "/tasks/" + enc(ch.remoteId)).catch(gone).then(function () { return { remoteId: ch.remoteId }; });
            }
            var list = lists[f.listId];
            var body = GG.googleTask(f);
            if (!list) throw fail("The task's list is not one of the account's", "400_BAD_REQUEST");
            if (ch.op === "create") {
                return g.tasks.post("/lists/" + enc(list) + "/tasks", body).then(function (t) { return { remoteId: t.id, etag: t.etag }; });
            }
            var moved = from && from !== list
                // To another list: Google Tasks moves it (destinationTasklist); its id stays.
                ? g.tasks.send("POST", "/lists/" + enc(from) + "/tasks/" + enc(ch.remoteId) + "/move", { query: { destinationTasklist: list } })
                : Promise.resolve();
            return moved.then(function () {
                return g.tasks.patch("/lists/" + enc(list) + "/tasks/" + enc(ch.remoteId), body);
            }).then(function (t) { return { remoteId: ch.remoteId, etag: t.etag }; });
        });
    });
}

// ---- Sign-in ---------------------------------------------------------------------------------------------

function signIn(ctx, p) {
    var client;
    return clientOf(ctx).then(function (c) {
        if (!c) throw kit.notAvailable("Google");
        client = c;
        return kit.oauthSignIn(ctx, client, { accountId: p.accountId });
    }).then(function (keyId) {
        return GG.whoAmI(GG.apis(ctx, function () { return ctx.oauth.token(keyId); }, client)).then(function (me) {
            return kit.forgetOldKey(ctx, p.accountId, keyId).then(function () { return result(me, keyId); });
        });
    });
}

var capabilities = {};
capabilities[P.contacts] = { capability: "CONTACTS", kind: K.contact, fields: CONTACT_FIELDS, pull: pullContacts, push: pushContact };
capabilities[P.calendar] = { capability: "CALENDAR", kind: K.event, fields: EVENT_FIELDS, pull: pullEvents, push: pushEvent,
                             // (Turned on again, the kit's token is gone: a full listing, whatever calendarTokens holds.)
                             remove: function (ctx) { return removeAll(ctx, [K.event, K.calendar]); } };
capabilities[P.tasks] = { capability: "TASKS", kind: K.task, fields: TASK_FIELDS, pull: pullTasks, push: pushTask,
                          remove: function (ctx) { return removeAll(ctx, [K.task, K.list]); } };

module.exports = kit.defineConnector({
    service: SERVICE,
    templateIds: [TEMPLATE],
    kinds: { state: "org.webosphoenix.google.state:1", item: K.item },
    userAgent: "webOS-Phoenix-Google/0.1",
    hosts: GG.HOSTS,
    signUp: "https://accounts.google.com/signup",

    validate: function (ctx, p) {
        var c = p.config || {};
        if (!c.oauthKey) return Promise.reject(fail("Sign in with Google first", "401_UNAUTHORIZED"));
        return clientOf(ctx).then(function (client) {
            if (!client) throw kit.notAvailable("Google");
            return GG.whoAmI(GG.apis(ctx, function () { return ctx.oauth.token(c.oauthKey); }, client));
        }).then(function (me) { return result(me, c.oauthKey); });
    },

    capabilities: capabilities,
    schedule: { every: "15m" },

    onDelete: function (ctx) {
        var key = (ctx.credentials && ctx.credentials.oauthKey) || (ctx.config && ctx.config.oauthKey);
        return key ? ctx.oauth.forget(key) : Promise.resolve();
    },

    methods: {
        providerInfo: function (ctx) {
            return clientOf(ctx).then(function (c) {
                return {
                    name: "Google",
                    help: "Your Google Calendar, Contacts and Tasks, kept in step both ways. Sign in on Google's own page. (Google Drive is a drive in Files; Gmail is an Email account.)",
                    oauth: c ? { available: true, label: "Sign In with Google" } : { available: false, reason: kit.notAvailable("Google").message },
                    privacy: "Your data goes between this device and Google only; no Phoenix server is in between."
                };
            });
        },
        signIn: function (ctx, p) { return signIn(ctx, p); }
    }
});

module.exports.TEMPLATE = TEMPLATE;
module.exports.KINDS = K;
module.exports.PROVIDERS = P;
