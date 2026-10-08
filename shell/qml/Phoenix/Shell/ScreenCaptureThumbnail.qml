// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The capture's thumbnail after a screen capture (Phoenix, as iOS and
// Android show it; docs/SCREENSHOTS.md SC3): framed, in the bottom left
// corner for a few seconds. A tap opens it in the preview (the Screenshot
// app: crop, markup, share, save, delete); a swipe to the left puts it
// away, as does doing nothing. The capture is saved either way.

import QtQuick

Item {
    id: thumb
    objectName: "screenCaptureThumbnail"

    // The capture to show (an ItemGrabResult's url).
    property url image
    // The shell's id for the capture, which the runtime's "Screen
    // captured" notification names (params.capture).
    property string capture: ""
    // Its file, once the runtime has saved it ("" until then).
    property string path: ""
    readonly property bool shown: state === "shown"

    // Tapped: the capture's file, or "" while it is still being saved
    // (with the capture's id, for the shell to open it once it is).
    signal activated(string path, string capture)

    function show(url, captureId) {
        dismissTimer.stop();
        path = "";
        capture = captureId || "";
        image = url;
        swipe.x = 0;
        state = "";             // from the left edge again, if one was up
        state = "shown";
        dismissTimer.restart();
    }
    function hide() {
        dismissTimer.stop();
        state = "";
    }

    // The screen's proportions, a fifth of its width on a tablet and a
    // quarter on a phone held upright.
    readonly property real aspect: parent && parent.width > 0 ? parent.height / parent.width : 1.5
    width: Math.round((parent ? parent.width : 320) * (aspect > 1 ? 0.26 : 0.18))
    height: Math.round(width * aspect)
    x: -width - Theme.px(24)
    visible: x > -width - Theme.px(24)

    states: State {
        name: "shown"
        PropertyChanges { target: thumb; x: Theme.px(16) }
    }
    transitions: Transition {
        NumberAnimation { property: "x"; duration: Theme.motion(250); easing.type: Easing.OutCubic }
    }

    Timer {
        id: dismissTimer
        interval: Theme.screenCaptureThumbnailDuration
        onTriggered: thumb.hide()
    }

    Item {
        id: swipe
        width: parent.width
        height: parent.height
        opacity: x < 0 ? Math.max(0.3, 1 + x / thumb.width) : 1

        // A soft shadow under the frame.
        Rectangle {
            anchors.fill: frame
            anchors.margins: -Theme.px(3)
            anchors.topMargin: -Theme.px(1)
            anchors.bottomMargin: -Theme.px(5)
            radius: frame.radius + Theme.px(3)
            color: Qt.rgba(0, 0, 0, 0.35)
        }
        Rectangle {
            id: frame
            objectName: "screenCaptureThumbnailFrame"
            anchors.fill: parent
            radius: Theme.px(6)
            color: "#ffffff"
            Image {
                objectName: "screenCaptureThumbnailImage"
                anchors.fill: parent
                anchors.margins: Theme.px(3)
                source: thumb.image
                fillMode: Image.PreserveAspectCrop
                smooth: true
                mipmap: true
                asynchronous: false
            }
        }

        MouseArea {
            id: area
            objectName: "screenCaptureThumbnailArea"
            anchors.fill: parent
            anchors.margins: -Theme.px(6)
            drag.target: swipe
            drag.axis: Drag.XAxis
            drag.minimumX: -thumb.width * 2
            drag.maximumX: Theme.px(12)
            drag.filterChildren: false
            preventStealing: true
            onPressed: dismissTimer.stop()
            onReleased: {
                if (swipe.x < -thumb.width * 0.3) {
                    thumb.hide();
                } else {
                    back.start();
                    dismissTimer.restart();
                }
            }
            onClicked: {
                if (Math.abs(swipe.x) > Theme.px(6))
                    return;
                var p = thumb.path;
                thumb.hide();
                thumb.activated(p, thumb.capture);
            }
        }
        NumberAnimation { id: back; target: swipe; property: "x"; to: 0; duration: Theme.motion(200); easing.type: Easing.OutCubic }
    }
}
