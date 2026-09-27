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

    property var apps          // ListModel with a quickLaunch role (1..4, 0 = not pinned)
    property bool launcherOpen: false

    signal launchRequested(string appId)
    signal launcherToggled

    height: Theme.quickLaunchHeight

    BorderImage {
        anchors.fill: parent
        source: Theme.asset("launcher3/quicklaunch-bg.png")
        border { left: 4; right: 4; top: 30; bottom: 4 }
        horizontalTileMode: BorderImage.Stretch
        verticalTileMode: BorderImage.Stretch
    }

    // Pinned apps sorted by their quickLaunch slot.
    readonly property var pinned: {
        var list = [];
        if (!apps)
            return list;
        for (var i = 0; i < apps.count; ++i) {
            var a = apps.get(i);
            if (a.quickLaunch > 0)
                list.push({ slot: a.quickLaunch, appId: a.appId, title: a.title, color: a.color, glyph: a.glyph, icon: a.icon });
        }
        list.sort(function(x, y) { return x.slot - y.slot; });
        return list.slice(0, Theme.quickLaunchMaxItems - 1);
    }

    readonly property real slotWidth: width / (pinned.length + 1)
    readonly property int iconSize: Theme.quickLaunchIconSize

    Repeater {
        model: ql.pinned
        delegate: AppIcon {
            required property var modelData
            required property int index
            x: ql.slotWidth * index + (ql.slotWidth - width) / 2
            y: Theme.quickLaunchIconY
            size: ql.iconSize
            showLabel: false
            title: modelData.title
            color: modelData.color
            glyph: modelData.glyph
            source: modelData.icon
            onClicked: ql.launchRequested(modelData.appId)
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
            y: (buttonMouse.pressed || ql.launcherOpen) ? -parent.height : 0
            source: Theme.asset("launcher3/quicklaunch-button-launcher.png")
            smooth: true
        }

        MouseArea {
            id: buttonMouse
            anchors.fill: parent
            onClicked: ql.launcherToggled()
        }
    }
}
