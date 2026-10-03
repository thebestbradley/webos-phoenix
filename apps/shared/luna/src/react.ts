// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// React hooks over the Luna client.
//
//   const status = useLuna((cb, err) => wifi.watchStatus(cb, err), []);

import { useEffect, useState } from "react";
import type { LunaError, Subscription } from "./bridge";
import { fileUrl } from "./files";
import { mediaUrl } from "./media";

export interface LunaState<T> {
    value: T | undefined;
    error: LunaError | undefined;
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
