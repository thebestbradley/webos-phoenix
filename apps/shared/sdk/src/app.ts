// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The app's life: what it was launched with, relaunches, the back gesture,
// the first frame, staying loaded, its window (orientation, full screen,
// screen on), and launching other apps.
//
//   Launch params: PalmSystem.launchParams (a JSON string), as WebAppMgr
//       gives them; a relaunch of a running app is the "webOSRelaunch"
//       document event (detail = params), as WebAppMgr dispatches it; the
//       Phoenix runtime does both (runtime/phoenix-runtime.js runtime.relaunch).
//   Back: the shell sends the back gesture to the page as an Escape key
//       (runtime.back; the webOS Back key, 461, goes on as Escape first on a
//       device). A page that takes it prevents the key's default; one that
//       does not is minimized to card view, as LunaSysMgr did
//       (SystemUiController.cpp:941-954).

import { guard, palmSystem, phoenixRuntime, request, warnOnce, type LunaReply } from "./core";

export type Orientation = "free" | "up" | "down" | "left" | "right" | "landscape" | "portrait";

export interface DeviceInfo {
    modelName?: string;
    platformVersion?: string;
    platformVersionMajor?: number;
    platformVersionMinor?: number;
    platformVersionDot?: number;
    screenWidth?: number;
    screenHeight?: number;
    keyboardAvailable?: boolean;
    wifiAvailable?: boolean;
    bluetoothAvailable?: boolean;
    [key: string]: unknown;
}

function parseJson<T>(raw: unknown, fallback: T): T {
    if (raw && typeof raw === "object") return raw as T;
    if (typeof raw !== "string" || !raw) return fallback;
    try {
        const v = JSON.parse(raw) as unknown;
        return (v && typeof v === "object" ? v : fallback) as T;
    } catch {
        return fallback;
    }
}

function appIdFromUrl(): string {
    if (typeof location === "undefined") return "";
    const m = /\/usr\/palm\/applications\/([^/]+)\//.exec(location.pathname);
    return m ? m[1] : "";
}

/** Handlers of the back gesture, innermost (last added) first. */
const backStack: (() => boolean)[] = [];
let backListening = false;

function onBackKey(e: KeyboardEvent): void {
    if ((e.key !== "Escape" && e.keyCode !== 461) || e.defaultPrevented) return;
    for (let i = backStack.length - 1; i >= 0; --i) {
        if (backStack[i]()) {
            e.preventDefault();
            return;
        }
    }
}

export const app = {
    /** The app's id (appinfo.json's id): "com.example.notes". */
    get id(): string {
        const p = palmSystem();
        return p?.appIdentifier || (p?.identifier ? p.identifier.split(" ")[0] : "") || appIdFromUrl();
    },

    /** The params the app was (last) launched with: {} when none. */
    launchParams<T extends object = Record<string, unknown>>(): T {
        return parseJson<T>(palmSystem()?.launchParams, {} as T);
    },

    /**
     * Each relaunch while the app runs (the user opened it again, a
     * notification or Just Type opened it with params). Returns a function
     * that stops listening.
     */
    onRelaunch<T extends object = Record<string, unknown>>(cb: (params: T) => void): () => void {
        if (typeof document === "undefined") return () => {};
        const h = (e: Event) => {
            const d = (e as CustomEvent).detail as unknown;
            cb(d && typeof d === "object" ? d as T : app.launchParams<T>());
        };
        document.addEventListener("webOSRelaunch", h);
        return () => document.removeEventListener("webOSRelaunch", h);
    },

    /**
     * The launch params now and at every relaunch: cb runs at once with the
     * current ones, then again on each relaunch.
     */
    onLaunch<T extends object = Record<string, unknown>>(cb: (params: T) => void): () => void {
        cb(app.launchParams<T>());
        return app.onRelaunch<T>(cb);
    },

    /**
     * The back gesture. The innermost handler added gets it first; return
     * true when it was taken (a pane closed), false to pass it on. When no
     * handler takes it the system minimizes the card, as webOS did at an
     * app's top level. Returns a function that removes the handler.
     *
     *     const off = app.onBack(() => { if (!editing) return false; stopEditing(); return true; });
     */
    onBack(handler: () => boolean): () => void {
        if (!backListening && typeof window !== "undefined") {
            window.addEventListener("keydown", onBackKey);
            backListening = true;
        }
        backStack.push(handler);
        return () => {
            const i = backStack.lastIndexOf(handler);
            if (i >= 0) backStack.splice(i, 1);
        };
    },

    /** Whether the app's card is in front (PalmSystem.isActivated; true without one). */
    get active(): boolean {
        return palmSystem()?.isActivated?.() ?? (typeof document === "undefined" || !document.hidden);
    },

    /**
     * The card coming to the front or leaving it: the Phoenix shell's
     * "phoenixcardactivation" event (a card minimized to card view stays
     * visible), and the page's visibility elsewhere.
     */
    onActiveChange(cb: (active: boolean) => void): () => void {
        if (typeof window === "undefined") return () => {};
        const card = (e: Event) => cb(!!((e as CustomEvent).detail as { active?: boolean } | null)?.active);
        const vis = () => cb(!document.hidden);
        window.addEventListener("phoenixcardactivation", card);
        document.addEventListener("visibilitychange", vis);
        return () => {
            window.removeEventListener("phoenixcardactivation", card);
            document.removeEventListener("visibilitychange", vis);
        };
    },

    /** The first frame is drawn: the card stops showing its launch screen (PalmSystem.stageReady). */
    stageReady(): void {
        palmSystem()?.stageReady?.();
    },

    /** Brings the app's card to the front (PalmSystem.activate). */
    activate(): void {
        palmSystem()?.activate?.();
    },

    /**
     * Stay loaded when the last card closes (a headless app that keeps
     * working, as LunaSysMgr's [KeepAlive] apps): PalmSystem.keepAlive.
     */
    keepAlive(on = true): void {
        const p = palmSystem();
        if (p?.keepAlive) p.keepAlive(on);
        else warnOnce("keepAlive", "app.keepAlive: PalmSystem.keepAlive is not here; the app closes with its last card.");
    },

    /** The window's orientation: "free" follows the device (PalmSystem.setWindowOrientation). */
    setOrientation(o: Orientation): void {
        const p = palmSystem();
        if (p?.setWindowOrientation) p.setWindowOrientation(o);
        else warnOnce("orientation", "app.setOrientation: not on webOS; the window keeps the browser's orientation.");
    },

    /** The maximized card takes the whole screen, status bar too (PalmSystem.enableFullScreenMode). */
    setFullScreen(on: boolean): void {
        const p = palmSystem();
        if (p?.enableFullScreenMode) p.enableFullScreenMode(on);
        else if (typeof document !== "undefined" && document.documentElement.requestFullscreen) {
            if (on) void document.documentElement.requestFullscreen().catch(() => {});
            else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        }
    },

    /** Keep the screen on while the card is in front (a video, a recipe): setWindowProperties blockScreenTimeout. */
    keepScreenOn(on: boolean): void {
        palmSystem()?.setWindowProperties?.({ blockScreenTimeout: on });
    },

    /** Tint the tablet's status bar while the card is maximized (0xRRGGBB). */
    setStatusBarColor(rgb: number): void {
        palmSystem()?.setWindowProperties?.({ statusBarColor: rgb & 0xffffff });
    },

    /** The system's locale ("en_us"). */
    get locale(): string {
        return palmSystem()?.locale ?? (typeof navigator !== "undefined" ? navigator.language.replace("-", "_").toLowerCase() : "en_us");
    },

    /** "HH12" or "HH24". */
    get timeFormat(): "HH12" | "HH24" {
        return palmSystem()?.timeFormat === "HH24" ? "HH24" : "HH12";
    },

    /** PalmSystem.deviceInfo: the model, platform version, screen size. {} outside webOS. */
    get deviceInfo(): DeviceInfo {
        return parseJson<DeviceInfo>(palmSystem()?.deviceInfo, {});
    },

    /** Whether this runs in Phoenix's runtime (phoenix-sim, a browser with it, or a Phoenix device). */
    get onPhoenix(): boolean {
        return !!phoenixRuntime();
    },

    /**
     * Launch an app (applicationManager/launch), with params it reads as its
     * launch params. Resolves when the system has it in hand.
     */
    async launch(appId: string, params: object = {}): Promise<void> {
        await request("luna://com.webos.applicationManager/launch", { id: appId, params });
    },

    /**
     * Open a URL or file in the app that handles it (applicationManager/open):
     * http(s) in the browser, tel: in Phone, mailto: in Email, a file by type.
     */
    async open(target: string): Promise<void> {
        await request("luna://com.webos.applicationManager/open", { target });
    },

    /** Close this window (the card). */
    close(): void {
        if (typeof window !== "undefined") window.close();
    },
};

/** For tests: forget the back handlers. */
export function resetBackHandlers(): void {
    backStack.length = 0;
}

/** An installed app's appinfo (applicationManager/getAppInfo {id}): {appInfo: {...}}; not-found when it is not installed. */
export function appInfo(appId: string): Promise<LunaReply> {
    return guard(request("luna://com.webos.applicationManager/getAppInfo", { id: appId }));
}
