// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Which apps are offered on this device (docs/APP-STORE.md 3.17): its
// device class (phone, tablet, desktop: the shell's layout), each app's
// kind (phoenix, legacy, web, native, local) and the classes it is made for
// (deviceClasses), the switches of the catalog the device ships with (its
// signed index's "availability": what is off where, by kind and by feed;
// they apply to every feed on the device), another catalog's switches for
// its own apps, the device's sources file (each source's deviceClasses),
// and the kinds the user hid here. The lists are availability.json, which
// the catalog (server/marketplace) reads too.

"use strict";

var LISTS = require("./availability.json");

function ids(list) { return list.map(function (x) { return x.id; }); }
var CLASSES = ids(LISTS.deviceClasses);
var KINDS = ids(LISTS.appKinds);
var FEEDS = ids(LISTS.feeds);
var PHOENIX_ID = /^(org|com)\.webosphoenix\./;

function find(list, id) { return list.filter(function (x) { return x.id === id; })[0] || null; }
function plural(cls) { var c = find(LISTS.deviceClasses, cls); return c ? c.plural : cls + "s"; }
function kindLower(kind) { var k = find(LISTS.appKinds, kind); return k ? k.lower : kind + " apps"; }
function feedLower(feed) { var f = find(LISTS.feeds, feed); return f ? f.lower : feed; }
function and(words) {
    return words.length < 2 ? words.join("") : words.slice(0, -1).join(", ") + " and " + words[words.length - 1];
}

// A list of device classes as an index, a package or a sources file says
// it: the known ones, in the list's order; null for all (missing, not a
// list, or none known: a class this device does not know is no reason to
// hide an app).
function classesOf(v) {
    if (!Array.isArray(v)) return null;
    var out = CLASSES.filter(function (c) { return v.indexOf(c) >= 0; });
    return out.length ? out : null;
}

// An index's "availability": the classes each kind and each feed is off
// for ({kinds: {legacy: ["phone"]}, feeds: {appmuseum: ["phone"]}}); a
// kind, feed or class this device does not know is left out.
function normalize(av) {
    var off = av && typeof av === "object" && av.off && typeof av.off === "object" ? av.off : {};
    function part(o, known) {
        var out = {};
        if (!o || typeof o !== "object" || Array.isArray(o)) return out;
        Object.keys(o).forEach(function (k) {
            if (known.indexOf(k) < 0 || !Array.isArray(o[k])) return;
            var cls = CLASSES.filter(function (c) { return o[k].indexOf(c) >= 0; });
            if (cls.length) out[k] = cls;
        });
        return out;
    }
    return { off: { kinds: part(off.kinds, KINDS), feeds: part(off.feeds, FEEDS) } };
}

// An entry's kind: the index's, else (a catalog from before 3.17, or an
// entry the device makes: the App Museum's, Preware's) by where it comes from.
function kindOf(e) {
    if (e && typeof e.appKind === "string" && KINDS.indexOf(e.appKind) >= 0) return e.appKind;
    if (!e) return "web";
    if (e.kind === "classic" || e.kind === "preware") return "legacy";
    if (e.kind === "pwa") return "web";
    if (PHOENIX_ID.test(e.id || "")) return "phoenix";
    if (e.kind === "connector") return "native";
    return "web";
}

// The feed an entry comes from.
function feedOf(e) {
    return e.kind === "classic" ? "appmuseum" : e.kind === "preware" ? "preware" : e.kind === "connector" ? "connectors" : "catalog";
}

// The original devices' names (the App Museum's flags, Preware's
// DeviceCompatibility) as device classes: the Pre, Pixi and Veer were
// phones, the TouchPad a tablet; LuneOS and the rest say nothing of a
// class. null: all.
var LEGACY = { pixi: "phone", "pixi plus": "phone", pre: "phone", "pre plus": "phone", pre2: "phone", "pre 2": "phone",
               pre3: "phone", "pre 3": "phone", veer: "phone", touchpad: "tablet", "touchpad go": "tablet" };
function classesFromDevices(list) {
    if (!Array.isArray(list)) return null;
    var seen = [];
    list.forEach(function (d) {
        var c = LEGACY[String(d).toLowerCase()];
        if (c && seen.indexOf(c) < 0) seen.push(c);
    });
    return classesOf(seen);
}

// Why an entry is not offered on this device, or null.
// ctx: {deviceClass ("" when the device has not said: everything is
// offered), hidden (kinds the user hid here), policy (the off lists of the
// catalog the device ships with, for every feed), own (those of the entry's
// own catalog, for its own apps), sourceClasses (its source's deviceClasses,
// from the sources file; null: all), sourceName}.
function offFor(e, ctx) {
    ctx = ctx || {};
    var kind = kindOf(e), cls = ctx.deviceClass || "";
    if ((ctx.hidden || []).indexOf(kind) >= 0)
        return { reason: "hidden", text: "You hid " + kindLower(kind) + " on this device (Catalogs > Kinds of Apps)" };
    if (!cls) return null;
    var feed = feedOf(e);
    if (ctx.sourceClasses && ctx.sourceClasses.indexOf(cls) < 0)
        return { reason: "feed", text: (ctx.sourceName || "This catalog") + " is not offered on " + plural(cls) };
    var offs = [ctx.policy, ctx.own].filter(Boolean);
    for (var i = 0; i < offs.length; i++) {
        if ((offs[i].off.feeds[feed] || []).indexOf(cls) >= 0)
            return { reason: "feed", text: "The Marketplace does not offer " + feedLower(feed) + " on " + plural(cls) };
    }
    for (var j = 0; j < offs.length; j++) {
        if ((offs[j].off.kinds[kind] || []).indexOf(cls) >= 0)
            return { reason: "kind", text: "The Marketplace does not offer " + kindLower(kind) + " on " + plural(cls) };
    }
    var dc = classesOf(e.deviceClasses);
    if (dc && dc.indexOf(cls) < 0)
        return { reason: "app", text: "Not offered on " + plural(cls) + ": made for " + and(dc.map(plural)) };
    return null;
}

module.exports = {
    LISTS: LISTS, CLASSES: CLASSES, KINDS: KINDS, FEEDS: FEEDS,
    classesOf: classesOf, classesFromDevices: classesFromDevices, normalize: normalize, kindOf: kindOf, feedOf: feedOf,
    offFor: offFor, plural: plural, kindLower: kindLower, feedLower: feedLower
};
