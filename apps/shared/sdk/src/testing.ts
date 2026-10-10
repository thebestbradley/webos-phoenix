// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// @phoenix/sdk/testing: a fake Luna bus for an app's unit tests (and the
// SDK's own). Answer methods with handlers, see what was asked, push
// replies to subscriptions.
//
//     const bus = installFakeBus();
//     bus.handle("luna://org.webosphoenix.share/open", () => ({ action: "cancel" }));
//     await share.open({ text: "hi" });
//     expect(bus.calls[0].params).toEqual({ text: "hi" });
//     bus.uninstall();

import { setTransport, type LunaReply, type Transport } from "./core";
import { setCapabilities, type Capability } from "./capabilities";

export interface FakeCall {
    uri: string;
    params: Record<string, unknown>;
    /** Whether it is (still) a subscription. */
    subscribed: boolean;
}

/** What a handler returns: a reply (returnValue: true is added), or a promise of one. Throwing makes an error reply. */
export type FakeHandler = (params: Record<string, unknown>, call: FakeCall) => object | Promise<object> | void;

export interface FakeBus extends Transport {
    /** Every request, oldest first. */
    readonly calls: FakeCall[];
    /** Answer a method (exact URI, or a RegExp). */
    handle(uri: string | RegExp, handler: FakeHandler): FakeBus;
    /** Reply to the open subscriptions of a method (exact URI). */
    emit(uri: string, reply: object): void;
    /** The calls to a method. */
    callsTo(uri: string): FakeCall[];
    /** Stop being the SDK's transport (and forget claimed capabilities). */
    uninstall(): void;
}

/**
 * A fake bus; unanswered methods fail as an unknown service does
 * ("Service does not exist", code "unavailable").
 */
export function createFakeBus(): FakeBus {
    const handlers: { match: string | RegExp; fn: FakeHandler }[] = [];
    const subs = new Map<string, Set<(r: LunaReply) => void>>();
    const calls: FakeCall[] = [];
    const bus: FakeBus = {
        name: "fake",
        calls,
        handle(uri, fn) { handlers.unshift({ match: uri, fn }); return bus; },
        callsTo(uri) { return calls.filter((c) => c.uri === uri); },
        emit(uri, reply) {
            for (const f of subs.get(uri) ?? []) f({ returnValue: true, ...reply });
        },
        uninstall() { setTransport(null); setCapabilities({}); },
        send(uri, params, onReply) {
            const call: FakeCall = { uri, params, subscribed: !!params.subscribe };
            calls.push(call);
            let live = true;
            const deliver = (r: LunaReply) => { if (live) onReply(r); };
            if (call.subscribed) {
                if (!subs.has(uri)) subs.set(uri, new Set());
                subs.get(uri)!.add(deliver);
            }
            const h = handlers.find((x) => typeof x.match === "string" ? x.match === uri : x.match.test(uri));
            queueMicrotask(async () => {
                if (!h) {
                    deliver({ returnValue: false, errorCode: -1, errorText: `Service does not exist: ${uri}` });
                    return;
                }
                try {
                    const r = await h.fn(params, call);
                    if (r !== undefined) deliver({ returnValue: true, ...(r as object) });
                } catch (e) {
                    const x = e as { errorCode?: number; errorText?: string; message?: string };
                    deliver({ returnValue: false, errorCode: x.errorCode ?? -1, errorText: x.errorText ?? x.message ?? String(e) });
                }
            });
            return () => {
                live = false;
                call.subscribed = false;
                subs.get(uri)?.delete(deliver);
            };
        },
    };
    return bus;
}

/**
 * A fake bus as the SDK's transport. `capabilities` claims has() answers
 * (default: Phoenix and the bus are here).
 */
export function installFakeBus(capabilities: Partial<Record<Capability, boolean>> = { bus: true, phoenix: true }): FakeBus {
    const bus = createFakeBus();
    setTransport(bus);
    setCapabilities(capabilities);
    return bus;
}
