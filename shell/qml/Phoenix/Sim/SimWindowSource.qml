// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Desktop window source: stands in for the compositor so the shell can be
// developed and screenshot-tested without a webOS device.
//
// Window source interface used by Phoenix.Shell:
//   apps          ListModel  appId, title, color, glyph, tab, quickLaunch
//   cards         ListModel  uid, appId, title       (running apps, in card order)
//   windowFor(uid) -> Item   the app surface to show inside the card
//   launch(appId, afterUid) -> uid
//   close(uid)
//   back(uid)                deliver the back gesture to the app
//   notifications ListModel  id, appId, title, body, color, glyph

import QtQuick

Item {
    id: source
    visible: false

    property ListModel apps: ListModel {
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

    property var _windows: ({})
    property int _nextUid: 1

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

    // Launch or re-focus an app. New cards are inserted to the right of
    // `afterUid` (CardWindowManager inserts next to the active group).
    function launch(appId, afterUid) {
        var existing = runningUid(appId);
        if (existing !== "")
            return existing;
        var info = appInfo(appId);
        if (!info)
            return "";
        var uid = "w" + (_nextUid++);
        var win = mockApp.createObject(source, {
            appId: appId, title: info.title, accent: info.color, glyph: info.glyph
        });
        _windows[uid] = win;
        var at = afterUid ? cardIndex(afterUid) + 1 : cards.count;
        if (at <= 0 || at > cards.count)
            at = cards.count;
        cards.insert(at, { uid: uid, appId: appId, title: info.title });
        return uid;
    }

    function close(uid) {
        var i = cardIndex(uid);
        if (i < 0)
            return;
        cards.remove(i);
        var win = _windows[uid];
        delete _windows[uid];
        if (win)
            win.destroy();
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
