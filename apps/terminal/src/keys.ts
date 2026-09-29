// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Keys a phone keyboard does not have, and what they send to the shell.
//
// The extras row (docs/TERMINAL.md, "The keyboard") sits above whatever
// keyboard is up: Esc, sticky Ctrl and Alt, Tab, the arrows, | ~ / -, and
// on its other pages Home/End/PgUp/PgDn, brackets and the function keys.
// Ctrl and Alt are sticky like the keyboard's shift: tap once for the next
// key, tap again quickly to lock, tap a locked one to release it. They also
// apply to what the keyboard types next. WebOS Internals' Terminal (Preware,
// GPL, used as a reference only) mapped the same keys to its Gesture, Sym
// and Orange combinations; its "Non-Obvious Keys" page is our Keys help.

export type ModState = "off" | "once" | "locked";

/** Double tap within this to lock a modifier. */
export const LOCK_MS = 400;

/** The next state of a sticky modifier after a tap at time now (ms). */
export function tapModifier(state: ModState, lastTap: number, now: number): ModState {
    if (state === "off") return "once";
    if (state === "once") return now - lastTap <= LOCK_MS ? "locked" : "off";
    return "off";
}

/** After a key was sent: a one-shot modifier is used up. */
export function afterKey(state: ModState): ModState {
    return state === "once" ? "off" : state;
}

export interface Mods {
    ctrl: boolean;
    alt: boolean;
}

/** Ctrl with a character: the control character (Ctrl-C = \x03), or null if it has none. */
export function ctrlChar(ch: string): string | null {
    if (ch.length !== 1) return null;
    const c = ch.toLowerCase();
    if (c >= "a" && c <= "z") return String.fromCharCode(c.charCodeAt(0) - 96);
    const map: Record<string, number> = { "@": 0, " ": 0, "2": 0, "[": 27, "3": 27, "\\": 28, "4": 28, "]": 29, "5": 29,
                                          "^": 30, "6": 30, "_": 31, "-": 31, "7": 31, "?": 127, "8": 127, "/": 31 };
    return c in map ? String.fromCharCode(map[c]) : null;
}

/** What the keyboard typed (xterm.js onData), with the sticky modifiers applied. */
export function applyMods(data: string, mods: Mods): string {
    if (!mods.ctrl && !mods.alt) return data;
    let out = data;
    if (mods.ctrl && data.length === 1) out = ctrlChar(data) ?? data;
    if (mods.alt) out = "\x1b" + out;
    return out;
}

// xterm's modifier parameter: 1 + shift 1 + alt 2 + ctrl 4.
function modParam(m: Mods): number {
    return 1 + (m.alt ? 2 : 0) + (m.ctrl ? 4 : 0);
}

export type SpecialKey = "esc" | "tab" | "up" | "down" | "left" | "right" | "home" | "end" | "pgup" | "pgdn"
    | "ins" | "del" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12";

const ARROWS: Record<string, string> = { up: "A", down: "B", right: "C", left: "D", home: "H", end: "F" };
const TILDE: Record<string, number> = { ins: 2, del: 3, pgup: 5, pgdn: 6, f5: 15, f6: 17, f7: 18, f8: 19, f9: 20, f10: 21, f11: 23, f12: 24 };
const SS3: Record<string, string> = { f1: "P", f2: "Q", f3: "R", f4: "S" };

/**
 * The bytes a special key sends, as xterm does: arrows as ESC O x in
 * application cursor mode (vim, less) and ESC [ x otherwise; with Ctrl or
 * Alt, ESC [ 1 ; m x.
 */
export function keySequence(key: SpecialKey, mods: Mods, appCursor: boolean): string {
    const m = modParam(mods);
    if (key === "esc") return mods.alt ? "\x1b\x1b" : "\x1b";
    if (key === "tab") return mods.alt ? "\x1b\t" : "\t";
    if (key in ARROWS) {
        const f = ARROWS[key];
        if (m > 1) return `\x1b[1;${m}${f}`;
        return (appCursor ? "\x1bO" : "\x1b[") + f;
    }
    if (key in SS3) return m > 1 ? `\x1b[1;${m}${SS3[key]}` : "\x1bO" + SS3[key];
    const n = TILDE[key];
    return m > 1 ? `\x1b[${n};${m}~` : `\x1b[${n}~`;
}

export interface ExtraKey {
    id: string;
    label: string;
    /** A special key, a modifier, or plain text. */
    special?: SpecialKey;
    modifier?: "ctrl" | "alt";
    text?: string;
    /** Held down, it repeats (arrows, Tab...). */
    repeat?: boolean;
    title?: string;
}

const k = (id: string, label: string, rest: Partial<ExtraKey> = {}): ExtraKey => ({ id, label, ...rest });

/** The extras row's pages; swipe the row (or tap its page dots) for the next. */
export const EXTRA_PAGES: ExtraKey[][] = [
    [
        k("esc", "Esc", { special: "esc", title: "Escape" }),
        k("ctrl", "Ctrl", { modifier: "ctrl", title: "Control (tap twice to lock)" }),
        k("alt", "Alt", { modifier: "alt", title: "Alt (tap twice to lock)" }),
        k("tab", "Tab", { special: "tab", repeat: true }),
        k("left", "←", { special: "left", repeat: true, title: "Left" }),
        k("down", "↓", { special: "down", repeat: true, title: "Down" }),
        k("up", "↑", { special: "up", repeat: true, title: "Up" }),
        k("right", "→", { special: "right", repeat: true, title: "Right" }),
        k("pipe", "|", { text: "|" }),
        k("tilde", "~", { text: "~" }),
        k("slash", "/", { text: "/" }),
        k("dash", "-", { text: "-", repeat: true }),
    ],
    [
        k("esc2", "Esc", { special: "esc", title: "Escape" }),
        k("ctrl2", "Ctrl", { modifier: "ctrl" }),
        k("home", "Home", { special: "home" }),
        k("end", "End", { special: "end" }),
        k("pgup", "PgUp", { special: "pgup", repeat: true }),
        k("pgdn", "PgDn", { special: "pgdn", repeat: true }),
        k("lbrace", "{", { text: "{" }),
        k("rbrace", "}", { text: "}" }),
        k("lbracket", "[", { text: "[" }),
        k("rbracket", "]", { text: "]" }),
        k("backslash", "\\", { text: "\\" }),
        k("backtick", "`", { text: "`" }),
    ],
    [
        ...Array.from({ length: 12 }, (_, i) => k(`f${i + 1}`, `F${i + 1}`, { special: `f${i + 1}` as SpecialKey })),
    ],
];

/** Long press repeats with the keyboard's timings. */
export const REPEAT_DELAY_MS = 350;
export const REPEAT_INTERVAL_MS = 120;

// ---- Hardware keyboard shortcuts -------------------------------------------------------

export type Shortcut = "newSession" | "closeSession" | "copy" | "paste" | "biggerText" | "smallerText" | "resetText" | "clear";

export interface KeyLike {
    type: string;
    key: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    metaKey: boolean;
}

/**
 * Shortcuts the app takes before the shell sees the key. Everything else
 * (Ctrl-C, Ctrl-D, Alt-b ...) goes to the shell. Cmd works for Ctrl+Shift on
 * a Mac keyboard.
 */
export function shortcutFor(e: KeyLike): Shortcut | null {
    if (e.type !== "keydown") return null;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const cs = (e.ctrlKey && e.shiftKey && !e.altKey) || (e.metaKey && !e.ctrlKey && !e.altKey);
    if (cs) {
        switch (key) {
        case "t": case "n": return "newSession";
        case "w": return "closeSession";
        case "c": return "copy";
        case "v": return "paste";
        case "k": return "clear";
        }
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (key === "=" || key === "+") return "biggerText";
        if (key === "-" || key === "_") return e.shiftKey && !e.metaKey ? null : "smallerText";
        if (key === "0") return "resetText";
    }
    if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && key === "Insert") return "paste";
    return null;
}

/** The keys help (after the Preware Terminal's "Non-Obvious Keys"). */
export const KEY_HELP: [string, string][] = [
    ["Back gesture", "Esc (as the Preware Terminal did)"],
    ["Ctrl, then a key", "The control character: Ctrl, C interrupts"],
    ["Ctrl or Alt twice", "Locks it until tapped again"],
    ["Swipe the extra keys", "Home, End, PgUp, PgDn, brackets, F1-F12"],
    ["Hold an arrow", "Repeats"],
    ["Long press on text", "Selects a word; drag to select more"],
    ["Tap a link", "Opens it in Web (mailto: in Email)"],
    ["Ctrl+Shift+T", "New session (a new card)"],
    ["Ctrl+Shift+W", "Close this session"],
    ["Ctrl+Shift+C / V", "Copy / paste (also Shift+Insert)"],
    ["Ctrl+Shift+K", "Clear the scrollback"],
    ["Ctrl+= / Ctrl+- / Ctrl+0", "Larger / smaller / medium text"],
];

// ---- Selection helpers -------------------------------------------------------------------

const WORD = /[\w./~:@%+#?=&-]/;

/** The word around column col of a line: [start, length], or null on a space. */
export function wordAt(line: string, col: number): [number, number] | null {
    if (col < 0 || col >= line.length || !WORD.test(line.charAt(col))) return null;
    let s = col, e = col;
    while (s > 0 && WORD.test(line.charAt(s - 1))) --s;
    while (e < line.length - 1 && WORD.test(line.charAt(e + 1))) ++e;
    return [s, e - s + 1];
}

const URL_RE = /\b(?:https?:\/\/|mailto:|www\.)[^\s"'<>`]+/g;

/** The link under column col of a line, if any (trailing punctuation left out). */
export function linkAt(line: string, col: number): string | null {
    URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(line))) {
        const url = m[0].replace(/[.,;:!?)\]]+$/, "");
        if (col >= m.index && col < m.index + url.length) return url.startsWith("www.") ? "http://" + url : url;
    }
    return null;
}
