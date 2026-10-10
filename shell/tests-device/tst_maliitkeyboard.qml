// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix keyboard as a device's input method (GAPS V5):
// Phoenix/Keyboard/MaliitKeyboard.qml, the keyboard's host inside
// maliit-server, over a fake input method (what services/keyboard's
// PhoenixInputMethod gives it: the field, and what reaches the field) and
// the fake bus (fakes/WebOSServices):
//
//   QT_QPA_PLATFORM=offscreen qmltestrunner -import shell/qml -import build/qml \
//       -import shell/tests-device/fakes -input shell/tests-device
//
// Typing, a candidate's commit, Backspace, Return, the field's types (no
// prediction in numbers, e-mail and web addresses, passwords), show, hide
// and the panel's height, the text around the cursor for auto-capitals
// (V1, V3), and what the keyboard reads and writes on the bus: its settings,
// key sounds, the clip strip, the words it learned. services/keyboard's
// keyboard-test runs the same QML inside the plugin over a fake Maliit host.

import QtQuick
import QtTest
import WebOSServices 1.0
import Phoenix.Keyboard

Item {
    id: root
    width: 320
    height: 480

    // PhoenixInputMethod's properties and methods, with a field of its own
    // that takes what is sent as an app's would.
    component FakeInputMethod: QtObject {
        property int contentType: 0
        property int enterKeyType: 0
        property bool hiddenText: false
        property bool autoCapitalization: false
        property bool active: false
        property int screenWidth: 320
        property int screenHeight: 480
        property int orientationAngle: 0
        property int panelHeight: 0
        readonly property string serviceName: "com.webos.service.ime"
        signal clientChanged()
        signal cursorMoved()

        property string text: ""
        property int cursor: 0
        property var keys: []
        property var commits: []
        property var preedits: []
        property int hidings: 0
        property string switchedTo: ""
        property var state: ({})

        function _insert(s) {
            text = text.slice(0, cursor) + s + text.slice(cursor);
            cursor += s.length;
        }
        // shell/native/keytext.h: a character is a commit, other keys go as keys.
        function sendKey(key, modifiers) {
            var ch = key === Qt.Key_Return || key === Qt.Key_Enter || key === Qt.Key_Backspace || key === Qt.Key_Tab
                     || key >= 0x01000000 ? "" : String.fromCharCode(key);
            if (key >= Qt.Key_A && key <= Qt.Key_Z && !(modifiers & Qt.ShiftModifier))
                ch = ch.toLowerCase();
            if (ch !== "") {
                commits = commits.concat([ch]);
                _insert(ch);
                return;
            }
            keys = keys.concat([key]);
            if (key === Qt.Key_Backspace && cursor > 0) {
                text = text.slice(0, cursor - 1) + text.slice(cursor);
                --cursor;
            } else if (key === Qt.Key_Left && cursor > 0) {
                --cursor;
            } else if (key === Qt.Key_Right && cursor < text.length) {
                ++cursor;
            }
        }
        function commitText(t) { commits = commits.concat([t]); _insert(t); }
        function setPreedit(t) { preedits = preedits.concat([t]); }
        function hideKeyboard() { ++hidings; active = false; }
        function setPanelHeight(h) { panelHeight = h; }
        function surroundingText() { return { text: text, cursor: cursor }; }
        function switchKeyboard(f) { switchedTo = f; }
        function readState(name) { return state[name] || ""; }
        function writeState(name, t) { var s = {}; for (var k in state) s[k] = state[k]; s[name] = t; state = s; return true; }
    }
    Component { id: fakeInputMethod; FakeInputMethod {} }
    Component { id: maliitKeyboard; MaliitKeyboard { anchors.fill: parent } }

    TestCase {
        name: "MaliitKeyboard"
        when: windowShown

        property var im: null
        property var host: null
        readonly property var kb: host ? host.keyboard : null

        // The keyboard's repaints queued by the test's last change
        // (Qt.callLater) run before it is destroyed.
        function cleanup() {
            wait(50);
        }

        // A fresh keyboard over a fresh input method, the system's
        // preferences answered with prefs.
        function make(prefs, state) {
            FakeBus.calls = [];
            im = createTemporaryObject(fakeInputMethod, root, { state: state || {} });
            host = createTemporaryObject(maliitKeyboard, root, { maliit: im });
            verify(host !== null);
            var p = { returnValue: true };
            for (var k in prefs || {})
                p[k] = prefs[k];
            verify(FakeBus.reply("com.webos.service.systemservice", "/getPreferences", p));
        }
        function show() {
            im.active = true;
            tryVerify(function() { return kb.keyRect("q") !== null; }, 1000);
        }
        function tapKey(name) {
            var r;
            tryVerify(function() { r = kb.keyRect(name); return r !== null; }, 1000, "key " + name);
            mouseClick(kb, r.x + r.width / 2, r.y + r.height / 2);
            wait(20);
        }

        // It asks for its settings, and follows them.
        function test_settings() {
            make({});
            var c = FakeBus.last("com.webos.service.systemservice", "/getPreferences");
            compare(c.params.subscribe, true);
            verify(c.params.keys.indexOf("x_palm_virtualkeyboard_prefs") >= 0);
            verify(c.params.keys.indexOf("x_palm_textinput") >= 0);
            compare(kb.numberRow, false);
            compare(kb.keyboardStyle, "auto");
            compare(kb.textSuggestions, true);
            compare(kb.keyboardId, "classic");
            // Settings > Text Assist changes them (the subscription's next reply).
            FakeBus.reply("com.webos.service.systemservice", "/getPreferences", {
                returnValue: true, keyboardNumberRow: true, keyboardStyle: "black",
                x_palm_virtualkeyboard_prefs: JSON.stringify({ TapSounds: false, WordSuggestions: false, AutoCorrect: false,
                                                               keyboards: [{ layout: "qwertz", language: "de" }, { layout: "qwerty", language: "en" }],
                                                               installed: ["phoenix", "classic"] }),
                x_palm_virtualkeyboard_settings: JSON.stringify({ layout: "qwerty", language: "en", keyboardId: "phoenix" }),
                x_palm_textinput: { shortcuts: [{ shortcut: "omw", text: "On my way" }], userWords: ["Phoenix"] } });
            compare(kb.numberRow, true);
            compare(kb.keyboardStyle, "black");
            compare(kb.tapSounds, false);
            compare(kb.textSuggestions, false);
            compare(kb.autoCorrect, false);
            compare(kb.keyboards.length, 2);
            compare(kb.keyboard.layout, "qwerty");
            compare(JSON.stringify(kb.installedKeyboards), JSON.stringify(["phoenix", "classic"]));
            compare(kb.keyboardId, "phoenix");
            verify(kb.phoenixLook);
            compare(kb.userShortcuts.omw, "On my way");
            compare(JSON.stringify(kb.userWords), JSON.stringify(["Phoenix"]));
        }

        // Shown by the server, its height is the panel's; keys and text reach
        // the field; hidden, it goes.
        function test_typingShowHideHeight() {
            make({});
            compare(kb.shown, false);
            show();
            verify(kb.shown);
            tryCompare(im, "panelHeight", Math.ceil(kb.keyboardHeight), 1000);
            verify(im.panelHeight > 100);
            tapKey("h");
            tapKey("i");
            compare(im.text, "hi");
            compare(JSON.stringify(im.commits), JSON.stringify(["h", "i"]));
            tapKey("Backspace");
            compare(im.text, "h");
            verify(im.keys.indexOf(Qt.Key_Backspace) >= 0);
            tapKey("Enter");
            verify(im.keys.indexOf(Qt.Key_Return) >= 0);
            // The number row makes it taller: the panel follows.
            var before = im.panelHeight;
            FakeBus.reply("com.webos.service.systemservice", "/getPreferences", { returnValue: true, keyboardNumberRow: true });
            tryVerify(function() { return im.panelHeight > before; }, 1000);
            compare(im.panelHeight, Math.ceil(kb.keyboardHeight));
            // The hide key.
            kb.hideRequested();
            compare(im.hidings, 1);
            compare(kb.shown, false);
            // The server hides it.
            show();
            im.active = false;
            compare(kb.shown, false);
        }

        // A candidate goes in for the word typed; a preedit goes to the field.
        function test_predictionCommit() {
            make({});
            show();
            tapKey("t");
            tapKey("h");
            tryVerify(function() { return kb.candidates.length > 0; }, 1000);
            var word = kb.candidates[0].text;
            kb.pickCandidate(0);
            compare(im.text, word + " ");
            kb.host.setPreedit("wor");
            compare(JSON.stringify(im.preedits), JSON.stringify(["wor"]));
        }

        // The field's type picks the keys and whether words are predicted.
        function test_contentTypes() {
            make({});
            show();
            var cases = [{ contentType: 0, type: 0, words: true }, { contentType: 1, type: 5, words: false },
                         { contentType: 2, type: 6, words: false }, { contentType: 3, type: 4, words: false },
                         { contentType: 4, type: 7, words: false }, { contentType: 0, hidden: true, type: 1, words: false },
                         { contentType: 0, enter: 5, type: 2, words: true }];
            cases.forEach(function (c) {
                im.contentType = c.contentType;
                im.hiddenText = !!c.hidden;
                im.enterKeyType = c.enter || 0;
                compare(kb.editorState.type, c.type, JSON.stringify(c));
                compare(kb.assistField, c.words, JSON.stringify(c));
                compare(kb.candidateBarShown && kb.assistBarShown, c.words, JSON.stringify(c));
            });
            im.contentType = 0;
            im.hiddenText = false;
            im.enterKeyType = 6;
            compare(kb.editorState.enterKeyLabel, "Next");
            im.enterKeyType = 0;
            compare(kb.editorState.enterKeyLabel, "");
        }

        // The text around the cursor (V3), and a capital where a sentence
        // starts when the field asks for one (V1).
        function test_surroundingTextAndAutoCap() {
            make({});
            im.autoCapitalization = true;
            im.text = "Hello. Good wor";
            im.cursor = im.text.length;
            show();
            im.clientChanged();
            tryCompare(kb, "_word", "wor", 1000);
            compare(kb._prevWord, "Good");
            compare(kb.editorState.autoCap, "sentences");
            // A new field after ". ": the next letter is a capital.
            wait(350);
            im.text = "Hello. ";
            im.cursor = im.text.length;
            im.cursorMoved();
            tryCompare(kb, "_sentenceStart", true, 1000);
            tapKey("a");
            compare(im.text, "Hello. A");
            // Without the field's hint: no capital.
            im.autoCapitalization = false;
            compare(kb.editorState.autoCap, "none");
        }

        // Key sounds through audiod, as the shell's (a PCM twin, the
        // feedback sink); off with "Keyboard clicks".
        function test_keySounds() {
            make({});
            show();
            FakeBus.clear();
            tapKey("a");
            var c = FakeBus.last("com.webos.service.audio", "/playSound");
            verify(c !== null);
            compare(c.params.fileName, "/usr/share/phoenix/sounds/feedback/key.wav.pcm");
            compare(c.params.sink, "pfeedback");
            FakeBus.reply("com.webos.service.systemservice", "/getPreferences",
                          { returnValue: true, x_palm_virtualkeyboard_prefs: JSON.stringify({ TapSounds: false }) });
            FakeBus.clear();
            tapKey("a");
            compare(FakeBus.last("com.webos.service.audio", "/playSound"), null);
        }

        // What it writes back: the keyboard in use, a word added, the
        // switch to OSE's keyboard, the words it learned.
        function test_writes() {
            make({ x_palm_virtualkeyboard_prefs: JSON.stringify({ keyboards: [{ layout: "qwerty", language: "en" }, { layout: "azerty", language: "fr" }],
                                                                  installed: ["classic", "ose"] }) });
            FakeBus.clear();
            kb.keyboardSelected({ layout: "azerty", language: "fr" });
            var c = FakeBus.last("com.webos.service.systemservice", "/setPreferences");
            compare(JSON.parse(c.params.x_palm_virtualkeyboard_settings).layout, "azerty");
            compare(JSON.parse(c.params.x_palm_virtualkeyboard_settings).keyboardId, "classic");
            kb.keyboardChosen("ose");
            c = FakeBus.last("com.webos.service.systemservice", "/setPreferences");
            compare(JSON.parse(c.params.x_palm_virtualkeyboard_settings).keyboardId, "ose");
            compare(im.switchedTo, "libplugin-global.so");
            FakeBus.clear();
            kb.dictionaryWordAdded("Phoenix");
            c = FakeBus.last("com.webos.service.systemservice", "/setPreferences");
            compare(JSON.stringify(c.params.x_palm_textinput.userWords), JSON.stringify(["Phoenix"]));
            kb.learnedWords = ["phoenix"];
            c = FakeBus.last("com.palm.systemmanager", "/phoenix/learnedWords");
            compare(JSON.stringify(c.params.words), JSON.stringify(["phoenix"]));
            // Text Assist's language is the process's: English again.
            kb.keyboardSelected({ layout: "qwerty", language: "en" });
            compare(kb.language, "en");
        }

        // What it keeps (the plugin's files): read at the start, written as
        // it changes.
        function test_state() {
            make({}, { emoji: JSON.stringify({ recent: ["😀"] }) });
            compare(kb.emojiPrefs, JSON.stringify({ recent: ["😀"] }));
            kb.emojiPrefs = JSON.stringify({ recent: ["🍕"] });
            compare(im.state.emoji, JSON.stringify({ recent: ["🍕"] }));
            show();
            tapKey("Space");    // a word learned or not, the data changes in time
            kb.textAssistData = "{\"words\":{}}";
            tryVerify(function() { return im.state.words === "{\"words\":{}}"; }, 3000);
        }

        // The clip strip asks the clipboard service on the bus.
        function test_clipboard() {
            make({});
            show();
            var c = FakeBus.last("org.webosphoenix.clipboard", "/getSettings");
            verify(c !== null);
            FakeBus.reply("org.webosphoenix.clipboard", "/getSettings", { returnValue: true, settings: { enabled: true, keyboardKey: true } });
            verify(kb.clipboardKeyShown);
            // Asked again each time it comes up.
            im.active = false;
            show();
            FakeBus.reply("org.webosphoenix.clipboard", "/getSettings", { returnValue: true, settings: { enabled: false } });
            verify(!kb.clipboardKeyShown);
        }
    }
}
