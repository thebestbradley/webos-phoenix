// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from "react";
import { tasks, type Task, type TaskList } from "@phoenix/luna";

export interface ListsState {
    /** Every list, the Inbox first (null until loaded). */
    lists: TaskList[] | null;
    /** Why the lists or the Inbox could not be had (the app says so instead of waiting). */
    error: string;
    retry: () => void;
}

/**
 * Every list. The Inbox is made on first use, and again whenever the lists
 * come without it: the app cannot work without its default list.
 */
export function useLists(): ListsState {
    const [l, setL] = useState<TaskList[] | null>(null);
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let live = true;
        const fail = (e: unknown) => { if (live) setError(errorText(e)); };
        const sub = tasks.watchLists((all) => {
            if (!live) return;
            setL(all);
            if (!all.some((x) => x.isDefault)) tasks.ensureInbox().catch(fail);
        }, fail);
        return () => { live = false; sub.cancel(); };
    }, [attempt]);
    return { lists: l, error, retry: () => { setError(""); setAttempt((n) => n + 1); } };
}

function errorText(e: unknown): string {
    return (e as { errorText?: string }).errorText ?? (e instanceof Error ? e.message : String(e));
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
