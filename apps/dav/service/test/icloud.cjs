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
//   - Basic authentication with the Apple Account's email and an
//     app-specific password; anything else, the account's own password
//     included, is 401 on every host;
//   - groups kept as vCards of their own (X-ADDRESSBOOKSERVER-KIND:group),
//     calendars of VTODO only (a Reminders list of an account never upgraded).
// Here each host is a port on 127.0.0.1, and behind each partition is a
// Radicale (test/radicale.cjs) whose /alice/ is the home set: the partition
// rewrites its paths both ways.
//
//   const ic = await require("./test/icloud.cjs").start();
//   ic.presetHosts   {"com.webosphoenix.icloud": {carddav, caldav}}
//   ic.user, ic.appPassword, ic.accountPassword (refused, as iCloud does)
//   ic.card, ic.cal  the Radicales (put, get, del, list in their own paths)
//   ic.cardBook, ic.calHome, ic.calWork  the collections, as paths in the Radicales
//   ic.hits          [{host: "contacts"|"caldav"|"contacts-partition"|"caldav-partition", method, path}]
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

async function start(options) {
    options = options || {};
    const user = options.user || "wren.castillo@icloud.com";
    const appPassword = options.appPassword || "abcd-efgh-ijkl-mnop";
    const accountPassword = options.accountPassword || "MyAppleAccountPassword1";
    const card = await radicale.start();
    const cal = await radicale.start();
    const hits = [];
    const servers = {};
    const auth = "Basic " + Buffer.from(user + ":" + appPassword).toString("base64");
    const origin = (name) => "http://127.0.0.1:" + servers[name].address().port;

    function refuse(res) {
        res.writeHead(401, { "WWW-Authenticate": "Basic realm=\"iCloud\"", "Content-Type": "text/plain" });
        res.end("Unauthorized");
    }

    // contacts.icloud.com / caldav.icloud.com: the principal, and where its home is.
    function front(name, service) {
        return async (req, res) => {
            await readBody(req);
            const path = new URL(req.url, "http://x").pathname;
            hits.push({ host: name, method: req.method, path });
            if (path === "/.well-known/" + service) {
                res.writeHead(301, { Location: "/" });
                return res.end();
            }
            if (req.headers.authorization !== auth) return refuse(res);
            if (req.method !== "PROPFIND") { res.writeHead(405); return res.end(); }
            const principal = "/" + DSID + "/principal/";
            if (path === "/") {
                res.writeHead(207, { "Content-Type": "text/xml; charset=UTF-8" });
                return res.end(multistatus("/", "<current-user-principal><href>" + principal + "</href></current-user-principal>"));
            }
            if (path === principal) {
                const partition = origin(name + "-partition");
                const home = service === "carddav"
                    ? "<addressbook-home-set xmlns=\"urn:ietf:params:xml:ns:carddav\"><href xmlns=\"DAV:\">" + partition + "/" + DSID + "/carddavhome/</href></addressbook-home-set>"
                    : "<calendar-home-set xmlns=\"urn:ietf:params:xml:ns:caldav\"><href xmlns=\"DAV:\">" + partition + "/" + DSID + "/calendars/</href></calendar-home-set>";
                // What it was asked for and does not have (the other home set) is a 404 propstat.
                res.writeHead(207, { "Content-Type": "text/xml; charset=UTF-8" });
                return res.end(multistatus(principal, home + "<displayname>Wren Castillo</displayname>"));
            }
            res.writeHead(404);
            res.end();
        };
    }

    // pNN-contacts / pNN-caldav: the account's data (a Radicale behind it).
    function partition(name, backend, prefix) {
        const theirs = "/" + backend.user + "/";
        return async (req, res) => {
            const body = await readBody(req);
            const path = new URL(req.url, "http://x").pathname;
            hits.push({ host: name, method: req.method, path });
            if (req.headers.authorization !== auth) return refuse(res);
            if (path.indexOf(prefix) !== 0) { res.writeHead(404); return res.end(); }
            const headers = { Authorization: "Basic " + Buffer.from(backend.user + ":" + backend.password).toString("base64") };
            ["content-type", "depth", "if-match", "if-none-match"].forEach((h) => { if (req.headers[h]) headers[h] = req.headers[h]; });
            const r = await fetch(backend.url + theirs + path.slice(prefix.length), {
                method: req.method, headers, body: body && req.method !== "GET" && req.method !== "DELETE" ? body.split(prefix).join(theirs) : undefined
            });
            const text = (await r.text()).split(theirs).join(prefix);
            const out = {};
            ["content-type", "etag"].forEach((h) => { if (r.headers.get(h)) out[h] = r.headers.get(h); });
            res.writeHead(r.status, out);
            res.end(text);
        };
    }

    const cardPrefix = "/" + DSID + "/carddavhome/", calPrefix = "/" + DSID + "/calendars/";
    servers.contacts = await listen(front("contacts", "carddav"));
    servers.caldav = await listen(front("caldav", "caldav"));
    servers["contacts-partition"] = await listen(partition("contacts-partition", card, cardPrefix));
    servers["caldav-partition"] = await listen(partition("caldav-partition", cal, calPrefix));

    // What a new iCloud account has: the address book "card", the calendars
    // "home" and "work", and an old Reminders list (VTODO only).
    await card.mkAddressbook("card", "Contacts");
    await cal.mkCalendar("home", "Home");
    await cal.mkCalendar("work", "Work");
    const r = await cal.dav("MKCALENDAR", "/" + cal.user + "/tasks/",
        "<?xml version=\"1.0\"?><c:mkcalendar xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:set><d:prop>" +
        "<d:displayname>Reminders</d:displayname><c:supported-calendar-component-set><c:comp name=\"VTODO\"/></c:supported-calendar-component-set>" +
        "</d:prop></d:set></c:mkcalendar>", { "Content-Type": "application/xml" });
    if (r.status !== 201) throw new Error("MKCALENDAR tasks failed: " + r.status);

    return {
        user, appPassword, accountPassword, card, cal, hits, dsid: DSID,
        contactsUrl: origin("contacts") + "/", caldavUrl: origin("caldav") + "/",
        presetHosts: { "com.webosphoenix.icloud": { carddav: origin("contacts") + "/", caldav: origin("caldav") + "/" } },
        // Paths in the Radicales of what the partitions show.
        cardBook: "/" + card.user + "/card/",
        calHome: "/" + cal.user + "/home/",
        calWork: "/" + cal.user + "/work/",
        stop() {
            Object.keys(servers).forEach((k) => servers[k].close());
            card.stop();
            cal.stop();
        }
    };
}

module.exports = { start, available: radicale.available, DSID };
