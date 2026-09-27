// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fake device status for the simulator. On a device the same properties are
// fed from webOS OSE Luna services (battery, connection manager, etc.).

import QtQuick

QtObject {
    property string carrier: "Phoenix"
    property int batteryPercent: 76
    property bool charging: false
    property int wifiBars: 3          // 0..3, -1 = off
    property int signalBars: 5        // 0..5, -1 = no modem
    property bool airplaneMode: false
    property bool bluetoothOn: false
    property bool rotationLocked: false
    property bool muted: false
    property real brightness: 0.7
    // Fixed time for reproducible screenshots; null = live clock.
    property var fixedTime: null
}
