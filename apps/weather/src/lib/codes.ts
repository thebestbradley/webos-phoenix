// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// WMO weather interpretation codes (WMO 4677, the subset Open-Meteo
// returns as weather_code) -> words and the app's icon.

export type Sky = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "showers" | "snow-showers" | "storm";

const CODES: Record<number, [string, Sky]> = {
    0: ["Clear", "clear"],
    1: ["Mostly Clear", "partly"],
    2: ["Partly Cloudy", "partly"],
    3: ["Cloudy", "cloudy"],
    45: ["Fog", "fog"],
    48: ["Freezing Fog", "fog"],
    51: ["Light Drizzle", "drizzle"],
    53: ["Drizzle", "drizzle"],
    55: ["Heavy Drizzle", "drizzle"],
    56: ["Freezing Drizzle", "drizzle"],
    57: ["Freezing Drizzle", "drizzle"],
    61: ["Light Rain", "rain"],
    63: ["Rain", "rain"],
    65: ["Heavy Rain", "rain"],
    66: ["Freezing Rain", "rain"],
    67: ["Freezing Rain", "rain"],
    71: ["Light Snow", "snow"],
    73: ["Snow", "snow"],
    75: ["Heavy Snow", "snow"],
    77: ["Snow Grains", "snow"],
    80: ["Rain Showers", "showers"],
    81: ["Rain Showers", "showers"],
    82: ["Heavy Showers", "showers"],
    85: ["Snow Showers", "snow-showers"],
    86: ["Snow Showers", "snow-showers"],
    95: ["Thunderstorm", "storm"],
    96: ["Thunderstorm, Hail", "storm"],
    99: ["Thunderstorm, Hail", "storm"],
};

export function describe(code: number | undefined): { text: string; sky: Sky } {
    const c = code === undefined ? undefined : CODES[code];
    if (c) return { text: c[0], sky: c[1] };
    return { text: "", sky: "cloudy" };
}

/** "Clear" at night reads better as "Clear" with a moon; the text stays, only the icon changes. */
export function isNightSky(sky: Sky, isDay: boolean): boolean {
    return !isDay && (sky === "clear" || sky === "partly");
}
