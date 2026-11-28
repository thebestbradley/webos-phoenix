// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for iCloud's CardDAV and CalDAV servers (tests only), for the
// iCloud preset (apps/dav/service/lib/presets.js): the tests
// (apps/dav/service/icloud.test.ts, tools/test-icloud-sync.cjs) point the
// preset at it with the image's setting dav/presets.json.
//
// It does what clients report iCloud does (Apple does not document it; DAVx5,
// davx5.com/tested-with/icloud; vdirsyncer's iCloud notes):
//   - two front hosts, contacts.icloud.com and caldav.icloud.com, each
//     with RFC 6764's /.well-known/carddav or /.well-known/caldav (a
//     redirect to "/"), answering current-user-principal with
//     /<dsid>/principal/ (a number, not the user name);
//   - the principal names home sets on the account's partition, another
//     host: https://pNN-contacts.icloud.com:443/<dsid>/carddavhome/ (one
//     address book, card/) and https://pNN-caldav.icloud.com:443/<dsid>/calendars/;
//     Apple moves an account to another partition now and then (pNN
//     changes, the paths stay): movePartition();
//   - Basic authentication with the Apple Account's email and an
//     app-specific password; anything else, the account's own password
//     included, is 401 on every host;
//   - groups kept as vCards of their own (X-ADDRESSBOOKSERVER-KIND:group),
//     calendars of VTODO only (a Reminders list of an account never upgraded);
//   - several Apple Accounts on the same hosts, each with its own dsid
//     (addUser);
//   - and what a test makes it do: 503 / 429 with Retry-After, connections
//     dropped before or after a request is carried out (faults), slow
//     answers (delayMs), sync-collection answered in pages ending in a 507
//     (pageSize), sync-tokens that expire (expireSyncTokens), a calendar
//     shared with the user read-only (addSharedCalendar), and an account of
//     iCloud in mainland China, whose home sets (or well-known redirect) are
//     on *.icloud.com.cn (addUser({region: "cn"})).
// Here each host is a port on 127.0.0.1, and behind each partition is a
// Radicale per user and service (test/radicale.cjs) whose /alice/ is the
// home set: the partition rewrites its paths both ways.
//
//   const ic = await require("./test/icloud.cjs").start();
//   ic.presetHosts   {"com.webosphoenix.icloud": {carddav, caldav}}
//   ic.user, ic.appPassword, ic.accountPassword (refused, as iCloud does)
//   ic.card, ic.cal  the Radicales (put, get, del, list in their own paths)
//   ic.cardBook, ic.calHome, ic.calWork, ic.calTasks  the collections, as paths in the Radicales
//   ic.hits          [{host: "contacts"|"caldav"|"contacts-partition"|"caldav-partition", method, path, partition?}]
//   await ic.addUser({user, appPassword, dsid, region?, cnRedirect?}) -> the same fields for another Apple Account
//   await ic.movePartition(u?)   the account moves to new partition hosts (the old ones answer 404)
//   ic.faults.push({host?, method?, path?: RegExp, status?, headers?, body?, drop?: "before"|"after", times?})
//   ic.pageSize, ic.delayMs, ic.expireSyncTokens(), await ic.addSharedCalendar(u, name, {advertise})
//   ic.stop()

"use strict";

const http = require("http");
const radicale = require("./radicale.cjs");

const DSID = "10022002";

function listen(handler) {
    return new Promise((resolve, reject) => {
        const srv = http.createServer(handler);
        srv.listen(0, "127.0.0.1", () => resolve(srv));
        srv.on("error", reject);
    });
}

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
}

function multistatus(href, props) {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
        "<multistatus xmlns=\"DAV:\" xmlns:CS=\"http://calendarserver.org/ns/\">" +
        "<response><href>" + href + "</href><propstat><prop>" + props + "</prop>" +
        "<status>HTTP/1.1 200 OK</status></propstat></response></multistatus>";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN_RE = /(<(?:[A-Za-z]+:)?sync-token>)([^<]*)(<\/(?:[A-Za-z]+:)?sync-token>)/;
// A calendar shared with you read-only (RFC 3744 privileges): it may be
// read, and its own properties (colour, name) set, not its events.
const READ_ONLY_PRIVILEGES = "<current-user-privilege-set><privilege><read /></privilege>" +
    "<privilege><read-current-user-privilege-set /></privilege><privilege><write-properties /></privilege>" +
    "<privilege><C:read-free-busy xmlns:C=\"urn:ietf:params:xml:ns:caldav\" /></privilege></current-user-privilege-set>";

async function start(options) {
    options = options || {};
    const hits = [];
    const servers = {};
    const users = [];
    const faults = [];
    const state = { pageSize: 0, delayMs: 0, expired: null, nextPartition: 1 };
    const origin = (name) => "http://127.0.0.1:" + servers[name].address().port;
    const cardPrefix = (u) => "/" + u.dsid + "/carddavhome/";
    const calPrefix = (u) => "/" + u.dsid + "/calendars/";

    function refuse(res) {
        res.writeHead(401, { "WWW-Authenticate": "Basic realm=\"iCloud\"", "Content-Type": "text/plain" });
        res.end("Unauthorized");
    }

    function userOf(req) { return users.find((u) => req.headers.authorization === u.auth) || null; }

    // A fault the test asked for, used up as it fires.
    function faultFor(host, req, path) {
        const i = faults.findIndex((f) => (!f.host || f.host === host) && (!f.method || f.method === req.method) &&
                                          (!f.path || f.path.test(path)));
        if (i < 0) return null;
        const f = faults[i];
        f.times = (f.times || 1) - 1;
        if (f.times <= 0) faults.splice(i, 1);
        return f;
    }

    // A status answer, or the connection dropped before anything is done.
    function fireEarly(f, req, res) {
        if (f.drop === "before") { req.socket.destroy(); return true; }
        if (f.status) {
            res.writeHead(f.status, Object.assign({ "Content-Type": "text/plain" }, f.headers || {}));
            res.end(f.body || "");
            return true;
        }
        return false;
    }

    // contacts.icloud.com / caldav.icloud.com: the principal, and where its home is.
    function front(name, service) {
        return async (req, res) => {
            await readBody(req);
            const path = new URL(req.url, "http://x").pathname;
            hits.push({ host: name, method: req.method, path });
            const f = faultFor(name, req, path);
            if (f && fireEarly(f, req, res)) return;
            const u = userOf(req);
            if (path === "/.well-known/" + service) {
                // A mainland-China account's goes to iCloud's hosts there.
                const cn = u && u.region === "cn" && u.cnRedirect;
                res.writeHead(301, { Location: cn ? "https://" + (service === "carddav" ? "contacts" : "caldav") + ".icloud.com.cn/" : "/" });
                return res.end();
            }
            if (!u) return refuse(res);
            if (req.method !== "PROPFIND") { res.writeHead(405); return res.end(); }
            const principal = "/" + u.dsid + "/principal/";
            if (path === "/") {
                res.writeHead(207, { "Content-Type": "text/xml; charset=UTF-8" });
                return res.end(multistatus("/", "<current-user-principal><href>" + principal + "</href></current-user-principal>"));
            }
            if (path === principal) {
                const partition = u.region === "cn"
                    ? "https://p52-" + (service === "carddav" ? "contacts" : "caldav") + ".icloud.com.cn:443"
                    : origin(name + "-partition-" + u.partition);
                const home = service === "carddav"
                    ? "<addressbook-home-set xmlns=\"urn:ietf:params:xml:ns:carddav\"><href xmlns=\"DAV:\">" + partition + cardPrefix(u) + "</href></addressbook-home-set>"
                    : "<calendar-home-set xmlns=\"urn:ietf:params:xml:ns:caldav\"><href xmlns=\"DAV:\">" + partition + calPrefix(u) + "</href></calendar-home-set>";
                // What it was asked for and does not have (the other home set) is a 404 propstat.
                res.writeHead(207, { "Content-Type": "text/xml; charset=UTF-8" });
                return res.end(multistatus(principal, home + "<displayname>" + u.displayName + "</displayname>"));
            }
            res.writeHead(404);
            res.end();
        };
    }

    // Sync-collection in pages: the token "page:<the server's token>:<offset>"
    // stands for the rest of an answer.
    function pageToken(orig, offset) { return "page:" + Buffer.from(orig, "utf8").toString("base64url") + ":" + offset; }
    function readPageToken(t) {
        const m = /^page:([A-Za-z0-9_-]*):(\d+)$/.exec(t || "");
        return m ? { orig: Buffer.from(m[1], "base64url").toString("utf8"), offset: Number(m[2]) } : null;
    }

    // pNN-contacts / pNN-caldav: the account's data (a Radicale behind it).
    function partition(name, kind, number) {
        return async (req, res) => {
            let body = await readBody(req);
            const path = new URL(req.url, "http://x").pathname;
            hits.push({ host: name, method: req.method, path, partition: number });
            const f = faultFor(name, req, path);
            if (f && f.drop !== "after" && fireEarly(f, req, res)) return;
            const u = userOf(req);
            if (!u) return refuse(res);
            const prefix = kind === "card" ? cardPrefix(u) : calPrefix(u);
            // Moved to another partition: this one no longer has the account.
            if (u.partition !== number || path.indexOf(prefix) !== 0) { res.writeHead(404); return res.end(); }
            const backend = kind === "card" ? u.card : u.cal;
            const theirs = "/" + backend.user + "/";
            const shared = kind === "cal" && u.shared.find((s) => path.indexOf(prefix + s.name + "/") === 0 && path !== prefix + s.name + "/");
            if (shared && (req.method === "PUT" || req.method === "DELETE")) {
                res.writeHead(403, { "Content-Type": "text/xml; charset=UTF-8" });
                return res.end("<?xml version=\"1.0\"?><error xmlns=\"DAV:\"><need-privileges><resource><href>" + path +
                               "</href><privilege><write-content/></privilege></resource></need-privileges></error>");
            }
            let paging = null;
            if (req.method === "REPORT" && /sync-collection/.test(body)) {
                const m = TOKEN_RE.exec(body);
                let token = m ? m[2] : "";
                const page = readPageToken(token);
                if (page) token = page.orig;
                else if (token && state.expired && !state.expired.has(path)) token = "http://radicale.org/ns/sync/expired";
                else if (!token && state.expired) state.expired.add(path);
                if (m) body = body.replace(TOKEN_RE, (all, a, t, b) => a + token + b);
                if (state.pageSize) paging = { offset: page ? page.offset : 0, asked: token };
            }
            const headers = { Authorization: "Basic " + Buffer.from(backend.user + ":" + backend.password).toString("base64") };
            ["content-type", "depth", "if-match", "if-none-match"].forEach((h) => { if (req.headers[h]) headers[h] = req.headers[h]; });
            const r = await fetch(backend.url + theirs + path.slice(prefix.length), {
                method: req.method, headers, body: body && req.method !== "GET" && req.method !== "DELETE" ? body.split(prefix).join(theirs) : undefined
            });
            let text = (await r.text()).split(theirs).join(prefix);
            if (paging && r.status === 207) {
                const all = text.match(/<response>[\s\S]*?<\/response>/g) || [];
                const tm = TOKEN_RE.exec(text);
                const more = paging.offset + state.pageSize < all.length;
                const token = more ? pageToken(paging.asked, paging.offset + state.pageSize) : (tm ? tm[2] : "");
                text = "<?xml version='1.0' encoding='utf-8'?>\n<multistatus xmlns=\"DAV:\">" +
                    all.slice(paging.offset, paging.offset + state.pageSize).join("") +
                    (more ? "<response><href>" + path + "</href><status>HTTP/1.1 507 Insufficient Storage</status></response>" : "") +
                    "<sync-token>" + token + "</sync-token></multistatus>";
            }
            if (kind === "cal" && req.method === "PROPFIND" && r.status === 207) {
                u.shared.filter((s) => s.advertise !== "write").forEach((s) => {
                    text = text.replace(/<response>[\s\S]*?<\/response>/g, (resp) =>
                        resp.indexOf("<href>" + prefix + s.name + "/</href>") >= 0
                            ? resp.replace(/<current-user-privilege-set>[\s\S]*?<\/current-user-privilege-set>/, READ_ONLY_PRIVILEGES)
                            : resp);
                });
            }
            if (state.delayMs) await sleep(state.delayMs);
            // Carried out, and the answer lost on the way back.
            if (f && f.drop === "after") { req.socket.destroy(); return; }
            const out = {};
            ["content-type", "etag"].forEach((h) => { if (r.headers.get(h)) out[h] = r.headers.get(h); });
            res.writeHead(r.status, out);
            res.end(text);
        };
    }

    async function ensurePartition(number) {
        for (const [name, kind] of [["contacts-partition", "card"], ["caldav-partition", "cal"]]) {
            const key = name + "-" + number;
            if (!servers[key]) servers[key] = await listen(partition(name, kind, number));
        }
    }

    // An Apple Account: its address book "card", its calendars "home" and
    // "work", and an old Reminders list (VTODO only).
    async function addUser(o) {
        o = o || {};
        const u = {
            user: o.user || "wren.castillo@icloud.com",
            appPassword: o.appPassword || "abcd-efgh-ijkl-mnop",
            accountPassword: o.accountPassword || "MyAppleAccountPassword1",
            dsid: o.dsid || DSID,
            displayName: o.displayName || "Wren Castillo",
            region: o.region || "",
            cnRedirect: !!o.cnRedirect,
            partition: state.nextPartition++,
            shared: []
        };
        u.auth = "Basic " + Buffer.from(u.user + ":" + u.appPassword).toString("base64");
        await ensurePartition(u.partition);
        u.card = await radicale.start();
        u.cal = await radicale.start();
        await u.card.mkAddressbook("card", "Contacts");
        await u.cal.mkCalendar("home", "Home");
        await u.cal.mkCalendar("work", "Work");
        const r = await u.cal.dav("MKCALENDAR", "/" + u.cal.user + "/tasks/",
            "<?xml version=\"1.0\"?><c:mkcalendar xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:set><d:prop>" +
            "<d:displayname>Reminders</d:displayname><c:supported-calendar-component-set><c:comp name=\"VTODO\"/></c:supported-calendar-component-set>" +
            "</d:prop></d:set></c:mkcalendar>", { "Content-Type": "application/xml" });
        if (r.status !== 201) throw new Error("MKCALENDAR tasks failed: " + r.status);
        users.push(u);
        return Object.assign(u, {
            // Paths in the Radicales of what the partitions show.
            cardBook: "/" + u.card.user + "/card/",
            calHome: "/" + u.cal.user + "/home/",
            calWork: "/" + u.cal.user + "/work/",
            calTasks: "/" + u.cal.user + "/tasks/"
        });
    }

    servers.contacts = await listen(front("contacts", "carddav"));
    servers.caldav = await listen(front("caldav", "caldav"));
    const first = await addUser(options);

    return {
        user: first.user, appPassword: first.appPassword, accountPassword: first.accountPassword,
        card: first.card, cal: first.cal, cardBook: first.cardBook, calHome: first.calHome, calWork: first.calWork,
        calTasks: first.calTasks, first, hits, faults, dsid: first.dsid,
        contactsUrl: origin("contacts") + "/", caldavUrl: origin("caldav") + "/",
        presetHosts: { "com.webosphoenix.icloud": { carddav: origin("contacts") + "/", caldav: origin("caldav") + "/" } },
        addUser,
        // The origins of a user's partition now (as the principal names them).
        partitionOrigins(u) {
            u = u || first;
            return { contacts: origin("contacts-partition-" + u.partition), caldav: origin("caldav-partition-" + u.partition) };
        },
        async movePartition(u) {
            u = u || first;
            const n = state.nextPartition++;
            await ensurePartition(n);
            u.partition = n;
        },
        // A calendar shared with the user: advertise "read" (its privileges
        // say read-only) or "write" (they do not, and the server refuses the
        // change anyway). Writes to its events are 403 either way.
        async addSharedCalendar(u, name, o) {
            u = u || first;
            await u.cal.mkCalendar(name, (o && o.displayName) || name);
            u.shared.push({ name, advertise: (o && o.advertise) || "read" });
            return "/" + u.cal.user + "/" + name + "/";
        },
        // Every sync-token given out so far is refused (403 valid-sync-token),
        // each collection's until a client starts it again with an empty one.
        expireSyncTokens() { state.expired = new Set(); },
        get pageSize() { return state.pageSize; },
        set pageSize(n) { state.pageSize = n || 0; },
        get delayMs() { return state.delayMs; },
        set delayMs(n) { state.delayMs = n || 0; },
        stop() {
            Object.keys(servers).forEach((k) => servers[k].close());
            users.forEach((u) => { u.card.stop(); u.cal.stop(); });
        }
    };
}

module.exports = { start, available: radicale.available, DSID };
