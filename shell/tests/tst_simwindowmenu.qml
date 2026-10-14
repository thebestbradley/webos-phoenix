// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim's Window menu (SimWindowMenu.qml): the open cards, in card
// view's order and stacks, live as they open, close and are renamed; the
// check mark on the card in front; choosing one brings it to the front,
// maximized, from card view, over another card, from the launcher and Just
// Type, and behind the lock screen until the user unlocks; the menu's own
// items (Card View, Launcher, Next Card, Previous Card). The menu bar that
// shows it: build/simchrome-test.
// Run: qmltestrunner -import qml -input tests

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
        system: SimSystemStatus {}
    }

    SimWindowMenu {
        id: menu
        shell: shell
    }

    SignalSpy {
        id: changes
        target: menu
        signalName: "cardsChanged"
    }

    TestCase {
        name: "SimWindowMenu"
        when: windowShown

        property var cv: shell.cardView

        function init() {
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.unlock();
            shell.cardView.jumpTo(0);
            if (shell.launcherOpen)
                shell.shortcut("launcher");
            changes.clear();
        }

        function titles() { return menu.cards.map(function (c) { return (c.child ? "  " : "") + c.title; }).join(", "); }
        function checkedUids() { return menu.cards.filter(function (c) { return c.checked; }).map(function (c) { return c.uid; }); }
        function action(id) {
            for (var i = 0; i < menu.actions.length; ++i)
                if (menu.actions[i].id === id)
                    return menu.actions[i];
            return null;
        }
        // Three cards in card view: Email, Messaging, Calendar.
        function threeCards() {
            var e = windows.launch("org.webosphoenix.email", "");
            var m = windows.launch("org.webosphoenix.messaging", e);
            var c = windows.launch("org.webosphoenix.calendar", m);
            wait(0);
            cv.jumpTo(0);
            return { email: e, msg: m, cal: c };
        }

        function test_listFollowsTheCards() {
            compare(menu.cards.length, 0, "no cards: an empty list (the menu says there are none)");
            var s = threeCards();
            compare(titles(), "Email, Messaging, Calendar", "card view's order, each card's title");
            verify(changes.count > 0, "a change phoenix-sim hears of");
            compare(menu.cards[1].uid, s.msg);
            compare(menu.cards[1].appId, "org.webosphoenix.messaging");
            compare(checkedUids().length, 0, "in card view no card is in front");

            // A window the app opens joins its stack, under its card, once
            // card view has it (after its prepare step, CardView.waitingUid).
            var child = windows.openChild(s.msg);
            tryVerify(function () { return titles() === "Email, Messaging,   New Messaging, Calendar"; }, 2000, titles());
            verify(menu.cards[2].child && !menu.cards[1].child && !menu.cards[3].child);

            // Closed cards go.
            changes.clear();
            windows.close(s.email);
            compare(titles(), "Messaging,   New Messaging, Calendar");
            verify(changes.count > 0);
            windows.close(child);
            compare(titles(), "Messaging, Calendar");
        }

        // The window's own title where it has one, else its app's; the
        // app's icon.
        function test_titlesAndIcons() {
            var s = threeCards();
            var i = windows.cardIndex(s.cal);
            windows.cards.setProperty(i, "title", "Week of June 1");
            compare(menu.cards[2].title, "Week of June 1", "renamed, live");
            windows.cards.setProperty(i, "title", "");
            compare(menu.cards[2].title, "Calendar", "no title of its own: the app's");

            compare(menu.cards[0].icon, "", "an app without an icon: none");
            var a = -1;
            for (var k = 0; k < windows.apps.count; ++k)
                if (windows.apps.get(k).appId === "org.webosphoenix.email")
                    a = k;
            var icon = windows.apps.get(a).icon;
            var file = String(Qt.resolvedUrl("../assets/openwebos/launcher3/launcher-bg64.png"));
            windows.apps.setProperty(a, "icon", file);
            compare(menu.cards[0].icon, file, "the app's icon, as it changes");
            windows.apps.setProperty(a, "icon", icon);
        }

        // Card view: as a tap on the card; the check mark on it once it fills
        // the screen.
        function test_showFromCardView() {
            var s = threeCards();
            verify(menu.show(s.cal));
            tryCompare(cv, "maximized", true);
            compare(cv.currentUid, s.cal);
            compare(checkedUids(), [s.cal]);
            verify(!menu.show("nonesuch"), "a card that is not there");
        }

        // Over a maximized card: the chosen one comes to the front instead,
        // the check mark with it.
        function test_showOverAnotherCard() {
            var s = threeCards();
            menu.show(s.email);
            tryCompare(cv, "maximized", true);
            compare(checkedUids(), [s.email]);
            menu.show(s.msg);
            tryCompare(cv, "currentUid", s.msg);
            tryCompare(cv, "maximized", true);
            compare(checkedUids(), [s.msg]);

            // A card stacked on another: its stack's, in front.
            var child = windows.openChild(s.cal);
            tryCompare(cv, "currentUid", child);
            tryCompare(cv, "maximized", true);
            menu.show(s.cal);
            tryCompare(cv, "currentUid", s.cal);
            tryCompare(cv, "maximized", true);
            compare(checkedUids(), [s.cal]);
        }

        // From the launcher and Just Type: they give way, as for an app
        // switched to from there.
        function test_showFromLauncherAndJustType() {
            var s = threeCards();
            shell.shortcut("launcher");
            verify(shell.launcherOpen);
            menu.show(s.msg);
            tryCompare(cv, "maximized", true);
            verify(!shell.launcherOpen, "the launcher closed");
            compare(cv.currentUid, s.msg);

            shell.shortcut("cardView");
            tryCompare(cv, "maximizeProgress", 0);
            shell.startJustType("");
            verify(shell.justTypeOpen);
            menu.show(s.email);
            tryCompare(cv, "maximized", true);
            verify(!shell.justTypeOpen, "Just Type closed");
            compare(cv.currentUid, s.email);
        }

        // Locked: the card comes to the front behind the lock screen, shown
        // once the user unlocks; the shell's commands wait for that.
        function test_showWhileLocked() {
            var s = threeCards();
            shell.lock();
            verify(shell.locked);
            verify(!menu.commandsAllowed);
            verify(!action("windowCardView").enabled() && !action("nextCard").enabled());
            menu.show(s.cal);
            tryCompare(cv, "maximized", true);
            compare(cv.currentUid, s.cal);
            verify(shell.locked, "still locked: unlocking is the user's");
            action("nextCard").run();
            compare(cv.currentUid, s.cal, "no switching over the lock screen");
            shell.unlock();
            verify(cv.maximized && cv.currentUid === s.cal, "in front once unlocked");
            verify(menu.commandsAllowed);
        }

        // Card View, Launcher, Next Card and Previous Card: the shell's
        // keyboard commands.
        function test_commands() {
            verify(!action("nextCard").enabled(), "nothing to switch to");
            var s = threeCards();
            compare(action("nextCard").keys, ["Ctrl+Shift+]"]);
            compare(action("previousCard").keys, ["Ctrl+Shift+["]);
            verify(action("nextCard").enabled() && action("previousCard").enabled());

            menu.show(s.email);
            tryCompare(cv, "maximized", true);
            action("nextCard").run();
            tryCompare(cv, "currentUid", s.msg);
            tryCompare(cv, "maximized", true);
            action("previousCard").run();
            tryCompare(cv, "currentUid", s.email);

            tryCompare(cv, "maximized", true);
            action("windowCardView").run();
            tryCompare(cv, "maximizeProgress", 0);
            verify(!shell.launcherOpen);
            action("windowCardView").run();
            verify(!shell.launcherOpen, "already there: card view stays");

            action("windowLauncher").run();
            verify(shell.launcherOpen);
            action("windowLauncher").run();
            verify(shell.launcherOpen, "already open: it stays");
            action("windowCardView").run();
            verify(!shell.launcherOpen, "card view from the launcher");
        }
    }
}
