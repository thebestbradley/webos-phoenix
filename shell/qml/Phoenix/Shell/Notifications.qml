// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Non-modal notifications, the webOS way:
//   1. a new notification scrolls in as a one-line banner at the bottom,
//   2. then collapses into a small icon in the notification bar,
//   3. tapping the bar opens the dashboard, where each item can be tapped
//      or swiped sideways to dismiss it. Tapping launches the app with
//      the notification's params (e.g. the task a reminder is for).

import QtQuick

Item {
    id: root

    property var model            // ListModel: appId, title, body, color, glyph, params (JSON or "")
    property bool dashboardOpen: false
    signal dismissRequested(int index)
    signal activated(string appId, string params)

    readonly property bool hasNotifications: model && model.count > 0
    // Height the bar currently occupies at the bottom of the screen.
    readonly property real barHeight: hasNotifications && !dashboardOpen ? Theme.bannerHeight : 0

    // ---- Banner --------------------------------------------------------------

    property string bannerText: ""
    property color bannerColor: "#666666"
    property string bannerGlyph: ""

    Connections {
        target: root.model
        function onRowsInserted(parent, first, last) {
            var n = root.model.get(last);
            root.bannerText = n.title + (n.body ? ": " + n.body : "");
            root.bannerColor = n.color;
            root.bannerGlyph = n.glyph;
            bannerAnim.restart();
        }
        function onCountChanged() {
            if (root.model.count === 0)
                root.dashboardOpen = false;
        }
    }

    Item {
        id: banner
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: Theme.bannerHeight
        clip: true
        visible: bannerContent.x < width

        Image {
            anchors.fill: parent
            source: Theme.asset("overlay-banner-bg.png")
            fillMode: Image.Stretch
        }

        Row {
            id: bannerContent
            x: parent.width
            anchors.verticalCenter: parent.verticalCenter
            spacing: Theme.px(6)
            AppIcon {
                size: Theme.px(22)
                showLabel: false
                color: root.bannerColor
                glyph: root.bannerGlyph
            }
            Text {
                anchors.verticalCenter: parent.verticalCenter
                text: root.bannerText
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: Theme.bannerFontSize
            }
        }

        // Slide in from the right, stay, then fade to 0.25 while sliding back
        // (BannerMessageHandler.cpp:122-130, 611-676).
        SequentialAnimation {
            id: bannerAnim
            PropertyAction { target: bannerContent; property: "opacity"; value: 1 }
            NumberAnimation { target: bannerContent; property: "x"; from: banner.width; to: Theme.px(5); duration: Theme.bannerSlideDuration; easing.type: Easing.OutCubic }
            PauseAnimation { duration: root.model && root.model.count > 1 ? Theme.bannerShowTimeQueued : Theme.bannerShowTime }
            ParallelAnimation {
                NumberAnimation { target: bannerContent; property: "x"; to: banner.width; duration: Theme.bannerSlideDuration }
                NumberAnimation { target: bannerContent; property: "opacity"; to: 0.25; duration: Theme.bannerSlideDuration }
            }
        }
    }

    // ---- Notification bar ----------------------------------------------------------

    Rectangle {
        id: bar
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: Theme.bannerHeight
        color: Theme.black
        visible: root.hasNotifications && !root.dashboardOpen && !bannerAnim.running

        Row {
            anchors.right: parent.right
            anchors.rightMargin: Theme.px(8)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Theme.px(4)
            Repeater {
                model: root.model
                delegate: AppIcon {
                    required property var model
                    size: Theme.px(22)
                    showLabel: false
                    color: model.color
                    glyph: model.glyph
                }
            }
        }

        MouseArea {
            anchors.fill: parent
            onClicked: root.dashboardOpen = true
        }
    }

    // ---- Dashboard -----------------------------------------------------------------

    MouseArea {
        anchors.fill: parent
        visible: root.dashboardOpen
        onClicked: root.dashboardOpen = false
    }

    Rectangle {
        id: dashboard
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: root.dashboardOpen ? Math.min(list.contentHeight, parent.height * 0.6) : 0
        Behavior on height { NumberAnimation { duration: 250; easing.type: Easing.OutCubic } }
        color: "#101010"
        clip: true

        Image {
            anchors.top: parent.top
            width: parent.width
            source: Theme.asset("dashboard-mask-top.png")
            fillMode: Image.Stretch
            z: 1
        }

        ListView {
            id: list
            anchors.fill: parent
            model: root.model
            interactive: contentHeight > height

            delegate: Item {
                id: item
                required property int index
                required property string appId
                required property string title
                required property string body
                required property color color
                required property string glyph
                required property string params
                width: list.width
                height: Theme.dashboardItemHeight

                Item {
                    id: content
                    width: parent.width
                    height: parent.height
                    opacity: 1 - Math.abs(x) / width

                    AppIcon {
                        id: dIcon
                        x: Theme.px(10)
                        anchors.verticalCenter: parent.verticalCenter
                        size: Theme.px(32)
                        showLabel: false
                        color: item.color
                        glyph: item.glyph
                    }
                    Column {
                        anchors.left: dIcon.right
                        anchors.leftMargin: Theme.px(10)
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        Text {
                            width: parent.width
                            elide: Text.ElideRight
                            text: item.title
                            color: Theme.text
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.px(16)
                            font.bold: true
                        }
                        Text {
                            width: parent.width
                            elide: Text.ElideRight
                            text: item.body
                            color: Theme.textDim
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.px(14)
                        }
                    }

                    MouseArea {
                        anchors.fill: parent
                        drag.target: content
                        drag.axis: Drag.XAxis
                        onReleased: {
                            if (Math.abs(content.x) > content.width * Theme.dashboardDismissRatio)
                                root.dismissRequested(item.index);
                            else
                                content.x = 0;
                        }
                        onClicked: {
                            root.activated(item.appId, item.params);
                            root.dismissRequested(item.index);
                        }
                    }
                }

                Image {
                    anchors.bottom: parent.bottom
                    width: parent.width
                    source: Theme.asset("menu-divider.png")
                    fillMode: Image.Stretch
                }
            }
        }
    }
}
