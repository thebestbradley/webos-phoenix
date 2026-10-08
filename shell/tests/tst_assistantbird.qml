// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's bird (AssistantBird.qml, docs/ASSISTANT-CHARACTER.md):
// every pose of art/assistant-bird/bird.json reaches its values; a lifted
// pose takes off with a squash and lands again; it blinks; the flames
// flicker; the beak moves while speaking; listening follows a level;
// each pose acts (motion.acting: its parts move through their loop), a
// pose change blends from wherever the loop is; with no motion (Reduce
// motion) it holds every pose still.

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

    // The extremes values reach as they change: a squash or a blink lasts
    // a few frames, which polling may not see on a slow machine.
    QtObject {
        id: seen
        property real minSquash: 1
        property real maxSquash: 1
        property real minFlap: 1
        property real maxFlap: 0
        property real minBlink: 1
        function reset() { minSquash = maxSquash = bird.squashY; minFlap = maxFlap = bird.flap; minBlink = bird.blink; }
    }
    Connections {
        target: bird
        function onSquashYChanged() { seen.minSquash = Math.min(seen.minSquash, bird.squashY); seen.maxSquash = Math.max(seen.maxSquash, bird.squashY); }
        function onFlapChanged() { seen.minFlap = Math.min(seen.minFlap, bird.flap); seen.maxFlap = Math.max(seen.maxFlap, bird.flap); }
        function onBlinkChanged() { seen.minBlink = Math.min(seen.minBlink, bird.blink); }
    }

    // Each acting part's values as they change: the extremes reached, the changes made.
    QtObject {
        id: acted
        property var range: ({})
        property int changes: 0
        function reset() {
            var r = {};
            for (var ch in bird.acts) {
                var a = bird.acts[ch];
                r[ch] = { rot: [a.rot, a.rot], tx: [a.tx, a.tx], ty: [a.ty, a.ty], sx: [a.sx, a.sx], sy: [a.sy, a.sy] };
            }
            range = r;
            changes = 0;
        }
        function note(ch, prop, v) {
            if (!range[ch])
                return;
            var r = range[ch][prop];
            r[0] = Math.min(r[0], v);
            r[1] = Math.max(r[1], v);
            ++changes;
        }
        // How far a value went (max - min).
        function span(ch, prop) { return range[ch][prop][1] - range[ch][prop][0]; }
    }
    Instantiator {
        model: Object.keys(bird.acts)
        delegate: Connections {
            required property string modelData
            target: bird.acts[modelData]
            function onRotChanged() { acted.note(modelData, "rot", target.rot); }
            function onTxChanged() { acted.note(modelData, "tx", target.tx); }
            function onTyChanged() { acted.note(modelData, "ty", target.ty); }
            function onSxChanged() { acted.note(modelData, "sx", target.sx); }
            function onSyChanged() { acted.note(modelData, "sy", target.sy); }
        }
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
            seen.reset();
            bird.pose = "done";
            tryVerify(function () { return bird.atRest(); }, 3000, "up");
            compare(bird.lift, 46);
            verify(seen.minSquash < 0.95, "the take-off squash: " + seen.minSquash);
            verify(seen.maxSquash > 1.02, "the stretch going up: " + seen.maxSquash);
            seen.reset();
            bird.pose = "idle";
            tryVerify(function () { return bird.atRest(); }, 3000, "down");
            compare(bird.lift, 0);
            compare(bird.squashY, 1);
            verify(seen.maxSquash > 1.02, "stretched as it falls: " + seen.maxSquash);
            verify(seen.minSquash < 0.95, "the landing squash: " + seen.minSquash);
        }

        function test_itBlinks() {
            var before = bird.blinks;
            seen.reset();
            tryVerify(function () { return bird.blinks > before && !bird.blinking; }, 9000, "a blink, over");
            verify(seen.minBlink < 0.5, "the eyes shut: " + seen.minBlink);
            compare(bird.blink, 1);
        }

        // The flames never stop: each layer moves on its own.
        function test_theFlamesFlicker() {
            var f = flame();
            verify(f.running);
            var seen = {};
            tryVerify(function () { seen[f.sy.toFixed(2)] = true; return Object.keys(seen).length >= 4; }, 3000, "the crest moving");
        }

        function test_theBeakMovesWhileSpeaking() {
            seen.reset();
            bird.pose = "speaking";
            // A whole round of syllables: shut between them, open again.
            tryVerify(function () { return seen.minFlap < 0.4 && seen.maxFlap > 0.9 && bird.flap > 0.9; }, 4000, "the beak moving");
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

        // Every pose with acting moves each of its parts through its loop:
        // each value a key changes, recorded as it goes, reaches most of
        // the way to the keys' extremes (idle's occasional one played now).
        function test_everyPoseActs() {
            var acting = bird.art.motion.acting.poses;
            var props = ["rot", "tx", "ty", "sx", "sy"];
            var poses = Object.keys(acting);
            verify(poses.length >= 10, "most poses act: " + poses.join(" "));
            for (var i = 0; i < poses.length; ++i) {
                var a = acting[poses[i]];
                bird.pose = poses[i];
                acted.reset();
                if (a.every)
                    bird.fidget();
                var want = [];
                for (var ch in a.steps) {
                    for (var k = 0; k < props.length; ++k) {
                        var lo = Infinity, hi = -Infinity;
                        for (var j = 0; j < a.steps[ch].length; ++j) {
                            lo = Math.min(lo, a.steps[ch][j][k + 1]);
                            hi = Math.max(hi, a.steps[ch][j][k + 1]);
                        }
                        if (hi - lo > 0)
                            want.push({ ch: ch, prop: props[k], span: hi - lo });
                    }
                }
                verify(want.length > 0, poses[i] + " moves something");
                tryVerify(function () {
                    return want.every(function (w) { return acted.span(w.ch, w.prop) >= 0.7 * w.span; });
                }, a.period * 2 + 1500, poses[i] + " acting: " + JSON.stringify(want.filter(function (w) {
                    return acted.span(w.ch, w.prop) < 0.7 * w.span;
                }).map(function (w) { return w.ch + "." + w.prop + " " + acted.span(w.ch, w.prop).toFixed(3) + "/" + w.span; })));
            }
        }

        // A pose change goes on from wherever the loop is: no jump, then
        // the new pose's own loop (here, idle: at rest).
        function test_aPoseChangeBlendsFromTheLoop() {
            bird.pose = "hello";
            var w = bird.acts.wingR;
            tryVerify(function () { return w.rot < -12; }, 2000, "the wave under way");
            var rot = w.rot, ty = bird.acts.head.ty, hr = bird.acts.head.rot;
            bird.pose = "idle";
            verify(Math.abs(w.rot - rot) < 0.001, "the flipper where it was: " + w.rot + " " + rot);
            verify(Math.abs(bird.acts.head.rot - hr) < 0.001, "the head where it was: " + bird.acts.head.rot + " " + hr);
            verify(Math.abs(bird.acts.head.ty - ty) < 0.001, "the head where it was: " + bird.acts.head.ty + " " + ty);
            tryVerify(function () { return w.rot === 0 && !w.isRunning(); }, 2000, "eased back to rest");
        }

        // Idle looks around now and then, by itself: its timer plays the
        // loop (waited for as it happens, however late a slow machine runs
        // it), which moves the eyes and the body all the way through.
        function test_idleLooksAroundNowAndThen() {
            var idle = bird.art.motion.acting.poses.idle;
            var before = bird.fidgets;
            acted.reset();
            tryVerify(function () { return bird.fidgets > before; }, 4 * (idle.every[1] + idle.period), "a look around, by itself");
            acted.reset();
            tryVerify(function () { return acted.span("eyes", "tx") > 10 && acted.span("body", "rot") > 3; }, 4 * idle.period + 4000,
                      "looking one way and the other");
            tryVerify(function () { return !bird.isActing(); }, 4 * idle.period + 4000, "and settled");
            for (var ch in bird.acts)
                verify(bird.acts[ch].rot === 0 && bird.acts[ch].tx === 0 && bird.acts[ch].ty === 0, "at rest again: " + ch);
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
            // No acting: every part at rest, whatever the pose, and nothing changes.
            acted.reset();
            var poses = Object.keys(bird.art.poses);
            for (var i = 0; i < poses.length; ++i) {
                bird.pose = poses[i];
                bird.fidget();
                for (var ch in bird.acts) {
                    var a = bird.acts[ch];
                    verify(!a.isRunning() && a.rot === 0 && a.tx === 0 && a.ty === 0 && a.sx === 1 && a.sy === 1, poses[i] + " " + ch + " still");
                }
            }
            wait(300);
            compare(acted.changes, 0, "nothing moved");
        }

        // Reduce motion turned on mid-loop: the parts go to rest at once.
        function test_reducedMotionStopsTheActing() {
            bird.pose = "working";
            tryVerify(function () { return bird.acts.wingL.rot > 5; }, 2000, "pumping");
            Theme.reduceMotion = true;
            for (var ch in bird.acts)
                verify(!bird.acts[ch].isRunning() && bird.acts[ch].rot === 0 && bird.acts[ch].ty === 0 && bird.acts[ch].sy === 1, ch);
        }
    }
}
