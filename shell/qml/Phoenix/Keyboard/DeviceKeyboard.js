// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the keyboard needs from a device, in its own terms (GAPS V5):
//
//  * the field, as Maliit has it (PhoenixInputMethod: Maliit's
//    TextContentType and EnterKeyType, hiddenText, autoCapitalization;
//    maliit-framework-webos common/maliit/namespace.h:44-95, set from the
//    app's Wayland text model, connection/
//    minputcontextwestonimprotocolconnection.cpp:705-758, 1296-1320), as
//    the keyboard's PalmIME::EditorState (KeyboardKeymap.js FieldType);
//  * its settings, the system preferences Settings > Text Assist writes
//    (com.webos.service.systemservice getPreferences): the same keys, rules
//    and defaults as the simulator's runtime reads them for the shell
//    (runtime/phoenix-runtime.js keyboardPrefs, tapSounds, keyboardCombos,
//    installedKeyboards, keyboardSettings, keyboardIdInUse, keyboardInUse,
//    textAssist, dictionaryWords, removedWords: lines 5244-5363), and what
//    the keyboard writes back (the keyboard in use, a word added to the
//    personal dictionary: phoenix-runtime.js 6946-6975).

.pragma library

// ---- The field ----------------------------------------------------------------------
// Maliit::TextContentType, Maliit::EnterKeyType (namespace.h:44-95).
var ContentType = { FreeText: 0, Number: 1, PhoneNumber: 2, Email: 3, Url: 4, Custom: 5 };
var EnterKeyType = { Default: 0, Return: 1, Done: 2, Go: 3, Send: 4, Search: 5, Next: 6, Previous: 7 };
// KeyboardKeymap.js FieldType (PalmIME::FieldType).
var FieldType = { Text: 0, Password: 1, Search: 2, Email: 4, Number: 5, Phone: 6, URL: 7 };

// The return key's label for the field's enter key type ("" is the
// keyboard's own, Enter), with tr for translation (qsTr from QML).
function enterKeyLabel(enterKeyType, tr) {
    tr = tr || function (s) { return s; };
    switch (enterKeyType) {
    case EnterKeyType.Done: return tr("Done");
    case EnterKeyType.Go: return tr("Go");
    case EnterKeyType.Send: return tr("Send");
    case EnterKeyType.Search: return tr("Search");
    case EnterKeyType.Next: return tr("Next");
    case EnterKeyType.Previous: return tr("Previous");
    }
    return "";
}

// PalmIME::EditorState {type, actions, flags, enterKeyLabel, autoCap} for
// the field m {contentType, enterKeyType, hiddenText, autoCapitalization}.
// A field hiding its text is a password (Maliit's hiddenText: the text
// model's password purpose or hidden-text hints); Maliit's custom purposes
// (a date, a name) are text. Auto-capitals (GAPS V1): a sentence's start
// when the app's field asks (the text model's auto-capitalization hint:
// Chromium's for a field without autocapitalize="off"), in text and search
// fields only, as the simulator's runtime decides for a page
// (phoenix-runtime.js autoCapFor).
function editorState(m, tr) {
    m = m || {};
    var type = FieldType.Text;
    if (m.hiddenText)
        type = FieldType.Password;
    else if (m.contentType === ContentType.Number)
        type = FieldType.Number;
    else if (m.contentType === ContentType.PhoneNumber)
        type = FieldType.Phone;
    else if (m.contentType === ContentType.Email)
        type = FieldType.Email;
    else if (m.contentType === ContentType.Url)
        type = FieldType.URL;
    else if (m.enterKeyType === EnterKeyType.Search)
        type = FieldType.Search;
    var words = type === FieldType.Text || type === FieldType.Search;
    return { type: type, actions: 0, flags: 0, enterKeyLabel: enterKeyLabel(m.enterKeyType, tr),
             autoCap: words && m.autoCapitalization ? "sentences" : "none" };
}

// ---- The settings -----------------------------------------------------------------------
// The preference keys the keyboard reads.
var prefKeys = ["x_palm_virtualkeyboard_prefs", "x_palm_virtualkeyboard_settings", "x_palm_textinput",
                "keyboardNumberRow", "keyboardStyle", "systemSounds"];

function _object(v) {
    if (typeof v === "string") {
        try { v = JSON.parse(v); } catch (e) { v = null; }
    }
    return v && typeof v === "object" ? v : {};
}
// x_palm_virtualkeyboard_prefs, a JSON string (VirtualKeyboardPreferences.cpp:233, 325).
function keyboardPrefs(p) { return _object((p || {}).x_palm_virtualkeyboard_prefs); }
function keyboardSettings(p) { return _object((p || {}).x_palm_virtualkeyboard_settings); }
function textInput(p) { return _object((p || {}).x_palm_textinput); }

// "Keyboard clicks" (TapSounds) and "System sounds".
function tapSounds(p) { return keyboardPrefs(p).TapSounds !== false; }
function systemSounds(p) { return (p || {}).systemSounds !== false; }

var LAYOUTS = ["qwerty", "qwertz", "azerty"];
var LANGUAGES = ["en", "de", "fr", "none"];
function combo(c) {
    if (!c || typeof c !== "object")
        return null;
    var layout = String(c.layout || "").toLowerCase(), language = String(c.language || "").toLowerCase();
    return LAYOUTS.indexOf(layout) >= 0 && LANGUAGES.indexOf(language) >= 0 ? { layout: layout, language: language } : null;
}
// Settings > Text Assist > Keyboards: [{layout, language}] turned on.
function keyboards(p) {
    var list = (keyboardPrefs(p).keyboards || []).map(combo).filter(Boolean);
    return list.length ? list : [{ layout: "qwerty", language: "en" }];
}
// The one in use (the language key's choice).
function keyboard(p) {
    var c = combo(keyboardSettings(p)), list = keyboards(p);
    for (var i = 0; c && i < list.length; ++i)
        if (list[i].layout === c.layout && list[i].language === c.language)
            return list[i];
    return list[0];
}
// GAPS V7: the keyboards installed, in the user's order, and the one in use.
var KEYBOARD_IDS = ["classic", "phoenix", "ose"];
function installedKeyboards(p) {
    var inst = keyboardPrefs(p).installed;
    var list = (Array.isArray(inst) ? inst : []).filter(function (id, i, all) {
        return KEYBOARD_IDS.indexOf(id) >= 0 && all.indexOf(id) === i;
    });
    return list.length ? list : ["classic"];
}
function keyboardId(p) {
    var id = keyboardSettings(p).keyboardId, list = installedKeyboards(p);
    return list.indexOf(id) >= 0 ? id : list[0];
}

var DICTIONARY_WORD = /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ']*$/;
function dictionaryWords(ti) {
    return (Array.isArray(ti.userWords) ? ti.userWords : []).filter(function (w) {
        return typeof w === "string" && w.length <= 48 && DICTIONARY_WORD.test(w);
    });
}
function removedWords(ti) {
    var out = {}, r = ti.removedWords && typeof ti.removedWords === "object" ? ti.removedWords : {};
    Object.keys(r).forEach(function (w) { if (typeof r[w] === "number" && r[w] > 0) out[w.toLowerCase()] = r[w]; });
    return out;
}
// Settings > Text Assist, as the keyboard takes it (Shell.qml's _assistPrefs).
function textAssist(p) {
    var kb = keyboardPrefs(p), ti = textInput(p);
    var shortcuts = {};
    (Array.isArray(ti.shortcuts) ? ti.shortcuts : []).forEach(function (s) {
        if (s && typeof s.shortcut === "string" && s.shortcut && typeof s.text === "string" && s.text)
            shortcuts[s.shortcut.toLowerCase()] = s.text;
    });
    return { suggestions: kb.WordSuggestions !== false, autoCorrect: kb.AutoCorrect !== false,
             swipe: kb.SwipeTyping !== false, spaces2period: kb.spaces2period !== false,
             emojiSuggestions: kb.EmojiSuggestions !== false,
             forgetWords: typeof kb.ForgetWords === "number" ? kb.ForgetWords : 0,
             shortcuts: shortcuts, shortcutsOn: ti.shortcutChecking !== "off",
             userWords: dictionaryWords(ti), removedWords: removedWords(ti) };
}
// Settings > Text Assist > Number row, Keyboard style.
function numberRow(p) { return !!(p || {}).keyboardNumberRow; }
function keyboardStyle(p) {
    var s = (p || {}).keyboardStyle;
    return ["auto", "black", "touchpad"].indexOf(s) >= 0 ? s : "auto";
}

// The preferences seen so far, with a getPreferences reply's keys.
function mergePrefs(prefs, reply) {
    var out = {}, k;
    for (k in prefs || {})
        out[k] = prefs[k];
    if (reply && typeof reply === "object")
        prefKeys.forEach(function (key) { if (reply[key] !== undefined) out[key] = reply[key]; });
    return out;
}

// ---- What the keyboard writes ----------------------------------------------------------
// setPreferences for the keyboard in use: the language key's {layout,
// language} or the globe key's keyboard id (phoenix-runtime.js 6946-6961).
function keyboardChoice(p, choice) {
    choice = choice || {};
    var c = combo(choice.keyboard) || combo(keyboardSettings(p)) || keyboard(p);
    var id = installedKeyboards(p).indexOf(choice.keyboardId) >= 0 ? choice.keyboardId : keyboardId(p);
    return { x_palm_virtualkeyboard_settings: JSON.stringify({ layout: c.layout, language: c.language, keyboardId: id }) };
}
// setPreferences for "Add" in the candidate bar, or null when the word is
// not one or is there already (phoenix-runtime.js 6964-6973).
function addWord(p, word) {
    var w = String(word || "").trim();
    if (!DICTIONARY_WORD.test(w))
        return null;
    var ti = textInput(p), words = dictionaryWords(ti);
    if (words.some(function (x) { return x.toLowerCase() === w.toLowerCase(); }))
        return null;
    var next = {};
    Object.keys(ti).forEach(function (k) { next[k] = ti[k]; });
    next.userWords = words.concat([w]);
    return { x_palm_textinput: next };
}
