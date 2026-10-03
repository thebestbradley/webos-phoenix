// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Quick launch bar: the glass shelf along the bottom of card view with the
// favourite apps and the launcher button (images/launcher3/quicklaunch-*).
// Up to five items including the launcher button (layoutsettings.cpp:87).
//
// Tablets lay it out as QuickLaunchBar did (quicklaunchbar.cpp:320-345,
// 662-735): the launcher button centred in a 128 px icon cell at the right
// end, its top 20 px down; the apps spread over the rest, each in a 128 px
// cell followed by an equal share of what is left. Phones (the 2.x dock is
// not in the open source) share the width equally, the button last.

import QtQuick

Item {
    id: ql

    property var apps          // ListModel: appId, title, color, glyph, icon
    property bool launcherOpen: false

    signal launchRequested(string appId)
    signal launcherToggled

    // The app just tapped shows launch feedback for up to 3 s
    // (QuickLaunchBar::setAppLaunchFeedback, quicklaunchbar.cpp:633,
    // 1661-1687).
    property string feedbackId: ""
    Timer {
        running: ql.feedbackId !== ""
        interval: Theme.launchFeedbackTimeout
        onTriggered: ql.feedbackId = ""
    }

    height: Theme.quickLaunchHeight

    // The scene behind the glass, blurred faintly under it.
    property Item backdrop: null

    BackdropBlur {
        anchors.fill: parent
        source: ql.backdrop
    }

    // quicklaunch-bg.png (10 x 105) tiled from the bar's top left, cut at
    // its height (QuickLaunchBar::paintBackground, :283-290).
    Item {
        anchors.fill: parent
        clip: true
        ArtTiledImage {
            width: parent.width
            height: Theme.artHeight(source)
            source: Theme.asset("launcher3/quicklaunch-bg.png")
            fillMode: Image.Tile
            horizontalAlignment: Image.AlignLeft
            verticalAlignment: Image.AlignTop
        }
    }

    // The dock's apps, in order (LauncherLayout.js dock), at most
    // quickLaunchMaxItems - 1 beside the launcher button.
    property var dock: []
    // The icon being dragged ("" when none).
    property string draggedId: ""

    signal dragStarted(string appId, string from, real x, real y)
    signal dragMoved(real x, real y)
    signal dragEnded(real x, real y)

    function entry(id) {
        if (!apps)
            return null;
        for (var i = 0; i < apps.count; ++i)
            if (apps.get(i).appId === id)
                return apps.get(i);
        return null;
    }

    readonly property var pinned: {
        var list = [];
        var ids = (dock || []).slice(0, Theme.quickLaunchMaxItems - 1);
        for (var i = 0; i < ids.length; ++i) {
            var a = entry(ids[i]);
            if (a)
                list.push({ appId: a.appId, title: a.title, color: a.color, glyph: a.glyph, icon: a.icon, largeIcon: a.largeIcon || "" });
        }
        return list;
    }

    readonly property real slotWidth: width / (pinned.length + 1)
    readonly property int iconSize: Theme.quickLaunchIconSize
    // Tablets: the item area, left of the button's cell, and the space
    // after each 128 px cell in it (rearrangeIcons, :671).
    readonly property real cellWidth: Theme.quickLaunchCellWidth
    readonly property real interSpace: pinned.length === 0 ? 0
        : Math.max(0, Math.floor((width - cellWidth - pinned.length * cellWidth) / pinned.length))

    // Centre of item i's cell; i === pinned.length is the launcher button.
    function slotCentre(i) {
        if (!Theme.tablet)
            return slotWidth * i + slotWidth / 2;
        if (i >= pinned.length)
            return width - cellWidth / 2;
        return i * (cellWidth + interSpace) + cellWidth / 2;
    }

    // Dock slot for a drop at x (0 .. pinned.length): the nearest centre.
    function slotAt(x) {
        if (!Theme.tablet)
            return Math.max(0, Math.min(pinned.length, Math.floor(x / slotWidth)));
        var best = 0;
        for (var i = 1; i <= pinned.length; ++i)
            if (Math.abs(x - slotCentre(i)) < Math.abs(x - slotCentre(best)))
                best = i;
        return best;
    }

    // Keyboard navigation (GAPS V8 (3)): the slot with the keyboard's
    // ring, 0 .. pinned.length (the launcher button), or -1.
    property int keySlot: -1
    function activateSlot(i) {
        if (i >= pinned.length)
            launcherToggled();
        else if (i >= 0) {
            feedbackId = pinned[i].appId;
            launchRequested(pinned[i].appId);
        }
    }
    Rectangle {
        objectName: "quickLaunchKeyFocus"
        visible: ql.keySlot >= 0 && ql.visible
        x: ql.slotCentre(Math.max(0, ql.keySlot)) - width / 2
        y: Theme.quickLaunchIconY - Theme.px(6)
        width: ql.iconSize + Theme.px(12)
        height: ql.iconSize + Theme.px(12)
        radius: Theme.px(10)
        color: "#302c8ce0"
        border.color: "#2c8ce0"
        border.width: Theme.px(2)
    }

    Repeater {
        model: ql.pinned
        delegate: AppIcon {
            required property var modelData
            required property int index
            x: ql.slotCentre(index) - width / 2
            y: Theme.quickLaunchIconY
            size: ql.iconSize
            showLabel: false
            interactive: false
            opacity: ql.draggedId === modelData.appId ? 0 : 1
            feedback: ql.feedbackId === modelData.appId
            title: modelData.title
            color: modelData.color
            glyph: modelData.glyph
            source: modelData.icon
            largeSource: modelData.largeIcon || ""
        }
    }

    // Launcher button. The art is a 64x128 sprite: top half normal, bottom
    // half active (quicklaunchbar.cpp:65-67).
    Item {
        id: launcherButton
        x: ql.slotCentre(ql.pinned.length) - width / 2
        y: Theme.quickLaunchIconY
        width: ql.iconSize
        height: ql.iconSize
        clip: true

        Image {
            width: parent.width
            height: parent.height * 2
            y: ((dockMouse.pressed && dockMouse.pressedSlot === ql.pinned.length) || ql.launcherOpen) ? -parent.height : 0
            source: Theme.asset("launcher3/quicklaunch-button-launcher.png")
            smooth: true
        }
    }

    // Tap launches; press and hold picks a dock app up, to move it along the
    // dock or drag it off (quicklaunchbar.cpp).
    MouseArea {
        id: dockMouse
        anchors.fill: parent
        pressAndHoldInterval: Theme.tapAndHoldInterval
        preventStealing: ql.draggedId !== ""
        property int pressedSlot: -1
        onPressed: (mouse) => { pressedSlot = ql.slotAt(mouse.x); }
        onClicked: (mouse) => ql.activateSlot(ql.slotAt(mouse.x))
        onPressAndHold: (mouse) => {
            var i = ql.slotAt(mouse.x);
            if (i < ql.pinned.length)
                ql.dragStarted(ql.pinned[i].appId, "dock", mouse.x, mouse.y);
        }
        onPositionChanged: (mouse) => { if (ql.draggedId !== "") ql.dragMoved(mouse.x, mouse.y); }
        onReleased: (mouse) => { if (ql.draggedId !== "") ql.dragEnded(mouse.x, mouse.y); }
    }
}
