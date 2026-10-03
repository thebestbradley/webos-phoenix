// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    afterKey, applyMods, ctrlChar, EXTRA_PAGES, keySequence, linkAt, LOCK_MS, shortcutFor, tapModifier, wordAt, type KeyLike,
} from "./keys";
import { DEFAULT_PREFS, fontPx, parsePrefs, SCHEMES, stepSize } from "./prefs";

const none = { ctrl: false, alt: false };

describe("sticky modifiers", () => {
    it("tap once for the next key, twice quickly to lock, once more to release", () => {
        expect(tapModifier("off", 0, 1000)).toBe("once");
        expect(tapModifier("once", 1000, 1000 + LOCK_MS - 1)).toBe("locked");
        expect(tapModifier("once", 1000, 1000 + LOCK_MS + 500)).toBe("off");
        expect(tapModifier("locked", 0, 5000)).toBe("off");
        expect(afterKey("once")).toBe("off");
        expect(afterKey("locked")).toBe("locked");
    });

    it("turn typed characters into control characters and Alt into ESC", () => {
        expect(ctrlChar("c")).toBe("\x03");
        expect(ctrlChar("D")).toBe("\x04");
        expect(ctrlChar("[")).toBe("\x1b");
        expect(ctrlChar("?")).toBe("\x7f");
        expect(ctrlChar("é")).toBeNull();
        expect(applyMods("c", { ctrl: true, alt: false })).toBe("\x03");
        expect(applyMods("b", { ctrl: false, alt: true })).toBe("\x1bb");
        expect(applyMods("x", { ctrl: true, alt: true })).toBe("\x1b\x18");
        expect(applyMods("hello", { ctrl: true, alt: false })).toBe("hello");   // a paste is left alone
        expect(applyMods("q", none)).toBe("q");
    });
});

describe("special keys", () => {
    it("send what xterm sends", () => {
        expect(keySequence("esc", none, false)).toBe("\x1b");
        expect(keySequence("tab", none, false)).toBe("\t");
        expect(keySequence("up", none, false)).toBe("\x1b[A");
        expect(keySequence("up", none, true)).toBe("\x1bOA");   // application cursor mode (vim, less)
        expect(keySequence("left", { ctrl: true, alt: false }, true)).toBe("\x1b[1;5D");
        expect(keySequence("right", { ctrl: false, alt: true }, false)).toBe("\x1b[1;3C");
        expect(keySequence("home", none, false)).toBe("\x1b[H");
        expect(keySequence("pgdn", none, false)).toBe("\x1b[6~");
        expect(keySequence("f1", none, false)).toBe("\x1bOP");
        expect(keySequence("f12", none, false)).toBe("\x1b[24~");
        expect(keySequence("del", { ctrl: true, alt: false }, false)).toBe("\x1b[3;5~");
    });

    it("the first page of the extras row is the plan's", () => {
        expect(EXTRA_PAGES[0].map((k) => k.label)).toEqual(["Esc", "Ctrl", "Alt", "Tab", "←", "↓", "↑", "→", "|", "~", "/", "-"]);
        expect(EXTRA_PAGES[2]).toHaveLength(12);
    });
});

describe("hardware keyboard shortcuts", () => {
    const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike =>
        ({ type: "keydown", key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });

    it("takes Ctrl+Shift combinations and leaves Ctrl-C to the shell", () => {
        expect(shortcutFor(k("T", { ctrlKey: true, shiftKey: true }))).toBe("newSession");
        expect(shortcutFor(k("C", { ctrlKey: true, shiftKey: true }))).toBe("copy");
        expect(shortcutFor(k("V", { ctrlKey: true, shiftKey: true }))).toBe("paste");
        expect(shortcutFor(k("W", { ctrlKey: true, shiftKey: true }))).toBe("closeSession");
        expect(shortcutFor(k("c", { metaKey: true }))).toBe("copy");
        expect(shortcutFor(k("Insert", { shiftKey: true }))).toBe("paste");
        expect(shortcutFor(k("=", { ctrlKey: true }))).toBe("biggerText");
        expect(shortcutFor(k("-", { ctrlKey: true }))).toBe("smallerText");
        expect(shortcutFor(k("c", { ctrlKey: true }))).toBeNull();
        expect(shortcutFor(k("d", { ctrlKey: true }))).toBeNull();
        expect(shortcutFor({ ...k("T", { ctrlKey: true, shiftKey: true }), type: "keyup" })).toBeNull();
    });
});

describe("selection helpers", () => {
    it("find the word and the link under a finger", () => {
        const line = "see https://example.com/a?b=1. and /usr/bin ok";
        expect(wordAt(line, 0)).toEqual([0, 3]);
        expect(wordAt(line, 3)).toBeNull();
        expect(wordAt(line, 40)).toEqual([35, 8]);
        expect(linkAt(line, 10)).toBe("https://example.com/a?b=1");
        expect(linkAt(line, 1)).toBeNull();
        expect(linkAt("go to www.webos-internals.org", 12)).toBe("http://www.webos-internals.org");
        expect(linkAt("mailto:a@b.c", 3)).toBe("mailto:a@b.c");
    });
});

describe("preferences", () => {
    it("default to bash, medium text and the Phoenix scheme, and survive bad data", () => {
        expect(DEFAULT_PREFS).toEqual({ shell: "bash", textSize: "medium", scheme: "phoenix", extraKeys: true });
        expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
        expect(parsePrefs("not json")).toEqual(DEFAULT_PREFS);
        expect(parsePrefs(JSON.stringify({ shell: "zsh", textSize: "huge", scheme: "classic", extraKeys: false })))
            .toEqual({ shell: "zsh", textSize: "medium", scheme: "classic", extraKeys: false });
        expect(parsePrefs(JSON.stringify({ shell: "/bin/evil" })).shell).toBe("bash");
    });

    it("step the text size within its range", () => {
        expect(stepSize("medium", 1)).toBe("large");
        expect(stepSize("xlarge", 1)).toBe("xlarge");
        expect(stepSize("small", -1)).toBe("small");
        expect(fontPx("medium")).toBe(12);
    });

    it("have a full ANSI palette in every scheme", () => {
        for (const s of SCHEMES) {
            expect(s.theme.background).toMatch(/^#/);
            expect(s.theme.foreground).toMatch(/^#/);
            expect(s.theme.brightMagenta).toMatch(/^#/);
        }
    });
});
