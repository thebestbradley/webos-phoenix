// Copyright (c) 2026 webOS Phoenix contributors
// Copyright (c) 2009-2013 LG Electronics, Inc. (the original)
// SPDX-License-Identifier: Apache-2.0
//
// The emergency window: one app window shown over everything, the lock
// screen included, after luna-sysmgr's EmergencyWindowManager
// (Src/lunaui/emergency/EmergencyWindowManager.cpp), which showed the phone
// app's Type_Emergency window above the lock window. Only one at a time
// (addWindow: "Only one emergency window is allowed at a time"); it fades
// in and out over 350 ms, linear (kFadeAnimDuration), fills the screen
// under the status bar, with the phone's rounded corners, and swallows the
// touches under it. The lock screen's PIN pad opens Phone's restricted
// mode here (Shell.openEmergency; apps/phone/src/views/Emergency.tsx).
//
// The window comes from the window source: windowFor(windowKey).

import QtQuick

Item {
    id: host

    property var source: null
    // The source's key for the window; "" when there is none.
    property string windowKey: ""
    readonly property bool active: windowKey !== ""

    visible: opacity > 0
    opacity: active ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: Theme.emergencyFadeDuration; easing.type: Easing.Linear } }

    // Behind the page while it loads, and nothing under it takes a touch.
    Rectangle {
        anchors.fill: parent
        color: Theme.black
    }
    MouseArea { anchors.fill: parent }

    Item {
        id: content
        objectName: "emergencyContent"
        anchors.fill: parent
    }

    // EmergencyWindowManager::positionCornerWindows: the rounded corners.
    Item {
        anchors.fill: parent
        visible: !Theme.tablet
        Image { anchors.left: parent.left; anchors.top: parent.top; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-top-left.png") }
        Image { anchors.right: parent.right; anchors.top: parent.top; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-top-right.png") }
        Image { anchors.left: parent.left; anchors.bottom: parent.bottom; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-bottom-left.png") }
        Image { anchors.right: parent.right; anchors.bottom: parent.bottom; width: Theme.screenCornerSize; height: width; source: Theme.asset("wm-corner-bottom-right.png") }
    }

    onWindowKeyChanged: Qt.callLater(attach)
    function attach() {
        var w = windowKey !== "" && source ? source.windowFor(windowKey) : null;
        if (!w)
            return;
        w.parent = content;
        w.x = 0;
        w.y = 0;
        w.width = Qt.binding(function() { return content.width; });
        w.height = Qt.binding(function() { return content.height; });
        w.visible = true;
        // It takes the keys (EmergencyWindowManager::addWindow: focusEvent,
        // IMEController::setClient).
        if (typeof w.focusPage === "function")
            w.focusPage();
        else
            w.forceActiveFocus();
    }
}
