// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The volume indicator: what LunaSysMgr showed when the volume keys
// changed a volume (NativeAlertManager::actOnChanged,
// VolumeControlAlertWindow.cpp). A transient alert: centred in the
// positive space on its 9-tile background (transient-alart-bg.png, 20 px
// margins; GraphicsItemContainer TransientAlertBackground), fading in and
// out over 400 ms (DashboardWindowManager::animateTransientAlertWindow),
// gone 3 s after the last change.
//
// kind: "phone" (in a call), "ringtone" (the ringer, and the system's
// sounds), "media" (music, video) or "mute" (the ringer switched off:
// bell_off.png). The level picks one of the picture's 11 rows, 160 x 48
// each, as audiod counted them (translateVolumeToGfxOffsets: (v + 6) / 11).

import QtQuick

Item {
    id: hud
    objectName: "volumeIndicator"

    property string kind: "ringtone"
    property int level: 0
    readonly property bool shown: _shown

    function show(what, volume) {
        kind = what;
        level = Math.max(0, Math.min(100, volume));
        _shown = true;
        hideTimer.restart();
    }

    property bool _shown: false
    Timer {
        id: hideTimer
        interval: 3000
        onTriggered: hud._shown = false
    }

    readonly property string _art: kind === "mute" ? "bell_off.png"
        : kind === "phone" ? "notification-volume-indicator.png"
        : kind === "media" ? "notification-music-indicator.png"
        : "notification-ringtone-indicator.png"
    // s_bitmapOffsetMapping: rows 0-9, the tenth for both 9 and 10.
    readonly property int _row: Math.min(9, Math.floor(Math.max(0, Math.min(110, level + 6)) / 11))
    readonly property real _contentWidth: Theme.px(160)
    readonly property real _contentHeight: Theme.px(48)
    readonly property real _margin: Theme.px(20)

    width: _contentWidth + 2 * _margin
    height: _contentHeight + 2 * _margin
    visible: opacity > 0
    opacity: _shown ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: 400; easing.type: Easing.Linear } }

    BorderImage {
        anchors.fill: parent
        source: Theme.asset("transient-alart-bg.png")
        border.left: Theme.artBorder(20, source)
        border.right: Theme.artBorder(20, source)
        border.top: Theme.artBorder(20, source)
        border.bottom: Theme.artBorder(20, source)
    }

    // One row of the picture (or the bell, centred).
    Item {
        x: hud._margin
        y: hud._margin
        width: hud._contentWidth
        height: hud._contentHeight
        clip: true
        Image {
            objectName: "volumeIndicatorArt"
            source: Theme.asset(hud._art)
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
            x: (parent.width - width) / 2
            y: hud.kind === "mute" ? (parent.height - height) / 2 : -hud._row * hud._contentHeight
            smooth: true
        }
    }
}
