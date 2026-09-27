// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Placeholder app used by the simulator: a header in the app's colour and a
// list that drills down one level, so the back gesture has something to do.

import QtQuick

Rectangle {
    id: app

    property string appId
    property string title
    property color accent: "#2f7fd1"
    property string glyph

    // Detail page title, or "" on the root page.
    property string detail: ""

    color: "#e9e9e9"

    // Returns true if the gesture was consumed.
    function back() {
        if (detail !== "") {
            detail = "";
            return true;
        }
        return false;
    }

    Rectangle {
        id: header
        width: parent.width
        height: Math.round(parent.width * 0.16)
        gradient: Gradient {
            GradientStop { position: 0; color: Qt.lighter(app.accent, 1.25) }
            GradientStop { position: 1; color: app.accent }
        }

        Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.left: parent.left
            anchors.leftMargin: parent.height * 0.3
            text: app.detail !== "" ? app.detail : app.title
            color: "white"
            font.pixelSize: parent.height * 0.42
            font.bold: true
            style: Text.Raised
            styleColor: Qt.darker(app.accent, 1.6)
        }
    }

    ListView {
        id: list
        visible: app.detail === ""
        anchors.top: header.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        clip: true
        model: 12
        delegate: Rectangle {
            required property int index
            width: list.width
            height: Math.round(app.width * 0.15)
            color: mouse.pressed ? "#cfe0f3" : (index % 2 ? "#f4f4f4" : "#ffffff")

            Rectangle {
                id: bullet
                anchors.verticalCenter: parent.verticalCenter
                x: parent.height * 0.3
                width: parent.height * 0.55; height: width; radius: width / 5
                color: app.accent
                Text {
                    anchors.centerIn: parent
                    text: app.glyph
                    color: "white"
                    font.pixelSize: parent.height * 0.55
                }
            }
            Text {
                anchors.verticalCenter: parent.verticalCenter
                anchors.left: bullet.right
                anchors.leftMargin: parent.height * 0.3
                text: app.title + " item " + (index + 1)
                color: "#333333"
                font.pixelSize: parent.height * 0.33
            }
            Rectangle { width: parent.width; height: 1; anchors.bottom: parent.bottom; color: "#d8d8d8" }
            MouseArea {
                id: mouse
                anchors.fill: parent
                onClicked: app.detail = app.title + " item " + (index + 1)
            }
        }
    }

    Text {
        visible: app.detail !== ""
        anchors.centerIn: parent
        width: parent.width * 0.8
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.WordWrap
        text: "Swipe left in the gesture area to go back."
        color: "#666666"
        font.pixelSize: app.width * 0.05
    }
}
