// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's bird (AssistantBird.qml, docs/ASSISTANT-CHARACTER.md):
// every pose of art/assistant-bird/bird.json reaches its values; a lifted
// pose takes off with a squash and lands again; it blinks; the flames
// flicker; the beak moves while speaking; listening follows a level;
// each pose acts (motion.acting: its parts move through their loop), a
// pose change blends from wherever the loop is; with no motion (Reduce
// motion) it holds every pose still. Its moves (motion.moves): the
// entrance is born of embers, falls, lands with a squash and a dust cloud
// and settles at rest; the exit bursts into embers and is gone; each idle
// and reaction plays and comes back to rest; Reduce motion fades it in
// and out instead; Animation speed scales them. Its magic (magic): the
// aura glows by the pose and radiates rings, sparks come and go in the
// pose's share of the lanes, a mist now and then; held still under Reduce
// motion; none pile up as poses and moves come and go.

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

    // The moves as they start and end, and the effects played.
    QtObject {
        id: moved
        property var started: []
        property var ended: []
        property var fx: []
        property real minFade: 1
        property real maxFade: 0
        function reset() { started = []; ended = []; fx = []; minFade = maxFade = bird.fade; }
    }
    Connections {
        target: bird
        function onMoveStarted(name) { moved.started = moved.started.concat([name]); }
        function onMoveEnded(name) { moved.ended = moved.ended.concat([name]); }
        function onFxPlayed(name) { moved.fx = moved.fx.concat([name]); }
        function onFadeChanged() { moved.minFade = Math.min(moved.minFade, bird.fade); moved.maxFade = Math.max(moved.maxFade, bird.fade); }
    }

    TestCase {
        name: "AssistantBird"
        when: windowShown

        function init() {
            Theme.reduceMotion = false;
            Theme.animationSpeed = "normal";
            bird._endMove(false);
            bird.gone = false;
            bird.fade = 1;
            bird.gazeX = 0;
            bird.gazeY = 0;
            // Nothing by itself (but where a test asks for it).
            bird.fidgety = false;
            bird.level = -1;
            bird.pose = "idle";
            tryVerify(function () { return bird.atRest() && bird.movesAtRest(); }, 3000, "idle");
            moved.reset();
        }
        function cleanupTestCase() {
            Theme.reduceMotion = false;
            Theme.animationSpeed = "normal";
        }

        // How far each value a move's keys change must go, by channel.
        function wanted(m) {
            var props = ["rot", "tx", "ty", "sx", "sy"], want = [];
            for (var ch in m.steps) {
                for (var k = 0; k < props.length; ++k) {
                    var lo = Infinity, hi = -Infinity;
                    for (var j = 0; j < m.steps[ch].length; ++j) {
                        lo = Math.min(lo, m.steps[ch][j][k + 1]);
                        hi = Math.max(hi, m.steps[ch][j][k + 1]);
                    }
                    if (hi - lo > 0)
                        want.push({ ch: ch, prop: props[k], span: hi - lo });
                }
            }
            return want;
        }
        function unmet(want) {
            return JSON.stringify(want.filter(function (w) { return acted.span(w.ch, w.prop) < 0.6 * w.span; })
                                  .map(function (w) { return w.ch + "." + w.prop + " " + acted.span(w.ch, w.prop).toFixed(3) + "/" + w.span; }));
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
            bird.fidgety = true;
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

        // The entrance: hidden, born of a swirl of embers and a fireball,
        // up high; it falls stretched, lands with a squash and a dust
        // cloud, its crest flaring, and settles at rest (recorded as it goes).
        function test_theEntranceLandsAndSettles() {
            var m = bird.art.motion.moves.enter;
            acted.reset();
            var ms = bird.enter(0);
            compare(ms, Theme.motion(m.period));
            compare(bird.move, "enter");
            verify(bird.acts.whole.sx < 0.05 && bird.acts.whole.sy < 0.05, "hidden at first: " + bird.acts.whole.sx);
            // The fireball shows (it starts once its effect is shown).
            var ball = findChild(bird, "assistantBirdFxBall-fireball");
            tryVerify(function () { return ball.visible && ball.opacity > 0.5 && ball.scale > 0.5; }, m.period * 2, "the fireball bursts");
            tryVerify(function () { return moved.ended.indexOf("enter") >= 0; }, m.period * 4 + 3000, "the entrance, over");
            verify(acted.range.whole.ty[0] < -190, "born up high: " + acted.range.whole.ty[0]);
            verify(acted.range.body.sy[1] > 1.08, "stretched as it falls: " + acted.range.body.sy[1]);
            verify(acted.range.body.sy[0] < 0.8, "the landing squash: " + acted.range.body.sy[0]);
            verify(acted.span("wingL", "rot") > 90 && acted.span("wingR", "rot") > 90, "flapping");
            verify(acted.range.crest.sy[1] > 1.5, "the crest flaring: " + acted.range.crest.sy[1]);
            compare(moved.fx.join(" "), "swirl fireball dust surge");
            tryVerify(function () { return bird.movesAtRest() && bird.atRest(); }, 3000, "at rest");
            compare(bird.faceEyes, "");
            compare(bird.faceBeak, "");
            compare(bird.fade, 1);
            verify(!bird.gone);
            // Each part's acting and the loop's own values back where they were.
            for (var ch in bird.acts)
                verify(bird.acts[ch].rot === 0 && bird.acts[ch].tx === 0 && bird.acts[ch].ty === 0 && bird.acts[ch].sx === 1 && bird.acts[ch].sy === 1, ch);
        }

        // The exit: a crouch, a leap, it bursts into embers and is gone;
        // it enters again whole.
        function test_theExitBurstsIntoEmbers() {
            var m = bird.art.motion.moves.leave;
            acted.reset();
            bird.leave();
            verify(bird.gone);
            tryVerify(function () { return moved.ended.indexOf("leave") >= 0; }, m.period * 4 + 3000, "the exit, over");
            verify(acted.range.body.sy[0] < 0.85, "the crouch: " + acted.range.body.sy[0]);
            verify(acted.range.whole.ty[0] < -80, "the leap: " + acted.range.whole.ty[0]);
            verify(bird.acts.whole.sx < 0.05, "gone: " + bird.acts.whole.sx);
            compare(moved.fx.join(" "), "flash burst");
            // Its embers fly, then it fades away (its motion stops).
            tryCompare(bird, "fade", 0, 3000);
            verify(!bird._live);
            verify(!bird.react("giggle"), "no reactions while gone");
            moved.reset();
            bird.enter(0);
            compare(bird.fade, 1);
            verify(!bird.gone);
            tryVerify(function () { return moved.ended.indexOf("enter") >= 0 && bird.movesAtRest(); }, 6000, "back");
            compare(bird.acts.whole.sx, 1);
        }

        // Every move but the entrance and the exit (the idle pool, the
        // reactions) moves each part its keys name most of the way, and
        // comes back to rest, its face its pose's again.
        function test_everyMovePlaysAndReturns() {
            var moves = bird.art.motion.moves;
            var names = Object.keys(moves).filter(function (n) { return moves[n].kind === "idle" || moves[n].kind === "react"; });
            verify(names.length >= 14, names.join(" "));
            for (var i = 0; i < names.length; ++i) {
                var m = moves[names[i]];
                moved.reset();
                acted.reset();
                verify(bird.play(names[i]) > 0, names[i]);
                var want = wanted(m);
                tryVerify(function () { return moved.ended.indexOf(names[i]) >= 0; }, m.period * 4 + 3000, names[i] + " over");
                verify(want.every(function (w) { return acted.span(w.ch, w.prop) >= 0.6 * w.span; }), names[i] + ": " + unmet(want));
                // Its effects played.
                var fx = m.cues.filter(function (c) { return !!c.fx; }).map(function (c) { return c.fx; });
                compare(moved.fx.join(" "), fx.join(" "), names[i] + " effects");
                tryVerify(function () { return bird.movesAtRest(); }, 2000, names[i] + " at rest");
                compare(bird.faceEyes, "", names[i]);
                compare(bird.faceBeak, "", names[i]);
                // Its eyes and beak easing back from the face a cue gave.
                tryVerify(function () { return bird.atRest(); }, 2000, names[i] + " the pose's values");
            }
        }

        // A move's face for a moment: the stretch's yawn (sleepy eyes, the beak wide).
        function test_aMovesFace() {
            var seen = [];
            var c = function () { seen.push(bird.faceEyes + "/" + bird.faceBeak); };
            bird.faceEyesChanged.connect(c);
            bird.faceBeakChanged.connect(c);
            try {
                bird.idle("stretch");
                compare(bird.lastIdle, "stretch");
                tryVerify(function () { return moved.ended.indexOf("stretch") >= 0; }, 9000);
                verify(seen.indexOf("sleepy/wide") >= 0, "the yawn: " + seen);
            } finally {
                bird.faceEyesChanged.disconnect(c);
                bird.faceBeakChanged.disconnect(c);
            }
        }

        // Idle by itself: the look around and a full-body idle in turn,
        // one of the pool at random (never the same twice running).
        function test_theIdlePoolPlaysByItself() {
            var idle = bird.art.motion.acting.poses.idle;
            var pool = bird.art.motion.idles.pool;
            var before = bird.idles, played = [];
            var c = function (name) { if (pool.indexOf(name) >= 0) played.push(name); };
            bird.moveStarted.connect(c);
            try {
                bird.fidgety = true;
                tryVerify(function () { return played.length >= 2; }, 6 * (idle.every[1] + 2500), "two from the pool, by itself: " + played);
                verify(played[0] !== played[1], "not the same twice: " + played);
                verify(bird.fidgets > 0, "and looking around between them");
                verify(bird.idles >= before + 2);
            } finally {
                bird.moveStarted.disconnect(c);
                bird.fidgety = false;
            }
        }

        // A pose change ends an idle move where it is, blending away; a
        // reaction goes on.
        function test_aPoseChangeEndsAnIdleMove() {
            bird.idle("stretch");
            var w = bird.acts.wingL;
            tryVerify(function () { return w.rot > 60; }, 3000, "flippers up");
            var rot = w.rot;
            bird.pose = "thinking";
            verify(Math.abs(w.rot - rot) < 0.001, "no jump: " + w.rot + " " + rot);
            compare(bird.move, "");
            compare(moved.ended.join(" "), "stretch");
            tryVerify(function () { return bird.movesAtRest(); }, 2000, "blended away");
            bird.react("cheer");
            bird.pose = "idle";
            compare(bird.move, "cheer");
            tryVerify(function () { return moved.ended.indexOf("cheer") >= 0; }, 4000);
        }

        // A reaction plays once at a time (typing fast pecks steadily);
        // none while it enters.
        function test_reactionsDoNotPileUp() {
            verify(bird.react("peck"));
            verify(!bird.react("peck"), "not again while it plays");
            tryVerify(function () { return bird.move === ""; }, 3000);
            verify(bird.react("peck"), "again once over");
            bird.enter(0);
            verify(!bird.react("giggle"), "not while it enters");
            compare(bird.move, "enter");
        }

        // Its gaze moves its eyes and head; held still under Reduce motion.
        function test_theGazeFollows() {
            bird.gazeX = 1;
            bird.gazeY = 1;
            tryVerify(function () { return bird._gx === 1 && bird._gy === 1; }, 2000, "looking");
            var eyes = findChild(bird, "assistantBirdEyes");
            fuzzyCompare(eyes.transform[2].x, bird.art.motion.gaze.eyes[0], 0.001);
            fuzzyCompare(eyes.transform[2].y, bird.art.motion.gaze.eyes[1], 0.001);
            bird.gazeX = 0;
            bird.gazeY = 0;
            tryVerify(function () { return bird._gx === 0 && bird._gy === 0; }, 2000, "ahead again");
            Theme.reduceMotion = true;
            bird.gazeX = -1;
            compare(bird._gx, 0);
        }

        // Animation speed scales the moves (Fast: 60% of the time): the
        // lengths its animations are given. (Not the wall clock: Qt Quick's
        // animation driver advances animations a vsync interval per frame
        // drawn, qtdeclarative src/quick/scenegraph/qsgcontext.cpp
        // QSGAnimationDriver::advance, so with frames drawn faster than that
        // they end before their time by the wall clock.)
        function test_animationSpeedScalesTheMoves() {
            var m = bird.art.motion.moves.enter;
            function given() {
                var l = bird.acts.whole._ml, sum = 0;
                for (var i = 0; i < l.length; ++i)
                    sum += l[i];
                return sum;
            }
            compare(bird.enter(0), m.period);
            fuzzyCompare(given(), m.period, 11);
            Theme.animationSpeed = "fast";
            compare(bird.enter(0), Math.round(m.period * 0.6));
            // Each step rounded to the millisecond.
            fuzzyCompare(given(), m.period * 0.6, 11);
            tryVerify(function () { return moved.ended.indexOf("enter") >= 0 && bird.movesAtRest(); }, 6000, "played to its end");
        }

        // Reduce motion: it enters and leaves with a plain fade; no moves,
        // no effects, no reactions.
        function test_reducedMotionFadesInAndOut() {
            Theme.reduceMotion = true;
            var count = bird.moveCount;
            var ms = bird.leave();
            verify(bird.gone);
            tryCompare(bird, "fade", 0, ms + 2000);
            moved.reset();
            ms = bird.enter(0);
            compare(bird.fade, 0);
            tryCompare(bird, "fade", 1, ms + 2000);
            verify(moved.maxFade === 1 && moved.minFade === 0);
            verify(!bird.react("giggle"));
            compare(bird.play("spin"), 0);
            compare(bird.moveCount, count);
            compare(moved.fx.length, 0);
            verify(bird.movesAtRest());
            // Turned on as it enters: shown at once, still.
            Theme.reduceMotion = false;
            bird.enter(0);
            Theme.reduceMotion = true;
            compare(bird.move, "");
            compare(bird.fade, 1);
            verify(bird.movesAtRest());
        }

        // Reduce motion turned on mid-loop: the parts go to rest at once.
        function test_reducedMotionStopsTheActing() {
            bird.pose = "working";
            tryVerify(function () { return bird.acts.wingL.rot > 5; }, 2000, "pumping");
            Theme.reduceMotion = true;
            for (var ch in bird.acts)
                verify(!bird.acts[ch].isRunning() && bird.acts[ch].rot === 0 && bird.acts[ch].ty === 0 && bird.acts[ch].sy === 1, ch);
        }
    
        // ---- Magic ----
        function lane(i) {
            var l = findChild(bird, "assistantBirdSparkLane-" + i);
            verify(l, "spark lane " + i);
            return l;
        }
        // Its sparks showing now (a lane's come one after another: one at most).
        function lit(l) {
            var n = 0;
            for (var i = 0; i < l.children.length; ++i)
                if (l.children[i].opacity > 0)
                    ++n;
            return n;
        }

        // The aura glows by the pose, flickering with the crest and
        // radiating rings; the pose's share of the spark lanes show and
        // sparks come and go in them; idle mists now and then.
        function test_itsMagicIsThere() {
            var magic = bird.art.magic;
            var aura = findChild(bird, "assistantBirdAura");
            verify(aura && aura.visible);
            tryVerify(function () { return Math.abs(bird.auraLevel - magic.poses.idle[0]) < 0.001; }, 4000);
            var seen = {};
            tryVerify(function () { seen[aura.opacity.toFixed(3)] = true; return Object.keys(seen).length >= 4; }, 10000, "the aura breathing");
            var ring = findChild(bird, "assistantBirdAuraRing-0");
            verify(ring);
            // (Waits are generous: the animation clock runs behind the wall clock on a busy machine.)
            tryVerify(function () { return ring.opacity > 0.3 && ring.scale > magic.aura.rings.scale[0]; },
                      4 * (magic.aura.rings.period + magic.aura.rings.gap), "a ring radiating");
            compare(magic.sparkLanes.length, magic.sparks.lanes);
            var poses = Object.keys(bird.art.poses);
            for (var p = 0; p < poses.length; ++p) {
                bird.pose = poses[p];
                compare(bird.sparkLanes, magic.poses[poses[p]][1], poses[p]);
                for (var i = 0; i < magic.sparks.lanes; ++i)
                    compare(lane(i).shown, i < magic.poses[poses[p]][1], poses[p] + " lane " + i);
            }
            bird.pose = "done";
            tryVerify(function () { return Math.abs(bird.auraLevel - 1) < 0.001; }, 4000, "brighter as it celebrates");
            // Every lane plays (the pose shows its share); a spark lights in each.
            var lighted = {};
            tryVerify(function () {
                for (var i = 0; i < magic.sparks.lanes; ++i) {
                    verify(lane(i).playing, "lane " + i + " playing");
                    if (lit(lane(i)) > 0)
                        lighted[i] = true;
                }
                return Object.keys(lighted).length === magic.sparks.lanes;
            }, 6 * (2600 + 2600 + 1700), "sparks in every lane: " + JSON.stringify(lighted));
            bird.pose = "idle";
            var mist = findChild(bird, "assistantBirdMist");
            verify(mist.visible);
            tryCompare(mist, "opacity", 1, 4000);
            bird.pose = "confused";
            tryCompare(mist, "opacity", 0, 4000, "no mist when unsure");
            // Nor rings.
            tryCompare(ring, "opacity", 0, 4000, "no rings when unsure");
        }

        // Reduce motion: a faint still glow; no sparks, rings or mist, and nothing changes.
        function test_reducedMotionHoldsTheMagicStill() {
            bird.pose = "done";
            Theme.reduceMotion = true;
            var magic = bird.art.magic;
            var aura = findChild(bird, "assistantBirdAura");
            compare(bird.auraLevel, magic.poses.done[0] * magic.aura.still);
            fuzzyCompare(aura.opacity, bird.auraLevel, 0.0001);
            verify(aura.opacity > 0.3, "still a glow: " + aura.opacity);
            verify(!findChild(bird, "assistantBirdAuraRing-0"), "no rings");
            verify(!findChild(bird, "assistantBirdSparks").visible && !findChild(bird, "assistantBirdMist").visible);
            for (var i = 0; i < magic.sparks.lanes; ++i) {
                verify(!lane(i).playing, "lane " + i);
                compare(lit(lane(i)), 0, "lane " + i);
            }
            var o = aura.opacity, b = bird.auraBreath;
            wait(400);
            compare(aura.opacity, o);
            compare(bird.auraBreath, b);
            compare(bird.auraBreath, 0);
        }

        // As poses change and moves come and go (the entrance, cheers),
        // each lane still lights one spark at most; the surge plays once a
        // move, not more; while it enters or leaves, none.
        function test_theMagicDoesNotPileUp() {
            var magic = bird.art.magic;
            var poses = Object.keys(bird.art.poses);
            var most = 0, surges = 0;
            var c = function (name) { if (name === "surge") ++surges; };
            bird.fxPlayed.connect(c);
            try {
                for (var r = 0; r < 3; ++r) {
                    for (var p = 0; p < poses.length; ++p) {
                        bird.pose = poses[p];
                        bird.react("cheer");
                        wait(60);
                        for (var i = 0; i < magic.sparks.lanes; ++i)
                            most = Math.max(most, lit(lane(i)));
                    }
                }
                verify(most <= 1, "one spark a lane at most: " + most);
                bird.pose = "idle";
                tryVerify(function () { return bird.move === ""; }, 8000);
                surges = 0;
                bird.enter(0);
                verify(!bird._sparkling, "none while it is born");
                tryVerify(function () { return moved.ended.indexOf("enter") >= 0; }, 15000);
                compare(surges, 1, "one surge as it lands");
                verify(bird._sparkling, "sparkling again");
                for (var j = 0; j < magic.sparks.lanes; ++j)
                    verify(lane(j).playing, "lane " + j);
            } finally {
                bird.fxPlayed.disconnect(c);
            }
        }
    }
}
