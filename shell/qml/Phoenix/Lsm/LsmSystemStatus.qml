// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Device status for the status bar. Same properties as
// Phoenix.Sim.SimSystemStatus.
//
// STATUS: placeholder values. M1 wires these to OSE Luna services
// (com.webos.service.connectionmanager, com.webos.service.bluetooth2,
// com.webos.service.battery where the device provides it, and the
// settings service's time format for twentyFourHour).

import QtQuick

QtObject {
    property string carrier: "webOS Phoenix"
    property int batteryPercent: 100
    property bool charging: true
    property int wifiBars: -1
    property int signalBars: -1
    property bool airplaneMode: false
    property bool bluetoothOn: false
    property bool rotationLocked: false
    property bool muted: false
    property bool twentyFourHour: false
    property real brightness: 1.0
    property var fixedTime: null
}
