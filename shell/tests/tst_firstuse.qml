// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// First Use (LunaSysMgr's minimal UI) and Reduce motion.
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
        system: SimSystemStatus { id: status }
        // The simulator's placeholders have no First Use app; Memos stands in.
        firstUseAppId: "org.webosphoenix.memos"
    }

    SignalSpy { id: ended; target: shell; signalName: "firstUseEnded" }

    TestCase {
        name: "FirstUse"
        when: windowShown

        function init() {
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.cardView.position = 0;
            shell.cardView.maximizeProgress = 0;
            ended.clear();
            verify(!shell.firstUse);
            shell.lock();
        }

        function cleanup() {
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            status.reduceMotion = false;
        }

        function test_startsFullScreenOverNothingElse() {
            verify(shell.locked);
            verify(shell.startFirstUse());
            verify(shell.firstUse);
            // No lock screen before it, the app's card maximized.
            verify(!shell.locked);
            compare(windows.cards.count, 1);
            compare(windows.cards.get(0).appId, "org.webosphoenix.memos");
            tryVerify(function() { return shell.maximized; }, 2000);
            // No dock, search pill or launcher; no system menu; no Just Type.
            verify(!shell.dockShown);
            verify(!shell.searchPill.shown);
            shell.gestureUp();
            verify(!shell.launcherOpen);
            verify(shell.maximized, "swipe up does not leave First Use");
            shell.homeKey();
            verify(!shell.launcherOpen);
            shell.openSystemMenu();
            verify(!findChild(shell, "systemMenu").open);
            keyClick(Qt.Key_M);
            verify(!shell.justTypeOpen);
            // It cannot be locked either (LunaSysMgr's minimal UI had no lock screen).
            shell.lock();
            verify(!shell.locked);
        }

        function test_anAppItOpensCanBeSwitchedTo() {
            shell.startFirstUse();
            var first = windows.cards.get(0).uid;
            tryVerify(function() { return shell.maximized; }, 2000);
            // First Use opens Accounts, say.
            var other = shell.launch("org.webosphoenix.email");
            tryCompare(shell.cardView, "currentUid", other, 2000);
            tryVerify(function() { return shell.maximized; }, 2000);
            // Now swipe up shows the two cards, still no launcher.
            shell.gestureUp();
            tryCompare(shell.cardView, "maximizeProgress", 0, 2000);
            verify(!shell.launcherOpen);
            verify(!shell.dockShown);
            shell.gestureUp();
            verify(!shell.launcherOpen);
            // First Use's card springs back when flicked; the other goes.
            shell.cardView.animateFlick(shell.cardView.cardItem(first), true);
            wait(Theme.cardDeleteDuration + 100);
            compare(windows.cardIndex(first) >= 0, true);
            shell.cardView.close(other);
            tryCompare(windows.cards, "count", 1, 2000);
            verify(shell.firstUse);
        }

        function test_endsWhenTheAppClosesItsWindow() {
            shell.startFirstUse();
            var uid = windows.cards.get(0).uid;
            // window.close() from the page, after it set firstUseComplete.
            windows.cardCloseRequested(uid);
            tryCompare(windows.cards, "count", 0, 2000);
            tryVerify(function() { return !shell.firstUse; }, 1000);
            compare(ended.count, 1);
            // The normal shell is back: dock, search pill, launcher.
            verify(shell.dockShown);
            verify(shell.searchPill.shown);
            shell.gestureUp();
            verify(shell.launcherOpen);
        }

        function test_noFirstUseAppNoFirstUse() {
            shell.firstUseAppId = "org.example.none";
            verify(!shell.startFirstUse());
            verify(!shell.firstUse);
            verify(shell.locked, "left alone");
            shell.firstUseAppId = "org.webosphoenix.memos";
        }

        function test_reduceMotionShortensTheAnimations() {
            compare(Theme.cardMaximizeDuration, 300);
            compare(Theme.launcherDuration, 350);
            status.applyAppStatus({ reduceMotion: true });
            verify(Theme.reduceMotion);
            compare(Theme.cardMaximizeDuration, 1);
            compare(Theme.launcherDuration, 1);
            compare(Theme.lockWindowFadeDuration, 1);
            status.applyAppStatus({ reduceMotion: false });
            compare(Theme.cardMaximizeDuration, 300);
        }
    }
}
