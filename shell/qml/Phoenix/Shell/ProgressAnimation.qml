// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The full-screen progress animation (luna-sysmgr Src/base/ProgressAnimation.cpp;
// WindowServer::startProgressAnimation / stopProgressAnimation,
// WindowServer.cpp:1089-1124): black, a picture with its glow pulsing over
// it, and a picture on top.
//   "msm"   normal-bg.png, glow-bg.png pulsing, msm-usb.png (USB drive mode)
//   "fsck"  the same with msm-fsck-usb.png and, written on it from 0.58 of
//           its height in its middle third, "OWWW! That hurts!" (18 px bold)
//           and "Next time, please unmount the drive from the desktop."
//           (18 px), white (constructLogo, :101-140): the drive is being
//           checked after it was pulled out
//   "logo"  (any other type; TypeHp) boot-logo.png, boot-logo-bright.png
//           pulsing: Phoenix's logo for HP's
// The glow: 0 to 1 over 2000 ms InQuad, then back the same way, and again
// (progressPulseDuration, progressPulseCurve; conf/lunaAnimations.conf:98-99).
// stop(): the glow stops and the whole grows to twice its size as it
// fades, 700 ms InQuad (progressFinishDuration/Curve, :100-101), then it
// is gone. (The black is square in the original, as wide as the screen is
// long, so it need not be redrawn when the screen turns; here it fills
// the screen, which the shell lays out again when it turns.) Phoenix's msm-usb.png and msm-fsck-usb.png stand for
// normal-usb.png and fsck-usb.png, which pictured the TouchPad.

import QtQuick

Item {
    id: progress
    objectName: "progressAnimation"

    property string type: ""
    readonly property bool running: _shown
    property bool _shown: false
    property bool _pulsing: false
    property real brightness: 0

    function start(t) {
        if (_shown)
            return;   // WindowServer::startProgressAnimation: one at a time
        type = t === "msm" || t === "fsck" ? t : "logo";
        finish.stop();
        content.opacity = 1;
        content.scale = 1;
        _shown = true;
        _pulsing = true;
        brightness = 0;
        pulse.forward = true;
        pulse.restart();
    }
    function stop() {
        if (!_shown || finish.running)
            return;
        _pulsing = false;
        pulse.stop();
        finish.start();
    }

    visible: _shown
    MouseArea { anchors.fill: parent; enabled: progress._shown }

    // All of it grows and fades at the end, the black too: the screen
    // under it shows through.
    Item {
        id: content
        // Grown and faded as one picture (the original's one item).
        layer.enabled: finish.running
        // The USB pictures, 768 px, drawn for the TouchPad's screen: on a
        // smaller one they shrink with it, to its longer side (Phoenix).
        readonly property real fit: progress.type === "logo" ? 1 : Math.min(1, Math.max(width, height) / Theme.px(768))
        anchors.fill: parent

        Rectangle {
            anchors.fill: parent
            color: "black"
        }
        Image {
            id: normal
            anchors.centerIn: parent
            scale: content.fit
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
            source: Theme.asset(progress.type === "logo" ? "boot-logo.png" : "normal-bg.png")
        }
        Image {
            anchors.centerIn: parent
            scale: content.fit
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
            source: Theme.asset(progress.type === "logo" ? "boot-logo-bright.png" : "glow-bg.png")
            visible: progress._pulsing
            opacity: progress.brightness
        }
        Image {
            id: picture
            objectName: "progressPicture"
            anchors.centerIn: parent
            scale: content.fit
            visible: progress.type !== "logo"
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
            source: progress.type === "logo" ? "" : Theme.asset(progress.type === "fsck" ? "msm-fsck-usb.png" : "msm-usb.png")

            // In the picture's middle third, from 0.58 of its height (kLabelRatio).
            Text {
                id: fsckTitle
                objectName: "progressTitle"
                visible: progress.type === "fsck"
                x: picture.width / 3
                width: picture.width / 3
                y: picture.height * 0.58
                horizontalAlignment: Text.AlignHCenter
                text: qsTr("OWWW! That hurts!")
                color: "white"
                font.family: Theme.fontFamily
                font.bold: true
                font.pixelSize: Theme.px(18)
            }
            Text {
                objectName: "progressDescription"
                visible: progress.type === "fsck"
                x: picture.width / 3
                width: picture.width / 3
                y: fsckTitle.y + fsckTitle.height * 2
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
                text: qsTr("Next time, please unmount the drive from the desktop.")
                color: "white"
                font.family: Theme.fontFamily
                font.pixelSize: Theme.px(18)
            }
        }
    }

    // The pulse, its direction turned at each end (slotPulseCompleted).
    NumberAnimation {
        id: pulse
        property bool forward: true
        target: progress
        property: "brightness"
        from: forward ? 0 : 1
        to: forward ? 1 : 0
        duration: Theme.motion(2000)
        easing.type: forward ? Easing.InQuad : Easing.OutQuad
        onFinished: {
            if (!progress._pulsing)
                return;
            forward = !forward;
            restart();
        }
    }

    ParallelAnimation {
        id: finish
        NumberAnimation { target: content; property: "scale"; to: 2; duration: Theme.motion(700); easing.type: Easing.InQuad }
        NumberAnimation { target: content; property: "opacity"; to: 0; duration: Theme.motion(700); easing.type: Easing.InQuad }
        onFinished: progress._shown = false
    }
}
