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
//   notifications ListModel  id, appId, title, body, color, glyph, icon
//   cardCloseRequested(uid)  signal: a window asked to close (window.close())
//
// Optional (the shell has a built-in fallback without them):
//   justTypeWindow() -> Item  the Just Type search surface, or null
//   justTypeStart(text)      show it with this text typed
//   justTypeStop()           it was dismissed; clear it
//   justTypeDismissed        signal: it launched something; close it
//   appMenu(uid)             the user tapped the app name: open its app menu
//
// Simulator only (sim.qml wires these to SimSystemStatus and the shell):
//   systemStatusReported(status)  signal: a web page reported the device
//                            state (radios, brightness, ...; see hostStatus()
//                            in runtime/phoenix-runtime.js), with wallpaperUrl
//                            resolved to a local file
//   pushSystemStatus(changes)     tell the web pages what the user changed
//                            in the system menu (only the changed keys)
//   simulateIncomingCall()   ring the Phone app (phoenix-sim F4)
//   simulateIncomingSms()    deliver a text to Messaging (phoenix-sim F5)
//   openUrl(url)             open a web page in the browser (phoenix-sim --open)
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

    // Quick launch slots for web apps: appinfo.json "phoenix.quickLaunch"
    // (Phone 1, Messaging 3), else by title for the original apps.
    readonly property var webQuickLaunch: ({ "Email": 2, "Calendar": 4 })

    Component.onCompleted: {
        var web = (typeof simWebEngine !== "undefined" && simWebEngine && typeof simWebApps !== "undefined") ? simWebApps : [];
        var titles = {};
        for (var i = 0; i < web.length; ++i) {
            var a = web[i];
            titles[a.title] = true;
            // Launch points (appinfo.json phoenix.launchPoints) are entries of
            // their own: own icon, title, card and launch params.
            apps.append({ appId: a.id, title: a.title, color: "#555c66", glyph: a.title.charAt(0),
                          tab: a.tab !== undefined ? a.tab : 0, quickLaunch: a.quickLaunch || webQuickLaunch[a.title] || 0,
                          icon: a.icon, web: true, main: a.main, noWindow: !!a.noWindow,
                          webAppId: a.appId || a.id, params: a.params || "", dir: a.dir || "" });
        }
        for (i = 0; i < placeholders.count; ++i) {
            var p = placeholders.get(i);
            if (titles[p.title])
                continue;
            apps.append({ appId: p.appId, title: p.title, color: p.color, glyph: p.glyph, tab: p.tab,
                          quickLaunch: p.quickLaunch, icon: p.icon, web: false, main: "", noWindow: false,
                          webAppId: "", params: "", dir: "" });
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

    // url: page to load instead of the app's main page (launch params).
    function _createWindow(appId, titleText, at, groupId, openRequest, url) {
        var info = appInfo(appId);
        var uid = "w" + (_nextUid++);
        var win;
        if (info.web) {
            win = _webWindow(appId, openRequest ? "" : (url || info.main), uid);
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
        if (win.loaded)
            win.loaded.connect(function() { source._pageLoaded(win); });
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
        if (appId === justTypeAppId && (type === "launch" || type === "open"))
            Qt.callLater(source.justTypeDismissed);
        if (type === "launch" && payload.id) {
            // A launch point whose params match wins (e.g. {id: settings,
            // params: {page: "wifi"}} opens the Wi-Fi card).
            var params = payload.params || {};
            var target = _launchTarget(payload.id, params);
            var running = runningUid(target);
            if (running !== "") {
                if (target === payload.id && Object.keys(params).length > 0 && _windows[running] && _windows[running].relaunch)
                    _windows[running].relaunch(params);
                cardFocusRequested(running);
                return;
            }
            var launched = launch(target, uid, target === payload.id ? params : null);
            if (launched !== "")
                cardFocusRequested(launched);
        } else if (type === "banner") {
            var info = appInfo(appId);
            notify(appId, info ? info.title : appId, payload.message || "");
        } else if (type === "notification") {
            // A notification for another app (e.g. a text the telephony
            // service received for Messaging): {appId, title, body}.
            var target = payload.appId && appInfo(payload.appId) ? payload.appId : appId;
            notify(target, payload.title || "", payload.body || "");
        } else if (type === "systemStatus") {
            // The pages are in step with the shell again.
            _pendingStatus = null;
            var st = {};
            for (var k in payload)
                st[k] = payload[k];
            if ("wallpaperFile" in payload)
                // A picture from /media (Photos) comes with its data: URL.
                st.wallpaperUrl = payload.wallpaperFile
                        ? (resolveDevicePath(payload.wallpaperFile) || payload.wallpaperUrl || "") : "";
            systemStatusReported(st);
        }
    }

    signal systemStatusReported(var status)

    // What the user changed while no web page was running, for the next
    // page that loads (pages share their state through the runtime's store).
    property var _pendingStatus: null

    function _statusScript(changes) {
        return "window.__phoenixRuntime && __phoenixRuntime.applyHostStatus && __phoenixRuntime.applyHostStatus("
               + JSON.stringify(changes) + ")";
    }

    function _webPages() {
        var out = [];
        for (var u in _windows)
            if (_windows[u] && _windows[u].runScript)
                out.push(_windows[u]);
        for (var a in _headless)
            if (_headless[a] && _headless[a].runScript)
                out.push(_headless[a]);
        return out;
    }

    function pushSystemStatus(changes) {
        var pages = _webPages();
        if (pages.length === 0) {
            var p = _pendingStatus || {};
            for (var k in changes)
                p[k] = changes[k];
            _pendingStatus = p;
            return;
        }
        var js = _statusScript(changes);
        for (var i = 0; i < pages.length; ++i)
            pages[i].runScript(js);
    }

    function _pageLoaded(win) {
        if (_pendingStatus) {
            win.runScript(_statusScript(_pendingStatus));
            _pendingStatus = null;
        }
    }

    // The launcher entry to start for a launch request: a launch point of
    // appId whose params equal these, else appId itself.
    function _launchTarget(appId, params) {
        var want = _canonical(params || {});
        for (var i = 0; i < apps.count; ++i) {
            var a = apps.get(i);
            if (a.webAppId === appId && a.appId !== appId && a.params !== "" && _canonical(JSON.parse(a.params)) === want)
                return a.appId;
        }
        return appId;
    }

    function _canonical(o) {
        if (o === null || typeof o !== "object")
            return JSON.stringify(o);
        if (Array.isArray(o))
            return "[" + o.map(_canonical).join(",") + "]";
        return "{" + Object.keys(o).sort().map(function(k) { return JSON.stringify(k) + ":" + _canonical(o[k]); }).join(",") + "}";
    }

    // Main page URL of a web app with these launch params.
    function mainUrl(appId, params) {
        var info = appInfo(appId);
        if (!info || !info.web)
            return "";
        if (!params || Object.keys(params).length === 0)
            return info.main;
        return String(info.main).split("?")[0] + "?launchParams=" + encodeURIComponent(JSON.stringify(params));
    }

    // Device path of an app's file (/usr/palm/applications/<id>/...) -> file URL.
    function resolveDevicePath(path) {
        var m = /^\/usr\/palm\/applications\/([^\/]+)\/(.*)$/.exec(path || "");
        if (!m)
            return "";
        for (var i = 0; i < apps.count; ++i) {
            var a = apps.get(i);
            if (a.webAppId === m[1] && a.dir !== "")
                return a.dir + m[2];
        }
        return "";
    }

    // The app menu of the app in card uid (the status bar's app name).
    function appMenu(uid) {
        var win = _windows[uid];
        if (win && win.runScript)
            win.runScript("window.__phoenixRuntime && __phoenixRuntime.openAppMenu && __phoenixRuntime.openAppMenu()");
        else if (win && win.appMenuRequested)
            win.appMenuRequested();
    }

    // Open a web page in the browser, as a tapped link does (phoenix-sim --open).
    function openUrl(url) {
        _hostMessage("", "", "launch", { id: "com.palm.app.browser", params: { target: url } });
    }

    // ---- Just Type ------------------------------------------------------------------
    // The original Just Type, com.palm.launcher from openwebos/luna-applauncher,
    // runs in one page that stays loaded; the shell shows it over the cards
    // while the user types (see JustType.qml).

    readonly property string justTypeAppId: "com.palm.launcher"
    property Item _justType: null
    property bool _justTypeLoaded: false
    signal justTypeDismissed

    function justTypeWindow() {
        if (_justType)
            return _justType;
        var info = appInfo(justTypeAppId);
        if (!info || !info.web)
            return null;
        _justType = _webWindow(justTypeAppId, info.main, "");
        if (_justType.loaded)
            _justType.loaded.connect(function() { source._justTypeLoaded = true; });
        return _justType;
    }

    function _justTypeScript(js) {
        return "(function(){var jt=window.enyo&&enyo.$.justTypeApp&&enyo.$.justTypeApp.$.justType;"
               + "if(jt){" + js + "}})()";
    }

    function justTypeStart(text) {
        var win = justTypeWindow();
        if (!win)
            return;
        var js = _justTypeScript("jt.forceFocus();jt.$.searchField.setValue(" + JSON.stringify(text)
                                 + ");jt.onValueChange(null,null," + JSON.stringify(text) + ");");
        _runWhenLoaded(win, js, !_justTypeLoaded);
    }

    function justTypeStop() {
        if (_justType && _justTypeLoaded)
            _justType.runScript(_justTypeScript("jt.justTypeDeactivated();"));
    }

    // ---- Simulator: incoming call and text -----------------------------------------

    readonly property string phoneAppId: "org.webosphoenix.phone"
    readonly property string messagingAppId: "org.webosphoenix.messaging"

    // Run js in win now, or once its page has loaded when just created.
    function _runWhenLoaded(win, js, fresh) {
        if (!fresh) {
            win.runScript(js);
            return;
        }
        var done = false;
        win.loaded.connect(function() {
            if (done)
                return;
            done = true;
            win.runScript(js);
        });
    }

    // A call comes in: the Phone card comes up ringing, as on webOS
    // (__phoenixRuntime.simulateIncomingCall in runtime/phoenix-runtime.js).
    function simulateIncomingCall() {
        var info = appInfo(phoneAppId);
        if (!info || !info.web) {
            notify(phoneAppId, "Incoming call", "Priya Nair");
            return;
        }
        var uid = runningUid(phoneAppId);
        var fresh = uid === "";
        if (fresh)
            uid = launch(phoneAppId, "");
        if (uid === "" || !_windows[uid] || !_windows[uid].runScript)
            return;
        _runWhenLoaded(_windows[uid], "window.__phoenixRuntime && __phoenixRuntime.simulateIncomingCall()", fresh);
        cardFocusRequested(uid);
    }

    // A text arrives. Any running page can play the telephony service; the
    // runtime then posts a "notification" for Messaging. With no web page
    // running, Messaging starts in the background to receive it.
    function simulateIncomingSms() {
        var js = "window.__phoenixRuntime && __phoenixRuntime.simulateIncomingSms()";
        var pages = _webPages();
        if (pages.length > 0) {
            pages[0].runScript(js);
            return;
        }
        var info = appInfo(messagingAppId);
        if (!info || !info.web) {
            notify(messagingAppId, "Marcus Reyes", "Are we still on for lunch at noon?");
            return;
        }
        var uid = launch(messagingAppId, "");
        if (uid !== "" && _windows[uid] && _windows[uid].runScript)
            _runWhenLoaded(_windows[uid], js, true);
    }

    // Launch or re-focus an app. A new app starts its own stack to the right
    // of the stack holding `afterUid` (CardWindowManager.cpp:556-599).
    // params: launch params for a web app (optional; launch points carry their own).
    function launch(appId, afterUid, params) {
        var existing = runningUid(appId);
        if (existing !== "")
            return existing;
        var info = appInfo(appId);
        if (!info)
            return "";
        var url = params ? mainUrl(appId, params) : "";
        if (info.web && info.noWindow) {
            // Headless app: its page runs hidden and opens card windows itself.
            if (!_headless[appId])
                _headless[appId] = _webWindow(appId, url || info.main, "");
            return "";
        }
        var at = afterUid ? _afterGroupOf(afterUid) : cards.count;
        return _createWindow(appId, info.title, at, newGroupId(), null, url);
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
        var info = appInfo(appId) || { color: "#666666", glyph: "!", icon: "" };
        notifications.append({
            id: "n" + Date.now() + "_" + notifications.count,
            appId: appId, title: titleText, body: body,
            color: info.color, glyph: info.glyph, icon: info.icon || ""
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
