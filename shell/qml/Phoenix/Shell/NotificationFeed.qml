// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the notification list holds, for the services that read it, and
// each new notification, for the Assistant to announce (docs/AI-AND-MCP.md,
// "Everyday features").
//
//   - The list: the window source's notifications (the dashboard), each
//     layer of a stack a notification of its own (NotificationStacks.js),
//     newest first, as {id, appId, app, title, body, time, ongoing}, with
//     whether the lock screen is up and whether it shows previews
//     (Settings > Screen & Lock > Show previews), given to the source's
//     publishNotifications: the simulator's pages answer
//     org.webosphoenix.system getNotifications from it
//     (runtime/phoenix-runtime.js), a device's shellhost does
//     (services/shellhost). The Assistant's "what did I miss" reads it.
//     A dashboard window's words are what its page put in it
//     (dashboardTitle, dashboardBody: the runtime reads its
//     .dashboard-title and .palm-dashboard-text, enyo DashboardContent.js:183-185).
//   - Each notification that comes (a new row, or a layer on a stack):
//     org.webosphoenix.assistant announce {appId, app, title, body,
//     headphones, time}. The service decides (driving mode, or "announce
//     messages" with headphones in) and says it; {listen: true} back
//     (driving mode) asks for the reply by voice: replyByVoice(threadId).
//     What the list held when the shell started is not announced.
//
// headphones: a wired headset in, or a Bluetooth headset connected.

import QtQuick
import "NotificationStacks.js" as Stacks

QtObject {
    id: feed

    property var source: null
    property bool locked: false
    property bool previews: true
    property bool headphones: false

    signal replyByVoice(string threadId)

    readonly property var model: source && source.notifications ? source.notifications : null

    function _appTitle(appId) {
        var a = source && typeof source.appInfo === "function" ? source.appInfo(appId) : null;
        return a && a.title ? String(a.title) : "";
    }
    // A row's notifications: each layer of its stack, or its window's words.
    function _rows(n) {
        var app = _appTitle(n.appId) || String(n.title || "");
        var base = { appId: String(n.appId || ""), app: app, ongoing: n.ongoing === true };
        if (n.windowKey !== undefined && n.windowKey !== "")
            return [Object.assign({ id: String(n.id || ""), title: String(n.dashboardTitle || ""), body: String(n.dashboardBody || ""),
                                    time: Number(n.time) || 0 }, base)];
        return Stacks.layersOf(n).map(function (l) {
            return Object.assign({ id: String(l.id || n.id || ""), title: String(l.title || ""), body: String(l.body || ""),
                                   time: Number(l.time) || Number(n.time) || 0 }, base);
        });
    }
    // Newest first.
    function digest() {
        var out = [];
        for (var i = 0; model && i < model.count; ++i)
            out = out.concat(_rows(model.get(i)));
        out.sort(function (a, b) { return b.time - a.time; });
        return out;
    }
    function publish() {
        if (source && typeof source.publishNotifications === "function")
            source.publishNotifications({ notifications: digest(), locked: locked, previews: previews });
    }

    function announce(r) {
        if (!source || typeof source.lunaCall !== "function" || r.ongoing)
            return;
        // The Assistant's own questions are its to say.
        if (r.appId === "org.webosphoenix.assistant" || (r.title === "" && r.body === ""))
            return;
        source.lunaCall("luna://org.webosphoenix.assistant/announce",
                        { appId: r.appId, app: r.app, title: r.title, body: r.body, time: r.time, headphones: headphones },
                        function (reply) {
                            if (reply && reply.returnValue !== false && reply.listen === true)
                                feed.replyByVoice(String(reply.threadId || ""));
                        });
    }

    // The notifications seen (by id): one not seen before is new.
    property var _seen: ({})
    property bool _primed: false
    function _update() {
        var list = digest(), seen = {}, fresh = [];
        for (var i = 0; i < list.length; ++i) {
            seen[list[i].id] = true;
            if (_primed && !_seen[list[i].id] && list[i].title + list[i].body !== "")
                fresh.push(list[i]);
        }
        // A dashboard's words come after its row: it is new once they do.
        for (var k in _seen)
            if (!seen[k]) delete _seen[k];
        for (i = 0; i < list.length; ++i)
            if (list[i].title + list[i].body !== "" || list[i].ongoing)
                _seen[list[i].id] = true;
        _primed = true;
        fresh.reverse().forEach(announce);
        publish();
    }

    property Timer _later: Timer {
        interval: 100
        onTriggered: feed._update()
    }
    function _changed() { _later.restart(); }
    onLockedChanged: _changed()
    onPreviewsChanged: _changed()
    onModelChanged: _changed()

    property Connections _watch: Connections {
        target: feed.model
        ignoreUnknownSignals: true
        function onRowsInserted() { feed._changed(); }
        function onRowsRemoved() { feed._changed(); }
        function onDataChanged() { feed._changed(); }
        function onModelReset() { feed._changed(); }
    }
    Component.onCompleted: _update()
}
