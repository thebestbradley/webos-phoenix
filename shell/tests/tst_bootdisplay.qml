// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The screen during the boot: it stays on until the boot animation is over
// (BootupAnimation holds it: DisplayManager::pushDNAST "boot", as the
// progress sequence does), the lock screen's short timeout included; the
// timers start only once it has ended. The owner, 10 October 2026: the
// simulator's screen went off during the start-up story, which the lock
// screen's 5 s timeout cut short.
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
        // The screen may go off, as in phoenix-sim without --stay-awake.
        stayAwake: false
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: status }
    }

    property var screens: shell.systemScreens
    property var boot: shell.systemScreens.boot

    TestCase {
        name: "BootDisplay"
        when: windowShown

        function init() {
            status.reduceMotion = false;
            status.tweaks = { animationSpeed: "fast" };
            shell.display.lockedOffTimeout = 300;
            shell.display.turnOn();
        }
        function cleanup() {
            if (boot.running) {
                if (boot.story)
                    boot.story.end();
                screens.finishBoot();
                tryCompare(boot, "running", false, 3000);
            }
            shell.display.lockedOffTimeout = 5000;
        }

        // Booting on the lock screen (phoenix-sim starts there): the lock
        // screen's timeout waits for the end of the story.
        function test_lockScreenWaitsForTheStory() {
            shell.lock();
            screens.startBoot(false);
            verify(boot.storyShown);
            screens.finishBoot();
            // Far longer than the lock screen's timeout, the story still playing.
            wait(1500);
            verify(boot.running);
            compare(shell.display.state, "on", "on while the story plays");
            tryCompare(boot, "running", false, 10000);
            compare(shell.display.state, "on", "on as the story ends");
            // Then the lock screen's timeout, from the end of the boot.
            tryCompare(shell.display, "state", "off", 2000);
        }

        // The classic glow too, until the boot is over.
        function test_lockScreenWaitsForTheGlow() {
            status.tweaks = { animationSpeed: "fast", startupAnimation: "classic" };
            shell.lock();
            screens.startBoot(false);
            verify(!boot.storyShown);
            wait(1000);
            compare(shell.display.state, "on", "on while booting");
            screens.finishBoot();
            tryCompare(boot, "running", false, 3000);
            tryCompare(shell.display, "state", "off", 2000);
        }
    }
}
