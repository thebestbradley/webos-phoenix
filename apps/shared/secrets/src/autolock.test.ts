// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setBridgeFactory, type ServiceBridge } from "@phoenix/luna";
import { AutoLock, CARD_ACTIVATION_EVENT, type LockReason } from "./autolock";

let lockListener: ((locked: boolean) => void) | null = null;

beforeEach(() => {
    vi.useFakeTimers();
    lockListener = null;
    setBridgeFactory(() => {
        const b: ServiceBridge = {
            onservicecallback: null,
            call(uri: string) {
                if (uri.endsWith("/getLockStatus")) {
                    lockListener = (locked) => b.onservicecallback?.(JSON.stringify({ returnValue: true, locked }));
                    lockListener(false);
                }
            },
            cancel() { lockListener = null; },
        };
        return b;
    });
});
afterEach(() => {
    vi.useRealTimers();
    setBridgeFactory(null);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

function setVisibility(v: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
}

describe("AutoLock", () => {
    it("locks when the screen locks", () => {
        const reasons: LockReason[] = [];
        const l = new AutoLock({ idleSeconds: 0, hiddenSeconds: -1, onLock: (r) => reasons.push(r) });
        l.start();
        lockListener!(true);
        expect(reasons).toEqual(["screen"]);
        expect(lockListener).toBeNull();   // the subscription is cancelled once locked
    });

    it("locks at once when hidden, with no grace", () => {
        const reasons: LockReason[] = [];
        new AutoLock({ idleSeconds: 0, hiddenSeconds: 0, onLock: (r) => reasons.push(r) }).start();
        setVisibility("hidden");
        expect(reasons).toEqual(["hidden"]);
    });

    it("gives a grace period when hidden, and forgets it when shown in time", () => {
        const reasons: LockReason[] = [];
        new AutoLock({ idleSeconds: 0, hiddenSeconds: 30, onLock: (r) => reasons.push(r) }).start();
        setVisibility("hidden");
        vi.advanceTimersByTime(20_000);
        setVisibility("visible");
        vi.advanceTimersByTime(60_000);
        expect(reasons).toEqual([]);
        setVisibility("hidden");
        vi.advanceTimersByTime(31_000);
        expect(reasons).toEqual(["hidden"]);
    });

    it("follows the shell's card activation event", () => {
        const reasons: LockReason[] = [];
        new AutoLock({ idleSeconds: 0, hiddenSeconds: 0, onLock: (r) => reasons.push(r) }).start();
        window.dispatchEvent(new CustomEvent(CARD_ACTIVATION_EVENT, { detail: { active: true } }));
        expect(reasons).toEqual([]);
        window.dispatchEvent(new CustomEvent(CARD_ACTIVATION_EVENT, { detail: { active: false } }));
        expect(reasons).toEqual(["hidden"]);
    });

    it("locks after the idle time; touches restart it", () => {
        const reasons: LockReason[] = [];
        new AutoLock({ idleSeconds: 60, hiddenSeconds: -1, onLock: (r) => reasons.push(r) }).start();
        vi.advanceTimersByTime(50_000);
        window.dispatchEvent(new Event("pointerdown"));
        vi.advanceTimersByTime(50_000);
        expect(reasons).toEqual([]);
        vi.advanceTimersByTime(11_000);
        expect(reasons).toEqual(["idle"]);
    });

    it("locks on the first touch after timers could not run (a throttled hidden page)", () => {
        let t = 1_000_000;
        const reasons: LockReason[] = [];
        new AutoLock({ idleSeconds: 60, hiddenSeconds: -1, now: () => t, onLock: (r) => reasons.push(r) }).start();
        t += 120_000;   // the clock moved on, no timer fired
        window.dispatchEvent(new Event("keydown"));
        expect(reasons).toEqual(["idle"]);
    });

    it("locks only once, and not after stop()", () => {
        const onLock = vi.fn();
        const l = new AutoLock({ idleSeconds: 0, hiddenSeconds: 0, onLock });
        l.start();
        l.lock("manual");
        setVisibility("hidden");
        expect(onLock).toHaveBeenCalledTimes(1);
    });
});
