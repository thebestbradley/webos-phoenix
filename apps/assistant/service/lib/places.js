// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Time zones of the world's large cities, for "what time is it in Tokyo"
// with no network (IANA tz names; the clock comes from Intl). Any other
// place is looked up with Open-Meteo's geocoder, which gives its time zone
// (lib/commands.js).

"use strict";

var ZONES = {
    "tokyo": "Asia/Tokyo", "osaka": "Asia/Tokyo", "seoul": "Asia/Seoul", "beijing": "Asia/Shanghai", "shanghai": "Asia/Shanghai",
    "hong kong": "Asia/Hong_Kong", "taipei": "Asia/Taipei", "singapore": "Asia/Singapore", "bangkok": "Asia/Bangkok",
    "jakarta": "Asia/Jakarta", "manila": "Asia/Manila", "kuala lumpur": "Asia/Kuala_Lumpur", "hanoi": "Asia/Bangkok",
    "delhi": "Asia/Kolkata", "new delhi": "Asia/Kolkata", "mumbai": "Asia/Kolkata", "bangalore": "Asia/Kolkata",
    "karachi": "Asia/Karachi", "dubai": "Asia/Dubai", "abu dhabi": "Asia/Dubai", "tehran": "Asia/Tehran", "riyadh": "Asia/Riyadh",
    "tel aviv": "Asia/Jerusalem", "jerusalem": "Asia/Jerusalem", "istanbul": "Europe/Istanbul", "moscow": "Europe/Moscow",
    "cairo": "Africa/Cairo", "lagos": "Africa/Lagos", "nairobi": "Africa/Nairobi", "johannesburg": "Africa/Johannesburg",
    "cape town": "Africa/Johannesburg", "casablanca": "Africa/Casablanca",
    "london": "Europe/London", "dublin": "Europe/Dublin", "lisbon": "Europe/Lisbon", "madrid": "Europe/Madrid",
    "barcelona": "Europe/Madrid", "paris": "Europe/Paris", "brussels": "Europe/Brussels", "amsterdam": "Europe/Amsterdam",
    "berlin": "Europe/Berlin", "munich": "Europe/Berlin", "frankfurt": "Europe/Berlin", "zurich": "Europe/Zurich",
    "geneva": "Europe/Zurich", "vienna": "Europe/Vienna", "rome": "Europe/Rome", "milan": "Europe/Rome", "prague": "Europe/Prague",
    "warsaw": "Europe/Warsaw", "budapest": "Europe/Budapest", "stockholm": "Europe/Stockholm", "oslo": "Europe/Oslo",
    "copenhagen": "Europe/Copenhagen", "helsinki": "Europe/Helsinki", "athens": "Europe/Athens", "kyiv": "Europe/Kyiv",
    "kiev": "Europe/Kyiv", "reykjavik": "Atlantic/Reykjavik",
    "new york": "America/New_York", "nyc": "America/New_York", "boston": "America/New_York", "washington": "America/New_York",
    "miami": "America/New_York", "atlanta": "America/New_York", "toronto": "America/Toronto", "montreal": "America/Toronto",
    "chicago": "America/Chicago", "dallas": "America/Chicago", "houston": "America/Chicago", "mexico city": "America/Mexico_City",
    "denver": "America/Denver", "phoenix": "America/Phoenix", "los angeles": "America/Los_Angeles", "la": "America/Los_Angeles",
    "san francisco": "America/Los_Angeles", "seattle": "America/Los_Angeles", "vancouver": "America/Vancouver",
    "las vegas": "America/Los_Angeles", "sunnyvale": "America/Los_Angeles", "anchorage": "America/Anchorage",
    "honolulu": "Pacific/Honolulu", "hawaii": "Pacific/Honolulu", "sao paulo": "America/Sao_Paulo", "são paulo": "America/Sao_Paulo",
    "rio de janeiro": "America/Sao_Paulo", "buenos aires": "America/Argentina/Buenos_Aires", "santiago": "America/Santiago",
    "lima": "America/Lima", "bogota": "America/Bogota",
    "sydney": "Australia/Sydney", "melbourne": "Australia/Melbourne", "brisbane": "Australia/Brisbane", "perth": "Australia/Perth",
    "adelaide": "Australia/Adelaide", "auckland": "Pacific/Auckland", "wellington": "Pacific/Auckland",
    "utc": "UTC", "gmt": "UTC"
};

function zoneOf(place) {
    var p = String(place || "").toLowerCase().replace(/^the /, "").replace(/[.,]/g, "").trim();
    return ZONES[p] || null;
}

module.exports = { ZONES: ZONES, zoneOf: zoneOf };
