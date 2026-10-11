// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Todoist account (template com.webosphoenix.todoist;
// docs/SYNERGY-CONNECTORS.md 1, "Tasks"), on the connector kit: Todoist's
// projects as lists in Tasks and their tasks, both ways (lib/todoist.js has
// the API and the mapping).
//
// Two ways to sign in (the sign-in page, accounts/wizard.html):
//   - the personal API token (Todoist's Settings > Integrations >
//     Developer): pasted in, kept in the account's credentials. Needs no
//     registration with Todoist: works in every build.
//   - Sign In with Todoist (OAuth): Todoist's page in the system's sign-in
//     sheet. Needs Phoenix's app registered with Todoist, whose client id
//     and secret are a setting of the image, /etc/palm/todoist/clients.json
//     ({"todoist": {"clientId": "...", "clientSecret": "..."}};
//     docs/DEVELOPER-APPS.md). Todoist's token exchange asks for the
//     secret: it ships in that file, or goes through the token relay
//     (OPEN-QUESTIONS Q49). Without it the page says "not available in this
//     build" and offers the token only.
//
//   TASKS   two-way: the projects as com.palm.tasklist.todoist:1 lists
//           (their tasks' kind, com.palm.task.todoist:1, named on each list
//           so Tasks puts a new task in it there), open tasks and those done
//           in the last 14 days; a task added, changed, completed or deleted
//           in Tasks goes to Todoist on the next sync. The server wins a
//           field changed on both sides (SYNERGY.md 3.3).
//
// Sharing: "Add to Todoist" in the share sheet makes a task in the Inbox of
// the account chosen from a link or text (the kit's compose page,
// index.html).

"use strict";

var kit = require("@phoenix/connector-kit");
var TD = require("./lib/todoist");

var SERVICE = "org.webosphoenix.service.todoist";
var TEMPLATE = "com.webosphoenix.todoist";
var TASK_KIND = "com.palm.task.todoist:1";
var LIST_KIND = "com.palm.tasklist.todoist:1";
var CLIENTS = "todoist/clients.json";
var PROVIDER = TEMPLATE + ".tasks";
var FIELDS = ["summary", "notes", "due", "allDay", "completed", "completedTime", "priority", "listId"];
var DONE_DAYS = 14;

function fail(message, errorCode) { var e = new Error(message); e.errorCode = errorCode; return e; }

// The image's setting: the OAuth registration, and (tests) the API's address.
function settingOf(ctx) {
    return ctx.systemConfig(CLIENTS).then(function (all) {
        var c = (all && all.todoist) || {};
        ["api", "authorizationEndpoint", "tokenEndpoint"].forEach(function (k) {
            if (c[k]) { try { ctx.http.allowHost(new URL(c[k]).host); } catch (e) { /* not an address */ } }
        });
        return c;
    });
}

function clientOf(ctx) {
    return kit.registeredClient(ctx, CLIENTS, "todoist", TD.OAUTH);
}

// The account's API client: its token, or its OAuth key's.
function session(ctx) {
    var cred = ctx.credentials || {};
    return settingOf(ctx).then(function (s) {
        var token;
        if (cred.token) token = function () { return Promise.resolve(cred.token); };
        else if (cred.oauthKey) token = function () { return ctx.oauth.token(cred.oauthKey); };
        else throw fail("The account has no Todoist token: sign in again", "401_UNAUTHORIZED");
        return TD.api(ctx, token, s.api);
    });
}

function whoAmI(api) {
    return api.get("/user").then(function (u) {
        if (!u || !u.id) throw fail("Todoist did not say whose token this is", "401_UNAUTHORIZED");
        return { id: String(u.id), username: u.email || u.full_name || String(u.id), name: u.full_name || "" };
    }, function (e) {
        if (e.status === 401 || e.status === 403) throw fail("Todoist did not accept the token", "401_UNAUTHORIZED");
        throw e;
    });
}

function result(me, credentials, mode) {
    return { username: me.username, credentials: { common: credentials }, config: { mode: mode, userId: me.id, name: me.name } };
}

// ---- Tasks ------------------------------------------------------------------------------

function pullTasks(ctx) {
    return session(ctx).then(function (api) {
        return TD.all(api, "/projects").then(function (projects) {
            var lists = projects.filter(function (p) { return !p.is_deleted && !p.is_archived; }).map(function (p, i) {
                var inbox = p.inbox_project || p.is_inbox_project;
                return { remoteId: String(p.id), fields: { name: inbox ? "Todoist Inbox" : String(p.name || "Project"),
                                                           sortOrder: 100 + (Number(p.child_order) || i), taskKind: TASK_KIND, inbox: !!inbox } };
            });
            return kit.syncContainers(ctx, LIST_KIND, lists, { createOnly: ["sortOrder"] });
        }).then(function (listIds) {
            var listIdOf = function (projectId) { return listIds[projectId] || ""; };
            var now = ctx.now();
            var since = new Date(now - DONE_DAYS * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");
            var until = new Date(now + 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
            return Promise.all([
                TD.all(api, "/tasks"),
                TD.all(api, "/tasks/completed/by_completion_date", { since: since, until: until }, 5)
            ]).then(function (got) {
                var seen = {}, changes = [];
                got[0].concat(got[1]).forEach(function (t) {
                    var id = String(t.id);
                    if (seen[id] || t.is_deleted || !listIdOf(String(t.project_id || ""))) return;
                    seen[id] = true;
                    changes.push({ remoteId: id, etag: TD.etagOf(t), fields: TD.taskFields(t, listIdOf) });
                });
                return { full: true, changes: changes, nextToken: null };
            });
        });
    });
}

function pushTask(ctx, change) {
    return session(ctx).then(function (api) {
        return kit.containerRemoteIds(ctx, LIST_KIND).then(function (projects) {
            var f = change.fields || {}, base = change.base || {};
            var project = projects[f.listId] || "";
            var refreshed = function (id) {
                return api.get("/tasks/" + encodeURIComponent(id)).then(function (t) { return { remoteId: String(t.id), etag: TD.etagOf(t) }; },
                                                                       function () { return { remoteId: String(id) }; });
            };
            if (change.op === "delete") {
                return api.del("/tasks/" + encodeURIComponent(change.remoteId)).catch(function (e) {
                    if (e.status === 404) return null; // gone already
                    throw e;
                }).then(function () { return { remoteId: change.remoteId }; });
            }
            var body = { content: f.summary || "", description: f.notes || "", priority: TD.todoistPriority(f.priority) };
            if (change.op === "create") {
                if (project) body.project_id = project;
                if (f.due) Object.assign(body, TD.dueFields(f.due, f.allDay));
                return api.post("/tasks", body).then(function (t) {
                    var id = String(t.id);
                    return (f.completed ? api.post("/tasks/" + encodeURIComponent(id) + "/close") : Promise.resolve()).then(function () { return refreshed(id); });
                });
            }
            var id = encodeURIComponent(change.remoteId);
            var steps = Promise.resolve();
            var dueChanged = f.due !== base.due || !!f.allDay !== !!base.allDay;
            if (f.summary !== base.summary || f.notes !== base.notes || f.priority !== base.priority || dueChanged) {
                if (dueChanged) Object.assign(body, TD.dueFields(f.due, f.allDay));
                steps = steps.then(function () { return api.post("/tasks/" + id, body); });
            }
            if (project && f.listId !== base.listId) steps = steps.then(function () { return api.post("/tasks/" + id + "/move", { project_id: project }); });
            if (!!f.completed !== !!base.completed) steps = steps.then(function () { return api.post("/tasks/" + id + (f.completed ? "/close" : "/reopen")); });
            return steps.then(function () { return refreshed(change.remoteId); });
        });
    });
}

// The lists go with the capability (the engine removes the tasks).
function removeTasks(ctx) {
    return ctx.db.find({ from: TASK_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] }).then(function (tasks) {
        return tasks.length ? ctx.db.del(tasks.map(function (t) { return t._id; })) : null;
    }).then(function () {
        return ctx.db.find({ from: LIST_KIND, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] });
    }).then(function (lists) {
        return lists.length ? ctx.db.del(lists.map(function (l) { return l._id; })) : null;
    });
}

// ---- Sharing: a task from a link or text ----------------------------------------------

var SHARE = {
    label: "Add to Todoist",
    accepts: { text: { maxLength: 16384 }, link: true },
    send: function (ctx, content) {
        var title = String(content.title || "").trim();
        var text = String(content.text || "").trim();
        var url = String(content.url || "").trim();
        // The task's name: the title, else the text's first line, else the link.
        var first = text.split(/\n/)[0].trim();
        var name = title || first || url;
        if (!name) return Promise.reject(fail("Nothing to add", "400_BAD_REQUEST"));
        var rest = [title ? text : text.split(/\n/).slice(1).join("\n").trim(), url && name !== url ? url : ""].filter(Boolean).join("\n\n");
        return session(ctx).then(function (api) {
            return api.post("/tasks", { content: name.slice(0, 500), description: rest }, { "X-Request-Id": content.idempotencyKey });
        }).then(function (t) {
            return { id: String(t.id), url: t.url || "https://app.todoist.com/app/task/" + encodeURIComponent(t.id) };
        });
    }
};

// ---- The definition ---------------------------------------------------------------------

function signIn(ctx, p) {
    var client;
    return clientOf(ctx).then(function (c) {
        if (!c) throw kit.notAvailable("Todoist", "Sign In with Todoist");
        client = c;
        return kit.oauthSignIn(ctx, client, { accountId: p.accountId });
    }).then(function (keyId) {
        return settingOf(ctx).then(function (s) {
            return whoAmI(TD.api(ctx, function () { return ctx.oauth.token(keyId); }, s.api)).then(function (me) {
                return kit.forgetOldKey(ctx, p.accountId, keyId).then(function () { return result(me, { oauthKey: keyId }, "oauth"); });
            });
        });
    });
}

module.exports = kit.defineConnector({
    service: SERVICE,
    templateIds: [TEMPLATE],
    kinds: { state: "org.webosphoenix.todoist.state:1", item: "org.webosphoenix.todoist.item:1" },
    userAgent: "webOS-Phoenix-Todoist/0.1",
    hosts: TD.HOSTS,
    signUp: "https://app.todoist.com/auth/signup",

    // {password: the personal API token} or {config: {oauthKey}} (after signIn).
    validate: function (ctx, p) {
        var c = p.config || {};
        return settingOf(ctx).then(function (s) {
            if (c.oauthKey) {
                return whoAmI(TD.api(ctx, function () { return ctx.oauth.token(c.oauthKey); }, s.api))
                    .then(function (me) { return result(me, { oauthKey: c.oauthKey }, "oauth"); });
            }
            var token = String(p.password || c.token || "").trim();
            if (!/^[A-Za-z0-9]{20,64}$/.test(token)) throw fail("Paste your API token from Todoist's Settings > Integrations > Developer", "401_UNAUTHORIZED");
            return whoAmI(TD.api(ctx, token, s.api)).then(function (me) { return result(me, { token: token }, "token"); });
        });
    },

    capabilities: (function () {
        var caps = {};
        caps[PROVIDER] = { capability: "TASKS", kind: TASK_KIND, fields: FIELDS, pull: pullTasks, push: pushTask, remove: removeTasks };
        return caps;
    })(),

    schedule: { every: "15m" },

    onDelete: function (ctx) {
        var key = ctx.credentials && ctx.credentials.oauthKey;
        return key ? ctx.oauth.forget(key) : Promise.resolve();
    },

    share: SHARE,

    methods: {
        // {templateId} -> what the sign-in page (accounts/ConnectorWizard.js) offers.
        providerInfo: function (ctx) {
            return clientOf(ctx).then(function (c) {
                return {
                    name: "Todoist",
                    help: "Your Todoist projects as lists in Tasks, and their tasks, kept in step both ways. " +
                          (c ? "Sign in on Todoist's page, or paste your API token." : "Paste your API token from Todoist's settings (Integrations, Developer)."),
                    oauth: c ? { available: true, label: "Sign In with Todoist" }
                             : { available: false, reason: kit.notAvailable("Todoist", "Sign In with Todoist").message + ". Your API token works instead." },
                    fields: [{ name: "password", caption: "API TOKEN", type: "password" }],
                    fieldsCaption: "Use an API Token Instead",
                    link: { caption: "Get Your API Token", url: "https://app.todoist.com/app/settings/integrations/developer" },
                    privacy: "Your tasks go between this device and Todoist only; no Phoenix server is in between."
                };
            });
        },
        // {accountId?} -> the validator's answer, after Todoist's page.
        signIn: function (ctx, p) { return signIn(ctx, p); }
    }
});

module.exports.TEMPLATE = TEMPLATE;
module.exports.KINDS = { task: TASK_KIND, list: LIST_KIND };
