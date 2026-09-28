// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Desktop window source: stands in for the compositor so the shell can be
// developed and screenshot-tested without a webOS device.
//
// Window source interface used by Phoenix.Shell:
//   apps          ListModel  appId, title, color, glyph, tab, quickLaunch
//   cards         ListModel  uid, appId, title, groupId  (running windows in
//                            screen order; consecutive cards with the same
//                            groupId form a card stack)
//   windowFor(uid) -> Item   the app surface to show inside the card
//   launch(appId, afterUid) -> uid   new apps start a stack right of afterUid's
//   close(uid)
//   back(uid)                deliver the back gesture to the app
//   moveCard(from, to)       reorder (indices into cards)
//   setCardGroup(uid, groupId), newGroupId()
//   cardFocusRequested(uid)  signal: show this card maximized (e.g. a new
//                            child window opened by an app)
//   notifications ListModel  id, appId, title, body, color, glyph
//   cardCloseRequested(uid)  signal: a window asked to close (window.close())
//
// Web apps (the original webOS apps, Settings, ...) come from the virtual
// webOS filesystem when phoenix-sim was built with Qt WebEngine; they
// replace the placeholder app with the same title.

import QtQuick

Item {
    id: source
    visible: false

    property ListModel apps: ListModel {}

    // Stand-ins for apps that are not built yet.
    property ListModel placeholders: ListModel {
        // tab: 0 = apps, 1 = downloads, 2 = settings
        // (conf/default-launcher-page-layout.json)
        ListElement { appId: "org.webosphoenix.phone";     title: "Phone";      color: "#3fae49"; glyph: "☎"; tab: 0; quickLaunch: 1; icon: "" }
        ListElement { appId: "org.webosphoenix.email";     title: "Email";      color: "#2f7fd1"; glyph: "@";      tab: 0; quickLaunch: 2; icon: "" }
        ListElement { appId: "org.webosphoenix.messaging"; title: "Messaging";  color: "#5aa7e8"; glyph: "✉"; tab: 0; quickLaunch: 3; icon: "" }
        ListElement { appId: "org.webosphoenix.calendar";  title: "Calendar";   color: "#d8453c"; glyph: "31";     tab: 0; quickLaunch: 4; icon: "" }
        ListElement { appId: "org.webosphoenix.browser";   title: "Web";        color: "#2a9bbd"; glyph: "◎"; tab: 0; quickLaunch: 0; icon: "" }
        ListElement { appId: "org.webosphoenix.contacts";  title: "Contacts";   color: "#8a6d4e"; glyph: "☺"; tab: 0; quickLaunch: 0; icon: "" }
        ListElement { appId: "org.webosphoenix.photos";    title: "Photos";     color: "#e0a23a"; glyph: "▣"; tab: 0; quickLaunch: 0; icon: "" }
        ListElement { appId: "org.webosphoenix.music";     title: "Music";      color: "#9b59b6"; glyph: "♫"; tab: 0; quickLaunch: 0; icon: "" }
        ListElement { appId: "org.webosphoenix.camera";    title: "Camera";     color: "#555c66"; glyph: "◉"; tab: 0; quickLaunch: 0; icon: "" }
        ListElement { appId: "org.webosphoenix.maps";      title: "Maps";       color: "#4caf50"; glyph: "⚑"; tab: 0; quickLaunch: 0; icon: "" }
        ListElement { appId: "org.webosphoenix.memos";     title: "Memos";      color: "#e8c93a"; glyph: "✎"; tab: 0; quickLaunch: 0; icon: "" }
        ListElement { appId: "org.webosphoenix.clock";     title: "Clock";      color: "#34495e"; glyph: "◷"; tab: 0; quickLaunch: 0; icon: "" }
        ListElement { appId: "org.webosphoenix.appstore";  title: "App Museum"; color: "#c0392b"; glyph: "★"; tab: 1; quickLaunch: 0; icon: "" }
        ListElement { appId: "org.webosphoenix.wifi";      title: "Wi-Fi";      color: "#607d8b"; glyph: "≈"; tab: 2; quickLaunch: 0; icon: "" }
        ListElement { appId: "org.webosphoenix.bluetooth"; title: "Bluetooth";  color: "#3f51b5"; glyph: "B";      tab: 2; quickLaunch: 0; icon: "" }
        ListElement { appId: "org.webosphoenix.screen";    title: "Screen & Lock"; color: "#795548"; glyph: "□"; tab: 2; quickLaunch: 0; icon: "" }
        ListElement { appId: "org.webosphoenix.deviceinfo"; title: "Device Info"; color: "#9e9e9e"; glyph: "i";     tab: 2; quickLaunch: 0; icon: "" }
    }

    property ListModel cards: ListModel {}
    property ListModel notifications: ListModel {}

    signal cardFocusRequested(string uid)
    signal cardCloseRequested(string uid)

    // Quick launch slots for web apps, by title.
    readonly property var webQuickLaunch: ({ "Email": 2, "Calendar": 4 })

    Component.onCompleted: {
        var web = (typeof simWebEngine !== "undefined" && simWebEngine && typeof simWebApps !== "undefined") ? simWebApps : [];
        var titles = {};
        for (var i = 0; i < web.length; ++i) {
            var a = web[i];
            titles[a.title] = true;
            apps.append({ appId: a.id, title: a.title, color: "#555c66", glyph: a.title.charAt(0),
                          tab: a.tab !== undefined ? a.tab : 0, quickLaunch: webQuickLaunch[a.title] || 0,
                          icon: a.icon, web: true, main: a.main, noWindow: !!a.noWindow });
        }
        for (i = 0; i < placeholders.count; ++i) {
            var p = placeholders.get(i);
            if (titles[p.title])
                continue;
            apps.append({ appId: p.appId, title: p.title, color: p.color, glyph: p.glyph, tab: p.tab,
                          quickLaunch: p.quickLaunch, icon: p.icon, web: false, main: "", noWindow: false });
        }
    }

    function appIdByTitle(titleText) {
        for (var i = 0; i < apps.count; ++i)
            if (apps.get(i).title === titleText)
                return apps.get(i).appId;
        return "";
    }

    property var _windows: ({})
    property int _nextUid: 1
    property int _nextGroup: 1

    function newGroupId() {
        return "g" + (_nextGroup++);
    }

    function appInfo(appId) {
        for (var i = 0; i < apps.count; ++i)
            if (apps.get(i).appId === appId)
                return apps.get(i);
        return null;
    }

    function cardIndex(uid) {
        for (var i = 0; i < cards.count; ++i)
            if (cards.get(i).uid === uid)
                return i;
        return -1;
    }

    function runningUid(appId) {
        for (var i = 0; i < cards.count; ++i)
            if (cards.get(i).appId === appId)
                return cards.get(i).uid;
        return "";
    }

    function windowFor(uid) {
        return _windows[uid] || null;
    }

    // Index just past the stack that contains uid (or the end).
    function _afterGroupOf(uid) {
        var i = cardIndex(uid);
        if (i < 0)
            return cards.count;
        var gid = cards.get(i).groupId;
        while (i < cards.count && cards.get(i).groupId === gid)
            ++i;
        return i;
    }

    function _createWindow(appId, titleText, at, groupId, openRequest) {
        var info = appInfo(appId);
        var uid = "w" + (_nextUid++);
        var win;
        if (info.web) {
            win = _webWindow(appId, openRequest ? "" : info.main, uid);
            if (openRequest)
                win.adopt(openRequest);
        } else {
            win = mockApp.createObject(source, {
                appId: appId, title: titleText, accent: info.color, glyph: info.glyph
            });
            win.newCardRequested.connect(function() { source.openChild(uid); });
        }
        _windows[uid] = win;
        cards.insert(at, { uid: uid, appId: appId, title: titleText, groupId: groupId });
        return uid;
    }

    // ---- Web apps --------------------------------------------------------------

    property var _headless: ({})     // appId -> hidden main page of a noWindow app
    property Component _webComponent: null

    function _webWindow(appId, url, uid) {
        if (!_webComponent)
            _webComponent = Qt.createComponent("WebAppWindow.qml");
        var win = _webComponent.createObject(source, { appId: appId, url: url });
        if (!win) {
            console.warn("phoenix-sim: cannot create web window:", _webComponent.errorString());
            return mockApp.createObject(source, { appId: appId, title: appId });
        }
        win.hostMessage.connect(function(type, payload) { source._hostMessage(appId, uid, type, payload); });
        win.windowRequested.connect(function(request) { source._openWindow(appId, request); });
        if (uid !== "")
            win.closeRequested.connect(function() { source.cardCloseRequested(uid); });
        return win;
    }

    // A page opened a window: it becomes a card in its app's stack, or the
    // app's first card if it has none yet (headless apps).
    function _openWindow(appId, request) {
        var info = appInfo(appId);
        var existing = runningUid(appId);
        var uid;
        if (existing !== "")
            uid = _createWindow(appId, info.title, _afterGroupOf(existing), cards.get(cardIndex(existing)).groupId, request);
        else
            uid = _createWindow(appId, info.title, cards.count, newGroupId(), request);
        cardFocusRequested(uid);
    }

    function _hostMessage(appId, uid, type, payload) {
        if (type === "launch" && payload.id) {
            var launched = launch(payload.id, uid);
            if (launched !== "")
                cardFocusRequested(launched);
        } else if (type === "banner") {
            var info = appInfo(appId);
            notify(appId, info ? info.title : appId, payload.message || "");
        }
    }

    // Launch or re-focus an app. A new app starts its own stack to the right
    // of the stack holding `afterUid` (CardWindowManager.cpp:556-599).
    function launch(appId, afterUid) {
        var existing = runningUid(appId);
        if (existing !== "")
            return existing;
        var info = appInfo(appId);
        if (!info)
            return "";
        if (info.web && info.noWindow) {
            // Headless app: its page runs hidden and opens card windows itself.
            if (!_headless[appId])
                _headless[appId] = _webWindow(appId, info.main, "");
            return "";
        }
        var at = afterUid ? _afterGroupOf(afterUid) : cards.count;
        return _createWindow(appId, info.title, at, newGroupId());
    }

    // A second window from the same app (e.g. an email compose card). It
    // joins the front of its parent's stack and is shown maximized.
    function openChild(parentUid) {
        var i = cardIndex(parentUid);
        if (i < 0)
            return "";
        var parent = cards.get(i);
        var info = appInfo(parent.appId);
        var uid = _createWindow(parent.appId, "New " + info.title, _afterGroupOf(parentUid), parent.groupId);
        cardFocusRequested(uid);
        return uid;
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
        var i = cardIndex(uid);
        if (i < 0)
            return;
        var appId = cards.get(i).appId;
        cards.remove(i);
        var win = _windows[uid];
        delete _windows[uid];
        if (win)
            win.destroy();
        // Closing a headless app's last card closes the app.
        if (_headless[appId] && runningUid(appId) === "") {
            _headless[appId].destroy();
            delete _headless[appId];
        }
    }

    function back(uid) {
        var win = _windows[uid];
        return win ? win.back() : false;
    }

    function notify(appId, titleText, body) {
        var info = appInfo(appId) || { color: "#666666", glyph: "!" };
        notifications.append({
            id: "n" + Date.now() + "_" + notifications.count,
            appId: appId, title: titleText, body: body,
            color: info.color, glyph: info.glyph
        });
    }

    function dismissNotification(index) {
        if (index >= 0 && index < notifications.count)
            notifications.remove(index);
    }

    Component {
        id: mockApp
        MockApp {}
    }
}
