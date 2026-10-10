// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Non-modal notifications, the two ways luna-sysmgr showed them
// (SystemUiController.cpp:82, 1361-1470; DashboardWindowManager.cpp).
//
// Phones: notifications never cover the app. They own the "negative space"
// at the bottom of the screen and the app's "positive space" ends where it
// begins, so the app shrinks and moves up to make room:
//   1. a notification arrives: the positive space loses the 28 px bar
//      (positiveSpaceBottomPadding) and the banner slides into it from the
//      right;
//   2. the banner then collapses into the notification's icon in the bar;
//   3. tapping the bar opens the dashboard, which grows the negative space
//      upward (at most 55% of the screen) and pushes the app up with it.
//      Each item can be tapped, or swiped sideways to dismiss it.
// Every change to the space animates over 400 ms, OutCubic
// (conf/lunaAnimations.conf:73-74), and the shell lays the cards out in
// what is left (negativeSpace).
//
// Tablets (TouchPad): the banner and the notification icons live in the
// status bar, and the dashboard is a 320 px drop-down under it, over the
// apps (DashboardWindowManager.cpp:62-63, 1234-1260): DashboardMenu.qml.
//
// Tapping a notification launches its app with the notification's params
// (e.g. the task a reminder is for).

import QtQuick
import "NotificationPolicy.js" as Policy

Item {
    id: root

    property var model            // ListModel: appId, title, body, color, glyph, icon, params (JSON or ""), windowKey,
                                  // ongoing (an ongoing activity: a download, an install; it stays
                                  // until it ends), progress (0-100, -1: none); a dashboard window's
                                  // persistent (not dismissable: DashboardWindow::persistent) and
                                  // manualDrag (it takes its own drags: webosDragMode "manual")
    // The window source: its alerts (popup alert windows) and windowFor(key)
    // for alert and dashboard windows.
    property var source
    // The scene behind, for the blur under the tablet panels.
    property Item backdrop: null
    property bool dashboardOpen: false

    // ---- Keyboard navigation (GAPS V8 (3)) -------------------------------------------
    // With the dashboard open: Up / Down (and Tab) move a highlight over the
    // rows in the order they are shown (tablets: newest at the top), Enter
    // opens the row as a tap would, Delete or Backspace dismisses it (not a
    // live activity), Esc closes the dashboard.
    property int keyRow: -1
    function _rowOrder() {
        var n = model ? model.count : 0, out = [];
        for (var i = 0; i < n; ++i)
            out.push(i);
        if (overlay)
            out.sort(function (a, b) { return dropDown.posOf(a) - dropDown.posOf(b); });
        return out;
    }
    function handleKey(event) {
        if (!dashboardOpen || !model)
            return false;
        var k = event.key;
        if (k === Qt.Key_Escape) {
            dashboardOpen = false;
            return true;
        }
        var order = _rowOrder();
        if (k === Qt.Key_Down || k === Qt.Key_Up || k === Qt.Key_Tab || k === Qt.Key_Backtab) {
            if (!order.length)
                return true;
            var up = k === Qt.Key_Up || k === Qt.Key_Backtab;
            var at = order.indexOf(keyRow);
            at = at < 0 ? (up ? order.length - 1 : 0) : Math.max(0, Math.min(order.length - 1, at + (up ? -1 : 1)));
            keyRow = order[at];
            return true;
        }
        if (keyRow < 0 || keyRow >= model.count)
            return false;
        var n = model.get(keyRow);
        if (k === Qt.Key_Return || k === Qt.Key_Enter || k === Qt.Key_Space) {
            activated(n.appId, n.params || "");
            if (!kept(n))
                dismissRequested(keyRow);
            keyRow = -1;
            return true;
        }
        if ((k === Qt.Key_Delete || k === Qt.Key_Backspace) && !kept(n)) {
            var at2 = order.indexOf(keyRow);
            dismissRequested(keyRow);
            // The row after it (or before, at the end) keeps the highlight.
            var left = model.count;
            keyRow = left === 0 ? -1 : Math.min(at2, left - 1);
            if (keyRow >= 0)
                keyRow = _rowOrder()[keyRow];
            return true;
        }
        return false;
    }
    // Tablet: where the status bar's system indicators begin (from the right).
    property real statusBarRightInset: 0
    // Height of the whole screen, for the dashboard's maximum size.
    property real screenHeight: height

    signal dismissRequested(int index)
    signal activated(string appId, string params)

    // A notification's button (DashboardItem actions; Phoenix): the app's
    // own service called, as the system UI, with the notification's params
    // and {action: id}, the notification done with, and what the service
    // says back ({text}) shown as the app's banner, without opening it
    // (e.g. the Assistant's follow-up answers, answerFollowUp). Only the
    // app's own service: luna://<appId>/...
    function runAction(index, actionId) {
        if (!model || index < 0 || index >= model.count)
            return;
        var n = model.get(index), a = null;
        try { a = n.actions ? JSON.parse(n.actions) : null; } catch (e) { a = null; }
        if (!a || typeof a.uri !== "string" || a.uri.indexOf("luna://" + n.appId + "/") !== 0)
            return;
        var note = { appId: n.appId, icon: n.icon, color: n.color, glyph: n.glyph };
        dismissRequested(index);
        if (!source || typeof source.lunaCall !== "function")
            return;
        source.lunaCall(a.uri, Object.assign({}, a.params || {}, { action: String(actionId) }), function (r) {
            if (r && r.returnValue !== false && r.text)
                root.showBanner(String(r.text), note.icon, note.color, note.glyph, note.appId, "", "");
        });
    }

    readonly property bool overlay: Theme.tablet
    readonly property bool hasNotifications: model && model.count > 0
    property bool bannerActive: false
    // The time for a swipe's speed (a test sets its own, so how busy the
    // machine is does not decide whether a flick was quick).
    property var clock: function () { return Date.now(); }
    // The dashboard has content while a banner shows or notifications wait
    // (DashboardWindowManager::setBannerHasContent, :454-465).
    // The phone's active-call banner ({appId, icon, message, startTime}
    // or null): in the banner strip while a call is up, over the other
    // banners (BannerWindow::paint); tablets have none
    // (StatusBarNotificationArea's are empty).
    property var activeCall: null
    readonly property bool activeCallShown: activeCall !== null && activeCall !== undefined && !overlay
    readonly property bool hasContent: hasNotifications || bannerActive || activeCallShown

    // ---- The drawer (Phoenix) ------------------------------------------------------
    // Live activities (ongoing) are pinned at the top of the list, above the
    // notifications (the window sources insert them there); ongoingCount is
    // how many lead the list. The open dashboard has a handle that pulls it
    // to the whole screen, whose header offers Select and Clear All.
    property int ongoingCount: 0
    // Rows nothing but their app takes away: live activities, and dashboard
    // windows opened {persistent: true} (DashboardWindow::persistent: a drag
    // or a flick never dismisses one, DashboardWindowContainer.cpp:343-347,
    // 433-438; luna-systemui's update dashboard opens one,
    // SysUpdateService.js:184-188).
    function kept(n) { return !!n && (n.ongoing === true || n.persistent === true); }
    property int keptCount: 0
    function _countOngoing() {
        var n = 0;
        while (model && n < model.count && model.get(n).ongoing)
            ++n;
        ongoingCount = n;
        var k = 0;
        for (var i = 0; model && i < model.count; ++i)
            if (kept(model.get(i)))
                ++k;
        keptCount = k;
    }
    Connections {
        target: root.model
        function onRowsInserted() { root._countOngoing(); }
        function onRowsRemoved() { root._countOngoing(); }
        function onRowsMoved() { root._countOngoing(); }
        function onDataChanged() { root._countOngoing(); }
        function onModelReset() { root._countOngoing(); }
    }
    onModelChanged: _countOngoing()
    readonly property int clearableCount: (model ? model.count : 0) - keptCount

    property bool drawerExpanded: false
    property bool selecting: false
    property var selectedIds: ({})
    readonly property int selectedCount: Object.keys(selectedIds).length
    // Phones: the drawer's height beyond the negative space while it opens
    // to the whole screen (animated), and the finger's pull on the handle.
    property real drawerLift: 0
    readonly property real drawerFullHeight: screenHeight - Theme.statusBarHeight
    readonly property real drawerPull: overlay ? 0 : phoneHandle.pull
    // While open it never shrinks under the banner's height: pulled down
    // past its own height the drawer stays under the finger (and its
    // handle sees the release that closes it) rather than vanishing.
    readonly property real phoneSpaceHeight: Math.max(0, Math.min(drawerFullHeight,
        dashboardOpen ? Math.max(Theme.bannerHeight, Math.max(negativeSpace, drawerLift) + drawerPull)
                      : Math.max(negativeSpace, drawerLift)))
    NumberAnimation {
        id: liftAnim
        target: root
        property: "drawerLift"
        duration: Theme.drawerDuration
        easing.type: Easing.OutCubic
    }
    function setDrawerExpanded(on) {
        if (!on) {
            selecting = false;
            selectedIds = {};
        }
        if (!overlay) {
            var from = Math.max(negativeSpace, drawerLift) + drawerPull;
            liftAnim.stop();
            drawerLift = from;
            liftAnim.to = on ? drawerFullHeight : 0;
            liftAnim.start();
        }
        drawerExpanded = on;
    }
    onDashboardOpenChanged: {
        keyRow = -1;
        if (!dashboardOpen) {
            liftAnim.stop();
            drawerLift = 0;
            drawerExpanded = false;
            selecting = false;
            selectedIds = {};
        }
    }
    function toggleSelected(id) {
        var s = Object.assign({}, selectedIds);
        if (s[id])
            delete s[id];
        else
            s[id] = true;
        selectedIds = s;
    }
    // Dismiss these rows, last first so the earlier indexes still hold.
    function _dismissAll(indexes) {
        indexes.sort(function(a, b) { return b - a; });
        for (var i = 0; i < indexes.length; ++i)
            dismissRequested(indexes[i]);
    }
    function clearSelected() {
        var list = [];
        for (var i = 0; i < model.count; ++i)
            if (!kept(model.get(i)) && selectedIds[model.get(i).id])
                list.push(i);
        selecting = false;
        selectedIds = {};
        _dismissAll(list);
    }
    function clearAll() {
        var list = [];
        for (var i = 0; i < model.count; ++i)
            if (!kept(model.get(i)))
                list.push(i);
        selecting = false;
        selectedIds = {};
        _dismissAll(list);
    }

    // Phones: the space taken from the bottom of the screen, animated. The
    // shell ends the cards and the quick launch bar above it. The rows and
    // the 10 px above them, no more than the positive space can give up
    // (DashboardWindowContainer::calculateScrollProperties, :984-990).
    // (Phoenix: and the drawer's handle above them.)
    readonly property real dashboardHeight: Math.min(
        Theme.drawerHandleHeight + Theme.dashboardTopPadding + (model ? model.count : 0) * Theme.dashboardItemHeight,
        screenHeight * Theme.maximumNegativeSpaceRatio)
    // The front popup alert, if any (phones: it takes the negative space;
    // DashboardWindowManagerStates.cpp:76-110).
    readonly property var alerts: source && source.alerts ? source.alerts : null
    readonly property bool alertShown: alerts !== null && alerts.count > 0
    // (Bound to the count itself, not alertShown: an alert inserted in front
    // of the one showing changes the front without changing alertShown.)
    readonly property string alertKey: alerts !== null && alerts.count > 0 ? alerts.get(0).key : ""
    readonly property real alertHeight: alerts !== null && alerts.count > 0 ? Theme.px(alerts.get(0).height) : 0
    // Phones: the room above the front alert when it is a web page (the
    // shell's own alerts keep their margins themselves); set as it is put
    // in place (attachAlert).
    property real alertTopPadding: 0

    // A full-screen app has the whole screen: no bar, no banners, no
    // dashboard; popup alerts (a call) still make room
    // (SystemUiController::hideStatusBarAndNotificationArea).
    property bool fullScreen: false
    // The lock screen is up: only the front popup alert shows, over it.
    property bool locked: false
    // The front alert is the phone's incoming call (AlertWindow::
    // isIncomingCallAlert): the lock screen offers "Drag up to answer".
    readonly property bool incomingCall: alerts !== null && alerts.count > 0
                                         && Policy.isIncomingCall(alerts.get(0).appId, alerts.get(0).name || "")
    // The virtual keyboard's height while it is up (the shell sets it):
    // it takes the negative space, the app's positive space ending where it
    // begins, full screen or not (InputWindowManager::slotShowIME ->
    // SystemUiController::changeNegativeSpace(uiHeight - keyboardHeight,
    // true), SystemUiController.cpp:1361-1470). On the devices that had it
    // the dashboard never owned the negative space (:82); on the phone,
    // which keeps the Pre's notification area, the keyboard takes it over
    // while it is up and a popup alert (a call) still comes first. Over the
    // lock screen only the keyboard (its password panel) takes any.
    property real keyboardHeight: 0
    // A change of the keyboard's height (rotation, the tablet's sizes)
    // applies at once (slotKeyboardHeightChanged: changeNegativeSpace(...,
    // immediate)); showing and hiding it animates.
    property bool spaceImmediate: false
    readonly property real negativeSpaceTarget: locked ? keyboardHeight
        : alertShown && !overlay ? alertHeight + alertTopPadding
        : keyboardHeight > 0 ? keyboardHeight
        : overlay || fullScreen ? 0
        : dashboardOpen ? dashboardHeight
        : hasContent ? Theme.bannerHeight : 0
    property real negativeSpace: negativeSpaceTarget
    Behavior on negativeSpace {
        enabled: !root.spaceImmediate
        NumberAnimation { duration: Theme.positiveSpaceDuration; easing.type: Easing.OutCubic }
    }

    // ---- Banner --------------------------------------------------------------

    property string bannerText: ""
    property color bannerColor: "#666666"
    property string bannerGlyph: ""
    property url bannerIcon: ""
    // What tapping the banner launches (BannerMessageHandler::
    // activateCurrentMessage); without params a tap opens the dashboard.
    property string bannerAppId: ""
    property string bannerParams: ""
    // The banner fades to 0.25 as it leaves; the lock screen's copy follows.
    readonly property real bannerOpacity: bannerContent.opacity

    Connections {
        target: root.model
        function onRowsInserted(parent, first, last) {
            var n = root.model.get(last);
            // A dashboard window shows itself; its app sends its own banner.
            if (n.windowKey)
                return;
            root.showBanner(n.title + (n.body ? ": " + n.body : ""), n.icon || "", n.color, n.glyph, n.appId, n.params || "", n.key || "");
        }
        function onCountChanged() {
            if (root.model.count === 0)
                root.dashboardOpen = false;
        }
    }

    // "(m:ss)", "(h:mm:ss)", at most "(99:59:59)"
    // (ActiveCallBanner::recomputeTime). startTime: seconds since 1970.
    function callTime(startTime, nowMs) {
        var t = Math.max(0, Math.floor(nowMs / 1000) - startTime);
        if (t >= 356813)
            return "(99:59:59)";
        var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
        var mm = h > 0 && m < 10 ? "0" + m : String(m);
        return "(" + (h > 0 ? h + ":" : "") + mm + ":" + (sec < 10 ? "0" : "") + sec + ")";
    }

    // A banner, with or without a notification behind it
    // (PalmSystem.addBannerMessage only scrolls a banner by). Banners queue
    // (BannerMessageHandler::addMessage): one alone shows for 5 s; while
    // others wait each shows for 2 s, and a new one cuts the one showing
    // down to 2 s from when it came in. id (with appId) is what
    // removeBanner and clearBanners find it by; onShow runs as it starts
    // to show (aboutToShowBanner: its sound).
    property var _bannerQueue: []
    property var _bannerShowing: null
    property double _bannerShownAt: 0
    property bool _bannerAlone: true
    readonly property int bannerQueueLength: _bannerQueue.length
    function showBanner(text, icon, color, glyph, appId, params, id, onShow) {
        if (!text)
            return;
        var b = { text: String(text), icon: icon || "", color: color || "#666666", glyph: glyph || "",
                  appId: appId || "", params: params || "", id: id || "", onShow: onShow || null };
        _bannerQueue = _bannerQueue.concat([b]);
        if (_bannerShowing === null) {
            _nextBanner();
        } else if (_bannerAlone) {
            // The one showing had 5 s; now 2 s from when it was in place,
            // or none if it has been up longer.
            _bannerAlone = false;
            if (bannerHold.running) {
                bannerHold.interval = Math.max(0, Theme.bannerShowTimeQueued - (Date.now() - _bannerShownAt));
                bannerHold.restart();
            }
        }
    }
    function _nextBanner() {
        if (_bannerQueue.length === 0) {
            _bannerShowing = null;
            bannerActive = false;
            return;
        }
        var b = _bannerQueue[0];
        _bannerQueue = _bannerQueue.slice(1);
        _bannerShowing = b;
        bannerText = b.text;
        bannerIcon = b.icon;
        bannerColor = b.color;
        bannerGlyph = b.glyph;
        bannerAppId = b.appId;
        bannerParams = b.params;
        bannerActive = true;
        bannerHold.stop();
        _bannerAlone = _bannerQueue.length === 0;
        bannerHide.stop();
        bannerContent.opacity = 1;
        bannerShow.restart();
        if (b.onShow)
            b.onShow();
    }
    // BannerMessageHandler::removeMessage: the one showing leaves now
    // (signalHideBanner), a waiting one is dropped.
    function removeBanner(appId, id) {
        if (_bannerShowing !== null && _bannerShowing.appId === appId && _bannerShowing.id === id) {
            _hideBanner();
            return;
        }
        _bannerQueue = _bannerQueue.filter(function (b) { return !(b.appId === appId && b.id === id); });
    }
    // BannerMessageHandler::clearMessages: all of an app's banners.
    function clearBanners(appId) {
        _bannerQueue = _bannerQueue.filter(function (b) { return b.appId !== appId; });
        if (_bannerShowing !== null && _bannerShowing.appId === appId)
            _hideBanner();
    }
    function _hideBanner() {
        bannerHold.stop();
        if (bannerHide.running)
            return;
        bannerShow.stop();
        bannerHide.restart();
    }
    // Clearing bannerActive from outside drops the banner and the queue.
    onBannerActiveChanged: {
        if (!bannerActive && _bannerShowing !== null) {
            _bannerQueue = [];
            _bannerShowing = null;
            bannerShow.stop();
            bannerHold.stop();
            bannerHide.stop();
            bannerProgress = 0;
        }
    }

    // BannerWindow::handleTap: while a banner shows, a tap activates it
    // (its app with its launch params; nothing without params); otherwise
    // it opens the dashboard.
    function tapBanner() {
        // ActiveCallBanner::handleTap: back to the call.
        if (activeCallShown) {
            activated(activeCall.appId, JSON.stringify({ action: "activecall" }));
            return;
        }
        if (bannerActive) {
            if (bannerAppId !== "" && bannerParams !== "")
                activated(bannerAppId, bannerParams);
        } else if (hasNotifications) {
            dashboardOpen = true;
        }
    }

    // Phones scroll the banner up from the bottom of the bar
    // (BannerWindow: VerticalScroll), tablets in from the right
    // (HorizontalScroll): over 1000 ms OutCubic; after its time it goes back
    // the way it came, fading to 0.25 (BannerMessageHandler.cpp:111-131,
    // 315-345, 611-625). progress is posAnimProgress: 0 out, 1 in place.
    property real bannerProgress: 0
    NumberAnimation {
        id: bannerShow
        target: root; property: "bannerProgress"; from: 0; to: 1
        duration: Theme.bannerSlideDuration; easing.type: Easing.OutCubic
        onFinished: {
            root._bannerShownAt = Date.now();
            bannerHold.interval = root._bannerAlone ? Theme.bannerShowTime : Theme.bannerShowTimeQueued;
            bannerHold.restart();
        }
    }
    // The show state's timer (5 s, or 2 s with others queued).
    Timer {
        id: bannerHold
        onTriggered: root._hideBanner()
    }
    ParallelAnimation {
        id: bannerHide
        NumberAnimation { target: root; property: "bannerProgress"; to: 0; duration: Theme.bannerSlideDuration }
        NumberAnimation { target: bannerContent; property: "opacity"; to: 0.25; duration: Theme.bannerSlideDuration }
        onFinished: root._nextBanner()
    }

    onAlertKeyChanged: Qt.callLater(attachAlert)
    onLockedChanged: Qt.callLater(attachAlert)
    function attachAlert() {
        var w = alertKey !== "" && source ? source.windowFor(alertKey) : null;
        if (!w) {
            alertTopPadding = 0;
            return;
        }
        var host = locked && lockAlertHost ? lockAlertHost : overlay ? tabletAlertHost : phoneAlertHost;
        // A page (a WebAppWindow runs scripts); the shell's own alerts do not.
        var web = typeof w.runScript === "function";
        alertTopPadding = host === phoneAlertHost && web ? Theme.phoneAlertTopPadding : 0;
        w.parent = host;
        w.x = 0;
        w.y = Qt.binding(function() { return host === phoneAlertHost ? root.alertTopPadding : 0; });
        w.width = Qt.binding(function() { return host.width; });
        w.height = Qt.binding(function() { return host === phoneAlertHost ? root.alertHeight : host.height; });
        w.visible = true;
    }

    // Everything but the lock screen's alert; the lock screen shows no
    // negative space and draws its own banner and dashboard (LockScreen).
    Item {
        id: normalLayer
        anchors.fill: parent
        visible: !root.locked

        // ---- Tap outside the open dashboard to close it -----------------------------

        MouseArea {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: root.overlay ? parent.bottom : space.top
            visible: root.dashboardOpen
            onClicked: root.dashboardOpen = false
        }

        // ---- The notification area ----------------------------------------------------
        // Phones: the negative space at the bottom, level with the app.
        // Tablets: a strip in the status bar, left of the system indicators.

        Rectangle {
            id: space
            color: root.overlay ? Theme.statusBarFill : Theme.black
            clip: true
            // Tablets: right of the centred clock.
            x: root.overlay ? root.width / 2 + Theme.px(40) : 0
            width: root.overlay ? root.width / 2 - Theme.px(40) - root.statusBarRightInset : root.width
            y: root.overlay ? -Theme.statusBarHeight : root.height - height
            height: root.overlay ? Theme.statusBarHeight : root.phoneSpaceHeight
            visible: root.overlay ? root.bannerActive : height > 0

            // The banner, in the bar's top 28 px while the space opens under it.
            Item {
                id: banner
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                height: Math.min(Theme.bannerHeight, parent.height)
                clip: true
                visible: root.bannerActive && !root.dashboardOpen && !root.activeCallShown

                Image {
                    anchors.fill: parent
                    source: Theme.asset("overlay-banner-bg.png")
                    fillMode: Image.Stretch
                    visible: !root.overlay
                }

                Row {
                    id: bannerContent
                    objectName: "bannerContent"
                    x: root.overlay ? Theme.px(5) + (1 - root.bannerProgress) * banner.width : Theme.px(5)
                    y: (banner.height - height) / 2 + (root.overlay ? 0 : (1 - root.bannerProgress) * banner.height)
                    spacing: Theme.px(5)
                    AppIcon {
                        size: Theme.px(22)
                        showLabel: false
                        color: root.bannerColor
                        glyph: root.bannerGlyph
                        source: root.bannerIcon
                    }
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        // Too long for the bar: cut off at its end
                        // (BannerMessage::createElidedMessage, ElideRight).
                        width: Math.min(implicitWidth, banner.width - Theme.px(5) * 3 - Theme.px(22))
                        elide: Text.ElideRight
                        text: root.bannerText
                        color: Theme.text
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.bannerFontSize
                    }
                }
            }

            // Phones: the call, its icon, who it is with and how long
            // (ActiveCallBanner.cpp: black, white 16 px text, 2 px in).
            Rectangle {
                id: activeCallRow
                objectName: "activeCallBanner"
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                height: Math.min(Theme.bannerHeight, parent.height)
                color: Theme.black
                visible: root.activeCallShown && !root.dashboardOpen
                property real now: Date.now()
                Timer {
                    interval: 450
                    repeat: true
                    running: activeCallRow.visible
                    triggeredOnStart: true
                    onTriggered: activeCallRow.now = Date.now()
                }
                readonly property string elapsed: root.activeCall ? root.callTime(root.activeCall.startTime, now) : ""
                AppIcon {
                    id: activeCallIcon
                    x: Theme.px(2)
                    y: Theme.px(2)
                    size: parent.height - Theme.px(4)
                    showLabel: false
                    source: root.activeCall ? root.activeCall.icon : ""
                }
                Text {
                    id: activeCallText
                    objectName: "activeCallText"
                    anchors.left: activeCallIcon.right
                    anchors.leftMargin: Theme.px(4)
                    anchors.right: parent.right
                    anchors.rightMargin: Theme.px(2)
                    anchors.verticalCenter: parent.verticalCenter
                    text: (root.activeCall ? root.activeCall.message : "") + " " + activeCallRow.elapsed
                    color: Theme.text
                    elide: Text.ElideMiddle
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.px(16)
                }
            }

            // Phones: the waiting notifications' icons, once the banner is
            // gone: right-aligned, side by side with no gaps, the newest at
            // the right, each as tall as the bar at most
            // (BannerWindow::paint, BannerWindow.cpp:90-115).
            Row {
                id: phoneIcons
                objectName: "phoneNotificationIcons"
                anchors.right: parent.right
                y: (Theme.bannerHeight - height) / 2
                spacing: 0
                visible: !root.overlay && !root.bannerActive && !root.dashboardOpen && !root.activeCallShown
                Repeater {
                    model: root.overlay ? null : root.model
                    delegate: AppIcon {
                        required property var model
                        size: Theme.bannerHeight
                        showLabel: false
                        color: model.color
                        glyph: model.glyph
                        source: model.icon || ""
                    }
                }
            }

            MouseArea {
                objectName: "bannerTap"
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                height: Theme.bannerHeight
                visible: (root.hasNotifications || root.bannerActive || root.activeCallShown) && !root.dashboardOpen
                onClicked: root.tapBanner()
            }

            // Phones: the dashboard fills the space as it grows (10 px top padding,
            // DashboardWindowContainer.cpp:96-108), newest at the bottom. The
            // masks show while rows are scrolled out of view above or below
            // (setMaskVisibility, :1019-1036; paint, :1303-1318).
            Item {
                anchors.fill: parent
                visible: !root.overlay && root.dashboardOpen
                // Taps on the dashboard stay in it: between the header's
                // buttons, or under the rows of a drawer pulled to the whole
                // screen, they never reach the cards or Just Type beneath.
                MouseArea { anchors.fill: parent }
                // Pull up for the whole screen (Phoenix).
                DrawerHandle {
                    id: phoneHandle
                    width: parent.width
                    expanded: root.drawerExpanded
                    expandsUp: true
                    enabled: !root.overlay && root.dashboardOpen
                    onExpandRequested: root.setDrawerExpanded(true)
                    onCollapseRequested: root.setDrawerExpanded(false)
                    onCloseRequested: root.dashboardOpen = false
                }
                DrawerHeader {
                    id: phoneHeader
                    anchors.top: phoneHandle.bottom
                    width: parent.width
                    visible: root.drawerExpanded
                    selecting: root.selecting
                    selectedCount: root.selectedCount
                    clearableCount: root.clearableCount
                    onSelectRequested: root.selecting = true
                    onCancelRequested: { root.selecting = false; root.selectedIds = {}; }
                    onClearSelectedRequested: root.clearSelected()
                    onClearAllRequested: root.clearAll()
                }
                Loader {
                    id: phoneDashboard
                    anchors.fill: parent
                    anchors.topMargin: Theme.drawerHandleHeight + (root.drawerExpanded ? Theme.drawerHeaderHeight : 0) + Theme.dashboardTopPadding
                    active: parent.visible
                    sourceComponent: dashboardList
                    // At the newest notification (the end), as the original;
                    // with live activities, at them: they are pinned on top.
                    onLoaded: root.ongoingCount > 0 ? item.positionViewAtBeginning() : item.positionViewAtEnd()
                }
                Image {
                    objectName: "dashboardMaskTop"
                    visible: phoneDashboard.item !== null && !phoneDashboard.item.atYBeginning
                    y: phoneDashboard.y - Theme.dashboardTopPadding
                    width: parent.width
                    height: Theme.artHeight(source)
                    source: Theme.asset("dashboard-mask-top.png")
                    fillMode: Image.Stretch
                }
                Image {
                    objectName: "dashboardMaskBottom"
                    visible: phoneDashboard.item !== null && !phoneDashboard.item.atYEnd
                    y: parent.height - Theme.dashboardBottomMaskOffset
                    width: parent.width
                    height: Theme.artHeight(source)
                    source: Theme.asset("dashboard-mask-bottom.png")
                    fillMode: Image.Stretch
                }
            }
        }

        // ---- Popup alerts ---------------------------------------------------------------
        // The front alert window (low battery, an alarm, an incoming call...):
        // phones give it the negative space, full width, level with the app;
        // tablets show it 320 px wide at the top right on popup-bg.png, 5 px in,
        // fading in over 400 ms (DashboardWindowManager.cpp:516-560, 1341-1355;
        // GraphicsItemContainer.cpp: 20 px margin).

        Rectangle {
            id: phoneAlert
            visible: !root.overlay && root.alertShown
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: root.negativeSpace
            color: Theme.black
            clip: true
            z: 2
            MouseArea { anchors.fill: parent }
            Item {
                id: phoneAlertHost
                objectName: "phoneAlertHost"
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                height: root.alertHeight + root.alertTopPadding
            }
        }

        ArtBorderImage {
            id: tabletAlert
            visible: opacity > 0
            opacity: root.overlay && root.alertShown ? 1 : 0
            Behavior on opacity { NumberAnimation { duration: Theme.alertFadeDuration } }
            anchors.right: parent.right
            anchors.rightMargin: Theme.px(5)
            y: Theme.px(5)
            width: Theme.px(320) + 2 * Theme.px(20)
            height: root.alertHeight + 2 * Theme.px(20)
            source: Theme.asset("popup-bg.png")
            border { left: Theme.artBorder(20, source); right: Theme.artBorder(20, source); top: Theme.artBorder(20, source); bottom: Theme.artBorder(20, source) }
            z: 2
            MouseArea { anchors.fill: parent }
            // The scene behind, blurred faintly within the panel's shape.
            BackdropBlur {
                anchors.fill: parent
                z: -1
                source: root.backdrop
                mask: alertShape
            }
            ArtBorderImage {
                id: alertShape
                visible: false
                anchors.fill: parent
                source: Theme.asset("popup-bg.png")
                border { left: Theme.artBorder(20, source); right: Theme.artBorder(20, source); top: Theme.artBorder(20, source); bottom: Theme.artBorder(20, source) }
            }
            Item {
                id: tabletAlertHost
                anchors.fill: parent
                anchors.margins: Theme.px(20)
            }
        }

        // Tablets: the notification icons are a group of their own, as
        // luna-sysmgr's (StatusBar m_notifGroup): a separator at its left,
        // and its own tab behind the icons while the drop-down is open (the
        // system menu's tab covers the system group only). Its caps lie
        // outside the icons with some padding (Theme.statusBarTabCap), so
        // every icon is on the tab's solid part.
        // The group fades in with the first notification and out after the
        // last, 300 ms linear (StatusBarItemGroup::show / hide, :185-232;
        // Theme.statusBarTabFadeDuration); its icons fade out while a banner
        // shows and back after it, 300 ms linear (StatusBarNotificationArea::
        // setIconsShown, :368-397).
        property real groupOpacity: root.overlay && root.hasNotifications ? 1 : 0
        Behavior on groupOpacity { NumberAnimation { objectName: "notificationGroupFade"; duration: Theme.statusBarTabFadeDuration } }
        property real iconsOpacity: root.bannerActive ? 0 : 1
        Behavior on iconsOpacity { NumberAnimation { objectName: "notificationIconsFade"; duration: Theme.notificationIconsFadeDuration } }
        readonly property real groupShown: groupOpacity * iconsOpacity

        ArtBorderImage {
            id: notifTab
            objectName: "notificationTab"
            visible: tabletIcons.visible && opacity > 0
            x: tabletIcons.x - Theme.statusBarTabCap - Theme.statusBarTabPadding
            y: -Theme.statusBarHeight
            width: tabletIcons.width + 2 * (Theme.statusBarTabCap + Theme.statusBarTabPadding)
            height: Theme.statusBarHeight
            source: Theme.asset("statusBar/status-bar-menu-dropdown-tab.png")
            border { left: Theme.artBorder(11, source); right: Theme.artBorder(11, source); top: 0; bottom: 0 }
            opacity: root.dashboardOpen ? 1 : 0
            Behavior on opacity { NumberAnimation { duration: Theme.statusBarMenuFadeDuration } }
        }
        Image {
            id: notifSeparator
            objectName: "notificationSeparator"
            visible: tabletIcons.visible
            x: tabletIcons.x - Theme.px(5) - width
            y: -Theme.statusBarHeight + (Theme.statusBarHeight - height) / 2
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
            source: Theme.asset("statusBar/status-bar-separator.png")
            opacity: (1 - notifTab.opacity) * tabletIcons.opacity
        }
        // At most ten icons' width (MAX_NOTIF_ICONS x (24 + 5), StatusBar.
        // cpp:128); past it the leftmost is cut off (StatusBarNotificationArea::
        // paint, "paint partial").
        Item {
            id: tabletIcons
            objectName: "tabletNotificationIcons"
            visible: root.overlay && opacity > 0
            opacity: normalLayer.groupShown
            anchors.right: parent.right
            anchors.rightMargin: root.statusBarRightInset + Theme.px(6)
            y: -Theme.statusBarHeight + (Theme.statusBarHeight - height) / 2
            width: Math.min(tabletIconRow.width, Theme.px(10 * (24 + 5)))
            height: tabletIconRow.height
            clip: true
            Row {
                id: tabletIconRow
                anchors.right: parent.right
                spacing: Theme.px(5)                                        // StatusBar.h:31-32
                Repeater {
                    model: root.overlay ? root.model : null
                    delegate: AppIcon {
                        required property var model
                        size: Theme.bannerHeight
                        showLabel: false
                        color: model.color
                        glyph: model.glyph
                        // The notification's small icon (a dashboard window's
                        // "icon" attribute), or its app's.
                        source: model.icon || ""
                    }
                }
            }
        }
        MouseArea {
            visible: root.overlay && root.hasNotifications && !root.bannerActive
            x: tabletIcons.x - Theme.px(5)
            y: -Theme.statusBarHeight
            width: tabletIcons.width + Theme.px(10)
            height: Theme.statusBarHeight
            onClicked: root.dashboardOpen = !root.dashboardOpen
        }

        // Tablets: the drop-down under the status bar, its right edge 11 px
        // past the notification area's (DashboardWindowManager.cpp:1244-1257,
        // 390-396; DashboardMenu).
        DashboardMenu {
            id: dropDown
            x: parent.width - root.statusBarRightInset - width + Theme.dashboardMenuEdgeOffset
            y: 0                                                // positiveSpace.y(), :1326-1338
            open: root.overlay && root.dashboardOpen
            model: root.overlay ? root.model : null
            ongoingCount: root.ongoingCount
            drawer: root
            fullHeight: root.screenHeight - Theme.statusBarHeight - Theme.px(10)
            source: root.source
            backdrop: root.backdrop
            locked: root.locked
            onActivated: (appId, params) => root.activated(appId, params)
            onActionRequested: (index, actionId) => root.runAction(index, actionId)
            onDismissRequested: (index) => root.dismissRequested(index)
        }
    }

    // ---- On the lock screen ------------------------------------------------------------
    // The lock screen shows the front alert itself, between its wallpaper
    // and its padlock (LockScreen.alertHost); the window moves there.
    property Item lockAlertHost: null

    // ---- Dashboard items (phones) ----------------------------------------------------

    Component {
        id: dashboardList

        ListView {
            id: list
            objectName: "phoneDashboardList"
            clip: true
            model: root.model
            interactive: contentHeight > height

            // A trackpad's two-finger swipe sideways on a row moves it as a
            // finger does and, once the fingers lift, dismisses it (past a
            // quarter of the width, or quick: card view's trackpad flick) or
            // springs it back; up or down it scrolls the list, momentum and
            // all, within its ends. A mouse wheel scrolls it (Phoenix).
            TrackpadSwipe {
                parent: list
                objectName: "phoneDashboardWheel"
                anchors.fill: parent
                z: 5
                verticalMomentum: true
                property Item row: null
                onNotched: (dx, dy) => scrollBy(list, dy / 120 * Theme.dashboardItemHeight)
                onStarted: (x, y) => {
                    row = null;
                    if (axis === "h") {
                        var r = list.itemAt(x, y + list.contentY);
                        if (r && r.wheelSwipeable)
                            row = r;
                        else
                            axis = "done";
                    } else if (!list.interactive) {
                        axis = "done";
                    }
                }
                onMoved: (dx, dy) => {
                    if (axis === "h")
                        row.wheelMove(sumX);
                    else
                        scrollBy(list, dy);
                }
                onEnded: {
                    if (axis === "h" && row)
                        row.wheelRelease(vx);
                    row = null;
                }
            }

            delegate: Item {
                id: item
                required property int index
                required property string appId
                required property string title
                required property string body
                required property color color
                required property string glyph
                required property string icon
                required property string params
                required property string windowKey
                required property bool ongoing
                required property real progress
                required property var model
                readonly property string key: model.id
                // A dashboard window nothing but its app takes away; one that
                // takes its own drags (see the swipe MouseArea).
                readonly property bool persistent: model.persistent === true
                readonly property bool manualDrag: windowKey !== "" && model.manualDrag === true
                readonly property bool selectable: root.selecting && !ongoing && !persistent
                // Swiped (or swiping) off its place.
                readonly property bool slidOut: content.x !== 0
                width: list.width

                // A row its app takes away (not a swipe) slides on a width
                // and a half over 200 ms, linear, before it goes and the rows
                // under it close up (DashboardWindowContainer::removeWindow,
                // :653-709, slotDeleteAnimationFinished, :724-741); a row
                // swiped away has made that move already and goes at once.
                // (Not a remove transition: the list shrinks with the
                // dashboard as the row goes, which ends a transition at once.)
                ListView.onRemove: if (!item.slidOut) leave.start()
                readonly property alias leaveAnimation: leaveSlide
                SequentialAnimation {
                    id: leave
                    PropertyAction { target: item; property: "ListView.delayRemove"; value: true }
                    NumberAnimation {
                        id: leaveSlide
                        objectName: "dashboardRowLeave"
                        target: content
                        property: "x"
                        to: Theme.dashboardDeleteTravel * content.width
                        duration: Theme.dashboardDeleteDuration
                    }
                    PropertyAction { target: item; property: "ListView.delayRemove"; value: false }
                }
                height: Theme.dashboardItemHeight

                // A trackpad's swipe (the list's TrackpadSwipe): as the
                // finger's drag below, and its release.
                readonly property bool wheelSwipeable: !item.ongoing && !root.selecting && !remove.running
                function wheelMove(x) {
                    snap.stop();
                    content.x = x;
                }
                function wheelRelease(vx) {
                    if (!item.persistent && (Math.abs(vx) > Theme.wheelFlickVelocity
                                             || Math.abs(content.x) > content.width * Theme.dashboardDismissRatio))
                        remove.start();
                    else if (content.x !== 0)
                        snap.start();
                }

                // The keyboard's highlight.
                Rectangle {
                    objectName: "dashboardKeyFocus"
                    visible: root.keyRow === item.index
                    anchors.fill: parent
                    anchors.margins: Theme.px(2)
                    radius: Theme.px(6)
                    color: "#302c8ce0"
                    border.color: "#2c8ce0"
                    border.width: Theme.px(2)
                    z: 3
                }
                // A faint rule between the live activities and the
                // notifications (Phoenix).
                Rectangle {
                    objectName: "drawerRule"
                    visible: root.ongoingCount > 0 && item.index === root.ongoingCount
                    x: Theme.px(8)
                    width: parent.width - 2 * x
                    height: Math.max(1, Theme.px(1))
                    color: Theme.drawerRule
                    z: 2
                }

                // Uncovered as the row is swiped away (Phoenix).
                SwipeClearLabel {
                    distance: Math.abs(content.x)
                    rowWidth: item.width
                    fromRight: content.x < 0
                    // Not for a row its app took away (leave): nobody swiped;
                    // nor for one a swipe does not clear.
                    visible: !item.ongoing && !item.persistent && content.x !== 0 && !leave.running
                }

                // Let go after a drag: dragged more than a quarter of the
                // width, or flicked sideways, it slides off and is
                // dismissed; otherwise (or a row a swipe does not clear) it
                // snaps back (DashboardWindowContainer.cpp:340-360, 426-440,
                // 700-708).
                function releaseDrag(vx, vy) {
                    var speed = Math.abs(vx) + Math.abs(vy);
                    var flicked = speed >= Theme.flickMinVelocity && speed <= Theme.flickMaxVelocity
                        && Math.abs(vx) > Math.abs(vy);
                    if (!item.persistent && (flicked || Math.abs(content.x) > content.width * Theme.dashboardDismissRatio))
                        remove.start();
                    else if (content.x !== 0)
                        snap.start();
                }
                DashboardItem {
                    id: content
                    width: parent.width
                    height: parent.height
                    opacity: 1 - Math.abs(x) / width
                    source: root.source
                    windowKey: item.windowKey
                    title: item.title
                    body: item.body
                    color: item.color
                    glyph: item.glyph
                    icon: item.icon
                    progress: item.progress
                    actions: item.model.actions || ""
                    onActionTapped: (actionId) => root.runAction(item.index, actionId)

                    // The lock screen showed the window while locked; it
                    // comes back here (LockScreen's dashboard).
                    Connections {
                        target: root
                        function onLockedChanged() { if (!root.locked) content.claim(); }
                    }

                    // Dragged more than a quarter of the width, or flicked
                    // sideways, it slides off and is dismissed; otherwise it
                    // snaps back (DashboardWindowContainer.cpp:340-360,
                    // 426-440, 700-708).
                    MouseArea {
                        id: swipe
                        objectName: "dashboardSwipe"
                        anchors.fill: parent
                        // Over the app's dashboard window: the row has the
                        // touches and passes them on (below); under the
                        // answers' buttons otherwise.
                        z: item.windowKey !== "" ? 3 : 0
                        // An ongoing activity stays until it ends.
                        drag.target: item.ongoing || root.selecting || forwarding ? null : content
                        drag.axis: Drag.XAxis
                        enabled: !remove.running
                        property point start
                        property real startTime: 0
                        // DashboardWindowContainer had the touches on a
                        // dashboard window and passed a tap on to it
                        // (handleTap, :1104-1146: a pen down and up). A
                        // window that takes its own drags (webosDragMode
                        // "manual": enyo.Dashboard opens its window so and
                        // swipes its layers itself, Dashboard.js:107;
                        // IpcClientHost.cpp:288-291) got the press, the moves
                        // and the release of a touch that began on it at
                        // rest right of its 50 px badge
                        // (sDashboardBadgeWidth): it is not the row's, unless
                        // it goes up or down first, which cancels it for the
                        // window (:172-307, 329-412). On the badge the row
                        // is dragged as any other.
                        property bool forwarding: false
                        property bool moved: false
                        onPressed: (m) => {
                            snap.stop();
                            start = mapToItem(root, m.x, m.y);
                            startTime = root.clock();
                            moved = false;
                            forwarding = item.manualDrag && !root.selecting && content.x === 0 && m.x > Theme.dashboardBadgeWidth;
                            if (forwarding)
                                content.pointer("down", m.x, m.y);
                        }
                        onPositionChanged: (m) => {
                            if (!forwarding)
                                return;
                            var p = mapToItem(root, m.x, m.y);
                            var dx = p.x - start.x, dy = p.y - start.y;
                            if (!moved && dx * dx + dy * dy >= Theme.tapRadius * Theme.tapRadius) {
                                moved = true;
                                if (Math.abs(dx) <= Math.abs(dy)) {
                                    content.pointer("cancel", m.x, m.y);
                                    forwarding = false;
                                    return;
                                }
                            }
                            content.pointer("move", m.x, m.y);
                        }
                        onCanceled: {
                            if (forwarding)
                                content.pointer("cancel", start.x, start.y);
                            forwarding = false;
                            if (content.x !== 0)
                                snap.start();
                        }
                        onReleased: (m) => {
                            if (forwarding) {
                                forwarding = false;
                                // Not past the tap radius: a tap (the page
                                // makes a click of a pen down and up).
                                content.pointer(moved ? "up" : "tapup", m.x, m.y);
                                return;
                            }
                            var p = mapToItem(root, m.x, m.y);
                            var ms = root.clock() - startTime;
                            item.releaseDrag(ms > 0 ? (p.x - start.x) / ms : 0, ms > 0 ? (p.y - start.y) / ms : 0);
                        }
                        onClicked: (m) => {
                            if (content.x !== 0 || item.manualDrag && moved)
                                return;
                            if (root.selecting) {
                                if (item.selectable)
                                    root.toggleSelected(item.key);
                                return;
                            }
                            // A dashboard window: the tap is its page's.
                            if (item.windowKey !== "") {
                                if (!item.manualDrag || m.x <= Theme.dashboardBadgeWidth)
                                    content.pointer("tap", m.x, m.y);
                                return;
                            }
                            root.activated(item.appId, item.params);
                            if (!item.ongoing && !item.persistent)
                                root.dismissRequested(item.index);
                        }
                    }
                    SelectMark {
                        visible: item.selectable
                        anchors.right: parent.right
                        anchors.rightMargin: Theme.px(12)
                        anchors.verticalCenter: parent.verticalCenter
                        checked: !!root.selectedIds[item.key]
                    }
                    NumberAnimation {
                        id: remove
                        target: content
                        property: "x"
                        to: content.x + Theme.dashboardDeleteTravel * content.width
                        duration: Theme.dashboardDeleteDuration
                        onFinished: root.dismissRequested(item.index)
                    }
                    NumberAnimation {
                        id: snap
                        target: content
                        property: "x"
                        to: 0
                        duration: Theme.dashboardSnapDuration
                        easing.type: Easing.OutCubic
                    }
                }
            }
        }
    }
}
