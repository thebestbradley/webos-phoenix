// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The countdown ring next to a one-time code: a circle that empties as the
// code's period runs out, amber for the last quarter, red for the last
// five seconds.

export function CountdownRing({ remaining, period, size = 26, testId }: { remaining: number; period: number; size?: number; testId?: string }) {
    const r = 10, c = 2 * Math.PI * r;
    const frac = Math.max(0, Math.min(1, remaining / period));
    const color = remaining <= 5 ? "#d2261f" : frac <= 0.25 ? "#e0a21f" : "#2f86d6";
    return (
        <svg className="sec-ring" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={`${Math.ceil(remaining)} seconds left`}
             data-testid={testId} data-remaining={Math.ceil(remaining)}>
            <circle cx="12" cy="12" r={r} fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="3" />
            <circle cx="12" cy="12" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 12 12)" />
        </svg>
    );
}
