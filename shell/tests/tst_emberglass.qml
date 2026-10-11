// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phoenix 2.0's look, Ember Glass, beside 1.0's (docs/SYSTEM-UI-2.md):
// the switch (the system preference "look", the simulator's --look, 1.0's
// look by default), the tokens it is drawn with (EmberGlass, generated from
// Ember Glass UI's), and the gesture light.
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
            verify(findChild(shell, "lightBar").visible);
            verify(!findChild(shell, "emberGestureLight").visible);
            verify(!findChild(shell, "gestureScrim").visible);
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
        // (size.statusbar, size.gesture-strip), the wallpaper under the
        // strip's scrim; the phoenix the default wallpaper.
        function test_frame() {
            var bar = findChild(shell, "gestureBar");
            var wall = findChild(shell, "wallpaper");
            compare(wall.mapToItem(shell, 0, wall.height).y, shell.height - bar.height);
            shell.look = "ember-glass";
            compare(Theme.statusBarHeight, Theme.px(32));
            compare(Theme.gestureAreaHeight, Theme.px(22));
            compare(bar.height, Theme.px(22));
            verify(findChild(shell, "gestureScrim").visible);
            compare(wall.mapToItem(shell, 0, wall.height).y, shell.height);
            compare(Theme.defaultWallpaperPath, "/usr/palm/applications/org.webosphoenix.settings/wallpapers/phoenix.jpg");
            verify(!findChild(shell, "screenCorners").visible);
        }

        // The gesture light: 118 x 4, the token's gradient (transparent at
        // both ends, gold-white at the centre), the glow following it; lit
        // while an app is maximized, dim in card view, as 1.0's bar.
        function test_gestureLight() {
            shell.look = "ember-glass";
            var g = findChild(shell, "gestureBar");
            var light = findChild(shell, "emberGestureLight");
            verify(light.visible);
            verify(!findChild(shell, "lightBar").visible);
            compare(light.width, Theme.px(118));
            compare(light.height, Theme.px(4));
            compare(light.x, Math.round((g.width - light.width) / 2));
            var grad = findChild(shell, "emberGestureGradient").gradient;
            compare(grad.orientation, Gradient.Horizontal);
            compare(grad.stops.length, EmberGlass.gestureLightGradient.stops.length);
            compare(grad.stops[0].color.a, 0);
            compare(grad.stops[grad.stops.length - 1].color.a, 0);
            var centre = null;
            for (var i = 0; i < grad.stops.length; ++i)
                if (grad.stops[i].position === 0.5)
                    centre = grad.stops[i].color;
            verify(Qt.colorEqual(centre, "#fff3dc"));
            verify(!g.lit);
            tryCompare(light, "opacity", 0.25, 2000);
            var uid = windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize(uid);
            tryVerify(function() { return shell.maximized; }, 2000);
            verify(g.lit);
            tryCompare(light, "opacity", 1, 2000);
        }

        // Each gesture's light runs along it; a finger resting on the area
        // makes it breathe (motion.breathe), and it stops when it lifts.
        function test_gestureLightRunsAndBreathes() {
            shell.look = "ember-glass";
            var g = findChild(shell, "gestureBar");
            var m = findChild(shell, "gestureMouse");
            var light = findChild(shell, "emberGestureLight");
            var sweep = findChild(shell, "emberLightSweep");
            mouseDrag(m, m.width * 0.6, m.height / 2, -m.width * 0.2, 0);
            compare(g.lastLight, "left");
            tryCompare(sweep, "opacity", 1, 500);
            tryCompare(sweep, "opacity", 0, 2000);
            compare(light.breath, 1);
            mousePress(m, m.width / 2, m.height / 2);
            tryVerify(function() { return light.breath < 0.8; }, 2000);
            mouseRelease(m, m.width / 2, m.height / 2);
            tryCompare(light, "breath", 1, 2000);
        }
    }
}
