// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { lessons, nextStep, passcodeProblem, previousStep, shownSteps, STEPS } from "./flow";

describe("First Use steps", () => {
    it("run from Welcome to All Set, and only the ends cannot be skipped", () => {
        expect(STEPS.map((s) => s.id)).toEqual(["welcome", "wifi", "hardware", "account", "restore", "datetime", "accounts", "passcode", "privacy", "tutorial", "done"]);
        expect(STEPS.filter((s) => !s.skippable).map((s) => s.id)).toEqual(["welcome", "done"]);
        expect(nextStep("welcome")).toBe("wifi");
        expect(nextStep("done")).toBe("done");
        expect(previousStep("welcome")).toBeNull();
        expect(previousStep("wifi")).toBe("welcome");
    });

    it("leave out Hardware when nothing needs firmware or a driver", () => {
        expect(nextStep("wifi")).toBe("hardware");
        expect(nextStep("wifi", ["hardware"])).toBe("account");
        expect(nextStep("wifi", ["hardware", "account"])).toBe("restore");
        expect(previousStep("restore", ["hardware", "account"])).toBe("wifi");
        expect(previousStep("restore")).toBe("account");
        expect(previousStep("account")).toBe("hardware");
        expect(shownSteps(["hardware"]).map((s) => s.id)).not.toContain("hardware");
        // A step that is showing still knows its neighbours.
        expect(nextStep("hardware", ["hardware"])).toBe("account");
        expect(nextStep("account", ["account"])).toBe("restore");
    });

    it("teach the back gesture on phones only", () => {
        expect(lessons(false).map((l) => l.id)).toContain("back");
        expect(lessons(true).map((l) => l.id)).not.toContain("back");
        expect(lessons(true)[0].text).toMatch(/bottom edge/);
        expect(lessons(false)[0].text).toMatch(/gesture area/);
    });

    it("check a new passcode", () => {
        expect(passcodeProblem("pin", "12", "12")).toMatch(/4 digits/);
        expect(passcodeProblem("pin", "1234", "1235")).toMatch(/do not match/);
        expect(passcodeProblem("pin", "1234", "1234")).toBeNull();
        expect(passcodeProblem("password", "abc", "abc")).toMatch(/4 characters/);
        expect(passcodeProblem("password", "abcd", "abcd")).toBeNull();
    });
});
