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
//                            groupId form a card stack); optional:
//                            fullScreen (enableFullScreenMode), orientation
//                            (the app's PalmSystem.setWindowOrientation:
//                            "free", "up", "down", "left", "right",
//                            "landscape", "portrait"; missing = "free")
//   windowFor(uid) -> Item   the app surface to show inside the card
//   launch(appId, afterUid) -> uid   new apps start a stack right of afterUid's
//   close(uid)
//   back(uid)                deliver the back gesture to the app
//   moveCard(from, to)       reorder (indices into cards)
//   setCardGroup(uid, groupId), newGroupId()
//   cardFocusRequested(uid)  signal: show this card maximized (e.g. a new
//                            child window opened by an app)
//   notifications ListModel  id, appId, title, body, color, glyph, icon, params (launch
//                            params for the app when tapped, as JSON, or ""),
//                            windowKey (a dashboard window: windowFor(windowKey)
//                            is the app's own dashboard, "" otherwise),
//                            clickableWhenLocked (the dashboard takes taps
//                            on the lock screen: its {clickableWhenLocked:
//                            true} window attribute)
//   alerts        ListModel  key, appId, height (legacy px): popup alert
//                            windows (windowFor(key)), front first
//   closeAlert(key)          (optional) close a popup alert window (Home)
//   bannerRequested(appId, text, icon, params)  signal: a transient banner
//                            (params: its launch params, JSON, or "")
//   cardCloseRequested(uid)  signal: a window asked to close (window.close())
//
// Optional (the shell has a built-in fallback without them):
//   justTypeWindow() -> Item  the Just Type search surface, or null
//   justTypeStart(text)      show it with this text typed
//   justTypeStop()           it was dismissed; clear it
//   justTypeDismissed        signal: it launched something; close it
//   appMenu(uid)             the user tapped the app name: open its app menu
//   removeApp(appId)         the user deleted the app in the launcher
//   savedLauncherLayout() -> string, saveLauncherLayout(json)
//                            the launcher's icon order, kept across sessions
//   apps also has removable: whether the launcher offers to delete the app
//
// Simulator only (sim.qml wires these to SimSystemStatus and the shell):
//   systemStatusReported(status)  signal: a web page reported the device
//                            state (radios, brightness, ...; see hostStatus()
//                            in runtime/phoenix-runtime.js), with wallpaperUrl
//                            resolved to a local file
//   pushSystemStatus(changes)     tell the web pages what the user changed
//                            in the system menu (only the changed keys)
//   lunaCall(uri, params, cb)     one reply from a (simulated) service;
//                            cb(null) when no runtime page is up
//   simulateIncomingCall()   ring the Phone app (phoenix-sim F4)
//   simulateIncomingSms()    deliver a text to Messaging (phoenix-sim F5)
//   openUrl(url)             open a web page in the browser (phoenix-sim --open)
//
// Web apps (the original webOS apps, Settings, ...) come from the virtual
// webOS filesystem when phoenix-sim was built with Qt WebEngine; they
// replace the placeholder app with the same title.

import QtQuick
import "../Shell/NotificationPolicy.js" as Policy

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
                          icon: a.icon, largeIcon: a.largeIcon || "", web: true, main: a.main, noWindow: !!a.noWindow,
                          orientation: a.requestedWindowOrientation || "",
                          webAppId: a.appId || a.id, params: a.params || "", dir: a.dir || "",
                          removable: false });
        }
        for (i = 0; i < placeholders.count; ++i) {
            var p = placeholders.get(i);
            if (titles[p.title])
                continue;
            apps.append({ appId: p.appId, title: p.title, color: p.color, glyph: p.glyph, tab: p.tab,
                          quickLaunch: p.quickLaunch, icon: p.icon, largeIcon: "", web: false, main: "", noWindow: false,
                          orientation: "",
                          webAppId: "", params: "", dir: "",
                          // Stand-ins for apps still to come can be deleted, as
                          // downloaded apps could; the built-in ones cannot.
                          removable: true });
        }
        Qt.callLater(_bootSystemApps);
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
        // appinfo.json requestedWindowOrientation (ApplicationDescription.cpp:
        // 464-469, handed to WebAppMgr) until the page asks for another.
        cards.insert(at, { uid: uid, appId: appId, title: titleText, groupId: groupId, fullScreen: false,
                           orientation: _windowOrientation(info.orientation) });
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
        // Popup alerts and dashboards (enyo.windows.openPopup / openDashboard;
        // the runtime tags their URL with the window type).
        var url = String(request.requestedUrl);
        var type = /[#&]phoenixWindow=([a-z]+)/.exec(url);
        if (type && (type[1] === "popupalert" || type[1] === "dashboard")) {
            _openSystemWindow(appId, request, type[1], url);
            return;
        }
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
            // A scheduled activity (an alarm, a reminder) launches in the
            // background: the app decides what to show, e.g. a notification.
            var background = !!params.$activity;
            var target = _launchTarget(payload.id, params);
            var running = runningUid(target);
            if (running !== "") {
                if (target === payload.id && Object.keys(params).length > 0 && _windows[running] && _windows[running].relaunch)
                    _windows[running].relaunch(params);
                if (!background)
                    cardFocusRequested(running);
                return;
            }
            // Launched by the app in front: the new card joins its stack,
            // e.g. the browser opened from a link in Email
            // (CardWindowManager::prepareAddWindow, :561-567).
            var joins = uid !== "" && uid === focusedUid && !background;
            var launched = launch(target, uid, target === payload.id ? params : null, joins);
            if (launched !== "" && !background)
                cardFocusRequested(launched);
        } else if (type === "banner") {
            // A banner only scrolls by; it leaves nothing in the dashboard
            // (PalmSystem.addBannerMessage).
            var bp = payload.params;
            bannerRequested(appId, payload.message || "", _iconUrl(payload.icon, appId),
                            bp === undefined || bp === null ? "" : typeof bp === "string" ? bp : JSON.stringify(bp));
        } else if (type === "notification") {
            // A notification for another app (e.g. a text the telephony
            // service received for Messaging, a Tasks reminder): {appId,
            // title, body, params?}; tapping it launches the app with params.
            var target = payload.appId && appInfo(payload.appId) ? payload.appId : appId;
            notify(target, payload.title || "", payload.body || "", payload.params);
        } else if (type === "activate") {
            // PalmSystem.activate: the app brings its card to the front.
            if (cardIndex(uid) >= 0)
                cardFocusRequested(uid);
        } else if (type === "windowOrientation") {
            // PalmSystem.setWindowOrientation (Enyo enyo.setAllowedOrientation,
            // Mojo stageController.setWindowOrientation): the card keeps this
            // orientation (ViewHost_Card_SetAppFixedOrientation / SetFreeOrientation,
            // CardWindow::onSetAppFixedOrientation, CardWindow.cpp:2536-2583).
            var oi = cardIndex(uid);
            if (oi >= 0)
                cards.setProperty(oi, "orientation", _windowOrientation(payload.orientation));
        } else if (type === "fullScreen") {
            // PalmSystem.enableFullScreenMode: the card, maximized, gets the
            // whole screen.
            var fi = cardIndex(uid);
            if (fi >= 0)
                cards.setProperty(fi, "fullScreen", !!payload.on);
        } else if (type === "inputFocus") {
            // An editable element of the page got or lost the focus, or the
            // app showed or hid the keyboard itself (runtime: "Virtual
            // keyboard"). Just Type's page is "justtype".
            inputFocusChanged(appId === justTypeAppId && uid === "" ? "justtype" : uid, !!payload.focused, payload.state || null);
        } else if (type === "lunaReply") {
            var cb = _lunaCallbacks[payload.id];
            delete _lunaCallbacks[payload.id];
            if (cb)
                cb(payload.reply);
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

    // ---- The virtual keyboard's input clients (the shell's IMEController) ------------

    // A page's editable element got (focused) or lost the input focus;
    // state is its PalmIME::EditorState ({type, actions, flags, enterKeyLabel}).
    signal inputFocusChanged(string uid, bool focused, var state)

    // What the keyboard's keys go to for a window: its page's view, which
    // passes them on to the focused element as real key events.
    function inputTarget(uid) {
        var w = uid === "justtype" ? _justType : _windows[uid];
        if (!w)
            return null;
        return w.view !== undefined ? w.view : w;
    }

    // The keyboard's hide key: the page's element loses the focus.
    function removeInputFocus(uid) {
        var w = uid === "justtype" ? _justType : _windows[uid];
        if (w && w.runScript)
            w.runScript("window.__phoenixRuntime && __phoenixRuntime.imeRemoveFocus && __phoenixRuntime.imeRemoveFocus()");
    }

    // The keyboard came up or went (Mojo.keyboardShown in the app).
    function keyboardShown(uid, shown) {
        var w = _windows[uid];
        if (w && w.runScript)
            w.runScript("window.__phoenixRuntime && __phoenixRuntime.keyboardShown && __phoenixRuntime.keyboardShown(" + (shown ? "true" : "false") + ")");
    }

    // Keyboard sounds (com.palm.audio/systemsounds/playFeedback: "key",
    // "space", "backspace", "return"; SoundPlayerPool::playFeedback). No
    // system sounds ship yet (GAPS A1): the simulator counts them.
    property int feedbackCount: 0
    property string lastFeedback: ""
    function playFeedback(name) {
        lastFeedback = name;
        feedbackCount++;
    }

    // The orientations a window can ask for; anything else is "free".
    function _windowOrientation(o) {
        o = String(o || "").toLowerCase();
        return ["up", "down", "left", "right", "landscape", "portrait"].indexOf(o) >= 0 ? o : "free";
    }

    // ---- Popup alerts, dashboards and banners -------------------------------------------
    // Windows of type "popupalert" and "dashboard" are not cards: the shell
    // shows alerts in the negative space (phones) or top right (tablets), and
    // dashboards as rows of the dashboard, each the app's own page
    // (DashboardWindowManager).

    property ListModel alerts: ListModel {}

    // The card the user is in (maximized and focused), set by the shell;
    // apps it launches stack on it.
    property string focusedUid: ""
    signal bannerRequested(string appId, string text, url icon, string params)

    // Tell a page when its card comes to the front (maximized) or leaves it
    // (minimized to card view, or another card maximized), as LunaSysMgr
    // does; the runtime passes it on as the "phoenixcardactivation" event
    // (runtime/phoenix-runtime.js "Card activation"). Passwords and
    // Authenticator lock on it.
    property string _activeUid: ""
    onFocusedUidChanged: {
        var previous = _activeUid;
        _activeUid = focusedUid;
        if (previous === focusedUid)
            return;
        var tell = function (uid, active) {
            var w = _windows[uid];
            if (w && w.runScript)
                w.runScript("window.__phoenixRuntime && __phoenixRuntime.cardActivated && __phoenixRuntime.cardActivated(" + active + ")");
        };
        if (previous !== "")
            tell(previous, false);
        if (focusedUid !== "")
            tell(focusedUid, true);
    }

    // A file URL for an icon an app names by device path.
    function _iconUrl(path, appId) {
        if (path && typeof simRootfs !== "undefined" && simRootfs) {
            var u = simRootfs.fileUrl(String(path));
            if (u !== "")
                return u;
        }
        var info = appInfo(appId);
        return info && info.icon ? info.icon : "";
    }

    function _param(url, name) {
        var m = new RegExp("[#&]" + name + "=([^&]*)").exec(url);
        return m ? decodeURIComponent(m[1]) : "";
    }

    function _openSystemWindow(appId, request, type, url) {
        var key = "s" + (_nextUid++);
        var win = _webWindow(appId, "", "");
        win.transparent = true;
        win.adopt(request);
        win.closeRequested.connect(function() { source._closeSystemWindow(key); });
        _windows[key] = win;
        if (type === "popupalert") {
            // Most urgent first: an incoming call goes in front of a
            // low-battery alert (NotificationPolicy.js).
            var name = _param(url, "phoenixName");
            var queued = [];
            for (var i = 0; i < alerts.count; ++i)
                queued.push({ appId: alerts.get(i).appId, name: alerts.get(i).name });
            alerts.insert(Policy.insertIndex(queued, appId, name),
                          { key: key, appId: appId, name: name, height: parseInt(_param(url, "phoenixHeight")) || 200 });
        } else {
            var info = appInfo(appId) || { title: appId, color: "#666666", glyph: "!", icon: "" };
            notifications.append({
                id: key, appId: appId, title: info.title, body: "",
                color: info.color, glyph: info.glyph, icon: _iconUrl(_param(url, "phoenixIcon"), appId),
                params: "", windowKey: key,
                clickableWhenLocked: _param(url, "phoenixClickableWhenLocked") === "1"
            });
        }
    }

    // The Home button closes the front popup alert
    // (DashboardWindowManager::slotCloseAlert: the window is closed).
    function closeAlert(key) {
        _closeSystemWindow(key);
    }

    // The page closed its alert or dashboard (window.close()), or the user
    // dismissed the dashboard.
    function _closeSystemWindow(key) {
        var i;
        for (i = alerts.count - 1; i >= 0; --i)
            if (alerts.get(i).key === key)
                alerts.remove(i);
        for (i = notifications.count - 1; i >= 0; --i)
            if (notifications.get(i).windowKey === key)
                notifications.remove(i);
        var win = _windows[key];
        delete _windows[key];
        if (win)
            win.destroy();
    }

    // Start the system's own headless apps at boot, as LunaSysMgr started
    // com.palm.systemui (WebAppMgrProxy.cpp:88-97).
    readonly property var bootApps: ["com.palm.systemui"]
    function _bootSystemApps() {
        for (var i = 0; i < bootApps.length; ++i) {
            var info = appInfo(bootApps[i]);
            if (info && info.web && !_headless[bootApps[i]])
                _headless[bootApps[i]] = _webWindow(bootApps[i], info.main, "");
        }
    }

    // phoenix-sim: the battery and charger (runtime setPower in every page,
    // so luna-systemui's powerd listeners hear it).
    function simulatePower(changes) {
        var js = "window.__phoenixRuntime && __phoenixRuntime.setPower && __phoenixRuntime.setPower(" + JSON.stringify(changes) + ")";
        var pages = _webPages();
        for (var i = 0; i < pages.length; ++i)
            pages[i].runScript(js);
    }

    // What the user changed while no web page was running, for the next
    // page that loads (pages share their state through the runtime's store).
    property var _pendingStatus: null

    function _statusScript(changes) {
        return "window.__phoenixRuntime && __phoenixRuntime.applyHostStatus && __phoenixRuntime.applyHostStatus("
               + JSON.stringify(changes) + ")";
    }

    // ---- Luna calls from the shell ---------------------------------------------
    // lunaCall(uri, params, callback): one reply, from the simulated services
    // in a runtime page (the always-running system UI page when there is one),
    // so the shell and the apps see the same state. callback(null) when no
    // page is running. The device source calls the bus directly.
    property var _lunaCallbacks: ({})
    property int _nextLunaCall: 1
    function lunaCall(uri, params, callback) {
        var page = _headless["com.palm.systemui"] || _webPages()[0];
        if (!page) {
            callback(null);
            return;
        }
        var id = _nextLunaCall++;
        _lunaCallbacks[id] = callback;
        page.runScript("(function () { var id = " + id + ", done = false;"
            + " function back(r) { if (done) return; done = true; phoenixHost.postToHost('lunaReply', { id: id, reply: r }); }"
            + " if (!window.__phoenixRuntime) return back(null);"
            + " __phoenixRuntime.dispatch(" + JSON.stringify(uri) + ", " + JSON.stringify(params || {}) + ", back,"
            + " { cancelled: function () { return done; }, onCancel: null }); })()");
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

    // State only the shell knows (the lock screen, how the UI and the device
    // are turned), which every page gets as it loads; unlike the rest it is
    // not the pages' to overrule.
    readonly property var _shellOwned: ["deviceLocked", "orientation", "ime"]
    property var _shellStatus: ({})

    function pushSystemStatus(changes) {
        for (var s in changes)
            if (_shellOwned.indexOf(s) >= 0)
                _shellStatus[s] = changes[s];
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
        if (Object.keys(_shellStatus).length > 0)
            win.runScript(_statusScript(_shellStatus));
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

    // ---- Launcher --------------------------------------------------------------------

    // The launcher layout as JSON; sim.qml keeps it in the settings file.
    property string launcherLayoutJson: ""
    function savedLauncherLayout() { return launcherLayoutJson; }
    function saveLauncherLayout(json) { launcherLayoutJson = json; }

    // Deleting an app closes its windows (the launcher layout keeps it out).
    function removeApp(appId) {
        for (var i = cards.count - 1; i >= 0; --i)
            if (cards.get(i).appId === appId)
                close(cards.get(i).uid);
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
        // Phone raises its incoming-call popup alert itself; its card only
        // comes up when the call is answered (PalmSystem.activate).
        _runWhenLoaded(_windows[uid], "window.__phoenixRuntime && __phoenixRuntime.simulateIncomingCall()", fresh);
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
    // joinUid's stack: the new card goes to its front instead of a stack
    // of its own.
    // A launch point whose params match wins, as for apps launching apps
    // (the system menu's "Wi-Fi Preferences" opens the Wi-Fi card).
    function launch(appId, afterUid, params, joinStack) {
        if (params && Object.keys(params).length > 0) {
            var target = _launchTarget(appId, params);
            if (target !== appId) {
                appId = target;
                params = null;
            }
        }
        var existing = runningUid(appId);
        if (existing !== "") {
            // Running already: new params go to the page (webOSRelaunch).
            if (params && Object.keys(params).length > 0 && _windows[existing] && _windows[existing].relaunch)
                _windows[existing].relaunch(params);
            return existing;
        }
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
        var join = joinStack && afterUid ? cardIndex(afterUid) : -1;
        return _createWindow(appId, info.title, at, join >= 0 ? cards.get(join).groupId : newGroupId(), null, url);
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

    // params: launch params for the app when the notification is tapped.
    function notify(appId, titleText, body, params) {
        var info = appInfo(appId) || { color: "#666666", glyph: "!", icon: "" };
        notifications.append({
            id: "n" + Date.now() + "_" + notifications.count,
            appId: appId, title: titleText, body: body,
            color: info.color, glyph: info.glyph, icon: info.icon || "",
            params: params && typeof params === "object" ? JSON.stringify(params) : "",
            windowKey: "", clickableWhenLocked: false
        });
    }

    function dismissNotification(index) {
        if (index < 0 || index >= notifications.count)
            return;
        var key = notifications.get(index).windowKey;
        if (key)
            _closeSystemWindow(key);
        else
            notifications.remove(index);
    }

    Component {
        id: mockApp
        MockApp {}
    }
}
