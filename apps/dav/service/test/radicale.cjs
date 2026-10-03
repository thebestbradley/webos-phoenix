// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Starts a throwaway Radicale CardDAV / CalDAV server (pip install radicale)
// on 127.0.0.1 with a temporary storage folder and one user, for the DAV
// tests (apps/dav/service/sync.test.ts, tools/test-dav-sync.cjs). Also a
// few raw WebDAV calls to set up and inspect the server side.

"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");

function available() {
    return spawnSync("python3", ["-c", "import radicale"], { stdio: "ignore" }).status === 0;
}

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, "127.0.0.1", () => { const p = srv.address().port; srv.close(() => resolve(p)); });
        srv.on("error", reject);
    });
}

async function start(options) {
    options = options || {};
    const user = options.user || "alice", password = options.password || "wonderland-app-password";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-radicale-"));
    const port = options.port || await freePort();
    fs.writeFileSync(path.join(dir, "users"), `${user}:${password}\n`);
    fs.writeFileSync(path.join(dir, "config"), [
        "[server]", `hosts = 127.0.0.1:${port}`,
        "[auth]", "type = htpasswd", `htpasswd_filename = ${path.join(dir, "users")}`, "htpasswd_encryption = plain",
        "[storage]", `filesystem_folder = ${path.join(dir, "collections")}`,
        "[logging]", "level = warning", ""
    ].join("\n"));
    const proc = spawn("python3", ["-m", "radicale", "--config", path.join(dir, "config")], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d; });
    const url = `http://127.0.0.1:${port}`;
    const auth = "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
    const until = Date.now() + 15000;
    for (;;) {
        try { await fetch(url + "/.web/"); break; } catch (e) { /* not up yet */ }
        if (Date.now() > until || proc.exitCode !== null) throw new Error("Radicale did not start: " + stderr);
        await new Promise((r) => setTimeout(r, 100));
    }
    async function dav(method, p, body, headers) {
        const res = await fetch(url + p, { method, body, headers: Object.assign({ Authorization: auth }, headers || {}) });
        return { status: res.status, etag: res.headers.get("etag"), body: await res.text() };
    }
    const server = {
        url, user, password, dir, dav,
        async mkAddressbook(name, displayName) {
            const r = await dav("MKCOL", `/${user}/${name}/`,
                `<?xml version="1.0"?><d:mkcol xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:set><d:prop>` +
                `<d:resourcetype><d:collection/><c:addressbook/></d:resourcetype><d:displayname>${displayName || name}</d:displayname>` +
                `</d:prop></d:set></d:mkcol>`, { "Content-Type": "application/xml" });
            if (r.status !== 201) throw new Error("MKCOL failed: " + r.status + " " + r.body);
            return `/${user}/${name}/`;
        },
        async mkCalendar(name, displayName) {
            const r = await dav("MKCALENDAR", `/${user}/${name}/`,
                `<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop>` +
                `<d:displayname>${displayName || name}</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/><c:comp name="VTODO"/></c:supported-calendar-component-set>` +
                `</d:prop></d:set></c:mkcalendar>`, { "Content-Type": "application/xml" });
            if (r.status !== 201) throw new Error("MKCALENDAR failed: " + r.status + " " + r.body);
            return `/${user}/${name}/`;
        },
        put(p, data, type) { return dav("PUT", p, data, { "Content-Type": type || (p.endsWith(".vcf") ? "text/vcard" : "text/calendar") }); },
        get(p) { return dav("GET", p); },
        del(p) { return dav("DELETE", p); },
        // Hrefs (paths) of the resources in a collection.
        async list(p) {
            const r = await dav("PROPFIND", p, `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`,
                { Depth: "1", "Content-Type": "application/xml" });
            return [...r.body.matchAll(/<(?:[a-zA-Z]+:)?href>([^<]+)<\/(?:[a-zA-Z]+:)?href>/g)].map((m) => decodeURIComponent(m[1]))
                .filter((h) => h !== p);
        },
        stop() {
            proc.kill();
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        }
    };
    return server;
}

module.exports = { available, start };
