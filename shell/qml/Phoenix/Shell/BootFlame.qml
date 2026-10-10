// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A flame of the start-up story (BootStory.qml), drawn as the Assistant
// bird's crest is (AssistantBird.qml, art/assistant-bird/bird.json): its
// three layers (crest: gold, crestInner: flame, crestCore: the pale core)
// from the same path data, each flickering through the same keys
// (motion.flicker: scaled and turned about its base, forward and back) at
// its own pace, under the crest's slower gust. `pace` stretches every
// period (each flame of the fire its own, so the fire never repeats in
// step) and `phase` starts it part way through its first step.
// Original Phoenix art (art/assistant-bird/PROVENANCE.md).
//
// The item's origin is the flame's base, its middle; `size` is its height
// (the crest's 66 units). Plain property animations, no script per frame.

import QtQuick
import QtQuick.Shapes
import "AssistantBirdData.js" as BirdData

Item {
    id: flame
    // Its height in pixels, base to tip, at rest.
    property real size: 60
    // Every period times this (1: the crest's own).
    property real pace: 1
    // Waits this long (ms) before it starts flickering.
    property int phase: 0
    property bool running: false
    // Drawn without the core (a dimmer flame, behind the others).
    property bool core: true

    readonly property real _k: size / 66

    width: 0
    height: 0

    component Layer: Shape {
        id: part
        property string name
        readonly property var spec: BirdData.bird.parts[name]
        preferredRendererType: Shape.CurveRenderer
        ShapePath {
            fillColor: BirdData.bird.colors[part.spec.fill]
            strokeColor: "transparent"
            PathSvg { path: part.spec.d }
        }
    }
    component FlickStep: ParallelAnimation {
        id: step
        property Item target
        property var from
        property var to
        property real period
        readonly property int length: Theme.motion(Math.abs(to[0] - from[0]) * period * flame.pace)
        NumberAnimation { target: step.target; property: "sx"; to: step.to[1]; duration: step.length; easing.type: Easing.InOutSine }
        NumberAnimation { target: step.target; property: "sy"; to: step.to[2]; duration: step.length; easing.type: Easing.InOutSine }
        NumberAnimation { target: step.target; property: "rot"; to: step.to[3]; duration: step.length; easing.type: Easing.InOutSine }
        NumberAnimation { target: step.target; property: "opacity"; to: step.to[4]; duration: step.length; easing.type: Easing.InOutSine }
    }
    component Flick: Item {
        id: fl
        property string name
        readonly property var f: BirdData.bird.motion.flicker[name]
        readonly property var k: f.keys4
        property real sx: 1
        property real sy: 1
        property real rot: 0
        transform: [
            Scale { origin.x: fl.f.pivot[0]; origin.y: fl.f.pivot[1]; xScale: fl.sx; yScale: fl.sy },
            Rotation { origin.x: fl.f.pivot[0]; origin.y: fl.f.pivot[1]; angle: fl.rot }
        ]
        SequentialAnimation {
            running: flame.running && flame.visible
            PauseAnimation { duration: Theme.motion(flame.phase) }
            SequentialAnimation {
                loops: Animation.Infinite
                FlickStep { target: fl; from: fl.k[0]; to: fl.k[1]; period: fl.f.period }
                FlickStep { target: fl; from: fl.k[1]; to: fl.k[2]; period: fl.f.period }
                FlickStep { target: fl; from: fl.k[2]; to: fl.k[3]; period: fl.f.period }
                FlickStep { target: fl; from: fl.k[3]; to: fl.k[2]; period: fl.f.period }
                FlickStep { target: fl; from: fl.k[2]; to: fl.k[1]; period: fl.f.period }
                FlickStep { target: fl; from: fl.k[1]; to: fl.k[0]; period: fl.f.period }
            }
            onRunningChanged: if (!running) { fl.sx = 1; fl.sy = 1; fl.rot = 0; fl.opacity = 1; }
        }
    }

    // The crest's drawing (its base at 0, 6) scaled to `size`, its base here.
    Item {
        transform: [
            Translate { y: -6 },
            Scale { xScale: flame._k; yScale: flame._k }
        ]
        Flick {
            name: "crestGust"
            Flick { objectName: "bootFlameOuter"; name: "crest"; Layer { name: "crest" } }
            Flick { name: "crestInner"; Layer { name: "crestInner" } }
            Flick { name: "crestCore"; visible: flame.core; Layer { name: "crestCore" } }
        }
    }
}
