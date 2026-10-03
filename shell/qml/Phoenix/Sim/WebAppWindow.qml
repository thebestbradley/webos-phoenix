// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// One web app window (a card, or a headless app's hidden main page) in the
// simulator. Pages come from the virtual webOS filesystem (phoenix://rootfs)
// with runtime/phoenix-runtime.js loaded first, which provides PalmSystem and
// the simulated service bus.
//
// On a device WebAppMgr plays this role; each window it creates is a
// separate compositor surface.

import QtQuick
import QtWebEngine
import Phoenix.Shell

Item {
    id: win

    property string appId
    property url url
    // Legacy pixels: the page is laid out at the original 320px phone /
    // 1024px tablet width and scaled up, like the rest of the shell.
    property real zoom: Theme.u
    // Alerts and dashboards draw on the system's dark background, not white.
    property bool transparent: false

    // A message from the page for the shell (see phoenixHost in the runtime).
    signal hostMessage(string type, var payload)
    // The page opened a window (window.open / enyo.windows.activate).
    signal windowRequested(var request)
    // The page asked to close its window (window.close()).
    signal closeRequested
    // The page finished loading (the runtime and the app's scripts ran).
    signal loaded
    // Until then the card shows the loading card (CardLoading).
    property bool ready: false
    onLoaded: { ready = true; _sendOrientation(); }

    readonly property alias view: view

    // How the window is turned (the card sets it: Card.windowOrientation),
    // as WebAppMgr told the page on an orientation change: the page is
    // resized to the turned card and reads it from PalmSystem.screenOrientation;
    // Mojo apps also get Mojo.screenOrientationChanged
    // (see screenOrientationChanged in runtime/phoenix-runtime.js).
    property string orientation: "up"
    // Once the turn has settled (the card's bindings update one by one).
    onOrientationChanged: Qt.callLater(_sendOrientation)
    function _sendOrientation() {
        view.runJavaScript("window.__phoenixRuntime && __phoenixRuntime.screenOrientationChanged && __phoenixRuntime.screenOrientationChanged("
                           + JSON.stringify(orientation) + ")");
    }

    // A site (an installed web app whose main is an https:// address): the
    // page is the site, without the runtime; the shell gives it navigation
    // (the back gesture goes back in its history; SiteMenu).
    readonly property bool site: /^https?:/.test(String(url))

    function back() {
        if (site) {
            if (!view.canGoBack)
                return false;
            view.goBack();
            return true;
        }
        view.runJavaScript("window.__phoenixRuntime && __phoenixRuntime.back()");
        return true;
    }

    // Give the page the keyboard.
    function focusPage() {
        view.forceActiveFocus();
    }

    // Run a snippet in the page (the shell talking to the runtime); done,
    // if given, is called with its result once it has run.
    function runScript(js, done) {
        if (done)
            view.runJavaScript(js, function (result) { done(result); });
        else
            view.runJavaScript(js);
    }

    // Relaunch with new launch params (webOSRelaunch event in the page).
    function relaunch(params) {
        runScript("window.__phoenixRuntime && __phoenixRuntime.relaunch && __phoenixRuntime.relaunch("
                  + JSON.stringify(params || {}) + ")");
    }

    // Let a window opened by another page load into this view.
    function adopt(request) {
        request.openIn(view);
    }

    // ---- Editing: Cut, Copy, Paste, Select All ----------------------------------------
    // The page's Edit commands run in Chromium (as WebAppMgr ran PalmSystem's
    // paste on webOS), on the system clipboard every app shares. The edit
    // popup (Phoenix.Shell EditPopup) opens over a selection: on a touch
    // long press (Chromium selects the word and asks for its menu), a right
    // click, or a press and hold with a mouse (the runtime selects the word
    // and sends "editMenu").

    readonly property var _webActions: ({
        selectAll: WebEngineView.SelectAll, cut: WebEngineView.Cut,
        copy: WebEngineView.Copy, paste: WebEngineView.Paste
    })

    function edit(action, target) {
        const v = target || view;
        if (_webActions[action] !== undefined)
            v.triggerWebAction(_webActions[action]);
    }

    // The popup for a page (view or a page inside it) at rect, in the page's
    // own coordinates.
    function _openEditPopup(page, rect, list) {
        const p = page.mapToItem(win, rect.x, rect.y);
        editPopup.page = page;
        editPopup.open(Qt.rect(p.x, p.y, rect.width, rect.height), list);
    }

    function _contextMenu(page, request) {
        // webOS had no context menu; only text gets the edit popup.
        request.accepted = true;
        if (!request.isContentEditable && !request.selectedText)
            return;
        const f = request.editFlags;
        const list = [];
        if (f & ContextMenuRequest.CanSelectAll && request.isContentEditable) list.push("selectAll");
        if (f & ContextMenuRequest.CanCut) list.push("cut");
        if (f & ContextMenuRequest.CanCopy) list.push("copy");
        if (f & ContextMenuRequest.CanPaste) list.push("paste");
        _openEditPopup(page, Qt.rect(request.position.x, request.position.y, 0, 0), list);
    }

    function _touchMenu(page, request) {
        request.accepted = true;
        const f = request.touchSelectionCommandFlags;
        const list = [];
        // Paste means a field: Select All then selects its text.
        if (f & TouchSelectionMenuRequest.Paste) list.push("selectAll");
        if (f & TouchSelectionMenuRequest.Cut) list.push("cut");
        if (f & TouchSelectionMenuRequest.Copy) list.push("copy");
        if (f & TouchSelectionMenuRequest.Paste) list.push("paste");
        _openEditPopup(page, request.selectionBounds, list);
    }

    // Chromium's touch selection handles, as round webOS-blue grips.
    Component {
        id: selectionHandle
        Rectangle {
            width: 18 * Theme.u
            height: width
            radius: width / 2
            color: Theme.highlight
            border.color: "white"
            border.width: Math.max(1, 2 * Theme.u)
        }
    }

    EditPopup {
        id: editPopup
        // The page the popup acts on (the app's, or a page shown inside it).
        property Item page: view
        anchors.fill: parent
        onTriggered: (action) => win.edit(action, page)
    }

    // ---- Pages inside the page (enyo.WebView) ------------------------------------
    // The runtime's BrowserAdapter stand-in (see "BrowserAdapter" in
    // runtime/phoenix-runtime.js) asks for a Chromium view over each
    // <object type="application/x-palm-browser">, as BrowserServer drew into
    // the plugin on webOS. The views sit above the page, at the object's
    // rectangle, and report back what the plugin reported.

    property var _webViews: ({})

    function _webViewEvent(id, name, args) {
        view.runJavaScript("window.__phoenixRuntime && __phoenixRuntime.webViewEvent && __phoenixRuntime.webViewEvent("
                           + JSON.stringify(id) + "," + JSON.stringify(name) + "," + JSON.stringify(args || []) + ")");
    }

    function _webView(p) {
        var v = _webViews[p.id];
        if (p.op === "create") {
            if (!v)
                _webViews[p.id] = nativeView.createObject(win, { viewId: p.id, visible: false });
            return;
        }
        if (!v)
            return;
        switch (p.op) {
        case "geometry":
            v.x = p.x * win.zoom;
            v.y = p.y * win.zoom;
            v.width = p.width * win.zoom;
            v.height = p.height * win.zoom;
            v.visible = p.visible;
            break;
        case "open": v.url = p.url; break;
        case "html": v.loadHtml(p.html, p.url); break;
        case "back": v.goBack(); break;
        case "forward": v.goForward(); break;
        case "reload": v.reload(); break;
        case "stop": v.stop(); break;
        case "find": v.findText(p.text); break;
        case "edit": edit(p.action, v); break;
        case "destroy":
            delete _webViews[p.id];
            v.destroy();
            break;
        }
    }

    Component {
        id: nativeView
        WebEngineView {
            id: page
            property string viewId
            z: 1
            profile: phoenixWebProfile
            zoomFactor: win.zoom
            settings.javascriptCanOpenWindows: true
            settings.javascriptCanAccessClipboard: true
            settings.javascriptCanPaste: true
            settings.playbackRequiresUserGesture: false
            touchHandleDelegate: selectionHandle
            onContextMenuRequested: (request) => win._contextMenu(page, request)
            onTouchSelectionMenuRequested: (request) => win._touchMenu(page, request)

            function report() {
                win._webViewEvent(viewId, "urlTitleChanged", [page.url.toString(), page.title, page.canGoBack, page.canGoForward]);
            }
            onUrlChanged: report()
            onTitleChanged: report()
            onLoadProgressChanged: win._webViewEvent(viewId, "loadProgressChanged", [loadProgress])
            onLoadingChanged: (info) => {
                switch (info.status) {
                case WebEngineView.LoadStartedStatus:
                    win._webViewEvent(viewId, "loadStarted", []);
                    break;
                case WebEngineView.LoadSucceededStatus:
                    report();
                    win._webViewEvent(viewId, "loadStopped", []);
                    win._webViewEvent(viewId, "documentLoadFinished", []);
                    break;
                case WebEngineView.LoadFailedStatus:
                    win._webViewEvent(viewId, "mainDocumentLoadFailed", ["", info.errorCode, info.url.toString(), info.errorString]);
                    win._webViewEvent(viewId, "loadStopped", []);
                    break;
                default:
                    win._webViewEvent(viewId, "loadStopped", []);
                }
            }
            // Links that open a new window stay in this view.
            onNewWindowRequested: (request) => { page.url = request.requestedUrl; }
        }
    }

    WebEngineView {
        id: view
        anchors.fill: parent
        profile: phoenixWebProfile
        url: win.url
        zoomFactor: win.zoom
        backgroundColor: win.transparent ? "transparent" : "white"

        settings.localContentCanAccessRemoteUrls: true
        settings.javascriptCanOpenWindows: true
        settings.javascriptCanAccessClipboard: true
        // PalmSystem.paste() and Enyo's Input paste (document.execCommand).
        settings.javascriptCanPaste: true
        settings.showScrollBars: false
        // Apps start and continue media themselves (Music's next song), as under WebAppMgr.
        settings.playbackRequiresUserGesture: false

        onJavaScriptConsoleMessage: (level, message, lineNumber, sourceID) => {
            if (message.indexOf("__phoenix__") === 0) {
                try {
                    const m = JSON.parse(message.substring(11));
                    if (m.type === "webView")
                        win._webView(m.payload);
                    else if (m.type === "editAction")
                        win.edit(m.payload.action);
                    else if (m.type === "editMenu")
                        win._openEditPopup(view, Qt.rect(m.payload.x * win.zoom, m.payload.y * win.zoom,
                                                         m.payload.width * win.zoom, m.payload.height * win.zoom),
                                           ["selectAll", "cut", "copy", "paste"].filter(
                                               (a) => m.payload["can" + a.charAt(0).toUpperCase() + a.slice(1)]));
                    else
                        win.hostMessage(m.type, m.payload);
                } catch (e) {
                    console.warn("phoenix-sim: bad host message", message);
                }
                return;
            }
            if (level === WebEngineView.ErrorMessageLevel)
                console.warn("[" + win.appId + "] " + message + " (" + sourceID + ":" + lineNumber + ")");
        }

        onLoadingChanged: (info) => {
            if (info.status === WebEngineView.LoadSucceededStatus)
                win.loaded();
        }
        onNewWindowRequested: (request) => win.windowRequested(request)
        onWindowCloseRequested: win.closeRequested()
        touchHandleDelegate: selectionHandle
        onContextMenuRequested: (request) => win._contextMenu(view, request)
        onTouchSelectionMenuRequested: (request) => win._touchMenu(view, request)
        // Camera and microphone for the Camera app, as an app's
        // requiredPermissions would grant them on a device. Nothing else.
        onFeaturePermissionRequested: (securityOrigin, feature) => {
            const media = feature === WebEngineView.MediaVideoCapture
                || feature === WebEngineView.MediaAudioCapture
                || feature === WebEngineView.MediaAudioVideoCapture;
            view.grantFeaturePermission(securityOrigin, feature, media);
        }
    }
}
