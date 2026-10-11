// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Zoom account (template com.webosphoenix.zoom;
// docs/SYNERGY-CONNECTORS.md 7, "Meetings and video calls" (3)), on the
// connector kit, through Zoom's REST API v2
// (https://developers.zoom.us/docs/api/):
//
//   CALENDAR  read only: your upcoming meetings in a calendar of their own,
//             "Zoom" (com.palm.calendar.zoom:1, com.palm.calendarevent.zoom:1),
//             each with its join address as the event's url and the first
//             line of its note ("Join Zoom meeting: ..."); a recurring
//             meeting's occurrences one by one
//               GET /users/me/meetings?type=upcoming (next_page_token)
//               GET /meetings/{id} (a recurring meeting's occurrences)
//   createMeeting {accountId, topic, start, duration?, agenda?}
//             schedules one (POST /users/me/meetings) -> {joinUrl, id};
//             for the Assistant ("Zoom meeting with Sam at 3") and Calendar
//
// Meetings run in the browser: Zoom's own app has no build for ARM Linux.
//
// Sign-in: Zoom's page in the system's sign-in sheet (OAuth). Zoom's token
// endpoint wants the app's client secret (with HTTP Basic client
// authentication), so Phoenix's Zoom app (a "General app", user-managed,
// registered by the project account: docs/DEVELOPER-APPS.md) signs in
// through the token relay (OPEN-QUESTIONS Q49, PLATFORM.md 6.5.4), or with
// the secret in the image's setting /etc/palm/zoom/clients.json
// ({"zoom": {"clientId": "...", "clientSecret": "..."}}) once the OAuth
// service sends it that way. Until either is there: "not available in this
// build".

"use strict";

var kit = require("@phoenix/connector-kit");

var SERVICE = "org.webosphoenix.service.zoom";
var TEMPLATE = "com.webosphoenix.zoom";
var CLIENTS = "zoom/clients.json";
var API = "https://api.zoom.us/v2";
var K = { calendar: "com.palm.calendar.zoom:1", event: "com.palm.calendarevent.zoom:1", item: "org.webosphoenix.zoom.item:1" };
var PROVIDER = TEMPLATE + ".calendar";
var EVENT_FIELDS = ["calendarId", "subject", "location", "note", "allDay", "tzId", "dtstart", "dtend", "url", "joinUrl", "alarm"];
var OAUTH = {
    authorizationEndpoint: "https://zoom.us/oauth/authorize",
    tokenEndpoint: "https://zoom.us/oauth/token",
    revocationEndpoint: "https://zoom.us/oauth/revoke",
    // Zoom's granular scopes (https://developers.zoom.us/docs/integrations/oauth-scopes-granular/).
    scope: "user:read:user meeting:read:list_meetings meeting:read:meeting meeting:write:meeting"
};

function fail(message, errorCode) { var e = new Error(message); e.errorCode = errorCode; return e; }

// The registration: a client id and the secret, or the relay that keeps it.
function clientOf(ctx) {
    return kit.registeredClient(ctx, CLIENTS, "zoom", OAUTH).then(function (c) {
        return c && c.clientSecret ? c : kit.viaRelay(ctx, c);
    });
}

function notAvailable() {
    return fail("Zoom is not available in this build: Phoenix's Zoom app is not registered here, and Zoom's sign-in needs its client secret, " +
                "kept by Phoenix's token relay (docs/DEVELOPER-APPS.md)", "NOT_AVAILABLE");
}

function api(ctx, token, client) {
    return kit.restApi(ctx, { base: (client && client.api) || API, token: token,
                              describe: function (b) { return b && (b.message || b.reason) ? String(b.message || b.reason) : ""; } });
}

// A signed-in account's API calls need only the registration (the OAuth service refreshes its token).
function session(ctx) {
    var key = (ctx.credentials && ctx.credentials.oauthKey) || (ctx.config && ctx.config.oauthKey);
    return kit.registeredClient(ctx, CLIENTS, "zoom", OAUTH).then(function (c) {
        if (!c) throw notAvailable();
        return api(ctx, function () { return ctx.oauth.token(key); }, c);
    });
}

function whoAmI(a) {
    return a.get("/users/me").then(function (u) {
        return { id: u.id, username: u.email || u.id, name: [u.first_name, u.last_name].filter(Boolean).join(" ") };
    });
}

function eventOf(m, start, duration, calendarId) {
    var t = Date.parse(start);
    var join = m.join_url || "";
    return {
        calendarId: calendarId, subject: m.topic || "Zoom meeting", location: "Zoom", allDay: false, tzId: m.timezone || "UTC",
        dtstart: t, dtend: t + (Number(duration) || 30) * 60000,
        note: kit.meetingNote(m.agenda || "", join, "Zoom"), url: join, joinUrl: join,
        alarm: kit.alarmBefore(10)
    };
}

function pullMeetings(ctx) {
    return session(ctx).then(function (a) {
        return kit.syncContainers(ctx, K.calendar, [{ remoteId: "zoom", fields: { name: "Zoom", isReadOnly: true, syncSource: "Zoom", excludeFromAll: false, color: "blue" } }],
                                  { createOnly: ["color"] }).then(function (ids) {
            var all = [];
            function page(token, n) {
                return a.get("/users/me/meetings", { type: "upcoming", page_size: 300, next_page_token: token || undefined }).then(function (r) {
                    all = all.concat(r.meetings || []);
                    return r.next_page_token && n < 10 ? page(r.next_page_token, n + 1) : all;
                });
            }
            return page(null, 0).then(function (meetings) {
                var changes = [], chain = Promise.resolve();
                meetings.forEach(function (m) {
                    chain = chain.then(function () {
                        // A recurring meeting with a fixed time (type 8): its occurrences; one with none (3): nothing to put in a calendar.
                        if (m.type === 3) return null;
                        if (m.type !== 8) {
                            changes.push({ remoteId: String(m.id), etag: [m.start_time, m.duration, m.topic, m.join_url, m.agenda || ""].join("|"),
                                           fields: eventOf(m, m.start_time, m.duration, ids.zoom) });
                            return null;
                        }
                        return a.get("/meetings/" + encodeURIComponent(m.id)).then(function (d) {
                            (d.occurrences || []).filter(function (o) { return o.status !== "deleted"; }).forEach(function (o) {
                                var full = Object.assign({}, m, d);
                                changes.push({ remoteId: m.id + "/" + o.occurrence_id, etag: [o.start_time, o.duration, d.topic, d.join_url, d.agenda || ""].join("|"),
                                               fields: eventOf(full, o.start_time, o.duration, ids.zoom) });
                            });
                        });
                    });
                });
                return chain.then(function () { return { full: true, nextToken: null, changes: changes }; });
            });
        });
    });
}

function removeAll(ctx) {
    var chain = Promise.resolve();
    [K.event, K.calendar].forEach(function (kind) {
        chain = chain.then(function () {
            return ctx.db.find({ from: kind, where: [{ prop: "accountId", op: "=", val: ctx.accountId }] }).then(function (objs) {
                return objs.length ? ctx.db.del(objs.map(function (o) { return o._id; })) : null;
            });
        });
    });
    return chain;
}

function signIn(ctx, p) {
    var client;
    return clientOf(ctx).then(function (c) {
        if (!c) throw notAvailable();
        client = c;
        return kit.oauthSignIn(ctx, client, { accountId: p.accountId });
    }).then(function (keyId) {
        return whoAmI(api(ctx, function () { return ctx.oauth.token(keyId); }, client)).then(function (me) {
            return kit.forgetOldKey(ctx, p.accountId, keyId).then(function () {
                return { username: me.username, credentials: { common: { oauthKey: keyId } }, config: { userId: me.id, name: me.name, oauthKey: keyId } };
            });
        });
    });
}

var capabilities = {};
capabilities[PROVIDER] = { capability: "CALENDAR", kind: K.event, fields: EVENT_FIELDS, pull: pullMeetings, remove: removeAll };

module.exports = kit.defineConnector({
    service: SERVICE,
    templateIds: [TEMPLATE],
    kinds: { state: "org.webosphoenix.zoom.state:1", item: K.item },
    userAgent: "webOS-Phoenix-Zoom/0.1",
    hosts: ["api.zoom.us", "zoom.us"],
    signUp: "https://zoom.us/signup",

    validate: function (ctx, p) {
        var c = p.config || {};
        if (!c.oauthKey) return Promise.reject(fail("Sign in with Zoom first", "401_UNAUTHORIZED"));
        return kit.registeredClient(ctx, CLIENTS, "zoom", OAUTH).then(function (client) {
            if (!client) throw notAvailable();
            return whoAmI(api(ctx, function () { return ctx.oauth.token(c.oauthKey); }, client));
        }).then(function (me) {
            return { username: me.username, credentials: { common: { oauthKey: c.oauthKey } }, config: { userId: me.id, name: me.name, oauthKey: c.oauthKey } };
        });
    },

    capabilities: capabilities,
    schedule: { every: "15m" },

    onDelete: function (ctx) {
        var key = ctx.credentials && ctx.credentials.oauthKey;
        return key ? ctx.oauth.forget(key) : Promise.resolve();
    },

    methods: {
        providerInfo: function (ctx) {
            return clientOf(ctx).then(function (c) {
                return {
                    name: "Zoom",
                    help: "Your upcoming Zoom meetings in Calendar, each with where to join. Meetings open in the browser.",
                    oauth: c ? { available: true, label: "Sign In with Zoom" } : { available: false, reason: notAvailable().message },
                    privacy: "Your meetings go between this device and Zoom." + (c && c.broker ? " Zoom's sign-in goes through Phoenix's token relay, which sees the sign-in's tokens as they pass and keeps nothing (docs/PLATFORM.md 6.5.4)." : "")
                };
            });
        },
        signIn: function (ctx, p) { return signIn(ctx, p); },
        // {accountId, topic, start (ms or ISO), duration? (minutes), agenda?} -> {id, joinUrl, start}
        createMeeting: function (ctx, p) {
            if (!p.topic) return Promise.reject(fail("A meeting needs a topic", "400_BAD_REQUEST"));
            var start = typeof p.start === "number" ? new Date(p.start) : new Date(String(p.start || ""));
            if (isNaN(start.getTime())) return Promise.reject(fail("A meeting needs a start time", "400_BAD_REQUEST"));
            return session(ctx).then(function (a) {
                return a.post("/users/me/meetings", { topic: String(p.topic).slice(0, 200), type: 2, start_time: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
                                                      duration: Number(p.duration) || 30, timezone: "UTC", agenda: p.agenda ? String(p.agenda) : undefined,
                                                      settings: { join_before_host: false, waiting_room: true } });
            }).then(function (m) {
                // The calendar shows it at the next sync; ask for one now.
                Promise.resolve(ctx.luna.call("luna://" + SERVICE + "/sync", { accountId: ctx.accountId })).catch(function () {});
                return { id: String(m.id), joinUrl: m.join_url, start: m.start_time };
            });
        }
    }
});

module.exports.TEMPLATE = TEMPLATE;
module.exports.KINDS = K;
module.exports.PROVIDER = PROVIDER;
