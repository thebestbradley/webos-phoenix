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
//                            fullScreen (enableFullScreenMode), blockScreenTimeout
//                            (setWindowProperties: the screen stays on), orientation
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
//   alerts        ListModel  key, appId, height (legacy px), sound,
//                            soundClass (the window's sound attributes):
//                            popup alert windows (windowFor(key)), front first
//   closeAlert(key)          (optional) close a popup alert window (Home)
//   bannerRequested(appId, text, icon, params, soundClass, soundFile, soundDuration)
//                            signal: a transient banner (params: its launch
//                            params, JSON, or ""), and the sound it asked for
//   soundRequested(appId, soundClass, soundFile, duration)
//                            signal: an app asked for a sound
//                            (PalmSystem.playSoundNotification), or a
//                            notification came with one
//   cardCloseRequested(uid)  signal: a window asked to close (window.close())
//
// System sounds (SystemSounds.qml decides what plays; the source plays it):
//   playSound(path, stream, loop, durationMs, volume, fallback) -> handle
//                            play a device path on a stream ("ringtones",
//                            "alerts", "notifications", "feedback", ...;
//                            durationMs -1 = the whole file; volume 0..1;
//                            fallback: played if the file cannot be)
//   stopSound(handle)
//   soundExists(path) -> bool
//   appDir(appId) -> string  the app's folder, for sounds named relative to it
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
//   launcherLayoutRestored(json)  signal: a restored backup brought one back
//   (installing: "installApp" / "removeApp" host messages, phoenix-sim's
//   simInstaller; deleting an installed app in the launcher removes it)
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
//   simPty (context property, C++ SimPty): the Terminal's real shells on
//                            this computer; "pty" host messages go to it and
//                            its replies back to the window (runtime block
//                            "Terminal"); null with --no-host-shell
//   preferencesReported(prefs)  signal: a page set system preferences
//                            (com.webos.service.systemservice setPreferences),
//                            e.g. firstUseComplete when First Use is done
//
// Optional, for the emergency window (Shell.openEmergency):
//   openSystemWindow(appId, params, kind) -> key   an app window that is no
//                            card: windowFor(key), back(key); "" if the
//                            app cannot be opened
//   closeSystemWindow(key)
//   systemWindowClosed(key)  signal: the page closed its window
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
            titles[web[i].title] = true;
            apps.append(_webEntry(web[i]));
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
        if (_simPty())
            _simPty().event.connect(_ptyEvent);
    }

    // A launcher entry for a web app (Rootfs::apps()). Launch points
    // (appinfo.json phoenix.launchPoints) are entries of their own: own icon,
    // title, card and launch params. Apps the user installed can be deleted.
    function _webEntry(a) {
        return { appId: a.id, title: a.title, color: "#555c66", glyph: a.title.charAt(0),
                 tab: a.tab !== undefined ? a.tab : 0, quickLaunch: a.quickLaunch || webQuickLaunch[a.title] || 0,
                 icon: a.icon, largeIcon: a.largeIcon || "", web: true, main: a.main, noWindow: !!a.noWindow,
                 orientation: a.requestedWindowOrientation || "",
                 webAppId: a.appId || a.id, params: a.params || "", dir: a.dir || "",
                 removable: !!a.installed };
    }

    // ---- Installing and removing apps (phoenix-sim's SimInstaller) ---------------------
    // The runtime's com.webos.appInstallService unpacks a package and sends
    // its files ("installApp"); removing one is "removeApp". The result goes
    // back to every page (applyHostStatus {installerResult, appsVersion}),
    // which then read the app list again, and the launcher follows.

    property int appsVersion: 0

    function _simInstaller() {
        return typeof simInstaller !== "undefined" && simInstaller ? simInstaller : null;
    }

    // The web apps again, after an install or removal: entries come and go,
    // changed ones are replaced in place.
    function _syncWebApps() {
        var inst = _simInstaller();
        if (!inst)
            return;
        var list = inst.apps(), byId = {};
        for (var i = 0; i < list.length; ++i)
            byId[list[i].id] = list[i];
        for (var j = apps.count - 1; j >= 0; --j) {
            var e = apps.get(j);
            if (!e.web)
                continue;
            if (!byId[e.appId])
                apps.remove(j);
            else {
                apps.set(j, _webEntry(byId[e.appId]));
                delete byId[e.appId];
            }
        }
        for (var k = 0; k < list.length; ++k)
            if (byId[list[k].id])
                apps.append(_webEntry(list[k]));
        appsVersion++;
    }

    function _installerRequest(type, payload) {
        var inst = _simInstaller();
        var error = !inst ? "Installing apps is not available"
                  : type === "installApp" ? inst.install(String(payload.appId || ""), payload.files || [])
                  : inst.remove(String(payload.appId || ""));
        if (!error) {
            // Its windows go with it; an update starts afresh.
            for (var i = cards.count - 1; i >= 0; --i)
                if (cards.get(i).appId === payload.appId || cards.get(i).webAppId === payload.appId)
                    close(cards.get(i).uid);
            _syncWebApps();
        }
        pushSystemStatus({ installerResult: { requestId: payload.requestId, ok: !error, error: error },
                           appsVersion: appsVersion });
    }

    // ---- The Terminal's shells (phoenix-sim's SimPty) -------------------------------

    function _simPty() {
        return typeof simPty !== "undefined" && simPty ? simPty : null;
    }

    // A reply for the page in window uid (org.webosphoenix.pty in the runtime).
    function _ptyEvent(uid, json) {
        var w = _windows[uid];
        if (w && w.runScript)
            w.runScript("window.__phoenixRuntime && __phoenixRuntime.ptyEvent && __phoenixRuntime.ptyEvent(" + json + ")");
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
        cards.insert(at, { uid: uid, appId: appId, title: titleText, groupId: groupId, fullScreen: false, blockScreenTimeout: false,
                           orientation: _windowOrientation(info.orientation) });
        return uid;
    }

    // ---- Web apps --------------------------------------------------------------

    property var _headless: ({})     // appId -> hidden main page of a noWindow app
    property Component _webComponent: null

    // system: the window is a system window (openSystemWindow), not a card.
    function _webWindow(appId, url, uid, system) {
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
        if (system)
            win.closeRequested.connect(function() { source.closeSystemWindow(uid); });
        else if (uid !== "")
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

    function _soundArgs(payload) {
        return [payload.soundClass ? String(payload.soundClass) : "", payload.soundFile ? String(payload.soundFile) : "",
                payload.duration | 0];
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
            var bs = _soundArgs(payload);
            bannerRequested(appId, payload.message || "", _iconUrl(payload.icon, appId),
                            bp === undefined || bp === null ? "" : typeof bp === "string" ? bp : JSON.stringify(bp),
                            bs[0], bs[1], bs[2]);
        } else if (type === "sound") {
            // PalmSystem.playSoundNotification(soundClass, soundFile, duration).
            var ss = _soundArgs(payload);
            soundRequested(appId, ss[0], ss[1], ss[2]);
        } else if (type === "notification") {
            // A notification for another app (e.g. a text the telephony
            // service received for Messaging, a Tasks reminder): {appId,
            // title, body, params?}; tapping it launches the app with params.
            var target = payload.appId && appInfo(payload.appId) ? payload.appId : appId;
            notify(target, payload.title || "", payload.body || "", payload.params);
            if (payload.soundClass || payload.soundFile) {
                var ns = _soundArgs(payload);
                soundRequested(target, ns[0], ns[1], ns[2]);
            }
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
        } else if (type === "windowProperties") {
            // PalmSystem.setWindowProperties {blockScreenTimeout}: the
            // screen stays on while the card is in front (Display.blocked).
            var wi = cardIndex(uid);
            if (wi >= 0 && payload.blockScreenTimeout !== undefined)
                cards.setProperty(wi, "blockScreenTimeout", !!payload.blockScreenTimeout);
        } else if (type === "inputFocus") {
            // An editable element of the page got or lost the focus, or the
            // app showed or hid the keyboard itself (runtime: "Virtual
            // keyboard"). Just Type's page is "justtype".
            inputFocusChanged(appId === justTypeAppId && uid === "" ? "justtype" : uid, !!payload.focused, payload.state || null);
        } else if (type === "pty") {
            // The Terminal's shell: SimPty checks appId, which is the
            // shell's record of the window, not the page's say-so.
            if (_simPty() && uid !== "")
                _simPty().request(uid, appId, payload);
        } else if (type === "lunaReply") {
            var cb = _lunaCallbacks[payload.id];
            delete _lunaCallbacks[payload.id];
            if (cb)
                cb(payload.reply);
        } else if (type === "preferences") {
            preferencesReported(payload);
        } else if (type === "ongoing") {
            setOngoing(appId, payload || {});
        } else if (type === "reboot") {
            rebootRequested();
        } else if (type === "installApp" || type === "removeApp") {
            _installerRequest(type, payload);
        } else if (type === "launcherLayout") {
            // A restored backup's launcher layout (com.palm.sysMgrDataBackup
            // postRestore, as LunaSysMgr's BackupManager put its files back).
            if (typeof payload.json === "string")
                launcherLayoutRestored(payload.json);
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
    signal preferencesReported(var prefs)
    signal launcherLayoutRestored(string json)
    // The page asked the device to restart (com.palm.power/shutdown/machineReboot).
    signal rebootRequested

    // ---- System windows: the emergency window ---------------------------------------
    // An app page shown by the shell outside the cards: Phone's restricted
    // mode over the lock screen (EmergencyWindowManager's Type_Emergency
    // window). Its key works as a window uid (windowFor, back, the keyboard).

    property ListModel systemWindows: ListModel {}
    signal systemWindowClosed(string key)

    function openSystemWindow(appId, params, kind) {
        var info = appInfo(appId);
        if (!info)
            return "";
        var key = (kind || "system") + (_nextUid++);
        var win = info.web ? _webWindow(appId, mainUrl(appId, params), key, true)
                           : mockApp.createObject(source, { appId: appId, title: info.title, accent: info.color, glyph: info.glyph });
        _windows[key] = win;
        systemWindows.append({ key: key, appId: appId, kind: kind || "system" });
        return key;
    }

    function closeSystemWindow(key) {
        var i;
        for (i = systemWindows.count - 1; i >= 0; --i)
            if (systemWindows.get(i).key === key)
                break;
        if (i < 0)
            return;
        systemWindows.remove(i);
        var win = _windows[key];
        delete _windows[key];
        if (win)
            win.destroy();
        systemWindowClosed(key);
    }

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

    // ---- System sounds ----------------------------------------------------------------
    // The shell's SystemSounds picks the file; the simulator plays it with
    // HTML audio in a runtime page (com.webos.service.audio playSound,
    // __phoenixRuntime.sounds), preferably the system UI's, which is always
    // up. Without web pages (tests) nothing is heard; soundLog keeps what
    // was asked for either way.

    signal soundRequested(string appId, string soundClass, string soundFile, int duration)

    // What was played, newest last: {handle, path, stream, loop, duration,
    // volume, fallback}; stopped handles are in stoppedSounds.
    property var soundLog: []
    property var stoppedSounds: []
    property int soundCount: 0
    property var lastSound: null
    property int _nextSound: 1

    // The system sounds that ship (runtime/rootfs.json: /usr/palm/sounds,
    // /usr/share/phoenix/sounds), for soundExists without a rootfs (tests).
    property var shippedSounds: [
        "/usr/palm/sounds/alert.wav", "/usr/palm/sounds/notification.wav", "/usr/palm/sounds/phone.wav",
        "/usr/palm/sounds/ringtone.mp3", "/usr/palm/sounds/boot.mp3", "/usr/palm/sounds/shutdown.mp3",
        "/usr/palm/sounds/charging.mp3", "/usr/palm/sounds/battery_full.mp3", "/usr/palm/sounds/battery_low.mp3",
        "/usr/palm/sounds/error.mp3", "/usr/palm/sounds/panel.mp3", "/usr/palm/sounds/tap_to_share.mp3",
        "/usr/share/phoenix/sounds/feedback/key.wav", "/usr/share/phoenix/sounds/feedback/space.wav",
        "/usr/share/phoenix/sounds/feedback/backspace.wav", "/usr/share/phoenix/sounds/feedback/return.wav",
        "/usr/share/phoenix/sounds/feedback/appclose.wav"
    ]

    function soundExists(path) {
        path = String(path || "");
        // The user's storage lives in the pages (the Files store): the
        // runtime plays the fallback if the file is not there.
        if (path.indexOf("/media/") === 0)
            return true;
        if (typeof simRootfs !== "undefined" && simRootfs)
            return simRootfs.fileUrl(path) !== "";
        return shippedSounds.indexOf(path) >= 0;
    }

    function appDir(appId) {
        var info = appInfo(appId);
        return info && info.dir ? info.dir : "/usr/palm/applications/" + appId;
    }

    function _soundPage() {
        var ui = _headless["com.palm.systemui"];
        if (ui && ui.runScript)
            return ui;
        var pages = _webPages();
        return pages.length ? pages[0] : null;
    }

    function playSound(path, stream, loop, duration, volume, fallback) {
        var handle = "snd" + (_nextSound++);
        var e = { handle: handle, path: String(path), stream: String(stream), loop: !!loop,
                  duration: duration > 0 ? duration : -1, volume: volume === undefined ? 1 : volume,
                  fallback: fallback ? String(fallback) : "" };
        var log = soundLog.slice(-49);
        log.push(e);
        soundLog = log;
        lastSound = e;
        soundCount++;
        var page = _soundPage();
        if (page)
            page.runScript("window.__phoenixRuntime && __phoenixRuntime.sounds && __phoenixRuntime.sounds.play("
                           + JSON.stringify({ playbackId: handle, fileName: e.path, sink: _sinkFor(e.stream), loop: e.loop,
                                              duration: e.duration, volume: e.volume, fallback: e.fallback }) + ")");
        return handle;
    }

    function stopSound(handle) {
        if (!handle)
            return;
        var s = stoppedSounds.slice(-49);
        s.push(handle);
        stoppedSounds = s;
        var pages = _webPages();
        for (var i = 0; i < pages.length; ++i)
            pages[i].runScript("window.__phoenixRuntime && __phoenixRuntime.sounds && __phoenixRuntime.sounds.control("
                               + JSON.stringify(String(handle)) + ", 'stop')");
    }

    // audiod's stream for a stream class (SoundPolicy.sinkFor).
    function _sinkFor(stream) {
        return stream === "ringtones" ? "pringtones" : stream === "feedback" ? "pfeedback" : "palerts";
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
    signal bannerRequested(string appId, string text, url icon, string params, string soundClass, string soundFile, int soundDuration)

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
                          { key: key, appId: appId, name: name, height: parseInt(_param(url, "phoenixHeight")) || 200,
                            sound: _param(url, "phoenixSound"), soundClass: _param(url, "phoenixSoundClass") });
        } else {
            var info = appInfo(appId) || { title: appId, color: "#666666", glyph: "!", icon: "" };
            notifications.append({
                id: key, appId: appId, title: info.title, body: "",
                color: info.color, glyph: info.glyph, icon: _iconUrl(_param(url, "phoenixIcon"), appId),
                params: "", windowKey: key,
                clickableWhenLocked: _param(url, "phoenixClickableWhenLocked") === "1",
                ongoing: false, progress: -1
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
    readonly property var _shellOwned: ["deviceLocked", "orientation", "ime", "firstUse", "launcherLayout"]
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

    // A screen capture for the runtime to save (runtime.saveScreenshot:
    // /media/internal/screencaptures, the media index, its notification).
    // One page saves it; with none running it waits for the next.
    property var _pendingCaptures: []
    function saveScreenshot(dataUrl, appTitle) {
        var js = "window.__phoenixRuntime && __phoenixRuntime.saveScreenshot && __phoenixRuntime.saveScreenshot("
            + JSON.stringify({ data: String(dataUrl), app: appTitle || "", time: Date.now() }) + ")";
        var pages = _webPages();
        if (pages.length === 0) {
            _pendingCaptures.push(js);
            return false;
        }
        pages[0].runScript(js);
        return true;
    }

    function _pageLoaded(win) {
        while (_pendingCaptures.length > 0)
            win.runScript(_pendingCaptures.shift());
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
    // false: a site, which has none; the shell draws one (siteState, siteAction).
    function appMenu(uid) {
        var win = _windows[uid];
        if (win && win.site)
            return false;
        if (win && win.runScript)
            win.runScript("window.__phoenixRuntime && __phoenixRuntime.openAppMenu && __phoenixRuntime.openAppMenu()");
        else if (win && win.appMenuRequested)
            win.appMenuRequested();
        return true;
    }

    // A site's navigation, for the shell's SiteMenu: null for other apps.
    function siteState(uid) {
        var win = _windows[uid];
        if (!win || !win.site)
            return null;
        return { canGoBack: win.view.canGoBack, canGoForward: win.view.canGoForward, url: String(win.view.url) };
    }
    // "back", "forward", "reload", or "browser" (the page in the browser).
    function siteAction(uid, name) {
        var win = _windows[uid];
        if (!win || !win.site)
            return;
        if (name === "back") win.view.goBack();
        else if (name === "forward") win.view.goForward();
        else if (name === "reload") win.view.reload();
        else if (name === "browser") openUrl(String(win.view.url));
    }

    // ---- Launcher --------------------------------------------------------------------

    // The launcher layout as JSON; sim.qml keeps it in the settings file.
    property string launcherLayoutJson: ""
    function savedLauncherLayout() { return launcherLayoutJson; }
    function saveLauncherLayout(json) { launcherLayoutJson = json; }

    // Deleting an app closes its windows (the launcher layout keeps it out);
    // one the user installed is removed from the device, as webOS did.
    function removeApp(appId) {
        for (var i = cards.count - 1; i >= 0; --i)
            if (cards.get(i).appId === appId)
                close(cards.get(i).uid);
        for (var j = 0; j < apps.count; ++j) {
            var e = apps.get(j);
            if (e.appId === appId && e.web && e.removable) {
                _installerRequest("removeApp", { appId: e.webAppId, requestId: "" });
                break;
            }
        }
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
        // Throwing a Terminal card away hangs its shell up (SIGHUP).
        if (_simPty())
            _simPty().closeWindow(uid);
        var win = _windows[uid];
        delete _windows[uid];
        if (win)
            win.destroy();
        // Closing a headless app's last card closes the app.
        if (_headless[appId] && runningUid(appId) === "") {
            _headless[appId].destroy();
            delete _headless[appId];
        }
        // Its live activities go with it: their work ran in its pages, and
        // they cannot be swiped away.
        if (runningUid(appId) === "" && !_headless[appId])
            _clearOngoingOf(appId);
    }

    function _clearOngoingOf(appId) {
        var prefix = "ongoing:" + appId + ":";
        for (var i = notifications.count - 1; i >= 0; --i)
            if (String(notifications.get(i).id).indexOf(prefix) === 0)
                notifications.remove(i);
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
            windowKey: "", clickableWhenLocked: false,
            ongoing: false, progress: -1
        });
    }

    // An ongoing activity (a download, an install; org.webosphoenix.ongoing
    // set / clear in the runtime): one dashboard item per id that stays,
    // with its progress, until it is cleared. {id, title, body, icon?,
    // progress (0-100, -1: none), params?} or {id, clear: true}.
    // They are pinned at the top of the list, above the notifications.
    function setOngoing(appId, p) {
        var key = "ongoing:" + appId + ":" + p.id;
        var at = -1;
        for (var i = 0; i < notifications.count; ++i)
            if (notifications.get(i).id === key) { at = i; break; }
        if (p.clear) {
            if (at >= 0)
                notifications.remove(at);
            return;
        }
        var target = p.appId && appInfo(p.appId) ? p.appId : appId;
        var info = appInfo(target) || { color: "#666666", glyph: "!", icon: "" };
        var progress = typeof p.progress === "number" ? Math.max(-1, Math.min(100, p.progress)) : -1;
        var params = p.params && typeof p.params === "object" ? JSON.stringify(p.params) : "";
        if (at >= 0) {
            notifications.setProperty(at, "title", p.title || "");
            notifications.setProperty(at, "body", p.body || "");
            notifications.setProperty(at, "progress", progress);
            notifications.setProperty(at, "params", params);
            return;
        }
        var flags = [];
        for (var j = 0; j < notifications.count; ++j)
            flags.push(notifications.get(j).ongoing);
        notifications.insert(Policy.ongoingInsertIndex(flags), {
            id: key, appId: target, title: p.title || "", body: p.body || "",
            color: info.color, glyph: info.glyph, icon: p.icon ? _iconUrl(p.icon, target) : (info.icon || ""),
            params: params, windowKey: "", clickableWhenLocked: false,
            ongoing: true, progress: progress
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
