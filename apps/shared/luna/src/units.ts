// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device's units, one setting for every app (Maps' distances, the
// Weather's temperatures, the Assistant's answers): Settings > Language &
// Region > Units, kept in com.webos.settingsservice as
// {measurementUnits: "auto" | "metric" | "imperial"} (Phoenix's key beside
// OSE's localeInfo). "auto" (the default) follows the region, as webOS
// did: miles and °F in the United States and the few others that use
// them, metric elsewhere. apps/assistant/service/lib/region.js is the
// same for the Assistant's service (luna.test checks that they agree).

import { subscribe, call, type Subscription } from "./bridge";
import type { SystemSettings } from "./types";

export type MeasurementSystem = "metric" | "imperial";
export type UnitsSetting = "auto" | MeasurementSystem;

export const UNITS_KEY = "measurementUnits";

/** Regions that use miles and °F: the US and its territories, Liberia, Myanmar, a few Pacific and Caribbean states. */
export const IMPERIAL_REGIONS = ["US", "PR", "GU", "VI", "AS", "MP", "UM", "LR", "MM", "BS", "BZ", "KY", "PW", "FM", "MH"];

/** The region of a locale ("en-US", "en_US" -> "US"); "" when there is none. */
export function regionOf(locale: string | undefined): string {
    const m = /^[a-z]{2,3}(?:[-_][A-Za-z]{4})?[-_]([A-Za-z]{2}|\d{3})\b/.exec(locale ?? "");
    return m ? m[1].toUpperCase() : "";
}

export function systemFor(setting: unknown, locale: string | undefined): MeasurementSystem {
    if (setting === "metric" || setting === "imperial") return setting;
    return IMPERIAL_REGIONS.includes(regionOf(locale)) ? "imperial" : "metric";
}

/** The units the device's settings say: the setting, else the region (localeInfo FMT, else UI). */
export function deviceUnits(s: SystemSettings | undefined): MeasurementSystem {
    return systemFor(s?.[UNITS_KEY], s?.localeInfo?.locales?.FMT ?? s?.localeInfo?.locales?.UI ?? (typeof navigator !== "undefined" ? navigator.language : "en-US"));
}

export const units = {
    /** The device's units now and whenever the setting or the region changes. */
    watch(cb: (u: MeasurementSystem, setting: UnitsSetting) => void, onError?: (e: unknown) => void): Subscription {
        return subscribe("luna://com.webos.settingsservice/getSystemSettings", { keys: ["localeInfo", UNITS_KEY], subscribe: true },
            (r) => { const s = (r as { settings?: SystemSettings }).settings ?? {}; cb(deviceUnits(s), (s[UNITS_KEY] as UnitsSetting) ?? "auto"); }, onError);
    },
    set(setting: UnitsSetting): Promise<unknown> {
        return call("luna://com.webos.settingsservice/setSystemSettings", { settings: { [UNITS_KEY]: setting } });
    },
};
