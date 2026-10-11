// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Notifications stacked as layers, the way webOS's dashboards held them
// (Enyo 1.0 enyo.Dashboard, framework/source/palm/system/Dashboard.js:1-19,
// 77-94): an app's notifications of one group (a conversation, an account,
// the missed calls) are one row of the notification area, a stack of
// layers {title, text} with the newest on top; the row shows the top
// layer, a push puts a layer on top, a pop takes the top one away, and an
// empty stack is no row at all. Email kept one per account and one for
// "All Inboxes" (Dashboard.js:15-17); Calendar one for all its reminders
// (ReminderManager.js:694-722). A notification without a group is a stack
// of its own, as before.
//
// Both window sources keep their notifications ListModel with these, so the
// simulator and the device hold the same rows. A row (Notifications.qml's
// model) adds to its fields:
//   group       the app's group key ("" for none): same app + same group =
//               one stack
//   layerCount  how many layers (1 for a plain notification)
//   layers      JSON: [{id, title, body, params, tag, actions, time}], oldest
//               first; the row's own title, body, params, tag and actions
//               are the top (last) layer's, so whatever reads a row (a tap,
//               the lock screen, the keyboard) has the top layer
// Pure functions over a ListModel (count, get, set, append, remove), so the
// sources and the tests share them.

.pragma library

// The layer a notification makes. params and actions: strings (JSON or "");
// time: when it came (ms), for what reads the list (NotificationFeed.qml).
function layer(id, title, body, params, tag, actions, time) {
    return {
        id: String(id || ""),
        title: String(title || ""),
        body: String(body || ""),
        params: typeof params === "string" ? params : "",
        tag: String(tag || ""),
        actions: typeof actions === "string" ? actions : "",
        time: Number(time) || 0
    };
}

// A row's layers, oldest first: its own JSON, else the row itself as the
// one layer (a dashboard window, a live activity, a row from before).
function layersOf(row) {
    if (row && typeof row.layers === "string" && row.layers !== "") {
        try {
            var a = JSON.parse(row.layers);
            if (Array.isArray(a) && a.length > 0)
                return a;
        } catch (e) {
            // fall through: the row itself
        }
    }
    return [layer(row ? row.id : "", row ? row.title : "", row ? row.body : "",
                  row ? row.params : "", row ? row.tag : "", row ? row.actions : "", row ? row.time : 0)];
}

// The row's fields for these layers: the top layer's, the count, the JSON.
function topFields(layers) {
    var top = layers[layers.length - 1];
    return {
        title: top.title,
        body: top.body,
        params: top.params,
        tag: top.tag,
        actions: top.actions,
        time: Number(top.time) || 0,
        layerCount: layers.length,
        layers: JSON.stringify(layers)
    };
}

// The app's stack of this group: a notification row (not a dashboard window
// or a live activity), or -1.
function find(model, appId, group) {
    if (!group)
        return -1;
    for (var i = 0; i < model.count; ++i) {
        var n = model.get(i);
        if (n.appId === appId && n.group === group && !n.ongoing && !n.windowKey)
            return i;
    }
    return -1;
}

// A notification: `row` is the new row's fields (id, appId, color, glyph,
// icon, ..., and title, body, params, tag, actions), `group` its group.
// With a group the app has a stack of, the notification is pushed on it as
// its top layer (Dashboard.push, :77-83; the row stays where it is, as a
// dashboard window did); otherwise a new row. Returns the row's index.
function push(model, row, group) {
    var l = layer(row.id, row.title, row.body, row.params, row.tag, row.actions, row.time);
    var at = find(model, row.appId, group || "");
    if (at >= 0) {
        model.set(at, topFields(layersOf(model.get(at)).concat([l])));
        return at;
    }
    var fields = {};
    for (var k in row)
        fields[k] = row[k];
    fields.group = String(group || "");
    var top = topFields([l]);
    for (k in top)
        fields[k] = top[k];
    model.append(fields);
    return model.count - 1;
}

// Keep the layers `keep` says to in the row at `index`: the row goes when
// none is left, and shows its new top layer otherwise. Returns whether it
// changed.
function _filter(model, index, keep) {
    var row = model.get(index);
    var layers = layersOf(row);
    var left = layers.filter(keep);
    if (left.length === layers.length)
        return false;
    if (left.length === 0)
        model.remove(index);
    else
        model.set(index, topFields(left));
    return true;
}

// The app's notifications of this tag (prefix: every tag starting with it)
// taken away, from whichever stack holds them.
function removeTagged(model, appId, tag, prefix) {
    tag = String(tag || "");
    if (tag === "")
        return;
    for (var i = model.count - 1; i >= 0; --i) {
        var n = model.get(i);
        if (n.appId !== appId || n.ongoing || n.windowKey)
            continue;
        _filter(model, i, function (l) {
            return !(prefix ? l.tag !== "" && l.tag.indexOf(tag) === 0 : l.tag === tag);
        });
    }
}

// The app's stack of this group taken away at once (the app read it: the
// original apps emptied their dashboard's layers, setLayers([]), and an
// empty stack closed it, Dashboard.js:90-94, 115-120).
function removeGroup(model, appId, group) {
    var at = find(model, appId, group);
    if (at >= 0)
        model.remove(at);
    return at >= 0;
}

// The top layer of the row at `index` swiped away: the next one shows
// (DashboardContent.layerSwiped, DashboardContent.js:51-64); the last one
// takes the row with it. Returns whether the row went.
function pop(model, index) {
    if (index < 0 || index >= model.count)
        return false;
    var layers = layersOf(model.get(index));
    if (layers.length <= 1) {
        model.remove(index);
        return true;
    }
    model.set(index, topFields(layers.slice(0, layers.length - 1)));
    return false;
}

// The count a stack shows, for text: "3 New Messages" and the like.
function countOf(row) {
    return row && row.layerCount > 1 ? row.layerCount : 1;
}
