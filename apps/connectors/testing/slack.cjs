// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for Slack's Web API (https://api.slack.com/web) as the Slack
// account uses it (apps/connectors/slack), under /slack/api/<method> (POST,
// form or JSON; {ok, error}): auth.test, users.list, conversations.list
// (cursor paging), conversations.history (oldest; for an app outside the
// Slack Marketplace at most 15 messages a call and one call a minute per
// conversation, else HTTP 429 ratelimited with Retry-After, as Slack's
// 2025 limits), chat.postMessage. A user token for the tests: fake.slack.token.

"use strict";

function addSlack(base) {
    const send = base.send;
    const sl = base.slack = {
        token: "xoxp-1111-2222-3333-test", team: { id: "T0PHX", name: "Phoenix Makers" }, me: "U0ANNA", marketplace: false, historyCalls: {},
        users: [
            { id: "U0ANNA", name: "anna", real_name: "Anna Lee", profile: { display_name: "anna", real_name: "Anna Lee", email: "anna@example.com", title: "Developer" } },
            { id: "U0RAJ", name: "raj", real_name: "Raj Patel", profile: { display_name: "raj", real_name: "Raj Patel", email: "raj@example.com", title: "Designer", phone: "+1 555 0142" } },
            { id: "U0KIM", name: "kim", real_name: "Kim", profile: { display_name: "", real_name: "Kim", email: "" } },
            { id: "U0BOT", name: "deploybot", is_bot: true, profile: { real_name: "Deploy Bot" } },
            { id: "U0GONE", name: "old", deleted: true, profile: { real_name: "Old Account" } }
        ],
        channels: [
            { id: "D0RAJ", is_im: true, user: "U0RAJ" },
            { id: "C0GEN", name: "general", is_channel: true, is_member: true },
            { id: "C0RAND", name: "random", is_channel: true, is_member: false }
        ],
        messages: { D0RAJ: [{ ts: "1760090000.000100", user: "U0RAJ", text: "Morning! Did the build pass?" }],
                    C0GEN: [{ ts: "1760090100.000200", user: "U0KIM", text: "Release notes are up: <https://example.org/notes|notes>" }],
                    C0RAND: [{ ts: "1760090200.000300", user: "U0KIM", text: "not a member here" }] },
        posted: []
    };
    let tick = 1760100000;
    sl.say = (channel, user, text) => { const m = { ts: (tick++) + ".000100", user, text }; sl.messages[channel].push(m); return m; };

    function authed(req) {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
        return !!m && (m[1] === sl.token || !!base.bearer(req, "slack"));
    }
    base.route("POST", /^\/slack\/api\/([a-zA-Z.]+)$/, (req, res, c) => {
        if (!authed(req)) return send(res, 200, { ok: false, error: "invalid_auth" });
        const ct = req.headers["content-type"] || "";
        const a = /json/.test(ct) ? (c.json() || {}) : Object.fromEntries(c.form());
        const page = (list, key) => {
            const limit = Number(a.limit) || 100, start = Number(a.cursor || 0);
            return { ok: true, [key]: list.slice(start, start + Math.min(limit, 2)), response_metadata: { next_cursor: start + 2 < list.length ? String(start + 2) : "" } };
        };
        switch (c.m[1]) {
        case "auth.test": return send(res, 200, { ok: true, url: "https://phoenix-makers.slack.com/", team: sl.team.name, user: "anna", team_id: sl.team.id, user_id: sl.me });
        case "users.list": return send(res, 200, page(sl.users, "members"));
        case "conversations.list": {
            const types = String(a.types || "public_channel").split(",");
            const list = sl.channels.filter((ch) => (ch.is_im ? types.includes("im") : types.includes("public_channel")));
            return send(res, 200, page(list, "channels"));
        }
        case "conversations.history": {
            const ch = a.channel;
            if (!sl.messages[ch]) return send(res, 200, { ok: false, error: "channel_not_found" });
            if (!sl.marketplace) {
                if (Number(a.limit) > 15) return send(res, 200, { ok: false, error: "invalid_limit" });
                const last = sl.historyCalls[ch] || 0;
                if (Date.now() - last < 60000) return send(res, 429, { ok: false, error: "ratelimited" }, { "Retry-After": "60" });
            }
            sl.historyCalls[ch] = Date.now();
            const oldest = a.oldest || "0";
            return send(res, 200, { ok: true, messages: sl.messages[ch].filter((m) => m.ts > oldest).slice().reverse().slice(0, Number(a.limit) || 100), has_more: false });
        }
        case "chat.postMessage": {
            if (!sl.messages[a.channel]) return send(res, 200, { ok: false, error: "channel_not_found" });
            const m = sl.say(a.channel, sl.me, a.text);
            sl.posted.push({ channel: a.channel, text: a.text });
            return send(res, 200, { ok: true, channel: a.channel, ts: m.ts, message: m });
        }
        }
        return send(res, 200, { ok: false, error: "unknown_method" });
    });
    sl.clients = () => ({ slack: { api: base.origin + "/slack/api" } });
    return sl;
}

module.exports = { addSlack };
