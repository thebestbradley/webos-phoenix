// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The 28px black status bar: carrier or app name on the left, clock in the
// centre, radios and battery on the right. Tapping the right side opens the
// system menu, tapping the app name opens the app menu.

import QtQuick

Item {
    id: bar

    property var system
    // Shown on the left: app title while an app is maximized, else carrier.
    property string title: system ? system.carrier : ""
    property bool appTitle: false
    property bool systemMenuOpen: false

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
        var h = shownTime.getHours() % 12;
        return (h === 0 ? 12 : h) + ":" + pad(shownTime.getMinutes());
    }

    Rectangle {
        anchors.fill: parent
        color: Theme.statusBarFill
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
        enabled: bar.appTitle
        onClicked: bar.appMenuRequested()
    }

    // ---- Centre: clock -----------------------------------------------------------

    Text {
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

        Image {
            visible: bar.system && bar.system.airplaneMode
            source: Theme.asset("statusBar/rssi-flightmode.png")
            width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
        }
        Image {
            visible: bar.system && !bar.system.airplaneMode && bar.system.signalBars >= 0
            source: bar.system ? Theme.asset("statusBar/rssi-" + Math.max(0, bar.system.signalBars) + ".png") : ""
            width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
        }
        Image {
            visible: bar.system && bar.system.bluetoothOn
            source: Theme.asset("statusBar/bluetooth-on.png")
            width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
        }
        Image {
            visible: bar.system && !bar.system.airplaneMode && bar.system.wifiBars >= 0
            source: bar.system ? Theme.asset("statusBar/wifi-" + Math.max(0, bar.system.wifiBars) + ".png") : ""
            width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
        }
        Image {
            // battery-0..11: 12 steps (images/statusBar/)
            readonly property int step: bar.system ? Math.round(bar.system.batteryPercent / 100 * 11) : 0
            source: !bar.system ? ""
                    : bar.system.charging && bar.system.batteryPercent >= 100 ? Theme.asset("statusBar/battery-charged.png")
                    : bar.system.charging ? Theme.asset("statusBar/battery-charging-" + step + ".png")
                    : Theme.asset("statusBar/battery-" + step + ".png")
            width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
        }
    }

    MouseArea {
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: Math.max(indicators.width + Theme.px(12), parent.width / 3)
        onClicked: bar.systemMenuRequested()
    }
}
