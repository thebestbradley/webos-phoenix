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
                                  // until it ends), progress (0-100, -1: none)
    // The window source: its alerts (popup alert windows) and windowFor(key)
    // for alert and dashboard windows.
    property var source
    // The scene behind, for the blur under the tablet panels.
    property Item backdrop: null
    property bool dashboardOpen: false
    // Tablet: where the status bar's system indicators begin (from the right).
    property real statusBarRightInset: 0
    // Height of the whole screen, for the dashboard's maximum size.
    property real screenHeight: height

    signal dismissRequested(int index)
    signal activated(string appId, string params)

    readonly property bool overlay: Theme.tablet
    readonly property bool hasNotifications: model && model.count > 0
    property bool bannerActive: false
    // The dashboard has content while a banner shows or notifications wait
    // (DashboardWindowManager::setBannerHasContent, :454-465).
    readonly property bool hasContent: hasNotifications || bannerActive

    // ---- The drawer (Phoenix) ------------------------------------------------------
    // Live activities (ongoing) are pinned at the top of the list, above the
    // notifications (the window sources insert them there); ongoingCount is
    // how many lead the list. The open dashboard has a handle that pulls it
    // to the whole screen, whose header offers Select and Clear All.
    property int ongoingCount: 0
    function _countOngoing() {
        var n = 0;
        while (model && n < model.count && model.get(n).ongoing)
            ++n;
        ongoingCount = n;
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
    readonly property int clearableCount: (model ? model.count : 0) - ongoingCount

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
            if (!model.get(i).ongoing && selectedIds[model.get(i).id])
                list.push(i);
        selecting = false;
        selectedIds = {};
        _dismissAll(list);
    }
    function clearAll() {
        var list = [];
        for (var i = 0; i < model.count; ++i)
            if (!model.get(i).ongoing)
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
        : alertShown && !overlay ? alertHeight
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
            root.showBanner(n.title + (n.body ? ": " + n.body : ""), n.icon || "", n.color, n.glyph, n.appId, n.params || "");
        }
        function onCountChanged() {
            if (root.model.count === 0)
                root.dashboardOpen = false;
        }
    }

    // A banner, with or without a notification behind it
    // (PalmSystem.addBannerMessage only scrolls a banner by).
    function showBanner(text, icon, color, glyph, appId, params) {
        bannerText = text;
        bannerIcon = icon || "";
        bannerColor = color || "#666666";
        bannerGlyph = glyph || "";
        bannerAppId = appId || "";
        bannerParams = params || "";
        bannerActive = true;
        bannerAnim.restart();
    }

    // BannerWindow::handleTap: while a banner shows, a tap activates it
    // (its app with its launch params; nothing without params); otherwise
    // it opens the dashboard.
    function tapBanner() {
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
    SequentialAnimation {
        id: bannerAnim
        PropertyAction { target: bannerContent; property: "opacity"; value: 1 }
        NumberAnimation { target: root; property: "bannerProgress"; from: 0; to: 1; duration: Theme.bannerSlideDuration; easing.type: Easing.OutCubic }
        PauseAnimation { duration: root.model && root.model.count > 1 ? Theme.bannerShowTimeQueued : Theme.bannerShowTime }
        ParallelAnimation {
            NumberAnimation { target: root; property: "bannerProgress"; to: 0; duration: Theme.bannerSlideDuration }
            NumberAnimation { target: bannerContent; property: "opacity"; to: 0.25; duration: Theme.bannerSlideDuration }
        }
        ScriptAction { script: root.bannerActive = false }
    }

    onAlertKeyChanged: Qt.callLater(attachAlert)
    onLockedChanged: Qt.callLater(attachAlert)
    function attachAlert() {
        var w = alertKey !== "" && source ? source.windowFor(alertKey) : null;
        if (!w)
            return;
        var host = locked && lockAlertHost ? lockAlertHost : overlay ? tabletAlertHost : phoneAlertHost;
        w.parent = host;
        w.x = 0;
        w.y = 0;
        w.width = Qt.binding(function() { return host.width; });
        w.height = Qt.binding(function() { return host.height; });
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
                visible: root.bannerActive && !root.dashboardOpen

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
                        text: root.bannerText
                        color: Theme.text
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.bannerFontSize
                    }
                }
            }

            // Phones: the waiting notifications' icons, once the banner is gone.
            Row {
                id: phoneIcons
                anchors.right: parent.right
                anchors.rightMargin: Theme.px(8)
                y: (Theme.bannerHeight - height) / 2
                spacing: Theme.px(4)
                visible: !root.overlay && !root.bannerActive && !root.dashboardOpen
                Repeater {
                    model: root.overlay ? null : root.model
                    delegate: AppIcon {
                        required property var model
                        size: Theme.px(22)
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
                visible: (root.hasNotifications || root.bannerActive) && !root.dashboardOpen
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
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                height: root.alertHeight
            }
        }

        BorderImage {
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
            BorderImage {
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
        // system menu's tab covers the system group only).
        BorderImage {
            id: notifTab
            objectName: "notificationTab"
            visible: tabletIcons.visible && opacity > 0
            x: notifSeparator.x
            y: -Theme.statusBarHeight
            width: tabletIcons.x + tabletIcons.width + Theme.px(5) - x
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
            opacity: 1 - notifTab.opacity
        }
        Row {
            id: tabletIcons
            visible: root.overlay && root.hasNotifications && !root.bannerActive
            anchors.right: parent.right
            anchors.rightMargin: root.statusBarRightInset + Theme.px(6)
            y: -Theme.statusBarHeight + (Theme.statusBarHeight - height) / 2
            spacing: Theme.px(5)                                        // StatusBar.h:31-32
            Repeater {
                model: root.overlay ? root.model : null
                delegate: AppIcon {
                    required property var model
                    size: Theme.px(22)
                    showLabel: false
                    color: model.color
                    glyph: model.glyph
                    // The notification's small icon (a dashboard window's
                    // "icon" attribute), or its app's.
                    source: model.icon || ""
                }
            }
        }
        MouseArea {
            visible: tabletIcons.visible
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
                readonly property bool selectable: root.selecting && !ongoing
                width: list.width
                height: Theme.dashboardItemHeight

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
                    visible: !item.ongoing && content.x !== 0
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
                        // An ongoing activity stays until it ends.
                        drag.target: item.ongoing || root.selecting ? null : content
                        drag.axis: Drag.XAxis
                        enabled: !remove.running
                        property point start
                        property real startTime: 0
                        onPressed: (m) => {
                            snap.stop();
                            start = mapToItem(root, m.x, m.y);
                            startTime = Date.now();
                        }
                        onReleased: (m) => {
                            var p = mapToItem(root, m.x, m.y);
                            var ms = Date.now() - startTime;
                            var vx = ms > 0 ? (p.x - start.x) / ms : 0, vy = ms > 0 ? (p.y - start.y) / ms : 0;
                            var speed = Math.abs(vx) + Math.abs(vy);
                            var flicked = speed >= Theme.flickMinVelocity && speed <= Theme.flickMaxVelocity
                                && Math.abs(vx) > Math.abs(vy);
                            if (flicked || Math.abs(content.x) > content.width * Theme.dashboardDismissRatio)
                                remove.start();
                            else if (content.x !== 0)
                                snap.start();
                        }
                        onClicked: {
                            if (content.x !== 0)
                                return;
                            if (root.selecting) {
                                if (item.selectable)
                                    root.toggleSelected(item.key);
                                return;
                            }
                            root.activated(item.appId, item.params);
                            if (!item.ongoing)
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
