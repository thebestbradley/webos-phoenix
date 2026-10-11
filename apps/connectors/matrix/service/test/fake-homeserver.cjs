// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A fake Matrix homeserver for the Matrix account's tests and the
// simulator's demo (matrix.example): the client-server API the connector
// uses, from the specification (https://spec.matrix.org/v1.16/client-server-api/):
//
//   discovery     /.well-known/matrix/client, /_matrix/client/versions
//                 (with org.matrix.simplified_msc3575 when slidingSync)
//   sign-in       GET/POST /v3/login (m.login.password), whoami, logout;
//                 OAuth 2.0 metadata when oauth (/v1/auth_metadata), its
//                 dynamic registration, authorize form and token endpoint
//   sync          simplified sliding sync (MSC4186) and /v3/sync, both
//                 long-polling; account_data (m.direct), receipts, typing
//   rooms         send (transaction ids), createRoom (is_direct), join,
//                 receipts, typing, account_data
//   media         POST /_matrix/media/v3/upload; GET /v1/media/download
//                 (authenticated) and /v3/download
//
// People the server plays: they answer a message after a moment, send a
// read receipt, and one room is end-to-end encrypted (what arrives in it is
// m.room.encrypted, which the connector cannot read yet).
//
//   var s = createFakeHomeserver({serverName, users: {me: "pw"}, people: [...], slidingSync?, oauth?})
//   s.request(req) -> the HTTP the kit's http sends (also .start(port) for a real one)
//   s.say(fromUserId, toUserId, text, {encrypted?, image?})  s.inviteDirect(from, to)
//   s.unauthorized(on)  s.throttle(seconds)  s.requests()

"use strict";

// Node's http only for start() (the simulator's page has none).

function createFakeHomeserver(options) {
    options = options || {};
    var serverName = options.serverName || "matrix.test";
    var base = options.base || "https://" + serverName;
    var users = Object.assign({}, options.users || {});
    var people = (options.people || []).map(function (p) { return Object.assign({ replies: [] }, p); });
    var replyDelay = options.replyDelay === undefined ? 300 : options.replyDelay;
    var schedule = options.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
    var tokens = {};           // token -> {userId, deviceId}
    var rooms = {};            // roomId -> {id, name, members: {userId: displayname}, events: [], encrypted, direct}
    var stream = [];           // global event log: {pos, roomId, event} | {pos, accountData: {userId, type}} | {pos, receipt}
    var accountData = {};      // userId -> {type: content}
    var media = {};            // mediaId -> {bytes, type, name}
    var txns = {};             // userId + txnId -> event_id
    var waiting = [];          // long polls
    var count = 0, refuse = false, slowDown = 0, seq = 0;
    var oauthClients = {}, oauthCodes = {}, oauthPending = {};

    function now() { return options.now ? options.now() : Date.now(); }
    function uid(local) { return "@" + local + ":" + serverName; }
    function person(userId) { return people.filter(function (p) { return p.userId === userId; })[0] || null; }
    function nameOf(userId) {
        var p = person(userId);
        return p ? p.displayname : (users[(userId.match(/^@([^:]+):/) || [])[1]] !== undefined ? (options.myName || userId.slice(1).split(":")[0]) : userId);
    }
    function push(entry) {
        entry.pos = ++seq;
        stream.push(entry);
        var w = waiting.splice(0);
        w.forEach(function (f) { f(); });
        return entry;
    }
    function event(roomId, sender, type, content, extra) {
        var e = Object.assign({ event_id: "$" + (++seq).toString(36) + "e" + Math.random().toString(36).slice(2, 7), room_id: roomId, sender: sender,
                                type: type, content: content, origin_server_ts: now() }, extra || {});
        rooms[roomId].events.push(e);
        push({ roomId: roomId, event: e });
        return e;
    }
    function room(id, name, members, opts) {
        rooms[id] = { id: id, name: name || "", members: Object.assign({}, members), events: [], encrypted: !!(opts && opts.encrypted),
                      direct: opts && opts.direct || null };
        var creator = Object.keys(members)[0];
        event(id, creator, "m.room.create", { creator: creator }, { state_key: "" });
        Object.keys(members).forEach(function (m) { event(id, m, "m.room.member", { membership: "join", displayname: members[m] }, { state_key: m }); });
        if (name) event(id, creator, "m.room.name", { name: name }, { state_key: "" });
        if (opts && opts.encrypted) event(id, creator, "m.room.encryption", { algorithm: "m.megolm.v1.aes-sha2" }, { state_key: "" });
        return rooms[id];
    }
    function setDirect(userId, other, roomId) {
        var d = (accountData[userId] = accountData[userId] || {})["m.direct"] = (accountData[userId]["m.direct"] || {});
        d[other] = (d[other] || []).filter(function (r) { return r !== roomId; }).concat([roomId]);
        push({ accountData: { userId: userId, type: "m.direct" } });
    }
    function directRoom(a, b) {
        var r = Object.keys(rooms).map(function (k) { return rooms[k]; }).filter(function (x) {
            return x.direct && x.members[a] !== undefined && x.members[b] !== undefined;
        })[0];
        return r || null;
    }

    // ---- The people: a DM with each user that signs in ----------------------------------------

    function welcome(userId) {
        people.forEach(function (p) {
            if (directRoom(userId, p.userId)) return;
            var members = {};
            members[p.userId] = p.displayname;
            members[userId] = nameOf(userId);
            var r = room("!dm" + (++seq).toString(36) + ":" + serverName, "", members, { direct: true, encrypted: !!p.encrypted });
            setDirect(userId, p.userId, r.id);
            if (p.greeting) say(p.userId, userId, p.greeting, { encrypted: !!p.encrypted });
        });
        (options.groups || []).forEach(function (g) {
            if (Object.keys(rooms).some(function (k) { return rooms[k].name === g.name && rooms[k].members[userId] !== undefined; })) return;
            var members = {};
            g.members.forEach(function (m) { members[m] = nameOf(m); });
            members[userId] = nameOf(userId);
            var r = room("!grp" + (++seq).toString(36) + ":" + serverName, g.name, members, {});
            (g.messages || []).forEach(function (m) { event(r.id, m[0], "m.room.message", { msgtype: "m.text", body: m[1] }); });
        });
    }

    function say(from, to, text, o) {
        o = o || {};
        var r = directRoom(from, to);
        if (!r) return null;
        if (o.encrypted || r.encrypted)
            return event(r.id, from, "m.room.encrypted", { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "AwgAEn...", session_id: "s1", device_id: "D1", sender_key: "k" });
        if (o.image) {
            var id = "m" + (++seq).toString(36);
            media[id] = { bytes: o.image.bytes, type: o.image.type, name: o.image.name };
            return event(r.id, from, "m.room.message", { msgtype: "m.image", body: o.image.name, url: "mxc://" + serverName + "/" + id,
                                                         info: { mimetype: o.image.type, size: o.image.bytes.length } });
        }
        return event(r.id, from, "m.room.message", { msgtype: "m.text", body: text });
    }

    function answer(roomId, sender, e) {
        var r = rooms[roomId];
        Object.keys(r.members).forEach(function (m) {
            var p = person(m);
            if (!p || m === sender) return;
            // A read receipt, then (a person with replies) an answer.
            schedule(function () {
                push({ roomId: roomId, receipt: { eventId: e.event_id, userId: m, ts: now() } });
            }, Math.max(20, replyDelay / 2));
            if (!p.replies.length || r.encrypted) return;
            p.n = (p.n || 0) + 1;
            var text = p.replies[(p.n - 1) % p.replies.length];
            schedule(function () { event(roomId, m, "m.room.message", { msgtype: "m.text", body: text }); }, replyDelay);
        });
    }

    // ---- Sync: what a user's rooms have since a position ---------------------------------------

    function myRooms(userId) {
        return Object.keys(rooms).map(function (k) { return rooms[k]; }).filter(function (r) { return r.members[userId] !== undefined; });
    }
    function changesSince(userId, pos) {
        return stream.filter(function (s) {
            if (s.pos <= pos) return false;
            if (s.accountData) return s.accountData.userId === userId;
            return rooms[s.roomId] && rooms[s.roomId].members[userId] !== undefined;
        });
    }
    function stateOf(r) {
        return r.events.filter(function (e) { return e.state_key !== undefined; });
    }
    function wait(userId, pos, timeoutMs) {
        return new Promise(function (resolve) {
            if (changesSince(userId, pos).length || !timeoutMs) return resolve();
            var done = false;
            var t = schedule(function () { if (!done) { done = true; resolve(); } }, Math.min(timeoutMs, options.maxWaitMs || 30000));
            waiting.push(function () { if (!done) { done = true; clearTimeout(t); resolve(); } });
        });
    }
    function receiptsFor(changes) {
        var out = {};
        changes.filter(function (c) { return c.receipt; }).forEach(function (c) {
            var ev = out[c.roomId] = out[c.roomId] || { type: "m.receipt", content: {} };
            var e = ev.content[c.receipt.eventId] = ev.content[c.receipt.eventId] || { "m.read": {} };
            e["m.read"][c.receipt.userId] = { ts: c.receipt.ts };
        });
        return out;
    }
    function accountDataFor(userId) {
        var a = accountData[userId] || {};
        return Object.keys(a).map(function (t) { return { type: t, content: a[t] }; });
    }

    // MSC4186 (simplified sliding sync): every room the lists' ranges cover,
    // with its state as asked and its timeline since pos (the latest
    // timeline_limit on a first sync of it).
    function slidingSync(who, body, pos, timeoutMs) {
        var since = pos ? Number(pos) : 0;
        return wait(who.userId, since, since ? timeoutMs : 0).then(function () {
            var changes = changesSince(who.userId, since);
            var list = (body.lists && body.lists.all) || {};
            var limit = list.timeline_limit || 10;
            var out = { pos: String(seq), lists: { all: { count: myRooms(who.userId).length } }, rooms: {}, extensions: {} };
            myRooms(who.userId).forEach(function (r) {
                var initial = !since;
                var timeline = initial ? r.events.filter(function (e) { return e.state_key === undefined; }).slice(-limit)
                    : changes.filter(function (c) { return c.roomId === r.id && c.event && c.event.state_key === undefined; }).map(function (c) { return c.event; });
                var stateChanged = changes.some(function (c) { return c.roomId === r.id && c.event && c.event.state_key !== undefined; });
                if (!initial && !timeline.length && !stateChanged) return;
                var rr = { initial: initial, timeline: timeline, required_state: initial || stateChanged ? stateOf(r) : [],
                           joined_count: Object.keys(r.members).length, is_dm: !!r.direct };
                if (r.name) rr.name = r.name;
                out.rooms[r.id] = rr;
            });
            var ext = body.extensions || {};
            if (ext.account_data && ext.account_data.enabled && (!since || changes.some(function (c) { return c.accountData; })))
                out.extensions.account_data = { global: accountDataFor(who.userId) };
            if (ext.receipts && ext.receipts.enabled) {
                var rc = receiptsFor(changes);
                if (Object.keys(rc).length) out.extensions.receipts = { rooms: rc };
            }
            return out;
        });
    }
    // /v3/sync with a since token ("s<pos>").
    function v3Sync(who, since, timeoutMs) {
        var pos = since ? Number(String(since).replace(/^s/, "")) : 0;
        return wait(who.userId, pos, pos ? timeoutMs : 0).then(function () {
            var changes = changesSince(who.userId, pos);
            var out = { next_batch: "s" + seq, rooms: { join: {} }, account_data: { events: [] } };
            var rc = receiptsFor(changes);
            myRooms(who.userId).forEach(function (r) {
                var timeline = !pos ? r.events.filter(function (e) { return e.state_key === undefined; }).slice(-10)
                    : changes.filter(function (c) { return c.roomId === r.id && c.event && c.event.state_key === undefined; }).map(function (c) { return c.event; });
                var stateChanged = changes.some(function (c) { return c.roomId === r.id && c.event && c.event.state_key !== undefined; });
                if (pos && !timeline.length && !stateChanged && !rc[r.id]) return;
                out.rooms.join[r.id] = { timeline: { events: timeline, limited: false }, state: { events: !pos || stateChanged ? stateOf(r) : [] },
                                         ephemeral: { events: rc[r.id] ? [rc[r.id]] : [] }, summary: { "m.joined_member_count": Object.keys(r.members).length } };
            });
            if (!pos || changes.some(function (c) { return c.accountData; })) out.account_data.events = accountDataFor(who.userId);
            return out;
        });
    }

    // ---- HTTP ------------------------------------------------------------------------------

    function json(status, body, headers) {
        return { status: status, headers: Object.assign({ "content-type": "application/json" }, headers || {}), body: JSON.stringify(body) };
    }
    function err(status, errcode, error, extra) { return json(status, Object.assign({ errcode: errcode, error: error }, extra || {})); }
    function bodyOf(req) {
        if (req.body instanceof Uint8Array) return req.body;
        try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
    }
    function auth(req) {
        var h = (req.headers && (req.headers.Authorization || req.headers.authorization)) || "";
        var m = /^Bearer (.+)$/.exec(h);
        if (m && !tokens[m[1]] && options.acceptAny) {
            // The demo server runs again in each page of the simulator: its tokens say whose they are.
            var d = /^syt_demo_([A-Za-z0-9_-]+)_([A-Z0-9]+)$/.exec(m[1]);
            if (d) {
                tokens[m[1]] = { userId: decodeURIComponent(escape(atob(d[1].replace(/-/g, "+").replace(/_/g, "/")))), deviceId: d[2] };
                welcome(tokens[m[1]].userId);
            }
        }
        return m && tokens[m[1]] ? tokens[m[1]] : null;
    }
    function issue(userId, deviceId) {
        var t = "syt_" + Math.random().toString(36).slice(2) + (++seq).toString(36);
        if (options.acceptAny) {
            deviceId = deviceId || "PHX" + (++seq).toString(36).toUpperCase();
            t = "syt_demo_" + btoa(unescape(encodeURIComponent(userId))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") + "_" + deviceId;
        }
        tokens[t] = { userId: userId, deviceId: deviceId || "PHX" + (++seq).toString(36).toUpperCase() };
        welcome(userId);
        return t;
    }

    function handle(req) {
        count++;
        var u = new URL(req.url);
        var path = u.pathname, method = req.method || "GET", qs = u.searchParams;
        if (slowDown) return Promise.resolve(err(429, "M_LIMIT_EXCEEDED", "Too many requests", { retry_after_ms: slowDown * 1000 }))
            .then(function (r) { r.headers["retry-after"] = String(slowDown); return r; });
        if (path === "/.well-known/matrix/client") return Promise.resolve(json(200, { "m.homeserver": { base_url: base } }));
        if (path === "/_matrix/client/versions")
            return Promise.resolve(json(200, { versions: ["v1.11", "v1.12"], unstable_features: options.slidingSync === false ? {} : { "org.matrix.simplified_msc3575": true } }));
        if (path === "/_matrix/client/v3/login" && method === "GET") {
            var flows = [{ type: "m.login.password" }];
            if (options.oauth) flows = [{ type: "m.login.sso" }];
            return Promise.resolve(json(200, { flows: flows }));
        }
        if (path === "/_matrix/client/v3/login" && method === "POST") {
            var b = bodyOf(req);
            var user = String((b.identifier && b.identifier.user) || b.user || "").replace(/^@/, "").split(":")[0];
            if (options.oauth) return Promise.resolve(err(400, "M_UNRECOGNIZED", "Use the OAuth sign-in"));
            // The demo server: any name with any password.
            if (options.acceptAny && user && b.password && users[user] === undefined) users[user] = b.password;
            if (b.type !== "m.login.password" || users[user] === undefined || users[user] !== b.password || refuse)
                return Promise.resolve(err(403, "M_FORBIDDEN", "Invalid username or password"));
            var t = issue(uid(user), b.device_id);
            return Promise.resolve(json(200, { access_token: t, device_id: tokens[t].deviceId, user_id: uid(user), home_server: serverName }));
        }
        if (options.oauth && (path === "/_matrix/client/v1/auth_metadata" || path === "/_matrix/client/unstable/org.matrix.msc2965/auth_metadata"))
            return Promise.resolve(json(200, { issuer: base + "/", authorization_endpoint: base + "/oauth2/authorize", token_endpoint: base + "/oauth2/token",
                                               registration_endpoint: base + "/oauth2/registration", revocation_endpoint: base + "/oauth2/revoke",
                                               code_challenge_methods_supported: ["S256"], response_types_supported: ["code"] }));
        if (options.oauth && path === "/oauth2/registration" && method === "POST") {
            var reg = bodyOf(req), cid = "client" + (++seq);
            oauthClients[cid] = reg;
            return Promise.resolve(json(201, { client_id: cid, redirect_uris: reg.redirect_uris }));
        }
        if (options.oauth && path === "/oauth2/authorize" && method === "GET") {
            var pend = "p" + (++seq);
            oauthPending[pend] = { clientId: qs.get("client_id"), redirect: qs.get("redirect_uri"), state: qs.get("state"), scope: qs.get("scope"),
                                   challenge: qs.get("code_challenge") };
            return Promise.resolve({ status: 200, headers: { "content-type": "text/html" },
                body: "<form method=post action=\"/oauth2/authorize\"><input name=\"pending\" value=\"" + pend + "\"><input name=\"user\" value=\"me\">" +
                      "<button id=\"authorize\">Continue</button></form>" });
        }
        if (options.oauth && path === "/oauth2/authorize" && method === "POST") {
            var f = new URLSearchParams(String(req.body || "")), pd = oauthPending[f.get("pending")];
            if (!pd) return Promise.resolve(err(400, "M_UNKNOWN", "no such request"));
            var code = "code" + (++seq);
            oauthCodes[code] = { user: f.get("user"), pending: pd };
            return Promise.resolve({ status: 302, headers: { location: pd.redirect + "?code=" + code + "&state=" + encodeURIComponent(pd.state) }, body: "" });
        }
        if (options.oauth && path === "/oauth2/token" && method === "POST") {
            var tf = new URLSearchParams(String(req.body || "")), c = oauthCodes[tf.get("code")];
            if (tf.get("grant_type") !== "authorization_code" || !c) return Promise.resolve(json(400, { error: "invalid_grant" }));
            delete oauthCodes[tf.get("code")];
            var dev = (/urn:matrix:(?:client|org\.matrix\.msc2967\.client):device:(\S+)/.exec(c.pending.scope || "") || [])[1];
            var at = issue(uid(c.user), dev);
            return Promise.resolve(json(200, { access_token: at, token_type: "Bearer", expires_in: 3600, refresh_token: "r" + at, scope: c.pending.scope }));
        }
        if (/^\/_matrix\/media\/v3\/download\/|^\/_matrix\/client\/v1\/media\/download\//.test(path) && method === "GET") {
            var authed = /\/v1\/media\//.test(path);
            if (authed && !auth(req)) return Promise.resolve(err(401, "M_MISSING_TOKEN", "Missing token"));
            var mid = decodeURIComponent(path.split("/").pop());
            var mm = media[mid];
            if (!mm) return Promise.resolve(err(404, "M_NOT_FOUND", "No such media"));
            return Promise.resolve(req.binary ? { status: 200, headers: { "content-type": mm.type }, bytes: mm.bytes }
                                              : { status: 200, headers: { "content-type": mm.type }, body: "" });
        }
        var who = auth(req);
        if (!who || refuse) return Promise.resolve(err(401, "M_UNKNOWN_TOKEN", "Unknown access token", { soft_logout: false }));
        var m;
        if (path === "/_matrix/client/v3/account/whoami") return Promise.resolve(json(200, { user_id: who.userId, device_id: who.deviceId }));
        if (path === "/_matrix/client/v3/logout" && method === "POST") {
            Object.keys(tokens).forEach(function (k) { if (tokens[k] === who) delete tokens[k]; });
            return Promise.resolve(json(200, {}));
        }
        if ((m = /^\/_matrix\/client\/v3\/profile\/([^/]+)$/.exec(path))) {
            var pid = decodeURIComponent(m[1]);
            return Promise.resolve(json(200, { displayname: nameOf(pid) }));
        }
        if (path === "/_matrix/client/unstable/org.matrix.simplified_msc3575/sync" && method === "POST") {
            if (options.slidingSync === false) return Promise.resolve(err(404, "M_UNRECOGNIZED", "Unrecognized request"));
            return slidingSync(who, bodyOf(req), qs.get("pos"), Number(qs.get("timeout") || 0)).then(function (r) { return json(200, r); });
        }
        if (path === "/_matrix/client/v3/sync") return v3Sync(who, qs.get("since"), Number(qs.get("timeout") || 0)).then(function (r) { return json(200, r); });
        if ((m = /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/send\/([^/]+)\/([^/]+)$/.exec(path)) && method === "PUT") {
            var roomId = decodeURIComponent(m[1]), type = decodeURIComponent(m[2]), txn = decodeURIComponent(m[3]);
            var r = rooms[roomId];
            if (!r || r.members[who.userId] === undefined) return Promise.resolve(err(403, "M_FORBIDDEN", "Not in the room"));
            var key = who.userId + "|" + txn;
            if (txns[key]) return Promise.resolve(json(200, { event_id: txns[key] }));
            var e = event(roomId, who.userId, type, bodyOf(req), { unsigned: { transaction_id: txn } });
            txns[key] = e.event_id;
            answer(roomId, who.userId, e);
            return Promise.resolve(json(200, { event_id: e.event_id }));
        }
        if ((m = /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/receipt\/m\.read\/([^/]+)$/.exec(path)) && method === "POST") {
            push({ roomId: decodeURIComponent(m[1]), receipt: { eventId: decodeURIComponent(m[2]), userId: who.userId, ts: now() } });
            return Promise.resolve(json(200, {}));
        }
        if ((m = /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/typing\/([^/]+)$/.exec(path)) && method === "PUT") return Promise.resolve(json(200, {}));
        if (path === "/_matrix/client/v3/createRoom" && method === "POST") {
            var cb = bodyOf(req), members = {};
            members[who.userId] = nameOf(who.userId);
            (cb.invite || []).forEach(function (i) { members[i] = nameOf(i); });
            var nr = room("!new" + (++seq).toString(36) + ":" + serverName, cb.name || "", members, { direct: !!cb.is_direct });
            return Promise.resolve(json(200, { room_id: nr.id }));
        }
        if ((m = /^\/_matrix\/client\/v3\/user\/([^/]+)\/account_data\/([^/]+)$/.exec(path))) {
            var auid = decodeURIComponent(m[1]), atype = decodeURIComponent(m[2]);
            if (auid !== who.userId) return Promise.resolve(err(403, "M_FORBIDDEN", "Not yours"));
            if (method === "PUT") {
                (accountData[auid] = accountData[auid] || {})[atype] = bodyOf(req);
                push({ accountData: { userId: auid, type: atype } });
                return Promise.resolve(json(200, {}));
            }
            var ad = (accountData[auid] || {})[atype];
            return Promise.resolve(ad ? json(200, ad) : err(404, "M_NOT_FOUND", "No account data"));
        }
        if (path === "/_matrix/media/v3/upload" && method === "POST") {
            var bytes = req.body instanceof Uint8Array ? req.body : new TextEncoder().encode(String(req.body || ""));
            var id2 = "u" + (++seq).toString(36);
            media[id2] = { bytes: bytes, type: (req.headers && (req.headers["Content-Type"] || req.headers["content-type"])) || "application/octet-stream",
                           name: qs.get("filename") || id2 };
            return Promise.resolve(json(200, { content_uri: "mxc://" + serverName + "/" + id2 }));
        }
        return Promise.resolve(err(404, "M_UNRECOGNIZED", "Unrecognized request: " + method + " " + path));
    }

    var server = null;
    var api = {
        serverName: serverName, base: base,
        request: handle,
        // A real HTTP server on this computer (the simulator's demo, Chromium tests).
        start: function (port) {
            return new Promise(function (resolve) {
                server = require("http").createServer(function (req, res) {
                    var chunks = [];
                    req.on("data", function (c) { chunks.push(c); });
                    req.on("end", function () {
                        var buf = Buffer.concat(chunks);
                        var type = req.headers["content-type"] || "";
                        var body = /json|x-www-form-urlencoded|text/.test(type) || !buf.length ? buf.toString("utf8") : new Uint8Array(buf);
                        handle({ method: req.method, url: base + req.url, headers: req.headers, body: body, binary: true }).then(function (r) {
                            var h = Object.assign({ "access-control-allow-origin": "*" }, r.headers);
                            res.writeHead(r.status, h);
                            res.end(r.bytes ? Buffer.from(r.bytes) : r.body || "");
                        });
                    });
                });
                server.listen(port || 0, "127.0.0.1", function () {
                    base = "http://127.0.0.1:" + server.address().port;
                    api.base = base;
                    resolve(api);
                });
            });
        },
        say: say,
        // For the simulator's demo, as the XMPP fake has them: who is signed in, and a message to them
        // ({picture: true}: the last picture uploaded, sent back).
        signedIn: function () { var t = Object.keys(tokens)[0]; return t ? tokens[t].userId : null; },
        deliver: function (from, user, text, o) {
            if (o && o.picture) {
                var ids = Object.keys(media).filter(function (k) { return /^u/.test(k); });
                var m = media[ids[ids.length - 1]];
                if (!m) return null;
                return say(from, user, "", { image: { bytes: m.bytes, type: m.type, name: m.name } });
            }
            return say(from, user, text);
        },
        // Someone the user has no room with yet invites them to a direct chat.
        addPerson: function (p) { people.push(Object.assign({ replies: [] }, p)); },
        rooms: function () { return Object.keys(rooms).map(function (k) { var r = rooms[k]; return { id: r.id, name: r.name, members: Object.keys(r.members), direct: r.direct, encrypted: r.encrypted }; }); },
        events: function (roomId) { return (rooms[roomId] || { events: [] }).events.slice(); },
        media: function (mxc) { return media[String(mxc).split("/").pop()] || null; },
        receiptsBy: function (userId) { return stream.filter(function (s) { return s.receipt && s.receipt.userId === userId; }).map(function (s) { return s.receipt; }); },
        tokens: function () { return Object.keys(tokens).map(function (k) { return tokens[k]; }); },
        oauthClients: function () { return oauthClients; },
        unauthorized: function (on) { refuse = !!on; },
        throttle: function (seconds) { slowDown = seconds; },
        requests: function () { return count; },
        close: function () {
            waiting.splice(0).forEach(function (f) { f(); });
            return server ? new Promise(function (r) { server.close(function () { r(); }); }) : Promise.resolve();
        }
    };
    return api;
}

// The simulator's demo homeserver: matrix.example and its people (fictional).
function demoHomeserver(o) {
    return createFakeHomeserver(Object.assign({
        serverName: "matrix.example", acceptAny: true,
        people: [
            { userId: "@sam.delgado:matrix.example", displayname: "Sam Delgado", greeting: "Welcome to Matrix on Phoenix!",
              replies: ["Nice, it works.", "Rooms as conversations, love it."] },
            { userId: "@priya:matrix.example", displayname: "Priya Nair", encrypted: true, greeting: "(encrypted)" }
        ],
        groups: [{ name: "Phoenix Testers", members: ["@sam.delgado:matrix.example", "@priya:matrix.example"],
                   messages: [["@sam.delgado:matrix.example", "Build 42 boots on the Pre 3."], ["@priya:matrix.example", "Cards are back!"]] }]
    }, o || {}));
}

module.exports = { createFakeHomeserver: createFakeHomeserver, demoHomeserver: demoHomeserver };
