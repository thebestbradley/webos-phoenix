// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import { PRIORITY, type Task, type TaskList } from "@phoenix/luna";
import {
    addDays, countTasks, daysInMonth, defaultDue, defaultRemind, fromParts, isDueToday, isOverdue, isUpcoming, launchText, loadPrefs, withDefaultTime,
    priorityChoice, priorityMarks, savePrefs, selectionTitle, startOfDay, toParts, visibleTasks,
} from "./views";

// Monday 28 September 2026, 10:00 local time.
const NOW = new Date(2026, 8, 28, 10, 0).getTime();
const at = (d: number, h = 0, mi = 0) => new Date(2026, 8, d, h, mi).getTime();

let n = 0;
function task(over: Partial<Task>): Task {
    return { _kind: "com.palm.task:1", _id: `t${++n}`, summary: `Task ${n}`, completed: false, priority: 0, listId: "inbox",
             accountId: "", createdTime: n, ...over };
}

describe("due dates", () => {
    it("knows what is overdue, due today and upcoming", () => {
        const yesterday = task({ due: at(27), allDay: true });
        const todayAllDay = task({ due: at(28), allDay: true });
        const thisMorning = task({ due: at(28, 9), allDay: false });
        const tonight = task({ due: at(28, 20), allDay: false });
        const tomorrow = task({ due: at(29), allDay: true });
        const undated = task({});
        expect([yesterday, todayAllDay, thisMorning, tonight, tomorrow, undated].map((t) => isOverdue(t, NOW)))
            .toEqual([true, false, true, false, false, false]);
        expect([yesterday, todayAllDay, thisMorning, tonight, tomorrow, undated].map((t) => isDueToday(t, NOW)))
            .toEqual([false, true, true, true, false, false]);
        expect([yesterday, todayAllDay, tomorrow, undated].map((t) => isUpcoming(t, NOW))).toEqual([false, false, true, false]);
        expect(isOverdue({ ...yesterday, completed: true }, NOW)).toBe(false);
    });

    it("steps whole days across month ends", () => {
        expect(startOfDay(at(28, 15, 30))).toBe(at(28));
        expect(addDays(at(30, 12), 1)).toBe(new Date(2026, 9, 1).getTime());
        expect(daysInMonth(2028, 2)).toBe(29);
        expect(fromParts({ ...toParts(new Date(2026, 0, 31, 8, 5).getTime()), mo: 2 })).toBe(new Date(2026, 1, 28, 8, 5).getTime());
    });
});

describe("views and lists", () => {
    const tasks = [
        task({ summary: "Pay rent", due: at(27), allDay: true, priority: PRIORITY.high }),
        task({ summary: "Water plants", due: at(28), allDay: true }),
        task({ summary: "Dentist", due: at(28, 16), allDay: false, listId: "errands" }),
        task({ summary: "Done already", due: at(28), allDay: true, completed: true }),
        task({ summary: "Book flights", due: at(30), allDay: true, priority: PRIORITY.low }),
        task({ summary: "Someday", priority: PRIORITY.medium }),
        task({ summary: "Someday urgent", priority: PRIORITY.high }),
    ];
    const titles = (ts: Task[]) => ts.map((t) => t.summary);

    it("lists a list's tasks: open first, by due date, then priority", () => {
        expect(titles(visibleTasks(tasks, { kind: "list", listId: "inbox" }, { hideCompleted: false, now: NOW })))
            .toEqual(["Pay rent", "Water plants", "Book flights", "Someday urgent", "Someday", "Done already"]);
        expect(titles(visibleTasks(tasks, { kind: "list", listId: "inbox" }, { hideCompleted: true, now: NOW })))
            .not.toContain("Done already");
    });

    it("gathers Today, Upcoming and Overdue from every list", () => {
        const view = (v: "today" | "upcoming" | "overdue", hideCompleted = false) =>
            titles(visibleTasks(tasks, { kind: "view", view: v }, { hideCompleted, now: NOW }));
        expect(view("today")).toEqual(["Water plants", "Dentist", "Done already"]);
        expect(view("today", true)).toEqual(["Water plants", "Dentist"]);
        expect(view("upcoming")).toEqual(["Book flights"]);
        expect(view("overdue")).toEqual(["Pay rent"]);
    });

    it("counts open tasks per view and list", () => {
        expect(countTasks(tasks, NOW)).toEqual({ today: 2, upcoming: 1, overdue: 1, lists: { inbox: 5, errands: 1 } });
    });

    it("titles the selection", () => {
        const lists: TaskList[] = [{ _kind: "com.palm.tasklist:1", _id: "inbox", name: "Inbox", accountId: "" }];
        expect(selectionTitle({ kind: "view", view: "upcoming" }, lists)).toBe("Upcoming");
        expect(selectionTitle({ kind: "list", listId: "inbox" }, lists)).toBe("Inbox");
    });
});

describe("new tasks and reminders", () => {
    it("are due today in Today and tomorrow in Upcoming", () => {
        expect(defaultDue({ kind: "view", view: "today" }, NOW)).toBe(at(28));
        expect(defaultDue({ kind: "view", view: "upcoming" }, NOW)).toBe(at(29));
        expect(defaultDue({ kind: "list", listId: "inbox" }, NOW)).toBeNull();
    });

    it("remind at the due time if it is ahead, else at the next full hour", () => {
        expect(defaultRemind({ due: at(28, 16), allDay: false }, NOW)).toBe(at(28, 16));
        expect(defaultRemind({ due: at(30), allDay: true }, NOW)).toBe(at(30, 9));
        expect(defaultRemind({ due: at(28, 9), allDay: false }, at(28, 10, 20))).toBe(at(28, 11));
        expect(defaultRemind({ due: null }, NOW)).toBe(at(28, 11));
    });
});

describe("priorities, launch text, prefs", () => {
    beforeEach(() => localStorage.clear());

    it("shows iCalendar priorities as marks and picker choices", () => {
        expect([0, 1, 3, 5, 7, 9].map(priorityMarks)).toEqual(["", "!!!", "!!!", "!!", "!", "!"]);
        expect([0, 2, 5, 8].map(priorityChoice)).toEqual([PRIORITY.none, PRIORITY.high, PRIORITY.medium, PRIORITY.low]);
    });

    it("decodes the text Just Type passes, and tolerates plain text", () => {
        expect(launchText("buy%20milk")).toBe("buy milk");
        expect(launchText("100%")).toBe("100%");
    });

    it("remembers whether completed tasks are hidden", () => {
        expect(loadPrefs()).toEqual({ hideCompleted: false });
        savePrefs({ hideCompleted: true });
        expect(loadPrefs()).toEqual({ hideCompleted: true });
    });
});

describe("withDefaultTime", () => {
    const due = new Date(2026, 8, 30).getTime();
    it("is the next whole hour on the due day", () => {
        expect(withDefaultTime(due, new Date(2026, 8, 28, 14, 20).getTime())).toBe(new Date(2026, 8, 30, 15, 0).getTime());
    });
    it("stays on the due day after 11 PM instead of rolling to the next", () => {
        expect(withDefaultTime(due, new Date(2026, 8, 28, 23, 5).getTime())).toBe(new Date(2026, 8, 30, 23, 0).getTime());
    });
});
