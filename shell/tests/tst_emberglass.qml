// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phoenix 2.0's look, Ember Glass, beside 1.0's (docs/SYSTEM-UI-2.md):
// the switch (the system preference "look", the simulator's --look, 1.0's
// look by default), the tokens it is drawn with (EmberGlass, generated from
// Ember Glass UI's), the gesture light, the cards, and the shell's side of
// Ember Glass's shell contract: the wallpaper blurred once (WallpaperBlur)
// and what each card's window gets (Card.glass).
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
        wallpaper: Qt.resolvedUrl("../../apps/settings/public/wallpapers/phoenix.jpg")
    }

    // A wallpaper black on its left half and white on its right, blurred
    // on its own (the Gaussian's profile across the edge).
    Item {
        id: halves
        width: 446
        height: 994
        visible: false
        Rectangle { width: parent.width / 2; height: parent.height; color: "black" }
        Rectangle { x: parent.width / 2; width: parent.width / 2; height: parent.height; color: "white" }
    }
    WallpaperBlur {
        id: edgeBlur
        wallpaper: halves
        scale: 1
        active: false
        toneMap: ({ saturate: 1, contrast: 0.42, brightness: 2.2 })
    }
    // (Shown only while grabImage reads them.)
    Image { id: edgeRaw; z: 10000; visible: false; source: edgeBlur.url }
    Image { id: edgeToned; z: 10000; visible: false; source: edgeBlur.tonedUrl }

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

        // The wallpaper blurred as CSS's blur(40px) blurs it, at a quarter
        // of the screen's CSS pixels (deviation 10 there): across a black
        // and white edge the profile is the Gaussian's (within the three
        // boxes' approximation, as Chromium's), and towards the screen's
        // edges the mock-up's #140604 padding darkens it.
        function test_wallpaperBlurIsCssBlur() {
            halves.visible = true;
            edgeBlur.active = true;
            edgeBlur.make();
            tryVerify(function() { return edgeBlur.url !== ""; }, 10000);
            compare(edgeBlur.pictureSize, Qt.size(112, 249));
            compare(edgeBlur.screenSize, Qt.size(446, 994));
            verify(edgeBlur.url.indexOf("data:image/png;base64,") === 0);
            tryCompare(edgeRaw, "status", Image.Ready, 5000);
            tryCompare(edgeToned, "status", Image.Ready, 5000);
            edgeRaw.visible = true;
            var img = grabImage(edgeRaw);
            edgeRaw.visible = false;
            var worst = 0;
            for (var x = 30; x < 82; ++x) {
                var want = 255 * 0.5 * (1 + erf((x + 0.5 - 56) / (10 * Math.SQRT2)));
                worst = Math.max(worst, Math.abs(img.red(x, 124) - want));
            }
            verify(worst <= 4, "the blur's profile is the Gaussian's (worst " + worst + " levels)");
            // The white side's top edge: towards #140604 and a little transparent.
            verify(img.red(100, 0) < img.red(100, 30) - 60, "darker at the screen's edge: " + img.red(100, 0) + " < " + img.red(100, 30));
            // Toned (contrast .42, brightness 2.2): the black side lifted.
            edgeToned.visible = true;
            var toned = grabImage(edgeToned);
            edgeToned.visible = false;
            verify(toned.red(10, 124) > 100, "the tone map lifts the dark side: " + toned.red(10, 124));
            halves.visible = false;
            edgeBlur.active = false;
        }
        function erf(x) {
            // Abramowitz and Stegun 7.1.26.
            var s = x < 0 ? -1 : 1;
            x = Math.abs(x);
            var t = 1 / (1 + 0.3275911 * x);
            var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
            return s * y;
        }

        // The shell blurs its wallpaper in Ember Glass only; the card view
        // has it for every card.
        function test_shellBlursItsWallpaper() {
            var blur = shell.wallpaperBlur;
            // (Cleared a moment after the test before went back to 1.0.)
            tryCompare(blur, "url", "", 2000);
            shell.look = "ember-glass";
            tryVerify(function() { return blur.url !== "" && blur.screenSize.height === 994; }, 10000);
            compare(blur.screenSize, Qt.size(446, 994));
            verify(blur.tonedUrl !== "" && blur.tonedUrl !== blur.url);
            compare(shell.cardView.glassWallpaper, blur.url);
            compare(shell.cardView.glassScreen, Qt.size(446, 994));
            shell.look = "classic";
            tryCompare(blur, "url", "", 2000);
        }

        // What a card's window gets (Card.glass, in CSS px): the blurred
        // wallpaper, where the window lies when the card is maximized (under
        // the 32 px status bar, above the 22 px strip), the whole screen,
        // the card's corners and live blur; the same in the card view (the
        // blur is the card's and moves with it); nothing in 1.0's look.
        function test_cardGlass() {
            var uid = windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize(uid);
            tryVerify(function() { return shell.maximized; }, 2000);
            var card = shell.cardView.cardItem(uid);
            compare(card.glass, null);
            shell.look = "ember-glass";
            tryVerify(function() { return shell.wallpaperBlur.url !== ""; }, 10000);
            var g = card.glass;
            compare(g.wallpaperBlurred, shell.wallpaperBlur.url);
            compare(g.window.x, 0);
            compare(g.window.y, 32);
            compare(g.window.width, 446);
            compare(g.window.height, 940);
            compare(g.screen.width, 446);
            compare(g.screen.height, 994);
            compare(g.windowRadius, 30);
            // Live, unless there is no GPU (the offscreen platform's tests).
            compare(g.blur, GraphicsInfo.api === GraphicsInfo.Software ? "none" : "live");
            verify(card._rounded, "a maximized card keeps its corners");
            shell.gestureUp();
            tryVerify(function() { return !shell.maximized && shell.cardView.maximizeProgress === 0; }, 3000);
            compare(card.glass.window.y, 32);
            verify(card.cardScale < 1);
            verify(findChild(card, "emberCardRim").visible, "in the card view, the hairline round the card");
            sys.tweaks = { glassBlur: "none" };
            compare(card.glass.blur, "none");
            shell.look = "classic";
            compare(card.glass, null);
            verify(!findChild(card, "emberCardRim").visible);
        }

        // The loading card is the shell's own glass: the toned blur where
        // the window lies, under the tint.
        function test_loadingCardGlass() {
            shell.look = "ember-glass";
            tryVerify(function() { return shell.wallpaperBlur.tonedUrl !== ""; }, 10000);
            var uid = windows.launch("org.webosphoenix.email", "");
            var card = shell.cardView.cardItem(uid);
            var glass = findChild(card, "emberLoadingGlass");
            verify(glass !== null);
            var picture = findChild(card, "emberLoadingWallpaper");
            compare(String(picture.source), shell.wallpaperBlur.tonedUrl);
            compare(picture.y, -32);
            compare(picture.height, 994);
        }
    }
}
