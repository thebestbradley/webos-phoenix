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
    // The PIN pad's Emergency Call (UnlockPanel): the shell opens Phone's
    // restricted mode in its emergency window, over the lock screen.
    property bool emergencyAvailable: false
    signal emergencyRequested

    onLockedChanged: if (locked) unlockPanel.shown = false

    // The phone is ringing: the padlock is the incoming-call handle and the
    // help reads "Drag up to answer", shown until the call stops; the call
    // interrupts PIN entry (LockWindow::activatePopUpAlert, :799-803,
    // 857-860, 1994). Unlocking answers it: the phone app hears the lock
    // status change (com.palm.systemmanager getLockStatus).
    property bool incomingCall: false
    // The front popup alert (Notifications puts its window in alertHost).
    property bool alertShown: false
    property real alertHeight: 0
    readonly property alias alertHost: alertHost
    // The dashboard and the banner (Notifications' model and banner): with
    // "Show notifications when locked" on (showAlertsWhenLocked), the
    // lock screen shows the banner while one plays and the dashboard
    // otherwise; neither over a popup alert or the unlock panel
    // (LockWindow::changeState, slotBannerActivated/Deactivated,
    // :836-946, 1024-1045).
    property var notifications: null
    property bool bannerActive: false
    property string bannerText: ""
    property color bannerColor: "#666666"
    property string bannerGlyph: ""
    property url bannerIcon: ""
    property real bannerOpacity: 1
    readonly property bool showAlertsWhenLocked: !system || system.showAlertsWhenLocked !== false
    readonly property bool _alertsShown: locked && showAlertsWhenLocked && !alertShown && !unlockPanel.shown
    readonly property bool bannerShown: _alertsShown && bannerActive
    readonly property bool dashboardShown: _alertsShown && !bannerActive && notifications !== null && notifications.count > 0

    onIncomingCallChanged: {
        if (incomingCall) {
            unlockPanel.shown = false;
            hideHelp.stop();
            helpShown = true;
        } else if (!drag.pressed) {
            hideHelp.restart();
        }
    }

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
    // Unlocked, it takes no input while it fades out: the screen under it
    // is already the user's (the original stops routing input to the lock
    // window once it unlocks).
    enabled: locked
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
        height: Theme.artHeight(source)
        source: Theme.asset("screen-lock-wallpaper-mask-top.png")
    }
    Image {
        anchors.bottom: parent.bottom
        width: parent.width
        height: Theme.artHeight(source)
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

    // ---- Popup alert (LockWindow PopUpAlert) ---------------------------------------
    // Centred, 320 px wide less its 10 px padding, on popup-bg.png; an incoming
    // call gets the whole height from under the bar to 84 px above the
    // bottom (adjustAlertBounds, kAlertsFromBottom). Under the padlock.
    ArtBorderImage {
        id: alertFrame
        objectName: "lockAlert"
        visible: opacity > 0
        opacity: lock.locked && lock.alertShown && !unlockPanel.shown ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.alertFadeDuration } }
        anchors.horizontalCenter: parent.horizontalCenter
        readonly property real contentWidth: Math.min(Theme.px(320), lock.width) - 2 * Theme.px(10)
        readonly property real contentHeight: lock.incomingCall
            ? lock.height - Theme.statusBarHeight - Theme.px(84) - 2 * Theme.px(10)
            : lock.alertHeight
        width: contentWidth + 2 * Theme.px(20)
        height: contentHeight + 2 * Theme.px(20)
        y: lock.incomingCall ? Theme.statusBarHeight - Theme.px(10) : (lock.height - height) / 2
        source: Theme.asset("popup-bg.png")
        border { left: Theme.artBorder(20, source); right: Theme.artBorder(20, source); top: Theme.artBorder(20, source); bottom: Theme.artBorder(20, source) }
        MouseArea { anchors.fill: parent }
        Item {
            id: alertHost
            anchors.fill: parent
            anchors.margins: Theme.px(20)
        }
    }

    // ---- Dashboard (LockWindow DashboardAlerts, :2597-2743) ---------------------
    // Centred, 320 px wide: the newest first, each 52 px row with a divider
    // under all but the last; at most 6, the sixth cut in half under
    // dashboard-scroll-fade.png. A tap reaches a dashboard window only when
    // it asked for {clickableWhenLocked: true}, and not while the help
    // saucer shows (:1862-1883; DashboardWindowContainer.cpp:1069).
    ArtBorderImage {
        id: lockDashboard
        objectName: "lockDashboard"
        readonly property int count: lock.notifications ? Math.min(lock.notifications.count, Theme.lockDashboardMaxItems) : 0
        readonly property real dividerHeight: Theme.px(2)            // menu-divider.png
        readonly property real contentHeight: count * Theme.dashboardItemHeight + Math.max(0, count - 1) * dividerHeight
            - (count === Theme.lockDashboardMaxItems ? Theme.dashboardItemHeight / 2 : 0)
        visible: opacity > 0
        opacity: lock.dashboardShown ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.lockFadeDuration } }
        anchors.horizontalCenter: parent.horizontalCenter
        width: Theme.lockAlertsWidth + 2 * Theme.lockAlertsShadow
        height: contentHeight + 2 * Theme.lockAlertsShadow + Theme.lockDashboardTopPadding + Theme.lockDashboardBottomPadding
        y: (lock.height - contentHeight) / 2 - Theme.lockAlertsShadow - Theme.lockDashboardTopPadding
        source: Theme.asset("popup-bg.png")
        border { left: Theme.artBorder(Theme.lockAlertsBorder, source); right: Theme.artBorder(Theme.lockAlertsBorder, source); top: Theme.artBorder(Theme.lockAlertsBorder, source); bottom: Theme.artBorder(Theme.lockAlertsBorder, source) }

        Item {
            id: dashboardRows
            x: Theme.lockAlertsShadow
            y: Theme.lockAlertsShadow + Theme.lockDashboardTopPadding
            width: Theme.lockAlertsWidth
            height: lockDashboard.contentHeight
            clip: true

            Column {
                width: parent.width
                Repeater {
                    // Only while the lock screen shows: a dashboard window is
                    // one live page, and the notification area has it
                    // otherwise.
                    model: lock.visible ? lockDashboard.count : 0
                    delegate: Column {
                        id: row
                        required property int index
                        readonly property var entry: lock.notifications.get(lock.notifications.count - 1 - index)
                        width: dashboardRows.width
                        DashboardItem {
                            objectName: "lockDashboardItem"
                            width: parent.width
                            source: lock.source
                            windowKey: row.entry.windowKey
                            title: row.entry.title
                            body: row.entry.body
                            color: row.entry.color
                            glyph: row.entry.glyph
                            icon: row.entry.icon
                            progress: row.entry.progress === undefined ? -1 : row.entry.progress
                            // Taps reach the window only when it allows them.
                            MouseArea {
                                anchors.fill: parent
                                z: 2
                                enabled: !(row.entry.clickableWhenLocked && row.entry.windowKey !== "" && !lock.helpShown)
                            }
                        }
                        Image {
                            visible: row.index < lockDashboard.count - 1
                            width: parent.width
                            height: lockDashboard.dividerHeight
                            source: Theme.asset("menu-divider.png")
                            fillMode: Image.Stretch
                        }
                    }
                }
            }

            Image {
                visible: lockDashboard.count === Theme.lockDashboardMaxItems
                anchors.bottom: parent.bottom
                width: parent.width
                height: Theme.artHeight(source)
                source: Theme.asset("dashboard-scroll-fade.png")
            }
        }
    }

    // ---- Banner (LockWindow BannerAlerts, :2745-2811) -----------------------------
    // Centred, 320 px by the banner's 28 px, 10 px padding inside the
    // popup-bg.png shadow; the message sits still, icon and text 5 px in
    // (BannerMessageView::NoScroll; BannerMessageHandler.cpp:410-430).
    ArtBorderImage {
        id: lockBanner
        objectName: "lockBanner"
        visible: opacity > 0
        opacity: lock.bannerShown ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.lockFadeDuration } }
        anchors.horizontalCenter: parent.horizontalCenter
        readonly property real inset: Theme.lockAlertsShadow + Theme.lockBannerPadding
        width: Theme.lockAlertsWidth + 2 * inset
        height: Theme.bannerHeight + 2 * inset
        y: (lock.height - height) / 2
        source: Theme.asset("popup-bg.png")
        border { left: Theme.artBorder(Theme.lockAlertsBorder, source); right: Theme.artBorder(Theme.lockAlertsBorder, source); top: Theme.artBorder(Theme.lockAlertsBorder, source); bottom: Theme.artBorder(Theme.lockAlertsBorder, source) }

        Row {
            x: lockBanner.inset + Theme.px(5)
            y: lockBanner.inset + (Theme.bannerHeight - height) / 2
            width: Theme.lockAlertsWidth - Theme.px(5)
            spacing: Theme.px(5)
            opacity: lock.bannerOpacity
            AppIcon {
                id: lockBannerIcon
                size: Theme.px(22)
                showLabel: false
                color: lock.bannerColor
                glyph: lock.bannerGlyph
                source: lock.bannerIcon
            }
            Text {
                objectName: "lockBannerText"
                anchors.verticalCenter: parent.verticalCenter
                width: parent.width - lockBannerIcon.width - parent.spacing
                elide: Text.ElideRight
                text: lock.bannerText
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: Theme.bannerFontSize
            }
        }
    }

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
            text: lock.incomingCall ? qsTr("Drag up to answer") : qsTr("Drag up to unlock")
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
        source: Theme.asset((lock.incomingCall ? "screen-lock-incoming-call-" : "screen-lock-padlock-")
                            + (drag.pressed ? "on.png" : "off.png"))

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
                lock.helpShown = lock.incomingCall || !padlock.outside(p);
            }
            // LockWindow::handlePenUpStateNormal: back home at once.
            onReleased: (m) => {
                var p = mapToItem(lock, m.x, m.y);
                if (padlock.outside(p))
                    lock.requestUnlock();
                if (!lock.incomingCall)
                    hideHelp.restart();
            }
            onCanceled: if (!lock.incomingCall) hideHelp.restart()
        }
    }

    // ---- PIN / password (uiComponents/UnlockPanel) -----------------------------

    UnlockPanel {
        id: unlockPanel
        objectName: "unlockPanel"
        property bool shown: false
        // A password (not a PIN) is typed on the virtual keyboard: faded in,
        // the panel is its input client (UnlockPanel.qml onOpacityChanged ->
        // requestFocusChange -> LockWindow::slotPinPanelFocusRequest,
        // LockWindow.cpp:1540-1554).
        readonly property bool inputClient: shown && !isPINEntry && opacity === 1
        anchors.centerIn: parent
        opacity: shown ? 1 : 0
        visible: shown || opacity > 0
        enabled: shown
        Behavior on opacity { NumberAnimation { duration: Theme.lockFadeDuration } }
        emergencyAvailable: lock.emergencyAvailable
        onEntryCanceled: shown = false
        onPasswordSubmitted: (password, isPIN) => lock._submit(password, isPIN)
        onEmergencyRequested: lock.emergencyRequested()
    }
}
