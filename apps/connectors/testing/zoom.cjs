// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for Zoom's REST API v2 (https://developers.zoom.us/docs/api/),
// the calls the Zoom account makes (apps/connectors/zoom), under /zoom/v2:
// GET /users/me, GET /users/me/meetings?type=upcoming (page_size,
// next_page_token), GET /meetings/{id} (a recurring meeting's occurrences),
// POST /users/me/meetings; and Zoom's OAuth on /oauth/zoom/, whose token
// endpoint wants the client secret (HTTP Basic or the form).

"use strict";

function addZoom(base) {
    const send = base.send;
    let n = 85012345678;
    const z = base.zoom = {
        me: { id: "KdYKjnimT4KPd8FFgQt9FQ", email: "anna@example.com", first_name: "Anna", last_name: "Lee" },
        meetings: [], secret: "zoom-test-secret", pageSize: 2
    };
    const meeting = (o) => { const m = Object.assign({ id: n++, uuid: "u" + n, type: 2, timezone: "Europe/Berlin", duration: 30, agenda: "" }, o);
                             m.join_url = "https://us02web.zoom.us/j/" + m.id + "?pwd=abc" + (m.id % 97); z.meetings.push(m); return m; };
    meeting({ topic: "Client kickoff", start_time: "2026-10-15T13:00:00Z", duration: 45, agenda: "Scope and timeline" });
    meeting({ topic: "Book club", type: 8, start_time: "2026-10-16T18:00:00Z", duration: 60,
              occurrences: [{ occurrence_id: "1760637600000", start_time: "2026-10-16T18:00:00Z", duration: 60, status: "available" },
                            { occurrence_id: "1761847200000", start_time: "2026-10-30T18:00:00Z", duration: 60, status: "available" },
                            { occurrence_id: "1763056800000", start_time: "2026-11-13T18:00:00Z", duration: 60, status: "deleted" }] });
    meeting({ topic: "Office hours (any time)", type: 3, start_time: undefined });
    z.meeting = meeting;

    base.oauthProvider("zoom", { pkce: true, secret: z.secret, scope: "user:read:user meeting:read:list_meetings meeting:read:meeting meeting:write:meeting" });
    base.route("*", /^\/zoom\/v2\//, (req, res) => (base.bearer(req, "zoom") ? false : send(res, 401, { code: 124, message: "Invalid access token." })));
    base.route("GET", /^\/zoom\/v2\/users\/me$/, (req, res) => send(res, 200, z.me));
    base.route("GET", /^\/zoom\/v2\/users\/me\/meetings$/, (req, res, c) => {
        if (c.query.get("type") !== "upcoming") return send(res, 400, { code: 300, message: "the connector lists upcoming meetings" });
        const size = Math.min(Number(c.query.get("page_size")) || 30, z.pageSize);
        const start = Number(c.query.get("next_page_token") || 0);
        const list = z.meetings.map((m) => { const x = Object.assign({}, m); delete x.occurrences; return x; });
        return send(res, 200, { page_size: size, total_records: list.length, meetings: list.slice(start, start + size),
                                next_page_token: start + size < list.length ? String(start + size) : "" });
    });
    base.route("GET", /^\/zoom\/v2\/meetings\/(\d+)$/, (req, res, c) => {
        const m = z.meetings.find((x) => String(x.id) === c.m[1]);
        return m ? send(res, 200, m) : send(res, 404, { code: 3001, message: "Meeting does not exist." });
    });
    base.route("POST", /^\/zoom\/v2\/users\/me\/meetings$/, (req, res, c) => {
        const b = c.json() || {};
        if (!b.topic || !b.start_time) return send(res, 400, { code: 300, message: "topic and start_time" });
        return send(res, 201, meeting({ topic: b.topic, start_time: b.start_time, duration: b.duration, timezone: b.timezone, agenda: b.agenda || "" }));
    });
    z.clients = (withClient) => ({ zoom: withClient === false ? { api: base.origin + "/zoom/v2" } : base.clientOf("zoom", { api: base.origin + "/zoom/v2" }) });
    return z;
}

module.exports = { addZoom };
