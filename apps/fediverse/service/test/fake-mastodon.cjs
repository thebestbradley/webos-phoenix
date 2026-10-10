// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A small Mastodon server for the Fediverse account's tests, without the
// internet: the connector's unit and conformance tests call handle()
// directly (request()), tools/test-fediverse.cjs runs it on 127.0.0.1
// (start()). It answers what the connector uses, as the API documents it:
//
//   WebFinger         https://docs.joinmastodon.org/spec/webfinger/
//   NodeInfo          https://github.com/jhass/nodeinfo/blob/main/PROTOCOL.md
//                     (Mastodon serves 2.0 at /nodeinfo/2.0)
//   OAuth metadata    RFC 8414; https://docs.joinmastodon.org/methods/oauth/#authorization-server-metadata
//   POST /api/v1/apps https://docs.joinmastodon.org/methods/apps/#create
//   /oauth/authorize, /oauth/token, /oauth/revoke
//                     https://docs.joinmastodon.org/methods/oauth/ (PKCE S256,
//                     RFC 7636: the verifier is checked against the challenge)
//   verify_credentials, following, account statuses
//                     https://docs.joinmastodon.org/methods/accounts/
//   notifications     https://docs.joinmastodon.org/methods/notifications/#get
//   POST /api/v1/statuses  https://docs.joinmastodon.org/methods/statuses/#create
//                     (Idempotency-Key: the same key, the same status)
//   POST /api/v2/media, GET /api/v1/media/:id
//                     https://docs.joinmastodon.org/methods/media/
//   paging            Link headers, https://docs.joinmastodon.org/api/guidelines/#pagination
//   entities          Account, Status, Notification, MediaAttachment, Application
//                     (https://docs.joinmastodon.org/entities/), with the fields used
//
// and for the tests (not Mastodon's): POST /__test/mention {from, text,
// visibility}, POST /__test/notify {type: "follow" | "reblog" | "favourite",
// from}, GET /__test/state, and in code unauthorized(on), throttle(seconds).
// Its people are fictional; Sofia Lindqvist shares her name with a contact
// of the simulator's sample address book, so the linker joins them.

"use strict";

const http = require("http");
const crypto = require("crypto");
const zlib = require("zlib");

// A plain square PNG (an avatar), the colour its own.
function png(size, rgb) {
    const table = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
    };
    const raw = Buffer.alloc((size * 3 + 1) * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const edge = Math.hypot(x - size / 2, y - size / 2) < size * 0.32;
        raw.set(edge ? [255, 255, 255] : rgb, y * (size * 3 + 1) + 1 + x * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

function parseQuery(q) {
    const out = {};
    new URLSearchParams(q || "").forEach((v, k) => {
        if (k.endsWith("[]")) (out[k] = out[k] || []).push(v);
        else out[k] = v;
    });
    return out;
}

function parseBody(req) {
    const type = String((req.headers || {})["content-type"] || (req.headers || {})["Content-Type"] || "");
    const raw = req.body === undefined || req.body === null ? Buffer.alloc(0) : Buffer.from(req.body);
    if (/multipart\/form-data/.test(type)) {
        const boundary = /boundary=([^;]+)/.exec(type)[1];
        const out = {}, sep = Buffer.from("--" + boundary);
        let pos = raw.indexOf(sep);
        while (pos >= 0) {
            const next = raw.indexOf(sep, pos + sep.length);
            if (next < 0) break;
            const part = raw.subarray(pos + sep.length + 2, next - 2);
            const headEnd = part.indexOf("\r\n\r\n");
            const head = part.subarray(0, headEnd).toString("utf8");
            const data = part.subarray(headEnd + 4);
            const name = /name="([^"]+)"/.exec(head)[1];
            const file = /filename="([^"]*)"/.exec(head);
            out[name] = file ? { filename: file[1], type: (/Content-Type: (\S+)/i.exec(head) || [])[1] || "", data: Buffer.from(data) } : data.toString("utf8");
            pos = next;
        }
        return out;
    }
    const text = raw.toString("utf8");
    if (/json/.test(type)) { try { return JSON.parse(text || "{}"); } catch (e) { return {}; } }
    return parseQuery(text);
}

function createFakeMastodon(options) {
    options = options || {};
    let base = options.base || "http://127.0.0.1:0";
    let domain = new URL(base).host;
    let count = 0, unauthorized = false, retryAfter = 0, nextId = 100000;
    const apps = {}, codes = {}, tokens = {}, statuses = [], media = {}, idempotent = {}, notifications = [], revoked = [];
    const id = () => String(++nextId);

    function account(o) {
        return Object.assign({
            locked: false, bot: false, discoverable: true, group: false, created_at: "2023-01-01T00:00:00.000Z",
            note: "<p></p>", followers_count: 10, following_count: 10, statuses_count: 5, emojis: [], fields: []
        }, o);
    }
    const me = () => account({ id: "1", username: "phoenix", acct: "phoenix", display_name: "Phoenix Tester", url: base + "/@phoenix",
                               avatar: base + "/avatars/phoenix.png", avatar_static: base + "/avatars/phoenix.png", last_status_at: null });
    // The accounts you follow (their addresses on the server's current base).
    const persons = () => ({
        sofia: account({ id: "11", username: "sofia", acct: "sofia@fedi.example", display_name: "Sofia Lindqvist", url: "https://fedi.example/@sofia",
                         avatar: base + "/avatars/sofia.png", avatar_static: base + "/avatars/sofia.png", last_status_at: "2026-10-09",
                         note: "<p>Research fellow. Cards forever.</p>",
                         fields: [{ name: "Website", value: "<a href=\"https://sofia.example/\" rel=\"me nofollow noopener\" target=\"_blank\">sofia.example</a>",
                                    verified_at: "2026-01-01T00:00:00.000Z" }] }),
        juniper: account({ id: "12", username: "juniper", acct: "juniper@pixels.example", display_name: "Juniper Bloom :blobcat:",
                           url: "https://pixels.example/@juniper", avatar: base + "/avatars/juniper.png", avatar_static: base + "/avatars/juniper.png",
                           last_status_at: "2026-10-08" }),
        theo: account({ id: "13", username: "theo", acct: "theo", display_name: "", url: base + "/@theo",
                        avatar: base + "/avatars/theo.png", avatar_static: base + "/avatars/theo.png", last_status_at: null })
    });
    const avatars = { phoenix: [200, 60, 40], sofia: [70, 130, 180], juniper: [90, 160, 90], theo: [150, 110, 170] };
    let followed = ["sofia", "juniper", "theo"];
    const latest = {
        "11": { id: "501", created_at: "2026-10-09T08:30:00.000Z", content: "<p>Flashed Phoenix on my old Pre 3 today. It <em>boots</em>!</p>" },
        "12": { id: "502", created_at: "2026-10-08T19:00:00.000Z", content: "<p>New album: autumn light <a href=\"https://pixels.example/tags/photo\" class=\"mention hashtag\">#<span>photo</span></a></p>" }
    };

    function status(o) {
        return Object.assign({ id: id(), created_at: new Date().toISOString(), in_reply_to_id: null, sensitive: false, spoiler_text: "",
                               visibility: "public", language: "en", uri: base + "/statuses/" + nextId, url: base + "/@phoenix/" + nextId,
                               replies_count: 0, reblogs_count: 0, favourites_count: 0, content: "", reblog: null, media_attachments: [],
                               mentions: [], tags: [], emojis: [], account: me() }, o);
    }

    function notify(type, from, st) {
        notifications.unshift({ id: id(), type, created_at: new Date().toISOString(), account: persons()[from] || persons().sofia, status: st || null });
    }

    function json(status, body, headers) {
        return { status, headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, headers || {}), body: JSON.stringify(body) };
    }
    function bearer(req) {
        const h = String((req.headers || {}).authorization || (req.headers || {}).Authorization || "");
        const m = /^Bearer (.+)$/.exec(h);
        return m && tokens[m[1]] && !tokens[m[1]].revoked ? tokens[m[1]] : null;
    }
    function page(list, query, path) {
        const limit = Math.min(Number(query.limit) || 40, 80);
        let items = list;
        if (query.since_id) items = items.filter((x) => BigInt(x.id) > BigInt(query.since_id));
        if (query.max_id) items = items.filter((x) => BigInt(x.id) < BigInt(query.max_id));
        const out = items.slice(0, limit);
        const headers = {};
        if (items.length > limit) {
            const q = new URLSearchParams(Object.assign({}, query, { max_id: out[out.length - 1].id }));
            headers.link = "<" + base + path + "?" + q.toString().replace(/%5B%5D/g, "[]") + ">; rel=\"next\"";
        }
        return json(200, out, headers);
    }

    function authorizePage(q, error) {
        return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: [
            "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">",
            "<title>Authorize - Fake Mastodon</title><style>body{font-family:sans-serif;background:#191b22;color:#fff;margin:0;padding:24px}",
            "h1{font-size:20px}.app{background:#282c37;border-radius:8px;padding:12px;margin:12px 0}button{font-size:16px;padding:10px 18px;",
            "border-radius:6px;border:0;margin-right:8px}#authorize{background:#6364ff;color:#fff}</style></head><body>",
            "<h1>Authorization required</h1>", error ? "<p class=\"error\">" + esc(error) + "</p>" : "",
            "<div class=\"app\"><b>" + esc((apps[q.client_id] || {}).name || "?") + "</b> would like to access your account <b>@phoenix@" + esc(domain) + "</b>.",
            "<p>Scopes: " + esc(q.scope || "read") + "</p></div>",
            "<form method=\"post\" action=\"/oauth/authorize\">",
            ["client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method", "response_type"].map((k) =>
                "<input type=\"hidden\" name=\"" + k + "\" value=\"" + esc(q[k] || "") + "\">").join(""),
            "<button id=\"authorize\" name=\"decision\" value=\"allow\" type=\"submit\">Authorize</button>",
            "<button id=\"deny\" name=\"decision\" value=\"deny\" type=\"submit\">Deny</button></form></body></html>"].join("") };
    }

    function handle(req) {
        count++;
        const u = new URL(req.url, base);
        const path = u.pathname, q = parseQuery(u.search.slice(1)), method = req.method || "GET";
        if (path.indexOf("/__test/") === 0) return testRoute(method, path, parseBody(req));
        if (retryAfter) return json(429, { error: "Too many requests" }, { "retry-after": String(retryAfter) });
        if (path.indexOf("/avatars/") === 0) {
            const who = path.slice(9).replace(/\.png$/, "");
            return avatars[who] ? { status: 200, headers: { "content-type": "image/png" }, body: png(96, avatars[who]) } : json(404, { error: "Not found" });
        }
        if (path === "/.well-known/webfinger") {
            const m = /^acct:([^@]+)@(.+)$/.exec(q.resource || "");
            if (!m || m[2] !== domain || m[1] !== "phoenix") return json(404, { error: "Not found" });
            return json(200, { subject: "acct:phoenix@" + domain, aliases: [base + "/@phoenix", base + "/users/phoenix"],
                               links: [{ rel: "http://webfinger.net/rel/profile-page", type: "text/html", href: base + "/@phoenix" },
                                       { rel: "self", type: "application/activity+json", href: base + "/users/phoenix" }] },
                        { "content-type": "application/jrd+json; charset=utf-8" });
        }
        // The account's public posts as RSS (Mastodon serves https://server/@user.rss),
        // which the connector kit's hello-world FEEDS connector reads.
        if (path === "/@phoenix.rss") {
            const items = statuses.filter((st) => st.visibility === "public" || st.visibility === "unlisted").slice().reverse().map((st) =>
                "<item><guid isPermaLink=\"true\">" + esc(st.url) + "</guid><link>" + esc(st.url) + "</link><pubDate>" + new Date(st.created_at).toUTCString() +
                "</pubDate><description>" + esc(st.content) + "</description></item>").join("");
            return { status: 200, headers: { "content-type": "application/rss+xml; charset=utf-8" }, body:
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?><rss version=\"2.0\"><channel><title>Phoenix Tester</title><link>" + base + "/@phoenix</link>" +
                "<description>Public posts from @phoenix@" + esc(domain) + "</description>" + items + "</channel></rss>" };
        }
        if (path === "/.well-known/nodeinfo")
            return json(200, { links: [{ rel: "http://nodeinfo.diaspora.software/ns/schema/2.0", href: base + "/nodeinfo/2.0" }] });
        if (path === "/nodeinfo/2.0")
            return json(200, { version: "2.0", software: { name: "mastodon", version: "4.3.0" }, protocols: ["activitypub"],
                               services: { outbound: [], inbound: [] }, usage: { users: { total: 4 }, localPosts: statuses.length },
                               openRegistrations: false, metadata: {} });
        if (path === "/.well-known/oauth-authorization-server")
            return json(200, { issuer: base + "/", authorization_endpoint: base + "/oauth/authorize", token_endpoint: base + "/oauth/token",
                               revocation_endpoint: base + "/oauth/revoke", scopes_supported: ["read", "write", "read:accounts", "read:follows",
                               "read:notifications", "read:statuses", "write:statuses", "write:media"], response_types_supported: ["code"],
                               grant_types_supported: ["authorization_code", "client_credentials"], code_challenge_methods_supported: ["S256"],
                               token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"] });
        if (path === "/api/v1/apps" && method === "POST") {
            const b = parseBody(req);
            if (!b.client_name || !b.redirect_uris) return json(422, { error: "Validation failed: client_name and redirect_uris are required" });
            const app = { id: id(), name: b.client_name, website: b.website || null, scopes: String(b.scopes || "read").split(" "),
                          redirect_uris: [].concat(b.redirect_uris), redirect_uri: [].concat(b.redirect_uris).join("\n"),
                          client_id: b64url(crypto.randomBytes(24)), client_secret: b64url(crypto.randomBytes(24)), vapid_key: "BFake=" };
            apps[app.client_id] = app;
            return json(200, app);
        }
        if (path === "/oauth/authorize" && method === "GET") {
            const app = apps[q.client_id];
            if (!app) return { status: 400, headers: { "content-type": "text/html" }, body: "<p>Client authentication failed: unknown client</p>" };
            if (app.redirect_uris.indexOf(q.redirect_uri) < 0) return { status: 400, headers: { "content-type": "text/html" }, body: "<p>The redirect uri included is not valid.</p>" };
            if (q.code_challenge_method !== "S256" || !q.code_challenge) return authorizePage(q, "PKCE with S256 is required by this test server");
            return authorizePage(q);
        }
        if (path === "/oauth/authorize" && method === "POST") {
            const b = parseBody(req);
            const app = apps[b.client_id];
            if (!app || app.redirect_uris.indexOf(b.redirect_uri) < 0) return json(400, { error: "invalid_client" });
            const sep = b.redirect_uri.indexOf("?") < 0 ? "?" : "&";
            if (b.decision !== "allow")
                return { status: 302, headers: { location: b.redirect_uri + sep + "error=access_denied&state=" + encodeURIComponent(b.state || "") }, body: "" };
            const code = b64url(crypto.randomBytes(16));
            codes[code] = { clientId: b.client_id, redirectUri: b.redirect_uri, challenge: b.code_challenge, scope: b.scope };
            return { status: 302, headers: { location: b.redirect_uri + sep + "code=" + code + "&state=" + encodeURIComponent(b.state || "") }, body: "" };
        }
        if (path === "/oauth/token" && method === "POST") {
            const b = parseBody(req);
            const c = codes[b.code];
            const app = apps[b.client_id];
            if (!app || app.client_secret !== b.client_secret) return json(401, { error: "invalid_client" });
            if (b.grant_type !== "authorization_code" || !c || c.clientId !== b.client_id || c.redirectUri !== b.redirect_uri)
                return json(400, { error: "invalid_grant" });
            const challenge = b64url(crypto.createHash("sha256").update(String(b.code_verifier || "")).digest());
            if (challenge !== c.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE verification failed" });
            delete codes[b.code];
            const token = b64url(crypto.randomBytes(32));
            tokens[token] = { clientId: b.client_id, scope: c.scope };
            return json(200, { access_token: token, token_type: "Bearer", scope: c.scope, created_at: Math.floor(Date.now() / 1000) });
        }
        if (path === "/oauth/revoke" && method === "POST") {
            const b = parseBody(req);
            if (tokens[b.token]) { tokens[b.token].revoked = true; revoked.push(b.token); }
            return json(200, {});
        }
        // The API: a token, and no 401 switch.
        if (path.indexOf("/api/") === 0) {
            if (unauthorized || !bearer(req)) return json(401, { error: "The access token is invalid" });
        }
        if (path === "/api/v1/accounts/verify_credentials") return json(200, Object.assign(me(), { source: { privacy: "public", note: "" } }));
        let m = /^\/api\/v1\/accounts\/(\w+)\/following$/.exec(path);
        if (m) return m[1] === "1" ? page(followed.map((k) => persons()[k]).sort((a, b) => Number(b.id) - Number(a.id)), q, path) : json(200, []);
        m = /^\/api\/v1\/accounts\/(\w+)\/statuses$/.exec(path);
        if (m) {
            const l = latest[m[1]];
            const who = Object.keys(persons()).filter((k) => persons()[k].id === m[1])[0];
            return json(200, l && who ? [status(Object.assign({}, l, { account: persons()[who], url: persons()[who].url + "/" + l.id }))] : []);
        }
        if (path === "/api/v1/notifications") {
            const types = q["types[]"];
            const list = notifications.filter((n) => !types || types.indexOf(n.type) >= 0);
            return page(list, q, path);
        }
        if (path === "/api/v1/statuses" && method === "POST") {
            const key = (req.headers || {})["Idempotency-Key"] || (req.headers || {})["idempotency-key"];
            if (key && idempotent[key]) return json(200, idempotent[key]);
            const b = parseBody(req);
            const ids = [].concat(b.media_ids || b["media_ids[]"] || []);
            if (!b.status && !ids.length) return json(422, { error: "Validation failed: Text can't be blank" });
            const st = status({ content: "<p>" + esc(b.status || "") + "</p>", text: b.status || "", visibility: b.visibility || "public",
                                in_reply_to_id: b.in_reply_to_id || null, spoiler_text: b.spoiler_text || "",
                                media_attachments: ids.map((i) => media[i]).filter(Boolean) });
            statuses.push(st);
            if (key) idempotent[key] = st;
            return json(200, st);
        }
        if (path === "/api/v2/media" && method === "POST") {
            const b = parseBody(req);
            if (!b.file || !b.file.data || !b.file.data.length) return json(422, { error: "Validation failed: File can't be blank" });
            const mid = id();
            media[mid] = { id: mid, type: /^image\//.test(b.file.type) ? "image" : "unknown", url: base + "/media/" + mid, preview_url: base + "/media/" + mid,
                           description: b.description || null, meta: {}, bytes: b.file.data.length, filename: b.file.filename, mimeType: b.file.type };
            return json(200, media[mid]);
        }
        m = /^\/api\/v1\/media\/(\w+)$/.exec(path);
        if (m) return media[m[1]] ? json(200, media[m[1]]) : json(404, { error: "Record not found" });
        return json(404, { error: "Not found: " + method + " " + path });
    }

    function testRoute(method, path, b) {
        if (path === "/__test/mention") {
            const from = persons()[b.from] || persons().sofia;
            const st = status({ account: from, visibility: b.visibility || "direct", url: from.url + "/" + nextId,
                                content: "<p><span class=\"h-card\"><a href=\"" + base + "/@phoenix\" class=\"u-url mention\">@<span>phoenix</span></a></span> " +
                                         esc(b.text || "Hello from the Fediverse") + "</p>",
                                mentions: [{ id: "1", username: "phoenix", acct: "phoenix", url: base + "/@phoenix" }] });
            notify("mention", b.from, st);
            return json(200, { notification: notifications[0] });
        }
        if (path === "/__test/notify") {
            const mine = statuses[statuses.length - 1] || status({ content: "<p>Hello, Fediverse!</p>" });
            notify(b.type || "follow", b.from || "juniper", b.type === "follow" ? null : mine);
            return json(200, { notification: notifications[0] });
        }
        if (path === "/__test/state")
            return json(200, { statuses, media: Object.keys(media).map((k) => Object.assign({}, media[k])), apps: Object.keys(apps).length,
                               tokens: Object.keys(tokens).length, revoked: revoked.length, requests: count });
        return json(404, { error: "no such test route" });
    }

    const api = {
        get base() { return base; },
        get domain() { return domain; },
        handle: (req) => Promise.resolve(handle(req)),
        // The kit's request(): the body as text, a binary answer as bytes.
        request: (req) => Promise.resolve(handle(req)).then((r) => {
            const body = Buffer.isBuffer(r.body) ? r.body : Buffer.from(String(r.body || ""), "utf8");
            return req.binary ? { status: r.status, headers: r.headers, bytes: new Uint8Array(body) }
                              : { status: r.status, headers: r.headers, body: body.toString("utf8") };
        }),
        requests: () => count,
        unauthorized: (on) => { unauthorized = !!on; },
        throttle: (s) => { retryAfter = s; },
        mention: (from, text, visibility) => testRoute("POST", "/__test/mention", { from, text, visibility }),
        notifyOf: (type, from) => testRoute("POST", "/__test/notify", { type, from }),
        follow: (who) => { if (followed.indexOf(who) < 0) followed.push(who); },
        unfollow: (who) => { followed = followed.filter((x) => x !== who); },
        statuses, media, tokens, revoked, apps,
        setBase: (b) => { base = b; domain = new URL(base).host; },
        // A token as if a sign-in had given it (the unit tests' OAuth service).
        issueToken: () => { const t = b64url(crypto.randomBytes(32)); tokens[t] = { clientId: "test", scope: "read" }; return t; },
        start: (port) => new Promise((resolve) => {
            const server = http.createServer((req, res) => {
                const chunks = [];
                req.on("data", (c) => chunks.push(c));
                req.on("end", () => {
                    Promise.resolve(handle({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) })).then((r) => {
                        res.writeHead(r.status, r.headers);
                        res.end(r.body);
                    });
                });
            });
            server.listen(port || 0, "127.0.0.1", () => {
                api.setBase("http://127.0.0.1:" + server.address().port);
                api.close = () => new Promise((r) => server.close(() => r()));
                resolve(api);
            });
        })
    };
    if (options.base) api.setBase(options.base);
    return api;
}

module.exports = { createFakeMastodon, png };

// node apps/fediverse/service/test/fake-mastodon.cjs [port]: the server alone
// (for the simulator by hand: sign in as @phoenix@127.0.0.1:<port>).
if (require.main === module) {
    createFakeMastodon().start(Number(process.argv[2]) || 0).then((s) => {
        console.log("Fake Mastodon at " + s.base + " (handle @phoenix@" + s.domain + ")");
    });
}
