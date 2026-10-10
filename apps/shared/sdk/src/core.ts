// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The SDK's core: how requests reach the Luna service bus (the transport),
// typed errors, subscriptions that are both callbacks and async iterators,
// and the globals of the web runtime.
//
// The requests themselves go through @phoenix/luna, the client Phoenix's own
// apps use (apps/shared/luna/src/bridge.ts): its call() and subscribe(), and
// its service wrappers (shareSheet, filePicker, contacts, ...). The SDK puts
// its transport under them with luna's setBridgeFactory, so a custom
// transport (Enact's LS2Request, a test's fake bus) carries those too. The
// published build bundles the luna code it uses; @phoenix/luna stays
// internal to the workspace.

import { call as lunaCall, setBridgeFactory, subscribe as lunaSubscribe, LunaError, type ServiceBridge, type Subscription } from "../../luna/src/bridge";

/** Every Luna reply: returnValue, and on failure errorCode and errorText. */
export interface LunaReply {
    returnValue?: boolean;
    errorCode?: number;
    errorText?: string;
    subscribed?: boolean;
    [key: string]: unknown;
}

/**
 * How requests reach the bus. One method, the shape of PalmServiceBridge and
 * of Enact's LS2Request: send a request and get its replies (one, or every
 * one while `params.subscribe` is true) until the returned function cancels
 * it. Error replies (returnValue: false) come to onReply too.
 */
export interface Transport {
    /** For messages and has(): "palm" (PalmServiceBridge), "ls2" (Enact), "none", or the app's own name. */
    readonly name: string;
    send(uri: string, params: Record<string, unknown>, onReply: (reply: LunaReply) => void): () => void;
}

// ---- Errors ---------------------------------------------------------------------------

/** What went wrong, for code that decides what to do. */
export type PhoenixErrorCode =
    /** Not here: no Luna bus (a plain browser), or a Phoenix-only service on plain webOS OSE. */
    | "unavailable"
    /** The service refused this app (a permission it lacks, or the user said no). */
    | "permission-denied"
    /** No reply in time. */
    | "timeout"
    /** The service had no such thing (an id, a file). */
    | "not-found"
    /** Any other failure: errorCode and errorText say which. */
    | "failed";

/** A request failed: the service's errorCode and errorText, and what kind of failure it was. */
export class PhoenixError extends Error {
    readonly code: PhoenixErrorCode;
    /** The Luna URI asked, or the API ("share.open") for failures before any request. */
    readonly uri: string;
    readonly errorCode: number;
    readonly errorText: string;
    /** The whole reply. */
    readonly reply: LunaReply;

    constructor(uri: string, reply: LunaReply, code?: PhoenixErrorCode) {
        const text = reply.errorText ?? "Unknown error";
        super(`${uri}: ${text}`);
        this.name = "PhoenixError";
        this.uri = uri;
        this.errorCode = typeof reply.errorCode === "number" ? reply.errorCode : -1;
        this.errorText = text;
        this.reply = reply;
        this.code = code ?? classify(this.errorCode, text);
    }
}

const NO_BUS = "no Luna bus here (not running on webOS)";

function classify(errorCode: number, text: string): PhoenixErrorCode {
    if (text.includes(NO_BUS) || /service does not exist|unknown service|service not available|Unknown method|no such service/i.test(text))
        return "unavailable";
    if (/permission|denied|not allowed|not permitted|unauthori[sz]ed/i.test(text)) return "permission-denied";
    if (errorCode === -2 && /timed out/i.test(text)) return "timeout";
    if (/not found|no such|does not exist/i.test(text)) return "not-found";
    return "failed";
}

/** Any error as a PhoenixError (LunaErrors keep their reply). */
export function toPhoenixError(e: unknown, uri = ""): PhoenixError {
    if (e instanceof PhoenixError) return e;
    if (e instanceof LunaError) return new PhoenixError(e.uri, e.reply as LunaReply);
    if (e && typeof e === "object" && "returnValue" in e) return new PhoenixError(uri, e as LunaReply);
    return new PhoenixError(uri, { returnValue: false, errorCode: -1, errorText: e instanceof Error ? e.message : String(e) });
}

/** The promise, its rejection as a PhoenixError. */
export function guard<T>(p: Promise<T>, uri = ""): Promise<T> {
    return p.catch((e: unknown) => { throw toPhoenixError(e, uri); });
}

// ---- Warnings -------------------------------------------------------------------------

const warned = new Set<string>();

/** Says once per key what is missing and what happens instead. */
export function warnOnce(key: string, message: string): void {
    if (warned.has(key)) return;
    warned.add(key);
    // eslint-disable-next-line no-console
    console.warn(`[Phoenix SDK] ${message}`);
}

/** Tests: warn again. */
export function resetWarnings(): void {
    warned.clear();
}

// ---- Transports -----------------------------------------------------------------------

type BridgeCtor = new () => ServiceBridge;

function nativeBridge(): BridgeCtor | undefined {
    const g = globalThis as { PalmServiceBridge?: BridgeCtor; WebOSServiceBridge?: BridgeCtor };
    // WebOSServiceBridge: webOS OSE's newer name for the same object (Enact's LS2Request tries both).
    return typeof g.PalmServiceBridge === "function" ? g.PalmServiceBridge
        : typeof g.WebOSServiceBridge === "function" ? g.WebOSServiceBridge : undefined;
}

/** PalmServiceBridge (or OSE's WebOSServiceBridge) as a Transport. */
export const palmTransport: Transport = {
    name: "palm",
    send(uri, params, onReply) {
        const Ctor = nativeBridge();
        if (!Ctor) {
            queueMicrotask(() => onReply(noBusReply(uri)));
            return () => {};
        }
        const b = new Ctor();
        b.onservicecallback = (json: string) => {
            let r: LunaReply;
            try { r = JSON.parse(json) as LunaReply; } catch { r = { returnValue: false, errorCode: -1, errorText: `Malformed reply from ${uri}` }; }
            onReply(r);
        };
        b.call(uri, JSON.stringify(params));
        return () => { b.onservicecallback = null; try { b.cancel(); } catch { /* gone */ } };
    },
};

function noBusReply(uri: string): LunaReply {
    const service = /^(?:luna|palm):\/\/([^/]+)/.exec(uri)?.[1] ?? uri;
    warnOnce("bus:" + service, `${service}: ${NO_BUS}; its calls fail with PhoenixError code "unavailable". ` +
        "Use has() to check first, or setTransport() to give the SDK a bus (tests: @phoenix/sdk/testing).");
    return { returnValue: false, errorCode: -1, errorText: `${service}: ${NO_BUS}` };
}

/** Outside webOS: every request fails with code "unavailable", and says so once per service. */
export const noTransport: Transport = {
    name: "none",
    send(uri, _params, onReply) {
        let live = true;
        queueMicrotask(() => { if (live) onReply(noBusReply(uri)); });
        return () => { live = false; };
    },
};

/** A Transport as the ServiceBridge @phoenix/luna's calls use. */
class TransportBridge implements ServiceBridge {
    onservicecallback: ((json: string) => void) | null = null;
    private stop: (() => void) | null = null;
    constructor(private readonly t: Transport) {}
    call(uri: string, json: string): unknown {
        let params: Record<string, unknown> = {};
        try { params = JSON.parse(json) as Record<string, unknown>; } catch { /* {} */ }
        this.stop = this.t.send(uri, params, (r) => this.onservicecallback?.(JSON.stringify(r)));
        return true;
    }
    cancel(): void {
        this.stop?.();
        this.stop = null;
    }
}

let custom: Transport | null = null;

/** The transport in use. */
export function transport(): Transport {
    return custom ?? (nativeBridge() ? palmTransport : noTransport);
}

/**
 * Carry every request over this transport (Enact's LS2Request, a test's fake
 * bus, a native shell's own bridge). null goes back to the default:
 * PalmServiceBridge when the page has it, else none.
 */
export function setTransport(t: Transport | null): void {
    custom = t;
}

// Every request the SDK makes, and @phoenix/luna's wrappers it calls, go
// through transport(). With PalmServiceBridge and no custom transport this
// is luna's own default (a bridge per request).
setBridgeFactory(() => {
    const t = transport();
    if (t === palmTransport) return new (nativeBridge() as BridgeCtor)();
    return new TransportBridge(t);
});

// ---- Requests ---------------------------------------------------------------------------

export interface RequestOptions {
    /** Fail with code "timeout" when no reply comes in time (default: wait). */
    timeoutMs?: number;
}

/**
 * Any Luna method: one request, one reply. Rejects with a PhoenixError when
 * the service answers returnValue: false, or there is no bus.
 *
 *     const info = await request("luna://com.webos.service.systemservice/osInfo/query", {});
 */
export function request<T extends object = LunaReply>(uri: string, params: object = {}, options: RequestOptions = {}): Promise<T & LunaReply> {
    return guard(lunaCall(uri, params, options) as Promise<T & LunaReply>, uri);
}

// ---- Subscriptions ------------------------------------------------------------------------

/**
 * A subscription: the values come to the callback given, and to every
 * `for await` loop over it. cancel() ends it (and ends the loops).
 *
 *     const w = location.watch((fix) => show(fix));
 *     ...
 *     w.cancel();
 *
 *     for await (const fix of location.watch()) { ...; if (done) break; }
 *
 * An error reply goes to onError and the subscription stays open (Luna
 * services may answer again); in a loop it ends the loop with a throw.
 */
export interface Watch<T> extends AsyncIterable<T> {
    cancel(): void;
    readonly cancelled: boolean;
    /** The latest value, if any came yet. */
    readonly latest: T | undefined;
}

export type OnValue<T> = (value: T) => void;
export type OnError = (error: PhoenixError) => void;

/** A Watch over a start function that gives callbacks to a subscription. */
export function makeWatch<T>(
    start: (onValue: (v: T) => void, onError: (e: unknown) => void) => { cancel(): void } | null,
    onValue?: OnValue<T>,
    onError?: OnError,
): Watch<T> {
    let cancelled = false;
    let latest: T | undefined;
    type Waiter = { resolve: (r: IteratorResult<T>) => void; reject: (e: unknown) => void };
    const loops = new Set<{ queue: T[]; waiting: Waiter | null; error: PhoenixError | null; done: boolean }>();
    let sub: { cancel(): void } | null = null;

    const finish = () => {
        for (const l of loops) {
            l.done = true;
            l.waiting?.resolve({ value: undefined, done: true });
            l.waiting = null;
        }
    };
    const w: Watch<T> = {
        cancel() {
            if (cancelled) return;
            cancelled = true;
            sub?.cancel();
            finish();
        },
        get cancelled() { return cancelled; },
        get latest() { return latest; },
        [Symbol.asyncIterator](): AsyncIterator<T> {
            const loop = { queue: [] as T[], waiting: null as Waiter | null, error: null as PhoenixError | null, done: cancelled };
            if (latest !== undefined) loop.queue.push(latest);
            loops.add(loop);
            return {
                next() {
                    if (loop.queue.length) return Promise.resolve({ value: loop.queue.shift() as T, done: false });
                    if (loop.error) { const e = loop.error; loop.error = null; loop.done = true; loops.delete(loop); return Promise.reject(e); }
                    if (loop.done) return Promise.resolve({ value: undefined, done: true });
                    return new Promise((resolve, reject) => { loop.waiting = { resolve, reject }; });
                },
                return() {
                    loop.done = true;
                    loops.delete(loop);
                    // The last loop gone and no callback: nobody listens any more.
                    if (!loops.size && !onValue) w.cancel();
                    return Promise.resolve({ value: undefined, done: true });
                },
            };
        },
    };
    sub = start(
        (v) => {
            if (cancelled) return;
            latest = v;
            onValue?.(v);
            for (const l of loops) {
                if (l.waiting) { const r = l.waiting; l.waiting = null; r.resolve({ value: v, done: false }); }
                else l.queue.push(v);
            }
        },
        (e) => {
            if (cancelled) return;
            const err = toPhoenixError(e);
            onError?.(err);
            for (const l of [...loops]) {
                if (l.waiting) { const r = l.waiting; l.waiting = null; l.done = true; loops.delete(l); r.reject(err); }
                else l.error = err;
            }
        },
    );
    if (cancelled) sub?.cancel();
    return w;
}

/** A Watch from one of @phoenix/luna's subscriptions (luna's watchX(cb, onError)). */
export function watchLuna<T>(open: (cb: (v: T) => void, onError: (e: LunaError) => void) => Subscription, onValue?: OnValue<T>, onError?: OnError): Watch<T> {
    return makeWatch<T>((v, e) => open(v, e), onValue, onError);
}

/**
 * Any Luna method with subscribe: true.
 *
 *     subscribeTo("luna://com.webos.service.connectionmanager/getstatus", {}, (r) => ...);
 */
export function subscribeTo<T extends object = LunaReply>(uri: string, params: object = {}, onValue?: OnValue<T & LunaReply>, onError?: OnError): Watch<T & LunaReply> {
    return makeWatch<T & LunaReply>((v, e) => lunaSubscribe(uri, params, (r) => v(r as T & LunaReply), e), onValue, onError);
}

// ---- The web runtime's globals ------------------------------------------------------------

/** The parts of PalmSystem (WebAppMgr's, or the Phoenix runtime's) the SDK uses. */
export interface PalmSystemLike {
    identifier?: string;
    appIdentifier?: string;
    launchParams?: string;
    locale?: string;
    timeFormat?: string;
    deviceInfo?: string;
    isActivated?: () => boolean;
    stageReady?: () => void;
    activate?: () => void;
    deactivate?: () => void;
    keepAlive?: (on?: boolean) => void;
    setWindowOrientation?: (o: string) => void;
    enableFullScreenMode?: (on: boolean) => void;
    setWindowProperties?: (p: object) => void;
    addBannerMessage?: (msg: string, params: string, icon?: string, soundClass?: string, soundFile?: string, duration?: number) => string;
    removeBannerMessage?: (id: string) => void;
    clearBannerMessages?: () => void;
    playSoundNotification?: (soundClass: string, soundFile?: string, duration?: number) => void;
}

/** The Phoenix runtime (runtime/phoenix-runtime.js), in the simulator and on a device. */
export interface PhoenixRuntimeLike {
    onDevice?: boolean;
    editState?: () => { canSelectAll: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean };
    edit?: (action: "selectAll" | "cut" | "copy" | "paste") => boolean;
    share?: (content: object) => Promise<unknown>;
    openAppMenu?: () => boolean;
}

export function palmSystem(): PalmSystemLike | undefined {
    return (globalThis as { PalmSystem?: PalmSystemLike }).PalmSystem;
}

export function phoenixRuntime(): PhoenixRuntimeLike | undefined {
    return (globalThis as { __phoenixRuntime?: PhoenixRuntimeLike }).__phoenixRuntime;
}

/** The shell's own messages (phoenix-sim; runtime/phoenix-runtime.js host.postToHost). */
export function phoenixHost(): { postToHost(type: string, payload: object): void } | undefined {
    return (globalThis as { phoenixHost?: { postToHost(type: string, payload: object): void } }).phoenixHost;
}

export function hasDocument(): boolean {
    return typeof document !== "undefined";
}
