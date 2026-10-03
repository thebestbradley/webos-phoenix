// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system's full-screen states (SystemScreens.qml): the Full Erase key
// chord and its countdown, the USB drive mode chord and storaged's signals
// (the brick screen, the check of the drive, "USB Drive connection
// failed"), the progress and boot animations, the frame rate counter and
// the touch plot.
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
        stayAwake: true
        source: SimWindowSource {
            id: windows
            property var calls: []
            property int failedAlerts: 0
            function lunaCall(uri, params, callback) {
                calls.push({ uri: uri, params: params });
                callback({ returnValue: true });
            }
            function showMsmEntryFailedAlert() { failedAlerts++; }
        }
        system: SimSystemStatus { id: status }
    }

    property var screens: shell.systemScreens
    SignalSpy { id: bootDone; target: shell.systemScreens; signalName: "bootFinished" }

    TestCase {
        name: "SystemScreens"
        when: windowShown

        function init() {
            shell.unlock();
            shell.forceActiveFocus();
            screens.resetKeys();
            screens.fullErase.pending = false;
            screens.cancelFullErase();
            windows.calls = [];
            windows.failedAlerts = 0;
            status.charging = false;
            status.volume = 50;
        }
        function callsTo(method) {
            return windows.calls.filter(function (c) { return c.uri.indexOf(method) >= 0; });
        }

        // Power and Volume Up held, then Home: the countdown, 6 to 0 a
        // second at a time; letting go of Volume Up puts it away.
        function test_fullEraseChordAndCancel() {
            keyPress(Qt.Key_F3);
            keyPress(Qt.Key_F11);
            compare(status.volume, 50, "Volume Up in the chord does not change the volume");
            keyClick(Qt.Key_Home);
            var erase = findChild(shell, "fullEraseConfirmation");
            verify(erase.shown);
            verify(!shell.launcherOpen, "Home was the chord's");
            compare(findChild(shell, "fullEraseTitle").text, "Full Erase");
            compare(findChild(shell, "fullEraseCountdown").text, "Continue holding for 6 seconds...");
            tryCompare(findChild(shell, "fullEraseCountdown"), "text", "Continue holding for 5 seconds...", 1500);
            keyRelease(Qt.Key_F11);
            verify(!erase.shown);
            keyRelease(Qt.Key_F3);
            // Power's release was the chord's: the screen stays on.
            verify(shell.display.on);
            compare(callsTo("EraseAll").length, 0);
        }

        // Held to the end: com.palm.storage/erase/EraseAll, and the
        // countdown stays while the device erases.
        function test_fullEraseConfirmed() {
            keyPress(Qt.Key_F11);
            keyPress(Qt.Key_F3);
            keyClick(Qt.Key_Home);
            var erase = findChild(shell, "fullEraseConfirmation");
            verify(erase.shown);
            tryCompare(findChild(shell, "fullEraseCountdown"), "text", "Continue holding for 1 second...", 6500);
            tryCompare(erase, "pending", true, 2500);
            compare(callsTo("palm://com.palm.storage/erase/EraseAll").length, 1);
            keyRelease(Qt.Key_F3);
            keyRelease(Qt.Key_F11);
            verify(erase.shown, "pending: it stays");
        }

        // Power and Volume Down: USB drive mode, on the USB charger only.
        function test_msmChord() {
            keyPress(Qt.Key_F3);
            keyClick(Qt.Key_F10);
            keyRelease(Qt.Key_F3);
            compare(callsTo("enterMSM").length, 0, "not charging");
            compare(status.volume, 50);
            status.charging = true;
            keyPress(Qt.Key_F10);
            keyPress(Qt.Key_F3);
            keyRelease(Qt.Key_F3);
            keyRelease(Qt.Key_F10);
            var c = callsTo("palm://com.palm.storage/diskmode/enterMSM");
            compare(c.length, 1);
            compare(c[0].params["user-confirmed"], true);
            verify(shell.display.on);
            // Not from the lock screen.
            shell.lock();
            keyPress(Qt.Key_F3);
            keyClick(Qt.Key_F10);
            keyRelease(Qt.Key_F3);
            compare(callsTo("enterMSM").length, 1);
        }

        // storaged's signals: the brick screen, a clean exit.
        function test_brickModeAndEject() {
            var brick = findChild(shell, "brickScreen");
            shell.storagedSignal("MSMProgress", { stage: "attempting", enterIMasq: false });
            verify(screens.brickMode);
            tryCompare(brick, "opacity", 1, 1000);
            verify(screens.holdsDisplay);
            shell.storagedSignal("MSMEntry", { "new-mode": "brick", enterIMasq: false });
            verify(screens.brickMode);
            // Home does nothing in USB drive mode.
            keyClick(Qt.Key_Home);
            verify(!shell.launcherOpen);
            shell.storagedSignal("MSMEntry", { "new-mode": "phone", enterIMasq: false });
            verify(!screens.brickMode);
            verify(screens.msmExitClean);
            tryCompare(brick, "visible", false, 1000);
        }

        // Pulled without ejecting: the check, then back.
        function test_fsckThenUnplugged() {
            shell.storagedSignal("MSMProgress", { stage: "attempting", enterIMasq: false });
            shell.storagedSignal("MSMFscking", {});
            var progress = findChild(shell, "progressAnimation");
            verify(progress.running);
            compare(progress.type, "fsck");
            tryCompare(findChild(shell, "progressTitle"), "visible", true, 1000);
            compare(findChild(shell, "progressTitle").text, "OWWW! That hurts!");
            compare(findChild(shell, "progressDescription").text, "Next time, please unmount the drive from the desktop.");
            shell.storagedSignal("MSMAvail", { "mode-avail": false });
            verify(!screens.brickMode);
            verify(!screens.fscking);
            // It grows and fades, 700 ms.
            tryCompare(progress, "running", false, 1500);
        }

        // storaged could not take the drive: "USB Drive connection failed".
        function test_entryFailed() {
            shell.storagedSignal("MSMProgress", { stage: "attempting", enterIMasq: false });
            shell.storagedSignal("MSMProgress", { stage: "failed", enterIMasq: false });
            verify(!screens.brickMode);
            compare(windows.failedAlerts, 1);
        }

        function test_msmEntryFailedAlert() {
            var c = Qt.createComponent("../qml/Phoenix/Shell/MsmEntryFailedAlert.qml");
            var alert = c.createObject(root, { width: 320, height: 160 });
            verify(alert);
            compare(findChild(alert, "msmEntryFailedTitle").text, "USB Drive connection failed");
            var ok = findChild(alert, "msmEntryFailedOk");
            fuzzyCompare(ok.y + ok.height, 160, 1);
            alert.destroy();
        }

        // runProgressAnimation: the glow pulses; stop grows and fades it.
        function test_progressAnimation() {
            var progress = findChild(shell, "progressAnimation");
            screens.startProgressAnimation("msm");
            compare(progress.type, "msm");
            verify(findChild(shell, "progressPicture").visible);
            tryVerify(function () { return progress.brightness > 0.3; }, 2500);
            screens.startProgressAnimation("fsck");
            compare(progress.type, "msm", "one at a time");
            screens.stopProgressAnimation();
            verify(progress.running);
            tryCompare(progress, "running", false, 1500);
            screens.startProgressAnimation("hp");
            compare(progress.type, "logo");
            screens.stopProgressAnimation();
            tryCompare(progress, "running", false, 1500);
        }

        // The boot animation: the logo's glow climbs by 8 every 80 ms from
        // -128; finishing it is the boot (the sound), then 700 ms of fade.
        function test_bootAnimation() {
            var boot = screens.boot;
            bootDone.clear();
            screens.startBoot(false);
            verify(boot.running);
            compare(boot.mode, "logo");
            compare(boot.glowAlpha, -128);
            tryVerify(function () { return boot.glowAlpha > -100; }, 1000);
            verify(findChild(shell, "bootLogo").visible);
            // The screen stays held from the logo through the fade, never
            // let go in between (dock mode would start, then be ended).
            var drops = 0;
            var held = function () { if (!screens.holdsDisplay) ++drops; };
            screens.holdsDisplayChanged.connect(held);
            screens.finishBoot();
            compare(drops, 0);
            screens.holdsDisplayChanged.disconnect(held);
            compare(bootDone.count, 1);
            screens.finishBoot();
            compare(bootDone.count, 1, "once");
            verify(boot.running);
            tryCompare(boot, "running", false, 1500);
            compare(boot.opacity, 0);
        }

        // "Updating the system": the progress in 20 frames, then the logo.
        function test_updatingTheSystem() {
            var boot = screens.boot;
            screens.startBoot(true);
            compare(boot.mode, "activity");
            verify(findChild(shell, "bootActivity").visible);
            compare(findChild(shell, "bootActivityLine1").text, "Updating the system");
            screens.bootProgress(50, 100);
            compare(boot.progress, 10);
            var spun = boot.spinnerFrame;
            tryVerify(function () { return boot.spinnerFrame !== spun; }, 500);
            screens.bootProgress(100, 100);
            compare(boot.progress, 20);
            tryCompare(boot, "mode", "logo", 500);
            screens.finishBoot();
            tryCompare(boot, "running", false, 1500);
        }

        // enableFpsCounter / enableTouchPlot.
        function test_debugOverlays() {
            var fps = findChild(shell, "fpsCounter");
            verify(!fps.visible);
            screens.debugOverlay({ fpsCounter: { enable: true } });
            verify(fps.visible);
            compare(fps.x, 0);
            compare(fps.y + fps.height, shell.height);
            compare(screens.debugOverlays.fpsCounter, true);
            screens.debugOverlay({ fpsCounter: { reset: 5 } });
            compare(fps.historySize, 5);
            screens.debugOverlay({ fpsCounter: { enable: false } });
            verify(!fps.visible);

            var plot = findChild(shell, "touchPlot");
            verify(!plot.visible);
            screens.debugOverlay({ touchPlot: { trails: true, crosshairs: true } });
            verify(plot.visible);
            compare(screens.debugOverlays.touchPlot.trails, true);
            mousePress(shell, 100, 200);
            mouseMove(shell, 120, 210);
            mouseMove(shell, 140, 220);
            mouseRelease(shell, 140, 220);
            var h = plot.history[0];
            verify(h && h.length >= 3, "pressed, moved, released");
            compare(h[0].state, "pressed");
            compare(h[h.length - 1].state, "released");
            compare(plot.touchesDown, 0);
            // A new touch clears the old paths.
            mouseClick(shell, 50, 50);
            compare(plot.history[0][0].x, 50);
            screens.debugOverlay({ touchPlot: { trails: false, crosshairs: false } });
            verify(!plot.visible);
            compare(plot.history.length, 0);
        }
    }
}
