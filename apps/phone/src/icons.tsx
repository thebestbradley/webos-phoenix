// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Small line glyphs for the call controls and the call log. Palm's phone
// icons were not open-sourced; these are drawn to sit with the Enyo art.

import type { ReactNode } from "react";

function Svg({ children, size = 24 }: { children: ReactNode; size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
    );
}

export const Handset = ({ size }: { size?: number }) => (
    <Svg size={size}>
        <path fill="currentColor" stroke="none" d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" />
    </Svg>
);

/** The handset turned down: end call. */
export const HangUp = ({ size = 28 }: { size?: number }) => (
    <Svg size={size}>
        <path fill="currentColor" stroke="none" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a1 1 0 0 1-1.41-.02L.29 13.08a1 1 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.41l-2.48 2.47a1 1 0 0 1-1.41.02 11.3 11.3 0 0 0-2.67-1.85 1 1 0 0 1-.56-.9v-3.1A15 15 0 0 0 12 9z" />
    </Svg>
);

export const MicOff = () => (
    <Svg>
        <path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 10V5a3 3 0 0 0-5.9-.8" />
        <path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11 5.7M12 18v3" />
        <path d="M3 3l18 18" />
    </Svg>
);

export const Speaker = () => (
    <Svg>
        <path fill="currentColor" d="M4 9h3l5-4v14l-5-4H4z" />
        <path d="M15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12" />
    </Svg>
);

export const Keypad = () => (
    <Svg>
        {[5, 12, 19].flatMap((x) => [5, 11, 17].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill="currentColor" stroke="none" />))}
        <circle cx="12" cy="22" r="1.6" fill="currentColor" stroke="none" />
    </Svg>
);

export const Pause = () => (
    <Svg>
        <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
        <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </Svg>
);

/** Call log direction arrows. */
export const Incoming = () => <Svg size={18}><path d="M17 7L7 17M7 9v8h8" /></Svg>;
export const Outgoing = () => <Svg size={18}><path d="M7 17L17 7M9 7h8v8" /></Svg>;
export const Missed = () => <Svg size={18}><path d="M4 8l6 6 4-4 6 6M20 11v5h-5" /></Svg>;

export const Voicemail = () => (
    <Svg>
        <circle cx="6.5" cy="12" r="3.5" />
        <circle cx="17.5" cy="12" r="3.5" />
        <path d="M6.5 15.5h11" />
    </Svg>
);

export const Star = () => (
    <Svg size={18}>
        <path fill="currentColor" stroke="none" d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" />
    </Svg>
);
