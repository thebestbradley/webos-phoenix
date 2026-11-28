// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The virtual keyboard typing into web pages, as the simulator's host
// does (Shell.qml's KeyboardHost: KeyInjector.sendImeKey, a key event with
// the character's text and no native key code, and commitText), through
// Qt WebEngine to the page: every character of each layer of the phone's
// and the tablet's QWERTY, QWERTZ and AZERTY keyboards (tapped), their
// long presses and the phone's "..." popup, into a plain input (a Phoenix
// React app's), an Enyo 1.0 enyo.Input of the URL type (the Browser's
// address bar) and an enyo.RichText (Memos, Just Type). What reaches the
// field must be exactly what the keys show, and each key's keypress event
// must carry its character (Enyo 1.0 and Mojo apps read keypress).
//
// Not in shell/tests: Qt WebEngine needs its sandbox off where a CI runner
// has no user namespaces, which a QML file cannot say;
// tools/test-typing-sim.cjs runs it with QTWEBENGINE_DISABLE_SANDBOX=1:
//
//   QTWEBENGINE_DISABLE_SANDBOX=1 QT_QPA_PLATFORM=offscreen qmltestrunner \
//       -import shell/qml -import build/qml -input shell/tests-web

import QtQuick
import QtTest
import QtWebEngine
import Phoenix.Shell
import Phoenix.Native
import "../qml/Phoenix/Shell/KeyboardKeymap.js" as KM

Item {
    id: root
    width: 1024
    height: 768

    WebEngineView {
        id: view
        x: 0
        y: 0
        width: 600
        height: 200
        url: Qt.resolvedUrl("keyboard-page.html")
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
                function sendKey(key, modifiers) { KeyInjector.sendImeKey(view, key, modifiers); }
                function commitText(text) { KeyInjector.commitText(view, text); }
            }
        }
    }

    TestCase {
        name: "KeyboardIntoWebPages"
        when: windowShown

        property var kb: null

        function js(script) {
            var done = false, result;
            view.runJavaScript(script, function (r) { result = r; done = true; });
            tryVerify(function() { return done; }, 5000, script);
            return result;
        }

        function initTestCase() {
            tryCompare(view, "loading", false, 20000);
            tryVerify(function() { return js("window.ready") === true; }, 20000, "the page and Enyo 1.0 loaded");
        }

        function make(tablet, layout) {
            var language = { qwerty: "en", qwertz: "de", azerty: "fr" }[layout];
            kb = createTemporaryObject(keyboardComponent, root, {
                tablet: tablet, availableWidth: tablet ? 1024 : 320, availableHeight: tablet ? 768 : 480,
                keyboards: [{ layout: layout, language: language }], keyboard: { layout: layout, language: language }
            });
            kb.shown = true;
            tryVerify(function() { return kb.keyRect("Shift") !== null && !kb._paintQueued; }, 2000);
        }
        function km() { return kb.keymap; }
        function settle() { tryVerify(function() { return !kb._paintQueued; }, 1000); }
        function entries() {
            settle();
            return kb._keys.map(function (e) { return { col: e.col, row: e.row, x: e.x, y: e.y, w: e.w, h: e.h, label: e.label, key: e.key }; });
        }
        function center(e) { return { x: e.x + e.w / 2, y: e.y + e.h / 2 + kb.candidateBarHeight }; }
        function entryFor(key) {
            var list = entries();
            for (var i = 0; i < list.length; ++i)
                if (list[i].key === key)
                    return list[i];
            return null;
        }
        function tap(key) { var p = center(entryFor(key)); mouseClick(kb, p.x, p.y); }
        function typesText(k) { return KM.isUnicodeKey(k) || KM.isTextShortcutKey(k); }
        function expectedFor(k, label) {
            return k === KM.Key.Space ? " " : KM.isUnicodeKey(k) ? label : km().displayString(k, false);
        }

        // Every key of the layer as it is now, tapped (Shift held by a
        // second finger for `shiftHeld`); what they type, in order.
        function tapLayer(shiftHeld, skipSpace) {
            var t = null, s = null, out = "";
            if (shiftHeld) {
                var sk = entryFor(KM.Key.Shift);
                if (!sk)
                    return "";              // (the phone's symbols have none)
                s = center(sk);
                t = touchEvent(kb);
                t.press(0, kb, s.x, s.y).commit();
                tryVerify(function() { return km().shiftDown; }, 1000);
            }
            var list = entries();
            for (var i = 0; i < list.length; ++i) {
                var e = list[i];
                if (!typesText(e.key) || (skipSpace && e.key === KM.Key.Space)
                        || (!kb.tablet && e.key === KM.Key.EmoticonOptions))
                    continue;
                var p = center(e);
                if (t) {
                    t.stationary(0).press(1, kb, p.x, p.y).commit();
                    t.stationary(0).release(1, kb, p.x, p.y).commit();
                    wait(0);
                } else {
                    mouseClick(kb, p.x, p.y);
                }
                out += expectedFor(e.key, e.label);
            }
            if (t) {
                t.release(0, kb, s.x, s.y).commit();
                tryVerify(function() { return !km().shiftDown; }, 1000);
            }
            return out;
        }
        // Every long press's characters (and the phone's popups), as a
        // release on each cell types it (_handleKey).
        function extendedAll() {
            var out = "";
            var list = entries();
            for (var i = 0; i < list.length; ++i) {
                var e = list[i];
                var ext = km().extendedChars(e.col, e.row);
                if (!ext || !(typesText(e.key) || e.key === KM.Key.MorePopup))
                    continue;
                for (var c = 0; c < ext.length; ++c) {
                    if (!typesText(ext[c]))
                        continue;
                    kb._handleKey(ext[c], null);
                    out += expectedFor(ext[c], km().displayString(ext[c], false));
                }
            }
            return out;
        }
        function symbols(on) {
            tap(KM.Key.Alt);
            tryCompare(km(), "symbolMode", on ? KM.SymbolMode.Lock : KM.SymbolMode.Off, 1000);
        }

        function typeEverything() {
            var want = tapLayer(false, false);
            want += tapLayer(true, false);
            want += extendedAll();
            symbols(true);
            want += tapLayer(false, true);
            want += tapLayer(true, true);
            want += extendedAll();
            symbols(false);
            return want;
        }

        function run(tablet, layout, field) {
            make(tablet, layout);
            verify(js("start('" + field + "')"), field + " focused");
            var want = typeEverything();
            var got;
            tryVerify(function() { got = js("value('" + field + "')"); return got === want; }, 5000);
            var at = 0;
            while (at < want.length && got[at] === want[at])
                ++at;
            compare(got, want, (tablet ? "tablet " : "phone ") + layout + " into " + field + ": first difference at " + at
                    + " (got " + JSON.stringify(String(got).substr(at, 6)) + ", wanted " + JSON.stringify(want.substr(at, 6)) + ")");
            // Each key event carried its character: keypress for what was
            // typed key by key (commits have none).
            var pressed = js("keyLog.filter(function (e) { return e.type === 'keypress'; }).map(function (e) { return e.key; }).join('')");
            var keyed = js("keyLog.filter(function (e) { return e.type === 'keydown' && e.key.length === 1; }).length");
            verify(pressed.length > 0 && keyed > 0, "key events reached the page");
            verify(want.indexOf(pressed.substr(0, 20)) >= 0, "keypress carries the characters: " + pressed.substr(0, 20));
        }

        function test_typing_data() {
            var out = [];
            [false, true].forEach(function (tablet) {
                ["qwerty", "qwertz", "azerty"].forEach(function (layout) {
                    ["plain", "url", "rich"].forEach(function (field) {
                        out.push({ tag: (tablet ? "tablet " : "phone ") + layout + " " + field, tablet: tablet, layout: layout, field: field });
                    });
                });
            });
            return out;
        }
        function test_typing(data) {
            run(data.tablet, data.layout, data.field);
        }
    }
}
