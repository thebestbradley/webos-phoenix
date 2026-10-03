// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text Assist > Shortcuts and Sounds > the alert and notification tones,
// against the simulated system service: what is saved (x_palm_textinput,
// alerttone, notificationtone) and what the runtime tells the shell's
// keyboard and sounds (systemStatus textAssist.shortcuts, alerttone,
// notificationtone).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { system } from "@phoenix/luna";
import { TextAssistPage } from "./TextAssist";
import { SoundsPage, toneOptions, SYSTEM_TONES } from "./Sounds";
import { shortcutProblem, textInputPrefs, withShortcut, withoutShortcut } from "./shortcuts";

type Runtime = { hostStatus(): Record<string, unknown> };
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
        expect(textInputPrefs(undefined)).toEqual({ spellChecking: "autoCorrect", grammarChecking: "autoCorrect", shortcutChecking: "autoCorrect", shortcuts: [] });
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
        expect(p.x_palm_textinput).toMatchObject({ spellChecking: "autoCorrect", shortcutChecking: "autoCorrect", shortcuts: [] });
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
