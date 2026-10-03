// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { dayLabel, dialable, formatDuration, formatNumber, formatTime, shortWhen } from "./format";

describe("formatNumber", () => {
    it("formats North American numbers as they are typed", () => {
        expect(formatNumber("408")).toBe("408");
        expect(formatNumber("4085")).toBe("408-5");
        expect(formatNumber("5550142")).toBe("555-0142");
        expect(formatNumber("40855501")).toBe("(408) 555-01");
        expect(formatNumber("4085550142")).toBe("(408) 555-0142");
        expect(formatNumber("14085550142")).toBe("1 (408) 555-0142");
        expect(formatNumber("+14085550142")).toBe("+1 (408) 555-0142");
        expect(formatNumber("+442071234567")).toBe("+442071234567");
    });
    it("leaves service codes alone", () => {
        expect(formatNumber("*86#")).toBe("*86#");
        expect(dialable("(408) 555-0142")).toBe("4085550142");
        expect(dialable("*86# x")).toBe("*86#");
    });
});

describe("times", () => {
    const now = new Date(2026, 8, 28, 15, 0).getTime();
    it("formats durations", () => {
        expect(formatDuration(7000)).toBe("0:07");
        expect(formatDuration(252000)).toBe("4:12");
        expect(formatDuration(3729000)).toBe("1:02:09");
    });
    it("formats clock times in 12 and 24 hours", () => {
        const t = new Date(2026, 8, 28, 9, 41).getTime();
        expect(formatTime(t, false)).toBe("9:41 AM");
        expect(formatTime(new Date(2026, 8, 28, 0, 5).getTime(), false)).toBe("12:05 AM");
        expect(formatTime(t, true)).toBe("09:41");
    });
    it("labels days", () => {
        expect(dayLabel(new Date(2026, 8, 28, 1).getTime(), now)).toBe("Today");
        expect(dayLabel(new Date(2026, 8, 27, 23).getTime(), now)).toBe("Yesterday");
        expect(dayLabel(new Date(2026, 8, 24, 12).getTime(), now)).toBe("Thursday");
        expect(dayLabel(new Date(2026, 7, 2).getTime(), now)).toBe("Aug 2");
        expect(shortWhen(new Date(2026, 8, 28, 14, 3).getTime(), now)).toMatch(/2:03 PM|14:03/);
    });
});
