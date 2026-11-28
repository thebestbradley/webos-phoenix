// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Every character of the virtual keyboard (VirtualKeyboard.qml, the
// keyboard-efigs keymaps in KeyboardKeymap.js) typed into a text field the
// way the simulator's keyboard host types it (Shell.qml's KeyboardHost:
// KeyInjector.sendImeKey / commitText, keytext.h): the phone's and the
// tablet's keyboards, QWERTY, QWERTZ and AZERTY, each key of each layer
// (plain, Shift held, the symbols, the symbols with Shift), each long
// press's accents, and the bottom rows of URL and e-mail fields. What a key
// types must be what its cap shows (the original drew the cap from the key
// it sent: PhoneKeyboard.cpp drawKeyCap / getKeyDisplayString, TabletKeymap
// getKeyDisplayString), and every printable ASCII character must be
// reachable on every layout.
//
// Needs Phoenix.Native (KeyInjector): run with the build tree's modules.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Native
import "../qml/Phoenix/Shell/KeyboardKeymap.js" as KM

Item {
    id: root
    width: 1024
    height: 768

    TextInput {
        id: field
        x: 10
        y: 10
        width: 600
        height: 20
    }

    Component {
        id: keyboardComponent
        VirtualKeyboard {
            y: root.height - height
            // Nothing between the key and the field: no corrections,
            // suggestions, shortcuts or swipes.
            textSuggestions: false
            autoCorrect: false
            swipeTyping: false
            shortcutsOn: false
            spaces2period: false
            emojiSuggestions: false
            tapSounds: false
            // The simulator's host (Shell.qml), into the field.
            host: KeyboardHost {
                function sendKey(key, modifiers) { KeyInjector.sendImeKey(field, key, modifiers); }
                function commitText(text) { KeyInjector.commitText(field, text); }
            }
        }
    }

    TestCase {
        name: "KeyboardCharacters"
        when: windowShown

        property var kb: null
        // Every character typed in this keyboard, for the coverage check.
        property var typedChars: ({})

        function make(tablet, layout, type) {
            var language = { qwerty: "en", qwertz: "de", azerty: "fr" }[layout];
            kb = createTemporaryObject(keyboardComponent, root, {
                tablet: tablet,
                availableWidth: tablet ? 1024 : 320,
                availableHeight: tablet ? 768 : 480,
                keyboards: [{ layout: layout, language: language }],
                keyboard: { layout: layout, language: language },
                editorState: { type: type || 0 }
            });
            kb.shown = true;
            field.text = "";
            field.forceActiveFocus();
            tryVerify(function() { return kb.keyRect("Shift") !== null; }, 2000, "keys laid out");
            compare(kb.layoutName, layout);
            typedChars = {};
        }

        function km() { return kb.keymap; }
        function keyAt(e) { return km().map(e.col, e.row); }
        function isCharKey(k) { return KM.isUnicodeKey(k) || KM.isTextShortcutKey(k); }
        function center(e) { return { x: e.x + e.w / 2, y: e.y + e.h / 2 + kb.candidateBarHeight }; }
        function entries() {
            // Drawn as the state is now (a change is laid out on the next
            // pass of the event loop, _triggerRepaint).
            tryVerify(function() { return !kb._paintQueued; }, 1000, "laid out");
            // A copy: the keys are laid out again as the state changes.
            return kb._keys.map(function (e) { return { col: e.col, row: e.row, x: e.x, y: e.y, w: e.w, h: e.h, label: e.label }; });
        }
        function entryFor(key) {
            var list = entries();
            for (var i = 0; i < list.length; ++i)
                if (keyAt(list[i]) === key)
                    return list[i];
            return null;
        }
        function tapAt(p) {
            mouseClick(kb, p.x, p.y);
        }
        function tapKey(key) {
            var e = entryFor(key);
            verify(e !== null, "key " + key.toString(16));
            tapAt(center(e));
        }
        function record(text) {
            for (var i = 0; i < text.length; ++i)
                typedChars[text.charAt(i)] = true;
        }
        function where(e, layer) {
            return (kb.tablet ? "tablet " : "phone ") + kb.layoutName + " " + layer + " [" + e.col + "," + e.row + "] \"" + e.label + "\"";
        }

        // Each key of the layer as it is now types its cap. `shiftHeld`:
        // Shift held by a second finger (the plugin's shift key down,
        // m_shiftDown) while each key is tapped.
        function typeLayer(layer, shiftHeld, skipSpace) {
            var t = null, s = null;
            if (shiftHeld) {
                // (The phone's symbols have no Shift: its place is a
                // symbol, PhoneKeymap.cpp:116-125.)
                var shiftKey = entryFor(KM.Key.Shift);
                if (!shiftKey) {
                    verify(!kb.tablet && km().isSymbolActive(), layer + ": a Shift key");
                    return 0;
                }
                s = center(shiftKey);
                t = touchEvent(kb);
                t.press(0, kb, s.x, s.y).commit();
                tryVerify(function() { return km().shiftDown; }, 1000, "shift down");
            }
            var list = entries();
            var n = 0;
            for (var i = 0; i < list.length; ++i) {
                var e = list[i];
                var k = keyAt(e);
                // (The phone's emoticon key opens its popup at once,
                // PhoneKeyboard.cpp:650-656: typeExtended types those.)
                if (!isCharKey(k) || (skipSpace && k === KM.Key.Space) || (!kb.tablet && k === KM.Key.EmoticonOptions))
                    continue;
                field.text = "";
                var expected = KM.isUnicodeKey(k) ? (k === KM.Key.Space ? " " : e.label) : km().displayString(k, false);
                var p = center(e);
                if (t) {
                    t.stationary(0).press(1, kb, p.x, p.y).commit();
                    t.stationary(0).release(1, kb, p.x, p.y).commit();
                    tryCompare(field, "text", expected, 1000, where(e, layer));
                } else {
                    tapAt(p);
                    compare(field.text, expected, where(e, layer));
                }
                record(field.text);
                ++n;
            }
            if (t) {
                t.release(0, kb, s.x, s.y).commit();
                tryVerify(function() { return !km().shiftDown; }, 1000, "shift up");
            }
            verify(n > 10, layer + ": " + n + " keys");
            return n;
        }

        // Each long press's accents: one long press a key, slid onto one of
        // its cells (in turn the first, the second... so that every place
        // in a popup is slid to somewhere) and let go; each other cell's
        // character then typed as a release on it types it (_handleKey),
        // in the same Shift state. What each types must be its cell's text.
        // `shifted`: Shift on for the press (as a tap of Shift leaves it,
        // ShiftMode.Once; a tap before each would lock it, 500 ms apart).
        function shiftOnce() {
            km().setShiftMode(KM.ShiftMode.Once);
            kb._layoutChanged();
            tryVerify(function() { return !kb._paintQueued && km().isShiftActive(); }, 1000);
        }
        // `longPress` false: the popups are not opened (each long press
        // waits 350 ms; the plain page's are, and the phone's "..." and
        // emoticon keys', which open at once), each character typed as its
        // release would type it.
        function typeExtended(layer, shifted, longPress) {
            var list = entries();
            var popup = findChild(kb, "extendedKeys");
            var n = 0, slide = 0;
            for (var i = 0; i < list.length; ++i) {
                var e = list[i];
                // (The phone's "..." key: its popup is all characters.)
                if (!(isCharKey(keyAt(e)) || keyAt(e) === KM.Key.MorePopup) || km().extendedChars(e.col, e.row) === null)
                    continue;
                var atOnce = !kb.tablet && (keyAt(e) === KM.Key.MorePopup || keyAt(e) === KM.Key.EmoticonOptions);
                if (!longPress && !atOnce) {
                    var ext = km().extendedChars(e.col, e.row).slice();
                    for (var x = 0; x < ext.length; ++x) {
                        if (!isCharKey(ext[x]))
                            continue;
                        field.text = "";
                        if (shifted)
                            shiftOnce();
                        var want = km().displayString(ext[x], false);
                        kb._handleKey(ext[x], null);
                        compare(field.text, want, where(e, layer) + " accent " + x + " \"" + want + "\"");
                        record(field.text);
                        ++n;
                    }
                    continue;
                }
                field.text = "";
                if (shifted)
                    shiftOnce();
                var p = center(e);
                mousePress(kb, p.x, p.y);
                tryCompare(popup, "visible", true, 1500, where(e, layer) + " long press");
                var keys = kb._extendedKeys.slice();
                var texts = popup.p.cells.map(function (c) { return c.text; });
                var chars = [];
                for (var c = 0; c < keys.length; ++c)
                    if (isCharKey(keys[c]))
                        chars.push(c);
                if (chars.length === 0) {
                    mouseRelease(kb, p.x, p.y);
                    tryCompare(popup, "visible", false, 1000);
                    continue;
                }
                var slid = chars[slide++ % chars.length];
                var cell = findChild(kb, "extendedKey" + slid);
                verify(cell, where(e, layer) + " cell " + slid);
                var q = cell.mapToItem(kb, cell.width / 2, cell.height / 2);
                mouseMove(kb, q.x, q.y);
                mouseRelease(kb, q.x, q.y);
                compare(field.text, texts[slid], where(e, layer) + " accent " + slid + " \"" + texts[slid] + "\" (slid to)");
                record(field.text);
                tryCompare(popup, "visible", false, 1000);
                ++n;
                for (var j = 0; j < chars.length; ++j) {
                    if (chars[j] === slid)
                        continue;
                    field.text = "";
                    if (shifted)
                        shiftOnce();
                    kb._handleKey(keys[chars[j]]);
                    compare(field.text, texts[chars[j]], where(e, layer) + " accent " + chars[j] + " \"" + texts[chars[j]] + "\"");
                    record(field.text);
                    ++n;
                }
                if (shifted)
                    tryVerify(function() { return !km().isShiftActive(); }, 1000, "shift once");
            }
            verify(n > 0, layer + ": accents typed");
            return n;
        }

        function symbolsOn() {
            tapKey(KM.Key.Alt);
            tryCompare(km(), "symbolMode", KM.SymbolMode.Lock, 1000);
        }
        function symbolsOff() {
            tapKey(KM.Key.Alt);
            tryCompare(km(), "symbolMode", KM.SymbolMode.Off, 1000);
        }

        function allLayers() {
            typeLayer("plain", false, false);
            typeLayer("shift", true, false);
            symbolsOn();
            // (Space ends the symbols, PhoneKeyboard.cpp:1027-1028.)
            typeLayer("symbols", false, true);
            typeLayer("symbols+shift", true, true);
            symbolsOff();
        }

        // The characters a person asks for most on a hardware-less device,
        // and all of printable ASCII, reachable on each layout.
        function checkCoverage(withCapitals) {
            var missing = [];
            for (var c = 0x21; c < 0x7f; ++c)
                if (!typedChars[String.fromCharCode(c)])
                    missing.push(String.fromCharCode(c));
            compare(missing.join(""), "", (kb.tablet ? "tablet " : "phone ") + kb.layoutName + ": ASCII not typed");
            var wanted = withCapitals ? "éèàçñüößÉÑ€£" : "éèàçñüöß€£";
            for (var i = 0; i < wanted.length; ++i)
                verify(typedChars[wanted.charAt(i)], kb.layoutName + ": " + wanted.charAt(i) + " typed");
        }

        function run(tablet, layout) {
            make(tablet, layout, KM.FieldType.Text);
            allLayers();
            typeExtended("plain accents", false, true);
            symbolsOn();
            typeExtended("symbol accents", false, false);
            symbolsOff();
            typeExtended("shifted accents", true, false);
            checkCoverage(true);
        }

        function test_phoneQwerty() { run(false, "qwerty"); }
        function test_phoneQwertz() { run(false, "qwertz"); }
        function test_phoneAzerty() { run(false, "azerty"); }
        function test_tabletQwerty() { run(true, "qwerty"); }
        function test_tabletQwertz() { run(true, "qwertz"); }
        function test_tabletAzerty() { run(true, "azerty"); }

        // The bottom rows of URL and e-mail fields (the phone's keys beside
        // the space bar, the tablet's bottom row: "/", ".com", "@",
        // "http://", PhoneKeymap.cpp:530-607, TabletKeymap.cpp:665-725).
        function fieldTypes_data() {
            var out = [];
            [false, true].forEach(function (tablet) {
                ["qwerty", "qwertz", "azerty"].forEach(function (layout) {
                    [["url", KM.FieldType.URL], ["email", KM.FieldType.Email]].forEach(function (t) {
                        out.push({ tag: (tablet ? "tablet " : "phone ") + layout + " " + t[0], tablet: tablet, layout: layout, type: t[1] });
                    });
                });
            });
            return out;
        }
        function test_fieldTypes_data() { return fieldTypes_data(); }
        function test_fieldTypes(data) {
            make(data.tablet, data.layout, data.type);
            allLayers();
            typeExtended("accents", false, false);
            symbolsOn();
            typeExtended("symbol accents", false, false);
            symbolsOff();
            verify(typedChars["/"] && typedChars["@"] && typedChars["."], "/ @ . on a " + data.tag + " field");
            checkCoverage(false);
        }
    }
}
