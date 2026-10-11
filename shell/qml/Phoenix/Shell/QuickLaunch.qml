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
//
// In Ember Glass on phones (Phoenix 2.0; docs/SYSTEM-UI-2.md, 6) the shelf
// is the mock-ups' floating dock (cards.html .dock): a 64 px glass capsule
// 34 px in from each side, the apps spread inside it, the launcher button
// Phosphor's four squares, an ember dot under the app in front. The apps
// keep their own icons (owner question 10); what it does is the same.

import QtQuick

Item {
    id: ql

    property var apps          // ListModel: appId, title, color, glyph, icon
    property bool launcherOpen: false

    signal launchRequested(string appId)
    signal launcherToggled
    // Press and hold on the launcher button: the Assistant
    // (docs/M6-PLAN.md F3; a tap still opens the launcher).
    signal assistantRequested
    // The hold opens it (Shell.assistantEnabled); off, a hold does nothing.
    property bool assistantEnabled: true

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
        objectName: "quickLaunchBlur"
        // Ember Glass: inside the capsule, blur(12px) (.dock). (Over the
        // capsule's own rect: the mask is stretched over the blur's.)
        x: ql.egDock ? egCapsule.x : 0
        y: ql.egDock ? egCapsule.y : 0
        width: ql.egDock ? egCapsule.width : ql.width
        height: ql.egDock ? egCapsule.height : ql.height
        source: ql.backdrop
        mask: ql.egDock ? egMask : null
        radius: ql.egDock ? Theme.px(12) : Theme.px(Theme.backdropBlurRadius)
    }

    // ---- Ember Glass's dock ----------------------------------------------------------
    // Phones and tablets alike (no render draws a tablet's: the phone's
    // capsule, as tall as the tablet's icons need, 10 px round them).
    readonly property bool egDock: Theme.emberGlass
    // The capsule's sides, and its 10 px padding: where the slots are.
    readonly property real egInset: egDock ? Theme.px(34 + 10) : 0
    // The app in front (Shell: the card view's), marked by the ember dot.
    property string activeAppId: ""
    // The blur keeps to the capsule, all of it (the mask's alpha is the
    // blur's; the capsule's own tint is 34%).
    Rectangle {
        id: egMask
        visible: false
        width: egCapsule.width
        height: egCapsule.height
        radius: egCapsule.radius
        color: "white"
    }
    Rectangle {
        id: egCapsule
        objectName: "emberDock"
        visible: ql.egDock
        x: Theme.px(34)
        width: ql.width - 2 * Theme.px(34)
        height: Theme.tablet ? Theme.quickLaunchIconSize + Theme.px(2 * 10) : Theme.px(64)
        // At the top: the 10 px under it keep it off the notification bar
        // (Theme.quickLaunchHeight).
        y: 0
        radius: height / 2
        // Without live blur, the dark theme's 94% tint (glass.fallback).
        color: Theme.egLiveBlur ? Qt.rgba(20 / 255, 18 / 255, 20 / 255, 0.34) : EmberGlass.dark.glassFallback
        border.color: Qt.rgba(1, 1, 1, 0.28)
        border.width: Math.max(1, EmberGlass.hairline * Theme.u)
        EgHighlight {
            width: parent.width
            topLeftRadius: parent.radius
            topRightRadius: parent.radius
            inset: parent.border.width
            color: Qt.rgba(1, 1, 1, 0.1)
        }
    }

    // quicklaunch-bg.png (10 x 105) tiled from the bar's top left, cut at
    // its height (QuickLaunchBar::paintBackground, :283-290). Also with the
    // launcher up: the original loads quicklaunch-bg-solid.png (:111-114)
    // but only ever paints the translucent art (m_qp_currentBg, set once at
    // :115), and the dock's "backgroundOpacity" that OverlayWindowManager
    // animates with the launcher (OverlayWindowManager.cpp:295-297,
    // 1459-1462, 1474-1477, 1543-1546) is stored and nothing paints with it
    // (Quicklauncher::setBackgroundOpacity, dimensionsmain.cpp:372-378), so
    // the dock never turned solid on a device.
    Item {
        anchors.fill: parent
        clip: true
        visible: !ql.egDock
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

    readonly property real slotWidth: (width - 2 * egInset) / (pinned.length + 1)
    readonly property int iconSize: Theme.quickLaunchIconSize
    // The icons' top: 1.0's, or centred in Ember Glass's capsule.
    readonly property real iconY: egDock ? Math.round(egCapsule.y + (egCapsule.height - iconSize) / 2) : Theme.quickLaunchIconY
    // Tablets: the item area, left of the button's cell, and the space
    // after each 128 px cell in it (rearrangeIcons, :671).
    readonly property real cellWidth: Theme.quickLaunchCellWidth
    readonly property real interSpace: pinned.length === 0 ? 0
        : Math.max(0, Math.floor((width - 2 * egInset - cellWidth - pinned.length * cellWidth) / pinned.length))

    // Centre of item i's cell; i === pinned.length is the launcher button.
    function slotCentre(i) {
        if (!Theme.tablet)
            return egInset + slotWidth * i + slotWidth / 2;
        if (i >= pinned.length)
            return width - egInset - cellWidth / 2;
        return egInset + i * (cellWidth + interSpace) + cellWidth / 2;
    }

    // Dock slot for a drop at x (0 .. pinned.length): the nearest centre.
    function slotAt(x) {
        if (!Theme.tablet)
            return Math.max(0, Math.min(pinned.length, Math.floor((x - egInset) / slotWidth)));
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
        y: ql.iconY - Theme.px(6)
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
            y: ql.iconY
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
    // Ember Glass: the ember dot under the app in front (.dock .app.on::after).
    Rectangle {
        objectName: "emberDockDot"
        readonly property int slot: {
            for (var i = 0; i < ql.pinned.length; ++i)
                if (ql.pinned[i].appId === ql.activeAppId)
                    return i;
            return -1;
        }
        visible: ql.egDock && slot >= 0
        width: Theme.px(4)
        height: width
        radius: width / 2
        x: ql.slotCentre(Math.max(0, slot)) - width / 2
        y: ql.iconY + ql.iconSize + Theme.px(1)
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: EmberGlass.emberA }
            GradientStop { position: 1; color: EmberGlass.emberB }
        }
    }

    Item {
        id: launcherButton
        x: ql.slotCentre(ql.pinned.length) - width / 2
        y: ql.iconY
        width: ql.iconSize
        height: ql.iconSize
        clip: true

        // Ember Glass: Phosphor's four squares, white (.dock .app .ic: 25 px).
        EgIcon {
            objectName: "emberLauncherButton"
            visible: ql.egDock
            anchors.centerIn: parent
            width: Theme.px(25)
            height: width
            name: "squares-four"
            opacity: (dockMouse.pressed && dockMouse.pressedSlot === ql.pinned.length) || ql.launcherOpen ? 0.6 : 1
        }
        Image {
            visible: !ql.egDock
            width: parent.width
            height: parent.height * 2
            y: ((dockMouse.pressed && dockMouse.pressedSlot === ql.pinned.length) || ql.launcherOpen) ? -parent.height : 0
            source: Theme.asset("launcher3/quicklaunch-button-launcher.png")
            smooth: true
        }
    }

    // Tap launches; press and hold (or a right click) opens a dock app's
    // menu (IconMenu.qml), and moving the finger on from there picks it
    // up, to move it along the dock or drag it off, as the hold alone did
    // (quicklaunchbar.cpp).
    signal menuRequested(string appId, string from, rect iconRect)
    function iconRect(i) {
        return Qt.rect(slotCentre(i) - iconSize / 2, iconY, iconSize, iconSize);
    }
    MouseArea {
        id: dockMouse
        objectName: "quickLaunchMouse"
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        pressAndHoldInterval: Theme.iconMenuHoldInterval
        preventStealing: ql.draggedId !== "" || heldSlot >= 0
        property int pressedSlot: -1
        // The app whose menu the hold opened, while the finger is down.
        property int heldSlot: -1
        property point heldAt
        onPressed: (mouse) => {
            pressedSlot = ql.slotAt(mouse.x);
            heldSlot = -1;
            if (mouse.button === Qt.RightButton && pressedSlot < ql.pinned.length)
                ql.menuRequested(ql.pinned[pressedSlot].appId, "dock", ql.iconRect(pressedSlot));
        }
        onClicked: (mouse) => { if (mouse.button === Qt.LeftButton) ql.activateSlot(ql.slotAt(mouse.x)); }
        onPressAndHold: (mouse) => {
            var i = ql.slotAt(mouse.x);
            if (mouse.button === Qt.LeftButton && i === ql.pinned.length && ql.assistantEnabled) {
                // The press shows as the button's pressed state until it lifts;
                // no click follows a hold.
                ql.assistantRequested();
                return;
            }
            if (mouse.button !== Qt.LeftButton || i >= ql.pinned.length)
                return;
            heldSlot = i;
            heldAt = Qt.point(mouse.x, mouse.y);
            ql.menuRequested(ql.pinned[i].appId, "dock", ql.iconRect(i));
        }
        onPositionChanged: (mouse) => {
            if (heldSlot >= 0 && Math.hypot(mouse.x - heldAt.x, mouse.y - heldAt.y) > Qt.styleHints.startDragDistance) {
                var i = heldSlot;
                heldSlot = -1;
                if (i < ql.pinned.length)
                    ql.dragStarted(ql.pinned[i].appId, "dock", mouse.x, mouse.y);
                return;
            }
            if (ql.draggedId !== "")
                ql.dragMoved(mouse.x, mouse.y);
        }
        onReleased: (mouse) => {
            heldSlot = -1;
            if (ql.draggedId !== "")
                ql.dragEnded(mouse.x, mouse.y);
        }
        onCanceled: heldSlot = -1
    }
}
