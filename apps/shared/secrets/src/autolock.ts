// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// When an unlocked vault locks itself:
//
//   - the screen locks: com.palm.systemmanager getLockStatus {subscribe}
//     says locked (the shell tells the service when the lock screen comes
//     up; runtime/phoenix-runtime.js in the simulator)
//   - the card is minimized or hidden: the page's visibilityState turns
//     "hidden" (runtime/phoenix-runtime.js "Card activation" turns the same
//     event into Mojo.stageDeactivated), or the shell's "phoenixcardactivation"
//     event says the card lost the front; after a grace period the user
//     picks (0: at once)
//   - nobody has touched the card for the idle time
//
// Timers in hidden pages are throttled, so every check also compares clock
// times when the page comes back or is touched: a vault whose time ran out
// while hidden locks before the touch does anything.

import { deviceLock, type Subscription } from "@phoenix/luna";

export interface AutoLockOptions {
    /** Lock after this many seconds without a touch or key (0: never). */
    idleSeconds: number;
    /** Lock this many seconds after the card is hidden (0: at once, -1: never). */
    hiddenSeconds: number;
    /** Called once per unlock period, with why. */
    onLock: (reason: LockReason) => void;
    /** Clock (tests). */
    now?: () => number;
}

export type LockReason = "screen" | "hidden" | "idle" | "manual";

const ACTIVITY = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

/** The event phoenix-sim's shell sends a card that gains or loses the front: detail {active}. */
export const CARD_ACTIVATION_EVENT = "phoenixcardactivation";

export class AutoLock {
    private opts: AutoLockOptions;
    private lastActivity = 0;
    private hiddenAt = 0;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    private sub: Subscription | null = null;
    private running = false;

    constructor(opts: AutoLockOptions) {
        this.opts = opts;
    }

    private now() {
        return this.opts.now ? this.opts.now() : Date.now();
    }

    /** Start watching (on unlock). */
    start(): void {
        if (this.running) return;
        this.running = true;
        this.lastActivity = this.now();
        this.hiddenAt = document.visibilityState === "hidden" ? this.now() : 0;
        for (const e of ACTIVITY) window.addEventListener(e, this.onActivity, { capture: true, passive: true });
        document.addEventListener("visibilitychange", this.onVisibility);
        window.addEventListener(CARD_ACTIVATION_EVENT, this.onCardActivation);
        try {
            this.sub = deviceLock.watchLocked((locked) => { if (locked) this.lock("screen"); }, () => { /* no lock service: nothing to watch */ });
        } catch { this.sub = null; }
        this.armIdle();
    }

    /** Stop watching (on lock). */
    stop(): void {
        if (!this.running) return;
        this.running = false;
        for (const e of ACTIVITY) window.removeEventListener(e, this.onActivity, { capture: true });
        document.removeEventListener("visibilitychange", this.onVisibility);
        window.removeEventListener(CARD_ACTIVATION_EVENT, this.onCardActivation);
        this.sub?.cancel();
        this.sub = null;
        if (this.idleTimer) clearTimeout(this.idleTimer);
        if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
        this.idleTimer = this.hiddenTimer = null;
    }

    /** New preferences take effect at once. */
    update(opts: Partial<AutoLockOptions>): void {
        this.opts = { ...this.opts, ...opts };
        if (this.running) { this.armIdle(); this.checkExpired(); }
    }

    lock(reason: LockReason): void {
        if (!this.running) return;
        this.stop();
        this.opts.onLock(reason);
    }

    /** Lock now if a limit passed while timers could not run. Returns true if it locked. */
    checkExpired(): boolean {
        if (!this.running) return false;
        const t = this.now();
        const { idleSeconds, hiddenSeconds } = this.opts;
        if (idleSeconds > 0 && t - this.lastActivity >= idleSeconds * 1000) { this.lock("idle"); return true; }
        if (this.hiddenAt && hiddenSeconds >= 0 && t - this.hiddenAt >= hiddenSeconds * 1000) { this.lock("hidden"); return true; }
        return false;
    }

    private armIdle() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = null;
        const { idleSeconds } = this.opts;
        if (idleSeconds <= 0) return;
        const left = Math.max(0, this.lastActivity + idleSeconds * 1000 - this.now());
        this.idleTimer = setTimeout(() => { if (!this.checkExpired()) this.armIdle(); }, left + 50);
    }

    private onActivity = () => {
        if (this.checkExpired()) return;
        this.lastActivity = this.now();
        this.armIdle();
    };

    private setHidden(hidden: boolean) {
        if (hidden) {
            if (this.hiddenAt) return;
            this.hiddenAt = this.now();
            const { hiddenSeconds } = this.opts;
            if (hiddenSeconds === 0) { this.lock("hidden"); return; }
            if (hiddenSeconds > 0) this.hiddenTimer = setTimeout(() => this.checkExpired(), hiddenSeconds * 1000 + 50);
        } else {
            if (this.checkExpired()) return;
            this.hiddenAt = 0;
            if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
            this.hiddenTimer = null;
        }
    }

    private onVisibility = () => this.setHidden(document.visibilityState === "hidden");

    private onCardActivation = (e: Event) => {
        const active = (e as CustomEvent<{ active?: boolean }>).detail?.active;
        if (typeof active === "boolean") this.setHidden(!active);
    };
}
