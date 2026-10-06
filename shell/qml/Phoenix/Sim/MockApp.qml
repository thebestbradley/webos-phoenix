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
    // The app menu (tap the app name in the status bar).
    property bool appMenuOpen: false
    // Loaded (web app windows report this; tests hold it back for a slow app).
    property bool ready: true

    // Ask the system for another card of this app (e.g. compose).
    signal newCardRequested

    color: "#e9e9e9"

    // Relaunched with these params (webOSRelaunch in a web app), last.
    property var relaunchParams: null
    function relaunch(params) {
        relaunchParams = params;
    }

    function appMenuRequested() {
        appMenuOpen = !appMenuOpen;
    }

    // Returns true if the gesture was consumed.
    function back() {
        if (appMenuOpen) {
            appMenuOpen = false;
            return true;
        }
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

        // "New" button: opens a second card that stacks with this one.
        Rectangle {
            anchors.right: parent.right
            anchors.rightMargin: parent.height * 0.2
            anchors.verticalCenter: parent.verticalCenter
            width: parent.height * 0.7
            height: width
            radius: width / 4
            color: newMouse.pressed ? Qt.darker(app.accent, 1.3) : Qt.lighter(app.accent, 1.15)
            border.color: Qt.darker(app.accent, 1.4)
            Text {
                anchors.centerIn: parent
                text: "+"
                color: "white"
                font.pixelSize: parent.height * 0.7
                font.bold: true
            }
            MouseArea {
                id: newMouse
                anchors.fill: parent
                onClicked: app.newCardRequested()
            }
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

    // A one-item app menu, dropping from the top left like enyo.AppMenu.
    MouseArea {
        anchors.fill: parent
        visible: app.appMenuOpen
        onClicked: app.appMenuOpen = false
    }
    Rectangle {
        visible: app.appMenuOpen
        x: 4
        y: 0
        width: Math.min(parent.width - 8, 200)
        height: 48
        radius: 6
        color: "#2b2b2b"
        border.color: "#111111"
        Text {
            anchors.verticalCenter: parent.verticalCenter
            x: 14
            text: "New " + app.title
            color: "white"
            font.pixelSize: 18
        }
        MouseArea {
            anchors.fill: parent
            onClicked: {
                app.appMenuOpen = false;
                app.newCardRequested();
            }
        }
    }
}
