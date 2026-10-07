// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The icon menu: holding a launcher or dock icon for 500 ms (or a right
// click) lifts the icon with a slight zoom, dims the rest and opens a
// menu beside it (docs/M6-PLAN.md F1; a Phoenix addition: in luna-sysmgr
// the hold only entered edit mode, reorderablepage.cpp:450-540). The menu
// is drawn as the system's popups are: popup-bg.png (the launcher's app
// info dialog, the edit popup) with the app menu's rows, dividers and
// pressed highlight (menu-divider.png, menu-selection-gradient-*.png).
//
// open(appId, from, rect, items): rect is the icon in this item's
// coordinates; items [{name, text, available?}]. A row emits
// triggered(name) and the menu closes; a tap outside, Back or Esc
// closes it (closeRequested).

import QtQuick

Item {
    id: menu
    objectName: "iconMenu"

    property bool open: false
    property string appId: ""
    // "page" (a launcher page) or "dock".
    property string from: ""
    property rect iconRect: Qt.rect(0, 0, 0, 0)
    property var items: []
    // The lifted icon's picture.
    property string title: ""
    property color iconColor: "#666666"
    property string glyph: ""
    property url iconSource: ""
    property url largeSource: ""
    // The menu's row with the keyboard's ring, -1 for none.
    property int keyIndex: -1

    signal triggered(string name)
    signal closeRequested

    visible: open || dim.opacity > 0
    // Fading out, it takes no touches.
    enabled: open

    function show(id, source, rect, list, look) {
        appId = id;
        from = source;
        iconRect = rect;
        items = list;
        title = look.title || "";
        iconColor = look.color || "#666666";
        glyph = look.glyph || "";
        iconSource = look.icon || "";
        largeSource = look.largeIcon || "";
        keyIndex = -1;
        open = true;
    }

    function choose(name) {
        for (var i = 0; i < items.length; ++i)
            if (items[i].name === name && items[i].available !== false) {
                open = false;
                triggered(name);
                return true;
            }
        return false;
    }

    // Up / Down (and Tab) over the rows that can be chosen, Enter chooses,
    // Esc closes, as the site menu's keys.
    function handleKey(event) {
        if (!open)
            return false;
        var k = event.key;
        if (k === Qt.Key_Escape) {
            closeRequested();
            return true;
        }
        if (k === Qt.Key_Down || k === Qt.Key_Up || k === Qt.Key_Tab || k === Qt.Key_Backtab) {
            var up = k === Qt.Key_Up || k === Qt.Key_Backtab;
            var n = items.length;
            for (var step = 1, i = keyIndex; step <= n; ++step) {
                i = keyIndex < 0 && step === 1 ? (up ? n - 1 : 0) : (i + (up ? -1 : 1) + n) % n;
                if (items[i].available !== false) {
                    keyIndex = i;
                    break;
                }
            }
            return true;
        }
        if ((k === Qt.Key_Return || k === Qt.Key_Enter || k === Qt.Key_Space) && keyIndex >= 0) {
            choose(items[keyIndex].name);
            return true;
        }
        return true;
    }

    // The rest dims.
    Rectangle {
        id: dim
        anchors.fill: parent
        color: "#000000"
        opacity: menu.open ? 0.5 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.statusBarMenuFadeDuration } }
    }
    // A tap outside closes it.
    MouseArea {
        objectName: "iconMenuScrim"
        anchors.fill: parent
        enabled: menu.open
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        onPressed: menu.closeRequested()
    }

    // The icon, lifted.
    AppIcon {
        id: lifted
        objectName: "iconMenuIcon"
        x: menu.iconRect.x + (menu.iconRect.width - width) / 2
        y: menu.iconRect.y + (menu.iconRect.height - height) / 2
        size: Math.max(1, Math.min(menu.iconRect.width, menu.iconRect.height))
        showLabel: false
        interactive: false
        title: menu.title
        color: menu.iconColor
        glyph: menu.glyph
        source: menu.iconSource
        largeSource: menu.largeSource
        opacity: dim.opacity * 2
        scale: menu.open ? 1.15 : 1
        Behavior on scale { NumberAnimation { duration: Theme.statusBarMenuFadeDuration; easing.type: Easing.OutCubic } }
    }

    // ---- The menu -------------------------------------------------------------------
    readonly property real _edge: Theme.px(11)       // popup-bg.png's shadow (AppInfoDialog.qml)
    readonly property real _gap: Theme.px(10)
    readonly property real _margin: Theme.px(8)      // from the screen's edges
    readonly property real _iconW: iconRect.width * 1.15
    readonly property real _iconH: iconRect.height * 1.15
    readonly property real _cx: iconRect.x + iconRect.width / 2
    readonly property real _cy: iconRect.y + iconRect.height / 2

    // Beside the icon: right, else left; else under it, else over it
    // (the dock's icons: over them).
    readonly property string side: {
        var w = panel.width - 2 * _edge, h = panel.height - 2 * _edge;
        if (from !== "dock") {
            if (_cx + _iconW / 2 + _gap + w + _margin <= width)
                return "right";
            if (_cx - _iconW / 2 - _gap - w - _margin >= 0)
                return "left";
            if (_cy + _iconH / 2 + _gap + h + _margin <= height)
                return "below";
        }
        return "above";
    }

    ArtBorderImage {
        id: panel
        objectName: "iconMenuPanel"
        width: Math.min(menu.width - 2 * menu._margin + 2 * menu._edge,
                        Math.max(Theme.px(180), panel.rowsWidth) + 2 * menu._edge)
        height: column.height + 2 * menu._edge + 2 * Theme.px(4)
        x: {
            var w = width - 2 * menu._edge, left;
            if (menu.side === "right")
                left = menu._cx + menu._iconW / 2 + menu._gap;
            else if (menu.side === "left")
                left = menu._cx - menu._iconW / 2 - menu._gap - w;
            else
                left = menu._cx - w / 2;
            return Math.max(menu._margin, Math.min(menu.width - menu._margin - w, left)) - menu._edge;
        }
        y: {
            var h = height - 2 * menu._edge, top;
            if (menu.side === "below")
                top = menu._cy + menu._iconH / 2 + menu._gap;
            else if (menu.side === "above")
                top = menu._cy - menu._iconH / 2 - menu._gap - h;
            else
                top = menu._cy - menu._iconH / 2;
            return Math.max(menu._margin, Math.min(menu.height - menu._margin - h, top)) - menu._edge;
        }
        // The widest row's text, with its indent on both sides.
        readonly property real rowsWidth: {
            var w = 0;
            for (var i = 0; i < rows.count; ++i) {
                var r = rows.itemAt(i);
                if (r)
                    w = Math.max(w, r.labelWidth + 2 * Theme.systemMenuIndent);
            }
            return w;
        }
        source: Theme.asset("popup-bg.png")
        border { left: Theme.artBorder(35, source); right: Theme.artBorder(35, source); top: Theme.artBorder(40, source); bottom: Theme.artBorder(40, source) }
        opacity: menu.open ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.statusBarMenuFadeDuration } }
        scale: menu.open ? 1 : 0.9
        Behavior on scale { NumberAnimation { duration: Theme.statusBarMenuFadeDuration; easing.type: Easing.OutCubic } }
        transformOrigin: menu.side === "right" ? Item.Left : menu.side === "left" ? Item.Right
                       : menu.side === "below" ? Item.Top : Item.Bottom
        MouseArea { anchors.fill: parent; acceptedButtons: Qt.LeftButton | Qt.RightButton }   // swallow taps

        Column {
            id: column
            x: menu._edge
            y: menu._edge + Theme.px(4)
            width: panel.width - 2 * menu._edge
            Repeater {
                id: rows
                model: menu.items
                delegate: Item {
                    id: row
                    required property var modelData
                    required property int index
                    readonly property bool available: modelData.available !== false
                    readonly property real labelWidth: label.implicitWidth
                    objectName: "iconMenu_" + modelData.name
                    width: column.width
                    height: Theme.systemMenuRowHeight
                    Image {
                        visible: row.index > 0
                        x: Theme.systemMenuDividerInset / 2
                        width: parent.width - Theme.systemMenuDividerInset
                        height: Theme.px(2)
                        source: Theme.asset("menu-divider.png")
                    }
                    ArtBorderImage {
                        visible: row.available && ((area.pressed && area.containsMouse) || menu.keyIndex === row.index)
                        source: Theme.asset(row.index === menu.items.length - 1 ? "menu-selection-gradient-last.png" : "menu-selection-gradient-default.png")
                        x: Theme.px(2)
                        width: parent.width - Theme.px(4)
                        height: parent.height
                        border { left: Theme.artBorder(19, source); right: Theme.artBorder(19, source) }
                    }
                    Text {
                        id: label
                        x: Theme.systemMenuIndent
                        width: parent.width - 2 * Theme.systemMenuIndent
                        anchors.verticalCenter: parent.verticalCenter
                        elide: Text.ElideRight
                        text: row.modelData.text
                        color: Theme.systemMenuText
                        opacity: row.available ? 1 : 0.4
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.systemMenuFontSize
                    }
                    MouseArea {
                        id: area
                        anchors.fill: parent
                        enabled: row.available && menu.open
                        onClicked: menu.choose(row.modelData.name)
                    }
                }
            }
        }
    }
}
