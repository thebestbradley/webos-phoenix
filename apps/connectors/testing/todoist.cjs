// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for Todoist's API v1 (https://developer.todoist.com/api/v1/),
// the endpoints the Todoist connector uses (apps/connectors/todoist), as
// documented: /api/v1/user, /projects and /tasks (cursor paging: results,
// next_cursor), /tasks/completed/by_completion_date (items, next_cursor),
// POST /tasks, /tasks/{id}, /tasks/{id}/move, /close, /reopen, DELETE
// /tasks/{id}; and Todoist's OAuth (its token exchange asks for the client
// secret) on the fake's /oauth/todoist/. The personal API token is
// fake.todoist.token.

"use strict";

const crypto = require("crypto");

function addTodoist(base, opts) {
    opts = opts || {};
    const send = base.send;
    const td = base.todoist = {
        token: "0123456789abcdef0123456789abcdef01234567",
        user: { id: "2671355", email: "anna@example.com", full_name: "Anna Lee", tz_info: { timezone: "Europe/Berlin" } },
        projects: [
            { id: "220474322", name: "Inbox", inbox_project: true, child_order: 0, color: "grey", is_archived: false, is_deleted: false },
            { id: "220474323", name: "Groceries", inbox_project: false, child_order: 1, color: "green", is_archived: false, is_deleted: false }
        ],
        tasks: [],
        pageSize: opts.pageSize || 0,
        secret: "todoist-test-secret"
    };
    let next = 7000;
    const stamp = () => new Date(Date.now() + (next++ % 1000)).toISOString();
    function add(t) {
        const task = Object.assign({ id: String(next++), content: "", description: "", project_id: td.projects[0].id, priority: 1, due: null,
                                     checked: false, is_deleted: false, added_at: stamp(), updated_at: stamp(), completed_at: null, labels: [] }, t);
        td.tasks.push(task);
        return task;
    }
    td.add = add;
    add({ content: "Buy milk", project_id: "220474323", priority: 4, due: { date: "2026-10-12", string: "Oct 12", is_recurring: false } });
    add({ content: "Call the dentist", description: "About the cleaning", due: { date: "2026-10-13T09:30:00", string: "Oct 13 9:30", is_recurring: false } });
    add({ content: "Renew passport", priority: 2, due: { date: "2026-11-01T08:00:00Z", string: "Nov 1 8am", timezone: "UTC", is_recurring: false } });
    add({ content: "Plan the trip", checked: true, completed_at: new Date().toISOString() });
    // Changed on the server (the tests): content and a new updated_at.
    td.edit = (id, fields) => { const t = td.tasks.find((x) => x.id === id); Object.assign(t, fields, { updated_at: stamp() }); return t; };

    base.oauthProvider("todoist", { secret: td.secret, pkce: false, scope: "data:read_write,data:delete" });

    function authed(req) {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
        return !!m && (m[1] === td.token || !!base.bearer(req, "todoist"));
    }
    function paged(list, query, key) {
        const size = td.pageSize || Number(query.get("limit")) || 50;
        const start = Number(query.get("cursor") || 0);
        const page = list.slice(start, start + size);
        const out = {};
        out[key] = page;
        out.next_cursor = start + size < list.length ? String(start + size) : null;
        return out;
    }
    const P = "^/api/v1";
    base.route("*", new RegExp(P + "/"), (req, res) => {
        if (!authed(req)) return send(res, 401, { error: "Unauthorized", error_tag: "AUTH_INVALID_TOKEN" });
        return false;
    });
    base.route("GET", new RegExp(P + "/user$"), (req, res) => send(res, 200, td.user));
    base.route("GET", new RegExp(P + "/projects$"), (req, res, c) => send(res, 200, paged(td.projects.filter((p) => !p.is_deleted), c.query, "results")));
    base.route("GET", new RegExp(P + "/tasks$"), (req, res, c) => send(res, 200, paged(td.tasks.filter((t) => !t.checked && !t.is_deleted), c.query, "results")));
    base.route("GET", new RegExp(P + "/tasks/completed/by_completion_date$"), (req, res, c) => {
        const since = Date.parse(c.query.get("since") || ""), until = Date.parse(c.query.get("until") || "");
        if (isNaN(since) || isNaN(until)) return send(res, 400, { error: "since and until are required" });
        const done = td.tasks.filter((t) => t.checked && !t.is_deleted && Date.parse(t.completed_at) >= since && Date.parse(t.completed_at) <= until);
        return send(res, 200, paged(done, c.query, "items"));
    });
    const byId = (id) => td.tasks.find((t) => t.id === id && !t.is_deleted);
    base.route("GET", new RegExp(P + "/tasks/([^/]+)$"), (req, res, c) => {
        const t = byId(c.m[1]);
        return t ? send(res, 200, t) : send(res, 404, { error: "Task not found" });
    });
    function applyDue(t, b) {
        if (b.due_string === "no date") t.due = null;
        else if (b.due_date) t.due = { date: b.due_date, string: b.due_date, is_recurring: false };
        else if (b.due_datetime) t.due = { date: b.due_datetime, string: b.due_datetime, timezone: "UTC", is_recurring: false };
    }
    base.route("POST", new RegExp(P + "/tasks$"), (req, res, c) => {
        const b = c.json() || {};
        if (!b.content) return send(res, 400, { error: "content is required" });
        const key = req.headers["x-request-id"];
        if (key) {
            const seen = td.tasks.find((t) => t.requestId === key);
            if (seen) return send(res, 200, seen);
        }
        const t = add({ content: b.content, description: b.description || "", project_id: b.project_id || td.projects[0].id, priority: b.priority || 1,
                        requestId: key || undefined });
        applyDue(t, b);
        return send(res, 200, t);
    });
    base.route("POST", new RegExp(P + "/tasks/([^/]+)$"), (req, res, c) => {
        const t = byId(c.m[1]);
        if (!t) return send(res, 404, { error: "Task not found" });
        const b = c.json() || {};
        ["content", "description", "priority"].forEach((k) => { if (b[k] !== undefined) t[k] = b[k]; });
        applyDue(t, b);
        t.updated_at = stamp();
        return send(res, 200, t);
    });
    base.route("POST", new RegExp(P + "/tasks/([^/]+)/(close|reopen|move)$"), (req, res, c) => {
        const t = byId(c.m[1]);
        if (!t) return send(res, 404, { error: "Task not found" });
        if (c.m[2] === "move") t.project_id = (c.json() || {}).project_id || t.project_id;
        else { t.checked = c.m[2] === "close"; t.completed_at = t.checked ? new Date().toISOString() : null; }
        t.updated_at = stamp();
        return send(res, 204, "");
    });
    base.route("DELETE", new RegExp(P + "/tasks/([^/]+)$"), (req, res, c) => {
        const t = byId(c.m[1]);
        if (!t) return send(res, 404, { error: "Task not found" });
        t.is_deleted = true;
        return send(res, 204, "");
    });
    td.clients = () => ({ todoist: base.clientOf("todoist", { api: base.origin + "/api/v1", tokenEndpoint: base.origin + "/oauth/todoist/token" }) });
    td.id = () => crypto.randomBytes(4).toString("hex");
    return td;
}

module.exports = { addTodoist };
