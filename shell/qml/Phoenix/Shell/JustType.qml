// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// "Just Type": start typing in card view and a universal search opens with
// matching apps and quick actions (webOS 2.0 universal search).

import QtQuick

Item {
    id: jt

    property var apps
    property bool open: false
    property alias query: input.text

    signal launchRequested(string appId)
    signal actionRequested(string action, string text)
    signal closeRequested

    visible: opacity > 0
    opacity: open ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: 150 } }

    function start(firstText) {
        input.text = firstText || "";
        open = true;
        input.forceActiveFocus();
    }

    Rectangle {
        anchors.fill: parent
        color: "#e6000000"
    }
    MouseArea {
        anchors.fill: parent
        onClicked: jt.closeRequested()
    }

    BorderImage {
        id: pill
        x: Theme.px(8)
        y: Theme.statusBarHeight + Theme.px(8)
        width: parent.width - Theme.px(16)
        height: Theme.px(36)
        source: Theme.asset("search-pill.png")
        border { left: 36; right: 18; top: 0; bottom: 0 }

        TextInput {
            id: input
            anchors.left: parent.left
            anchors.leftMargin: Theme.px(36)
            anchors.right: parent.right
            anchors.rightMargin: Theme.px(12)
            anchors.verticalCenter: parent.verticalCenter
            color: Theme.text
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(17)
            Keys.onEscapePressed: jt.closeRequested()
            onAccepted: if (results.count > 0) jt.launchRequested(results.get(0).appId)
        }
    }

    ListModel { id: results }

    function refresh() {
        results.clear();
        var q = input.text.toLowerCase();
        if (!apps || q === "")
            return;
        for (var i = 0; i < apps.count; ++i) {
            var a = apps.get(i);
            if (a.title.toLowerCase().indexOf(q) >= 0)
                results.append({ appId: a.appId, title: a.title, color: a.color, glyph: a.glyph });
        }
    }
    Connections {
        target: input
        function onTextChanged() { jt.refresh(); }
    }

    Column {
        anchors.top: pill.bottom
        anchors.topMargin: Theme.px(8)
        x: Theme.px(8)
        width: parent.width - Theme.px(16)
        spacing: Theme.px(2)

        Repeater {
            model: results
            delegate: Rectangle {
                id: result
                required property var model
                width: parent.width
                height: Theme.px(44)
                color: resultMouse.pressed ? "#33ffffff" : "transparent"
                AppIcon {
                    id: rIcon
                    anchors.verticalCenter: parent.verticalCenter
                    size: Theme.px(36)
                    showLabel: false
                    color: result.model.color
                    glyph: result.model.glyph
                }
                Text {
                    anchors.left: rIcon.right
                    anchors.leftMargin: Theme.px(10)
                    anchors.verticalCenter: parent.verticalCenter
                    text: result.model.title
                    color: Theme.text
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.px(17)
                }
                MouseArea {
                    id: resultMouse
                    anchors.fill: parent
                    onClicked: jt.launchRequested(result.model.appId)
                }
            }
        }

        Text {
            visible: input.text !== ""
            topPadding: Theme.px(10)
            text: "Actions: New Email · New Message · New Memo · Search the Web"
            color: Theme.textDim
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(13)
        }
    }
}
