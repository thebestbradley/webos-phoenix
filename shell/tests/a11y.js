// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shell's accessibility for the tests (tst_accessibility,
// tst_accessibilitytablet): what a screen reader is given for what is on
// screen.
//
// unnamed(root) walks root's item tree and returns a line for every item a
// finger can use there (a MouseArea, or an item with a TapHandler) that is
// on screen and is not named for a screen reader: neither it nor the item it
// is in (its parent, the control a MouseArea fills) has an Accessible.name
// and a role, and it is not Accessible.ignored (an input catcher with
// nothing to say: a scrim, a gesture area, a drag surface). As Qt's
// accessibility does (QAccessibleQuickItem's unignored children), an
// ignored item's own children are still walked.

// A library script has no QML imports, so no attached Accessible of its
// own: the test passes acc(item), which returns item.Accessible.

.pragma library

var acc = function (o) { return undefined; };

function _isMouseArea(o) {
    return o && ((o.hasOwnProperty("pressAndHoldInterval") && o.hasOwnProperty("acceptedButtons"))
                 || (o.hasOwnProperty("touchPoints") && o.hasOwnProperty("maximumTouchPoints")));
}
function _hasTapHandler(o) {
    if (!o || !o.data)
        return false;
    for (var i = 0; i < o.data.length; ++i) {
        var d = o.data[i];
        if (d && d.hasOwnProperty("gesturePolicy") && d.hasOwnProperty("tapCount") && d.enabled)
            return true;
    }
    return false;
}
function _named(o) {
    var a = o && acc(o);
    return !!a && !a.ignored && a.name !== undefined && String(a.name) !== "" && a.role !== 0;
}
// Qt's Accessible.Role values a person acts on: Button, CheckBox,
// RadioButton, ComboBox, MenuItem, PageTab, Slider, SpinBox, ButtonMenu,
// ButtonDropDown, EditableText, Link.
var _controlRoles = [0x2B, 0x2C, 0x2D, 0x2E, 0x0C, 0x25, 0x33, 0x34, 0x39, 0x38, 0x2A, 0x1E];
function _isControl(o) {
    var a = acc(o);
    return !!a && !a.ignored && _controlRoles.indexOf(a.role) >= 0;
}
function _onScreen(o, root) {
    if (!o.visible || o.width <= 0 || o.height <= 0)
        return false;
    for (var p = o; p && p !== root; p = p.parent)
        if (p.opacity < 0.02)
            return false;
    var r = o.mapToItem(root, 0, 0, o.width, o.height);
    return r.x + r.width > 0 && r.y + r.height > 0 && r.x < root.width && r.y < root.height;
}
function describe(o) {
    var names = [];
    for (var p = o; p && names.length < 5; p = p.parent) {
        var s = String(p);
        names.push((p.objectName ? p.objectName + ":" : "") + s.replace(/\(0x[0-9a-f]+\)/, "").replace(/_QML_\d+/, ""));
    }
    return names.join(" < ");
}
// An app's window in a card (Card.qml's cardAppHost): the app's own
// accessibility, not the shell's.
var appHosts = ["cardAppHost"];
function unnamed(root, accessor) {
    if (accessor)
        acc = accessor;
    var out = [];
    function walk(o) {
        if (!o || !o.visible || appHosts.indexOf(o.objectName) >= 0)
            return;
        var ignored = !!acc(o) && acc(o).ignored;
        var interactive = (_isMouseArea(o) && o.enabled) || _hasTapHandler(o);
        if (!ignored && interactive && _onScreen(o, root) && !_named(o) && !(o.parent && _named(o.parent)))
            out.push(describe(o));
        // A control a screen reader is told of (a role a person acts on)
        // with nothing to say: AT-SPI's push button ''.
        else if (!ignored && _isControl(o) && _onScreen(o, root) && !_named(o))
            out.push(describe(o) + " (a control role, no name)");
        var kids = o.children || [];
        for (var i = 0; i < kids.length; ++i)
            walk(kids[i]);
    }
    walk(root);
    return out;
}
// Every named item on screen, as [name, role] (for a test's own checks).
function named(root, accessor) {
    if (accessor)
        acc = accessor;
    var out = [];
    function walk(o) {
        if (!o || !o.visible)
            return;
        if (_named(o) && _onScreen(o, root))
            out.push({ item: o, name: String(acc(o).name), role: acc(o).role,
                       description: String(acc(o).description || "") });
        var kids = o.children || [];
        for (var i = 0; i < kids.length; ++i)
            walk(kids[i]);
    }
    walk(root);
    return out;
}
