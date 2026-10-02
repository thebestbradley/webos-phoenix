// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Tasks client (tasks.ts) and the activity manager it schedules
// reminders with, against the simulated services in
// runtime/phoenix-runtime.js (as phone.test.ts does for telephony).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, LunaError } from "./bridge";
import { db } from "./db8";
import {
    activityDateString, dueText, PRIORITY, reminderActivityName, TASK_KIND, TASKLIST_KIND, tasks, TASKS_APP_ID, type Task, type TaskInput,
} from "./tasks";

interface Activity { activityId: number; name: string; state: string; schedule?: { start: string }; callback?: { params?: Record<string, unknown> } }
interface Rt {
    activities: { fireDue(at?: number): number; list(): Activity[]; parseStart(s: object): number | null };
    relaunch(params: object): boolean;
}
const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];
let rt: Rt;
let palm: { appIdentifier: string };

beforeAll(() => {
    const w = window as unknown as Record<string, unknown>;
    w.phoenixHost = { postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }) };
    const src = readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8");
    new Function(src).call(window);
    rt = w.__phoenixRuntime as Rt;
    palm = w.PalmSystem as { appIdentifier: string };
});

const OTHER_PAGE = "com.webos.phoenix.unknown";

beforeEach(() => {
    localStorage.clear();
    hostMessages.length = 0;
    palm.appIdentifier = OTHER_PAGE;
});

const HOUR = 3_600_000;
const activity = (name: string) => rt.activities.list().find((a) => a.name === name);
const launches = () => hostMessages.filter((m) => m.type === "launch").map((m) => m.payload as { id: string; params: Record<string, unknown> });

async function newTask(over: Partial<TaskInput> = {}): Promise<Task> {
    const inbox = await tasks.ensureInbox();
    const id = await tasks.save({
        summary: "Buy milk", completed: false, priority: PRIORITY.none, listId: inbox._id!, accountId: "", ...over,
    });
    return (await tasks.get(id))!;
}

describe("activity manager (simulated com.palm.activitymanager)", () => {
    it("reads schedule start times in UTC, or local time with local: true", () => {
        expect(rt.activities.parseStart({ start: "2026-09-28 14:05:00Z" })).toBe(Date.UTC(2026, 8, 28, 14, 5, 0));
        expect(rt.activities.parseStart({ start: "2026-09-28 14:05:00" })).toBe(Date.UTC(2026, 8, 28, 14, 5, 0));
        expect(rt.activities.parseStart({ start: "2026-09-28 14:05:00", local: true })).toBe(new Date(2026, 8, 28, 14, 5, 0).getTime());
        expect(rt.activities.parseStart({ start: "tomorrow" })).toBeNull();
    });

    it("creates, describes, lists, replaces and completes activities", async () => {
        const at = activityDateString(Date.now() + HOUR);
        const act = { name: "clockAlarm1", schedule: { start: at }, callback: { method: "palm://com.palm.applicationManager/launch", params: { id: "com.palm.app.clock" } } };
        const r = await call("luna://com.palm.activitymanager/create", { activity: act, start: true }) as unknown as { activityId: number };
        expect(r.activityId).toBeGreaterThan(0);
        const e = await call("luna://com.palm.activitymanager/create", { activity: act, start: true }).catch((x) => x);
        expect(e).toBeInstanceOf(LunaError);
        expect(e.errorCode).toBe(17);
        const again = await call("luna://com.palm.activitymanager/create", { activity: act, start: true, replace: true }) as unknown as { activityId: number };
        expect(again.activityId).not.toBe(r.activityId);
        const d = await call("luna://com.palm.activitymanager/getDetails", { activityName: "clockAlarm1" }) as unknown as { activity: Activity };
        expect(d.activity).toMatchObject({ activityId: again.activityId, state: "waiting", schedule: { start: at } });
        const l = await call("luna://com.palm.activitymanager/list", {}) as unknown as { activities: Activity[] };
        expect(l.activities.map((a) => a.name)).toEqual(["clockAlarm1"]);
        await call("luna://com.palm.activitymanager/complete", { activityId: again.activityId });
        expect(rt.activities.list()).toEqual([]);
        const gone = await call("luna://com.palm.activitymanager/cancel", { activityName: "clockAlarm1" }).catch((x) => x);
        expect(gone.errorCode).toBe(2);
    });

    it("fires a due app launch once, with $activity in the launch params, for the shell", async () => {
        await call("luna://com.palm.activitymanager/create", {
            start: true, replace: true,
            activity: { name: "wake", schedule: { start: activityDateString(Date.now() + HOUR) },
                        callback: { method: "palm://com.palm.applicationManager/launch", params: { id: "com.palm.app.clock", params: { action: "ring" } } } },
        });
        expect(rt.activities.fireDue(Date.now())).toBe(0);
        expect(rt.activities.fireDue(Date.now() + 2 * HOUR)).toBe(1);
        const l = launches();
        expect(l).toHaveLength(1);
        expect(l[0]).toMatchObject({ id: "com.palm.app.clock", params: { action: "ring", $activity: { name: "wake" } } });
        expect(activity("wake")?.state).toBe("running");
        expect(rt.activities.fireDue(Date.now() + 3 * HOUR)).toBe(0);
    });

    it("hands the app's own page the launch params in place (webOSRelaunch), without the shell", async () => {
        palm.appIdentifier = "com.palm.app.clock";
        const got: unknown[] = [];
        const on = (e: Event) => got.push((e as CustomEvent).detail);
        document.addEventListener("webOSRelaunch", on);
        await call("luna://com.palm.activitymanager/create", {
            start: true,
            activity: { name: "wake2", schedule: { start: activityDateString(Date.now() + HOUR) },
                        callback: { method: "luna://com.webos.applicationManager/launch", params: { id: "com.palm.app.clock", params: { key: "a1" } } } },
        });
        rt.activities.fireDue(Date.now() + HOUR);
        document.removeEventListener("webOSRelaunch", on);
        expect(got).toEqual([{ key: "a1", $activity: expect.objectContaining({ name: "wake2" }) }]);
        expect(launches()).toHaveLength(0);
    });

    // The app's dashboard (or alert) may outlive its card: it is not the
    // app, so the shell launches the app instead of a relaunch inside it.
    it("from the app's dashboard window, asks the shell to launch the app", async () => {
        palm.appIdentifier = "com.palm.app.clock";
        const was = location.hash;
        location.hash = "phoenixWindow=dashboard&phoenixHeight=52";
        const got: unknown[] = [];
        const on = (e: Event) => got.push((e as CustomEvent).detail);
        document.addEventListener("webOSRelaunch", on);
        try {
            await call("luna://com.palm.activitymanager/create", {
                start: true,
                activity: { name: "wake3", schedule: { start: activityDateString(Date.now() + HOUR) },
                            callback: { method: "palm://com.palm.applicationManager/launch", params: { id: "com.palm.app.clock", params: { key: "a3" } } } },
            });
            expect(rt.activities.fireDue(Date.now() + HOUR)).toBe(1);
        } finally {
            document.removeEventListener("webOSRelaunch", on);
            location.hash = was;
        }
        expect(got).toEqual([]);
        expect(launches()).toEqual([{ id: "com.palm.app.clock", params: { key: "a3", $activity: expect.objectContaining({ name: "wake3" }) } }]);
    });

    it("fires on its own when the time comes", async () => {
        palm.appIdentifier = "com.palm.app.clock";
        const fired = new Promise<unknown>((res) => {
            const on = (e: Event) => { document.removeEventListener("webOSRelaunch", on); res((e as CustomEvent).detail); };
            document.addEventListener("webOSRelaunch", on);
        });
        // Whole seconds: start the schedule on the next one.
        await call("luna://com.palm.activitymanager/create", {
            start: true,
            activity: { name: "soon", schedule: { start: activityDateString(Math.ceil(Date.now() / 1000) * 1000 + 1000) },
                        callback: { method: "palm://com.palm.applicationManager/launch", params: { id: "com.palm.app.clock", params: {} } } },
        });
        await expect(fired).resolves.toMatchObject({ $activity: { name: "soon" } });
    });

    it("sets and clears com.palm.power timeouts on the same schedule", async () => {
        await call("luna://com.palm.power/timeout/set", { key: "t1", at: "12/31/2035 23:00:00", uri: "palm://com.palm.applicationManager/launch", params: { id: "x" } });
        expect(activity("timeout:t1")?.schedule?.start).toBe("2035-12-31 23:00:00Z");
        await call("luna://com.palm.power/timeout/clear", { key: "t1" });
        expect(activity("timeout:t1")).toBeUndefined();
    });
});

describe("tasks client", () => {
    it("makes one Inbox, however often it is asked", async () => {
        const [a, b] = await Promise.all([tasks.ensureInbox(), tasks.ensureInbox()]);
        expect(a._id).toBe(b._id);
        expect(await tasks.lists()).toHaveLength(1);
        expect(a).toMatchObject({ _kind: TASKLIST_KIND, name: "Inbox", isDefault: true, accountId: "" });
    });

    it("adds, renames and deletes lists (with their tasks); the Inbox stays", async () => {
        const inbox = await tasks.ensureInbox();
        const id = await tasks.addList("Groceries");
        await tasks.renameList(id, "Shopping");
        expect((await tasks.lists()).map((l) => l.name)).toEqual(["Inbox", "Shopping"]);
        const t = await newTask({ listId: id, remind: Date.now() + HOUR });
        expect(activity(reminderActivityName(t._id!))).toBeDefined();
        await tasks.deleteList(id);
        expect((await tasks.lists()).map((l) => l.name)).toEqual(["Inbox"]);
        expect(await tasks.get(t._id!)).toBeNull();
        expect(activity(reminderActivityName(t._id!))).toBeUndefined();
        await expect(tasks.deleteList(inbox._id!)).rejects.toBeInstanceOf(LunaError);
    });

    it("stores VTODO-shaped tasks and keeps uid and createdTime across edits", async () => {
        const t = await newTask({ notes: "2%", due: Date.UTC(2026, 9, 1), allDay: true, priority: PRIORITY.high });
        expect(t).toMatchObject({ _kind: TASK_KIND, summary: "Buy milk", notes: "2%", completed: false, priority: 1, remind: null, completedTime: null });
        expect(t.uid).toMatch(/@webosphoenix$/);
        await tasks.save({ ...t, summary: "  Buy oat milk " }, (t.createdTime ?? 0) + 5000);
        const e = (await tasks.get(t._id!))!;
        expect(e).toMatchObject({ summary: "Buy oat milk", uid: t.uid, createdTime: t.createdTime, modifiedTime: (t.createdTime ?? 0) + 5000 });
        const found = await db.find<Task>({ from: TASK_KIND, where: [{ prop: "summary", op: "?", val: "oat" }] });
        expect(found.map((x) => x._id)).toEqual([t._id]);
    });

    it("schedules a reminder the way the Clock app sets alarms, and drops it when done", async () => {
        const at = Date.now() + 2 * HOUR;
        const t = await newTask({ remind: at });
        const a = activity(reminderActivityName(t._id!))!;
        expect(a.schedule?.start).toBe(activityDateString(at));
        expect(a.callback?.params).toEqual({ id: TASKS_APP_ID, params: { reminder: t._id } });
        await tasks.setCompleted(t, true);
        expect(activity(reminderActivityName(t._id!))).toBeUndefined();
        expect((await tasks.get(t._id!))!.completedTime).toBeGreaterThan(0);
        // A reminder time that has passed is not scheduled.
        await tasks.save({ ...t, completed: false, remind: Date.now() - 1000 });
        expect(activity(reminderActivityName(t._id!))).toBeUndefined();
    });

    it("posts a notification when the reminder fires, and snoozes it for ten minutes", async () => {
        const due = Date.now() + 3 * HOUR;
        const t = await newTask({ summary: "Call Ada", due, remind: Date.now() + HOUR });
        rt.activities.fireDue(Date.now() + HOUR);
        const l = launches();
        expect(l).toEqual([{ id: TASKS_APP_ID, params: { reminder: t._id, $activity: expect.objectContaining({ name: reminderActivityName(t._id!) }) } }]);
        expect(await tasks.handleReminder(l[0].params.reminder as string)).toMatchObject({ _id: t._id });
        const n = hostMessages.find((m) => m.type === "notification");
        expect(n?.payload).toEqual({ appId: TASKS_APP_ID, title: "Call Ada", body: `Due ${dueText({ due, allDay: false })}`, params: { taskId: t._id, fromReminder: true } });
        expect(activity(reminderActivityName(t._id!))).toBeUndefined();

        const now = Date.now();
        await tasks.snooze(t, now);
        expect((await tasks.get(t._id!))!.remind).toBe(now + 10 * 60_000);
        expect(activity(reminderActivityName(t._id!))?.schedule?.start).toBe(activityDateString(now + 10 * 60_000));
    });

    it("says nothing for a task that is gone or done", async () => {
        const t = await newTask({ completed: true });
        expect(await tasks.handleReminder(t._id!)).toBeNull();
        await tasks.remove(t);
        expect(await tasks.handleReminder(t._id!)).toBeNull();
        expect(hostMessages.filter((m) => m.type === "notification")).toHaveLength(0);
    });
});

describe("dueText", () => {
    const now = new Date(2026, 8, 28, 10, 0).getTime();
    it("names nearby days and adds the time unless all day", () => {
        expect(dueText({ due: new Date(2026, 8, 28).getTime(), allDay: true }, now)).toBe("Today");
        expect(dueText({ due: new Date(2026, 8, 29, 15, 30).getTime(), allDay: false }, now)).toBe("Tomorrow 3:30 PM");
        expect(dueText({ due: new Date(2026, 8, 27).getTime(), allDay: true }, now)).toBe("Yesterday");
        expect(dueText({ due: new Date(2026, 9, 5).getTime(), allDay: true }, now)).toBe("Mon, Oct 5");
        expect(dueText({ due: null }, now)).toBe("");
    });
});
