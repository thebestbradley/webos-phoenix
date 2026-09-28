// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Promise and subscription wrapper around PalmServiceBridge, the web
// runtime's handle on the Luna service bus. WebAppMgr provides it on a
// webOS OSE device; runtime/phoenix-runtime.js provides it (with simulated
// services) in phoenix-sim and a desktop browser.
//
//   const status = await call("luna://com.webos.service.wifi/getstatus", {});
//   const sub = subscribe("luna://com.webos.service.wifi/getstatus", {}, (r) => ...);
//   sub.cancel();

import type { LunaApi, LunaReply } from "./types";

/** The part of PalmServiceBridge this client uses. */
export interface ServiceBridge {
    onservicecallback: ((json: string) => void) | null;
    call(uri: string, json: string): unknown;
    cancel(): void;
}

export type BridgeFactory = () => ServiceBridge;

let factory: BridgeFactory | null = null;

/** Replace how bridges are made (tests, or hosts without PalmServiceBridge). null restores the default. */
export function setBridgeFactory(f: BridgeFactory | null): void {
    factory = f;
}

function makeBridge(uri: string): ServiceBridge {
    if (factory) return factory();
    const Ctor = (globalThis as { PalmServiceBridge?: new () => ServiceBridge }).PalmServiceBridge;
    if (typeof Ctor !== "function")
        throw new LunaError(uri, { returnValue: false, errorCode: -1, errorText: "PalmServiceBridge is not available" });
    return new Ctor();
}

/** A service replied with returnValue: false (or the call could not be made). */
export class LunaError extends Error {
    readonly uri: string;
    readonly errorCode: number;
    readonly errorText: string;
    readonly reply: LunaReply;

    constructor(uri: string, reply: LunaReply) {
        const text = reply.errorText ?? "Unknown error";
        super(`${uri}: ${text}`);
        this.name = "LunaError";
        this.uri = uri;
        this.errorCode = reply.errorCode ?? -1;
        this.errorText = text;
        this.reply = reply;
    }
}

export type LunaUri = keyof LunaApi;
export type LunaParams<U extends LunaUri> = LunaApi[U]["params"];
export type LunaResult<U extends LunaUri> = LunaApi[U]["result"] & LunaReply;

function parse(uri: string, json: string): LunaReply {
    try {
        const r = JSON.parse(json) as LunaReply;
        return r && typeof r === "object" ? r : { returnValue: false, errorText: "Bad reply" };
    } catch {
        return { returnValue: false, errorCode: -1, errorText: `Malformed reply from ${uri}` };
    }
}

// Bridges must stay referenced until they answer, or the web runtime may
// collect them and drop the callback.
const pending = new Set<ServiceBridge>();

export interface CallOptions {
    /** Reject with a LunaError if no reply arrives in time (default: wait forever). */
    timeoutMs?: number;
}

/** One request, one reply. Rejects with LunaError when returnValue is false. */
export function call<U extends LunaUri>(uri: U, params: LunaParams<U>, options?: CallOptions): Promise<LunaResult<U>>;
export function call(uri: string, params?: object, options?: CallOptions): Promise<LunaReply>;
export function call(uri: string, params: object = {}, options: CallOptions = {}): Promise<LunaReply> {
    return new Promise((resolve, reject) => {
        let bridge: ServiceBridge;
        try {
            bridge = makeBridge(uri);
        } catch (e) {
            reject(e);
            return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = () => {
            if (timer) clearTimeout(timer);
            bridge.onservicecallback = null;
            pending.delete(bridge);
        };
        bridge.onservicecallback = (json: string) => {
            done();
            const r = parse(uri, json);
            if (r.returnValue === false) reject(new LunaError(uri, r));
            else resolve(r);
        };
        if (options.timeoutMs) {
            timer = setTimeout(() => {
                done();
                try { bridge.cancel(); } catch { /* ignore */ }
                reject(new LunaError(uri, { returnValue: false, errorCode: -2, errorText: "Timed out" }));
            }, options.timeoutMs);
        }
        pending.add(bridge);
        bridge.call(uri, JSON.stringify(params));
    });
}

export interface Subscription {
    cancel(): void;
    readonly cancelled: boolean;
}

/**
 * Call with subscribe: true and receive every reply. Error replies go to
 * onError (the subscription stays open unless the service ends it).
 */
export function subscribe<U extends LunaUri>(
    uri: U, params: LunaParams<U>, onReply: (r: LunaResult<U>) => void, onError?: (e: LunaError) => void): Subscription;
export function subscribe(
    uri: string, params: object, onReply: (r: LunaReply) => void, onError?: (e: LunaError) => void): Subscription;
export function subscribe(
    uri: string, params: object, onReply: (r: LunaReply) => void, onError?: (e: LunaError) => void): Subscription {
    let cancelled = false;
    let bridge: ServiceBridge | null = null;
    try {
        bridge = makeBridge(uri);
    } catch (e) {
        queueMicrotask(() => onError?.(e as LunaError));
    }
    const sub: Subscription = {
        cancel() {
            if (cancelled) return;
            cancelled = true;
            if (bridge) {
                bridge.onservicecallback = null;
                pending.delete(bridge);
                try { bridge.cancel(); } catch { /* ignore */ }
            }
        },
        get cancelled() { return cancelled; },
    };
    if (bridge) {
        bridge.onservicecallback = (json: string) => {
            if (cancelled) return;
            const r = parse(uri, json);
            if (r.returnValue === false) onError?.(new LunaError(uri, r));
            else onReply(r);
        };
        pending.add(bridge);
        bridge.call(uri, JSON.stringify({ ...params, subscribe: true }));
    }
    return sub;
}
