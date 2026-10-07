// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Subscribed Calendar (template com.webosphoenix.webcal, lib/webcal.js;
// docs/M6-PLAN.md F4 item 8): a public .ics read one way into a read-only
// calendar, with db8 and the accounts service faked in memory
// (test/memdb.cjs) and the calendar's server faked as a function.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const { createDavService } = require("./davservice.js") as Any;
const { split, httpUrl } = require("./lib/webcal.js") as Any;
const { createMemDb, createFakeBus, KIND_PARENTS } = require("./test/memdb.cjs") as Any;

const ACCOUNT = "webcal-account-1";
const ics = (events: string[], name = "Phoenix Holidays") => [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", `X-WR-CALNAME:${name}`,
    "BEGIN:VTIMEZONE", "TZID:Europe/Berlin", "BEGIN:STANDARD", "DTSTART:19701025T030000", "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE",
    ...events, "END:VCALENDAR", ""].join("\r\n");
const EV = (uid: string, summary: string, day: string, extra: string[] = []) => [
    "BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20260101T000000Z", `DTSTART;VALUE=DATE:${day}`, `SUMMARY:${summary}`, ...extra, "END:VEVENT"];

function setup(files: Record<string, string>) {
    const db = createMemDb(KIND_PARENTS);
    const account = { _id: ACCOUNT, templateId: "com.webosphoenix.webcal", username: "Phoenix Holidays",
                      capabilityProviders: [{ id: "com.webosphoenix.webcal.calendar", capability: "CALENDAR" }] };
    const bus = createFakeBus({ db, accounts: { [ACCOUNT]: account },
                                credentials: { [ACCOUNT]: { common: { password: "", url: "https://cal.example.org/holidays.ics" } } } });
    const asked: string[] = [];
    const request = async (req: Any) => {
        asked.push(req.url);
        if (req.url === "https://cal.example.org/moved.ics") return { status: 301, headers: { location: "/holidays.ics" }, body: "" };
        const body = files[req.url];
        return body === undefined ? { status: 404, headers: {}, body: "" } : { status: 200, headers: {}, body };
    };
    const svc = createDavService({ luna: bus, request, localTz: "Europe/Berlin", periodicSync: false });
    return { db, svc, asked };
}
const live = (db: Any, kind: string) => Object.values(db.objects as Record<string, Any>).filter((o: Any) => !o._del && o._kind === kind);

describe("Subscribed calendars (.ics, one way)", () => {
    it("reads webcal addresses as https, and cuts a file into its events", () => {
        expect(httpUrl("webcal://cal.example.org/x.ics")).toBe("https://cal.example.org/x.ics");
        expect(httpUrl(" https://cal.example.org/x.ics ")).toBe("https://cal.example.org/x.ics");
        expect(() => httpUrl("ftp://x/y.ics")).toThrow();
        const s = split(ics([...EV("a", "New Year", "20270101"), ...EV("b", "Labour Day", "20270501"),
                             ...EV("b", "Labour Day (moved)", "20270502", ["RECURRENCE-ID;VALUE=DATE:20270501"])]));
        expect(s.name).toBe("Phoenix Holidays");
        expect(s.events.map((e: Any) => e.uid)).toEqual(["a", "b"]);
        expect(s.events[1].text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
        expect(s.events[0].text).toContain("BEGIN:VTIMEZONE");
        expect(() => split("<html>not a calendar</html>")).toThrow(/not a calendar/);
    });

    it("checks the address, then reads it into a read-only calendar, again only when it changed", async () => {
        const url = "https://cal.example.org/holidays.ics";
        const files: Record<string, string> = { [url]: ics([...EV("a", "New Year", "20270101"), ...EV("b", "Labour Day", "20270501")]) };
        const { db, svc, asked } = setup(files);
        const v = await svc.checkCredentials({ templateId: "com.webosphoenix.webcal", username: "", password: "",
                                               config: { url: "webcal://cal.example.org/moved.ics" } });
        expect(v).toMatchObject({ returnValue: true, username: "Phoenix Holidays", credentials: { common: { url: "https://cal.example.org/moved.ics" } },
                                  config: { events: 2 } });
        expect(asked).toEqual(["https://cal.example.org/moved.ics", url]);
        const bad = await svc.checkCredentials({ templateId: "com.webosphoenix.webcal", config: { url: "https://cal.example.org/none.ics" } });
        expect(bad.returnValue).toBe(false);

        expect((await svc.sync({ accountId: ACCOUNT })).stats).toMatchObject({ events: 2, unchanged: false });
        const cals = live(db, "com.palm.calendar.dav:1");
        expect(cals).toHaveLength(1);
        expect(cals[0]).toMatchObject({ name: "Phoenix Holidays", isReadOnly: true, accountId: ACCOUNT });
        expect(live(db, "com.palm.calendarevent.dav:1").map((e: Any) => e.subject).sort()).toEqual(["Labour Day", "New Year"]);
        expect(live(db, "com.palm.calendarevent.dav:1").every((e: Any) => e.calendarId === cals[0]._id && e.allDay)).toBe(true);

        // Unchanged: nothing is written again.
        expect((await svc.sync({ accountId: ACCOUNT })).stats.unchanged).toBe(true);
        // Changed: the file wins, one way.
        files[url] = ics([...EV("a", "New Year's Day", "20270101"), ...EV("c", "Unity Day", "20271003")]);
        expect((await svc.sync({ accountId: ACCOUNT })).stats).toMatchObject({ events: 2, unchanged: false });
        expect(live(db, "com.palm.calendarevent.dav:1").map((e: Any) => e.subject).sort()).toEqual(["New Year's Day", "Unity Day"]);
        expect(live(db, "com.palm.calendar.dav:1")).toHaveLength(1);

        // Removed: its calendar and events go.
        await svc.onDelete({ accountId: ACCOUNT });
        expect(live(db, "com.palm.calendarevent.dav:1")).toHaveLength(0);
        expect(live(db, "com.palm.calendar.dav:1")).toHaveLength(0);
    });
});
