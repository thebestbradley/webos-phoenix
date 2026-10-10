// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The keyboard button on a tablet (KeyboardButton.qml; tst_keyboardbutton.qml
// has the rest): the notification drop-down and popup alerts are at the top
// right, under the status bar; the button keeps clear of them.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 1024
    height: 768

    // The system preferences the shells write (the window source's lunaCall).
    property var prefCalls: []

    Shell {
        id: tablet
        anchors.fill: parent
        formFactor: "tablet"
        density: 1
        virtualKeyboard: true
        source: SimWindowSource {
            id: tabletWindows
            function lunaCall(uri, params, callback) {
                root.prefCalls = root.prefCalls.concat([{ uri: uri, params: params }]);
                callback(null);
            }
        }
        system: SimSystemStatus { id: tabletSys }
    }

    TextInput {
        id: field
        // Under the shell: it takes the focus, not the taps meant for the button.
        z: -1
        x: 10
        y: 40
        width: 200
        height: 20
    }

    TestCase {
        name: "KeyboardButtonTablet"
        when: windowShown

        readonly property var shell: tablet
        readonly property var sys: tabletSys
        readonly property var windows: tabletWindows

        function reset() {
            sys.deviceOrientation = "up";
            tryCompare(shell, "uiOrientation", "up", 3000);
            tryVerify(function() { return !shell.rotator.rotating; }, 3000);
            sys.hardwareKeyboard = false;
            sys.tweaks = {};
            field.focus = false;
            shell.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", false, 2000);
            var notes = shell.notifications;
            notes.dashboardOpen = false;
            notes.bannerActive = false;
            while (windows.notifications.count > 0)
                windows.dismissNotification(0);
            tryCompare(notes, "negativeSpace", 0, 2000);
            shell.unlock();
            root.prefCalls = [];
        }

        function cleanup() {
            sys.hardwareKeyboard = false;
            field.focus = false;
        }

        // The button, shown for the field with a hardware keyboard attached.
        function showButton() {
            sys.hardwareKeyboard = true;
            field.forceActiveFocus();
            var b = findChild(shell, "showKeyboardButton");
            tryCompare(b, "visible", true, 1000);
            return b;
        }

        // Its rectangle in the shell's coordinates.
        function rectOf(item) {
            var p = item.mapToItem(shell, 0, 0);
            return Qt.rect(p.x, p.y, item.width, item.height);
        }
        function overlaps(a, b) {
            return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        }
        function lastPrefs() {
            for (var i = root.prefCalls.length - 1; i >= 0; --i)
                if (/setPreferences$/.test(root.prefCalls[i].uri))
                    return root.prefCalls[i].params;
            return null;
        }

        // Tablet: put under the status bar on the right, a popup alert at
        // the top right pushes it below itself, and the open drop-down too
        // (which takes the keyboard focus, so the button may go instead);
        // nothing it covers is blocked.
        function test_tabletKeepsClearOfAlertsAndTheDropDown() {
            reset();
            sys.tweaks = { keyboardButtonSide: "right", keyboardButtonY: 0 };
            var b = showButton();
            var top = rectOf(b);
            compare(top.y, Theme.statusBarHeight + Theme.px(10));
            compare(top.x + top.width, shell.width - Theme.px(12));
            var notes = shell.notifications;
            var alertRect = function () {
                var r = notes.occupiedRects[0];
                var p = notes.mapToItem(shell, r.x, r.y);
                return Qt.rect(p.x, p.y, r.width, r.height);
            };
            windows.showMemoryAlert();
            tryVerify(function() { return notes.occupiedRects.length === 1; }, 1000, "the alert shows");
            verify(overlaps(top, alertRect()), "the alert is where the button was");
            tryVerify(function() { return !overlaps(rectOf(b), alertRect()); }, 1000, "clear of the alert");
            verify(b.visible);
            compare(rectOf(b).y, alertRect().y + alertRect().height + Theme.px(8));
            while (windows.alerts.count > 0)
                windows.closeAlert(windows.alerts.get(0).key);
            tryCompare(b, "y", top.y, 2000);

            windows.notify("org.webosphoenix.messaging", "Palm Pre", "Tablet");
            notes.bannerActive = false;
            notes.dashboardOpen = true;
            var menu = findChild(shell, "dashboardMenu");
            tryVerify(function() { return menu.visible && menu.height > 0; }, 1000);
            tryVerify(function() { return !b.visible || !overlaps(rectOf(b), rectOf(menu)); }, 1000, "clear of the drop-down");
            notes.dashboardOpen = false;
            tryVerify(function() { return !menu.visible; }, 2000);
        }

        // The default place, the bottom right, and a tap there.
        function test_tabletTapShowsTheKeyboard() {
            reset();
            var b = showButton();
            var r = rectOf(b);
            compare(r.x + r.width, shell.width - Theme.px(12));
            compare(r.y + r.height, shell.height - Theme.gestureAreaHeight - Theme.px(10));
            mouseClick(b);
            tryCompare(shell, "keyboardOpen", true, 1000);
            verify(!b.visible);
        }
    }
}
