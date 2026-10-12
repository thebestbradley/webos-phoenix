// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text Assist > Shortcuts, Keyboard style, Number row and Keyboard size, and
// Sounds > the alert and notification tones, against the simulated system
// service: what is saved (x_palm_textinput, keyboardStyle, keyboardNumberRow,
// x_palm_virtualkeyboard_settings, alerttone, notificationtone) and what the
// runtime tells the shell's keyboard and sounds (systemStatus
// textAssist.shortcuts, tweaks.keyboardStyle, tweaks.numberRow, keyboardSize,
// alerttone, notificationtone).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { keyboardSize, numberRowShown, system, withKeyboardSettings } from "@phoenix/luna";
import { installedKeyboards, keyboardStyle, moveKeyboard, TextAssistPage } from "./TextAssist";
import { SoundsPage, toneOptions, SYSTEM_TONES } from "./Sounds";
import { shortcutProblem, textInputPrefs, withShortcut, withoutShortcut } from "./shortcuts";

type Runtime = { hostStatus(): Record<string, unknown>; applyHostStatus(st: object, opts?: object): void };
const runtime = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;
const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];
const lastStatus = () => [...hostMessages].reverse().find((m) => m.type === "systemStatus")?.payload ?? {};

beforeAll(() => {
    (window as unknown as Record<string, unknown>).phoenixHost = {
        postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }),
    };
    new Function(readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
    // The tone samples play through audiod's player; jsdom has no audio.
    (window as unknown as { __phoenixRuntime: { sounds: { createAudio: () => object } } }).__phoenixRuntime.sounds.createAudio =
        () => ({ addEventListener() {}, play: () => Promise.resolve(), pause() {} });
});

describe("shortcut rules", () => {
    const list = [{ shortcut: "omw", text: "On my way" }];
    it("takes one word of letters, not a second of the same name", () => {
        expect(shortcutProblem(list, "brb", "be right back")).toBeNull();
        expect(shortcutProblem(list, "don't", "do not")).toBeNull();
        expect(shortcutProblem(list, "", "x")).toMatch(/Type the shortcut/);
        expect(shortcutProblem(list, "gr8", "great")).toMatch(/letters only/);
        expect(shortcutProblem(list, "two words", "x")).toMatch(/letters only/);
        expect(shortcutProblem(list, "brb", "  ")).toMatch(/text/);
        expect(shortcutProblem(list, "OMW", "Oh my word")).toMatch(/already/);
        // Editing omw itself may keep its name.
        expect(shortcutProblem(list, "Omw", "On my way!", "omw")).toBeNull();
    });
    it("adds, replaces and removes, sorted", () => {
        const two = withShortcut(list, "brb", "be right back");
        expect(two.map((s) => s.shortcut)).toEqual(["brb", "omw"]);
        expect(withShortcut(two, "otw", "On the way", "omw").map((s) => s.shortcut)).toEqual(["brb", "otw"]);
        expect(withoutShortcut(two, "OMW")).toEqual([{ shortcut: "brb", text: "be right back" }]);
    });
    it("reads the preference with LunaSysMgr's defaults", () => {
        expect(textInputPrefs(undefined)).toEqual({ spellChecking: "autoCorrect", grammarChecking: "autoCorrect", shortcutChecking: "autoCorrect", shortcuts: [], userWords: [], removedWords: {} });
        expect(textInputPrefs({ shortcutChecking: "off", shortcuts: [{ shortcut: "a" }] }).shortcuts).toEqual([]);
    });
});

describe("Text Assist > Shortcuts", () => {
    it("adds, edits and deletes a shortcut, and the keyboard is told", async () => {
        render(<TextAssistPage />);
        fireEvent.click(await screen.findByTestId("ta-shortcut-add"));
        const dialog = await screen.findByTestId("ta-shortcut-dialog");
        fireEvent.change(within(dialog).getByTestId("ta-shortcut-field"), { target: { value: "gr8" } });
        fireEvent.change(within(dialog).getByTestId("ta-shortcut-text"), { target: { value: "great" } });
        fireEvent.click(within(dialog).getByTestId("ta-shortcut-save"));
        expect((await screen.findByTestId("ta-shortcut-error")).textContent).toMatch(/letters only/);
        fireEvent.change(within(dialog).getByTestId("ta-shortcut-field"), { target: { value: "omw" } });
        fireEvent.change(within(dialog).getByTestId("ta-shortcut-text"), { target: { value: "On my way" } });
        fireEvent.click(within(dialog).getByTestId("ta-shortcut-save"));
        await waitFor(() => expect(screen.getByTestId("ta-shortcut-omw").textContent).toContain("On my way"));
        expect(lastStatus().textAssist).toMatchObject({ shortcuts: { omw: "On my way" }, shortcutsOn: true });

        // Edit it.
        fireEvent.click(screen.getByTestId("ta-shortcut-omw"));
        const edit = await screen.findByTestId("ta-shortcut-dialog");
        fireEvent.change(within(edit).getByTestId("ta-shortcut-text"), { target: { value: "On my way!" } });
        fireEvent.click(within(edit).getByTestId("ta-shortcut-save"));
        await waitFor(() => expect(screen.getByTestId("ta-shortcut-omw").textContent).toContain("On my way!"));
        expect((runtime().hostStatus().textAssist as { shortcuts: object }).shortcuts).toEqual({ omw: "On my way!" });

        // Turn them off, then delete it.
        fireEvent.click(screen.getByTestId("ta-shortcuts-on"));
        await waitFor(() => expect((runtime().hostStatus().textAssist as { shortcutsOn: boolean }).shortcutsOn).toBe(false));
        fireEvent.click(screen.getByTestId("ta-shortcuts-on"));
        await waitFor(() => expect((runtime().hostStatus().textAssist as { shortcutsOn: boolean }).shortcutsOn).toBe(true));
        fireEvent.click(screen.getByTestId("ta-shortcut-omw"));
        fireEvent.click(within(await screen.findByTestId("ta-shortcut-dialog")).getByTestId("ta-shortcut-delete"));
        await waitFor(() => expect(screen.queryByTestId("ta-shortcut-omw")).toBeNull());
        expect((runtime().hostStatus().textAssist as { shortcuts: object }).shortcuts).toEqual({});
        // The original checks are kept.
        const p = await new Promise<Record<string, unknown>>((res) => {
            const sub = system.watchPreferences(["x_palm_textinput"], (v) => { sub.cancel(); res(v); });
        });
        expect(p.x_palm_textinput).toMatchObject({ spellChecking: "autoCorrect", shortcutChecking: "autoCorrect", shortcuts: [], userWords: [], removedWords: {} });
    });
});

describe("Text Assist > Keyboard style", () => {
    it("reads anything else as Automatic", () => {
        expect(keyboardStyle(undefined)).toBe("auto");
        expect(keyboardStyle("neon")).toBe("auto");
        expect(keyboardStyle("touchpad")).toBe("touchpad");
    });
    it("picks the look, and the shell's keyboard is told at once", async () => {
        render(<TextAssistPage />);
        const style = await screen.findByTestId("ta-keyboard-style");
        await waitFor(() => expect(style.textContent).toContain("Automatic (phone: black, tablet: TouchPad)"));
        fireEvent.click(style);
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(
            ["Automatic (phone: black, tablet: TouchPad)", "Black", "TouchPad"]);
        fireEvent.click(screen.getByRole("option", { name: "TouchPad" }));
        await waitFor(() => expect((lastStatus().tweaks as { keyboardStyle: string }).keyboardStyle).toBe("touchpad"));
        await waitFor(() => expect(screen.getByTestId("ta-keyboard-style").textContent).toContain("TouchPad"));
        fireEvent.click(screen.getByTestId("ta-keyboard-style"));
        fireEvent.click(screen.getByRole("option", { name: "Black" }));
        await waitFor(() => expect((runtime().hostStatus().tweaks as { keyboardStyle: string }).keyboardStyle).toBe("black"));
    });
});

describe("Text Assist > Keyboards (GAPS V7)", () => {
    it("reads the installed keyboards, known ones in order", () => {
        expect(installedKeyboards(undefined)).toEqual(["classic"]);
        expect(installedKeyboards(["phoenix", "nope", "classic", "phoenix"])).toEqual(["phoenix", "classic"]);
        expect(moveKeyboard(["classic", "phoenix"], "phoenix", 0)).toEqual(["phoenix", "classic"]);
    });
    it("installs the Phoenix keyboard, and the shell's keyboard is told", async () => {
        render(<TextAssistPage />);
        const phoenix = await screen.findByTestId("ta-whole-phoenix");
        expect(phoenix.getAttribute("aria-checked")).toBe("false");
        // OSE's: on a device only.
        expect((screen.getByTestId("ta-whole-ose") as HTMLButtonElement).disabled ||
               screen.getByTestId("ta-whole-ose").getAttribute("aria-disabled") === "true").toBe(true);
        fireEvent.click(phoenix);
        await waitFor(() => expect(runtime().hostStatus().installedKeyboards).toEqual(["classic", "phoenix"]));
        expect(runtime().hostStatus().keyboardId).toBe("classic");
        await waitFor(() => expect(screen.getByTestId("ta-whole-phoenix").getAttribute("aria-checked")).toBe("true"));
        // Removed again; the last one cannot be.
        fireEvent.click(screen.getByTestId("ta-whole-phoenix"));
        await waitFor(() => expect(runtime().hostStatus().installedKeyboards).toEqual(["classic"]));
    });
});

describe("Sounds > alert and notification tones", () => {
    it("offers the system tones and the ringtones, keeping an unknown current one", () => {
        expect(toneOptions(SYSTEM_TONES, { name: "x", fullPath: "/usr/palm/sounds/alert.wav" }).map((o) => o.label)).toEqual(["Alert", "Notification"]);
        expect(toneOptions(SYSTEM_TONES, { name: "Gone", fullPath: "/media/internal/ringtones/gone.mp3" }).map((o) => o.label))
            .toEqual(["Alert", "Notification", "Gone"]);
    });

    it("picks each tone, and the shell plays the one picked", async () => {
        render(<SoundsPage />);
        const alert = await screen.findByTestId("alerttone");
        await waitFor(() => expect(alert.textContent).toContain("Alert"));
        expect(screen.getByTestId("notificationtone").textContent).toContain("Notification");
        fireEvent.click(alert);
        // The ringtones are there too.
        await waitFor(() => expect(screen.getAllByRole("option").map((o) => o.textContent)).toContain("Phone"));
        fireEvent.click(screen.getAllByRole("option").find((o) => o.textContent === "Phone")!);
        await waitFor(() => expect(runtime().hostStatus().alerttone).toBe("/usr/palm/sounds/phone.wav"));
        expect(lastStatus().alerttone).toBe("/usr/palm/sounds/phone.wav");

        fireEvent.click(screen.getByTestId("notificationtone"));
        await waitFor(() => expect(screen.getAllByRole("option").map((o) => o.textContent)).toContain("Alert"));
        fireEvent.click(screen.getAllByRole("option").find((o) => o.textContent === "Alert")!);
        await waitFor(() => expect(runtime().hostStatus().notificationtone).toBe("/usr/palm/sounds/alert.wav"));
        await waitFor(() => expect(screen.getByTestId("notificationtone").textContent).toContain("Alert"));
        expect(screen.getByTestId("alerttone").textContent).toContain("Phone");
    });
});

describe("Text Assist > Hardware keyboard > Keyboard button", () => {
    it("is on by default; off and on again, the shell is told (tweaks.keyboardButton)", async () => {
        render(<TextAssistPage />);
        const toggle = await screen.findByTestId("ta-keyboardbutton");
        expect(screen.getByTestId("ta-keyboardbutton-row").textContent).toContain("With a hardware keyboard, a button that brings up the on-screen keyboard");
        await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
        expect((runtime().hostStatus().tweaks as { keyboardButton: boolean }).keyboardButton).toBe(true);
        fireEvent.click(toggle);
        await waitFor(() => expect((lastStatus().tweaks as { keyboardButton: boolean }).keyboardButton).toBe(false));
        await waitFor(() => expect(screen.getByTestId("ta-keyboardbutton").getAttribute("aria-checked")).toBe("false"));
        // The shell's hold menu turns it off the same way; turned on elsewhere, it shows here.
        await system.setPreferences({ keyboardButton: true });
        await waitFor(() => expect(screen.getByTestId("ta-keyboardbutton").getAttribute("aria-checked")).toBe("true"));
    });
});

describe("Text Assist > Number row (the owner, 12 October 2026)", () => {
    const toggle = () => screen.getByTestId("ta-numberrow");
    it("reads the setting, else the form factor's own", () => {
        expect(numberRowShown(undefined, true)).toBe(true);
        expect(numberRowShown(null, false)).toBe(false);
        expect(numberRowShown(false, true)).toBe(false);
        expect(numberRowShown(true, false)).toBe(true);
    });
    it("shows what this device's keyboard does, and flipping it writes the preference", async () => {
        await system.setPreferences({ keyboardNumberRow: null });
        runtime().applyHostStatus({ formFactor: "phone" });
        render(<TextAssistPage />);
        await screen.findByTestId("ta-numberrow");
        expect(screen.getByTestId("ta-numberrow-row").textContent).toContain("Numbers above the letters");
        // Unset: off on a phone, on on a tablet (the shell's layout, live).
        await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("false"));
        expect((runtime().hostStatus().tweaks as { numberRow: unknown }).numberRow).toBe(null);
        runtime().applyHostStatus({ formFactor: "tablet" });
        await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("true"));
        // Off on the tablet: an explicit false, for both form factors.
        fireEvent.click(toggle());
        await waitFor(() => expect((lastStatus().tweaks as { numberRow: unknown }).numberRow).toBe(false));
        await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("false"));
        runtime().applyHostStatus({ formFactor: "phone" });
        await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("false"));
        // On on the phone: true, the tablet's too.
        fireEvent.click(toggle());
        await waitFor(() => expect((lastStatus().tweaks as { numberRow: unknown }).numberRow).toBe(true));
        runtime().applyHostStatus({ formFactor: "tablet" });
        await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("true"));
        await system.setPreferences({ keyboardNumberRow: null });
        runtime().applyHostStatus({ formFactor: "phone" });
    });
});

describe("Text Assist > Keyboard size", () => {
    const settings = async () => (await new Promise<Record<string, unknown>>((res) => {
        const sub = system.watchPreferences(["x_palm_virtualkeyboard_settings"], (v) => { sub.cancel(); res(v); });
    })).x_palm_virtualkeyboard_settings;
    it("reads the original's \"keyboard size\", Medium otherwise", () => {
        expect(keyboardSize(undefined)).toBe(0);
        expect(keyboardSize(JSON.stringify({ layout: "qwerty", language: "en", "keyboard size": -2 }))).toBe(-2);
        expect(keyboardSize(JSON.stringify({ "keyboard size": 7 }))).toBe(1);
        expect(keyboardSize("{broken")).toBe(0);
        expect(JSON.parse(withKeyboardSettings(JSON.stringify({ layout: "azerty", language: "fr" }), { "keyboard size": 1 })))
            .toEqual({ layout: "azerty", language: "fr", "keyboard size": 1 });
    });
    it("is a tablet's only; picked here, the shell's keyboard is told; picked on the keyboard, it shows here", async () => {
        runtime().applyHostStatus({ formFactor: "phone" });
        render(<TextAssistPage />);
        await screen.findByTestId("ta-numberrow");
        // (jsdom's 1024 x 768 card is a tablet's until the shell's layout arrives.)
        await waitFor(() => expect(screen.queryByTestId("ta-keyboard-size")).toBeNull());
        runtime().applyHostStatus({ formFactor: "tablet" });
        const size = await screen.findByTestId("ta-keyboard-size");
        await waitFor(() => expect(size.textContent).toContain("Medium"));
        fireEvent.click(size);
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Extra Small", "Small", "Medium", "Large"]);
        fireEvent.click(screen.getByRole("option", { name: "Small" }));
        await waitFor(() => expect(lastStatus().keyboardSize).toBe(-1));
        expect(runtime().hostStatus().keyboardSize).toBe(-1);
        await waitFor(() => expect(screen.getByTestId("ta-keyboard-size").textContent).toContain("Small"));
        // The keyboard in use is kept beside it.
        expect(JSON.parse(String(await settings()))).toMatchObject({ "keyboard size": -1 });
        // The hide key's long press picks Large (the shell's systemStatus keyboardSize).
        runtime().applyHostStatus({ keyboardSize: 1 });
        await waitFor(() => expect(screen.getByTestId("ta-keyboard-size").textContent).toContain("Large"));
        expect(JSON.parse(String(await settings()))["keyboard size"]).toBe(1);
        // ... and the language key another keyboard: the size stays.
        runtime().applyHostStatus({ keyboard: { layout: "qwerty", language: "none" } });
        await waitFor(async () => expect(JSON.parse(String(await settings()))).toMatchObject({ language: "none", "keyboard size": 1 }));
        expect(runtime().hostStatus().keyboardSize).toBe(1);
        runtime().applyHostStatus({ keyboard: { layout: "qwerty", language: "en" }, keyboardSize: 0 });
        runtime().applyHostStatus({ formFactor: "phone" });
    });
});
