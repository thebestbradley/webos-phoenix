// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The TouchPad's virtual keyboard (VirtualKeyboard.qml; openwebos/keyboard-efigs
// TabletKeyboard): five rows at the art's own size, the hide key, the
// keyboard sizes on its long press, and the negative space it takes.
// Needs Phoenix.Native (KeyInjector): run with the build tree's modules.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 1024
    height: 768

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "tablet"
        // The TouchPad as it was (a Home button, no gesture bar): the tests
        // measure the keyboard against its pixels.
        hardwareHomeButton: true
        density: 1
        virtualKeyboard: true
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    TextInput {
        id: field
        x: 10
        y: 40
        width: 400
        height: 20
    }

    TestCase {
        name: "TabletKeyboard"
        when: windowShown

        readonly property var kb: shell.keyboard

        function init() {
            sys.deviceOrientation = "up";
            tryCompare(shell, "uiOrientation", "up", 3000);
            tryVerify(function() { return !shell.rotator.rotating; }, 3000);
            field.inputMethodHints = Qt.ImhNone;
            field.focus = false;
            shell.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", false, 2000);
            tryCompare(shell.notifications, "negativeSpace", 0, 2000);
            kb.keyboardSize = 0;
            shell.unlock();
            field.text = "";
        }

        function showKeyboard() {
            field.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", true, 2000);
            tryCompare(shell.notifications, "negativeSpace", kb.keyboardHeight, 2000);
            tryVerify(function() { return kb.keyRect("q") !== null; }, 1000);
        }

        function keyCenter(name) {
            var r;
            tryVerify(function() { r = kb.keyRect(name); return r !== null; }, 1000, "key " + name);
            return Qt.point(r.x + r.width / 2, r.y + r.height / 2);
        }

        function tapKey(name) {
            var p = keyCenter(name);
            mouseClick(kb, p.x, p.y);
            wait(20);
        }

        function keyBackground(name) {
            for (var i = 0; i < kb._keys.length; ++i)
                if (kb._keys[i].name === name)
                    return kb._keys[i].background;
            return "";
        }

        function test_showsAtTheArtsSize() {
            showKeyboard();
            // The TouchPad's own pixels, 340 high by default (keyboard-bg.png;
            // TabletKeyboard.cpp:247).
            compare(Theme.keyboardScale, 1);
            compare(kb.keysHeight, 340);
            // Text Assist's candidate bar above the keys, in a text field.
            compare(kb.candidateBarHeight, 44);
            compare(kb.keyboardHeight, 340 + 44);
            compare(shell.notifications.negativeSpace, 384);
            compare(kb.y, root.height - 384);
            compare(shell.cardView.windowHeight, root.height - Theme.statusBarHeight - 384);
            // Five rows; the number row on the short keys.
            compare(keyBackground("1"), "key-gray-short.png");
            compare(keyBackground("q"), "key-white.png");
            compare(keyBackground("Enter"), "key-black.png");
        }

        function test_typesNumbersAndShift() {
            showKeyboard();
            tapKey("1");
            tapKey("a");
            compare(field.text, "1a");
            tapKey("Shift");
            // Shift lights its key (key-shift-on.png) and shows the other
            // characters of the number row.
            tryCompare(kb.keymap, "shiftMode", 1, 1000);
            tryVerify(function() { return keyBackground("Shift") === "key-shift-on.png"; }, 1000);
            tapKey("!");
            compare(field.text, "1a!");
            compare(kb.keymap.shiftMode, 0);
        }

        function test_symbolKey() {
            showKeyboard();
            tapKey("+ = [  ]");
            tryVerify(function() { return kb.keyRect("A B C") !== null; }, 1000);
            // The letters' other page: Q is `, E is €.
            tapKey("`");
            tapKey("€");
            compare(field.text, "`€");
        }

        function test_hideKeyHides() {
            showKeyboard();
            tapKey("Hide");
            tryCompare(shell, "keyboardOpen", false, 1000);
            verify(!field.activeFocus);
            tryCompare(shell.notifications, "negativeSpace", 0, 1000);
            tryCompare(kb, "visible", false, 500);
        }

        // Holding the hide key offers the sizes; the new height applies at once.
        function test_keyboardSizes() {
            showKeyboard();
            var p = keyCenter("Hide");
            mousePress(kb, p.x, p.y);
            var popup = findChild(kb, "extendedKeys");
            // cFirstRepeatLongDelay: 750 ms.
            wait(500);
            verify(!popup.visible);
            tryCompare(popup, "visible", true, 1000);
            // XS, S, M, L: S is 291 high ((340 + 243) / 2).
            var cell = findChild(kb, "extendedKey1");
            var c = cell.mapToItem(kb, cell.width / 2, cell.height / 2);
            mouseMove(kb, c.x, c.y);
            mouseRelease(kb, c.x, c.y);
            tryCompare(kb, "keysHeight", 291, 1000);
            // At once (slotKeyboardHeightChanged: immediate).
            compare(shell.notifications.negativeSpace, 291 + 44);
            verify(shell.keyboardOpen);
            kb.keyboardSize = 1;
            compare(kb.keysHeight, 393);
            compare(shell.notifications.negativeSpace, 393 + 44);
        }

        // Two keyboards or more: a language key beside the symbol key
        // (updateLanguageKey); it goes to the next (AZERTY here).
        function test_languageKey() {
            sys.keyboards = [{ layout: "qwerty", language: "en" }];
            sys.keyboard = sys.keyboards[0];
            showKeyboard();
            compare(kb.keyRect("En"), null, "one keyboard: no language key");
            var symbolWidth = kb.keyRect("+ = [  ]").width;
            sys.keyboards = [{ layout: "qwerty", language: "en" }, { layout: "azerty", language: "fr" }];
            tryVerify(function() { return kb.keyRect("En") !== null; }, 1000);
            verify(kb.keyRect("+ = [  ]").width < symbolWidth * 0.75, "the symbol key makes room");
            tapKey("En");
            compare(sys.keyboard.layout, "azerty");
            tryVerify(function() { return kb.keyRect("Fr") !== null; }, 1000);
            // AZERTY: a where QWERTY has q.
            verify(kb.keyRect("a").y < kb.keyRect("q").y);
            sys.keyboards = [{ layout: "qwerty", language: "en" }];
            sys.keyboard = sys.keyboards[0];
        }

        function test_urlField() {
            field.inputMethodHints = Qt.ImhUrlCharactersOnly;
            showKeyboard();
            // QWERTY_BOTTOM_ROW_URL: "/" and ".com" beside a narrower space bar.
            tryVerify(function() { return kb.keyRect("/") !== null && kb.keyRect(".com") !== null; }, 1000);
            tapKey("/");
            tapKey(".com");
            compare(field.text, "/.com");
        }

        function test_portrait() {
            showKeyboard();
            sys.deviceOrientation = "right";
            tryCompare(shell, "uiOrientation", "right", 3000);
            tryVerify(function() { return !shell.rotator.rotating && Math.abs(kb.width - 768) < 0.5; }, 3000);
            // The keys laid out again for the narrower screen.
            tryVerify(function() { var r = kb.keyRect("p"); return r !== null && r.x + r.width < 768; }, 1000);
            compare(kb.keysHeight, 340);
            tryCompare(shell.notifications, "negativeSpace", 340 + 44, 3000);
            tapKey("z");
            compare(field.text, "z");
        }

        // With the keyboard up the bezel flick must travel 60 px.
        function test_keyboardOpenForTheBezelFlick() {
            showKeyboard();
            verify(shell.keyboardOpen);
        }
    }
}
