// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Units and formatting. The forecast is always fetched in metric units
// (Open-Meteo's defaults: °C, km/h, mm) and cached that way; the app
// converts for display, so changing units needs no new request.
//
// "Automatic" follows the system region (com.webos.settingsservice
// localeInfo.locales.FMT, Settings > Language & Region): the US and a few
// others use °F and mph, the UK °C with mph, everyone else °C and km/h.
// Hours follow the system clock (systemservice timeFormat HH12 / HH24).

export type UnitsPref = "auto" | "metric" | "imperial";

export interface Units {
    temp: "C" | "F";
    wind: "kmh" | "mph";
    precip: "mm" | "in";
}

export const METRIC: Units = { temp: "C", wind: "kmh", precip: "mm" };
export const IMPERIAL: Units = { temp: "F", wind: "mph", precip: "in" };

/** Regions that use Fahrenheit (and miles): the US and its territories, Liberia, Myanmar, a few Pacific states. */
const FAHRENHEIT = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM", "LR", "MM", "BS", "BZ", "KY", "PW", "FM", "MH"]);
/** °C but road speeds in mph. */
const MPH = new Set(["GB", "IM", "JE", "GG"]);

/** A locale Intl accepts: POSIX forms ("en_US", "en-US@posix", "C") become BCP 47 or "en-US". */
export function safeLocale(locale: string | undefined): string {
    const tag = (locale ?? "").replace(/[@.].*$/, "").replace(/_/g, "-");
    try {
        return Intl.getCanonicalLocales(tag)[0] ?? "en-US";
    } catch {
        return "en-US";
    }
}

/** The region of a BCP 47 locale ("en-US" -> "US"); "" when there is none. */
export function regionOf(locale: string | undefined): string {
    const m = /^[a-z]{2,3}(?:[-_][A-Za-z]{4})?[-_]([A-Za-z]{2}|\d{3})\b/.exec(locale ?? "");
    return m ? m[1].toUpperCase() : "";
}

export function unitsFor(pref: UnitsPref, locale: string | undefined): Units {
    if (pref === "metric") return METRIC;
    if (pref === "imperial") return IMPERIAL;
    const r = regionOf(locale);
    if (FAHRENHEIT.has(r)) return IMPERIAL;
    if (MPH.has(r)) return { temp: "C", wind: "mph", precip: "mm" };
    return METRIC;
}

export const toF = (c: number) => c * 9 / 5 + 32;

/** "23°" (rounded, in the display unit). */
export function temp(c: number | undefined, u: Units): string {
    if (c === undefined || !Number.isFinite(c)) return "--";
    const v = Math.round(u.temp === "F" ? toF(c) : c);
    return `${Object.is(v, -0) ? 0 : v}°`;
}

export function wind(kmh: number | undefined, u: Units): string {
    if (kmh === undefined || !Number.isFinite(kmh)) return "--";
    return u.wind === "mph" ? `${Math.round(kmh / 1.609344)} mph` : `${Math.round(kmh)} km/h`;
}

export function precip(mm: number | undefined, u: Units): string {
    if (mm === undefined || !Number.isFinite(mm)) return "--";
    return u.precip === "in" ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** 353 -> "N". */
export function compass(deg: number | undefined): string {
    if (deg === undefined || !Number.isFinite(deg)) return "";
    return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/**
 * An hour of a local ISO time ("2026-09-28T16:00", the location's own
 * clock, as Open-Meteo returns with timezone=auto): "4 PM" or "16:00".
 */
export function hourLabel(iso: string, clock: "HH12" | "HH24"): string {
    const m = /T(\d{2}):(\d{2})/.exec(iso);
    if (!m) return "";
    const h = Number(m[1]);
    if (clock === "HH24") return `${m[1]}:${m[2]}`;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${m[2] === "00" ? "" : ":" + m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "Mon" for a local date ("2026-09-28"); "Today" for the first day. */
export function dayLabel(date: string, today: string, locale = "en-US"): string {
    if (date === today) return "Today";
    const [y, mo, d] = date.split("-").map(Number);
    if (!y || !mo || !d) return date;
    try {
        return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, mo - 1, d)));
    } catch {
        return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
    }
}
