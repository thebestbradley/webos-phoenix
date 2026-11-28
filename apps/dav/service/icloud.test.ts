// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The iCloud account preset (lib/presets.js, template com.webosphoenix.icloud)
// on the CardDAV / CalDAV transport, against a stand-in that behaves like
// iCloud's servers (test/icloud.cjs: a front host per service whose
// principal names home sets on a per-user partition host, Basic
// authentication with an app-specific password only, a group vCard, a
// Reminders list of VTODO only), with Radicale behind it (skipped without
// it: pip install radicale). The preset's hosts are pointed at the stand-in
// through the image's setting (presetHosts, /etc/palm/dav/presets.json).

import { join } from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as synckit from "@phoenix/synckit";
import * as memdb from "@phoenix/synckit/src/test/memdb.js";
import { loadCommonJs } from "../../shared/connector-kit/src/test-support";

const require = createRequire(import.meta.url);
const load = (file: string) => loadCommonJs(join(__dirname, file));
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const { createDavService } = load("davservice.js") as Any;
const presets = load("lib/presets.js") as Any;
const davclient = load("lib/davclient.js") as Any;
const { createRequest } = synckit as Any;
const vcard = synckit.vcard as Any;
const ical = synckit.ical as Any;
const { createMemDb, createFakeBus, KIND_PARENTS } = memdb as Any;
const icloud = require("./test/icloud.cjs") as Any;

const ACCOUNT = "icloud-account-1";
const TEMPLATE = "com.webosphoenix.icloud";

const VCARD_ADA = ["BEGIN:VCARD", "VERSION:3.0", "PRODID:-//Apple Inc.//iOS 18.0//EN", "UID:ada-1", "N:Palmer;Ada;;;",
    "FN:Ada Palmer", "item1.TEL;type=CELL;type=VOICE;type=pref:(408) 555-0142", "EMAIL;type=INTERNET;type=HOME:ada@example.com",
    "END:VCARD", ""].join("\r\n");
const VCARD_GROUP = ["BEGIN:VCARD", "VERSION:3.0", "PRODID:-//Apple Inc.//iOS 18.0//EN", "UID:group-1", "N:Book club",
    "FN:Book club", "X-ADDRESSBOOKSERVER-KIND:group", "X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:ada-1", "END:VCARD", ""].join("\r\n");
const ICS_DINNER = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//iOS 18.0//EN", "BEGIN:VEVENT", "UID:dinner-1",
    "DTSTAMP:20260101T000000Z", "DTSTART;TZID=America/Los_Angeles:20261205T190000", "DTEND;TZID=America/Los_Angeles:20261205T210000",
    "SUMMARY:Dinner with Ada", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
const ICS_TODO = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//iOS 12.0//EN", "BEGIN:VTODO", "UID:todo-1",
    "DTSTAMP:20260101T000000Z", "SUMMARY:Buy milk", "END:VTODO", "END:VCALENDAR", ""].join("\r\n");

const live = (db: Any, kind: string) => Object.values(db.objects as Record<string, Any>).filter((o: Any) => !o._del && o._kind === kind);

describe("the iCloud preset", () => {
    it("names iCloud's hosts and its own capability providers", () => {
        const p = presets.presetFor(TEMPLATE, null);
        expect(p.services).toEqual({ carddav: "https://contacts.icloud.com/", caldav: "https://caldav.icloud.com/" });
        expect(p.providers).toEqual({ CONTACTS: "com.webosphoenix.icloud.contacts", CALENDAR: "com.webosphoenix.icloud.calendar" });
        expect(presets.presetFor("com.webosphoenix.dav", null)).toBeNull();
    });

    it("takes other hosts only from the image's setting, and only http(s) ones", () => {
        const p = presets.presetFor(TEMPLATE, { [TEMPLATE]: { carddav: "http://127.0.0.1:1/", caldav: "javascript:alert(1)" } });
        expect(p.services).toEqual({ carddav: "http://127.0.0.1:1/", caldav: "https://caldav.icloud.com/" });
    });

    it("the template matches the preset's providers", () => {
        const t = require("../public/accounts/com.webosphoenix.icloud/com.webosphoenix.icloud.json");
        const p = presets.presetFor(TEMPLATE, null);
        expect(t.templateId).toBe(TEMPLATE);
        expect(t.capabilityProviders.map((c: Any) => [c.capability, c.id])).toEqual([["CONTACTS", p.providers.CONTACTS], ["CALENDAR", p.providers.CALENDAR]]);
        expect(t.validator.address).toBe("palm://org.webosphoenix.service.dav/checkCredentials");
        expect(t.validator.customUI).toEqual({ appId: "org.webosphoenix.dav", name: "accounts/icloud.html" });
    });

    it("discovery looks for each service on its own host (no server the user typed)", async () => {
        const asked: string[] = [];
        const request = (r: Any) => {
            asked.push(r.method + " " + r.url);
            return Promise.resolve({ status: 404, headers: {}, body: "" });
        };
        const c = davclient.createClient({ request, services: { carddav: "https://contacts.icloud.com", caldav: "https://caldav.icloud.com" },
                                           username: "a@icloud.com", password: "x" });
        await expect(c.discover()).rejects.toMatchObject({ errorCode: "NO_DAV_SERVICE" });
        expect(asked.sort()).toEqual(["PROPFIND https://caldav.icloud.com/", "PROPFIND https://caldav.icloud.com/.well-known/caldav",
                                      "PROPFIND https://contacts.icloud.com/", "PROPFIND https://contacts.icloud.com/.well-known/carddav"]);
    });
});

describe.skipIf(!icloud.available())("iCloud against a stand-in with iCloud's redirects and partitions", () => {
    let ic: Any;
    let db: Any;
    let tempdb: Any;
    let svc: Any;
    let credentials: Any;

    beforeAll(async () => {
        ic = await icloud.start();
        await ic.card.put(ic.cardBook + "ada-1.vcf", VCARD_ADA);
        await ic.card.put(ic.cardBook + "group-1.vcf", VCARD_GROUP);
        await ic.cal.put(ic.calHome + "dinner-1.ics", ICS_DINNER);
        await ic.cal.put("/" + ic.cal.user + "/tasks/todo-1.ics", ICS_TODO);
        db = createMemDb(KIND_PARENTS);
        tempdb = createMemDb();
        credentials = {};
        const account = {
            _id: ACCOUNT, templateId: TEMPLATE, username: ic.user,
            capabilityProviders: [{ id: "com.webosphoenix.icloud.contacts", capability: "CONTACTS" },
                                  { id: "com.webosphoenix.icloud.calendar", capability: "CALENDAR" }]
        };
        const bus = createFakeBus({ db, tempdb, accounts: { [ACCOUNT]: account }, credentials });
        svc = createDavService({ luna: bus, request: createRequest(), localTz: "America/Los_Angeles", periodicSync: false,
                                 presetHosts: () => ic.presetHosts });
    }, 30000);
    afterAll(() => ic && ic.stop());

    it("refuses the Apple Account's own password, saying to use an app-specific one", async () => {
        const r = await svc.checkCredentials({ templateId: TEMPLATE, username: ic.user, password: ic.accountPassword, config: {} });
        expect(r).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
        expect(r.errorText).toMatch(/app-specific password/);
        expect(r.errorText).toMatch(/account\.apple\.com/);
    });

    it("signs in with the app-specific password: principals on the front hosts, homes on the partitions", async () => {
        ic.hits.length = 0;
        // A server the page might send is not used: the preset's hosts are.
        const r = await svc.checkCredentials({ templateId: TEMPLATE, username: ic.user, password: ic.appPassword,
                                               config: { serverUrl: "https://evil.example/" } });
        expect(r.returnValue).toBe(true);
        expect(r.config).toMatchObject({ serverUrl: ic.contactsUrl, principalUrl: ic.contactsUrl + ic.dsid + "/principal/",
                                         addressbooks: 1, calendars: 3 });
        expect(r.credentials.common).toEqual({ password: ic.appPassword, serverUrl: ic.contactsUrl });
        const hosts = ic.hits.map((h: Any) => h.host + " " + h.method + " " + h.path);
        // RFC 6764's well-known URI first, redirected to "/" on the same host.
        expect(hosts).toContain("contacts PROPFIND /.well-known/carddav");
        expect(hosts).toContain("caldav PROPFIND /.well-known/caldav");
        expect(hosts).toContain("contacts-partition PROPFIND /" + ic.dsid + "/carddavhome/");
        expect(hosts).toContain("caldav-partition PROPFIND /" + ic.dsid + "/calendars/");
        credentials[ACCOUNT] = r.credentials;
    });

    it("first sync: contacts and events, not the group card nor the Reminders list", async () => {
        expect((await svc.onCreate({ accountId: ACCOUNT, config: { serverUrl: ic.contactsUrl } })).returnValue).toBe(true);
        const r = await svc.sync({ accountId: ACCOUNT });
        expect(r.returnValue).toBe(true);
        expect(r.stats).toMatchObject({ collections: 3, contactsChanged: 1, eventsChanged: 1, conflicts: 0, errors: [] });
        const contacts = live(db, "com.palm.contact.dav:1");
        expect(contacts.map((c: Any) => c.name.givenName)).toEqual(["Ada"]);
        expect(contacts[0]).toMatchObject({ accountId: ACCOUNT, phoneNumbers: [{ value: "(408) 555-0142" }] });
        expect(contacts[0].remoteId).toMatch(new RegExp("/" + ic.dsid + "/carddavhome/card/ada-1\\.vcf$"));
        const cals = live(db, "com.palm.calendar.dav:1").map((c: Any) => c.name).sort();
        expect(cals).toEqual(["Home", "Work"]);
        expect(live(db, "com.palm.calendarevent.dav:1").map((e: Any) => e.subject)).toEqual(["Dinner with Ada"]);
        // The sync state is the iCloud providers' (Accounts shows a warning on them).
        expect(live(tempdb, "com.palm.account.syncstate:1").map((o: Any) => o.capabilityProvider + " " + o.syncState).sort())
            .toEqual(["com.webosphoenix.icloud.calendar IDLE", "com.webosphoenix.icloud.contacts IDLE"]);
    });

    it("device changes reach iCloud, and iCloud's reach the device", async () => {
        const cal = live(db, "com.palm.calendar.dav:1").find((c: Any) => c.name === "Work");
        await db.put([{ _kind: "com.palm.contact.dav:1", accountId: ACCOUNT, name: { givenName: "Carol", familyName: "Nguyen" },
                        phoneNumbers: [{ value: "(212) 555-0126", type: "type_mobile" }] }]);
        await db.put([{ _kind: "com.palm.calendarevent.dav:1", accountId: ACCOUNT, calendarId: cal._id, subject: "Review (from the phone)",
                        dtstart: Date.UTC(2026, 11, 8, 17), dtend: Date.UTC(2026, 11, 8, 18), tzId: "America/Los_Angeles", allDay: false }]);
        let r = await svc.sync({ accountId: ACCOUNT });
        expect(r.stats).toMatchObject({ uploaded: { created: 2, modified: 0, deleted: 0 }, conflicts: 0, errors: [] });
        const cards = await ic.card.list(ic.cardBook);
        expect(cards).toHaveLength(3);
        const carol = cards.find((f: string) => !/ada-1|group-1/.test(f));
        expect(vcard.toContact((await ic.card.get(carol)).body).contact.name.givenName).toBe("Carol");
        // The group card is left as it was.
        expect((await ic.card.get(ic.cardBook + "group-1.vcf")).body).toContain("X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:ada-1");
        const work = await ic.cal.list(ic.calWork);
        expect(work).toHaveLength(1);
        expect(ical.toEvents((await ic.cal.get(work[0])).body).master.subject).toBe("Review (from the phone)");

        await ic.card.put(ic.cardBook + "ada-1.vcf", VCARD_ADA.replace("FN:Ada Palmer", "FN:Ada Palmer\r\nNOTE:Changed on the iPhone"));
        await ic.cal.del(ic.calHome + "dinner-1.ics");
        r = await svc.sync({ accountId: ACCOUNT });
        expect(r.returnValue).toBe(true);
        expect(live(db, "com.palm.contact.dav:1").find((c: Any) => c.name.givenName === "Ada").note).toBe("Changed on the iPhone");
        expect(live(db, "com.palm.calendarevent.dav:1").map((e: Any) => e.subject)).toEqual(["Review (from the phone)"]);
    });

    it("an app-specific password revoked later shows as 401 on the account", async () => {
        credentials[ACCOUNT] = { common: { password: "revoked-0000-0000", serverUrl: ic.contactsUrl } };
        const r = await svc.sync({ accountId: ACCOUNT });
        expect(r).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
        expect(live(tempdb, "com.palm.account.syncstate:1").every((o: Any) => o.syncState === "ERROR" && o.errorCode === "401_UNAUTHORIZED")).toBe(true);
    });
});
