// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shell for a screen reader and Settings > Accessibility, on a phone
// (tst_accessibilitytablet: the tablet): in each main scene (the lock
// screen, card view, the launcher, the system menu, the dashboard and a
// banner, Just Type) every control on screen has a name and a role
// (a11y.js); what is spoken says the status (battery, signal, the time),
// a toggle's state, an app's name, "card n of m"; Text size, Bold text and
// High contrast reach the shell's text, and Reduce motion its animations.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim
import "a11y.js" as A11y

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys; fixedTime: new Date(2009, 5, 6, 9, 41) }
    }

    A11yScenes { id: scenes; test: tc; shell: shell; windows: windows; sys: sys; root: root }

    TestCase {
        id: tc
        name: "Accessibility"
        when: windowShown
        function init() { scenes.reset(); }
        function cleanup() { scenes.reset(); }

        function test_lockScreen() { scenes.lockScreen(); }
        function test_cardView() { scenes.cardView(); }
        function test_launcher() { scenes.launcher(); }
        function test_systemMenu() { scenes.systemMenu(); }
        function test_dashboard() { scenes.dashboard(); }
        function test_justType() { scenes.justType(); }
        function test_statusBarSpeaksItsValues() { scenes.statusBar(); }
        function test_textSize() { scenes.textSize(); }
        function test_boldText() { scenes.boldText(); }
        function test_highContrast() { scenes.highContrast(); }
        function test_reduceMotion() { scenes.reduceMotion(); }
    }
}
