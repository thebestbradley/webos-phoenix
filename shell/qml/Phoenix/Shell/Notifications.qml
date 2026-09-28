// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Non-modal notifications, the two ways luna-sysmgr showed them
// (SystemUiController.cpp:82, 1361-1470; DashboardWindowManager.cpp).
//
// Phones: notifications never cover the app. They own the "negative space"
// at the bottom of the screen and the app's "positive space" ends where it
// begins, so the app shrinks and moves up to make room:
//   1. a notification arrives: the positive space loses the 28 px bar
//      (positiveSpaceBottomPadding) and the banner slides into it from the
//      right;
//   2. the banner then collapses into the notification's icon in the bar;
//   3. tapping the bar opens the dashboard, which grows the negative space
//      upward (at most 55% of the screen) and pushes the app up with it.
//      Each item can be tapped, or swiped sideways to dismiss it.
// Every change to the space animates over 400 ms, OutCubic
// (conf/lunaAnimations.conf:73-74), and the shell lays the cards out in
// what is left (negativeSpace).
//
// Tablets (TouchPad): the banner and the notification icons live in the
// status bar, and the dashboard is a 320 px drop-down under it, over the
// apps (DashboardWindowManager.cpp:62-63, 1234-1260).
//
// Tapping a notification launches its app with the notification's params
// (e.g. the task a reminder is for).

import QtQuick

Item {
    id: root

    property var model            // ListModel: appId, title, body, color, glyph, icon, params (JSON or "")
    property bool dashboardOpen: false
    // Tablet: where the status bar's system indicators begin (from the right).
    property real statusBarRightInset: 0
    // Height of the whole screen, for the dashboard's maximum size.
    property real screenHeight: height

    signal dismissRequested(int index)
    signal activated(string appId, string params)

    readonly property bool overlay: Theme.tablet
    readonly property bool hasNotifications: model && model.count > 0
    property bool bannerActive: false
    // The dashboard has content while a banner shows or notifications wait
    // (DashboardWindowManager::setBannerHasContent, :454-465).
    readonly property bool hasContent: hasNotifications || bannerActive

    // Phones: the space taken from the bottom of the screen, animated. The
    // shell ends the cards and the quick launch bar above it.
    readonly property real dashboardHeight: Math.min(
        Theme.px(10) + (model ? model.count : 0) * Theme.dashboardItemHeight + Theme.px(10),
        screenHeight * Theme.maximumNegativeSpaceRatio)
    readonly property real negativeSpaceTarget: overlay ? 0
        : dashboardOpen ? dashboardHeight
        : hasContent ? Theme.bannerHeight : 0
    property real negativeSpace: negativeSpaceTarget
    Behavior on negativeSpace { NumberAnimation { duration: Theme.positiveSpaceDuration; easing.type: Easing.OutCubic } }

    // ---- Banner --------------------------------------------------------------

    property string bannerText: ""
    property color bannerColor: "#666666"
    property string bannerGlyph: ""
    property url bannerIcon: ""

    Connections {
        target: root.model
        function onRowsInserted(parent, first, last) {
            var n = root.model.get(last);
            root.bannerText = n.title + (n.body ? ": " + n.body : "");
            root.bannerColor = n.color;
            root.bannerGlyph = n.glyph;
            root.bannerIcon = n.icon || "";
            root.bannerActive = true;
            bannerAnim.restart();
        }
        function onCountChanged() {
            if (root.model.count === 0)
                root.dashboardOpen = false;
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
        ScriptAction { script: root.bannerActive = false }
    }

    // ---- Tap outside the open dashboard to close it -----------------------------

    MouseArea {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: root.overlay ? parent.bottom : space.top
        visible: root.dashboardOpen
        onClicked: root.dashboardOpen = false
    }

    // ---- The notification area ----------------------------------------------------
    // Phones: the negative space at the bottom, level with the app.
    // Tablets: a strip in the status bar, left of the system indicators.

    Rectangle {
        id: space
        color: root.overlay ? Theme.statusBarFill : Theme.black
        clip: true
        // Tablets: right of the centred clock.
        x: root.overlay ? root.width / 2 + Theme.px(40) : 0
        width: root.overlay ? root.width / 2 - Theme.px(40) - root.statusBarRightInset : root.width
        y: root.overlay ? -Theme.statusBarHeight : root.height - height
        height: root.overlay ? Theme.statusBarHeight : root.negativeSpace
        visible: root.overlay ? root.bannerActive : height > 0

        // The banner, in the bar's top 28 px while the space opens under it.
        Item {
            id: banner
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            height: Math.min(Theme.bannerHeight, parent.height)
            clip: true
            visible: root.bannerActive && !root.dashboardOpen

            Image {
                anchors.fill: parent
                source: Theme.asset("overlay-banner-bg.png")
                fillMode: Image.Stretch
                visible: !root.overlay
            }

            Row {
                id: bannerContent
                x: banner.width
                anchors.verticalCenter: parent.verticalCenter
                spacing: Theme.px(6)
                AppIcon {
                    size: Theme.px(22)
                    showLabel: false
                    color: root.bannerColor
                    glyph: root.bannerGlyph
                    source: root.bannerIcon
                }
                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: root.bannerText
                    color: Theme.text
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.bannerFontSize
                }
            }
        }

        // Phones: the waiting notifications' icons, once the banner is gone.
        Row {
            id: phoneIcons
            anchors.right: parent.right
            anchors.rightMargin: Theme.px(8)
            y: (Theme.bannerHeight - height) / 2
            spacing: Theme.px(4)
            visible: !root.overlay && !root.bannerActive && !root.dashboardOpen
            Repeater {
                model: root.overlay ? null : root.model
                delegate: AppIcon {
                    required property var model
                    size: Theme.px(22)
                    showLabel: false
                    color: model.color
                    glyph: model.glyph
                    source: model.icon || ""
                }
            }
        }

        MouseArea {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            height: Theme.bannerHeight
            visible: !root.overlay && root.hasNotifications && !root.dashboardOpen
            onClicked: root.dashboardOpen = true
        }

        // Phones: the dashboard fills the space as it grows (10 px top padding,
        // DashboardWindowContainer.cpp:96-108).
        Item {
            anchors.fill: parent
            visible: !root.overlay && root.dashboardOpen
            Loader {
                anchors.fill: parent
                anchors.topMargin: Theme.px(10)
                active: parent.visible
                sourceComponent: dashboardList
            }
            Image {
                anchors.top: parent.top
                width: parent.width
                source: Theme.asset("dashboard-mask-top.png")
                fillMode: Image.Stretch
            }
        }
    }

    // Tablets: the notification icons in the status bar; they open the drop-down.
    Row {
        id: tabletIcons
        visible: root.overlay && root.hasNotifications && !root.bannerActive
        anchors.right: parent.right
        anchors.rightMargin: root.statusBarRightInset + Theme.px(5)
        y: -Theme.statusBarHeight + (Theme.statusBarHeight - height) / 2
        spacing: Theme.px(5)                                        // StatusBar.h:31-32
        Repeater {
            model: root.overlay ? root.model : null
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
        visible: tabletIcons.visible
        x: tabletIcons.x - Theme.px(5)
        y: -Theme.statusBarHeight
        width: tabletIcons.width + Theme.px(10)
        height: Theme.statusBarHeight
        onClicked: root.dashboardOpen = !root.dashboardOpen
    }

    // Tablets: the 320 px drop-down under the status bar, top right.
    BorderImage {
        id: dropDown
        visible: root.overlay && opacity > 0
        opacity: root.overlay && root.dashboardOpen ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.searchPillFadeDuration } }
        anchors.right: parent.right
        anchors.rightMargin: root.statusBarRightInset
        y: -Theme.px(2)
        width: Theme.px(320)
        height: Math.min(Theme.px(20) + (root.model ? root.model.count : 0) * Theme.dashboardItemHeight,
                         root.screenHeight * Theme.maximumNegativeSpaceRatio)
        source: Theme.asset("menu-dropdown-bg.png")
        border { left: 30; right: 30; top: 30; bottom: 30 }
        Loader {
            anchors.fill: parent
            anchors.margins: Theme.px(10)
            active: root.overlay && root.dashboardOpen
            sourceComponent: dashboardList
        }
    }

    // ---- Dashboard items ------------------------------------------------------------

    Component {
        id: dashboardList

        ListView {
            id: list
            clip: true
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
                required property string icon
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
                        source: item.icon
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

                    // Swipe more than a quarter of the width to dismiss
                    // (DashboardWindowContainer.cpp:350-363).
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
