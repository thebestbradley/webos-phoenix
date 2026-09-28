// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// React hooks over the Luna client.
//
//   const status = useLuna((cb, err) => wifi.watchStatus(cb, err), []);

import { useEffect, useState } from "react";
import type { LunaError, Subscription } from "./bridge";

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
