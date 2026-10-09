// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Weather's logic against real Open-Meteo replies (apps/weather/fixtures,
// CC BY 4.0), without the network.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { describe as sky } from "./codes";
import {
    fetchForecast, forecastUrl, parseForecast, placeLine, roundCoord, searchPlaces, searchUrl, WeatherError, type Fetcher, type Place,
} from "./openmeteo";
import { addPlace, CURRENT_ID, DEFAULT_PREFS, freshness, load, movePlace, removePlace, save, STALE_MS } from "./store";
import { compass, dayLabel, effectiveUnits, hourLabel, IMPERIAL, METRIC, precip, regionOf, safeLocale, temp, unitsFor, wind } from "./units";

const fixture = (name: string) => JSON.parse(readFileSync(resolve(__dirname, "../../fixtures", name), "utf8"));
const reply = (body: unknown, status = 200): ReturnType<Fetcher> =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

function memory() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("units", () => {
    it("Automatic is the device's units (Settings > Language & Region > Units), whose own Automatic is the region's", () => {
        expect(effectiveUnits("auto", "metric", "en-US")).toEqual(METRIC);
        expect(effectiveUnits("auto", "imperial", "de-DE")).toEqual(IMPERIAL);
        expect(effectiveUnits("auto", "auto", "en-US")).toEqual(IMPERIAL);
        expect(effectiveUnits("auto", "auto", "de-DE")).toEqual(METRIC);
        expect(effectiveUnits("metric", "imperial", "en-US")).toEqual(METRIC);
    });
    it("follow the region", () => {
        expect(regionOf("en-US")).toBe("US");
        expect(regionOf("zh-Hans-CN")).toBe("CN");
        expect(regionOf("en")).toBe("");
        expect(safeLocale("en-US@posix")).toBe("en-US");
        expect(safeLocale("de_DE.UTF-8")).toBe("de-DE");
        expect(safeLocale("C")).toBe("en-US");
        expect(safeLocale(undefined)).toBe("en-US");
        expect(unitsFor("auto", "en-US")).toEqual(IMPERIAL);
        expect(unitsFor("auto", "de-DE")).toEqual(METRIC);
        expect(unitsFor("auto", "en-GB")).toEqual({ temp: "C", wind: "mph", precip: "mm" });
        expect(unitsFor("auto", undefined)).toEqual(METRIC);
        expect(unitsFor("metric", "en-US")).toEqual(METRIC);
        expect(unitsFor("imperial", "fr-FR")).toEqual(IMPERIAL);
    });

    it("convert and format", () => {
        expect(temp(23.1, METRIC)).toBe("23°");
        expect(temp(23.1, IMPERIAL)).toBe("74°");
        expect(temp(-0.4, METRIC)).toBe("0°");
        expect(temp(NaN, METRIC)).toBe("--");
        expect(wind(16.09, IMPERIAL)).toBe("10 mph");
        expect(wind(12.7, METRIC)).toBe("13 km/h");
        expect(precip(2.54, IMPERIAL)).toBe("0.10 in");
        expect(precip(0.25, METRIC)).toBe("0.3 mm");
        expect(compass(353)).toBe("N");
        expect(compass(72)).toBe("E");
        expect(compass(-90)).toBe("W");
    });

    it("label hours and days in the place's own time", () => {
        expect(hourLabel("2026-09-28T16:00", "HH12")).toBe("4 PM");
        expect(hourLabel("2026-09-29T00:00", "HH12")).toBe("12 AM");
        expect(hourLabel("2026-09-29T12:30", "HH12")).toBe("12:30 PM");
        expect(hourLabel("2026-09-28T07:00", "HH24")).toBe("07:00");
        expect(dayLabel("2026-09-28", "2026-09-28")).toBe("Today");
        expect(dayLabel("2026-09-29", "2026-09-28")).toBe("Tue");
    });
});

describe("weather codes", () => {
    it("describe WMO codes", () => {
        expect(sky(0)).toEqual({ text: "Clear", sky: "clear" });
        expect(sky(63)).toEqual({ text: "Rain", sky: "rain" });
        expect(sky(95).sky).toBe("storm");
        expect(sky(1234)).toEqual({ text: "", sky: "cloudy" });
    });
});

describe("Open-Meteo requests", () => {
    it("send coordinates rounded to about a kilometre, nothing else about the user", () => {
        expect(roundCoord(37.368834)).toBe(37.37);
        expect(roundCoord(-122.036349)).toBe(-122.04);
        const u = new URL(forecastUrl(37.368834, -122.036349));
        expect(u.origin).toBe("https://api.open-meteo.com");
        expect(u.pathname).toBe("/v1/forecast");
        expect(u.searchParams.get("latitude")).toBe("37.37");
        expect(u.searchParams.get("longitude")).toBe("-122.04");
        expect(u.searchParams.get("timezone")).toBe("auto");
        expect(u.searchParams.get("current")).toContain("weather_code");
        expect([...u.searchParams.keys()].sort()).toEqual(
            ["current", "daily", "forecast_days", "forecast_hours", "hourly", "latitude", "longitude", "timezone"]);
        expect(forecastUrl(1, 2, "https://wx.example.org/")).toMatch(/^https:\/\/wx\.example\.org\/v1\/forecast\?/);
        const s = new URL(searchUrl(" London ", "de"));
        expect(s.host).toBe("geocoding-api.open-meteo.com");
        expect(s.searchParams.get("name")).toBe("London");
        expect(s.searchParams.get("language")).toBe("de");
    });

    it("read a forecast: now, the next 24 hours, 7 days", () => {
        const f = parseForecast(fixture("forecast-sunnyvale.json"), 1000);
        expect(f.fetchedAt).toBe(1000);
        expect(f.timezone).toBe("America/Los_Angeles");
        expect(f.current).toMatchObject({ time: "2026-09-28T16:00", temp: 23.1, humidity: 50, code: 0, isDay: true, wind: 12.7, windDir: 353 });
        expect(f.hourly).toHaveLength(24);
        expect(f.hourly[0].time).toBe("2026-09-28T16:00");
        expect(f.daily).toHaveLength(7);
        expect(f.daily[0]).toMatchObject({ date: "2026-09-28", max: 23.1, min: 10.5, sunrise: "2026-09-28T07:01" });
        const l = parseForecast(fixture("forecast-london.json"), 0);
        expect(l.current.isDay).toBe(false);
        expect(l.hourly.some((h) => h.code === 51)).toBe(true);
    });

    it("start the hours at the current one", () => {
        const r = fixture("forecast-sunnyvale.json");
        r.current.time = "2026-09-28T18:15";
        const f = parseForecast(r, 0);
        expect(f.hourly[0].time).toBe("2026-09-28T18:00");
        expect(f.hourly.length).toBe(23);
    });

    it("pass on the server's reason for an error", async () => {
        expect(() => parseForecast({ error: true, reason: "Daily API request limit exceeded." }, 0)).toThrow("Daily API request limit exceeded.");
        expect(() => parseForecast({}, 0)).toThrow(WeatherError);
        const e = await fetchForecast({ latitude: 1, longitude: 2 }, { fetcher: () => reply({ error: true, reason: "Latitude must be in range" }, 400) })
            .catch((x) => x);
        expect(e).toBeInstanceOf(WeatherError);
        expect(e.kind).toBe("server");
        expect(e.message).toBe("Latitude must be in range");
        const off = await fetchForecast({ latitude: 1, longitude: 2 }, { fetcher: () => Promise.reject(new TypeError("Failed to fetch")) }).catch((x) => x);
        expect(off.kind).toBe("offline");
    });

    it("fetch a forecast and search places", async () => {
        const urls: string[] = [];
        const fetcher: Fetcher = (url) => {
            urls.push(url);
            return reply(url.includes("/v1/search") ? fixture("search-london.json") : fixture("forecast-london.json"));
        };
        const places = await searchPlaces("London", { fetcher });
        expect(places.map((p) => `${p.name}, ${p.admin}, ${p.countryCode}`).slice(0, 3))
            .toEqual(["London, England, GB", "London, Ontario, CA", "London, Ohio, US"]);
        expect(placeLine(places[0])).toBe("England, United Kingdom");
        const f = await fetchForecast(places[0], { fetcher, now: 5 });
        expect(f.current.temp).toBe(16.9);
        expect(urls[1]).toContain("latitude=51.51");
        expect(await searchPlaces("  ", { fetcher })).toEqual([]);
        expect(urls).toHaveLength(2);
    });
});

describe("saved places and the cache", () => {
    const sv: Place = { id: "5400075", name: "Sunnyvale", latitude: 37.36883, longitude: -122.03635 };
    const ld: Place = { id: "2643743", name: "London", latitude: 51.50853, longitude: -0.12574 };
    const here: Place = { id: CURRENT_ID, name: "Current Location", latitude: 37.37, longitude: -122.04 };

    it("add, dedupe, reorder and remove places; Current Location stays first", () => {
        let p = addPlace([], sv);
        p = addPlace(p, ld);
        p = addPlace(p, { ...ld, id: "other" });
        expect(p.map((x) => x.id)).toEqual(["5400075", "2643743"]);
        p = addPlace(p, here);
        expect(p[0].id).toBe(CURRENT_ID);
        p = movePlace(p, "2643743", -1);
        expect(p.map((x) => x.id)).toEqual([CURRENT_ID, "2643743", "5400075"]);
        expect(movePlace(p, CURRENT_ID, -1)).toEqual(p);
        expect(removePlace(p, "2643743").map((x) => x.id)).toEqual([CURRENT_ID, "5400075"]);
    });

    it("keep state, drop forecasts of removed places, survive junk", () => {
        const s = memory();
        expect(load(s)).toEqual({ places: [], selected: null, cache: {}, prefs: DEFAULT_PREFS });
        const f = parseForecast(fixture("forecast-sunnyvale.json"), 1);
        save({ places: [sv], selected: sv.id, cache: { [sv.id]: f, gone: f }, prefs: { ...DEFAULT_PREFS, units: "metric" } }, s);
        const back = load(s);
        expect(back.places).toEqual([sv]);
        expect(Object.keys(back.cache)).toEqual([sv.id]);
        expect(back.prefs.units).toBe("metric");
        s.setItem("org.webosphoenix.weather", JSON.stringify({ places: [{ id: 1 }, sv], prefs: { units: "kelvin", server: "javascript:alert(1)" } }));
        expect(load(s).places).toEqual([sv]);
        expect(load(s).prefs).toEqual(DEFAULT_PREFS);
        s.setItem("org.webosphoenix.weather", "}{");
        expect(load(s).places).toEqual([]);
    });

    it("know when a forecast is stale", () => {
        const f = parseForecast(fixture("forecast-sunnyvale.json"), 0);
        expect(freshness(undefined, 0)).toBe("none");
        expect(freshness(f, STALE_MS - 1)).toBe("fresh");
        expect(freshness(f, STALE_MS)).toBe("stale");
        expect(freshness(f, 4 * 24 * 3600 * 1000)).toBe("expired");
    });
});
