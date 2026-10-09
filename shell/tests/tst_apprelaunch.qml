// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Apps > Opening a running app (system preference appRelaunch):
// opening an app that already has a card brings that card to the front as
// it is ("front", the default), relaunches it so it reloads its data
// ("refresh"), or opens another card of it ("new").

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
        system: SimSystemStatus { id: status }
    }

    TestCase {
        name: "AppRelaunch"
        when: windowShown

        readonly property string email: "org.webosphoenix.email"
        readonly property string calendar: "org.webosphoenix.calendar"

        function init() {
            status.applyAppStatus({ appRelaunch: "front" });
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.unlock();
        }
        function cleanup() {
            status.applyAppStatus({ appRelaunch: "front" });
        }

        function cardsOf(appId) {
            var list = [];
            for (var i = 0; i < windows.cards.count; ++i)
                if (windows.cards.get(i).appId === appId)
                    list.push(windows.cards.get(i).uid);
            return list;
        }

        function test_frontByDefault() {
            compare(shell.appRelaunch, "front");
            compare(windows.appRelaunch, "front");
            var a = shell.openApp(email);
            verify(a !== "");
            shell.openApp(calendar);
            tryCompare(shell.cardView, "currentUid", windows.runningUid(calendar), 2000);
            // Opened again: the same card, in front, its state kept (no
            // relaunch without params).
            compare(shell.openApp(email), a);
            compare(cardsOf(email).length, 1);
            tryCompare(shell.cardView, "currentUid", a, 2000);
            compare(windows.windowFor(a).relaunchParams, null);
            compare(windows.windowFor(a).refreshCount, 0);
        }

        function test_refresh() {
            status.applyAppStatus({ appRelaunch: "refresh" });
            compare(shell.appRelaunch, "refresh");
            compare(windows.appRelaunch, "refresh");
            var a = shell.openApp(email);
            compare(windows.windowFor(a).refreshCount, 0, "a first launch is not a refresh");
            // From the wave launcher (the dock's apps): the same card,
            // relaunched with fresh data.
            shell.waveLauncher.launchRequested(email);
            compare(cardsOf(email).length, 1);
            compare(windows.windowFor(a).refreshCount, 1);
            compare(JSON.stringify(windows.windowFor(a).relaunchParams), "{}");
            // A tapped notification stays the card's (front): its params
            // go to it, no refresh.
            shell.launch(email, { messageId: "m1" });
            compare(windows.windowFor(a).refreshCount, 1);
            compare(windows.windowFor(a).relaunchParams.messageId, "m1");
        }

        function test_newCard() {
            status.applyAppStatus({ appRelaunch: "new" });
            var a = shell.openApp(email);
            tryVerify(function() { return shell.maximized; }, 2000);
            var b = shell.openApp(email);
            verify(b !== "" && b !== a, "a second card of the app");
            compare(cardsOf(email).length, 2);
            // Each its own stack, and the new one in front.
            var ia = windows.cardIndex(a), ib = windows.cardIndex(b);
            verify(windows.cards.get(ia).groupId !== windows.cards.get(ib).groupId);
            tryCompare(shell.cardView, "currentUid", b, 2000);
            verify(windows.windowFor(a) !== windows.windowFor(b));
            // Both in card view; closed one by one.
            shell.cardView.minimize();
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
            verify(shell.cardView.cardItem(a) !== null);
            verify(shell.cardView.cardItem(b) !== null);
            windows.close(b);
            compare(cardsOf(email).length, 1);
            compare(windows.runningUid(email), a);
            verify(windows.windowFor(a) !== null);
            windows.close(a);
            compare(cardsOf(email).length, 0);
        }

        function test_newCardKeepsOneCardApps() {
            status.applyAppStatus({ appRelaunch: "new" });
            // The phone's card is the call: never two.
            var p = shell.openApp(windows.phoneAppId);
            compare(shell.openApp(windows.phoneAppId), p);
            compare(cardsOf(windows.phoneAppId).length, 1);
            // A notification's tap goes to the card there is.
            var a = shell.openApp(email);
            compare(shell.launch(email, { messageId: "m2" }), a);
            compare(cardsOf(email).length, 1);
        }

        // An app opening another (a link, the assistant's "Open Memos")
        // follows the setting; an app launching itself (its dashboard) or
        // a background launch (an alarm) does not.
        function test_launchesFromApps() {
            var e = shell.openApp(email);
            var c = shell.openApp(calendar);
            status.applyAppStatus({ appRelaunch: "new" });
            windows._hostMessage("org.webosphoenix.assistant", "", "launch", { id: calendar, params: {} });
            compare(cardsOf(calendar).length, 2);
            windows._hostMessage(email, e, "launch", { id: email, params: { folder: "inbox" } });
            compare(cardsOf(email).length, 1);
            compare(windows.windowFor(e).relaunchParams.folder, "inbox");
            windows._hostMessage("org.webosphoenix.clock", "", "launch", { id: email, params: { $activity: { activityId: 1 } } });
            compare(cardsOf(email).length, 1);

            status.applyAppStatus({ appRelaunch: "refresh" });
            windows._hostMessage("org.webosphoenix.assistant", "", "launch", { id: email, params: {} });
            compare(cardsOf(email).length, 1);
            compare(windows.windowFor(e).refreshCount, 1);
        }

        // An app asking for a new card of itself ({newCard: true}, the
        // Assistant's "Open in New Card"): another card whatever the
        // setting, in a stack of its own beside the asking card's, with its
        // params; a background launch or a one-card app does not.
        function test_newCardAsked() {
            var a = shell.openApp(email);
            windows._hostMessage(email, a, "launch", { id: email, params: { conversationId: "t1" }, newCard: true });
            var list = cardsOf(email);
            compare(list.length, 2);
            var b = list[0] === a ? list[1] : list[0];
            verify(windows.cards.get(windows.cardIndex(a)).groupId !== windows.cards.get(windows.cardIndex(b)).groupId,
                   "its own stack");
            compare(windows.cardIndex(b), windows.cardIndex(a) + 1, "right of the asking card");
            compare(windows.windowFor(a).relaunchParams, null, "the asking card keeps its own");
            tryCompare(shell.cardView, "currentUid", b, 2000);
            windows._hostMessage(email, a, "launch", { id: email, params: { $activity: { activityId: 2 } }, newCard: true });
            compare(cardsOf(email).length, 2);
            var p = shell.openApp(windows.phoneAppId);
            windows._hostMessage(windows.phoneAppId, p, "launch", { id: windows.phoneAppId, params: {}, newCard: true });
            compare(cardsOf(windows.phoneAppId).length, 1);
        }

        // The setting reaches the shell through the runtime's systemStatus
        // (anything else is "front").
        function test_unknownIsFront() {
            status.applyAppStatus({ appRelaunch: "sideways" });
            compare(shell.appRelaunch, "front");
        }
    }
}
