// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The everyday requests the Assistant's English grammar understands
// (lib/lang/en.js): each family of phrasings, what it should not take, and
// the days and times people say ("next Tuesday at noon", "in 2 hours",
// "tonight", "every Monday"). grammar.test.ts has the first commands.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Args = Record<string, any>;
type Parsed = { command: string; args: Args } | null;
const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(text: string, ctx?: object): Parsed; compileAppCommands(a: object[], l?: string): object[] };
const en = req("./lib/lang/en.js") as {
    when(t: string, now: number, o?: object): number | null;
    extract(t: string, now: number): Args;
    resolve(i: Args, now: number, prefer: string): Args;
};
const dates = req("./lib/dates.js") as { occurrences(ev: object, from: number, to: number): number[]; rrule(r: object, s: number): object };
const units = req("./lib/units.js") as { convert(v: number, f: string, t: string): number | null; round(v: number): string };

// Wednesday 7 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 7, 10, 0, 0).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m, 0).getTime();
const day = (d: number, month = 9, y = 2026) => new Date(y, month, d).getTime();
const APPS = [
    { id: "com.palm.app.calendar", title: "Calendar",
      universalSearch: { action: { displayName: "New Event", launchParam: "quickLaunchText", url: "com.palm.app.calendar" } } },
    { id: "com.palm.app.notes", title: "Memos", universalSearch: { action: { displayName: "New Memo", url: "com.palm.app.notes", launchParam: "text" } } },
    { id: "org.webosphoenix.tasks", title: "Tasks", universalSearch: { action: { displayName: "New Task", url: "org.webosphoenix.tasks", launchParam: "text" } } },
    { id: "org.webosphoenix.settings", title: "Settings" },
];
const CTX = { lang: "en", now: NOW, apps: APPS, names: ["Sam", "Sam Delgado", "Priya", "Priya Nair", "Mom", "Alex", "Alex Rivera"],
              appCommands: grammar.compileAppCommands(APPS, "en") };
const parse = (t: string) => grammar.parse(t, CTX);
const cmd = (t: string) => parse(t)?.command ?? null;
const args = (t: string) => parse(t)?.args ?? null;

describe("calendar events", () => {
    it("adds events from the ways people say them", () => {
        expect(parse("add a meeting with Sam tomorrow at 3")).toEqual({ command: "event", args: {
            title: "Meeting with Sam", start: at(8, 15), end: null, allDay: false, repeat: null, location: "", invitees: ["sam"] } });
        expect(args("create an event called dentist on Friday at 10am")).toMatchObject({ title: "Dentist", start: at(9, 10), allDay: false });
        expect(args("schedule lunch with Priya next Tuesday at noon")).toMatchObject({ title: "Lunch with Priya", start: at(13, 12), invitees: ["priya"] });
        expect(args("put gym on my calendar tomorrow at 8am")).toMatchObject({ title: "Gym", start: at(8, 8) });
        expect(args("new event Dentist Friday 2pm")).toMatchObject({ title: "Dentist", start: at(9, 14) });
        expect(args("add dentist appointment to my calendar on the 20th at 9:30")).toMatchObject({ title: "Dentist appointment", start: at(20, 9, 30) });
        expect(args("Add an appointment called Haircut on October 22nd at 4:15 pm")).toMatchObject({ title: "Haircut", start: at(22, 16, 15) });
    });
    it("reads durations, ranges, places, people, all-day and repeats", () => {
        expect(args("schedule a meeting with Sam and Priya tomorrow from 2 to 3:30 at Room 4B")).toMatchObject({
            title: "Meeting with Sam and Priya", start: at(8, 14), end: at(8, 15, 30), location: "Room 4B", invitees: ["sam", "priya"] });
        expect(args("add a call with Alex on Monday at 9 for 30 minutes")).toMatchObject({ title: "Call with Alex", start: at(12, 9), end: at(12, 9, 30) });
        expect(args("add an event called team offsite on Friday all day")).toMatchObject({ title: "Team offsite", start: day(9), allDay: true });
        expect(args("add Priya's birthday to my calendar on October 30")).toMatchObject({ title: "Priya's birthday", start: day(30), allDay: true });
        expect(args("schedule yoga every Monday at 7pm")).toMatchObject({ title: "Yoga", start: at(12, 19), repeat: { freq: "WEEKLY", days: [1] } });
        expect(args("add a meeting called standup every weekday at 9:30")).toMatchObject({ title: "Standup", start: at(8, 9, 30), repeat: { freq: "WEEKLY", days: [1, 2, 3, 4, 5] } });
        expect(args("book dinner at Bistro Verde tonight at 8")).toMatchObject({ title: "Dinner", location: "Bistro Verde", start: at(7, 20) });
        expect(args("schedule a 1:1 with Sam 3-4pm tomorrow")).toMatchObject({ title: "1:1 with Sam", start: at(8, 15), end: at(8, 16) });
    });
    it("asks when, rather than guessing, when no time is said", () => {
        expect(args("add a meeting with Sam")).toMatchObject({ title: "Meeting with Sam", start: null });
    });
    it("leaves what is not an event", () => {
        expect(cmd("add milk to my shopping list")).toBe("task");
        expect(cmd("schedule")).toBeNull();
        expect(cmd("make a sandwich")).toBeNull();
        expect(cmd("add 5 and 7")).not.toBe("event");
    });
    it("reads the agenda: a day, a week, the next one, one by name", () => {
        expect(args("what's on my calendar today")).toEqual({ range: "day", from: day(7), to: day(8) });
        expect(args("what do I have tomorrow")).toEqual({ range: "day", from: day(8), to: day(9) });
        expect(args("what's on my schedule this week")).toEqual({ range: "week", from: day(7), to: day(12), label: "this week" });
        expect(args("show my calendar for next week")).toEqual({ range: "week", from: day(12), to: day(19), label: "next week" });
        expect(args("do I have anything on Friday")).toEqual({ range: "day", from: day(9), to: day(10) });
        expect(args("am I busy on Monday")).toEqual({ range: "day", from: day(12), to: day(13) });
        expect(args("what's my next meeting")).toEqual({ range: "next" });
        expect(args("when is my dentist appointment")).toEqual({ range: "find", query: "dentist" });
        expect(args("my agenda")).toEqual({ range: "day", from: day(7), to: day(8) });
        expect(cmd("what's on TV")).toBeNull();
        expect(cmd("when is sunset")).toBeNull();
    });
});

describe("days and times as said", () => {
    const w = (t: string, o?: object) => en.when(t, NOW, o);
    it("relative times", () => {
        expect(w("in 2 hours")).toBe(NOW + 2 * 3600000);
        expect(w("in twenty minutes")).toBe(NOW + 20 * 60000);
        expect(w("in an hour and a half")).toBe(NOW + 5400000);
        expect(w("half an hour from now")).toBe(NOW + 1800000);
        expect(w("in 3 days")).toBe(at(10, 9));
        expect(w("a week from today")).toBe(at(14, 9));
    });
    it("days, weekdays and dates", () => {
        expect(w("tonight")).toBe(at(7, 18));
        expect(w("tomorrow morning")).toBe(at(8, 9));
        expect(w("tomorrow evening at 7")).toBe(at(8, 19));
        expect(w("the day after tomorrow at 9")).toBe(at(9, 9));
        expect(w("next tuesday at noon")).toBe(at(13, 12));
        expect(w("this friday at 5", { prefer: "day" })).toBe(at(9, 17));
        expect(w("on wednesday")).toBe(at(14, 9));
        expect(w("on the 15th at 10")).toBe(at(15, 10));
        expect(w("on the 3rd")).toBe(new Date(2026, 10, 3, 9).getTime());
        expect(w("october 20th at 6:30pm")).toBe(at(20, 18, 30));
        expect(w("20 october")).toBe(at(20, 9));
        expect(w("march 5")).toBe(new Date(2027, 2, 5, 9).getTime());
        expect(w("the fifth of november at quarter past 8 in the morning")).toBe(new Date(2026, 10, 5, 8, 15).getTime());
        expect(w("next week")).toBe(at(12, 9));
    });
    it("hours without am or pm, by what is being asked", () => {
        expect(w("at 3", { prefer: "day" })).toBe(at(7, 15));
        expect(w("at 9", { prefer: "day" })).toBe(at(8, 9));
        expect(w("at 11", { prefer: "alarm" })).toBe(at(7, 11));
        expect(w("at 7", { preferAm: true })).toBe(at(8, 7));
        expect(w("at seven thirty pm")).toBe(at(7, 19, 30));
        expect(w("at 8 tonight")).toBe(at(7, 20));
    });
    it("repeats", () => {
        const r = (t: string) => en.resolve(en.extract(t, NOW), NOW, "day");
        expect(r("every monday at 7pm")).toMatchObject({ start: at(12, 19), repeat: { freq: "WEEKLY", days: [1] } });
        expect(r("every monday and wednesday at 9")).toMatchObject({ start: at(12, 9), repeat: { freq: "WEEKLY", days: [1, 3] } });
        expect(r("daily at 8am")).toMatchObject({ start: at(8, 8), repeat: { freq: "DAILY" } });
        expect(r("every other week")).toMatchObject({ repeat: { freq: "WEEKLY", interval: 2 } });
        expect(r("weekdays at 7am")).toMatchObject({ start: at(8, 7), repeat: { freq: "WEEKLY", days: [1, 2, 3, 4, 5] } });
        expect(r("every month on the 1st")).toMatchObject({ start: new Date(2026, 10, 1).getTime(), allDay: true, repeat: { freq: "MONTHLY" } });
    });
    it("leaves words that are not times", () => {
        expect(w("the gate code")).toBeNull();
        expect(en.extract("one on one with sam", NOW).rest).toBe("one on one with sam");
        expect(en.extract("book a table for 3", NOW).clock).toBeUndefined();
    });
    it("expands repeating events as the Calendar stores them", () => {
        const ev = { dtstart: at(5, 9, 30), dtend: at(5, 10), rrule: dates.rrule({ freq: "WEEKLY", days: [1, 2, 3, 4, 5] }, at(5, 9, 30)) };
        expect(ev.rrule).toEqual({ freq: "WEEKLY", interval: 1, rules: [{ ruleType: "BYDAY", ruleValue: [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }, { day: 5 }] }] });
        expect(dates.occurrences(ev, day(9), day(13))).toEqual([at(9, 9, 30), at(12, 9, 30)]);
        expect(dates.occurrences({ ...ev, exdates: [String(at(12, 9, 30))] }, day(9), day(13))).toEqual([at(9, 9, 30)]);
        expect(dates.occurrences({ dtstart: at(15, 0), dtend: at(15, 23, 59), allDay: true, rrule: { freq: "MONTHLY", interval: 1, rules: [] } },
                                 day(1, 10), day(1, 11))).toEqual([new Date(2026, 10, 15).getTime()]);
    });
});

describe("timers, the stopwatch and alarms", () => {
    it("timers left and cancelled", () => {
        for (const t of ["how much time is left", "how long is left on the timer", "check my timer", "what's left on the timer", "is the timer still running"])
            expect(cmd(t), t).toBe("timerStatus");
        expect(args("cancel the timer")).toEqual({ label: "", all: false });
        expect(args("stop the eggs timer")).toEqual({ label: "eggs", all: false });
        expect(args("cancel all timers")).toEqual({ label: "", all: true });
        expect(cmd("set a 5 minute timer")).toBe("timer");
        expect(cmd("how much time is left in the year")).toBeNull();
    });
    it("the stopwatch", () => {
        expect(args("start a stopwatch")).toEqual({ action: "start" });
        expect(args("stop the stopwatch")).toEqual({ action: "stop" });
        expect(args("reset the stopwatch")).toEqual({ action: "reset" });
        expect(args("how long has the stopwatch been running")).toEqual({ action: "status" });
    });
    it("alarms that repeat as the Clock can", () => {
        expect(args("set an alarm for 7am weekdays")).toEqual({ time: at(8, 7), label: "", repeat: "weekdays" });
        expect(args("wake me up at 6:30 every day")).toEqual({ time: at(8, 6, 30), label: "", repeat: "daily" });
        expect(args("set an alarm for 9 on weekends")).toEqual({ time: at(10, 9), label: "", repeat: "weekends" });
        expect(args("set an alarm for 7 every monday")).toEqual({ time: at(12, 7), label: "", repeat: "once", unrepeated: "every Monday" });
        expect(args("set an alarm for 6 tomorrow")).toEqual({ time: at(8, 6), label: "" });
        expect(args("set an alarm in 20 minutes")).toEqual({ time: NOW + 20 * 60000, label: "" });
    });
    it("alarms listed, turned off, deleted", () => {
        expect(cmd("what alarms do I have")).toBe("alarmList");
        expect(cmd("show my alarms")).toBe("alarmList");
        expect(cmd("when is my next alarm")).toBe("alarmList");
        expect(args("cancel my 7am alarm")).toEqual({ action: "off", hour: 7, minute: 0, meridiem: "am", all: false });
        expect(args("turn off the alarm for 6:30")).toEqual({ action: "off", hour: 6, minute: 30, meridiem: "", all: false });
        expect(args("delete all alarms")).toEqual({ action: "delete", hour: null, minute: null, meridiem: "", all: true });
        expect(args("delete my alarms")).toMatchObject({ action: "delete", all: true });
        expect(cmd("turn off the alarm system")).toBeNull();
    });
});

describe("reminders, tasks, lists, memos", () => {
    it("reminders with times said anywhere", () => {
        expect(args("remind me to call mom at 6")).toEqual({ text: "call mom", due: at(7, 18) });
        expect(args("remind me to take the bins out tonight")).toEqual({ text: "take the bins out", due: at(7, 18) });
        expect(args("remind me in 2 hours to check the oven")).toEqual({ text: "check the oven", due: NOW + 7200000 });
        expect(args("remind me tomorrow morning to call the bank")).toEqual({ text: "call the bank", due: at(8, 9) });
        expect(args("remind me about the meeting with Sam on Friday at 4")).toEqual({ text: "the meeting with Sam", due: at(9, 16) });
        expect(cmd("remember that the gate code is 1234")).toBe("note");
    });
    it("tasks and named lists", () => {
        expect(args("add milk to my shopping list")).toEqual({ text: "Milk", list: "Shopping", due: null });
        expect(args("put eggs and bread on the grocery list")).toEqual({ text: "Eggs and bread", list: "Grocery", due: null });
        expect(args("create a task pay rent")).toEqual({ text: "Pay rent", list: "", due: null });
        expect(args("add a task to call the bank tomorrow")).toEqual({ text: "Call the bank", list: "", due: at(8, 9) });
        expect(args("add renew passport to my to-do list")).toEqual({ text: "Renew passport", list: "", due: null });
        expect(args("new to-do: water the plants")).toEqual({ text: "Water the plants", list: "", due: null });
    });
    it("memos, and finding them", () => {
        expect(args("new note: buy flowers for Ada")).toEqual({ text: "Buy flowers for Ada" });
        expect(args("take a note that the wifi password is on the fridge")).toEqual({ text: "The wifi password is on the fridge" });
        expect(args("note down: Parking on level 3")).toEqual({ text: "Parking on level 3" });
        expect(args("make a memo saying call the plumber")).toEqual({ text: "Call the plumber" });
        expect(args("find my notes about Wi-Fi")).toEqual({ query: "wi-fi" });
        expect(args("search my memos for books")).toEqual({ query: "books" });
        expect(args("show me my notes")).toEqual({ query: "" });
        expect(cmd("notes about")).toBeNull();
    });
});

describe("people, messages and email", () => {
    it("texts keep the words as typed, and name the contact", () => {
        expect(args("text Sam I'm running late")).toEqual({ who: "sam", message: "I'm running late" });
        expect(args("text Priya Nair See you at 6")).toEqual({ who: "priya nair", message: "See you at 6" });
        expect(cmd("send an email to Priya")).toBe("email");
    });
    it("calls", () => {
        expect(args("call mom")).toEqual({ who: "mom", label: "" });
        expect(args("call Sam on his mobile")).toEqual({ who: "sam", label: "mobile" });
    });
    it("emails: compose, or read back with words", () => {
        expect(args("email Alex about the report")).toEqual({ who: "alex", subject: "The report", body: "" });
        expect(args("send an email to Priya saying see you soon")).toEqual({ who: "priya", subject: "", body: "See you soon" });
        expect(args("email Sam about lunch saying are you free at 1")).toEqual({ who: "sam", subject: "Lunch", body: "Are you free at 1" });
        expect(args("email alex@example.com subject invoice")).toEqual({ who: "alex@example.com", subject: "Invoice", body: "" });
        expect(cmd("email")).toBeNull();
    });
    it("finds email and reads messages", () => {
        expect(args("search my email for invoice")).toEqual({ query: "invoice", from: false, unread: false });
        expect(args("find emails from Alex")).toEqual({ query: "alex", from: true, unread: false });
        expect(args("do I have any new emails")).toEqual({ query: "", from: false, unread: true });
        expect(args("read my last message")).toEqual({ who: "" });
        expect(args("what did Sam say")).toEqual({ who: "sam" });
        expect(args("read my messages from Priya")).toEqual({ who: "priya" });
    });
    it("contacts: added, and asked about", () => {
        expect(args("add Sam to contacts with number 555 0100")).toEqual({ name: "Sam", number: "555 0100", email: "", label: "" });
        expect(args("add a contact Robin Lee 555-0111")).toEqual({ name: "Robin Lee", number: "555-0111", email: "", label: "" });
        expect(args("new contact Jo March mobile number 408 555 0177 email jo@example.com")).toEqual({
            name: "Jo March", number: "408 555 0177", email: "jo@example.com", label: "mobile" });
        expect(args("what's Sam's number")).toEqual({ who: "sam", what: "phone", label: "" });
        expect(args("what is Priya's email address")).toEqual({ who: "priya", what: "email", label: "" });
        expect(cmd("add contact")).toBeNull();
    });
});

describe("music, sound, the screen and the system", () => {
    it("music controls", () => {
        for (const [t, a] of [["pause", "pause"], ["pause the music", "pause"], ["stop the music", "pause"], ["resume", "play"], ["resume the music", "play"],
                              ["next song", "next"], ["skip this song", "next"], ["play the next track", "next"], ["previous track", "prev"], ["go back a song", "prev"]])
            expect(args(t), t).toEqual({ action: a });
        expect(args("play some music")).toEqual({ query: "" });
        expect(cmd("stop the timer")).toBe("timerCancel");
    });
    it("volume", () => {
        expect(args("turn up the volume")).toEqual({ action: "up" });
        expect(args("turn the volume down a bit")).toEqual({ action: "down" });
        expect(args("louder")).toEqual({ action: "up" });
        expect(args("set the volume to 30%")).toEqual({ action: "set", level: 30 });
        expect(args("volume 80 percent")).toEqual({ action: "set", level: 80 });
        expect(args("max volume")).toEqual({ action: "set", level: 100 });
        expect(args("mute")).toEqual({ action: "mute" });
        expect(args("unmute")).toEqual({ action: "unmute" });
        expect(args("silence the phone")).toEqual({ setting: "ringer", state: "off" });
    });
    it("brightness", () => {
        expect(args("set brightness to 50%")).toEqual({ action: "set", level: 50 });
        expect(args("turn the brightness up")).toEqual({ action: "up" });
        expect(args("make the screen dimmer")).toEqual({ action: "down" });
        expect(args("brightness 20")).toEqual({ action: "set", level: 20 });
        expect(args("max brightness")).toEqual({ action: "set", level: 100 });
    });
    it("Do Not Disturb, screenshots, locking, battery", () => {
        expect(args("turn on do not disturb")).toEqual({ setting: "dnd", state: "on" });
        expect(args("turn off do not disturb")).toEqual({ setting: "dnd", state: "off" });
        expect(args("do not disturb")).toEqual({ setting: "dnd", state: "on" });
        expect(cmd("take a screenshot")).toBe("screenshot");
        expect(cmd("screenshot")).toBe("screenshot");
        expect(cmd("lock the screen")).toBe("lock");
        expect(cmd("lock the phone")).toBe("lock");
        expect(cmd("what's my battery")).toBe("battery");
        expect(cmd("how much battery do I have")).toBe("battery");
        expect(cmd("is my phone charging")).toBe("battery");
        expect(cmd("lock the door")).toBeNull();
    });
    it("Settings pages, and apps", () => {
        expect(args("open Wi-Fi settings")).toEqual({ page: "wifi" });
        expect(args("open bluetooth settings")).toEqual({ page: "bluetooth" });
        expect(args("show me the battery settings")).toEqual({ page: "battery" });
        expect(args("sound settings")).toEqual({ page: "sounds" });
        expect(args("open settings")).toEqual({ appId: "org.webosphoenix.settings", title: "Settings" });
        expect(cmd("open the pod bay doors settings")).toBeNull();
    });
});

describe("conversions, the world, photos, undo", () => {
    it("units, offline", () => {
        expect(args("convert 10 miles to km")).toEqual({ value: 10, from: "mi", to: "km" });
        expect(args("how many cups in a liter")).toEqual({ value: 1, from: "l", to: "cup" });
        expect(args("what's 100 fahrenheit in celsius")).toEqual({ value: 100, from: "f", to: "c" });
        expect(args("5 feet in centimeters")).toEqual({ value: 5, from: "ft", to: "cm" });
        expect(args("how many ounces in a pound")).toEqual({ value: 1, from: "lb", to: "oz" });
        expect(units.round(units.convert(10, "mi", "km")!)).toBe("16.09");
        expect(units.round(units.convert(100, "f", "c")!)).toBe("37.78");
        expect(units.round(units.convert(1, "l", "cup")!)).toBe("4.23");
        expect(units.convert(1, "kg", "km")).toBeNull();
    });
    it("currencies, by code or name", () => {
        expect(args("what's 20 USD in EUR")).toEqual({ value: 20, from: "USD", to: "EUR", currency: true });
        expect(args("convert 50 pounds to dollars")).toEqual({ value: 50, from: "GBP", to: "USD", currency: true });
        expect(args("convert 50 pounds to kilos")).toEqual({ value: 50, from: "lb", to: "kg" });
        expect(args("convert 50 british pounds to dollars")).toEqual({ value: 50, from: "GBP", to: "USD", currency: true });
        expect(args("how much is 1000 yen in euros")).toEqual({ value: 1000, from: "JPY", to: "EUR", currency: true });
    });
    it("time in a city, distances", () => {
        expect(args("what time is it in Tokyo")).toEqual({ place: "tokyo" });
        expect(args("what's the time in New York")).toEqual({ place: "new york" });
        expect(args("how far is Paris")).toEqual({ place: "paris" });
        expect(args("how far away is the Eiffel Tower")).toEqual({ place: "eiffel tower" });
        expect(cmd("what time is it")).toBe("time");
    });
    it("photos by day", () => {
        expect(args("show my photos from yesterday")).toEqual({ from: day(6), to: day(7), label: "yesterday" });
        expect(args("show me pictures from last week")).toEqual({ from: day(28, 8), to: day(5), label: "last week" });
        expect(args("photos from friday")).toEqual({ from: day(2), to: day(3), label: "" });
        expect(args("show my photos")).toEqual({ from: null, to: null, label: "" });
    });
    it("undo and cancel; what only a model can do", () => {
        expect(args("undo")).toEqual({ pending: false });
        expect(args("cancel that")).toEqual({ pending: true });
        expect(args("never mind")).toEqual({ pending: true });
        expect(args("translate hello into French")).toEqual({ what: "translate" });
        expect(cmd("how do you say thank you in Japanese")).toBe("beyond");
    });
});
