// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Full Erase's confirmation (luna-sysmgr Src/lunaui/FullEraseConfirmationWindow.cpp):
// while Power and Volume Up are held with Home pressed
// (WindowServerLuna.cpp:1240-1276), the screen goes black with
// warning-system.png and counts down: "Continue holding for 6 seconds...",
// a second at a time (6 to 0, then the erase: slotTimerTicked, :82-94).
// Letting go of either key before that puts it away
// (cancelFullEraseCountdown). The title 26 px 0.05 of the height down, the
// warning 0.167 down, the countdown 20 px at the middle, the description
// 16 px 0.70 down, white, centred and wrapped across the screen (:33-41,
// :117-160).

import QtQuick

Item {
    id: erase
    objectName: "fullEraseConfirmation"

    property bool shown: false
    property int secondsLeft: 6
    // The erase has been asked for: the window stays until the device restarts.
    property bool pending: false
    signal confirmed

    function show() {
        if (shown)
            return;
        secondsLeft = 6;
        pending = false;
        shown = true;
        ticker.restart();
    }
    function cancel() {
        if (pending)
            return;
        ticker.stop();
        shown = false;
    }

    visible: shown
    MouseArea { anchors.fill: parent; enabled: erase.shown }

    Rectangle {
        anchors.fill: parent
        color: "black"
    }

    Timer {
        id: ticker
        interval: 1000
        repeat: true
        onTriggered: {
            if (erase.secondsLeft === 0) {
                stop();
                erase.pending = true;
                erase.confirmed();
                return;
            }
            erase.secondsLeft--;
        }
    }

    Text {
        objectName: "fullEraseTitle"
        width: parent.width
        y: parent.height * 0.05
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.WordWrap
        text: qsTr("Full Erase")
        color: "white"
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(26)
    }
    Image {
        anchors.horizontalCenter: parent.horizontalCenter
        y: parent.height * 0.167
        width: Theme.artWidth(source)
        height: Theme.artHeight(source)
        source: Theme.asset("warning-system.png")
    }
    Text {
        objectName: "fullEraseCountdown"
        width: parent.width
        y: parent.height * 0.50
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.WordWrap
        text: erase.secondsLeft === 1 ? qsTr("Continue holding for 1 second...")
                                      : qsTr("Continue holding for %1 seconds...").arg(erase.secondsLeft)
        color: "white"
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(20)
    }
    Text {
        width: parent.width
        y: parent.height * 0.70
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.WordWrap
        text: qsTr("Erases applications you installed and all your files on the USB drive.")
        color: "white"
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(16)
    }
}
