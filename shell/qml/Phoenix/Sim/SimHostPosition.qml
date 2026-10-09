// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Where this computer is, for Simulate > Location > This Computer's
// Location (SimLocation.qml loads it, so that without Qt Positioning only
// this fails). On a Mac, CoreLocation asks the user once (Info.plist's
// NSLocationUsageDescription); on Linux, GeoClue answers if it runs.

import QtQuick
import QtPositioning

PositionSource {
    id: src
    signal found(real lat, real lon)
    active: false
    updateInterval: 1000
    function locate() {
        src.update(30000);
    }
    onPositionChanged: {
        if (src.position.latitudeValid && src.position.longitudeValid)
            src.found(src.position.coordinate.latitude, src.position.coordinate.longitude);
    }
    onSourceErrorChanged: {
        if (src.sourceError !== 0)  // PositionSource.NoError
            console.warn("phoenix-sim: this computer's location: error " + src.sourceError);
    }
}
