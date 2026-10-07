// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's bird (AssistantBird.qml, docs/ASSISTANT-CHARACTER.md):
// every pose of art/assistant-bird/bird.json reaches its values; a lifted
// pose takes off with a squash and lands again; it blinks; the flames
// flicker; the beak moves while speaking; listening follows a level;
// with no motion (Reduce motion) it holds every pose still.

import QtQuick
import QtTest
import Phoenix.Shell

Item {
    id: root
    width: 480
    height: 480

    AssistantBird {
        id: bird
        width: 200
        x: 140
        y: 120
    }

    TestCase {
        name: "AssistantBird"
        when: windowShown

        function init() {
            Theme.reduceMotion = false;
            bird.level = -1;
            bird.pose = "idle";
            tryVerify(function () { return bird.atRest(); }, 3000, "idle");
        }
        function cleanupTestCase() {
            Theme.reduceMotion = false;
        }

        function flame(name) {
            var f = findChild(bird, "assistantBirdFlame");
            verify(f, "the crest's flame");
            return f;
        }

        // Each pose's table values, reached from idle and from the one before.
        function test_everyPoseReachesItsValues() {
            var poses = Object.keys(bird.art.poses);
            compare(poses.length, 12);
            compare(poses.join(" "), "asleep hello idle listening thinking working speaking done asking confused proud shy");
            for (var i = 0; i < poses.length; ++i) {
                bird.pose = poses[i];
                tryVerify(function () { return bird.atRest(); }, 3000, poses[i]);
                var p = bird.art.poses[poses[i]];
                fuzzyCompare(bird.tilt, p.tilt, 0.001);
                fuzzyCompare(bird.wingL, p.wingL, 0.001);
                fuzzyCompare(bird.wingR, p.wingR, 0.001);
                fuzzyCompare(bird.crestScale, p.crestScale, 0.001);
                fuzzyCompare(bird.lift, p.lift, 0.001);
                fuzzyCompare(bird.leftEye.height, bird.art.eyes[p.eyes].L[3], 0.001);
                // Its lids and closed eyes show, the others not.
                var overlays = Object.keys(bird.art.overlays);
                for (var k = 0; k < overlays.length; ++k) {
                    var o = findChild(bird, "assistantBirdOverlay-" + overlays[k]);
                    var on = bird.art.eyes[p.eyes].overlays.indexOf(overlays[k]) >= 0;
                    tryCompare(o, "opacity", on ? 1 : 0, 1000, poses[i] + " " + overlays[k]);
                }
                // Its extras show, the others not.
                var extras = Object.keys(bird.art.extras);
                for (var x = 0; x < extras.length; ++x) {
                    var e = findChild(bird, "assistantBirdExtra-" + extras[x]);
                    tryCompare(e, "opacity", p.extras.indexOf(extras[x]) >= 0 ? 1 : 0, 1000, poses[i] + " " + extras[x]);
                }
            }
        }

        // Done hops: down on its feet, up stretched, and back down with a squash.
        function test_aLiftedPoseHopsWithSquashAndStretch() {
            bird.pose = "done";
            tryVerify(function () { return bird.squashY < 0.95; }, 2000, "the take-off squash");
            tryVerify(function () { return bird.squashY > 1.02; }, 2000, "the stretch going up");
            tryVerify(function () { return bird.atRest(); }, 3000, "up");
            compare(bird.lift, 46);
            bird.pose = "idle";
            tryVerify(function () { return bird.squashY < 0.95 && bird.lift === 0; }, 2000, "the landing squash");
            tryVerify(function () { return bird.atRest(); }, 3000, "down");
            compare(bird.squashY, 1);
        }

        function test_itBlinks() {
            var before = bird.blinks;
            tryVerify(function () { return bird.blink < 0.5; }, 9000, "a blink");
            tryVerify(function () { return bird.blink === 1 && bird.blinks > before; }, 2000, "eyes open again");
        }

        // The flames never stop: each layer moves on its own.
        function test_theFlamesFlicker() {
            var f = flame();
            verify(f.running);
            var seen = {};
            tryVerify(function () { seen[f.sy.toFixed(2)] = true; return Object.keys(seen).length >= 4; }, 3000, "the crest moving");
        }

        function test_theBeakMovesWhileSpeaking() {
            bird.pose = "speaking";
            tryVerify(function () { return bird.flap < 0.4; }, 3000, "the beak shut between syllables");
            tryVerify(function () { return bird.flap > 0.9; }, 3000, "and open again");
            bird.pose = "idle";
            tryCompare(bird, "flap", 1, 2000);
        }

        // A level is followed; without one, a rhythm of its own.
        function test_listeningFollowsTheLevel() {
            bird.pose = "listening";
            bird.level = 0.8;
            tryCompare(bird, "voice", 0.8, 2000);
            bird.level = 0.2;
            tryCompare(bird, "voice", 0.2, 2000);
            bird.level = -1;
            var seen = {};
            tryVerify(function () { seen[bird.voice.toFixed(1)] = true; return Object.keys(seen).length >= 3; }, 3000, "its own rhythm");
        }

        // Reduce motion: no flicker, breath, blink or hop; poses change at once.
        function test_reducedMotionHoldsStill() {
            Theme.reduceMotion = true;
            verify(!bird.animated);
            var f = flame();
            tryVerify(function () { return !f.running && f.sx === 1 && f.sy === 1 && f.rot === 0; }, 1000, "the flame still");
            tryVerify(function () { return bird.breathX === 1 && bird.breathY === 1 && bird.blink === 1; }, 1000, "no breath, no blink");
            bird.pose = "done";
            // At once: no hop.
            compare(bird.lift, 46);
            compare(bird.squashY, 1);
            tryVerify(function () { return bird.atRest(); }, 1000);
            bird.pose = "speaking";
            tryVerify(function () { return bird.atRest(); }, 1000);
            verify(!bird.talking);
            compare(bird.flap, 1);
            bird.pose = "listening";
            verify(!f.running);
            compare(bird._voiced, 0);
        }
    }
}
