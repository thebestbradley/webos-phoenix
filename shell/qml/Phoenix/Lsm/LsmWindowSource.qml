// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Window source backed by webOS OSE's luna-surfacemanager: card-type app
// surfaces become Phoenix cards, launch points become launcher icons.
// Implements the same interface as Phoenix.Sim.SimWindowSource.
//
// STATUS: experimental. Written against luna-surfacemanager 2.0.0-423
// (webOS OSE, Qt 6.8); it has not yet run on a device. See docs/ROADMAP.md.

import QtQuick
import WebOSCoreCompositor 1.0
import WebOSCompositorBase 1.0
import WebOSServices 1.0
import WebOS.Global 1.0
import Phoenix.Native

Item {
    id: source
    visible: false

    property ListModel apps: ListModel {}
    property ListModel cards: ListModel {}
    property ListModel notifications: ListModel {}

    // The shell connects to this to maximize a newly mapped card.
    signal cardFocusRequested(string uid)

    property var _hosts: ({})       // uid -> SurfaceHost
    property var _surfaces: []      // [{ uid, item }]
    property int _nextUid: 1
    property int _nextGroup: 1
    property string _pendingAfterUid: ""

    function newGroupId() {
        return "g" + (_nextGroup++);
    }

    // Index just past the stack that holds card index i.
    function _groupEnd(i) {
        var gid = cards.get(i).groupId;
        while (i < cards.count && cards.get(i).groupId === gid)
            ++i;
        return i;
    }

    // ---- Apps ------------------------------------------------------------------

    LaunchPointsModel {
        id: launchPoints
        appId: LS.appId
    }

    // Copy launch points into a plain ListModel the shell can read with get().
    Instantiator {
        id: launchPointCopies
        model: launchPoints
        delegate: QtObject {
            required property string id
            required property string title
            required property string icon
        }
        onObjectAdded: rebuildApps.restart()
        onObjectRemoved: rebuildApps.restart()
    }

    Timer {
        id: rebuildApps
        interval: 0
        onTriggered: {
            source.apps.clear();
            for (var i = 0; i < launchPointCopies.count; ++i) {
                var lp = launchPointCopies.objectAt(i);
                if (!lp)
                    continue;
                source.apps.append({
                    appId: lp.id, title: lp.title, icon: lp.icon,
                    color: "#666666", glyph: lp.title.charAt(0),
                    tab: 0, quickLaunch: i < 4 ? i + 1 : 0
                });
            }
        }
    }

    // ---- Surfaces ------------------------------------------------------------------

    function isCard(item) {
        return item && !item.isProxy() && !item.isPartOfGroup()
               && item.type === "_WEBOS_WINDOW_TYPE_CARD"
               && item.displayAffinity === compositorWindow.displayId;
    }

    function uidOf(item) {
        for (var i = 0; i < _surfaces.length; ++i)
            if (_surfaces[i].item === item)
                return _surfaces[i].uid;
        return "";
    }

    function cardIndex(uid) {
        for (var i = 0; i < cards.count; ++i)
            if (cards.get(i).uid === uid)
                return i;
        return -1;
    }

    function addSurface(item) {
        if (!isCard(item) || uidOf(item) !== "")
            return;
        var uid = "s" + (_nextUid++);
        _surfaces.push({ uid: uid, item: item });
        _hosts[uid] = hostComponent.createObject(source, { surface: item });
        item.state = Qt.WindowFullScreen;
        // A further window of an app that already has a card joins that
        // card's stack; anything else starts a new stack to the right of the
        // active one (CardWindowManager.cpp:556-599).
        var sibling = cardIndex(runningUid(item.appId));
        var at, groupId;
        if (sibling >= 0) {
            at = _groupEnd(sibling);
            groupId = cards.get(sibling).groupId;
        } else {
            var after = cardIndex(_pendingAfterUid);
            at = after >= 0 ? _groupEnd(after) : cards.count;
            groupId = newGroupId();
        }
        cards.insert(at, { uid: uid, appId: item.appId, title: item.title || item.appId, groupId: groupId });
        _pendingAfterUid = "";
        cardFocusRequested(uid);
    }

    function removeSurface(item) {
        var uid = uidOf(item);
        if (uid === "")
            return;
        _surfaces = _surfaces.filter(function(s) { return s.uid !== uid; });
        var i = cardIndex(uid);
        if (i >= 0)
            cards.remove(i);
        var host = _hosts[uid];
        delete _hosts[uid];
        if (host) {
            if (item.parent === host)
                item.parent = null;
            host.destroy();
        }
    }

    Connections {
        target: compositor
        function onSurfaceMapped(item) { source.addSurface(item); }
        function onSurfaceUnmapped(item) { source.removeSurface(item); }
        function onSurfaceDestroyed(item) { source.removeSurface(item); }
    }

    Component {
        id: hostComponent
        SurfaceHost {}
    }

    // ---- Window source interface ------------------------------------------------------

    function windowFor(uid) {
        return _hosts[uid] || null;
    }

    function runningUid(appId) {
        for (var i = 0; i < cards.count; ++i)
            if (cards.get(i).appId === appId)
                return cards.get(i).uid;
        return "";
    }

    // Launching is asynchronous: the card appears when the surface maps and
    // cardFocusRequested() fires. Returns the uid only if already running.
    // params: launch params (a tapped notification's); SAM relaunches a
    // running app with them.
    function launch(appId, afterUid, params) {
        var running = runningUid(appId);
        if (running !== "" && !params)
            return running;
        _pendingAfterUid = afterUid || "";
        LS.adhoc.call("luna://com.webos.applicationManager", "/launch",
                      JSON.stringify({ id: appId, params: params || {} }));
        return running;
    }

    function moveCard(from, to) {
        if (from !== to && from >= 0 && to >= 0 && from < cards.count && to < cards.count)
            cards.move(from, to, 1);
    }

    function setCardGroup(uid, groupId) {
        var i = cardIndex(uid);
        if (i >= 0)
            cards.setProperty(i, "groupId", groupId);
    }

    function close(uid) {
        for (var i = 0; i < _surfaces.length; ++i)
            if (_surfaces[i].uid === uid) {
                _surfaces[i].item.close();
                return;
            }
    }

    // One reply from a service on the bus: lunaCall(uri, params, callback);
    // callback(null) when the call cannot be made. The lock screen asks
    // com.palm.systemmanager for the device lock through this.
    Service {
        id: lunaBus
        appId: LS.appId
        property var pending: ({})
        onResponse: (method, payload, token) => {
            var cb = pending[token];
            if (!cb)
                return;
            delete pending[token];
            var r = null;
            try { r = JSON.parse(payload); } catch (e) { /* not JSON */ }
            cb(r);
        }
    }
    function lunaCall(uri, params, callback) {
        var m = /^(?:palm|luna):\/\/([^\/]+)(\/.*)$/.exec(uri);
        var token = m ? lunaBus.call("luna://" + m[1], m[2], JSON.stringify(params || {})) : 0;
        if (token > 0)
            lunaBus.pending[token] = callback;
        else
            callback(null);
    }

    // The back gesture is the webOS Back key, delivered to the card's
    // surface, which forwards it to the app by its native scan code
    // (WebOSSurfaceItem::processKeyEvent). webOS reads evdev 412 as Back;
    // on the wire that is XKB keycode 412 + 8. Web apps get it as keyCode
    // 461, Enyo 1.0 and Mojo apps as their back event.
    readonly property int backScanCode: 412 + 8
    function back(uid) {
        for (var i = 0; i < _surfaces.length; ++i)
            if (_surfaces[i].uid === uid)
                return KeyInjector.sendKey(_surfaces[i].item, WebOS.Key_webOS_Back, backScanCode);
        return false;
    }

    function notify(appId, title, body, params) {
        notifications.append({ id: "n" + Date.now(), appId: appId, title: title, body: body || "",
                               color: "#666666", glyph: "!", icon: "", params: params ? JSON.stringify(params) : "",
                               windowKey: "", clickableWhenLocked: false });
    }

    function dismissNotification(index) {
        if (index >= 0 && index < notifications.count)
            notifications.remove(index);
    }
}
