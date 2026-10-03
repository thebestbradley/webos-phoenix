// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device's position, from webOS OSE's location service:
//
//   luna://com.webos.service.location/getLocationUpdates
//     {subscribe: true, minimumInterval, Handler?} -> {latitude, longitude,
//     altitude, direction, speed, horizAccuracy, vertAccuracy, timestamp}
//   (https://www.webosose.org/docs/reference/ls2-api/com-webos-service-location/)
//
// runtime/phoenix-runtime.js simulates it (with mock/setLocation to move
// the device). Where the bus has no location service, the web runtime's
// navigator.geolocation is used instead.

import { subscribe, type LunaError, type Subscription } from "@phoenix/luna";

export interface Fix {
    lon: number;
    lat: number;
    /** m; -1 unknown */
    accuracy: number;
    /** degrees from north; -1 unknown */
    heading: number;
    /** m/s; -1 unknown */
    speed: number;
    timestamp: number;
}

export const LOCATION = "luna://com.webos.service.location";

interface LocationReply {
    latitude?: number; longitude?: number; horizAccuracy?: number; direction?: number; speed?: number; timestamp?: number;
    errorCode?: number;
}

export function fixFromReply(r: LocationReply): Fix | null {
    if (typeof r.latitude !== "number" || typeof r.longitude !== "number") return null;
    return {
        lat: r.latitude, lon: r.longitude, accuracy: r.horizAccuracy ?? -1, heading: r.direction ?? -1,
        speed: r.speed ?? -1, timestamp: r.timestamp ?? Date.now(),
    };
}

/** Error text for OSE's location error codes. */
export function locationError(code: number | undefined): string {
    switch (code) {
        case 1: return "Finding your location timed out";
        case 5: return "Location services are off";
        case 11: return "No network connection for locating";
        default: return "Your location is not available";
    }
}

/** Follow the device's position. onFix gets every fix; onError says why there is none. */
export function watchLocation(onFix: (f: Fix) => void, onError: (text: string) => void): Subscription {
    let cancelled = false;
    let geoId: number | null = null;
    let fallback = false;
    const useBrowser = () => {
        if (fallback || cancelled) return;
        fallback = true;
        if (!("geolocation" in navigator)) { onError(locationError(undefined)); return; }
        geoId = navigator.geolocation.watchPosition(
            (p) => onFix({
                lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy,
                heading: p.coords.heading ?? -1, speed: p.coords.speed ?? -1, timestamp: p.timestamp,
            }),
            (e) => onError(e.code === e.PERMISSION_DENIED ? "Location services are off" : locationError(undefined)),
            { enableHighAccuracy: true, maximumAge: 5000 },
        );
    };
    const sub = subscribe(`${LOCATION}/getLocationUpdates`, { subscribe: true, minimumInterval: 1000 }, (r) => {
        const f = fixFromReply(r as LocationReply);
        if (f) onFix(f);
    }, (e: LunaError) => {
        // No such service (or no bridge): the browser's geolocation.
        if (e.errorCode === -1 && /not available|Unknown method|Service does not exist|no such service/i.test(e.errorText)) useBrowser();
        else onError(locationError(e.errorCode));
    });
    return {
        cancel() {
            cancelled = true;
            sub.cancel();
            if (geoId !== null) navigator.geolocation.clearWatch(geoId);
        },
        get cancelled() { return cancelled; },
    };
}
