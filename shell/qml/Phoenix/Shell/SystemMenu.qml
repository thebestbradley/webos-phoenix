// Copyright (c) 2026 webOS Phoenix contributors
// Copyright (c) 2010-2013 Hewlett-Packard Development Company, L.P. (the original)
// SPDX-License-Identifier: Apache-2.0
//
// The status bar's system menu: a port of luna-sysmgr's
// uiComponents/SystemMenu (SystemMenu.qml, Drawer.qml, MenuListEntry.qml,
// MenuDivider.qml, Spinner.qml, DateElement.qml, BatteryElement.qml,
// BrightnessElement.qml, Slider.qml, WiFiElement.qml, WifiEntry.qml,
// VpnElement.qml, VpnEntry.qml, BluetoothElement.qml, BluetoothEntry.qml,
// AirplaneModeElement.qml, RotationLockElement.qml, MuteElement.qml) from
// QtQuick 1 to Qt 6, with the same art (menu-dropdown-bg.png,
// menu-selection-gradient-*.png, statusBar/*) and metrics in legacy pixels
// (Theme.systemMenu*). What Src/lunaui/status-bar/SystemMenu.cpp did in C++
// (labels for each state, the brightness floor, launching the preferences
// apps, the date timer) is done here from `system` (SimSystemStatus /
// LsmSystemStatus): its lists and functions stand in for the services
// StatusBarServicesConnector asked.
//
// Not reproduced: the restricted (dock mode) menu, and the drawers asking
// the view to scroll to show an opened list (commented out in the
// original too, SystemMenu.qml:182-186).

import QtQuick

Item {
    id: menu

    property var system
    // The window source, for the services the menu asks (lunaCall): the
    // torch (the Flashlight row).
    property var source: null
    property bool open: false
    signal closeRequested
    // Open an app (the preferences rows): Shell.launch.
    signal launchRequested(string appId, var params)

    // The scene behind, for the blur under the menu.
    property Item backdrop: null
    // Room below the status bar: the positive space's height plus 10, as
    // SystemMenu::slotPositiveSpaceChangeFinished gave setHeight
    // (SystemMenu.cpp:945-953); the menu is at most 410 tall.
    property real availableHeight: height - Theme.statusBarHeight

    // The preferences each drawer's last row opens. Palm had an app for
    // each (com.palm.app.wifi, .bluetooth, .vpn: SystemMenu.cpp:56-59);
    // Phoenix's Settings takes the page as a launch param, and the window
    // source opens its launch point for it (Wi-Fi, Bluetooth cards).
    readonly property string settingsAppId: "org.webosphoenix.settings"
    function openPreferences(page) { launchRequested(settingsAppId, { page: page }); }

    // SystemMenu.qml:336-342: the menu closes itself a moment after a row
    // is used, so the tap shows.
    function closeAfter(ms) {
        closeTimer.interval = ms;
        closeTimer.restart();
    }
    Timer {
        id: closeTimer
        onTriggered: menu.closeRequested()
    }

    readonly property var sys: system
    readonly property bool wifiOn: !!sys && sys.wifiBars >= 0
    readonly property bool bluetoothOn: !!sys && sys.bluetoothOn
    readonly property bool bluetoothTurningOn: !!sys && !!sys.bluetoothTurningOn
    // Airplane mode switching: the label says so, the toggle and the radio
    // drawers wait (SystemMenu.qml:68-78, 174,197,220,242).
    readonly property bool airplaneModeInProgress: !!sys && !!sys.airplaneModeInProgress
    // The connected network first (WiFiElement.qml:87-90).
    readonly property var wifiList: {
        var l = sys && sys.wifiNetworks ? sys.wifiNetworks.slice() : [];
        return l.filter(function(n) { return n.state === "ipConfigured"; })
                .concat(l.filter(function(n) { return n.state !== "ipConfigured"; }));
    }
    readonly property string vpnInUse: {
        var l = sys && sys.vpnProfiles ? sys.vpnProfiles : [];
        for (var i = 0; i < l.length; ++i)
            if (l[i].state === "connected" || l[i].state === "connecting")
                return l[i].name;
        return "";
    }

    // Opening and closing fade (StatusBarItemGroup.cpp:243-306).
    visible: opacity > 0
    opacity: open ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: Theme.systemMenuFadeDuration } }

    onOpenChanged: {
        if (open) { closeTimer.stop(); date.refresh(); refreshTorch(); }
        _setKeyItem(null);
    }

    // ---- The torch (Phoenix; the community's Device Menu Megamix) ----------------------
    // LuneOS's torchd (org.webosports.service.torch, as the Flashlight app
    // uses it): the row shows on a device that has one.
    property bool torchAvailable: false
    property bool torchOn: false
    function _torchCall(method, params) {
        if (!source || typeof source.lunaCall !== "function")
            return;
        source.lunaCall("luna://org.webosports.service.torch/" + method, params || {}, function (r) {
            if (!r || r.returnValue === false) {
                if (method === "getStatus")
                    menu.torchAvailable = false;
                return;
            }
            menu.torchAvailable = r.available !== false;
            menu.torchOn = !!r.on;
        });
    }
    function refreshTorch() { _torchCall("getStatus"); }
    function toggleTorch() { _torchCall("set", { on: !torchOn }); }

    // ---- Keyboard navigation (GAPS V8 (3)) -----------------------------------------
    // Up / Down (and Tab / Shift+Tab) move through the rows on show, top
    // to bottom, including an open drawer's; Enter or Space acts on the
    // row, Left / Right move a slider, Esc closes the menu.
    property Item keyItem: null
    function _setKeyItem(item) {
        if (keyItem)
            keyItem.keyFocused = false;
        keyItem = item;
        if (item) {
            item.keyFocused = true;
            // Scrolled into view.
            var y = item.mapToItem(flick.contentItem, 0, 0).y;
            if (y < flick.contentY)
                flick.contentY = y;
            else if (y + item.height > flick.contentY + flick.height)
                flick.contentY = y + item.height - flick.height;
        }
    }
    function _shown(item) {
        for (var p = item; p && p !== menu; p = p.parent)
            if (!p.visible || p.height <= 0 || p.opacity <= 0)
                return false;
        return true;
    }
    function keyItems() {
        var out = [];
        (function walk(o) {
            for (var i = 0; i < o.children.length; ++i) {
                var c = o.children[i];
                if (c.keyNavigable === true && _shown(c))
                    out.push(c);
                walk(c);
            }
        })(flick.contentItem);
        out.sort(function (a, b) {
            return a.mapToItem(menu, 0, 0).y - b.mapToItem(menu, 0, 0).y;
        });
        return out;
    }
    function handleKey(event) {
        if (!open)
            return false;
        var k = event.key, back = event.key === Qt.Key_Backtab || (k === Qt.Key_Tab && (event.modifiers & Qt.ShiftModifier));
        if (k === Qt.Key_Escape) {
            closeRequested();
            return true;
        }
        if (k === Qt.Key_Down || k === Qt.Key_Up || k === Qt.Key_Tab || k === Qt.Key_Backtab) {
            var items = keyItems();
            if (!items.length)
                return true;
            var i = items.indexOf(keyItem);
            var up = k === Qt.Key_Up || back;
            i = i < 0 ? (up ? items.length - 1 : 0) : (i + (up ? -1 : 1) + items.length) % items.length;
            _setKeyItem(items[i]);
            return true;
        }
        if ((k === Qt.Key_Return || k === Qt.Key_Enter || k === Qt.Key_Space) && keyItem) {
            if (keyItem.selectable)
                keyItem.action();
            return true;
        }
        if ((k === Qt.Key_Left || k === Qt.Key_Right) && keyItem && keyItem.adjustable) {
            keyItem.adjust(k === Qt.Key_Left ? -0.1 : 0.1);
            return true;
        }
        return false;
    }
    // Put back on close, once faded out (SystemMenu.qml:345-366): drawers
    // shut, and the rotation lock and mute rows show the state they set.
    onVisibleChanged: {
        if (visible)
            return;
        wifi.close(true);
        bluetooth.close(true);
        vpn.close(true);
        rotation.delayUpdate = false;
        mute.delayUpdate = false;
        torch.delayUpdate = false;
        flick.contentY = 0;
    }
    onAirplaneModeInProgressChanged: {
        if (airplaneModeInProgress) {
            wifi.close();
            vpn.close();
            bluetooth.close();
        }
    }

    // Tap outside to close.
    MouseArea {
        anchors.fill: parent
        onClicked: menu.closeRequested()
    }

    // ---- MenuDivider.qml ---------------------------------------------------------
    component Divider: Image {
        property int inset: Theme.systemMenuDividerInset
        width: parent ? parent.width - inset : 0
        x: inset / 2
        height: Theme.px(2)
        source: Theme.asset("menu-divider.png")
    }

    // ---- MenuListEntry.qml: a 42 px row, highlighted while pressed ----------------
    component Entry: Item {
        id: entry
        property bool selectable: true
        property bool forceSelected: false
        // Keyboard navigation (GAPS V8 (3)): reached with the arrows and
        // Tab, highlighted as when pressed; Enter acts.
        readonly property bool keyNavigable: selectable || adjustable
        property bool adjustable: false
        property bool keyFocused: false
        function adjust(step) {}
        // The bottom row's highlight follows the art's rounded foot
        // (menuPosition 2, MenuListEntry.qml:19-20).
        property bool last: false
        readonly property bool pressed: area.pressed && area.containsMouse
        signal action
        width: parent ? parent.width : 0
        height: Theme.systemMenuRowHeight

        ArtBorderImage {
            visible: (entry.selectable && entry.pressed) || entry.forceSelected || entry.keyFocused
            source: Theme.asset(entry.last ? "menu-selection-gradient-last.png" : "menu-selection-gradient-default.png")
            x: Theme.px(4)
            width: parent.width - Theme.px(8)
            height: parent.height
            border { left: Theme.artBorder(19, source); right: Theme.artBorder(19, source) }
        }
        MouseArea {
            id: area
            anchors.fill: parent
            enabled: entry.selectable
            onClicked: entry.action()
        }
    }

    // Prelude 18, 14 px in (AirplaneModeElement.qml:13-22).
    component Label: Text {
        x: Theme.systemMenuIndent
        anchors.verticalCenter: parent.verticalCenter
        color: Theme.systemMenuText
        font.family: Theme.fontFamily
        font.pixelSize: Theme.systemMenuFontSize
    }

    // A row's icon, 12 px from its right edge (AirplaneModeElement.qml:24-25,32).
    component Icon: Image {
        x: parent.width - width - Theme.px(4 + 8)
        anchors.verticalCenter: parent.verticalCenter
        width: Theme.artWidth(source)
        height: Theme.artHeight(source)
    }

    // ---- Spinner: SystemMenu.cpp's AnimatedSpinner (:991-1073) ---------------------
    component Spinner: Image {
        id: spinner
        property bool on: false
        property int frame: 0
        visible: on
        source: Theme.asset("spinner.png")
        width: Theme.px(32)
        height: Theme.px(32)
        smooth: true
        rotation: frame * 360 / Theme.spinnerFrames
        NumberAnimation on frame {
            running: spinner.on
            from: 0
            to: Theme.spinnerFrames
            duration: Theme.spinnerDuration
            loops: Animation.Infinite
        }
    }

    // ---- WifiEntry.qml / BluetoothEntry.qml / VpnEntry.qml: a list entry ----------
    component ListEntry: Item {
        id: le
        property string name
        property string status
        property bool statusBold: false
        property bool connected: false
        property int bars: -1           // Wi-Fi: 0-3; -1 none
        property bool secured: false
        // Wi-Fi's icons sit 3 px from the edge, the others' 8 (WifiEntry.qml:12, BluetoothEntry.qml:10).
        readonly property int rightMargin: Theme.px(bars >= 0 ? 3 : 8)
        readonly property int iconSpacing: Theme.px(4)
        x: Theme.systemMenuIndent + Theme.systemMenuSubIndent
        width: parent ? parent.width - x : 0
        height: parent ? parent.height : 0

        Text {
            id: nameText
            anchors.verticalCenter: parent.verticalCenter
            width: le.bars >= 0
                   ? parent.width - sig.width - check.width - lock.width - le.rightMargin - 3 * le.iconSpacing - Theme.px(5)
                   : parent.width - check.width - le.rightMargin - le.iconSpacing - Theme.px(5)
            elide: Text.ElideRight
            text: le.name
            color: Theme.systemMenuText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.systemMenuEntryFontSize
        }
        Text {
            visible: le.status !== ""
            y: nameText.y + nameText.baselineOffset + Theme.px(1)
            text: le.status
            color: Theme.systemMenuTextDim
            font.bold: le.statusBold
            font.family: Theme.fontFamily
            font.pixelSize: Theme.systemMenuStatusFontSize
            font.capitalization: Font.AllUppercase
        }
        Image {
            id: sig
            visible: le.bars >= 0
            x: parent.width - width - le.iconSpacing - le.rightMargin
            anchors.verticalCenter: parent.verticalCenter
            width: le.bars >= 0 ? Theme.artWidth(source) : 0
            height: Theme.artHeight(source)
            source: le.bars >= 0 ? Theme.asset("statusBar/wifi-" + le.bars + ".png") : ""
        }
        Image {
            id: lock
            visible: le.secured
            x: sig.x - width - le.iconSpacing
            anchors.verticalCenter: parent.verticalCenter
            width: le.bars >= 0 ? Theme.artWidth(source) : 0
            height: Theme.artHeight(source)
            source: Theme.asset("statusBar/system-menu-lock.png")
        }
        Image {
            id: check
            visible: le.connected
            x: le.bars >= 0 ? lock.x - width - le.iconSpacing : parent.width - width - le.iconSpacing - le.rightMargin
            anchors.verticalCenter: parent.verticalCenter
            width: Theme.artWidth(source)
            height: Theme.artHeight(source)
            source: Theme.asset("statusBar/system-menu-popup-item-checkmark.png")
        }
    }

    // ---- Drawer.qml: a header row that opens a list below it -----------------------
    component Drawer: Column {
        id: drawer
        property string title
        property string stateText
        property bool spinning: false
        // The spinner sits this far from the title's start, the state text
        // leaves this much for the title (WiFiElement.qml:158,168;
        // BluetoothElement.qml:160,168).
        property int spinnerOffset: 20
        property int stateGap: 35
        property bool active: true
        property bool isOpen: false
        readonly property bool closedFully: body.height === 0
        default property alias content: bodyColumn.data
        signal opened
        signal closed

        property bool _toggling: false
        property bool _instant: false
        function open() {
            if (isOpen)
                return;
            _toggling = true;
            isOpen = true;
            opened();
        }
        function close(instant) {
            if (!isOpen)
                return;
            _toggling = true;
            _instant = !!instant;
            // An opening still under way would carry on to the open height:
            // disabling the Behavior only affects changes from now on.
            if (_instant)
                bodyAnim.stop();
            isOpen = false;
            _instant = false;
            closed();
        }

        width: parent ? parent.width : 0

        Entry {
            selectable: drawer.active
            onAction: drawer.isOpen ? drawer.close() : drawer.open()

            Label {
                id: titleText
                text: drawer.title
                color: drawer.active ? Theme.systemMenuText : Theme.systemMenuTextDim
            }
            Spinner {
                x: titleText.width + Theme.px(drawer.spinnerOffset)
                y: (parent.height - height) / 2 - Theme.px(1)
                on: drawer.spinning
            }
            Text {
                x: parent.width - width - Theme.systemMenuIndent
                width: parent.width - titleText.width - Theme.px(drawer.stateGap)
                anchors.verticalCenter: parent.verticalCenter
                horizontalAlignment: Text.AlignRight
                elide: Text.ElideRight
                text: drawer.stateText
                color: Theme.systemMenuTextDim
                font.family: Theme.fontFamily
                font.pixelSize: Theme.systemMenuStateFontSize
                font.capitalization: Font.AllUppercase
            }
        }
        Item {
            id: body
            width: parent.width
            height: drawer.isOpen ? bodyColumn.height : 0
            clip: true
            Behavior on height {
                enabled: !drawer._instant
                NumberAnimation {
                    id: bodyAnim
                    duration: drawer._toggling ? Theme.systemMenuDrawerDuration : Theme.systemMenuDrawerResizeDuration
                    easing.type: drawer._toggling ? Easing.OutCubic : Easing.Linear
                    onRunningChanged: if (!running) drawer._toggling = false
                }
            }
            Column {
                id: bodyColumn
                width: parent.width
            }
        }
    }

    // ---- BrightnessElement.qml / Slider.qml: a slider between two icons ---------------
    // value 0..1; moved(v) as the user drags or taps the rail. Phoenix uses
    // it for the volume too (SystemMenu.qml had brightness alone).
    component SliderRow: Entry {
        id: sliderRow
        property real value: 0
        property string sliderName: ""
        property url lessSource: ""
        property url moreSource: ""
        // Icons drawn in place of art (the volume's speakers).
        property Component lessIcon: null
        property Component moreIcon: null
        signal moved(real v)
        selectable: false
        // Left and Right move it a tenth.
        adjustable: true
        function adjust(step) { moved(Math.max(0, Math.min(1, value + step))); }
        Item {
            id: brightnessContent
            x: Theme.px(4)
            width: parent.width - Theme.px(8)
            height: parent.height
            readonly property int margin: Theme.px(5)
            readonly property int spacing: Theme.px(5)

            Loader {
                id: less
                x: brightnessContent.margin
                anchors.verticalCenter: parent.verticalCenter
                sourceComponent: sliderRow.lessIcon ? sliderRow.lessIcon : artIcon
                property url art: sliderRow.lessSource
            }
            Loader {
                id: more
                x: parent.width - width - brightnessContent.margin
                anchors.verticalCenter: parent.verticalCenter
                sourceComponent: sliderRow.moreIcon ? sliderRow.moreIcon : artIcon
                property url art: sliderRow.moreSource
            }
            Component {
                id: artIcon
                Image {
                    width: Theme.artWidth(source); height: Theme.artHeight(source)
                    source: parent ? parent.art : ""
                }
            }

            Item {
                id: slider
                objectName: sliderRow.sliderName
                readonly property real value: Math.max(0, Math.min(1, sliderRow.value))
                readonly property int railEdgeOffset: Theme.px(8)
                readonly property int railBorderWidth: Theme.px(11)
                readonly property int handleGrabTolerance: Theme.px(12)
                readonly property int railTapTolerance: Theme.px(20)
                readonly property real railChangeStep: 0.20
                function setValue(v) { sliderRow.moved(Math.max(0, Math.min(1, v))); }
                function valueForX(px) {
                    return (px - railEdgeOffset) / (width - 2 * railEdgeOffset);
                }

                width: parent.width - (less.width + more.width + 2 * brightnessContent.margin + 2 * brightnessContent.spacing)
                height: handle.height + handleGrabTolerance
                x: (parent.width - width) / 2
                y: (parent.height - height) / 2

                ArtBorderImage {
                    width: parent.width
                    height: Theme.artHeight(source)
                    anchors.verticalCenter: parent.verticalCenter
                    source: Theme.asset("statusBar/slider-track.png")
                    border { left: Theme.artBorder(11, source); right: Theme.artBorder(11, source) }
                }
                ArtBorderImage {
                    width: Math.max((parent.width - handle.width / 2) * slider.value + handle.width / 2,
                                    2 * slider.railBorderWidth)
                    height: Theme.artHeight(source)
                    anchors.verticalCenter: parent.verticalCenter
                    source: Theme.asset("statusBar/slider-track-progress.png")
                    border { left: Theme.artBorder(11, source); right: Theme.artBorder(11, source) }
                }
                Image {
                    id: handle
                    x: slider.railEdgeOffset + (slider.width - 2 * slider.railEdgeOffset) * slider.value - width / 2
                    y: (slider.height - height) / 2
                    width: Theme.artWidth(source); height: Theme.artHeight(source)
                    source: Theme.asset("statusBar/slider-handle.png")
                }

                // Drag the handle, or tap the rail to step 20% towards
                // the tap (Slider.qml:35-120). The menu does not
                // scroll meanwhile (setFlickOverride).
                MouseArea {
                    id: sliderArea
                    readonly property int xOffset: 2 * slider.handleGrabTolerance
                    property bool onHandle: false
                    property bool onBar: false
                    property real downX: 0
                    x: -xOffset
                    width: parent.width + 2 * xOffset
                    height: parent.height
                    preventStealing: true
                    onPressed: (mouse) => {
                        var mx = mouse.x - xOffset;
                        downX = mx;
                        onHandle = mx > handle.x - slider.handleGrabTolerance
                                   && mx < handle.x + handle.width + slider.handleGrabTolerance;
                        onBar = !onHandle && mouse.y > handle.y && mouse.y < handle.y + handle.height;
                    }
                    onPositionChanged: (mouse) => {
                        var mx = mouse.x - xOffset;
                        if (onHandle)
                            slider.setValue(slider.valueForX(mx));
                        else if (onBar && Math.abs(mx - downX) > slider.railTapTolerance)
                            onBar = false;
                    }
                    onReleased: (mouse) => {
                        var mx = mouse.x - xOffset;
                        if (onHandle && mx !== downX)
                            slider.setValue(slider.valueForX(mx));
                        else if (onBar)
                            slider.setValue(slider.value + (mx < handle.x ? -1 : 1) * slider.railChangeStep);
                        onHandle = onBar = false;
                    }
                    onCanceled: onHandle = onBar = false
                }
            }
        }
    }

    // A speaker in the brightness icons' grey, drawn (the original art has no
    // volume icons): waves 0 for quiet, 2 for loud.
    component SpeakerIcon: Canvas {
        property int waves: 0
        width: Theme.px(24)
        height: Theme.px(24)
        onPaint: {
            var c = getContext("2d"), u = width / 24;
            c.reset();
            c.fillStyle = "#d2d2d2";
            c.strokeStyle = "#d2d2d2";
            c.beginPath();
            c.moveTo(4 * u, 9 * u); c.lineTo(8 * u, 9 * u); c.lineTo(13 * u, 4.5 * u);
            c.lineTo(13 * u, 19.5 * u); c.lineTo(8 * u, 15 * u); c.lineTo(4 * u, 15 * u);
            c.closePath();
            c.fill();
            c.lineWidth = 1.8 * u;
            c.lineCap = "round";
            for (var i = 1; i <= waves; ++i) {
                c.beginPath();
                c.arc(13 * u, 12 * u, (2.5 + 3.2 * i) * u, -Math.PI / 4, Math.PI / 4);
                c.stroke();
            }
        }
    }

    // ---- SystemMenu.qml ------------------------------------------------------------

    Item {
        id: panel
        width: Theme.systemMenuWidth
        height: Math.min(Theme.systemMenuMaxHeight, menu.availableHeight)
        x: menu.width - width + Theme.systemMenuEdgeOffset
        y: Theme.statusBarHeight

        ArtBorderImage {
            id: background
            width: parent.width
            height: Math.min(panel.height, mainMenu.height + Theme.systemMenuBottomMargin)
            source: Theme.asset("menu-dropdown-bg.png")
            border { left: Theme.artBorder(30, source); top: Theme.artBorder(10, source); right: Theme.artBorder(30, source); bottom: Theme.artBorder(30, source) }

            MouseArea { anchors.fill: parent }  // swallow taps

            // The scene behind the menu, blurred faintly within its shape.
            BackdropBlur {
                anchors.fill: parent
                z: -1
                source: menu.backdrop
                mask: panelShape
            }
            ArtBorderImage {
                id: panelShape
                visible: false
                anchors.fill: parent
                source: Theme.asset("menu-dropdown-bg.png")
                border { left: Theme.artBorder(30, source); top: Theme.artBorder(10, source); right: Theme.artBorder(30, source); bottom: Theme.artBorder(30, source) }
            }
        }

        Item {
            id: clipRect
            x: Theme.systemMenuSideMargin
            width: parent.width - 2 * Theme.systemMenuSideMargin
            height: parent.height - Theme.systemMenuBottomMargin
            clip: true

            Flickable {
                id: flick
                objectName: "systemMenuFlickable"
                width: parent.width
                height: Math.min(clipRect.height, mainMenu.height)
                contentWidth: width
                contentHeight: mainMenu.height

                Column {
                    id: mainMenu
                    width: clipRect.width

                    // ---- DateElement.qml ----
                    Entry {
                        id: date
                        objectName: "systemMenuDate"
                        selectable: false
                        property date now: new Date()
                        readonly property string label: now.toLocaleDateString(Qt.locale(), Locale.LongFormat)
                        function refresh() {
                            now = menu.sys && menu.sys.fixedTime ? menu.sys.fixedTime : new Date();
                        }
                        // SystemMenu.cpp:63,126-133: every 30 s while open.
                        Timer {
                            interval: Theme.systemMenuDateInterval
                            running: menu.open
                            repeat: true
                            onTriggered: date.refresh()
                        }
                        Label { text: date.label; color: Theme.systemMenuTextDim }
                    }
                    Divider {}

                    // ---- BatteryElement.qml; the text from SystemMenu.cpp:925-937 ----
                    Entry {
                        id: battery
                        objectName: "systemMenuBattery"
                        selectable: false
                        readonly property int percent: menu.sys ? menu.sys.batteryPercent : -1
                        readonly property string label: qsTr("Battery: ")
                            + (percent >= 0 && percent <= 100 ? percent + "%" : qsTr("Not Available"))
                        Label { text: battery.label; color: Theme.systemMenuTextDim }
                    }
                    Divider {}

                    // ---- BrightnessElement.qml ----
                    // 0..1 on the slider is the 10..100% the display allows.
                    SliderRow {
                        readonly property real floor: Theme.minimumBrightness
                        sliderName: "systemMenuBrightness"
                        lessSource: Theme.asset("statusBar/brightness-less.png")
                        moreSource: Theme.asset("statusBar/brightness-more.png")
                        value: menu.sys ? (menu.sys.brightness - floor) / (1 - floor) : 0
                        onMoved: (v) => { if (menu.sys) menu.sys.brightness = floor + v * (1 - floor); }
                    }
                    Divider {}

                    // ---- Volume (Phoenix): the master volume, below brightness ----
                    SliderRow {
                        sliderName: "systemMenuVolume"
                        lessIcon: Component { SpeakerIcon { waves: 0 } }
                        moreIcon: Component { SpeakerIcon { waves: 2 } }
                        value: menu.sys && menu.sys.volume !== undefined ? menu.sys.volume / 100 : 0
                        onMoved: (v) => { if (menu.sys) menu.sys.volume = Math.round(v * 100); }
                    }
                    Divider {}

                    // ---- WiFiElement.qml ----
                    Drawer {
                        id: wifi
                        objectName: "systemMenuWifi"
                        title: qsTr("Wi-Fi")
                        stateText: !menu.wifiOn ? qsTr("OFF") : menu.sys.wifiSsid ? menu.sys.wifiSsid : qsTr("ON")
                        spinnerOffset: 18
                        stateGap: 60
                        active: !menu.airplaneModeInProgress
                        // Scanning when opened, or turning on (WiFiElement.qml:22-36, 286-296).
                        spinning: isOpen && menu.wifiOn && !!menu.sys.wifiScanning
                        // The list shows once a scan has answered, and goes when
                        // the drawer has shut (WiFiElement.qml:118-136).
                        property bool listed: false
                        // Close the menu when this network ("*": any) connects
                        // (coloseOnConnect).
                        property string joining: ""

                        onOpened: {
                            joining = "";
                            listed = false;
                            if (menu.wifiOn) {
                                menu.sys.scanWifi();
                                listed = !menu.sys.wifiScanning;
                            }
                        }
                        onClosed: joining = ""
                        onClosedFullyChanged: if (closedFully) listed = false

                        function pick(n) {
                            if (["ipConfigured", "associated", "ipFailed", "associationFailed"].indexOf(n.state) >= 0) {
                                // Connected, or failed: the preferences show it (SystemMenu.cpp:356-362).
                                menu.openPreferences("wifi");
                                menu.closeAfter(Theme.systemMenuRowCloseDelay);
                            } else if (n.state === "connecting") {
                                return;
                            } else if (!n.known && n.security !== "") {
                                // A secured network asks for its password there (:369-374).
                                menu.openPreferences("wifi");
                                menu.closeAfter(Theme.systemMenuRowCloseDelay);
                            } else {
                                menu.sys.connectWifi(n.ssid);
                            }
                            joining = n.ssid;
                        }

                        Connections {
                            target: menu.sys
                            ignoreUnknownSignals: true
                            function onWifiScanningChanged() {
                                if (!menu.sys.wifiScanning && wifi.isOpen && menu.wifiOn)
                                    wifi.listed = true;
                            }
                            function onWifiNetworksChanged() {
                                if (wifi.joining === "" || !wifi.isOpen)
                                    return;
                                var l = menu.sys.wifiNetworks;
                                for (var i = 0; i < l.length; ++i) {
                                    if (l[i].state === "ipConfigured" && (wifi.joining === "*" || l[i].ssid === wifi.joining)) {
                                        wifi.joining = "";
                                        menu.closeAfter(Theme.systemMenuWifiConnectCloseDelay);
                                    }
                                }
                            }
                        }

                        Divider {}
                        Entry {
                            id: wifiToggle
                            objectName: "systemMenuWifiToggle"
                            readonly property string label: menu.wifiOn ? qsTr("Turn off WiFi") : qsTr("Turn on WiFi")
                            onAction: {
                                if (menu.wifiOn) {
                                    menu.sys.setWifiOn(false);
                                    menu.closeAfter(Theme.systemMenuRowCloseDelay);
                                } else {
                                    wifi.joining = "*";
                                    wifi.listed = false;
                                    menu.sys.setWifiOn(true);
                                }
                            }
                            Label { x: Theme.systemMenuIndent + Theme.systemMenuSubIndent; text: wifiToggle.label }
                        }
                        Divider {}
                        Repeater {
                            model: wifi.listed && menu.wifiOn ? menu.wifiList : []
                            delegate: Column {
                                id: netRow
                                required property var modelData
                                width: parent ? parent.width : 0
                                Entry {
                                    objectName: "systemMenuWifiNetwork"
                                    forceSelected: netRow.modelData.state === "connecting"
                                    onAction: wifi.pick(netRow.modelData)
                                    ListEntry {
                                        readonly property string st: netRow.modelData.state
                                        name: netRow.modelData.ssid
                                        bars: Math.max(0, Math.min(3, netRow.modelData.bars))
                                        secured: netRow.modelData.security !== ""
                                        connected: st === "ipConfigured"
                                        status: st === "connecting" || st === "associating" || st === "associated" ? qsTr("Connecting...")
                                              : st === "ipFailed" ? qsTr("IP configuration failed")
                                              : st === "associationFailed" ? qsTr("Association failed") : ""
                                        statusBold: st === "ipFailed"
                                    }
                                }
                                Divider {}
                            }
                        }
                        Entry {
                            objectName: "systemMenuWifiPreferences"
                            onAction: {
                                menu.openPreferences("wifi");
                                menu.closeAfter(Theme.systemMenuRowCloseDelay);
                            }
                            Label { x: Theme.systemMenuIndent + Theme.systemMenuSubIndent; text: qsTr("Wi-Fi Preferences") }
                        }
                    }
                    Divider {}

                    // ---- VpnElement.qml ----
                    Drawer {
                        id: vpn
                        objectName: "systemMenuVpn"
                        title: qsTr("VPN")
                        stateText: menu.vpnInUse !== "" ? menu.vpnInUse : qsTr("Off")
                        active: !menu.airplaneModeInProgress
                        property string joining: ""
                        onOpened: joining = ""

                        // VpnElement.qml:504-513; SystemMenu.cpp:765-774. The
                        // list is rebuilt by the change, so the drawer does it.
                        function pick(p) {
                            // A VPN that asks for a user name and password
                            // signs in in Settings > VPN, which connects it
                            // (the legacy drawer opened the VPN app for it).
                            if (p.needsCredentials && p.state === "disconnected") {
                                menu.launchRequested(menu.settingsAppId, { page: "vpn", connect: p.name });
                                menu.closeAfter(Theme.systemMenuEntryCloseDelay);
                                return;
                            }
                            joining = p.state === "connected" ? "" : p.name;
                            if (p.state === "connected")
                                menu.closeAfter(Theme.systemMenuEntryCloseDelay);
                            if (p.state !== "connecting")
                                menu.sys.connectVpn(p.name);
                        }

                        Connections {
                            target: menu.sys
                            ignoreUnknownSignals: true
                            function onVpnProfilesChanged() {
                                if (vpn.joining === "" || !vpn.isOpen)
                                    return;
                                var l = menu.sys.vpnProfiles;
                                for (var i = 0; i < l.length; ++i)
                                    if (l[i].name === vpn.joining && l[i].state === "connected") {
                                        vpn.joining = "";
                                        menu.closeAfter(Theme.systemMenuEntryCloseDelay);
                                    }
                            }
                        }

                        Divider {}
                        Repeater {
                            model: menu.sys && menu.sys.vpnProfiles ? menu.sys.vpnProfiles : []
                            delegate: Column {
                                id: vpnRow
                                required property var modelData
                                width: parent ? parent.width : 0
                                Entry {
                                    objectName: "systemMenuVpnProfile"
                                    forceSelected: vpnRow.modelData.state === "connecting"
                                    onAction: vpn.pick(vpnRow.modelData)
                                    ListEntry {
                                        name: vpnRow.modelData.name
                                        connected: vpnRow.modelData.state === "connected"
                                        status: vpnRow.modelData.state === "connecting" ? qsTr("Connecting...")
                                              : vpnRow.modelData.state === "connectfailed" ? qsTr("Unable to connect") : ""
                                    }
                                }
                                Divider {}
                            }
                        }
                        Entry {
                            onAction: {
                                menu.openPreferences("vpn");
                                menu.closeAfter(Theme.systemMenuRowCloseDelay);
                            }
                            Label { x: Theme.systemMenuIndent + Theme.systemMenuSubIndent; text: qsTr("VPN Preferences") }
                        }
                    }
                    Divider {}

                    // ---- BluetoothElement.qml ----
                    Drawer {
                        id: bluetooth
                        objectName: "systemMenuBluetooth"
                        title: qsTr("Bluetooth")
                        // SystemMenu.cpp:562-610: OFF while coming up, the device when connected.
                        stateText: !menu.bluetoothOn ? qsTr("OFF")
                                   : menu.sys.bluetoothDevice ? menu.sys.bluetoothDevice : qsTr("ON")
                        active: !menu.airplaneModeInProgress
                        spinning: menu.bluetoothTurningOn && isOpen
                        property string joining: ""
                        onOpened: joining = ""

                        // BluetoothElement.qml:261-276.
                        function pick(d) {
                            var connected = d.state === "connected";
                            joining = connected ? "" : d.address;
                            if (connected)
                                menu.closeAfter(Theme.systemMenuEntryCloseDelay);
                            menu.sys.connectBluetooth(d.address);
                        }

                        Connections {
                            target: menu.sys
                            ignoreUnknownSignals: true
                            function onBluetoothDevicesChanged() {
                                if (bluetooth.joining === "" || !bluetooth.isOpen)
                                    return;
                                var l = menu.sys.bluetoothDevices;
                                for (var i = 0; i < l.length; ++i)
                                    if (l[i].address === bluetooth.joining && l[i].state === "connected") {
                                        bluetooth.joining = "";
                                        menu.closeAfter(Theme.systemMenuEntryCloseDelay);
                                    }
                            }
                        }

                        Divider {}
                        Entry {
                            id: bluetoothToggle
                            objectName: "systemMenuBluetoothToggle"
                            readonly property string label: menu.bluetoothTurningOn ? qsTr("Turning on Bluetooth...")
                                : menu.bluetoothOn ? qsTr("Turn off Bluetooth") : qsTr("Turn on Bluetooth")
                            onAction: {
                                // BluetoothElement.qml:200-205; SystemMenu.cpp:462-471.
                                if (menu.bluetoothOn && !menu.bluetoothTurningOn)
                                    menu.closeAfter(Theme.systemMenuRowCloseDelay);
                                if (!menu.bluetoothTurningOn)
                                    menu.sys.setBluetoothOn(!menu.bluetoothOn);
                            }
                            Label { x: Theme.systemMenuIndent + Theme.systemMenuSubIndent; text: bluetoothToggle.label }
                        }
                        Divider {}
                        Repeater {
                            model: menu.bluetoothOn && menu.sys.bluetoothDevices ? menu.sys.bluetoothDevices : []
                            delegate: Column {
                                id: btRow
                                required property var modelData
                                width: parent ? parent.width : 0
                                Entry {
                                    objectName: "systemMenuBluetoothDevice"
                                    forceSelected: btRow.modelData.state === "connecting"
                                    onAction: bluetooth.pick(btRow.modelData)
                                    ListEntry {
                                        name: btRow.modelData.name
                                        connected: btRow.modelData.state === "connected"
                                        status: btRow.modelData.state === "connecting" ? qsTr("Connecting...")
                                              : btRow.modelData.state === "connectfailed" ? qsTr("Unable to connect") : ""
                                    }
                                }
                                Divider {}
                            }
                        }
                        Entry {
                            onAction: {
                                menu.openPreferences("bluetooth");
                                menu.closeAfter(Theme.systemMenuRowCloseDelay);
                            }
                            Label { x: Theme.systemMenuIndent + Theme.systemMenuSubIndent; text: qsTr("Bluetooth Preferences") }
                        }
                    }
                    Divider {}

                    // ---- AirplaneModeElement.qml; labels from SystemMenu.cpp:65-70 ----
                    Entry {
                        id: airplane
                        objectName: "systemMenuAirplane"
                        readonly property bool on: !!menu.sys && menu.sys.airplaneMode
                        readonly property string label: menu.airplaneModeInProgress
                            ? (on ? qsTr("Turning off Airplane Mode") : qsTr("Turning on Airplane Mode"))
                            : (on ? qsTr("Turn off Airplane Mode") : qsTr("Turn on Airplane Mode"))
                        selectable: !menu.airplaneModeInProgress
                        onAction: {
                            menu.sys.airplaneMode = !menu.sys.airplaneMode;
                            menu.closeAfter(Theme.systemMenuToggleCloseDelay);
                        }
                        Label {
                            text: airplane.label
                            color: airplane.selectable ? Theme.systemMenuText : Theme.systemMenuTextDim
                        }
                        Icon {
                            opacity: airplane.selectable ? 1.0 : 0.65
                            source: Theme.asset(airplane.on ? "statusBar/icon-airplane-off.png" : "statusBar/icon-airplane.png")
                        }
                    }
                    Divider {}

                    // ---- RotationLockElement.qml; labels from SystemMenu.cpp:884-898 ----
                    Entry {
                        id: rotation
                        objectName: "systemMenuRotation"
                        // After a tap the row keeps its state until the menu has
                        // faded out (delayUpdate, SystemMenu.qml:48-56,80-92).
                        property bool delayUpdate: false
                        property bool locked: false
                        Binding on locked {
                            when: !rotation.delayUpdate
                            value: !!menu.sys && menu.sys.rotationLocked
                            restoreMode: Binding.RestoreNone
                        }
                        readonly property string label: locked ? qsTr("Turn off Rotation Lock") : qsTr("Turn on Rotation Lock")
                        onAction: {
                            delayUpdate = true;
                            menu.sys.rotationLocked = !menu.sys.rotationLocked;
                            menu.closeAfter(Theme.systemMenuToggleCloseDelay);
                        }
                        Label { text: rotation.label }
                        Icon {
                            source: Theme.asset(rotation.locked ? "statusBar/icon-rotation-lock-off.png" : "statusBar/icon-rotation-lock.png")
                        }
                    }
                    Divider {}

                    // ---- MuteElement.qml; labels from SystemMenu.cpp:900-915 ----
                    Entry {
                        id: mute
                        objectName: "systemMenuMute"
                        last: !menu.torchAvailable
                        property bool delayUpdate: false
                        property bool muted: false
                        Binding on muted {
                            when: !mute.delayUpdate
                            value: !!menu.sys && menu.sys.muted
                            restoreMode: Binding.RestoreNone
                        }
                        readonly property string label: muted ? qsTr("Unmute Sound") : qsTr("Mute Sound")
                        onAction: {
                            delayUpdate = true;
                            menu.sys.muted = !menu.sys.muted;
                            menu.closeAfter(Theme.systemMenuToggleCloseDelay);
                        }
                        Label { text: mute.label }
                        Icon {
                            source: Theme.asset(mute.muted ? "statusBar/icon-mute-off.png" : "statusBar/icon-mute.png")
                        }
                    }

                    // ---- Flashlight (Phoenix; the Device Menu Megamix's torch) ----
                    // Labelled as the rows above; a torch drawn in their
                    // icons' white, with its beam while it is on.
                    Divider { visible: menu.torchAvailable }
                    Entry {
                        id: torch
                        objectName: "systemMenuFlashlight"
                        visible: menu.torchAvailable
                        last: true
                        property bool delayUpdate: false
                        property bool on: false
                        Binding on on {
                            when: !torch.delayUpdate
                            value: menu.torchOn
                            restoreMode: Binding.RestoreNone
                        }
                        readonly property string label: on ? qsTr("Turn off Flashlight") : qsTr("Turn on Flashlight")
                        onAction: {
                            delayUpdate = true;
                            menu.toggleTorch();
                            menu.closeAfter(Theme.systemMenuToggleCloseDelay);
                        }
                        Label { text: torch.label }
                        Canvas {
                            objectName: "systemMenuFlashlightIcon"
                            width: Theme.px(24)
                            height: Theme.px(24)
                            anchors.right: parent.right
                            anchors.rightMargin: Theme.px(12)
                            anchors.verticalCenter: parent.verticalCenter
                            property bool lit: torch.on
                            onLitChanged: requestPaint()
                            onPaint: {
                                var c = getContext("2d"), w = width, h = height;
                                c.reset();
                                c.fillStyle = "rgba(255,255,255,0.9)";
                                // The head, wide at the top, and the handle.
                                c.beginPath();
                                c.moveTo(w * 0.30, h * 0.30);
                                c.lineTo(w * 0.70, h * 0.30);
                                c.lineTo(w * 0.60, h * 0.48);
                                c.lineTo(w * 0.40, h * 0.48);
                                c.closePath();
                                c.fill();
                                c.fillRect(w * 0.40, h * 0.50, w * 0.20, h * 0.42);
                                if (lit) {
                                    c.strokeStyle = "rgba(255,255,255,0.9)";
                                    c.lineWidth = Math.max(1, w / 14);
                                    c.lineCap = "round";
                                    c.beginPath();
                                    c.moveTo(w * 0.50, h * 0.20); c.lineTo(w * 0.50, h * 0.04);
                                    c.moveTo(w * 0.30, h * 0.22); c.lineTo(w * 0.18, h * 0.08);
                                    c.moveTo(w * 0.70, h * 0.22); c.lineTo(w * 0.82, h * 0.08);
                                    c.stroke();
                                }
                            }
                        }
                    }
                }
            }
        }

        // ---- Scroll fades and arrows (SystemMenu.qml:289-333) ----
        Item {
            objectName: "systemMenuScrollUp"
            z: 10
            width: parent.width - Theme.px(22)
            x: (parent.width - width) / 2
            opacity: !flick.atYBeginning ? 1 : 0
            Behavior on opacity { NumberAnimation { duration: Theme.systemMenuScrollFadeDuration } }
            ArtBorderImage {
                width: parent.width
                height: Theme.artHeight(source)
                source: Theme.asset("menu-dropdown-scrollfade-top.png")
                border { left: Theme.artBorder(20, source); right: Theme.artBorder(20, source) }
            }
            Image {
                x: (parent.width - width) / 2
                width: Theme.artWidth(source); height: Theme.artHeight(source)
                source: Theme.asset("menu-arrow-up.png")
            }
        }
        Item {
            objectName: "systemMenuScrollDown"
            z: 10
            width: parent.width - Theme.px(22)
            x: (parent.width - width) / 2
            y: flick.height - Theme.px(29)
            opacity: !flick.atYEnd ? 1 : 0
            Behavior on opacity { NumberAnimation { duration: Theme.systemMenuScrollFadeDuration } }
            ArtBorderImage {
                width: parent.width
                height: Theme.artHeight(source)
                source: Theme.asset("menu-dropdown-scrollfade-bottom.png")
                border { left: Theme.artBorder(20, source); right: Theme.artBorder(20, source) }
            }
            Image {
                x: (parent.width - width) / 2
                y: Theme.px(10)
                width: Theme.artWidth(source); height: Theme.artHeight(source)
                source: Theme.asset("menu-arrow-down.png")
            }
        }
    }
}
