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
// a lively rhythm without one.
//
// All of it through Theme.motion (Settings > Advanced > Animation speed).
// With `animated` false (Reduce motion) every pose is held still: no
// flicker, breath, blink, hop or beak flapping; poses change at once. The
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
    // Its own motion only while drawn.
    readonly property bool _live: animated && visible && opacity > 0

    implicitWidth: 120
    implicitHeight: width * 1.1

    readonly property var art: BirdData.bird
    readonly property var poseSpec: art.poses[pose] || art.poses.idle
    readonly property var _eyes: art.eyes[poseSpec.eyes]
    readonly property var _beak: art.beaks[poseSpec.beak]
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
        if (_was === "asleep" && pose !== "asleep" && animated)
            shakeAnim.restart();
        _was = pose;
    }
    onAnimatedChanged: {
        if (!animated) {
            shakeAnim.stop();
            nodAnim.stop();
            shake = 0;
            nodAngle = 0;
            _applyLift();
        }
    }
    Component.onCompleted: {
        lift = poseSpec.lift;
        _liftTo = lift;
        _was = pose;
    }

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

    Item {
        id: drawing
        width: bird.art.viewBox[0]
        height: bird.art.viewBox[1]
        transform: Scale { xScale: bird.width / drawing.width; yScale: bird.width / drawing.width }

        Part {
            name: "shadow"
            transform: Scale { origin.x: bird._pv.shadow[0]; origin.y: bird._pv.shadow[1]; xScale: bird.shadowScale * (1 - 0.25 * Math.min(1, bird.lift / 60)) }
        }

        // The bird, apart from the extras around it.
        Item {
            id: body
            objectName: "assistantBirdBody"
            transform: [
                Scale { origin.x: bird._pv.breath[0]; origin.y: bird._pv.breath[1]; xScale: bird.breathX; yScale: bird.breathY },
                Scale { origin.x: bird._pv.feet[0]; origin.y: bird._pv.feet[1]; xScale: bird.squashX; yScale: bird.squashY },
                Rotation { origin.x: bird._pv.body[0]; origin.y: bird._pv.body[1]; angle: bird.tilt + bird.shake },
                Rotation { origin.x: bird._pv.feet[0]; origin.y: bird._pv.feet[1]; angle: bird.nodAngle },
                Translate { y: -bird.lift }
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
            Flicker { name: "tail"; running: bird._live; Part { name: "tail" } }
            Flicker { name: "tailInner"; running: bird._live; Part { name: "tailInner" } }

            // The crest: its three flames, under a slower gust, scaled and
            // turned by the pose, swelling with the voice as it listens.
            Item {
                id: crest
                objectName: "assistantBirdCrest"
                transform: [
                    Scale {
                        origin.x: 0; origin.y: 6
                        xScale: 1 + bird.art.motion.level.crest * bird._voiced
                        yScale: 1 + bird.art.motion.level.crest * 1.4 * bird._voiced
                    },
                    Scale { xScale: bird.crestScale; yScale: bird.crestScale },
                    Rotation { angle: bird.crestRotation },
                    Translate { x: bird._pv.crest[0]; y: bird._pv.crest[1] }
                ]
                Flicker {
                    name: "crestGust"
                    running: bird._live
                    Flicker { objectName: "assistantBirdFlame"; name: "crest"; running: bird._live; Part { name: "crest" } }
                    Flicker { name: "crestInner"; running: bird._live; Part { name: "crestInner" } }
                    Flicker { name: "crestCore"; running: bird._live; Part { name: "crestCore" } }
                }
            }

            Part { name: "footL" }
            Part { name: "footR" }
            Part { name: "body" }
            Part { name: "belly" }
            Item {
                transform: Rotation { origin.x: bird._pv.wingL[0]; origin.y: bird._pv.wingL[1]; angle: bird.wingL }
                Part { name: "wingL" }
                Part { name: "wingTipL" }
            }
            Item {
                transform: Rotation { origin.x: bird._pv.wingR[0]; origin.y: bird._pv.wingR[1]; angle: bird.wingR }
                Part { name: "wingR" }
                Part { name: "wingTipR" }
            }

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

            // The beak.
            Item {
                id: beak
                objectName: "assistantBirdBeak"
                transform: Rotation { origin.x: bird._pv.beak[0]; origin.y: bird._pv.beak[1]; angle: bird.beakTilt }
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
    }
}
