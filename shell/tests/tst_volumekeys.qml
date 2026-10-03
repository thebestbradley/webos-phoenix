// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The volume keys and their indicator (Shell.volumeKey, VolumeIndicator.qml;
// NativeAlertManager::actOnChanged). The simulator's F10 and F11.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: status }
    }

    TestCase {
        name: "VolumeKeys"
        when: windowShown

        property var hud: findChild(shell, "volumeIndicator")

        function init() {
            shell.unlock();
            shell.forceActiveFocus();
            status.volume = 50;
            status.muted = false;
            status.audioScenario = "system";
            tryCompare(hud, "opacity", 0, 5000);
        }

        function test_upAndDown() {
            keyClick(Qt.Key_F11);
            compare(status.volume, 60);
            verify(hud.shown);
            compare(hud.kind, "ringtone");
            // (60 + 6) / 11: the sixth row.
            compare(hud._row, 6);
            tryCompare(hud, "opacity", 1, 1000);
            keyClick(Qt.Key_F10);
            keyClick(Qt.Key_VolumeDown);
            compare(status.volume, 40);
            // Not past the ends.
            for (var i = 0; i < 8; ++i)
                keyClick(Qt.Key_F10);
            compare(status.volume, 0);
            compare(hud._row, 0);
            for (i = 0; i < 12; ++i)
                keyClick(Qt.Key_VolumeUp);
            compare(status.volume, 100);
            compare(hud._row, 9);
        }

        function test_goesAfterThreeSeconds() {
            keyClick(Qt.Key_F11);
            wait(2500);
            verify(hud.shown);
            // A key keeps it up.
            keyClick(Qt.Key_F11);
            wait(1500);
            verify(hud.shown);
            tryCompare(hud, "shown", false, 2500);
            tryCompare(hud, "opacity", 0, 1000);
        }

        function test_whatIsPlaying() {
            status.audioScenario = "media";
            keyClick(Qt.Key_F11);
            compare(hud.kind, "media");
            status.audioScenario = "phone";
            keyClick(Qt.Key_F11);
            compare(hud.kind, "phone");
            status.audioScenario = "ringtone";
            keyClick(Qt.Key_F11);
            compare(hud.kind, "ringtone");
            compare(status.volume, 80);
        }

        // The ringer switched off: the crossed-out bell, the ringer's
        // volume left alone; music and calls still change.
        function test_muted() {
            status.muted = true;
            keyClick(Qt.Key_F11);
            compare(hud.kind, "mute");
            compare(status.volume, 50);
            status.audioScenario = "media";
            keyClick(Qt.Key_F11);
            compare(hud.kind, "media");
            compare(status.volume, 60);
        }

        // With the screen off it changes the volume without waking it.
        function test_screenOff() {
            shell.display.turnOff();
            keyClick(Qt.Key_F11);
            compare(status.volume, 60);
            compare(shell.display.state, "off");
            verify(!hud.shown);
            shell.unlock();
        }

        // Over the lock screen.
        function test_onTheLockScreen() {
            shell.lock();
            keyClick(Qt.Key_F11);
            verify(hud.shown);
            tryCompare(hud, "opacity", 1, 1000);
            verify(hud.visible);
        }
    }
}
