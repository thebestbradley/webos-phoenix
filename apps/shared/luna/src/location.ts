// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// com.webos.service.location (OSE location-framework): where the device
// is. Weather asks it once for the "Current Location" entry. On a device
// it is OSE's location service (GPS and network handlers; see
// docs/HARDWARE.md, GPS); the simulator implements getCurrentPosition in
// runtime/phoenix-runtime.js (block "Location") with a fixed, settable
// position.
//
//   getCurrentPosition {accuracy?: 1 high | 2 medium | 3 low,
//                       maximumAge?: seconds, responseTime?: 1 | 2 | 3}
//       -> {latitude, longitude, altitude, horizAccuracy, vertAccuracy,
//           speed, direction, timestamp (ms)}
//
// Errors are webOS style; the app treats any of them ("location is off",
// "timed out", no service at all) as "no position" and offers the search.

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
    /** 1 high (GPS), 2 medium, 3 low (network): OSE's accuracy levels. */
    accuracy?: 1 | 2 | 3;
    /** Accept a fix this many seconds old. */
    maximumAge?: number;
    /** 1 fast, 2 medium, 3 slow (OSE's responseTime levels). */
    responseTime?: 1 | 2 | 3;
}

declare module "./types" {
    interface LunaApi {
        "luna://com.webos.service.location/getCurrentPosition": { params: PositionRequest; result: Position };
    }
}

export const location = {
    /** One fix. Rejects with a LunaError when there is none. */
    async currentPosition(req: PositionRequest = { accuracy: 3, maximumAge: 600, responseTime: 2 }, timeoutMs = 20000): Promise<Position> {
        const r = await call("luna://com.webos.service.location/getCurrentPosition", req, { timeoutMs });
        return { ...r, latitude: Number(r.latitude), longitude: Number(r.longitude) };
    },
};
