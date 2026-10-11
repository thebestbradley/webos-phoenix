// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phoenix 2.0's look, Ember Glass, beside 1.0's (docs/SYSTEM-UI-2.md):
// the switch (the system preference "look", the simulator's --look, 1.0's
// look by default) and the tokens it is drawn with (EmberGlass, generated
// from Ember Glass UI's).
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 446
    height: 994

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        density: 1
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    TestCase {
        name: "EmberGlass"
        when: windowShown

        function init() {
            shell.unlock();
        }
        function cleanup() {
            shell.look = "";
            sys.tweaks = {};
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.cardView.maximizeProgress = 0;
        }

        // The tokens, as Ember Glass UI's tokens/ember-glass.tokens.json
        // gives them (SPEC.md's numbers).
        function test_tokens() {
            compare(EmberGlass.gestureLightWidth, 118);
            compare(EmberGlass.gestureLightHeight, 4);
            compare(EmberGlass.glassL1Blur, 40);
            compare(EmberGlass.sizeStatusbar, 32);
            compare(EmberGlass.sizeGestureStrip, 22);
            compare(EmberGlass.radiusCard, 30);
            compare(EmberGlass.motionBreathe, 1600);
            fuzzyCompare(EmberGlass.light.glassL1Tint.a, 0.78, 0.004);
            fuzzyCompare(EmberGlass.dark.glassL1Tint.a, 0.68, 0.004);
            verify(Qt.colorEqual(EmberGlass.dark.colorInk3, "#9a98a0"));
            verify(Qt.colorEqual(EmberGlass.light.colorInk3, "#605e65"));
            compare(EmberGlass.light.glassL1Contrast, 0.42);
            compare(EmberGlass.light.glassL1Brightness, 2.2);
            var stops = EmberGlass.gestureLightGradient.stops;
            compare(stops[0].position, 0);
            compare(stops[stops.length - 1].position, 1);
            verify(EmberGlass.tokensSource.indexOf("ember-glass-ui") >= 0);
        }

        // 1.0's look unless something chooses Ember Glass.
        function test_classicByDefault() {
            compare(shell.effectiveLook, "classic");
            compare(Theme.look, "classic");
            verify(!Theme.emberGlass);
            compare(Theme.statusBarHeight, Theme.px(28));
            compare(Theme.gestureAreaHeight, Theme.px(20));
            compare(Theme.defaultWallpaperPath, "/usr/palm/applications/org.webosphoenix.settings/wallpapers/northern-lights.jpg");
        }

        // The system preference (Settings > Advanced; the runtime's tweaks).
        function test_lookFromThePreference() {
            sys.tweaks = { look: "ember-glass" };
            compare(Theme.look, "ember-glass");
            verify(Theme.emberGlass);
            sys.tweaks = { look: "classic" };
            compare(Theme.look, "classic");
            sys.tweaks = { look: "something else" };
            compare(Theme.look, "classic");
        }

        // This run's (phoenix-sim's --look) wins over the preference; a name
        // that is no look leaves it to the preference.
        function test_lookForThisRun() {
            sys.tweaks = { look: "classic" };
            shell.look = "ember-glass";
            compare(Theme.look, "ember-glass");
            ignoreWarning("phoenix: no look named \"aurora\" (classic, ember-glass)");
            shell.look = "aurora";
            compare(Theme.look, "classic");
            sys.tweaks = { look: "ember-glass" };
            compare(Theme.look, "ember-glass");
        }

        // Ember Glass's frame: a 32 px status bar and a 22 px gesture strip
        // (size.statusbar, size.gesture-strip); the phoenix the default
        // wallpaper.
        function test_frame() {
            shell.look = "ember-glass";
            compare(Theme.statusBarHeight, Theme.px(32));
            compare(Theme.gestureAreaHeight, Theme.px(22));
            compare(findChild(shell, "gestureBar").height, Theme.px(22));
            compare(Theme.defaultWallpaperPath, "/usr/palm/applications/org.webosphoenix.settings/wallpapers/phoenix.jpg");
        }
    }
}
