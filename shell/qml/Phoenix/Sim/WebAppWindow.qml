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
import Phoenix.Native
import "Links.js" as Links

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
    // A link (or a window, or a navigation) the page should not show
    // itself: the app for it opens it (applicationManager open {target};
    // Links.js).
    signal linkRequested(string url)
    // The page asked to close its window (window.close()).
    signal closeRequested
    // The page finished loading (the runtime and the app's scripts ran).
    signal loaded
    // The window is going away, with its page: what the page held (its
    // calls to the services) ends with it, as when a process leaves the bus.
    signal gone
    Component.onDestruction: gone()
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
    // The part of the web the site covers (its manifest's scope; the
    // window's start page's origin when it has none): links out of it go
    // to the browser or the web app whose site it is.
    property string scope: ""
    readonly property string _scope: Links.scopeOf(url, scope)

    // The back gesture went unhandled by the app's page (it did not stop
    // the key; back() answers false at once for a site at its first page).
    // The shell minimizes the card (SystemUiController::slotKeyEventRejected).
    signal backUnhandled

    function back() {
        if (site) {
            if (!view.canGoBack)
                return false;
            view.goBack();
            return true;
        }
        view.runJavaScript("window.__phoenixRuntime ? __phoenixRuntime.back() : false", function (handled) {
            if (handled === false)
                win.backUnhandled();
        });
        return true;
    }

    // Give the page the keyboard.
    function focusPage() {
        view.forceActiveFocus();
    }

    // Run a snippet in the page (the shell talking to the runtime).
    // done(result), if given, gets what the script's last expression was.
    function runScript(js, done) {
        if (done)
            view.runJavaScript(js, done);
        else
            view.runJavaScript(js);
    }

    // A touch the system UI passes on to the page, at x, y in the window's
    // pixels (a dashboard row: DashboardItem.pointer, as LunaSysMgr sent
    // pen events to a dashboard window, DashboardWindow::inputEvent). The
    // page gets mouse events at that point, as WebKit made them of pen
    // events: "down", "move", "up" go to the element first pressed (the
    // mouse's capture), "tapup" also clicks it, "cancel" lets go without a
    // click, "tap" is a down, an up and a click.
    function pointer(type, x, y) {
        view.runJavaScript("(function (t, x, y) {"
            + " var d = document, w = window, st = w.__phoenixPointer || (w.__phoenixPointer = {});"
            + " if (t === 'down' || t === 'tap' || !st.target) st.target = d.elementFromPoint(x, y) || d.body;"
            + " var el = st.target;"
            + " function fire(n) { el.dispatchEvent(new MouseEvent(n, { bubbles: true, cancelable: true, view: w,"
            + "   clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: n === 'mousedown' || n === 'mousemove' ? 1 : 0 })); }"
            + " if (t === 'down' || t === 'tap') fire('mousedown');"
            + " if (t === 'move') fire('mousemove');"
            + " if (t === 'up' || t === 'tapup' || t === 'tap' || t === 'cancel') fire('mouseup');"
            + " if (t === 'tapup' || t === 'tap') fire('click');"
            + " if (t !== 'down' && t !== 'move') st.target = null;"
            + "})(" + JSON.stringify(String(type)) + ", " + (x / zoom) + ", " + (y / zoom) + ")");
    }

    // Relaunch with new launch params (webOSRelaunch event in the page).
    // refresh (Settings > Apps > Opening a running app: Refresh): the page
    // also reloads its data ("phoenixRefresh"); a site reloads.
    function relaunch(params, refresh) {
        // A site launched with a page of its own ({target}, a link to it
        // from another app) goes there.
        if (site) {
            if (params && typeof params.target === "string" && Links.inScope(params.target, _scope))
                view.url = params.target;
            else if (refresh)
                view.reload();
            return;
        }
        runScript("window.__phoenixRuntime && __phoenixRuntime.relaunch && __phoenixRuntime.relaunch("
                  + JSON.stringify(params || {}) + ", " + (refresh ? "true" : "false") + ")");
    }

    // ---- Links: where the page's navigations go (Links.js) ---------------------------

    function _kind(type) {
        switch (type) {
        case WebEngineNavigationRequest.LinkClickedNavigation: return "link";
        case WebEngineNavigationRequest.TypedNavigation: return "typed";
        case WebEngineNavigationRequest.FormSubmittedNavigation: return "form";
        case WebEngineNavigationRequest.BackForwardNavigation: return "backforward";
        case WebEngineNavigationRequest.ReloadNavigation: return "reload";
        case WebEngineNavigationRequest.RedirectNavigation: return "redirect";
        default: return "other";
        }
    }
    function _navigation(request) {
        if (Links.navigation(request.url, _kind(request.navigationType), request.isMainFrame, site, _scope) === "route") {
            request.reject();
            linkRequested(String(request.url));
        }
    }
    function _newWindow(request) {
        const url = String(request.requestedUrl);
        if (Links.newWindow(url, request.destination === WebEngineNewWindowRequest.InNewDialog, site, _scope) === "route")
            linkRequested(url);
        else
            windowRequested(request);
    }
    // The script that reports links to other schemes (Links.linkScript), in
    // pages without the runtime: sites and page views.
    function _addLinkScript(target) {
        const script = WebEngine.script();
        script.name = "phoenix-links";
        script.worldId = WebEngineScript.ApplicationWorld;
        script.injectionPoint = WebEngineScript.DocumentCreation;
        script.runsOnSubFrames = true;
        script.sourceCode = Links.linkScript;
        target.userScripts.insert(script);
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
        if (_webActions[action] === undefined)
            return;
        // Copy and Cut in a password field: Chromium refuses them, the
        // runtime copies the selection itself and records it as a sensitive
        // clip (runtime/phoenix-runtime.js "Clipboard history").
        if ((action === "copy" || action === "cut") && v === view) {
            view.runJavaScript("!!(window.__phoenixRuntime && __phoenixRuntime.clipboard && __phoenixRuntime.clipboard.passwordCopy("
                               + JSON.stringify(action) + "))", (done) => {
                if (!done)
                    v.triggerWebAction(_webActions[action]);
            });
            return;
        }
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

    // A print job (com.palm.printmgr in the runtime, "Save as PDF"): the
    // page view's page (the browser's Print) or this window's own document
    // (PalmSystem.printFrame) as a PDF, which Chromium makes, handed back to
    // the page's print manager as base64. p: {jobID, pageSize: "A4" |
    // "Letter" | "Legal", landscape}.
    function _print(target, p) {
        const sizes = { A4: WebEngineView.A4, Letter: WebEngineView.Letter, Legal: WebEngineView.Legal };
        target.printToPdf((data) => {
            const bytes = data ? new Uint8Array(data) : new Uint8Array(0);
            view.runJavaScript("window.__phoenixRuntime && __phoenixRuntime.print && __phoenixRuntime.print.rendered("
                               + JSON.stringify(p.jobID) + "," + (bytes.length ? JSON.stringify(_base64(bytes)) : "null") + ","
                               + JSON.stringify(bytes.length ? {} : { error: "The page could not be printed" }) + ")");
        }, sizes[p.pageSize] !== undefined ? sizes[p.pageSize] : WebEngineView.Letter,
           p.landscape ? WebEngineView.Landscape : WebEngineView.Portrait);
    }
    function _base64(bytes) {
        const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const out = [];
        let i = 0;
        for (; i + 2 < bytes.length; i += 3) {
            const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
            out.push(abc[n >> 18] + abc[(n >> 12) & 63] + abc[(n >> 6) & 63] + abc[n & 63]);
        }
        if (i < bytes.length) {
            const n = (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8);
            out.push(abc[n >> 18] + abc[(n >> 12) & 63] + (i + 1 < bytes.length ? abc[(n >> 6) & 63] : "=") + "=");
        }
        return out.join("");
    }

    function _webViewEvent(id, name, args) {
        view.runJavaScript("window.__phoenixRuntime && __phoenixRuntime.webViewEvent && __phoenixRuntime.webViewEvent("
                           + JSON.stringify(id) + "," + JSON.stringify(name) + "," + JSON.stringify(args || []) + ")");
    }

    // The page views' profile (simBrowser: the web's own, apart from the
    // apps' pages, as BrowserServer's was), or the browser's Private
    // Browsing one; without simBrowser (tests) the apps'.
    readonly property bool _hasSimBrowser: typeof simBrowser !== "undefined" && simBrowser !== null
    function _viewProfile(privateMode) {
        if (!_hasSimBrowser)
            return phoenixWebProfile;
        return privateMode ? simBrowser.privateProfile() : simBrowser.profile;
    }
    function _makeView(id, privateMode, props) {
        const o = { viewId: id, visible: false, privateMode: !!privateMode, profile: _viewProfile(privateMode) };
        for (const k in props || {})
            o[k] = props[k];
        const v = nativeView.createObject(win, o);
        if (privateMode && _hasSimBrowser)
            simBrowser.trackPrivateView(v);
        return v;
    }

    function _webView(p) {
        var v = _webViews[p.id];
        if (p.op === "create") {
            if (!v)
                _webViews[p.id] = _makeView(p.id, p.private, {});
            return;
        }
        if (!v)
            return;
        switch (p.op) {
        case "geometry":
            // Stepping aside for something drawn in the page over it (an
            // Enyo popup, the share sheet: nothing in the page can draw over
            // a native view): a picture of it goes to the page first, in its
            // place under them, so the page stays seen (dimmed) rather than
            // the white of an empty rectangle, as BrowserServer's page,
            // drawn in the app, did.
            if (v.visible && !p.visible && v.width > 0 && v.height > 0 && p.width > 0 && p.height > 0) {
                const id = p.id;
                v.grabToImage(function (result) {
                    win._webViewEvent(id, "phoenixSnapshot", ["data:image/png;base64," + ImageTools.pngBase64(result.image)]);
                    if (win._webViews[id] === v && v.phoenixHide)
                        v.visible = false;
                });
                v.phoenixHide = true;
            } else {
                v.phoenixHide = false;
                v.visible = p.visible;
            }
            v.x = p.x * win.zoom;
            v.y = p.y * win.zoom;
            v.width = p.width * win.zoom;
            v.height = p.height * win.zoom;
            break;
        case "open": v.url = p.url; break;
        case "redirects": v.redirects = p.list || []; break;
        case "html": v.loadHtml(p.html, p.url); break;
        case "back": v.goBack(); break;
        case "forward": v.goForward(); break;
        case "reload": v.reload(); break;
        case "stop": v.stop(); break;
        // Find on Page: the next match (or the one before), and the count
        // back ("phoenixFindResult": active match, matches).
        case "find":
            v.findText(p.text || "", p.backward ? WebEngineView.FindBackward : 0);
            break;
        // Private Browsing on or off (the browser's app menu): the page
        // starts again in a view of the other profile, at the same place.
        case "private":
            if (!!p.on === v.privateMode)
                break;
            _webViews[p.id] = _makeView(p.id, p.on, { x: v.x, y: v.y, width: v.width, height: v.height, visible: v.visible,
                                                      redirects: v.redirects });
            if (p.url)
                _webViews[p.id].url = p.url;
            v.destroy();
            break;
        case "edit": edit(p.action, v); break;
        case "print": _print(v, p); break;
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
            property bool privateMode: false
            // Hiding once its picture is taken (geometry above).
            property bool phoenixHide: false
            // The page's redirects (BrowserAdapter addUrlRedirect, from the
            // runtime): links matching one go back to the page as
            // urlRedirected(url, cookie) instead of loading.
            property var redirects: []
            function redirected(url) {
                const cookie = Links.redirectFor(url, redirects);
                if (cookie === null)
                    return false;
                win._webViewEvent(viewId, "urlRedirected", [String(url), cookie]);
                return true;
            }
            z: 1
            zoomFactor: win.zoom
            settings.javascriptCanOpenWindows: true
            settings.javascriptCanAccessClipboard: true
            settings.javascriptCanPaste: true
            settings.playbackRequiresUserGesture: false
            // Links to other schemes never reach the computer's own apps.
            settings.unknownUrlSchemePolicy: WebEngineSettings.DisallowUnknownUrlSchemes
            Component.onCompleted: win._addLinkScript(page)
            touchHandleDelegate: selectionHandle
            onContextMenuRequested: (request) => win._contextMenu(page, request)
            onTouchSelectionMenuRequested: (request) => win._touchMenu(page, request)

            function report() {
                win._webViewEvent(viewId, "urlTitleChanged", [page.url.toString(), page.title, page.canGoBack, page.canGoForward]);
            }
            onUrlChanged: report()
            onTitleChanged: report()
            onLoadProgressChanged: win._webViewEvent(viewId, "loadProgressChanged", [loadProgress])
            onFindTextFinished: (result) => win._webViewEvent(viewId, "phoenixFindResult", [result.activeMatch, result.numberOfMatches])
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
            // What the page follows (not what the app loads in it,
            // openURL / setHTML, or history) is checked against the redirects.
            onNavigationRequested: (request) => {
                const kind = win._kind(request.navigationType);
                if (request.isMainFrame && kind !== "typed" && kind !== "backforward" && kind !== "reload"
                        && !Links.isLocal(request.url) && page.redirected(request.url))
                    request.reject();
            }
            onJavaScriptConsoleMessage: (level, message) => {
                if (message.indexOf(Links.LINK_PREFIX) === 0)
                    page.redirected(message.substring(Links.LINK_PREFIX.length));
            }
            // Links that open a new window stay in this view, unless the
            // app takes them.
            onNewWindowRequested: (request) => {
                if (!page.redirected(request.requestedUrl))
                    page.url = request.requestedUrl;
            }

            // A file the view does not show (a PDF, a zip, a link with
            // "download"): Chromium would download it itself. BrowserAdapter
            // handed such a load back to the app instead
            // (BasicWebView.mimeNotSupported -> onFileLoad), and the browser
            // asks the application manager who opens the type and has the
            // download manager fetch it (BrowserApp.gotResourceInfo).
            Connections {
                target: page.profile
                function onDownloadRequested(download) {
                    if (download.view !== page)
                        return;
                    const mime = download.mimeType || "application/octet-stream";
                    const url = download.url.toString();
                    download.cancel();
                    win._webViewEvent(page.viewId, "mimeNotSupported", [mime, url]);
                }
            }
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

        // Links to other schemes never reach the computer's own apps: the
        // runtime hands them to the application manager, and in a site the
        // link script reports them (linkRequested).
        settings.unknownUrlSchemePolicy: WebEngineSettings.DisallowUnknownUrlSchemes
        Component.onCompleted: {
            if (win.site)
                win._addLinkScript(view);
        }
        onNavigationRequested: (request) => win._navigation(request)

        onJavaScriptConsoleMessage: (level, message, lineNumber, sourceID) => {
            if (message.indexOf(Links.LINK_PREFIX) === 0) {
                if (win.site)
                    win.linkRequested(message.substring(Links.LINK_PREFIX.length));
                return;
            }
            // A site has no runtime: it does not talk to the shell.
            if (message.indexOf("__phoenix__") === 0 && win.site)
                return;
            if (message.indexOf("__phoenix__") === 0) {
                try {
                    const m = JSON.parse(message.substring(11));
                    if (m.type === "webView")
                        win._webView(m.payload);
                    else if (m.type === "print")
                        win._print(view, m.payload);
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
        onNewWindowRequested: (request) => win._newWindow(request)
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
