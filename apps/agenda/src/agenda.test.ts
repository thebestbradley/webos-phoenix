// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { agenda, calendarColor, occurrenceStarts, occurrences, parseIcalDate, whenLabel, type CalendarEvent } from "./agenda";

// Wednesday 3 June 2009, 10:15 local time.
const NOW = new Date(2009, 5, 3, 10, 15).getTime();
const at = (day: number, h: number, m = 0) => new Date(2009, 5, day, h, m).getTime();
const CAL = [{ _id: "c1", color: "green" }, { _id: "c2", color: "#123456" }, { _id: "hidden", color: "red", visible: false }];

describe("repeating events", () => {
    it("expands weekly events on their days", () => {
        // Weekdays at 9:30 from Monday 1 June.
        const e: CalendarEvent = { _id: "standup", dtstart: at(1, 9, 30), dtend: at(1, 10),
            rrule: { freq: "WEEKLY", interval: 1, rules: [{ ruleType: "BYDAY", ruleValue: [1, 2, 3, 4, 5].map((day) => ({ day })) }] } };
        const days = occurrenceStarts(e, at(9, 0)).map((t) => new Date(t).getDate());
        expect(days).toEqual([1, 2, 3, 4, 5, 8]);
        // Every other week, on the event's own weekday, three times.
        const fortnightly: CalendarEvent = { dtstart: at(1, 18), rrule: { freq: "WEEKLY", interval: 2, count: 3 } };
        expect(occurrenceStarts(fortnightly, at(30, 0) + 60 * 86400000).map((t) => new Date(t).getDate())).toEqual([1, 15, 29]);
    });

    it("expands daily, monthly and yearly ones, until their end", () => {
        expect(occurrenceStarts({ dtstart: at(1, 8), rrule: { freq: "DAILY", until: at(4, 8) } }, at(30, 0)).length).toBe(4);
        expect(occurrenceStarts({ dtstart: at(1, 8), rrule: { freq: "DAILY", until: "20090603T235959" } }, at(30, 0)).length).toBe(3);
        // The 31st: not in months without one.
        const end = new Date(2009, 11, 31, 23).getTime();
        const monthly = occurrenceStarts({ dtstart: new Date(2009, 0, 31, 9).getTime(), rrule: { freq: "MONTHLY" } }, end);
        expect(monthly.map((t) => new Date(t).getMonth())).toEqual([0, 2, 4, 6, 7, 9, 11]);
        // The second Tuesday of the month.
        const second = occurrenceStarts({ dtstart: new Date(2009, 0, 13, 19).getTime(),
            rrule: { freq: "MONTHLY", rules: [{ ruleType: "BYDAY", ruleValue: [{ day: 2, ord: 2 }] }] } }, new Date(2009, 3, 1).getTime());
        expect(second.map((t) => new Date(t).getDate())).toEqual([13, 10, 10]);
        const yearly = occurrenceStarts({ dtstart: new Date(2007, 5, 6).getTime(), allDay: true, rrule: { freq: "YEARLY" } }, at(30, 0));
        expect(yearly.map((t) => new Date(t).getFullYear())).toEqual([2007, 2008, 2009]);
    });

    it("leaves out exdates, replaced occurrences and hidden calendars", () => {
        const e: CalendarEvent = { _id: "gym", calendarId: "c1", subject: "Gym", dtstart: at(1, 7), dtend: at(1, 8),
            rrule: { freq: "DAILY" }, exdates: [new Date(at(2, 7)).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")] };
        const moved: CalendarEvent = { _id: "gym-moved", calendarId: "c1", subject: "Gym (late)", dtstart: at(3, 19), dtend: at(3, 20),
            parentId: "gym", parentDtstart: at(3, 7) };
        const secret: CalendarEvent = { _id: "s", calendarId: "hidden", subject: "Hidden", dtstart: at(2, 12), dtend: at(2, 13) };
        const occ = occurrences([e, moved, secret], CAL, at(1, 0), at(5, 0));
        expect(occ.map((o) => `${new Date(o.start).getDate()} ${o.subject}`)).toEqual(["1 Gym", "3 Gym (late)", "4 Gym"]);
        expect(occ[0].color).toBe("#52b400");
        expect(parseIcalDate("20090603")).toBe(at(3, 0));
    });
});

describe("the agenda", () => {
    const events: CalendarEvent[] = [
        { _id: "a", calendarId: "c1", subject: "Breakfast", dtstart: at(3, 8), dtend: at(3, 9) },
        { _id: "b", calendarId: "c1", subject: "Stand-up", location: "Room 4B", dtstart: at(3, 9, 30), dtend: at(3, 10, 30) },
        { _id: "c", calendarId: "c2", subject: "Lunch", dtstart: at(3, 12, 30), dtend: at(3, 13, 30) },
        { _id: "d", calendarId: "c2", subject: "Birthday", allDay: true, dtstart: at(4, 0), dtend: at(4, 23, 59) },
        { _id: "e", calendarId: "c1", subject: "Dinner", dtstart: at(4, 18, 30), dtend: at(4, 21) },
        { _id: "f", calendarId: "c1", subject: "Night shift", dtstart: at(5, 22), dtend: at(6, 6) },
        { _id: "g", calendarId: "c1", subject: "Next month", dtstart: new Date(2009, 6, 20, 9).getTime() },
    ];

    it("shows today from now, then the days ahead that have something", () => {
        const occ = occurrences(events, CAL, new Date(2009, 5, 3).getTime(), at(10, 0));
        const days = agenda(occ, NOW, 7, "en-US");
        expect(days.map((d) => d.label)).toEqual(["Today", "Tomorrow", "Friday, June 5", "Saturday, June 6"]);
        // Breakfast is over; the stand-up is still on.
        expect(days[0].items.map((o) => o.subject)).toEqual(["Stand-up", "Lunch"]);
        // All day first.
        expect(days[1].items.map((o) => o.subject)).toEqual(["Birthday", "Dinner"]);
        // Past midnight it is there the next day too.
        expect(days[3].items.map((o) => o.subject)).toEqual(["Night shift"]);
        expect(days[0].items[1].color).toBe("#123456");
    });

    it("keeps today when nothing is left of it", () => {
        const days = agenda([], NOW, 7);
        expect(days).toHaveLength(1);
        expect(days[0]).toMatchObject({ label: "Today", items: [] });
    });

    it("says when, in the clock's format", () => {
        const occ = occurrences(events, CAL, new Date(2009, 5, 3).getTime(), at(10, 0));
        const [today, tomorrow, , saturday] = agenda(occ, NOW, 7, "en-US");
        expect(whenLabel(today.items[0], today.date, false, "en-US")).toBe("9:30 AM – 10:30 AM");
        expect(whenLabel(today.items[0], today.date, true, "en-US")).toBe("09:30 – 10:30");
        expect(whenLabel(tomorrow.items[0], tomorrow.date, false, "en-US")).toBe("All day");
        expect(whenLabel(saturday.items[0], saturday.date, false, "en-US")).toBe("Until 6:00 AM");
    });

    it("knows the Calendar app's colours", () => {
        expect(calendarColor("teal")).toBe("#00a6c9");
        expect(calendarColor("#abcdef")).toBe("#abcdef");
        expect(calendarColor(undefined)).toBe("#0d71d7");
    });
});
