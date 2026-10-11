// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Sign In card's bar (org.webosphoenix.signin; services/oauth/
// signincard.js): the provider's host with a lock when the page is https,
// and Cancel. The shell draws it over the top of the card, outside the web
// page, so the provider's page (or anything it navigates to) cannot draw a
// convincing one of its own: the simulator's sign-in sheet put the address
// above its web view for the same reason (apps/sharesheet "signin"), as a
// browser's address bar does.
//
// phoenix-sim's WebAppWindow shows it with the page's own address as it
// loads; on a device (Lsm SurfaceHost) WebAppMgr tells the shell no
// address, so the bar shows the host the OAuth service opened, which it
// posts through org.webosphoenix.shellhost (a message only that service's
// name can send; docs/DEVICE-AUDIT.md section 4).

import QtQuick

Rectangle {
    id: bar
    property string hostName: ""
    property bool secure: false
    property bool loading: false
    signal cancel()

    height: Theme.px(40)
    gradient: Gradient {
        GradientStop { position: 0; color: "#4a4e53" }
        GradientStop { position: 1; color: "#2b2e31" }
    }
    Rectangle { anchors { left: parent.left; right: parent.right; bottom: parent.bottom } height: 1; color: "#141516" }

    // The lock: green and closed for https, grey and open for anything else.
    Item {
        id: lock
        objectName: "signInLock"
        readonly property bool secure: bar.secure
        width: Theme.px(14); height: Theme.px(18)
        anchors { left: parent.left; leftMargin: Theme.px(10); verticalCenter: parent.verticalCenter }
        Rectangle {
            width: Theme.px(10); height: Theme.px(12); radius: Theme.px(5)
            x: bar.secure ? Theme.px(2) : Theme.px(6)
            color: "transparent"
            border.width: Theme.px(2)
            border.color: bar.secure ? "#7fd36b" : "#a7abb0"
        }
        Rectangle {
            width: parent.width; height: Theme.px(10); radius: Theme.px(2)
            anchors.bottom: parent.bottom
            color: bar.secure ? "#7fd36b" : "#a7abb0"
        }
    }

    Text {
        id: address
        objectName: "signInHost"
        anchors { left: lock.right; leftMargin: Theme.px(8); right: cancelButton.left; rightMargin: Theme.px(8); verticalCenter: parent.verticalCenter }
        text: bar.hostName
        elide: Text.ElideLeft
        color: "#ffffff"
        font.bold: true
        font.pixelSize: Theme.px(15)
        font.family: Theme.fontFamily
    }

    Rectangle {
        id: cancelButton
        objectName: "signInCancel"
        anchors { right: parent.right; rightMargin: Theme.px(6); verticalCenter: parent.verticalCenter }
        width: cancelText.implicitWidth + Theme.px(20); height: Theme.px(28)
        radius: Theme.px(6)
        border.color: "#15171a"
        gradient: Gradient {
            GradientStop { position: 0; color: cancelArea.pressed ? "#2b2e31" : "#666b71" }
            GradientStop { position: 1; color: cancelArea.pressed ? "#3d4146" : "#3d4146" }
        }
        Text {
            id: cancelText
            anchors.centerIn: parent
            text: qsTr("Cancel")
            color: "#ffffff"
            font.pixelSize: Theme.px(14)
            font.family: Theme.fontFamily
        }
        MouseArea {
            id: cancelArea
            anchors.fill: parent
            onClicked: bar.cancel()
        }
    }

    // Loading: a thin line along the bottom, as the browser's progress.
    Rectangle {
        visible: bar.loading
        anchors { left: parent.left; bottom: parent.bottom }
        height: Theme.px(2)
        color: "#3b8fd9"
        width: parent.width * 0.35
        SequentialAnimation on x {
            running: bar.loading
            loops: Animation.Infinite
            NumberAnimation { from: -bar.width * 0.35; to: bar.width; duration: 1200 }
        }
    }
}
