// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// AssistantMoments.qml: the Assistant's routines hear when the device is
// put on charge and when it connects to a car (its Bluetooth class of
// device, or its name), and nothing for how things were at the start.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root

    QtObject {
        id: fakeSource
        property var events: []
        function lunaCall(uri, params, cb) {
            if (uri === "luna://org.webosphoenix.assistant/routineEvent")
                events = events.concat([params.event]);
            cb({ returnValue: true });
        }
    }
    SimSystemStatus { id: sys; charger: "wall" }
    AssistantMoments { id: moments; source: fakeSource; system: sys }

    TestCase {
        name: "AssistantMoments"

        function test_chargerAndCar() {
            // On charge at the start: nothing said.
            compare(fakeSource.events, []);
            sys.charger = "none";
            compare(fakeSource.events, []);
            sys.charger = "pc";
            compare(fakeSource.events, ["charging"]);
            sys.charger = "inductive";
            compare(fakeSource.events, ["charging"]);
            // The headset is no car; the Car Kit is.
            sys.bluetoothDevices = [{ name: "Palm Stereo Headset", address: "a", state: "connected" }, { name: "Car Kit", address: "b", state: "disconnected" }];
            compare(fakeSource.events, ["charging"]);
            sys.bluetoothDevices = [{ name: "Palm Stereo Headset", address: "a", state: "connected" }, { name: "Car Kit", address: "b", state: "connected" }];
            compare(fakeSource.events, ["charging", "car"]);
            // By its class of device: Audio/Video, car audio (0x200420), whatever its name.
            verify(moments.isCar({ name: "XYZ-200", classOfDevice: 0x200420 }));
            verify(!moments.isCar({ name: "XYZ-200", classOfDevice: 0x240404 }));
        }
    }
}
