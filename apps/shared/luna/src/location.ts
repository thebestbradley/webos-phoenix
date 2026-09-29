// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Location: webOS OSE's com.webos.service.location, and Phoenix's
// per-app permissions in front of it (org.webosphoenix.service.location).
// Settings > Location Services turns the handlers on and off and lists
// the apps; any app (Weather, Maps, ...) asks for the position here:
//
//   const fix = await location.currentPosition();   // {latitude, longitude, horizAccuracy, ...}
//   const sub = location.watch((fix) => ..., (e) => ...);  sub.cancel();
//
// The OSE service has two handlers, "gps" (the GNSS receiver) and
// "network" (a position looked up from Wi-Fi and cell towers); they are
// turned on and off with setState {Handler, state} (the capital H is what
// the service accepts: LuneOS found lower-case rejected with errorCode 10
// on devices, luneos-components LunaService.qml). Location Services "off"
// is both handlers off. errorCodes follow the legacy com.palm.location API
// (LOCATION_ERRORS). The simulator answers all of this in
// runtime/phoenix-runtime.js ("First use, emergency information, location
// and help"); the first request from an app with no answer yet raises
// luna-systemui's location permission alert.

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

export type LocationHandler = "gps" | "network";

/** errorCode values of a failed position request (legacy com.palm.location). */
export const LOCATION_ERRORS = {
    TIMEOUT: 1,
    POSITION_UNAVAILABLE: 2,
    UNKNOWN: 3,
    /** Both handlers are off: Location Services is off. */
    LOCATION_OFF: 5,
    /** The user did not allow this app. */
    PERMISSION_DENIED: 6,
} as const;

export interface LocationFix {
    latitude: number;
    longitude: number;
    /** Metres; -1 when unknown (network fixes). */
    altitude: number;
    /** Metres, the radius of the likely area. */
    horizAccuracy: number;
    vertAccuracy: number;
    /** Degrees; -1 when unknown. */
    direction: number;
    /** Metres per second; -1 when unknown. */
    velocity: number;
    /** Seconds since the epoch. */
    timestamp: number;
    /** Phoenix: which handler gave the fix. */
    handler?: LocationHandler;
}

export interface LocationPermission {
    appId: string;
    title: string;
    allowed: boolean;
    /** When the user answered (ms). */
    time: number;
    /** When the app last had the position (ms), 0 if never. */
    lastUsed: number;
}

export interface ReverseLocation {
    address: string;
    locality: string;
    region: string;
    country: string;
    countryCode: string;
}

type OnError = (e: LunaError) => void;
const SVC = "luna://com.webos.service.location/";
const PERM = "luna://org.webosphoenix.service.location/";

export const location = {
    /** getCurrentPosition: one fix, from the handler given or whichever is on. */
    async currentPosition(handler?: LocationHandler): Promise<LocationFix> {
        return (await call(SVC + "getCurrentPosition", handler ? { Handler: handler } : {})) as unknown as LocationFix;
    },
    /** getLocationUpdates {subscribe}: a fix every minimumInterval ms (at least 1000). */
    watch(cb: (fix: LocationFix) => void, onError?: OnError, minimumInterval = 1000): Subscription {
        return subscribe(SVC + "getLocationUpdates", { minimumInterval }, (r) => {
            if (typeof (r as { latitude?: unknown }).latitude === "number") cb(r as unknown as LocationFix);
        }, onError);
    },
    /** getAllLocationHandlers {subscribe}: which handlers are on. */
    watchHandlers(cb: (h: Record<LocationHandler, boolean>) => void, onError?: OnError): Subscription {
        return subscribe(SVC + "getAllLocationHandlers", {}, (r) => {
            const out = { gps: false, network: false };
            for (const h of (r as { handlers?: { name: string; state: boolean }[] }).handlers ?? [])
                if (h.name === "gps" || h.name === "network") out[h.name] = !!h.state;
            cb(out);
        }, onError);
    },
    /** setState {Handler, state} */
    setHandler(handler: LocationHandler, on: boolean) {
        return call(SVC + "setState", { Handler: handler, state: on });
    },
    /** Location Services on (both handlers) or off (neither). */
    async setEnabled(on: boolean) {
        await location.setHandler("gps", on);
        await location.setHandler("network", on);
    },
    /** getReverseLocation {latitude, longitude}: the place a position is in. */
    async reverse(latitude: number, longitude: number): Promise<ReverseLocation> {
        return (await call(SVC + "getReverseLocation", { latitude, longitude })) as unknown as ReverseLocation;
    },
};

export const locationPermissions = {
    /** getPermissions {subscribe}: the apps that asked, and the answers. */
    watch(cb: (p: LocationPermission[]) => void, onError?: OnError): Subscription {
        return subscribe(PERM + "getPermissions", {},
            (r) => cb((r as { permissions?: LocationPermission[] }).permissions ?? []), onError);
    },
    set(appId: string, allowed: boolean) {
        return call(PERM + "setPermission", { appId, allowed });
    },
    /** Forget the answer: the app asks again next time. */
    remove(appId: string) {
        return call(PERM + "removePermission", { appId });
    },
};

/** "37.38880° N, 122.03010° W" */
export function formatCoordinates(lat: number, lon: number, digits = 5): string {
    const f = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(digits)}° ${v >= 0 ? pos : neg}`;
    return `${f(lat, "N", "S")}, ${f(lon, "E", "W")}`;
}
