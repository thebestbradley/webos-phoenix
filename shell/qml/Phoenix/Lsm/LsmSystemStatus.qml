// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Device status for the status bar. Same properties as
// Phoenix.Sim.SimSystemStatus.
//
// STATUS: placeholder values. M1 wires these to OSE Luna services
// (com.webos.service.connectionmanager, com.webos.service.bluetooth2,
// com.webos.service.battery where the device provides it, and the
// settings service's time format for twentyFourHour and its
// showAlertsWhenLocked preference).

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
    // The accelerometer's orientation ("up", "down", "left", "right",
    // "faceup", "facedown"), which the shell's UI follows (UiRotation).
    // STATUS: placeholder, always "up". M1 feeds it from the device's
    // orientation sensor (OSE's sensor service, or Qt Sensors'
    // QOrientationSensor where the device provides one).
    property string deviceOrientation: "up"
    property bool muted: false
    property bool twentyFourHour: false
    property bool showAlertsWhenLocked: true
    property real brightness: 1.0
    property var fixedTime: null
}
