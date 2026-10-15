// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// AirPods in the shell (docs/ACCESSORIES.md): what Earbuds.js decides, the
// card EarbudsMonitor shows when a case opens nearby (pairing and battery),
// ear detection pausing and resuming, the low battery notification, and
// the system menu's batteries and Noise Control. The status is what
// org.webosphoenix.earbuds reports (system.earbuds), given here as the
// runtime would report it (SimSystemStatus.applyAppStatus {earbuds}).

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim
import "../qml/Phoenix/Shell/Earbuds.js" as Logic

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus {
            id: status
            fixedTime: new Date(2009, 5, 6, 9, 41)
            _scanTime: 100
            _connectTime: 150
        }
    }

    SignalSpy { id: requests; target: status; signalName: "earbudsRequested" }

    // ---- What the service reports ------------------------------------------------------
    function nearby(over) {
        var n = { id: "5e:a1", model: "0x1420", modelName: "AirPods", kind: "", color: "white",
                  battery: { left: 100, right: 100, case: 80 }, charging: { left: false, right: false, case: false },
                  lidOpen: true, lidOpenCount: 3, rssi: -42, paired: "" };
        for (var k in over || {}) n[k] = over[k];
        return n;
    }
    function device(over) {
        var d = { address: "a0:b1", name: "AirPods Pro", model: "AirPods Pro 2", kind: "airpodspro", modelNumber: "A2931",
                  connected: true, aap: true, battery: { left: 90, right: 85, case: 70, single: -1 },
                  charging: { left: false, right: false, case: false, single: false },
                  inEar: { left: "ear", right: "ear" }, noiseMode: "anc", noiseModes: ["off", "transparency", "adaptive", "anc"],
                  earDetection: true, conversationAwareness: true };
        for (var k in over || {}) d[k] = over[k];
        return d;
    }
    function report(nearbyList, devices, pairing) {
        status.applyAppStatus({ earbuds: { bluetooth: true, nearby: nearbyList || [], devices: devices || [], pairing: pairing || null } });
    }

    TestCase {
        name: "Earbuds"
        when: windowShown

        property var monitor: findChild(shell, "earbudsMonitor")
        function alert() { return windows.windowFor(monitor.alertKey); }
        // The card, once it is up (Notifications puts it in place).
        // (The phone's negative space opens with an animation, the card
        // clipped in it: wait until all of it shows.)
        function shownAlert() {
            tryCompare(windows.alerts, "count", 1, 1000);
            var a = alert();
            tryVerify(function() { return a.visible && a.parent && a.parent.parent && Math.abs(a.parent.parent.height - a.height) < 0.5; }, 2000);
            // Its buttons laid out (the Row places them when it is polished;
            // a press before that lands on the last one placed).
            waitForItemPolished(child(a, "earbudsAlertButtons"));
            return a;
        }
        function child(item, name) { return item ? findChild(item, name) : null; }

        function init() {
            shell.unlock();
            status.bluetoothOn = true;
            report([], [], null);
            monitor._dismissed = {};
            monitor._close();
            monitor.pausedByEar = false;
            monitor.lastEarAction = "";
            monitor.lastNotification = null;
            monitor.batteryCardTime = 6000;
            requests.clear();
            tryCompare(windows.alerts, "count", 0, 1000);
        }

        // ---- Earbuds.js ------------------------------------------------------------------
        function test_logic() {
            compare(Logic.batteryText({ left: 80, right: 70, case: 40 }), "L 80%  R 70%  Case 40%");
            compare(Logic.batteryText({ left: -1, right: -1, case: -1, single: 55 }), "55%");
            compare(Logic.modes(device({ noiseModes: ["anc", "off", "transparency"] })), ["off", "transparency", "anc"]);
            compare(Logic.modeLabel("anc"), "Noise Cancellation");
            // A case that opens: new, or closed before, or opened again since.
            var s0 = { nearby: [] }, s1 = { nearby: [nearby()] };
            compare(Logic.cardFor(s0, s1, {}).kind, "pair");
            compare(Logic.cardFor(s1, s1, {}), null);
            compare(Logic.cardFor({ nearby: [nearby({ lidOpen: false })] }, s1, {}).kind, "pair");
            compare(Logic.cardFor(s1, { nearby: [nearby({ lidOpenCount: 4 })] }, {}).kind, "pair");
            // Not now: until the lid closes.
            compare(Logic.cardFor(s0, s1, { "5e:a1": true }), null);
            compare(Logic.stillDismissed({ "5e:a1": true }, s1), { "5e:a1": true });
            compare(Logic.stillDismissed({ "5e:a1": true }, { nearby: [nearby({ lidOpen: false })] }), {});
            // Paired here: the battery card, with the device.
            var paired = { nearby: [nearby({ paired: "a0:b1" })], devices: [device()] };
            var c = Logic.cardFor(s0, paired, {});
            compare(c.kind, "battery");
            compare(c.device.address, "a0:b1");
            // Ear detection.
            compare(Logic.earAction(device(), device({ inEar: { left: "out", right: "ear" } })), "pause");
            compare(Logic.earAction(device({ inEar: { left: "out", right: "ear" } }), device()), "resume");
            compare(Logic.earAction(device(), device({ inEar: { left: "out", right: "ear" }, earDetection: false })), "");
            compare(Logic.earAction(device({ aap: false }), device({ inEar: { left: "out", right: "ear" } })), "");
            // Low battery: under 20, 10, 5 (not while charging).
            var low = Logic.lowBattery(device({ battery: { left: 25, right: 30, case: 50 } }), device({ battery: { left: 19, right: 30, case: 50 } }));
            compare(low.level, 20);
            compare(low.title, "AirPods Pro battery low");
            compare(Logic.lowBattery(device({ battery: { left: 12, right: 30, case: 50 } }), device({ battery: { left: 8, right: 30, case: 50 } })).level, 10);
            compare(Logic.lowBattery(device({ battery: { left: 19, right: 30, case: 50 } }), device({ battery: { left: 18, right: 30, case: 50 } })), null);
            compare(Logic.lowBattery(device({ battery: { left: 25, right: 30, case: 50 } }),
                                     device({ battery: { left: 19, right: 30, case: 50 }, charging: { left: true, right: false, case: false } })), null);
        }

        // ---- The card ------------------------------------------------------------------------
        function test_pairCard() {
            report([nearby()], [], null);
            var a = shownAlert();
            compare(windows.alerts.get(0).height, 250);
            compare(child(a, "earbudsAlertTitle").text, "AirPods");
            compare(child(a, "earbudsAlertMessage").text, "Not connected to this device.");
            compare(child(child(a, "earbudsAlertBattery_case"), "value").text, "80%");
            // In the popup alert's place: the negative space at the bottom
            // of the phone (above its gesture area), full width.
            var space = findChild(shell, "phoneAlertHost").parent;
            fuzzyCompare(a.mapToItem(root, 0, a.height).y, space.mapToItem(root, 0, space.height).y, 0.5);
            verify(a.mapToItem(root, 0, a.height).y > root.height - 40);
            compare(a.width, root.width);
            // Connect: the service pairs; the card follows it.
            mouseClick(child(a, "earbudsAlertConnect"));
            compare(requests.count, 1);
            compare(requests.signalArguments[0][0].method, "connect");
            compare(requests.signalArguments[0][0].params.id, "5e:a1");
            compare(child(a, "earbudsAlertMessage").text, "Hold the button on the back of the case until the light flashes white.");
            verify(child(a, "earbudsAlertCancel").visible);
            report([nearby()], [], { id: "5e:a1", state: "pairing", address: "a0:b1", error: "" });
            compare(child(a, "earbudsAlertMessage").text, "Pairing...");
            // Paired and connected: their battery card.
            report([nearby({ paired: "a0:b1" })], [device({ inEar: { left: "case", right: "case" } })], null);
            compare(a.kind, "battery");
            compare(child(a, "earbudsAlertTitle").text, "AirPods Pro");
            compare(child(child(a, "earbudsAlertBattery_left"), "value").text, "90%");
            waitForItemPolished(child(a, "earbudsAlertButtons"));
            mouseClick(child(a, "earbudsAlertDone"));
            tryCompare(windows.alerts, "count", 0, 1000);
        }

        function test_notNowUntilTheLidCloses() {
            report([nearby()], [], null);
            mouseClick(child(shownAlert(), "earbudsAlertNotNow"));
            tryCompare(windows.alerts, "count", 0, 1000);
            report([nearby({ battery: { left: 90, right: 100, case: 80 } })], [], null);
            compare(windows.alerts.count, 0);
            report([nearby({ lidOpen: false })], [], null);
            report([nearby({ lidOpenCount: 4 })], [], null);
            tryCompare(windows.alerts, "count", 1, 1000);
        }

        function test_failedPairingAndCancel() {
            report([nearby()], [], null);
            var a = shownAlert();
            mouseClick(child(a, "earbudsAlertConnect"));
            report([nearby()], [], { id: "5e:a1", state: "failed", address: "", error: "No AirPods in pairing mode were found" });
            compare(child(a, "earbudsAlertMessage").text, "No AirPods in pairing mode were found");
            compare(child(a, "earbudsAlertConnect").caption, "Try Again");
            waitForItemPolished(child(a, "earbudsAlertButtons"));
            mouseClick(child(a, "earbudsAlertConnect"));
            report([nearby()], [], { id: "5e:a1", state: "searching", address: "", error: "" });
            waitForItemPolished(child(a, "earbudsAlertButtons"));
            mouseClick(child(a, "earbudsAlertCancel"));
            compare(requests.signalArguments[requests.count - 1][0].method, "cancelConnect");
            tryCompare(windows.alerts, "count", 0, 1000);
        }

        function test_batteryCardClosesByItself() {
            monitor.batteryCardTime = 300;
            report([nearby({ paired: "a0:b1" })], [device()], null);
            tryCompare(windows.alerts, "count", 1, 1000);
            compare(alert().kind, "battery");
            tryCompare(windows.alerts, "count", 0, 2000);
        }

        // The Home button closes the front popup alert (Shell, the window
        // source's closeAlert): the next opening shows a card again.
        function test_closedFromOutside() {
            report([nearby()], [], null);
            shownAlert();
            windows.closeAlert(monitor.alertKey);
            compare(monitor.card, null);
            report([nearby({ lidOpen: false })], [], null);
            report([nearby({ lidOpenCount: 4 })], [], null);
            tryCompare(windows.alerts, "count", 1, 1000);
        }

        function test_cardGoesWithTheAirPods() {
            report([nearby()], [], null);
            tryCompare(windows.alerts, "count", 1, 1000);
            report([], [], null);
            tryCompare(windows.alerts, "count", 0, 1000);
        }

        // ---- Ear detection and the battery ---------------------------------------------------
        function test_earDetectionPausesAndPlays() {
            report([], [device()], null);
            report([], [device({ inEar: { left: "out", right: "ear" } })], null);
            compare(monitor.lastEarAction, "pause");
            // No page answers getNowPlaying here: pausing anyway is harmless.
            verify(monitor.pausedByEar);
            report([], [device()], null);
            compare(monitor.lastEarAction, "resume");
            verify(!monitor.pausedByEar);
            // Off: nothing.
            monitor.lastEarAction = "";
            report([], [device({ earDetection: false })], null);
            report([], [device({ earDetection: false, inEar: { left: "out", right: "out" } })], null);
            compare(monitor.lastEarAction, "");
        }

        function test_lowBatteryNotification() {
            report([], [device({ battery: { left: 30, right: 28, case: 70, single: -1 } })], null);
            var before = windows.notifications.count;
            report([], [device({ battery: { left: 9, right: 28, case: 70, single: -1 } })], null);
            compare(monitor.lastNotification.title, "AirPods Pro battery low");
            compare(monitor.lastNotification.body, "9% remaining. Put them in the case to charge.");
            compare(windows.notifications.count, before + 1);
            compare(JSON.parse(windows.notifications.get(0).params), { page: "bluetooth", view: "earbuds", address: "a0:b1" });
        }

        // ---- The system menu -----------------------------------------------------------------
        function test_systemMenu() {
            // Only the AirPods paired (not the simulator's demo devices).
            status.bluetoothDevices = [];
            report([], [device()], null);
            var menu = findChild(shell, "systemMenu");
            shell.openSystemMenu();
            tryCompare(menu, "opacity", 1, 1000);
            // The paired AirPods in Bluetooth's list, with their batteries.
            var bt = findChild(menu, "systemMenuBluetooth");
            compare(bt.stateText, "AirPods Pro");
            bt.open();
            var entry = null;
            tryVerify(function() { entry = findChild(menu, "systemMenuBluetoothEntry"); return entry !== null; }, 1000);
            compare(entry.name, "AirPods Pro");
            compare(entry.status, "L 90%  R 85%  Case 70%");
            verify(entry.connected);
            bt.close(true);
            // Noise Control: the mode in its header, the modes inside.
            var noise = findChild(menu, "systemMenuNoiseControl");
            verify(noise.visible);
            compare(noise.stateText, "Noise Cancellation");
            noise.open();
            var row = findChild(menu, "systemMenuNoiseMode_transparency");
            verify(row);
            // (The open drawer runs below the menu's fold: the row as a
            // tap on it would act, without scrolling the menu.)
            row.action();
            compare(requests.signalArguments[requests.count - 1][0].method, "setNoiseMode");
            compare(requests.signalArguments[requests.count - 1][0].params, { address: "a0:b1", mode: "transparency" });
            tryCompare(menu, "open", false, 2000);
            // Without modes (AirPods 3) or not connected: no drawer.
            report([], [device({ noiseModes: [] })], null);
            verify(!noise.visible);
            report([], [device({ connected: false, aap: false })], null);
            verify(!noise.visible);
        }
    }
}
