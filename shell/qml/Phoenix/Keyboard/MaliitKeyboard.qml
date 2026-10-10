// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix keyboard on a device (GAPS V5): the shell's own keyboard,
// VirtualKeyboard.qml with its key maps, Text Assist, dictation, swipe,
// emoji, clip strip and cursor control, as it is, in maliit-server's input
// panel. services/keyboard (PhoenixInputMethod, the Maliit input method
// plugin) loads this into its window and is `maliit` here: the field's
// state, and what reaches the field. This is the keyboard's host
// (KeyboardHost) on a device, as Shell.qml is in the simulator:
//
//   keys          maliit.sendKey: a character is committed to the app's
//                 field, other keys (Backspace, Return, the arrows of cursor
//                 control) go as key events (shell/native/keytext.h)
//   commits       maliit.commitText (candidates, corrections, emoji, clips,
//                 dictation), maliit.setPreedit
//   hide key      maliit.hideKeyboard: the panel goes
//   height        maliit.setPanelHeight: the panel is the keyboard's height,
//                 which luna-surfacemanager makes room for (the shell's
//                 platformKeyboardHeight, PhoenixViewsRoot.qml)
//   the field     maliit.contentType, enterKeyType, hiddenText,
//                 autoCapitalization -> editorState (DeviceKeyboard.js);
//                 maliit.surroundingText() for prediction and auto-capitals
//                 (V1, V3); clientChanged / cursorMoved: read it again
//
// and, what the keyboard needs of the system, here on the bus (KeyboardBus):
//
//   settings      the system preferences Settings > Text Assist writes
//                 (com.webos.service.systemservice getPreferences, followed)
//   choices       the keyboard in use, a word added: setPreferences; the
//                 globe key to "webOS OSE" switches maliit-server to OSE's
//                 own keyboard (V7)
//   key sounds    audiod's playSound, as the shell plays its feedback sounds
//                 on a device (SoundPolicy.forFeedback; LsmWindowSource.qml
//                 playSound: the file's raw PCM twin, on the pfeedback sink)
//   dictation     Phoenix.Native's Dictation: the microphone, and the
//                 transcriber (org.webosphoenix.transcriber) through
//                 luna-send, as the shell's (V2)
//   clip strip    ClipboardClient over the bus (org.webosphoenix.clipboard)
//   learned words kept by the plugin (maliit.readState / writeState), and
//                 told to com.palm.systemmanager for Settings > Text Assist >
//                 Personal Dictionary (phoenix/learnedWords)
//
// Haptics: on a device every tap's buzz is the shell's (UserActivity sees
// the touches on the input panel too, as the compositor), so none here.
//
// STATUS: written against maliit-framework-webos's and ime-manager's
// sources, tested with a fake input method (shell/tests-device
// tst_maliitkeyboard) and in the plugin over a fake Maliit host
// (keyboard-test); not yet run on a device.

import QtQuick
import QtQuick.Window
import Phoenix.Native
import Phoenix.Shell
import "DeviceKeyboard.js" as DK
import "../Shell/SoundPolicy.js" as Policy

Item {
    id: root

    // The input method (PhoenixInputMethod), or a test's stand-in.
    required property var maliit

    // The screen the panel is at the bottom of.
    readonly property int screenWidth: maliit && maliit.screenWidth > 0 ? maliit.screenWidth : width
    readonly property int screenHeight: maliit && maliit.screenHeight > 0 ? maliit.screenHeight : height
    // As the shell sizes its UI (Shell.qml effectiveDensity, tablet): the
    // keyboard's scale and phone or tablet keyboard follow the same rules.
    property real density: Theme.densityFor(Screen.pixelDensity * 25.4)
    readonly property bool tablet: Theme.tabletLayoutFor(screenWidth, screenHeight, density)
    Binding { target: Theme; property: "u"; value: root.density }
    Binding { target: Theme; property: "tablet"; value: root.tablet }

    // ---- The system --------------------------------------------------------------------
    property alias bus: keyboardBus
    KeyboardBus {
        id: keyboardBus
        appId: (root.maliit && root.maliit.serviceName ? root.maliit.serviceName : "com.webos.service.ime") + ".phoenixKeyboard"
    }
    // The system preferences the keyboard reads (DeviceKeyboard.prefKeys).
    property var prefs: ({})
    function _prefsReply(r) {
        if (!r || r.returnValue === false)
            return;
        var merged = DK.mergePrefs(prefs, r);
        if (JSON.stringify(merged) !== JSON.stringify(prefs))
            prefs = merged;
    }
    function _setPreferences(p) {
        if (!p)
            return;
        prefs = DK.mergePrefs(prefs, p);
        keyboardBus.lunaCall("luna://com.webos.service.systemservice/setPreferences", p, null);
    }

    // Key sounds (SystemSounds.feedback on a device: SoundPolicy picks the
    // file, audiod plays its PCM twin; LsmWindowSource.qml:384-412).
    readonly property var pcmSpec: ({ format: "PA_SAMPLE_S16LE", sampleRate: 44100, channels: 2 })
    property var lastSound: null
    function playFeedback(name) {
        var file = Policy.forFeedback(name, "", { systemSounds: DK.systemSounds(prefs), tapSounds: DK.tapSounds(prefs) });
        lastSound = { name: name, file: file };
        if (file === "")
            return;
        keyboardBus.lunaCall("luna://com.webos.service.audio/playSound",
                             { fileName: file + ".pcm", sink: "pfeedback", format: pcmSpec.format,
                               sampleRate: pcmSpec.sampleRate, channels: pcmSpec.channels }, null);
    }

    // Dictation (GAPS V2): the default command is the device's transcriber.
    Dictation { id: dictationEngine }

    // The clip strip (M6 F2).
    ClipboardClient {
        id: clipboardClient
        source: keyboardBus
        // The Clipboard app: launched by the system (the keyboard goes).
        onOpenAppRequested: {
            root.maliit.hideKeyboard();
            keyboardBus.lunaCall("luna://com.webos.service.applicationmanager/launch", { id: "org.webosphoenix.clipboard" }, null);
        }
    }

    // ---- The keyboard ------------------------------------------------------------------
    property alias keyboard: kb
    VirtualKeyboard {
        id: kb
        objectName: "virtualKeyboard"
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        tablet: root.tablet
        pixelScale: Theme.keyboardScale
        availableWidth: root.screenWidth
        availableHeight: root.screenHeight
        shown: !!root.maliit && root.maliit.active
        editorState: DK.editorState(root.maliit, qsTr)
        dictation: dictationEngine.available ? dictationEngine : null
        clipboard: clipboardClient
        onShownChanged: if (shown) clipboardClient.refreshSettings()

        // Settings > Text Assist (the system preferences).
        numberRow: DK.numberRow(root.prefs)
        keyboardStyle: DK.keyboardStyle(root.prefs)
        tapSounds: DK.tapSounds(root.prefs)
        readonly property var _assistPrefs: DK.textAssist(root.prefs)
        textSuggestions: _assistPrefs.suggestions
        autoCorrect: _assistPrefs.autoCorrect
        swipeTyping: _assistPrefs.swipe
        userShortcuts: _assistPrefs.shortcuts
        shortcutsOn: _assistPrefs.shortcutsOn
        spaces2period: _assistPrefs.spaces2period
        emojiSuggestions: _assistPrefs.emojiSuggestions
        forgetWordsAt: _assistPrefs.forgetWords
        userWords: _assistPrefs.userWords
        removedWords: _assistPrefs.removedWords
        keyboards: DK.keyboards(root.prefs)
        keyboard: DK.keyboard(root.prefs)
        installedKeyboards: DK.installedKeyboards(root.prefs)
        keyboardId: DK.keyboardId(root.prefs)
        onKeyboardSelected: (k) => root._setPreferences(DK.keyboardChoice(root.prefs, { keyboard: k }))
        onKeyboardChosen: (id) => {
            root._setPreferences(DK.keyboardChoice(root.prefs, { keyboardId: id }));
            // webOS OSE's keyboard is another Maliit plugin (V7).
            if (id === "ose")
                root.maliit.switchKeyboard("libplugin-global.so");
        }
        onDictionaryWordAdded: (word) => root._setPreferences(DK.addWord(root.prefs, word))

        // What it keeps: the words it learned, recent emoji and tones.
        onTextAssistDataChanged: wordsSave.restart()
        onEmojiPrefsChanged: root.maliit.writeState("emoji", emojiPrefs)
        onLearnedWordsChanged: keyboardBus.lunaCall("luna://com.palm.systemmanager/phoenix/learnedWords",
                                                    { words: learnedWords }, null)

        host: KeyboardHost {
            function sendKey(key, modifiers) { root.maliit.sendKey(key, modifiers); }
            function commitText(text) { root.maliit.commitText(text); }
            function setPreedit(text) { root.maliit.setPreedit(text); }
            function hideKeyboard() { root.maliit.hideKeyboard(); }
            function feedback(name) { root.playFeedback(name); }
            function panelHeight(height) { root.maliit.setPanelHeight(Math.ceil(height)); }
            function surroundingText() {
                var s = root.maliit.surroundingText();
                return s && typeof s.text === "string" ? { text: s.text, cursor: Number(s.cursor) } : null;
            }
        }
    }
    // The learned words are written a moment after the typing stops (as
    // phoenix-sim keeps them, sim.qml textAssistSave).
    Timer {
        id: wordsSave
        interval: 2000
        onTriggered: root.maliit.writeState("words", kb.textAssistData)
    }

    Connections {
        target: root.maliit
        ignoreUnknownSignals: true
        // IMEController::restartInput: another field's text is read afresh.
        function onClientChanged() { kb.inputClientChanged(); }
        // The cursor moved, or the text around it changed.
        function onCursorMoved() { kb._fieldMoved(); }
    }

    Component.onCompleted: {
        kb.emojiPrefs = maliit.readState("emoji");
        kb.textAssistData = maliit.readState("words");
        maliit.setPanelHeight(Math.ceil(kb.keyboardHeight));
        keyboardBus.lunaSubscribe("luna://com.webos.service.systemservice/getPreferences", { keys: DK.prefKeys }, root._prefsReply);
    }
}
