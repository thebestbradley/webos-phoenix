// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The display: dim, off, locked, kept on, woken by alerts (Display.qml), and
// the shell's Power and Home with it.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    Display {
        id: display
        // 1 s: dim at 667 ms, off 333 ms later.
        timeout: 1
        lockedOffTimeout: 200
        alertTimeout: 200
    }
    SignalSpy { id: offs; target: display; signalName: "turnedOff" }

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: status }
    }

    TestCase {
        name: "Display"
        when: windowShown

        function init() {
            display.locked = false;
            display.blocked = false;
            display.stayAwake = false;
            display.timeout = 1;
            display.turnOn();
            offs.clear();
            status.screenTimeout = 60;
            shell.unlock();
            shell.forceActiveFocus();
        }

        function test_dimsThenTurnsOff() {
            compare(display.state, "on");
            wait(450);
            compare(display.state, "on", "two thirds of the timeout");
            tryCompare(display, "state", "dim", 600);
            wait(150);
            compare(display.state, "dim");
            tryCompare(display, "state", "off", 500);
            compare(offs.count, 1);
        }

        function test_inputBringsItBack() {
            tryCompare(display, "state", "dim", 1000);
            display.activity();
            compare(display.state, "on");
            // And the timer starts again.
            wait(450);
            compare(display.state, "on");
            // Off, input does nothing: only Power or Home (turnOn).
            display.turnOff();
            display.activity();
            compare(display.state, "off");
        }

        function test_lockedTurnsOffSooner() {
            display.timeout = 60;
            display.locked = true;
            tryCompare(display, "state", "off", 400);
            compare(offs.count, 1);
        }

        function test_blockedStaysOnUnlessLocked() {
            display.blocked = true;
            wait(1300);
            compare(display.state, "on", "an app keeps it on");
            display.locked = true;
            tryCompare(display, "state", "off", 400, "not on the lock screen");
        }

        function test_stayAwake() {
            display.stayAwake = true;
            wait(1300);
            compare(display.state, "on");
            display.turnOff();
            compare(display.state, "off", "Power still turns it off");
        }

        function test_alertTurnsItOnForAWhile() {
            display.turnOff();
            offs.clear();
            display.alert(false);
            compare(display.state, "on");
            tryCompare(display, "state", "off", 400);
            compare(offs.count, 1);
            // Touched meanwhile: it stays the user's.
            display.alert(false);
            display.activity();
            wait(300);
            compare(display.state, "on");
        }

        function test_callStaysOnWhileItRings() {
            display.turnOff();
            display.alert(true);
            wait(400);
            compare(display.state, "on");
            display.callDone();
            compare(display.state, "off");
            // From dim, back to dim.
            display.turnOn();
            tryCompare(display, "state", "dim", 1000);
            display.alert(true);
            compare(display.state, "on");
            display.callDone();
            compare(display.state, "dim");
        }

        // ---- The shell ----

        function test_powerTurnsTheScreenOffAndLocks() {
            compare(shell.display.state, "on");
            keyClick(Qt.Key_F3);
            compare(shell.display.state, "off");
            verify(shell.locked);
            // Off, the gestures do nothing...
            keyClick(Qt.Key_F1);
            verify(!shell.launcherOpen);
            compare(shell.display.state, "off");
            // ...and Home turns it on, to the lock screen.
            keyClick(Qt.Key_Home);
            compare(shell.display.state, "on");
            verify(shell.locked);
            verify(!shell.launcherOpen);
            // Power: off again, then on.
            keyClick(Qt.Key_F3);
            compare(shell.display.state, "off");
            keyClick(Qt.Key_F3);
            compare(shell.display.state, "on");
            verify(shell.locked);
        }

        function test_offTouchesGoNowhere() {
            shell.lock();
            shell.display.turnOff();
            var before = shell.display.state;
            mouseClick(shell, 160, 240);
            compare(shell.display.state, before);
            verify(shell.locked);
        }

        // phoenix-sim: a click on the dark screen wakes it (to the lock
        // screen), as F3 would; the click itself goes nowhere.
        function test_tapToWake() {
            shell.tapToWake = true;
            shell.display.turnOff();
            mouseClick(shell, 160, 240);
            compare(shell.display.state, "on");
            verify(shell.locked);
            shell.tapToWake = false;
        }

        function test_screenTimeoutLocks() {
            status.screenTimeout = 1;
            tryCompare(shell.display, "state", "dim", 1000);
            tryCompare(shell, "locked", true, 600);
            compare(shell.display.state, "off");
        }

        function test_chargerTurnsItOn() {
            shell.display.turnOff();
            status.charging = true;
            compare(shell.display.state, "on");
            status.charging = false;
        }

        // setWindowProperties {blockScreenTimeout}: on while the card is in
        // front, and only then.
        function test_appKeepsTheScreenOn() {
            status.screenTimeout = 1;
            var uid = windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximizeProgress = 1;
            windows._hostMessage("org.webosphoenix.email", uid, "windowProperties", { blockScreenTimeout: true });
            verify(shell.display.blocked);
            wait(1300);
            compare(shell.display.state, "on");
            // In card view the timeout is back.
            shell.cardView.maximizeProgress = 0;
            verify(!shell.display.blocked);
            tryCompare(shell.display, "state", "dim", 1000);
            windows.close(uid);
        }

        function test_unlockTurnsItOn() {
            shell.display.turnOff();
            shell.unlock();
            compare(shell.display.state, "on");
        }
    }
}
