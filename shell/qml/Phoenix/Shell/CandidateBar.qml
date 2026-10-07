// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text Assist's candidate bar (Phoenix, GAPS V2, V3): above the keys in text
// fields, on the keyboard's own background, in its key-cap colours. The
// candidates (VirtualKeyboard.candidates): the word as typed, in quotes when
// a correction is offered; the correction the space bar puts in, in white
// and bold; other words. A tap types one. At the right, the microphone
// (dictation), when the device has one: tap to talk, tap again to stop;
// what was said is typed where the cursor is.
// Phoenix (M6 F2): at the left, the clipboard key (a clipboard, drawn), in
// every field while the clipboard history is on: it opens the clip strip in
// place of the keys (ClipStrip), and tapped again brings the keys back.
// In a field without Text Assist (a password, an address) the bar holds
// only that key.

import QtQuick

Item {
    id: bar
    objectName: "candidateBar"

    required property Item keyboard

    readonly property var dictation: keyboard.dictation
    readonly property bool listening: dictation !== null && dictation.listening === true && !dictation.owner
    readonly property bool transcribing: dictation !== null && dictation.busy === true && !dictation.owner
    readonly property bool assist: keyboard.assistBarShown
    readonly property real micWidth: dictation !== null && assist ? height * 1.2 : 0
    readonly property real clipWidth: keyboard.clipboardKeyShown ? height * 1.2 : 0
    readonly property color textColor: "#e2e2e2"
    readonly property color strongColor: "#ffffff"
    readonly property real fontSize: Math.round(height * 0.38)

    Image {
        anchors.fill: parent
        source: bar.keyboard._artFile("keyboard-bg.png")
        fillMode: Image.Stretch
    }
    // The line between the bar and the keys.
    Rectangle {
        anchors.bottom: parent.bottom
        width: parent.width
        height: Math.max(1, Math.round(bar.height / 40))
        color: Qt.rgba(0, 0, 0, 0.45)
    }

    // The clipboard key.
    Item {
        id: clipKey
        objectName: "clipboardKey"
        visible: bar.keyboard.clipboardKeyShown
        width: bar.clipWidth
        height: bar.height
        Rectangle {
            anchors.centerIn: parent
            width: Math.min(parent.width, parent.height) * 0.8
            height: width
            radius: width / 2
            color: clipTap.pressed || bar.keyboard.clipsOpen ? Qt.rgba(1, 1, 1, 0.18) : "transparent"
        }
        // A clipboard: the board, its clip at the top, lines of text.
        Item {
            anchors.centerIn: parent
            width: bar.height * 0.46
            height: width * 1.2
            Rectangle {
                y: parent.height * 0.08
                width: parent.width
                height: parent.height * 0.92
                radius: width * 0.12
                color: "transparent"
                border.color: bar.strongColor
                border.width: Math.max(1.5, parent.width * 0.09)
            }
            Rectangle {
                x: parent.width * 0.28
                width: parent.width * 0.44
                height: parent.height * 0.2
                radius: height * 0.3
                color: bar.strongColor
            }
            Repeater {
                model: 3
                Rectangle {
                    required property int index
                    x: parent.width * 0.24
                    y: parent.height * (0.4 + index * 0.17)
                    width: parent.width * (index === 2 ? 0.32 : 0.52)
                    height: Math.max(1, parent.width * 0.08)
                    color: bar.strongColor
                }
            }
        }
        MouseArea {
            id: clipTap
            anchors.fill: parent
            onClicked: bar.keyboard.toggleClips()
        }
    }
    Rectangle {
        visible: clipKey.visible && bar.assist
        x: bar.clipWidth
        width: 1
        height: parent.height * 0.5
        anchors.verticalCenter: parent.verticalCenter
        color: Qt.rgba(1, 1, 1, 0.25)
    }

    Row {
        id: cells
        visible: bar.assist && !bar.listening && !bar.transcribing && bar.keyboard.dictationMessage === ""
        x: bar.clipWidth
        width: bar.width - bar.micWidth - bar.clipWidth
        height: bar.height
        Repeater {
            model: bar.keyboard.candidates
            delegate: Item {
                id: cell
                objectName: "candidate"
                required property int index
                required property var modelData
                readonly property bool quoted: modelData.kind === "typed"
                    && bar.keyboard.candidates.some(function (c) { return c.kind === "correction"; })
                width: cells.width / Math.max(1, bar.keyboard.candidates.length)
                height: cells.height
                Rectangle {
                    anchors.fill: parent
                    anchors.margins: 2
                    radius: 4
                    color: Qt.rgba(1, 1, 1, 0.18)
                    visible: tap.pressed
                }
                Text {
                    anchors.fill: parent
                    anchors.leftMargin: 6
                    anchors.rightMargin: 6
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                    elide: Text.ElideRight
                    text: cell.quoted ? "“" + cell.modelData.text + "”" : cell.modelData.text
                    color: cell.modelData.kind === "correction" ? bar.strongColor : bar.textColor
                    font.family: Theme.fontFamily
                    font.pixelSize: bar.fontSize
                    font.bold: cell.modelData.kind === "correction"
                }
                // Dividers between the candidates.
                Rectangle {
                    visible: cell.index > 0
                    width: 1
                    height: parent.height * 0.5
                    anchors.verticalCenter: parent.verticalCenter
                    color: Qt.rgba(1, 1, 1, 0.25)
                }
                MouseArea {
                    id: tap
                    anchors.fill: parent
                    onClicked: bar.keyboard.candidateTapped(cell.index)
                }
            }
        }
    }

    // Listening, or writing down what was said.
    Text {
        objectName: "dictationStatus"
        visible: bar.listening || bar.transcribing || bar.keyboard.dictationMessage !== ""
        anchors.left: parent.left
        anchors.leftMargin: 12 + bar.clipWidth
        anchors.right: mic.left
        anchors.verticalCenter: parent.verticalCenter
        elide: Text.ElideRight
        text: bar.listening ? "Listening\u2026 tap the microphone when you are done"
            : bar.transcribing ? "Writing it down\u2026" : bar.keyboard.dictationMessage
        color: bar.textColor
        font.family: Theme.fontFamily
        font.pixelSize: bar.fontSize
    }

    // The microphone (dictation).
    Item {
        id: mic
        objectName: "dictationKey"
        visible: bar.dictation !== null && bar.assist
        anchors.right: parent.right
        width: bar.micWidth
        height: bar.height
        Rectangle {
            anchors.centerIn: parent
            width: Math.min(parent.width, parent.height) * 0.8
            height: width
            radius: width / 2
            color: bar.listening ? "#c0392b" : micTap.pressed ? Qt.rgba(1, 1, 1, 0.18) : "transparent"
        }
        // A microphone, drawn.
        Item {
            anchors.centerIn: parent
            width: bar.height * 0.5
            height: width
            opacity: bar.transcribing ? 0.4 : 1
            Rectangle {
                x: parent.width * 0.32
                width: parent.width * 0.36
                height: parent.height * 0.62
                radius: width / 2
                color: bar.strongColor
            }
            Rectangle {
                x: parent.width * 0.16
                y: parent.height * 0.3
                width: parent.width * 0.68
                height: parent.height * 0.46
                radius: width / 2
                color: "transparent"
                border.color: bar.strongColor
                border.width: Math.max(1.5, parent.width * 0.07)
            }
            Rectangle {
                x: parent.width * 0.47
                y: parent.height * 0.76
                width: parent.width * 0.07
                height: parent.height * 0.18
                color: bar.strongColor
            }
        }
        MouseArea {
            id: micTap
            anchors.fill: parent
            enabled: !bar.transcribing
            onClicked: bar.keyboard.toggleDictation()
        }
    }
}
