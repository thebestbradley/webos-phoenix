// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The adaptive simulator (phoenix-sim --adaptive, ./phoenix run): with
// formFactor "auto" the shell is a phone or a tablet by its screen's size
// (Theme.tabletLayoutFor), and the screen is the window, so a resize across
// the threshold switches the layout live: the card view, the launcher and
// the dock, the status bar, the keyboard, the notifications, without
// restarting the apps.
// Needs Phoenix.Native (KeyInjector): run with the build tree's modules.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 1024
    height: 768

    Item {
        id: screen
        width: 320
        height: 480

        Shell {
            id: shell
            anchors.fill: parent
            formFactor: "auto"
            density: 1
            virtualKeyboard: true
            source: SimWindowSource { id: windows }
            system: SimSystemStatus { id: sys }
        }
    }

    TextInput {
        id: field
        x: 10
        y: 40
        width: 200
        height: 20
    }

    TestCase {
        name: "FormFactorSwitch"
        when: windowShown

        function resize(w, h) {
            screen.width = w;
            screen.height = h;
            tryCompare(shell, "tablet", Math.min(w, h) / shell.effectiveDensity >= 600, 1000);
            tryCompare(Theme, "tablet", shell.tablet, 1000);
            wait(50);
        }
        function phone() { resize(320, 480); }
        function tablet() { resize(1024, 768); }

        function init() {
            phone();
            field.focus = false;
            shell.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", false, 2000);
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.cardView.maximizeProgress = 0;
            shell.notifications.dashboardOpen = false;
            while (windows.notifications.count > 0)
                windows.dismissNotification(0);
            shell.unlock();
            if (shell.launcherOpen)
                shell.gestureUp();
            tryCompare(shell, "launcherOpen", false, 2000);
        }

        function test_threshold() {
            verify(!shell.tablet);
            // The shorter side decides: 600 legacy pixels (Theme.tabletMinSide).
            resize(599, 900);
            verify(!shell.tablet);
            resize(600, 900);
            verify(shell.tablet);
            resize(1024, 599);
            verify(!shell.tablet);
            // At a density of 2 it is the legacy pixels that count.
            shell.density = 2;
            resize(1024, 768);
            verify(!shell.tablet);
            resize(1600, 1400);
            verify(shell.tablet);
            shell.density = 1;
        }

        // The cards keep running through the switch, and the card view
        // takes the tablet's proportions (luna-topaz.conf).
        function test_cardsSurviveAndRelayout() {
            windows.launch("org.webosphoenix.email", "");
            windows.launch("org.webosphoenix.messaging", "");
            tryCompare(windows.cards, "count", 2, 2000);
            var uids = [windows.cards.get(0).uid, windows.cards.get(1).uid];
            var view = shell.cardView;
            compare(Theme.activeCardRatio, 0.659);
            tablet();
            compare(windows.cards.count, 2);
            compare(windows.cards.get(0).uid, uids[0]);
            compare(windows.cards.get(1).uid, uids[1]);
            compare(Theme.activeCardRatio, 0.55);
            compare(Theme.gapBetweenCards, 30);
            // A maximized card fills the tablet's screen under the bar.
            view.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            var card = findChild(view, "card-" + view.currentUid) || null;
            phone();
            verify(shell.maximized, "still the app in front");
            compare(windows.cards.count, 2);
            view.minimize();
            tryCompare(view, "maximizeProgress", 0, 2000);
        }

        function test_launcherAndDock() {
            var dock = findChild(shell, "quickLaunch");
            compare(dock.height, 68);
            compare(Theme.launcherColumns, 3);
            shell.gestureUp();
            tryCompare(shell, "launcherOpen", true, 2000);
            tablet();
            verify(shell.launcherOpen, "the launcher stays open");
            compare(Theme.launcherColumns, 7);
            tryCompare(dock, "height", 100, 1000);
            var n = dock.pinned.length;
            compare(dock.slotCentre(n), dock.width - 64);
            phone();
            compare(Theme.launcherColumns, 3);
            tryCompare(dock, "height", 68, 1000);
        }

        function test_statusBar() {
            verify(findChild(shell, "centreClock").visible);
            verify(!findChild(shell, "tabletClock").visible);
            tablet();
            tryVerify(function() { return findChild(shell, "tabletClock").visible; }, 1000);
            verify(!findChild(shell, "centreClock").visible);
            compare(findChild(shell, "statusBar").width, 1024);
            compare(Theme.statusBarFill, Qt.color("#515558"));
            phone();
            tryVerify(function() { return findChild(shell, "centreClock").visible; }, 1000);
            compare(findChild(shell, "statusBar").width, 320);
        }

        // The keyboard that is up stays up, as the other form factor's.
        function test_keyboardSwitchesWhileUp() {
            var kb = shell.keyboard;
            field.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", true, 2000);
            tryCompare(shell.notifications, "negativeSpace", kb.keyboardHeight, 2000);
            verify(!kb.tablet);
            verify(kb.keyRect("Tab") === null, "the phone has no Tab key");
            var phoneHeight = kb.keyboardHeight;

            tablet();
            verify(kb.tablet);
            tryCompare(shell, "keyboardOpen", true, 1000);
            tryVerify(function() { return kb.visible; }, 1000, "the keyboard is shown");
            tryVerify(function() { return kb.keyRect("Tab") !== null; }, 1000, "the tablet's keys");
            verify(kb.keyboardHeight !== phoneHeight);
            tryCompare(shell.notifications, "negativeSpace", kb.keyboardHeight, 2000);
            compare(kb.width, 1024);

            phone();
            verify(!kb.tablet);
            tryVerify(function() { return kb.visible; }, 1000, "the keyboard is shown");
            tryVerify(function() { return kb.keyRect("Tab") === null && kb.keyRect("q") !== null; }, 1000);
            tryCompare(shell.notifications, "negativeSpace", kb.keyboardHeight, 2000);
            compare(kb.width, 320);
        }

        function test_notifications() {
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "Hi");
            tryVerify(function() { return windows.notifications.count === 1; }, 2000);
            tablet();
            shell.notifications.bannerActive = false;
            var icons = findChild(shell, "tabletNotificationIcons");
            tryVerify(function() { return icons.visible; }, 3000);
            compare(windows.notifications.count, 1);
            phone();
            tryVerify(function() { return !icons.visible; }, 3000);
            compare(windows.notifications.count, 1);
        }
    }
}
