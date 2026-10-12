// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The TouchPad's virtual keyboard (VirtualKeyboard.qml; openwebos/keyboard-efigs
// TabletKeyboard): five rows at the art's own size, the hide key, the
// keyboard sizes on its long press (kept by the system, as Settings > Text
// Assist > Keyboard size), and the negative space it takes; in the phone's
// black look too (Keyboard style); without its number row (Settings > Text
// Assist > Number row off; the owner, 12 October 2026).
// Needs Phoenix.Native (KeyInjector): run with the build tree's modules.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim
import "../qml/Phoenix/Shell/KeyboardKeymap.js" as KM

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

    // A tablet keyboard of its own, made with the sizes the system kept
    // (the shell starting again).
    Component {
        id: freshKeyboard
        VirtualKeyboard { tablet: true; availableWidth: 1024; availableHeight: 768 }
    }
    SignalSpy { id: sizeSelected; target: shell.keyboard; signalName: "keyboardSizeSelected" }

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
            sys.keyboardSize = 0;
            sys.tweaks = {};
            sizeSelected.clear();
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

        // Holds the hide key and picks the size in cell `index` (XS, S, M, L).
        function pickSize(index) {
            var p = keyCenter("Hide");
            mousePress(kb, p.x, p.y);
            var popup = findChild(kb, "extendedKeys");
            // cFirstRepeatLongDelay: 750 ms.
            wait(500);
            verify(!popup.visible);
            tryCompare(popup, "visible", true, 1000);
            var cell = findChild(kb, "extendedKey" + index);
            var c = cell.mapToItem(kb, cell.width / 2, cell.height / 2);
            mouseMove(kb, c.x, c.y);
            mouseRelease(kb, c.x, c.y);
            tryCompare(popup, "visible", false, 1000);
        }

        // Holding the hide key offers the sizes; the new height applies at
        // once. The system keeps the size (selectKeyboardSize ->
        // VirtualKeyboardPreferences, VirtualKeyboardPreferences.cpp:178-187),
        // and a size it is given (Settings > Text Assist > Keyboard size)
        // resizes the open keyboard.
        function test_keyboardSizes() {
            showKeyboard();
            // XS, S, M, L: S is 291 high ((340 + 243) / 2).
            pickSize(1);
            compare(sizeSelected.count, 1);
            compare(sizeSelected.signalArguments[0][0], -1);
            compare(sys.keyboardSize, -1, "the system is told (x_palm_virtualkeyboard_settings)");
            tryCompare(kb, "keysHeight", 291, 1000);
            // At once (slotKeyboardHeightChanged: immediate).
            compare(shell.notifications.negativeSpace, 291 + 44);
            verify(shell.keyboardOpen);
            // Settings > Text Assist > Keyboard size, while it is up.
            sys.keyboardSize = 1;
            compare(kb.keyboardSize, 1);
            compare(kb.keysHeight, 393);
            compare(shell.notifications.negativeSpace, 393 + 44);
            // The one in use is blue in the long press (TabletKeyboard.cpp:1387).
            tryVerify(function() { return !kb._paintQueued; }, 1000, "the keys laid out again");
            var p = keyCenter("Hide");
            mousePress(kb, p.x, p.y);
            tryVerify(function() { return kb._extendedKeys !== null && kb._popup !== null; }, 2000);
            var cells = kb._popup.cells;
            compare(cells.length, 4);
            compare(cells.map(function(c) { return c.bold; }).join(), "false,false,false,true");
            mouseRelease(kb, p.x, p.y);
            tryCompare(findChild(kb, "extendedKeys"), "visible", false, 1000);
            sys.keyboardSize = 0;
            tryCompare(kb, "keysHeight", 340, 1000);
        }

        // The size the system kept is the keyboard's from the start (the
        // shell starting again: VirtualKeyboardPreferences::applyInitSettings
        // asked for it, VirtualKeyboardPreferences.cpp:63).
        function test_keyboardSizeAtStart() {
            var k = createTemporaryObject(freshKeyboard, root, { keyboardSize: -2 });
            verify(k);
            compare(k.keysHeight, 243);
            compare(k.keymap.rect.height + k._topPadding, 243);
            // The system's status says it before the keyboard is up.
            sys.applyAppStatus({ keyboardSize: 1 });
            compare(sys.keyboardSize, 1);
            compare(kb.keysHeight, 393);
            showKeyboard();
            compare(kb.keysHeight, 393);
            compare(shell.notifications.negativeSpace, 393 + 44);
        }

        // Settings > Text Assist > Number row off (the owner, 12 October
        // 2026): the tablet loses its number row, the keyboard is shorter
        // by it and the letter rows keep their size; on again, back.
        function test_numberRowOff() {
            showKeyboard();
            compare(kb.numberRowShown, true, "unset: the tablet's own");
            compare(kb.keymap.rows, 5);
            var q = kb.keyRect("q"), a = kb.keyRect("a"), one = kb.keyRect("1"), height = kb.keysHeight;
            verify(one !== null && one.y < q.y);
            // The number row's height: 55 of the art's 340 at the default size.
            var rowHeight = q.y - one.y;
            compare(rowHeight, 55);
            sys.tweaks = { numberRow: false };
            tryVerify(function() { return kb.keyRect("1") === null; }, 1000, "no number row");
            compare(kb.numberRowShown, false);
            compare(kb.keymap.rows, 4);
            compare(kb.keysHeight, height - rowHeight, "shorter by the number row");
            compare(kb.keysHeight, 285);
            tryCompare(shell.notifications, "negativeSpace", 285 + 44, 1000);
            var q2 = kb.keyRect("q");
            compare(q2.height, q.height, "the letter keys keep their size");
            compare(kb.keyRect("a").height, a.height);
            compare(q.y - q2.y, rowHeight, "the letters move up by the row");
            compare(kb.keyRect("Space").height, q.height);
            // The top letters are white keys with one character, not the
            // number row's short gray keys with two.
            compare(keyBackground("q"), "key-white.png");
            tapKey("q");
            tapKey("Shift");
            tapKey("Q");
            compare(field.text, "qQ");
            // Every size is shorter by the row's share (the letters' size).
            sys.keyboardSize = 1;
            compare(kb.keysHeight, Math.round(393 * 285 / 340));
            sys.keyboardSize = -2;
            compare(kb.keysHeight, Math.round(243 * 285 / 340));
            sys.keyboardSize = 0;
            // On again while open.
            sys.tweaks = { numberRow: true };
            tryVerify(function() { return kb.keyRect("1") !== null; }, 1000, "the number row is back");
            compare(kb.keysHeight, height);
            compare(kb.keyRect("q"), q);
            compare(keyBackground("1"), "key-gray-short.png");
            tryCompare(shell.notifications, "negativeSpace", 340 + 44, 1000);
            // Unset again: the tablet's own.
            sys.tweaks = { numberRow: false };
            tryVerify(function() { return kb.keyRect("1") === null; }, 1000);
            sys.tweaks = {};
            tryVerify(function() { return kb.keyRect("1") !== null; }, 1000, "unset: the tablet's");
            compare(kb.keysHeight, 340);
        }

        // Without the number row the digits are on the symbol page of the
        // top letters, as the phone's (PhoneKeymap.cpp:156-161), and their
        // long press has the row's shifted symbols and the letters' own.
        function test_digitsWithoutTheNumberRow() {
            sys.tweaks = { numberRow: false };
            showKeyboard();
            tryVerify(function() { return kb.keyRect("1") === null; }, 1000);
            var q = kb.keyRect("q");
            tapKey("+ = [  ]");
            tryVerify(function() { return kb.keyRect("A B C") !== null; }, 1000);
            compare(kb.keyRect("1"), q, "1 where Q is");
            tapKey("1");
            tapKey("2");
            tapKey("0");
            compare(field.text, "120");
            // The rest of the symbol page is the original's: A is <.
            tapKey("<");
            compare(field.text, "120<");
            // Hold 2: 2 @ ² (the number row's), then ~ (W's, before).
            var c = keyCenter("2");
            mousePress(kb, c.x, c.y);
            tryVerify(function() { return kb._extendedKeys !== null && kb._popup !== null; }, 2000);
            tryCompare(findChild(kb, "extendedKeys"), "visible", true, 1000);
            compare(kb._extendedKeys.map(function(k) { return String.fromCharCode(k); }).join(""), "2@²~");
            var cell = findChild(kb, "extendedKey1");
            var p = cell.mapToItem(kb, cell.width / 2, cell.height / 2);
            mouseMove(kb, p.x, p.y);
            mouseRelease(kb, p.x, p.y);
            compare(field.text, "120<@");
            sys.tweaks = {};
        }

        // The key maps themselves: the tablet without its number row, in
        // each layout; AZERTY's caps lock (its number lock) types capitals
        // on the top letters, as before, and digits on the number row.
        function test_keymapWithoutTheNumberRow() {
            var families = { qwerty: "QWERTYUIOP", qwertz: "QWERTZUIOP", azerty: "AZERTYUIOP" };
            for (var f in families) {
                var km = new KM.Keymap(true, f, false);
                compare(km.rows, 4, f);
                compare(km.numberRow, false);
                km.setSymbolMode(KM.SymbolMode.Lock);
                for (var x = 0; x < 10; ++x) {
                    compare(km.mapPage(x, 0, 0), families[f].charCodeAt(x), f + " letter " + x);
                    compare(String.fromCharCode(km.map(x, 0)), "1234567890".charAt(x), f + " digit " + x);
                }
                // The bottom row is the last still.
                compare(km.mapPage(km.family.symbolX, 3, 0), KM.Key.Alt, f);
                // The language key and the bottom row follow the field as before.
                km.setEditorState({ type: KM.FieldType.URL });
                verify(km.layout[3].some(function(k) { return k.key === KM.Key.DotCom; }), f);
                var with5 = new KM.Keymap(true, f);
                compare(with5.rows, 5, "unset: the tablet's own");
            }
            var az = new KM.Keymap(true, "azerty", false);
            az.setShiftMode(KM.ShiftMode.CapsLock);
            compare(az.map(0, 0), KM.code("A"));
            var az5 = new KM.Keymap(true, "azerty", true);
            az5.setShiftMode(KM.ShiftMode.CapsLock);
            compare(az5.map(1, 0), KM.code("1"), "the number row's digits, as before");
            // On and off in place.
            var km2 = new KM.Keymap(true, "qwerty", true);
            verify(km2.setNumberRow(false));
            compare(km2.rows, 4);
            compare(km2.rowHeight.length, 4);
            verify(!km2.setNumberRow(false));
            verify(km2.setNumberRow(true));
            compare(km2.rows, 5);
            compare(km2.mapPage(1, 0, 0), KM.code("1"));
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

        // Settings > Text Assist > Keyboard style "black": the phone's look
        // on the TouchPad's layout (the owner, 8 October 2026): the same
        // rows and sizes, the phone's art and colours, at once and back.
        function test_blackStyle() {
            showKeyboard();
            var q = kb.keyRect("q"), height = kb.keysHeight;
            compare(kb.touchpadLook, true);
            sys.tweaks = { keyboardStyle: "black" };
            tryCompare(kb, "touchpadLook", false, 1000);
            verify(kb._art.indexOf("keyboard-phone/") >= 0, kb._art);
            tryVerify(function() { return keyBackground("q") === "key-white.png" && kb._keys[0].art === kb._art; }, 1000);
            compare(keyBackground("1"), "key-charcoal.png");
            compare(keyBackground("Enter"), "key-charcoal.png");
            compare(keyBackground("Shift"), "key-charcoal.png");
            // The layout is the tablet's still.
            compare(kb.keysHeight, height);
            compare(kb.keyRect("q"), q);
            compare(kb.cActiveColor, Qt.color("#d2d2d2"));
            var shot = grabImage(shell);
            var at = function(name, fx, fy) {
                var r = kb.keyRect(name);
                var c = kb.mapToItem(shell, r.x + r.width * fx, r.y + r.height * fy);
                return shot.pixel(Math.round(c.x), Math.round(c.y));
            };
            // Black letter keys, a charcoal Enter, as the phone's.
            verify(at("q", 0.2, 0.5).r < 0.05, "a black letter key " + at("q", 0.2, 0.5));
            var enter = at("Enter", 0.15, 0.5);
            verify(enter.r > 0.10 && enter.r < 0.16, "a charcoal Enter " + enter);
            // It still types.
            tapKey("1");
            tapKey("a");
            compare(field.text, "1a");
            sys.tweaks = {};
            tryCompare(kb, "touchpadLook", true, 1000);
            tryVerify(function() { return keyBackground("1") === "key-gray-short.png"; }, 1000);
        }

        // With the keyboard up the bezel flick must travel 60 px.
        function test_keyboardOpenForTheBezelFlick() {
            showKeyboard();
            verify(shell.keyboardOpen);
        }
    }
}
