// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the virtual keyboard (VirtualKeyboard.qml) types into, and how: the
// one interface between the keyboard and the system it runs in (GAPS V5).
// The keyboard calls these; a host overrides them:
//
//   * the simulator's (Shell.qml, `ime.host`): the field is a text field of
//     the shell's or a web view's page, in the same process, and the keys
//     reach it as key events and input method commits (KeyInjector), as
//     LunaSysMgr's IME delivered them (SysmgrIMEModel::sendKeyEvent,
//     IMEController::commitText);
//   * a device's (Phoenix/Keyboard/MaliitKeyboard.qml): the keyboard is a
//     Maliit input method plugin inside maliit-server
//     (services/keyboard), and the field is in an app's own process,
//     reached through MAbstractInputMethodHost (sendCommitString,
//     sendKeyEvent, sendPreeditString, notifyImInitiatedHiding,
//     surroundingText) and the Wayland text protocol.
//
// The other way, the host sets the keyboard's own properties: `shown` (show
// or hide), `editorState` (the field: PalmIME::EditorState {type, actions,
// flags, enterKeyLabel, autoCap}; KeyboardKeymap.js FieldType), calls
// `inputClientChanged()` when another field takes the keyboard, and the
// settings (layouts, Text Assist, sounds, style).
//
// Everything is a no-op here: a keyboard without a host (the tests' own
// keyboards) only emits its signals (keyTyped, textCommitted, ...), which
// it does with a host too.

import QtQuick

QtObject {
    // A key: a character's code (KeyboardKeymap.js, Qt's key codes for
    // Latin-1) or a Qt key (Backspace, Return, Tab, the arrows: cursor
    // control, V4), with Qt modifiers (Shift with the arrows selects).
    // What it types: shell/native/keytext.h.
    function sendKey(key, modifiers) {}

    // Text put in at the cursor in one go: a candidate, a correction,
    // ".com", an emoji, a clip, dictation's words.
    function commitText(text) {}

    // Text being composed at the cursor, shown in the field but not yet in
    // it ("" ends it). Phoenix's keyboards type straight into the field, as
    // the original's did (keyboard-efigs had no composition): none of them
    // composes yet; it is here for one that will (a language whose letters
    // are built from several keys), and both hosts carry it.
    function setPreedit(text) {}

    // The hide key (IMEController::hideIME): the field gives up the keyboard.
    function hideKeyboard() {}

    // A key sound: "key", "space", "backspace", "return"
    // (SysmgrIMEModel::keyDownAudioFeedback), played as the system's
    // feedback sounds are (SoundPolicy.forFeedback).
    function feedback(name) {}

    // The keyboard's height changed while it is up (a size from the hide
    // key's hold, the candidate bar coming or going): the space it takes at
    // the bottom of the screen (the negative space; on a device the input
    // panel's height, which luna-surfacemanager makes room for).
    function panelHeight(height) {}

    // The field's text around the cursor, {text, cursor} (an input method's
    // ImSurroundingText and ImCursorPosition), or null when it cannot tell
    // (GAPS V3: prediction from the field's words, the sentence's start for
    // auto-capitals, V1).
    function surroundingText() { return null; }
}
