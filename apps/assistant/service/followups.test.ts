// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Follow-up questions (lib/followups.js) through the service (assistant.js),
// over an in-memory db8 and activity manager: a question after something
// is made, answers by chip or in words changing the real record, the
// window after which it is queued, the notification later (attempts,
// spacing, quiet hours, Do Not Disturb, a call), and the restraint: never
// what was given, a thing edited or gone or past, Skips.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Reply = { returnValue: boolean; errorCode?: number; errorText?: string; [k: string]: any };
type Methods = Record<string, (p?: object) => Promise<Reply>>;
const req = createRequire(import.meta.url);
const { createAssistantService } = req("./assistant.js") as { createAssistantService(d: object): Methods };
const { RULES, ACTIVITY } = req("./lib/followups.js") as { RULES: Record<string, number>; ACTIVITY: string };

const MIN = 60000, HOUR = 60 * MIN;
// Wednesday 7 October 2026, 10:00 local time.
const START = new Date(2026, 9, 7, 10, 0, 0).getTime();

function setup(opts: { people?: any[]; events?: any[]; lists?: any[] } = {}) {
    let clock = START;
    const db = new Map<string, any>();
    let n = 0;
    const put = (o: any) => { const id = o._id ?? "db" + ++n; db.set(id, { ...JSON.parse(JSON.stringify(o)), _id: id }); return id; };
    put({ _kind: "com.palm.calendar:1", _id: "cal1", syncSource: "Local", accountId: "acc" });
    put({ _kind: "com.palm.tasklist:1", _id: "inbox", name: "Inbox", isDefault: true, sortOrder: 0 });
    (opts.lists ?? []).forEach(put);
    (opts.people ?? []).forEach((p) => put({ _kind: "com.palm.person:1", ...p }));
    (opts.events ?? []).forEach((e) => put({ _kind: "com.palm.calendarevent:1", calendarId: "cal1", ...e }));
    const calls: { uri: string; params: any }[] = [];
    const notes: any[] = [];
    const state = { ringer: 50, calls: [] as any[] };
    const luna = {
        call(uri: string, params: any): Promise<any> {
            calls.push({ uri, params });
            const ok = (o: object = {}) => Promise.resolve({ returnValue: true, ...o });
            if (uri.endsWith("/listLaunchPoints")) return ok({ launchPoints: [] });
            if (uri === "luna://com.palm.db/find")
                return ok({ results: [...db.values()].filter((o) => o._kind === params.query.from && !o._del) });
            if (uri === "luna://com.palm.db/put") return ok({ results: params.objects.map((o: any) => ({ id: put(o), rev: 1 })) });
            if (uri === "luna://com.palm.db/get") return ok({ results: params.ids.map((id: string) => db.get(id)).filter(Boolean) });
            if (uri === "luna://com.palm.db/merge") {
                params.objects.forEach((o: any) => { if (db.has(o._id)) db.set(o._id, { ...db.get(o._id), ...JSON.parse(JSON.stringify(o)) }); });
                return ok();
            }
            if (uri === "luna://com.palm.db/del") { params.ids.forEach((id: string) => db.delete(id)); return ok(); }
            if (uri === "luna://com.palm.db/reserveIds") return ok({ ids: [put({ _kind: "x" }), put({ _kind: "x" })] });
            if (uri === "luna://com.palm.db/find" && params.query.from === "com.palm.account:1") return ok({ results: [] });
            if (uri.endsWith("/getInputVolume")) return ok({ volume: state.ringer });
            if (uri.endsWith("/callStatusQuery")) return ok({ calls: state.calls });
            return ok();
        },
    };
    const data = new Map<string, unknown>();
    const storage = {
        get: (k: string) => (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null),
        set: (k: string, v: unknown) => { data.set(k, JSON.parse(JSON.stringify(v))); },
        remove: (k: string) => { data.delete(k); },
        keys: (prefix: string) => [...data.keys()].filter((k) => k.startsWith(prefix)),
    };
    let who = "com.palm.systemui";
    const make = () => createAssistantService({
        luna, storage, now: () => clock, caller: () => who, request: () => Promise.reject(new Error("offline")),
        secrets: { seal: (t: string) => Promise.resolve(t), unseal: (t: string) => Promise.resolve(t) },
        notify: (x: any) => notes.push(x), locale: () => "en-US",
    });
    const t = {
        svc: make(), db, calls, notes, state, data,
        restart() { t.svc = make(); },
        as(id: string) { who = id; },
        at(ms: number) { clock = ms; },
        get now() { return clock; },
        called: (part: string) => calls.filter((c) => c.uri.includes(part)),
        kind: (k: string) => [...db.values()].filter((o) => o._kind === k),
        async ask(text: string, extra: object = {}) {
            const r = await t.svc.ask({ text, ...extra });
            expect(r.returnValue, r.errorText).toBe(true);
            return r;
        },
        async choose(m: any, label: string) {
            const c = m.choices.find((x: any) => x.label === label);
            expect(c, `no chip "${label}" in ${JSON.stringify(m.choices)}`).toBeTruthy();
            const r = await t.svc.choose({ threadId: m.threadId, messageId: m.id, choice: c.id });
            expect(r.returnValue, r.errorText).toBe(true);
            return r;
        },
        async queue() { return (await t.svc.followUps()).followUps as any[]; },
        // The activity's call, as the activity manager makes it at its time.
        async wake(at: number) { t.at(at); return t.svc.followUpWake({}); },
    };
    return t;
}
const last = (r: Reply) => r.messages[r.messages.length - 1];
const texts = (r: Reply) => r.messages.filter((m: any) => m.role === "assistant").map((m: any) => m.text);
const chips = (m: any) => (m.choices ?? []).map((c: any) => c.label);

const SAM = { _id: "sam", name: { givenName: "Sam", familyName: "Jones" }, emails: [{ value: "sam@example.com", primary: true }], favorite: true };
const PRIYA = { _id: "priya", name: { givenName: "Priya", familyName: "Shah" }, emails: [{ value: "priya@example.com" }] };

describe("in the conversation", () => {
    it("asks where an event is, with places used before, a video call and Skip, and a chip sets it", async () => {
        const t = setup({ events: [{ subject: "Standup", location: "Office", dtstart: START - 86400000, dtend: START - 86400000 + HOUR, lastModified: START - 1000 }] });
        const r = await t.ask("add a meeting with the team tomorrow at 3");
        expect(texts(r)).toEqual([expect.stringMatching(/^Added/), "Hey, where's tomorrow's meeting with the team happening?"]);
        const q = last(r);
        expect(q.followUp).toMatchObject({ kind: "location" });
        expect(chips(q)).toEqual(["Office", "Video call", "Skip"]);
        const a = await t.choose(q, "Office");
        expect(a.messages[0]).toMatchObject({ text: "Got it, I've put Office as the place.", status: "done", command: "event" });
        const ev = t.kind("com.palm.calendarevent:1").find((e) => e.subject !== "Standup");
        expect(ev.location).toBe("Office");
        // The next one, most useful first: no one to invite here, so how long.
        expect(last(a)).toMatchObject({ text: "How long do you think tomorrow's meeting with the team will run?", followUp: { kind: "duration" } });
        expect(chips(last(a))).toEqual(["30 min", "1 hour", "2 hours", "Skip"]);
        const d = await t.choose(last(a), "2 hours");
        expect(d.messages.map((m: any) => m.text)).toEqual(["OK, I've blocked out 2 hours."]);   // two per thing: no third
        expect(t.db.get(ev._id).dtend - t.db.get(ev._id).dtstart).toBe(2 * HOUR);
        // The question's chips are spent.
        const thread = await t.svc.thread({});
        expect(thread.messages.find((m: any) => m.id === q.id).chosen).toBe("fu:0");
    });

    it("never asks what was said, and asks who comes from the contacts with an email", async () => {
        const t = setup({ people: [SAM, PRIYA] });
        const r = await t.ask("schedule lunch tomorrow at noon for 2 hours at Bistro Verde");
        expect(last(r)).toMatchObject({ text: "Is anyone joining you for tomorrow's lunch?", followUp: { kind: "invitees" } });
        expect(chips(last(r))).toEqual(["Sam Jones", "Skip"]);
        const a = await t.ask("Sam and Priya");
        expect(a.messages[1].text).toBe("Done, I've invited Sam Jones and Priya Shah.");
        const ev = t.kind("com.palm.calendarevent:1")[0];
        expect(ev.attendees.map((x: any) => x.email)).toEqual(["sam@example.com", "priya@example.com"]);
        // Place and length were said; the reminder is the next thing to ask.
        expect(last(a)).toMatchObject({ text: "Quick one about tomorrow's lunch: should I remind you beforehand?", followUp: { kind: "alert" } });
        await t.ask("1 hour before");
        expect(t.db.get(ev._id).alarm[0].alarmTrigger.value).toBe("-PT1H");
    });

    it("takes answers in words, and says so when a name is not a contact", async () => {
        const t = setup({ people: [SAM] });
        await t.ask("add a meeting tomorrow at 3");
        const a = await t.ask("at the Corner Cafe");
        expect(a.messages[1].text).toBe("Got it, I've put The Corner Cafe as the place.");
        expect(last(a).text).toBe("Is anyone joining you for tomorrow's meeting?");
        const b = await t.ask("Gandalf");
        expect(b.messages[1]).toMatchObject({ text: "I couldn't find Gandalf with an email address in your contacts.", status: "failed",
                                              followUp: { kind: "invitees" } });
        // Still waiting for an answer.
        const c = await t.ask("Sam");
        expect(c.messages[1].text).toBe("Done, I've invited Sam Jones.");
    });

    it("leaves the question for later when the next words are a request", async () => {
        const t = setup();
        await t.ask("add a meeting tomorrow at 3");
        const r = await t.ask("turn on the flashlight");
        expect(last(r).text).toBe("The flashlight is on.");
        const q = await t.queue();
        expect(q).toHaveLength(1);
        expect(q[0]).toMatchObject({ kind: "location", state: "queued", nextAt: START + RULES.firstMs });
    });

    it("asks reminders when, tasks which list, alarms whether they repeat, contacts what is missing", async () => {
        const t = setup({ lists: [{ _kind: "com.palm.tasklist:1", _id: "shop", name: "Shopping", sortOrder: 1 }] });
        let r = await t.ask("remind me to call the bank");
        expect(last(r)).toMatchObject({ text: "When should I remind you to call the bank?" });
        expect(chips(last(r))).toEqual(["In 1 hour", "This evening", "Tomorrow morning", "Skip"]);
        await t.choose(last(r), "Tomorrow morning");
        const task = t.kind("com.palm.task:1")[0];
        expect(task).toMatchObject({ due: new Date(2026, 9, 8, 9).getTime(), remind: new Date(2026, 9, 8, 9).getTime() });
        expect(t.called("activitymanager/create").some((c) => c.params.activity.name === "org.webosphoenix.tasks.remind." + task._id)).toBe(true);

        r = await t.ask("create a task pay rent");
        expect(last(r).text).toBe("When's “Pay rent” due?");   // the next phrasing of "when"
        const l = await t.ask("skip");
        expect(l.messages[1].text).toBe("No problem, I'll leave it.");
        expect(last(l)).toMatchObject({ text: "Which list should “Pay rent” go on?" });
        expect(chips(last(l))).toEqual(["Shopping", "Skip"]);

        r = await t.ask("set an alarm for 6:30 am");
        expect(last(r).text).toBe("Should your 6:30 AM alarm go off every day, or just this once?");
        const a = await t.ask("weekdays");
        expect(a.messages[1].text).toBe("It'll go off on weekdays now.");
        expect(t.kind("com.palm.clock.alarm:1")[0].occurs).toBe("weekdays");
        expect(last(a).text).toBe("What's the 6:30 AM alarm for?");

        r = await t.ask("add Jo March to contacts with number 555 0100");
        expect(last(r).text).toBe("Do you have an email address for Jo March?");
        await t.ask("jo@example.com");
        const person = t.kind("com.palm.person:1")[0];
        expect(person.emails[0]).toMatchObject({ value: "jo@example.com", normalizedValue: "jo@example.com" });
    });

    it("does nothing of the kind with Follow-up questions off", async () => {
        const t = setup();
        t.as("org.webosphoenix.settings");
        await t.svc.setSettings({ followUps: false });
        t.as("com.palm.systemui");
        const r = await t.ask("add a meeting tomorrow at 3");
        expect(r.messages).toHaveLength(2);
        expect(await t.queue()).toEqual([]);
    });
});

describe("later, as a notification", () => {
    async function queued(t: ReturnType<typeof setup>, text = "add a meeting on friday at 3") {
        await t.ask(text);
        expect((await t.svc.followUpLeave({})).queued).toBe(1);
        return (await t.queue())[0];
    }

    it("queues a question left unanswered for the window, with the activity manager to wake it", async () => {
        const t = setup();
        await t.ask("add a meeting on friday at 3");
        const act = t.called("activitymanager/create").map((c) => c.params.activity).filter((a) => a.name === ACTIVITY).pop();
        expect(act.callback.method).toBe("luna://org.webosphoenix.assistant/followUpWake");
        expect(act.schedule.start).toBe(new Date(START + RULES.windowMs).toISOString().replace("T", " ").slice(0, 19) + "Z");
        expect((await t.wake(START + RULES.windowMs - 1000)).queued).toBe(0);
        expect((await t.wake(START + RULES.windowMs)).queued).toBe(1);
        expect((await t.queue())[0]).toMatchObject({ state: "queued", nextAt: START + RULES.windowMs + RULES.firstMs });
    });

    it("delivers it with its answers as buttons, twice at most, spaced, then drops it", async () => {
        const t = setup();
        const q = await queued(t);
        expect(q.nextAt).toBe(START + HOUR);
        expect((await t.wake(START + HOUR)).delivered).toBe(1);
        expect(t.notes).toHaveLength(1);
        expect(t.notes[0]).toMatchObject({
            appId: "org.webosphoenix.assistant", tag: "followup:" + q.id, title: "Hey, where's Friday's meeting happening?",
            params: { followUp: q.id },
            actions: { uri: "luna://org.webosphoenix.assistant/answerFollowUp", params: { id: q.id },
                       items: [{ id: "fu:0", label: "Video call" }, { id: "fu:skip", label: "Skip" }] },
        });
        expect((await t.wake(START + HOUR + RULES.againMs - 1)).delivered).toBe(0);
        expect((await t.wake(START + HOUR + RULES.againMs)).delivered).toBe(1);
        expect((await t.queue())[0].attempts).toBe(2);
        const end = await t.wake(START + HOUR + 2 * RULES.againMs);
        expect(end.dropped).toBe(1);
        expect(t.notes[t.notes.length - 1]).toEqual({ appId: "org.webosphoenix.assistant", tag: "followup:" + q.id, remove: true });
        expect(await t.queue()).toEqual([]);
    });

    it("is sent once when several copies of the service wake at once (the owner's burst of thirteen)", async () => {
        // In the simulator each app page runs the service on the one store;
        // on 10 October 2026 four woke together and each sent every question.
        const t = setup();
        const q = await queued(t);
        const copies = [t.svc, (t.restart(), t.svc), (t.restart(), t.svc), (t.restart(), t.svc)];
        t.at(START + HOUR);
        const woke = await Promise.all(copies.map((c) => c.followUpWake({})));
        expect(woke.reduce((n, r) => n + r.delivered, 0)).toBe(1);
        expect(t.notes).toHaveLength(1);
        const thread = await t.svc.thread({});
        expect(thread.messages.filter((m: any) => m.followUp && m.followUp.id === q.id)).toHaveLength(1);
        // And again later: once.
        t.at(START + HOUR + RULES.againMs);
        const again = await Promise.all(copies.map((c) => c.followUpWake({})));
        expect(again.reduce((n, r) => n + r.delivered, 0)).toBe(1);
        expect(t.notes).toHaveLength(2);
    });

    it("waits out the quiet hours, Do Not Disturb and calls", async () => {
        const t = setup();
        t.at(new Date(2026, 9, 7, 21, 30).getTime());
        await queued(t);
        const night = new Date(2026, 9, 7, 22, 30).getTime();
        expect(await t.wake(night)).toMatchObject({ delivered: 0, postponed: 1 });
        const morning = new Date(2026, 9, 8, 8, 0).getTime();
        expect((await t.queue())[0].nextAt).toBe(morning);
        t.state.ringer = 0;
        expect(await t.wake(morning)).toMatchObject({ delivered: 0, postponed: 1 });
        expect((await t.queue())[0].nextAt).toBe(morning + RULES.dndWaitMs);
        t.state.ringer = 50;
        t.state.calls = [{ id: 1, state: "active" }];
        expect(await t.wake(morning + RULES.dndWaitMs)).toMatchObject({ delivered: 0, postponed: 1 });
        expect((await t.queue())[0].nextAt).toBe(morning + RULES.dndWaitMs + RULES.callWaitMs);
        t.state.calls = [];
        expect((await t.wake(morning + RULES.dndWaitMs + RULES.callWaitMs)).delivered).toBe(1);
    });

    it("respects quiet hours set in Settings", async () => {
        const t = setup();
        t.as("org.webosphoenix.settings");
        expect((await t.svc.setSettings({ quietStart: "9am" })).returnValue).toBe(false);
        await t.svc.setSettings({ quietStart: "10:30", quietEnd: "12:00" });
        t.as("com.palm.systemui");
        await queued(t);
        expect(await t.wake(START + HOUR)).toMatchObject({ postponed: 1 });
        expect((await t.queue())[0].nextAt).toBe(new Date(2026, 9, 7, 12, 0).getTime());
    });

    it("comes back after the delays chosen in Settings: first, second, or no second", async () => {
        const t = setup();
        t.as("org.webosphoenix.settings");
        const s = (await t.svc.getSettings()).settings;
        expect(s).toMatchObject({ followUpFirst: 60, followUpAgain: 240, quietStart: "22:00", quietEnd: "08:00" });
        expect((await t.svc.setSettings({ followUpFirst: 45 })).returnValue).toBe(false);
        expect((await t.svc.setSettings({ followUpAgain: "4h" })).returnValue).toBe(false);
        await t.svc.setSettings({ followUpFirst: 15, followUpAgain: 1440 });
        t.as("com.palm.systemui");
        let q = await queued(t);
        expect(q.nextAt).toBe(START + 15 * MIN);
        expect((await t.wake(START + 15 * MIN)).delivered).toBe(1);
        // The next day, same time (out of the quiet hours).
        expect((await t.queue())[0].nextAt).toBe(START + 15 * MIN + 24 * HOUR);

        // Three hours, then none: one notification, gone after the default
        // spacing when it is not answered.
        const u = setup();
        u.as("org.webosphoenix.settings");
        await u.svc.setSettings({ followUpFirst: 180, followUpAgain: 0 });
        u.as("com.palm.systemui");
        q = await queued(u, "add a meeting next week on friday at 3");
        expect(q.nextAt).toBe(START + 3 * HOUR);
        expect((await u.wake(START + 3 * HOUR)).delivered).toBe(1);
        const end = await u.wake(START + 3 * HOUR + RULES.againMs);
        expect(end).toMatchObject({ delivered: 0, dropped: 1 });
        expect(u.notes.filter((n) => !n.remove)).toHaveLength(1);
        expect(u.notes[u.notes.length - 1]).toMatchObject({ tag: "followup:" + q.id, remove: true });
    });

    it("drops the question when the user filled it in, the thing went, or its time passed", async () => {
        let t = setup();
        const q = await queued(t);
        const ev = t.kind("com.palm.calendarevent:1")[0];
        t.db.set(ev._id, { ...ev, location: "Home" });   // added in Calendar
        expect((await t.wake(q.nextAt)).dropped).toBe(1);
        expect(t.notes).toHaveLength(0);

        t = setup();
        await queued(t);
        t.db.clear();
        expect((await t.wake(START + HOUR)).dropped).toBe(1);

        // Soon: it comes before the event (half an hour before), and not after it.
        t = setup();
        const soon = await queued(t, "add a meeting today at 11");
        expect(soon.nextAt).toBe(START + HOUR - RULES.beforeMs);
        expect((await t.wake(new Date(2026, 9, 7, 11, 0).getTime())).dropped).toBe(1);
    });

    it("applies a notification's button without opening anything, and says so in its conversation", async () => {
        const t = setup();
        const q = await queued(t);
        await t.wake(START + HOUR);
        const r = await t.svc.answerFollowUp({ id: q.id, action: "fu:0" });
        expect(r).toMatchObject({ returnValue: true, text: "Got it, I've put Video call as the place.", answered: true });
        expect(t.kind("com.palm.calendarevent:1")[0].location).toBe("Video call");
        expect(t.notes[t.notes.length - 1]).toMatchObject({ tag: "followup:" + q.id, remove: true });
        const th = await t.svc.thread({ id: q.threadId });
        expect(th.messages[th.messages.length - 1]).toMatchObject({ text: "Got it, I've put Video call as the place.", status: "done" });
        expect(await t.queue()).toEqual([]);
        expect(t.called("applicationManager/launch")).toHaveLength(0);
        // Only the system UI, the Assistant and Settings.
        t.as("com.example.app");
        expect((await t.svc.answerFollowUp({ id: q.id, action: "fu:0" })).returnValue).toBe(false);
    });

    it("says it in its conversation as it is sent, unread until opened, and opens on it when tapped", async () => {
        const t = setup();
        const q = await queued(t);
        await t.wake(START + HOUR);
        let th = await t.svc.thread({ id: q.threadId });
        expect(th.thread.unread).toBe(1);
        const sent = th.messages[th.messages.length - 1];
        expect(sent).toMatchObject({ text: "Hey, where's Friday's meeting happening?", followUp: { id: q.id } });
        // The question asked at first gave way to it.
        expect(th.messages.filter((m: any) => m.followUp && !m.chosen)).toHaveLength(1);
        const r = await t.svc.followUpOpen({ id: q.id });
        expect(r.thread.id).toBe(q.threadId);
        expect(r.messages).toEqual([]);   // already there, not asked twice
        th = await t.svc.thread({ id: q.threadId });
        expect(th.thread.unread).toBe(0);
        expect(t.notes[t.notes.length - 1]).toMatchObject({ remove: true });
        const a = await t.ask("Office", { threadId: q.threadId });
        expect(a.messages[1].text).toBe("Got it, I've put Office as the place.");
        // Read without a notification: markRead.
        await t.ask("add a meeting on saturday at 4", { threadId: q.threadId });
        await t.svc.followUpLeave({});
        await t.wake(START + 2 * HOUR);
        // How long the first one is (asked after "Office") and where the second is.
        expect((await t.svc.thread({ id: q.threadId })).thread.unread).toBe(2);
        await t.svc.markRead({ id: q.threadId });
        expect((await t.svc.thread({ id: q.threadId })).thread.unread).toBe(0);
    });

    it("keeps the queue across a restart", async () => {
        const t = setup();
        await queued(t);
        t.restart();
        expect(await t.queue()).toHaveLength(1);
        expect((await t.wake(START + HOUR)).delivered).toBe(1);
    });
});

describe("restraint", () => {
    it("stops asking about a thing after two Skips", async () => {
        const t = setup({ people: [SAM] });
        await t.ask("add a meeting tomorrow at 3");
        let r = await t.ask("skip");
        expect(last(r).text).toBe("Is anyone joining you for tomorrow's meeting?");
        r = await t.ask("no thanks");
        expect(r.messages.map((m: any) => m.text)).toEqual(["no thanks", "No problem, I'll leave it."]);
    });

    it("asks before it stops asking a kind Skipped three times in a row, and stops only when told", async () => {
        const t = setup();
        const skip = async (from: number, n = 3) => {
            for (let i = 0; i < n; ++i) {
                const r = await t.ask(`add a meeting on friday at ${from + i}`);
                expect(last(r).followUp.kind).toBe("location");
                await t.choose(last(r), "Skip");
            }
        };
        await skip(1);
        let r = await t.ask("add a meeting on friday at 5");
        expect(last(r)).toMatchObject({ text: "I've been asking about where your meetings are. Is that helpful, or should I stop asking?",
                                        followUp: { kind: "doubt" } });
        expect(chips(last(r))).toEqual(["Keep asking", "Stop asking"]);
        // Keep asking: and it asks.
        let a = await t.ask("keep asking");
        expect(a.messages[1].text).toBe("Good to know. I'll keep asking.");
        expect(last(a).followUp.kind).toBe("location");
        expect((await t.svc.getSettings({})).settings.followUpTopicsOff).toEqual([]);
        await t.choose(last(a), "Skip");
        await skip(6, 2);
        r = await t.ask("add a meeting on saturday at 9");
        expect(last(r).followUp.kind).toBe("doubt");
        expect(last(r).text).toBe("You've skipped a few questions about where your meetings are. Want me to keep asking those?");
        a = await t.choose(last(r), "Stop asking");
        expect(a.messages[0].text).toBe("OK, I'll stop asking about where your meetings are. You can turn it back on in Settings > Assistant.");
        expect((await t.svc.getSettings({})).settings.followUpTopicsOff).toEqual(["location"]);
        expect((await t.svc.followUps()).topicsOff).toEqual(["location"]);
        expect(last(await t.ask("add a meeting on saturday at 10")).followUp.kind).toBe("duration");
        // On again in Settings.
        t.as("org.webosphoenix.settings");
        expect((await t.svc.setSettings({ followUpTopicsOff: ["nonsense"] })).returnValue).toBe(false);
        await t.svc.setSettings({ followUpTopicsOff: [] });
        t.as("com.palm.systemui");
        expect(last(await t.ask("add a meeting on saturday at 11")).followUp.kind).toBe("location");
    });
});
