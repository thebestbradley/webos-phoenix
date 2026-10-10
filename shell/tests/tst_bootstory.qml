// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The start-up story (BootStory.qml, BootAnimation.qml's logo at start-up
// with Settings > Advanced > Start-up animation: Phoenix): its beats in
// order; finish() before the end waits for the wave, after it ends at once;
// a tap skips; the screen is held throughout; turned to the Home button;
// Reduce motion; Classic is the original glow.
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
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: status }
    }

    property var screens: shell.systemScreens
    property var boot: shell.systemScreens.boot
    SignalSpy { id: bootDone; target: shell.systemScreens; signalName: "bootFinished" }

    TestCase {
        name: "BootStory"
        when: windowShown

        // The story in 60% of its time (Animation speed: Fast).
        function init() {
            status.reduceMotion = false;
            status.tweaks = { animationSpeed: "fast" };
            shell.homeButtonOrientationAngle = 0;
            bootDone.clear();
        }
        function cleanup() {
            if (boot.running) {
                if (boot.story)
                    boot.story.end();
                screens.finishBoot();
                tryCompare(boot, "running", false, 2000);
            }
        }
        // The screen is held from now until the end (counted drops).
        property int drops: 0
        function held() { if (!screens.holdsDisplay) ++drops; }

        function test_beatsInOrderAndFinishWaitsForTheWave() {
            drops = 0;
            screens.holdsDisplayChanged.connect(held);
            screens.startBoot(false);
            verify(boot.storyShown, "the story, not the glow");
            verify(!findChild(shell, "bootLogo").visible);
            compare(boot.story.beat, "orb");
            verify(findChild(shell, "bootStoryOrb").visible);
            // The boot is over at once: the sound, but the story plays on.
            screens.finishBoot();
            compare(bootDone.count, 1);
            verify(boot.finishPending);
            verify(boot.running);
            screens.finishBoot();
            compare(bootDone.count, 1, "once");
            tryCompare(boot.story, "beat", "burn", 4000);
            tryVerify(function () { return boot.story.scream > 0.9; }, 1000, "it screams");
            compare(boot.story.bird.visible, false);
            tryCompare(boot.story, "beat", "flight", 4000);
            verify(findChild(shell, "bootStoryFlyer").visible);
            tryCompare(boot.story, "beat", "enter", 4000);
            verify(boot.story.bird.visible);
            compare(boot.story.bird.move, "enter");
            tryCompare(boot.story, "beat", "wave", 3000);
            compare(boot.story.bird.pose, "hello");
            verify(boot.running, "waits for the wave");
            // The wave over, the transition (700 ms) and the screen is let go.
            tryCompare(boot, "running", false, 3000);
            compare(drops, 1, "held to the end, let go once");
            screens.holdsDisplayChanged.disconnect(held);
            compare(bootDone.count, 1);
        }

        function test_beatsPlayed() {
            screens.startBoot(false);
            var story = boot.story;
            tryCompare(story, "done", true, 10000);
            compare(story.beats, ["orb", "gold", "burn", "ash", "flight", "enter", "wave", "idle"]);
        }

        // A boot longer than the story: the bird stands, idle, until it is
        // over, then the transition at once.
        function test_finishAfterTheEnd() {
            screens.startBoot(false);
            tryCompare(boot.story, "done", true, 10000);
            compare(boot.story.beat, "idle");
            compare(boot.story.bird.pose, "idle");
            verify(boot.story.bird.fidgety);
            verify(boot.running);
            verify(screens.holdsDisplay);
            wait(300);
            verify(boot.running, "waits for the boot");
            screens.finishBoot();
            verify(!boot.finishPending);
            verify(boot.running, "the transition");
            tryCompare(boot, "running", false, 1500);
        }

        // A tap skips to the wave; once the boot is over, to the end.
        function test_tapSkips() {
            screens.startBoot(false);
            tryCompare(boot.story, "beat", "burn", 4000);
            mouseClick(shell, 100, 100);
            compare(boot.story.beat, "wave");
            verify(boot.story.bird.visible);
            compare(boot.story.bird.pose, "hello");
            verify(!findChild(shell, "bootStoryOrb").visible);
            tryCompare(boot.story, "done", true, 2000);
            screens.finishBoot();
            tryCompare(boot, "running", false, 1500);

            screens.startBoot(false);
            tryCompare(boot.story, "beat", "gold", 3000);
            screens.finishBoot();
            verify(boot.finishPending);
            mouseClick(shell, 100, 100);
            verify(!boot.finishPending, "straight to the finish");
            tryCompare(boot, "running", false, 1500);
        }

        // HomeButtonOrientationAngle: upright with the button below; the
        // ground, where the bird lands, toward the button.
        function test_turnedToTheHomeButton() {
            shell.homeButtonOrientationAngle = 270;
            screens.startBoot(false);
            var stage = findChild(shell, "bootStoryStage");
            compare(stage.rotation, 270);
            compare(stage.width, shell.height);
            compare(stage.height, shell.width);
            var orb = findChild(shell, "bootStoryOrb");
            var o = orb.mapToItem(shell, 0, 0);
            fuzzyCompare(o.x, shell.width / 2, 2);
            fuzzyCompare(o.y, shell.height / 2, 2);
            boot.story.skip();
            var b = boot.story.bird;
            var feet = b.mapToItem(shell, b.width / 2, b.height * 410 / 440);
            verify(feet.x > shell.width / 2 + 20, "the ground toward the right: " + feet.x);
            fuzzyCompare(feet.y, shell.height / 2, 2);
            shell.homeButtonOrientationAngle = 90;
            feet = b.mapToItem(shell, b.width / 2, b.height * 410 / 440);
            verify(feet.x < shell.width / 2 - 20, "the ground toward the left: " + feet.x);
            // Everything inside the screen.
            var top = b.mapToItem(shell, b.width / 2, 0);
            verify(top.x > 0 && top.x < shell.width);
        }

        // Reduce motion: the bird, waving still, briefly.
        function test_reduceMotion() {
            status.reduceMotion = true;
            screens.startBoot(false);
            compare(boot.story.beat, "wave");
            verify(boot.story.bird.visible);
            verify(!boot.story.bird.animated);
            compare(boot.story.beats, ["wave"]);
            tryCompare(boot.story, "done", true, 2500);
        }

        // Classic: the original glow, no story.
        function test_classic() {
            status.tweaks = { startupAnimation: "classic" };
            screens.startBoot(false);
            verify(!boot.storyShown);
            compare(boot.story, null);
            verify(findChild(shell, "bootLogo").visible);
            tryVerify(function () { return boot.glowAlpha > -100; }, 1000);
            screens.finishBoot();
            verify(!boot.finishPending);
            tryCompare(boot, "running", false, 1500);
        }

        // After "Updating the system", the logo is the glow (as before).
        function test_afterUpdatingTheGlow() {
            screens.startBoot(true);
            screens.bootProgress(100, 100);
            tryCompare(boot, "mode", "logo", 500);
            verify(!boot.storyShown);
            verify(findChild(shell, "bootLogo").visible);
            screens.finishBoot();
            tryCompare(boot, "running", false, 1500);
        }
    }
}
