// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The 28px black status bar: carrier or app name on the left, clock in the
// centre, radios and battery on the right. Tapping the right side opens the
// system menu, tapping the app name opens the app menu. On the lock screen
// it is LockWindow's own bar (StatusBar::TypeLockScreen): the date in the
// centre instead of the time, and neither menu.

import QtQuick
import Phoenix.Native

Item {
    id: bar

    property var system
    // Shown on the left: the maximized app's title, "Launcher" or "Just
    // Type", else the carrier (SystemUiController::updateStatusBarTitle).
    property string title: system ? system.carrier : ""
    // Phones: on appname-background.png (everything but the carrier).
    property bool titleBorder: false
    // Tapping the title opens a menu: the arrow shows.
    property bool titleActionable: false
    // Tablets: the fill under the art (the launcher's and Just Type's
    // #4F545A, else the default), changing over 300 ms.
    property color fillColor: Theme.statusBarFill
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
        color: Theme.tablet ? bar.fillColor : Theme.statusBarFill
        Behavior on color { ColorAnimation { duration: Theme.statusBarColorChangeDuration } }
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

    // ---- Left: carrier / app name (StatusBarTitle, StatusBarItemGroup) -------------

    // Phones draw the title on appname-background.png for an app, the
    // launcher and Just Type, not for the carrier; tablets never do
    // (StatusBarTitle::setTitleString).
    readonly property bool _border: !Theme.tablet && titleBorder
    readonly property font _titleFont: FontTools.withPercentageSpacing(Qt.font({
        family: Theme.fontFamily, pixelSize: Theme.statusBarFontSize, bold: true
    }), Theme.statusBarTitleSpacingPercent)

    // The title shown, and the one fading out (animateTitleTransition).
    property string _shownTitle: title
    property bool _shownBorder: _border
    property string _oldTitle: ""
    property bool _oldBorder: false
    function _changeTitle() {
        if (title === _shownTitle && _border === _shownBorder)
            return;
        _oldTitle = _shownTitle;
        _oldBorder = _shownBorder;
        _shownTitle = title;
        _shownBorder = _border;
        titleFade.restart();
    }
    onTitleChanged: _changeTitle()
    on_BorderChanged: _changeTitle()
    NumberAnimation {
        id: titleFade
        target: newTitle
        property: "opacity"
        from: 0
        to: 1
        duration: Theme.statusBarTitleChangeDuration
    }

    component Title: Item {
        id: t
        property string text
        property bool border
        height: bar.height
        width: border ? Theme.px(Theme.statusBarTitleCapLeft) + label.width + Theme.px(Theme.statusBarTitleCapRight)
                      : Theme.statusBarTitlePadding + label.width
        BorderImage {
            visible: t.border
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width
            height: Theme.px(26)
            source: Theme.asset("statusBar/appname-background.png")
            border { left: Theme.statusBarTitleCapLeft; right: Theme.statusBarTitleCapRight; top: 0; bottom: 0 }
        }
        Text {
            id: label
            x: t.border ? Theme.statusBarTitleBorderPadding : Theme.statusBarTitlePadding
            anchors.verticalCenter: parent.verticalCenter
            anchors.verticalCenterOffset: Theme.statusBarTitleBaselineOffset
            // Elided to the 140 px title less its caps or padding
            // (setTitleString, :131-135).
            width: Math.min(implicitWidth, Theme.statusBarTitleMaxWidth
                - (t.border ? Theme.px(Theme.statusBarTitleCapLeft + Theme.statusBarTitleCapRight - 4)
                            : Theme.statusBarTitlePadding))
            elide: Text.ElideRight
            text: t.text
            color: Theme.text
            font: bar._titleFont
        }
    }

    Title {
        id: oldTitle
        text: bar._oldTitle
        border: bar._oldBorder
        opacity: 1 - newTitle.opacity
        visible: opacity > 0
    }
    Title {
        id: newTitle
        objectName: "statusBarTitle"
        text: bar._shownTitle
        border: bar._shownBorder
    }

    // Tablets: the arrow after the title while it opens a menu, and the
    // group's separator at its right end (StatusBarItemGroup paint and
    // layoutLeft). Phones need neither: appname-background.png has the
    // arrow in its right cap. (luna-sysmgr 3.0.5's phone path would draw
    // menu-arrow.png after the pill as well, a second arrow the shipped
    // phones never showed.)
    property real _arrowProgress: titleActionable && !lockScreen ? 1 : 0
    Behavior on _arrowProgress { NumberAnimation { duration: Theme.statusBarArrowFadeDuration; easing.type: Easing.InOutQuad } }
    Image {
        id: titleArrow
        objectName: "statusBarTitleArrow"
        visible: Theme.tablet && opacity > 0
        x: newTitle.width + Theme.statusBarArrowSpacing
        anchors.verticalCenter: parent.verticalCenter
        width: Theme.px(sourceSize.width)
        height: Theme.px(sourceSize.height)
        source: Theme.asset("statusBar/menu-arrow.png")
        opacity: bar._arrowProgress
    }
    Image {
        objectName: "statusBarTitleSeparator"
        visible: Theme.tablet && opacity > 0
        x: titleArrow.x + titleArrow.width + Theme.px(7)             // ARROW_SPACING, StatusBar.h:33
        anchors.verticalCenter: parent.verticalCenter
        width: Theme.px(sourceSize.width)
        height: Theme.px(sourceSize.height)
        source: Theme.asset("statusBar/status-bar-separator.png")
        opacity: bar._arrowProgress
    }

    MouseArea {
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: parent.width / 3
        enabled: bar.titleActionable && !bar.lockScreen
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

    // The tab behind the system group while its menu is open. Tablets:
    // status-bar-menu-dropdown-tab.png in three slices with 11 px caps,
    // fading in and out over 200 ms (StatusBarItemGroup::activate /
    // deactivate and paint, :282-330, 381-396; statusBarMenuFade*,
    // lunaAnimations.conf:124-125).
    BorderImage {
        id: menuTab
        objectName: "systemMenuTab"
        anchors.right: parent.right
        anchors.top: parent.top
        height: parent.height
        width: indicators.width + Theme.px(12)
        source: Theme.tablet || !bar.systemMenuOpen ? Theme.asset("statusBar/status-bar-menu-dropdown-tab.png")
                                                    : Theme.asset("statusBar/status-bar-menu-dropdown-tab-pressed.png")
        border { left: Theme.tablet ? 11 : 0; right: Theme.tablet ? 11 : 0; top: 0; bottom: 0 }
        opacity: bar.systemMenuOpen ? 1 : 0
        Behavior on opacity {
            enabled: Theme.tablet
            NumberAnimation { duration: Theme.statusBarMenuFadeDuration }
        }
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
        Indicator {
            objectName: "airplaneIcon"
            shown: bar.system !== null && bar.system !== undefined && bar.system.airplaneMode
            source: Theme.asset("statusBar/icon-airplane.png")
        }
        Indicator {
            objectName: "muteIcon"
            shown: bar.system !== null && bar.system !== undefined && bar.system.muted
            source: Theme.asset("statusBar/icon-mute.png")
        }
        Indicator {
            objectName: "rotationLockIcon"
            shown: bar.system !== null && bar.system !== undefined && bar.system.rotationLocked
            source: Theme.asset("statusBar/icon-rotation-lock.png")
        }
        Indicator {
            objectName: "wifiIcon"
            shown: !!bar.system && !bar.system.airplaneMode && bar.system.wifiBars >= 0
            source: bar.system ? Theme.asset("statusBar/wifi-" + Math.max(0, bar.system.wifiBars) + ".png") : ""
        }
        Indicator {
            objectName: "bluetoothIcon"
            shown: !!bar.system && bar.system.bluetoothOn
            source: Theme.asset("statusBar/bluetooth-on.png")
        }
        // RSSI, or the flight-mode bars (StatusBar::RSSI_FLIGHT_MODE).
        Indicator {
            objectName: "rssiIcon"
            shown: !!bar.system && (bar.system.airplaneMode || bar.system.signalBars >= 0)
            source: !bar.system ? ""
                    : bar.system.airplaneMode ? Theme.asset("statusBar/rssi-flightmode.png")
                    : Theme.asset("statusBar/rssi-" + Math.max(0, bar.system.signalBars) + ".png")
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

    // A status icon that slides in and out: over 1000 ms its width opens
    // InOutQuad in the first half while it fades in linearly, the right
    // part of the image revealed last; hiding runs it backwards
    // (StatusBarIcon::show / hide / animValueChanged / paint,
    // StatusBarIcon.cpp:84-205; statusBarItemSlide*,
    // lunaAnimations.conf:122-123).
    component Indicator: Item {
        id: ind
        property bool shown: false
        property alias source: img.source
        property real progress: shown ? 1 : 0
        Behavior on progress { NumberAnimation { duration: Theme.statusBarItemSlideDuration } }
        readonly property real widthFactor: {
            var t = Math.min(1, progress * 2);
            return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        }
        visible: shown || progress > 0
        anchors.verticalCenter: parent ? parent.verticalCenter : undefined
        width: img.width * widthFactor
        height: img.height
        clip: true
        opacity: progress
        Image {
            id: img
            width: Theme.px(sourceSize.width)
            height: Theme.px(sourceSize.height)
        }
    }
}
