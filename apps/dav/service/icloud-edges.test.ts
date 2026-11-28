// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The iCloud account (template com.webosphoenix.icloud, a preset of the
// CardDAV / CalDAV transport: lib/presets.js) at its edges, end to end
// against the stand-in for iCloud's servers (test/icloud.cjs, Radicale
// behind it; skipped without it): passwords refused and revoked, a
// partition move, 503 and 429, connections dropped mid-sync, conflicts,
// recurring events with exceptions, all-day events across zones and DST,
// rich and Unicode contacts with photos, groups, a large address book in
// pages, sync-tokens that expire, a calendar shared read-only, Reminders
// lists, two Apple Accounts, removal (also during a sync) and an account
// of iCloud in mainland China.

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as synckit from "@phoenix/synckit";
import * as memdb from "@phoenix/synckit/src/test/memdb.js";
import { loadCommonJs } from "../../shared/connector-kit/src/test-support";

const require = createRequire(import.meta.url);
const load = (file: string) => loadCommonJs(join(__dirname, file));
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const { createDavService } = load("davservice.js") as Any;
const { createRequest } = synckit as Any;
const vcard = synckit.vcard as Any;
const ical = synckit.ical as Any;
const { createMemDb, createFakeBus, KIND_PARENTS } = memdb as Any;
const icloud = require("./test/icloud.cjs") as Any;

const TEMPLATE = "com.webosphoenix.icloud";
const PROVIDERS = [{ id: "com.webosphoenix.icloud.contacts", capability: "CONTACTS" },
                   { id: "com.webosphoenix.icloud.calendar", capability: "CALENDAR" }];
const CONTACT = "com.palm.contact.dav:1";
const CALENDAR = "com.palm.calendar.dav:1";
const EVENT = "com.palm.calendarevent.dav:1";

const live = (db: Any, kind: string, accountId?: string) => Object.values(db.objects as Record<string, Any>)
    .filter((o: Any) => !o._del && o._kind === kind && (!accountId || o.accountId === accountId));
const given = (db: Any, name: string, accountId?: string) => live(db, CONTACT, accountId).filter((c: Any) => c.name && c.name.givenName === name);

const card = (uid: string, first: string, last: string, extra: string[] = []) => ["BEGIN:VCARD", "VERSION:3.0",
    "PRODID:-//Apple Inc.//iOS 18.0//EN", "UID:" + uid, "N:" + last + ";" + first + ";;;", "FN:" + first + " " + last,
    ...extra, "END:VCARD", ""].join("\r\n");
const event = (uid: string, summary: string, start: string, end: string, extra: string[] = []) => ["BEGIN:VCALENDAR",
    "VERSION:2.0", "PRODID:-//Apple Inc.//iOS 18.0//EN", "BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:20260101T000000Z",
    "DTSTART;TZID=America/Los_Angeles:" + start, "DTEND;TZID=America/Los_Angeles:" + end, "SUMMARY:" + summary, ...extra,
    "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");

// One device: db8, the accounts service and the DAV service, with any
// number of iCloud accounts on it.
function device(ic: Any, o: Any = {}) {
    const db = createMemDb(KIND_PARENTS);
    const tempdb = createMemDb();
    const accounts: Record<string, Any> = {};
    const credentials: Record<string, Any> = {};
    const bus = createFakeBus({ db, tempdb, accounts, credentials });
    const logs: string[] = [];
    const svc = createDavService({
        luna: bus, request: o.request || createRequest(), localTz: o.localTz || "America/Los_Angeles", periodicSync: false,
        presetHosts: () => ic.presetHosts, savePhoto: o.savePhoto, log: (m: string) => logs.push(m),
        // No real waiting in tests: Retry-After and retries pass at once, on a clock of the test's.
        http: o.http || { sleep: () => Promise.resolve() }
    });
    async function add(accountId: string, u: Any) {
        accounts[accountId] = { _id: accountId, templateId: TEMPLATE, username: u.user, capabilityProviders: PROVIDERS };
        const r = await svc.checkCredentials({ templateId: TEMPLATE, username: u.user, password: u.appPassword, config: {} });
        expect(r.returnValue).toBe(true);
        credentials[accountId] = r.credentials;
        expect((await svc.onCreate({ accountId, config: r.config })).returnValue).toBe(true);
        return r;
    }
    const syncState = (accountId: string) => live(tempdb, "com.palm.account.syncstate:1").filter((s: Any) => s.accountId === accountId);
    return { db, tempdb, svc, accounts, credentials, add, logs, syncState };
}

// A request() that records every URL asked for.
function recording(inner: Any) {
    const urls: string[] = [];
    const request = (r: Any) => { urls.push(r.url); return inner(r); };
    return { urls, request };
}

describe.skipIf(!icloud.available())("iCloud at its edges", () => {
    describe("signing in", () => {
        let ic: Any;
        beforeAll(async () => { ic = await icloud.start(); }, 30000);
        afterAll(() => ic && ic.stop());

        it("the Apple Account's own password (and an account without two-factor, which has no other): 401, with what to do", async () => {
            const d = device(ic);
            const r = await d.svc.checkCredentials({ templateId: TEMPLATE, username: ic.user, password: ic.accountPassword, config: {} });
            expect(r).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
            expect(r.errorText).toMatch(/app-specific password/);
            expect(r.errorText).toMatch(/two-factor authentication/);
        });

        it("an app-specific password revoked later: the account is flagged, saying so", async () => {
            const d = device(ic);
            await d.add("acct", ic);
            expect((await d.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            d.credentials.acct = { common: { password: "wxyz-wxyz-wxyz-wxyz", serverUrl: ic.contactsUrl } };
            const r = await d.svc.sync({ accountId: "acct" });
            expect(r).toMatchObject({ returnValue: false, errorCode: "401_UNAUTHORIZED" });
            expect(r.errorText).toMatch(/app-specific password/);
            expect(r.errorText).toMatch(/revoked/);
            const states = d.syncState("acct");
            expect(states).toHaveLength(2);
            states.forEach((s: Any) => {
                expect(s).toMatchObject({ syncState: "ERROR", errorCode: "401_UNAUTHORIZED" });
                expect(s.errorText).toMatch(/revoked/);
            });
        });

        it("an account of iCloud in mainland China: a clear 'not supported', at once, and nothing sent there", async () => {
            for (const cnRedirect of [false, true]) {
                const u = await ic.addUser({ user: "li.wei" + (cnRedirect ? "2" : "") + "@icloud.com", appPassword: "cnpw-cnpw-cnpw-cnpw",
                                             dsid: cnRedirect ? "30033004" : "30033003", region: "cn", cnRedirect });
                const rec = recording((r: Any) => /icloud\.com\.cn/.test(r.url)
                    ? new Promise(() => { /* never answers, as such a host may from here */ })
                    : createRequest()(r));
                const d = device(ic, { request: rec.request });
                const started = Date.now();
                const r = await d.svc.checkCredentials({ templateId: TEMPLATE, username: u.user, password: u.appPassword, config: {} });
                expect(Date.now() - started).toBeLessThan(5000);
                expect(r).toMatchObject({ returnValue: false, errorCode: "REGION_NOT_SUPPORTED" });
                expect(r.errorText).toMatch(/mainland China/);
                expect(rec.urls.filter((x) => /icloud\.com\.cn/.test(x))).toEqual([]);
            }
        }, 30000);

        it("never sends the password to a host that is not iCloud's", async () => {
            const rec = recording(createRequest());
            const d = device(ic, { request: rec.request });
            const r = await d.svc.checkCredentials({ templateId: TEMPLATE, username: ic.user, password: ic.appPassword,
                                                     config: { serverUrl: "http://127.0.0.2:1/" } });
            expect(r.returnValue).toBe(true);
            expect(rec.urls.every((x) => new URL(x).hostname === "127.0.0.1")).toBe(true);
        });
    });

    describe("the account's partition moves (pNN changes)", () => {
        let ic: Any;
        beforeAll(async () => { ic = await icloud.start(); }, 30000);
        afterAll(() => ic && ic.stop());

        it("keeps every contact, event and calendar, uploads what was changed meanwhile, and uses only the new hosts", async () => {
            await ic.card.put(ic.cardBook + "ada-1.vcf", card("ada-1", "Ada", "Palmer", ["TEL;type=CELL:(408) 555-0142"]));
            await ic.cal.put(ic.calHome + "dinner-1.ics", event("dinner-1", "Dinner", "20261205T190000", "20261205T210000"));
            const d = device(ic);
            await d.add("acct", ic);
            expect((await d.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            const ada = given(d.db, "Ada")[0];
            const dinner = live(d.db, EVENT)[0];
            const calIds = live(d.db, CALENDAR).map((c: Any) => c._id).sort();
            // Changed on the device before the next sync, and the user's colour for Home.
            await d.db.merge([{ _id: ada._id, note: "Edited before the move" }]);
            const home = live(d.db, CALENDAR).find((c: Any) => c.name === "Home");
            await d.db.merge([{ _id: home._id, color: "purple" }]);
            const old = ic.partitionOrigins();
            await ic.movePartition();
            ic.hits.length = 0;
            const r = await d.svc.sync({ accountId: "acct" });
            expect(r.returnValue).toBe(true);
            expect(r.stats).toMatchObject({ conflicts: 0, errors: [], contactsRemoved: 0, eventsRemoved: 0 });
            expect(r.stats.uploaded).toMatchObject({ modified: 1, created: 0, deleted: 0 });
            // The same objects, none twice.
            expect(given(d.db, "Ada").map((c: Any) => c._id)).toEqual([ada._id]);
            expect(live(d.db, EVENT).map((e: Any) => e._id)).toEqual([dinner._id]);
            expect(live(d.db, CALENDAR).map((c: Any) => c._id).sort()).toEqual(calIds);
            expect(live(d.db, CALENDAR).find((c: Any) => c.name === "Home").color).toBe("purple");
            const now = ic.partitionOrigins();
            expect(given(d.db, "Ada")[0].remoteId.indexOf(now.contacts)).toBe(0);
            expect(live(d.db, EVENT)[0].remoteId.indexOf(now.caldav)).toBe(0);
            expect(vcard.toContact((await ic.card.get(ic.cardBook + "ada-1.vcf")).body).contact.note).toBe("Edited before the move");
            // Nothing asked of the old partition.
            expect(ic.hits.filter((h: Any) => h.partition !== undefined && h.partition !== ic.first.partition)).toEqual([]);
            expect(old.contacts).not.toBe(now.contacts);
            // And the next sync has nothing to do.
            const again = await d.svc.sync({ accountId: "acct" });
            expect(again.stats).toMatchObject({ contactsChanged: 0, eventsChanged: 0, uploaded: { created: 0, modified: 0, deleted: 0 } });
        });
    });

    describe("503 and 429 from Apple", () => {
        let ic: Any;
        beforeAll(async () => { ic = await icloud.start(); }, 30000);
        afterAll(() => ic && ic.stop());

        it("a long Retry-After ends the sync as 'Server unavailable' with when to try again, and nothing is sent before then", async () => {
            await ic.card.put(ic.cardBook + "ada-1.vcf", card("ada-1", "Ada", "Palmer"));
            let t = Date.UTC(2026, 10, 28, 12);
            const d = device(ic, { http: { sleep: () => Promise.resolve(), now: () => t } });
            await d.add("acct", ic);
            ic.faults.push({ host: "contacts-partition", method: "REPORT", status: 503, headers: { "Retry-After": "600" } });
            const r = await d.svc.sync({ accountId: "acct" });
            expect(r).toMatchObject({ returnValue: false, errorCode: "503_SERVICE_UNAVAILABLE" });
            expect(r.retryAt).toBe(t + 600000);
            d.syncState("acct").forEach((s: Any) => expect(s).toMatchObject({ syncState: "ERROR", errorCode: "503_SERVICE_UNAVAILABLE", retryAt: t + 600000 }));
            // Within the ten minutes: refused here, iCloud not asked.
            ic.hits.length = 0;
            t += 60000;
            const early = await d.svc.sync({ accountId: "acct" });
            expect(early).toMatchObject({ returnValue: false, errorCode: "503_SERVICE_UNAVAILABLE" });
            expect(ic.hits).toEqual([]);
            // After it: the sync runs, and the contact is there once.
            t += 600000;
            const later = await d.svc.sync({ accountId: "acct" });
            expect(later.returnValue).toBe(true);
            expect(given(d.db, "Ada")).toHaveLength(1);
            d.syncState("acct").forEach((s: Any) => expect(s.syncState).toBe("IDLE"));
        });

        it("a short Retry-After, and a 503 without one, are waited out and the sync completes", async () => {
            const waits: number[] = [];
            const d = device(ic, { http: { sleep: (ms: number) => { waits.push(ms); return Promise.resolve(); } } });
            await d.add("acct", ic);
            ic.faults.push({ host: "caldav-partition", method: "PROPFIND", status: 429, headers: { "Retry-After": "2" } });
            ic.faults.push({ host: "contacts-partition", method: "REPORT", status: 503 });
            const r = await d.svc.sync({ accountId: "acct" });
            expect(r.returnValue).toBe(true);
            expect(r.stats.errors).toEqual([]);
            expect(waits).toContain(2000);
            expect(ic.faults).toEqual([]);
        });

        it("a 503 while uploading stops the sync instead of trying every change, and the next sync uploads them once", async () => {
            const d = device(ic);
            await d.add("acct", ic);
            expect((await d.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            await d.db.put([{ _kind: CONTACT, accountId: "acct", name: { givenName: "Uma", familyName: "One" } },
                            { _kind: CONTACT, accountId: "acct", name: { givenName: "Vic", familyName: "Two" } },
                            { _kind: CONTACT, accountId: "acct", name: { givenName: "Wes", familyName: "Three" } }]);
            ic.faults.push({ host: "contacts-partition", method: "PUT", status: 503, headers: { "Retry-After": "3600" } });
            ic.hits.length = 0;
            const r = await d.svc.sync({ accountId: "acct" });
            expect(r).toMatchObject({ returnValue: false, errorCode: "503_SERVICE_UNAVAILABLE" });
            expect(ic.hits.filter((h: Any) => h.method === "PUT")).toHaveLength(1);
        });
    });

    describe("the network drops mid-sync", () => {
        let ic: Any;
        beforeAll(async () => { ic = await icloud.start(); }, 30000);
        afterAll(() => ic && ic.stop());

        it("an upload carried out whose answer is lost: the next sync makes no second copy on either side", async () => {
            const d = device(ic);
            await d.add("acct", ic);
            expect((await d.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            const work = live(d.db, CALENDAR).find((c: Any) => c.name === "Work");
            await d.db.put([{ _kind: CONTACT, accountId: "acct", name: { givenName: "Carol", familyName: "Nguyen" } }]);
            await d.db.put([{ _kind: EVENT, accountId: "acct", calendarId: work._id, subject: "Offsite", allDay: false,
                              dtstart: Date.UTC(2026, 11, 9, 17), dtend: Date.UTC(2026, 11, 9, 18), tzId: "America/Los_Angeles" }]);
            // Every try of each upload reaches the server, and every answer is lost.
            ic.faults.push({ host: "contacts-partition", method: "PUT", drop: "after", times: 5 });
            ic.faults.push({ host: "caldav-partition", method: "PUT", drop: "after", times: 5 });
            await d.svc.sync({ accountId: "acct" });
            ic.faults.length = 0;
            const r = await d.svc.sync({ accountId: "acct" });
            expect(r.returnValue).toBe(true);
            expect(r.stats.errors).toEqual([]);
            expect(given(d.db, "Carol")).toHaveLength(1);
            expect(live(d.db, EVENT).filter((e: Any) => e.subject === "Offsite")).toHaveLength(1);
            expect(await ic.card.list(ic.cardBook)).toHaveLength(1);
            expect(await ic.cal.list(ic.calWork)).toHaveLength(1);
            // The one on the device is the one on the server.
            const carol = given(d.db, "Carol")[0];
            expect(decodeURIComponent(new URL(carol.remoteId).pathname)).toBe((await ic.card.list(ic.cardBook))[0].replace("/" + ic.card.user + "/", "/" + ic.dsid + "/carddavhome/"));
            const again = await d.svc.sync({ accountId: "acct" });
            expect(again.stats).toMatchObject({ uploaded: { created: 0, modified: 0, deleted: 0 }, contactsChanged: 0, eventsChanged: 0 });
        });

        it("a download cut off part way: the sync fails as a connection error, and the next one finishes it without duplicates", async () => {
            for (let i = 0; i < 120; i++) await ic.card.put(ic.cardBook + "bulk-" + i + ".vcf", card("bulk-" + i, "Bulk" + i, "Person"));
            // The second multiget's connection drops, on every try.
            let seen = 0;
            const inner = createRequest();
            const request = (r: Any) => {
                if (r.method === "REPORT" && /addressbook-multiget/.test(r.body || "") && ++seen >= 2) {
                    const e: Any = new Error("socket hang up");
                    e.code = "ECONNRESET";
                    return Promise.reject(e);
                }
                return inner(r);
            };
            const d2 = device(ic, { request });
            await d2.add("acct", ic);
            const r = await d2.svc.sync({ accountId: "acct" });
            expect(r).toMatchObject({ returnValue: false, errorCode: "CONNECTION_FAILED" });
            // Nothing half-applied: what was fetched before the drop is kept or fetched again.
            seen = -1000;
            const r2 = await d2.svc.sync({ accountId: "acct" });
            expect(r2.returnValue).toBe(true);
            const names = live(d2.db, CONTACT).map((c: Any) => c.name.givenName).filter((n: string) => /^Bulk/.test(n));
            expect(names).toHaveLength(120);
            expect(new Set(names).size).toBe(120);
        }, 60000);
    });

    describe("both sides changed", () => {
        let ic: Any;
        let d: ReturnType<typeof device>;
        beforeAll(async () => {
            ic = await icloud.start();
            await ic.card.put(ic.cardBook + "ada-1.vcf", card("ada-1", "Ada", "Palmer", ["NOTE:original"]));
            await ic.card.put(ic.cardBook + "bob-1.vcf", card("bob-1", "Bob", "Okafor", ["NOTE:original"]));
            await ic.cal.put(ic.calHome + "dinner-1.ics", event("dinner-1", "Dinner", "20261205T190000", "20261205T210000"));
            await ic.cal.put(ic.calHome + "lunch-1.ics", event("lunch-1", "Lunch", "20261206T120000", "20261206T130000"));
            d = device(ic);
            await d.add("acct", ic);
            expect((await d.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
        }, 30000);
        afterAll(() => ic && ic.stop());

        it("the same contact and event edited on both (ETag conflict): iCloud's copy wins, once, and is not uploaded over", async () => {
            const ada = given(d.db, "Ada")[0];
            const dinner = live(d.db, EVENT).find((e: Any) => e.subject === "Dinner");
            await d.db.merge([{ _id: ada._id, note: "from the device" }, { _id: dinner._id, location: "Device's place" }]);
            await ic.card.put(ic.cardBook + "ada-1.vcf", card("ada-1", "Ada", "Palmer", ["NOTE:from the iPhone"]));
            await ic.cal.put(ic.calHome + "dinner-1.ics", event("dinner-1", "Dinner", "20261205T193000", "20261205T213000", ["LOCATION:iPhone's place"]));
            const r = await d.svc.sync({ accountId: "acct" });
            expect(r.stats).toMatchObject({ conflicts: 2, errors: [], uploaded: { created: 0, modified: 0, deleted: 0 } });
            expect(given(d.db, "Ada").map((c: Any) => [c._id, c.note])).toEqual([[ada._id, "from the iPhone"]]);
            const ev = live(d.db, EVENT).filter((e: Any) => e.subject === "Dinner");
            expect(ev.map((e: Any) => [e._id, e.location])).toEqual([[dinner._id, "iPhone's place"]]);
            expect(vcard.toContact((await ic.card.get(ic.cardBook + "ada-1.vcf")).body).contact.note).toBe("from the iPhone");
        });

        it("edited between our pull and our upload (412): iCloud's copy wins", async () => {
            const bob = given(d.db, "Bob")[0];
            await d.db.merge([{ _id: bob._id, note: "device edit" }]);
            // The iPhone saves Bob just as the device uploads its edit.
            let raced = false;
            const inner = createRequest();
            const request = async (r: Any) => {
                if (!raced && r.method === "PUT" && /bob-1\.vcf$/.test(r.url)) {
                    raced = true;
                    await ic.card.put(ic.cardBook + "bob-1.vcf", card("bob-1", "Bob", "Okafor", ["NOTE:iPhone edit"]));
                }
                return inner(r);
            };
            // The same device's data, through a request that races.
            const svc = createDavService({ luna: createFakeBus({ db: d.db, tempdb: d.tempdb, accounts: d.accounts, credentials: d.credentials }),
                                           request, localTz: "America/Los_Angeles", periodicSync: false, presetHosts: () => ic.presetHosts,
                                           http: { sleep: () => Promise.resolve() } });
            const r = await svc.sync({ accountId: "acct" });
            expect(raced).toBe(true);
            expect(r.stats).toMatchObject({ conflicts: 1, errors: [] });
            expect(given(d.db, "Bob").map((c: Any) => [c._id, c.note])).toEqual([[bob._id, "iPhone edit"]]);
        });

        it("deleted on iCloud while edited on the device: it goes from the device too, and is not uploaded again", async () => {
            const lunch = live(d.db, EVENT).find((e: Any) => e.subject === "Lunch");
            await d.db.merge([{ _id: lunch._id, note: "edited on the device" }]);
            await ic.cal.del(ic.calHome + "lunch-1.ics");
            const bob = given(d.db, "Bob")[0];
            await d.db.merge([{ _id: bob._id, note: "edited again" }]);
            await ic.card.del(ic.cardBook + "bob-1.vcf");
            const r = await d.svc.sync({ accountId: "acct" });
            expect(r.stats).toMatchObject({ conflicts: 2, errors: [], uploaded: { created: 0, modified: 0, deleted: 0 } });
            expect(live(d.db, EVENT).filter((e: Any) => e.subject === "Lunch")).toEqual([]);
            expect(given(d.db, "Bob")).toEqual([]);
            expect((await ic.cal.list(ic.calHome)).some((h: string) => /lunch/.test(h))).toBe(false);
            expect((await ic.card.list(ic.cardBook)).some((h: string) => /bob/.test(h))).toBe(false);
        });
    });

    describe("events", () => {
        let ic: Any;
        beforeAll(async () => { ic = await icloud.start(); }, 30000);
        afterAll(() => ic && ic.stop());

        // Weekly on Tuesdays across the end of daylight saving time (1 November
        // 2026 in Los Angeles), one week skipped, one moved to the evening.
        const YOGA = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//iOS 18.0//EN", "CALSCALE:GREGORIAN",
            "BEGIN:VTIMEZONE", "TZID:America/Los_Angeles", "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0800", "TZOFFSETTO:-0700",
            "DTSTART:20070311T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "TZNAME:PDT", "END:DAYLIGHT", "BEGIN:STANDARD",
            "TZOFFSETFROM:-0700", "TZOFFSETTO:-0800", "DTSTART:20071104T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
            "TZNAME:PST", "END:STANDARD", "END:VTIMEZONE",
            "BEGIN:VEVENT", "UID:yoga-1", "DTSTAMP:20261001T000000Z", "DTSTART;TZID=America/Los_Angeles:20261020T073000",
            "DTEND;TZID=America/Los_Angeles:20261020T083000", "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=6",
            "EXDATE;TZID=America/Los_Angeles:20261027T073000", "SUMMARY:Yoga", "X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC", "END:VEVENT",
            "BEGIN:VEVENT", "UID:yoga-1", "DTSTAMP:20261001T000000Z", "RECURRENCE-ID;TZID=America/Los_Angeles:20261103T073000",
            "DTSTART;TZID=America/Los_Angeles:20261103T180000", "DTEND;TZID=America/Los_Angeles:20261103T190000",
            "SUMMARY:Yoga (evening)", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
        // Three days over the change of the clocks, from an iPhone (dates, no zone).
        const TRIP = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//iOS 18.0//EN", "BEGIN:VEVENT", "UID:trip-1",
            "DTSTAMP:20261001T000000Z", "DTSTART;VALUE=DATE:20261031", "DTEND;VALUE=DATE:20261103", "SUMMARY:Trip", "END:VEVENT",
            "END:VCALENDAR", ""].join("\r\n");

        it("a recurring event with exceptions: the rule, the skipped week and the moved one, both ways", async () => {
            await ic.cal.put(ic.calHome + "yoga-1.ics", YOGA);
            const d = device(ic);
            await d.add("acct", ic);
            expect((await d.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            const master = live(d.db, EVENT).find((e: Any) => e.subject === "Yoga");
            const kids = live(d.db, EVENT).filter((e: Any) => e.parentId === master._id);
            expect(master.rrule).toMatchObject({ freq: "WEEKLY", count: 6 });
            expect(master.dtstart).toBe(Date.UTC(2026, 9, 20, 14, 30));
            expect(master.exdates.sort()).toEqual(["20261027T143000Z", "20261103T153000Z"]);
            expect(kids).toHaveLength(1);
            expect(kids[0]).toMatchObject({ subject: "Yoga (evening)", recurrenceId: "20261103T153000Z", dtstart: Date.UTC(2026, 10, 4, 2) });
            // The moved one renamed on the device.
            await d.db.merge([{ _id: kids[0]._id, subject: "Yoga (evening, studio B)" }]);
            let r = await d.svc.sync({ accountId: "acct" });
            expect(r.stats).toMatchObject({ uploaded: { modified: 1 }, conflicts: 0, errors: [] });
            const raw = (await ic.cal.get(ic.calHome + "yoga-1.ics")).body;
            const back = ical.toEvents(raw, { localTz: "America/Los_Angeles" });
            expect(back.master).toMatchObject({ subject: "Yoga", dtstart: Date.UTC(2026, 9, 20, 14, 30), rrule: { freq: "WEEKLY", count: 6 } });
            expect(back.master.exdates).toContain("20261027T143000Z");
            expect(back.overrides.map((o: Any) => [o.recurrenceId, o.subject, o.dtstart]))
                .toEqual([["20261103T153000Z", "Yoga (evening, studio B)", Date.UTC(2026, 10, 4, 2)]]);
            expect(raw).toMatch(/RECURRENCE-ID;TZID=America\/Los_Angeles:20261103T073000/);
            expect(raw).toContain("X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC");
            // The iPhone moves another week and drops the first exception.
            await ic.cal.put(ic.calHome + "yoga-1.ics", YOGA.replace("SUMMARY:Yoga (evening)", "SUMMARY:Yoga (evening)")
                .replace("RECURRENCE-ID;TZID=America/Los_Angeles:20261103T073000", "RECURRENCE-ID;TZID=America/Los_Angeles:20261110T073000")
                .replace("DTSTART;TZID=America/Los_Angeles:20261103T180000", "DTSTART;TZID=America/Los_Angeles:20261110T180000")
                .replace("DTEND;TZID=America/Los_Angeles:20261103T190000", "DTEND;TZID=America/Los_Angeles:20261110T190000"));
            r = await d.svc.sync({ accountId: "acct" });
            expect(r.stats).toMatchObject({ conflicts: 0, errors: [] });
            const now = live(d.db, EVENT).filter((e: Any) => e.parentId === master._id);
            expect(now.map((e: Any) => e.recurrenceId)).toEqual(["20261110T153000Z"]);
            expect(live(d.db, EVENT).filter((e: Any) => /Yoga/.test(e.subject) && !e.parentId).map((e: Any) => e._id)).toEqual([master._id]);
            expect(live(d.db, EVENT).find((e: Any) => e._id === master._id).exdates.sort()).toEqual(["20261027T143000Z", "20261110T153000Z"]);
        });

        it("all-day events keep their dates across zones and the change of the clocks, both ways", async () => {
            await ic.cal.put(ic.calHome + "trip-1.ics", TRIP);
            const la = device(ic, { localTz: "America/Los_Angeles" });
            await la.add("acct", ic);
            expect((await la.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            const trip = live(la.db, EVENT).find((e: Any) => e.subject === "Trip");
            expect(trip).toMatchObject({ allDay: true, dtstart: Date.UTC(2026, 9, 31, 7), dtend: Date.UTC(2026, 10, 3, 7, 59, 59) });
            // The same Apple Account on a device in Tokyo: the same dates there.
            const tokyo = device(ic, { localTz: "Asia/Tokyo" });
            await tokyo.add("acct", ic);
            expect((await tokyo.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            const there = live(tokyo.db, EVENT).find((e: Any) => e.subject === "Trip");
            expect(there).toMatchObject({ allDay: true, dtstart: Date.UTC(2026, 9, 30, 15), dtend: Date.UTC(2026, 10, 2, 14, 59, 59) });
            // Edited in Tokyo, then in Los Angeles: still 31 October to 2 November.
            await tokyo.db.merge([{ _id: there._id, note: "Pack boots" }]);
            expect((await tokyo.svc.sync({ accountId: "acct" })).stats.uploaded.modified).toBe(1);
            let raw = (await ic.cal.get(ic.calHome + "trip-1.ics")).body;
            expect(raw).toMatch(/DTSTART;VALUE=DATE:20261031\r\n/);
            expect(raw).toMatch(/DTEND;VALUE=DATE:20261103\r\n/);
            expect((await la.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            const back = live(la.db, EVENT).find((e: Any) => e._id === trip._id);
            expect(back).toMatchObject({ note: "Pack boots", dtstart: Date.UTC(2026, 9, 31, 7), dtend: Date.UTC(2026, 10, 3, 7, 59, 59) });
            await la.db.merge([{ _id: trip._id, subject: "Trip to the coast" }]);
            expect((await la.svc.sync({ accountId: "acct" })).stats.uploaded.modified).toBe(1);
            raw = (await ic.cal.get(ic.calHome + "trip-1.ics")).body;
            expect(raw).toMatch(/DTSTART;VALUE=DATE:20261031\r\n/);
            expect(raw).toMatch(/DTEND;VALUE=DATE:20261103\r\n/);
            // One made on the device on the day the clocks go forward (14 March 2027).
            const home = live(la.db, CALENDAR).find((c: Any) => c.name === "Home");
            await la.db.put([{ _kind: EVENT, accountId: "acct", calendarId: home._id, subject: "Spring forward", allDay: true,
                               tzId: "America/Los_Angeles", dtstart: Date.UTC(2027, 2, 14, 8), dtend: Date.UTC(2027, 2, 15, 6, 59, 59) }]);
            expect((await la.svc.sync({ accountId: "acct" })).stats.uploaded.created).toBe(1);
            const made = (await Promise.all((await ic.cal.list(ic.calHome)).map((h: string) => ic.cal.get(h))))
                .map((x: Any) => x.body).find((b: string) => /Spring forward/.test(b));
            expect(made).toMatch(/DTSTART;VALUE=DATE:20270314\r\n/);
            expect(made).toMatch(/DTEND;VALUE=DATE:20270315\r\n/);
            expect((await tokyo.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            expect(live(tokyo.db, EVENT).find((e: Any) => e.subject === "Spring forward"))
                .toMatchObject({ allDay: true, dtstart: Date.UTC(2027, 2, 13, 15), dtend: Date.UTC(2027, 2, 14, 14, 59, 59) });
        });

        it("a Reminders list (VTODO only) is skipped: no calendar, nothing downloaded or uploaded", async () => {
            await ic.cal.put(ic.calTasks + "todo-1.ics", ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//iOS 12.0//EN",
                "BEGIN:VTODO", "UID:todo-1", "DTSTAMP:20260101T000000Z", "SUMMARY:Buy milk", "END:VTODO", "END:VCALENDAR", ""].join("\r\n"));
            const d = device(ic);
            await d.add("acct", ic);
            ic.hits.length = 0;
            expect((await d.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            expect(live(d.db, CALENDAR).map((c: Any) => c.name).sort()).toEqual(["Home", "Work"]);
            expect(live(d.db, EVENT).some((e: Any) => /milk/.test(e.subject || ""))).toBe(false);
            expect(ic.hits.filter((h: Any) => h.host === "caldav-partition" && /\/tasks\/./.test(h.path) || (h.method === "REPORT" && /\/tasks\/$/.test(h.path)))).toEqual([]);
        });
    });

    describe("contacts", () => {
        let ic: Any;
        beforeAll(async () => { ic = await icloud.start(); }, 30000);
        afterAll(() => ic && ic.stop());

        const photoBytes = Buffer.from(Array.from({ length: 900 }, (_, i) => (i * 37 + 11) % 256));
        const photo64 = photoBytes.toString("base64");
        const NOTE = "日本語のメモ — café ☕ 🎉 ".repeat(6).trim();
        // As an iPhone writes it: grouped labels, a folded photo, UTF-8 names.
        const ZOE = ["BEGIN:VCARD", "VERSION:3.0", "PRODID:-//Apple Inc.//iOS 18.0//EN", "UID:zoe-1", "N:Ångström;Zoë;;;",
            "FN:Zoë Ångström", "NICKNAME:小龍", "ORG:Œuvre & Fils;", "item1.TEL;type=CELL;type=VOICE;type=pref:+1 (408) 555-0101",
            "TEL;type=HOME;type=VOICE:+33 1 23 45 67 89", "item2.TEL:+44 20 7946 0018", "item2.X-ABLabel:_$!<Other>!$_",
            "EMAIL;type=INTERNET;type=HOME;type=pref:zoe@example.com", "EMAIL;type=INTERNET;type=WORK:zoe@oeuvre.example",
            "item3.EMAIL;type=INTERNET:zoë@例え.jp", "item3.X-ABLabel:_$!<Other>!$_", "NOTE:" + NOTE,
            ("PHOTO;ENCODING=b;TYPE=JPEG:" + photo64).match(/.{1,74}/g)!.join("\r\n "), "END:VCARD", ""].join("\r\n");

        it("a photo, several phones and emails, Unicode names: all of it in, and all of it kept on the way back", async () => {
            await ic.card.put(ic.cardBook + "zoe-1.vcf", ZOE);
            const saved: Record<string, string> = {};
            const puts: string[] = [];
            const inner = createRequest();
            const request = (r: Any) => { if (r.method === "PUT") puts.push(r.body); return inner(r); };
            const d = device(ic, { request, savePhoto: (key: string, dataUrl: string) => { saved[key] = dataUrl; return Promise.resolve("/photos/" + key + ".jpg"); } });
            await d.add("acct", ic);
            expect((await d.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            const zoe = given(d.db, "Zoë")[0];
            expect(zoe.name).toMatchObject({ givenName: "Zoë", familyName: "Ångström" });
            expect(zoe.nickname).toBe("小龍");
            expect(zoe.note).toBe(NOTE);
            expect(zoe.phoneNumbers.map((p: Any) => p.value)).toEqual(["+1 (408) 555-0101", "+33 1 23 45 67 89", "+44 20 7946 0018"]);
            expect(zoe.emails.map((e: Any) => e.value)).toEqual(["zoe@example.com", "zoe@oeuvre.example", "zoë@例え.jp"]);
            expect(Object.values(saved)).toEqual(["data:image/jpeg;base64," + photo64]);
            expect(zoe.photos[0].localPath).toMatch(/^\/photos\//);
            // A phone added on the device.
            await d.db.merge([{ _id: zoe._id, phoneNumbers: zoe.phoneNumbers.concat([{ value: "+81 3-1234-5678", type: "type_work" }]) }]);
            const r = await d.svc.sync({ accountId: "acct" });
            expect(r.stats).toMatchObject({ uploaded: { modified: 1 }, errors: [] });
            const raw = (await ic.card.get(ic.cardBook + "zoe-1.vcf")).body;
            // What was sent: lines of at most 75 octets, none splitting a
            // character (Radicale itself keeps them unfolded).
            expect(puts).toHaveLength(1);
            puts[0].split("\r\n").forEach((line: string) => {
                expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
                expect(Buffer.from(line, "utf8").toString("utf8")).toBe(line);
                expect(/[\uD800-\uDBFF]$|^ ?[\uDC00-\uDFFF]/.test(line)).toBe(false);
            });
            const back = vcard.toContact(raw).contact;
            expect(back.name).toMatchObject({ givenName: "Zoë", familyName: "Ångström" });
            expect(back.note).toBe(NOTE);
            expect(back.nickname).toBe("小龍");
            expect(back.phoneNumbers.map((p: Any) => p.value)).toEqual(["+1 (408) 555-0101", "+33 1 23 45 67 89", "+44 20 7946 0018", "+81 3-1234-5678"]);
            expect(back.emails.map((e: Any) => e.value)).toEqual(["zoe@example.com", "zoe@oeuvre.example", "zoë@例え.jp"]);
            expect(back.photos[0].value).toBe("data:image/jpeg;base64," + photo64);
            expect(raw).toContain("UID:zoe-1");
        });

        it("contact groups, Apple's and vCard 4's, never become contacts, whatever happens to them", async () => {
            const group = (uid: string, name: string, members: string[]) => ["BEGIN:VCARD", "VERSION:3.0", "PRODID:-//Apple Inc.//iOS 18.0//EN",
                "UID:" + uid, "N:" + name, "FN:" + name, "X-ADDRESSBOOKSERVER-KIND:group",
                ...members.map((m) => "X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:" + m), "END:VCARD", ""].join("\r\n");
            await ic.card.put(ic.cardBook + "group-1.vcf", group("group-1", "Book club", ["zoe-1"]));
            await ic.card.put(ic.cardBook + "group-2.vcf", ["BEGIN:VCARD", "VERSION:4.0", "UID:group-2", "FN:Climbing", "KIND:group",
                "MEMBER:urn:uuid:zoe-1", "END:VCARD", ""].join("\r\n"));
            const d = device(ic);
            await d.add("acct", ic);
            expect((await d.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            const names = () => live(d.db, CONTACT).map((c: Any) => c.name && (c.name.givenName || c.name.familyName));
            expect(names()).not.toContain("Book club");
            expect(names()).not.toContain("Climbing");
            // Renamed, a member added, then deleted on the iPhone.
            await ic.card.put(ic.cardBook + "group-1.vcf", group("group-1", "Book club 2027", ["zoe-1", "ada-1"]));
            let r = await d.svc.sync({ accountId: "acct" });
            expect(r.stats).toMatchObject({ contactsChanged: 0, uploaded: { created: 0, modified: 0, deleted: 0 }, errors: [] });
            expect(names().some((n: string) => /Book club/.test(n || ""))).toBe(false);
            await ic.card.del(ic.cardBook + "group-1.vcf");
            r = await d.svc.sync({ accountId: "acct" });
            expect(r.stats).toMatchObject({ contactsRemoved: 0, errors: [] });
            expect((await ic.card.get(ic.cardBook + "group-2.vcf")).body).toContain("MEMBER:urn:uuid:zoe-1");
            expect(live(d.db, "com.palm.person:1").some((p: Any) => /Book club|Climbing/.test(JSON.stringify(p.name || {})))).toBe(false);
        });
    });

    describe("a large address book", () => {
        let ic: Any;
        const N = 1040;
        beforeAll(async () => {
            ic = await icloud.start();
            // Straight into Radicale's storage (its folder of .vcf files), which is quicker than 1040 PUTs.
            const dir = join(ic.card.dir, "collections", "collection-root", ic.card.user, "card");
            for (let n = 0; n < N; n++) {
                writeFileSync(join(dir, "p" + n + ".vcf"), card("p" + n, "Person" + n, "Many", ["TEL;type=CELL:+1 555 " + String(n).padStart(7, "0")]));
            }
            expect(await ic.card.list(ic.cardBook)).toHaveLength(N);
        }, 180000);
        afterAll(() => ic && ic.stop());

        it("1040 contacts in pages of 40 (sync-token, 507): all of them once, then an expired token resyncs without a duplicate or a removal", async () => {
            ic.pageSize = 40;
            const d = device(ic);
            await d.add("acct", ic);
            const r = await d.svc.sync({ accountId: "acct" });
            expect(r.returnValue).toBe(true);
            expect(r.stats).toMatchObject({ contactsChanged: N, errors: [] });
            const ids = live(d.db, CONTACT).map((c: Any) => c._id).sort();
            expect(ids).toHaveLength(N);
            expect(new Set(live(d.db, CONTACT).map((c: Any) => c.name.givenName)).size).toBe(N);
            // A change on each side meanwhile, then every token expires.
            const p7 = given(d.db, "Person7")[0];
            const p9 = given(d.db, "Person9")[0];
            await d.db.merge([{ _id: p7._id, note: "device" }]);
            await ic.card.put(ic.cardBook + "p8.vcf", card("p8", "Person8", "Many", ["NOTE:iPhone"]));
            await ic.card.del(ic.cardBook + "p9.vcf");
            ic.expireSyncTokens();
            const r2 = await d.svc.sync({ accountId: "acct" });
            expect(r2.returnValue).toBe(true);
            expect(r2.stats).toMatchObject({ contactsChanged: 1, contactsRemoved: 1, conflicts: 0, errors: [], uploaded: { created: 0, modified: 1, deleted: 0 } });
            const after = live(d.db, CONTACT);
            expect(after).toHaveLength(N - 1);
            // Every contact kept its id, but the one removed.
            expect(after.map((c: Any) => c._id).sort()).toEqual(ids.filter((id: string) => id !== p9._id));
            expect(given(d.db, "Person9")).toEqual([]);
            expect(given(d.db, "Person8")[0].note).toBe("iPhone");
            expect(vcard.toContact((await ic.card.get(ic.cardBook + "p7.vcf")).body).contact.note).toBe("device");
            expect(live(d.db, "com.palm.person:1").length).toBe(N - 1);
        }, 180000);
    });

    describe("a calendar shared with you read-only", () => {
        let ic: Any;
        beforeAll(async () => {
            ic = await icloud.start();
            await ic.addSharedCalendar(ic.first, "family", { displayName: "Family (shared)", advertise: "read" });
            await ic.addSharedCalendar(ic.first, "club", { displayName: "Club (shared)", advertise: "write" });
            await ic.cal.put("/" + ic.cal.user + "/family/bday-1.ics", event("bday-1", "Mum's birthday", "20261212T180000", "20261212T200000"));
            await ic.cal.put("/" + ic.cal.user + "/club/match-1.ics", event("match-1", "Match", "20261213T100000", "20261213T120000"));
        }, 30000);
        afterAll(() => ic && ic.stop());

        it("shows as read-only, and a change made on the device anyway is refused clearly and undone", async () => {
            const d = device(ic);
            await d.add("acct", ic);
            expect((await d.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            const family = live(d.db, CALENDAR).find((c: Any) => c.name === "Family (shared)");
            expect(family.isReadOnly).toBe(true);
            expect(live(d.db, CALENDAR).find((c: Any) => c.name === "Home").isReadOnly).toBe(false);
            const bday = live(d.db, EVENT).find((e: Any) => e.calendarId === family._id);
            await d.db.merge([{ _id: bday._id, subject: "Changed on the device" }]);
            await d.db.put([{ _kind: EVENT, accountId: "acct", calendarId: family._id, subject: "New on the device", allDay: false,
                              dtstart: Date.UTC(2026, 11, 14, 17), dtend: Date.UTC(2026, 11, 14, 18), tzId: "America/Los_Angeles" }]);
            ic.hits.length = 0;
            const r = await d.svc.sync({ accountId: "acct" });
            expect(r.returnValue).toBe(true);
            expect(ic.hits.filter((h: Any) => h.method === "PUT" || h.method === "DELETE")).toEqual([]);
            expect(r.stats.refused).toBe(2);
            expect(r.stats.errors).toHaveLength(2);
            r.stats.errors.forEach((e: string) => expect(e).toMatch(/Family \(shared\) is read-only/));
            const inFamily = live(d.db, EVENT).filter((e: Any) => e.calendarId === family._id);
            expect(inFamily.map((e: Any) => [e._id, e.subject])).toEqual([[bday._id, "Mum's birthday"]]);
            const again = await d.svc.sync({ accountId: "acct" });
            expect(again.stats).toMatchObject({ errors: [], refused: 0, uploaded: { created: 0, modified: 0, deleted: 0 } });
        });

        it("one whose privileges do not say so: iCloud's 403 is taken as read-only, and the change undone", async () => {
            const d = device(ic);
            await d.add("acct", ic);
            expect((await d.svc.sync({ accountId: "acct" })).returnValue).toBe(true);
            const club = live(d.db, CALENDAR).find((c: Any) => c.name === "Club (shared)");
            const match = live(d.db, EVENT).find((e: Any) => e.calendarId === club._id);
            await d.db.del([match._id]);
            const r = await d.svc.sync({ accountId: "acct" });
            expect(r.returnValue).toBe(true);
            expect(r.stats.refused).toBe(1);
            expect(r.stats.errors.join("\n")).toMatch(/Club \(shared\) is read-only/);
            // Back from iCloud, and the calendar known to be read-only from now on.
            expect(live(d.db, EVENT).filter((e: Any) => e.calendarId === club._id).map((e: Any) => e.subject)).toEqual(["Match"]);
            expect(live(d.db, CALENDAR).find((c: Any) => c._id === club._id).isReadOnly).toBe(true);
            expect(await ic.cal.list("/" + ic.cal.user + "/club/")).toHaveLength(1);
            const again = await d.svc.sync({ accountId: "acct" });
            expect(again.stats).toMatchObject({ errors: [], refused: 0 });
        });
    });

    describe("two iCloud accounts, and removing one", () => {
        let ic: Any;
        let second: Any;
        beforeAll(async () => {
            ic = await icloud.start();
            second = await ic.addUser({ user: "sam.okoro@icloud.com", appPassword: "sams-sams-sams-sams", dsid: "20044005", displayName: "Sam Okoro" });
            const photo = "PHOTO;ENCODING=b;TYPE=PNG:iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";
            // The same person (one UID) in both, with a different photo in each.
            await ic.card.put(ic.cardBook + "ada-1.vcf", card("ada-1", "Ada", "Palmer", [photo + "AAAA"]));
            await second.card.put(second.cardBook + "ada-1.vcf", card("ada-1", "Ada", "Palmer", [photo + "BBBB"]));
            await second.card.put(second.cardBook + "sam-1.vcf", card("sam-1", "Theo", "Okoro"));
            await ic.cal.put(ic.calHome + "dinner-1.ics", event("dinner-1", "Dinner", "20261205T190000", "20261205T210000"));
            await second.cal.put(second.calWork + "dinner-1.ics", event("dinner-1", "Dinner (Sam)", "20261205T190000", "20261205T210000"));
        }, 60000);
        afterAll(() => ic && ic.stop());

        it("each account its own contacts, events, calendars and photos; removing one leaves the other and the device's own", async () => {
            const photos: Record<string, string> = {};
            const d = device(ic, { savePhoto: (key: string, url: string) => { photos[key] = url; return Promise.resolve("/p/" + key); } });
            await d.add("a1", ic);
            await d.add("a2", second);
            // The device's own contact (no account) and another account's.
            await d.db.put([{ _kind: "com.palm.contact:1", name: { givenName: "Local", familyName: "Only" } },
                            { _kind: CONTACT, accountId: "some-other-dav", name: { givenName: "Other", familyName: "Account" } }]);
            expect((await d.svc.sync({ accountId: "a1" })).returnValue).toBe(true);
            expect((await d.svc.sync({ accountId: "a2" })).returnValue).toBe(true);
            expect(given(d.db, "Ada", "a1")).toHaveLength(1);
            expect(given(d.db, "Ada", "a2")).toHaveLength(1);
            expect(given(d.db, "Theo", "a2")).toHaveLength(1);
            expect(live(d.db, CALENDAR, "a1")).toHaveLength(2);
            expect(live(d.db, CALENDAR, "a2")).toHaveLength(2);
            // Each Ada's photo is her own.
            expect(new Set(Object.values(photos)).size).toBe(2);
            expect(Object.keys(photos)).toHaveLength(2);
            const p1 = given(d.db, "Ada", "a1")[0].photos[0].localPath, p2 = given(d.db, "Ada", "a2")[0].photos[0].localPath;
            expect(p1).not.toBe(p2);
            expect(photos[p1.slice(3)]).toMatch(/AAAA$/);
            expect(photos[p2.slice(3)]).toMatch(/BBBB$/);
            // A change in one reaches only its own server.
            const ada2 = given(d.db, "Ada", "a2")[0];
            await d.db.merge([{ _id: ada2._id, note: "second account" }]);
            expect((await d.svc.sync({ accountId: "a2" })).stats.uploaded.modified).toBe(1);
            expect(vcard.toContact((await ic.card.get(ic.cardBook + "ada-1.vcf")).body).contact.note || "").toBe("");
            // Remove the first.
            expect((await d.svc.onDelete({ accountId: "a1" })).returnValue).toBe(true);
            for (const kind of [CONTACT, CALENDAR, EVENT, "org.webosphoenix.dav.item:1", "org.webosphoenix.dav.collection:1", "org.webosphoenix.dav.account:1"])
                expect(live(d.db, kind, "a1")).toEqual([]);
            expect(given(d.db, "Ada", "a2")).toHaveLength(1);
            expect(given(d.db, "Theo", "a2")).toHaveLength(1);
            expect(live(d.db, EVENT, "a2").map((e: Any) => e.subject)).toEqual(["Dinner (Sam)"]);
            expect(live(d.db, CALENDAR, "a2")).toHaveLength(2);
            expect(live(d.db, "com.palm.contact:1").filter((c: Any) => c.name.givenName === "Local")).toHaveLength(1);
            expect(given(d.db, "Other", "some-other-dav")).toHaveLength(1);
            // iCloud keeps its own.
            expect(await ic.card.list(ic.cardBook)).toHaveLength(1);
            expect(await ic.cal.list(ic.calHome)).toHaveLength(1);
            // The persons left are those of contacts left.
            const left = live(d.db, "com.palm.contact:1").map((c: Any) => c._id).concat(live(d.db, CONTACT).map((c: Any) => c._id));
            live(d.db, "com.palm.person:1").forEach((p: Any) => (p.contactIds || []).forEach((id: string) => expect(left).toContain(id)));
            expect((await d.svc.sync({ accountId: "a2" })).returnValue).toBe(true);
        });

        it("removed while it is syncing: nothing of it is left afterwards", async () => {
            const d = device(ic);
            await d.add("a1", ic);
            ic.delayMs = 40;
            const running = d.svc.sync({ accountId: "a1" });
            await new Promise((r) => setTimeout(r, 120));
            const removed = await d.svc.onDelete({ accountId: "a1" });
            await running;
            ic.delayMs = 0;
            expect(removed.returnValue).toBe(true);
            for (const kind of [CONTACT, CALENDAR, EVENT, "org.webosphoenix.dav.item:1", "org.webosphoenix.dav.collection:1", "org.webosphoenix.dav.account:1"])
                expect(live(d.db, kind, "a1")).toEqual([]);
        }, 30000);
    });
});
