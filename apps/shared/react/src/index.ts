// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// @phoenix/react: React hooks over @phoenix/sdk, for React apps of any kind
// (plain React, Ionic's React components; Enact apps use @phoenix/enact,
// which builds on these). Everything the SDK offers stays available from
// @phoenix/sdk; these keep it in step with components' lives: listeners
// removed on unmount, subscriptions cancelled, state updated on relaunch.
//
//     function App() {
//         const params = useLaunchParams<{ noteId?: string }>();
//         useBack(() => closeNote(), noteOpen);
//         useAppMenu({ items: [{ label: "Preferences", onSelect: openPrefs }], share: () => ({ text: note.body }) });
//         useShareReceiver((s) => createNote(s.text ?? s.url ?? ""));
//         ...
//     }

import { createElement, Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
    app, appMenu, applyTheme, assistant, has, justType, share,
    type AppMenuHandle, type AppMenuOptions, type Capability, type OnError, type OnValue, type PhoenixError, type ShareContent, type Watch,
} from "@phoenix/sdk";

/** The launch params, updated on each relaunch. */
export function useLaunchParams<T extends object = Record<string, unknown>>(): T {
    const [params, setParams] = useState<T>(() => app.launchParams<T>());
    useEffect(() => app.onRelaunch<T>(setParams), []);
    return params;
}

/** cb at each relaunch (not the first launch). */
export function useRelaunch<T extends object = Record<string, unknown>>(cb: (params: T) => void): void {
    const ref = useRef(cb);
    ref.current = cb;
    useEffect(() => app.onRelaunch<T>((p) => ref.current(p)), []);
}

/**
 * While `active`, the back gesture calls handler (return true when it was
 * taken). The innermost (last mounted) handler gets it first.
 */
export function useBack(handler: () => boolean | void, active = true): void {
    const ref = useRef(handler);
    ref.current = handler;
    // The order components first rendered in: a parent renders before its
    // children (whose effects run first, so effect order would put the
    // parent innermost).
    const [order] = useState(() => ++backSeq);
    useEffect(() => {
        if (!active) return;
        const entry = { order, run: () => ref.current() !== false };
        backHandlers.push(entry);
        backHandlers.sort((a, b) => a.order - b.order);
        if (!offBack) offBack = app.onBack(runBack);
        return () => {
            const i = backHandlers.indexOf(entry);
            if (i >= 0) backHandlers.splice(i, 1);
            if (!backHandlers.length && offBack) { offBack(); offBack = null; }
        };
    }, [active, order]);
}

let backSeq = 0;
const backHandlers: { order: number; run: () => boolean }[] = [];
let offBack: (() => void) | null = null;

function runBack(): boolean {
    for (let i = backHandlers.length - 1; i >= 0; --i)
        if (backHandlers[i].run()) return true;
    return false;
}

/**
 * The app menu, drawn by the SDK in the Phoenix look, opening from the
 * status bar's app name. Options are read again on every render.
 */
export function useAppMenu(options: AppMenuOptions): AppMenuHandle | null {
    const opts = useRef(options);
    opts.current = options;
    const [handle, setHandle] = useState<AppMenuHandle | null>(null);
    useEffect(() => {
        const h = appMenu.attach(opts.current);
        setHandle(h);
        return () => h.destroy();
    }, []);
    // The latest items and content (an open menu is drawn again with them).
    useEffect(() => { handle?.update(options); });
    return handle;
}

/** The app menu as a component (renders nothing itself): `<AppMenu items={...} share={...} />`. */
export function AppMenu(props: AppMenuOptions): null {
    useAppMenu(props);
    return null;
}

/** The latest value of a subscription and its last error; reopened when deps change. */
export function useWatch<T>(open: (onValue: OnValue<T>, onError: OnError) => Watch<T> | null, deps: readonly unknown[]): { value: T | undefined; error: PhoenixError | undefined } {
    const [state, setState] = useState<{ value: T | undefined; error: PhoenixError | undefined }>({ value: undefined, error: undefined });
    useEffect(() => {
        const w = open((value) => setState({ value, error: undefined }), (error) => setState((s) => ({ value: s.value, error })));
        return () => w?.cancel();
    }, deps); // eslint-disable-line react-hooks/exhaustive-deps
    return state;
}

/** A promise's result, run again when deps change: {value, error, loading}. */
export function usePromise<T>(run: () => Promise<T>, deps: readonly unknown[]): { value: T | undefined; error: unknown; loading: boolean } {
    const [state, setState] = useState<{ value: T | undefined; error: unknown; loading: boolean }>({ value: undefined, error: undefined, loading: true });
    useEffect(() => {
        let live = true;
        setState((s) => ({ ...s, loading: true }));
        run().then((value) => { if (live) setState({ value, error: undefined, loading: false }); },
                   (error) => { if (live) setState({ value: undefined, error, loading: false }); });
        return () => { live = false; };
    }, deps); // eslint-disable-line react-hooks/exhaustive-deps
    return state;
}

/** Whether the device offers a capability (see has()). */
export function useCapability(cap: Capability): boolean {
    return has(cap);
}

/** Content shared to the app (its appinfo.json shareTargets): at launch and on each relaunch. */
export function useShareReceiver(cb: (content: ShareContent) => void): void {
    const ref = useRef(cb);
    ref.current = cb;
    useEffect(() => share.onReceive((s) => ref.current(s)), []);
}

/** The app's Just Type action (its launchParam): cb gets the words typed. */
export function useJustTypeAction(launchParam: string, cb: (text: string) => void): void {
    const ref = useRef(cb);
    ref.current = cb;
    useEffect(() => justType.onAction(launchParam, (t) => ref.current(t)), [launchParam]);
}

/** One of the app's Assistant commands (its launchParam): cb gets the words that filled {text}. */
export function useAssistantCommand(launchParam: string, cb: (text: string) => void): void {
    const ref = useRef(cb);
    ref.current = cb;
    useEffect(() => assistant.onCommand(launchParam, (t) => ref.current(t)), [launchParam]);
}

/** Whether the app's card is in front. */
export function useActive(): boolean {
    const [active, setActive] = useState(() => app.active);
    useEffect(() => app.onActiveChange(setActive), []);
    return active;
}

/** Tell the system the first frame is drawn (PalmSystem.stageReady), once, after the first render. */
export function useStageReady(ready = true): void {
    const done = useRef(false);
    useEffect(() => {
        if (!ready || done.current) return;
        done.current = true;
        requestAnimationFrame(() => app.stageReady());
    }, [ready]);
}

/** Put the Phoenix design layer's stylesheet in the page (and phx-app on the body). */
export function usePhoenixTheme(options?: { body?: boolean }): void {
    useEffect(() => applyTheme(options), []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** How many times the user asked for fresh data (Settings > Apps > Refresh: the runtime's "phoenixRefresh" event). */
export function useRefresh(): number {
    const [n, setN] = useState(0);
    useEffect(() => {
        if (typeof document === "undefined") return;
        const h = () => setN((x) => x + 1);
        document.addEventListener("phoenixRefresh", h);
        return () => document.removeEventListener("phoenixRefresh", h);
    }, []);
    return n;
}

/** The app's root, started again when the app is refreshed (useRefresh). */
export function Refreshed({ children }: { children: ReactNode }) {
    return createElement(Fragment, { key: useRefresh() }, children);
}
