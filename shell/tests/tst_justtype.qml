// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Just Type's app menu (GAPS O1): with the original page (com.palm.launcher,
// whose JustType.js has an AppMenu with Preferences and Help), the status
// bar's "Just Type" opens it, as SystemUiController::updateStatusBarTitle
// made the title actionable; the back gesture goes to the page, which
// closes the menu first and then Just Type. And typing in card view with
// a popup alert up: every key is Just Type's. The page here is a stand-in
// that runs the window source's scripts against an Enyo-like app menu.

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

    // The Just Type page: enyo.appMenu with isOpen, toggled by the runtime's
    // openAppMenu() and closed by close().
    Item {
        id: page
        property bool menuOpen: false
        property var scripts: []
        signal loaded
        // As a web view does, it takes the keys back when it loses them
        // while its page has a field focused.
        property bool pageHasFocus: false
        onActiveFocusChanged: if (!activeFocus && pageHasFocus) Qt.callLater(page.forceActiveFocus)
        // and takes every key it is given (typed: their text).
        property string typed: ""
        Keys.onPressed: (event) => { typed += event.text; event.accepted = true; }
        // JustType.start gives it the keyboard once it shows the first letter.
        function focusPage() { forceActiveFocus(); }
        // holdStart: Just Type's start (its first letter) waits for the
        // test to call startDone(), as a page still loading does.
        property bool holdStart: false
        property var _startDone: null
        function startDone() {
            var d = _startDone;
            _startDone = null;
            if (d)
                d();
        }
        function runScript(js, done) {
            scripts = scripts.concat([js]);
            if (holdStart && js.indexOf("jt.forceFocus()") >= 0) {
                _startDone = done || null;
                return;
            }
            var result;
            if (js.indexOf("openAppMenu") >= 0)
                menuOpen = !menuOpen;
            if (js.indexOf("m.isOpen") >= 0) {
                result = menuOpen;
                menuOpen = false;
            }
            if (done)
                Qt.callLater(done, result);
        }
    }

    TestCase {
        name: "JustTypeAppMenu"
        when: windowShown

        function initTestCase() {
            windows._justType = page;
            windows._justTypeLoaded = true;
        }

        function init() {
            shell.unlock();
            shell.cardView.maximizeProgress = 0;
        }

        // What a test left (a failed one too): Just Type closed, no alert.
        function cleanup() {
            page.holdStart = false;
            page._startDone = null;
            if (shell.justTypeOpen) {
                shell.gestureBack();
                tryVerify(function() { return !shell.justTypeOpen; }, 1000);
            }
            windows.closeAlert(windows.dismissCardTutorialKey);
            windows.dismissedFirstCard = true;
            shell.notifications.bannerActive = false;
            tryCompare(shell.notifications, "alertShown", false, 2000);
        }

        function test_titleOpensTheAppMenuAndBackClosesIt() {
            var bar = findChild(shell, "statusBar");
            verify(!bar.titleActionable);
            shell.startJustType("p");
            verify(shell.justTypeOpen);
            compare(bar.title, "Just Type");
            verify(bar.titleActionable, "the title opens Just Type's menu");
            mouseClick(shell, 30, Theme.statusBarHeight / 2);
            verify(page.menuOpen);
            // Back: the menu goes, Just Type stays.
            shell.gestureBack();
            tryVerify(function() { return !page.menuOpen; }, 1000);
            wait(50);
            verify(shell.justTypeOpen);
            // Again: Just Type goes.
            shell.gestureBack();
            tryVerify(function() { return !shell.justTypeOpen; }, 1000);
            verify(!bar.titleActionable);
        }

        // The page had the keys; once Just Type goes they come back to the
        // shell, so typing in card view starts it again.
        function test_typingAgainAfterBack() {
            shell.startJustType("c");
            page.forceActiveFocus();
            page.pageHasFocus = true;
            verify(page.activeFocus);
            shell.gestureBack();
            tryVerify(function() { return !shell.justTypeOpen; }, 1000);
            wait(50);
            verify(root.Window.activeFocusItem !== page, "the page does not keep the keys");
            page.pageHasFocus = false;
            keyClick(Qt.Key_M);
            verify(shell.justTypeOpen);
            shell.gestureBack();
            tryVerify(function() { return !shell.justTypeOpen; }, 1000);
        }

        // Typing in card view the first time: the "Dismissing Cards"
        // tutorial (a popup alert) is up, and its keys (Space, Enter, Tab,
        // the arrows) are not taken from Just Type. A space typed while the
        // shell holds the keys for the page, and one right after the page
        // took the first letter (and the keyboard), both reach the search;
        // the tutorial stays. ("how do" came out "howdo": the space pressed
        // the tutorial's OK.)
        function test_spaceWithATutorialUp() {
            windows.dismissedFirstCard = false;
            windows.firstCardAlert();
            tryCompare(shell.notifications, "alertShown", true, 2000);
            compare(shell.notifications.alertKey, "dismisscardtutorial");
            page.typed = "";
            page.scripts = [];
            page.holdStart = true;
            // The first time Just Type opens: its page never had the keyboard.
            page.focus = false;
            shell.forceActiveFocus();
            keyClick(Qt.Key_H);
            verify(shell.justTypeOpen);
            // The page has not shown "h" yet: the shell holds these.
            keyClick(Qt.Key_O);
            keyClick(Qt.Key_W);
            keyClick(Qt.Key_Space);
            verify(!page.activeFocus);
            // The start callback: the held keys go to the page, which takes
            // the keyboard; a space right after it is the page's.
            page.startDone();
            page.holdStart = false;
            verify(page.activeFocus);
            keyClick(Qt.Key_Space);
            keyClick(Qt.Key_D);
            verify(page.scripts[0].indexOf('var v="h";') >= 0, "Just Type starts with the first letter");
            compare(page.scripts.filter(function (js) { return js.indexOf('getValue()+"ow "') >= 0; }).length, 1,
                    "the held keys, the space too, follow it");
            compare(page.typed, " d", "the keys after the start reach the page");
            compare(windows.alerts.count, 1, "the tutorial is not dismissed by typing");
            verify(shell.notifications.alertShown);
            // Just Type closed, the alert has its keys again: Space presses OK.
            shell.gestureBack();
            tryVerify(function() { return !shell.justTypeOpen; }, 1000);
            keyClick(Qt.Key_Space);
            compare(windows.alerts.count, 0);
        }

        // Preferences launches an app from the page: Just Type closes.
        function test_launchFromTheMenuClosesJustType() {
            shell.startJustType("p");
            mouseClick(shell, 30, Theme.statusBarHeight / 2);
            verify(page.menuOpen);
            page.menuOpen = false;
            windows._hostMessage("com.palm.launcher", "", "launch", { id: "org.webosphoenix.settings", params: { page: "justtype" } });
            tryVerify(function() { return !shell.justTypeOpen; }, 1000);
        }
    }
}
