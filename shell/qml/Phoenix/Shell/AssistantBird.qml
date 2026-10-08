// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix Assistant's character (docs/ASSISTANT-CHARACTER.md): a black
// bean-shaped bird with a white tuxedo belly, flipper wings with golden
// tips, golden feet, a golden flame crest and a fan of tail flames that
// always burn, white pill-oval eyes and a two-part golden beak. Original
// art for Phoenix (art/assistant-bird/PROVENANCE.md); webOS had no assistant.
//
// Its shapes, poses and motion come from art/assistant-bird/bird.json
// through AssistantBirdData.js (tools/gen-assistant-bird.py), which the
// Assistant app's bird (apps/assistant/src/bird) is drawn from too. Drawn
// with Qt Quick Shapes from the SVG path data, in the drawing's 400 x 440
// units scaled to the item: crisp at any size and density.
//
// pose: one of BirdData.bird.poses (asleep, hello, idle, listening,
// thinking, working, speaking, done, asking, confused, proud, shy). The
// body's tilt and lift, the wings, the crest's size and lean, the eyes
// (each an oval that changes its size and place, with lids that slide in
// and closed-eye curves), the beak's opening and tilt and the extras
// (sparkles, embers, rings...) move to the new pose's values. A pose with
// a lift (done) takes off with a squash and a stretch, and lands with a
// squash when it ends. Asleep -> anything wakes with a little shake.
//
// While it shows: it breathes, blinks every few seconds (at random, now
// and then twice), its crest's three flames and its tail's two flicker,
// each at its own pace, with a slower gust over the crest, so the fire
// never repeats in step; speaking, the beak opens and closes in a
// syllable rhythm (the speech program gives no word timings); listening,
// the crest and the rings follow `level` (the microphone's loudness), or
// a lively rhythm without one. And every pose acts (motion.acting, `Act`
// below): a loop over its parts on top of the pose's values (hello waves,
// working bobs and pumps its flippers...; idle looks around now and then),
// and a pose change blends from wherever the loop is.
//
// Moves (motion.moves, played by play() on a layer of their own over the
// pose and its acting): the entrance (enter(): embers swirl in and a
// fireball bursts, the bird is born out of it flapping, its tail
// streaming, drops with a stretch, lands with a squash, a dust cloud and
// its crest flaring, bounces and settles), the exit (leave(): a crouch, a
// leap and it bursts into embers; then it is gone until it enters again),
// the idle pool (now and then, in turn with idle's look around: a
// stretch and a yawn, a hop, preening its tail, tapping a foot, peeking
// down, a shiver of its flames, looking up) and the reactions (react():
// a peck as a character is typed, a wince at a deletion, a curious tilt
// after a pause, a cheer as a request is sent, a giggle or a spin when
// tapped, a scoot when the keyboard moves it). Each is keys over its
// parts with curves that feel physical (falls ease in like gravity,
// throws ease out, landings spring back), cues for a moment's face
// (eyes, beak) and effects (particles: the embers, the fireball, dust
// puffs, all plain property animations over shapes). gazeX, gazeY: where
// it looks (the text it watches, a scroll it follows).
//
// All of it through Theme.motion (Settings > Advanced > Animation speed).
// With `animated` false (Reduce motion) every pose is held still: no
// flicker, breath, blink, hop, acting, moves, effects or beak flapping;
// poses change at once, it enters and leaves with a plain fade. The
// animations are plain property animations (no script runs per frame);
// Animators cannot scale unevenly about a point.

import QtQuick
import QtQuick.Shapes
import Phoenix.Shell
import "AssistantBirdData.js" as BirdData

Item {
    id: bird
    objectName: "assistantBird"

    property string pose: "idle"
    // Listening: the microphone's loudness, 0 to 1; below 0: none known.
    property real level: -1
    property bool animated: !Theme.reduceMotion
    // A soft warm light behind it (the flame's), so the black bird reads on
    // a dark ground (the assistant's view).
    property bool glow: false
    // Where it looks, -1 to 1 (motion.gaze): at the text it watches, along a scroll.
    property real gazeX: 0
    property real gazeY: 0
    // Plays the idle pool now and then (and idle's look around): off while
    // the user is busy with it (typing).
    property bool fidgety: true
    // Its own motion only while drawn.
    readonly property bool _live: animated && visible && opacity > 0
    // Shown (1) or gone (0): entering and leaving under Reduce motion fade it.
    property real fade: 1
    opacity: fade

    implicitWidth: 120
    implicitHeight: width * 1.1

    readonly property var art: BirdData.bird
    readonly property var poseSpec: art.poses[pose] || art.poses.idle
    // A move's moment of a face of its own (its cues), else the pose's.
    property string faceEyes: ""
    property string faceBeak: ""
    readonly property var _eyes: art.eyes[faceEyes || poseSpec.eyes]
    readonly property var _beak: art.beaks[faceBeak || poseSpec.beak]
    readonly property var _t: art.motion.transition
    readonly property var _pv: art.pivots

    // A quick nod (a reply without speech).
    function nod() {
        if (!animated)
            return;
        nodAnim.restart();
    }

    // Every value at its pose (tests, the review scene).
    function atRest() {
        var p = poseSpec, e = _eyes, b = _beak;
        function near(a, v) { return Math.abs(a - v) < 0.001; }
        return near(tilt, p.tilt) && near(lift, p.lift) && near(wingL, p.wingL) && near(wingR, p.wingR)
            && near(crestScale, p.crestScale) && near(crestRotation, p.crestRotation) && near(beakTilt, p.beakTilt)
            && near(eyeL.x, e.L[0]) && near(eyeL.y, e.L[1]) && near(eyeL.width, e.L[2]) && near(eyeL.height, e.L[3])
            && near(eyeR.x, e.R[0]) && near(eyeR.y, e.R[1]) && near(eyeR.width, e.R[2]) && near(eyeR.height, e.R[3])
            && near(eyesShown, e.show) && near(jawDy, b.jaw[0]) && near(jawSx, b.jaw[1]) && near(jawSy, b.jaw[2])
            && near(mouthSy, b.mouth[1]) && near(grin, b.grin) && near(upperSy, b.upper[1])
            && near(squashX, 1) && near(squashY, 1) && !liftUp.running && !liftDown.running;
    }

    // ---- The pose's values, eased to ----------------------------------------------------------
    property real tilt: poseSpec.tilt
    Behavior on tilt { NumberAnimation { duration: Theme.motion(bird._t.body); easing.type: Easing.InOutCubic } }
    property real wingL: poseSpec.wingL
    Behavior on wingL { NumberAnimation { duration: Theme.motion(bird._t.wings); easing.type: Easing.OutBack; easing.overshoot: 1.4 } }
    property real wingR: poseSpec.wingR
    Behavior on wingR { NumberAnimation { duration: Theme.motion(bird._t.wings); easing.type: Easing.OutBack; easing.overshoot: 1.4 } }
    property real crestScale: poseSpec.crestScale
    Behavior on crestScale { NumberAnimation { duration: Theme.motion(bird._t.crest); easing.type: Easing.OutBack; easing.overshoot: 1.2 } }
    property real crestRotation: poseSpec.crestRotation
    Behavior on crestRotation { NumberAnimation { duration: Theme.motion(bird._t.crest); easing.type: Easing.InOutCubic } }
    property real beakTilt: poseSpec.beakTilt
    Behavior on beakTilt { NumberAnimation { duration: Theme.motion(bird._t.beak); easing.type: Easing.InOutQuad } }
    property real shadowScale: poseSpec.lift > 0 ? 0.7 : 1
    Behavior on shadowScale { NumberAnimation { duration: Theme.motion(bird._t.body); easing.type: Easing.InOutQuad } }

    // The eyes: each an oval (centre and radii), drawn when eyesShown.
    property real eyesShown: _eyes.show
    Behavior on eyesShown { NumberAnimation { duration: Theme.motion(bird._t.eyes) } }
    QtObject {
        id: eyeL
        property real x: bird._eyes.L[0]
        property real y: bird._eyes.L[1]
        property real width: bird._eyes.L[2]
        property real height: bird._eyes.L[3]
        Behavior on x { NumberAnimation { duration: Theme.motion(bird._t.eyes); easing.type: Easing.InOutQuad } }
        Behavior on y { NumberAnimation { duration: Theme.motion(bird._t.eyes); easing.type: Easing.InOutQuad } }
        Behavior on width { NumberAnimation { duration: Theme.motion(bird._t.eyes); easing.type: Easing.InOutQuad } }
        Behavior on height { NumberAnimation { duration: Theme.motion(bird._t.eyes); easing.type: Easing.InOutQuad } }
    }
    QtObject {
        id: eyeR
        property real x: bird._eyes.R[0]
        property real y: bird._eyes.R[1]
        property real width: bird._eyes.R[2]
        property real height: bird._eyes.R[3]
        Behavior on x { NumberAnimation { duration: Theme.motion(bird._t.eyes); easing.type: Easing.InOutQuad } }
        Behavior on y { NumberAnimation { duration: Theme.motion(bird._t.eyes); easing.type: Easing.InOutQuad } }
        Behavior on width { NumberAnimation { duration: Theme.motion(bird._t.eyes); easing.type: Easing.InOutQuad } }
        Behavior on height { NumberAnimation { duration: Theme.motion(bird._t.eyes); easing.type: Easing.InOutQuad } }
    }
    readonly property alias leftEye: eyeL
    readonly property alias rightEye: eyeR

    // The beak: the lower jaw (dropped by jawDy, scaled from its top), the
    // mouth inside, the tongue, the grin's curved jaw, the upper beak
    // (scaled from its edge, raised by upperDy).
    property real jawDy: _beak.jaw[0]
    property real jawSx: _beak.jaw[1]
    property real jawSy: _beak.jaw[2]
    property real mouthSx: _beak.mouth[0]
    property real mouthSy: _beak.mouth[1]
    property real mouthShown: _beak.mouth[2]
    property real tongue: _beak.tongue
    property real grin: _beak.grin
    property real upperDy: _beak.upper[0]
    property real upperSy: _beak.upper[1]
    Behavior on jawDy { NumberAnimation { duration: Theme.motion(bird._t.beak); easing.type: Easing.OutQuad } }
    Behavior on jawSx { NumberAnimation { duration: Theme.motion(bird._t.beak); easing.type: Easing.OutQuad } }
    Behavior on jawSy { NumberAnimation { duration: Theme.motion(bird._t.beak); easing.type: Easing.OutQuad } }
    Behavior on mouthSx { NumberAnimation { duration: Theme.motion(bird._t.beak); easing.type: Easing.OutQuad } }
    Behavior on mouthSy { NumberAnimation { duration: Theme.motion(bird._t.beak); easing.type: Easing.OutQuad } }
    Behavior on mouthShown { NumberAnimation { duration: Theme.motion(bird._t.beak) } }
    Behavior on tongue { NumberAnimation { duration: Theme.motion(bird._t.beak) } }
    Behavior on grin { NumberAnimation { duration: Theme.motion(bird._t.beak) } }
    Behavior on upperDy { NumberAnimation { duration: Theme.motion(bird._t.beak); easing.type: Easing.OutQuad } }
    Behavior on upperSy { NumberAnimation { duration: Theme.motion(bird._t.beak); easing.type: Easing.OutQuad } }

    // ---- Lift: a hop, with a squash and a stretch --------------------------------------------
    property real lift: 0
    property real squashX: 1
    property real squashY: 1
    readonly property var _hop: art.motion.hop
    property real _liftTo: 0
    function _applyLift() {
        // From the pose itself: poseSpec may not have caught up yet here.
        var to = (art.poses[pose] || art.poses.idle).lift;
        if (Math.abs(to - lift) < 0.001 && !liftUp.running && !liftDown.running)
            return;
        liftUp.stop();
        liftDown.stop();
        _liftTo = to;
        if (!animated) {
            lift = to;
            squashX = 1;
            squashY = 1;
        } else if (to > lift) {
            liftUp.start();
        } else {
            liftDown.start();
        }
    }
    // Take-off: down on the knees, then up long and thin, round again at the top.
    SequentialAnimation {
        id: liftUp
        ParallelAnimation {
            NumberAnimation { target: bird; property: "squashX"; to: bird._hop.squash[0]; duration: Theme.motion(bird._hop.takeoff); easing.type: Easing.OutQuad }
            NumberAnimation { target: bird; property: "squashY"; to: bird._hop.squash[1]; duration: Theme.motion(bird._hop.takeoff); easing.type: Easing.OutQuad }
        }
        ParallelAnimation {
            NumberAnimation { target: bird; property: "lift"; to: bird._liftTo; duration: Theme.motion(bird._hop.rise); easing.type: Easing.OutCubic }
            SequentialAnimation {
                ParallelAnimation {
                    NumberAnimation { target: bird; property: "squashX"; to: bird._hop.stretch[0]; duration: Theme.motion(bird._hop.rise * 0.4); easing.type: Easing.OutQuad }
                    NumberAnimation { target: bird; property: "squashY"; to: bird._hop.stretch[1]; duration: Theme.motion(bird._hop.rise * 0.4); easing.type: Easing.OutQuad }
                }
                ParallelAnimation {
                    NumberAnimation { target: bird; property: "squashX"; to: 1; duration: Theme.motion(bird._hop.rise * 0.6); easing.type: Easing.InOutQuad }
                    NumberAnimation { target: bird; property: "squashY"; to: 1; duration: Theme.motion(bird._hop.rise * 0.6); easing.type: Easing.InOutQuad }
                }
            }
        }
    }
    // Landing: falls stretched, squashes on its feet, springs back.
    SequentialAnimation {
        id: liftDown
        ParallelAnimation {
            NumberAnimation { target: bird; property: "lift"; to: bird._liftTo; duration: Theme.motion(bird._hop.fall); easing.type: Easing.InQuad }
            NumberAnimation { target: bird; property: "squashX"; to: bird._hop.stretch[0]; duration: Theme.motion(bird._hop.fall); easing.type: Easing.InQuad }
            NumberAnimation { target: bird; property: "squashY"; to: bird._hop.stretch[1]; duration: Theme.motion(bird._hop.fall); easing.type: Easing.InQuad }
        }
        ParallelAnimation {
            NumberAnimation { target: bird; property: "squashX"; to: bird._hop.squash[0]; duration: Theme.motion(bird._hop.land); easing.type: Easing.OutQuad }
            NumberAnimation { target: bird; property: "squashY"; to: bird._hop.squash[1]; duration: Theme.motion(bird._hop.land); easing.type: Easing.OutQuad }
        }
        ParallelAnimation {
            NumberAnimation { target: bird; property: "squashX"; to: 1; duration: Theme.motion(bird._hop.settle); easing.type: Easing.OutBack }
            NumberAnimation { target: bird; property: "squashY"; to: 1; duration: Theme.motion(bird._hop.settle); easing.type: Easing.OutBack }
        }
    }

    // Waking: a little shake as it leaves sleep.
    property string _was: ""
    property real shake: 0
    SequentialAnimation {
        id: shakeAnim
        loops: 3
        NumberAnimation { target: bird; property: "shake"; to: -4; duration: Theme.motion(55); easing.type: Easing.InOutQuad }
        NumberAnimation { target: bird; property: "shake"; to: 4; duration: Theme.motion(70); easing.type: Easing.InOutQuad }
        NumberAnimation { target: bird; property: "shake"; to: 0; duration: Theme.motion(55); easing.type: Easing.InOutQuad }
    }
    property real nodAngle: 0
    SequentialAnimation {
        id: nodAnim
        NumberAnimation { target: bird; property: "nodAngle"; to: 7; duration: Theme.motion(130); easing.type: Easing.OutQuad }
        NumberAnimation { target: bird; property: "nodAngle"; to: 0; duration: Theme.motion(240); easing.type: Easing.InOutQuad }
    }

    onPoseChanged: {
        _applyLift();
        if (_was === "asleep" && pose !== "asleep" && animated && move !== "enter")
            shakeAnim.restart();
        _was = pose;
        // An idle move is idle's alone: it blends away.
        if (moveKind === "idle")
            _endMove(true);
    }
    onAnimatedChanged: {
        if (!animated) {
            shakeAnim.stop();
            nodAnim.stop();
            shake = 0;
            nodAngle = 0;
            _applyLift();
            // No moves: shown still, or gone.
            _endMove(false);
            fadeAnim.stop();
            goneAnim.stop();
            fade = gone ? 0 : 1;
        }
    }
    Component.onCompleted: {
        lift = poseSpec.lift;
        _liftTo = lift;
        _was = pose;
    }

    // ---- Acting: each pose's loops (motion.acting) ------------------------------------------------
    // Each part that acts plays its pose's loop on top of the pose's values:
    // hello waves, thinking taps its chin, working bobs and pumps... (the
    // table in docs/ASSISTANT-CHARACTER.md). Idle's look around comes now and
    // then, after a random gap like the blink.
    Act { id: actBody; channel: "body" }
    Act { id: actHead; channel: "head" }
    Act { id: actEyes; channel: "eyes" }
    Act { id: actLids; channel: "lids" }
    Act { id: actWingL; channel: "wingL" }
    Act { id: actWingR; channel: "wingR" }
    Act { id: actBeak; channel: "beak" }
    Act { id: actCrest; channel: "crest" }
    Act { id: actWhole; channel: "whole" }
    Act { id: actTail; channel: "tail" }
    Act { id: actFootL; channel: "footL" }
    Act { id: actFootR; channel: "footR" }
    readonly property var acts: ({ body: actBody, head: actHead, eyes: actEyes, lids: actLids, wingL: actWingL, wingR: actWingR,
                                   beak: actBeak, crest: actCrest, whole: actWhole, tail: actTail, footL: actFootL, footR: actFootR })
    readonly property var _every: (art.motion.acting.poses[pose] || {}).every
    // The occasional acting (idle's look around), now.
    function fidget() {
        for (var k in acts)
            acts[k].once();
        ++fidgets;
    }
    // Is any part acting?
    function isActing() {
        for (var k in acts)
            if (acts[k].isRunning())
                return true;
        return false;
    }
    property int fidgets: 0
    // Every random gap (like the blink's) plus the length of what plays
    // (the look around's loop, or a move), so one has ended before the next.
    function _fidgetInterval(ms) {
        var a = art.motion.acting.poses[pose];
        return a && a.every ? a.every[0] + Math.random() * (a.every[1] - a.every[0]) + Theme.motion(ms === undefined ? a.period : ms) : 1000;
    }
    // A full-body idle (motion.idles.pool) now: `name`, or one at random
    // (never the one before).
    property int idles: 0
    property string lastIdle: ""
    function idle(name) {
        var pool = art.motion.idles.pool;
        if (!name) {
            var others = pool.filter(function (n) { return n !== bird.lastIdle; });
            name = others[Math.floor(Math.random() * others.length)];
        }
        if (!play(name))
            return "";
        lastIdle = name;
        ++idles;
        return name;
    }
    // In turn: the look around, then one of the pool (none while a move plays).
    property bool _poolNext: false
    Timer {
        running: bird._live && bird._every !== undefined && bird.fidgety
        repeat: true
        interval: bird._fidgetInterval()
        onTriggered: {
            var ms;
            if (bird.move !== "") {
                ms = 0;
            } else if (bird._poolNext) {
                var name = bird.idle();
                ms = name ? bird.art.motion.moves[name].period : 0;
                bird._poolNext = false;
            } else {
                bird.fidget();
                bird._poolNext = true;
            }
            interval = bird._fidgetInterval(ms);
        }
    }

    // ---- Moves: the entrance, the exit, the idle pool, the reactions ------------------------------
    // The move playing ("" none), its kind; how many have started.
    property string move: ""
    property string moveKind: ""
    property int moveCount: 0
    signal moveStarted(string name)
    signal moveEnded(string name)
    // Left (leave()): gone until it enters again.
    property bool gone: false
    readonly property var _moves: art.motion.moves
    // Plays a move (motion.moves[name]) now, or after delay ms: over the
    // parts it names (each from wherever a move before left it, blending),
    // its cues at their moments. The time it takes, or 0 (none, or no motion).
    function play(name, delay) {
        var m = _moves[name];
        if (!m || !animated)
            return 0;
        delay = Math.max(0, delay || 0);
        var was = move;
        moveClock.stop();
        if (was !== "")
            moveEnded(was);
        faceEyes = "";
        faceBeak = "";
        for (var k in acts) {
            if (m.kind === "enter")
                acts[k].clearMove();
            else
                acts[k].cancelMove();
            acts[k].startMove(m, delay);
        }
        // The cues, each waited for from the one before; the end.
        var waits = [], cues = [], t = delay;
        for (var i = 0; i < 6; ++i) {
            var c = i < m.cues.length ? m.cues[i] : null;
            var at = c ? delay + Theme.motion(c.at * m.period) : t;
            waits.push(Math.max(0, at - t));
            cues.push(c);
            t = Math.max(t, at);
        }
        waits.push(Math.max(0, delay + Theme.motion(m.period) - t));
        _cues = cues;
        _cueWaits = waits;
        move = name;
        moveKind = m.kind;
        ++moveCount;
        moveStarted(name);
        moveClock.start();
        return delay + Theme.motion(m.period);
    }
    // A reaction (motion.reactions): not while it enters or leaves, nor
    // again while it plays (typing fast: a steady pecking).
    function react(name) {
        if (!animated || gone || moveKind === "enter" || moveKind === "leave" || move === name)
            return false;
        return play(name) > 0;
    }
    // Enters (after delay ms): the entrance, or under Reduce motion a fade.
    // The time it takes.
    readonly property int _fadeMs: Math.round(250 * Theme.animationScale)
    function enter(delay) {
        delay = Math.max(0, delay || 0);
        gone = false;
        shakeAnim.stop();
        shake = 0;
        fadeAnim.stop();
        goneAnim.stop();
        if (!animated) {
            _endMove(false);
            fade = 0;
            fadeAnim.wait = delay;
            fadeAnim.to = 1;
            fadeAnim.start();
            return delay + _fadeMs;
        }
        fade = 1;
        return play("enter", delay);
    }
    // Leaves: the exit (gone at its end), or under Reduce motion a fade.
    function leave() {
        fadeAnim.stop();
        gone = true;
        if (!animated) {
            _endMove(false);
            fadeAnim.wait = 0;
            fadeAnim.to = 0;
            fadeAnim.start();
            return _fadeMs;
        }
        return play("leave");
    }
    SequentialAnimation {
        id: fadeAnim
        property int wait: 0
        property real to: 1
        PauseAnimation { duration: fadeAnim.wait }
        NumberAnimation { target: bird; property: "fade"; to: fadeAnim.to; duration: bird._fadeMs; easing.type: Easing.InOutQuad }
    }
    // Ends the move playing: blending away from where it is, or at once.
    function _endMove(blend) {
        var was = move;
        moveClock.stop();
        for (var k in acts) {
            if (blend)
                acts[k].cancelMove();
            else
                acts[k].clearMove();
        }
        faceEyes = "";
        faceBeak = "";
        move = "";
        moveKind = "";
        if (was !== "")
            moveEnded(was);
    }
    function _cue(i) {
        var c = _cues[i];
        if (!c)
            return;
        if (c.eyes !== undefined)
            faceEyes = c.eyes;
        if (c.beak !== undefined)
            faceBeak = c.beak;
        if (c.fx && _fx[c.fx])
            _fx[c.fx].play();
    }
    function _moveDone() {
        var was = move, kind = moveKind;
        faceEyes = "";
        faceBeak = "";
        move = "";
        moveKind = "";
        // Left: gone (and its motion stops with it) once its embers have flown.
        if (kind === "leave")
            goneAnim.restart();
        moveEnded(was);
    }
    SequentialAnimation {
        id: goneAnim
        PauseAnimation { duration: Theme.motion(bird.art.effects.burst.period) }
        PropertyAction { target: bird; property: "fade"; value: 0 }
    }
    // Is any part moving (a move)?
    function isMoving() {
        for (var k in acts)
            if (acts[k].isMoving())
                return true;
        return false;
    }
    // Every move layer at rest (tests).
    function movesAtRest() {
        for (var k in acts) {
            var a = acts[k];
            if (a.isMoving() || a.mrot !== 0 || a.mtx !== 0 || a.mty !== 0 || a.msx !== 1 || a.msy !== 1)
                return false;
        }
        return true;
    }
    property var _cues: [null, null, null, null, null, null]
    property var _cueWaits: [0, 0, 0, 0, 0, 0, 0]
    // The cues' clock (set only while stopped: see Act's _steps).
    SequentialAnimation {
        id: moveClock
        PauseAnimation { duration: bird._cueWaits[0] }
        ScriptAction { script: bird._cue(0) }
        PauseAnimation { duration: bird._cueWaits[1] }
        ScriptAction { script: bird._cue(1) }
        PauseAnimation { duration: bird._cueWaits[2] }
        ScriptAction { script: bird._cue(2) }
        PauseAnimation { duration: bird._cueWaits[3] }
        ScriptAction { script: bird._cue(3) }
        PauseAnimation { duration: bird._cueWaits[4] }
        ScriptAction { script: bird._cue(4) }
        PauseAnimation { duration: bird._cueWaits[5] }
        ScriptAction { script: bird._cue(5) }
        PauseAnimation { duration: bird._cueWaits[6] }
        ScriptAction { script: bird._moveDone() }
    }

    // ---- Gaze: where it looks ------------------------------------------------------------------------
    readonly property var _gz: art.motion.gaze
    property real _gx: animated ? Math.max(-1, Math.min(1, gazeX)) : 0
    property real _gy: animated ? Math.max(-1, Math.min(1, gazeY)) : 0
    Behavior on _gx { enabled: bird.animated; NumberAnimation { duration: Theme.motion(bird._gz.ms); easing.type: Easing.OutCubic } }
    Behavior on _gy { enabled: bird.animated; NumberAnimation { duration: Theme.motion(bird._gz.ms); easing.type: Easing.OutCubic } }
    // How high above the ground it is (the hop, a move's leap), for its shadow.
    readonly property real _air: Math.max(0, lift - actBody.ty - actWhole.ty)

    // ---- Breathing and blinking -----------------------------------------------------------------
    readonly property var _breath: art.motion.breath
    property real breathX: 1
    property real breathY: 1
    SequentialAnimation {
        running: bird._live
        loops: Animation.Infinite
        ParallelAnimation {
            NumberAnimation { target: bird; property: "breathX"; to: bird._breath.scaleX; duration: Theme.motion(bird._breath.period / 2); easing.type: Easing.InOutSine }
            NumberAnimation { target: bird; property: "breathY"; to: bird._breath.scaleY; duration: Theme.motion(bird._breath.period / 2); easing.type: Easing.InOutSine }
        }
        ParallelAnimation {
            NumberAnimation { target: bird; property: "breathX"; to: 1; duration: Theme.motion(bird._breath.period / 2); easing.type: Easing.InOutSine }
            NumberAnimation { target: bird; property: "breathY"; to: 1; duration: Theme.motion(bird._breath.period / 2); easing.type: Easing.InOutSine }
        }
        onRunningChanged: if (!running) { bird.breathX = 1; bird.breathY = 1; }
    }

    // 1 open, toward 0 shut.
    property real blink: 1
    readonly property var _blink: art.motion.blink
    property int blinks: 0
    readonly property bool blinking: blinkAnim.running
    Timer {
        id: blinkTimer
        running: bird._live && bird.eyesShown > 0.5
        // At random from the first one on (birds side by side do not blink together).
        interval: bird._blink.minGap + Math.random() * (bird._blink.maxGap - bird._blink.minGap)
        onTriggered: {
            blinkAnim.loops = Math.random() < bird._blink.twice ? 2 : 1;
            blinkAnim.restart();
            ++bird.blinks;
            interval = bird._blink.minGap + Math.random() * (bird._blink.maxGap - bird._blink.minGap);
            restart();
        }
    }
    SequentialAnimation {
        id: blinkAnim
        NumberAnimation { target: bird; property: "blink"; to: 0.08; duration: Theme.motion(bird._blink.close); easing.type: Easing.InQuad }
        PauseAnimation { duration: Theme.motion(bird._blink.hold) }
        NumberAnimation { target: bird; property: "blink"; to: 1; duration: Theme.motion(bird._blink.open); easing.type: Easing.OutQuad }
    }
    on_LiveChanged: if (!_live) { blinkAnim.stop(); blink = 1; }

    // ---- Speaking: the beak in a syllable rhythm ----------------------------------------------
    // 1 open as the pose has it, toward 0 shut.
    property real flap: 1
    readonly property var _speech: art.motion.speech
    readonly property bool talking: pose === "speaking" && _live
    SequentialAnimation {
        id: talkAnim
        running: bird.talking
        loops: Animation.Infinite
        NumberAnimation { target: bird; property: "flap"; to: bird._speech[0][0]; duration: Theme.motion(bird._speech[0][1]); easing.type: Easing.InOutSine }
        NumberAnimation { target: bird; property: "flap"; to: bird._speech[1][0]; duration: Theme.motion(bird._speech[1][1]); easing.type: Easing.InOutSine }
        NumberAnimation { target: bird; property: "flap"; to: bird._speech[2][0]; duration: Theme.motion(bird._speech[2][1]); easing.type: Easing.InOutSine }
        NumberAnimation { target: bird; property: "flap"; to: bird._speech[3][0]; duration: Theme.motion(bird._speech[3][1]); easing.type: Easing.InOutSine }
        NumberAnimation { target: bird; property: "flap"; to: bird._speech[4][0]; duration: Theme.motion(bird._speech[4][1]); easing.type: Easing.InOutSine }
        NumberAnimation { target: bird; property: "flap"; to: bird._speech[5][0]; duration: Theme.motion(bird._speech[5][1]); easing.type: Easing.InOutSine }
        NumberAnimation { target: bird; property: "flap"; to: bird._speech[6][0]; duration: Theme.motion(bird._speech[6][1]); easing.type: Easing.InOutSine }
        NumberAnimation { target: bird; property: "flap"; to: bird._speech[7][0]; duration: Theme.motion(bird._speech[7][1]); easing.type: Easing.InOutSine }
        onRunningChanged: if (!running) flapRest.restart()
    }
    NumberAnimation { id: flapRest; target: bird; property: "flap"; to: 1; duration: Theme.motion(bird._t.beak) }

    // ---- Listening: the voice, 0 to 1 -----------------------------------------------------------
    readonly property var _listen: art.motion.listen
    property real listenShown: pose === "listening" ? 1 : 0
    Behavior on listenShown { NumberAnimation { duration: Theme.motion(bird._t.extras) } }
    property real voice: 0
    Binding on voice {
        when: bird.level >= 0
        value: Math.max(0, Math.min(1, bird.level))
        restoreMode: Binding.RestoreNone
    }
    Behavior on voice {
        enabled: bird.level >= 0 && bird.animated
        NumberAnimation { duration: 80 }
    }
    SequentialAnimation {
        running: bird._live && bird.pose === "listening" && bird.level < 0
        loops: Animation.Infinite
        NumberAnimation { target: bird; property: "voice"; to: bird._listen[0][0]; duration: Theme.motion(bird._listen[0][1]); easing.type: Easing.InOutSine }
        NumberAnimation { target: bird; property: "voice"; to: bird._listen[1][0]; duration: Theme.motion(bird._listen[1][1]); easing.type: Easing.InOutSine }
        NumberAnimation { target: bird; property: "voice"; to: bird._listen[2][0]; duration: Theme.motion(bird._listen[2][1]); easing.type: Easing.InOutSine }
        NumberAnimation { target: bird; property: "voice"; to: bird._listen[3][0]; duration: Theme.motion(bird._listen[3][1]); easing.type: Easing.InOutSine }
        NumberAnimation { target: bird; property: "voice"; to: bird._listen[4][0]; duration: Theme.motion(bird._listen[4][1]); easing.type: Easing.InOutSine }
        NumberAnimation { target: bird; property: "voice"; to: bird._listen[5][0]; duration: Theme.motion(bird._listen[5][1]); easing.type: Easing.InOutSine }
        onRunningChanged: if (!running && bird.level < 0) bird.voice = 0
    }
    readonly property real _voiced: voice * listenShown * (animated ? 1 : 0)

    // ---- The drawing -----------------------------------------------------------------------------
    // A part of the drawing: its path, filled or stroked, in the drawing's units.
    component Part: Shape {
        id: part
        property string name
        readonly property var spec: BirdData.bird.parts[name]
        readonly property var colors: BirdData.bird.colors
        preferredRendererType: Shape.CurveRenderer
        opacity: spec.opacity !== undefined ? spec.opacity : 1
        ShapePath {
            fillColor: part.spec.fill ? part.colors[part.spec.fill] : "transparent"
            strokeColor: part.spec.stroke ? part.colors[part.spec.stroke] : "transparent"
            strokeWidth: part.spec.stroke ? part.spec.width : -1
            capStyle: ShapePath.RoundCap
            joinStyle: ShapePath.RoundJoin
            PathSvg { path: part.spec.d }
        }
    }

    // One step of a flicker: to key k (of motion.flicker's keys4) in its share of the period.
    component FlickStep: ParallelAnimation {
        id: step
        property Item flame
        property var from
        property var to
        property real period
        readonly property int length: Theme.motion(Math.abs(to[0] - from[0]) * period)
        NumberAnimation { target: step.flame; property: "sx"; to: step.to[1]; duration: step.length; easing.type: Easing.BezierSpline; easing.bezierCurve: [0.42, 0, 0.58, 1, 1, 1] }
        NumberAnimation { target: step.flame; property: "sy"; to: step.to[2]; duration: step.length; easing.type: Easing.BezierSpline; easing.bezierCurve: [0.42, 0, 0.58, 1, 1, 1] }
        NumberAnimation { target: step.flame; property: "rot"; to: step.to[3]; duration: step.length; easing.type: Easing.BezierSpline; easing.bezierCurve: [0.42, 0, 0.58, 1, 1, 1] }
        NumberAnimation { target: step.flame; property: "opacity"; to: step.to[4]; duration: step.length; easing.type: Easing.BezierSpline; easing.bezierCurve: [0.42, 0, 0.58, 1, 1, 1] }
    }
    // Flickers what it holds (motion.flicker[name]): scaled and turned about
    // its pivot through its keys and back, over and over (CSS's alternate).
    component Flicker: Item {
        id: fl
        property string name
        property bool running: false
        readonly property var f: BirdData.bird.motion.flicker[name]
        readonly property var k: f.keys4
        // At rest (not flickering): as drawn.
        property real sx: 1
        property real sy: 1
        property real rot: 0
        transform: [
            Scale { origin.x: fl.f.pivot[0]; origin.y: fl.f.pivot[1]; xScale: fl.sx; yScale: fl.sy },
            Rotation { origin.x: fl.f.pivot[0]; origin.y: fl.f.pivot[1]; angle: fl.rot }
        ]
        SequentialAnimation {
            running: fl.running
            loops: Animation.Infinite
            FlickStep { flame: fl; from: fl.k[0]; to: fl.k[1]; period: fl.f.period }
            FlickStep { flame: fl; from: fl.k[1]; to: fl.k[2]; period: fl.f.period }
            FlickStep { flame: fl; from: fl.k[2]; to: fl.k[3]; period: fl.f.period }
            FlickStep { flame: fl; from: fl.k[3]; to: fl.k[2]; period: fl.f.period }
            FlickStep { flame: fl; from: fl.k[2]; to: fl.k[1]; period: fl.f.period }
            FlickStep { flame: fl; from: fl.k[1]; to: fl.k[0]; period: fl.f.period }
            onRunningChanged: if (!running) { fl.sx = 1; fl.sy = 1; fl.rot = 0; fl.opacity = 1; }
        }
    }

    // One of the extras' parts, moving as its extra does (motion: float,
    // twinkle, pulse, bob), the index-th of them later by stagger.
    component ExtraPart: Item {
        id: xp
        property string name
        property var extra: ({ motion: "", parts: [], period: 0, stagger: 0, dy: 0, scale: 1, low: 1 })
        property int index
        property bool running: false
        readonly property var box: BirdData.bird.parts[name].bbox
        property real dy: 0
        property real grow: 1
        property real fade: 1
        readonly property bool floats: extra.motion === "float"
        opacity: fade
        transform: [
            Scale { origin.x: (xp.box[0] + xp.box[2]) / 2; origin.y: (xp.box[1] + xp.box[3]) / 2; xScale: xp.grow; yScale: xp.grow },
            Translate { y: xp.dy }
        ]
        Part { name: xp.name }
        SequentialAnimation {
            running: xp.running
            loops: Animation.Infinite
            PauseAnimation { duration: Theme.motion(xp.extra.stagger * xp.index) }
            // float: rises (or falls) by dy, fading in and out.
            ParallelAnimation {
                NumberAnimation { target: xp; property: "dy"; from: 0; to: xp.floats ? xp.extra.dy : 0; duration: xp.floats ? Theme.motion(xp.extra.period) : 0 }
                SequentialAnimation {
                    NumberAnimation { target: xp; property: "fade"; from: xp.floats ? 0 : 1; to: 1; duration: xp.floats ? Theme.motion(xp.extra.period * 0.25) : 0 }
                    PauseAnimation { duration: xp.floats ? Theme.motion(xp.extra.period * 0.45) : 0 }
                    NumberAnimation { target: xp; property: "fade"; to: xp.floats ? 0 : 1; duration: xp.floats ? Theme.motion(xp.extra.period * 0.3) : 0 }
                }
            }
            // twinkle, pulse, bob: there and back.
            NumberAnimation {
                target: xp
                property: xp.extra.motion === "twinkle" ? "grow" : xp.extra.motion === "pulse" ? "fade" : "dy"
                to: xp.extra.motion === "twinkle" ? xp.extra.scale : xp.extra.motion === "pulse" ? xp.extra.low : xp.extra.motion === "bob" ? xp.extra.dy : 0
                duration: xp.floats ? 0 : Theme.motion(xp.extra.period)
                easing.type: Easing.InOutSine
            }
            NumberAnimation {
                target: xp
                property: xp.extra.motion === "twinkle" ? "grow" : xp.extra.motion === "pulse" ? "fade" : "dy"
                to: xp.extra.motion === "twinkle" ? 1 : xp.extra.motion === "pulse" ? 1 : 0
                duration: xp.floats ? 0 : Theme.motion(xp.extra.period)
                easing.type: Easing.InOutSine
            }
            PauseAnimation { duration: Theme.motion(xp.extra.stagger * (xp.extra.parts.length - 1 - xp.index)) }
            onRunningChanged: if (!running) { xp.dy = 0; xp.grow = 1; xp.fade = 1; }
        }
    }

    // One step of a part's acting loop: to key `to` ([at, rotation, x, y,
    // scale x, scale y]) from key `from`, in its share of the period.
    component ActStep: ParallelAnimation {
        id: astep
        property QtObject act
        property var from
        property var to
        property int length
        NumberAnimation { target: astep.act; property: "lrot"; to: astep.to[1]; duration: astep.length; easing.type: Easing.BezierSpline; easing.bezierCurve: [0.42, 0, 0.58, 1, 1, 1] }
        NumberAnimation { target: astep.act; property: "ltx"; to: astep.to[2]; duration: astep.length; easing.type: Easing.BezierSpline; easing.bezierCurve: [0.42, 0, 0.58, 1, 1, 1] }
        NumberAnimation { target: astep.act; property: "lty"; to: astep.to[3]; duration: astep.length; easing.type: Easing.BezierSpline; easing.bezierCurve: [0.42, 0, 0.58, 1, 1, 1] }
        NumberAnimation { target: astep.act; property: "lsx"; to: astep.to[4]; duration: astep.length; easing.type: Easing.BezierSpline; easing.bezierCurve: [0.42, 0, 0.58, 1, 1, 1] }
        NumberAnimation { target: astep.act; property: "lsy"; to: astep.to[5]; duration: astep.length; easing.type: Easing.BezierSpline; easing.bezierCurve: [0.42, 0, 0.58, 1, 1, 1] }
    }
    // One step of a move: to key `to` along `curve` (the Bezier into it).
    component MoveStep: ParallelAnimation {
        id: mstep
        property QtObject act
        property var to
        property var curve
        property int length
        NumberAnimation { target: mstep.act; property: "mrot"; to: mstep.to[1]; duration: mstep.length; easing.type: Easing.BezierSpline; easing.bezierCurve: mstep.curve }
        NumberAnimation { target: mstep.act; property: "mtx"; to: mstep.to[2]; duration: mstep.length; easing.type: Easing.BezierSpline; easing.bezierCurve: mstep.curve }
        NumberAnimation { target: mstep.act; property: "mty"; to: mstep.to[3]; duration: mstep.length; easing.type: Easing.BezierSpline; easing.bezierCurve: mstep.curve }
        NumberAnimation { target: mstep.act; property: "msx"; to: mstep.to[4]; duration: mstep.length; easing.type: Easing.BezierSpline; easing.bezierCurve: mstep.curve }
        NumberAnimation { target: mstep.act; property: "msy"; to: mstep.to[5]; duration: mstep.length; easing.type: Easing.BezierSpline; easing.bezierCurve: mstep.curve }
    }
    // A part's acting (motion.acting): the pose's loop for `channel`, on top
    // of the pose's values. rot, tx, ty, sx, sy are what the part's
    // transforms read: the loop's values (l...) with a blend (b...) that
    // starts where the part was when the pose changed and fades out over
    // `lead`, so a new loop never jumps (each loop starts and ends at rest).
    component Act: QtObject {
        id: act
        property string channel
        objectName: "assistantBirdAct-" + channel
        readonly property var acting: BirdData.bird.motion.acting
        readonly property var pivot: acting.pivot[channel]
        readonly property var spec: acting.poses[bird.pose] || null
        readonly property var keys: spec && spec.steps[channel] ? spec.steps[channel] : null
        readonly property bool live: bird._live
        // Whether it moves now (read when asked; see _steps for why a loop's
        // running is not to be trusted to notify if its children change).
        function isRunning() { return loop.running || blend.running; }
        property real lrot: 0
        property real ltx: 0
        property real lty: 0
        property real lsx: 1
        property real lsy: 1
        property real brot: 0
        property real btx: 0
        property real bty: 0
        property real bsx: 1
        property real bsy: 1
        // A move's layer (bird.play()).
        property real mrot: 0
        property real mtx: 0
        property real mty: 0
        property real msx: 1
        property real msy: 1
        readonly property real rot: lrot + brot + mrot
        readonly property real tx: ltx + btx + mtx
        readonly property real ty: lty + bty + mty
        readonly property real sx: lsx * bsx * msx
        readonly property real sy: lsy * bsy * msy

        // What the loop plays, set only while it is stopped: a running
        // animation group whose children change is rebuilt by Qt at its next
        // loop (or at once at its start) with its signals blocked, so a loop
        // bound to the pose would jump to the new pose's keys and could stop
        // without runningChanged (QQuickAnimationGroupPrivate::restartFromCurrentLoop).
        property var _steps: [_rest, _rest, _rest, _rest, _rest, _rest]
        property var _lengths: [0, 0, 0, 0, 0]
        function _load(k, period) {
            var l = [];
            for (var i = 0; i < 5; ++i)
                l.push(Theme.motion((k[i + 1][0] - k[i][0]) * period));
            _steps = k;
            _lengths = l;
        }
        function play() {
            // The loop's and the blend's (a move goes on over them).
            var r = lrot + brot, x = ltx + btx, y = lty + bty, w = lsx * bsx, h = lsy * bsy;
            loop.stop();
            blend.stop();
            lrot = 0; ltx = 0; lty = 0; lsx = 1; lsy = 1;
            if (!live) {
                brot = 0; btx = 0; bty = 0; bsx = 1; bsy = 1;
                return;
            }
            brot = r; btx = x; bty = y; bsx = w; bsy = h;
            blend.start();
            // From the pose itself (the bindings on it may not all have caught up).
            var a = acting.poses[bird.pose];
            // Over and over, or (idle's look around: every) now and then by bird.fidget().
            if (a && a.steps[channel] && a.every === undefined) {
                _load(a.steps[channel], a.period);
                loop.loops = Animation.Infinite;
                loop.start();
            }
        }
        // Played once now (the occasional ones).
        function once() {
            var a = acting.poses[bird.pose];
            if (live && a && a.steps[channel]) {
                loop.stop();
                _load(a.steps[channel], a.period);
                loop.loops = 1;
                loop.start();
            }
        }
        onKeysChanged: play()
        onLiveChanged: play()
        Component.onCompleted: play()

        // Moves: the move's keys for this part ([at, rotation, x, y, scale
        // x, scale y], 12), the curve into each and the steps' lengths.
        function isMoving() { return mover.running; }
        property var _mk: [_rest, _rest, _rest, _rest, _rest, _rest, _rest, _rest, _rest, _rest, _rest, _rest]
        property var _mc: [_io, _io, _io, _io, _io, _io, _io, _io, _io, _io, _io]
        property var _ml: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        property int _mdelay: 0
        readonly property var _io: [0.42, 0, 0.58, 1, 1, 1]
        function startMove(m, delay) {
            var k = m.steps[channel];
            if (!k)
                return;
            mover.stop();
            var l = [], c = [];
            for (var i = 0; i < 11; ++i) {
                l.push(Theme.motion((k[i + 1][0] - k[i][0]) * m.period));
                var b = m.curves[channel][i];
                c.push([b[0], b[1], b[2], b[3], 1, 1]);
            }
            _mk = k;
            _mc = c;
            _ml = l;
            _mdelay = delay;
            // From its first key (an entrance's: hidden, through its delay).
            mrot = k[0][1]; mtx = k[0][2]; mty = k[0][3]; msx = k[0][4]; msy = k[0][5];
            mover.start();
        }
        // Ends a move here: the blend takes it from where it is back to rest.
        function cancelMove() {
            mover.stop();
            if (mrot === 0 && mtx === 0 && mty === 0 && msx === 1 && msy === 1)
                return;
            brot += mrot; btx += mtx; bty += mty; bsx *= msx; bsy *= msy;
            mrot = 0; mtx = 0; mty = 0; msx = 1; msy = 1;
            if (live)
                blend.restart();
            else
                play();
        }
        // Ends a move here at once.
        function clearMove() {
            mover.stop();
            mrot = 0; mtx = 0; mty = 0; msx = 1; msy = 1;
        }

        property list<QtObject> _anims: [
            ParallelAnimation {
                id: blend
                NumberAnimation { target: act; property: "brot"; to: 0; duration: Theme.motion(act.acting.lead); easing.type: Easing.OutCubic }
                NumberAnimation { target: act; property: "btx"; to: 0; duration: Theme.motion(act.acting.lead); easing.type: Easing.OutCubic }
                NumberAnimation { target: act; property: "bty"; to: 0; duration: Theme.motion(act.acting.lead); easing.type: Easing.OutCubic }
                NumberAnimation { target: act; property: "bsx"; to: 1; duration: Theme.motion(act.acting.lead); easing.type: Easing.OutCubic }
                NumberAnimation { target: act; property: "bsy"; to: 1; duration: Theme.motion(act.acting.lead); easing.type: Easing.OutCubic }
            },
            SequentialAnimation {
                id: mover
                PauseAnimation { duration: act._mdelay }
                MoveStep { act: act; to: act._mk[1]; curve: act._mc[0]; length: act._ml[0] }
                MoveStep { act: act; to: act._mk[2]; curve: act._mc[1]; length: act._ml[1] }
                MoveStep { act: act; to: act._mk[3]; curve: act._mc[2]; length: act._ml[2] }
                MoveStep { act: act; to: act._mk[4]; curve: act._mc[3]; length: act._ml[3] }
                MoveStep { act: act; to: act._mk[5]; curve: act._mc[4]; length: act._ml[4] }
                MoveStep { act: act; to: act._mk[6]; curve: act._mc[5]; length: act._ml[5] }
                MoveStep { act: act; to: act._mk[7]; curve: act._mc[6]; length: act._ml[6] }
                MoveStep { act: act; to: act._mk[8]; curve: act._mc[7]; length: act._ml[7] }
                MoveStep { act: act; to: act._mk[9]; curve: act._mc[8]; length: act._ml[8] }
                MoveStep { act: act; to: act._mk[10]; curve: act._mc[9]; length: act._ml[9] }
                MoveStep { act: act; to: act._mk[11]; curve: act._mc[10]; length: act._ml[10] }
            },
            SequentialAnimation {
                id: loop
                ActStep { act: act; from: act._steps[0]; to: act._steps[1]; length: act._lengths[0] }
                ActStep { act: act; from: act._steps[1]; to: act._steps[2]; length: act._lengths[1] }
                ActStep { act: act; from: act._steps[2]; to: act._steps[3]; length: act._lengths[2] }
                ActStep { act: act; from: act._steps[3]; to: act._steps[4]; length: act._lengths[3] }
                ActStep { act: act; from: act._steps[4]; to: act._steps[5]; length: act._lengths[4] }
            }
        ]
        readonly property var _rest: [0, 0, 0, 0, 1, 1]
    }

    Item {
        id: drawing
        width: bird.art.viewBox[0]
        height: bird.art.viewBox[1]
        transform: Scale { xScale: bird.width / drawing.width; yScale: bird.width / drawing.width }

        // Smaller and fainter the higher it is; none before it is born.
        Part {
            name: "shadow"
            opacity: spec.opacity * (1 - 0.6 * Math.min(1, bird._air / 220))
            transform: Scale {
                origin.x: bird._pv.shadow[0]; origin.y: bird._pv.shadow[1]
                xScale: bird.shadowScale * (1 - 0.25 * Math.min(1, bird._air / 60)) * Math.min(1, Math.abs(actWhole.sy))
            }
        }

        // The bird, apart from the extras around it.
        Item {
            id: body
            objectName: "assistantBirdBody"
            transform: [
                Scale { origin.x: actBody.pivot[0]; origin.y: actBody.pivot[1]; xScale: actBody.sx; yScale: actBody.sy },
                Rotation { origin.x: actBody.pivot[0]; origin.y: actBody.pivot[1]; angle: actBody.rot },
                Translate { x: actBody.tx; y: actBody.ty },
                Scale { origin.x: bird._pv.breath[0]; origin.y: bird._pv.breath[1]; xScale: bird.breathX; yScale: bird.breathY },
                Scale { origin.x: bird._pv.feet[0]; origin.y: bird._pv.feet[1]; xScale: bird.squashX; yScale: bird.squashY },
                Rotation { origin.x: bird._pv.body[0]; origin.y: bird._pv.body[1]; angle: bird.tilt + bird.shake },
                Rotation { origin.x: bird._pv.feet[0]; origin.y: bird._pv.feet[1]; angle: bird.nodAngle + bird._gx * bird._gz.body },
                Translate { y: -bird.lift },
                Scale { origin.x: actWhole.pivot[0]; origin.y: actWhole.pivot[1]; xScale: actWhole.sx; yScale: actWhole.sy },
                Rotation { origin.x: actWhole.pivot[0]; origin.y: actWhole.pivot[1]; angle: actWhole.rot },
                Translate { x: actWhole.tx; y: actWhole.ty }
            ]

            Shape {
                visible: bird.glow
                preferredRendererType: Shape.CurveRenderer
                ShapePath {
                    strokeColor: "transparent"
                    fillGradient: RadialGradient {
                        centerX: 208; centerY: 236; centerRadius: 210
                        focalX: 208; focalY: 236
                        GradientStop { position: 0; color: "#40F2B705" }
                        GradientStop { position: 0.55; color: "#18F2B705" }
                        GradientStop { position: 1; color: "#00F2B705" }
                    }
                    PathSvg { path: "M-2 236 A210 210 0 1 0 418 236 A210 210 0 1 0 -2 236 Z" }
                }
            }
            Item {
                transform: [
                    Scale { origin.x: actTail.pivot[0]; origin.y: actTail.pivot[1]; xScale: actTail.sx; yScale: actTail.sy },
                    Rotation { origin.x: actTail.pivot[0]; origin.y: actTail.pivot[1]; angle: actTail.rot },
                    Translate { x: actTail.tx; y: actTail.ty }
                ]
                Flicker { name: "tail"; running: bird._live; Part { name: "tail" } }
                Flicker { name: "tailInner"; running: bird._live; Part { name: "tailInner" } }
            }

            // The crest: its three flames, under a slower gust, scaled and
            // turned by the pose, swelling with the voice as it listens.
            Item {
                id: crest
                objectName: "assistantBirdCrest"
                transform: [
                    Scale { xScale: actCrest.sx; yScale: actCrest.sy },
                    Rotation { angle: actCrest.rot },
                    Translate { x: actCrest.tx; y: actCrest.ty },
                    Scale {
                        origin.x: 0; origin.y: 6
                        xScale: 1 + bird.art.motion.level.crest * bird._voiced
                        yScale: 1 + bird.art.motion.level.crest * 1.4 * bird._voiced
                    },
                    Scale { xScale: bird.crestScale; yScale: bird.crestScale },
                    Rotation { angle: bird.crestRotation },
                    Translate { x: bird._pv.crest[0]; y: bird._pv.crest[1] },
                    Scale { origin.x: actHead.pivot[0]; origin.y: actHead.pivot[1]; xScale: actHead.sx; yScale: actHead.sy },
                    Rotation { origin.x: actHead.pivot[0]; origin.y: actHead.pivot[1]; angle: actHead.rot + bird._gx * bird._gz.head },
                    Translate { x: actHead.tx; y: actHead.ty + bird._gy * bird._gz.headY }
                ]
                Flicker {
                    name: "crestGust"
                    running: bird._live
                    Flicker { objectName: "assistantBirdFlame"; name: "crest"; running: bird._live; Part { name: "crest" } }
                    Flicker { name: "crestInner"; running: bird._live; Part { name: "crestInner" } }
                    Flicker { name: "crestCore"; running: bird._live; Part { name: "crestCore" } }
                }
            }

            Part {
                name: "footL"
                transform: [
                    Rotation { origin.x: actFootL.pivot[0]; origin.y: actFootL.pivot[1]; angle: actFootL.rot },
                    Translate { x: actFootL.tx; y: actFootL.ty }
                ]
            }
            Part {
                name: "footR"
                transform: [
                    Rotation { origin.x: actFootR.pivot[0]; origin.y: actFootR.pivot[1]; angle: actFootR.rot },
                    Translate { x: actFootR.tx; y: actFootR.ty }
                ]
            }
            Part { name: "body" }
            Part { name: "belly" }
            Item {
                transform: [
                    Scale { origin.x: actWingL.pivot[0]; origin.y: actWingL.pivot[1]; xScale: actWingL.sx; yScale: actWingL.sy },
                    Rotation { origin.x: actWingL.pivot[0]; origin.y: actWingL.pivot[1]; angle: actWingL.rot },
                    Translate { x: actWingL.tx; y: actWingL.ty },
                    Rotation { origin.x: bird._pv.wingL[0]; origin.y: bird._pv.wingL[1]; angle: bird.wingL }
                ]
                Part { name: "wingL" }
                Part { name: "wingTipL" }
            }
            Item {
                transform: [
                    Scale { origin.x: actWingR.pivot[0]; origin.y: actWingR.pivot[1]; xScale: actWingR.sx; yScale: actWingR.sy },
                    Rotation { origin.x: actWingR.pivot[0]; origin.y: actWingR.pivot[1]; angle: actWingR.rot },
                    Translate { x: actWingR.tx; y: actWingR.ty },
                    Rotation { origin.x: bird._pv.wingR[0]; origin.y: bird._pv.wingR[1]; angle: bird.wingR }
                ]
                Part { name: "wingR" }
                Part { name: "wingTipR" }
            }

            // The face (eyes, lids, beak) acts as the head (with the crest),
            // the eyes glance, the lids narrow.
            Item {
                id: face
                transform: [
                    Scale { origin.x: actHead.pivot[0]; origin.y: actHead.pivot[1]; xScale: actHead.sx; yScale: actHead.sy },
                    Rotation { origin.x: actHead.pivot[0]; origin.y: actHead.pivot[1]; angle: actHead.rot + bird._gx * bird._gz.head },
                    Translate { x: actHead.tx; y: actHead.ty + bird._gy * bird._gz.headY }
                ]
                Item {
                    id: eyeGroup
                    objectName: "assistantBirdEyes"
                    transform: [
                        Scale { origin.x: actEyes.pivot[0]; origin.y: actEyes.pivot[1]; xScale: actEyes.sx; yScale: actEyes.sy },
                        Rotation { origin.x: actEyes.pivot[0]; origin.y: actEyes.pivot[1]; angle: actEyes.rot },
                        Translate { x: actEyes.tx + bird._gx * bird._gz.eyes[0]; y: actEyes.ty + bird._gy * bird._gz.eyes[1] }
                    ]
                    // The eyes: ovals of radius 10 scaled to their radii, shut a
                    // little by a blink.
                    Part {
                        objectName: "assistantBirdEyeL"
                        name: "eye"
                        opacity: bird.eyesShown
                        visible: opacity > 0
                        transform: [
                            Scale { xScale: eyeL.width / 10; yScale: eyeL.height / 10 * bird.blink },
                            Translate { x: eyeL.x; y: eyeL.y }
                        ]
                    }
                    Part {
                        objectName: "assistantBirdEyeR"
                        name: "eye"
                        opacity: bird.eyesShown
                        visible: opacity > 0
                        transform: [
                            Scale { xScale: eyeR.width / 10; yScale: eyeR.height / 10 * bird.blink },
                            Translate { x: eyeR.x; y: eyeR.y }
                        ]
                    }
                    Item {
                        transform: [
                            Scale { origin.x: actLids.pivot[0]; origin.y: actLids.pivot[1]; xScale: actLids.sx; yScale: actLids.sy },
                            Rotation { origin.x: actLids.pivot[0]; origin.y: actLids.pivot[1]; angle: actLids.rot },
                            Translate { x: actLids.tx; y: actLids.ty }
                        ]
                        // Lids and closed eyes: slide in from their side as they appear.
                        Repeater {
                            model: Object.keys(bird.art.overlays)
                            delegate: Part {
                                id: overlay
                                required property string modelData
                                objectName: "assistantBirdOverlay-" + modelData
                                name: modelData
                                readonly property bool on: bird._eyes.overlays.indexOf(modelData) >= 0
                                opacity: on ? 1 : 0
                                visible: opacity > 0
                                Behavior on opacity { NumberAnimation { duration: Theme.motion(bird._t.eyes) } }
                                property real dy: on ? 0 : bird.art.overlays[modelData].dy
                                Behavior on dy { NumberAnimation { duration: Theme.motion(bird._t.eyes); easing.type: Easing.OutQuad } }
                                transform: Translate { y: overlay.dy }
                            }
                        }
                    }
                }

                // The beak.
                Item {
                    id: beak
                    objectName: "assistantBirdBeak"
                    transform: [
                        Scale { origin.x: actBeak.pivot[0]; origin.y: actBeak.pivot[1]; xScale: actBeak.sx; yScale: actBeak.sy },
                        Rotation { origin.x: actBeak.pivot[0]; origin.y: actBeak.pivot[1]; angle: actBeak.rot },
                        Translate { x: actBeak.tx; y: actBeak.ty },
                        Rotation { origin.x: bird._pv.beak[0]; origin.y: bird._pv.beak[1]; angle: bird.beakTilt }
                    ]
                    readonly property real open: bird.flap
                    Part {
                        name: "jaw"
                        opacity: 1 - bird.grin
                        transform: [
                            Scale { origin.x: bird._pv.jaw[0]; origin.y: bird._pv.jaw[1]; xScale: bird.jawSx; yScale: bird.jawSy * (0.62 + 0.38 * beak.open) },
                            Translate { y: bird.jawDy }
                        ]
                    }
                    Part {
                        name: "mouth"
                        opacity: bird.mouthShown
                        visible: opacity > 0
                        transform: Scale { origin.x: bird._pv.jaw[0]; origin.y: bird._pv.jaw[1]; xScale: bird.mouthSx; yScale: bird.mouthSy * beak.open }
                    }
                    Part {
                        name: "tongue"
                        opacity: bird.tongue
                        visible: opacity > 0
                        transform: Scale { origin.x: bird._pv.jaw[0]; origin.y: bird._pv.jaw[1]; yScale: 0.4 + 0.6 * beak.open }
                    }
                    Part { name: "grinJaw"; opacity: bird.grin; visible: opacity > 0 }
                    Part { name: "grinMouth"; opacity: bird.grin; visible: opacity > 0 }
                    Item {
                        transform: [
                            Scale { origin.x: bird._pv.upperBeak[0]; origin.y: bird._pv.upperBeak[1]; yScale: bird.upperSy + (1 - bird.upperSy) * (1 - beak.open) },
                            Translate { y: bird.upperDy * beak.open }
                        ]
                        Part { name: "upperBeak" }
                    }
                    Item {
                        transform: Translate { y: bird.upperDy * beak.open }
                        Part { name: "beakShine" }
                        Part { name: "nostrilL" }
                        Part { name: "nostrilR" }
                    }
                }
            }
        }

        // The extras around it: snores, sparkles, embers, the rings that
        // carry its listening (swelling with the voice), a question mark,
        // a sweat drop, the working dots.
        Repeater {
            model: Object.keys(bird.art.extras)
            delegate: Item {
                id: extraGroup
                required property string modelData
                readonly property var spec: bird.art.extras[modelData]
                readonly property bool on: bird.poseSpec.extras.indexOf(modelData) >= 0
                objectName: "assistantBirdExtra-" + modelData
                opacity: on ? 1 : 0
                visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: Theme.motion(bird._t.extras) } }
                readonly property bool rings: modelData === "rings"
                transform: Scale {
                    origin.x: bird._pv.rings[0]; origin.y: bird._pv.rings[1]
                    xScale: extraGroup.rings ? 1 + bird.art.motion.level.rings * bird._voiced : 1
                    yScale: extraGroup.rings ? 1 + bird.art.motion.level.rings * 0.5 * bird._voiced : 1
                }
                Repeater {
                    model: extraGroup.spec.parts
                    delegate: ExtraPart {
                        required property string modelData
                        required property int index
                        name: modelData
                        extra: extraGroup.spec
                        // The rings follow a known level rather than their own beat.
                        running: bird._live && extraGroup.visible && !(extraGroup.rings && bird.level >= 0)
                    }
                }
            }
        }

        // The effects (embers, the fireball, dust): each shown while it plays.
        Repeater {
            model: Object.keys(bird.art.effects)
            delegate: Fx {
                required property string modelData
                name: modelData
            }
        }
    }

    // ---- Effects (art.effects): particles, each a few property animations ---------------------------
    property var _fx: ({})
    property int fxCount: 0
    signal fxPlayed(string name)
    component Fx: Item {
        id: fx
        property string name
        objectName: "assistantBirdFx-" + name
        readonly property var spec: BirdData.bird.effects[name]
        readonly property var colors: BirdData.bird.colors
        property int plays: 0
        // A fireball behind the bird (born out of it); embers and dust over it.
        z: spec.kind === "glow" ? -1 : 1
        visible: showing.running
        function play() {
            if (!bird.animated)
                return;
            ++plays;
            showing.restart();
            ++bird.fxCount;
            bird.fxPlayed(name);
        }
        Component.onCompleted: bird._fx[name] = fx
        PauseAnimation { id: showing; duration: Theme.motion(fx.spec.period) + 1 }

        // glow: a ball of fire, scaled and faded through its keys.
        Shape {
            id: ball
            visible: fx.spec.kind === "glow"
            x: fx.spec.origin[0]
            y: fx.spec.origin[1]
            opacity: 0
            scale: 0
            transformOrigin: Item.TopLeft
            preferredRendererType: Shape.CurveRenderer
            readonly property real r: fx.spec.radius || 0
            ShapePath {
                strokeColor: "transparent"
                fillGradient: RadialGradient {
                    centerX: 0; centerY: 0; centerRadius: ball.r
                    focalX: 0; focalY: 0
                    GradientStop { position: 0; color: fx.colors.flameCore }
                    GradientStop { position: 0.3; color: fx.colors.flame }
                    GradientStop { position: 0.6; color: "#C0" + fx.colors.ember.substring(1) }
                    GradientStop { position: 1; color: "#00" + fx.colors.ember.substring(1) }
                }
                PathSvg { path: "M" + (-ball.r) + " 0 A" + ball.r + " " + ball.r + " 0 1 0 " + ball.r + " 0 A" + ball.r + " " + ball.r + " 0 1 0 " + (-ball.r) + " 0 Z" }
            }
            readonly property var k: fx.spec.keys4 || [[0, 0, 0, [0, 0, 1, 1]], [1, 0, 0, [0, 0, 1, 1]], [1, 0, 0, [0, 0, 1, 1]], [1, 0, 0, [0, 0, 1, 1]]]
            function step(i) { return Theme.motion((k[i + 1][0] - k[i][0]) * fx.spec.period); }
            function curve(i) { var c = k[i + 1][3]; return [c[0], c[1], c[2], c[3], 1, 1]; }
            Connections { target: fx; function onPlaysChanged() { if (fx.spec.kind === "glow") ballAnim.restart(); } }
            SequentialAnimation {
                id: ballAnim
                PropertyAction { target: ball; property: "scale"; value: ball.k[0][1] }
                PropertyAction { target: ball; property: "opacity"; value: ball.k[0][2] }
                ParallelAnimation {
                    NumberAnimation { target: ball; property: "scale"; to: ball.k[1][1]; duration: ball.step(0); easing.type: Easing.BezierSpline; easing.bezierCurve: ball.curve(0) }
                    NumberAnimation { target: ball; property: "opacity"; to: ball.k[1][2]; duration: ball.step(0); easing.type: Easing.BezierSpline; easing.bezierCurve: ball.curve(0) }
                }
                ParallelAnimation {
                    NumberAnimation { target: ball; property: "scale"; to: ball.k[2][1]; duration: ball.step(1); easing.type: Easing.BezierSpline; easing.bezierCurve: ball.curve(1) }
                    NumberAnimation { target: ball; property: "opacity"; to: ball.k[2][2]; duration: ball.step(1); easing.type: Easing.BezierSpline; easing.bezierCurve: ball.curve(1) }
                }
                ParallelAnimation {
                    NumberAnimation { target: ball; property: "scale"; to: ball.k[3][1]; duration: ball.step(2); easing.type: Easing.BezierSpline; easing.bezierCurve: ball.curve(2) }
                    NumberAnimation { target: ball; property: "opacity"; to: ball.k[3][2]; duration: ball.step(2); easing.type: Easing.BezierSpline; easing.bezierCurve: ball.curve(2) }
                }
                PropertyAction { target: ball; property: "opacity"; value: 0 }
            }
        }

        // swirl, puff, burst: their particles.
        Repeater {
            model: fx.spec.kind === "glow" ? [] : fx.spec.particles
            delegate: Item {
                id: pt
                required property var modelData
                readonly property string kind: fx.spec.kind
                readonly property int delay: Theme.motion(modelData[3])
                readonly property int length: Theme.motion(fx.spec.period - modelData[3])
                readonly property color tint: fx.colors[modelData[4] || "dust"]
                x: fx.spec.origin[0]
                y: fx.spec.origin[1]
                opacity: 0
                // swirl: turning (a) at a radius (r) about the origin; puff,
                // burst: out by (tx, ty); all sized by s.
                property real a: kind === "swirl" ? modelData[0] : 0
                property real r: kind === "swirl" ? modelData[1] : 0
                property real tx: 0
                property real ty: 0
                property real s: 1
                transform: [
                    Translate { x: pt.r + pt.tx; y: pt.ty },
                    Rotation { angle: pt.a }
                ]
                // An ember: a streak along its way round (swirl) or a spark,
                // in a faint halo.
                Rectangle {
                    visible: pt.kind !== "puff"
                    readonly property real size: pt.modelData[2] * 2.6
                    width: size; height: size; radius: size / 2
                    x: -size / 2; y: -size / 2
                    color: pt.tint
                    opacity: 0.3
                    scale: pt.s
                }
                Rectangle {
                    visible: pt.kind !== "puff"
                    readonly property real size: pt.modelData[2]
                    width: size; height: pt.kind === "swirl" ? size * 2.4 : size; radius: size / 2
                    x: -width / 2; y: -height / 2
                    color: pt.tint
                    scale: pt.s
                    Rectangle { anchors.centerIn: parent; width: parent.width * 0.45; height: parent.height * 0.45; radius: width / 2; color: fx.colors.flameCore }
                }
                // A dust cloud: soft at its edge.
                Shape {
                    id: cloud
                    visible: pt.kind === "puff"
                    readonly property real rr: pt.kind === "puff" ? pt.modelData[2] : 0
                    scale: pt.s
                    transformOrigin: Item.TopLeft
                    preferredRendererType: Shape.CurveRenderer
                    ShapePath {
                        strokeColor: "transparent"
                        fillGradient: RadialGradient {
                            centerX: 0; centerY: 0; centerRadius: cloud.rr
                            focalX: 0; focalY: 0
                            GradientStop { position: 0; color: "#E0" + fx.colors.dust.substring(1) }
                            GradientStop { position: 0.55; color: "#90" + fx.colors.dust.substring(1) }
                            GradientStop { position: 1; color: "#00" + fx.colors.dust.substring(1) }
                        }
                        PathSvg { path: "M" + (-cloud.rr) + " 0 A" + cloud.rr + " " + cloud.rr + " 0 1 0 " + cloud.rr + " 0 A" + cloud.rr + " " + cloud.rr + " 0 1 0 " + (-cloud.rr) + " 0 Z" }
                    }
                }
                Connections { target: fx; function onPlaysChanged() { ptAnim.restart(); } }
                SequentialAnimation {
                    id: ptAnim
                    PropertyAction { target: pt; property: "opacity"; value: 0 }
                    PropertyAction { target: pt; property: "a"; value: pt.kind === "swirl" ? pt.modelData[0] : 0 }
                    PropertyAction { target: pt; property: "r"; value: pt.kind === "swirl" ? pt.modelData[1] : 0 }
                    PropertyAction { target: pt; property: "tx"; value: 0 }
                    PropertyAction { target: pt; property: "ty"; value: 0 }
                    PropertyAction { target: pt; property: "s"; value: pt.kind === "puff" ? 0.35 : 1 }
                    PauseAnimation { duration: pt.delay }
                    ParallelAnimation {
                        // swirl: in to the origin, faster and faster, turning.
                        NumberAnimation { target: pt; property: "r"; to: 0; duration: pt.kind === "swirl" ? pt.length : 0; easing.type: Easing.InQuad }
                        NumberAnimation { target: pt; property: "a"; to: pt.kind === "swirl" ? pt.modelData[0] + fx.spec.spin : 0; duration: pt.kind === "swirl" ? pt.length : 0; easing.type: Easing.InQuad }
                        // puff, burst: out, slowing.
                        NumberAnimation { target: pt; property: "tx"; to: pt.kind === "swirl" ? 0 : pt.modelData[0]; duration: pt.kind === "swirl" ? 0 : pt.length; easing.type: Easing.OutCubic }
                        NumberAnimation { target: pt; property: "ty"; to: pt.kind === "swirl" ? 0 : pt.modelData[1]; duration: pt.kind === "swirl" ? 0 : pt.length; easing.type: Easing.OutCubic }
                        NumberAnimation {
                            target: pt; property: "s"
                            to: pt.kind === "puff" ? 1 : pt.kind === "swirl" ? 0.4 : 0.3
                            duration: pt.length
                            easing.type: pt.kind === "puff" ? Easing.OutQuad : pt.kind === "swirl" ? Easing.InQuad : Easing.Linear
                        }
                        // Bright at once (burst), coming up (swirl), billowing (puff); then out.
                        SequentialAnimation {
                            NumberAnimation { target: pt; property: "opacity"; to: pt.kind === "puff" ? 0.85 : 1; duration: pt.kind === "burst" ? 0 : pt.length * (pt.kind === "puff" ? 0.15 : 0.25); easing.type: pt.kind === "puff" ? Easing.OutQuad : Easing.Linear }
                            PauseAnimation { duration: pt.kind === "puff" ? pt.length * 0.25 : pt.kind === "swirl" ? pt.length * 0.75 : 0 }
                            NumberAnimation { target: pt; property: "opacity"; to: pt.kind === "swirl" ? 1 : 0; duration: pt.kind === "puff" ? pt.length * 0.6 : pt.kind === "burst" ? pt.length : 0; easing.type: Easing.InQuad }
                        }
                    }
                    PropertyAction { target: pt; property: "opacity"; value: 0 }
                }
            }
        }
    }
}
