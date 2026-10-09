// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device's units (units.ts), and the Assistant service's copy
// (apps/assistant/service/lib/region.js) agreeing with it.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { deviceUnits, IMPERIAL_REGIONS, regionOf, systemFor } from "./units";

describe("the device's units", () => {
    it("the setting, else the region: miles and °F in the US, metric elsewhere", () => {
        expect(systemFor("auto", "en-US")).toBe("imperial");
        expect(systemFor("auto", "en_US")).toBe("imperial");
        expect(systemFor("auto", "en-GB")).toBe("metric");
        expect(systemFor("auto", "de-DE")).toBe("metric");
        expect(systemFor("metric", "en-US")).toBe("metric");
        expect(systemFor("imperial", "ja-JP")).toBe("imperial");
        expect(deviceUnits({ localeInfo: { locales: { UI: "en-US", FMT: "de-DE" } } })).toBe("metric");
        expect(deviceUnits({ localeInfo: { locales: { UI: "en-US" } } })).toBe("imperial");
        expect(deviceUnits({ localeInfo: { locales: { FMT: "en-US" } }, measurementUnits: "metric" })).toBe("metric");
        expect(regionOf("zh-Hans-CN")).toBe("CN");
    });

    it("is the Assistant service's too", () => {
        const region = createRequire(import.meta.url)("../../../assistant/service/lib/region.js") as {
            IMPERIAL_REGIONS: string[]; systemFor(s: unknown, l: string): string; deviceUnits(s: object): string;
        };
        expect(region.IMPERIAL_REGIONS).toEqual(IMPERIAL_REGIONS);
        for (const [s, l] of [["auto", "en-US"], ["auto", "fr-FR"], ["metric", "en-US"], ["imperial", "en-GB"], [undefined, "es-MX"]])
            expect(region.systemFor(s, l as string)).toBe(systemFor(s, l as string));
        const s = { localeInfo: { locales: { UI: "en-US", FMT: "en-GB" } }, measurementUnits: "auto" };
        expect(region.deviceUnits(s)).toBe(deviceUnits(s as never));
    });
});
