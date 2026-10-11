// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Todoist's API v1 (https://developer.todoist.com/api/v1/, the unified API
// that replaced REST v2 and Sync v9 in 2025), the calls the connector makes:
//
//   GET    /user                                  who the token belongs to
//   GET    /projects?cursor=&limit=               projects (paged: results, next_cursor)
//   GET    /tasks?cursor=&limit=                  open tasks (paged)
//   GET    /tasks/completed/by_completion_date?since=&until=&cursor=
//                                                 tasks done in a window (items, next_cursor)
//   GET    /tasks/{id}                            one task (its updated_at after a change)
//   POST   /tasks {content, description, project_id, priority, due_date | due_datetime}
//   POST   /tasks/{id} {...}                      update (due_string "no date" clears the date)
//   POST   /tasks/{id}/move {project_id}          to another project
//   POST   /tasks/{id}/close, /tasks/{id}/reopen
//   DELETE /tasks/{id}
//
// Authorization: a Bearer token, either the user's personal API token
// (Settings > Integrations > Developer: no registration) or one from
// Todoist's OAuth (an app registered at https://developer.todoist.com/appconsole.html).
//
// The mapping to Tasks (com.palm.task:1, apps/shared/luna/src/tasks.ts):
//
//   content        summary
//   description    notes
//   due.date       due (ms) and allDay: "2026-10-12" a day (local midnight),
//                  "2026-10-12T09:00:00" a floating time (the device's zone),
//                  "...Z" a fixed one
//   checked        completed (completed_at: completedTime)
//   priority       Todoist 4 (P1, urgent) -> 1 high, 3 (P2) -> 5 medium,
//                  2 (P3) -> 9 low, 1 (P4, none) -> 0
//   project_id     listId (the project's com.palm.tasklist.todoist:1)

"use strict";

var kit = require("@phoenix/connector-kit");

var API = "https://api.todoist.com/api/v1";
var PAGE = 200;

var OAUTH = {
    authorizationEndpoint: "https://app.todoist.com/oauth/authorize",
    tokenEndpoint: "https://api.todoist.com/oauth/access_token",
    scope: "data:read_write,data:delete"
};

function api(ctx, token, base) {
    return kit.restApi(ctx, {
        base: base || API,
        token: typeof token === "function" ? token : function () { return Promise.resolve(token); },
        describe: function (b) { return b && (b.error || b.error_tag) ? String(b.error || b.error_tag) : ""; }
    });
}

// Every page of a cursor-paged listing (results or items, next_cursor).
function all(a, path, query, max) {
    var out = [];
    function page(cursor, n) {
        return a.get(path, Object.assign({ limit: PAGE, cursor: cursor || undefined }, query || {})).then(function (r) {
            var list = (r && (r.results || r.items)) || (Array.isArray(r) ? r : []);
            out = out.concat(list);
            return r && r.next_cursor && n < (max || 50) ? page(r.next_cursor, n + 1) : out;
        });
    }
    return page(null, 0);
}

function pad(n) { return (n < 10 ? "0" : "") + n; }

// due -> {due, allDay}
function dueOf(due) {
    if (!due || !due.date) return { due: null, allDay: false };
    var d = String(due.datetime || due.date);
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(d);
    if (!m) return { due: null, allDay: false };
    if (m[4] === undefined) return { due: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), allDay: true };
    if (m[7]) return { due: Date.parse(d), allDay: false };
    return { due: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime(), allDay: false };
}

// {due, allDay} -> the request's fields.
function dueFields(due, allDay) {
    if (due === null || due === undefined || due === "") return { due_string: "no date" };
    var t = new Date(Number(due));
    if (allDay) return { due_date: t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate()) };
    return { due_datetime: t.toISOString().replace(/\.\d{3}Z$/, "Z") };
}

var TO_PRIORITY = { 4: 1, 3: 5, 2: 9, 1: 0 };
function priorityOf(p) { return TO_PRIORITY[Number(p)] !== undefined ? TO_PRIORITY[Number(p)] : 0; }
function todoistPriority(p) {
    p = Number(p) || 0;
    if (p === 0) return 1;
    if (p <= 3) return 4;
    if (p <= 6) return 3;
    return 2;
}

/** A task -> the db8 fields (listId from the project's list). */
function taskFields(t, listIdOf) {
    var d = dueOf(t.due);
    var done = !!(t.checked || t.is_completed || t.completed_at);
    return {
        summary: String(t.content || ""),
        notes: String(t.description || ""),
        due: d.due, allDay: d.allDay,
        completed: done,
        completedTime: done ? (Date.parse(t.completed_at || "") || null) : null,
        priority: priorityOf(t.priority),
        listId: listIdOf(String(t.project_id || "")) || ""
    };
}

/** The change key: Todoist bumps updated_at on every change. */
function etagOf(t) {
    return String(t.updated_at || t.added_at || "") + (t.checked || t.completed_at ? "|done" : "");
}

module.exports = {
    API: API, OAUTH: OAUTH, HOSTS: ["api.todoist.com", "app.todoist.com", "todoist.com"],
    api: api, all: all, dueOf: dueOf, dueFields: dueFields, priorityOf: priorityOf, todoistPriority: todoistPriority,
    taskFields: taskFields, etagOf: etagOf
};
