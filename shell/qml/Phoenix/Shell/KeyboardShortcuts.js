// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shell's hardware keyboard shortcuts (GAPS V8), in two schemes the
// owner chose to offer side by side (Settings > Text Assist > Hardware
// keyboard): "ipad", Command-style shortcuts as on an iPad, and "desktop",
// as a Linux desktop. The original keyboard's own keys (Search, the
// card-view key) work in both. Qt's Ctrl is Command on a Mac and its Meta
// is Control; elsewhere Meta is the Super (Windows) key.

.pragma library

// {action, key, modifiers, label}
function scheme(name) {
    var C = Qt.ControlModifier, S = Qt.ShiftModifier, A = Qt.AltModifier, M = Qt.MetaModifier;
    if (name === "desktop") {
        return [
            { action: "next", key: Qt.Key_Tab, modifiers: A, label: qsTr("Next card") },
            { action: "previous", key: Qt.Key_Backtab, modifiers: A | S, label: qsTr("Previous card") },
            { action: "close", key: Qt.Key_F4, modifiers: A, label: qsTr("Close the card") },
            { action: "justType", key: Qt.Key_Space, modifiers: M, label: qsTr("Just Type") },
            { action: "launcher", key: Qt.Key_A, modifiers: M, label: qsTr("Launcher") },
            { action: "maximize", key: Qt.Key_Up, modifiers: M, label: qsTr("Open the card") },
            { action: "cardView", key: Qt.Key_Down, modifiers: M, label: qsTr("Card view") },
            { action: "notifications", key: Qt.Key_N, modifiers: M, label: qsTr("Notifications") },
            { action: "lock", key: Qt.Key_L, modifiers: M, label: qsTr("Lock") }
        ];
    }
    return [
        { action: "next", key: Qt.Key_Tab, modifiers: C, label: qsTr("Next card") },
        { action: "previous", key: Qt.Key_Backtab, modifiers: C | S, label: qsTr("Previous card") },
        { action: "cardView", key: Qt.Key_H, modifiers: C, label: qsTr("Card view") },
        { action: "justType", key: Qt.Key_Space, modifiers: C, label: qsTr("Just Type") },
        { action: "close", key: Qt.Key_W, modifiers: C, label: qsTr("Close the card") },
        { action: "launcher", key: Qt.Key_Up, modifiers: C, label: qsTr("Launcher") },
        { action: "maximize", key: Qt.Key_Down, modifiers: C, label: qsTr("Open the card") },
        { action: "notifications", key: Qt.Key_N, modifiers: A, label: qsTr("Notifications") },
        { action: "lock", key: Qt.Key_L, modifiers: C | A, label: qsTr("Lock") }
    ];
}

// The modifier whose hold shows the sheet: Command (iPad), Super (desktop).
function sheetKey(name) {
    return name === "desktop" ? Qt.Key_Meta : Qt.Key_Control;
}

// "⌘⇧Tab" on a Mac, "Ctrl+Shift+Tab" elsewhere.
function keyText(s, mac) {
    var parts = [];
    var m = s.modifiers;
    if (mac) {
        var t = "";
        if (m & Qt.MetaModifier) t += "⌃";
        if (m & Qt.AltModifier) t += "⌥";
        if (m & Qt.ShiftModifier) t += "⇧";
        if (m & Qt.ControlModifier) t += "⌘";
        return t + keyName(s.key);
    }
    if (m & Qt.ControlModifier) parts.push("Ctrl");
    if (m & Qt.MetaModifier) parts.push("Super");
    if (m & Qt.AltModifier) parts.push("Alt");
    if (m & Qt.ShiftModifier) parts.push("Shift");
    parts.push(keyName(s.key));
    return parts.join("+");
}

function keyName(k) {
    switch (k) {
    case Qt.Key_Tab: case Qt.Key_Backtab: return "Tab";
    case Qt.Key_Space: return "Space";
    case Qt.Key_Up: return "↑";
    case Qt.Key_Down: return "↓";
    case Qt.Key_F4: return "F4";
    default: return String.fromCharCode(k);
    }
}
