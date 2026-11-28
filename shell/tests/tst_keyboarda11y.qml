// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The virtual keyboard to a screen reader (GAPS V10; VirtualKeyboard.qml
// accessibleKeyName): each key on screen is a button of its own (the
// keyboard draws its keys; one touch area takes the fingers) with a name,
// its character or what it does ("Shift", "Delete", "Space", "Numbers and
// symbols"), Shift a toggle that says when it is on, and activating one
// types what a tap on it types; the long press's popups ("...", the
// emoticons) are buttons too.
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
            textSuggestions: false
            autoCorrect: false
            swipeTyping: false
            shortcutsOn: false
            spaces2period: false
            emojiSuggestions: false
            tapSounds: false
            host: KeyboardHost {
                function sendKey(key, modifiers) { KeyInjector.sendImeKey(field, key, modifiers); }
                function commitText(text) { KeyInjector.commitText(field, text); }
            }
        }
    }

    TestCase {
        name: "KeyboardAccessibility"
        when: windowShown

        property var kb: null

        function make(tablet) {
            kb = createTemporaryObject(keyboardComponent, root, {
                tablet: tablet, availableWidth: tablet ? 1024 : 320, availableHeight: tablet ? 768 : 480
            });
            kb.shown = true;
            field.text = "";
            field.forceActiveFocus();
            tryVerify(function() { return kb.keyRect("Shift") !== null && !kb._paintQueued; }, 2000);
        }
        // The key items as a screen reader finds them, by name.
        function keys() {
            tryVerify(function() { return !kb._paintQueued; }, 1000);
            var out = [];
            for (var i = 0; ; ++i) {
                var k = findChild(kb, "keyboardKey" + i);
                if (!k)
                    break;
                out.push(k);
            }
            return out;
        }
        function named(name) {
            var list = keys();
            for (var i = 0; i < list.length; ++i)
                if (list[i].Accessible.name === name)
                    return list[i];
            return null;
        }

        function everyKeyNamed(form) {
            var list = keys();
            verify(list.length > 25, form + ": " + list.length + " keys");
            var names = {};
            for (var i = 0; i < list.length; ++i) {
                var a = list[i].Accessible;
                verify(!a.ignored, form + ": key " + i + " shown to a screen reader");
                verify(a.role === Accessible.Button || a.role === Accessible.CheckBox, form + ": key " + i + " a button");
                verify(String(a.name) !== "", form + ": key " + i + " (" + list[i].modelData.label + ") has a name");
                // (The tablet has a Shift each side.)
                verify(!names[a.name] || a.name === "Delete" || a.name === "Shift", form + ": one key named " + a.name);
                names[a.name] = true;
            }
            return names;
        }

        function test_names_data() {
            return [{ tag: "phone", tablet: false }, { tag: "tablet", tablet: true }];
        }
        function test_names(data) {
            make(data.tablet);
            var names = everyKeyNamed(data.tag);
            ["Shift", "Delete", "Space", "Return", "Numbers and symbols", "Emoji", "q", "m"].forEach(function (n) {
                verify(names[n], data.tag + ": a key named " + n);
            });
            // Its character, which the reader says by name.
            verify(named(",") !== null && named(".") !== null, data.tag + ": , and .");
            // The symbols: the key says it goes back to the letters.
            named("Numbers and symbols").Accessible.pressAction();
            tryCompare(kb.keymap, "symbolMode", KM.SymbolMode.Lock, 1000);
            names = everyKeyNamed(data.tag + " symbols");
            verify(names["Letters"], data.tag + ": Letters");
            (data.tablet ? ["1", "\\", "|", "~", "€"] : ["1", "!", "@", "More symbols", "Emoticons"]).forEach(function (n) {
                verify(names[n], data.tag + " symbols: a key named " + n);
            });
        }

        // Activated, each key types what a tap types; Shift toggles.
        function test_activate_data() { return test_names_data(); }
        function test_activate(data) {
            make(data.tablet);
            var list = keys();
            for (var i = 0; i < list.length; ++i) {
                var k = list[i].modelData.key;
                if (!KM.isUnicodeKey(k) || k === KM.Key.Space)
                    continue;
                field.text = "";
                list[i].Accessible.pressAction();
                compare(field.text, list[i].Accessible.name, data.tag + ": " + list[i].Accessible.name + " types itself");
            }
            field.text = "";
            var shift = named("Shift");
            verify(!shift.Accessible.checked);
            shift.Accessible.toggleAction();
            tryVerify(function() { return named("Shift").Accessible.checked; }, 1000, "Shift on");
            named("Q").Accessible.pressAction();
            compare(field.text, "Q");
            tryVerify(function() { return named("Shift") && !named("Shift").Accessible.checked; }, 1000, "Shift once");
            named("Space").Accessible.pressAction();
            named("Delete").Accessible.pressAction();
            compare(field.text, "Q");
        }

        // The phone's popups: "..." (the symbols the keyboard has nowhere
        // else) and the emoticons, a button each.
        function test_phonePopups() {
            make(false);
            named("Numbers and symbols").Accessible.pressAction();
            tryCompare(kb.keymap, "symbolMode", KM.SymbolMode.Lock, 1000);
            var more = named("More symbols");
            verify(more !== null, "the ... key");
            more.Accessible.pressAction();
            var popup = findChild(kb, "extendedKeys");
            tryCompare(popup, "visible", true, 1000);
            var cell = findChild(kb, "extendedKey0");
            verify(cell);
            compare(cell.Accessible.role, Accessible.Button);
            var name = cell.Accessible.name;
            verify(name.length === 1, "a character: " + name);
            field.text = "";
            cell.Accessible.pressAction();
            compare(field.text, name);
            tryCompare(popup, "visible", false, 1000);
            named("Emoticons").Accessible.pressAction();
            tryCompare(popup, "visible", true, 1000);
            cell = findChild(kb, "extendedKey0");
            compare(cell.Accessible.name, ":-)");
            field.text = "";
            cell.Accessible.pressAction();
            compare(field.text, ":-)");
        }
    }
}
