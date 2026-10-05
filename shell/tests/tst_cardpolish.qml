// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Card view polish (GAPS C11): an app's scene transition (CardTransition),
// the "Dismissing Cards" tutorial (firstCardAlert) and Touch to Share's glow
// and ghost card.
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
    }

    SignalSpy {
        id: preparedSpy
        target: windows
        signalName: "sceneTransitionRequested"
    }

    TestCase {
        name: "CardPolish"
        when: windowShown

        function init() {
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            while (windows.alerts.count > 0)
                windows.closeAlert(windows.alerts.get(0).key);
            windows.dismissedFirstCard = true;
            shell.cardView.position = 0;
            shell.cardView.maximizeProgress = 0;
            shell.unlock();
        }

        // A maximized card for appId.
        function maximized(appId) {
            var uid = shell.launch(appId);
            verify(uid !== "");
            tryCompare(shell.cardView, "maximized", true, 3000);
            compare(shell.cardView.currentUid, uid);
            return uid;
        }

        // ---- Scene transitions --------------------------------------------------

        function test_sceneTransitionPushZoomsTheNewSceneIn() {
            var uid = maximized("org.webosphoenix.email");
            var card = shell.cardView.cardItem(uid);
            var win = windows.windowFor(uid);
            // The page asks; the card snapshots, then tells the page.
            windows.lastSceneTransitionPrepared = "";
            windows._hostMessage("org.webosphoenix.email", uid, "sceneTransition", { op: "prepare", isPop: false });
            compare(windows.lastSceneTransitionPrepared, "", "not before the snapshot");
            tryCompare(windows, "lastSceneTransitionPrepared", uid, 2000, "the page is told once the snapshot is taken");
            compare(card.sceneTransitionState, "prepared");
            var snap = findChild(card, "sceneSnapshot");
            verify(snap.visible);
            // The page changes its scene, then runs the transition.
            win.detail = "Inbox";
            windows._hostMessage("org.webosphoenix.email", uid, "sceneTransition", { op: "run", transition: "zoom-fade", isPop: false });
            compare(card.sceneTransitionState, "running");
            // Push: the new scene zooms in from 0.75 and fades in, over the
            // snapshot (CardTransition.cpp).
            verify(win.scale >= 0.75 && win.scale < 1);
            verify(win.opacity < 1);
            verify(snap.z < win.z);
            wait(120);
            verify(win.scale > 0.75 && win.scale < 1, "half way " + win.scale);
            verify(snap.opacity > 0 && snap.opacity < 1);
            tryCompare(card, "sceneTransitionState", "", 1000);
            compare(win.scale, 1);
            compare(win.opacity, 1);
            verify(!snap.visible);
        }

        function test_sceneTransitionPopZoomsDownUnderTheSnapshot() {
            var uid = maximized("org.webosphoenix.email");
            var card = shell.cardView.cardItem(uid);
            var win = windows.windowFor(uid);
            card.prepareSceneTransition(true, null);
            tryCompare(card, "sceneTransitionState", "prepared", 2000);
            card.runSceneTransition("zoom-fade", true);
            var snap = findChild(card, "sceneSnapshot");
            // Pop: the live scene from 1.25 down to 1, under the snapshot.
            verify(win.scale > 1 && win.scale <= 1.25);
            verify(snap.z > win.z);
            tryCompare(card, "sceneTransitionState", "", 1000);
            compare(win.scale, 1);
        }

        function test_crossFadeAndCancel() {
            var uid = maximized("org.webosphoenix.email");
            var card = shell.cardView.cardItem(uid);
            var win = windows.windowFor(uid);
            card.prepareSceneTransition(false, null);
            tryCompare(card, "sceneTransitionState", "prepared", 2000);
            card.runSceneTransition("cross-fade", false);
            // Cross-fade: the live scene is unscaled, the snapshot fades over it.
            compare(win.scale, 1);
            compare(win.opacity, 1);
            tryCompare(card, "sceneTransitionState", "", 1000);
            // Cancelled after prepare: the live window is back.
            card.prepareSceneTransition(false, null);
            tryCompare(card, "sceneTransitionState", "prepared", 2000);
            windows._hostMessage("org.webosphoenix.email", uid, "sceneTransition", { op: "cancel" });
            compare(card.sceneTransitionState, "");
            // An unknown type draws nothing (CardTransition's constructor).
            card.prepareSceneTransition(false, null);
            tryCompare(card, "sceneTransitionState", "prepared", 2000);
            card.runSceneTransition("flip", false);
            compare(card.sceneTransitionState, "");
            // Run without prepare: nothing.
            card.runSceneTransition("zoom-fade", false);
            compare(card.sceneTransitionState, "");
        }

        // ---- The "Dismissing Cards" tutorial -------------------------------------

        function test_dismissCardTutorialTheFirstTimeInCardView() {
            windows.dismissedFirstCard = false;
            var shown = 0;
            var onShown = function () { shown++; };
            windows.firstCardAlertShown.connect(onShown);
            maximized("org.webosphoenix.email");
            compare(windows.alerts.count, 0, "not while the card is maximized");
            shell.cardView.minimize();
            compare(windows.alerts.count, 1);
            compare(windows.alerts.get(0).key, "dismisscardtutorial");
            compare(windows.alerts.get(0).height, 170);
            compare(shown, 1);
            verify(windows.dismissedFirstCard);
            var alert = findChild(shell, "dismissCardTutorial");
            verify(alert);
            tryCompare(alert, "visible", true);
            compare(findChild(alert, "dismissCardTutorialTitle").text, "Dismissing Cards");
            compare(findChild(alert, "dismissCardTutorialMessage").text,
                    "You can close an application by using your finger to flick it up and off screen while in Card View.");
            tryCompare(shell.notifications, "negativeSpace", shell.notifications.alertHeight, 2000);
            mouseClick(findChild(alert, "dismissCardTutorialOk"));
            compare(windows.alerts.count, 0);
            // Never again.
            shell.cardView.maximize();
            tryCompare(shell.cardView, "maximized", true, 2000);
            shell.cardView.minimize();
            compare(windows.alerts.count, 0);
            compare(shown, 1);
            windows.firstCardAlertShown.disconnect(onShown);
        }

        function test_noTutorialWithoutACard() {
            windows.dismissedFirstCard = false;
            shell.cardView.minimize();
            compare(windows.alerts.count, 0);
            verify(!windows.dismissedFirstCard);
        }

    }
}
