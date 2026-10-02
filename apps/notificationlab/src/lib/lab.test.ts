// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ID, Lab, TASK_NAME, formatElapsed, rowFor, startIn, taskRequest, type Host, type OngoingRow } from "./lab";

function recorder() {
    const rows = new Map<string, OngoingRow>();
    const banners: string[] = [];
    const cleared: string[] = [];
    const host: Host = {
        setOngoing: (r) => { rows.set(r.id, r); },
        clearOngoing: (id) => { rows.delete(id); cleared.push(id); },
        banner: (t) => { banners.push(t); },
    };
    return { host, rows, banners, cleared };
}

describe("Notification Lab activities", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("a download shows its progress each second, then goes with a banner", () => {
        const r = recorder();
        const lab = new Lab(r.host);
        const run = lab.start("download");
        expect(r.rows.get(run.id)).toMatchObject({ progress: 0, title: "Downloading Lab Sample.zip", params: { from: run.id } });
        vi.advanceTimersByTime(5000);
        expect(r.rows.get(run.id)?.progress).toBe(25);
        expect(r.rows.get(run.id)?.body).toBe("12.0 of 48 MB · 15 s left");
        vi.advanceTimersByTime(15000);
        expect(r.rows.has(run.id)).toBe(false);
        expect(r.banners).toEqual(["Lab Sample.zip downloaded"]);
        expect(lab.list()).toHaveLength(0);
        // Nothing left to run: the timer stops.
        expect(vi.getTimerCount()).toBe(0);
    });

    it("a sync has no progress bar (-1)", () => {
        const r = recorder();
        const run = new Lab(r.host).start("sync");
        expect(r.rows.get(run.id)?.progress).toBe(-1);
    });

    it("runs several at once, each its own row", () => {
        const r = recorder();
        const lab = new Lab(r.host);
        const a = lab.start("download"), b = lab.start("upload"), c = lab.start("install");
        expect(new Set([a.id, b.id, c.id]).size).toBe(3);
        expect(r.rows.size).toBe(3);
        vi.advanceTimersByTime(12000);
        // The install (12 s) is done; the others go on.
        expect([...r.rows.keys()].sort()).toEqual([a.id, b.id].sort());
        expect(r.banners).toEqual(["Lab Game installed"]);
    });

    it("pause holds the progress and says so; resume goes on", () => {
        const r = recorder();
        const lab = new Lab(r.host);
        const run = lab.start("download");
        vi.advanceTimersByTime(2000);
        lab.togglePause(run.id);
        expect(r.rows.get(run.id)?.title).toBe("Downloading Lab Sample.zip (paused)");
        vi.advanceTimersByTime(10000);
        expect(r.rows.get(run.id)?.progress).toBe(10);
        lab.togglePause(run.id);
        vi.advanceTimersByTime(2000);
        expect(r.rows.get(run.id)?.progress).toBe(20);
    });

    it("stop clears the row without a banner; a timer says it stopped", () => {
        const r = recorder();
        const lab = new Lab(r.host);
        const dl = lab.start("download");
        const t = lab.start("timer");
        vi.advanceTimersByTime(65000);
        expect(r.rows.get(t.id)?.body).toBe("1:05 elapsed");
        lab.stop(dl.id);
        expect(r.banners).toEqual(["Lab Sample.zip downloaded"]);   // it had finished at 20 s
        lab.stopAll();
        expect(r.rows.size).toBe(0);
        expect(r.banners).toEqual(["Lab Sample.zip downloaded", "Lab timer stopped"]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("tells its listeners", () => {
        const r = recorder();
        const lab = new Lab(r.host);
        const f = vi.fn();
        const off = lab.onChange(f);
        lab.start("sync");
        vi.advanceTimersByTime(1000);
        expect(f).toHaveBeenCalledTimes(2);
        off();
        lab.stopAll();
        expect(f).toHaveBeenCalledTimes(2);
    });

    it("rowFor and formatElapsed", () => {
        expect(formatElapsed(0)).toBe("0:00 elapsed");
        expect(formatElapsed(125)).toBe("2:05 elapsed");
        const row = rowFor({ id: "install-1", kind: { key: "install", title: "T", seconds: 10, determinate: true, body: (p) => `${p}`, done: "" }, elapsed: 7, paused: false });
        expect(row).toMatchObject({ progress: 70, body: "70" });
    });
});

describe("Notification Lab background tasks", () => {
    it("schedules a relaunch of the app, in UTC", () => {
        const now = Date.UTC(2026, 9, 2, 3, 4, 5, 678);
        expect(startIn(10000, now)).toBe("2026-10-02 03:04:15Z");
        expect(taskRequest(10, now)).toEqual({
            start: true, replace: true,
            activity: {
                name: TASK_NAME, description: "Notification Lab: in 10 s", type: { background: true },
                schedule: { start: "2026-10-02 03:04:15Z" },
                callback: { method: "palm://com.palm.applicationManager/launch",
                            params: { id: APP_ID, params: { task: "in 10 s", scheduled: now } } },
            },
        });
    });

    it("a charging task waits for the charger, under its own name", () => {
        const req = taskRequest(0, 0, true) as { activity: { name: string; requirements: object; schedule?: object } };
        expect(req.activity.name).toBe(TASK_NAME + ".charging");
        expect(req.activity.requirements).toEqual({ charging: true });
        expect(req.activity.schedule).toBeUndefined();
    });
});
