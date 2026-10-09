// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text Assist > Personal Dictionary against the simulated system service:
// the words added and deleted (x_palm_textinput userWords, removedWords),
// what the runtime tells the shell's keyboard (systemStatus
// textAssist.userWords, removedWords), the words the keyboard learned
// (getSystemStatus learnedWords) and the keyboard's own "Add".

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { system } from "@phoenix/luna";
import { TextAssistPage } from "./TextAssist";
import { dictionaryEntries, withoutWord, withWord, wordProblem, REMOVED_MAX } from "./dictionary";

type TextAssistStatus = { userWords: string[]; removedWords: Record<string, number> };
type Runtime = { hostStatus(): Record<string, unknown>; applyHostStatus(st: Record<string, unknown>): void };
const runtime = () => (window as unknown as { __phoenixRuntime: Runtime }).__phoenixRuntime;
const textAssist = () => runtime().hostStatus().textAssist as TextAssistStatus;

beforeAll(() => {
    (window as unknown as Record<string, unknown>).phoenixHost = { postToHost: () => {} };
    new Function(readFileSync(resolve(__dirname, "../../../../runtime/phoenix-runtime.js"), "utf8")).call(window);
});

describe("dictionary rules", () => {
    it("takes one word of letters, once", () => {
        expect(wordProblem(["Phoenix"], "webOS")).toBeNull();
        expect(wordProblem(["Phoenix"], "y'all")).toBeNull();
        expect(wordProblem(["Phoenix"], " ")).toMatch(/Type the word/);
        expect(wordProblem(["Phoenix"], "two words")).toMatch(/letters only/);
        expect(wordProblem(["Phoenix"], "r2d2")).toMatch(/letters only/);
        expect(wordProblem(["Phoenix"], "PHOENIX")).toMatch(/already/);
    });
    it("lists the added and the learned words once, sorted, without the hidden ones", () => {
        expect(dictionaryEntries(["webOS", "Zed"], ["zed", "Kalt", "brb"], new Set(["brb"]))).toEqual([
            { word: "Kalt", learned: true }, { word: "webOS", learned: false }, { word: "Zed", learned: false }]);
    });
    it("deletes an added word and forgets a learned one, keeping the latest deletions", () => {
        const ti = withWord({ shortcuts: [] }, "webOS");
        expect(ti.userWords).toEqual(["webOS"]);
        const gone = withoutWord(ti, "WebOS", 5);
        expect(gone.userWords).toEqual([]);
        expect(gone.removedWords).toEqual({ webos: 5 });
        let many = gone;
        for (let i = 0; i < REMOVED_MAX + 5; ++i) many = withoutWord(many, `w${i}`, 10 + i);
        expect(Object.keys(many.removedWords!)).toHaveLength(REMOVED_MAX);
        expect(many.removedWords!.webos).toBeUndefined();
    });
});

describe("Text Assist > Personal Dictionary", () => {
    it("adds and deletes words, lists the learned ones, and the keyboard is told", async () => {
        // The keyboard learned two words.
        act(() => runtime().applyHostStatus({ learnedWords: ["Kalt", "brb"] }));
        render(<TextAssistPage />);
        fireEvent.click(await screen.findByTestId("ta-dictionary"));
        await screen.findByTestId("ta-dict-kalt");
        expect(screen.getByTestId("ta-dict-kalt").textContent).toContain("Learned");

        // Add one; a bad one is refused.
        fireEvent.click(screen.getByTestId("ta-dict-add"));
        const dialog = await screen.findByTestId("ta-dict-dialog");
        fireEvent.change(within(dialog).getByTestId("ta-dict-field"), { target: { value: "web OS" } });
        fireEvent.click(within(dialog).getByTestId("ta-dict-save"));
        expect((await screen.findByTestId("ta-dict-error")).textContent).toMatch(/letters only/);
        fireEvent.change(within(dialog).getByTestId("ta-dict-field"), { target: { value: "webOS" } });
        fireEvent.click(within(dialog).getByTestId("ta-dict-save"));
        await waitFor(() => expect(screen.getByTestId("ta-dict-webos").textContent).toContain("Added"));
        expect(textAssist().userWords).toEqual(["webOS"]);

        // Delete the learned word (tap, Delete Word): the keyboard forgets it.
        fireEvent.click(screen.getByTestId("ta-dict-brb"));
        fireEvent.click(within(await screen.findByTestId("ta-dict-word-dialog")).getByTestId("ta-dict-delete"));
        await waitFor(() => expect(screen.queryByTestId("ta-dict-brb")).toBeNull());
        await waitFor(() => expect(textAssist().removedWords.brb).toBeGreaterThan(0));

        // Swipe the added one across: Delete.
        const row = screen.getByTestId("ta-dict-swipe-webos").firstElementChild as HTMLElement;
        Object.defineProperty(row, "clientWidth", { value: 300 });
        fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 });
        fireEvent.pointerMove(window, { clientX: 200, clientY: 12 });
        fireEvent.pointerUp(window, { clientX: 250, clientY: 12 });
        fireEvent.click(await screen.findByTestId("ta-dict-swipe-webos-delete"));
        await waitFor(() => expect(screen.queryByTestId("ta-dict-webos")).toBeNull());
        await waitFor(() => expect(textAssist().userWords).toEqual([]));
        expect(textAssist().removedWords.webos).toBeGreaterThan(0);

        // Forget Learned Words, here now.
        fireEvent.click(screen.getByTestId("ta-forget"));
        fireEvent.click(within(await screen.findByTestId("ta-forget-dialog")).getByTestId("ta-forget-confirm"));
        await waitFor(() => expect(screen.getByTestId("ta-learned-note").textContent).toMatch(/forgotten/));
        expect(screen.queryByTestId("ta-dict-kalt")).toBeNull();
        expect((runtime().hostStatus().textAssist as { forgetWords: number }).forgetWords).toBeGreaterThan(0);
    });

    it("keeps the word the keyboard's Add sends, once", async () => {
        runtime().applyHostStatus({ dictionaryWordAdded: "Ngozi" });
        runtime().applyHostStatus({ dictionaryWordAdded: "ngozi" });
        runtime().applyHostStatus({ dictionaryWordAdded: "not one" });
        await waitFor(() => expect(textAssist().userWords).toEqual(["Ngozi"]));
        // Shortcuts saved afterwards keep the dictionary.
        const p = await new Promise<Record<string, unknown>>((res) => {
            const sub = system.watchPreferences(["x_palm_textinput"], (v) => { sub.cancel(); res(v); });
        });
        expect(p.x_palm_textinput).toMatchObject({ userWords: ["Ngozi"] });
    });
});
