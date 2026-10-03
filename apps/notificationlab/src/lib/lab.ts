// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Notification Lab's simulated work: live activities that move on a
// timer, and the requests the app makes of the system. Kept apart from
// the page so it runs (and is tested) without one.
//
//   - Live activities: org.webosphoenix.ongoing set / clear (the shell's
//     rows pinned at the top of the notification area; docs/APP-RUNTIME.md
//     "Ongoing activities"). A run steps its progress on a timer and ends
//     with a banner.
//   - Background tasks: com.palm.activitymanager/create with a schedule
//     and a callback that relaunches the app ({$activity} in its params).

export const APP_ID = "org.webosphoenix.notificationlab";

/** A kind of simulated work. */
export interface Kind {
    key: string;
    title: string;
    /** Seconds to run; 0: until stopped. */
    seconds: number;
    /** false: no progress bar (an activity that cannot say how far it is). */
    determinate: boolean;
    /** What the row says, at `pct` (0-100) with `left` seconds to go. */
    body: (pct: number, left: number) => string;
    /** The banner at the end. */
    done: string;
}

const mb = (pct: number, total: number) => (total * pct / 100).toFixed(1);

export const KINDS: Record<string, Kind> = {
    download: {
        key: "download", title: "Downloading Lab Sample.zip", seconds: 20, determinate: true,
        body: (pct, left) => `${mb(pct, 48)} of 48 MB · ${left} s left`, done: "Lab Sample.zip downloaded",
    },
    upload: {
        key: "upload", title: "Uploading 12 photos", seconds: 32, determinate: true,
        body: (pct) => `${Math.min(12, Math.floor(pct * 12 / 100) + 1)} of 12`, done: "12 photos uploaded",
    },
    install: {
        key: "install", title: "Installing Lab Game", seconds: 12, determinate: true,
        body: (pct) => (pct < 60 ? "Downloading" : "Installing") + ` · ${pct}%`, done: "Lab Game installed",
    },
    sync: {
        key: "sync", title: "Syncing 3 accounts", seconds: 15, determinate: false,
        body: () => "Mail, Contacts and Calendar", done: "Accounts synced",
    },
    timer: {
        key: "timer", title: "Lab timer", seconds: 0, determinate: false,
        body: (_pct, left) => formatElapsed(-left), done: "Lab timer stopped",
    },
};

export function formatElapsed(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} elapsed`;
}

/** What the row shows. */
export interface OngoingRow {
    id: string;
    title: string;
    body: string;
    /** 0-100, or -1: no progress bar. */
    progress: number;
    params: { from: string };
}

/** A running activity. */
export interface Run {
    id: string;
    kind: Kind;
    /** Seconds since it started. */
    elapsed: number;
    paused: boolean;
}

export function rowFor(run: Run): OngoingRow {
    const k = run.kind;
    const pct = k.seconds > 0 ? Math.min(100, Math.round(run.elapsed * 100 / k.seconds)) : 0;
    const left = k.seconds > 0 ? Math.max(0, Math.ceil(k.seconds - run.elapsed)) : -run.elapsed;
    return {
        id: run.id,
        title: k.title + (run.paused ? " (paused)" : ""),
        body: k.body(pct, left),
        progress: k.determinate ? pct : -1,
        params: { from: run.id },
    };
}

export function finished(run: Run): boolean {
    return run.kind.seconds > 0 && run.elapsed >= run.kind.seconds;
}

/** What the lab asks of the system (the luna calls, a banner). */
export interface Host {
    setOngoing(row: OngoingRow): void;
    clearOngoing(id: string): void;
    banner(text: string, params: object): void;
}

/** The activities the lab is running, stepped once a second. */
export class Lab {
    private runs: Run[] = [];
    private timer: ReturnType<typeof setInterval> | null = null;
    private next = 1;
    private listeners = new Set<() => void>();

    constructor(private host: Host, private tickMs = 1000) {}

    list(): readonly Run[] { return this.runs; }

    onChange(f: () => void): () => void {
        this.listeners.add(f);
        return () => this.listeners.delete(f);
    }

    start(kindKey: string): Run {
        const kind = KINDS[kindKey];
        if (!kind) throw new Error("no such activity: " + kindKey);
        const run: Run = { id: `${kind.key}-${this.next++}`, kind, elapsed: 0, paused: false };
        this.runs = [...this.runs, run];
        this.host.setOngoing(rowFor(run));
        this.arm();
        this.changed();
        return run;
    }

    togglePause(id: string): void {
        this.update(id, (r) => ({ ...r, paused: !r.paused }));
    }

    /** Ends one now: its row goes, with no banner. */
    stop(id: string): void {
        const run = this.runs.find((r) => r.id === id);
        if (!run) return;
        this.runs = this.runs.filter((r) => r.id !== id);
        this.host.clearOngoing(id);
        if (run.kind.seconds === 0) this.host.banner(run.kind.done, { from: id });
        this.arm();
        this.changed();
    }

    stopAll(): void {
        for (const r of [...this.runs]) this.stop(r.id);
    }

    /** One step (the timer's; tests call it). */
    tick(): void {
        const ended: Run[] = [];
        this.runs = this.runs.map((r) => {
            if (r.paused) return r;
            const n = { ...r, elapsed: r.elapsed + this.tickMs / 1000 };
            if (finished(n)) ended.push(n);
            else this.host.setOngoing(rowFor(n));
            return n;
        }).filter((r) => !finished(r));
        for (const r of ended) {
            this.host.clearOngoing(r.id);
            this.host.banner(r.kind.done, { from: r.id });
        }
        this.arm();
        this.changed();
    }

    dispose(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.listeners.clear();
    }

    private update(id: string, f: (r: Run) => Run) {
        this.runs = this.runs.map((r) => {
            if (r.id !== id) return r;
            const n = f(r);
            this.host.setOngoing(rowFor(n));
            return n;
        });
        this.changed();
    }

    private arm() {
        const want = this.runs.length > 0;
        if (want && !this.timer) this.timer = setInterval(() => this.tick(), this.tickMs);
        else if (!want && this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    private changed() {
        for (const f of this.listeners) f();
    }
}

// ---- Background tasks (com.palm.activitymanager) -----------------------------------------

/** The activity manager's schedule.start for `ms` from `now`, in UTC ("YYYY-MM-DD HH:MM:SSZ"). */
export function startIn(ms: number, now = Date.now()): string {
    return new Date(now + ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

export const TASK_NAME = "org.webosphoenix.notificationlab.task";

/** The create request: the app relaunched with {task, $activity} when it is due. */
export function taskRequest(seconds: number, now = Date.now(), charging = false): object {
    const activity: Record<string, unknown> = {
        name: charging ? TASK_NAME + ".charging" : TASK_NAME,
        description: charging ? "Notification Lab: when charging" : `Notification Lab: in ${seconds} s`,
        type: { background: true },
        callback: {
            method: "palm://com.palm.applicationManager/launch",
            params: { id: APP_ID, params: { task: charging ? "charging" : `in ${seconds} s`, scheduled: now } },
        },
    };
    if (charging) activity.requirements = { charging: true };
    else activity.schedule = { start: startIn(seconds * 1000, now) };
    return { start: true, replace: true, activity };
}

/** The launch params of a relaunch by the task. */
export interface TaskLaunch {
    task?: string;
    scheduled?: number;
    $activity?: { activityId: number; name: string };
    from?: string;
}
