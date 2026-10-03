// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Terminal's preferences, kept in the app's localStorage and shared by
// all its cards (a change in one reaches the others through the storage
// event): the shell for new sessions, text size, colour scheme, the extra
// keys row.

import type { ITheme } from "@xterm/xterm";
import { DEFAULT_SHELL, type ShellName } from "@phoenix/luna";

export type TextSize = "small" | "medium" | "large" | "xlarge";
export type SchemeId = "phoenix" | "paper" | "classic" | "solarized-dark" | "solarized-light" | "high-contrast";

export interface Prefs {
    shell: ShellName;
    textSize: TextSize;
    scheme: SchemeId;
    /** The row of Esc, Ctrl, Alt, Tab, arrows... above the keyboard. */
    extraKeys: boolean;
}

export const DEFAULT_PREFS: Prefs = { shell: DEFAULT_SHELL, textSize: "medium", scheme: "phoenix", extraKeys: true };

/** Font size in legacy pixels (the shell zooms cards to the screen). */
export const TEXT_SIZES: { value: TextSize; label: string; px: number }[] = [
    { value: "small", label: "Small", px: 10 },
    { value: "medium", label: "Medium", px: 12 },
    { value: "large", label: "Large", px: 14 },
    { value: "xlarge", label: "Extra Large", px: 17 },
];

export function fontPx(size: TextSize): number {
    return (TEXT_SIZES.find((s) => s.value === size) ?? TEXT_SIZES[1]).px;
}

/** One step larger or smaller (Ctrl+= / Ctrl+-), clamped. */
export function stepSize(size: TextSize, by: number): TextSize {
    const i = TEXT_SIZES.findIndex((s) => s.value === size);
    return TEXT_SIZES[Math.max(0, Math.min(TEXT_SIZES.length - 1, (i < 0 ? 1 : i) + by))].value;
}

// ANSI colours: black red green yellow blue magenta cyan white, then bright.
const TANGO = ["#2e3436", "#cc0000", "#4e9a06", "#c4a000", "#3465a4", "#75507b", "#06989a", "#d3d7cf",
               "#555753", "#ef2929", "#8ae234", "#fce94f", "#729fcf", "#ad7fa8", "#34e2e2", "#eeeeec"];
const SOLARIZED = ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
                   "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"];
const NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

function palette(colors: string[]): ITheme {
    const t: Record<string, string> = {};
    NAMES.forEach((n, i) => {
        t[n] = colors[i];
        t["bright" + n.charAt(0).toUpperCase() + n.slice(1)] = colors[i + 8];
    });
    return t as ITheme;
}

export interface Scheme {
    id: SchemeId;
    label: string;
    theme: ITheme;
}

export const SCHEMES: Scheme[] = [
    {
        // Light grey on the webOS charcoal, the cursor in the Heritage blue.
        id: "phoenix", label: "Phoenix",
        theme: { ...palette(TANGO), background: "#1f2023", foreground: "#dcdcd8", cursor: "#4aa3df", cursorAccent: "#1f2023",
                 selectionBackground: "#2d6c94aa" },
    },
    {
        // Dark on the Memos yellow.
        id: "paper", label: "Paper",
        theme: { ...palette(TANGO), background: "#f7e98f", foreground: "#3b3222", cursor: "#3b3222", cursorAccent: "#f7e98f",
                 selectionBackground: "#c9a93f88", white: "#8a8266", brightWhite: "#5c5540", yellow: "#8f6f00", brightYellow: "#a88400" },
    },
    {
        id: "classic", label: "Classic",
        theme: { ...palette(TANGO), background: "#000000", foreground: "#33ff33", cursor: "#33ff33", cursorAccent: "#000000",
                 selectionBackground: "#33ff3355" },
    },
    {
        id: "solarized-dark", label: "Solarized Dark",
        theme: { ...palette(SOLARIZED), background: "#002b36", foreground: "#839496", cursor: "#93a1a1", cursorAccent: "#002b36",
                 selectionBackground: "#073642" },
    },
    {
        id: "solarized-light", label: "Solarized Light",
        theme: { ...palette(SOLARIZED), background: "#fdf6e3", foreground: "#657b83", cursor: "#586e75", cursorAccent: "#fdf6e3",
                 selectionBackground: "#eee8d5" },
    },
    {
        id: "high-contrast", label: "High Contrast",
        theme: { ...palette(["#000000", "#ff5555", "#55ff55", "#ffff55", "#5599ff", "#ff55ff", "#55ffff", "#ffffff",
                             "#777777", "#ff8888", "#88ff88", "#ffff88", "#88bbff", "#ff88ff", "#88ffff", "#ffffff"]),
                 background: "#000000", foreground: "#ffffff", cursor: "#ffff00", cursorAccent: "#000000", selectionBackground: "#ffffff66" },
    },
];

export function schemeOf(id: SchemeId): Scheme {
    return SCHEMES.find((s) => s.id === id) ?? SCHEMES[0];
}

export const PREFS_KEY = "org.webosphoenix.terminal.prefs";
const SHELLS: ShellName[] = ["bash", "zsh", "fish", "sh"];

/** Stored prefs, with anything missing or unknown back at its default. */
export function parsePrefs(json: string | null): Prefs {
    let raw: Partial<Prefs> = {};
    try { raw = json ? JSON.parse(json) as Partial<Prefs> : {}; } catch { raw = {}; }
    return {
        shell: SHELLS.includes(raw.shell as ShellName) ? raw.shell as ShellName : DEFAULT_PREFS.shell,
        textSize: TEXT_SIZES.some((s) => s.value === raw.textSize) ? raw.textSize as TextSize : DEFAULT_PREFS.textSize,
        scheme: SCHEMES.some((s) => s.id === raw.scheme) ? raw.scheme as SchemeId : DEFAULT_PREFS.scheme,
        extraKeys: typeof raw.extraKeys === "boolean" ? raw.extraKeys : DEFAULT_PREFS.extraKeys,
    };
}

export function loadPrefs(): Prefs {
    try { return parsePrefs(localStorage.getItem(PREFS_KEY)); } catch { return { ...DEFAULT_PREFS }; }
}

export function savePrefs(p: Prefs): void {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}
