// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system menu (port of luna-sysmgr's uiComponents/SystemMenu): its
// metrics, labels, drawers, and closing after a toggle.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus {
            id: status
            fixedTime: new Date(2009, 5, 6, 9, 41)
            _scanTime: 100
            _connectTime: 150
        }
    }

    SignalSpy { id: launched; signalName: "launchRequested" }

    TestCase {
        name: "SystemMenu"
        when: windowShown

        property var menu: findChild(shell, "systemMenu")

        function init() {
            shell.unlock();
            menu.open = false;
            tryCompare(menu, "visible", false, 1000);
            status.airplaneMode = false;
            status.rotationLocked = false;
            status.muted = false;
            status.brightness = 0.7;
            status.bluetoothOn = false;
            status.bluetoothTurningOn = false;
            status.setWifiOn(true);
            menu.restricted = false;
            launched.target = menu;
            launched.clear();
            shell.openSystemMenu();
            tryCompare(menu, "opacity", 1, 1000);
        }

        function test_metrics() {
            // SystemMenu.qml:6,16; MenuListEntry.qml:6; lunaAnimations.conf:124.
            compare(Theme.systemMenuWidth, 300);
            compare(Theme.systemMenuMaxHeight, 410);
            compare(Theme.systemMenuRowHeight, 42);
            compare(Theme.systemMenuFontSize, 18);
            compare(Theme.systemMenuStateFontSize, 13);
            compare(Theme.systemMenuFadeDuration, 200);
            var date = findChild(menu, "systemMenuDate");
            compare(date.height, 42);
            // 300 wide less 7 px each side; its right edge 11 px off screen.
            compare(date.width, 286);
            var p = date.mapToItem(root, 0, 0);
            compare(p.x + date.width + 7 - 11, root.width);
            compare(p.y, Theme.statusBarHeight);
        }

        // GAPS V8 (3): with a keyboard, Down / Up move through the rows on
        // show (the first is the brightness slider: the date and battery
        // rows do nothing), Left / Right move a slider, Enter acts, Esc
        // closes the menu.
        function test_keyboardNavigation() {
            verify(shell.activeFocus);
            keyClick(Qt.Key_Down);
            var brightness = menu.keyItem;
            verify(brightness && brightness.adjustable, "first stop: the brightness slider");
            verify(brightness.keyFocused);
            keyClick(Qt.Key_Right);
            verify(status.brightness > 0.7);
            keyClick(Qt.Key_Left);
            keyClick(Qt.Key_Left);
            verify(status.brightness < 0.7);
            // Down to the Airplane Mode row and turn it on with Enter.
            var airplane = null;
            for (var i = 0; i < 20 && !airplane; ++i) {
                keyClick(Qt.Key_Down);
                if (menu.keyItem.label !== undefined && String(menu.keyItem.label).indexOf("Airplane Mode") >= 0)
                    airplane = menu.keyItem;
            }
            verify(airplane, "reached Airplane Mode");
            verify(!brightness.keyFocused);
            keyClick(Qt.Key_Return);
            tryCompare(status, "airplaneMode", true, 2000);
            // Up from the top wraps to the bottom; Esc closes.
            keyClick(Qt.Key_Escape);
            tryCompare(menu, "open", false, 1000);
        }

        function test_dateAndBattery() {
            compare(findChild(menu, "systemMenuDate").label,
                    new Date(2009, 5, 6).toLocaleDateString(Qt.locale(), Locale.LongFormat));
            compare(findChild(menu, "systemMenuBattery").label, "Battery: 76%");
            status.batteryPercent = 42;
            compare(findChild(menu, "systemMenuBattery").label, "Battery: 42%");
            status.batteryPercent = 76;
        }

        function test_airplaneModeClosesAfterToggle() {
            var row = findChild(menu, "systemMenuAirplane");
            compare(row.label, "Turn on Airplane Mode");
            mouseClick(row);
            verify(status.airplaneMode);
            compare(row.label, "Turn off Airplane Mode");
            // Still open for 250 ms, then closes (SystemMenu.qml:247-248).
            wait(150);
            verify(menu.open);
            tryCompare(menu, "open", false, 400);
        }

        function test_airplaneModeInProgress() {
            var row = findChild(menu, "systemMenuAirplane");
            status.airplaneModeInProgress = true;
            compare(row.label, "Turning on Airplane Mode");
            verify(!row.selectable);
            verify(!findChild(menu, "systemMenuWifi").active);
            status.airplaneModeInProgress = false;
            verify(row.selectable);
        }

        // Dock mode's menu (SystemMenu(320, 480, true), DockModeMenuManager.cpp:142):
        // the radio drawers show their state, greyed, and do not open;
        // airplane mode cannot be changed; rotation lock and mute work
        // (SystemMenu.cpp:188-241).
        function test_restrictedMenu() {
            menu.restricted = true;
            var wifi = findChild(menu, "systemMenuWifi");
            var vpn = findChild(menu, "systemMenuVpn");
            var bt = findChild(menu, "systemMenuBluetooth");
            var air = findChild(menu, "systemMenuAirplane");
            verify(!wifi.active && !vpn.active && !bt.active);
            compare(wifi.stateText, status.wifiSsid);
            compare(bt.stateText, "OFF");
            // A tap on a drawer's header does nothing.
            mouseClick(wifi, 40, 21);
            mouseClick(bt, 40, 21);
            wait(400);
            verify(!wifi.isOpen && !bt.isOpen);
            compare(wifi.height, 42);
            verify(!air.selectable);
            mouseClick(air);
            verify(!status.airplaneMode);
            verify(menu.open);
            // The keyboard skips them: the brightness slider, the volume,
            // then the rotation lock.
            keyClick(Qt.Key_Down);
            keyClick(Qt.Key_Down);
            keyClick(Qt.Key_Down);
            compare(menu.keyItem.objectName, "systemMenuRotation");
            keyClick(Qt.Key_Escape);
            tryCompare(menu, "open", false, 1000);
            shell.openSystemMenu();
            tryCompare(menu, "opacity", 1, 1000);
            mouseClick(findChild(menu, "systemMenuRotation"));
            verify(status.rotationLocked);
            tryCompare(menu, "open", false, 1000);
            // An open drawer shuts when the menu becomes restricted.
            menu.restricted = false;
            shell.openSystemMenu();
            tryCompare(menu, "opacity", 1, 1000);
            wifi.open();
            menu.restricted = true;
            verify(!wifi.isOpen);
            menu.restricted = false;
            verify(wifi.active);
        }

        // Turned on from the menu with nothing paired, Bluetooth opens its
        // preferences to pair something (SystemMenu::slotBluetoothTurnedOn,
        // SystemMenu.cpp:552-558); with devices paired it stays in the menu.
        function test_bluetoothNoPairedDevices() {
            compare(status.bluetoothPairedCount, -1);
            verify(menu.bluetoothPairedDevicesAvailable, "the sample devices count until the runtime says");
            status.applyAppStatus({ bluetoothPairedCount: 0 });
            verify(!menu.bluetoothPairedDevicesAvailable);
            var bt = findChild(menu, "systemMenuBluetooth");
            bt.open();
            tryVerify(function() { return bt.height > 42 * 3; }, 1000);
            mouseClick(findChild(menu, "systemMenuBluetoothToggle"));
            compare(launched.count, 0);
            tryVerify(function() { return status.bluetoothOn; }, 1000);
            compare(launched.count, 1);
            compare(launched.signalArguments[0][0], "org.webosphoenix.settings");
            compare(launched.signalArguments[0][1].page, "bluetooth");
            tryCompare(menu, "open", false, 1000);
            // Turned on elsewhere (Settings), it does not.
            status.setBluetoothOn(false);
            launched.clear();
            status.setBluetoothOn(true);
            tryVerify(function() { return status.bluetoothOn; }, 1000);
            compare(launched.count, 0);
            // Something paired: the menu stays.
            status.setBluetoothOn(false);
            status.applyAppStatus({ bluetoothPairedCount: 1 });
            shell.openSystemMenu();
            tryCompare(menu, "opacity", 1, 1000);
            bt.open();
            tryVerify(function() { return bt.height > 42 * 3; }, 1000);
            mouseClick(findChild(menu, "systemMenuBluetoothToggle"));
            tryVerify(function() { return status.bluetoothOn; }, 1000);
            wait(400);
            compare(launched.count, 0);
            verify(menu.open);
            status.bluetoothPairedCount = -1;
        }

        function test_rotationLockLabelWaitsForClose() {
            var row = findChild(menu, "systemMenuRotation");
            compare(row.label, "Turn on Rotation Lock");
            mouseClick(row);
            verify(status.rotationLocked);
            // The row keeps its label while the menu fades (delayUpdate).
            compare(row.label, "Turn on Rotation Lock");
            tryCompare(menu, "visible", false, 1000);
            compare(row.label, "Turn off Rotation Lock");
        }

        function test_muteLabels() {
            var row = findChild(menu, "systemMenuMute");
            // The last row: below the fold on a phone (the menu scrolls).
            var flick = findChild(menu, "systemMenuFlickable");
            flick.contentY = Math.max(0, flick.contentHeight - flick.height);
            compare(row.label, "Mute Sound");
            mouseClick(row);
            verify(status.muted);
            tryCompare(menu, "visible", false, 1000);
            compare(row.label, "Unmute Sound");
        }

        function test_brightnessFloor() {
            // The slider's far left is 10%, not off (SystemMenu.cpp:61,873-876).
            var slider = findChild(menu, "systemMenuBrightness");
            var hx = 8 + (slider.width - 16) * slider.value;
            mousePress(slider, hx, slider.height / 2);
            mouseMove(slider, hx - 60, slider.height / 2);
            mouseMove(slider, -40, slider.height / 2);
            mouseRelease(slider, -40, slider.height / 2);
            fuzzyCompare(status.brightness, 0.10, 0.001);
            compare(slider.value, 0);
            // A tap on the rail steps 20% towards it.
            mouseClick(slider, slider.width - 10, slider.height / 2);
            fuzzyCompare(status.brightness, 0.10 + 0.2 * 0.9, 0.001);
        }

        // Phoenix: the volume, below brightness: the master volume, 0-100.
        function test_volumeSlider() {
            var slider = findChild(menu, "systemMenuVolume");
            verify(slider, "a volume slider");
            var bright = findChild(menu, "systemMenuBrightness");
            verify(slider.mapToItem(menu, 0, 0).y > bright.mapToItem(menu, 0, 0).y, "below brightness");
            fuzzyCompare(slider.value, status.volume / 100, 0.001);
            var hx = 8 + (slider.width - 16) * slider.value;
            mousePress(slider, hx, slider.height / 2);
            mouseMove(slider, hx + 30, slider.height / 2);
            mouseMove(slider, slider.width + 40, slider.height / 2);
            mouseRelease(slider, slider.width + 40, slider.height / 2);
            compare(status.volume, 100);
            mouseClick(slider, 10, slider.height / 2);
            compare(status.volume, 80);
        }

        function test_wifiDrawer() {
            var wifi = findChild(menu, "systemMenuWifi");
            compare(wifi.stateText, "Phoenix");
            verify(!wifi.isOpen);
            mouseClick(wifi, wifi.width / 2, 21);
            verify(wifi.isOpen);
            // Scanning: spinner, no list yet; then the networks.
            verify(wifi.spinning);
            verify(!findChild(menu, "systemMenuWifiNetwork"));
            tryCompare(wifi, "listed", true, 1000);
            verify(!wifi.spinning);
            verify(findChild(menu, "systemMenuWifiNetwork"));
            compare(findChild(menu, "systemMenuWifiToggle").label, "Turn off WiFi");
            // Opens over 350 ms OutCubic.
            tryVerify(function() { return wifi.height > 42 * 4; }, 1000);
            mouseClick(wifi, wifi.width / 2, 21);
            verify(!wifi.isOpen);
        }

        function test_wifiOffClosesMenu() {
            var wifi = findChild(menu, "systemMenuWifi");
            wifi.open();
            var toggle = findChild(menu, "systemMenuWifiToggle");
            tryVerify(function() { return wifi.height > 42 * 3; }, 1000);
            mouseClick(toggle);
            compare(status.wifiBars, -1);
            compare(wifi.stateText, "OFF");
            compare(toggle.label, "Turn on WiFi");
            tryCompare(menu, "open", false, 600);
        }

        function test_wifiOnClosesWhenConnected() {
            status.setWifiOn(false);
            var wifi = findChild(menu, "systemMenuWifi");
            wifi.open();
            var toggle = findChild(menu, "systemMenuWifiToggle");
            tryVerify(function() { return wifi.height > 42 * 3; }, 1000);
            mouseClick(toggle);
            verify(status.wifiBars >= 0);
            verify(wifi.spinning);
            // Joins the known network, then closes 1 s later (WiFiElement.qml:92-95).
            tryCompare(status, "wifiSsid", "Phoenix", 1000);
            verify(menu.open);
            tryCompare(menu, "open", false, 1500);
        }

        function test_bluetoothTurningOn() {
            var bt = findChild(menu, "systemMenuBluetooth");
            compare(bt.stateText, "OFF");
            bt.open();
            var toggle = findChild(menu, "systemMenuBluetoothToggle");
            compare(toggle.label, "Turn on Bluetooth");
            tryVerify(function() { return bt.height > 42 * 3; }, 1000);
            mouseClick(toggle);
            compare(toggle.label, "Turning on Bluetooth...");
            verify(bt.spinning);
            tryCompare(toggle, "label", "Turn off Bluetooth", 1000);
            verify(!bt.spinning);
            compare(bt.stateText, "ON");
            // Turning on leaves the menu open.
            verify(menu.open);
            verify(findChild(menu, "systemMenuBluetoothDevice"));
        }

        function test_bluetoothDeviceConnects() {
            status.bluetoothOn = true;
            var bt = findChild(menu, "systemMenuBluetooth");
            bt.open();
            tryVerify(function() { return bt.height > 42 * 4; }, 1000);
            var dev = findChild(menu, "systemMenuBluetoothDevice");
            mouseClick(dev);
            verify(findChild(menu, "systemMenuBluetoothDevice").forceSelected);
            tryCompare(status, "bluetoothDevice", "Palm Stereo Headset", 1000);
            compare(bt.stateText, "Palm Stereo Headset");
            tryCompare(menu, "open", false, 1000);
        }

        function test_vpnDrawer() {
            var vpn = findChild(menu, "systemMenuVpn");
            compare(vpn.stateText, "Off");
            vpn.open();
            tryVerify(function() { return vpn.height > 42 * 2; }, 1000);
            mouseClick(findChild(menu, "systemMenuVpnProfile"));
            compare(vpn.stateText, "Office");
            tryCompare(status, "vpnProfile", "Office", 1000);
            tryCompare(menu, "open", false, 1000);
            status.connectVpn("Office");
            compare(status.vpnProfile, "");
        }

        // Once the web runtime reports its profiles (Settings > VPN), the
        // drawer shows those, and a row asks the runtime to connect or
        // disconnect (sim.qml sends the request to the pages).
        SignalSpy { id: vpnAsked; target: status; signalName: "vpnRequested" }
        function test_vpnFromTheRuntime() {
            var demo = status.vpnProfiles;
            status.applyAppStatus({ vpnProfiles: [{ id: "vpn1", name: "Office", state: "disconnected" },
                                                  { id: "vpn2", name: "Home", state: "connected" }] });
            var vpn = findChild(menu, "systemMenuVpn");
            compare(vpn.stateText, "Home");
            vpnAsked.clear();
            status.connectVpn("Office");
            compare(vpnAsked.count, 1);
            compare(vpnAsked.signalArguments[0][0].vpnConnect, "Office");
            status.connectVpn("Home");
            compare(vpnAsked.signalArguments[1][0].vpnDisconnect, "Home");
            // The runtime answers; the menu follows it, not a guess of its own.
            compare(status.vpnProfiles[0].state, "disconnected");
            status.applyAppStatus({ vpnProfiles: [{ id: "vpn1", name: "Office", state: "connecting" },
                                                  { id: "vpn2", name: "Home", state: "disconnected" }] });
            compare(vpn.stateText, "Office");
            // One that asks for a user name and password: the row opens
            // Settings > VPN to sign in there.
            status.applyAppStatus({ vpnProfiles: [{ name: "Home", state: "disconnected", needsCredentials: true }] });
            vpn.open();
            tryVerify(function() { return vpn.height > 42 * 2; }, 1000);
            launched.clear();
            vpnAsked.clear();
            mouseClick(findChild(menu, "systemMenuVpnProfile"));
            compare(vpnAsked.count, 0);
            compare(launched.count, 1);
            compare(launched.signalArguments[0][0], "org.webosphoenix.settings");
            compare(launched.signalArguments[0][1].page, "vpn");
            compare(launched.signalArguments[0][1].connect, "Home");
            tryCompare(menu, "open", false, 1000);
            status._runtimeVpn = false;
            status.vpnProfiles = demo;
        }

        function test_preferences() {
            var wifi = findChild(menu, "systemMenuWifi");
            wifi.open();
            tryCompare(wifi, "listed", true, 1000);
            var prefs = findChild(menu, "systemMenuWifiPreferences");
            tryVerify(function() { return wifi.height > 42 * 6; }, 1000);
            // The list is longer than the menu: scroll the row into view.
            var flick = findChild(menu, "systemMenuFlickable");
            verify(flick.contentHeight > flick.height);
            flick.contentY = prefs.mapToItem(flick.contentItem, 0, 0).y - 100;
            mouseClick(prefs);
            compare(launched.count, 1);
            compare(launched.signalArguments[0][0], "org.webosphoenix.settings");
            compare(launched.signalArguments[0][1].page, "wifi");
            tryCompare(menu, "open", false, 600);
        }

        function test_drawersShutOnClose() {
            var wifi = findChild(menu, "systemMenuWifi");
            wifi.open();
            menu.open = false;
            tryCompare(menu, "visible", false, 1000);
            verify(!wifi.isOpen);
            // Shut at once (no animation)...
            verify(wifi.closedFully);
            // ...and the drawer's column lays out again on the next frame.
            tryCompare(wifi, "height", 42, 500);
        }

        function test_settingsLaunchPoint() {
            // The window source opens Settings' Wi-Fi launch point for {page: "wifi"}.
            windows.apps.append({ appId: "org.webosphoenix.settings.wifi", title: "Wi-Fi", color: "#555c66", glyph: "W",
                                  tab: 2, quickLaunch: 0, icon: "", web: false, main: "", noWindow: false,
                                  webAppId: "org.webosphoenix.settings", params: "{\"page\":\"wifi\"}", dir: "",
                                  removable: false });
            var uid = windows.launch("org.webosphoenix.settings", "", { page: "wifi" });
            verify(uid !== "");
            compare(windows.cards.get(windows.cardIndex(uid)).appId, "org.webosphoenix.settings.wifi");
            windows.close(uid);
            windows.apps.remove(windows.apps.count - 1);
        }
    }
}
