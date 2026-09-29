// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.webos.service.location (OSE location-framework): where the device
// is. Weather asks it once for the "Current Location" entry; Maps follows it
// (apps/maps/src/lib/location.ts). On a device it is OSE's location service
// (GPS and network handlers; see docs/HARDWARE.md, GPS); the simulator
// implements it in runtime/phoenix-runtime.js (block "Location and text to
// speech").
//
//   getLocationUpdates {Handler?: "gps" | "network" | "passive",
//                       responseTimeout?: seconds, subscribe?}
//       -> {latitude, longitude, altitude, horizAccuracy, vertAccuracy,
//           speed, direction, timestamp (ms)}
//   Without subscribe it answers once, with one fix
//   (https://www.webosose.org/docs/reference/ls2-api/com-webos-service-location/).
//
// Errors are webOS style (errorCode 1 timed out, 5 location is off, ...);
// the app treats any of them, or no service at all, as "no position" and
// offers the search.

import { call } from "./bridge";

export interface Position {
    latitude: number;
    longitude: number;
    altitude?: number;
    /** Metres. */
    horizAccuracy?: number;
    vertAccuracy?: number;
    speed?: number;
    direction?: number;
    /** ms since the epoch. */
    timestamp?: number;
}

export interface PositionRequest {
    /** Which source: OSE picks one when it is left out. */
    Handler?: "gps" | "network" | "passive";
    /** Seconds to wait for a fix. */
    responseTimeout?: number;
}

declare module "./types" {
    interface LunaApi {
        "luna://com.webos.service.location/getLocationUpdates": { params: PositionRequest; result: Position };
    }
}

export const location = {
    /** One fix. Rejects with a LunaError when there is none. */
    async currentPosition(req: PositionRequest = { responseTimeout: 15 }, timeoutMs = 20000): Promise<Position> {
        const r = await call("luna://com.webos.service.location/getLocationUpdates", req, { timeoutMs });
        return { ...r, latitude: Number(r.latitude), longitude: Number(r.longitude) };
    },
};
