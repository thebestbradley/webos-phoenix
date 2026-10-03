// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The simulator's storage daemon (storaged) as far as USB drive mode goes:
// a USB cable from a computer (phoenix-sim Shift+F8, --usb), the drive
// taken from the device for the computer (com.palm.storage
// diskmode/enterMSM: the shell's Power + Volume Down, luna-systemui's "USB
// Drive" button), given back when the computer ejects it (Ctrl+F8), and
// checked when the cable is pulled without that. It says so with the
// /storaged signals LunaSysMgr and luna-systemui listened to
// (SystemService.cpp:318-350, luna-systemui StoragedService.js):
//   cable in           MSMAvail {mode-avail: true}
//   enterMSM           MSMProgress {stage: "attempting"}, then MSMEntry
//                      {new-mode: "brick"}; with --usb-busy (an app keeps a
//                      file open on the drive) MSMProgress {stage: "failed"}
//   ejected            MSMEntry {new-mode: "phone"}
//   cable out          MSMAvail {mode-avail: false}; if the drive was still
//                      the computer's, first MSMFscking and a check of it,
//                      and after that PartitionAvail {fscked: true}
//                      (luna-systemui's "Some data was damaged" alert)
// The cable also charges the device (powerd's USBDockStatus, USBName "pc").
//
// signalled(method, payload) is each signal; sim.qml passes it to the web
// pages (SimWindowSource.storagedSignal) and to the shell
// (Shell.storagedSignal).

import QtQuick

QtObject {
    id: storage

    property bool hostConnected: false
    // "phone": the device has the drive; "brick": the computer has it.
    property string mode: "phone"
    property bool busy: false
    readonly property int unmountTime: 1000     // the drive taken from the device
    readonly property int fsckTime: 4000        // the check after an unclean exit

    signal signalled(string method, var payload)
    // The cable is in or out (sim.qml: the charger, the pages' host status).
    signal cableChanged(bool connected)

    function plug(connected) {
        if (connected === hostConnected)
            return;
        if (connected) {
            hostConnected = true;
            cableChanged(true);
            signalled("MSMAvail", { "mode-avail": true });
            return;
        }
        if (mode === "brick") {
            // Pulled without ejecting: storaged checks the drive first.
            entering.stop();
            signalled("MSMFscking", {});
            fsck.start();
            return;
        }
        _unplugged(false);
    }
    function _unplugged(fscked) {
        hostConnected = false;
        mode = "phone";
        cableChanged(false);
        signalled("MSMAvail", { "mode-avail": false });
        if (fscked)
            signalled("PartitionAvail", { fscked: true });
    }

    function enterMSM(enterIMasq) {
        if (!hostConnected || mode === "brick" || entering.running)
            return;
        signalled("MSMProgress", { stage: "attempting", enterIMasq: !!enterIMasq });
        entering.failing = busy;
        entering.start();
    }

    // The computer ejected the drive: back to the device.
    function eject() {
        if (mode !== "brick")
            return;
        mode = "phone";
        signalled("MSMEntry", { "new-mode": "phone", enterIMasq: false });
    }

    property Timer entering: Timer {
        property bool failing: false
        interval: storage.unmountTime
        onTriggered: {
            if (failing) {
                storage.signalled("MSMProgress", { stage: "failed", enterIMasq: false });
                return;
            }
            storage.mode = "brick";
            storage.signalled("MSMEntry", { "new-mode": "brick", enterIMasq: false });
        }
    }
    property Timer fsck: Timer {
        interval: storage.fsckTime
        onTriggered: storage._unplugged(true)
    }
}
