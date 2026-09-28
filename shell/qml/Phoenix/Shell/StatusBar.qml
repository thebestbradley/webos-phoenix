// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The 28px black status bar: carrier or app name on the left, clock in the
// centre, radios and battery on the right. Tapping the right side opens the
// system menu, tapping the app name opens the app menu. On the lock screen
// it is LockWindow's own bar (StatusBar::TypeLockScreen): the date in the
// centre instead of the time, and neither menu.

import QtQuick

Item {
    id: bar

    property var system
    // Shown on the left: app title while an app is maximized, else carrier.
    property string title: system ? system.carrier : ""
    property bool appTitle: false
    property bool systemMenuOpen: false
    property bool lockScreen: false
    // Tablet: an app, the launcher or Just Type is up; the bar's fill fades
    // in under its tiled art (StatusBar::fadeBar, setMaximizedAppTitle).
    property bool filled: false
    // Width of the system indicators at the right (tablet notification
    // icons go just left of them).
    readonly property real systemGroupWidth: indicators.width + Theme.px(6)

    signal systemMenuRequested
    signal appMenuRequested

    height: Theme.statusBarHeight

    function pad(n) { return n < 10 ? "0" + n : "" + n }

    property date now: new Date()
    Timer {
        interval: 1000; running: !bar.system || !bar.system.fixedTime; repeat: true
        onTriggered: bar.now = new Date()
    }
    readonly property date shownTime: system && system.fixedTime ? system.fixedTime : now
    readonly property string clockText: {
        // StatusBarClock::setDisplayDate: the locale's short date.
        if (lockScreen)
            return Qt.formatDate(shownTime, Qt.locale().dateFormat(Locale.ShortFormat));
        // 12 h without a leading zero, or 24 h (StatusBarClock::tick).
        if (system && system.twentyFourHour)
            return pad(shownTime.getHours()) + ":" + pad(shownTime.getMinutes());
        var h = shownTime.getHours() % 12;
        return (h === 0 ? 12 : h) + ":" + pad(shownTime.getMinutes());
    }

    // Phones: solid black. Tablets: #515558 under the tiled art, faded in
    // over 300 ms while an app, the launcher or Just Type is up
    // (lunaAnimations.conf statusBarFade*), the wallpaper through it otherwise.
    Rectangle {
        objectName: "statusBarFill"
        anchors.fill: parent
        color: Theme.statusBarFill
        opacity: !Theme.tablet || bar.filled ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.statusBarFadeDuration } }
    }
    // Tablet only: tiled bar art over the fill (StatusBar.cpp:227,240-262).
    Image {
        anchors.fill: parent
        visible: Theme.tablet
        source: Theme.asset("statusBar/status-bar-background.png")
        fillMode: Image.TileHorizontally
    }

    // ---- Left: carrier / app name --------------------------------------------

    BorderImage {
        id: appNameBg
        visible: bar.appTitle
        anchors.verticalCenter: parent.verticalCenter
        x: Theme.px(2)
        width: titleText.implicitWidth + Theme.px(24)
        height: Theme.px(26)
        source: Theme.asset("statusBar/appname-background.png")
        border { left: 12; right: 12; top: 0; bottom: 0 }
    }

    Text {
        id: titleText
        anchors.verticalCenter: parent.verticalCenter
        x: bar.appTitle ? appNameBg.x + Theme.px(12) : Theme.px(8)
        width: Math.min(implicitWidth, Theme.statusBarTitleMaxWidth)
        elide: Text.ElideRight
        text: bar.title
        color: Theme.text
        font.family: Theme.fontFamily
        font.pixelSize: Theme.statusBarFontSize
        font.bold: bar.appTitle
    }

    MouseArea {
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: parent.width / 3
        enabled: bar.appTitle && !bar.lockScreen
        onClicked: bar.appMenuRequested()
    }

    // ---- Centre: clock -----------------------------------------------------------

    // Tablets put the time at the right end of the system group instead
    // (StatusBar.cpp:98-104); their lock screen keeps the date centred.
    Text {
        objectName: "centreClock"
        visible: !Theme.tablet || bar.lockScreen
        anchors.centerIn: parent
        text: bar.clockText
        color: Theme.text
        font.family: Theme.fontFamily
        font.pixelSize: Theme.statusBarClockFontSize
    }

    // ---- Right: indicators ----------------------------------------------------------

    Image {
        id: menuTab
        anchors.right: parent.right
        anchors.top: parent.top
        height: parent.height
        width: indicators.width + Theme.px(12)
        source: bar.systemMenuOpen ? Theme.asset("statusBar/status-bar-menu-dropdown-tab-pressed.png")
                                   : Theme.asset("statusBar/status-bar-menu-dropdown-tab.png")
        fillMode: Image.Stretch
        opacity: bar.systemMenuOpen ? 1 : 0
    }

    Row {
        id: indicators
        anchors.right: parent.right
        anchors.rightMargin: Theme.px(6)
        anchors.verticalCenter: parent.verticalCenter
        spacing: Theme.statusBarIconSpacing

        // StatusBarInfo paints right to left from the battery: RSSI, WAN,
        // Bluetooth, Wi-Fi, TTY, HAC, call forward, roaming, VPN, rotation
        // lock, mute, airplane (StatusBarInfo.cpp:143-275). This Row runs
        // left to right, so the reverse. Not shown yet, for want of the
        // state: WAN, TTY, HAC, call forward, roaming, VPN.
        Image {
            objectName: "airplaneIcon"
            visible: bar.system !== null && bar.system !== undefined && bar.system.airplaneMode
            source: Theme.asset("statusBar/icon-airplane.png")
            width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
        }
        Image {
            objectName: "muteIcon"
            visible: bar.system !== null && bar.system !== undefined && bar.system.muted
            source: Theme.asset("statusBar/icon-mute.png")
            width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
        }
        Image {
            objectName: "rotationLockIcon"
            visible: bar.system !== null && bar.system !== undefined && bar.system.rotationLocked
            source: Theme.asset("statusBar/icon-rotation-lock.png")
            width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
        }
        Image {
            visible: bar.system && !bar.system.airplaneMode && bar.system.wifiBars >= 0
            source: bar.system ? Theme.asset("statusBar/wifi-" + Math.max(0, bar.system.wifiBars) + ".png") : ""
            width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
        }
        Image {
            visible: bar.system && bar.system.bluetoothOn
            source: Theme.asset("statusBar/bluetooth-on.png")
            width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
        }
        // RSSI, or the flight-mode bars (StatusBar::RSSI_FLIGHT_MODE).
        Image {
            visible: bar.system && (bar.system.airplaneMode || bar.system.signalBars >= 0)
            source: !bar.system ? ""
                    : bar.system.airplaneMode ? Theme.asset("statusBar/rssi-flightmode.png")
                    : Theme.asset("statusBar/rssi-" + Math.max(0, bar.system.signalBars) + ".png")
            width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
        }
        Image {
            objectName: "battery"
            readonly property int step: bar.system ? Theme.batteryState(bar.system.batteryPercent) : 0
            // States 0-11 are battery-N; the full one reuses battery-11, or
            // battery-charged while charging (StatusBarBattery.cpp:150-172).
            source: !bar.system ? ""
                    : bar.system.charging && step === 12 ? Theme.asset("statusBar/battery-charged.png")
                    : bar.system.charging ? Theme.asset("statusBar/battery-charging-" + step + ".png")
                    : Theme.asset("statusBar/battery-" + Math.min(step, 11) + ".png")
            width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
        }
        // Tablet: the clock, rightmost (the system group's first item).
        Text {
            objectName: "tabletClock"
            visible: Theme.tablet && !bar.lockScreen
            anchors.verticalCenter: parent.verticalCenter
            text: bar.clockText
            color: Theme.text
            font.family: Theme.fontFamily
            font.pixelSize: Theme.statusBarClockFontSize
        }
    }

    MouseArea {
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: Math.max(indicators.width + Theme.px(12), parent.width / 3)
        enabled: !bar.lockScreen
        onClicked: bar.systemMenuRequested()
    }
}
