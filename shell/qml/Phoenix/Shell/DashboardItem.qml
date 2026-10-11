// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One 52 px row of the dashboard (DashboardWindowContainer.cpp:48): the
// app's own dashboard window when it opened one, otherwise its icon, title
// and message. The notification area and the lock screen both show these;
// a dashboard window is one live page, so whichever shows it calls claim().
//
// Phoenix: a notification may carry answers as buttons ({actions}: the
// "notification" host message's, JSON {items: [{id, label}], ...}), shown
// on the row's second line in place of its message, e.g. the Assistant's
// follow-up questions ("Where is Dentist?" Office · Video call · Skip).
// A tap on one says actionTapped(id); the row's own tap still opens the app.
//
// A stack of the app's notifications (NotificationStacks.js: layerCount > 1)
// is drawn as Enyo 1.0's standard dashboard drew its layers (palm/system/
// dashboard-window/DashboardContent.js:8-23, 99-123; dashboard.css): the top
// layer's title and message, with the count in the blue badge over the
// icon's top right corner (.dashboard-count); the layer under it peeks out
// at its left, edge on (notification-divider.png), a third further left
// once there are three or more (.layer-1, .layer-2). While the top layer is
// swiped (layerX, set by the row) the one under it shows through where it
// was (configureClipping, :201-205).

import QtQuick

Item {
    id: item

    // The window source, for windowFor(windowKey).
    property var source
    property string windowKey: ""
    property string title: ""
    property string body: ""
    property color color: "#666666"
    property string glyph: ""
    property string icon: ""
    // An ongoing activity's progress, 0-100 (a download, an install); -1: none.
    property real progress: -1
    // The answers offered ("" or the JSON above); none on the lock screen.
    property string actions: ""
    readonly property var _actionItems: {
        if (!actions)
            return [];
        try {
            var a = JSON.parse(actions);
            return a && Array.isArray(a.items) ? a.items : [];
        } catch (e) {
            return [];
        }
    }
    signal actionTapped(string actionId)

    // A stack: how many layers, and their JSON ([{title, body, ...}],
    // oldest first; title and body above are the top one's). Without the
    // JSON (the lock screen's private previews) the layers peek out empty.
    property int layerCount: 1
    property string layers: ""
    // The top layer's offset while it is swiped away (the row moves it).
    property real layerX: 0
    readonly property bool stacked: _own && layerCount > 1
    readonly property var _layerList: {
        if (!layers)
            return [];
        try {
            var a = JSON.parse(layers);
            return Array.isArray(a) ? a : [];
        } catch (e) {
            return [];
        }
    }
    // The layer under the top one, if known.
    readonly property var underLayer: stacked && _layerList.length >= 2 ? _layerList[_layerList.length - 2] : null
    // Where the top layer's left edge rests: the second layer's place with
    // two, 12 px right of it with more (.layer-1 / .layer-2).
    readonly property real topEdge: layerCount >= 3 ? Theme.dashboardLayerEdge + Theme.dashboardLayerStep : Theme.dashboardLayerEdge
    // Popped with three or more left: the new top layer comes from the
    // second's place to its own (layerSwiped, DashboardContent.js:55-63).
    property real _shift: 0
    function shiftIn() {
        if (layerCount < 3)
            return;
        shiftAnim.stop();
        _shift = -Theme.dashboardLayerStep;
        shiftAnim.start();
    }
    NumberAnimation {
        id: shiftAnim
        target: item
        property: "_shift"
        to: 0
        duration: Theme.dashboardLayerShiftDuration
        // CSS "ease": cubic-bezier(0.25, 0.1, 0.25, 1).
        easing.type: Easing.Bezier
        easing.bezierCurve: [0.25, 0.1, 0.25, 1, 1, 1]
    }
    readonly property real _topX: topEdge + layerX + _shift
    // The single row's text, where a stack's bottom layer has its own.
    readonly property real _plainTextX: Theme.px(10) + Theme.px(32) + Theme.px(10)

    height: Theme.dashboardItemHeight

    // Show the app's dashboard window here.
    function claim() {
        var w = windowKey && source ? source.windowFor(windowKey) : null;
        if (!w)
            return;
        w.parent = host;
        w.x = 0;
        w.y = 0;
        w.width = Qt.binding(function() { return host.width; });
        w.height = Qt.binding(function() { return host.height; });
        w.visible = true;
    }
    Component.onCompleted: claim()

    // Pass a touch on to the app's dashboard window, at x, y in the row (the
    // window fills it), as DashboardWindowContainer passed pen events to it
    // (DashboardWindow::inputEvent: handleTap, :1104-1146; a window that
    // takes its own drags, :193-217, 284-306, 386-412). type: "down",
    // "move", "up", "tapup" (an up that ends a tap), "cancel", or "tap" (a
    // down and an up). A window that cannot take them is left alone.
    function pointer(type, x, y) {
        var w = windowKey && source ? source.windowFor(windowKey) : null;
        if (w && typeof w.pointer === "function")
            w.pointer(type, x, y);
    }

    Item {
        id: host
        anchors.fill: parent
        visible: item.windowKey !== ""
        z: 1
    }

    // The row's own icon and text, when the app has no dashboard window
    // (the window draws its own; behind it they would show through).
    readonly property bool _own: item.windowKey === ""

    AppIcon {
        id: dIcon
        visible: item._own
        x: Theme.px(10)
        anchors.verticalCenter: parent.verticalCenter
        size: Theme.px(32)
        showLabel: false
        color: item.color
        glyph: item.glyph
        source: item.icon
    }

    // The count, over the icon's top right corner (.dashboard-count: shown
    // from two layers, DashboardContent.js:117-122): the top half of
    // dashboard-newitem-badge.png (the bottom half is its pressed look)
    // with 12 px caps, the number bold 16 px white on its top 24 px.
    Item {
        id: badge
        objectName: "dashboardCount"
        visible: item._own && item.layerCount > 1
        z: 2
        width: Math.max(Theme.px(24), countLabel.implicitWidth + Theme.px(16))
        height: Theme.px(28)
        x: dIcon.x + dIcon.width + Theme.px(3) - width
        y: dIcon.y - Theme.px(3)
        scale: Theme.dashboardBadgeScale
        transformOrigin: Item.TopRight
        clip: true
        ArtBorderImage {
            width: parent.width
            height: 2 * parent.height
            source: Theme.asset("dashboard-newitem-badge.png")
            border { left: Theme.artBorder(12, source); right: Theme.artBorder(12, source); top: 0; bottom: Theme.artBorder(28, source) }
        }
        Text {
            id: countLabel
            objectName: "dashboardCountLabel"
            anchors.horizontalCenter: parent.horizontalCenter
            y: (Theme.px(24) - height) / 2
            text: String(item.layerCount)
            color: "#ffffff"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(16)
            font.bold: true
        }
    }

    // The layer under the top one, where it rests: shown only as far as
    // the top layer has moved off it, and its edge (15 px) when there are
    // three or more (DashboardLayer clipControl / leftOffset, :76-77,
    // 201-205). With two, it is the bottom layer: no edge, its text where a
    // single row has it (.layer-0).
    Item {
        id: under
        objectName: "dashboardUnderLayer"
        visible: item.stacked && width > 0
        x: Theme.dashboardLayerEdge
        width: Math.max(0, Math.min(item.width - x,
            item.layerCount >= 3 ? Theme.dashboardLayerPeek + item.layerX + item._shift : item.layerX))
        height: parent.height
        clip: true
        Image {
            visible: item.layerCount >= 3
            y: (parent.height - height) / 2
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
            source: Theme.asset("notification-divider.png")
        }
        Column {
            x: item.layerCount >= 3 ? Theme.dashboardLayerTextInset : item._plainTextX - under.x
            width: item.width - under.x - x
            anchors.verticalCenter: parent.verticalCenter
            Text {
                objectName: "dashboardUnderTitle"
                width: parent.width
                elide: Text.ElideRight
                text: item.underLayer ? item.underLayer.title : ""
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: Theme.px(16)
                font.bold: true
            }
            Text {
                width: parent.width
                elide: Text.ElideRight
                text: item.underLayer ? item.underLayer.body : ""
                color: Theme.textDim
                font.family: Theme.fontFamily
                font.pixelSize: Theme.px(14)
            }
        }
    }
    // The top layer's own edge.
    Image {
        objectName: "dashboardTopDivider"
        visible: item.stacked
        x: item._topX
        y: (parent.height - height) / 2
        width: Theme.artWidth(source)
        height: Theme.artHeight(source)
        opacity: textColumn.opacity
        source: Theme.asset("notification-divider.png")
    }

    Column {
        id: textColumn
        visible: item._own
        x: item.stacked ? item._topX + Theme.dashboardLayerTextInset : item._plainTextX
        width: parent.width - (item.stacked ? item.topEdge + Theme.dashboardLayerTextInset : item._plainTextX)
        // Fading as it is swiped away, as the row does.
        opacity: item.stacked ? Math.max(0, 1 - item.layerX / Math.max(1, item.width - item.topEdge)) : 1
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
            visible: item._actionItems.length === 0
            width: parent.width
            elide: Text.ElideRight
            text: item.body
            color: Theme.textDim
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(14)
        }
        // Room for the answers (actionRow, over the row's own tap area).
        Item {
            id: actionSpace
            visible: item._actionItems.length > 0
            width: parent.width
            height: Theme.px(24)
        }
        // The progress of an ongoing activity.
        Rectangle {
            objectName: "dashboardProgress"
            visible: item.progress >= 0
            width: parent.width - Theme.px(10)
            height: Theme.px(4)
            radius: height / 2
            color: Qt.rgba(1, 1, 1, 0.2)
            Rectangle {
                width: parent.width * Math.max(0, Math.min(100, item.progress)) / 100
                height: parent.height
                radius: parent.radius
                color: Theme.text
            }
        }
    }

    // The answers: small pills on the second line, above the row's own
    // MouseArea (a tap on one is not a tap on the row).
    Row {
        id: actionRow
        objectName: "dashboardActions"
        visible: item._own && item._actionItems.length > 0
        z: 2
        x: textColumn.x
        y: textColumn.y + actionSpace.y + (actionSpace.height - height) / 2
        width: textColumn.width
        spacing: Theme.px(6)
        clip: true
        Repeater {
            model: item._actionItems
            delegate: Rectangle {
                id: pill
                required property var modelData
                objectName: "dashboardAction_" + modelData.id
                height: Theme.px(22)
                width: pillLabel.implicitWidth + Theme.px(18)
                radius: height / 2
                color: pillArea.pressed ? Qt.rgba(1, 1, 1, 0.32) : Qt.rgba(1, 1, 1, 0.12)
                border.width: Math.max(1, Theme.px(1))
                border.color: Qt.rgba(1, 1, 1, 0.35)
                Text {
                    id: pillLabel
                    anchors.centerIn: parent
                    text: pill.modelData.label
                    color: Theme.text
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.px(13)
                }
                MouseArea {
                    id: pillArea
                    anchors.fill: parent
                    preventStealing: true
                    onClicked: item.actionTapped(String(pill.modelData.id))
                }
            }
        }
    }
}
