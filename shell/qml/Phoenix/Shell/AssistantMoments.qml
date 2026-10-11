// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device's moments a routine may run at (the Assistant's routines,
// docs/AI-AND-MCP.md "Everyday features"): put on charge (the charger, a
// USB cable from a wall plug or a computer, or a Touchstone, where there
// was none) and connected to a car (a Bluetooth device that is a car kit:
// its class of device says car audio, Bluetooth's assigned numbers major
// class 0x04 Audio/Video, minor 0x08 Car audio, or its name says car).
// Each goes to org.webosphoenix.assistant routineEvent {event: "charging" |
// "car"}, which runs the routines that wait for it. Nothing is said for
// what the device was doing when the shell started.

import QtQuick

QtObject {
    id: moments

    property var source: null
    property var system: null

    readonly property string charger: system && system.charger !== undefined ? String(system.charger) : "none"
    readonly property bool car: {
        var list = system && system.bluetoothDevices ? system.bluetoothDevices : [];
        for (var i = 0; i < list.length; ++i)
            if (list[i].state === "connected" && moments.isCar(list[i]))
                return true;
        return false;
    }
    property bool _started: false
    property string _lastCharger: "none"
    property bool _lastCar: false

    function isCar(d) {
        var cod = Number(d.classOfDevice) || 0;
        if (cod && ((cod >> 8) & 0x1f) === 0x04 && ((cod >> 2) & 0x3f) === 0x08)
            return true;
        return /\b(?:car|auto|vehicle|uconnect|sync|carplay|hands-?free kit)\b/i.test(String(d.name || ""));
    }
    function tell(event) {
        if (source && typeof source.lunaCall === "function")
            source.lunaCall("luna://org.webosphoenix.assistant/routineEvent", { event: event }, function () {});
    }

    onChargerChanged: {
        var was = _lastCharger;
        _lastCharger = charger;
        if (_started && was === "none" && charger !== "none")
            tell("charging");
    }
    onCarChanged: {
        var was = _lastCar;
        _lastCar = car;
        if (_started && !was && car)
            tell("car");
    }
    Component.onCompleted: {
        _lastCharger = charger;
        _lastCar = car;
        _started = true;
    }
}
