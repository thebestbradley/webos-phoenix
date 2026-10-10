// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The keyboard button (Phoenix; the iPad's keyboard bar, GAPS V8 (1)): with
// a hardware keyboard attached and a text field in use, the virtual
// keyboard stays down, and this brings it up. The original had no such
// button (the TouchPad's Bluetooth keyboard had its own key for it), so
// its behaviour is Phoenix's (the owner, 10 October 2026):
//
//   - It sits on the left or right edge (by default the bottom right, above
//     the gesture bar) and never covers the notification area: the phone's
//     banner, dashboard and popup alerts at the bottom, the tablet's
//     drop-down and alerts at the top right (keepOut). It moves clear of
//     them along its edge, following them as they grow, else to the other
//     edge, else it hides; outside its own rectangle it takes no touches.
//   - Dragged, it follows the finger and, let go, snaps to the nearer edge
//     at the height it was dropped (placeChosen: the side, and the height
//     as a fraction of the room between the status bar and the bottom,
//     which the shell saves).
//   - Held (600 ms without moving) or right-clicked, a menu in the system's
//     popup look (as IconMenu's) offers Hide Keyboard Button and Cancel
//     (hideRequested).
//   - A tap brings the keyboard up (activated).
//
// Fill the UI root with it: it lays itself out in its own coordinates.

import QtQuick

Item {
    id: root

    // The shell wants it shown (a hardware keyboard, a field, the keyboard down).
    property bool shown: false
    // Where it was put: "left" or "right", and its height along the edge
    // (0: under the status bar, 1: at the bottom).
    property string side: "right"
    property real fraction: 1
    // The room the status bar takes at the top.
    property real topInset: 0
    // What it must not cover (the notification area), as rects in this
    // item's coordinates.
    property var keepOut: []

    signal activated
    signal placeChosen(string side, real fraction)
    signal hideRequested

    readonly property real sideMargin: Theme.px(12)
    readonly property real edgeMargin: Theme.px(10)
    // Between it and what it keeps clear of.
    readonly property real gap: Theme.px(8)
    readonly property bool menuOpen: _menuOpen
    readonly property alias button: button

    property string _side: side === "left" ? "left" : "right"
    property real _fraction: isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 1
    onSideChanged: _side = side === "left" ? "left" : "right"
    onFractionChanged: _fraction = isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 1

    property bool _menuOpen: false
    // Settling after a drop: x and y animate to the edge.
    property bool _snapping: false
    property real _dragX: 0
    property real _dragY: 0
    property real _startX: 0
    property real _startY: 0

    readonly property real _top: topInset + edgeMargin
    readonly property real _bottom: Math.max(_top, height - edgeMargin - button.height)

    function _clear(y, blocks) {
        for (var i = 0; i < blocks.length; ++i) {
            var r = blocks[i];
            if (y + button.height + gap > r.y + 0.5 && y < r.y + r.height + gap - 0.5)
                return false;
        }
        return true;
    }
    // Where on that edge, nearest the height asked for, clear of keepOut;
    // null when there is no room.
    function _placeOn(edge, wantY) {
        var x = edge === "left" ? sideMargin : width - sideMargin - button.width;
        var blocks = [];
        var list = keepOut || [];
        for (var i = 0; i < list.length; ++i) {
            var r = list[i];
            if (r && r.width > 0 && r.height > 0 && r.x < x + button.width + gap && r.x + r.width > x - gap)
                blocks.push(r);
        }
        var y = Math.max(_top, Math.min(_bottom, wantY));
        var candidates = [y];
        for (i = 0; i < blocks.length; ++i)
            candidates.push(blocks[i].y - gap - button.height, blocks[i].y + blocks[i].height + gap);
        var best = null;
        for (i = 0; i < candidates.length; ++i) {
            var c = candidates[i];
            if (c < _top - 0.5 || c > _bottom + 0.5 || !_clear(c, blocks))
                continue;
            if (best === null || Math.abs(c - y) < Math.abs(best - y))
                best = c;
        }
        return best === null ? null : { x: x, y: best, side: edge };
    }
    readonly property var place: {
        var wantY = _top + _fraction * (_bottom - _top);
        return _placeOn(_side, wantY) || _placeOn(_side === "left" ? "right" : "left", wantY);
    }

    // A drag starts from where it rests (kept up to date, so the button
    // does not jump as the drag takes over its place).
    function _syncDrag() {
        if (!button.dragging && place) {
            _dragX = place.x;
            _dragY = place.y;
        }
    }
    onPlaceChanged: _syncDrag()
    Component.onCompleted: _syncDrag()

    onShownChanged: if (!shown) _menuOpen = false

    // A tap outside the menu closes it.
    MouseArea {
        objectName: "keyboardButtonMenuScrim"
        anchors.fill: parent
        enabled: root._menuOpen
        visible: root._menuOpen
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        onPressed: root._menuOpen = false
    }

    Rectangle {
        id: button
        objectName: "showKeyboardButton"
        readonly property bool dragging: drag.active
        visible: root.shown && (dragging || root.place !== null)
        width: Theme.px(56)
        height: Theme.px(40)
        x: dragging ? root._dragX : root.place ? root.place.x : root.width - root.sideMargin - width
        y: dragging ? root._dragY : root.place ? root.place.y : root._bottom
        Behavior on x {
            enabled: root._snapping || (!button.dragging && button.visible)
            NumberAnimation { duration: Theme.positiveSpaceDuration; easing.type: Easing.OutCubic }
        }
        Behavior on y {
            enabled: root._snapping
            NumberAnimation { duration: Theme.positiveSpaceDuration; easing.type: Easing.OutCubic }
        }
        radius: Theme.px(8)
        color: tap.pressed || dragging || root._menuOpen ? "#e0505050" : "#d0202020"
        border.color: "#60ffffff"

        Accessible.role: Accessible.Button
        Accessible.name: qsTr("Show Keyboard")
        Accessible.description: qsTr("Hold for more options")
        Accessible.onPressAction: root.activated()

        Item {
            anchors.centerIn: parent
            width: Theme.px(36)
            height: Theme.px(22)
            clip: true
            // icon-hide-keyboard.png without its arrow: just the keyboard.
            Image {
                source: Theme.asset("keyboard-tablet/icon-hide-keyboard.png")
                width: Theme.px(36)
                height: Theme.px(36) * Theme.artHeight(source) / Math.max(1, Theme.artWidth(source))
            }
        }

        TapHandler {
            id: tap
            objectName: "keyboardButtonTap"
            longPressThreshold: 0.6
            onTapped: root.activated()
            onLongPressed: root._menuOpen = true
        }
        TapHandler {
            acceptedButtons: Qt.RightButton
            onTapped: root._menuOpen = true
        }
        DragHandler {
            id: drag
            objectName: "keyboardButtonDrag"
            target: null
            onActiveChanged: {
                if (active) {
                    snapTimer.stop();
                    root._snapping = false;
                    root._menuOpen = false;
                    root._startX = root._dragX;
                    root._startY = root._dragY;
                    return;
                }
                // Let go: the nearer edge, at the height it was dropped.
                var edge = root._dragX + button.width / 2 < root.width / 2 ? "left" : "right";
                var range = root._bottom - root._top;
                var f = range > 0 ? Math.max(0, Math.min(1, (root._dragY - root._top) / range)) : 1;
                root._snapping = true;
                root._side = edge;
                root._fraction = f;
                snapTimer.restart();
                root.placeChosen(edge, f);
            }
            onActiveTranslationChanged: {
                if (!active)
                    return;
                root._dragX = Math.max(0, Math.min(root.width - button.width, root._startX + activeTranslation.x));
                root._dragY = Math.max(root.topInset, Math.min(root.height - button.height, root._startY + activeTranslation.y));
            }
        }
    }
    Timer {
        id: snapTimer
        interval: Theme.positiveSpaceDuration + 50
        onTriggered: root._snapping = false
    }

    // A row of the menu (IconMenu's rows).
    component MenuRow: Item {
        id: row
        property string text
        property bool first: false
        property bool last: false
        readonly property real labelWidth: label.implicitWidth
        signal chosen
        property bool active: false
        width: parent ? parent.width : 0
        height: Theme.systemMenuRowHeight
        Image {
            visible: !row.first
            x: Theme.systemMenuDividerInset / 2
            width: parent.width - Theme.systemMenuDividerInset
            height: Theme.px(2)
            source: Theme.asset("menu-divider.png")
        }
        ArtBorderImage {
            visible: area.pressed && area.containsMouse
            source: Theme.asset(row.last ? "menu-selection-gradient-last.png" : "menu-selection-gradient-default.png")
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
            text: row.text
            color: Theme.systemMenuText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.systemMenuFontSize
        }
        MouseArea {
            id: area
            anchors.fill: parent
            enabled: row.active
            onClicked: row.chosen()
        }
    }

    // ---- The hold menu: the system's popup (popup-bg.png, the app menu's rows) ----
    readonly property real _edge: Theme.px(11)       // popup-bg.png's shadow (IconMenu)
    ArtBorderImage {
        id: panel
        objectName: "keyboardButtonMenu"
        visible: opacity > 0
        opacity: root._menuOpen ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.statusBarMenuFadeDuration } }
        width: Math.min(root.width - 2 * root.sideMargin, Math.max(Theme.px(200), rowsWidth)) + 2 * root._edge
        height: column.height + 2 * root._edge + 2 * Theme.px(4)
        readonly property real rowsWidth: Math.max(hideRow.labelWidth, cancelRow.labelWidth) + 2 * Theme.systemMenuIndent
        // Beside the button's edge, above it, or below it when there is no room.
        x: {
            var w = width - 2 * root._edge;
            var left = root._side === "left" ? button.x : button.x + button.width - w;
            return Math.max(root.sideMargin, Math.min(root.width - root.sideMargin - w, left)) - root._edge;
        }
        y: {
            var h = height - 2 * root._edge;
            var top = button.y - Theme.px(8) - h;
            if (top < root.topInset + root.edgeMargin)
                top = button.y + button.height + Theme.px(8);
            return top - root._edge;
        }
        source: Theme.asset("popup-bg.png")
        border { left: Theme.artBorder(35, source); right: Theme.artBorder(35, source); top: Theme.artBorder(40, source); bottom: Theme.artBorder(40, source) }
        MouseArea { anchors.fill: parent; enabled: root._menuOpen; acceptedButtons: Qt.LeftButton | Qt.RightButton }   // swallow taps

        Column {
            id: column
            x: root._edge
            y: root._edge + Theme.px(4)
            width: panel.width - 2 * root._edge
            MenuRow {
                id: hideRow
                objectName: "keyboardButtonHide"
                first: true
                active: root._menuOpen
                text: qsTr("Hide Keyboard Button")
                onChosen: {
                    root._menuOpen = false;
                    root.hideRequested();
                }
            }
            MenuRow {
                id: cancelRow
                objectName: "keyboardButtonCancel"
                last: true
                active: root._menuOpen
                text: qsTr("Cancel")
                onChosen: root._menuOpen = false
            }
        }
    }
}
