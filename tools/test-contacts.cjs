#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The simulated contacts service (com.palm.service.contacts; runtime/
// phoenix-runtime.js, "Contacts service"), as app-services' service and the
// contacts framework it runs do it, in headless Chromium with the sample
// people:
//
//   1. favoritePerson, setFavoriteDefault (the app's default number in its
//      favoriteData, moved first, one per app; refused for a person who is
//      not a favourite and for a number the person has not), unfavoritePerson
//      (every default gone);
//   2. vCardExportOne (3.0 and 2.1, as VCardExporter writes them) and
//      vCardExportAll;
//   3. countVCardContacts, readVCard and importVCard of a file:// target
//      (a path without file:// refused, as the service does): the fields and
//      types the importer gives; imported contacts saved to the default
//      account, each with a person;
//   4. sortOrderChanged: the sort keys follow Contacts' list order;
//   5. the original Contacts opening a .vcf ({target}): one contact opens
//      Create New Contact with it (countVCardContacts, readVCard;
//      ContactsApp.js:427-429), two ask to import them (VCardHelper.js).
//
//   node tools/test-contacts.cjs [--tablet] [--out DIR]

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

async function drained(pending) {
    const r = await pending;
    try { await r.arrayBuffer(); } catch (e) { /* the status is what counts */ }
    return r;
}
function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "contacts-tests", tablet ? "tablet" : "phone");
const port = 8700 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const CONTACTS = `${origin}/usr/palm/applications/com.palm.app.contacts/index.html`;
const S = "palm://com.palm.service.contacts/";
const PHONE_POINT = "contact_point_type_phoneNumber";
const ALEX = "person-phoenix-sample-contact-1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await drained(fetch(url))).ok) return; } catch (e) { /* retry */ }
        await sleep(100);
    }
    throw new Error("server did not start");
}

const ONE = ["BEGIN:VCARD", "VERSION:3.0", "N:Okafor;Ngozi;;;", "FN:Ngozi Okafor", "TEL;TYPE=CELL:(510) 555-0170", "EMAIL;TYPE=WORK:ngozi@example.com", "END:VCARD", ""].join("\r\n");
const TWO = ["BEGIN:VCARD", "VERSION:2.1", "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;J=C3=BCrgen;;;", "TEL;CELL;VOICE:+49 30 1234567",
    "TEL;WORK;FAX:030 999", "EMAIL;INTERNET;HOME:jm@example.de", "ADR;WORK:;Suite 5;Hauptstr. 1;Berlin;;10115;Germany", "ORG:Acme\\, Inc.;R&D",
    "TITLE:CTO", "BDAY:19800102", "X-JABBER:jm@jabber.example", "NOTE:Line one\\nline two", "END:VCARD",
    "BEGIN:VCARD", "VERSION:3.0", "N:Doe;Jane;;;", "TEL;TYPE=HOME:555 0101", "URL;TYPE=WORK:https://example.org",
    "NOTE:A long note, folded", "  over two lines", "item1.X-ABRELATEDNAMES:John", "item1.X-ABLabel:_$!<Spouse>!$_", "END:VCARD", ""].join("\r\n");

async function main() {
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport: tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 } });
        const errors = [];
        context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
        const page = await context.newPage();
        await page.goto(CONTACTS);
        await page.waitForFunction(() => window.enyo && window.__phoenixRuntime, null, { timeout: 20000 });
        const call = (url, params) => page.evaluate(([u, p]) => new Promise((r) => __phoenixRuntime.dispatch(u, p, r, { cancelled: () => false })), [url, params]);
        const person = async (id) => ((await call("palm://com.palm.db/get", { ids: [id] })).results || [])[0];
        const file = async (p) => (await call("luna://org.webosphoenix.filemanager/read", { path: p, encoding: "utf8" })).data;

        // 1. Favourites and their defaults.
        let r = await call(S + "setFavoriteDefault", { personId: ALEX, defaultData: { value: "(408) 555-0198", type: "type_work", contactPointType: PHONE_POINT, listIndex: 2 } });
        check(r.returnValue === false && /not a favorite/.test(r.errorText), `setFavoriteDefault on a person not a favourite is refused (${r.errorText})`);
        r = await call(S + "favoritePerson", { personId: ALEX });
        check(r.returnValue && (await person(ALEX)).favorite === true, "favoritePerson: a favourite");
        r = await call(S + "setFavoriteDefault", { personId: ALEX, defaultData: { value: "408-555-0198", type: "type_work", contactPointType: PHONE_POINT, listIndex: 2 } });
        let phones = (await person(ALEX)).phoneNumbers;
        check(r.returnValue && phones[0].value === "(408) 555-0198" && JSON.stringify(phones[0].favoriteData) === JSON.stringify({ "com.palm.app.phone": { listIndex: 2 } }),
              `setFavoriteDefault: the work number, written another way, is the app's default, first (${JSON.stringify(phones.map((p) => [p.value, p.favoriteData]))})`);
        await call(S + "setFavoriteDefault", { personId: ALEX, defaultData: { value: "(408) 555-0144", type: "type_mobile", contactPointType: PHONE_POINT, listIndex: 0, appId: "com.palm.app.phone" } });
        phones = (await person(ALEX)).phoneNumbers;
        check(phones[0].value === "(408) 555-0144" && phones[0].favoriteData["com.palm.app.phone"].listIndex === 0 && !phones[1].favoriteData["com.palm.app.phone"],
              "... another number made the default: one default per app");
        r = await call(S + "setFavoriteDefault", { personId: ALEX, defaultData: { value: "(408) 555-0144", type: "type_home", contactPointType: PHONE_POINT, listIndex: 0 } });
        check(r.returnValue === false && /Could not find a contact point/.test(r.errorText), "a number of another type is not found, as the framework's match");
        r = await call(S + "setFavoriteDefault", { personId: ALEX, defaultData: { value: "x", contactPointType: "contact_point_type_url", listIndex: 0 } });
        check(r.returnValue === false && /unsupported contact point type/.test(r.errorText), "a URL cannot be a favourite's default");
        await call(S + "unfavoritePerson", { personId: ALEX });
        const unfav = await person(ALEX);
        check(unfav.favorite === false && unfav.phoneNumbers.every((p) => Object.keys(p.favoriteData || {}).length === 0), "unfavoritePerson: not a favourite, no defaults left");

        // 2. Export.
        r = await call(S + "vCardExportOne", { personId: ALEX, filePath: "/media/internal/Downloads/alex.vcf" });
        const alex = await file("/media/internal/Downloads/alex.vcf");
        check(r.returnValue && r.success && r.filePath === "/media/internal/Downloads/alex.vcf" && alex.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\nN:Rivera;Alex;;;\r\nFN:Alex Rivera\r\n")
              && alex.includes("\r\nTEL;TYPE=CELL,VOICE:(408) 555-0144\r\n") && alex.includes("\r\nEMAIL;TYPE=WORK,INTERNET:alex.rivera@example.com\r\n")
              && alex.includes("\r\nADR;TYPE=WORK:;;100 Market Street;San Jose;CA;95113;United States\r\n") && alex.endsWith("END:VCARD\r\n\r\n"),
              "vCardExportOne: the person as a 3.0 vCard, as VCardExporter writes it");
        await call(S + "vCardExportOne", { personId: "person-phoenix-sample-contact-3", filePath: "/tmp/marcus.vcf", vCardVersion: "2.1", onlyPhoneNumbers: true });
        const marcus = await file("/tmp/marcus.vcf");
        check(marcus.includes("VERSION:2.1\r\nN;CHARSET=UTF-8:Chen;Marcus;;;\r\n") && marcus.includes("TEL;CHARSET=UTF-8;HOME;VOICE:4155550163\r\n") && !/EMAIL|NOTE|ORG/.test(marcus),
              "... 2.1, only the phone numbers, unformatted");
        r = await call(S + "vCardExportAll", { filePath: "/media/internal/Downloads/everyone.vcf" });
        const people = (await call("palm://com.palm.db/find", { query: { from: "com.palm.person:1" } })).results.length;
        const everyone = await file("/media/internal/Downloads/everyone.vcf");
        check(r.returnValue && (everyone.match(/BEGIN:VCARD/g) || []).length === people, `vCardExportAll: every person (${people})`);

        // 3. Count, read, import.
        await call("luna://org.webosphoenix.filemanager/write", { path: "/media/internal/Downloads/one.vcf", data: ONE, overwrite: true });
        await call("luna://org.webosphoenix.filemanager/write", { path: "/media/internal/Downloads/two.vcf", data: TWO, overwrite: true });
        r = await call(S + "countVCardContacts", { filePath: "/media/internal/Downloads/two.vcf" });
        check(r.returnValue === false && /target to a local file/.test(r.errorText), "a path without file:// is refused, as the service refused it");
        r = await call(S + "countVCardContacts", { filePath: "file:///media/internal/Downloads/two.vcf" });
        check(r.returnValue && r.count === 2, "countVCardContacts: 2");
        r = await call(S + "readVCard", { filePath: "file:///media/internal/Downloads/two.vcf" });
        const [j, d] = r.contacts || [];
        check(j && j.name.familyName === "Müller" && j.name.givenName === "Jürgen" && JSON.stringify(j.phoneNumbers.map((p) => p.type)) === '["type_mobile","type_work_fax"]'
              && j.emails[0].type === "type_home" && j.addresses[0].streetAddress === "Hauptstr. 1, Suite 5" && j.addresses[0].type === "type_work"
              && j.organizations[0].name === "Acme, Inc." && j.organizations[0].title === "CTO" && j.birthday === "1980-01-02"
              && j.ims[0].type === "type_jabber" && j.note === "Line one\nline two",
              "readVCard: a 2.1 card's fields and types (quoted-printable decoded)");
        check(d && d.urls[0].type === "type_work" && d.note === "A long note, folded over two lines" && d.relations[0].value === "John" && d.relations[0].type === "type_spouse",
              "... a 3.0 card's: its URL, a folded note, a related name");
        r = await call(S + "importVCard", { filePath: "file:///media/internal/Downloads/two.vcf" });
        const prefs = (await call("palm://com.palm.db/find", { query: { from: "com.palm.app.contacts.prefs:1" } })).results[0] || {};
        check(r.returnValue && r.contacts.length === 2 && r.contacts.every((c) => c._id && c._kind === "com.palm.contact.palmprofile:1" && c.accountId === (prefs.defaultAccountId || "phoenix-sample-account-profile")),
              "importVCard: both saved to the default account's contacts");
        const linked = (await call("palm://com.palm.db/find", { query: { from: "com.palm.person:1", where: [{ prop: "contactIds", op: "=", val: r.contacts[0]._id }] } })).results;
        check(linked.length === 1 && linked[0].name.familyName === "Müller" && linked[0].sortKey === "müller\tjürgen", "... each with a person, sorted");

        // 4. The list order.
        if (prefs._id) await call("palm://com.palm.db/merge", { objects: [{ _id: prefs._id, listSortOrder: "FIRST_LAST" }] });
        else await call("palm://com.palm.db/put", { objects: [{ _kind: "com.palm.app.contacts.prefs:1", listSortOrder: "FIRST_LAST" }] });
        r = await call(S + "sortOrderChanged", {});
        check(r.returnValue && (await person(ALEX)).sortKey === "alex\trivera", "sortOrderChanged: First Last, the sort keys follow");
        if (prefs._id) await call("palm://com.palm.db/merge", { objects: [{ _id: prefs._id, listSortOrder: "LAST_FIRST" }] });
        await call(S + "sortOrderChanged", {});
        check((await person(ALEX)).sortKey === "rivera\talex", "... and back to Last First");

        // 5. The original Contacts opening a .vcf.
        const opened = await context.newPage();
        await opened.goto(`${CONTACTS}?launchParams=${encodeURIComponent(JSON.stringify({ target: "file:///media/internal/Downloads/one.vcf" }))}`);
        const ask = await opened.waitForFunction(() => /Create New Contact/.test(document.body.innerText)
            && Array.from(document.querySelectorAll("input")).some((i) => /Ngozi Okafor/.test(i.value)), null, { timeout: 20000 }).then(() => true, () => false);
        check(ask, "Contacts opens a one-contact .vcf: Create New Contact with its name and number (onGotVCardContact)");
        await opened.screenshot({ path: path.join(outDir, "contacts-vcf-one.png") });
        await opened.goto(`${CONTACTS}?launchParams=${encodeURIComponent(JSON.stringify({ target: "file:///media/internal/Downloads/two.vcf" }))}`);
        const askImport = await opened.waitForFunction(() => /import 2 contacts/.test(document.body.innerText), null, { timeout: 20000 }).then(() => true, () => false);
        check(askImport, "... a two-contact one asks to import 2 contacts");
        await opened.screenshot({ path: path.join(outDir, "contacts-vcf-two.png") });

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `\n${failures} check(s) failed` : "\nall passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
