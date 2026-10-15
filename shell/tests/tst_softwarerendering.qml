// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Without a GPU the blur behind translucent surfaces steps down
// (BackdropBlur, RenderInfo.softwareRendering): forced on, it is off and
// does not even take the snapshot of the scene behind; forced off, it blurs
// whatever the renderer; by itself (auto) it follows what RenderInfo saw of
// the renderer: Qt Quick's software renderer, which these tests run on
// offscreen, or a software rasteriser such as llvmpipe, count as no GPU.
// The Assistant's backdrop (tst_assistant) darkens where nothing blurs.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Native

Item {
    id: root
    width: 320
    height: 480

    Rectangle {
        id: scene
        anchors.fill: parent
        color: "#2060a0"
        Rectangle { x: 40; y: 60; width: 120; height: 80; color: "white" }
    }

    Item {
        id: surface
        x: 20
        y: 40
        width: 200
        height: 120
        BackdropBlur {
            id: blur
            anchors.fill: parent
            source: scene
        }
    }

    TestCase {
        name: "SoftwareRendering"
        when: windowShown

        property string savedMode

        function initTestCase() {
            savedMode = RenderInfo.mode;
        }
        function cleanup() {
            RenderInfo.mode = savedMode;
        }

        // The blur's picture of the scene behind (ShaderEffectSource).
        function snapshot() {
            for (var i = 0; i < blur.children.length; ++i) {
                if (blur.children[i].sourceRect !== undefined)
                    return blur.children[i];
            }
            return null;
        }

        function test_forcedOnStepsDown() {
            RenderInfo.mode = "on";
            verify(RenderInfo.softwareRendering);
            verify(!blur.visible, "no blur");
            verify(snapshot() !== null);
            compare(snapshot().sourceItem, null, "nothing behind redrawn for it");
        }

        function test_forcedOffBlurs() {
            RenderInfo.mode = "off";
            verify(!RenderInfo.softwareRendering);
            verify(blur.visible, "the blur, whatever the renderer");
            compare(snapshot().sourceItem, scene);
            compare(blur.region, Qt.rect(20, 40, 200, 120));
        }

        function test_switchesBothWays() {
            RenderInfo.mode = "off";
            verify(blur.visible);
            RenderInfo.mode = "on";
            verify(!blur.visible);
            RenderInfo.mode = "off";
            verify(blur.visible);
        }

        // By itself it follows the renderer RenderInfo saw drawing this
        // window: the API at once, the device once the scene graph is up.
        function test_autoFollowsTheRenderer() {
            RenderInfo.mode = "auto";
            tryVerify(function () { return RenderInfo.graphicsApi !== ""; }, 5000, "the renderer seen");
            compare(RenderInfo.softwareRendering, RenderInfo.softwareDetected);
            compare(blur.visible, !RenderInfo.softwareDetected);
            if (GraphicsInfo.api === GraphicsInfo.Software) {
                compare(RenderInfo.graphicsApi, "Software");
                verify(RenderInfo.softwareDetected, "Qt Quick's software renderer is no GPU");
            }
        }

        function test_modeTakesAutoOnOrOff() {
            RenderInfo.mode = "off";
            ignoreWarning('RenderInfo.mode: "sometimes" is not auto, on or off');
            RenderInfo.mode = "sometimes";
            compare(RenderInfo.mode, "off");
            RenderInfo.mode = "1";
            compare(RenderInfo.mode, "on");
        }
    }
}
