// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// React hooks over the Luna client.
//
//   const status = useLuna((cb, err) => wifi.watchStatus(cb, err), []);

import { createElement, Fragment, useEffect, useState, type ReactNode } from "react";
import type { LunaError, Subscription } from "./bridge";
import { fileUrl } from "./files";
import { mediaUrl } from "./media";
import { devMode } from "./services";

export interface LunaState<T> {
    value: T | undefined;
    error: LunaError | undefined;
}

/**
 * How many times the app was asked for fresh data: the shell relaunched it
 * with Settings > Apps > Opening a running app set to Refresh (the
 * runtime's "phoenixRefresh" document event). A count to put in an
 * effect's deps so it runs again.
 */
export function useRefresh(): number {
    const [count, setCount] = useState(0);
    useEffect(() => {
        if (typeof document === "undefined") return;
        const onRefresh = () => setCount((n) => n + 1);
        document.addEventListener("phoenixRefresh", onRefresh);
        return () => document.removeEventListener("phoenixRefresh", onRefresh);
    }, []);
    return count;
}

/**
 * Keep the latest value of a subscription. `start` opens it (for example
 * `(cb, err) => wifi.watchStatus(cb, err)`); it is reopened when deps change
 * and cancelled on unmount.
 */
export function useLuna<T>(
    start: (onValue: (v: T) => void, onError: (e: LunaError) => void) => Subscription | null,
    deps: readonly unknown[],
): LunaState<T> {
    const [state, setState] = useState<LunaState<T>>({ value: undefined, error: undefined });
    useEffect(() => {
        const sub = start(
            (value) => setState({ value, error: undefined }),
            (error) => setState((s) => ({ value: s.value, error })),
        );
        return () => sub?.cancel();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return state;
}

/**
 * Settings' Developer Mode shows (its launch point, the list of panes, the
 * Marketplace's way there): Developer Mode is on, or Just Type's Konami
 * code revealed it (devModeUnlocked). undefined until both are known.
 */
export function useDevModeShown(): boolean | undefined {
    const on = useLuna<boolean>((cb, err) => devMode.watch(cb, err), []).value;
    const unlocked = useLuna<boolean>((cb, err) => devMode.watchUnlocked(cb, err), []).value;
    if (on === true || unlocked === true) return true;
    return on === undefined || unlocked === undefined ? undefined : false;
}

/**
 * An app's root (each Phoenix app's main.tsx): started again when the app
 * is refreshed (useRefresh), so everything it shows is loaded anew from
 * the services, for the launch params it was relaunched with, as a webOS
 * app reloaded on its relaunch.
 */
export function Refreshed({ children }: { children: ReactNode }) {
    return createElement(Fragment, { key: useRefresh() }, children);
}

/** The launch params and every relaunch (OSE's "webOSRelaunch" document event). */
export function useLaunchParams<T extends object>(): T {
    const read = (): T => {
        try {
            const raw = (globalThis as { PalmSystem?: { launchParams?: string } }).PalmSystem?.launchParams;
            return (raw ? JSON.parse(raw) : {}) as T;
        } catch {
            return {} as T;
        }
    };
    const [params, setParams] = useState<T>(read);
    useEffect(() => {
        const onRelaunch = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            setParams(detail && typeof detail === "object" ? (detail as T) : read());
        };
        document.addEventListener("webOSRelaunch", onRelaunch);
        return () => document.removeEventListener("webOSRelaunch", onRelaunch);
    }, []);
    return params;
}

/**
 * A URL to show any file of the device (see fileUrl(): the file manager's,
 * which also knows files that are copies of the system's, such as a
 * message's pictures); undefined until it is known.
 */
export function useFileUrl(path: string | undefined): string | undefined {
    const [url, setUrl] = useState<{ path: string; url: string }>();
    useEffect(() => {
        if (!path) return;
        let live = true;
        fileUrl(path).then((u) => { if (live) setUrl({ path, url: u }); }, () => {});
        return () => { live = false; };
    }, [path]);
    return url && url.path === path ? url.url : undefined;
}

/** A URL for a media file path (see mediaUrl()); undefined until it is known. */
export function useMediaUrl(path: string | undefined): string | undefined {
    const [url, setUrl] = useState<{ path: string; url: string }>();
    useEffect(() => {
        if (!path) return;
        let live = true;
        mediaUrl(path).then((u) => { if (live) setUrl({ path, url: u }); }, () => {});
        return () => { live = false; };
    }, [path]);
    return url && url.path === path ? url.url : undefined;
}
