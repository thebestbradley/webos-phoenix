// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Quick launch bar: the glass shelf along the bottom of card view with the
// favourite apps and the launcher button (images/launcher3/quicklaunch-*).
// Up to five items including the launcher button (layoutsettings.cpp:87);
// the launcher button sits at the right end (inferred from device photos).

import QtQuick

Item {
    id: ql

    property var apps          // ListModel: appId, title, color, glyph, icon
    property bool launcherOpen: false

    signal launchRequested(string appId)
    signal launcherToggled

    height: Theme.quickLaunchHeight

    // The scene behind the glass, blurred faintly under it.
    property Item backdrop: null

    BackdropBlur {
        anchors.fill: parent
        source: ql.backdrop
    }

    BorderImage {
        anchors.fill: parent
        source: Theme.asset("launcher3/quicklaunch-bg.png")
        border { left: 4; right: 4; top: 30; bottom: 4 }
        horizontalTileMode: BorderImage.Stretch
        verticalTileMode: BorderImage.Stretch
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
                list.push({ appId: a.appId, title: a.title, color: a.color, glyph: a.glyph, icon: a.icon });
        }
        return list;
    }

    readonly property real slotWidth: width / (pinned.length + 1)
    readonly property int iconSize: Theme.quickLaunchIconSize

    // Dock slot for a drop at x (0 .. pinned.length).
    function slotAt(x) {
        return Math.max(0, Math.min(pinned.length, Math.floor(x / slotWidth)));
    }

    Repeater {
        model: ql.pinned
        delegate: AppIcon {
            required property var modelData
            required property int index
            x: ql.slotWidth * index + (ql.slotWidth - width) / 2
            y: Theme.quickLaunchIconY
            size: ql.iconSize
            showLabel: false
            interactive: false
            opacity: ql.draggedId === modelData.appId ? 0 : 1
            pressed: dockMouse.pressed && dockMouse.pressedSlot === index
            title: modelData.title
            color: modelData.color
            glyph: modelData.glyph
            source: modelData.icon
        }
    }

    // Launcher button. The art is a 64x128 sprite: top half normal, bottom
    // half active (quicklaunchbar.cpp:65-67).
    Item {
        id: launcherButton
        x: ql.slotWidth * ql.pinned.length + (ql.slotWidth - width) / 2
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
        onClicked: (mouse) => {
            var i = ql.slotAt(mouse.x);
            if (i >= ql.pinned.length)
                ql.launcherToggled();
            else
                ql.launchRequested(ql.pinned[i].appId);
        }
        onPressAndHold: (mouse) => {
            var i = ql.slotAt(mouse.x);
            if (i < ql.pinned.length)
                ql.dragStarted(ql.pinned[i].appId, "dock", mouse.x, mouse.y);
        }
        onPositionChanged: (mouse) => { if (ql.draggedId !== "") ql.dragMoved(mouse.x, mouse.y); }
        onReleased: (mouse) => { if (ql.draggedId !== "") ql.dragEnded(mouse.x, mouse.y); }
    }
}
