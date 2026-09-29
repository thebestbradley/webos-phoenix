// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Glyphs drawn for Passwords (32x32, like @phoenix/ui's).

import type { ReactNode } from "react";

type P = { size?: number };

function Svg({ size = 24, children }: P & { children: ReactNode }) {
    return <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" fill="currentColor">{children}</svg>;
}

export const KeyIcon = (p: P) => (
    <Svg {...p}><path d="M11 6a8 8 0 0 1 7.6 10.5L29 27v3h-5v-3h-3v-3h-3l-2.6-2.6A8 8 0 1 1 11 6zm-2 5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" /></Svg>
);
export const FolderIcon = (p: P) => (
    <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h7l3 3h12a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>
);
export const LockIcon = (p: P) => (
    <Svg {...p}><path d="M16 3a7 7 0 0 1 7 7v4h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V16a2 2 0 0 1 2-2h1v-4a7 7 0 0 1 7-7zm0 3a4 4 0 0 0-4 4v4h8v-4a4 4 0 0 0-4-4zm0 12a2.5 2.5 0 0 0-1.3 4.6V25h2.6v-2.4A2.5 2.5 0 0 0 16 18z" /></Svg>
);
export const EyeIcon = ({ off, ...p }: P & { off?: boolean }) => (
    <Svg {...p}>
        <path d="M16 7c6.5 0 11.5 5 13 9-1.5 4-6.5 9-13 9S4.5 20 3 16c1.5-4 6.5-9 13-9zm0 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zm0 3a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" />
        {off && <path d="M5 4.5L27.5 27 25.5 29 3 6.5z" />}
    </Svg>
);
export const DiceIcon = (p: P) => (
    <Svg {...p}><path fillRule="evenodd" d="M7 4h18a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm3 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /></Svg>
);
export const DatabaseIcon = (p: P) => (
    <Svg {...p}><path d="M16 3c6.6 0 11 2 11 4.5v17C27 27 22.6 29 16 29S5 27 5 24.5v-17C5 5 9.4 3 16 3zm0 3C10.5 6 8 7.3 8 7.8S10.5 9.5 16 9.5s8-1.2 8-1.7S21.5 6 16 6zM8 12v4c0 .6 2.5 2 8 2s8-1.4 8-2v-4c-2 1-4.8 1.5-8 1.5S10 13 8 12zm0 8v4.3c0 .6 2.5 1.7 8 1.7s8-1.1 8-1.7V20c-2 1-4.8 1.5-8 1.5S10 21 8 20z" /></Svg>
);
