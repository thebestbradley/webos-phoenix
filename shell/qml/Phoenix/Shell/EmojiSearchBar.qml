// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Emoji search (Phoenix, GAPS V6): above the keys while the emoji page's
// search is on. The keys type the search (VirtualKeyboard._emojiSearchKey),
// the matching emoji scroll by below it, and a tap types one. Back (or the
// emoji or return key) goes back to the emoji page.

import QtQuick

Item {
    id: bar
    objectName: "emojiSearchBar"

    required property Item keyboard

    readonly property real rowHeight: Math.round(keyboard.width / (keyboard.tablet ? 16 : 9))
    readonly property var results: keyboard.emojiMatches(keyboard.emojiQuery, 60)
    height: rowHeight * 2

    Image {
        anchors.fill: parent
        source: bar.keyboard._art + "keyboard-bg.png"
        fillMode: Image.Stretch
    }

    // Back, and the search typed so far.
    Item {
        id: field
        width: parent.width
        height: bar.rowHeight
        Item {
            id: back
            objectName: "emojiSearchBack"
            width: bar.rowHeight
            height: bar.rowHeight
            Text {
                anchors.centerIn: parent
                text: "←"
                color: "#e2e2e2"
                font.family: Theme.fontFamily
                font.pixelSize: Math.round(bar.rowHeight * 0.5)
            }
            MouseArea {
                anchors.fill: parent
                onClicked: bar.keyboard.endEmojiSearch()
            }
        }
        Rectangle {
            anchors.left: back.right
            anchors.right: parent.right
            anchors.rightMargin: 6
            anchors.verticalCenter: parent.verticalCenter
            height: bar.rowHeight * 0.72
            radius: height / 2
            color: "#f2f2f2"
            Text {
                id: query
                objectName: "emojiSearchQuery"
                anchors.left: parent.left
                anchors.leftMargin: parent.height * 0.4
                anchors.verticalCenter: parent.verticalCenter
                text: bar.keyboard.emojiQuery
                color: "#202020"
                font.family: Theme.fontFamily
                font.pixelSize: Math.round(parent.height * 0.5)
            }
            Text {
                visible: bar.keyboard.emojiQuery === ""
                anchors.left: query.left
                anchors.verticalCenter: parent.verticalCenter
                text: qsTr("Search emoji")
                color: "#8a8a8a"
                font: query.font
            }
            // The caret after the text.
            Rectangle {
                x: query.x + query.contentWidth + 1
                anchors.verticalCenter: parent.verticalCenter
                width: 2
                height: parent.height * 0.55
                color: Theme.highlight
            }
        }
    }

    ListView {
        id: list
        objectName: "emojiResults"
        anchors.top: field.bottom
        width: parent.width
        height: bar.rowHeight
        orientation: ListView.Horizontal
        clip: true
        model: bar.results
        delegate: Item {
            id: result
            required property var modelData
            readonly property string shown: bar.keyboard.emojiFor(modelData)
            objectName: "emojiResult-" + modelData.e
            width: bar.rowHeight
            height: bar.rowHeight
            Rectangle {
                anchors.fill: parent
                anchors.margins: 2
                radius: 6
                color: Theme.highlight
                opacity: 0.5
                visible: area.pressed
            }
            Text {
                anchors.centerIn: parent
                text: result.shown
                font.family: Theme.emojiFontFamily
                font.pixelSize: Math.round(bar.rowHeight * 0.62)
            }
            MouseArea {
                id: area
                anchors.fill: parent
                onClicked: bar.keyboard.chooseEmoji(result.shown)
            }
        }
        Text {
            anchors.centerIn: parent
            visible: list.count === 0 && bar.keyboard.emojiQuery.trim() !== ""
            text: qsTr("No emoji found")
            color: "#a0a0a0"
            font.family: Theme.fontFamily
            font.pixelSize: Math.round(bar.rowHeight * 0.38)
        }
    }

    // Touches here are the bar's, not the app's below.
    MouseArea {
        anchors.fill: parent
        z: -1
    }
}
