// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for the AT Protocol services the Bluesky connector reaches
// (apps/connectors/bluesky), as documented (https://atproto.com/specs,
// https://docs.bsky.app/docs/api/), on the fake's server under /bsky:
//
//   identity  /bsky/xrpc/com.atproto.identity.resolveHandle (a resolver),
//             /bsky/plc/<did> (a PLC directory: the DID document naming the
//             PDS), /bsky/well-known/<handle> (a handle's
//             /.well-known/atproto-did)
//   PDS       /bsky/pds/xrpc/...: createSession and refreshSession (app
//             passwords: an account password is refused with
//             AuthFactorTokenRequired), getProfile, getFollows (cursor
//             paging), listNotifications, createRecord (record keys: a
//             second record of one key is refused), uploadBlob; chat.bsky.*
//             only with the atproto-proxy header naming the chat service,
//             and only for an app password allowed direct messages
//   OAuth     /bsky/pds/.well-known/oauth-protected-resource, the
//             authorization server's metadata, PAR (RFC 9126), the
//             authorize page, the token endpoint; every DPoP proof's
//             signature, htm, htu, nonce and ath checked (RFC 9449), with
//             use_dpop_nonce asked for once; tokens bound to their key
//
// fake.bluesky: {handle, did, appPassword, chatlessPassword, accountPassword,
// follows, notifications, convos, posts, blobs, clients()}

"use strict";

const crypto = require("crypto");

function b64urlDecode(s) { return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64"); }

function addBluesky(base) {
    const send = base.send, b64url = base.b64url;
    const now = () => new Date().toISOString();
    const bs = base.bluesky = {
        handle: "anna.test", did: "did:plc:annaannaannaannaanna1234",
        appPassword: "abcd-efgh-ijkl-mnop", chatlessPassword: "zzzz-yyyy-xxxx-wwww", accountPassword: "correct horse battery staple",
        follows: [], notifications: [], convos: [], posts: [], blobs: [], sessions: new Map(), refreshes: new Map(),
        dpopNonce: "nonce-" + crypto.randomBytes(4).toString("hex"), oauthTokens: new Map(), pars: new Map(), codes: new Map(),
        pageSize: 2, createSessions: 0
    };
    const people = [
        { did: "did:plc:bobbobbobbobbobbobbobbob", handle: "bob.test", displayName: "Bob Marsh", description: "Birds and boats.", avatar: "" },
        { did: "did:plc:carlacarlacarlacarlacarl", handle: "carla.test", displayName: "Carla", description: "", avatar: "" },
        { did: "did:web:dee.example", handle: "dee.example", displayName: "Dee Ortiz", description: "On my own PDS.", avatar: "" }
    ];
    bs.follows = people.slice();
    const at = (s) => new Date(Date.parse("2026-10-10T10:00:00Z") + s * 1000).toISOString();
    bs.notifications = [
        { uri: "at://did:plc:bobbobbobbobbobbobbobbob/app.bsky.feed.like/1", reason: "like", reasonSubject: "at://" + bs.did + "/app.bsky.feed.post/p1",
          author: people[0], indexedAt: at(1), record: {} }
    ];
    bs.convos = [{ id: "convo-bob", rev: "r1", members: [{ did: bs.did, handle: bs.handle }, { did: people[0].did, handle: people[0].handle, displayName: people[0].displayName }],
                   messages: [{ id: "m1", rev: "a001", text: "Hi Anna!", sender: { did: people[0].did }, sentAt: at(2) }] }];
    bs.people = people;
    // A new notification or message from the "server" (the tests).
    bs.notify = (reason, who, text) => {
        const n = { uri: "at://" + who.did + "/app.bsky.feed.post/n" + bs.notifications.length, reason, author: who, indexedAt: at(100 + bs.notifications.length),
                    record: text ? { text } : {}, reasonSubject: reason === "like" || reason === "repost" ? "at://" + bs.did + "/app.bsky.feed.post/p1" : undefined };
        bs.notifications.push(n);
        return n;
    };
    bs.message = (convo, text, sender) => {
        const c = bs.convos.find((x) => x.id === convo);
        const rev = "a" + String(100 + c.messages.length).padStart(3, "0");
        c.messages.push({ id: "m" + (c.messages.length + 1), rev, text, sender: { did: sender || c.members[1].did }, sentAt: now() });
        c.rev = "r" + (c.messages.length + 1);
    };

    const P = "/bsky";
    const pdsUrl = () => base.origin + P + "/pds";
    const asUrl = () => base.origin + P + "/as";
    const didDoc = (did, handle) => ({
        "@context": ["https://www.w3.org/ns/did/v1"], id: did, alsoKnownAs: ["at://" + handle],
        service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: pdsUrl() }]
    });

    // ---- identity -----------------------------------------------------------------------
    base.route("GET", /^\/bsky\/xrpc\/com\.atproto\.identity\.resolveHandle$/, (req, res, c) => {
        const h = c.query.get("handle");
        if (h === bs.handle) return send(res, 200, { did: bs.did });
        const p = people.find((x) => x.handle === h);
        return p ? send(res, 200, { did: p.did }) : send(res, 400, { error: "InvalidRequest", message: "Unable to resolve handle" });
    });
    base.route("GET", /^\/bsky\/well-known\/([^/]+)$/, (req, res, c) => (c.m[1] === bs.handle ? send(res, 200, bs.did, { "Content-Type": "text/plain" }) : send(res, 404, "")));
    base.route("GET", /^\/bsky\/plc\/(.+)$/, (req, res, c) => {
        const did = decodeURIComponent(c.m[1]);
        if (did === bs.did) return send(res, 200, didDoc(bs.did, bs.handle));
        const p = people.find((x) => x.did === did);
        return p ? send(res, 200, didDoc(p.did, p.handle)) : send(res, 404, { message: "DID not registered" });
    });

    // ---- sessions -------------------------------------------------------------------------
    function issueSession(chat) {
        const access = "acc-" + crypto.randomBytes(6).toString("hex"), refresh = "ref-" + crypto.randomBytes(6).toString("hex");
        bs.sessions.set(access, { chat, expires: Date.now() + 2 * 3600e3 });
        bs.refreshes.set(refresh, { chat });
        return { did: bs.did, handle: bs.handle, accessJwt: access, refreshJwt: refresh, email: "anna@example.com", active: true };
    }
    bs.expireSessions = () => { for (const s of bs.sessions.values()) s.expires = 0; };
    base.route("POST", /^\/bsky\/pds\/xrpc\/com\.atproto\.server\.createSession$/, (req, res, c) => {
        bs.createSessions++;
        const b = c.json() || {};
        if (b.identifier !== bs.did && b.identifier !== bs.handle) return send(res, 401, { error: "AuthenticationRequired", message: "Invalid identifier or password" });
        if (b.password === bs.accountPassword) return send(res, 401, { error: "AuthFactorTokenRequired", message: "A sign in code has been sent to your email address" });
        if (b.password !== bs.appPassword && b.password !== bs.chatlessPassword) return send(res, 401, { error: "AuthenticationRequired", message: "Invalid identifier or password" });
        return send(res, 200, issueSession(b.password === bs.appPassword));
    });
    base.route("POST", /^\/bsky\/pds\/xrpc\/com\.atproto\.server\.refreshSession$/, (req, res) => {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
        const r = m && bs.refreshes.get(m[1]);
        if (!r) return send(res, 400, { error: "ExpiredToken", message: "Token has been revoked" });
        bs.refreshes.delete(m[1]);
        return send(res, 200, issueSession(r.chat));
    });

    // ---- DPoP (RFC 9449) ------------------------------------------------------------------
    async function checkDpop(req, htu, accessToken) {
        const proof = req.headers.dpop;
        if (!proof) return { error: "invalid_dpop_proof" };
        const [h, p, sig] = proof.split(".");
        const head = JSON.parse(b64urlDecode(h).toString("utf8")), body = JSON.parse(b64urlDecode(p).toString("utf8"));
        if (head.typ !== "dpop+jwt" || head.alg !== "ES256" || !head.jwk) return { error: "invalid_dpop_proof" };
        const key = await crypto.webcrypto.subtle.importKey("jwk", head.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        const ok = await crypto.webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlDecode(sig), Buffer.from(h + "." + p));
        if (!ok) return { error: "invalid_dpop_proof", why: "signature" };
        if (body.htm !== req.method || body.htu !== htu) return { error: "invalid_dpop_proof", why: "htm/htu " + body.htm + " " + body.htu + " != " + htu };
        if (Math.abs(body.iat * 1000 - Date.now()) > 300e3) return { error: "invalid_dpop_proof", why: "iat" };
        if (body.nonce !== bs.dpopNonce) return { error: "use_dpop_nonce" };
        if (accessToken && body.ath !== b64url(crypto.createHash("sha256").update(accessToken).digest())) return { error: "invalid_dpop_proof", why: "ath" };
        const thumb = b64url(crypto.createHash("sha256").update(JSON.stringify({ crv: head.jwk.crv, kty: head.jwk.kty, x: head.jwk.x, y: head.jwk.y })).digest());
        return { thumb };
    }

    // The account's token: a session of an app password, or an OAuth token with its DPoP proof.
    async function authed(req, htu) {
        const m = /^(Bearer|DPoP) (.+)$/.exec(req.headers.authorization || "");
        if (!m) return { status: 401, body: { error: "AuthenticationRequired", message: "Authentication Required" } };
        if (m[1] === "Bearer") {
            const s = bs.sessions.get(m[2]);
            if (!s) return { status: 401, body: { error: "InvalidToken", message: "Bad token" } };
            if (s.expires < Date.now()) return { status: 400, body: { error: "ExpiredToken", message: "Token has expired" } };
            return { chat: s.chat };
        }
        const t = bs.oauthTokens.get(m[2]);
        if (!t || t.expires < Date.now()) return { status: 401, body: { error: "InvalidToken", message: "Bad token" } };
        const d = await checkDpop(req, htu, m[2]);
        if (d.error === "use_dpop_nonce") return { status: 401, body: { error: "use_dpop_nonce" }, headers: { "WWW-Authenticate": "DPoP error=\"use_dpop_nonce\"", "DPoP-Nonce": bs.dpopNonce } };
        if (d.error || d.thumb !== t.thumb) return { status: 401, body: { error: "InvalidToken", message: "DPoP " + (d.why || d.error || "key") } };
        return { chat: true, oauth: true };
    }

    function xrpc(method, nsid, fn) {
        base.route(method, new RegExp("^/bsky/pds/xrpc/" + nsid.replace(/\./g, "\\.") + "$"), (req, res, c) => {
            authed(req, pdsUrl() + "/xrpc/" + nsid).then((a) => {
                if (a.status) return send(res, a.status, a.body, a.headers || {});
                if (/^chat\./.test(nsid)) {
                    if (req.headers["atproto-proxy"] !== "did:web:api.bsky.chat#bsky_chat") return send(res, 400, { error: "InvalidRequest", message: "No service configured for " + nsid });
                    if (!a.chat) return send(res, 400, { error: "InvalidToken", message: "Bad token scope" });
                }
                return fn(req, res, c, a);
            }).catch((e) => send(res, 500, String(e.stack)));
        });
    }
    const page = (list, c, key) => {
        const size = Math.min(Number(c.query.get("limit")) || 50, bs.pageSize || 50);
        const start = Number(c.query.get("cursor") || 0);
        const out = { [key]: list.slice(start, start + size) };
        if (start + size < list.length) out.cursor = String(start + size);
        return out;
    };
    xrpc("GET", "app.bsky.actor.getProfile", (req, res, c) => send(res, 200, { did: bs.did, handle: bs.handle, displayName: "Anna Lee", followsCount: bs.follows.length }));
    xrpc("GET", "app.bsky.graph.getFollows", (req, res, c) => send(res, 200, Object.assign({ subject: { did: bs.did, handle: bs.handle } }, page(bs.follows, c, "follows"))));
    xrpc("GET", "app.bsky.notification.listNotifications", (req, res, c) => {
        const reasons = c.query.getAll("reasons");
        const list = bs.notifications.filter((n) => !reasons.length || reasons.includes(n.reason)).slice().reverse();
        return send(res, 200, { notifications: list.slice(0, Number(c.query.get("limit")) || 50), seenAt: at(0) });
    });
    xrpc("POST", "com.atproto.repo.uploadBlob", (req, res, c) => {
        if (c.body.length > 1000000) return send(res, 400, { error: "BlobTooLarge" });
        const cid = "bafkrei" + crypto.createHash("sha256").update(c.body).digest("hex").slice(0, 40);
        bs.blobs.push({ cid, size: c.body.length, mimeType: req.headers["content-type"] });
        return send(res, 200, { blob: { $type: "blob", ref: { $link: cid }, mimeType: req.headers["content-type"], size: c.body.length } });
    });
    xrpc("POST", "com.atproto.repo.createRecord", (req, res, c) => {
        const b = c.json() || {};
        if (b.repo !== bs.did || b.collection !== "app.bsky.feed.post" || !b.record || b.record.$type !== "app.bsky.feed.post")
            return send(res, 400, { error: "InvalidRequest", message: "bad record" });
        if ([...b.record.text].length > 300) return send(res, 400, { error: "InvalidRecord", message: "text too long" });
        const rkey = b.rkey || "3l" + crypto.randomBytes(5).toString("hex");
        if (bs.posts.some((p) => p.rkey === rkey)) return send(res, 400, { error: "InvalidRequest", message: "Record already exists" });
        bs.posts.push({ rkey, record: b.record });
        return send(res, 200, { uri: "at://" + bs.did + "/app.bsky.feed.post/" + rkey, cid: "bafyrei" + rkey });
    });
    xrpc("GET", "chat.bsky.convo.listConvos", (req, res) => send(res, 200, { convos: bs.convos.map((c) => ({ id: c.id, rev: c.rev, members: c.members, unreadCount: 1 })) }));
    xrpc("GET", "chat.bsky.convo.getMessages", (req, res, c) => {
        const convo = bs.convos.find((x) => x.id === c.query.get("convoId"));
        if (!convo) return send(res, 400, { error: "InvalidRequest", message: "Convo not found" });
        return send(res, 200, { messages: convo.messages.slice().reverse().slice(0, Number(c.query.get("limit")) || 30) });
    });
    xrpc("GET", "chat.bsky.convo.getConvoForMembers", (req, res, c) => {
        const did = c.query.getAll("members")[0];
        let convo = bs.convos.find((x) => x.members.some((m) => m.did === did));
        if (!convo) {
            const p = people.find((x) => x.did === did);
            convo = { id: "convo-" + (p ? p.handle.split(".")[0] : "x"), rev: "r0", members: [{ did: bs.did, handle: bs.handle }, p], messages: [] };
            bs.convos.push(convo);
        }
        return send(res, 200, { convo: { id: convo.id, rev: convo.rev, members: convo.members } });
    });
    xrpc("POST", "chat.bsky.convo.sendMessage", (req, res, c) => {
        const b = c.json() || {};
        const convo = bs.convos.find((x) => x.id === b.convoId);
        if (!convo || !b.message || !b.message.text) return send(res, 400, { error: "InvalidRequest" });
        bs.message(convo.id, b.message.text, bs.did);
        const m = convo.messages[convo.messages.length - 1];
        return send(res, 200, { id: m.id, rev: m.rev, text: m.text, sender: m.sender, sentAt: m.sentAt });
    });

    // ---- OAuth (the PDS's authorization server) -------------------------------------------------
    base.route("GET", /^\/bsky\/pds\/\.well-known\/oauth-protected-resource$/, (req, res) =>
        send(res, 200, { resource: pdsUrl(), authorization_servers: [asUrl()], scopes_supported: [], bearer_methods_supported: ["header"] }));
    base.route("GET", /^\/bsky\/as\/\.well-known\/oauth-authorization-server$/, (req, res) => send(res, 200, {
        issuer: asUrl(), authorization_endpoint: asUrl() + "/oauth/authorize", token_endpoint: asUrl() + "/oauth/token",
        pushed_authorization_request_endpoint: asUrl() + "/oauth/par", revocation_endpoint: asUrl() + "/oauth/revoke",
        require_pushed_authorization_requests: true, dpop_signing_alg_values_supported: ["ES256"],
        scopes_supported: ["atproto", "transition:generic", "transition:chat.bsky"], client_id_metadata_document_supported: true
    }));
    async function dpopOrNonce(req, res, htu) {
        const d = await checkDpop(req, htu, null);
        if (d.error === "use_dpop_nonce") { send(res, 400, { error: "use_dpop_nonce", error_description: "Authorization server requires nonce in DPoP proof" }, { "DPoP-Nonce": bs.dpopNonce }); return null; }
        if (d.error) { send(res, 400, { error: d.error, error_description: d.why || "" }); return null; }
        return d;
    }
    bs.clientId = () => base.origin + "/bsky/client-metadata.json";
    base.route("POST", /^\/bsky\/as\/oauth\/par$/, (req, res, c) => {
        dpopOrNonce(req, res, asUrl() + "/oauth/par").then((d) => {
            if (!d) return;
            const f = c.form();
            if (f.get("client_id") !== bs.clientId()) return send(res, 400, { error: "invalid_client" });
            if (f.get("code_challenge_method") !== "S256" || !f.get("code_challenge") || f.get("response_type") !== "code" || !f.get("state"))
                return send(res, 400, { error: "invalid_request" });
            if (!/\batproto\b/.test(f.get("scope") || "")) return send(res, 400, { error: "invalid_scope" });
            const uri = "urn:ietf:params:oauth:request_uri:req-" + crypto.randomBytes(6).toString("hex");
            bs.pars.set(uri, { f: Object.fromEntries(f), thumb: d.thumb });
            return send(res, 201, { request_uri: uri, expires_in: 299 }, { "DPoP-Nonce": bs.dpopNonce });
        });
    });
    base.route("GET", /^\/bsky\/as\/oauth\/authorize$/, (req, res, c) => {
        const q = c.query;
        // PAR: only client_id and request_uri.
        if ([...q.keys()].sort().join(",") !== "client_id,request_uri") return send(res, 400, "only client_id and request_uri");
        const par = bs.pars.get(q.get("request_uri"));
        if (!par || par.f.client_id !== q.get("client_id")) return send(res, 400, "unknown request_uri");
        const code = "cod-" + crypto.randomBytes(6).toString("hex");
        bs.codes.set(code, par);
        bs.pars.delete(q.get("request_uri"));
        const to = par.f.redirect_uri + "?code=" + code + "&state=" + encodeURIComponent(par.f.state) + "&iss=" + encodeURIComponent(asUrl());
        res.writeHead(302, { Location: to });
        return res.end();
    });
    function oauthToken(thumb, scope) {
        const access = "oat-" + crypto.randomBytes(6).toString("hex"), refresh = "ort-" + crypto.randomBytes(6).toString("hex");
        bs.oauthTokens.set(access, { thumb, expires: Date.now() + 3600e3 });
        bs.refreshes.set("oauth:" + refresh, { thumb, scope });
        return { access_token: access, token_type: "DPoP", refresh_token: refresh, expires_in: 3600, scope, sub: bs.did };
    }
    bs.expireOAuth = () => { for (const t of bs.oauthTokens.values()) t.expires = 0; };
    base.route("POST", /^\/bsky\/as\/oauth\/token$/, (req, res, c) => {
        dpopOrNonce(req, res, asUrl() + "/oauth/token").then((d) => {
            if (!d) return;
            const f = c.form();
            if (f.get("client_id") !== bs.clientId()) return send(res, 400, { error: "invalid_client" });
            if (f.get("grant_type") === "authorization_code") {
                const par = bs.codes.get(f.get("code"));
                bs.codes.delete(f.get("code"));
                if (!par || par.thumb !== d.thumb || par.f.redirect_uri !== f.get("redirect_uri")) return send(res, 400, { error: "invalid_grant" });
                if (b64url(crypto.createHash("sha256").update(f.get("code_verifier") || "").digest()) !== par.f.code_challenge) return send(res, 400, { error: "invalid_grant", error_description: "PKCE" });
                return send(res, 200, oauthToken(d.thumb, par.f.scope), { "DPoP-Nonce": bs.dpopNonce });
            }
            if (f.get("grant_type") === "refresh_token") {
                const r = bs.refreshes.get("oauth:" + f.get("refresh_token"));
                bs.refreshes.delete("oauth:" + f.get("refresh_token"));
                if (!r || r.thumb !== d.thumb) return send(res, 400, { error: "invalid_grant", error_description: "refresh token used or unknown" });
                return send(res, 200, oauthToken(d.thumb, r.scope), { "DPoP-Nonce": bs.dpopNonce });
            }
            return send(res, 400, { error: "unsupported_grant_type" });
        });
    });
    base.route("POST", /^\/bsky\/as\/oauth\/revoke$/, (req, res, c) => {
        const t = c.form().get("token");
        bs.revoked = (bs.revoked || 0) + (bs.refreshes.delete("oauth:" + t) ? 1 : 0);
        return send(res, 200, {});
    });

    // What /etc/palm/bluesky/clients.json says for this server.
    bs.clients = (withOAuth) => ({ bluesky: Object.assign({
        resolver: base.origin + P, plc: base.origin + P + "/plc", wellKnown: base.origin + P + "/well-known/{handle}"
    }, withOAuth ? { clientId: bs.clientId(), redirectUri: "org.webosphoenix:/oauth/bluesky" } : {}) });
    return bs;
}

module.exports = { addBluesky };
