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

    readonly property alias view: view

    function back() {
        view.runJavaScript("window.__phoenixRuntime && __phoenixRuntime.back()");
        return true;
    }

    // Give the page the keyboard.
    function focusPage() {
        view.forceActiveFocus();
    }

    // Run a snippet in the page (the shell talking to the runtime).
    function runScript(js) {
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
            settings.playbackRequiresUserGesture: false

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
        settings.showScrollBars: false
        // Apps start and continue media themselves (Music's next song), as under WebAppMgr.
        settings.playbackRequiresUserGesture: false

        onJavaScriptConsoleMessage: (level, message, lineNumber, sourceID) => {
            if (message.indexOf("__phoenix__") === 0) {
                try {
                    const m = JSON.parse(message.substring(11));
                    if (m.type === "webView")
                        win._webView(m.payload);
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
