// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Stand-ins for the drives Phoenix connects to, on one local HTTP server,
// implementing the endpoints the connector uses as the providers document
// them (each with its own files, in memory), for the tests
// (apps/drives/service/drives.test.ts), the Chromium test
// (tools/test-drives.cjs) and trying the drives in the simulator:
//
//   WebDAV / Nextcloud   /remote.php/dav/files/<user>/... (PROPFIND, GET with
//                        Range, PUT, MKCOL, MOVE, COPY, DELETE, SEARCH,
//                        quota), chunked upload v2 (/remote.php/dav/uploads/),
//                        Login Flow v2 (/index.php/login/v2, its page, poll),
//                        app password deletion (/ocs/v2.php/core/apppassword)
//   S3                   /<bucket>/<key> (path style, bucket phoenix-files): ListObjectsV2, HEAD,
//                        GET with Range, PUT, CopyObject, DELETE, multipart;
//                        every request's Signature V4 is checked
//   Dropbox              /dropbox/2/... and /dropbox-content/2/...
//   OneDrive (Graph)     /graph/v1.0/me/drive..., download and upload-session
//                        addresses of their own (/graph-dl/, /graph-up/)
//   Google Drive         /gdrive/drive/v3/..., /gdrive/upload/drive/v3/...
//                        (multipart and resumable uploads)
//   Box                  /box/2.0/..., /box-up/api/2.0/... (form upload, upload
//                        sessions with SHA-1 digests), /box-dl/<id>
//   OAuth (each)         /oauth/<provider>/authorize (an "Allow" page, or a
//                        redirect at once with autoApprove), /token (the code
//                        with its PKCE verifier, refresh tokens), /revoke
//
//   const fake = await createFakeDrives().start(0);
//   fake.origin, fake.clients (the drives/clients.json for it), fake.trees,
//   fake.requests, fake.stop()

"use strict";

const crypto = require("crypto");
const http = require("http");

// ---- A tree of files, by id and by path -------------------------------------------------

function createTree(rootId) {
    const nodes = new Map();
    let next = 1;
    const root = { id: rootId || "root", name: "", parent: null, type: "folder", mtime: Date.parse("2026-10-01T09:00:00Z"), version: 1 };
    nodes.set(root.id, root);
    const t = {
        root, nodes,
        newId: () => "id" + (next++).toString(36) + crypto.randomBytes(3).toString("hex"),
        children: (id) => [...nodes.values()].filter((n) => n.parent === id && !n.trashed),
        child: (id, name) => t.children(id).find((n) => n.name === name),
        byPath(p) {
            let n = root;
            for (const seg of String(p).split("/").filter(Boolean)) {
                if (!n || n.type !== "folder") return null;
                n = t.child(n.id, seg);
            }
            return n || null;
        },
        pathOf(n) {
            const parts = [];
            for (let x = n; x && x.parent !== null; x = nodes.get(x.parent)) parts.unshift(x.name);
            return "/" + parts.join("/");
        },
        add(parentId, name, type, bytes, mtime) {
            const n = { id: t.newId(), name, parent: parentId, type, mtime: mtime || Date.now(), version: 1 };
            if (type === "file") n.bytes = Buffer.from(bytes || []);
            nodes.set(n.id, n);
            return n;
        },
        // mkdir -p, then the file: put("/Photos/a.jpg", bytes).
        put(p, bytes, mtime) {
            const parts = String(p).split("/").filter(Boolean);
            let dir = root;
            for (const seg of parts.slice(0, -1)) dir = t.child(dir.id, seg) || t.add(dir.id, seg, "folder", null, mtime);
            const name = parts[parts.length - 1];
            const old = t.child(dir.id, name);
            if (old && old.type === "file") { old.bytes = Buffer.from(bytes); old.mtime = mtime || Date.now(); old.version++; return old; }
            return t.add(dir.id, name, "file", bytes, mtime);
        },
        mkdirp(p) {
            let dir = root;
            for (const seg of String(p).split("/").filter(Boolean)) dir = t.child(dir.id, seg) || t.add(dir.id, seg, "folder");
            return dir;
        },
        remove(n) {
            for (const c of t.children(n.id)) t.remove(c);
            nodes.delete(n.id);
        },
        copy(n, parentId, name) {
            const c = t.add(parentId, name, n.type, n.bytes);
            if (n.type === "folder") for (const k of t.children(n.id)) t.copy(k, c.id, k.name);
            return c;
        },
        etag: (n) => "\"" + crypto.createHash("md5").update(n.bytes || Buffer.from(n.id + ":" + n.version)).digest("hex") + "\"",
        sha1: (n) => crypto.createHash("sha1").update(n.bytes || Buffer.alloc(0)).digest("hex"),
        md5: (n) => crypto.createHash("md5").update(n.bytes || Buffer.alloc(0)).digest("hex"),
        used: () => [...nodes.values()].reduce((a, n) => a + (n.bytes ? n.bytes.length : 0), 0)
    };
    return t;
}

// Sample files: two pictures and a text, so a drive is not empty.
function seed(t, png) {
    t.put("/Documents/notes.txt", Buffer.from("Shopping: milk, bread, a new Touchstone.\n"), Date.parse("2026-10-05T10:00:00Z"));
    t.put("/Photos/lake.png", png, Date.parse("2026-10-06T08:30:00Z"));
    t.put("/Photos/hills.png", png, Date.parse("2026-10-06T08:31:00Z"));
    t.mkdirp("/Shared");
}

// A PNG of one colour, size x size.
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
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw.set([rgb[0] + (y >> 2), rgb[1], rgb[2] + (x >> 2)].map((v) => v & 255), y * (size * 3 + 1) + 1 + x * 3);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", require("zlib").deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---- HTTP helpers --------------------------------------------------------------------------

function send(res, status, body, headers) {
    const h = Object.assign({}, headers || {});
    let b = body;
    if (b !== undefined && b !== null && !Buffer.isBuffer(b) && typeof b !== "string") { b = JSON.stringify(b); h["Content-Type"] = h["Content-Type"] || "application/json"; }
    if (b === undefined || b === null) b = "";
    res.writeHead(status, h);
    res.end(b);
}
const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Range: bytes=a-b of a buffer -> [status, part, headers].
function ranged(req, bytes, extra) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    const h = Object.assign({ "Content-Type": "application/octet-stream", "Accept-Ranges": "bytes" }, extra || {});
    if (!m) return [200, bytes, h];
    const start = Number(m[1]), end = m[2] ? Math.min(Number(m[2]), bytes.length - 1) : bytes.length - 1;
    if (start >= bytes.length) return [416, Buffer.alloc(0), Object.assign(h, { "Content-Range": "bytes */" + bytes.length })];
    return [206, bytes.subarray(start, end + 1), Object.assign(h, { "Content-Range": "bytes " + start + "-" + end + "/" + bytes.length })];
}

function createFakeDrives(options) {
    options = options || {};
    const picture = png(64, [40, 110, 170]);
    const fake = { origin: "", requests: [], autoApprove: !!options.autoApprove, offline: false };
    const trees = fake.trees = {
        dav: createTree("dav"), s3: createTree("s3"), dropbox: createTree("dbx"), onedrive: createTree("od-root"),
        googledrive: createTree("gd-root"), box: createTree("0")
    };
    // A new drive has the samples (Google Drive with drive.file shows only Phoenix's own: none).
    ["dav", "s3", "dropbox", "onedrive", "box"].forEach((k) => seed(trees[k], picture));
    fake.picture = picture;

    // ---- OAuth -------------------------------------------------------------------------------
    const codes = new Map(), tokens = new Map(), refresh = new Map();
    const PROVIDERS = ["dropbox", "onedrive", "googledrive", "box"];
    fake.clients = () => {
        const o = fake.origin;
        const oauth = (p) => ({ clientId: "phoenix-test-" + p, authorizationEndpoint: o + "/oauth/" + p + "/authorize", tokenEndpoint: o + "/oauth/" + p + "/token",
                                revocationEndpoint: p === "dropbox" || p === "onedrive" ? undefined : o + "/oauth/" + p + "/revoke" });
        return {
            dropbox: Object.assign(oauth("dropbox"), { api: o + "/dropbox/2/", content: o + "/dropbox-content/2/" }),
            onedrive: Object.assign(oauth("onedrive"), { graph: o + "/graph/v1.0" }),
            googledrive: Object.assign(oauth("googledrive"), { api: o + "/gdrive/drive/v3", upload: o + "/gdrive/upload/drive/v3", clientSecret: "not-secret" }),
            box: Object.assign(oauth("box"), { api: o + "/box/2.0", upload: o + "/box-up/api/2.0" })
        };
    };
    fake.users = { dav: { user: "phoenix", password: "app-password-1" }, s3: { accessKeyId: "PHOENIXKEY", secretAccessKey: "phoenix-secret", bucket: "phoenix-files", region: "us-east-1" } };
    function issue(provider) {
        const access = "at-" + provider + "-" + crypto.randomBytes(6).toString("hex");
        const rt = "rt-" + provider + "-" + crypto.randomBytes(6).toString("hex");
        tokens.set(access, { provider, expires: Date.now() + 3600e3 });
        refresh.set(rt, provider);
        return { access_token: access, token_type: "bearer", expires_in: 3600, refresh_token: rt, scope: "files" };
    }
    function bearer(req, provider) {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
        const t = m && tokens.get(m[1]);
        return !!(t && t.provider === provider && t.expires > Date.now());
    }
    fake.expireTokens = () => { for (const t of tokens.values()) t.expires = 0; };
    function oauth(req, res, url, provider, rest, body) {
        if (rest === "authorize") {
            const q = url.searchParams;
            if (q.get("client_id") !== "phoenix-test-" + provider) return send(res, 400, "unknown client");
            if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return send(res, 400, "PKCE required");
            const approve = "/oauth/" + provider + "/approve?" + q.toString();
            if (fake.autoApprove) { res.writeHead(302, { Location: approve }); return res.end(); }
            return send(res, 200, "<!doctype html><meta name=viewport content='width=device-width'><title>Sign in</title>" +
                "<body style='font-family:sans-serif;padding:16px'><h2>Test " + provider + "</h2><p>Allow webOS Phoenix to see and change your files?</p>" +
                "<a id=allow href='" + xmlEsc(approve) + "' style='display:inline-block;padding:10px 18px;background:#2b6;color:#fff;border-radius:6px'>Allow</a> " +
                "<a id=deny href='" + xmlEsc(q.get("redirect_uri") + "?error=access_denied&state=" + encodeURIComponent(q.get("state"))) + "'>Deny</a></body>",
                { "Content-Type": "text/html" });
        }
        if (rest === "approve") {
            const q = url.searchParams;
            const code = "code-" + crypto.randomBytes(8).toString("hex");
            codes.set(code, { provider, challenge: q.get("code_challenge"), redirect: q.get("redirect_uri"), client: q.get("client_id") });
            const to = q.get("redirect_uri") + (q.get("redirect_uri").indexOf("?") < 0 ? "?" : "&") + "code=" + code + "&state=" + encodeURIComponent(q.get("state"));
            res.writeHead(302, { Location: to });
            return res.end();
        }
        if (rest === "token" && req.method === "POST") {
            const f = new URLSearchParams(body.toString("utf8"));
            if (f.get("grant_type") === "authorization_code") {
                const c = codes.get(f.get("code"));
                codes.delete(f.get("code"));
                if (!c || c.provider !== provider || c.redirect !== f.get("redirect_uri") || c.client !== f.get("client_id")) return send(res, 400, { error: "invalid_grant" });
                if (b64url(crypto.createHash("sha256").update(f.get("code_verifier") || "").digest()) !== c.challenge) return send(res, 400, { error: "invalid_grant", error_description: "PKCE" });
                if (provider === "googledrive" && f.get("client_secret") !== "not-secret") return send(res, 401, { error: "invalid_client" });
                return send(res, 200, issue(provider));
            }
            if (f.get("grant_type") === "refresh_token") {
                if (refresh.get(f.get("refresh_token")) !== provider) return send(res, 400, { error: "invalid_grant" });
                const t = issue(provider);
                delete t.refresh_token;
                return send(res, 200, t);
            }
            return send(res, 400, { error: "unsupported_grant_type" });
        }
        if (rest === "revoke" && req.method === "POST") {
            const f = new URLSearchParams(body.toString("utf8"));
            tokens.delete(f.get("token"));
            fake.revoked = (fake.revoked || 0) + 1;
            return send(res, 200, {});
        }
        return send(res, 404, "no such OAuth endpoint");
    }

    // ---- WebDAV / Nextcloud --------------------------------------------------------------------
    const flows = new Map();
    const uploads = new Map();
    let appPasswords = 1;
    function davAuth(req) {
        const m = /^Basic (.+)$/.exec(req.headers.authorization || "");
        if (!m) return false;
        const [u, p] = Buffer.from(m[1], "base64").toString("utf8").split(":");
        return u === fake.users.dav.user && (p === fake.users.dav.password || /^app-password-\d+$/.test(p));
    }
    function davProps(n, href) {
        const t = trees.dav;
        const dir = n.type === "folder";
        return "<d:response><d:href>" + xmlEsc(href) + "</d:href><d:propstat><d:prop>" +
            "<d:getlastmodified>" + new Date(n.mtime).toUTCString() + "</d:getlastmodified>" +
            (dir ? "<d:resourcetype><d:collection/></d:resourcetype>" : "<d:resourcetype/><d:getcontentlength>" + n.bytes.length + "</d:getcontentlength>" +
                   "<d:getcontenttype>" + (/\.png$/.test(n.name) ? "image/png" : /\.txt$/.test(n.name) ? "text/plain" : "application/octet-stream") + "</d:getcontenttype>") +
            "<d:getetag>" + t.etag(n) + "</d:getetag><oc:permissions>RGDNVW" + (dir ? "CK" : "") + "</oc:permissions>" +
            "</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>";
    }
    const davHref = (n) => "/remote.php/dav/files/" + fake.users.dav.user + t2href(trees.dav.pathOf(n)) + (n.type === "folder" && n.parent !== null ? "/" : n.parent === null ? "/" : "");
    function t2href(p) { return p === "/" ? "" : p.split("/").map(encodeURIComponent).join("/"); }
    function multistatus(inner) {
        return "<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\" xmlns:oc=\"http://owncloud.org/ns\" xmlns:s=\"http://sabredav.org/ns\">" + inner + "</d:multistatus>";
    }
    function davPathOf(u) {
        const prefix = "/remote.php/dav/files/" + fake.users.dav.user;
        if (u.pathname.indexOf(prefix) !== 0) return null;
        return decodeURIComponent(u.pathname.slice(prefix.length)).replace(/\/+$/, "") || "/";
    }
    function dav(req, res, u, body) {
        const t = trees.dav;
        if (u.pathname === "/index.php/login/v2" && req.method === "POST") {
            const token = crypto.randomBytes(16).toString("hex");
            flows.set(token, { done: false });
            return send(res, 200, { poll: { token, endpoint: fake.origin + "/login/v2/poll" }, login: fake.origin + "/login/v2/flow/" + token });
        }
        let m = /^\/login\/v2\/flow\/([0-9a-f]+)$/.exec(u.pathname);
        if (m) {
            return send(res, 200, "<!doctype html><meta name=viewport content='width=device-width'><title>Nextcloud</title><body style='font-family:sans-serif'>" +
                "<h2>Connect to your account</h2><p>webOS Phoenix wants to see your files.</p><a id=grant href='/login/v2/grant/" + m[1] + "'>Grant access</a></body>",
                { "Content-Type": "text/html" });
        }
        m = /^\/login\/v2\/grant\/([0-9a-f]+)$/.exec(u.pathname);
        if (m && flows.has(m[1])) {
            flows.set(m[1], { done: true, password: "app-password-" + (++appPasswords) });
            return send(res, 200, "<!doctype html><body><h2>Account connected</h2><p>You can close this window.</p></body>", { "Content-Type": "text/html" });
        }
        if (u.pathname === "/login/v2/poll" && req.method === "POST") {
            const token = new URLSearchParams(body.toString("utf8")).get("token");
            const f = flows.get(token);
            if (!f || !f.done) return send(res, 404, "");
            flows.delete(token);
            return send(res, 200, { server: fake.origin, loginName: fake.users.dav.user, appPassword: f.password });
        }
        if (u.pathname === "/ocs/v2.php/core/apppassword" && req.method === "DELETE") {
            fake.appPasswordDeleted = (fake.appPasswordDeleted || 0) + 1;
            return send(res, 200, "<ocs><meta><status>ok</status></meta></ocs>");
        }
        if (!davAuth(req)) return send(res, 401, "", { "WWW-Authenticate": "Basic realm=\"Nextcloud\"" });
        // Chunked upload v2.
        m = /^\/remote\.php\/dav\/uploads\/([^/]+)\/([^/]+)(?:\/(.+))?$/.exec(u.pathname);
        if (m) {
            const key = m[2];
            if (req.method === "MKCOL") { uploads.set(key, { chunks: new Map(), dest: req.headers.destination }); return send(res, 201, ""); }
            const up = uploads.get(key);
            if (!up) return send(res, 404, "");
            if (req.method === "PUT" && m[3]) { up.chunks.set(m[3], body); fake.chunks = (fake.chunks || 0) + 1; return send(res, 201, ""); }
            if (req.method === "MOVE" && m[3] === ".file") {
                const bytes = Buffer.concat([...up.chunks.keys()].sort().map((k) => up.chunks.get(k)));
                if (Number(req.headers["oc-total-length"]) !== bytes.length) return send(res, 400, "length");
                const dest = davPathOf(new URL(req.headers.destination));
                if (req.headers.overwrite === "F" && t.byPath(dest)) return send(res, 412, "");
                t.put(dest, bytes);
                uploads.delete(key);
                return send(res, 201, "");
            }
            if (req.method === "DELETE") { uploads.delete(key); return send(res, 204, ""); }
            return send(res, 405, "");
        }
        if (req.method === "SEARCH" && u.pathname === "/remote.php/dav/") {
            const words = [...body.toString("utf8").matchAll(/<d:literal>%([^<]*)%<\/d:literal>/g)].map((x) => x[1].toLowerCase());
            const hits = [...t.nodes.values()].filter((n) => n.parent !== null && words.every((w) => n.name.toLowerCase().includes(w)));
            return send(res, 207, multistatus(hits.map((n) => davProps(n, davHref(n))).join("")), { "Content-Type": "application/xml" });
        }
        const p = davPathOf(u);
        if (p === null) return send(res, 404, "");
        const n = t.byPath(p);
        const parent = t.byPath(p.replace(/\/[^/]*$/, "") || "/");
        const name = p.slice(p.lastIndexOf("/") + 1);
        switch (req.method) {
        case "PROPFIND": {
            if (!n) return send(res, 404, "<d:error xmlns:d=\"DAV:\" xmlns:s=\"http://sabredav.org/ns\"><s:message>File not found</s:message></d:error>");
            if (/quota-used-bytes/.test(body.toString("utf8"))) {
                return send(res, 207, multistatus("<d:response><d:href>" + davHref(n) + "</d:href><d:propstat><d:prop><d:quota-used-bytes>" + t.used() +
                    "</d:quota-used-bytes><d:quota-available-bytes>" + (1024 * 1024 * 1024 - t.used()) + "</d:quota-available-bytes></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"),
                    { "Content-Type": "application/xml" });
            }
            const list = [n].concat(req.headers.depth === "1" && n.type === "folder" ? t.children(n.id) : []);
            return send(res, 207, multistatus(list.map((x) => davProps(x, davHref(x))).join("")), { "Content-Type": "application/xml; charset=utf-8" });
        }
        case "GET": {
            if (!n || n.type !== "file") return send(res, 404, "");
            const [st, part, h] = ranged(req, n.bytes, { ETag: t.etag(n) });
            if (req.headers.range) fake.ranges = (fake.ranges || 0) + 1;
            return send(res, st, part, h);
        }
        case "PUT":
            if (!parent || parent.type !== "folder") return send(res, 409, "");
            if (req.headers["if-none-match"] === "*" && n) return send(res, 412, "");
            t.put(p, body);
            return send(res, n ? 204 : 201, "", { ETag: t.etag(t.byPath(p)) });
        case "MKCOL":
            if (n) return send(res, 405, "");
            if (!parent) return send(res, 409, "");
            t.add(parent.id, name, "folder");
            return send(res, 201, "");
        case "DELETE":
            if (!n) return send(res, 404, "");
            t.remove(n);
            return send(res, 204, "");
        case "MOVE": case "COPY": {
            if (!n) return send(res, 404, "");
            const dest = davPathOf(new URL(req.headers.destination));
            const there = t.byPath(dest);
            const dparent = t.byPath(dest.replace(/\/[^/]*$/, "") || "/");
            if (!dparent) return send(res, 409, "");
            if (there && req.headers.overwrite === "F") return send(res, 412, "");
            if (there) t.remove(there);
            const dname = dest.slice(dest.lastIndexOf("/") + 1);
            if (req.method === "MOVE") { n.parent = dparent.id; n.name = dname; n.version++; }
            else t.copy(n, dparent.id, dname);
            return send(res, there ? 204 : 201, "");
        }
        }
        return send(res, 405, "");
    }

    // ---- S3 (path style; Signature V4 checked) ---------------------------------------------
    const multiparts = new Map();
    function s3Check(req, u) {
        const auth = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(req.headers.authorization || "");
        if (!auth) return "MissingSecurityHeader";
        if (auth[1] !== fake.users.s3.accessKeyId) return "InvalidAccessKeyId";
        const names = auth[4].split(";");
        const query = [...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
        const canonical = [req.method, u.pathname, query.map((q) => q[0] + "=" + q[1]).join("&"),
            names.map((k) => k + ":" + String(req.headers[k] || "").trim().replace(/\s+/g, " ") + "\n").join(""), auth[4],
            req.headers["x-amz-content-sha256"]].join("\n");
        const scope = auth[2] + "/" + auth[3] + "/s3/aws4_request";
        const toSign = ["AWS4-HMAC-SHA256", req.headers["x-amz-date"], scope, crypto.createHash("sha256").update(canonical).digest("hex")].join("\n");
        let key = crypto.createHmac("sha256", "AWS4" + fake.users.s3.secretAccessKey).update(auth[2]).digest();
        key = crypto.createHmac("sha256", key).update(auth[3]).digest();
        key = crypto.createHmac("sha256", key).update("s3").digest();
        key = crypto.createHmac("sha256", key).update("aws4_request").digest();
        if (crypto.createHmac("sha256", key).update(toSign).digest("hex") !== auth[5]) return "SignatureDoesNotMatch";
        return null;
    }
    function enc(s) { return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()); }
    const s3err = (res, status, code) => send(res, status, "<?xml version=\"1.0\"?><Error><Code>" + code + "</Code><Message>" + code + "</Message></Error>", { "Content-Type": "application/xml" });
    // S3 keeps keys flat: the tree's paths are the keys ("folder/" for an empty folder's marker).
    const s3keys = new Map();
    (function seedS3() {
        const t = trees.s3;
        for (const n of t.nodes.values()) if (n.type === "file") s3keys.set(t.pathOf(n).slice(1), { bytes: n.bytes, mtime: n.mtime });
        s3keys.set("Shared/", { bytes: Buffer.alloc(0), mtime: Date.now() });
    })();
    fake.s3keys = s3keys;
    function s3(req, res, u, body) {
        const bad = s3Check(req, u);
        if (bad) return s3err(res, 403, bad);
        const m = /^\/([^/]+)\/?(.*)$/.exec(u.pathname);
        if (!m || m[1] !== fake.users.s3.bucket) return s3err(res, 404, "NoSuchBucket");
        const key = decodeURIComponent(m[2]);
        const q = u.searchParams;
        const etag = (b) => "\"" + crypto.createHash("md5").update(b).digest("hex") + "\"";
        if (req.method === "GET" && !key && q.get("list-type") === "2") {
            const prefix = q.get("prefix") || "", delim = q.get("delimiter");
            const max = Number(q.get("max-keys")) || 1000;
            const all = [...s3keys.keys()].filter((k) => k.indexOf(prefix) === 0).sort();
            const files = [], folders = new Set();
            for (const k of all) {
                const rest = k.slice(prefix.length);
                const i = delim ? rest.indexOf(delim) : -1;
                if (i >= 0) folders.add(prefix + rest.slice(0, i + 1));
                else files.push(k);
            }
            const start = Number(q.get("continuation-token") || 0);
            const items = files.map((k) => ["f", k]).concat([...folders].map((k) => ["d", k]));
            const page = items.slice(start, start + max);
            const more = start + max < items.length;
            const xml = "<?xml version=\"1.0\"?><ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"><Name>" + m[1] + "</Name><Prefix>" + xmlEsc(prefix) +
                "</Prefix><KeyCount>" + page.length + "</KeyCount><IsTruncated>" + more + "</IsTruncated>" +
                (more ? "<NextContinuationToken>" + (start + max) + "</NextContinuationToken>" : "") +
                page.filter((x) => x[0] === "f").map((x) => { const o = s3keys.get(x[1]); return "<Contents><Key>" + xmlEsc(x[1]) + "</Key><LastModified>" + new Date(o.mtime).toISOString() +
                    "</LastModified><ETag>" + xmlEsc(etag(o.bytes)) + "</ETag><Size>" + o.bytes.length + "</Size></Contents>"; }).join("") +
                page.filter((x) => x[0] === "d").map((x) => "<CommonPrefixes><Prefix>" + xmlEsc(x[1]) + "</Prefix></CommonPrefixes>").join("") + "</ListBucketResult>";
            return send(res, 200, xml, { "Content-Type": "application/xml" });
        }
        if (req.method === "POST" && q.has("uploads")) {
            const id = "up-" + crypto.randomBytes(6).toString("hex");
            multiparts.set(id, { key, parts: new Map() });
            return send(res, 200, "<InitiateMultipartUploadResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"><Bucket>" + m[1] + "</Bucket><Key>" + xmlEsc(key) +
                "</Key><UploadId>" + id + "</UploadId></InitiateMultipartUploadResult>", { "Content-Type": "application/xml" });
        }
        if (q.has("uploadId")) {
            const up = multiparts.get(q.get("uploadId"));
            if (!up) return s3err(res, 404, "NoSuchUpload");
            if (req.method === "PUT") { up.parts.set(Number(q.get("partNumber")), body); fake.parts = (fake.parts || 0) + 1; return send(res, 200, "", { ETag: etag(body) }); }
            if (req.method === "DELETE") { multiparts.delete(q.get("uploadId")); return send(res, 204, ""); }
            if (req.method === "POST") {
                const listed = [...body.toString("utf8").matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>([^<]*)<\/ETag>/g)];
                const nums = listed.map((x) => Number(x[1]));
                for (let i = 0; i < nums.length - 1; i++) if (up.parts.get(nums[i]).length < 5 * 1024 * 1024) return s3err(res, 400, "EntityTooSmall");
                const bytes = Buffer.concat(nums.map((n) => up.parts.get(n)));
                s3keys.set(up.key, { bytes, mtime: Date.now() });
                multiparts.delete(q.get("uploadId"));
                return send(res, 200, "<CompleteMultipartUploadResult><Key>" + xmlEsc(up.key) + "</Key><ETag>" + etag(bytes) + "</ETag></CompleteMultipartUploadResult>", { "Content-Type": "application/xml" });
            }
        }
        const o = s3keys.get(key);
        if (req.method === "HEAD") {
            if (!o) return send(res, 404, "");
            res.writeHead(200, { "Content-Length": String(o.bytes.length), "Last-Modified": new Date(o.mtime).toUTCString(), ETag: etag(o.bytes), "Content-Type": "application/octet-stream" });
            return res.end();
        }
        if (req.method === "GET") {
            if (!o) return s3err(res, 404, "NoSuchKey");
            const [st, part, h] = ranged(req, o.bytes, { ETag: etag(o.bytes) });
            return send(res, st, part, h);
        }
        if (req.method === "PUT") {
            const src = req.headers["x-amz-copy-source"];
            if (src) {
                const sk = decodeURIComponent(src.replace(/^\/[^/]+\//, ""));
                const so = s3keys.get(sk);
                if (!so) return s3err(res, 404, "NoSuchKey");
                s3keys.set(key, { bytes: Buffer.from(so.bytes), mtime: Date.now() });
                return send(res, 200, "<CopyObjectResult><ETag>" + etag(so.bytes) + "</ETag></CopyObjectResult>", { "Content-Type": "application/xml" });
            }
            s3keys.set(key, { bytes: body, mtime: Date.now() });
            return send(res, 200, "", { ETag: etag(body) });
        }
        if (req.method === "DELETE") { s3keys.delete(key); return send(res, 204, ""); }
        return s3err(res, 405, "MethodNotAllowed");
    }

    // ---- Dropbox ----------------------------------------------------------------------------
    const sessions = new Map();
    function dbxMeta(n) {
        const t = trees.dropbox;
        if (n.type === "folder") return { ".tag": "folder", name: n.name, path_display: t.pathOf(n), path_lower: t.pathOf(n).toLowerCase(), id: "id:" + n.id };
        return { ".tag": "file", name: n.name, path_display: t.pathOf(n), path_lower: t.pathOf(n).toLowerCase(), id: "id:" + n.id, size: n.bytes.length,
                 server_modified: new Date(n.mtime).toISOString().replace(/\.\d+Z$/, "Z"), rev: "0" + n.version.toString(16) + n.id.slice(-4),
                 content_hash: crypto.createHash("sha256").update(n.bytes).digest("hex") };
    }
    const dbx409 = (res, summary) => send(res, 409, { error_summary: summary + "/..", error: { ".tag": summary.split("/")[0] } });
    function dropbox(req, res, u, body, content) {
        if (!bearer(req, "dropbox")) return send(res, 401, { error_summary: "invalid_access_token/.." });
        const t = trees.dropbox;
        const name = u.pathname.replace(/^\/dropbox(-content)?\/2\//, "");
        const arg = content ? JSON.parse(req.headers["dropbox-api-arg"] || "{}") : JSON.parse(body.toString("utf8") || "null") || {};
        const at = (p) => (p === "" || p === "/" ? t.root : t.byPath(p));
        if (name === "files/list_folder") {
            const n = at(arg.path);
            if (!n) return dbx409(res, "path/not_found");
            if (n.type !== "folder") return dbx409(res, "path/not_folder");
            const all = t.children(n.id).map(dbxMeta);
            const first = all.slice(0, 2);
            return send(res, 200, { entries: arg.limit === 1 ? all.slice(0, 1) : first, cursor: n.id + ":2", has_more: arg.limit !== 1 && all.length > 2 });
        }
        if (name === "files/list_folder/continue") {
            const [id, from] = arg.cursor.split(":");
            const all = t.children(id).map(dbxMeta);
            return send(res, 200, { entries: all.slice(Number(from)), cursor: id + ":" + all.length, has_more: false });
        }
        if (name === "files/get_metadata") { const n = at(arg.path); return n ? send(res, 200, dbxMeta(n)) : dbx409(res, "path/not_found"); }
        if (name === "files/download") {
            const n = at(arg.path);
            if (!n || n.type !== "file") return dbx409(res, "path/not_found");
            const [st, part, h] = ranged(req, n.bytes, { "Dropbox-API-Result": JSON.stringify(dbxMeta(n)) });
            return send(res, st, part, h);
        }
        const commit = (c, bytes) => {
            const there = at(c.path);
            if (there && c.mode !== "overwrite") return null;
            if (!at(c.path.replace(/\/[^/]*$/, "") || "/")) t.mkdirp(c.path.replace(/\/[^/]*$/, ""));
            return dbxMeta(t.put(c.path, bytes));
        };
        if (name === "files/upload") { const r = commit(arg, body); return r ? send(res, 200, r) : dbx409(res, "path/conflict/file"); }
        if (name === "files/upload_session/start") {
            const id = "s" + crypto.randomBytes(5).toString("hex");
            sessions.set(id, [body]);
            return send(res, 200, { session_id: id });
        }
        if (name === "files/upload_session/append_v2" || name === "files/upload_session/finish") {
            const s = sessions.get(arg.cursor.session_id);
            if (!s) return dbx409(res, "lookup_failed/not_found");
            const have = s.reduce((a, b) => a + b.length, 0);
            if (have !== arg.cursor.offset) return dbx409(res, "lookup_failed/incorrect_offset");
            s.push(body);
            fake.dbxChunks = (fake.dbxChunks || 0) + 1;
            if (name.endsWith("append_v2")) return send(res, 200, null);
            sessions.delete(arg.cursor.session_id);
            const r = commit(arg.commit, Buffer.concat(s));
            return r ? send(res, 200, r) : dbx409(res, "path/conflict/file");
        }
        if (name === "files/create_folder_v2") {
            if (at(arg.path)) return dbx409(res, "path/conflict/folder");
            const parent = at(arg.path.replace(/\/[^/]*$/, "") || "/");
            if (!parent) return dbx409(res, "path/not_found");
            return send(res, 200, { metadata: dbxMeta(t.add(parent.id, arg.path.slice(arg.path.lastIndexOf("/") + 1), "folder")) });
        }
        if (name === "files/move_v2" || name === "files/copy_v2") {
            const n = at(arg.from_path);
            if (!n) return dbx409(res, "from_lookup/not_found");
            if (at(arg.to_path)) return dbx409(res, "to/conflict/file");
            const parent = at(arg.to_path.replace(/\/[^/]*$/, "") || "/");
            if (!parent) return dbx409(res, "to/not_found");
            const dn = arg.to_path.slice(arg.to_path.lastIndexOf("/") + 1);
            let r;
            if (name === "files/move_v2") { n.parent = parent.id; n.name = dn; r = n; } else r = t.copy(n, parent.id, dn);
            return send(res, 200, { metadata: dbxMeta(r) });
        }
        if (name === "files/delete_v2") { const n = at(arg.path); if (!n) return dbx409(res, "path_lookup/not_found"); t.remove(n); return send(res, 200, { metadata: { name: n.name } }); }
        if (name === "files/search_v2") {
            const q = arg.query.toLowerCase();
            const hits = [...t.nodes.values()].filter((n) => n.parent !== null && n.name.toLowerCase().includes(q))
                .filter((n) => !arg.options || !arg.options.path || t.pathOf(n).indexOf(arg.options.path + "/") === 0);
            return send(res, 200, { matches: hits.map((n) => ({ metadata: { ".tag": "metadata", metadata: dbxMeta(n) } })), has_more: false });
        }
        if (name === "users/get_space_usage") return send(res, 200, { used: t.used(), allocation: { ".tag": "individual", allocated: 2 * 1024 * 1024 * 1024 } });
        if (name === "users/get_current_account") return send(res, 200, { account_id: "dbid:phoenix", email: "phoenix@dropbox.test", name: { display_name: "Phoenix Tester" } });
        if (name === "auth/token/revoke") { tokens.delete(/^Bearer (.+)$/.exec(req.headers.authorization)[1]); fake.revoked = (fake.revoked || 0) + 1; return send(res, 200, null); }
        return send(res, 400, "unknown endpoint " + name);
    }

    // ---- OneDrive (Microsoft Graph) ---------------------------------------------------------
    const dl = new Map(), graphUploads = new Map();
    function graphItem(n) {
        const t = trees.onedrive;
        const parentPath = n.parent === null ? undefined : t.pathOf(t.nodes.get(n.parent));
        const o = { id: n.id, name: n.name || "root", lastModifiedDateTime: new Date(n.mtime).toISOString(), eTag: "\"{" + n.id + "}," + n.version + "\"",
                    cTag: "\"c:{" + n.id + "}," + n.version + "\"", size: n.bytes ? n.bytes.length : 0,
                    parentReference: parentPath === undefined ? { driveId: "d1" } : { driveId: "d1", path: "/drive/root:" + (parentPath === "/" ? "" : parentPath.split("/").map(encodeURIComponent).join("/")) } };
        if (n.type === "folder") o.folder = { childCount: t.children(n.id).length };
        else {
            o.file = { mimeType: /\.png$/.test(n.name) ? "image/png" : "text/plain" };
            const token = crypto.randomBytes(8).toString("hex");
            dl.set(token, n.id);
            o["@microsoft.graph.downloadUrl"] = fake.origin + "/graph-dl/" + token;
        }
        return o;
    }
    const gErr = (res, status, code) => send(res, status, { error: { code, message: code } });
    function graph(req, res, u, body) {
        const t = trees.onedrive;
        let m = /^\/graph-dl\/([0-9a-f]+)$/.exec(u.pathname);
        if (m) {
            if (req.headers.authorization) return gErr(res, 400, "noAuthOnDownloadUrl");
            const n = t.nodes.get(dl.get(m[1]));
            if (!n) return send(res, 404, "");
            const [st, part, h] = ranged(req, n.bytes);
            return send(res, st, part, h);
        }
        m = /^\/graph-up\/([0-9a-f]+)$/.exec(u.pathname);
        if (m) {
            const up = graphUploads.get(m[1]);
            if (!up) return gErr(res, 404, "itemNotFound");
            if (req.method === "DELETE") { graphUploads.delete(m[1]); return send(res, 204, ""); }
            const cr = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers["content-range"] || "");
            if (!cr || Number(cr[1]) !== up.have) return gErr(res, 416, "invalidRange");
            if (body.length % 327680 !== 0 && Number(cr[2]) + 1 !== Number(cr[3])) return gErr(res, 400, "invalidChunkSize");
            up.parts.push(body);
            up.have += body.length;
            fake.graphChunks = (fake.graphChunks || 0) + 1;
            if (up.have < Number(cr[3])) return send(res, 202, { nextExpectedRanges: [up.have + "-"] });
            graphUploads.delete(m[1]);
            if (t.byPath(up.path) && up.behavior === "fail") return gErr(res, 409, "nameAlreadyExists");
            return send(res, 201, graphItem(t.put(up.path, Buffer.concat(up.parts))));
        }
        if (!bearer(req, "onedrive")) return gErr(res, 401, "InvalidAuthenticationToken");
        let rest = decodeURIComponent(u.pathname.replace(/^\/graph\/v1\.0/, ""));
        if (rest === "/me") return send(res, 200, { id: "u1", displayName: "Phoenix Tester", mail: "phoenix@onedrive.test", userPrincipalName: "phoenix@onedrive.test" });
        if (rest === "/me/drive") return send(res, 200, { id: "d1", quota: { used: t.used(), total: 5 * 1024 * 1024 * 1024, remaining: 1 } });
        rest = rest.replace(/^\/me\/drive/, "");
        let path, tail = "";
        if ((m = /^\/root(\/children|\/search\(q='(.*)'\))?$/.exec(rest))) { path = "/"; tail = m[1] || ""; }
        else if ((m = /^\/root:(\/.*?):(\/children|\/content|\/createUploadSession)?$/.exec(rest))) { path = m[1]; tail = m[2] || ""; }
        else return gErr(res, 400, "invalidRequest");
        const n = t.byPath(path);
        if (tail.indexOf("/search(") === 0) {
            const q = /search\(q='(.*)'\)/.exec(tail)[1].replace(/''/g, "'").toLowerCase();
            const hits = [...t.nodes.values()].filter((x) => x.parent !== null && x.name.toLowerCase().includes(q));
            return send(res, 200, { value: hits.map(graphItem) });
        }
        if (tail === "/children" && req.method === "GET") {
            if (!n) return gErr(res, 404, "itemNotFound");
            const all = t.children(n.id).map(graphItem);
            const skip = Number(u.searchParams.get("$skiptoken") || 0);
            const page = all.slice(skip, skip + 2);
            const out = { value: page };
            if (skip + 2 < all.length) out["@odata.nextLink"] = fake.origin + u.pathname + "?$skiptoken=" + (skip + 2);
            return send(res, 200, out);
        }
        if (tail === "/children" && req.method === "POST") {
            if (!n) return gErr(res, 404, "itemNotFound");
            const b = JSON.parse(body.toString("utf8"));
            if (t.child(n.id, b.name)) return gErr(res, 409, "nameAlreadyExists");
            return send(res, 201, graphItem(t.add(n.id, b.name, "folder")));
        }
        if (tail === "/content" && req.method === "PUT") {
            if (n && u.searchParams.get("@microsoft.graph.conflictBehavior") === "fail") return gErr(res, 409, "nameAlreadyExists");
            if (!t.byPath(path.replace(/\/[^/]*$/, "") || "/")) return gErr(res, 404, "itemNotFound");
            return send(res, n ? 200 : 201, graphItem(t.put(path, body)));
        }
        if (tail === "/createUploadSession") {
            const b = JSON.parse(body.toString("utf8") || "{}");
            const id = crypto.randomBytes(6).toString("hex");
            graphUploads.set(id, { path, have: 0, parts: [], behavior: b.item && b.item["@microsoft.graph.conflictBehavior"] });
            return send(res, 200, { uploadUrl: fake.origin + "/graph-up/" + id, expirationDateTime: new Date(Date.now() + 3600e3).toISOString() });
        }
        if (!n) return gErr(res, 404, "itemNotFound");
        if (req.method === "GET") return send(res, 200, graphItem(n));
        if (req.method === "DELETE") { t.remove(n); return send(res, 204, ""); }
        if (req.method === "PATCH") {
            const b = JSON.parse(body.toString("utf8"));
            const dir = b.parentReference ? t.byPath(decodeURIComponent(b.parentReference.path.replace(/^\/drive\/root:?/, "")) || "/") : t.nodes.get(n.parent);
            if (!dir) return gErr(res, 404, "itemNotFound");
            const there = t.child(dir.id, b.name || n.name);
            if (there && there !== n) {
                if (u.searchParams.get("@microsoft.graph.conflictBehavior") !== "replace") return gErr(res, 409, "nameAlreadyExists");
                t.remove(there);
            }
            n.parent = dir.id; n.name = b.name || n.name; n.version++;
            return send(res, 200, graphItem(n));
        }
        return gErr(res, 405, "notAllowed");
    }

    // ---- Google Drive -----------------------------------------------------------------------
    const FOLDER = "application/vnd.google-apps.folder";
    const resumables = new Map();
    function gfile(n) {
        const t = trees.googledrive;
        const o = { id: n.id === t.root.id ? "gd-root" : n.id, name: n.name || "My Drive", mimeType: n.type === "folder" ? FOLDER : n.mime || (/\.png$/.test(n.name) ? "image/png" : "text/plain"),
                    modifiedTime: new Date(n.mtime).toISOString(), version: String(n.version), parents: n.parent ? [n.parent] : [], capabilities: { canEdit: true } };
        if (n.type === "file") { o.size = String(n.bytes.length); o.md5Checksum = t.md5(n); }
        return o;
    }
    const gdErr = (res, status, reason) => send(res, status, { error: { code: status, message: reason, errors: [{ reason }] } });
    function gnode(id) { const t = trees.googledrive; return id === "root" ? t.root : t.nodes.get(id); }
    function gquery(q) {
        const t = trees.googledrive;
        const conds = q.split(/ and /);
        return [...t.nodes.values()].filter((n) => n.parent !== null && conds.every((c) => {
            let m;
            if ((m = /^'(.*)' in parents$/.exec(c))) return n.parent === (m[1] === "root" ? t.root.id : m[1].replace(/\\'/g, "'"));
            if ((m = /^trashed = (true|false)$/.exec(c))) return !!n.trashed === (m[1] === "true");
            if ((m = /^name contains '(.*)'$/.exec(c))) return n.name.toLowerCase().includes(m[1].replace(/\\'/g, "'").toLowerCase());
            if ((m = /^name = '(.*)'$/.exec(c))) return n.name === m[1].replace(/\\'/g, "'");
            return false;
        }));
    }
    // multipart/related -> [metadata, bytes]
    function related(req, body) {
        const b = /boundary=([^;]+)/.exec(req.headers["content-type"] || "")[1];
        const sep = Buffer.from("--" + b);
        const parts = [];
        let i = body.indexOf(sep);
        while (i >= 0) {
            const j = body.indexOf(sep, i + sep.length);
            if (j < 0) break;
            const part = body.subarray(i + sep.length + 2, j - 2);
            const h = part.indexOf("\r\n\r\n");
            parts.push(part.subarray(h + 4));
            i = j;
        }
        return [JSON.parse(parts[0].toString("utf8")), parts[1]];
    }
    function gdrive(req, res, u, body) {
        const t = trees.googledrive;
        let m = /^\/gdrive-resumable\/([0-9a-f]+)$/.exec(u.pathname);
        if (m) {
            const up = resumables.get(m[1]);
            if (!up) return gdErr(res, 404, "notFound");
            if (req.method === "DELETE") { resumables.delete(m[1]); return send(res, 204, ""); }
            const cr = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers["content-range"] || "");
            if (!cr || Number(cr[1]) !== up.have) return gdErr(res, 400, "badRange");
            if (body.length % 262144 !== 0 && Number(cr[2]) + 1 !== Number(cr[3])) return gdErr(res, 400, "badChunk");
            up.parts.push(body); up.have += body.length;
            fake.gdChunks = (fake.gdChunks || 0) + 1;
            if (up.have < Number(cr[3])) { res.writeHead(308, { Range: "bytes=0-" + (up.have - 1) }); return res.end(); }
            resumables.delete(m[1]);
            const bytes = Buffer.concat(up.parts);
            let n;
            if (up.id) { n = gnode(up.id); n.bytes = bytes; n.version++; n.mtime = Date.now(); } else n = t.add(up.meta.parents[0] === "root" ? t.root.id : up.meta.parents[0], up.meta.name, "file", bytes);
            return send(res, 200, gfile(n));
        }
        if (!bearer(req, "googledrive")) return gdErr(res, 401, "authError");
        if ((m = /^\/gdrive\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(u.pathname))) {
            const type = u.searchParams.get("uploadType");
            if (type === "multipart") {
                const [meta, bytes] = related(req, body);
                let n;
                if (m[1]) { n = gnode(m[1]); if (!n) return gdErr(res, 404, "notFound"); n.bytes = Buffer.from(bytes); n.version++; n.mtime = Date.now(); }
                else n = t.add(meta.parents[0] === "root" ? t.root.id : meta.parents[0], meta.name, "file", bytes);
                return send(res, 200, gfile(n));
            }
            if (type === "resumable") {
                const id = crypto.randomBytes(6).toString("hex");
                resumables.set(id, { id: m[1], meta: JSON.parse(body.toString("utf8") || "{}"), have: 0, parts: [] });
                return send(res, 200, "", { Location: fake.origin + "/gdrive-resumable/" + id });
            }
            return gdErr(res, 400, "badUploadType");
        }
        if (u.pathname === "/gdrive/drive/v3/about") return send(res, 200, { user: { emailAddress: "phoenix@gdrive.test", displayName: "Phoenix Tester", permissionId: "p1" },
                                                                           storageQuota: { limit: String(15 * 1024 * 1024 * 1024), usage: String(t.used()) } });
        if (u.pathname === "/gdrive/drive/v3/files" && req.method === "GET") {
            const all = gquery(u.searchParams.get("q") || "");
            const size = Number(u.searchParams.get("pageSize")) || 100;
            const start = Number(u.searchParams.get("pageToken") || 0);
            const out = { files: all.slice(start, start + Math.min(size, 2)).map(gfile) };
            if (start + 2 < all.length && size > 2) out.nextPageToken = String(start + 2);
            if (size <= 2) out.files = all.slice(0, size).map(gfile);
            return send(res, 200, out);
        }
        if (u.pathname === "/gdrive/drive/v3/files" && req.method === "POST") {
            const b = JSON.parse(body.toString("utf8"));
            const parent = gnode(b.parents[0]);
            if (!parent) return gdErr(res, 404, "notFound");
            return send(res, 200, gfile(t.add(parent.id, b.name, b.mimeType === FOLDER ? "folder" : "file", Buffer.alloc(0))));
        }
        if ((m = /^\/gdrive\/drive\/v3\/files\/([^/]+)(\/copy|\/export)?$/.exec(u.pathname))) {
            const n = gnode(decodeURIComponent(m[1]));
            if (!n || n.trashed) return gdErr(res, 404, "notFound");
            if (m[2] === "/copy") {
                const b = JSON.parse(body.toString("utf8"));
                return send(res, 200, gfile(t.copy(n, gnode(b.parents[0]).id, b.name)));
            }
            if (m[2] === "/export") return send(res, 200, Buffer.from("exported " + n.name), { "Content-Type": u.searchParams.get("mimeType") });
            if (req.method === "GET" && u.searchParams.get("alt") === "media") {
                const [st, part, h] = ranged(req, n.bytes);
                return send(res, st, part, h);
            }
            if (req.method === "GET") return send(res, 200, gfile(n));
            if (req.method === "PATCH") {
                const b = JSON.parse(body.toString("utf8") || "{}");
                if (b.trashed) { n.trashed = true; fake.trashed = (fake.trashed || 0) + 1; return send(res, 200, gfile(n)); }
                if (u.searchParams.get("addParents")) n.parent = gnode(u.searchParams.get("addParents")).id;
                if (b.name) n.name = b.name;
                n.version++;
                return send(res, 200, gfile(n));
            }
            if (req.method === "DELETE") { t.remove(n); return send(res, 204, ""); }
        }
        return gdErr(res, 404, "notFound");
    }

    // ---- Box --------------------------------------------------------------------------------
    const boxSessions = new Map();
    function boxItem(n) {
        const t = trees.box;
        const chain = [];
        for (let x = n.parent !== null ? t.nodes.get(n.parent) : null; x; x = x.parent !== null ? t.nodes.get(x.parent) : null) chain.unshift({ type: "folder", id: x.id, name: x.name || "All Files" });
        const o = { type: n.type, id: n.id, name: n.id === "0" ? "All Files" : n.name, modified_at: new Date(n.mtime).toISOString(), etag: String(n.version),
                    path_collection: { total_count: chain.length, entries: chain }, permissions: { can_upload: true } };
        if (n.type === "file") { o.size = n.bytes.length; o.sha1 = t.sha1(n); }
        return o;
    }
    const boxErr = (res, status, code) => send(res, status, { type: "error", status, code, message: code });
    function form(req, body) {
        const b = /boundary=([^;]+)/.exec(req.headers["content-type"] || "")[1];
        const sep = Buffer.from("--" + b);
        const out = {};
        let i = body.indexOf(sep);
        while (i >= 0) {
            const j = body.indexOf(sep, i + sep.length);
            if (j < 0) break;
            const part = body.subarray(i + sep.length + 2, j - 2);
            const h = part.indexOf("\r\n\r\n");
            const name = /name="([^"]+)"/.exec(part.subarray(0, h).toString("utf8"))[1];
            out[name] = part.subarray(h + 4);
            i = j;
        }
        return out;
    }
    function box(req, res, u, body) {
        const t = trees.box;
        let m = /^\/box-dl\/([^/]+)$/.exec(u.pathname);
        if (m) {
            const n = t.nodes.get(m[1]);
            if (!n) return send(res, 404, "");
            const [st, part, h] = ranged(req, n.bytes);
            return send(res, st, part, h);
        }
        if (!bearer(req, "box")) return boxErr(res, 401, "unauthorized");
        const up = u.pathname.indexOf("/box-up/api/2.0") === 0;
        const rest = u.pathname.replace(/^\/box-up\/api\/2\.0|^\/box\/2\.0/, "");
        if (up && rest === "/files/upload_sessions" || up && /^\/files\/[^/]+\/upload_sessions$/.test(rest)) {
            const b = JSON.parse(body.toString("utf8"));
            if (b.file_size < 20 * 1024 * 1024) return boxErr(res, 400, "file_size_too_small");
            const id = crypto.randomBytes(6).toString("hex");
            const fileId = (/^\/files\/([^/]+)\//.exec(rest) || [])[1];
            boxSessions.set(id, { folder: b.folder_id, name: b.file_name, size: b.file_size, fileId, parts: [] });
            return send(res, 201, { id, type: "upload_session", part_size: 8 * 1024 * 1024, total_parts: Math.ceil(b.file_size / (8 * 1024 * 1024)) });
        }
        if (up && (m = /^\/files\/upload_sessions\/([^/]+)(\/commit)?$/.exec(rest))) {
            const s = boxSessions.get(m[1]);
            if (!s) return boxErr(res, 404, "not_found");
            if (req.method === "DELETE") { boxSessions.delete(m[1]); return send(res, 204, ""); }
            if (!m[2]) {
                const digest = (/^sha=(.+)$/.exec(req.headers.digest || "") || [])[1];
                if (digest !== crypto.createHash("sha1").update(body).digest("base64")) return boxErr(res, 412, "bad_digest");
                const cr = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers["content-range"]);
                const part = { part_id: crypto.randomBytes(4).toString("hex").toUpperCase(), offset: Number(cr[1]), size: body.length, sha1: crypto.createHash("sha1").update(body).digest("hex") };
                s.parts.push([part, body]);
                fake.boxParts = (fake.boxParts || 0) + 1;
                return send(res, 200, { part });
            }
            const bytes = Buffer.concat(s.parts.sort((a, b) => a[0].offset - b[0].offset).map((p) => p[1]));
            const digest = (/^sha=(.+)$/.exec(req.headers.digest || "") || [])[1];
            if (digest !== crypto.createHash("sha1").update(bytes).digest("base64")) return boxErr(res, 422, "bad_digest");
            boxSessions.delete(m[1]);
            let n;
            if (s.fileId) { n = t.nodes.get(s.fileId); n.bytes = bytes; n.version++; } else n = t.add(s.folder, s.name, "file", bytes);
            return send(res, 201, { total_count: 1, entries: [boxItem(n)] });
        }
        if (up && (m = /^\/files(?:\/([^/]+))?\/content$/.exec(rest))) {
            const f = form(req, body);
            const attrs = JSON.parse(f.attributes.toString("utf8"));
            let n;
            if (m[1]) { n = t.nodes.get(m[1]); if (!n) return boxErr(res, 404, "not_found"); n.bytes = Buffer.from(f.file); n.version++; n.mtime = Date.now(); }
            else {
                if (t.child(attrs.parent.id, attrs.name)) return boxErr(res, 409, "item_name_in_use");
                n = t.add(attrs.parent.id, attrs.name, "file", f.file);
            }
            return send(res, 201, { total_count: 1, entries: [boxItem(n)] });
        }
        if (rest === "/users/me") return send(res, 200, { type: "user", id: "b1", name: "Phoenix Tester", login: "phoenix@box.test", space_amount: 10 * 1024 * 1024 * 1024, space_used: t.used() });
        if (rest === "/search") {
            const q = (u.searchParams.get("query") || "").toLowerCase();
            const hits = [...t.nodes.values()].filter((n) => n.parent !== null && n.name.toLowerCase().includes(q));
            return send(res, 200, { total_count: hits.length, entries: hits.map(boxItem) });
        }
        if (rest === "/folders" && req.method === "POST") {
            const b = JSON.parse(body.toString("utf8"));
            if (!t.nodes.get(b.parent.id)) return boxErr(res, 404, "not_found");
            if (t.child(b.parent.id, b.name)) return boxErr(res, 409, "item_name_in_use");
            return send(res, 201, boxItem(t.add(b.parent.id, b.name, "folder")));
        }
        if ((m = /^\/(folders|files)\/([^/]+)(\/items|\/content|\/copy)?$/.exec(rest))) {
            const n = t.nodes.get(m[2]);
            if (!n || (m[1] === "folders") !== (n.type === "folder")) return boxErr(res, 404, "not_found");
            if (m[3] === "/items") {
                const all = t.children(n.id).map(boxItem);
                const start = Number(u.searchParams.get("marker") || 0);
                const out = { entries: all.slice(start, start + 2), limit: 2 };
                if (start + 2 < all.length) out.next_marker = String(start + 2);
                return send(res, 200, out);
            }
            if (m[3] === "/content") { res.writeHead(302, { Location: fake.origin + "/box-dl/" + n.id }); return res.end(); }
            if (m[3] === "/copy") {
                const b = JSON.parse(body.toString("utf8"));
                if (t.child(b.parent.id, b.name || n.name)) return boxErr(res, 409, "item_name_in_use");
                return send(res, 201, boxItem(t.copy(n, b.parent.id, b.name || n.name)));
            }
            if (req.method === "GET") return send(res, 200, boxItem(n));
            if (req.method === "PUT") {
                const b = JSON.parse(body.toString("utf8"));
                const parent = b.parent ? t.nodes.get(b.parent.id) : t.nodes.get(n.parent);
                const there = t.child(parent.id, b.name || n.name);
                if (there && there !== n) return boxErr(res, 409, "item_name_in_use");
                n.parent = parent.id; n.name = b.name || n.name; n.version++;
                return send(res, 200, boxItem(n));
            }
            if (req.method === "DELETE") {
                if (n.type === "folder" && t.children(n.id).length && u.searchParams.get("recursive") !== "true") return boxErr(res, 400, "folder_not_empty");
                t.remove(n);
                return send(res, 204, "");
            }
        }
        return boxErr(res, 404, "not_found");
    }

    // ---- The server ---------------------------------------------------------------------------
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            const body = Buffer.concat(chunks);
            const u = new URL(req.url, "http://localhost");
            fake.requests.push({ method: req.method, path: u.pathname, query: u.search, range: req.headers.range || "", size: body.length });
            if (fake.offline) { req.socket.destroy(); return; }
            // The conformance suite's switches: every request 401, or 429 with a Retry-After.
            if (fake.unauthorizedAll && !/^\/oauth\//.test(u.pathname)) return send(res, 401, "", { "WWW-Authenticate": "Basic realm=\"test\"" });
            if (fake.throttleSeconds) return send(res, 429, "", { "Retry-After": String(fake.throttleSeconds) });
            try {
                let m;
                if ((m = /^\/oauth\/([a-z]+)\/(authorize|approve|token|revoke)$/.exec(u.pathname)) && PROVIDERS.includes(m[1])) return oauth(req, res, u, m[1], m[2], body);
                if (u.pathname === "/" + fake.users.s3.bucket || u.pathname.indexOf("/" + fake.users.s3.bucket + "/") === 0) return s3(req, res, u, body);
                if (/^\/dropbox\/2\//.test(u.pathname)) return dropbox(req, res, u, body, false);
                if (/^\/dropbox-content\/2\//.test(u.pathname)) return dropbox(req, res, u, body, true);
                if (/^\/(graph\/v1\.0|graph-dl|graph-up)\//.test(u.pathname) || u.pathname === "/graph/v1.0/me") return graph(req, res, u, body);
                if (/^\/(gdrive|gdrive-resumable)\//.test(u.pathname)) return gdrive(req, res, u, body);
                if (/^\/(box\/2\.0|box-up\/api\/2\.0|box-dl)\//.test(u.pathname)) return box(req, res, u, body);
                return dav(req, res, u, body);
            } catch (e) {
                send(res, 500, String(e && e.stack || e));
            }
        });
    });
    // The kit's conformance suite's FakeServer over this server (request: Node's http).
    fake.conformance = (request) => ({
        request, requests: () => fake.requests.length,
        unauthorized: (on) => { fake.unauthorizedAll = !!on; },
        throttle: (secs) => { fake.throttleSeconds = secs || 0; }
    });
    fake.start = (port) => new Promise((resolve) => server.listen(port || 0, "127.0.0.1", () => {
        fake.origin = "http://127.0.0.1:" + server.address().port;
        resolve(fake);
    }));
    fake.stop = () => new Promise((resolve) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => resolve()); });
    return fake;
}

module.exports = { createFakeDrives, createTree, png };

// node apps/drives/service/test/fake-drives.cjs [port]: a server to try the drives in the simulator.
if (require.main === module) {
    createFakeDrives().start(Number(process.argv[2]) || 8099).then((f) => {
        console.log("Fake drives at " + f.origin + " (WebDAV user " + f.users.dav.user + ", password " + f.users.dav.password + ")");
        console.log("drives/clients.json for it:\n" + JSON.stringify(f.clients(), null, 2));
    });
}
