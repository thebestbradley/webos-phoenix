// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The keyboard shortcuts, listed while their modifier is held (GAPS V8:
// "a sheet listing them while Ctrl is held", as an iPad shows Command's):
// the shell's own and the original keyboard keys, on the popup art.

import QtQuick
import "KeyboardShortcuts.js" as KS

ArtBorderImage {
    id: sheet
    objectName: "shortcutSheet"

    property string scheme: "ipad"
    property bool shown: false
    readonly property bool mac: Qt.platform.os === "osx"
    readonly property var entries: KS.scheme(scheme).concat([
        { label: qsTr("Just Type"), text: qsTr("Search key") },
        { label: qsTr("Card view"), text: mac ? qsTr("Card view key") : qsTr("Super, on its own") },
        { label: qsTr("Screen capture"), text: mac ? "⌘⌥P" : "Ctrl+Alt+P" }
    ])

    visible: opacity > 0
    opacity: shown ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: Theme.motion(200) } }

    source: Theme.asset("popup-bg.png")
    border { left: Theme.artBorder(20, source); right: Theme.artBorder(20, source); top: Theme.artBorder(20, source); bottom: Theme.artBorder(20, source) }
    width: Theme.px(360)
    height: list.height + 2 * Theme.px(28)

    Column {
        id: list
        x: Theme.px(28)
        y: Theme.px(28)
        width: sheet.width - 2 * Theme.px(28)
        spacing: Theme.px(6)
        Text {
            text: qsTr("Keyboard Shortcuts")
            color: "#FFFFFF"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(18)
            font.bold: true
            bottomPadding: Theme.px(4)
        }
        Repeater {
            model: sheet.entries
            delegate: Item {
                required property var modelData
                width: list.width
                height: Theme.px(22)
                Text {
                    text: modelData.label
                    color: "#FFFFFF"
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.px(15)
                    anchors.verticalCenter: parent.verticalCenter
                }
                Text {
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    text: modelData.text !== undefined ? modelData.text : KS.keyText(modelData, sheet.mac)
                    color: "#BFC4C8"
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.px(15)
                    font.bold: true
                }
            }
        }
    }
}
