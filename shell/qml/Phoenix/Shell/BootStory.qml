// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The start-up story (Settings > Advanced > Start-up animation: Phoenix),
// in place of the boot logo's glow (BootAnimation.qml): a phoenix's death
// and rebirth, asked for by the owner. A Phoenix addition; webOS had the
// glowing logo alone. Original Phoenix art, all drawn here (Qt Quick
// Shapes and plain items, crisp at any density); the flames are the
// Assistant bird's (BootFlame.qml), the bird is AssistantBird itself.
//
// The beats (`beat`, in order; `beats` lists those played):
//   "orb"     black, the classic orb (the boot logo's dark disc and silver
//             rim) with a dead face, X eyes, in place of the emblem; its
//             white glow swells as the logo's did.
//   "gold"    the glow turns from white to the bird's gold, and grows.
//   "burn"    it catches fire: the crest's flames, each at its own pace,
//             burst out around it and grow; the face screams (the mouth
//             wide, the X eyes stay), it shakes, chars, and sinks, burning
//             down, embers flying up.
//   "ash"     a small pile of ash on the ground, smoke curling up from it,
//             a few embers dying in it.
//   "flight"  a small gold bird-shaped orb (half the dead orb's size) shoots
//             up out of the ash and flies all over the screen, looping and
//             swooping, trailing sparks.
//   "enter"   it flies into the spot where the bird's entrance
//             (AssistantBird.enter(): embers swirl, a fireball bursts, the
//             bird is born out of it, drops, lands with a squash and dust)
//             starts, and becomes its fireball.
//   "wave"    landed, the bird says hello (its hello pose: it waves).
//   "idle"    the story is over (`done`, ended()): the bird stands idle,
//             breathing, blinking, now and then an idle move, until the boot
//             is (BootAnimation.finish()).
// About 11.5 s at the normal speed, every step through Theme.motion
// (Settings > Advanced > Animation speed: Fast plays it in 60% of that).
// Under Reduce motion (Settings > Accessibility) none of it moves: the bird
// fades in, in its hello pose, and holds it 1.5 s.
//
// skip(): straight to the wave. end(): over at once (done).
//
// `angle` (HomeButtonOrientationAngle) turns the whole scene so it is
// upright with the Home button below, as the logo; the orb, the ground
// line, the bird and the flight path are laid out for the screen it is
// upright on (phone portrait or landscape, tablet).
//
// Kept light for a low-end device: a few dozen shapes, plain property
// animations; the particles (embers, smoke, sparks) are a dozen items each,
// a script only as each one starts over.

import QtQuick
import QtQuick.Shapes
import "AssistantBirdData.js" as BirdData

Item {
    id: story
    objectName: "bootStory"

    property int angle: 0
    readonly property bool _sideways: angle === 90 || angle === 270

    // The beat playing ("" before the start), the beats played so far.
    property string beat: ""
    property var beats: []
    // The wave is over (the story's end): it waits, idle, for the boot.
    property bool done: false
    signal ended
    // Reduce motion: a still picture instead.
    readonly property bool calm: Theme.reduceMotion

    readonly property var colors: BirdData.bird.colors

    // ---- Layout (the upright scene's units) ------------------------------------------------
    readonly property alias stage: stage
    readonly property real sw: stage.width
    readonly property real sh: stage.height
    readonly property real _s: Math.min(sw, sh)
    function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    // The dead orb's radius: about the boot logo's on a phone, larger on a tablet.
    readonly property real r: _clamp(_s * 0.13, Theme.px(36), Theme.px(80))
    readonly property real cx: sw / 2
    readonly property real cy: sh / 2
    // The ground the ash lies on and the bird lands on.
    readonly property real groundY: Math.min(sh * 0.8, cy + r + Math.max(sh * 0.12, r * 1.2))
    // The bird (its drawing 400 x 440 units, its feet at 410), on the ground in the middle.
    readonly property real birdW: _clamp(_s * 0.36, Theme.px(110), Theme.px(220))
    readonly property real _bk: birdW / 400
    // Where its entrance's fireball bursts (effects.fireball.origin, with the
    // bird where it lands): the end of the flight.
    readonly property real handX: cx + (BirdData.bird.effects.fireball.origin[0] - 200) * _bk
    readonly property real handY: groundY - (410 - BirdData.bird.effects.fireball.origin[1]) * _bk
    // The flames' heights times this, so the tallest (3.2 r over the orb's
    // middle, flickering taller) stays on a short screen (phone landscape).
    readonly property real _flameRoom: Math.min(1, (cy - sh * 0.04) / (r * 3.9))
    // The bird-shaped orb's radius: half the dead orb's.
    readonly property real rb: r * 0.5

    // ---- What moves (the story's animations set them) --------------------------------------------
    property real orbOpacity: 1
    property real orbY: cy
    property real orbScale: 1
    property real glow: 0
    property real glowSize: 1
    property color glowColor: "#FFFFFF"
    property color rimColor: "#C8C8C8"
    property color faceColor: "#E6E6E6"
    property color discColor: "#1C1C1C"
    property real scream: 0
    property real shake: 0
    property real fire: 0
    property real fireScale: 1
    property real floorGlow: 0
    property real ash: 0
    property real ashBulge: 1
    property bool birdShown: false
    property real flyerOpacity: 0
    property real flyerScale: 1

    readonly property alias bird: bird
    readonly property alias flyer: flyer

    function _setBeat(b) {
        beat = b;
        beats = beats.concat([b]);
    }
    function _reset() {
        tale.stop();
        waveAnim.stop();
        calmAnim.stop();
        orbOpacity = 1;
        orbY = Qt.binding(function () { return story.cy; });
        orbScale = 1;
        glow = 0;
        glowSize = 1;
        glowColor = "#FFFFFF";
        rimColor = "#C8C8C8";
        faceColor = "#E6E6E6";
        discColor = "#1C1C1C";
        scream = 0;
        shake = 0;
        fire = 0;
        fireScale = 1;
        floorGlow = 0;
        ash = 0;
        ashBulge = 1;
        birdShown = false;
        flyerOpacity = 0;
        flyerScale = 1;
        bird.pose = "idle";
        bird.fidgety = false;
        if (bird.move !== "")
            bird._endMove(false);
        done = false;
        beat = "";
        beats = [];
    }
    function start() {
        _reset();
        if (calm)
            calmAnim.start();
        else
            tale.start();
    }
    function stop() {
        _reset();
    }
    // Straight to the wave (the bird landed): a tap.
    function skip() {
        if (beat === "" || done || beat === "wave")
            return;
        tale.stop();
        calmAnim.stop();
        orbOpacity = 0;
        glow = 0;
        fire = 0;
        floorGlow = 0;
        ash = 0;
        flyerOpacity = 0;
        if (bird.move !== "")
            bird._endMove(false);
        bird.fade = 1;
        birdShown = true;
        waveAnim.restart();
    }
    // Over at once.
    function end() {
        if (done)
            return;
        tale.stop();
        waveAnim.stop();
        calmAnim.stop();
        _ended();
    }
    function _ended() {
        orbOpacity = 0;
        glow = 0;
        fire = 0;
        floorGlow = 0;
        ash = 0;
        flyerOpacity = 0;
        birdShown = true;
        bird.pose = "idle";
        bird.fidgety = true;
        done = true;
        _setBeat("idle");
        ended();
    }

    function _alpha(c, a) { return Qt.rgba(c.r, c.g, c.b, a); }
    function _circle(r) {
        var a = " A" + r + " " + r + " 0 1 0 ";
        return "M" + (-r) + " 0" + a + r + " 0" + a + (-r) + " 0 Z";
    }

    // ---- Parts ------------------------------------------------------------------------------
    // A soft round light about its origin: `tint` at `inner` of its radius
    // fading to nothing at the edge.
    component Glow: Shape {
        id: gl
        property real radius: 10
        property color tint: "white"
        property real inner: 0
        preferredRendererType: Shape.GeometryRenderer
        ShapePath {
            strokeColor: "transparent"
            fillGradient: RadialGradient {
                centerX: 0; centerY: 0; centerRadius: gl.radius
                focalX: 0; focalY: 0
                GradientStop { position: 0; color: story._alpha(gl.tint, gl.inner > 0 ? 1 : 0.9) }
                GradientStop { position: Math.max(0.01, gl.inner); color: story._alpha(gl.tint, 0.85) }
                GradientStop { position: gl.inner + (1 - gl.inner) * 0.25; color: story._alpha(gl.tint, 0.4) }
                GradientStop { position: gl.inner + (1 - gl.inner) * 0.6; color: story._alpha(gl.tint, 0.1) }
                GradientStop { position: 1; color: story._alpha(gl.tint, 0) }
            }
            PathSvg { path: story._circle(gl.radius) }
        }
    }

    // Particles from a point that moves (sx, sy), each `life` ms: from
    // there, drifting by up to `spread` and moving by `rise` (up below 0),
    // fading and scaling to `grow`; a new one every life / count ms. Dots,
    // a glint (a four-pointed twinkle) every fourth with `glints`, or soft
    // puffs (smoke) with `soft`.
    component Sparks: Item {
        id: sp
        property real sx: 0
        property real sy: 0
        property bool running: false
        property int count: 10
        property int life: 700
        property real rise: -40
        property real spread: 10
        property real size: 4
        property real grow: 0.3
        property real alpha: 1
        property bool soft: false
        property bool glints: false
        property var tints: ["gold"]
        Repeater {
            model: sp.count
            delegate: Item {
                id: p
                required property int index
                property real x0: 0
                property real y0: 0
                property real drift: 0
                property real t: 0
                readonly property real d: sp.size * (0.65 + 0.35 * ((index * 7) % 5) / 4)
                readonly property color tint: story.colors[sp.tints[index % sp.tints.length]] || sp.tints[index % sp.tints.length]
                x: x0 + drift * t
                y: y0 + sp.rise * t
                opacity: t > 0 && t < 1 ? sp.alpha * (sp.soft ? Math.sin(Math.PI * t) : 1 - t * t) : 0
                visible: opacity > 0
                scale: 1 + (sp.grow - 1) * t
                rotation: sp.glints ? 90 * t : 0
                Rectangle {
                    visible: !sp.soft && !(sp.glints && p.index % 4 === 0)
                    x: -width / 2; y: -height / 2
                    width: p.d; height: p.d; radius: p.d / 2
                    color: p.tint
                }
                Repeater {
                    model: sp.glints && p.index % 4 === 0 ? 2 : 0
                    delegate: Rectangle {
                        required property int index
                        x: -width / 2; y: -height / 2
                        width: p.d * 3; height: p.d * 0.45; radius: height / 2
                        rotation: index * 90
                        color: story.colors.flameCore
                    }
                }
                Loader {
                    active: sp.soft
                    sourceComponent: Glow { radius: p.d; tint: p.tint }
                }
                SequentialAnimation {
                    running: sp.running
                    onRunningChanged: if (!running) p.t = 0
                    PauseAnimation { duration: Theme.motion(p.index * sp.life / sp.count) }
                    SequentialAnimation {
                        loops: Animation.Infinite
                        ScriptAction {
                            script: {
                                p.x0 = sp.sx + (Math.random() - 0.5) * sp.spread * 0.6;
                                p.y0 = sp.sy + (Math.random() - 0.5) * sp.spread * 0.3;
                                p.drift = (Math.random() - 0.5) * sp.spread * 2;
                            }
                        }
                        NumberAnimation { target: p; property: "t"; from: 0; to: 1; duration: Theme.motion(sp.life); easing.type: Easing.OutQuad }
                    }
                }
            }
        }
    }

    // ---- The scene, upright with the Home button below ----------------------------------------
    Rectangle {
        anchors.fill: parent
        color: "black"
    }

    Item {
        id: stage
        objectName: "bootStoryStage"
        anchors.centerIn: parent
        width: story._sideways ? parent.height : parent.width
        height: story._sideways ? parent.width : parent.height
        rotation: story.angle

        // The fire's light on the ground.
        Glow {
            x: story.cx
            y: story.groundY
            radius: story.r * 2.6
            tint: story.colors.ember
            opacity: story.floorGlow * 0.55
            visible: opacity > 0
            transform: Scale { yScale: 0.22 }
        }

        // The orb's glow: white, then gold, then the fire's.
        Glow {
            objectName: "bootStoryGlow"
            x: story.cx
            y: story.orbY
            radius: story.r * 2.4 * story.glowSize
            inner: 1 / (2.4 * story.glowSize)
            tint: story.glowColor
            scale: story.orbScale
            opacity: story.glow * story.orbOpacity
            visible: opacity > 0
        }

        // The flames (BootFlame, the bird's crest's), behind the orb: one
        // tall in the middle, the others around its top, each leaning out.
        Item {
            id: fireRoot
            objectName: "bootStoryFire"
            x: story.cx
            y: story.orbY
            scale: story.fireScale
            Repeater {
                // [angle from upright, distance out (of r), height (of r), pace, phase ms, in front]
                model: [[0, 0.3, 3.2, 1.0, 0, false], [-34, 0.62, 2.0, 0.83, 90, false], [36, 0.62, 2.1, 1.17, 40, false],
                        [-68, 0.82, 1.45, 1.31, 150, false], [70, 0.8, 1.5, 0.74, 60, false], [-14, 0.5, 2.3, 1.09, 200, false],
                        [16, 0.48, 2.4, 0.91, 120, false], [-112, 0.9, 1.0, 1.22, 30, true], [110, 0.9, 1.05, 0.88, 170, true]]
                delegate: BootFlame {
                    required property var modelData
                    required property int index
                    readonly property real a: modelData[0] * Math.PI / 180
                    // Each flame catches a little after the one before.
                    readonly property real catching: story._clamp(story.fire * 1.6 - index * 0.07, 0, 1)
                    x: Math.sin(a) * modelData[1] * story.r
                    y: -Math.cos(a) * modelData[1] * story.r
                    z: modelData[5] ? 2 : 0
                    rotation: modelData[5] ? modelData[0] * 0.25 : modelData[0] * 0.55
                    size: modelData[2] * story.r * story._flameRoom
                    pace: modelData[3]
                    phase: modelData[4]
                    core: !modelData[5]
                    scale: catching * (0.75 + 0.25 * story.fire)
                    visible: catching > 0
                    running: story.beat === "burn"
                }
            }

            // The orb (BootAnimation's logo without its emblem): the dark disc,
            // its rim, the face; it shakes as it screams.
            Item {
                id: orb
                objectName: "bootStoryOrb"
                z: 1
                scale: story.orbScale / story.fireScale
                rotation: story.shake
                opacity: story.orbOpacity
                visible: opacity > 0
                Shape {
                    preferredRendererType: Shape.CurveRenderer
                    ShapePath {
                        strokeColor: story.rimColor
                        strokeWidth: Math.max(1, story.r * 0.06)
                        fillGradient: RadialGradient {
                            centerX: 0; centerY: -story.r * 0.35; centerRadius: story.r * 1.35
                            focalX: 0; focalY: -story.r * 0.35
                            GradientStop { position: 0; color: Qt.lighter(story.discColor, 1.9) }
                            GradientStop { position: 1; color: story.discColor }
                        }
                        PathSvg { path: story._circle(story.r) }
                    }
                }
                // The X eyes (dead), a little higher as it screams.
                Repeater {
                    model: 4
                    delegate: Rectangle {
                        required property int index
                        readonly property real ex: (index < 2 ? -1 : 1) * story.r * 0.36
                        readonly property real ey: -story.r * (0.2 + 0.1 * story.scream)
                        objectName: "bootStoryEye-" + index
                        width: story.r * 0.44 * (1 + 0.1 * story.scream)
                        height: Math.max(1.5, story.r * 0.1)
                        radius: height / 2
                        x: ex - width / 2
                        y: ey - height / 2
                        rotation: index % 2 ? -45 : 45
                        color: story.faceColor
                        antialiasing: true
                    }
                }
                // The mouth: a flat line, dead; wide open, screaming.
                Rectangle {
                    id: mouth
                    objectName: "bootStoryMouth"
                    width: story.r * (0.5 + 0.02 * story.scream)
                    height: Math.max(1.5, story.r * (0.1 + 0.56 * story.scream))
                    radius: Math.min(width, height) / 2
                    x: -width / 2
                    y: story.r * (0.3 - 0.14 * story.scream) - Math.max(1.5, story.r * 0.1) / 2
                    color: Qt.tint(story.faceColor, story._alpha(Qt.color("#3A0E00"), Math.min(1, story.scream * 1.6)))
                    border.color: story.faceColor
                    border.width: Math.min(height / 2, story.r * 0.08)
                    antialiasing: true
                }
            }
        }

        // Embers flying up from the fire.
        Sparks {
            sx: story.cx
            sy: story.orbY - story.r * 0.6 * story.orbScale
            running: story.beat === "burn"
            count: 10
            life: 900
            rise: -story.r * 2.8
            spread: story.r * 1.2
            size: Math.max(2, story.r * 0.09)
            grow: 0.3
            tints: ["ember", "gold", "flame"]
        }

        // The ash: a small mound on the ground, a few embers dying in it,
        // smoke curling up.
        Item {
            id: ashPile
            objectName: "bootStoryAsh"
            x: story.cx
            y: story.groundY
            opacity: story.ash
            visible: opacity > 0
            transform: Scale { yScale: story.ashBulge * story.ash; xScale: 0.6 + 0.4 * story.ash }
            Shape {
                preferredRendererType: Shape.CurveRenderer
                ShapePath {
                    strokeColor: "transparent"
                    fillGradient: LinearGradient {
                        x1: 0; y1: -story.r * 0.5; x2: 0; y2: 0
                        GradientStop { position: 0; color: "#77706A" }
                        GradientStop { position: 1; color: "#3A3532" }
                    }
                    PathSvg {
                        path: {
                            var w = story.r * 1.25, h = story.r * 0.5;
                            return "M" + (-w) + " 0 C" + (-w * 0.7) + " " + (-h * 0.2) + " " + (-w * 0.55) + " " + (-h * 0.9) + " " + (-w * 0.15) + " " + (-h)
                                + " C" + (-w * 0.05) + " " + (-h * 1.08) + " " + (w * 0.1) + " " + (-h * 0.92) + " " + (w * 0.22) + " " + (-h * 0.95)
                                + " C" + (w * 0.55) + " " + (-h * 0.85) + " " + (w * 0.72) + " " + (-h * 0.25) + " " + w + " 0 Z";
                        }
                    }
                }
            }
            Repeater {
                model: [[-0.6, -0.1, 900], [-0.2, -0.36, 1300], [0.26, -0.3, 700], [0.68, -0.1, 1100], [0.04, -0.12, 1600], [-0.38, -0.24, 1000]]
                delegate: Rectangle {
                    required property var modelData
                    width: Math.max(2, story.r * 0.07); height: width; radius: width / 2
                    x: modelData[0] * story.r - width / 2
                    y: modelData[1] * story.r - height / 2
                    color: story.colors.ember
                    SequentialAnimation on opacity {
                        running: ashPile.visible
                        loops: Animation.Infinite
                        NumberAnimation { to: 0.15; duration: Theme.motion(modelData[2]); easing.type: Easing.InOutSine }
                        NumberAnimation { to: 1; duration: Theme.motion(modelData[2] * 0.7); easing.type: Easing.InOutSine }
                    }
                }
            }
        }
        Sparks {
            objectName: "bootStorySmoke"
            sx: story.cx
            sy: story.groundY - story.r * 0.35
            running: story.beat === "ash" || (story.beat === "burn" && story.fireScale < 0.9)
            soft: true
            count: 5
            life: 1700
            rise: -story.r * 2.4
            spread: story.r * 0.9
            size: story.r * 0.4
            grow: 3
            alpha: 0.55
            tints: ["#6E6660", "#57514D"]
        }

        // The bird-shaped orb: gold, a crest flame, a beak, an eye, a
        // flapping wing and two tail flames streaming behind; facing the way
        // it flies. Sparks fall from it.
        Sparks {
            objectName: "bootStorySparks"
            sx: flyer.x
            sy: flyer.y
            running: story.beat === "flight"
            count: 18
            life: 800
            rise: story.r * 1.1
            spread: story.rb * 1.0
            size: Math.max(2.5, story.r * 0.13)
            grow: 0.25
            glints: true
            tints: ["flameCore", "gold", "flame", "ember"]
        }
        Item {
            id: flyer
            objectName: "bootStoryFlyer"
            x: story.cx
            y: story.groundY
            opacity: story.flyerOpacity
            scale: story.flyerScale
            visible: opacity > 0
            Glow {
                radius: story.rb * 3
                inner: 0.3
                tint: story.colors.gold
                opacity: 0.55
            }
            // Turned to the way it flies (the path's heading); flying
            // leftward, flipped so it is not upside down, turning over
            // quickly once it is clearly going the other way (not to and
            // fro as it climbs or dives).
            onRotationChanged: {
                var c = Math.cos(rotation * Math.PI / 180);
                if (c < -0.35 && flyerBody.side > 0)
                    flyerBody.side = -1;
                else if (c > 0.35 && flyerBody.side < 0)
                    flyerBody.side = 1;
            }
            Item {
                id: flyerBody
                property int side: 1
                property real upright: side
                Behavior on upright { NumberAnimation { duration: Theme.motion(110); easing.type: Easing.InOutQuad } }
                transform: Scale { yScale: flyerBody.upright }
                BootFlame {
                    x: -story.rb * 0.7; y: story.rb * 0.1
                    rotation: -104
                    size: story.rb * 1.6
                    pace: 0.6
                    running: flyer.visible
                }
                BootFlame {
                    x: -story.rb * 0.7; y: story.rb * 0.3
                    rotation: -128
                    size: story.rb * 1.1
                    pace: 0.5
                    phase: 80
                    core: false
                    running: flyer.visible
                }
                BootFlame {
                    x: story.rb * 0.25; y: -story.rb * 0.72
                    rotation: 18
                    size: story.rb * 1.0
                    pace: 0.7
                    running: flyer.visible
                }
                Shape {
                    preferredRendererType: Shape.CurveRenderer
                    ShapePath {
                        strokeColor: "transparent"
                        fillGradient: RadialGradient {
                            centerX: story.rb * 0.3; centerY: -story.rb * 0.35; centerRadius: story.rb * 1.4
                            focalX: story.rb * 0.3; focalY: -story.rb * 0.35
                            GradientStop { position: 0; color: story.colors.flameCore }
                            GradientStop { position: 0.45; color: story.colors.flame }
                            GradientStop { position: 1; color: story.colors.gold }
                        }
                        // A plump egg: the orb a bird.
                        PathSvg {
                            path: { var a = story.rb * 1.08, b = story.rb * 0.92;
                                    return "M" + (-a) + " 0 A" + a + " " + b + " 0 1 0 " + a + " 0 A" + a + " " + b + " 0 1 0 " + (-a) + " 0 Z"; }
                        }
                    }
                }
                // The beak.
                Shape {
                    preferredRendererType: Shape.CurveRenderer
                    ShapePath {
                        strokeColor: "transparent"
                        fillColor: "#C47A00"
                        PathSvg {
                            path: { var s = story.rb;
                                    return "M" + (s * 0.95) + " " + (-s * 0.28) + " L" + (s * 1.5) + " " + (s * 0.02) + " L" + (s * 0.95) + " " + (s * 0.24) + " Z"; }
                        }
                    }
                }
                // The eye.
                Rectangle {
                    width: story.rb * 0.3; height: width; radius: width / 2
                    x: story.rb * 0.42 - width / 2; y: -story.rb * 0.3 - height / 2
                    color: story.colors.ink
                    Rectangle {
                        width: parent.width * 0.38; height: width; radius: width / 2
                        x: parent.width * 0.5; y: parent.height * 0.12
                        color: "white"
                    }
                }
                // The wing, flapping.
                Shape {
                    id: wing
                    preferredRendererType: Shape.CurveRenderer
                    x: -story.rb * 0.15; y: story.rb * 0.05
                    property real flap: 0
                    transform: Rotation { angle: wing.flap }
                    ShapePath {
                        strokeColor: "transparent"
                        fillColor: story.colors.beakDark
                        PathSvg {
                            path: { var s = story.rb;
                                    return "M0 0 C" + (-s * 0.2) + " " + (-s * 0.75) + " " + (-s * 0.9) + " " + (-s * 0.9) + " " + (-s * 1.05) + " " + (-s * 0.55)
                                        + " C" + (-s * 0.75) + " " + (-s * 0.35) + " " + (-s * 0.45) + " " + (-s * 0.05) + " 0 0 Z"; }
                        }
                    }
                    SequentialAnimation on flap {
                        running: flyer.visible
                        loops: Animation.Infinite
                        NumberAnimation { to: 55; duration: Theme.motion(110); easing.type: Easing.OutQuad }
                        NumberAnimation { to: -10; duration: Theme.motion(130); easing.type: Easing.InQuad }
                    }
                }
            }
        }

        // The bird, born out of the fireball the orb becomes.
        AssistantBird {
            id: bird
            objectName: "bootStoryBird"
            width: story.birdW
            height: width * 1.1
            x: story.cx - width / 2
            y: story.groundY - 410 * story._bk
            visible: story.birdShown
            fidgety: false
            // The warm light behind it, so the black bird reads on black.
            glow: true
        }
    }

    // ---- The story ----------------------------------------------------------------------------
    // The flight: out of the ash and up, then loops and swoops all over the
    // screen, to where the bird's fireball bursts. In the scene's
    // fractions, the end where the fireball is, flying in level.
    readonly property string flightPath: {
        var W = sw, H = sh;
        function p(u, v) { return (u * W) + " " + (v * H); }
        var hx = handX, hy = handY;
        return "M" + p(0.5, 0.2)
            + " C" + p(0.5, 0.04) + " " + p(0.86, 0.04) + " " + p(0.84, 0.26)
            + " C" + p(0.82, 0.46) + " " + p(0.6, 0.46) + " " + p(0.63, 0.31)
            + " C" + p(0.66, 0.16) + " " + p(0.92, 0.22) + " " + p(0.8, 0.42)
            + " C" + p(0.7, 0.58) + " " + p(0.3, 0.58) + " " + p(0.2, 0.42)
            + " C" + p(0.08, 0.22) + " " + p(0.34, 0.16) + " " + p(0.37, 0.31)
            + " C" + p(0.4, 0.46) + " " + p(0.16, 0.46) + " " + p(0.16, 0.28)
            + " C" + p(0.16, 0.08) + " " + (hx - 0.3 * W) + " " + (hy - 0.02 * H) + " " + hx + " " + hy;
    }

    SequentialAnimation {
        id: tale
        // Black, the orb, dead; its white glow swells (the logo's first glow).
        ScriptAction { script: story._setBeat("orb") }
        PauseAnimation { duration: Theme.motion(300) }
        NumberAnimation { target: story; property: "glow"; to: 1; duration: Theme.motion(1200); easing.type: Easing.InOutSine }
        NumberAnimation { target: story; property: "glow"; to: 0.7; duration: Theme.motion(300); easing.type: Easing.InOutSine }

        // White to gold.
        ScriptAction { script: story._setBeat("gold") }
        ParallelAnimation {
            ColorAnimation { target: story; property: "glowColor"; to: story.colors.gold; duration: Theme.motion(800); easing.type: Easing.InOutSine }
            ColorAnimation { target: story; property: "rimColor"; to: story.colors.gold; duration: Theme.motion(800) }
            ColorAnimation { target: story; property: "faceColor"; to: story.colors.flameCore; duration: Theme.motion(800) }
            ColorAnimation { target: story; property: "discColor"; to: "#251A06"; duration: Theme.motion(1000) }
            NumberAnimation { target: story; property: "glow"; to: 1; duration: Theme.motion(1100); easing.type: Easing.OutSine }
            NumberAnimation { target: story; property: "glowSize"; to: 1.3; duration: Theme.motion(1100); easing.type: Easing.InOutSine }
        }

        // It catches fire and screams, burns, sinks and burns down.
        ScriptAction { script: story._setBeat("burn") }
        ParallelAnimation {
            SequentialAnimation {
                NumberAnimation { target: story; property: "fire"; to: 0.6; duration: Theme.motion(300); easing.type: Easing.OutCubic }
                NumberAnimation { target: story; property: "fire"; to: 1; duration: Theme.motion(900); easing.type: Easing.InOutSine }
                PauseAnimation { duration: Theme.motion(500) }
                NumberAnimation { target: story; property: "fire"; to: 0; duration: Theme.motion(700); easing.type: Easing.InQuad }
            }
            SequentialAnimation {
                PauseAnimation { duration: Theme.motion(180) }
                NumberAnimation { target: story; property: "scream"; to: 1; duration: Theme.motion(320); easing.type: Easing.OutBack }
            }
            SequentialAnimation {
                PauseAnimation { duration: Theme.motion(200) }
                SequentialAnimation {
                    loops: 14
                    NumberAnimation { target: story; property: "shake"; to: 6; duration: Theme.motion(40) }
                    NumberAnimation { target: story; property: "shake"; to: -6; duration: Theme.motion(40) }
                }
                NumberAnimation { target: story; property: "shake"; to: 0; duration: Theme.motion(60) }
            }
            ColorAnimation { target: story; property: "glowColor"; to: story.colors.ember; duration: Theme.motion(1200) }
            SequentialAnimation {
                PauseAnimation { duration: Theme.motion(300) }
                ParallelAnimation {
                    ColorAnimation { target: story; property: "discColor"; to: "#120804"; duration: Theme.motion(1100) }
                    ColorAnimation { target: story; property: "rimColor"; to: story.colors.ember; duration: Theme.motion(900) }
                    ColorAnimation { target: story; property: "faceColor"; to: story.colors.flame; duration: Theme.motion(900) }
                }
            }
            NumberAnimation { target: story; property: "floorGlow"; to: 1; duration: Theme.motion(600) }
            SequentialAnimation {
                PauseAnimation { duration: Theme.motion(1250) }
                ParallelAnimation {
                    NumberAnimation { target: story; property: "orbY"; to: story.groundY - story.r * 0.3; duration: Theme.motion(1150); easing.type: Easing.InQuad }
                    NumberAnimation { target: story; property: "orbScale"; to: 0.22; duration: Theme.motion(1150); easing.type: Easing.InQuad }
                    NumberAnimation { target: story; property: "fireScale"; to: 0.45; duration: Theme.motion(1150); easing.type: Easing.InQuad }
                    NumberAnimation { target: story; property: "glow"; to: 0; duration: Theme.motion(1150) }
                    SequentialAnimation {
                        PauseAnimation { duration: Theme.motion(650) }
                        ParallelAnimation {
                            NumberAnimation { target: story; property: "orbOpacity"; to: 0; duration: Theme.motion(500) }
                            NumberAnimation { target: story; property: "ash"; to: 1; duration: Theme.motion(500); easing.type: Easing.OutCubic }
                            NumberAnimation { target: story; property: "floorGlow"; to: 0.25; duration: Theme.motion(500) }
                        }
                    }
                }
            }
        }

        // Ash, smoking.
        ScriptAction { script: story._setBeat("ash") }
        ParallelAnimation {
            NumberAnimation { target: story; property: "floorGlow"; to: 0; duration: Theme.motion(900) }
            SequentialAnimation {
                PauseAnimation { duration: Theme.motion(650) }
                // It stirs.
                NumberAnimation { target: story; property: "ashBulge"; to: 1.25; duration: Theme.motion(120); easing.type: Easing.OutQuad }
                NumberAnimation { target: story; property: "ashBulge"; to: 0.95; duration: Theme.motion(110); easing.type: Easing.InOutQuad }
                NumberAnimation { target: story; property: "ashBulge"; to: 1.4; duration: Theme.motion(120); easing.type: Easing.OutQuad }
            }
        }

        // The bird-orb shoots out of the ash and flies about.
        ScriptAction {
            script: {
                story._setBeat("flight");
                story.flyerOpacity = 1;
            }
        }
        ParallelAnimation {
            NumberAnimation { target: story; property: "ash"; to: 0; duration: Theme.motion(900); easing.type: Easing.InQuad }
            NumberAnimation { target: story; property: "ashBulge"; to: 0.4; duration: Theme.motion(900) }
            SequentialAnimation {
                PathAnimation {
                    target: flyer
                    duration: Theme.motion(320)
                    easing.type: Easing.OutCubic
                    orientation: PathAnimation.RightFirst
                    path: Path {
                        startX: story.cx; startY: story.groundY - story.r * 0.2
                        PathLine { x: story.sw * 0.5; y: story.sh * 0.2 }
                    }
                }
                PathAnimation {
                    target: flyer
                    duration: Theme.motion(2300)
                    easing.type: Easing.InOutSine
                    orientation: PathAnimation.RightFirst
                    orientationExitDuration: Theme.motion(200)
                    endRotation: 0
                    path: Path { PathSvg { path: story.flightPath } }
                }
            }
        }

        // It becomes the bird's fireball: the bird is born out of it.
        ScriptAction {
            script: {
                story._setBeat("enter");
                story.birdShown = true;
                story.bird.enter(0);
            }
        }
        ParallelAnimation {
            // Glowing on into the fireball (it bursts 143 ms in, fullest at
            // about 280: effects.fireball), then gone into it.
            NumberAnimation { target: story; property: "flyerScale"; to: 1.5; duration: Theme.motion(300); easing.type: Easing.OutQuad }
            SequentialAnimation {
                PauseAnimation { duration: Theme.motion(130) }
                NumberAnimation { target: story; property: "flyerOpacity"; to: 0; duration: Theme.motion(170); easing.type: Easing.InQuad }
            }
        }
        PauseAnimation { duration: Math.max(0, Theme.motion(BirdData.bird.motion.moves.enter.period) - Theme.motion(300)) }
        ScriptAction { script: waveAnim.start() }
    }

    // Landed: it waves (its hello pose), then the story is over.
    SequentialAnimation {
        id: waveAnim
        ScriptAction {
            script: {
                story._setBeat("wave");
                story.bird.pose = "hello";
            }
        }
        PauseAnimation { duration: Theme.motion(1500) }
        ScriptAction { script: story._ended() }
    }

    // Reduce motion: the bird in its hello pose, held.
    SequentialAnimation {
        id: calmAnim
        ScriptAction {
            script: {
                story.orbOpacity = 0;
                story.birdShown = true;
                story.bird.pose = "hello";
                story.bird.enter(0);
                story._setBeat("wave");
            }
        }
        PauseAnimation { duration: 1500 }
        ScriptAction { script: story._ended() }
    }
}
