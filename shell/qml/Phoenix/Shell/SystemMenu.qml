// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The status bar's system menu: battery, brightness and the radio / mode
// toggles, dropping down from the top right as in webOS 2.x/3.x.

import QtQuick

Item {
    id: menu

    property var system
    property bool open: false
    signal closeRequested

    // The scene behind, for the blur under the menu.
    property Item backdrop: null

    visible: opacity > 0
    opacity: open ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: 150 } }

    // Tap outside to close.
    MouseArea {
        anchors.fill: parent
        onClicked: menu.closeRequested()
    }

    BorderImage {
        id: panel
        anchors.right: parent.right
        anchors.rightMargin: Theme.px(4)
        y: Theme.statusBarHeight - Theme.px(2)
        width: Theme.px(Theme.tablet ? 300 : 240)
        height: column.height + Theme.px(24)
        source: Theme.asset("menu-dropdown-bg.png")
        border { left: 30; right: 30; top: 30; bottom: 30 }

        MouseArea { anchors.fill: parent }  // swallow taps

        // The scene behind the menu, blurred faintly within its shape.
        BackdropBlur {
            anchors.fill: parent
            z: -1
            source: menu.backdrop
            mask: panelShape
        }
        BorderImage {
            id: panelShape
            visible: false
            anchors.fill: parent
            source: Theme.asset("menu-dropdown-bg.png")
            border { left: 30; right: 30; top: 30; bottom: 30 }
        }

        Column {
            id: column
            x: Theme.px(14)
            y: Theme.px(10)
            width: parent.width - Theme.px(28)

            component Row_: Item {
                id: rowItem
                property string label
                property string value
                property bool toggle: false
                property bool checked: false
                signal clicked
                width: column.width
                height: Theme.px(44)

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: rowItem.label
                    color: Theme.text
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.px(16)
                }
                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.right: parent.right
                    text: rowItem.toggle ? (rowItem.checked ? "On" : "Off") : rowItem.value
                    color: rowItem.toggle && rowItem.checked ? Theme.highlight : Theme.textDim
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.px(14)
                }
                Image {
                    anchors.bottom: parent.bottom
                    width: parent.width
                    source: Theme.asset("menu-divider.png")
                    fillMode: Image.Stretch
                }
                MouseArea { anchors.fill: parent; onClicked: rowItem.clicked() }
            }

            Row_ {
                label: "Battery"
                value: menu.system ? menu.system.batteryPercent + "%" : ""
            }

            Item {
                width: column.width
                height: Theme.px(44)
                Image {
                    id: less
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    source: Theme.asset("statusBar/brightness-less.png")
                    width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
                }
                Image {
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    source: Theme.asset("statusBar/brightness-more.png")
                    width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
                }
                BorderImage {
                    id: track
                    anchors.verticalCenter: parent.verticalCenter
                    x: less.width + Theme.px(8)
                    width: parent.width - 2 * x
                    height: Theme.px(sourceSize.height)
                    source: Theme.asset("statusBar/slider-track.png")
                    border { left: 6; right: 6 }
                    BorderImage {
                        height: parent.height
                        width: menu.system ? parent.width * menu.system.brightness : 0
                        source: Theme.asset("statusBar/slider-track-progress.png")
                        border { left: 6; right: 6 }
                    }
                    Image {
                        source: Theme.asset("statusBar/slider-handle.png")
                        width: Theme.px(sourceSize.width); height: Theme.px(sourceSize.height)
                        anchors.verticalCenter: parent.verticalCenter
                        x: (menu.system ? parent.width * menu.system.brightness : 0) - width / 2
                    }
                    MouseArea {
                        anchors.fill: parent
                        anchors.margins: -Theme.px(12)
                        function set(mx) {
                            if (menu.system)
                                menu.system.brightness = Math.max(0.05, Math.min(1, (mx - Theme.px(12)) / track.width));
                        }
                        onPressed: (m) => set(m.x)
                        onPositionChanged: (m) => set(m.x)
                    }
                }
            }

            Row_ {
                label: "Wi-Fi"; toggle: true
                checked: menu.system && menu.system.wifiBars >= 0
                onClicked: if (menu.system) menu.system.wifiBars = menu.system.wifiBars >= 0 ? -1 : 3
            }
            Row_ {
                label: "Bluetooth"; toggle: true
                checked: menu.system && menu.system.bluetoothOn
                onClicked: if (menu.system) menu.system.bluetoothOn = !menu.system.bluetoothOn
            }
            Row_ {
                label: "Airplane Mode"; toggle: true
                checked: menu.system && menu.system.airplaneMode
                onClicked: if (menu.system) menu.system.airplaneMode = !menu.system.airplaneMode
            }
            Row_ {
                label: "Rotation Lock"; toggle: true
                checked: menu.system && menu.system.rotationLocked
                onClicked: if (menu.system) menu.system.rotationLocked = !menu.system.rotationLocked
            }
            Row_ {
                label: "Mute Sound"; toggle: true
                checked: menu.system && menu.system.muted
                onClicked: if (menu.system) menu.system.muted = !menu.system.muted
            }
        }
    }
}
