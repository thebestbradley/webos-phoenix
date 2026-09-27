// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Lock screen: the large bitmap clock (images/screen-lock-clock-*.png), the
// date, and the padlock you drag up into the ring to unlock.

import QtQuick

Item {
    id: lock

    property var system
    property url wallpaper: ""
    property bool locked: true
    signal unlockRequested

    visible: opacity > 0
    opacity: locked ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: 300 } }

    property date now: new Date()
    Timer {
        interval: 1000; repeat: true
        running: lock.visible && (!lock.system || !lock.system.fixedTime)
        onTriggered: lock.now = new Date()
    }
    readonly property date shownTime: system && system.fixedTime ? system.fixedTime : now

    // Swallow input to everything underneath.
    MouseArea { anchors.fill: parent }

    // The lock screen hides the cards: just the wallpaper behind the clock.
    Wallpaper {
        anchors.fill: parent
        source: lock.wallpaper
    }

    Image {
        anchors.top: parent.top
        width: parent.width
        height: parent.height * 0.4
        source: Theme.asset("screen-lock-wallpaper-mask-top.png")
        fillMode: Image.Stretch
    }
    Image {
        anchors.bottom: parent.bottom
        width: parent.width
        height: parent.height * 0.4
        source: Theme.asset("screen-lock-wallpaper-mask-bottom.png")
        fillMode: Image.Stretch
    }

    // ---- Clock --------------------------------------------------------------

    Row {
        id: clock
        anchors.horizontalCenter: parent.horizontalCenter
        // Centred 15% down the screen (LockWindow.cpp:427).
        y: Math.max(Theme.statusBarHeight, lock.height * Theme.lockClockCenterRatio - Theme.lockDigitHeight / 2)

        readonly property string text: {
            var h = lock.shownTime.getHours() % 12;
            if (h === 0) h = 12;
            var m = lock.shownTime.getMinutes();
            return h + ":" + (m < 10 ? "0" : "") + m;
        }

        Repeater {
            model: clock.text.length
            delegate: Image {
                required property int index
                readonly property string ch: clock.text.charAt(index)
                source: Theme.asset(ch === ":" ? "screen-lock-clock-colon.png" : "screen-lock-clock-" + ch + ".png")
                width: ch === ":" ? Theme.lockColonWidth : Theme.lockDigitWidth
                height: Theme.lockDigitHeight
            }
        }
    }

    Text {
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: clock.bottom
        anchors.topMargin: Theme.px(4)
        text: Qt.formatDate(lock.shownTime, "dddd, MMMM d")
        color: Theme.text
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(16)
        style: Text.Raised
        styleColor: "#000000"
    }

    // ---- Unlock target + padlock ----------------------------------------------

    Image {
        id: target
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: Theme.gestureAreaHeight
        width: Theme.px(320)
        height: Theme.px(190)
        source: Theme.asset("screen-lock-target-scrim.png")
        opacity: drag.active ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: 150 } }

        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            y: Theme.px(40)
            text: qsTr("Drag up to unlock")
            color: Theme.text
            font.family: Theme.fontFamily
            font.pixelSize: Theme.lockHelpFontSize
            font.bold: true
        }
    }

    Image {
        id: padlock
        width: Theme.lockPadlockSize
        height: Theme.lockPadlockSize
        source: drag.active ? Theme.asset("screen-lock-padlock-on.png") : Theme.asset("screen-lock-padlock-off.png")

        readonly property real homeX: (lock.width - width) / 2
        // Rests 10% of the screen height above the bottom (LockWindow.cpp:81).
        readonly property real homeY: lock.height - lock.height * Theme.lockHandleOffsetRatio - height
        x: homeX
        y: homeY

        // Unlock once the padlock has been dragged this far up (LockWindow.cpp:89).
        readonly property real unlockDistance: Theme.lockUnlockDistance

        MouseArea {
            id: drag
            anchors.fill: parent
            readonly property bool active: pressed
            drag.target: padlock
            drag.axis: Drag.YAxis
            drag.minimumY: 0
            drag.maximumY: padlock.homeY
            onReleased: {
                if (padlock.homeY - padlock.y > padlock.unlockDistance)
                    lock.unlockRequested();
                padlockReturn.start();
            }
        }

        NumberAnimation on y {
            id: padlockReturn
            running: false
            to: padlock.homeY
            duration: 200
            easing.type: Easing.OutCubic
        }
    }
}
