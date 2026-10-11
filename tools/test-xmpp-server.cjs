#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Jabber (XMPP) account against a real XMPP server: Prosody, started
// here on this computer (ports 15222 and 15280, a throwaway data folder and
// a certificate made for localhost), with the device's own code paths: the
// connector (apps/connectors/xmpp/service/connector.js) on the kit as run-js-service
// runs it, Node's TCP, STARTTLS with the certificate checked, SASL SCRAM,
// stream management; db8 and the accounts service in memory. It checks:
//
//   1. the sign-in (the server given as host and port: localhost has no SRV);
//   2. the roster as a contact and a buddy, the buddy's presence;
//   3. a message out (stream management's acknowledgement makes it
//      successful) and one in, a carbon of what another client of the same
//      account sends, the archive (MAM) after a reconnect;
//   4. a picture through Prosody's HTTP file share (XEP-0363), fetched back;
//   5. receipts (XEP-0184) from a client that sends them.
//
//   node tools/test-xmpp-server.cjs          (skips when Prosody is not installed:
//                                             apt install prosody, about 4 MB)
//
// Needs the connector kit built (cd apps && npm run build -w @phoenix/connector-kit).

"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const KIT = path.join(REPO, "apps/shared/connector-kit/lib");
let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
    for (let t = 0; t < (ms || 10000); t += 50) {
        const v = await fn();
        if (v) return v;
        await sleep(50);
    }
    return null;
}
function which(cmd) {
    try { return execFileSync("sh", ["-c", "command -v " + cmd]).toString().trim(); } catch (e) { return ""; }
}

async function main() {
    if (!which("prosody") || !which("prosodyctl")) {
        console.log("skip: Prosody is not installed (apt install prosody)");
        return;
    }
    if (!fs.existsSync(path.join(KIT, "index.js"))) {
        console.error("The connector kit is not built: cd apps && npm run build -w @phoenix/connector-kit");
        process.exit(2);
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-prosody-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "localhost.key"), "-out", path.join(dir, "localhost.crt"),
                             "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
    const cfg = path.join(dir, "prosody.cfg.lua");
    const root = process.getuid && process.getuid() === 0;
    fs.writeFileSync(cfg, [
        root ? "run_as_root = true\nprosody_user = \"root\"\nprosody_group = \"root\"" : "",
        `data_path = "${dir}/data"`, `pidfile = "${dir}/prosody.pid"`, `log = { info = "${dir}/prosody.log" }`,
        `modules_enabled = { "roster"; "saslauth"; "tls"; "disco"; "carbons"; "mam"; "smacks"; "ping"; "vcard_legacy"; "posix" }`,
        `modules_disabled = { "s2s" }`, "c2s_require_encryption = true", "authentication = \"internal_hashed\"",
        "default_archive_policy = true", "c2s_ports = { 15222 }", "c2s_interfaces = { \"127.0.0.1\" }", "s2s_ports = { }",
        "http_ports = { 15280 }", "http_interfaces = { \"127.0.0.1\" }", "https_ports = { }",
        `ssl = { key = "${dir}/localhost.key"; certificate = "${dir}/localhost.crt"; }`,
        "VirtualHost \"localhost\"",
        "Component \"upload.localhost\" \"http_file_share\"", "    http_file_share_size_limit = 10485760",
        "    http_host = \"localhost\"", "    http_external_url = \"http://localhost:15280/\""
    ].join("\n") + "\n");
    fs.mkdirSync(path.join(dir, "data"));
    for (const [u, pw] of [["me", "secret-me"], ["ada", "secret-ada"]])
        execFileSync("prosodyctl", ["--config", cfg, "register", u, "localhost", pw], { stdio: "ignore" });
    const prosody = spawn("prosody", ["--config", cfg, "-F"], { stdio: "ignore" });
    // The device checks the server's certificate: this one is ours.
    process.env.NODE_EXTRA_CA_CERTS = path.join(dir, "localhost.crt");
    try {
        await until(() => new Promise((r) => { const s = require("net").connect(15222, "127.0.0.1", () => { s.end(); r(true); }); s.on("error", () => r(false)); }), 10000);
        await run(dir);
    } finally {
        prosody.kill();
        await sleep(300);
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

async function run(dir) {
    // Node reads NODE_EXTRA_CA_CERTS when it starts: give tls the certificate itself.
    const tls = require("tls");
    const ca = fs.readFileSync(path.join(dir, "localhost.crt"), "utf8");
    const origConnect = tls.connect;
    tls.connect = function (o, cb) { return origConnect.call(tls, Object.assign({ ca: [ca].concat(tls.rootCertificates) }, o), cb); };

    const kit = require(KIT);
    const device = require(path.join(KIT, "device.js"));
    const synckit = require(path.join(REPO, "apps/shared/synckit/src/index.js"));
    const memdb = require(path.join(REPO, "apps/shared/synckit/src/test/memdb.js"));
    const { loadCommonJs } = require(path.join(KIT, "tools/load.js"));
    const xmpp = loadCommonJs(path.join(REPO, "apps/connectors/xmpp/service/connector.js"), { "@phoenix/connector-kit": kit, "@phoenix/synckit": synckit });
    const C = require(path.join(REPO, "apps/connectors/xmpp/service/lib/client.js"));
    const X = require(path.join(REPO, "apps/connectors/xmpp/service/lib/xml.js"));
    const template = JSON.parse(fs.readFileSync(path.join(REPO, "apps/connectors/xmpp/public/accounts/com.webosphoenix.xmpp/com.webosphoenix.xmpp.json"), "utf8"));
    const KINDS = { "com.palm.contact.xmpp:1": "com.palm.contact:1", "com.palm.immessage.xmpp:1": "com.palm.immessage:1",
                    "com.palm.immessage:1": "com.palm.message:1", "com.palm.imloginstate.xmpp:1": "com.palm.imloginstate:1",
                    "com.palm.imbuddystatus.xmpp:1": "com.palm.imbuddystatus:1" };
    const db = memdb.createMemDb(Object.assign({}, memdb.KIND_PARENTS, KINDS));
    const tempdb = memdb.createMemDb(KINDS);
    const accounts = {}, credentials = {}, toasts = [];
    let methods = {};
    const bus = memdb.createFakeBus({ db, tempdb, accounts, credentials, handlers: {
        "luna://com.webos.notification/createToast": (p) => { toasts.push(p); return { returnValue: true }; },
        "luna://org.webosports.service.messaging/putMessage": async (p) => {
            const addr = p.message.folder === "inbox" ? p.message.from.addr : p.message.to[0].addr;
            const r = await db.put([Object.assign({ conversations: ["thread-" + addr] }, p.message)]);
            return { returnValue: true, threadids: ["thread-" + addr] };
        },
        "luna://com.palm.service.accounts/listAccounts": () => ({ returnValue: true, results: Object.values(accounts) }),
        "luna://org.webosphoenix.service.xmpp/*": (p, uri) => methods[uri.slice(uri.lastIndexOf("/") + 1)](p)
    } });
    const files = { "/media/internal/DCIM/100PHNX/pixel.png": { bytes: new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")), mimeType: "image/png" } };
    const written = {};
    methods = kit.createConnectorService(xmpp, {
        luna: bus, request: synckit.createRequest({}), periodicSync: false, net: device.nodeNet(),
        readFile: async (p) => files[p],
        writeFile: async (svc, name, bytes) => { written[name] = bytes; return "/media/internal/.phoenix/connector-files/" + svc + "/" + name; },
        log: () => {}
    });
    const ACCOUNT = "prosody-1";
    const messages = () => Object.values(db.objects).filter((o) => !o._del && o._kind === "com.palm.immessage.xmpp:1");

    // 1. Sign in.
    const bad = await methods.checkCredentials({ username: "me@localhost", password: "wrong", config: { host: "127.0.0.1", port: 15222 } });
    check(bad.returnValue === false && bad.errorCode === "401_UNAUTHORIZED", "a wrong password is 401_UNAUTHORIZED (" + bad.errorCode + ")");
    const r = await methods.checkCredentials({ username: "me@localhost", password: "secret-me", config: { host: "127.0.0.1", port: 15222 } });
    if (!check(r.returnValue, "signs in: TCP, STARTTLS (certificate checked), SCRAM (" + (r.errorText || r.config && r.config.boundJid) + ")")) return;
    check(r.config.tls === true, "the connection was encrypted");

    // Ada, another client: in the account's roster, and her client sends receipts.
    const ada = C.createClient({ net: Object.assign({ supports: { srv: false, tcp: true, websocket: false }, allowHost() {} }, device.nodeNet()),
                                 jid: "ada@localhost", password: "secret-ada", host: "127.0.0.1", port: 15222, resource: "phone" });
    const adaGot = [];
    ada.on("stanza", (el) => {
        if (!el.is("message")) return;
        adaGot.push(el);
        const req = el.getChild("request", "urn:xmpp:receipts");
        if (req && el.attrs.id) ada.send(X.el("message", { to: el.attrs.from, id: "rcpt-" + el.attrs.id }, X.el("received", { xmlns: "urn:xmpp:receipts", id: el.attrs.id })));
    });
    ada.on("stanza", (el) => { if (el.is("presence") && el.attrs.type === "subscribe") ada.send(X.el("presence", { to: el.attrs.from, type: "subscribed" })); });
    await ada.connect();
    ada.send(X.el("presence"));
    // Me, from another client: Ada in the roster, both ways (RFC 6121 3).
    const other = C.createClient({ net: Object.assign({ supports: { srv: false, tcp: true, websocket: false }, allowHost() {} }, device.nodeNet()),
                                   jid: "me@localhost", password: "secret-me", host: "127.0.0.1", port: 15222, resource: "laptop" });
    await other.connect();
    await other.iq(X.el("iq", { type: "set" }, X.el("query", { xmlns: "jabber:iq:roster" }, X.el("item", { jid: "ada@localhost", name: "Ada Palmer" }))));
    other.send(X.el("presence", { to: "ada@localhost", type: "subscribe" }));
    ada.send(X.el("presence", { to: "me@localhost", type: "subscribe" }));
    other.send(X.el("presence", { to: "ada@localhost", type: "subscribed" }));
    other.send(X.el("presence"));
    await sleep(500);

    accounts[ACCOUNT] = { _id: ACCOUNT, templateId: template.templateId, username: r.username,
                          capabilityProviders: template.capabilityProviders.map((c) => ({ id: c.id, capability: c.capability })) };
    credentials[ACCOUNT] = r.credentials;
    await methods.onCreate({ accountId: ACCOUNT, config: r.config });
    for (const p of template.capabilityProviders) await methods.onEnabled({ accountId: ACCOUNT, capabilityProviderId: p.id, enabled: true });
    const s = await methods.sync({ accountId: ACCOUNT });
    check(s.returnValue, "the first sync (" + (s.errorText || "") + ")");

    // 2. Roster and presence.
    const contact = Object.values(db.objects).find((o) => !o._del && o._kind === "com.palm.contact.xmpp:1");
    check(contact && contact.remoteId === "ada@localhost" && contact.nickname === "Ada Palmer", "Ada is a contact (the roster's name)");
    const buddy = await until(() => Object.values(tempdb.objects).find((o) => !o._del && o.username === "ada@localhost" && o.availability === 0), 5000);
    check(!!buddy, "Ada is a buddy, available");

    // 3. Messages.
    const [m] = await db.put([{ _kind: "com.palm.immessage.xmpp:1", folder: "outbox", status: "pending", serviceName: "type_jabber", username: "me@localhost",
                                messageText: "Hello from Phoenix", to: [{ addr: "ada@localhost" }], localTimestamp: Date.now(), timestamp: Date.now(), flags: {} }]);
    await methods.outbox({ messageId: m.id });
    check(!!(await until(() => adaGot.find((e) => e.getChildText("body") === "Hello from Phoenix"))), "Ada's client got the message");
    check(!!(await until(() => db.objects[m.id].status === "successful")), "the message is successful (acknowledged by the server: XEP-0198)");
    check(!!(await until(() => db.objects[m.id].deliveryStatus === "delivered")), "and delivered (Ada's receipt, XEP-0184)");
    ada.send(X.el("message", { to: "me@localhost", type: "chat", id: "a1" }, X.el("body", {}, "Welcome back")));
    const inbox = await until(() => messages().find((x) => x.messageText === "Welcome back"));
    check(inbox && inbox.from.addr === "ada@localhost" && inbox.from.name === "Ada Palmer", "Ada's message is in the inbox, from her");
    check(toasts.some((t) => t.message === "Ada Palmer: Welcome back"), "with a notification");
    other.send(X.el("message", { to: "ada@localhost", type: "chat", id: "l1" }, X.el("body", {}, "Typed on the laptop")));
    const carbon = await until(() => messages().find((x) => x.messageText === "Typed on the laptop"));
    check(carbon && carbon.folder === "outbox" && carbon.to[0].addr === "ada@localhost", "the laptop's message is filed as sent (carbons, XEP-0280)");
    // Away: disconnected, a message meanwhile, the archive brings it.
    await methods.disconnect({ accountId: ACCOUNT });
    ada.send(X.el("message", { to: "me@localhost", type: "chat", id: "a2" }, X.el("body", {}, "While you were away")));
    await sleep(400);
    await methods.sync({ accountId: ACCOUNT });
    check(messages().filter((x) => x.messageText === "While you were away").length === 1, "the archive (MAM) brings what came while away, once");
    check(messages().filter((x) => x.messageText === "Welcome back").length === 1, "and nothing twice");

    // 4. A picture.
    const [pm] = await db.put([{ _kind: "com.palm.immessage.xmpp:1", folder: "outbox", status: "pending", serviceName: "type_jabber", username: "me@localhost",
                                 messageText: "", to: [{ addr: "ada@localhost" }], localTimestamp: Date.now(), timestamp: Date.now(), flags: {},
                                 parts: [{ path: "/media/internal/DCIM/100PHNX/pixel.png", mimeType: "image/png" }] }]);
    await methods.outbox({ messageId: pm.id });
    const picMsg = await until(() => adaGot.find((e) => e.getChild("x", "jabber:x:oob")));
    const url = picMsg && picMsg.getChild("x", "jabber:x:oob").getChildText("url");
    check(/^http:\/\/localhost:15280\/file_share\/.+\/pixel\.png$/.test(url || ""), "the picture went up through HTTP upload (" + url + ")");
    if (url) {
        const got = await synckit.createRequest({})({ method: "GET", url, binary: true });
        check(got.status === 200 && got.bytes.length === files["/media/internal/DCIM/100PHNX/pixel.png"].bytes.length, "and Prosody serves it back");
        ada.send(X.el("message", { to: "me@localhost", type: "chat", id: "a3" }, X.el("body", {}, url), X.el("x", { xmlns: "jabber:x:oob" }, X.el("url", {}, url))));
        const pic = await until(() => messages().find((x) => x.folder === "inbox" && x.parts));
        check(pic && pic.parts[0].mimeType === "image/png" && Object.keys(written).length === 1, "a picture sent to the account is fetched and kept");
    }

    await methods.onDelete({ accountId: ACCOUNT });
    await ada.close();
    await other.close();
}

main().then(() => {
    console.log(failures ? failures + " failed" : "all passed");
    process.exit(failures ? 1 : 0);
}, (e) => { console.error(e); process.exit(1); });
