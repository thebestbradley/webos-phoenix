// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the notification list holds, for the services that read it, and
// each new one, for the Assistant to announce (docs/AI-AND-MCP.md,
// "Everyday features").
//
//   - The list: the window source's notifications (the dashboard), newest
//     first, as {id, appId, app, title, body, time, ongoing}, with whether
//     the lock screen is up and whether it shows previews (Settings > Screen
//     & Lock > Show previews), given to the source's publishNotifications:
//     the simulator's pages answer org.webosphoenix.system getNotifications
//     from it (runtime/phoenix-runtime.js), a device's shellhost does
//     (services/shellhost). The Assistant's "what did I miss" reads it.
//     A dashboard window's words are what its page put in it
//     (dashboardTitle, dashboardBody: the runtime reads its
//     .dashboard-title and .palm-dashboard-text, enyo DashboardContent.js:183-185).
//   - Each notification that comes: org.webosphoenix.assistant announce
//     {appId, app, title, body, headphones, time}. The service decides
//     (driving mode, or "announce messages" with headphones in) and says
//     it; {listen: true} back (driving mode) asks for the reply by voice:
//     replyByVoice().
//
// headphones: a wired headset in, or a Bluetooth headset connected.

import QtQuick

QtObject {
    id: feed

    property var source: null
    property bool locked: false
    property bool previews: true
    property bool headphones: false
    // The newest are announced; none while the list is first read.
    property bool announcing: true

    signal replyByVoice(string threadId)

    readonly property var model: source && source.notifications ? source.notifications : null

    function _appTitle(appId) {
        var a = source && typeof source.appInfo === "function" ? source.appInfo(appId) : null;
        return a && a.title ? String(a.title) : "";
    }
    function _row(n) {
        var dash = n.windowKey !== undefined && n.windowKey !== "";
        var title = dash ? String(n.dashboardTitle || "") : String(n.title || "");
        var body = dash ? String(n.dashboardBody || "") : String(n.body || "");
        return { id: String(n.id || ""), appId: String(n.appId || ""), app: _appTitle(n.appId) || String(n.title || ""),
                 title: title, body: body, time: Number(n.time) || 0, ongoing: n.ongoing === true };
    }
    // Newest first (the list keeps them as they came, ongoing ones pinned at the top).
    function digest() {
        var out = [];
        for (var i = 0; model && i < model.count; ++i)
            out.push(_row(model.get(i)));
        out.sort(function (a, b) { return b.time - a.time; });
        return out;
    }
    function publish() {
        if (source && typeof source.publishNotifications === "function")
            source.publishNotifications({ notifications: digest(), locked: locked, previews: previews });
    }

    function announce(n) {
        if (!announcing || !source || typeof source.lunaCall !== "function" || n.ongoing)
            return;
        var r = _row(n);
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

    property Timer _later: Timer {
        interval: 100
        onTriggered: feed.publish()
    }
    function _changed() { _later.restart(); }
    onLockedChanged: _changed()
    onPreviewsChanged: _changed()
    onModelChanged: _changed()

    property Connections _rows: Connections {
        target: feed.model
        ignoreUnknownSignals: true
        function onRowsInserted(parent, first, last) {
            for (var i = first; i <= last; ++i)
                feed.announce(feed.model.get(i));
            feed._changed();
        }
        function onRowsRemoved() { feed._changed(); }
        function onDataChanged() { feed._changed(); }
        function onModelReset() { feed._changed(); }
    }
}
