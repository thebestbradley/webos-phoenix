// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The boot animation (luna-sysmgr Src/base/BootupAnimation.cpp): black, the
// logo in the middle with its lit copy over it, the light swelling and
// fading as the device starts. Frames every 80 ms (s_frameTimeSlow); the
// lit logo's alpha climbs from -128 (clamped to 0: dark for the first
// part) by 8 a frame to 255, then falls and climbs by 15
// (renderInStateLogo, :271-322): a first glow of about 4 s
// (kFirstGlowAnimDuration), then one every 2 s (kGlowAnimDuration). Phoenix
// draws its own logo (boot-logo.png, boot-logo-bright.png): HP's is a
// trademark Apache-2.0 does not license.
//
// "activity": "Updating the system", while an update finishes
// (renderInStateActivity, :324-418): activity-static.png, or the frame of
// activity-progress.png (20 frames) for the progress so far, with
// activity-spinner.png's 10 frames turning in it; under them, at the
// bottom, "Updating the system" (20 px, white at 0xC0) and "Do not remove
// battery" (16 px, 0x80). Once the progress is full it goes back to the
// logo (:404-415).
//
// finish(): the boot is over (WindowServer::bootupFinished): the logo
// alone grows to twice its size as it fades, 700 ms, linear
// (BootupAnimationTransition, kFadeAnimDuration, :556-581), and the
// screen under it shows.
//
// What Phoenix does differently: at start-up (start(false)) the logo's
// glow is replaced by a story of its own (BootStory.qml), as the owner
// asked: the orb, without the emblem, a dead face; its glow turning gold;
// it catches fire, screams and burns down to ash; a small gold bird-orb
// shoots out of the ash, flies about the screen and becomes the
// Assistant bird's entrance; the bird lands and waves. `style` "classic"
// (Settings > Advanced > Start-up animation: Classic) keeps the original
// glow above, unchanged; so does the logo after "Updating the system".
// The story plays to the end of the wave even when the boot is over
// sooner: finish() then waits for it (finishPending) before the
// transition; a boot that takes longer leaves the bird standing, idle,
// until finish(). A tap skips to the wave, or straight to the transition
// once finish() has been called. `running` stays true throughout.

import QtQuick

Item {
    id: boot
    objectName: "bootAnimation"

    // "logo", "activity", or "" when not running.
    property string mode: ""
    // The logo at start-up: "phoenix" (the story, BootStory.qml) or
    // "classic" (the original glow); Settings > Advanced > Start-up
    // animation. Read as it starts.
    property string style: "phoenix"
    // This start's logo is the story.
    property bool _story: false
    readonly property bool storyShown: _story && storyLoader.item !== null
    readonly property var story: storyLoader.item
    // finish() came before the story's end: the transition waits for it.
    property bool finishPending: false
    readonly property bool running: mode !== "" || transition.running
    // The lit logo's alpha (renderInStateLogo's sCurrAlpha) and step.
    property int glowAlpha: -128
    property int _glowDelta: 8
    // Progress frames (0: activity-static.png; 1-20: activity-progress.png's)
    // and the spinner's frame (0-9).
    property int progress: 0
    property int spinnerFrame: 0
    readonly property int progressTotal: 20     // s_activityProgressTotal
    readonly property int spinnerTotal: 10      // s_activitySpinnerTotal
    readonly property int frameTime: 80         // s_frameTimeSlow

    // Turned by this much (0, 90, 180, 270, clockwise), so the logo and the
    // update screen are upright with the Home button below
    // (HomeButtonOrientationAngle: renderInStateLogo / renderInStateActivity
    // turn the context, BootupAnimation.cpp:167-180, 283-286, 337-340; the
    // transition's pixmap, :587-596).
    property int angle: 0
    readonly property bool _sideways: angle === 90 || angle === 270

    signal finished

    // BootupAnimation::start / startActivity.
    function start(activity) {
        glowAlpha = -128;
        _glowDelta = 8;
        progress = 0;
        spinnerFrame = 0;
        finishPending = false;
        _story = !activity && style !== "classic";
        // A story already there starts again; a new one starts as it loads.
        var had = storyLoader.item;
        mode = activity ? "activity" : "logo";
        opacity = 1;
        scale = 1;
        if (had && storyLoader.item === had)
            had.start();
    }
    // setActivityProgress (:532-537): val of total, in 20 steps.
    function setProgress(val, total) {
        if (total <= 0)
            return;
        val = Math.max(0, Math.min(total, val));
        progress = Math.max(0, Math.min(progressTotal, Math.round(val * progressTotal / total)));
    }
    function finish() {
        if (mode === "" || finishPending)
            return;
        // The story plays to the end of its wave first.
        if (storyShown && !storyLoader.item.done) {
            finishPending = true;
            return;
        }
        _finishNow();
    }
    function _finishNow() {
        finishPending = false;
        // The transition first: running (and SystemScreens.holdsDisplay)
        // stays true from the logo to the end of the fade, not false for
        // the moment between them.
        transition.start();
        mode = "";
    }

    visible: running
    // Faded and grown as one picture, as the original drew it (the logo on
    // black in one pixmap): not the logo's own black square over the fill.
    layer.enabled: transition.running

    // Swallows the input while it shows; a tap skips the story (to its
    // wave, or to its end once the boot is over).
    MouseArea {
        anchors.fill: parent
        enabled: boot.running
        onClicked: {
            if (!boot.storyShown || boot.mode === "")
                return;
            if (boot.finishPending)
                boot.story.end();
            else
                boot.story.skip();
        }
    }

    Rectangle {
        anchors.fill: parent
        color: "black"
    }

    Timer {
        interval: boot.frameTime
        repeat: true
        running: boot.mode === "activity" || (boot.mode === "logo" && !boot._story)
        onTriggered: {
            if (boot.mode === "logo") {
                var a = boot.glowAlpha + boot._glowDelta;
                if (a <= -128) {
                    boot._glowDelta = 15;
                    a = -128;
                } else if (a >= 255) {
                    boot._glowDelta = -15;
                    a = 255;
                }
                boot.glowAlpha = a;
            } else {
                boot.spinnerFrame = (boot.spinnerFrame + 1) % boot.spinnerTotal;
                if (boot.progress === boot.progressTotal) {
                    boot.glowAlpha = -128;
                    boot._glowDelta = 8;
                    boot.mode = "logo";
                }
            }
        }
    }

    // ---- The logo -----------------------------------------------------------------

    Item {
        id: logo
        anchors.centerIn: parent
        rotation: boot.angle
        width: Theme.artWidth(normal.source)
        height: Theme.artHeight(normal.source)
        visible: boot.mode !== "activity" && !boot._story
        Image {
            id: normal
            objectName: "bootLogo"
            anchors.fill: parent
            source: Theme.asset("boot-logo.png")
        }
        Image {
            objectName: "bootLogoBright"
            anchors.fill: parent
            source: Theme.asset("boot-logo-bright.png")
            opacity: Math.max(0, Math.min(255, boot.glowAlpha)) / 255
            visible: boot.mode !== ""
        }
    }

    // ---- Updating the system --------------------------------------------------------

    Item {
        id: activity
        objectName: "bootActivity"
        anchors.centerIn: parent
        width: boot._sideways ? parent.height : parent.width
        height: boot._sideways ? parent.width : parent.height
        rotation: boot.angle
        visible: boot.mode === "activity"

        Image {
            anchors.centerIn: parent
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
            source: Theme.asset("activity-static.png")
            visible: boot.progress === 0
        }
        Item {
            id: progressFrame
            anchors.centerIn: parent
            width: Theme.artWidth(staticArt.source)
            height: Theme.artHeight(staticArt.source)
            clip: true
            visible: boot.progress > 0
            Image { id: staticArt; visible: false; source: Theme.asset("activity-static.png") }
            Image {
                source: Theme.asset("activity-progress.png")
                width: Theme.artWidth(source)
                height: Theme.artHeight(source)
                y: -(boot.progress - 1) * progressFrame.height
            }
        }
        Item {
            id: spinner
            anchors.centerIn: parent
            width: Theme.artWidth(spinnerArt.source)
            height: width
            clip: true
            Image {
                id: spinnerArt
                source: Theme.asset("activity-spinner.png")
                width: Theme.artWidth(source)
                height: Theme.artHeight(source)
                y: -boot.spinnerFrame * spinner.height
            }
        }

        // Each line centred, its baseline 40 and 20 px above the bottom.
        Text {
            objectName: "bootActivityLine1"
            anchors.horizontalCenter: parent.horizontalCenter
            y: parent.height - Theme.px(40) - baselineOffset
            text: qsTr("Updating the system")
            color: Qt.rgba(1, 1, 1, 0xC0 / 255)
            font.family: Theme.fontFamily
            font.bold: true
            font.pixelSize: Theme.px(20)
        }
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            y: parent.height - Theme.px(20) - baselineOffset
            text: qsTr("Do not remove battery")
            color: Qt.rgba(1, 1, 1, 0x80 / 255)
            font.family: Theme.fontFamily
            font.bold: true
            font.pixelSize: Theme.px(16)
        }
    }

    // ---- The story (Phoenix) -------------------------------------------------------

    Loader {
        id: storyLoader
        anchors.fill: parent
        active: boot._story && boot.running
        sourceComponent: BootStory {
            angle: boot.angle
            onEnded: if (boot.finishPending) boot._finishNow()
        }
        onLoaded: item.start()
    }

    // BootupAnimationTransition: the logo, alone on black, twice as big
    // and gone in 700 ms.
    ParallelAnimation {
        id: transition
        NumberAnimation { target: boot; property: "opacity"; from: 1; to: 0; duration: Theme.motion(700) }
        NumberAnimation { target: boot; property: "scale"; from: 1; to: 2; duration: Theme.motion(700) }
        onFinished: {
            boot.scale = 1;
            boot.finished();
        }
    }
}
