// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The 28px black status bar: carrier or app name on the left, clock in the
// centre, radios and battery on the right. Tapping the right side opens the
// system menu, tapping the app name opens the app menu. On the lock screen
// it is LockWindow's own bar (StatusBar::TypeLockScreen): the date in the
// centre instead of the time, and neither menu.

import QtQuick
import Phoenix.Native

Item {
    id: bar

    property var system
    // Shown on the left: the maximized app's title, "Launcher" or "Just
    // Type", else the carrier (SystemUiController::updateStatusBarTitle).
    property string title: system ? system.carrier : ""
    // Phones: on appname-background.png (everything but the carrier).
    property bool titleBorder: false
    // Tapping the title opens a menu: the arrow shows.
    property bool titleActionable: false
    // Tablets: the fill under the art (the launcher's and Just Type's
    // #4F545A, else the default), changing over 300 ms.
    property color fillColor: Theme.statusBarFill
    property bool systemMenuOpen: false
    property bool lockScreen: false
    // Settings > Advanced > Battery percentage (the community's "Battery
    // Percent and Icon" patches): the charge beside the battery.
    property bool batteryPercent: false
    // The microphone (a Phoenix addition; webOS showed none): "on" while
    // something records (dictation, the assistant), "standby" while it
    // listens for "Hey Phoenix" only (subtle), "" when it is closed.
    property string microphone: ""
    // Tablet: an app, the launcher or Just Type is up; the bar's fill fades
    // in under its tiled art (StatusBar::fadeBar, setMaximizedAppTitle).
    property bool filled: false
    // Width of the system group at the right: its indicators, on tablets
    // the arrow at its right end and the separator at its left
    // (StatusBarItemGroup::layoutRight). Tablet notification icons go just
    // left of it.
    readonly property real systemGroupWidth: indicators.width + indicators.anchors.rightMargin
        + (Theme.tablet && !lockScreen ? systemSeparator.width + Theme.px(6) : 0)

    // The screen's shape where the bar is (Shell.displayCutouts,
    // displayCornerRadius; device pixels): the camera cutouts at the top
    // edge, and the corners' radius. A Phoenix addition: webOS's screens
    // were square, without cutouts. As Phosh's top bar does
    // (phosh/src/layout-manager.c: get_clock_pos, get_corner_shift): the
    // centred clock moves beside a cutout that would cover it, to its left
    // if that leaves it clear, else to its right; and the content at both
    // ends keeps out of the rounded corners.
    property var cutouts: []
    property real cornerRadius: 0
    // How far in from each end the corners push the bar's content: where
    // the corner's arc is at the top of an icon filling 80% of the bar
    // ("Icons usually don't fill the full height so assume 80%",
    // get_corner_shift). 0 on a square screen, so the layout is the
    // original's.
    readonly property real cornerInset: {
        var r = cornerRadius, top = height * 0.1;
        if (!(r > 0) || top >= r)
            return 0;
        return Math.ceil(r - Math.sqrt(r * r - (r - top) * (r - top)));
    }

    signal systemMenuRequested
    signal appMenuRequested

    height: Theme.statusBarHeight

    function pad(n) { return n < 10 ? "0" + n : "" + n }

    property date now: new Date()
    Timer {
        interval: 1000; running: !bar.system || !bar.system.fixedTime; repeat: true
        onTriggered: bar.now = new Date()
    }
    readonly property date shownTime: system && system.fixedTime ? system.fixedTime : now
    readonly property string clockText: {
        // StatusBarClock::setDisplayDate: the locale's short date.
        if (lockScreen)
            return Qt.formatDate(shownTime, Qt.locale().dateFormat(Locale.ShortFormat));
        // 12 h without a leading zero, or 24 h (StatusBarClock::tick).
        if (system && system.twentyFourHour)
            return pad(shownTime.getHours()) + ":" + pad(shownTime.getMinutes());
        var h = shownTime.getHours() % 12;
        return (h === 0 ? 12 : h) + ":" + pad(shownTime.getMinutes());
    }

    // Phones: solid black. Tablets: #515558 under the tiled art, faded in
    // over 300 ms while an app, the launcher or Just Type is up
    // (lunaAnimations.conf statusBarFade*), the wallpaper through it otherwise.
    Rectangle {
        objectName: "statusBarFill"
        anchors.fill: parent
        color: Theme.tablet ? bar.fillColor : Theme.statusBarFill
        Behavior on color { ColorAnimation { duration: Theme.statusBarColorChangeDuration } }
        opacity: !Theme.tablet || bar.filled ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.statusBarFadeDuration } }
    }
    // Tablet only: tiled bar art over the fill (StatusBar.cpp:227,240-262).
    ArtTiledImage {
        anchors.fill: parent
        visible: Theme.tablet
        source: Theme.asset("statusBar/status-bar-background.png")
        fillMode: Image.TileHorizontally
    }

    // ---- Left: carrier / app name (StatusBarTitle, StatusBarItemGroup) -------------

    // Phones draw the title on appname-background.png for an app, the
    // launcher and Just Type, not for the carrier; tablets never do
    // (StatusBarTitle::setTitleString).
    readonly property bool _border: !Theme.tablet && titleBorder
    readonly property font _titleFont: FontTools.withPercentageSpacing(Qt.font({
        family: Theme.fontFamily, pixelSize: Theme.statusBarFontSize, bold: true
    }), Theme.statusBarTitleSpacingPercent)

    // The title shown, and the one fading out (animateTitleTransition).
    property string _shownTitle: title
    property bool _shownBorder: _border
    property string _oldTitle: ""
    property bool _oldBorder: false
    function _changeTitle() {
        if (title === _shownTitle && _border === _shownBorder)
            return;
        _oldTitle = _shownTitle;
        _oldBorder = _shownBorder;
        _shownTitle = title;
        _shownBorder = _border;
        titleFade.restart();
    }
    onTitleChanged: _changeTitle()
    on_BorderChanged: _changeTitle()
    NumberAnimation {
        id: titleFade
        target: newTitle
        property: "opacity"
        from: 0
        to: 1
        duration: Theme.statusBarTitleChangeDuration
    }

    component Title: Item {
        id: t
        property string text
        property bool border
        height: bar.height
        width: border ? Theme.px(Theme.statusBarTitleCapLeft) + label.width + Theme.px(Theme.statusBarTitleCapRight)
                      : Theme.statusBarTitlePadding + label.width
        ArtBorderImage {
            visible: t.border
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width
            height: Theme.px(26)
            source: Theme.asset("statusBar/appname-background.png")
            border { left: Theme.artBorder(Theme.statusBarTitleCapLeft, source); right: Theme.artBorder(Theme.statusBarTitleCapRight, source); top: 0; bottom: 0 }
        }
        Text {
            id: label
            x: t.border ? Theme.statusBarTitleBorderPadding : Theme.statusBarTitlePadding
            anchors.verticalCenter: parent.verticalCenter
            anchors.verticalCenterOffset: Theme.statusBarTitleBaselineOffset
            // Elided to the 140 px title less its caps or padding
            // (setTitleString, :131-135).
            width: Math.min(implicitWidth, Theme.statusBarTitleMaxWidth
                - (t.border ? Theme.px(Theme.statusBarTitleCapLeft + Theme.statusBarTitleCapRight - 4)
                            : Theme.statusBarTitlePadding))
            elide: Text.ElideRight
            text: t.text
            color: Theme.text
            font: bar._titleFont
        }
    }

    Title {
        id: oldTitle
        x: bar.cornerInset
        text: bar._oldTitle
        border: bar._oldBorder
        opacity: 1 - newTitle.opacity
        visible: opacity > 0
    }
    Title {
        id: newTitle
        objectName: "statusBarTitle"
        x: bar.cornerInset
        text: bar._shownTitle
        border: bar._shownBorder
    }

    // Tablets: the arrow after the title while it opens a menu, and the
    // group's separator at its right end (StatusBarItemGroup paint and
    // layoutLeft). Phones need neither: appname-background.png has the
    // arrow in its right cap. (luna-sysmgr 3.0.5's phone path would draw
    // menu-arrow.png after the pill as well, a second arrow the shipped
    // phones never showed.)
    property real _arrowProgress: titleActionable && !lockScreen ? 1 : 0
    Behavior on _arrowProgress { NumberAnimation { duration: Theme.statusBarArrowFadeDuration; easing.type: Easing.InOutQuad } }
    Image {
        id: titleArrow
        objectName: "statusBarTitleArrow"
        visible: Theme.tablet && opacity > 0
        x: newTitle.x + newTitle.width + Theme.statusBarArrowSpacing
        anchors.verticalCenter: parent.verticalCenter
        width: Theme.artWidth(source)
        height: Theme.artHeight(source)
        source: Theme.asset("statusBar/menu-arrow.png")
        opacity: bar._arrowProgress
    }
    Image {
        objectName: "statusBarTitleSeparator"
        visible: Theme.tablet && opacity > 0
        x: titleArrow.x + titleArrow.width + Theme.px(7)             // ARROW_SPACING, StatusBar.h:33
        anchors.verticalCenter: parent.verticalCenter
        width: Theme.artWidth(source)
        height: Theme.artHeight(source)
        source: Theme.asset("statusBar/status-bar-separator.png")
        opacity: bar._arrowProgress
    }

    MouseArea {
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: parent.width / 3
        enabled: bar.titleActionable && !bar.lockScreen
        onClicked: bar.appMenuRequested()
    }

    // ---- Centre: clock -----------------------------------------------------------

    // Tablets put the time at the right end of the system group instead
    // (StatusBar.cpp:98-104); their lock screen keeps the date centred.
    // Where the clock goes: centred (anchors.centerIn's pixel,
    // Theme.centred), unless a cutout covers that; then beside it, on the
    // side where it covers less of the title or the indicators (the left
    // when both are clear, as get_clock_pos tries it first).
    readonly property real _clockGap: Theme.px(6)
    function _overlap(x, w) {
        var o = 0;
        for (var i = 0; i < cutouts.length; ++i)
            o = Math.max(o, Math.min(x + w, cutouts[i].x + cutouts[i].width) - Math.max(x, cutouts[i].x));
        return o;
    }
    function _clockX(w) {
        var centre = Theme.centred(bar.width, w);
        if (_overlap(centre, w) <= 0)
            return centre;
        var first = cutouts[0].x, last = cutouts[0].x + cutouts[0].width;
        for (var i = 1; i < cutouts.length; ++i) {
            first = Math.min(first, cutouts[i].x);
            last = Math.max(last, cutouts[i].x + cutouts[i].width);
        }
        var left = Math.round(first - _clockGap - w), right = Math.round(last + _clockGap);
        var leftOverlap = Math.max(0, newTitle.x + newTitle.width + _clockGap - left) + Math.max(0, bar.cornerInset - left);
        var rightOverlap = Math.max(0, right + w + _clockGap - indicators.x);
        return leftOverlap <= rightOverlap ? left : right;
    }
    Text {
        objectName: "centreClock"
        visible: !Theme.tablet || bar.lockScreen
        anchors.verticalCenter: parent.verticalCenter
        x: bar._clockX(width)
        text: bar.clockText
        color: Theme.text
        font.family: Theme.fontFamily
        font.pixelSize: Theme.statusBarClockFontSize
    }

    // ---- Right: indicators ----------------------------------------------------------

    // The tab behind the system group while its menu is open. Tablets:
    // status-bar-menu-dropdown-tab.png in three slices with 11 px caps,
    // fading in and out over 200 ms (StatusBarItemGroup::activate /
    // deactivate and paint, :282-330, 381-396; statusBarMenuFade*,
    // lunaAnimations.conf:124-125).
    // As the original's tabRect (StatusBarItemGroup.cpp:360-366) its right
    // cap lies past the screen's edge, so the solid part reaches it, and its
    // left cap and some padding go before the leftmost icon, so the tab
    // holds every icon (Theme.statusBarTabCap), the microphone's too. Phones
    // (which had no tab: the original drew one only with tabletUi, :117-132)
    // show the pressed art behind the group, in the same three slices: it
    // has the same transparent 10 px down each side, which stretched whole
    // left the microphone outside the tab and a gap after the battery.
    ArtBorderImage {
        id: menuTab
        objectName: "systemMenuTab"
        anchors.right: parent.right
        anchors.rightMargin: -Theme.statusBarTabCap
        anchors.top: parent.top
        height: parent.height
        width: indicators.width + indicators.anchors.rightMargin + 2 * Theme.statusBarTabCap + Theme.statusBarTabPadding
        source: Theme.tablet || !bar.systemMenuOpen ? Theme.asset("statusBar/status-bar-menu-dropdown-tab.png")
                                                    : Theme.asset("statusBar/status-bar-menu-dropdown-tab-pressed.png")
        border { left: Theme.artBorder(11, source); right: Theme.artBorder(11, source); top: 0; bottom: 0 }
        opacity: bar.systemMenuOpen ? 1 : 0
        Behavior on opacity {
            enabled: Theme.tablet
            NumberAnimation { duration: Theme.statusBarMenuFadeDuration }
        }
    }

    // Tablets: the system group has an arrow and a separator (StatusBar.cpp:93,
    // hasArrow and showSeparator for TypeNormal and TypeDockMode; the lock
    // screen's bar has neither). The group is actionable from the start
    // (:138), so the arrow fades in over 500 ms InOutQuad
    // (StatusBarItemGroup::setActionable, StatusBarItemGroup.cpp:136-158;
    // statusBarArrowSlide*, lunaAnimations.conf:120-121), the separator with
    // it. The room for the arrow is there as soon as it starts (layoutRight
    // when m_arrowAnimProg > 0, :467-487). The lock screen's bar is another
    // bar (LockWindow's), so locking takes the arrow away at once and
    // unlocking shows it as it was.
    readonly property bool _systemArrow: Theme.tablet && !lockScreen
    property real _systemArrowFade: 0
    Behavior on _systemArrowFade { NumberAnimation { duration: Theme.statusBarArrowFadeDuration; easing.type: Easing.InOutQuad } }
    Connections {
        target: Theme
        function onTabletChanged() { bar._systemArrowFade = Theme.tablet ? 1 : 0; }
    }
    Component.onCompleted: _systemArrowFade = Theme.tablet ? 1 : 0
    readonly property real _systemArrowProgress: _systemArrow ? _systemArrowFade : 0

    // The separator at the group's left edge, between it and the
    // notification icons; it fades out as the tab fades in (paint, :426-435:
    // opacity m_arrowAnimProg * (1 - the tab's)).
    Image {
        id: systemSeparator
        objectName: "systemGroupSeparator"
        visible: bar._systemArrow && opacity > 0
        x: bar.width - bar.systemGroupWidth
        anchors.verticalCenter: parent.verticalCenter
        width: Theme.artWidth(source)
        height: Theme.artHeight(source)
        source: Theme.asset("statusBar/status-bar-separator.png")
        opacity: bar._systemArrowProgress * (1 - menuTab.opacity)
    }
    // menu-arrow.png at the group's right end, ARROW_SPACING (7 px,
    // StatusBar.h:33) from the screen's edge, over the tab when its menu is
    // open (paint, :412-416: drawn at -width - ARROW_SPACING, opacity
    // m_arrowAnimProg only).
    Image {
        id: systemArrow
        objectName: "systemGroupArrow"
        visible: bar._systemArrow && opacity > 0
        x: bar.width - bar.cornerInset - width - Theme.px(7)
        anchors.verticalCenter: parent.verticalCenter
        width: Theme.artWidth(source)
        height: Theme.artHeight(source)
        source: Theme.asset("statusBar/menu-arrow.png")
        opacity: bar._systemArrowProgress
    }

    Row {
        id: indicators
        anchors.right: parent.right
        // Tablets: left of the arrow and ARROW_SPACING on both its sides
        // (layoutRight, :479-487); without one, a few pixels' padding.
        anchors.rightMargin: bar.cornerInset + (bar._systemArrow && bar._systemArrowProgress > 0
                             ? systemArrow.width + 2 * Theme.px(7) : Theme.px(6))
        anchors.verticalCenter: parent.verticalCenter
        spacing: Theme.statusBarIconSpacing

        // StatusBarInfo paints right to left from the battery: RSSI, WAN,
        // Bluetooth, Wi-Fi, TTY, HAC, call forward, roaming, VPN, rotation
        // lock, mute, airplane (StatusBarInfo.cpp:143-275). This Row runs
        // left to right, so the reverse. WAN, TTY, HAC and roaming come from
        // a modem's services (LsmSystemStatus on a device; the simulator has
        // no modem, so they stay off there unless set).
        // Leftmost, the microphone: orange while recording, a dim outline
        // of itself while it waits for the wake word.
        Item {
            id: micIndicator
            objectName: "microphoneIcon"
            readonly property bool shown: bar.microphone !== ""
            readonly property bool recording: bar.microphone === "on"
            property real progress: shown ? 1 : 0
            Behavior on progress { NumberAnimation { duration: Theme.statusBarItemSlideDuration / 2 } }
            visible: progress > 0
            anchors.verticalCenter: parent.verticalCenter
            width: Math.round(Theme.px(14) * progress)
            height: Theme.px(16)
            clip: true
            opacity: progress * (recording ? 1 : 0.55)
            MicGlyph {
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                width: Theme.px(14)
                height: Theme.px(16)
                color: micIndicator.recording ? "#FF9F0A" : Theme.text
                lineWidth: 2.2
            }
        }
        Indicator {
            objectName: "airplaneIcon"
            shown: bar.system !== null && bar.system !== undefined && bar.system.airplaneMode
            source: Theme.asset("statusBar/icon-airplane.png")
        }
        Indicator {
            objectName: "muteIcon"
            shown: bar.system !== null && bar.system !== undefined && bar.system.muted
            source: Theme.asset("statusBar/icon-mute.png")
        }
        Indicator {
            objectName: "rotationLockIcon"
            shown: bar.system !== null && bar.system !== undefined && bar.system.rotationLocked
            source: Theme.asset("statusBar/icon-rotation-lock.png")
        }
        // A VPN connected (StatusBarInfo::setVpn, from com.palm.vpn's
        // profile list; here the system menu's VPN profiles).
        Indicator {
            objectName: "vpnIcon"
            shown: !!bar.system && !!bar.system.vpnProfile
            source: Theme.asset("statusBar/vpn-status-icon.png")
        }
        // Roaming (StatusBarInfo::setRoaming, network-roaming.png, :258-262;
        // the modem's registration "roaming" or "roamblink",
        // StatusBarServicesConnector::handleNetworkStatus, :1079-1086).
        Indicator {
            objectName: "roamingIcon"
            shown: !!bar.system && !bar.system.airplaneMode && bar.system.roaming === true
            source: Theme.asset("statusBar/network-roaming.png")
        }
        // Unconditional call forwarding on (StatusBarInfo::setCallForward,
        // from com.palm.telephony forwardQuery; off with the radio).
        Indicator {
            objectName: "callForwardIcon"
            shown: !!bar.system && !bar.system.airplaneMode && !!bar.system.callForwarding
            source: Theme.asset("statusBar/call-forward.png")
        }
        // Hearing aid compatibility and TTY on (StatusBarInfo::setHAC /
        // setTTY, :236-246; telephony hacQuery / ttyQuery).
        Indicator {
            objectName: "hacIcon"
            shown: !!bar.system && bar.system.hac === true
            source: Theme.asset("statusBar/hac.png")
        }
        Indicator {
            objectName: "ttyIcon"
            shown: !!bar.system && bar.system.tty === true
            source: Theme.asset("statusBar/tty.png")
        }
        // Wi-Fi: the bars, or wifi-connecting.png while a network is being
        // joined (WIFI_CONNECTING, StatusBarInfo.cpp:220-228; the
        // connection manager's associating / associated,
        // StatusBarServicesConnector::wifiEventsCallback, :2921-2925).
        Indicator {
            objectName: "wifiIcon"
            readonly property bool connecting: !!bar.system && bar.system.wifiBars === 0 && !!bar.system.wifiNetworks
                                               && bar.system.wifiNetworks.some(function(n) { return n.state === "connecting"; })
            shown: !!bar.system && !bar.system.airplaneMode && bar.system.wifiBars >= 0
            source: !bar.system ? "" : connecting ? Theme.asset("statusBar/wifi-connecting.png")
                    : Theme.asset("statusBar/wifi-" + Math.max(0, bar.system.wifiBars) + ".png")
        }
        // Bluetooth: on, connecting, or a device connected
        // (StatusBarServicesConnector::updateBluetoothIcon, :2304-2321).
        Indicator {
            objectName: "bluetoothIcon"
            readonly property var devices: bar.system && bar.system.bluetoothDevices ? bar.system.bluetoothDevices : []
            readonly property string btState: devices.some(function(d) { return d.state === "connected"; }) ? "connected"
                                            : devices.some(function(d) { return d.state === "connecting"; }) ? "connecting" : "on"
            shown: !!bar.system && bar.system.bluetoothOn
            source: Theme.asset("statusBar/bluetooth-" + btState + ".png")
        }
        // Mobile data (StatusBarInfo.cpp:195-210, getWanIndex,
        // StatusBarServicesConnector.cpp:1702-1731): the network type's
        // icon, connected or dormant (1x and EV-DO only); EV-DO as 3G when
        // the show3GForEvdo preference says so (system.show3GForEvdo).
        Indicator {
            objectName: "wanIcon"
            readonly property string type: bar.system && typeof bar.system.wanType === "string" ? bar.system.wanType : ""
            readonly property bool dormant: !!bar.system && bar.system.wanDormant === true
            readonly property string art: {
                var evdo = bar.system && bar.system.show3GForEvdo ? "3g" : "evdo";
                var names = { "1x": "1x", "edge": "edge", "evdo": evdo, "gprs": "gprs", "umts": "3g", "hsdpa": "3g",
                              "hspa-4g": "hsdpa-plus" };
                if (!names[type] || (dormant && type !== "1x" && type !== "evdo"))
                    return "";
                return "statusBar/network-" + names[type] + (dormant ? "-dormant.png" : "-connected.png");
            }
            shown: !!bar.system && !bar.system.airplaneMode && art !== ""
            source: art !== "" ? Theme.asset(art) : ""
        }
        // RSSI. In airplane mode it goes: the airplane icon above says so
        // ("Airplane mode now has its own icon in the status bar, so hide
        // the rssi icon", StatusBarServicesConnector.cpp:947-952,
        // updateRSSIIcon(false, RSSI_FLIGHT_MODE)); it showed a second plane.
        Indicator {
            objectName: "rssiIcon"
            shown: !!bar.system && !bar.system.airplaneMode && bar.system.signalBars >= 0
            source: !bar.system ? "" : Theme.asset("statusBar/rssi-" + Math.max(0, bar.system.signalBars) + ".png")
        }
        // The charge, in the bar's 14 px bold beside the icon, coloured as
        // the patches did: red when low (the battery's own red states, at
        // 12% and under), amber to 20%, else white; green while charging.
        Text {
            objectName: "batteryPercent"
            readonly property int pct: bar.system ? bar.system.batteryPercent : -1
            visible: bar.batteryPercent && pct >= 0
            anchors.verticalCenter: parent.verticalCenter
            text: pct + "%"
            color: bar.system && bar.system.charging ? "#8CE05A" : pct <= Theme.batteryChargeLevels[0] ? "#FF4D40"
                 : pct <= Theme.batteryChargeLevels[1] ? "#FFC21A" : Theme.text
            font.family: Theme.fontFamily
            font.pixelSize: Theme.statusBarFontSize
            font.bold: true
        }
        Image {
            objectName: "battery"
            readonly property int step: bar.system ? Theme.batteryState(bar.system.batteryPercent) : 0
            // States 0-11 are battery-N; the full one reuses battery-11, or
            // battery-charged while charging (StatusBarBattery.cpp:150-172).
            // No level (powerd not reporting: batteryPercent < 0) is
            // battery-error.png (StatusBarBattery.cpp:106-110).
            source: !bar.system ? ""
                    : bar.system.batteryPercent < 0 ? Theme.asset("statusBar/battery-error.png")
                    : bar.system.charging && step === 12 ? Theme.asset("statusBar/battery-charged.png")
                    : bar.system.charging ? Theme.asset("statusBar/battery-charging-" + step + ".png")
                    : Theme.asset("statusBar/battery-" + Math.min(step, 11) + ".png")
            width: Theme.artWidth(source); height: Theme.artHeight(source)
        }
        // Tablet: the clock, rightmost (the system group's first item).
        Text {
            objectName: "tabletClock"
            visible: Theme.tablet && !bar.lockScreen
            anchors.verticalCenter: parent.verticalCenter
            text: bar.clockText
            color: Theme.text
            font.family: Theme.fontFamily
            font.pixelSize: Theme.statusBarClockFontSize
        }
    }

    MouseArea {
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: Math.max(indicators.width + indicators.anchors.rightMargin + Theme.px(6), parent.width / 3)
        enabled: !bar.lockScreen
        onClicked: bar.systemMenuRequested()
    }

    // A status icon that slides in and out: over 1000 ms its width opens
    // InOutQuad in the first half while it fades in linearly, the right
    // part of the image revealed last; hiding runs it backwards
    // (StatusBarIcon::show / hide / animValueChanged / paint,
    // StatusBarIcon.cpp:84-205; statusBarItemSlide*,
    // lunaAnimations.conf:122-123).
    component Indicator: Item {
        id: ind
        property bool shown: false
        property alias source: img.source
        property real progress: shown ? 1 : 0
        Behavior on progress { NumberAnimation { duration: Theme.statusBarItemSlideDuration } }
        readonly property real widthFactor: {
            var t = Math.min(1, progress * 2);
            return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        }
        visible: shown || progress > 0
        anchors.verticalCenter: parent ? parent.verticalCenter : undefined
        width: img.width * widthFactor
        height: img.height
        clip: true
        opacity: progress
        Image {
            id: img
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
        }
    }
}
