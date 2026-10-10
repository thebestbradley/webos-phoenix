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
            // A ghost still in flight from a test that stopped early.
            tryCompare(shell.cardView, "ghostCount", 0, 2000);
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            while (windows.alerts.count > 0)
                windows.closeAlert(windows.alerts.get(0).key);
            windows.simulateTouchToShareDevice(false);
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

        // ---- Touch to Share ------------------------------------------------------

        function test_glowWhileAPhoneIsInRange() {
            var glow = findChild(shell, "touchToShareGlow");
            verify(glow);
            verify(!glow.active);
            // com.palm.systemmanager/touchToShareDeviceInRange {inRange: true}.
            windows._hostMessage("com.palm.systemui", "", "touchToShare", { op: "inRange", inRange: true });
            verify(glow.active);
            verify(glow.running);
            var rings = findChild(glow, "touchToShareGlowRings");
            verify(rings.visible);
            // Centred on the bottom edge's middle.
            var c = rings.mapToItem(shell, rings.width / 2, rings.height / 2);
            fuzzyCompare(c.x, shell.width / 2, 1);
            fuzzyCompare(c.y, shell.height, 1);
            // Grows to 4 times while fading, 1000 ms, again and again.
            wait(500);
            verify(rings.scale > 1.5 && rings.scale < 4, "scale " + rings.scale);
            verify(rings.opacity > 0 && rings.opacity < 1);
            windows._hostMessage("com.palm.systemui", "", "touchToShare", { op: "inRange", inRange: false });
            verify(!glow.active);
            verify(!rings.visible);
            // From the Home button's edge (TouchToShareGlow.cpp:39-64): the
            // TouchPad's, on the right of its screen (270).
            shell.homeButtonOrientationAngle = 270;
            windows._hostMessage("com.palm.systemui", "", "touchToShare", { op: "inRange", inRange: true });
            tryCompare(rings, "scale", 1, 1500);
            c = rings.mapToItem(shell, rings.width / 2, rings.height / 2);
            fuzzyCompare(c.x, shell.width, 1);
            fuzzyCompare(c.y, shell.height / 2, 1);
            compare(rings.rotation, 270);
            compare(rings.width, shell.height);
            shell.homeButtonOrientationAngle = 90;
            c = rings.mapToItem(shell, rings.width / 2, rings.height / 2);
            fuzzyCompare(c.x, 0, 1);
            shell.homeButtonOrientationAngle = 180;
            c = rings.mapToItem(shell, rings.width / 2, rings.height / 2);
            fuzzyCompare(c.x, shell.width / 2, 1);
            fuzzyCompare(c.y, 0, 1);
            windows._hostMessage("com.palm.systemui", "", "touchToShare", { op: "inRange", inRange: false });
            shell.homeButtonOrientationAngle = 0;
        }

        function test_tapSendsTheAppsDataAndThrowsItsCard() {
            var uid = maximized("org.webosphoenix.email");
            var i = windows.cardIndex(uid);
            var app = windows.appInfo("org.webosphoenix.email");
            verify(app);
            // An app that does not say tapToShareSupported is not asked.
            compare(windows.simulateTouchToShareTap(), "");
            verify(windows.touchToShareInRange);
            for (var k = 0; k < windows.apps.count; ++k)
                if (windows.apps.get(k).appId === "org.webosphoenix.email")
                    windows.apps.setProperty(k, "tapToShare", true);
            compare(windows.simulateTouchToShareTap(), "org.webosphoenix.email");
            compare(windows.windowFor(uid).relaunchParams.sendDataToShare, true);
            // The app answers with com.palm.stservice/shareData.
            var data = { target: "https://www.example.com/", type: "rawdata", mimetype: "text/html" };
            windows._hostMessage("org.webosphoenix.email", uid, "touchToShare", { op: "shareData", data: data });
            compare(windows.touchToShareReceived.appId, "org.webosphoenix.email");
            compare(windows.touchToShareReceived.data.target, "https://www.example.com/");
            // The tone (sounds/tap_to_share.mp3).
            compare(shell.sounds.last.file, "/usr/palm/sounds/tap_to_share.mp3");
            // To card view, then the ghost goes up and off at half opacity.
            tryCompare(shell.cardView, "maximized", false, 1000);
            compare(shell.cardView.ghostCount, 0, "not before the card is in card view");
            // Once it is there and its picture (taken as the transfer came;
            // grabToImage answers asynchronously, possibly after the card
            // has arrived) is ready.
            tryCompare(shell.cardView, "maximizeProgress", 0, 1000);
            tryCompare(shell.cardView, "ghostCount", 1, 2000);
            var ghost = findChild(shell.cardView, "ghostCard");
            verify(ghost);
            compare(ghost.opacity, 0.5);
            var card = shell.cardView.cardItem(uid);
            var startY = ghost.y;
            wait(150);
            verify(ghost.y < startY, "moving up");
            verify(ghost.scale > card.cardScale && ghost.scale < 0.85);
            tryCompare(shell.cardView, "ghostCount", 0, 2000);
            // The card itself stays.
            verify(windows.cardIndex(uid) >= 0);
        }

        function test_transferredForAnotherAppDoesNothing() {
            var uid = maximized("org.webosphoenix.email");
            windows._hostMessage("com.palm.systemui", "", "touchToShare", { op: "transferred", appId: "com.palm.app.browser" });
            wait(50);
            verify(shell.cardView.maximized);
            compare(shell.cardView.ghostCount, 0);
            // touchToShareAppUrlTransferred for the app in front: thrown.
            windows._hostMessage("com.palm.systemui", "", "touchToShare", { op: "transferred", appId: "org.webosphoenix.email" });
            tryCompare(shell.cardView, "maximized", false, 1000);
            tryCompare(shell.cardView, "ghostCount", 1, 2000);
            tryCompare(shell.cardView, "ghostCount", 0, 2000);
        }
    }
}
