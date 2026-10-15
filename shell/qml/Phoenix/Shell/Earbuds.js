// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the shell does with AirPods (docs/ACCESSORIES.md), from the status
// org.webosphoenix.earbuds reports (system.earbuds: {bluetooth, nearby,
// devices, pairing}; services/accessories/earbuds.js on a device, the
// runtime in phoenix-sim). EarbudsMonitor.qml acts on what these decide;
// they are pure, for tst_earbuds.
//
//   - A case opened nearby (cardFor): AirPods not paired here get the
//     pairing card ("pair"), as an iPhone's setup card; paired ones the
//     battery card ("battery"), shown a few seconds. "Not now" keeps the
//     pairing card away until that case's lid closes.
//   - Ear detection (earAction): taking an earbud out pauses what plays,
//     putting it back plays again (Apple, "Use automatic ear detection").
//   - Low batteries (lowBattery): a notification as the earbuds go under
//     20, 10 and 5 percent, as Apple's "How to charge your AirPods"
//     (support.apple.com/119912) says iPhone gives.

.pragma library

var LOW_LEVELS = [20, 10, 5];

var MODE_LABELS = { off: "Off", transparency: "Transparency", adaptive: "Adaptive", anc: "Noise Cancellation" };
var MODE_ORDER = ["off", "transparency", "adaptive", "anc"];

function modeLabel(mode) { return MODE_LABELS[mode] || ""; }

// The modes a device has, in Apple's order.
function modes(device) {
    var have = device && device.noiseModes ? device.noiseModes : [];
    return MODE_ORDER.filter(function (m) { return have.indexOf(m) >= 0; });
}

function percent(v) { return typeof v === "number" && v >= 0 ? Math.round(v) + "%" : ""; }

// "L 80%  R 70%  Case 40%" (what has a reading).
function batteryText(b) {
    if (!b) return "";
    var parts = [];
    if (typeof b.single === "number" && b.single >= 0) parts.push(percent(b.single));
    if (b.left >= 0) parts.push("L " + percent(b.left));
    if (b.right >= 0) parts.push("R " + percent(b.right));
    if (b["case"] >= 0) parts.push("Case " + percent(b["case"]));
    return parts.join("  ");
}

function deviceFor(status, address) {
    var l = status && status.devices ? status.devices : [];
    for (var i = 0; i < l.length; ++i)
        if (l[i].address === address)
            return l[i];
    return null;
}

// The connected AirPods (the first), or null.
function connectedDevice(status) {
    var l = status && status.devices ? status.devices : [];
    for (var i = 0; i < l.length; ++i)
        if (l[i].connected)
            return l[i];
    return null;
}

function nearbyFor(status, id) {
    var l = status && status.nearby ? status.nearby : [];
    for (var i = 0; i < l.length; ++i)
        if (l[i].id === id)
            return l[i];
    return null;
}

// A case that has just opened: in the new status with its lid open, and
// before either not there, closed, or opened again since (the lid open
// count, Celosia & Cunche 2020 §4.2). -> [nearby].
function opened(prev, next) {
    var out = [];
    (next && next.nearby ? next.nearby : []).forEach(function (n) {
        if (!n.lidOpen)
            return;
        var p = nearbyFor(prev, n.id);
        if (!p || !p.lidOpen || p.lidOpenCount !== n.lidOpenCount)
            out.push(n);
    });
    return out;
}

// The card a status change calls for: {kind: "pair" | "battery", id,
// nearby, device} or null. dismissed: {id: true} for "Not now".
function cardFor(prev, next, dismissed) {
    var list = opened(prev, next);
    for (var i = 0; i < list.length; ++i) {
        var n = list[i];
        if (n.paired) {
            return { kind: "battery", id: n.id, nearby: n, device: deviceFor(next, n.paired) };
        }
        if (!dismissed || !dismissed[n.id])
            return { kind: "pair", id: n.id, nearby: n, device: null };
    }
    return null;
}

// "Not now"s to forget: the cases closed since (or gone).
function stillDismissed(dismissed, next) {
    var out = {};
    for (var id in dismissed) {
        var n = nearbyFor(next, id);
        if (n && n.lidOpen)
            out[id] = true;
    }
    return out;
}

function inEarCount(d) {
    if (!d || !d.inEar)
        return 0;
    return (d.inEar.left === "ear" ? 1 : 0) + (d.inEar.right === "ear" ? 1 : 0);
}

// "pause" when an earbud came out of an ear, "resume" when one went back,
// "" otherwise; only for connected AirPods with the control channel and
// Automatic Ear Detection on.
function earAction(prevDevice, device) {
    if (!prevDevice || !device || !device.connected || !device.aap || device.earDetection === false)
        return "";
    if (prevDevice.address !== device.address || !prevDevice.aap)
        return "";
    var before = inEarCount(prevDevice), now = inEarCount(device);
    if (now < before)
        return "pause";
    if (now > before)
        return "resume";
    return "";
}

// The lowest level of the earbuds that are not charging, or -1.
function earbudsLevel(d) {
    if (!d || !d.battery)
        return -1;
    var levels = [];
    ["left", "right", "single"].forEach(function (k) {
        var v = d.battery[k];
        if (typeof v === "number" && v >= 0 && !(d.charging && d.charging[k]))
            levels.push(v);
    });
    return levels.length ? Math.min.apply(null, levels) : -1;
}

// The notification a battery change calls for, {title, body, level} or
// null: the earbuds' level went under 20, 10 or 5 percent.
function lowBattery(prevDevice, device) {
    if (!device || !device.connected || !device.aap)
        return null;
    var now = earbudsLevel(device), before = earbudsLevel(prevDevice);
    if (now < 0 || before < 0)
        return null;
    for (var i = LOW_LEVELS.length - 1; i >= 0; --i) {
        var t = LOW_LEVELS[i];
        if (now <= t && before > t)
            return { level: t, title: device.name + " battery low",
                     body: Math.round(now) + "% remaining. Put them in the case to charge." };
    }
    return null;
}
