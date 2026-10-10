// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device window source's decisions, without the compositor, so they can
// be tested on any computer (shell/tests/tst_lsmcards.qml): what a card
// surface's window properties ask for, where a new card goes, and what Back
// does. LsmWindowSource.qml applies them to luna-surfacemanager's surfaces.
//
// Window properties (WebOSSurfaceItem.windowProperties, luna-surfacemanager
// modules/weboscompositor/webossurfaceitem.h:63) are what the client set on
// its surface. WebAppMgr sets these on every web app's window
// (wam src/platform/web_app_wayland.cc:212-227):
//   appId, instanceId, title, icon, subtitle, _WEBOS_WINDOW_CLASS
//   launchingAppId                   the app that asked SAM to launch it
//                                    (SAM src/bus/client/WAM.cpp:199, the
//                                    launch call's sender)
//   _WEBOS_ACCESS_POLICY_KEYS_BACK   "true": the page takes Back (its app
//                                    handles Back itself, appinfo
//                                    disableBackHistoryAPI, or its history
//                                    can go back); "false": "Do not send
//                                    back key to WAM. LSM should handle it"
//                                    (web_app_wayland.cc:725-733)
// and WebAppMgr has no orientation, full-screen or status bar colour call
// (its PalmSystem answers screenOrientation "up" and windowOrientation
// "free", palm_system_webos.h:42-43). The page sets the rest itself with
// WebAppMgr's setWindowProperty (palm_system_blink.cc:100-108), which
// phoenix-runtime.js does on a device for the webOS calls apps make
// (runtime "Window properties on a device"):
//   phoenixOrientation         PalmSystem.setWindowOrientation, appinfo
//                              requestedWindowOrientation
//   phoenixFullScreen          PalmSystem.enableFullScreenMode ("true"/"false")
//   phoenixStatusBarColor      setWindowProperties {statusBarColor} (0xRRGGBB
//                              as a decimal number; "" none)
//   phoenixBlockScreenTimeout  setWindowProperties {blockScreenTimeout}
//   phoenixReturnTo            the app to go back to ({returnToCaller}: the
//                              launch params' $caller), "" none
//   phoenixBack                "<n>": the page did not take Back number n
//                              (it changes each time)
// Values come as strings (WebAppMgr's are), or as their types.
//
// STATUS: written against WebAppMgr's and luna-surfacemanager's sources;
// not yet run on a device.

.pragma library

function _str(v) {
    return v === undefined || v === null ? "" : String(v);
}

function _bool(v) {
    return v === true || v === 1 || v === "true" || v === "1";
}

// The orientations a window may keep (SimWindowSource._windowOrientation;
// CardWindow::onSetAppFixedOrientation, CardWindow.cpp:2536-2583).
function orientation(v) {
    var o = _str(v).toLowerCase();
    return ["up", "down", "left", "right", "landscape", "portrait"].indexOf(o) >= 0 ? o : "free";
}

// 0xRRGGBB from a number or its decimal / "#RRGGBB" / "0xRRGGBB" text; -1
// for none (the shell's "no colour", SimWindowSource's statusBarColor).
function color(v) {
    if (typeof v === "number")
        return isFinite(v) && v >= 0 ? (v & 0xFFFFFF) : -1;
    var s = _str(v).trim();
    if (s === "")
        return -1;
    var n = /^#[0-9a-f]{6}$/i.test(s) ? parseInt(s.slice(1), 16)
          : /^0x[0-9a-f]{1,6}$/i.test(s) ? parseInt(s.slice(2), 16)
          : /^[0-9]+$/.test(s) ? parseInt(s, 10) : NaN;
    return isFinite(n) && n >= 0 ? (n & 0xFFFFFF) : -1;
}

// The card's fields (SimWindowSource's cards: fullScreen, statusBarColor,
// orientation, blockScreenTimeout) and the device's own: launchingAppId,
// returnTo, backPolicy ("page", "shell": the page cannot go back), back
// (the last unanswered Back's number, "" none).
function cardFields(props) {
    props = props || {};
    var policy = _str(props._WEBOS_ACCESS_POLICY_KEYS_BACK);
    return {
        fullScreen: _bool(props.phoenixFullScreen),
        statusBarColor: color(props.phoenixStatusBarColor),
        orientation: orientation(props.phoenixOrientation),
        blockScreenTimeout: _bool(props.phoenixBlockScreenTimeout),
        launchingAppId: _str(props.launchingAppId),
        returnTo: _str(props.phoenixReturnTo),
        backPolicy: policy === "false" ? "shell" : "page",
        back: _str(props.phoenixBack)
    };
}

// The apps that launch others without being one the user goes back to:
// the shell itself (luna-surfacemanager's bus name), the launcher and the
// system UI (as phoenix-runtime.js's /launch leaves them out of $caller).
var notCallers = ["", "com.webos.surfacemanager", "com.webos.app.home", "com.palm.launcher", "com.palm.systemui",
                  "com.webos.phoenix.unknown"];

function isCaller(appId) {
    return notCallers.indexOf(_str(appId)) < 0;
}

// Where a new card goes (CardWindowManager::prepareAddWindowSibling,
// CardWindowManager.cpp:556-578): a further window of an app that has a
// card joins that card's stack (:556-599, as before); else, launched by the
// card in front (maximized and focused: focusedUid) and its app
// (launchingAppId is the focused card's app, :561-563), it joins that
// stack at its front; else a new stack right of afterUid's (the shell's
// launch) or at the end.
// cards: [{uid, appId, groupId}] in screen order. Returns {at, groupOf}:
// the index to insert at, and the uid whose group it joins ("" for a new
// group).
function placement(cards, appId, launchingAppId, focusedUid, afterUid) {
    function index(uid) {
        for (var i = 0; i < cards.length; ++i)
            if (cards[i].uid === uid)
                return i;
        return -1;
    }
    function groupEnd(i) {
        var gid = cards[i].groupId;
        while (i < cards.length && cards[i].groupId === gid)
            ++i;
        return i;
    }
    for (var s = 0; s < cards.length; ++s)
        if (cards[s].appId === appId)
            return { at: groupEnd(s), groupOf: cards[s].uid };
    var f = index(focusedUid || "");
    if (f >= 0 && isCaller(launchingAppId) && cards[f].appId === launchingAppId)
        return { at: groupEnd(f), groupOf: cards[f].uid };
    var a = index(afterUid || "");
    return { at: a >= 0 ? groupEnd(a) : cards.length, groupOf: "" };
}

// What Back does for a card whose page the shell may not give it to, or did
// not take it: "return" to its caller's card (callerUid running; the
// simulator's cardReturnRequested, runtime.back's {returnTo}) or "minimize"
// (SystemUiController::slotKeyEventRejected, SystemUiController.cpp:941-954).
function unhandledBack(fields, appId, callerUid) {
    return fields.returnTo !== "" && fields.returnTo !== appId && isCaller(fields.returnTo) && callerUid !== ""
        ? "return" : "minimize";
}

// What the back gesture does now: "key" (send the webOS Back key to the
// page, which says later if it did not take it: phoenixBack) or, when the
// page cannot take it (backPolicy "shell": its history cannot go back and
// its app does not handle Back itself), what unhandledBack says.
function backAction(fields, appId, callerUid) {
    return fields.backPolicy === "shell" ? unhandledBack(fields, appId, callerUid) : "key";
}
