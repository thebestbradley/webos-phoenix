// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Places (lib/commands-places.js, lib/lang/en-places.js): where I parked,
// and finding it again; home and work, the user's saved places in Maps;
// reminders when the device gets to or leaves a place, a task in Tasks
// and an activity whose trigger is the location service's updates inside
// (or outside) a box about the place, run by placeWake through each phase.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { device, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const grammar = req("./lib/grammar.js") as { parse(text: string, ctx?: object): { command: string; args: Record<string, any> } | null };
const parse = (t: string) => grammar.parse(t, { lang: "en", now: NOW });
const PLACE = "org.webosphoenix.maps.place:1";
const HOME = { lat: 37.40, lon: -122.08 };

// A device with Home (and maybe others) saved in Maps.
function world(places: { name: string; lat: number; lon: number }[] = [], opts: object = {}) {
    return device(Object.assign({
        seed: (put: (o: object) => string) => places.forEach((p, i) => put({ _kind: PLACE, name: p.name, detail: "", lat: p.lat, lon: p.lon, created: i + 1, searchText: p.name.toLowerCase() })),
    }, opts));
}
function moveTo(d: ReturnType<typeof device>, p: { lat: number; lon: number }) { d.state.position = { latitude: p.lat, longitude: p.lon }; }
function placeActivity(d: ReturnType<typeof device>) {
    return [...d.state.activities.entries()].filter(([n]) => n.startsWith("assistant.place."))[0]?.[1];
}
function wake(d: ReturnType<typeof device>, id: string, fix: object) { return d.svc.placeWake({ id, $activity: { activityId: 1, trigger: fix } }); }

describe("the words", () => {
    it("remembers, finds and forgets where I parked", () => {
        expect(parse("remember where I parked")).toEqual({ command: "parking", args: { action: "save", note: "" } });
        expect(parse("I parked here")).toEqual({ command: "parking", args: { action: "save", note: "" } });
        expect(parse("remember I parked on level 3")).toEqual({ command: "parking", args: { action: "save", note: "on level 3" } });
        expect(parse("I parked in row F next to the elevator")?.args.note).toBe("in row F next to the elevator");
        expect(parse("save my parking spot")?.command).toBe("parking");
        expect(parse("forget where I parked")).toEqual({ command: "parking", args: { action: "forget", note: "" } });
        expect(parse("where did I park")).toEqual({ command: "findParking", args: { directions: false } });
        expect(parse("where's my car")?.command).toBe("findParking");
        expect(parse("find my car")?.command).toBe("findParking");
        expect(parse("take me back to my car")).toEqual({ command: "findParking", args: { directions: true } });
    });
    it("reminds at home, at work, here, or a saved place, coming or going", () => {
        expect(parse("remind me to buy milk when I get home")).toEqual({ command: "placeReminder", args: { text: "buy milk", place: "home", when: "arrive" } });
        expect(parse("remind me to call Mom when I leave work")).toEqual({ command: "placeReminder", args: { text: "call Mom", place: "work", when: "leave" } });
        expect(parse("when I get home, remind me to water the plants")?.args).toEqual({ text: "water the plants", place: "home", when: "arrive" });
        expect(parse("remind me when I get to work to email Sam")?.args).toEqual({ text: "email Sam", place: "work", when: "arrive" });
        expect(parse("remind me to text Sam when I'm leaving the office")?.args).toEqual({ text: "text Sam", place: "work", when: "leave" });
        expect(parse("remind me to lock the door when I leave")?.args).toEqual({ text: "lock the door", place: "here", when: "leave" });
        expect(parse("next time I'm at work remind me to fix the printer")?.args).toEqual({ text: "fix the printer", place: "work", when: "arrive" });
        expect(parse("remind me to grab my bag when I get to the gym")?.args).toEqual({ text: "grab my bag", place: "gym", when: "arrive" });
    });
    it("saves home and work where I am", () => {
        expect(parse("this is my home")).toEqual({ command: "setPlace", args: { place: "home" } });
        expect(parse("set my work location to here")).toEqual({ command: "setPlace", args: { place: "work" } });
        expect(parse("I live here")).toEqual({ command: "setPlace", args: { place: "home" } });
        expect(parse("set my home address to 12 Main Street")).toEqual({ command: "setPlace", args: { place: "home", address: "12 Main Street" } });
    });
    it("leaves timed reminders, driving mode and directions home alone", () => {
        expect(parse("remind me to pick up the kids at 5")?.command).toBe("reminder");
        expect(parse("remind me to buy milk")?.command).toBe("reminder");
        expect(parse("remind me to call Mom when I get there")?.command).toBe("reminder");
        expect(parse("I've parked")?.command).toBe("drivingMode");
        expect(parse("navigate home")?.command).toBe("navigate");
        expect(parse("remember that the wifi password is 1234")?.command).toBe("note");
    });
});

describe("parking", () => {
    it("saves the spot with its note, then says how far and which way, and when", async () => {
        const d = world();
        const saved = await d.ask("remember I parked on level 3");
        expect(saved).toMatchObject({ command: "parking", status: "done" });
        expect(saved.text).toBe("Got it. I've saved where you parked, on level 3. Ask me “where did I park?” to find it.");
        // 300 m north and 300 m east of the car, 25 minutes on.
        moveTo(d, { lat: 37.37 + 300 / 111320, lon: -122.04 + 300 / (111320 * Math.cos(37.37 * Math.PI / 180)) });
        d.setNow(NOW + 25 * 60000);
        const found = await d.ask("where did I park");
        expect(found.text).toBe("Your car is about 0.3 miles southwest of here. You parked 25 minutes ago, on level 3.");
        expect(found.choices.map((c: { label: string }) => c.label)).toContain("Walking Directions");
        const walk = await d.ask("take me back to my car");
        expect(walk.text).toMatch(/^Your car is about 0.3 miles southwest/);
        expect(d.state.launched.at(-1)).toMatchObject({ id: "org.webosphoenix.maps", params: { destination: { name: "Your car", lat: 37.37, lon: -122.04 }, travelMode: "walk", navigate: true } });
        expect((await d.ask("forget where I parked")).text).toBe("OK, I've forgotten where you parked.");
        expect((await d.ask("where did I park")).text).toBe("I don't know where you parked. When you park, say “remember where I parked”.");
    });
    it("asks for the location first, and saves the spot on yes", async () => {
        const d = world([], { locationAllowed: null });
        const asked = await d.ask("remember where I parked");
        expect(asked.text).toBe("To remember where you parked, I need your location. Is it OK if I use it?");
        const done = await d.ask("yes");
        expect(done.text).toMatch(/^Got it\. I've saved where you parked\./);
        expect(d.storage.get("assistant:parking")).toMatchObject({ lat: 37.37, lon: -122.04 });
    });
});

describe("home and work", () => {
    it("saves where I am as Home in Maps, moves it, and takes the move back", async () => {
        const d = world();
        expect((await d.ask("this is my home")).text).toBe("OK, this is your home now. It's in Maps as “Home”.");
        expect(d.of(PLACE)).toMatchObject([{ name: "Home", lat: 37.37, lon: -122.04 }]);
        moveTo(d, HOME);
        expect((await d.ask("set my home location to here")).text).toBe("OK, I've moved your home to where you are now. It's in Maps as “Home”.");
        expect(d.of(PLACE)).toMatchObject([{ name: "Home", lat: HOME.lat, lon: HOME.lon }]);
        expect((await d.svc.places({})).home).toMatchObject({ name: "Home", lat: HOME.lat });
        const undo = await d.ask("undo that");
        expect(undo.status).toBe("pending");
        await d.confirm(undo);
        expect(d.of(PLACE)).toMatchObject([{ name: "Home", lat: 37.37, lon: -122.04 }]);
    });
    it("sends an address to Maps, and Settings clears one", async () => {
        const d = world([{ name: "Work", lat: 37.39, lon: -122.03 }]);
        const m = await d.ask("set my home address to 12 Main Street");
        expect(m.text).toMatch(/find it in Maps and save it as “Home”/);
        expect(d.state.launched.at(-1)).toMatchObject({ id: "org.webosphoenix.maps", params: { query: "12 Main Street" } });
        expect((await d.svc.places({})).work).toMatchObject({ name: "Work" });
        expect((await d.svc.setPlace({ place: "work", clear: true })).returnValue).toBe(true);
        expect((await d.svc.places({})).work).toBeNull();
    });
});

describe("reminders at a place", () => {
    it("adds the task and an activity triggered inside home's box; Tasks reminds on arrival", async () => {
        const d = world([{ name: "Home", ...HOME }]);
        const m = await d.ask("remind me to buy milk when I get home");
        expect(m).toMatchObject({ command: "placeReminder", status: "done", text: "OK, I'll remind you to buy milk when you get home." });
        const task = d.of("com.palm.task:1").find((t: { summary: string }) => t.summary === "buy milk");
        expect(task).toMatchObject({ notes: "When you get home", due: null });
        const a = placeActivity(d);
        expect(a.callback).toMatchObject({ method: "luna://org.webosphoenix.assistant/placeWake" });
        expect(a.trigger.method).toBe("luna://com.webos.service.location/getLocationUpdates");
        expect(a.trigger.params).toEqual({ subscribe: true, minimumInterval: 60000, minimumDistance: 50 });
        // The box: 150 m each way about home.
        expect(a.trigger.where.map((w: { prop: string; op: string }) => w.prop + w.op)).toEqual(["latitude>=", "latitude<=", "longitude>=", "longitude<="]);
        expect(a.trigger.where[1].val - HOME.lat).toBeCloseTo(150 / 111320, 6);
        const id = a.callback.params.id;
        // Arrived: Tasks posts the reminder, the activity is done.
        const r = await wake(d, id, { returnValue: true, latitude: HOME.lat + 0.0005, longitude: HOME.lon });
        expect(r).toMatchObject({ returnValue: true, fired: true, taskId: task._id });
        expect(d.state.launched.at(-1)).toEqual({ id: "org.webosphoenix.tasks", params: { reminder: task._id }, behind: true });
        expect(placeActivity(d)).toBeUndefined();
        expect(d.storage.get("assistant:placeReminders")).toEqual([]);
    });
    it("said at home, first waits to leave it; then to come back", async () => {
        const d = world([{ name: "Home", lat: 37.37, lon: -122.04 }]);
        await d.ask("remind me to water the plants when I get home");
        let a = placeActivity(d);
        expect(a.trigger.or).toHaveLength(4);
        const id = a.callback.params.id;
        // Still home: nothing, the same trigger again.
        expect(await wake(d, id, { returnValue: true, latitude: 37.37, longitude: -122.04 })).toMatchObject({ fired: false, phase: "away" });
        // Gone (a kilometre north): now it waits to be back.
        expect(await wake(d, id, { returnValue: true, latitude: 37.38, longitude: -122.04 })).toMatchObject({ fired: false, phase: "arrive" });
        a = placeActivity(d);
        expect(a.trigger.where).toHaveLength(4);
        expect(await wake(d, id, { returnValue: true, latitude: 37.3701, longitude: -122.0401 })).toMatchObject({ fired: true });
    });
    it("leaving work: fires once out of the wider box", async () => {
        const d = world([{ name: "Work", lat: 37.37, lon: -122.04 }]);
        expect((await d.ask("remind me to call Mom when I leave work")).text).toBe("OK, I'll remind you to call Mom when you leave work.");
        const a = placeActivity(d), id = a.callback.params.id;
        expect(a.trigger.or.map((t: { where: { prop: string; op: string } }) => t.where.prop + t.where.op)).toEqual(["latitude<", "latitude>", "longitude<", "longitude>"]);
        // 200 m away is still inside the leaving box (250 m).
        expect(await wake(d, id, { returnValue: true, latitude: 37.37 + 200 / 111320, longitude: -122.04 })).toMatchObject({ fired: false });
        expect(await wake(d, id, { returnValue: true, latitude: 37.37 + 300 / 111320, longitude: -122.04 })).toMatchObject({ fired: true });
    });
    it("no fix (location off): tries again in 15 minutes", async () => {
        const d = world([{ name: "Home", ...HOME }]);
        await d.ask("remind me to buy milk when I get home");
        const id = placeActivity(d).callback.params.id;
        expect(await wake(d, id, { returnValue: false, errorCode: 5, errorText: "Location services are off" })).toMatchObject({ fired: false, retry: true });
        expect(placeActivity(d).schedule.start).toBeTruthy();
    });
    it("home not known yet: offers to use where I am, then sets the reminder", async () => {
        const d = world();
        const asked = await d.ask("remind me to buy milk when I get home");
        expect(asked.text).toBe("I don't know where your home is yet. Should I use where you are now?");
        expect(asked.choices.map((c: { label: string }) => c.label)).toEqual(["Set Home to Here", "Home & Work Settings"]);
        const all = await d.askAll("yes");
        expect(all.filter((x: { role: string }) => x.role === "assistant").map((x: { text: string }) => x.text)).toEqual(["OK, this is your home now. It's in Maps as “Home”.", "OK, I'll remind you to buy milk when you get home."]);
        expect(placeActivity(d).trigger.or).toHaveLength(4);   // made at home: first away
    });
    it("a place Maps does not know: the task, and how to have it there", async () => {
        const d = world();
        const m = await d.ask("remind me to buy milk when I get to the store");
        expect(m.text).toBe("I've added “buy milk” to Tasks, but I don't know where “Store” is, so I can't remind you there. Save it in Maps as “Store” and ask me again.");
        expect(d.of("com.palm.task:1").find((t: { summary: string }) => t.summary === "buy milk")).toMatchObject({ notes: "When you get to Store" });
        expect(placeActivity(d)).toBeUndefined();
    });
    it("a place saved in Maps by name, and here", async () => {
        const d = world([{ name: "Gym", lat: 37.39, lon: -122.05 }]);
        expect((await d.ask("remind me to grab my towel when I get to the gym")).text).toBe("OK, I'll remind you to grab my towel when you get to Gym.");
        d.newThread();
        expect((await d.ask("remind me to lock the door when I leave")).text).toBe("OK, I'll remind you to lock the door when you leave here.");
        expect(d.storage.get("assistant:placeReminders").map((r: { place: string; phase: string }) => r.place + ":" + r.phase)).toEqual(["Gym:arrive", "here:leave"]);
    });
    it("undo takes the task and the geofence back", async () => {
        const d = world([{ name: "Home", ...HOME }]);
        await d.ask("remind me to buy milk when I get home");
        const undo = await d.ask("undo that");
        await d.confirm(undo);
        expect(d.of("com.palm.task:1").find((t: { summary: string }) => t.summary === "buy milk")).toBeUndefined();
        expect(placeActivity(d)).toBeUndefined();
    });
});
