// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Microsoft account (template com.webosphoenix.microsoft:
// Microsoft 365 work or school accounts and Outlook.com personal ones;
// docs/SYNERGY-CONNECTORS.md 1, SYNERGY-MODERN.md 1.3), on the connector
// kit, through Microsoft Graph (lib/msgraph.js). One sign-in for all of it:
// Microsoft's own page in the system's sign-in sheet (OAuth with PKCE, a
// public client), with Phoenix's Entra app registration, the one the
// drives' OneDrive uses, kept in the image's setting
// /etc/palm/microsoft/clients.json ({"microsoft": {"clientId": "..."}};
// docs/DEVELOPER-APPS.md). Without it the account type says "not available
// in this build". Tokens stay in the OAuth service's key store.
//
//   CONTACTS  two-way: the contacts folder (com.palm.contact.microsoft:1),
//             linked to the people you have
//   CALENDAR  two-way: each calendar (com.palm.calendar.microsoft:1) and its
//             events (com.palm.calendarevent.microsoft:1): repeats, reminders,
//             attendees; a Teams meeting's join address is the event's url
//             and the first line of its note ("Join Microsoft Teams
//             meeting: ..."), so Calendar shows where to join
//   TASKS     two-way: Microsoft To Do's lists (com.palm.tasklist.microsoft:1)
//             and their tasks (com.palm.task.microsoft:1)
//
// Not here yet: Outlook's mail in Email (SYNERGY.md 2.5: Graph's mail
// folders, or Email's IMAP and SMTP with XOAUTH2, whose token is for
// outlook.office.com rather than Graph). Until it is, the sign-in asks for
// no mail scope.
//
// The server wins a field changed on both sides (SYNERGY.md 3.3).

"use strict";

var kit = require("@phoenix/connector-kit");
var G = require("./lib/msgraph");

var SERVICE = "org.webosphoenix.service.microsoft";
var TEMPLATE = "com.webosphoenix.microsoft";
var CLIENTS = "microsoft/clients.json";
var K = {
    contact: "com.palm.contact.microsoft:1",
    calendar: "com.palm.calendar.microsoft:1",
    event: "com.palm.calendarevent.microsoft:1",
    list: "com.palm.tasklist.microsoft:1",
    task: "com.palm.task.microsoft:1",
    item: "org.webosphoenix.microsoft.item:1"
};
var P = { contacts: TEMPLATE + ".contacts", calendar: TEMPLATE + ".calendar", tasks: TEMPLATE + ".tasks" };
var CONTACT_FIELDS = ["name", "nickname", "birthday", "note", "emails", "phoneNumbers", "addresses", "organizations", "urls", "ims"];
var EVENT_FIELDS = ["calendarId", "subject", "location", "note", "allDay", "tzId", "dtstart", "dtend", "rrule", "alarm", "attendees", "transp",
                    "classification", "url", "joinUrl"];
var TASK_FIELDS = ["summary", "notes", "due", "allDay", "completed", "completedTime", "priority", "listId"];

function fail(message, errorCode) { var e = new Error(message); e.errorCode = errorCode; return e; }

function clientOf(ctx) {
    return kit.registeredClient(ctx, CLIENTS, "microsoft", G.OAUTH);
}

// The device's zone: all-day events are days there.
function localTz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
}

// The account's Graph client: its key's token.
function session(ctx) {
    var key = (ctx.credentials && ctx.credentials.oauthKey) || (ctx.config && ctx.config.oauthKey);
    return clientOf(ctx).then(function (c) {
        if (!c) throw fail(kit.notAvailable("Microsoft").message, "NOT_AVAILABLE");
        return G.api(ctx, function () { return ctx.oauth.token(key); }, c.graph);
    });
}

function result(me, keyId) {
    return { username: me.username, credentials: { common: { oauthKey: keyId } }, config: { userId: me.id, name: me.name, oauthKey: keyId } };
}

// ---- Contacts ---------------------------------------------------------------------------------

function pullContacts(ctx) {
    return session(ctx).then(function (a) {
        return G.all(a, "/me/contacts", { $top: 100, $select: G.CONTACT_SELECT });
    }).then(function (list) {
        return { full: true, nextToken: null, changes: list.map(function (c) {
            return { remoteId: c.id, etag: c.changeKey || c["@odata.etag"], fields: G.contactFields(c) };
        }) };
    });
}

function pushContact(ctx, ch) {
    return session(ctx).then(function (a) {
        if (ch.op === "delete") return a.del("/me/contacts/" + encodeURIComponent(ch.remoteId)).catch(gone).then(function () { return { remoteId: ch.remoteId }; });
        var body = G.graphContact(ch.fields || {});
        var call = ch.op === "create" ? a.post("/me/contacts", body) : a.patch("/me/contacts/" + encodeURIComponent(ch.remoteId), body);
        return call.then(function (c) { return { remoteId: c.id || ch.remoteId, etag: c.changeKey || c["@odata.etag"] }; });
    });
}

// Deleted already on the server: nothing left to do.
function gone(e) { if (e.status === 404) return null; throw e; }

// ---- Calendar -----------------------------------------------------------------------------------

function pullEvents(ctx) {
    var tz = localTz();
    return session(ctx).then(function (a) {
        return G.all(a, "/me/calendars", { $top: 100, $select: "id,name,color,hexColor,canEdit,isDefaultCalendar" }).then(function (cals) {
            return kit.syncContainers(ctx, K.calendar, cals.map(function (c, i) { return { remoteId: c.id, fields: G.calendarFields(c, i) }; }),
                                      { createOnly: ["color"] }).then(function (ids) {
                var changes = [], chain = Promise.resolve();
                cals.forEach(function (c) {
                    chain = chain.then(function () {
                        return G.all(a, "/me/calendars/" + encodeURIComponent(c.id) + "/events", { $top: 100, $select: G.EVENT_SELECT },
                                     { Prefer: G.PREFER }, 30).then(function (events) {
                            events.filter(function (e) { return !e.isCancelled && e.type !== "occurrence" && e.type !== "exception"; }).forEach(function (e) {
                                changes.push({ remoteId: e.id, etag: e.changeKey || e["@odata.etag"], fields: G.eventFields(e, ids[c.id], tz) });
                            });
                        });
                    });
                });
                return chain.then(function () { return { full: true, nextToken: null, changes: changes }; });
            });
        });
    });
}

// The user's answer to an invitation (their attendee entry, as Calendar or
// the Assistant sets it) goes as Graph's reply, which tells the organizer:
// POST /me/events/{id}/accept | decline | tentativelyAccept
// (https://learn.microsoft.com/graph/api/event-accept); a guest does not
// PATCH the organizer's event, so with nothing else changed that is all.
var ANSWER = { ACCEPTED: "accept", DECLINED: "decline", TENTATIVE: "tentativelyAccept" };
function sameBesidesGuests(a, b) {
    var x = Object.assign({}, a, { attendees: null }), y = Object.assign({}, b, { attendees: null });
    return JSON.stringify(x) === JSON.stringify(y);
}

function pushEvent(ctx, ch) {
    var tz = localTz();
    return session(ctx).then(function (a) {
        if (ch.op === "delete") return a.del("/me/events/" + encodeURIComponent(ch.remoteId)).catch(gone).then(function () { return { remoteId: ch.remoteId }; });
        var f = ch.fields || {};
        var body = G.graphEvent(f, tz);
        var answer = kit.answerChanged(ch, ctx.account && ctx.account.username);
        if (answer) {
            var path = "/me/events/" + encodeURIComponent(ch.remoteId);
            return a.post(path + "/" + ANSWER[answer], { sendResponse: true }).then(function () {
                if (!sameBesidesGuests(body, G.graphEvent(ch.base, tz))) return a.patch(path, body);
                return a.get(path, { $select: "id,changeKey" });
            }).then(function (e) { return { remoteId: ch.remoteId, etag: (e && (e.changeKey || e["@odata.etag"])) || ch.etag }; });
        }
        if (ch.op === "create") {
            return kit.containerRemoteIds(ctx, K.calendar).then(function (cals) {
                var cal = cals[f.calendarId];
                var path = cal ? "/me/calendars/" + encodeURIComponent(cal) + "/events" : "/me/events";
                return a.post(path, body);
            }).then(function (e) { return { remoteId: e.id, etag: e.changeKey || e["@odata.etag"] }; });
        }
        return a.patch("/me/events/" + encodeURIComponent(ch.remoteId), body).then(function (e) {
            return { remoteId: ch.remoteId, etag: e.changeKey || e["@odata.etag"] };
        });
    });
}

function removeCalendars(ctx) {
    return removeAll(ctx, [K.event, K.calendar]);
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

// ---- To Do ----------------------------------------------------------------------------------------

// A task's remote id is its list's and its own ("<listId>/<taskId>"): Graph reaches a task through its list.
function splitTaskId(remoteId) {
    var i = String(remoteId).lastIndexOf("/");
    return { list: remoteId.slice(0, i), task: remoteId.slice(i + 1) };
}
function taskPath(remoteId) {
    var t = splitTaskId(remoteId);
    return "/me/todo/lists/" + encodeURIComponent(t.list) + "/tasks/" + encodeURIComponent(t.task);
}

function pullTasks(ctx) {
    var tz = localTz();
    return session(ctx).then(function (a) {
        return G.all(a, "/me/todo/lists", { $top: 100 }).then(function (lists) {
            var containers = lists.map(function (l, i) {
                var name = l.wellknownListName === "defaultList" ? "To Do: " + (l.displayName || "Tasks") : (l.displayName || "List");
                return { remoteId: l.id, fields: { name: name, sortOrder: 200 + i, taskKind: K.task } };
            });
            return kit.syncContainers(ctx, K.list, containers, { createOnly: ["sortOrder"] }).then(function (ids) {
                var changes = [], chain = Promise.resolve();
                lists.forEach(function (l) {
                    chain = chain.then(function () {
                        return G.all(a, "/me/todo/lists/" + encodeURIComponent(l.id) + "/tasks", { $top: 100 }, null, 20).then(function (tasks) {
                            tasks.forEach(function (t) {
                                changes.push({ remoteId: l.id + "/" + t.id, etag: t["@odata.etag"] || t.lastModifiedDateTime, fields: G.taskFields(t, ids[l.id], tz) });
                            });
                        });
                    });
                });
                return chain.then(function () { return { full: true, nextToken: null, changes: changes }; });
            });
        });
    });
}

function pushTask(ctx, ch) {
    return session(ctx).then(function (a) {
        if (ch.op === "delete") return a.del(taskPath(ch.remoteId)).catch(gone).then(function () { return { remoteId: ch.remoteId }; });
        var f = ch.fields || {};
        return kit.containerRemoteIds(ctx, K.list).then(function (lists) {
            var list = lists[f.listId];
            var body = G.graphTask(f);
            var create = function () {
                if (!list) throw fail("The task's list is not one of the account's", "400_BAD_REQUEST");
                return a.post("/me/todo/lists/" + encodeURIComponent(list) + "/tasks", body).then(function (t) {
                    return { remoteId: list + "/" + t.id, etag: t["@odata.etag"] || t.lastModifiedDateTime };
                });
            };
            if (ch.op === "create") return create();
            // Another list: Graph has no move, so the task is made there and deleted here
            // (its new id comes in with the next sync, as a new task).
            if (list && splitTaskId(ch.remoteId).list !== list) {
                return create().then(function (r) { return a.del(taskPath(ch.remoteId)).catch(gone).then(function () { return r; }); });
            }
            return a.patch(taskPath(ch.remoteId), body).then(function (t) { return { remoteId: ch.remoteId, etag: t["@odata.etag"] || t.lastModifiedDateTime }; });
        });
    });
}

function removeTasks(ctx) { return removeAll(ctx, [K.task, K.list]); }

// ---- Sign-in -------------------------------------------------------------------------------------------

function signIn(ctx, p) {
    var client;
    return clientOf(ctx).then(function (c) {
        if (!c) throw kit.notAvailable("Microsoft");
        client = c;
        return kit.oauthSignIn(ctx, client, { accountId: p.accountId });
    }).then(function (keyId) {
        return G.whoAmI(G.api(ctx, function () { return ctx.oauth.token(keyId); }, client.graph)).then(function (me) {
            return kit.forgetOldKey(ctx, p.accountId, keyId).then(function () { return result(me, keyId); });
        });
    });
}

var capabilities = {};
capabilities[P.contacts] = { capability: "CONTACTS", kind: K.contact, fields: CONTACT_FIELDS, pull: pullContacts, push: pushContact };
capabilities[P.calendar] = { capability: "CALENDAR", kind: K.event, fields: EVENT_FIELDS, pull: pullEvents, push: pushEvent, remove: removeCalendars };
capabilities[P.tasks] = { capability: "TASKS", kind: K.task, fields: TASK_FIELDS, pull: pullTasks, push: pushTask, remove: removeTasks };

module.exports = kit.defineConnector({
    service: SERVICE,
    templateIds: [TEMPLATE],
    kinds: { state: "org.webosphoenix.microsoft.state:1", item: K.item },
    userAgent: "webOS-Phoenix-Microsoft/0.1",
    hosts: G.HOSTS,
    signUp: "https://signup.live.com/",

    validate: function (ctx, p) {
        var c = p.config || {};
        if (!c.oauthKey) return Promise.reject(fail("Sign in with Microsoft first", "401_UNAUTHORIZED"));
        return clientOf(ctx).then(function (client) {
            if (!client) throw kit.notAvailable("Microsoft");
            return G.whoAmI(G.api(ctx, function () { return ctx.oauth.token(c.oauthKey); }, client.graph));
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
                    name: "Microsoft",
                    help: "Your Outlook.com or Microsoft 365 contacts, calendars (Teams meetings with where to join) and Microsoft To Do lists, kept in step both ways. Sign in on Microsoft's own page.",
                    oauth: c ? { available: true, label: "Sign In with Microsoft" } : { available: false, reason: kit.notAvailable("Microsoft").message },
                    privacy: "Your data goes between this device and Microsoft only; no Phoenix server is in between. A work or school account's administrator may have to allow Phoenix first."
                };
            });
        },
        signIn: function (ctx, p) { return signIn(ctx, p); }
    }
});

module.exports.TEMPLATE = TEMPLATE;
module.exports.KINDS = K;
module.exports.PROVIDERS = P;
