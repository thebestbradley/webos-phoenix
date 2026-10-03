// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Tasks and task lists in db8, and their reminders.
//
// webOS 1.x shipped a Tasks app whose lists could be synced per account
// (Synergy); the account templates released with Open webOS still name a
// TASKS capability and an Exchange sub-kind, com.palm.task.eas:1
// (third_party/app-services/account-templates), but the task kinds
// themselves were never released. So Phoenix defines:
//
//   com.palm.tasklist:1  name, accountId ("" = on this device), sortOrder
//   com.palm.task:1      summary, notes, due, allDay, completed,
//                        completedTime, priority, listId, accountId,
//                        remind, uid, createdTime, modifiedTime
//
// The fields map onto an iCalendar VTODO for a later CalDAV sync: SUMMARY,
// DESCRIPTION, DUE (a DATE when allDay, else a DATE-TIME), STATUS:COMPLETED
// and COMPLETED, PRIORITY (0 undefined, 1 highest ... 9 lowest), a VALARM
// with an absolute TRIGGER, UID, CREATED and LAST-MODIFIED. An account's
// synced tasks would go in its own sub-kind (com.palm.task.eas:1 extends
// com.palm.task:1), as Contacts and Calendar do.
//
// A reminder is an activity, scheduled the way the webOS Clock app sets
// alarms (com.palm.app.clock utility/activitymanager.js): an activity named
// after the task with a schedule, whose callback launches the app with
// {reminder: taskId}. The app then posts the notification.
//
//   luna://com.palm.activitymanager/create {activity: {name, schedule:
//       {start: "YYYY-MM-DD HH:MM:SSZ"}, callback: {method:
//       "palm://com.palm.applicationManager/launch", params: {id, params}}},
//       start: true, replace: true}
//   luna://com.palm.activitymanager/complete {activityName}

import { call, LunaError, type Subscription } from "./bridge";
import { db, type DbObject } from "./db8";

export const TASK_KIND = "com.palm.task:1";
export const TASKLIST_KIND = "com.palm.tasklist:1";
export const TASKS_APP_ID = "org.webosphoenix.tasks";

/** iCalendar PRIORITY values (RFC 5545 3.8.1.9) the app offers. */
export const PRIORITY = { none: 0, high: 1, medium: 5, low: 9 } as const;

export interface TaskList extends DbObject {
    name: string;
    /** com.palm.account:1 _id of the account it syncs with; "" on this device. */
    accountId: string;
    sortOrder?: number;
    /** The default list; it cannot be deleted. */
    isDefault?: boolean;
}

export interface Task extends DbObject {
    summary: string;
    notes?: string;
    /** When it is due (ms). With allDay, local midnight of the day. */
    due?: number | null;
    allDay?: boolean;
    completed: boolean;
    completedTime?: number | null;
    /** 0 none, 1 high, 5 medium, 9 low. */
    priority: number;
    listId: string;
    accountId: string;
    /** When to remind (ms), or null. */
    remind?: number | null;
    uid?: string;
    createdTime?: number;
    modifiedTime?: number;
}

/** A task being written; db8 fills in _id and _rev. */
export type TaskInput = Omit<Task, "_kind" | "uid" | "createdTime" | "modifiedTime"> & Partial<Pick<Task, "_kind">>;

/** Launch params the Tasks app understands. */
export interface TasksLaunchParams {
    /** Open this task (Just Type, a tapped notification). */
    taskId?: string;
    /** With taskId: it was opened from its reminder (offer Snooze and Done). */
    fromReminder?: boolean;
    /** Start a new task with this summary (Just Type "New Task"). */
    text?: string;
    /** A reminder is due for this task (the activity's callback). */
    reminder?: string;
    /** Added by the activity manager to an activity's callback. */
    $activity?: { activityId?: number; name?: string };
}

export const SNOOZE_MINUTES = 10;

type OnError = (e: LunaError) => void;

const AM = "luna://com.palm.activitymanager";

/** The reminder activity's name for a task. */
export function reminderActivityName(taskId: string): string {
    return `${TASKS_APP_ID}.remind.${taskId}`;
}

/** "2026-09-28 14:05:00Z": the activity manager's schedule format (UTC), as the calendar reminders service writes it. */
export function activityDateString(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
        `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

function newUid(): string {
    const r = Math.random().toString(36).slice(2, 10);
    return `${Date.now().toString(36)}-${r}@webosphoenix`;
}

let inboxPending: Promise<TaskList> | null = null;

function byOrder(a: TaskList, b: TaskList): number {
    if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name);
}

export const tasks = {
    /** Every list, the default one first. */
    watchLists(cb: (lists: TaskList[]) => void, onError?: OnError): Subscription {
        return db.watch<TaskList>({ from: TASKLIST_KIND }, (all) => cb([...all].sort(byOrder)), onError);
    },
    /** Every task (the views filter and sort them). */
    watchTasks(cb: (all: Task[]) => void, onError?: OnError): Subscription {
        return db.watch<Task>({ from: TASK_KIND }, cb, onError);
    },
    async lists(): Promise<TaskList[]> {
        return (await db.find<TaskList>({ from: TASKLIST_KIND })).sort(byOrder);
    },
    async get(id: string): Promise<Task | null> {
        return (await db.get<Task>([id]))[0] ?? null;
    },

    /** The default list ("Inbox"), made on first use. */
    ensureInbox(): Promise<TaskList> {
        // One at a time, so two callers cannot both make one.
        inboxPending ??= (async () => {
            const found = (await tasks.lists()).find((l) => l.isDefault);
            if (found) return found;
            const inbox: TaskList = { _kind: TASKLIST_KIND, name: "Inbox", accountId: "", sortOrder: 0, isDefault: true };
            const [r] = await db.put([inbox]);
            return { ...inbox, _id: r.id, _rev: r.rev };
        })().finally(() => { inboxPending = null; });
        return inboxPending;
    },
    async addList(name: string, accountId = ""): Promise<string> {
        const all = await tasks.lists();
        const sortOrder = all.reduce((m, l) => Math.max(m, l.sortOrder ?? 0), 0) + 1;
        const [r] = await db.put([{ _kind: TASKLIST_KIND, name, accountId, sortOrder } as TaskList]);
        return r.id;
    },
    async renameList(id: string, name: string): Promise<void> {
        await db.merge([{ _id: id, name }]);
    },
    /** Delete a list with its tasks (and their reminders). The default list stays. */
    async deleteList(id: string): Promise<void> {
        const [list] = await db.get<TaskList>([id]);
        if (!list || list.isDefault) throw new LunaError(`${TASKLIST_KIND}/del`, { returnValue: false, errorCode: -1, errorText: "The default list cannot be deleted" });
        const inList = await db.find<Task>({ from: TASK_KIND, where: [{ prop: "listId", op: "=", val: id }] });
        for (const t of inList) if (t.remind && t._id) await tasks.cancelReminder(t._id);
        await db.delWhere({ from: TASK_KIND, where: [{ prop: "listId", op: "=", val: id }] });
        await db.del([id]);
    },

    /**
     * Store a task (new when it has no _id) and bring its reminder in line:
     * scheduled when it has a future remind time and is not completed,
     * cancelled otherwise. Resolves with the task's _id.
     */
    async save(input: TaskInput, now = Date.now()): Promise<string> {
        const task: Task = {
            ...input,
            _kind: TASK_KIND,
            summary: input.summary.trim(),
            due: input.due ?? null,
            remind: input.remind ?? null,
            completedTime: input.completed ? (input.completedTime ?? now) : null,
            modifiedTime: now,
        };
        let id = input._id;
        if (id) {
            const [old] = await db.get<Task>([id]);
            task.uid = old?.uid ?? newUid();
            task.createdTime = old?.createdTime ?? now;
            await db.put([task]);
        } else {
            task.uid = newUid();
            task.createdTime = now;
            id = (await db.put([task]))[0].id;
        }
        await tasks.syncReminder({ ...task, _id: id }, now);
        return id;
    },
    async setCompleted(task: Task, completed: boolean, now = Date.now()): Promise<void> {
        await tasks.save({ ...task, completed, completedTime: completed ? now : null }, now);
    },
    async remove(task: Task): Promise<void> {
        if (!task._id) return;
        if (task.remind) await tasks.cancelReminder(task._id);
        await db.del([task._id]);
    },
    /** Remind again in SNOOZE_MINUTES. */
    async snooze(task: Task, now = Date.now(), minutes = SNOOZE_MINUTES): Promise<void> {
        await tasks.save({ ...task, remind: now + minutes * 60_000 }, now);
    },

    async syncReminder(task: Task, now = Date.now()): Promise<void> {
        if (!task._id) return;
        if (task.remind && task.remind > now && !task.completed) await tasks.scheduleReminder(task._id, task.remind);
        else await tasks.cancelReminder(task._id);
    },
    /** Create (or replace) the task's reminder activity. */
    async scheduleReminder(taskId: string, at: number): Promise<void> {
        await call(`${AM}/create`, {
            start: true,
            replace: true,
            activity: {
                name: reminderActivityName(taskId),
                description: "Tasks reminder",
                type: { foreground: true, persist: true },
                schedule: { start: activityDateString(at) },
                callback: {
                    method: "palm://com.palm.applicationManager/launch",
                    params: { id: TASKS_APP_ID, params: { reminder: taskId } },
                },
            },
        });
    },
    /** Drop the task's reminder activity; fine if there is none. */
    async cancelReminder(taskId: string): Promise<void> {
        try {
            await call(`${AM}/complete`, { activityName: reminderActivityName(taskId) });
        } catch (e) {
            if (!(e instanceof LunaError)) throw e;
        }
    },

    /**
     * A reminder activity fired ({reminder: taskId}): tell the shell with a
     * "notification" host message (a banner and a dashboard item; tapping it
     * launches the app with {taskId, fromReminder}), and complete the
     * activity. Resolves with the task, or null if it is gone or done.
     */
    async handleReminder(taskId: string): Promise<Task | null> {
        await tasks.cancelReminder(taskId);
        const task = await tasks.get(taskId);
        if (!task || task.completed) return null;
        const body = task.due ? `Due ${dueText(task)}` : task.notes?.split("\n")[0] || "Reminder";
        postNotification({ appId: TASKS_APP_ID, title: task.summary, body, params: { taskId, fromReminder: true } });
        return task;
    },
};

/** "Today", "Tomorrow", "Mon, Sep 29", with the time unless it is all day. */
export function dueText(task: Pick<Task, "due" | "allDay">, now = Date.now()): string {
    if (!task.due) return "";
    const d = new Date(task.due);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const n = new Date(now);
    const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    const days = Math.round((day - today) / 86_400_000);
    const date = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday"
        : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    if (task.allDay) return date;
    return `${date} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export interface HostNotification {
    appId: string;
    title: string;
    body?: string;
    /** Launch params for the app when the notification is tapped. */
    params?: Record<string, unknown>;
}

/**
 * Post a notification to the shell: phoenixHost's "notification" message
 * (phoenix-sim shows a banner and a dashboard item), else a legacy banner.
 */
export function postNotification(n: HostNotification): void {
    const g = globalThis as {
        phoenixHost?: { postToHost(type: string, payload: object): void };
        PalmSystem?: { addBannerMessage?: (msg: string, params: string, icon?: string) => void };
    };
    if (g.phoenixHost) g.phoenixHost.postToHost("notification", n);
    else g.PalmSystem?.addBannerMessage?.(n.body ? `${n.title}: ${n.body}` : n.title, JSON.stringify(n.params ?? {}), "icon.png");
}
