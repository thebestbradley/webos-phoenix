// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Lock screen: the large bitmap clock (images/screen-lock-clock-*.png), the
// date, and the padlock you drag up into the ring to unlock. With a PIN or
// password set, the unlock panel asks for it first (LockWindow.cpp
// StatePinEntry); the device lock service checks it, so the shell never
// holds the passcode.

import QtQuick

Item {
    id: lock

    property var system
    // The window source: its lunaCall reaches the device lock service
    // (com.palm.systemmanager getDeviceLockMode / matchDevicePasscode, the
    // legacy webOS API Settings sets the passcode with).
    property var source
    property url wallpaper: ""
    property bool locked: true
    // Asking for the PIN or password.
    readonly property bool pinEntry: unlockPanel.shown
    readonly property alias unlockPanel: unlockPanel
    signal unlockRequested

    onLockedChanged: if (locked) unlockPanel.shown = false

    function _call(method, params, callback) {
        if (!source || !source.lunaCall) {
            callback(null);
            return;
        }
        source.lunaCall("palm://com.palm.systemmanager/" + method, params, callback);
    }

    // The padlock reached the ring: unlock, or ask for the passcode first
    // (LockWindow.cpp:1259-1271).
    function requestUnlock() {
        _call("getDeviceLockMode", {}, function (r) {
            if (!lock.locked)
                return;
            // No lock service, no passcode can have been set.
            var mode = r && r.returnValue !== false ? r.lockMode : "none";
            if (!r || r.returnValue === false)
                console.warn("Phoenix: device lock service unavailable; unlocking");
            if (mode !== "pin" && mode !== "password") {
                lock.unlockRequested();
                return;
            }
            var pin = mode === "pin";
            unlockPanel.setupDialog(pin, qsTr("Device Locked"), pin ? qsTr("Enter PIN") : qsTr("Enter Password"), false, 0);
            unlockPanel.shown = true;
            unlockPanel.forceActiveFocus();
        });
    }

    // LockWindow::slotPasswordSubmitted.
    function _submit(passcode, isPin) {
        _call("matchDevicePasscode", { passCode: passcode }, function (r) {
            if (!lock.locked || !unlockPanel.shown)
                return;
            if (r && r.returnValue !== false && r.succeeded) {
                unlockPanel.shown = false;
                lock.unlockRequested();
                return;
            }
            unlockPanel.queueUpTitle(qsTr("Device Locked"), isPin ? qsTr("Enter PIN") : qsTr("Enter Password"));
            unlockPanel.setupDialog(isPin, isPin ? qsTr("PIN Incorrect") : qsTr("Password Incorrect"),
                                    qsTr("Try Again"), false, 0);
        });
    }

    visible: opacity > 0
    opacity: locked ? 1 : 0
    // LockWindow::fadeWindow: 150 ms InQuad (lunaAnimations.conf:104-105).
    Behavior on opacity { NumberAnimation { duration: Theme.lockWindowFadeDuration; easing.type: Easing.InQuad } }

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

    // At their own height, full width: the top one under the status bar
    // (LockWindow.cpp:2559-2565).
    Image {
        y: Theme.statusBarHeight
        width: parent.width
        height: Theme.px(sourceSize.height)
        source: Theme.asset("screen-lock-wallpaper-mask-top.png")
    }
    Image {
        anchors.bottom: parent.bottom
        width: parent.width
        height: Theme.px(sourceSize.height)
        source: Theme.asset("screen-lock-wallpaper-mask-bottom.png")
    }

    // ---- Clock --------------------------------------------------------------

    Row {
        id: clock
        anchors.horizontalCenter: parent.horizontalCenter
        // Centred 15% down the screen (LockWindow.cpp:427).
        y: Math.max(Theme.statusBarHeight, lock.height * Theme.lockClockCenterRatio - Theme.lockDigitHeight / 2)

        // ClockWindow::tick: 12 h without a leading zero, or 24 h.
        readonly property string text: {
            var m = lock.shownTime.getMinutes();
            var h = lock.shownTime.getHours();
            if (lock.system && lock.system.twentyFourHour)
                return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
            h = h % 12;
            if (h === 0) h = 12;
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

    // The help saucer shows while the padlock is held, until it is dragged
    // out past the radius; after a release it hides a second later
    // (LockWindow::showHelp / startHideHelpTimer, kHideHelpTimeoutInMS).
    property bool helpShown: false
    Timer {
        id: hideHelp
        interval: Theme.lockHideHelpDelay
        onTriggered: lock.helpShown = false
    }

    Image {
        id: target
        anchors.horizontalCenter: parent.horizontalCenter
        // Its bottom level with the padlock's (LockWindow.cpp:449, 454).
        y: lock.height - lock.height * Theme.lockHandleOffsetRatio - height
        width: Theme.px(320)
        height: Theme.px(190)
        source: Theme.asset("screen-lock-target-scrim.png")
        visible: lock.helpShown && !unlockPanel.shown

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
        objectName: "padlock"
        // Not over the unlock panel (LockWindow.cpp:1053).
        visible: !unlockPanel.shown
        width: Theme.lockPadlockSize
        height: Theme.lockPadlockSize
        source: drag.pressed ? Theme.asset("screen-lock-padlock-on.png") : Theme.asset("screen-lock-padlock-off.png")

        readonly property real homeX: (lock.width - width) / 2
        // Rests 10% of the screen height above the bottom (LockWindow.cpp:81, 454).
        readonly property real homeY: lock.height - lock.height * Theme.lockHandleOffsetRatio - height
        // Centred on the finger while held.
        property point finger: Qt.point(homeX + width / 2, homeY + height / 2)
        x: drag.pressed ? finger.x - width / 2 : homeX
        y: drag.pressed ? finger.y - height / 2 : homeY

        // Dragged out of the saucer (146 px, LockWindow.cpp:89) and above
        // where it rests.
        function outside(p) {
            var dx = p.x - (homeX + width / 2), dy = p.y - (homeY + height / 2);
            return dx * dx + dy * dy > Theme.lockUnlockDistance * Theme.lockUnlockDistance && dy < 0;
        }

        MouseArea {
            id: drag
            anchors.fill: parent
            preventStealing: true
            onPressed: { hideHelp.stop(); lock.helpShown = true; }
            onPositionChanged: (m) => {
                var p = mapToItem(lock, m.x, m.y);
                padlock.finger = p;
                lock.helpShown = !padlock.outside(p);
            }
            // LockWindow::handlePenUpStateNormal: back home at once.
            onReleased: (m) => {
                var p = mapToItem(lock, m.x, m.y);
                if (padlock.outside(p))
                    lock.requestUnlock();
                hideHelp.restart();
            }
            onCanceled: hideHelp.restart()
        }
    }

    // ---- PIN / password (uiComponents/UnlockPanel) -----------------------------

    UnlockPanel {
        id: unlockPanel
        objectName: "unlockPanel"
        property bool shown: false
        anchors.centerIn: parent
        opacity: shown ? 1 : 0
        visible: shown || opacity > 0
        enabled: shown
        Behavior on opacity { NumberAnimation { duration: Theme.lockFadeDuration } }
        onEntryCanceled: shown = false
        onPasswordSubmitted: (password, isPIN) => lock._submit(password, isPIN)
    }
}
