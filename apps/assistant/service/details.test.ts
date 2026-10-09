// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One thing about one item (lib/details.js and the grammar's details in
// lib/lang/en.js), through the service: the field asked for, concisely,
// with the item's card; and "it", the item the conversation is about.

import { describe, expect, it } from "vitest";
import { at, device } from "./test/device";

const seeded = () => device({ seed: (put) => {
    put({ _id: "ev-sam", _kind: "com.palm.calendarevent:1", calendarId: "cal-local", subject: "Meeting with Sam", location: "Room 4B",
          dtstart: at(8, 15), dtend: at(8, 16, 30), allDay: false,
          attendees: [{ email: "me@example.com", commonName: "Jordan Avery", organizer: true },
                      { email: "sam@example.com", commonName: "Sam Delgado", organizer: false },
                      { email: "priya@example.net", commonName: "Priya Nair", organizer: false }] });
    put({ _id: "memo-groc", _kind: "com.palm.note:1", text: "Grocery\nMilk\nEggs\nCoffee", color: "blue", position: "k" });
    put({ _id: "task-today", _kind: "com.palm.task:1", summary: "Pay rent", listId: "list-inbox", completed: false, due: at(7, 17), createdTime: 4 });
    put({ _id: "task-later", _kind: "com.palm.task:1", summary: "Renew passport", listId: "list-inbox", completed: false, due: at(20, 9), createdTime: 5 });
    put({ _id: "p-mom", _kind: "com.palm.person:1", name: { givenName: "Mom" }, phoneNumbers: [{ value: "(303) 555-0199", type: "type_mobile" }], birthday: "1961-03-14" });
    put({ _id: "p-alex", _kind: "com.palm.person:1", name: { givenName: "Alex", familyName: "Rivera" }, phoneNumbers: [], emails: [{ value: "alex@example.com", type: "type_work" }],
          contactIds: ["c-alex"] });
    put({ _id: "c-alex", _kind: "com.palm.contact.palmprofile:1", name: { givenName: "Alex", familyName: "Rivera" }, emails: [{ value: "alex@example.com", type: "type_work" }] });
    put({ _id: "task-stamps", _kind: "com.palm.task:1", summary: "Buy stamps", listId: "list-inbox", completed: false, createdTime: 6 });
    put({ _id: "call-mom", _kind: "com.palm.phonecall:1", type: "incoming", timestamp: at(7, 8, 15), duration: 120000, from: { addr: "(303) 555-0199", name: "Mom" }, to: [] });
} });

describe("one thing about an event", () => {
    it("tells its time, place, who is invited and how long", async () => {
        const d = seeded();
        const t = await d.ask("what time is my meeting with Sam");
        expect(t.text).toBe("“Meeting with Sam” is tomorrow at 3:00 PM, until 4:30 PM.");
        expect(t.data.attachments[0].items[0]).toMatchObject({ title: "Meeting with Sam", detail: "Room 4B" });
        expect((await d.ask("where is my meeting with Sam")).text).toBe("“Meeting with Sam” is at Room 4B.");
        expect((await d.ask("who's invited to my meeting with Sam")).text).toBe("Sam Delgado and Priya Nair are invited to “Meeting with Sam”.");
        expect((await d.ask("how long is the meeting with Sam")).text).toBe("“Meeting with Sam” is 1 hour 30 minutes.");
        expect((await d.ask("where is my dentist appointment")).text).toBe("“Dentist” is at Downtown Dental.");
        expect((await d.ask("when is my next dentist appointment")).text).toBe("“Dentist” is on Friday at 2:00 PM, at Downtown Dental.");
        expect((await d.ask("where is my meeting with Alex")).text).toBe("I couldn't find “meeting with alex” on your calendar.");
    });
    it("answers about “it”: the event the conversation is about", async () => {
        const d = seeded();
        expect((await d.ask("where is it")).text).toBe("Which one? Ask about it by name, like “where is my meeting with Sam”.");
        await d.ask("what time is my meeting with Sam");
        expect((await d.ask("where is it")).text).toBe("“Meeting with Sam” is at Room 4B.");
        expect((await d.ask("who's invited")).text).toBe("Sam Delgado and Priya Nair are invited to “Meeting with Sam”.");
        // Another event shown: "it" is that one now.
        await d.ask("when is my dentist appointment");
        expect((await d.ask("where is it")).text).toBe("“Dentist” is at Downtown Dental.");
    });
    it("leaves the clock and places alone", async () => {
        const d = seeded();
        expect((await d.ask("what time is it")).command).toBe("time");
        expect((await d.ask("where is the nearest pharmacy")).command).toBe("nearby");
    });
});

describe("one thing about the rest", () => {
    it("reads a memo", async () => {
        const d = seeded();
        const m = await d.ask("what did I write in my grocery memo");
        expect(m.text).toBe("Your “Grocery” memo says: Milk\nEggs\nCoffee");
        expect(m.data.attachments[0].items[0].open).toEqual({ appId: "com.palm.app.notes", params: { memoId: "memo-groc" }, title: "Memos" });
        expect((await d.ask("what does it say")).text).toBe("Your “Grocery” memo says: Milk\nEggs\nCoffee");
    });
    it("tells a contact's birthday, and when someone called", async () => {
        const d = seeded();
        expect((await d.ask("when is Mom's birthday")).text).toBe("Mom's birthday is 1961-03-14.");
        expect((await d.ask("when did Mom call")).text).toBe("Mom last called today at 8:15 AM.");
        expect((await d.ask("when did Sam call")).text).toBe("You missed a call from Sam Delgado today at 9:30 AM.");
        expect((await d.ask("did Priya call me")).text).toBe("You last called Priya Nair today at 8:00 AM; there's no call from them since.");
    });
    it("tells what is due, and what an email said", async () => {
        const d = seeded();
        expect((await d.ask("what's on my to-do list for today")).text).toBe("Today on your tasks: “Pay rent”.");
        expect((await d.ask("what did Alex's last email say")).text).toBe("From Alex Rivera, today at 9:00 AM: “Invoice 2231”. Your invoice");
        expect((await d.ask("what time is my alarm set for")).command).toBe("alarmList");
    });
});

describe("changing what was found", () => {
    it("changes the event the conversation is about, each read back, each undone", async () => {
        const d = seeded();
        const ev = () => d.db.get("ev-sam");
        await d.ask("what time is my meeting with Sam");
        expect((await d.ask("rename it to Coffee with Sam")).text).toBe("Renamed “Meeting with Sam” to “Coffee with Sam”.");
        expect(ev().subject).toBe("Coffee with Sam");
        expect((await d.ask("move it to Zoom")).text).toBe("“Coffee with Sam” is at Zoom now.");
        expect(ev().location).toBe("Zoom");
        expect((await d.ask("add Alex to it")).text).toBe("Added Alex Rivera to “Coffee with Sam”.");
        expect(ev().attendees.map((a: any) => a.email)).toEqual(["me@example.com", "sam@example.com", "priya@example.net", "alex@example.com"]);
        expect((await d.ask("remove Priya from it")).text).toBe("Took Priya Nair off “Coffee with Sam”.");
        expect(ev().attendees.map((a: any) => a.commonName)).toEqual(["Jordan Avery", "Sam Delgado", "Alex Rivera"]);
        expect((await d.ask("move it to 4")).text).toBe("Moved “Coffee with Sam” to tomorrow at 4:00 PM.");
        expect(ev()).toMatchObject({ dtstart: at(8, 16), dtend: at(8, 17, 30) });
        // Undo takes back the last change (the move), after Yes.
        await d.confirm(await d.ask("undo"));
        expect(ev()).toMatchObject({ dtstart: at(8, 15), dtend: at(8, 16, 30) });
    });
    it("changes events by their words", async () => {
        const d = seeded();
        expect((await d.ask("rename my meeting with Sam to Planning")).text).toBe("Renamed “Meeting with Sam” to “Planning”.");
        expect((await d.ask("change the meeting with Sam to 4")).text).toBe("I couldn't find “with sam” on your calendar.");
        expect((await d.ask("invite Alex to the planning meeting")).text).toBe("Added Alex Rivera to “Planning”.");
        expect((await d.ask("rename it to Retro")).text).toBe("Renamed “Planning” to “Retro”.");
    });
    it("changes lists, memos, contacts and alarms", async () => {
        const d = seeded();
        expect((await d.ask("add milk to my groceries list")).text).toBe("Added “Milk” to your Groceries list.");
        expect((await d.ask("remove eggs from it")).text).toBe("Took “Eggs” off your Groceries list.");
        expect(d.db.has("task-eggs")).toBe(false);
        await d.confirm(await d.ask("undo"));
        expect(d.db.get("task-eggs")).toMatchObject({ summary: "Eggs", listId: "list-shop" });
        expect((await d.ask("mark buy stamps done")).text).toBe("Marked “Buy stamps” as done.");
        expect((await d.ask("rename my grocery memo to Shopping")).text).toBe("Renamed “Grocery” to “Shopping”.");
        expect(d.db.get("memo-groc").text).toBe("Shopping\nMilk\nEggs\nCoffee");
        expect((await d.ask("remove eggs from it")).text).toBe("Took “eggs” out of your “Shopping” memo.");
        expect(d.db.get("memo-groc").text).toBe("Shopping\nMilk\nCoffee");
        expect((await d.ask("change Alex's email to alex@new.example.com")).text).toBe("Alex Rivera's email is alex@new.example.com now.");
        expect(d.db.get("p-alex").emails[0].value).toBe("alex@new.example.com");
        expect(d.db.get("c-alex").emails[0].value).toBe("alex@new.example.com");
        expect((await d.ask("set my 7am alarm to 6:30")).text).toBe("Your 7:00 AM alarm is at 6:30 AM now.");
        expect(d.db.get("alarm-7")).toMatchObject({ hour: 6, minute: 30, niceTime: "6:30 AM" });
        expect(d.state.activities.get("clockAlarm1")).toBeTruthy();
        expect((await d.ask("change my 6:30 pm alarm to 7")).text).toBe("Your 6:30 PM alarm is at 7:00 PM now.");
    });
    it("asks which, when nothing is in focus", async () => {
        const d = seeded();
        expect((await d.ask("rename it to Lunch")).text).toBe("Which one? Say its name, like “rename my meeting with Sam to Coffee with Sam”.");
        expect((await d.ask("change my alarm to 6")).text).toBe("You have alarms at 7:00 AM and 6:30 PM: which one? Say “set my 7:00 AM alarm to…”.");
    });
});
