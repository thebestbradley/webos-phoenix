// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Open-Meteo (https://open-meteo.com): forecasts and place search, free
// and without an API key. Data CC BY 4.0: the app credits "Weather data by
// Open-Meteo.com" with a link, as the licence asks.
//
// Terms (https://open-meteo.com/en/terms, September 2026): the free API is
// for non-commercial use, fewer than 10,000 calls a day, 5,000 an hour and
// 600 a minute; an app with subscriptions or advertising, or a commercial
// product, needs a paid plan or its own Open-Meteo server (the server is
// open source, AGPL-3.0). Each device calls the API itself: one forecast
// per saved place when it is older than 30 minutes, or when the user
// refreshes. The server can be changed in Preferences.
//
// What is sent (docs/APP-RUNTIME.md, Weather):
//   forecast  latitude and longitude rounded to 2 decimals (about 1 km),
//             the list of variables below, timezone=auto
//   search    the typed place name, count=10, the UI language
// and, as with any request, the device's IP address (Open-Meteo keeps web
// server logs, which may hold coordinates, for 90 days and shares them with
// no one, per its terms). No API key, account, cookie or device id.

export const DEFAULT_SERVER = "https://api.open-meteo.com";
export const GEOCODING_SERVER = "https://geocoding-api.open-meteo.com";
export const ATTRIBUTION_URL = "https://open-meteo.com/";

export const CURRENT_VARS = ["temperature_2m", "relative_humidity_2m", "apparent_temperature", "is_day", "precipitation",
    "weather_code", "wind_speed_10m", "wind_direction_10m"];
export const HOURLY_VARS = ["temperature_2m", "precipitation_probability", "weather_code", "is_day"];
export const DAILY_VARS = ["weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_probability_max", "sunrise", "sunset"];

/** Coordinates sent to the server: 2 decimals, about 1.1 km. */
export const roundCoord = (x: number) => Math.round(x * 100) / 100;

export function forecastUrl(latitude: number, longitude: number, server = DEFAULT_SERVER): string {
    const q = new URLSearchParams({
        latitude: String(roundCoord(latitude)),
        longitude: String(roundCoord(longitude)),
        current: CURRENT_VARS.join(","),
        hourly: HOURLY_VARS.join(","),
        daily: DAILY_VARS.join(","),
        timezone: "auto",
        forecast_days: "7",
        forecast_hours: "25",
    });
    return `${server.replace(/\/+$/, "")}/v1/forecast?${q.toString().replace(/%2C/g, ",")}`;
}

export function searchUrl(name: string, language = "en", server = GEOCODING_SERVER): string {
    const q = new URLSearchParams({ name: name.trim(), count: "10", language, format: "json" });
    return `${server.replace(/\/+$/, "")}/v1/search?${q.toString()}`;
}

// ---- The model ----------------------------------------------------------------------------

export interface Current {
    /** Local time at the place, "2026-09-28T16:00". */
    time: string;
    /** °C */
    temp: number;
    feels: number;
    /** % */
    humidity: number;
    code: number;
    isDay: boolean;
    /** km/h */
    wind: number;
    /** degrees */
    windDir: number;
    /** mm in the last 15 minutes */
    precip: number;
}

export interface Hour {
    time: string;
    temp: number;
    code: number;
    isDay: boolean;
    /** % */
    precipProb: number;
}

export interface Day {
    /** "2026-09-28" */
    date: string;
    code: number;
    max: number;
    min: number;
    precipProb: number;
    sunrise: string;
    sunset: string;
}

export interface Forecast {
    /** ms since the epoch, when it was fetched. */
    fetchedAt: number;
    timezone: string;
    utcOffsetSeconds: number;
    current: Current;
    /** The next 24 hours from the current one. */
    hourly: Hour[];
    /** 7 days from today (the place's today). */
    daily: Day[];
}

export class WeatherError extends Error {
    /** "offline": no answer; "server": an error reply (reason from Open-Meteo); "bad": an answer we cannot read. */
    constructor(readonly kind: "offline" | "server" | "bad", message: string) {
        super(message);
        this.name = "WeatherError";
    }
}

type Json = Record<string, unknown>;
const num = (v: unknown, fallback = NaN) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const arr = (o: unknown, k: string): unknown[] => {
    const v = (o as Json | undefined)?.[k];
    return Array.isArray(v) ? v : [];
};

/** An Open-Meteo forecast reply -> Forecast. Throws WeatherError("bad") when it is not one. */
export function parseForecast(r: unknown, fetchedAt: number): Forecast {
    const o = r as Json;
    if (!o || typeof o !== "object") throw new WeatherError("bad", "The weather service sent something unreadable.");
    if (o.error) throw new WeatherError("server", String(o.reason ?? "The weather service refused the request."));
    const c = o.current as Json | undefined;
    if (!c || typeof c.time !== "string") throw new WeatherError("bad", "The forecast has no current conditions.");
    const current: Current = {
        time: c.time,
        temp: num(c.temperature_2m),
        feels: num(c.apparent_temperature),
        humidity: num(c.relative_humidity_2m),
        code: num(c.weather_code, -1),
        isDay: c.is_day !== 0,
        wind: num(c.wind_speed_10m),
        windDir: num(c.wind_direction_10m),
        precip: num(c.precipitation, 0),
    };
    const h = o.hourly;
    const times = arr(h, "time") as string[];
    const hourStart = current.time.slice(0, 13);   // "2026-09-28T16"
    let first = times.findIndex((t) => typeof t === "string" && t.slice(0, 13) >= hourStart);
    if (first < 0) first = times.length;
    const hourly: Hour[] = times.slice(first, first + 24).map((time, j) => {
        const i = first + j;
        return {
            time,
            temp: num(arr(h, "temperature_2m")[i]),
            code: num(arr(h, "weather_code")[i], -1),
            isDay: arr(h, "is_day")[i] !== 0,
            precipProb: num(arr(h, "precipitation_probability")[i], 0),
        };
    });
    const d = o.daily;
    const daily: Day[] = (arr(d, "time") as string[]).map((date, i) => ({
        date,
        code: num(arr(d, "weather_code")[i], -1),
        max: num(arr(d, "temperature_2m_max")[i]),
        min: num(arr(d, "temperature_2m_min")[i]),
        precipProb: num(arr(d, "precipitation_probability_max")[i], 0),
        sunrise: String(arr(d, "sunrise")[i] ?? ""),
        sunset: String(arr(d, "sunset")[i] ?? ""),
    }));
    return {
        fetchedAt,
        timezone: typeof o.timezone === "string" ? o.timezone : "",
        utcOffsetSeconds: num(o.utc_offset_seconds, 0),
        current, hourly, daily,
    };
}

export interface Place {
    /** Open-Meteo's GeoNames id as a string; "current" for the device's own position. */
    id: string;
    name: string;
    /** State or region ("California"). */
    admin?: string;
    country?: string;
    countryCode?: string;
    latitude: number;
    longitude: number;
}

/** A geocoding search reply -> places. */
export function parseSearch(r: unknown): Place[] {
    const o = r as Json;
    if (o?.error) throw new WeatherError("server", String(o.reason ?? "The search failed."));
    return arr(o, "results").flatMap((x): Place[] => {
        const p = x as Json;
        const latitude = num(p.latitude), longitude = num(p.longitude);
        if (typeof p.name !== "string" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
        return [{
            id: String(p.id ?? `${latitude},${longitude}`),
            name: p.name,
            admin: typeof p.admin1 === "string" ? p.admin1 : undefined,
            country: typeof p.country === "string" ? p.country : undefined,
            countryCode: typeof p.country_code === "string" ? p.country_code : undefined,
            latitude, longitude,
        }];
    });
}

/** "Sunnyvale, California, United States" without the parts that are missing. */
export function placeLine(p: Place): string {
    return [p.admin, p.country].filter((s) => s && s !== p.name).join(", ");
}

// ---- Requests -------------------------------------------------------------------------------

export type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

async function getJson(url: string, fetcher: Fetcher, timeoutMs: number): Promise<unknown> {
    const ctl = typeof AbortController === "function" ? new AbortController() : undefined;
    const timer = setTimeout(() => ctl?.abort(), timeoutMs);
    let res;
    try {
        res = await fetcher(url, { signal: ctl?.signal });
    } catch {
        throw new WeatherError("offline", "Can't reach the weather service.");
    } finally {
        clearTimeout(timer);
    }
    let body: unknown;
    try {
        body = await res.json();
    } catch {
        throw new WeatherError(res.ok ? "bad" : "server", `The weather service answered ${res.status}.`);
    }
    if (!res.ok) {
        const reason = (body as Json | undefined)?.reason;
        throw new WeatherError("server", typeof reason === "string" ? reason : `The weather service answered ${res.status}.`);
    }
    return body;
}

const defaultFetch: Fetcher = (url, init) => fetch(url, init);

export async function fetchForecast(p: Pick<Place, "latitude" | "longitude">, opts: { server?: string; fetcher?: Fetcher; now?: number } = {}): Promise<Forecast> {
    const body = await getJson(forecastUrl(p.latitude, p.longitude, opts.server), opts.fetcher ?? defaultFetch, 20000);
    return parseForecast(body, opts.now ?? Date.now());
}

export async function searchPlaces(name: string, opts: { language?: string; fetcher?: Fetcher } = {}): Promise<Place[]> {
    if (!name.trim()) return [];
    return parseSearch(await getJson(searchUrl(name, opts.language), opts.fetcher ?? defaultFetch, 15000));
}
