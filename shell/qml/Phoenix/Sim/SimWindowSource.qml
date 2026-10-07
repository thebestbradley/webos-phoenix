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
//                            fullScreen (enableFullScreenMode), blockScreenTimeout,
//                            statusBarColor (setWindowProperties; -1 for none)
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
//   activeCallBanner        {appId, icon, message, startTime (s)} or null: the
//                            phone's active-call banner (PalmSystem.addActiveCallBanner)
//   bannerRequested(appId, text, icon, params, soundClass, soundFile, soundDuration, bannerId),
//   bannerRemoved(appId, bannerId), bannersCleared(appId)
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
//   justTypeStart(text, done) show it with this text typed (done: once it is)
//   justTypeType(text)       type more at the end
//   justTypeAppMenu()        open or close its app menu (the status bar's
//                            "Just Type"); false when it has none yet
//   justTypeBack()           the back gesture while it is up: its app menu
//                            closes if open, else it is dismissed
//                            (justTypeDismissed)
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
// Optional, for the launcher's icon menu (Shell.iconMenuItems):
//   launchNewInstance(appId) -> uid  another window of an app whose entry
//                            has multipleInstances (New Window)
//   apps also has multipleInstances, size (bytes, App Info), and params /
//   main (Share sends a launch point's or a site's web address)
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
//   simulateIncomingMms()    a picture message (Shift+F5)
//   simulateIncomingIm()     an instant message from a buddy (Ctrl+F5)
//   openUrl(url)             open a web page in the browser (phoenix-sim --open)
//   simPty (context property, C++ SimPty): the Terminal's real shells on
//                            this computer; "pty" host messages go to it and
//                            its replies back to the window (runtime block
//                            "Terminal"); null with --no-host-shell
//   dictation                the shell's Dictation (Shell.dictation; null
//                            when it cannot record): "dictation" host
//                            messages ({op: start | stop | cancel, prompt,
//                            autoStop}) go to it and its states back to the
//                            window (runtime block "Dictation": Voice Dial)
//   localModels, speech      the shell's LocalModels and Speech (Shell.localModels,
//                            Shell.speech; localModels null without a
//                            models folder): "assistant" host messages
//                            ({op, requestId, ...}: status, download, cancel,
//                            remove, ensure, speak, stopSpeaking,
//                            speechStatus) go to them and their answers back
//                            to the page (runtime block "The Phoenix
//                            Assistant"); every page hears {changed: true}
//                            when the models change (a download's progress)
//   preferencesReported(prefs)  signal: a page set system preferences
//                            (com.webos.service.systemservice setPreferences),
//                            e.g. firstUseComplete when First Use is done
//
// Optional, for the emergency window (Shell.openEmergency) and dock mode's
// exhibitions (DockMode.qml, kind "dockmode"):
//   openSystemWindow(appId, params, kind) -> key   an app window that is no
//                            card: windowFor(key), back(key); "" if the
//                            app cannot be opened; windowFor(key).ready
//                            once its page has loaded
//   closeSystemWindow(key)
//   systemWindowClosed(key)  signal: the page closed its window
//   activateWindow(key, active)  the window came to the front of dock
//                            mode or left it ("phoenixcardactivation")
//   savedDockModePositions() -> string, saveDockModePositions(json)
//                            which exhibition each Touchstone showed
//   apps also has exhibition (appinfo.json exhibitionMode) and
//   exhibitionTitle (exhibitionModeOptions.title)
//
// Web apps (the original webOS apps, Settings, ...) come from the virtual
// webOS filesystem when phoenix-sim was built with Qt WebEngine; they
// replace the placeholder app with the same title.

import QtQuick
import Phoenix.Native
import Phoenix.Shell
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
            apps.append(Object.assign(_launcherFields(), {
                          appId: p.appId, title: p.title, color: p.color, glyph: p.glyph, tab: p.tab,
                          quickLaunch: p.quickLaunch, icon: p.icon, largeIcon: "", splashIcon: "", splashBackground: "",
                          web: false, main: "", noWindow: false,
                          orientation: "",
                          webAppId: "", params: "", dir: "",
                          // Stand-ins for apps still to come can be deleted, as
                          // downloaded apps could; the built-in ones cannot.
                          removable: true, exhibition: false, exhibitionTitle: p.title }));
        }
        Qt.callLater(_bootSystemApps);
        if (_simPty())
            _simPty().event.connect(_ptyEvent);
    }

    // A launcher entry for a web app (Rootfs::apps()). Launch points
    // (appinfo.json phoenix.launchPoints) are entries of their own: own icon,
    // title, card and launch params. Apps the user installed can be deleted.
    function _webEntry(a) {
        return Object.assign(_launcherFields(), {
                 appId: a.id, title: a.title, color: "#555c66", glyph: a.title.charAt(0),
                 tab: a.tab !== undefined ? a.tab : 0, quickLaunch: a.quickLaunch || webQuickLaunch[a.title] || 0,
                 icon: a.icon, largeIcon: a.largeIcon || "", splashIcon: a.splashIcon || "", splashBackground: a.splashBackground || "",
                 web: true, main: a.main, noWindow: !!a.noWindow,
                 orientation: a.requestedWindowOrientation || "",
                 webAppId: a.appId || a.id, params: a.params || "", dir: a.dir || "",
                 // Apps the user installed can be deleted, launch points
                 // apps added removed.
                 removable: a.dynamic ? a.removable !== false : !!a.installed, version: a.version || "",
                 page: a.page || "", dynamic: !!a.dynamic, category: a.category || "", keywords: a.keywords || "",
                 installed: !!a.installed,
                 // appinfo.json exhibitionMode (dockMode): it can be an
                 // exhibition in dock mode, under exhibitionTitle.
                 exhibition: !!a.exhibition, exhibitionTitle: a.exhibitionTitle || a.title,
                 // appinfo.json tapToShareSupported (Touch to Share).
                 tapToShare: !!a.tapToShareSupported,
                 // Several windows at once (the icon menu's New Window).
                 multipleInstances: !!a.multipleInstances || multipleInstanceApps.indexOf(a.id) >= 0,
                 // The app's files, in bytes (App Info).
                 size: a.size || 0 });
    }

    // The launcher's fields every entry has (Shell._launcherEntries,
    // LauncherLayout.pageFor): the page appinfo.json names, a launch point
    // an app added (Favorites), category and keywords ("\n"-separated);
    // and an install as it goes: installState "installing" | "failed" | "",
    // progress 0-100, pending (an app not installed yet: only its icon).
    function _launcherFields() {
        return { page: "", dynamic: false, category: "", keywords: "", installed: false,
                 installState: "", progress: -1, pending: false, installReason: "",
                 exhibition: false, exhibitionTitle: "", tapToShare: false,
                 multipleInstances: false, size: 0 };
    }

    // Apps that run in several windows at once whose appinfo.json cannot
    // say so ("multipleInstances": true, Rootfs::apps): the original
    // browser, which opens a card on every launch (BrowserApp.js:132-147).
    property var multipleInstanceApps: ["com.palm.app.browser"]

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
            // A pending icon becomes the app once it is installed (in its
            // place, so the launcher keeps it where it was).
            if (!e.web && !e.pending)
                continue;
            if (!byId[e.appId]) {
                if (!e.pending)
                    apps.remove(j);
            } else {
                var st = _installs[e.appId];
                apps.set(j, Object.assign(_webEntry(byId[e.appId]), st && st.state !== "installed"
                    ? { installState: st.state, progress: st.progress || 0, installReason: st.reason || "" } : {}));
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
            // Its windows go with it, kept alive or not; an update starts afresh.
            closeApp(String(payload.appId || ""));
            _syncWebApps();
        }
        var status = { installerResult: { requestId: payload.requestId, ok: !error, error: error }, appsVersion: appsVersion };
        // Why an app went, for com.palm.appinstaller/notifyOnChange.
        if (!error && type === "removeApp")
            status.appsCause = { appId: payload.appId, cause: payload.cause || "USER" };
        pushSystemStatus(status);
    }

    // The application manager's work for the runtime ("appManagerOp" host
    // messages, runtime.hostOp): {requestId, op, ...}; the answer goes to
    // every page as applyHostStatus {installerResult: {requestId, ok,
    // error, ...}}, and the one that asked takes it.
    function _appManagerOp(payload) {
        var inst = _simInstaller();
        var r = { requestId: payload.requestId, ok: true, error: "" };
        var changed = false;
        switch (payload.op) {
        case "addLaunchPoint": {
            var added = inst ? inst.addLaunchPoint(payload.launchPoint || {}) : { error: "Failed to save launch point" };
            if (added.error) { r.ok = false; r.error = added.error; }
            else { r.launchPointId = added.launchPointId; changed = true; }
            break;
        }
        case "removeLaunchPoint":
            r.error = inst ? inst.removeLaunchPoint(String(payload.launchPointId || "")) : "launch point folder not set";
            r.ok = r.error === "";
            changed = r.ok;
            break;
        case "rescan":
            if (inst) { inst.rescan(); changed = true; }
            else { r.ok = false; r.error = "Not available"; }
            break;
        case "capacity":
            r.freeKB = inst ? inst.freeSpaceKB() : -1;
            break;
        case "running":
            r.running = running();
            break;
        case "close":
            closeProcess(String(payload.processId || ""));
            break;
        default:
            r.ok = false;
            r.error = "Unknown op: " + payload.op;
        }
        if (changed)
            _syncWebApps();
        pushSystemStatus(changed ? { installerResult: r, appsVersion: appsVersion } : { installerResult: r });
    }

    // The browser's page pictures (SimSnapshots): a picture of the web view
    // viewId (an enyo.WebView's Chromium view in one of the windows).
    Connections {
        target: typeof simSnapshots !== "undefined" ? simSnapshots : null
        function onGrabRequested(id, viewId) { source._grabView(id, viewId); }
    }
    function _grabView(id, viewId) {
        var wins = [];
        for (var uid in _windows)
            wins.push(_windows[uid]);
        for (var h in _headless)
            wins.push(_headless[h]);
        for (var i = 0; i < wins.length; ++i) {
            var views = wins[i] && wins[i]._webViews;
            var v = views ? views[viewId] : null;
            if (v && v.width > 0 && v.height > 0) {
                v.grabToImage(function (result) { simSnapshots.finishGrab(id, result.image); });
                return;
            }
        }
        // No such view: the request times out and fails (SimSnapshots).
    }

    // A launch point the user removed in the launcher (Remove Shortcut?).
    function removeLaunchPoint(id) {
        var inst = _simInstaller();
        if (!inst || inst.removeLaunchPoint(id) !== "")
            return false;
        _syncWebApps();
        pushSystemStatus({ appsVersion: appsVersion });
        return true;
    }

    // ---- Installs as they go (the launcher's pending icons) ------------------------
    // "installStatus" host messages from whichever page installs (the
    // runtime's installer, the Marketplace): {appId, state, progress,
    // title, icon, reason, retry, open}. An app not installed yet gets an
    // entry of its own (pending), for its icon; one being updated keeps
    // its entry, with the badge. Pages hear what is pending
    // (applyHostStatus {installs}, installProgressQuery).
    property var _installs: ({})

    function _entryIndex(appId) {
        for (var i = 0; i < apps.count; ++i)
            if (apps.get(i).appId === appId)
                return i;
        return -1;
    }

    function _installStatus(payload) {
        var id = String(payload.appId || "");
        if (!id)
            return;
        var all = Object.assign({}, _installs);
        var i = _entryIndex(id);
        if (payload.state === "installed") {
            delete all[id];
            if (i >= 0) {
                if (apps.get(i).pending)
                    apps.remove(i);   // not installed after all (the list says)
                else
                    apps.set(i, { installState: "", progress: -1, installReason: "" });
            }
        } else {
            var st = Object.assign({}, all[id] || {}, payload);
            all[id] = st;
            var icon = st.icon ? (/^(data|https?|file):/.test(st.icon) ? st.icon : _iconUrl(st.icon, id)) : "";
            if (i < 0) {
                apps.append(Object.assign(_launcherFields(), {
                    appId: id, title: st.title || id, color: "#555c66", glyph: (st.title || id).charAt(0),
                    tab: 0, quickLaunch: 0, icon: icon, largeIcon: "", splashIcon: "", splashBackground: "",
                    web: false, main: "", noWindow: false, orientation: "", webAppId: id, params: "", dir: "",
                    removable: false, version: "", installed: true, pending: true,
                    installState: st.state, progress: st.progress || 0, installReason: st.reason || "" }));
            } else {
                var change = { installState: st.state, progress: st.progress || 0, installReason: st.reason || "" };
                if (apps.get(i).pending) {
                    if (st.title) change.title = st.title;
                    if (icon) change.icon = icon;
                }
                apps.set(i, change);
            }
        }
        _installs = all;
        pushSystemStatus({ installs: all });
    }

    // What the launcher shows for an app being installed: {state,
    // progress, title, reason, retry, open}, or null.
    function installInfo(appId) {
        return _installs[appId] || null;
    }

    // The failed install's Try Again: as it was asked (the Marketplace's
    // install, or the installer's with the same package), in a page that
    // runs the runtime.
    function retryInstall(appId) {
        var st = _installs[appId];
        if (!st || !st.retry || !st.retry.uri)
            return false;
        _installStatus({ appId: appId, state: "installing", progress: 0, reason: "" });
        lunaCall(st.retry.uri, st.retry.params || {}, function (reply) {
            if (reply === null)
                _installStatus({ appId: appId, state: "failed", reason: "Nothing can install it now" });
        });
        return true;
    }

    // The failed install's Remove: its icon goes; an app installed before
    // (a failed update) is removed.
    function dismissInstall(appId) {
        var i = _entryIndex(appId);
        var installed = i >= 0 && !apps.get(i).pending && apps.get(i).removable;
        _installStatus({ appId: appId, state: "installed" });
        if (installed)
            removeApp(appId);
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
        cards.insert(at, { uid: uid, appId: appId, title: titleText, groupId: groupId, fullScreen: false, blockScreenTimeout: false, statusBarColor: -1,
                           orientation: _windowOrientation(info.orientation) });
        _pidOf(appId);
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
        var pageKey = "p" + (_nextPageKey++);
        win.hostMessage.connect(function(type, payload) {
            if (!source._deviceMessage(pageKey, appId, type, payload))
                source._hostMessage(appId, uid, type, payload);
        });
        if (win.loaded)
            win.loaded.connect(function() { source._pageLoaded(win); });
        // A page gone lets go of what it held.
        if (win.gone)
            win.gone.connect(function() { source._pageGone(pageKey); });
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
        } else if (type === "browserData") {
            // The browser's Clear Cookies and Clear Cache (com.palm.browserServer):
            // the page views' profile (phoenix-sim's simBrowser).
            if (typeof simBrowser !== "undefined" && simBrowser !== null) {
                if (payload.op === "clearCookies")
                    simBrowser.clearCookies();
                else if (payload.op === "clearCache")
                    simBrowser.clearCache();
            }
        } else if (type === "banner") {
            // A banner only scrolls by; it leaves nothing in the dashboard
            // (PalmSystem.addBannerMessage).
            var bp = payload.params;
            var bs = _soundArgs(payload);
            bannerRequested(appId, payload.message || "", _iconUrl(payload.icon, appId),
                            bp === undefined || bp === null ? "" : typeof bp === "string" ? bp : JSON.stringify(bp),
                            bs[0], bs[1], bs[2], payload.id ? String(payload.id) : "");
        } else if (type === "removeBanner") {
            // PalmSystem.removeBannerMessage(id) / clearBannerMessages().
            bannerRemoved(appId, payload.id ? String(payload.id) : "");
        } else if (type === "clearBanners") {
            bannersCleared(appId);
        } else if (type === "activeCallBanner") {
            // PalmSystem.add/update/removeActiveCallBanner: one at a time,
            // the app that added it changes or removes it.
            if (payload.op === "add" && activeCallBanner === null) {
                activeCallBanner = { appId: appId, icon: _iconUrl(payload.icon, appId), message: payload.message || "",
                                     startTime: payload.startTime || 0 };
            } else if (payload.op === "update" && activeCallBanner !== null && activeCallBanner.appId === appId) {
                activeCallBanner = { appId: appId, icon: _iconUrl(payload.icon, appId), message: payload.message || "",
                                     startTime: payload.startTime || 0 };
            } else if (payload.op === "remove" && activeCallBanner !== null && activeCallBanner.appId === appId) {
                activeCallBanner = null;
            }
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
            // PalmSystem.activate: the app brings its card to the front; a
            // window kept alive without one gets its card back.
            if (cardIndex(uid) < 0 && _parked[uid])
                _unpark(uid);
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
            // screen stays on while the card is in front (Display.blocked);
            // {statusBarColor}: the tablet's status bar while it is maximized.
            var wi = cardIndex(uid);
            if (wi >= 0 && payload.blockScreenTimeout !== undefined)
                cards.setProperty(wi, "blockScreenTimeout", !!payload.blockScreenTimeout);
            if (wi >= 0 && typeof payload.statusBarColor === "number")
                cards.setProperty(wi, "statusBarColor", payload.statusBarColor);
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
        } else if (type === "dictation") {
            if (uid !== "")
                _dictationRequest(uid, payload || {});
        } else if (type === "assistant") {
            _assistantRequest(appId, uid, payload || {});
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
            rebootRequested(payload.reason ? String(payload.reason) : "");
        } else if (type === "shutdown") {
            shutdownRequested(payload.reason ? String(payload.reason) : "");
        } else if (type === "restartUi") {
            restartUiRequested();
        } else if (type === "erase") {
            // The device was erased (com.palm.storage erase/EraseAll, Wipe;
            // Settings' Full Erase): it restarts into First Use.
            eraseRequested();
        } else if (type === "enterMSM") {
            // com.palm.storage diskmode/enterMSM, for the simulated storaged.
            enterMSMRequested(!!payload.enterIMasq);
        } else if (type === "debugOverlay") {
            // com.palm.systemmanager enableFpsCounter / enableTouchPlot.
            debugOverlayRequested(payload);
        } else if (type === "sceneTransition") {
            // PalmSystem.prepare/run/cancelSceneTransition: the card does
            // the scene change (Card.prepareSceneTransition).
            if (uid !== "" && cardIndex(uid) >= 0)
                sceneTransitionRequested(uid, String(payload.op || ""), String(payload.transition || ""), !!payload.isPop);
            else if (uid !== "" && payload.op === "prepare")
                sceneTransitionPrepared(uid);
        } else if (type === "touchToShare") {
            _touchToShareRequest(appId, uid, payload || {});
        } else if (type === "progressAnimation") {
            // com.palm.systemmanager runProgressAnimation.
            progressAnimationRequested(String(payload.type || ""), String(payload.state || ""));
        } else if (type === "installApp" || type === "removeApp") {
            _installerRequest(type, payload);
        } else if (type === "appManagerOp") {
            _appManagerOp(payload);
        } else if (type === "installStatus") {
            _installStatus(payload);
        } else if (type === "keepAlive") {
            // PalmSystem.keepAlive(on): the app stays loaded when its last
            // card closes (headless apps such as Calendar ask for it).
            // Per window: Email marks its main card "cachable off-screen"
            // (MailApp.js), Calendar its app window (AppView.js).
            if (uid !== "") {
                var ka = Object.assign({}, _keepAliveAsked);
                if (payload.on)
                    ka[uid] = true;
                else
                    delete ka[uid];
                _keepAliveAsked = ka;
            }
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
            // Dock mode's own (the dockwallpaper preference).
            if ("dockWallpaperFile" in payload)
                st.dockWallpaperUrl = payload.dockWallpaperFile
                        ? (resolveDevicePath(payload.dockWallpaperFile) || payload.dockWallpaperUrl || "") : "";
            systemStatusReported(st);
        }
    }

    signal systemStatusReported(var status)
    signal preferencesReported(var prefs)
    signal launcherLayoutRestored(string json)
    // The page asked the device to restart (com.palm.power/shutdown/machineReboot),
    // and why ("System update" for an update's Install Now).
    signal rebootRequested(string reason)
    // The power menu's Shut Down (com.palm.power/shutdown/machineOff) and
    // Luna Restart (org.webosphoenix.system/restartUi).
    signal shutdownRequested(string reason)
    signal restartUiRequested
    // The device was erased; it restarts into First Use.
    signal eraseRequested
    // USB drive mode was asked for (com.palm.storage diskmode/enterMSM).
    signal enterMSMRequested(bool enterIMasq)
    // enableFpsCounter {enable, reset, dump} as {fpsCounter: {...}};
    // enableTouchPlot {collection, trails, crosshairs} as {touchPlot: {...}}.
    signal debugOverlayRequested(var request)
    // runProgressAnimation {type, state}.
    signal progressAnimationRequested(string type, string state)

    // ---- Scene transitions ---------------------------------------------------------
    // A page's PalmSystem.prepareSceneTransition(isPop) ("prepare"),
    // runSceneTransition(type, isPop) ("run", type "zoom-fade" or
    // "cross-fade") and cancelSceneTransition() ("cancel"), for its card.
    signal sceneTransitionRequested(string uid, string op, string transition, bool isPop)
    // The card has its snapshot: the page may change the scene.
    property string lastSceneTransitionPrepared: ""
    function sceneTransitionPrepared(uid) {
        lastSceneTransitionPrepared = uid;
        var w = _windows[uid];
        if (w && w.runScript)
            w.runScript("window.__phoenixRuntime && __phoenixRuntime.sceneTransitionPrepared && __phoenixRuntime.sceneTransitionPrepared()");
    }

    // ---- Touch to Share --------------------------------------------------------------
    // The TouchPad's Touch to Share, with a simulated phone nearby
    // (phoenix-sim Shift+F7 / Ctrl+F7, --touch-to-share). On the device the
    // tap2share service (com.palm.stservice, not in the open-source release)
    // ran it:
    //  1. a phone in range: com.palm.systemmanager/touchToShareDeviceInRange
    //     {inRange} starts or stops the glow (SystemService.cpp:5143-5215;
    //     TouchToShareGlow.cpp);
    //  2. the phone touches the device: the app in front, if its appinfo.json
    //     has "tapToShareSupported", is relaunched with {sendDataToShare}
    //     and answers with com.palm.stservice/shareData {data: {target,
    //     type, mimetype}} (the Isis browser, BrowserApp.js:137-139);
    //  3. once it is sent, touchToShareAppUrlTransferred {appid}
    //     (SystemService.cpp:5224-5296): if that app's card is maximized it
    //     is minimized and a ghost of it is thrown off the top of the screen
    //     (CardWindowManagerStates.cpp:485-492, CardWindowManager.cpp:2915-2957).
    // The shell plays tap_to_share.mp3 (shipped with LunaSysMgr; its caller,
    // the service, was not released) as the transfer completes.
    property bool touchToShareInRange: false
    // What the simulated phone received last: {appId, data} (or null).
    property var touchToShareReceived: null
    // An app's data was sent: its card is thrown (CardView).
    signal touchToShareTransferred(string appId)

    function simulateTouchToShareDevice(inRange) {
        touchToShareInRange = !!inRange;
    }
    // The phone touches the device: the app in front is asked for what to
    // share. Returns the app asked, or "" (nothing in front that can share).
    function simulateTouchToShareTap() {
        touchToShareInRange = true;
        var uid = focusedUid;
        var i = cardIndex(uid);
        if (i < 0)
            return "";
        var appId = cards.get(i).appId;
        var info = appInfo(appId);
        var w = _windows[uid];
        if (!info || !info.tapToShare || !w || !w.relaunch)
            return "";
        w.relaunch({ sendDataToShare: true });
        return appId;
    }

    function _touchToShareRequest(appId, uid, p) {
        if (p.op === "inRange") {
            touchToShareInRange = !!p.inRange;
        } else if (p.op === "transferred") {
            touchToShareTransferred(String(p.appId || ""));
        } else if (p.op === "shareData") {
            // The simulated phone takes it; the transfer completes.
            touchToShareReceived = { appId: appId, data: p.data || {} };
            console.info("Touch to Share: " + appId + " sent " + JSON.stringify(p.data || {}));
            touchToShareTransferred(appId);
        }
    }

    // A /storaged signal (the simulated storage daemon's, SimStorage.qml)
    // for every page's com.palm.bus/signal/addmatch listeners
    // (luna-systemui's StoragedService.js).
    function storagedSignal(method, payload) {
        var js = "window.__phoenixRuntime && __phoenixRuntime.storagedSignal && __phoenixRuntime.storagedSignal("
            + JSON.stringify(method) + ", " + JSON.stringify(payload || {}) + ")";
        var pages = _webPages();
        for (var i = 0; i < pages.length; ++i)
            pages[i].runScript(js);
    }

    // A /com/palm/display signal for every page's com.palm.bus/signal/addmatch
    // listeners: powerKeyPressed {showDialog: true} (Power held; luna-systemui
    // opens its power menu, PowerdService.js).
    function displaySignal(method, payload) {
        var js = "window.__phoenixRuntime && __phoenixRuntime.displaySignal && __phoenixRuntime.displaySignal("
            + JSON.stringify(method) + ", " + JSON.stringify(payload || {}) + ")";
        var pages = _webPages();
        for (var i = 0; i < pages.length; ++i)
            pages[i].runScript(js);
        displaySignals.push(method);
    }
    // The display signals sent, for the tests.
    property var displaySignals: []

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
        // The share sheet over the launcher: only its sheet is drawn.
        if (kind === "share" && info.web)
            win.transparent = true;
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
    signal bannerRequested(string appId, string text, url icon, string params, string soundClass, string soundFile, int soundDuration, string bannerId)
    signal bannerRemoved(string appId, string bannerId)
    signal bannersCleared(string appId)
    property var activeCallBanner: null

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

    // How much memory is left (MemoryMonitor); phoenix-sim --low-memory
    // makes it low.
    property MemoryMonitor memory: MemoryMonitor {
        forceLow: typeof simLowMemory !== "undefined" && simLowMemory === true
    }

    // Launched even then: a call, its contacts, a text (luna.conf [Memory]
    // AppsToAllowInLowMemory), and their Phoenix counterparts.
    readonly property var appsAllowedInLowMemory: ["com.palm.app.phone", "com.palm.app.contacts", "com.palm.app.messaging",
                                                   "org.webosphoenix.phone", "org.webosphoenix.messaging"]

    // "Sorry, Too Many Cards", once, in the popup alert's place
    // (MemoryAlert.qml, 160 px tall); OK closes it.
    readonly property string memoryAlertKey: "memoryalert"
    Component {
        id: memoryAlertComponent
        MemoryAlert {}
    }
    function showMemoryAlert() {
        if (_windows[memoryAlertKey])
            return;
        var alert = memoryAlertComponent.createObject(source, { visible: false });
        alert.okButtonPressed.connect(function () { source.closeAlert(source.memoryAlertKey); });
        _windows[memoryAlertKey] = alert;
        var queued = [];
        for (var i = 0; i < alerts.count; ++i)
            queued.push({ appId: alerts.get(i).appId, name: alerts.get(i).name });
        alerts.insert(Policy.insertIndex(queued, "com.palm.systemui", "memoryalert"),
                      { key: memoryAlertKey, appId: "com.palm.systemui", name: "memoryalert", height: 160,
                        sound: "", soundClass: "" });
    }

    // "Dismissing Cards", the first time the user is in card view
    // (CardWindowManager::firstCardAlert, CardWindowManager.cpp:1167-1187;
    // DismissCardTutorial.qml, 170 px tall, in the popup alert's place); OK
    // closes it. It is marked done as it is shown (markFirstCardDone: the
    // marker file /var/luna/preferences/used-first-card), so it never shows
    // again. phoenix-sim keeps the mark in simSettings "cards/usedFirstCard";
    // without one (tests) it counts as done.
    property bool dismissedFirstCard: true
    // It was shown: remember that (sim.qml).
    signal firstCardAlertShown
    readonly property string dismissCardTutorialKey: "dismisscardtutorial"
    Component {
        id: dismissCardTutorialComponent
        DismissCardTutorial {}
    }
    function firstCardAlert() {
        if (dismissedFirstCard)
            return;
        dismissedFirstCard = true;
        firstCardAlertShown();
        if (_windows[dismissCardTutorialKey])
            return;
        var alert = dismissCardTutorialComponent.createObject(source, { visible: false });
        alert.okButtonPressed.connect(function () { source.closeAlert(source.dismissCardTutorialKey); });
        _windows[dismissCardTutorialKey] = alert;
        var queued = [];
        for (var i = 0; i < alerts.count; ++i)
            queued.push({ appId: alerts.get(i).appId, name: alerts.get(i).name });
        alerts.insert(Policy.insertIndex(queued, "com.palm.systemui", dismissCardTutorialKey),
                      { key: dismissCardTutorialKey, appId: "com.palm.systemui", name: dismissCardTutorialKey, height: 170,
                        sound: "", soundClass: "" });
    }

    // "USB Drive connection failed": storaged could not take the drive
    // (WindowServerLuna::slotBrickModeFailed, uiComponents/MsmEntryFailed;
    // 160 px tall in the popup alert's place); OK closes it.
    readonly property string msmEntryFailedKey: "msmentryfailed"
    Component {
        id: msmEntryFailedComponent
        MsmEntryFailedAlert {}
    }
    function showMsmEntryFailedAlert() {
        if (_windows[msmEntryFailedKey])
            return;
        var alert = msmEntryFailedComponent.createObject(source, { visible: false });
        alert.okButtonPressed.connect(function () { source.closeAlert(source.msmEntryFailedKey); });
        _windows[msmEntryFailedKey] = alert;
        var queued = [];
        for (var i = 0; i < alerts.count; ++i)
            queued.push({ appId: alerts.get(i).appId, name: alerts.get(i).name });
        alerts.insert(Policy.insertIndex(queued, "com.palm.systemui", "msmentryfailed"),
                      { key: msmEntryFailedKey, appId: "com.palm.systemui", name: "msmentryfailed", height: 160,
                        sound: "", soundClass: "" });
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

    // ---- Launch at boot and keep alive (luna.conf) -----------------------------------
    // The original apps by their webOS ids, with the Phoenix apps that
    // stand in for them (Phone, Messaging, Camera, Photos, Music).
    readonly property var _palmIds: ({
        "com.palm.app.phone": "org.webosphoenix.phone", "com.palm.app.messaging": "org.webosphoenix.messaging",
        "com.palm.app.camera": "org.webosphoenix.camera", "com.palm.app.photos": "org.webosphoenix.photos",
        "com.palm.app.musicplayer": "org.webosphoenix.music"
    })
    function _phoenixIds(ids) {
        return ids.map(function (id) { return source._palmIds[id] || id; });
    }
    // [LaunchAtBoot]: started at boot without a card, with the launch
    // params {launchedAtBoot: true} (the apps open nothing then:
    // Email's Launch.js relaunch, Calendar's App.handleLaunchParams), so
    // they come up at once when launched. Phones: conf/luna.conf:98-99
    // (the Pre and Pre 2; the Pre 3 kept only phone and email,
    // luna-windsornot.conf:18-19); the TouchPad: luna-topaz.conf:18-19.
    readonly property var launchAtBootApps: _phoenixIds(Theme.tablet
        ? ["com.palm.app.phone", "com.palm.app.email", "com.palm.app.calendar", "com.palm.app.messaging"]
        : ["com.palm.app.phone", "com.palm.app.email", "com.palm.app.calendar", "com.palm.app.messaging", "com.palm.app.camera"])
    // [KeepAlive]: closing the app's last card keeps it running without
    // one; launching it again brings that back (luna.conf:101-102; the
    // TouchPad's list, luna-topaz.conf:21-22, replaces the phones').
    readonly property var keepAliveApps: _phoenixIds(Theme.tablet
        ? ["com.palm.app.email", "com.palm.app.calendar", "com.palm.app.messaging", "com.palm.app.photos", "com.palm.app.musicplayer"]
        : ["com.palm.app.phone"])
    // [KeepAliveUntilMemPressure]: the same until memory runs low
    // (luna.conf:104-105, both).
    readonly property var keepAliveUntilMemoryPressureApps: ["com.palm.app.browser"]

    // Windows kept alive without a card: uid -> {win, appId, title,
    // orientation}. Their apps still run (running()); a launch, or the
    // page activating its window, brings the card back.
    property var _parked: ({})
    // Windows whose page asked to be kept (PalmSystem.keepAlive): uid -> true.
    property var _keepAliveAsked: ({})
    // Process ids, as WebAppMgr gave them: appId -> "1001", ...
    property var _pids: ({})
    property int _nextPid: 1000

    function _bootSystemApps() {
        for (var i = 0; i < bootApps.length; ++i) {
            var info = appInfo(bootApps[i]);
            if (info && info.web && !_headless[bootApps[i]])
                _headless[bootApps[i]] = _webWindow(bootApps[i], info.main, "");
        }
        _systemUiPage = _headless["com.palm.systemui"] || null;
        // Not when a demo scene or a test sets the scene up.
        if (bootAppsEnabled)
            for (var j = 0; j < launchAtBootApps.length; ++j)
                launchAtBoot(launchAtBootApps[j]);
    }
    // phoenix-sim starts the launch-at-boot apps (sim.qml turns this off
    // for --scene and screenshots of a set scene).
    property bool bootAppsEnabled: false

    // Start an app without a card: a headless app's page, or an app's
    // window kept ready for its first launch.
    function launchAtBoot(appId) {
        var info = appInfo(appId);
        if (!info || !info.web || runningUid(appId) !== "" || _headless[appId] || _parkedUid(appId) !== "")
            return false;
        var url = mainUrl(appId, { launchedAtBoot: true });
        if (info.noWindow) {
            _headless[appId] = _webWindow(appId, url, "");
        } else {
            var uid = "w" + (_nextUid++);
            var win = _webWindow(appId, url, uid);
            win.visible = false;
            _windows[uid] = win;
            _park(uid, { appId: appId, title: info.title, orientation: _windowOrientation(info.orientation) });
        }
        _pidOf(appId);
        return true;
    }

    function _pidOf(appId) {
        if (!_pids[appId]) {
            var p = Object.assign({}, _pids);
            p[appId] = String(++_nextPid);
            _pids = p;
        }
        return _pids[appId];
    }
    function _parkedUid(appId) {
        var found = "";
        for (var uid in _parked)
            if (_parked[uid].appId === appId)
                found = uid;   // the last one kept
        return found;
    }
    function _park(uid, card) {
        var win = _windows[uid];
        if (win) {
            win.visible = false;
            win.parent = source;
        }
        var p = Object.assign({}, _parked);
        p[uid] = card;
        _parked = p;
    }
    // Bring a kept window back as a card, in front.
    function _unpark(uid) {
        var card = _parked[uid];
        if (!card)
            return "";
        var p = Object.assign({}, _parked);
        delete p[uid];
        _parked = p;
        cards.insert(cards.count, { uid: uid, appId: card.appId, title: card.title, groupId: newGroupId(), fullScreen: false,
                                    blockScreenTimeout: false, statusBarColor: -1, orientation: card.orientation || "free" });
        return uid;
    }
    // Whether closing this card keeps its window: its page asked
    // (PalmSystem.keepAlive), or it is the last card of an app kept alive
    // (not a headless one, whose page is what stays).
    function _keepsWindow(uid, appId, info) {
        if (_keepAliveAsked[uid])
            return true;
        if (!info || info.noWindow || runningUid(appId) !== "")
            return false;
        if (keepAliveApps.indexOf(appId) >= 0)
            return true;
        return keepAliveUntilMemoryPressureApps.indexOf(appId) >= 0 && !memory.low;
    }
    // A headless app's page stays when its last card closes if the app is
    // kept alive, or one of its windows is.
    function _keepsHeadless(appId) {
        return keepAliveApps.indexOf(appId) >= 0 || _parkedUid(appId) !== "";
    }

    // Memory runs low: the apps kept only until then go (as WebAppMgr
    // closed KeepAliveUntilMemPressure apps).
    Connections {
        target: source.memory
        function onChanged() {
            if (!source.memory.low)
                return;
            for (var uid in source._parked)
                if (source.keepAliveUntilMemoryPressureApps.indexOf(source._parked[uid].appId) >= 0)
                    source._dropParked(uid);
        }
    }
    function _dropParked(uid) {
        var card = _parked[uid];
        if (!card)
            return;
        var p = Object.assign({}, _parked);
        delete p[uid];
        _parked = p;
        var ka = Object.assign({}, _keepAliveAsked);
        delete ka[uid];
        _keepAliveAsked = ka;
        var win = _windows[uid];
        delete _windows[uid];
        if (win)
            win.destroy();
        _appGone(card.appId);
    }
    // The app has nothing left running: its process id, live activities
    // and active-call banner go.
    function _appGone(appId) {
        if (runningUid(appId) !== "" || _headless[appId] || _parkedUid(appId) !== "")
            return;
        if (_pids[appId]) {
            var p = Object.assign({}, _pids);
            delete p[appId];
            _pids = p;
        }
        _clearOngoingOf(appId);
        if (activeCallBanner !== null && activeCallBanner.appId === appId)
            activeCallBanner = null;
    }

    // The apps running (applicationManager/running): with cards, headless,
    // or kept alive; [{id, processid}].
    function running() {
        var ids = [], seen = {};
        function add(id) { if (id && !seen[id]) { seen[id] = true; ids.push(id); } }
        for (var h in _headless)
            add(h);
        for (var i = 0; i < cards.count; ++i)
            add(cards.get(i).appId);
        for (var uid in _parked)
            add(_parked[uid].appId);
        return ids.map(function (id) { return { id: id, processid: source._pidOf(id) }; });
    }

    // Close an app: its cards, kept windows and headless page
    // (applicationManager/close, an update or removal).
    function closeApp(appId) {
        if (!appId)
            return;
        for (var i = cards.count - 1; i >= 0; --i)
            if (cards.get(i).appId === appId || cards.get(i).webAppId === appId)
                close(cards.get(i).uid, true);
        for (var uid in _parked)
            if (_parked[uid].appId === appId)
                _dropParked(uid);
        if (_headless[appId]) {
            _headless[appId].destroy();
            delete _headless[appId];
        }
        _appGone(appId);
    }
    function closeProcess(processId) {
        for (var id in _pids)
            if (_pids[id] === processId)
                closeApp(id);
    }
    // The system UI's page: loaded, and how far (0-100) it has; phoenix-sim's
    // boot animation waits for it.
    property var _systemUiPage: null
    property bool systemUiLoaded: false
    readonly property int systemUiProgress: systemUiLoaded ? 100
        : _systemUiPage && _systemUiPage.view ? _systemUiPage.view.loadProgress : 0

    // phoenix-sim: the battery and charger (runtime setPower in every page,
    // so luna-systemui's powerd listeners hear it).
    function simulatePower(changes) {
        var js = "window.__phoenixRuntime && __phoenixRuntime.setPower && __phoenixRuntime.setPower(" + JSON.stringify(changes) + ")";
        var pages = _webPages();
        for (var i = 0; i < pages.length; ++i)
            pages[i].runScript(js);
    }

    // ---- LunaSysMgr's device services (Phoenix.Shell DeviceServices) ---------------
    // Each page's runtime answers com.palm.display, .keys, .vibrate and
    // .ambientLightSensor; the shell tells every page what the display, the
    // keys, the switches and the light do (deviceEvent), and the pages ask
    // the shell (host messages displayState, displayHolds, vibrate). What a
    // page holds (requestBlock, powerKeyBlock, ...) ends with the page.

    signal displayStateRequested(string state)
    signal vibrationRequested(var request)
    // Every page's holds added up: {requestBlock, powerKeyBlock, proximity, alsDisabled}.
    property var displayHolds: ({ requestBlock: 0, powerKeyBlock: 0, proximity: 0, alsDisabled: 0 })
    property var _holdsByPage: ({})      // page key -> its holds
    property var _vibrationsByPage: ({})  // page key -> [ids of its endless vibrations]
    property var _deviceState: ({})       // the last display, switches, light and holds, for pages that load later
    property int _nextPageKey: 1

    function deviceEvent(ev) {
        var st = Object.assign({}, _deviceState);
        for (var k in ev)
            if (k === "display" || k === "switches" || k === "light" || k === "holds")
                st[k] = Object.assign({}, st[k] || {}, ev[k]);
        // A key's switch state stays for later pages too.
        if (ev.key && (ev.key.category === "/switches" || ev.key.category === "/headset")
                && (ev.key.state === "up" || ev.key.state === "down") && ev.key.key !== "headset_button") {
            st.switches = Object.assign({}, st.switches || {});
            st.switches[ev.key.key] = ev.key.state;
        }
        _deviceState = st;
        _toPages("window.__phoenixRuntime && __phoenixRuntime.devices && __phoenixRuntime.devices.hostEvent("
                 + JSON.stringify(ev) + ")");
    }

    function _toPages(js) {
        var pages = _webPages();
        for (var i = 0; i < pages.length; ++i)
            pages[i].runScript(js);
    }

    // Returns whether the message was the device services'.
    function _deviceMessage(pageKey, appId, type, payload) {
        if (type === "displayState") {
            displayStateRequested(String(payload.state || ""));
        } else if (type === "displayHolds") {
            var h = Object.assign({}, _holdsByPage);
            h[pageKey] = { requestBlock: payload.requestBlock | 0, powerKeyBlock: payload.powerKeyBlock | 0,
                           proximity: payload.proximity | 0, alsDisabled: payload.alsDisabled | 0 };
            _holdsByPage = h;
            _sumHolds();
        } else if (type === "vibrate") {
            var v = Object.assign({}, _vibrationsByPage);
            var ids = (v[pageKey] || []).filter(function (id) { return id !== payload.id; });
            if (payload.on)
                ids.push(payload.id);
            v[pageKey] = ids;
            _vibrationsByPage = v;
            vibrationRequested(payload);
        } else {
            return false;
        }
        return true;
    }

    function _pageGone(pageKey) {
        if (_holdsByPage[pageKey]) {
            var h = Object.assign({}, _holdsByPage);
            delete h[pageKey];
            _holdsByPage = h;
            _sumHolds();
        }
        var ids = _vibrationsByPage[pageKey] || [];
        if (ids.length > 0) {
            var v = Object.assign({}, _vibrationsByPage);
            delete v[pageKey];
            _vibrationsByPage = v;
            for (var i = 0; i < ids.length; ++i)
                vibrationRequested({ id: ids[i], on: false });
        }
    }

    function _sumHolds() {
        var sum = { requestBlock: 0, powerKeyBlock: 0, proximity: 0, alsDisabled: 0 };
        for (var p in _holdsByPage)
            for (var k in sum)
                sum[k] += _holdsByPage[p][k] || 0;
        if (JSON.stringify(sum) === JSON.stringify(displayHolds))
            return;
        displayHolds = sum;
        deviceEvent({ holds: sum });
    }

    // What the user changed while no web page was running, for the next
    // page that loads (pages share their state through the runtime's store).
    property var _pendingStatus: null

    // writer: whether this page stores the change (runtime applyHostStatus):
    // one page does, so pages do not write their copies of the shared state
    // over one another (or over a setting the user just changed).
    function _statusScript(changes, writer) {
        return "window.__phoenixRuntime && __phoenixRuntime.applyHostStatus && __phoenixRuntime.applyHostStatus("
               + JSON.stringify(changes) + ", " + JSON.stringify({ writer: writer !== false }) + ")";
    }
    // The page that stores the shell's changes: the system UI page, which
    // runs as long as the shell does, else the first page.
    function _writerPage() {
        var pages = _webPages();
        return _systemUiPage && pages.indexOf(_systemUiPage) >= 0 ? _systemUiPage : (pages[0] || null);
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
    readonly property var _shellOwned: ["deviceLocked", "orientation", "ime", "firstUse", "launcherLayout", "gestureArea", "dockMode",
                                        "debugOverlays", "usbHost", "gamepads", "usbDrives", "formFactor"]
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
        var writer = _writerPage();
        for (var i = 0; i < pages.length; ++i)
            pages[i].runScript(_statusScript(changes, pages[i] === writer));
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
        if (win === _systemUiPage)
            systemUiLoaded = true;
        while (_pendingCaptures.length > 0)
            win.runScript(_pendingCaptures.shift());
        var writer = _writerPage();
        var writes = !writer || win === writer;
        if (_pendingStatus) {
            // Kept until the page that stores it has it.
            win.runScript(_statusScript(_pendingStatus, writes));
            if (writes)
                _pendingStatus = null;
        }
        if (Object.keys(_shellStatus).length > 0)
            win.runScript(_statusScript(_shellStatus, writes));
        if (Object.keys(_deviceState).length > 0)
            win.runScript("window.__phoenixRuntime && __phoenixRuntime.devices && __phoenixRuntime.devices.hostEvent("
                          + JSON.stringify(_deviceState) + ")");
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

    // ---- Dock mode -----------------------------------------------------------------

    // Which exhibition each Touchstone showed last (DockModePositionManager's
    // knownPucks, /var/palm/user-exhibition-apps.json), as JSON; sim.qml
    // keeps it in the settings file.
    property string dockModePositionsJson: ""
    function savedDockModePositions() { return dockModePositionsJson; }
    function saveDockModePositions(json) { dockModePositionsJson = json; }

    // An exhibition's window came to the front of dock mode or left it
    // (DockModeWindow::focusEvent): the page hears it as a card coming to
    // the front ("phoenixcardactivation").
    function activateWindow(key, active) {
        var w = _windows[key];
        if (w && w.runScript)
            w.runScript("window.__phoenixRuntime && __phoenixRuntime.cardActivated && __phoenixRuntime.cardActivated(" + !!active + ")");
    }

    // Deleting an app closes its windows (the launcher layout keeps it out);
    // one the user installed is removed from the device, as webOS did.
    function removeApp(appId) {
        for (var j = 0; j < apps.count; ++j) {
            var e = apps.get(j);
            // A launch point an app added goes; the app stays.
            if (e.appId === appId && e.dynamic) {
                removeLaunchPoint(appId);
                return;
            }
        }
        for (var i = cards.count - 1; i >= 0; --i)
            if (cards.get(i).appId === appId)
                close(cards.get(i).uid, true);
        for (j = 0; j < apps.count; ++j) {
            e = apps.get(j);
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

    // done (optional) is called once the page shows text.
    function justTypeStart(text, done) {
        var win = justTypeWindow();
        if (!win)
            return;
        var js = _justTypeScript("jt.forceFocus();" + _justTypeSetText(JSON.stringify(text)));
        _runWhenLoaded(win, js, !_justTypeLoaded, done);
    }

    // More text typed at the end of the search.
    function justTypeType(text) {
        if (!_justType || !_justTypeLoaded)
            return;
        _justType.runScript(_justTypeScript(_justTypeSetText("jt.$.searchField.getValue()+" + JSON.stringify(text))));
    }

    // The search field's text set to the expression v, the cursor after it.
    // The field is an editable div (a RichText): setValue replaces its
    // content and leaves the cursor at its start, so what was typed next
    // went in front ("palm" came out "almp").
    function _justTypeSetText(v) {
        return "var v=" + v + ";var f=jt.$.searchField;f.setValue(v);"
               + "var n=f.$.input&&f.$.input.hasNode();"
               + "if(n&&n.setSelectionRange){n.setSelectionRange(v.length,v.length);}"
               + "else if(n){var r=document.createRange();r.selectNodeContents(n);r.collapse(false);"
               + "var sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);}"
               + "jt.onValueChange(null,null,v);";
    }

    function justTypeStop() {
        if (_justType && _justTypeLoaded)
            _justType.runScript(_justTypeScript("jt.justTypeDeactivated();"));
    }

    // Just Type's app menu (luna-applauncher JustType.js: Preferences, which
    // launches com.palm.app.searchpreferences, and Help), as the status
    // bar's title opened it (SystemUiController.cpp:806-838): Enyo's
    // enyo.appMenu in its page (runtime openAppMenu).
    function justTypeAppMenu() {
        if (!_justType || !_justTypeLoaded)
            return false;
        _justType.runScript("window.__phoenixRuntime && __phoenixRuntime.openAppMenu && __phoenixRuntime.openAppMenu()");
        return true;
    }

    // Back while Just Type is up goes to its page (SystemUiController.cpp:
    // 424-443): an open app menu closes; otherwise Just Type goes.
    function justTypeBack() {
        if (!_justType || !_justTypeLoaded) {
            source.justTypeDismissed();
            return;
        }
        _justType.runScript("(function(){var m=window.enyo&&enyo.appMenu;"
                            + "if(m&&m.isOpen){m.close();return true;}return false;})()",
                            function(menuClosed) {
                                if (menuClosed !== true)
                                    source.justTypeDismissed();
                            });
    }

    // ---- Simulator: incoming call and text -----------------------------------------

    readonly property string phoneAppId: "org.webosphoenix.phone"
    readonly property string messagingAppId: "org.webosphoenix.messaging"

    // Run js in win now, or once its page has loaded when just created.
    function _runWhenLoaded(win, js, fresh, then) {
        if (!fresh) {
            win.runScript(js, then);
            return;
        }
        var done = false;
        win.loaded.connect(function() {
            if (done)
                return;
            done = true;
            win.runScript(js, then);
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
        _simulateMessage("window.__phoenixRuntime && __phoenixRuntime.simulateIncomingSms()");
    }
    // A picture message arrives (phoenix-sim Shift+F5; the runtime's
    // simulateIncomingMms), the same way.
    function simulateIncomingMms() {
        _simulateMessage("window.__phoenixRuntime && __phoenixRuntime.simulateIncomingMms()");
    }
    // An instant message from a buddy (phoenix-sim Ctrl+F5): only with an
    // IM account signed in (Accounts > Jabber (XMPP)); the runtime's
    // simulateIncomingIm says null otherwise.
    function simulateIncomingIm() {
        _simulateMessage("window.__phoenixRuntime && __phoenixRuntime.simulateIncomingIm && __phoenixRuntime.simulateIncomingIm()");
    }
    function _simulateMessage(js) {
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
        // An app still being installed does not run (the launcher handles
        // taps on its icon).
        if (!info || info.pending)
            return "";
        if (info.web && info.noWindow && _headless[appId]) {
            // Running without a card: the app opens one when told; a
            // window of it kept alive comes back when the page activates
            // it (enyo.windows.activate finds it open).
            if (_headless[appId].relaunch)
                _headless[appId].relaunch(params || {});
            return "";
        }
        // Kept alive (or started at boot): its window comes back as a card,
        // and the page hears of the launch (relaunch, as webOS relaunched a
        // running app).
        var kept = info.noWindow ? "" : _parkedUid(appId);
        if (kept !== "") {
            _unpark(kept);
            if (_windows[kept] && _windows[kept].relaunch)
                _windows[kept].relaunch(params || {});
            return kept;
        }
        // No memory left for another app: refused, and the user is asked
        // to close some cards (MemoryMonitor::allowNewNativeAppLaunch,
        // IpcServer.cpp:232-238; WindowServerLuna::createMemoryAlertWindow).
        memory.refresh();
        if (memory.low && !(info.web && info.noWindow) && appsAllowedInLowMemory.indexOf(appId) < 0) {
            showMemoryAlert();
            return "";
        }
        var url = params ? mainUrl(appId, params) : "";
        if (info.web && info.noWindow) {
            // Headless app: its page runs hidden and opens card windows itself.
            if (!_headless[appId])
                _headless[appId] = _webWindow(appId, url || info.main, "");
            _pidOf(appId);
            return "";
        }
        var at = afterUid ? _afterGroupOf(afterUid) : cards.count;
        var join = joinStack && afterUid ? cardIndex(afterUid) : -1;
        return _createWindow(appId, info.title, at, join >= 0 ? cards.get(join).groupId : newGroupId(), null, url);
    }

    // Another window of an app that runs several at once (apps
    // multipleInstances; the launcher's icon menu, New Window): a fresh
    // instance in a stack of its own, at the right, even while one runs.
    function launchNewInstance(appId) {
        var info = appInfo(appId);
        if (!info || info.pending || info.noWindow || !info.multipleInstances)
            return "";
        if (runningUid(appId) === "")
            return launch(appId);
        memory.refresh();
        if (memory.low && appsAllowedInLowMemory.indexOf(appId) < 0) {
            showMemoryAlert();
            return "";
        }
        return _createWindow(appId, info.title, cards.count, newGroupId(), null, "");
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

    // ---- Dictation for the apps (org.webosphoenix.dictation) ------------------------
    // One microphone: the window that started a recording owns it
    // (Dictation.owner) until it is transcribed, and only it hears the
    // result; the keyboard's own recordings have owner "".

    property var dictation: null

    function _dictationEvent(uid, ev) {
        var w = _windows[uid];
        if (w && w.runScript)
            w.runScript("window.__phoenixRuntime && __phoenixRuntime.dictationEvent && __phoenixRuntime.dictationEvent("
                        + JSON.stringify(ev) + ")");
    }

    function _dictationRequest(uid, p) {
        var d = dictation;
        if (!d) {
            _dictationEvent(uid, { state: "error", errorText: qsTr("Dictation is not available on this device.") });
            return;
        }
        var mine = d.owner === uid;
        if (p.op === "start") {
            if ((d.listening || d.busy) && !mine) {
                _dictationEvent(uid, { state: "error", errorText: qsTr("The microphone is in use.") });
                return;
            }
            if (d.listening || d.busy)
                d.cancel();
            d.owner = uid;
            d.prompt = typeof p.prompt === "string" ? p.prompt.slice(0, 1000) : "";
            d.autoStop = !!p.autoStop;
            d.start();
            if (d.listening)
                _dictationEvent(uid, { state: "listening" });
        } else if (p.op === "stop" && mine) {
            d.stop();
        } else if (p.op === "cancel" && mine) {
            d.cancel();
            _dictationDone();
        }
    }

    function _dictationDone() {
        if (!dictation)
            return;
        dictation.owner = "";
        dictation.prompt = "";
        dictation.autoStop = false;
    }

    Connections {
        target: source.dictation
        ignoreUnknownSignals: true
        // Only recordings for app windows: the keyboard's (owner "") and the
        // shell's assistant view's ("assistant") are theirs.
        function onStateChanged() {
            var d = source.dictation;
            if (d.owner !== "" && source._windows[d.owner] && d.busy)
                source._dictationEvent(d.owner, { state: "transcribing" });
        }
        function onTranscribed(text, error) {
            var d = source.dictation;
            var uid = d.owner;
            if (uid === "" || !source._windows[uid])
                return;
            source._dictationDone();
            source._dictationEvent(uid, error ? { state: "error", errorText: error } : { state: "done", text: text });
        }
    }

    // ---- The Assistant's on-device model and speech ("assistant" host messages) -------

    property var localModels: null
    property var speech: null
    // requestId -> {appId, uid} of an ensure under way.
    property var _assistantWaiting: ({})

    function _assistantPage(appId, uid) {
        return uid !== "" ? _windows[uid] : (_headless[appId] || null);
    }
    function _assistantEvent(page, ev) {
        if (page && page.runScript)
            page.runScript("window.__phoenixRuntime && __phoenixRuntime.assistantHostEvent && __phoenixRuntime.assistantHostEvent("
                           + JSON.stringify(ev) + ")");
    }
    function _assistantRequest(appId, uid, p) {
        var page = _assistantPage(appId, uid);
        var answer = function (o) { o.requestId = p.requestId; _assistantEvent(page, o); };
        var lm = localModels, sp = speech;
        switch (p.op) {
        case "status":
            answer(lm ? lm.status() : { available: false, installed: [], ramBytes: 0, error: "" });
            break;
        case "download":
            if (!lm) { answer({ error: qsTr("Models cannot be downloaded here.") }); break; }
            lm.download(String(p.id), String(p.url), String(p.sha256 || ""), Number(p.size) || 0);
            answer(lm.error && lm.status().downloading === null ? { error: lm.error } : {});
            break;
        case "cancel":
            if (lm) lm.cancel(String(p.id));
            answer({});
            break;
        case "remove":
            if (lm) lm.remove(String(p.id));
            answer({});
            break;
        case "ensure":
            if (!lm) { answer({ error: qsTr("No on-device model here.") }); break; }
            var w = _assistantWaiting;
            w[p.requestId] = { appId: appId, uid: uid };
            _assistantWaiting = w;
            lm.ensure(String(p.id), String(p.requestId));
            break;
        case "speak":
            if (!sp || !sp.available) { answer({ error: qsTr("No text-to-speech here.") }); break; }
            sp.speak(String(p.text || ""), String(p.lang || "en"));
            answer({});
            break;
        case "stopSpeaking":
            if (sp) sp.stop();
            answer({});
            break;
        case "speechStatus":
            answer({ available: !!(sp && sp.available), engine: sp ? sp.engine : "" });
            break;
        default:
            answer({ error: "unknown op " + p.op });
        }
    }
    function _assistantSettle(requestId, ev) {
        var who = _assistantWaiting[requestId];
        if (!who)
            return;
        var w = _assistantWaiting;
        delete w[requestId];
        _assistantWaiting = w;
        ev.requestId = requestId;
        _assistantEvent(_assistantPage(who.appId, who.uid), ev);
    }
    Connections {
        target: source.localModels
        ignoreUnknownSignals: true
        function onReady(requestId, baseUrl) { source._assistantSettle(requestId, { baseUrl: baseUrl }); }
        function onFailed(requestId, error) { source._assistantSettle(requestId, { error: error }); }
        // Every page's subscribers (Settings' download progress), at most twice a second.
        function onChanged() { if (!assistantChangedTimer.running) assistantChangedTimer.start(); }
    }
    Timer {
        id: assistantChangedTimer
        interval: 500
        onTriggered: {
            var pages = source._webPages();
            for (var i = 0; i < pages.length; ++i)
                source._assistantEvent(pages[i], { changed: true });
        }
    }

    // disableKeepAlive: close for good, kept alive or not (the angry card,
    // CardWindowManager::closeWindow -> setDisableKeepAlive; an app removed).
    function close(uid, disableKeepAlive) {
        var i = cardIndex(uid);
        if (i < 0)
            return;
        var card = { appId: cards.get(i).appId, title: cards.get(i).title, orientation: cards.get(i).orientation };
        var appId = card.appId;
        cards.remove(i);
        // Its recording stops unheard.
        if (dictation && dictation.owner === uid) {
            dictation.cancel();
            _dictationDone();
        }
        if (!disableKeepAlive && _windows[uid] && _keepsWindow(uid, appId, appInfo(appId))) {
            // Kept alive: the page goes on running without its card.
            _park(uid, card);
            return;
        }
        // Throwing a Terminal card away hangs its shell up (SIGHUP).
        if (_simPty())
            _simPty().closeWindow(uid);
        var win = _windows[uid];
        delete _windows[uid];
        if (_keepAliveAsked[uid]) {
            var ka = Object.assign({}, _keepAliveAsked);
            delete ka[uid];
            _keepAliveAsked = ka;
        }
        if (win)
            win.destroy();
        // Closing a headless app's last card closes the app, unless it is
        // kept alive.
        if (_headless[appId] && runningUid(appId) === "" && (disableKeepAlive || !_keepsHeadless(appId))) {
            _headless[appId].destroy();
            delete _headless[appId];
        }
        // Its live activities go with it: their work ran in its pages, and
        // they cannot be swiped away; its active-call banner too.
        _appGone(appId);
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
