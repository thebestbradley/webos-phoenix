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

    WebEngineView {
        id: view
        anchors.fill: parent
        profile: phoenixWebProfile
        url: win.url
        zoomFactor: win.zoom
        backgroundColor: "white"

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
