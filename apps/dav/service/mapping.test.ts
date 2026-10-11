// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// vCard <-> com.palm.contact:1 and iCalendar <-> com.palm.calendarevent:1
// (lib/vcard.js, lib/ical.js), and the pieces under them (content lines,
// dates and time zones, the WebDAV XML reader).

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as synckit from "@phoenix/synckit";
import { loadCommonJs } from "../../shared/connector-kit/src/test-support";

// The service's CommonJS files, with the shared sync layer's sources
// (@phoenix/synckit), as the simulator's loader runs them: no build and
// no node_modules link needed.
const load = (file: string) => loadCommonJs(join(__dirname, file));
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const vcard = synckit.vcard as Any;
const ical = synckit.ical as Any;
const CL = synckit.contentline as Any;
const DT = synckit.datetime as Any;
const X = synckit.xml as Any;
const { parseMultistatus } = load("lib/davclient.js") as Any;

const card = (...lines: string[]) => ["BEGIN:VCARD", ...lines, "END:VCARD", ""].join("\r\n");
const cal = (...lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR", ""].join("\r\n");

describe("vCard -> contact", () => {
    it("maps names, phones, emails, addresses, birthday, note (vCard 3.0)", () => {
        const { uid, contact } = vcard.toContact(card(
            "VERSION:3.0", "UID:urn:uuid:1234", "N:Lindqvist;Sofia;Maria;Dr.;PhD", "FN:Dr. Sofia Maria Lindqvist PhD",
            "NICKNAME:Sofi,Sof", "TEL;TYPE=CELL,VOICE;TYPE=PREF:+1 617 555 0108", "TEL;TYPE=WORK,FAX:617-555-0109",
            "TEL;TYPE=HOME,FAX:617-555-0110", "TEL;TYPE=PAGER:617-555-0111", "TEL:617-555-0112",
            "EMAIL;TYPE=INTERNET,WORK:sofia@example.edu", "EMAIL:s@example.org",
            "ADR;TYPE=WORK:PO Box 7;Suite 9;1 Main St;Boston;MA;02110;USA",
            "BDAY:19880412", "NOTE:Line one\\nLine two\\; with\\, escapes", "URL;TYPE=WORK:https://example.edu/~sofia"));
        expect(uid).toBe("1234");
        expect(contact.name).toEqual({ familyName: "Lindqvist", givenName: "Sofia", middleName: "Maria", honorificPrefix: "Dr.", honorificSuffix: "PhD" });
        expect(contact.nickname).toBe("Sofi");
        expect(contact.phoneNumbers.map((p: Any) => [p.value, p.type, p.primary])).toEqual([
            ["+1 617 555 0108", "type_mobile", true], ["617-555-0109", "type_work_fax", false],
            ["617-555-0110", "type_personal_fax", false], ["617-555-0111", "type_pager", false], ["617-555-0112", "type_other", false]]);
        expect(contact.emails.map((e: Any) => [e.value, e.type])).toEqual([["sofia@example.edu", "type_work"], ["s@example.org", "type_other"]]);
        expect(contact.addresses[0]).toMatchObject({ streetAddress: "PO Box 7\nSuite 9\n1 Main St", locality: "Boston", region: "MA",
                                                     postalCode: "02110", country: "USA", type: "type_work" });
        expect(contact.birthday).toBe("1988-04-12");
        expect(contact.note).toBe("Line one\nLine two; with, escapes");
        expect(contact.urls[0]).toMatchObject({ value: "https://example.edu/~sofia", type: "type_work" });
    });

    it("reads vCard 4.0: lower-case types, PREF=1, --MMDD birthdays, data: photos, IMPP", () => {
        const { contact } = vcard.toContact(card(
            "VERSION:4.0", "FN:Theo", "N:;Theo;;;", "TEL;TYPE=cell;PREF=1:tel:+12065550171",
            "BDAY:--0704", "ANNIVERSARY:20150620", "PHOTO:data:image/jpeg;base64,/9j/4AAQ",
            "IMPP;X-SERVICE-TYPE=Skype:skype:theo.l", "IMPP:xmpp:theo@example.org"));
        expect(contact.phoneNumbers[0]).toMatchObject({ value: "+12065550171", type: "type_mobile", primary: true });
        expect(contact.birthday).toBe("0000-07-04");
        expect(contact.anniversary).toBe("2015-06-20");
        expect(contact.photos[0]).toMatchObject({ value: "data:image/jpeg;base64,/9j/4AAQ", type: "type_big" });
        expect(contact.ims.map((i: Any) => [i.value, i.type])).toEqual([["theo.l", "type_skype"], ["theo@example.org", "type_jabber"]]);
    });

    it("reads vCard 2.1: bare types, quoted-printable, base64 photos; Apple's omitted year", () => {
        const { contact } = vcard.toContact(card(
            "VERSION:2.1", "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;J=C3=B6rg", "TEL;CELL;HOME:555-0101",
            "PHOTO;ENCODING=BASE64;TYPE=JPEG:/9j/4AAQ", "X-AIM:jorg99", "BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-01"));
        expect(contact.name).toMatchObject({ familyName: "Müller", givenName: "Jörg" });
        expect(contact.phoneNumbers[0].type).toBe("type_mobile");
        expect(contact.photos[0].value).toBe("data:image/jpeg;base64,/9j/4AAQ");
        expect(contact.ims[0]).toMatchObject({ value: "jorg99", type: "type_aim" });
        expect(contact.birthday).toBe("0000-03-01");
    });

    it("a card with only ORG is a company; one with only FN gets it as the given name", () => {
        expect(vcard.toContact(card("VERSION:3.0", "FN:Bistro Verde", "ORG:Bistro Verde")).contact)
            .toMatchObject({ name: { givenName: "", familyName: "" }, organizations: [{ name: "Bistro Verde" }] });
        expect(vcard.toContact(card("VERSION:3.0", "FN:Madonna")).contact.name.givenName).toBe("Madonna");
    });

    it("unfolds folded lines", () => {
        const { contact } = vcard.toContact("BEGIN:VCARD\r\nVERSION:3.0\r\nN:Brooks;Han\r\n nah;;;\r\nNOTE:a long\r\n\tnote\r\nEND:VCARD\r\n");
        expect(contact.name.givenName).toBe("Hannah");
        expect(contact.note).toBe("a longnote");
    });
});

describe("contact -> vCard", () => {
    const contact = {
        name: { givenName: "Ada", familyName: "Palmer", middleName: "", honorificPrefix: "", honorificSuffix: "" },
        nickname: "Countess", birthday: "0000-12-10", note: "Two\nlines; and, commas",
        phoneNumbers: [{ value: "(408) 555-0142", type: "type_mobile", primary: true }, { value: "555-0199", type: "type_work_fax" }],
        emails: [{ value: "ada@example.com", type: "type_home" }],
        addresses: [{ streetAddress: "1 Loop", locality: "Cupertino", region: "CA", postalCode: "95014", country: "USA", type: "type_home" }],
        organizations: [{ name: "Analytical Engines", department: "R&D", title: "Engineer" }],
        urls: [{ value: "https://ada.example.com", type: "type_home" }],
        ims: [{ value: "ada@jabber.example", type: "type_jabber" }],
        photos: [{ value: "data:image/png;base64,iVBORw0KGgo=", type: "type_big" }]
    };

    it("writes vCard 3.0 for new cards, and reads back the same contact", () => {
        const text = vcard.fromContact(contact, null, { uid: "u-1" });
        expect(text).toMatch(/^BEGIN:VCARD\r\nVERSION:3.0\r\n/);
        expect(text).toContain("UID:u-1");
        expect(text).toContain("FN:Ada Palmer");
        expect(text).toContain("TEL;TYPE=CELL,PREF:(408) 555-0142");
        expect(text).toContain("TEL;TYPE=WORK,FAX:555-0199");
        expect(text).toContain("NOTE:Two\\nlines\\; and\\, commas");
        expect(text).toContain("BDAY;X-APPLE-OMIT-YEAR=1604:1604-12-10");
        expect(text).toContain("PHOTO;ENCODING=b;TYPE=PNG:iVBORw0KGgo=");
        const back = vcard.toContact(text).contact;
        expect(back.name).toEqual(contact.name);
        expect(back.phoneNumbers.map((p: Any) => [p.value, p.type, p.primary])).toEqual([["(408) 555-0142", "type_mobile", true], ["555-0199", "type_work_fax", false]]);
        expect(back.emails[0]).toMatchObject({ value: "ada@example.com", type: "type_home" });
        expect(back.addresses[0]).toMatchObject(contact.addresses[0]);
        expect(back.organizations[0]).toMatchObject({ name: "Analytical Engines", department: "R&D", title: "Engineer" });
        expect(back.ims[0]).toMatchObject({ value: "ada@jabber.example", type: "type_jabber" });
        expect(back.birthday).toBe("0000-12-10");
        expect(back.note).toBe(contact.note);
        expect(back.photos[0].value).toBe("data:image/png;base64,iVBORw0KGgo=");
    });

    it("keeps what it does not map from the server copy, and its version", () => {
        const base = card("VERSION:4.0", "UID:keep-me", "PRODID:-//Other//EN", "N:Old;Name;;;", "FN:Old Name",
                          "CATEGORIES:Friends,VIP", "item1.TEL:555-0000", "item1.X-ABLabel:Boat", "X-CUSTOM;X-P=1:value", "GENDER:F");
        const text = vcard.fromContact(contact, base);
        expect(text).toContain("VERSION:4.0");
        expect(text).toContain("UID:keep-me");
        expect(text).toContain("CATEGORIES:Friends,VIP");
        expect(text).toContain("X-CUSTOM;X-P=1:value");
        expect(text).toContain("GENDER:F");
        expect(text).not.toContain("Old Name");
        expect(text).not.toContain("555-0000");
        expect(text).not.toMatch(/X-ABLabel/i);
        expect(text).toContain("TEL;TYPE=cell;PREF=1:(408) 555-0142");
        expect(text).toContain("BDAY:--1210");
        expect(text).toContain("PHOTO:data:image/png;base64,iVBORw0KGgo=");
    });

    it("folds long lines at 75 octets, keeping UTF-8 characters whole", () => {
        const text = vcard.fromContact({ name: { givenName: "Zoë", familyName: "Ünal" }, note: "é".repeat(100) }, null, { uid: "u" });
        for (const line of text.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
        expect(vcard.toContact(text).contact.note).toBe("é".repeat(100));
    });
});

describe("iCalendar -> event", () => {
    const opts = { localTz: "Europe/Berlin" };

    it("converts TZID times with the IANA database, UTC and floating times", () => {
        const e = ical.toEvents(cal("BEGIN:VEVENT", "UID:a", "DTSTART;TZID=America/Los_Angeles:20260310T090000",
            "DTEND;TZID=America/Los_Angeles:20260310T093000", "SUMMARY:After the DST change", "END:VEVENT"), opts).master;
        expect(e).toMatchObject({ dtstart: Date.UTC(2026, 2, 10, 16), dtend: Date.UTC(2026, 2, 10, 16, 30), tzId: "America/Los_Angeles", allDay: false });
        const u = ical.toEvents(cal("BEGIN:VEVENT", "UID:b", "DTSTART:20260101T120000Z", "DURATION:PT1H30M", "END:VEVENT"), opts).master;
        expect(u).toMatchObject({ dtstart: Date.UTC(2026, 0, 1, 12), dtend: Date.UTC(2026, 0, 1, 13, 30), tzId: "UTC" });
        const f = ical.toEvents(cal("BEGIN:VEVENT", "UID:c", "DTSTART:20260701T080000", "END:VEVENT"), opts).master;
        expect(f).toMatchObject({ dtstart: Date.UTC(2026, 6, 1, 6), dtend: Date.UTC(2026, 6, 1, 6), tzId: "Europe/Berlin" });
    });

    it("understands Outlook zone names and VTIMEZONE-only zones", () => {
        const w = ical.toEvents(cal("BEGIN:VEVENT", "UID:w", "DTSTART;TZID=W. Europe Standard Time:20260115T100000", "END:VEVENT"), opts).master;
        expect(w.dtstart).toBe(Date.UTC(2026, 0, 15, 9));
        const custom = cal("BEGIN:VTIMEZONE", "TZID:My Office", "BEGIN:STANDARD", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
            "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "END:STANDARD", "BEGIN:DAYLIGHT", "DTSTART:19700308T020000",
            "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "END:DAYLIGHT", "END:VTIMEZONE",
            "BEGIN:VEVENT", "UID:v", "DTSTART;TZID=My Office:20260701T100000", "DTEND;TZID=My Office:20261210T100000", "END:VEVENT");
        const v = ical.toEvents(custom, opts).master;
        expect(v.dtstart).toBe(Date.UTC(2026, 6, 1, 14));
        expect(v.dtend).toBe(Date.UTC(2026, 11, 10, 15));
    });

    it("all-day events run from local midnight to 23:59:59 of their last day", () => {
        const e = ical.toEvents(cal("BEGIN:VEVENT", "UID:d", "DTSTART;VALUE=DATE:20261224", "DTEND;VALUE=DATE:20261227", "END:VEVENT"), opts).master;
        expect(e).toMatchObject({ allDay: true, dtstart: Date.UTC(2026, 11, 23, 23), dtend: Date.UTC(2026, 11, 26, 22, 59, 59) });
        const one = ical.toEvents(cal("BEGIN:VEVENT", "UID:e", "DTSTART;VALUE=DATE:20260401", "END:VEVENT"), opts).master;
        expect(one.dtend - one.dtstart).toBe(24 * 3600 * 1000 - 1000);
    });

    it("maps RRULE, EXDATE and alarms to the Calendar app's format", () => {
        const e = ical.toEvents(cal("BEGIN:VEVENT", "UID:r", "DTSTART;TZID=America/New_York:20260105T090000",
            "RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR,1MO;BYMONTH=1,7;WKST=MO;UNTIL=20271231T235959Z",
            "EXDATE;TZID=America/New_York:20260302T090000,20260504T090000",
            "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER;RELATED=END:-P1D", "END:VALARM",
            "BEGIN:VALARM", "ACTION:AUDIO", "TRIGGER;VALUE=DATE-TIME:20260105T080000Z", "END:VALARM", "END:VEVENT"), opts).master;
        expect(e.rrule).toEqual({
            freq: "MONTHLY", interval: 2, until: Date.UTC(2027, 11, 31, 23, 59, 59), wkst: 1,
            rules: [{ ruleType: "BYDAY", ruleValue: [{ day: 5, ord: -1 }, { day: 1, ord: 1 }] },
                    { ruleType: "BYMONTH", ruleValue: [{ ord: 1 }, { ord: 7 }] }]
        });
        expect(e.exdates).toEqual(["20260302T140000Z", "20260504T130000Z"]);
        expect(e.alarm).toEqual([
            { action: "display", alarmTrigger: { value: "-P1D", valueType: "DURATION", related: "end" } },
            { action: "audio", alarmTrigger: { value: "20260105T080000Z", valueType: "DATETIME" } }]);
    });

    it("reads attendees and the organizer", () => {
        const e = ical.toEvents(cal("BEGIN:VEVENT", "UID:m", "DTSTART:20260101T100000Z",
            "ORGANIZER;CN=Hannah Brooks:mailto:hannah@example.com",
            "ATTENDEE;CN=Alex Rivera;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:alex@example.com", "END:VEVENT"), opts).master;
        expect(e.attendees).toEqual([
            { email: "hannah@example.com", commonName: "Hannah Brooks", organizer: true },
            { email: "alex@example.com", commonName: "Alex Rivera", organizer: false, role: "REQ-PARTICIPANT", participationStatus: "ACCEPTED" }]);
    });
});

describe("event -> iCalendar", () => {
    const tz = "America/New_York";
    const base = {
        subject: "Planning; Q4, draft", location: "Room 2A", note: "Agenda\nfollows", allDay: false, tzId: tz,
        dtstart: Date.UTC(2026, 9, 5, 14), dtend: Date.UTC(2026, 9, 5, 15),
        alarm: [{ action: "display", alarmTrigger: { value: "-PT15M", valueType: "DURATION" } }]
    };

    it("writes timed events with their IANA zone, escaping text", () => {
        const text = ical.fromEvents(base, [], null, { localTz: tz, uid: "p-1", now: Date.UTC(2026, 8, 1) });
        expect(text).toContain("UID:p-1");
        expect(text).toContain("DTSTAMP:20260901T000000Z");
        expect(text).toContain("DTSTART;TZID=America/New_York:20261005T100000");
        expect(text).toContain("DTEND;TZID=America/New_York:20261005T110000");
        expect(text).toContain("SUMMARY:Planning\\; Q4\\, draft");
        expect(text).toContain("DESCRIPTION:Agenda\\nfollows");
        expect(text).toMatch(/BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\n/);
        expect(ical.toEvents(text, { localTz: tz }).master).toMatchObject({ subject: base.subject, note: base.note, dtstart: base.dtstart, dtend: base.dtend });
    });

    it("writes UTC when the zone is UTC or unknown", () => {
        const text = ical.fromEvents({ ...base, tzId: "UTC" }, [], null, { localTz: tz, uid: "u" });
        expect(text).toContain("DTSTART:20261005T140000Z");
    });

    it("writes all-day events as DATE with an exclusive end", () => {
        const e = ical.toEvents(cal("BEGIN:VEVENT", "UID:d", "DTSTART;VALUE=DATE:20261224", "DTEND;VALUE=DATE:20261227", "END:VEVENT"), { localTz: tz }).master;
        const text = ical.fromEvents(e, [], null, { localTz: tz, uid: "d" });
        expect(text).toContain("DTSTART;VALUE=DATE:20261224");
        expect(text).toContain("DTEND;VALUE=DATE:20261227");
    });

    it("writes RRULE, EXDATE and overrides; an override's date is not an EXDATE", () => {
        const master = { ...base, rrule: { freq: "WEEKLY", interval: 1, count: 8, wkst: 0,
                                           rules: [{ ruleType: "BYDAY", ruleValue: [{ day: 1 }, { day: 4 }] }] },
                         exdates: ["20261008T140000Z", "20261012T140000Z"] };
        const child = { ...base, subject: "Planning (moved)", recurrenceId: "20261012T140000Z", parentId: "x",
                        dtstart: Date.UTC(2026, 9, 12, 18), dtend: Date.UTC(2026, 9, 12, 19) };
        const text = ical.fromEvents(master, [child, { ...child, _del: true, recurrenceId: "20261015T140000Z" }], null, { localTz: tz, uid: "w" });
        expect(text).toContain("RRULE:FREQ=WEEKLY;COUNT=8;WKST=SU;BYDAY=MO,TH");
        expect(text).toContain("EXDATE;TZID=America/New_York:20261008T100000");
        expect(text).not.toContain("20261012T100000,");
        expect(text).toContain("RECURRENCE-ID;TZID=America/New_York:20261012T100000");
        const parsed = ical.toEvents(text, { localTz: tz });
        expect(parsed.overrides).toHaveLength(1);
        expect(parsed.master.exdates.sort()).toEqual(["20261008T140000Z", "20261012T140000Z"]);
    });

    it("keeps attendees, X- properties and VTIMEZONEs of the server copy", () => {
        const server = cal("BEGIN:VTIMEZONE", "TZID:America/New_York", "END:VTIMEZONE", "BEGIN:VEVENT", "UID:srv-1",
            "DTSTART;TZID=America/New_York:20261005T100000", "SUMMARY:Old", "ORGANIZER:mailto:boss@example.com",
            "ATTENDEE;CN=Me:mailto:me@example.com", "X-MOZ-GENERATION:3", "SEQUENCE:2", "END:VEVENT", "BEGIN:VTODO", "UID:t", "END:VTODO");
        const text = ical.fromEvents(base, [], server, { localTz: tz });
        expect(text).toContain("UID:srv-1");
        expect(text).toContain("ORGANIZER:mailto:boss@example.com");
        expect(text).toContain("ATTENDEE;CN=Me:mailto:me@example.com");
        expect(text).toContain("X-MOZ-GENERATION:3");
        expect(text).toContain("BEGIN:VTIMEZONE");
        expect(text).toContain("BEGIN:VTODO");
        expect(text).not.toContain("SUMMARY:Old");
        expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    });
});

describe("building blocks", () => {
    it("content lines: quoted parameters and groups", () => {
        const [c] = CL.parse("BEGIN:X\r\nitem2.ADR;TYPE=\"home,pref\";LABEL=\"1 Main St:Apt 2\":;;1 Main St;;;;\r\nEND:X\r\n");
        expect(c.props[0]).toMatchObject({ group: "item2", name: "ADR", params: { TYPE: ["home,pref"], LABEL: ["1 Main St:Apt 2"] } });
        expect(CL.splitValue("a\\;b;c\\,d;", ";")).toEqual(["a;b", "c,d", ""]);
    });

    it("dates, durations and zones", () => {
        expect(DT.parseDuration("-P1DT2H30M")).toBe(-(26 * 60 + 30) * 60000);
        expect(DT.parseDuration("P2W")).toBe(14 * 86400000);
        expect(DT.formatDuration(-15 * 60000)).toBe("-PT15M");
        expect(DT.formatDuration(7 * 86400000)).toBe("P1W");
        expect(DT.fromWall({ year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 }, "Europe/Berlin"))
            .toBe(Date.UTC(2026, 2, 29, 1, 30)); // in the spring-forward gap: moved forward
        expect(DT.ianaZone("/mozilla.org/20050126_1/America/New_York")).toBe("America/New_York");
        expect(DT.ianaZone("Tokyo Standard Time")).toBe("Asia/Tokyo");
        expect(DT.ianaZone("Nowhere/Special")).toBeNull();
    });

    it("WebDAV multistatus with prefixes, default namespaces and entities", () => {
        const list = parseMultistatus(`<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="http://calendarserver.org/ns/">
  <D:response><D:href>/dav/a%20b.vcf</D:href>
    <D:propstat><D:prop><D:getetag>"e&amp;1"</D:getetag><C:getctag>7</C:getctag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
    <D:propstat><D:prop><D:displayname/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>
  </D:response>
  <response xmlns="DAV:"><href>/dav/gone.vcf</href><status>HTTP/1.1 404 Not Found</status></response>
  <D:sync-token>tok-2</D:sync-token>
</D:multistatus>`, "https://dav.example.com/dav/");
        expect(list.map((i: Any) => [i.href, i.status])).toEqual([["https://dav.example.com/dav/a%20b.vcf", 200], ["https://dav.example.com/dav/gone.vcf", 404]]);
        expect(X.text(list[0].props["DAV: getetag"])).toBe("\"e&1\"");
        expect(Object.keys(list[0].props)).toEqual(["DAV: getetag", "http://calendarserver.org/ns/ getctag"]);
        expect(list.syncToken).toBe("tok-2");
    });
});
