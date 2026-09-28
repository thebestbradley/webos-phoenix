// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Popup alert priority (NotificationPolicy.js).
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import "../qml/Phoenix/Shell/NotificationPolicy.js" as Policy

TestCase {
    name: "NotificationPolicy"

    function test_priorities() {
        compare(Policy.popupAlertPriority("com.palm.app.phone", "incoming-phoneapp"), 0);
        // Phoenix's Phone stands in for the original.
        compare(Policy.popupAlertPriority("org.webosphoenix.phone", "incoming-known"), 1);
        // The Enyo Clock's alarm windows are "ring".
        compare(Policy.popupAlertPriority("com.palm.app.clock", "com.palm.app.clock.alarm.3"), 6);
        // Any Calendar window: its "" entry.
        compare(Policy.popupAlertPriority("com.palm.app.calendar", "reminder"), 14);
        compare(Policy.popupAlertPriority("com.palm.systemui", "LowBatteryAlert"), 1000);
    }

    function test_queue() {
        var q = [{ appId: "com.palm.systemui", name: "LowBatteryAlert" }];
        // Default priority waits its turn.
        compare(Policy.insertIndex(q, "org.webosphoenix.email", ""), 1);
        // A call goes in front of the alert showing.
        compare(Policy.insertIndex(q, "org.webosphoenix.phone", "incoming-known"), 0);
        // An alarm goes behind a call already showing, ahead of the rest.
        q = [{ appId: "org.webosphoenix.phone", name: "incoming-known" },
             { appId: "com.palm.app.calendar", name: "reminder" },
             { appId: "com.palm.systemui", name: "LowBatteryAlert" }];
        compare(Policy.insertIndex(q, "com.palm.app.clock", "com.palm.app.clock.alarm.1"), 1);
        compare(Policy.insertIndex([], "com.palm.app.clock", "ring"), 0);
    }
}
