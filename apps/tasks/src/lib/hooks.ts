// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from "react";
import { tasks, type Task, type TaskList } from "@phoenix/luna";

/** Every list (null until loaded); makes the Inbox on first use. */
export function useLists(): TaskList[] | null {
    const [l, setL] = useState<TaskList[] | null>(null);
    useEffect(() => {
        let live = true;
        void tasks.ensureInbox().catch(() => {});
        const sub = tasks.watchLists((all) => { if (live) setL(all); });
        return () => { live = false; sub.cancel(); };
    }, []);
    return l;
}

export function useTasks(): Task[] | null {
    const [t, setT] = useState<Task[] | null>(null);
    useEffect(() => {
        const sub = tasks.watchTasks(setT);
        return () => sub.cancel();
    }, []);
    return t;
}

/** The time, updated every minute (what is overdue changes with it). */
export function useNow(): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(t);
    }, []);
    return now;
}

/** A tablet-wide card: lists and tasks side by side. */
export function useWide(): boolean {
    const [wide, setWide] = useState(() => window.innerWidth >= 600);
    useEffect(() => {
        const on = () => setWide(window.innerWidth >= 600);
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
    }, []);
    return wide;
}
