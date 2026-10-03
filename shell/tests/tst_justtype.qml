// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Just Type's app menu (GAPS O1): with the original page (com.palm.launcher,
// whose JustType.js has an AppMenu with Preferences and Help), the status
// bar's "Just Type" opens it, as SystemUiController::updateStatusBarTitle
// made the title actionable; the back gesture goes to the page, which
// closes the menu first and then Just Type. The page here is a stand-in
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
        function runScript(js, done) {
            scripts = scripts.concat([js]);
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
