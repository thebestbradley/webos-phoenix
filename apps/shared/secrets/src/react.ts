// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// React hooks over the auto-lock and the clipboard.

import { useEffect, useRef, useState } from "react";
import { AutoLock, type LockReason } from "./autolock";
import { secretClipboard } from "./clipboard";
import { importOtpKey, totp, totpCounter, type OtpParams } from "./otp";

/**
 * While `unlocked`, lock (call onLock) on screen lock, when the card is
 * hidden for `hiddenSeconds` (0: at once, -1: never) and after
 * `idleSeconds` without a touch (0: never).
 */
export function useAutoLock(unlocked: boolean, idleSeconds: number, hiddenSeconds: number, onLock: (reason: LockReason) => void): void {
    const cb = useRef(onLock);
    cb.current = onLock;
    const lock = useRef<AutoLock | null>(null);
    useEffect(() => {
        if (!unlocked) return;
        const l = new AutoLock({ idleSeconds, hiddenSeconds, onLock: (r) => cb.current(r) });
        lock.current = l;
        l.start();
        return () => { l.stop(); lock.current = null; };
        // Preferences are applied by the effect below without restarting.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [unlocked]);
    useEffect(() => { lock.current?.update({ idleSeconds, hiddenSeconds }); }, [idleSeconds, hiddenSeconds]);
}

/** Seconds until the clipboard is cleared (0 when nothing of ours is on it), ticking. */
export function useClipboardCountdown(): number {
    const left = () => {
        const at = secretClipboard.clearsAt;
        return at ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : 0;
    };
    const [secs, setSecs] = useState(left);
    useEffect(() => {
        const off = secretClipboard.onChange(() => setSecs(left()));
        const t = setInterval(() => setSecs(left()), 500);
        return () => { off(); clearInterval(t); };
    }, []);
    return secs;
}

/** The current time, updated every `ms` (for code countdowns). */
export function useNow(ms = 250): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), ms);
        return () => clearInterval(t);
    }, [ms]);
    return now;
}

export { CountdownRing } from "./ring";

/**
 * The current TOTP code for `params` (null while it is computed or when
 * params is null or not TOTP). The HMAC key is imported once per params.
 */
export function useTotpCode(params: OtpParams | null, now: number): string | null {
    const [key, setKey] = useState<CryptoKey | null>(null);
    const [code, setCode] = useState<{ step: number; code: string } | null>(null);
    useEffect(() => {
        setKey(null);
        setCode(null);
        if (!params || params.type !== "totp") return;
        let live = true;
        importOtpKey(params.secret, params.algorithm).then((k) => { if (live) setKey(k); }, () => {});
        return () => { live = false; };
    }, [params]);
    const step = params ? totpCounter(now, params.period) : 0;
    useEffect(() => {
        if (!key || !params) return;
        let live = true;
        totp(key, now, params.digits, params.period).then((c) => { if (live) setCode({ step, code: c }); }, () => {});
        return () => { live = false; };
        // Only when the time step changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, step]);
    return code && code.step === step ? code.code : null;
}
