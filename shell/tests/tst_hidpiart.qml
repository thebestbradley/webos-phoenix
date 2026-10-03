// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Every picture of the shell's Open webOS art that the shell draws, at the
// density: the 1x file at 1.0, its @2x file at 2 and its @3x file at 3 (the
// keyboards' art at their own scale), and 9-patches and tiles drawn the
// 1x art's size times the density (docs/spec/hidpi-art.md). Walks the
// shell with its surfaces open: the lock screen, the launcher, the system
// menu and the keyboard.
// Needs Phoenix.Native: run with the build tree's modules.

import QtQuick
import QtTest
import Phoenix.Native
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
        density: 1
        virtualKeyboard: true
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    TextInput {
        id: field
        x: 10
        y: 40
        width: 200
        height: 20
    }

    TestCase {
        name: "HiDpiArt"
        when: windowShown

        readonly property string artDir: "/assets/openwebos/"

        function cleanup() {
            field.focus = false;
            shell.forceActiveFocus();
            shell.unlock();
            shell.density = 1;
        }

        // Every Image / BorderImage under `item` showing shell art.
        function artItems(item, out) {
            if (!item)
                return out;
            if (item.source !== undefined && item.status !== undefined && String(item.source).indexOf(artDir) >= 0)
                out.push(item);
            for (var i = 0; i < item.children.length; ++i)
                artItems(item.children[i], out);
            return out;
        }

        function insideKeyboard(item) {
            for (var p = item; p; p = p.parent)
                if (p === shell.keyboard)
                    return true;
            return false;
        }

        function fileName(url) {
            var s = String(url);
            return s.substring(s.lastIndexOf("/") + 1);
        }

        // The variant suffix ("", "@2x", "@3x") the art should be drawn
        // from at this scale: the smallest at least `scale`.
        function suffixFor(scale) {
            return scale <= 1 ? "" : scale <= 2 ? "@2x" : "@3x";
        }

        function checkArt(u, what) {
            var items = artItems(shell, []);
            verify(items.length > 0, what + ": some art");
            var n = 0;
            for (var i = 0; i < items.length; ++i) {
                var src = String(items[i].source);
                var name = fileName(src);
                // The keyboard draws its art at its own scale; the same art
                // elsewhere (the hardware keyboard's keyboard button) is at
                // the shell's.
                var keyboard = (src.indexOf("/keyboard-phone/") >= 0 || src.indexOf("/keyboard-tablet/") >= 0)
                    && insideKeyboard(items[i]);
                var want = suffixFor(keyboard ? shell.keyboard.pixelScale : u);
                var m = /(@[0-9.]+x)?\.png$/.exec(name);
                verify(m !== null, name);
                compare(m[1] || "", want, what + " at " + u + ": " + name);
                ++n;
            }
            return n;
        }

        // A 9-patch's or tile's image laid out smaller by the density and
        // scaled up by it: its corners are the art's times u.
        function checkScaled(u) {
            var arts = [];
            function walk(item) {
                if (!item)
                    return;
                if (item.artScale !== undefined && (item.border !== undefined || item.fillMode !== undefined))
                    arts.push(item);
                for (var i = 0; i < item.children.length; ++i)
                    walk(item.children[i]);
            }
            walk(shell);
            verify(arts.length > 0);
            for (var i = 0; i < arts.length; ++i) {
                var a = arts[i];
                var inner = a.children[0];
                fuzzyCompare(inner.scale, u / HiDpi.borderScale(a.source), 1e-6, "scale of " + fileName(a.source));
                fuzzyCompare(inner.width * inner.scale, a.width, 1e-3, "width of " + fileName(a.source));
                fuzzyCompare(inner.height * inner.scale, a.height, 1e-3, "height of " + fileName(a.source));
            }
        }

        function test_everyPictureAtTheDensity() {
            for (var u of [1, 2, 3]) {
                shell.density = u;
                compare(Theme.u, u);
                // The keyboard redraws once the event is over (_paint).
                wait(50);

                // The lock screen and its PIN pad.
                shell.lock();
                tryCompare(shell, "locked", true);
                var count = checkArt(u, "lock screen");
                shell.unlock();

                // The launcher, then the system menu.
                shell.gestureUp();
                tryCompare(shell, "launcherOpen", true);
                count += checkArt(u, "launcher");
                checkScaled(u);
                shell.gestureUp();
                tryCompare(shell, "launcherOpen", false);
                shell.openSystemMenu();
                wait(50);
                count += checkArt(u, "system menu");
                checkScaled(u);
                shell.homeKey();

                // The keyboard, with a key held for its preview.
                field.forceActiveFocus();
                tryCompare(shell, "keyboardOpen", true, 2000);
                tryVerify(function() { return shell.keyboard.keyRect("q") !== null; }, 1000);
                count += checkArt(u, "keyboard");
                field.focus = false;
                shell.forceActiveFocus();
                tryCompare(shell, "keyboardOpen", false, 2000);
                verify(count > 40, "pictures checked at " + u + ": " + count);
            }
        }

        function test_everyArtFileHasItsVariants() {
            // Each picture drawn above, and the rest of the shell's art the
            // QML names (tools/hidpi-art.py --check covers every file).
            var names = ["statusBar/battery-5.png", "statusBar/rssi-3.png", "statusBar/wifi-2.png",
                         "popup-bg.png", "menu-dropdown-bg.png", "card-shadow-tile.png", "scrim.png",
                         "launcher3/launcher-bg.png", "launcher3/quicklaunch-bg.png", "launcher3/tab-bg.png",
                         "pin/button-green.png", "pin/pin-grid.png", "loading-bg.png", "loading-glow.png",
                         "screen-lock-target-scrim.png", "wm-corner-top-left.png", "overlay-banner-bg.png",
                         "dashboard-mask-top.png", "keyboard-phone/key-white.png", "keyboard-phone/key-charcoal.png",
                         "keyboard-tablet/key-gray-short.png", "keyboard-tablet/popup-bg-2.png"];
            for (var i = 0; i < names.length; ++i) {
                compare(fileName(HiDpi.variant(Theme.assetUrl(names[i]), 2)), names[i].split("/").pop().replace(".png", "@2x.png"));
                compare(fileName(HiDpi.variant(Theme.assetUrl(names[i]), 3)), names[i].split("/").pop().replace(".png", "@3x.png"));
            }
        }
    }
}
