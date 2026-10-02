// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The virtual keyboard: Open webOS's phone and tablet keyboards
// (openwebos/keyboard-efigs, Apache-2.0: src/PhoneKeyboard.cpp,
// src/TabletKeyboard.cpp, over the key maps in KeyboardKeymap.js), drawn
// with luna-sysmgr's art (images/keyboard-phone/, images/keyboard-tablet/).
//
// The plugin worked in its screen's pixels: the tablet keyboard's art is
// the TouchPad's (1024 wide, "native assets", TabletKeyboard.cpp:471), the
// phone keyboard's is for 480-wide phones of about 250 dpi (ten 48 px keys
// a row; PhoneKeyboard.cpp:100 prefers dpi >= 250), the Pre 3's 1.5x. So
// the keyboard lays itself out and handles touches in those pixels, in
// `frame`, and is scaled into the shell's (pixelScale).
//
// What it does, as the original did:
//  * height: the phone's is 377 px upright, 260 on its side
//    (PhoneKeyboard.cpp:231-232); the tablet's one of four sizes, 340 by
//    default (TabletKeyboard.cpp:245-248), picked from the hide key's long
//    press. The key rows fill it (rows scaled from the art), the rest is
//    padding at the top (setKeyboardHeight).
//  * keys: shift (tap: once, double tap within 500 ms: caps lock, tap
//    again: off), the symbol key (locks the other page until space or
//    return), held keys: space, backspace and arrows repeat (first after
//    350 ms, then every 120 ms; backspace deletes words after 1850 ms or
//    with shift, every 275 ms), others with extended characters pop them up
//    after 350 ms, and slide onto one to type it. Several fingers type in
//    order: a new touch sends the keys still held. Double space types
//    ". " in text fields (ShortcutsHandler.cpp).
//  * the phone shows the key under the finger enlarged above it (popup-bg).
//  * key sounds: "key", "space", "backspace", "return" for the system's
//    feedback player (SysmgrIMEModel::keyDownAudioFeedback).
// Phoenix: cursor control (GAPS V4). Holding the space bar (from when the
// original began repeating it), or sliding along it, turns the keyboard
// into a trackpad: the keys fade, sliding moves the cursor (arrow keys),
// and a second finger down selects (Shift with the arrows). Space no longer
// repeats.
// Phoenix: emoji (GAPS V6). The emoji key beside the space bar in text
// fields opens the emoji page (EmojiPanel): categories, recents, skin tones
// (hold an emoji), search by name typed on the keys. The symbol page's
// emoticon keys still type the original's text emoticons.
// Phoenix: Text Assist (GAPS V2, V3), in place of the XT9 candidate bar
// and trace typing the original had through a licensed engine
// (CandidateBar.cpp; never released). A candidate bar above the keys in text
// fields: the word as typed, the correction the space bar will put in (in
// bold), completions; between words, the next word. Backspace right after a
// correction puts the typed word back. Swipe across the letters to type a
// word (TextAssist.swipe; the other candidates in the bar). The words come
// from TextAssist.js (WordsEnUS.js and what the user types, learned here and
// kept by the shell: textAssistData). Dictation: the bar's microphone.
// Not ported: keyboard combos (language key),
// and the emoticon pictures (/usr/palm/emoticons, not in the Apache-2.0
// images): emoticon keys show their text.

import QtQuick
import "KeyboardKeymap.js" as KM
import "EmojiData.js" as ED
import "TextAssist.js" as TA

Item {
    id: kb

    property bool tablet: false
    // Shell (legacy) pixels per keyboard pixel.
    property real pixelScale: 1
    // The screen the keyboard is for (SysmgrIMEModel::m_availableSpace), in
    // shell pixels.
    property real availableWidth: parent ? parent.width : 0
    property real availableHeight: parent ? parent.height : 0
    // The input field (PalmIME::EditorState: type, actions, flags,
    // enterKeyLabel) and whether to start the next word capitalized.
    property var editorState: ({})
    property bool autoCap: false
    // IMEDataInterface::m_visible: the keyboard is (being) shown.
    property bool shown: false
    // IMEController::isIMEOpened: it takes touches (IMEView::acceptPoint).
    property bool acceptingInput: shown
    // VirtualKeyboardPreferences: tap sounds and double space to period,
    // both on by default (VirtualKeyboardPreferences.cpp:42).
    property bool tapSounds: true
    property bool spaces2period: true
    property string layoutName: "qwerty"
    // Tablet: the keyboard size, -2 to 1 (XS, S, M, L).
    property int keyboardSize: 0

    // sendKeyDownUp: a key press and release for the input field.
    signal keyTyped(int key, int modifiers)
    // Text entered in one go (".com").
    signal textCommitted(string text)
    // The hide key (IMEDataInterface::requestHide).
    signal hideRequested()
    // keyDownAudioFeedback: "key", "space", "backspace" or "return".
    signal feedback(string name)

    // ---- Text Assist (Phoenix, GAPS V2, V3) ---------------------------------------------
    // Settings > Text & Keyboard: suggestions, auto-correction, swipe typing.
    property bool textSuggestions: true
    property bool autoCorrect: true
    property bool swipeTyping: true
    // Dictation: an object with start() / stop() / cancel(), listening,
    // busy, and a signal transcribed(text, error) (Phoenix.Native Dictation);
    // null: no microphone key.
    property var dictation: null
    // What the user typed, learned (TextAssist.userData); the shell keeps it.
    property string textAssistData: ""
    // Settings > Text Assist > Forget Learned Words: when (ms). Words learned
    // before it are dropped (once: the time is kept in textAssistData).
    property real forgetWordsAt: 0
    onForgetWordsAtChanged: _forgetIfAsked()
    function _forgetIfAsked() {
        if (forgetWordsAt > 0 && forgetWordsAt > TA.forgottenAt()) {
            TA.forget(forgetWordsAt);
            _saveTextAssist();
            _refreshCandidates();
        }
    }
    property string _textAssistDataCurrent: ""
    onTextAssistDataChanged: {
        if (textAssistData === _textAssistDataCurrent)
            return;
        _textAssistDataCurrent = textAssistData;
        TA.setUserData(textAssistData);
        _forgetIfAsked();
    }
    // A text field where words are typed (not a password, number, phone,
    // e-mail or web address).
    readonly property bool assistField: {
        var t = KM.editorState(editorState).type;
        return t === KM.FieldType.Text || t === KM.FieldType.Search;
    }
    readonly property bool candidateBarShown: assistField && !emojiOpen && (textSuggestions || swipeTyping || dictation !== null)
    // The bar's height, in keyboard pixels.
    readonly property int candidateBarRows: tablet ? 44 : 54
    readonly property real candidateBarHeight: candidateBarShown ? candidateBarRows * pixelScale : 0
    // [{text, kind}]: kind "typed", "correction" (what space puts in), "word".
    property var candidates: []
    // The word being typed (since the last space or punctuation), the one
    // before it, and whether a sentence ended there.
    property string _word: ""
    property string _prevWord: ""
    property bool _sentenceStart: true
    // The last correction, until the next key: {typed, corrected, sep}.
    property var _lastCorrection: null
    // The typed word was put back after a correction: not corrected again.
    property string _keepWord: ""
    property bool _assistOwnText: false

    function _assistReset() {
        _word = "";
        _prevWord = "";
        _lastCorrection = null;
        _keepWord = "";
        _refreshCandidates();
    }
    function _refreshCandidates() {
        if (!candidateBarShown || !textSuggestions) {
            candidates = [];
            return;
        }
        var prev = _sentenceStart ? (_prevWord ? _prevWord + "." : "") : _prevWord;
        var list = TA.suggest(_word, prev, tablet ? 5 : 3);
        if (!autoCorrect || _word === _keepWord)
            list = list.map(function (c) { return c.kind === "correction" ? { text: c.text, kind: "word" } : c; });
        candidates = list;
    }
    function _saveTextAssist() {
        _textAssistDataCurrent = TA.userData();
        textAssistData = _textAssistDataCurrent;
    }
    // Typed text the keyboard puts in itself (a correction, a candidate).
    function _assistBackspaces(n) {
        for (var i = 0; i < n; ++i)
            kb.keyTyped(KM.Key.Backspace, Qt.NoModifier);
    }
    function _assistCommit(text) {
        _assistOwnText = true;
        kb.textCommitted(text);
        _assistOwnText = false;
    }
    onTextCommitted: if (!_assistOwnText) _assistReset()
    // A word ends (space, punctuation, return): learned, and the next one begins.
    function _endWord(sentence) {
        if (_word) {
            TA.learn(_sentenceStart ? "" : _prevWord, _word);
            _saveTextAssist();
            _prevWord = _word;
        }
        _word = "";
        _keepWord = "";
        _sentenceStart = sentence;
        _refreshCandidates();
    }
    // Every key the keyboard sends: the word being typed follows it.
    function _trackKey(key, modifiers) {
        if (key === KM.Key.Backspace) {
            if (_word)
                _word = _word.slice(0, -1);
            else
                _prevWord = "";
            _lastCorrection = null;
            _refreshCandidates();
            return;
        }
        var ch = key > 0 && key < 0x110000 && !KM.isFunctionKey(key) ? String.fromCharCode(key) : "";
        if (/^[A-Za-z\u00c0-\u024f]$/.test(ch) || (ch === "'" && _word)) {
            _word += (modifiers & Qt.ShiftModifier) ? ch.toUpperCase() : ch.toLowerCase();
            _lastCorrection = null;
            _refreshCandidates();
        } else if (key === KM.Key.Space || key === KM.Key.Return || /^[.,!?;:]$/.test(ch)) {
            var keep = _lastCorrection;
            _endWord(key === KM.Key.Return || /^[.!?]$/.test(ch));
            if (keep && key === KM.Key.Space)
                _lastCorrection = keep;        // backspace now puts the typed word back
        } else if (ch) {
            _word = "";
            _lastCorrection = null;
            _refreshCandidates();
        } else {
            _assistReset();               // arrows, tab: somewhere else in the text
        }
    }
    // Before a space or punctuation: the correction, if any, goes in.
    function _autoCorrect() {
        if (!autoCorrect || !assistField || !_word || _word === _keepWord)
            return;
        var fix = TA.correction(_word);
        if (!fix || fix === _word)
            return;
        _assistBackspaces(_word.length);
        _assistCommit(fix);
        _lastCorrection = { typed: _word, corrected: fix };
        _word = fix;
    }
    // Backspace right after a correction and its space: the typed word back.
    function _undoCorrection() {
        var c = _lastCorrection;
        if (!c || _word)
            return false;
        _assistBackspaces(1 + c.corrected.length);
        _assistCommit(c.typed);
        _word = c.typed;
        _keepWord = c.typed;
        _prevWord = "";
        _lastCorrection = null;
        _refreshCandidates();
        return true;
    }
    // A candidate tapped: it replaces the word being typed, and a space follows.
    function pickCandidate(index) {
        var c = candidates[index];
        if (!c)
            return;
        _makeSound(KM.Key.A);
        _assistBackspaces(_word.length);
        _assistCommit(c.text + " ");
        _word = c.text;
        _lastCorrection = null;
        _endWord(false);
        if (_km.setAutoCap(false))
            _layoutChanged();
    }
    // A swipe's word: after a space unless one is there already.
    function _commitSwipe(words) {
        if (!words.length)
            return;
        var w = words[0].text;
        if (_km.isCapActive() || _sentenceStart)
            w = w.charAt(0).toUpperCase() + w.slice(1);
        var space = _word !== "" || _swipeNeedsSpace;
        if (_word)
            _endWord(false);
        _assistCommit((space ? " " : "") + w);
        _word = w;
        _swipeNeedsSpace = true;
        // The other words it may have been, in the bar.
        candidates = [{ text: w, kind: "correction" }].concat(words.slice(1).map(function (x) {
            var t = _sentenceStart ? x.text.charAt(0).toUpperCase() + x.text.slice(1) : x.text;
            return { text: t, kind: "word" };
        })).slice(0, tablet ? 5 : 3);
        _swipeWords = true;
        if (_km.shiftMode === KM.ShiftMode.Once && _km.setShiftMode(KM.ShiftMode.Off))
            _layoutChanged();
        if (_km.setAutoCap(false))
            _layoutChanged();
    }
    // After a swipe, a candidate replaces the swiped word (and no space follows).
    property bool _swipeWords: false
    property bool _swipeNeedsSpace: false
    function _pickSwipe(index) {
        var c = candidates[index];
        if (!c)
            return;
        _makeSound(KM.Key.A);
        _assistBackspaces(_word.length);
        _assistCommit(c.text);
        _word = c.text;
        candidates = [{ text: c.text, kind: "correction" }].concat(candidates.filter(function (x) { return x.text !== c.text; })).slice(0, tablet ? 5 : 3);
    }
    function candidateTapped(index) {
        if (_swipeWords)
            _pickSwipe(index);
        else
            pickCandidate(index);
    }

    // ---- Dictation (GAPS V2) ------------------------------------------------------------
    // What went wrong last, shown in the bar for a few seconds.
    property string dictationMessage: ""
    Timer { id: dictationMessageTimer; interval: 4000; onTriggered: kb.dictationMessage = "" }
    function toggleDictation() {
        if (!dictation || dictation.busy)
            return;
        _makeSound(KM.Key.A);
        dictationMessage = "";
        if (dictation.listening)
            dictation.stop();
        else
            dictation.start();
    }
    Connections {
        target: kb.dictation
        ignoreUnknownSignals: true
        function onTranscribed(text, error) {
            if (error) {
                kb.dictationMessage = error;
                dictationMessageTimer.restart();
                return;
            }
            text = String(text || "").trim();
            if (!text)
                return;
            var space = kb._word !== "" || kb._swipeNeedsSpace;
            if (kb._sentenceStart || kb._km.isCapActive())
                text = text.charAt(0).toUpperCase() + text.slice(1);
            kb._assistCommit((space ? " " : "") + text);
            kb._word = "";
            kb._prevWord = "";
            kb._sentenceStart = /[.!?]$/.test(text);
            kb._swipeNeedsSpace = true;
            kb._refreshCandidates();
            if (kb._km.setAutoCap(false))
                kb._layoutChanged();
        }
    }

    // ---- Swipe typing ---------------------------------------------------------------------
    property string _swipeId: ""
    property var _swipePath: []          // frame pixels
    // The letter keys' centres (frame pixels) and their width.
    function _letterKeys() {
        var keys = {}, w = 0;
        for (var i = 0; i < _keys.length; ++i) {
            var k = _keys[i];
            if (/^[a-z]$/.test(k.name)) {
                keys[k.name] = { x: k.x + k.w / 2, y: k.y + k.h / 2 };
                w = Math.max(w, k.w);
            }
        }
        return { keys: keys, width: w };
    }
    function _letterAt(x, y) {
        for (var i = 0; i < _keys.length; ++i) {
            var k = _keys[i];
            if (x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h)
                return /^[a-z]$/.test(k.name) ? k.name : "";
        }
        return "";
    }

    // ---- Emoji (Phoenix, GAPS V6) ---------------------------------------------------
    // Recents and each emoji's skin tone, as JSON {recent: [...], tones:
    // {base: toned}}; the shell keeps it between runs.
    property string emojiPrefs: ""
    // The emoji page is up; searching: the keys type the search.
    property bool emojiOpen: false
    property bool emojiSearch: false
    property string emojiQuery: ""
    readonly property int emojiRecentMax: 32
    // The categories, without the emoji this Qt and font cannot draw as one
    // glyph (built when the page first opens: _buildEmoji).
    readonly property var emojiCategories: _emojiShown || []
    property var _emojiShown: null
    property var _emojiRecent: []
    property var _emojiTones: ({})
    // The prefs the state above was last read from or written to.
    property string _emojiPrefsCurrent: ""
    onEmojiPrefsChanged: {
        if (emojiPrefs === _emojiPrefsCurrent)
            return;            // our own write
        _emojiPrefsCurrent = emojiPrefs;
        _loadEmojiPrefs();
    }

    function _loadEmojiPrefs() {
        var p = {};
        try { p = JSON.parse(emojiPrefs || "{}") || {}; } catch (e) { p = {}; }
        _emojiRecent = Array.isArray(p.recent) ? p.recent.filter(function (e) { return typeof e === "string"; }).slice(0, emojiRecentMax) : [];
        _emojiTones = p.tones && typeof p.tones === "object" ? p.tones : ({});
    }
    function _saveEmojiPrefs() {
        _emojiPrefsCurrent = JSON.stringify({ recent: _emojiRecent, tones: _emojiTones });
        emojiPrefs = _emojiPrefsCurrent;
    }
    // What an emoji types: its remembered skin tone, if any.
    function emojiFor(entry) {
        return entry.t && _emojiTones[entry.e] ? _emojiTones[entry.e] : entry.e;
    }
    // Types an emoji and keeps it in the recents. With a base, the emoji is
    // the tone chosen for it (the base itself: no tone), remembered.
    function chooseEmoji(text, base) {
        if (base !== undefined) {
            var tones = Object.assign({}, _emojiTones);
            if (text === base)
                delete tones[base];
            else
                tones[base] = text;
            _emojiTones = tones;
        }
        var recent = _emojiRecent.filter(function (e) { return e !== text; });
        recent.unshift(text);
        _emojiRecent = recent.slice(0, emojiRecentMax);
        _saveEmojiPrefs();
        _makeSound(KM.Key.A);
        kb.textCommitted(text);
    }
    // Sequences of several code points (joined with ZWJ, or a text
    // character made emoji with VS16) are drawn as one glyph only where Qt
    // segments emoji (Qt 6.9: "❤️‍🔥", keycaps; Qt 6.4 draws their parts).
    // Each is measured once; one that comes out wider than an emoji is not
    // offered, nor are tones that do. Measured in small steps after start-up
    // (a phone takes a while for all), finished at once if the page opens
    // first.
    TextMetrics { id: emojiMetrics; font.family: Theme.emojiFontFamily; font.pixelSize: 40 }
    property var _emojiBuild: null       // {c, i, single, out}
    function _emojiDrawable(e) {
        if (_emojiBuild.single <= 0 || (e.length <= 2 && !/[\uFE0F\u200D\u20E3]/.test(e)))
            return true;
        emojiMetrics.text = e;
        return emojiMetrics.advanceWidth <= _emojiBuild.single * 1.3;
    }
    // Measures up to n more emoji; true when all are done.
    function _buildEmoji(n) {
        if (_emojiShown)
            return true;
        if (!_emojiBuild) {
            emojiMetrics.text = "\uD83D\uDE00";
            _emojiBuild = { c: 0, i: 0, single: emojiMetrics.advanceWidth, out: [] };
        }
        var b = _emojiBuild, cats = ED.categories;
        for (var done = 0; b.c < cats.length && !(done >= n); ++done) {
            var cat = cats[b.c];
            if (b.i === 0)
                b.out.push({ key: cat.key, icon: cat.icon, emoji: [] });
            var entry = cat.emoji[b.i];
            if (_emojiDrawable(entry.e)) {
                if (entry.t && !(_emojiDrawable(entry.t[0]) && _emojiDrawable(entry.t[4])))
                    entry = { e: entry.e, n: entry.n };
                b.out[b.c].emoji.push(entry);
            }
            if (++b.i >= cat.emoji.length) {
                b.c++;
                b.i = 0;
            }
        }
        if (b.c < cats.length)
            return false;
        _emojiShown = b.out;
        _emojiBuild = null;
        return true;
    }
    Timer {
        id: emojiBuildTimer
        interval: 0
        repeat: true
        running: true
        onTriggered: if (kb._buildEmoji(60)) stop()
    }
    function openEmoji() {
        _buildEmoji(Infinity);
        _touchEnd();
        emojiSearch = false;
        emojiQuery = "";
        emojiOpen = true;
    }
    function closeEmoji() {
        emojiOpen = false;
        emojiSearch = false;
        emojiQuery = "";
    }
    function startEmojiSearch() {
        emojiQuery = "";
        emojiSearch = true;
    }
    function endEmojiSearch() {
        emojiSearch = false;
        emojiQuery = "";
    }
    // Emoji whose CLDR name has a word starting with each word of the
    // query; names starting with the query first.
    function emojiMatches(query, max) {
        var words = String(query).toLowerCase().trim().split(/\s+/).filter(function (w) { return w !== ""; });
        if (!words.length)
            return [];
        var q = words.join(" ");
        var first = [], rest = [];
        for (var c = 0; c < emojiCategories.length; ++c) {
            var list = emojiCategories[c].emoji;
            for (var i = 0; i < list.length; ++i) {
                var name = list[i].n.toLowerCase();
                var nameWords = name.split(/[\s:,\-]+/);
                var all = words.every(function (w) { return nameWords.some(function (n) { return n.indexOf(w) === 0; }); });
                if (all)
                    (name.indexOf(q) === 0 ? first : rest).push(list[i]);
            }
        }
        return first.concat(rest).slice(0, max || 60);
    }
    // While searching, the keys type the search (not the field).
    function _emojiSearchKey(key) {
        if (key === KM.Key.Backspace)
            emojiQuery = emojiQuery.slice(0, -1);
        else if (key === KM.Key.Space)
            emojiQuery += " ";
        else if (key === KM.Key.Return || key === KM.Key.Emoji)
            endEmojiSearch();
        else if (KM.isUnicodeKey(key))
            emojiQuery += KM.lower(String.fromCharCode(key));
        else
            return false;
        return true;
    }

    // The keyboard is a trackpad (cursor control).
    readonly property bool trackpad: _trackpadId !== ""

    // m_keyboardHeight, in shell pixels: what the keyboard takes from the
    // screen.
    readonly property real keyboardHeight: keysHeight + candidateBarHeight
    // The keys alone (the original keyboard's height).
    readonly property real keysHeight: (_keymapHeight + _topPadding) * pixelScale
    readonly property alias keymap: kb._km
    // For tests: key rectangles in shell pixels, by label.
    function keyRect(label) {
        for (var i = 0; i < _keys.length; ++i) {
            var k = _keys[i];
            if (k.label === label || k.name === label)
                return Qt.rect(k.x * pixelScale, k.y * pixelScale + candidateBarHeight, k.w * pixelScale, k.h * pixelScale);
        }
        return null;
    }

    width: availableWidth
    height: keyboardHeight

    // ---- Art (sizes in pixels, as the plugin read them from the pixmaps) ---------

    readonly property string _art: Theme.assetUrl(tablet ? "keyboard-tablet/" : "keyboard-phone/")
    // keyboard-bg.png: 3x200 phone, 3x340 tablet.
    readonly property int _bgHeight: tablet ? 340 : 200
    // key-*.png: two states stacked, 48x96 phone, 93x140 tablet;
    // key-gray-short.png 93x110 (the tablet's number row).
    readonly property int _keyHalf: tablet ? 70 : 48
    readonly property int _shortKeyHalf: 55
    // 9-tile corners: 22 phone, 13 tablet (PhoneKeyboard.cpp:181, TabletKeyboard.cpp:176).
    readonly property int _corner: tablet ? 13 : 22
    // Phoenix: the phone's bordered keys (shift, delete, the bottom row)
    // trimmed of 3 of their art's 5 black pixels a side, so they stand 4 px
    // apart, not 10, nearer the letters' spacing (the plugin never trimmed
    // the phone's: PhoneKeyboard.cpp:478-479).
    readonly property int cPhoneKeyTrim: 3
    // Phoenix (the owner, 2 October 2026): the phone keyboard upright is
    // 336 px, not the plugin's 377 (PhoneKeyboard.cpp:231-232), and its
    // bordered keys are drawn 4 px short at top and bottom: buttons, not
    // slabs, and more of the app above. Touch areas follow the rows.
    readonly property int cPhoneHeight: 336
    readonly property int cPhoneKeyInsetV: 4
    // Phoenix: the emoji key's face, in outline.
    readonly property color cEmojiKeyColor: "#ffc83d"
    // popup-bg.png 100x90, popup-bg-2.png 100x150, popup-key.png 80x120.
    readonly property int _popupWidth: 100
    readonly property int _popupHeight: 90
    readonly property int _popup2Height: 150
    readonly property int _popupKeyWidth: 80
    readonly property int _popupKeyHalf: 60

    // Extended keys popup (PhoneKeyboard.cpp:69-77, TabletKeyboard.cpp:68-77).
    readonly property int cPopupFontSize: 22
    readonly property int cPopupLeftSide: 11
    readonly property int cPopupRightSide: 10
    readonly property int cPopupSide: 20
    readonly property int cPopupPointerStart: 37
    readonly property int cPopupPointerWidth: 25
    readonly property int cPopupTopToKey: 10
    readonly property int cPopupSingleLineMax: 5
    readonly property int cElipsisFontSize: 14
    // Key repeat (PhoneKeyboard.cpp:61-65).
    readonly property int cFirstRepeatDelay: 350
    readonly property int cFirstRepeatLongDelay: 750
    readonly property int cLetterDeleteRepeatDelay: 120
    readonly property int cWordDeleteRepeatDelay: 275
    readonly property int cWordDeleteDelay: cFirstRepeatDelay + 1500
    // Cursor control: a slide this far along the space bar starts it; the
    // cursor moves a character per quarter key, a line per key row.
    readonly property int cTrackpadSlop: 20
    readonly property int cTrackpadStepX: tablet ? 22 : 12
    readonly property int cTrackpadStepY: _keyHalf
    readonly property int doubleTapDuration: 500     // DOUBLE_TAP_DURATION
    // IMEView::acceptPoint: 40 px above the keys also count for 500 ms
    // after a touch began (IMEView.cpp:289-298).
    readonly property int graceZone: 40

    // Colours (PhoneKeyboard.cpp:87-96, TabletKeyboard.cpp:84-91).
    readonly property color cActiveColor: tablet ? Qt.rgba(20 / 255, 20 / 255, 20 / 255, 1) : "#d2d2d2"
    readonly property color cActiveColorBack: tablet ? "#e2e2e2" : "#d2d2d2"
    readonly property color cDisabledColor: tablet ? Qt.rgba(100 / 255, 100 / 255, 100 / 255, 1) : "#808080"
    readonly property color cDisabledColorBack: tablet ? Qt.rgba(200 / 255, 200 / 255, 200 / 255, 1) : "#808080"
    readonly property color cFunctionColor: "#d2d2d2"
    readonly property color cFunctionColorBack: tablet ? "#000000" : "#d2d2d2"
    readonly property color cBlueColor: Qt.rgba(75 / 255, 151 / 255, 222 / 255, 1)
    readonly property color cBlueColorBack: "#ffffff"
    readonly property color cPopoutTextColor: Qt.rgba(20 / 255, 20 / 255, 20 / 255, 1)
    readonly property color cPopoutTextColorBack: "#e2e2e2"

    // ---- State ---------------------------------------------------------------------

    property var _km: new KM.Keymap(tablet, layoutName)
    onTabletChanged: _reset()
    onLayoutNameChanged: {
        if (_km.setLayoutFamily(layoutName))
            _layoutChanged();
    }
    function _reset() {
        _km = new KM.Keymap(tablet, layoutName);
        _touches = ({});
        _extendedKeys = null;
        _availableSpaceChanged();
    }

    // Keyboard pixels.
    readonly property int _spaceWidth: Math.round(availableWidth / pixelScale)
    readonly property int _spaceHeight: Math.round(availableHeight / pixelScale)
    readonly property bool _landscape: _spaceWidth >= _spaceHeight   // inLandscapeOrientation
    property int _keymapHeight: 0
    property int _topPadding: 0          // m_keyboardTopPading
    property int _requestedHeight: -1
    property real _trim: 0               // m_9tileCorner.m_trimH / m_trimV

    property var _touches: ({})          // id -> Touch
    property var _repeatKey: null
    property string _trackpadId: ""      // the touch moving the cursor
    property var _trackpadAnchor: null   // where the last step was taken
    property real _repeatStartTime: 0
    property var _extendedKeys: null
    property var _extendedFrame: null    // {x, y, w, h}
    property int _extendedPointer: 0
    property int _extendedKeyShown: 0
    property real _lastShiftTime: 0
    property real _lastUnlockTime: 0
    // Shortcuts (double space to period).
    property bool _doubleSpacePeriod: false
    property real _lastSpaceTime: 0
    property int _lastKey: KM.Key.A      // cUnknownKey

    // Bumped on every change to what is drawn (triggerRepaint).
    // What is drawn is rebuilt once per event, after it (paint()).
    property bool _paintQueued: false
    function _triggerRepaint() {
        if (_paintQueued)
            return;
        _paintQueued = true;
        Qt.callLater(_paint);
    }
    function _paint() {
        _paintQueued = false;
        _keys = _computeKeys();
        _pressed = _computePressed();
        _popup = _computePopup();
    }

    // ---- Size (setKeyboardHeight, availableSpaceChanged, requestSize) --------------

    // Tablet: XS, S, M, L (TabletKeyboard.cpp:245-248).
    readonly property var _tabletPresets: [243, Math.floor((340 + 243) / 2), 340, 393]

    function _presetHeight() {
        if (tablet)
            return _tabletPresets[Math.max(0, Math.min(3, 2 + keyboardSize))];
        // PhoneKeyboard.cpp:231-232: 377 upright (Phoenix: cPhoneHeight), 260 on its side.
        return _landscape ? 260 : cPhoneHeight;
    }

    function _availableSpaceChanged() {
        _extendedKeys = null;
        _requestedHeight = _presetHeight();
        _setKeyboardHeight(_requestedHeight);
    }
    onAvailableWidthChanged: Qt.callLater(_availableSpaceChanged)
    onAvailableHeightChanged: Qt.callLater(_availableSpaceChanged)
    onPixelScaleChanged: Qt.callLater(_availableSpaceChanged)
    onKeyboardSizeChanged: if (tablet) { _requestedHeight = _presetHeight(); _setKeyboardHeight(_requestedHeight); }
    Component.onCompleted: {
        _km.setRowHeight(0, tablet ? _shortKeyHalf : _keyHalf);
        _availableSpaceChanged();
        _km.setEditorState(editorState);
        _resetShortcuts(editorState);
        _sentenceStart = true;
        _assistReset();
    }

    function _setKeyboardHeight(height) {
        var width = _spaceWidth, screenHeight = _spaceHeight;
        var rows = _km.rows;
        for (var r = 0; r < rows; ++r)
            _km.setRowHeight(r, tablet && r === 0 ? _shortKeyHalf : _keyHalf);
        if (tablet)
            height = Math.min(height, screenHeight - 28);
        else
            height = Math.max(50, Math.min(height, screenHeight - 28));
        if (height <= 0 || width <= 0)
            return;
        // The art's "ideal" sizes; the padding above the keys scales with them.
        var fullHeight = _bgHeight;
        var fullKeymapHeight = tablet ? Math.floor((2 * _shortKeyHalf + (rows - 1) * 2 * _keyHalf) / 2) : rows * _keyHalf;
        if (fullHeight < fullKeymapHeight)
            fullHeight = fullKeymapHeight;
        var keymapHeight = Math.floor(height * fullKeymapHeight / fullHeight);
        _topPadding = Math.max(0, height - keymapHeight);
        _km.setRect(0, _topPadding, width, keymapHeight);
        _keymapHeight = keymapHeight;
        // TabletKeyboard.cpp:527-540: narrow or small keyboards trim the
        // keys' 9-tile edges; the phone's are never trimmed (:478-479).
        var trim = 0;
        if (tablet) {
            if (width < 480)
                trim = 5;
            else if (width === 480)
                trim = 4;
            else if (keymapHeight >= fullKeymapHeight)
                trim = 0;
            else
                trim = Math.min(4, Math.floor((fullKeymapHeight - keymapHeight) / 40));
        }
        _trim = trim;
        _layoutChanged();
    }

    onShownChanged: {
        // Text Assist starts over: the text around the cursor is not known.
        _swipeNeedsSpace = false;
        _sentenceStart = true;
        _assistReset();
        if (shown) {
            _setKeyboardHeight(_requestedHeight > 0 ? _requestedHeight : _presetHeight());
        } else {
            // visibleChanged(false): back to plain letters.
            closeEmoji();
            _cancelSwipe();
            if (dictation && dictation.listening)
                dictation.cancel();
            _km.setSymbolMode(KM.SymbolMode.Off);
            _km.setShiftMode(KM.ShiftMode.Off);
            _clearExtendedKeys();
            _layoutChanged();
        }
    }

    onEditorStateChanged: {
        // editorStateChanged: the symbol lock ends with the field.
        var changed = false;
        if (_km.symbolMode === KM.SymbolMode.Lock && _km.setSymbolMode(KM.SymbolMode.Off))
            changed = true;
        if (_km.setEditorState(editorState))
            changed = true;
        if (changed)
            _layoutChanged();
        _resetShortcuts(editorState);
    }
    onAutoCapChanged: if (_km.setAutoCap(autoCap)) _layoutChanged()

    function _layoutChanged() {    // keyboardLayoutChanged
        _triggerRepaint();
    }

    // ---- What is drawn -------------------------------------------------------------

    // The keys: the background (every key, by its plain key) and the caps
    // (updateBackground and paint).
    property var _keys: []
    function _computeKeys() {
        var out = [];
        if (_keymapHeight <= 0)
            return out;
        for (var y = 0; y < _km.rows; ++y) {
            for (var x = 0; x < _km.columns; ++x) {
                var z = _km.keyZone(x, y);
                if (z.count <= 0)
                    continue;
                var plain = _km.mapPage(x, y, 0);
                var key = _km.map(x, y);
                if (tablet && key === KM.Key.None)
                    continue;
                out.push({
                    x: z.x, y: z.y, w: z.width, h: z.height, col: x, row: y,
                    background: _keyBackground(x, y, key),
                    caps: (!tablet && plain === KM.Key.None) ? [] : _keyCap({ x: z.x, y: z.y, w: z.width, h: z.height }, x, y, key, 0),
                    ellipsis: _extendedKeys !== null && _km.extendedChars(x, y) !== null,
                    label: _km.displayString(key, true),
                    name: key === KM.Key.Space ? "Space" : KM.isFunctionKey(key) ? _km.displayString(key, true) : String.fromCharCode(key).toLowerCase()
                });
            }
        }
        return out;
    }

    // getKeyBackground: phone by the plain key's kind (letters white,
    // function keys black, others gray; PhoneKeyboard.cpp:1364-1382), the
    // tablet's number row short gray and shift by its mode
    // (TabletKeyboard.cpp:1488-1504).
    function _keyBackground(x, y, key) {
        if (tablet) {
            if (y === 0)
                return "key-gray-short.png";
            if (key === KM.Key.Shift)
                return _km.shiftMode === KM.ShiftMode.CapsLock ? "key-shift-lock.png"
                     : _km.shiftMode === KM.ShiftMode.Once ? "key-shift-on.png" : "key-black.png";
        }
        var plain = _km.mapPage(x, y, 0);
        // Phoenix: the phone's bordered keys in charcoal (key-charcoal.png,
        // tools/keyboard-charcoal.py) where the plugin drew key-black.png /
        // key-gray.png (the same art: a near-black face in a grey rim).
        var bordered = tablet ? null : "key-charcoal.png";
        if (KM.isFunctionKey(plain) && !KM.isTextShortcutKey(plain))
            return bordered || "key-black.png";
        return KM.isLetter(plain) ? "key-white.png" : (bordered || "key-gray.png");
    }
    function _keyHalfFor(bg) { return bg === "key-gray-short.png" ? _shortKeyHalf : _keyHalf; }

    // ---- Key caps (drawKeyCap) ---------------------------------------------------------
    // use: 0 unpressed, 1 pressed, 2 preview (phone popup), 3 extended.

    TextMetrics { id: metrics; font.family: Theme.fontFamily }
    function _textWidth(text, size, bold) {
        metrics.font.pixelSize = size;
        metrics.font.bold = bold;
        metrics.text = text;
        return metrics.advanceWidth;
    }

    function _boost(s) { return s.length === 1 && ".,;:'\"".indexOf(s) >= 0; }

    function _keyIcon(key) {     // getPixmapForKey
        switch (key) {
        case KM.Key.Shift:
            switch (_km.shiftMode) {
            case KM.ShiftMode.Once: return "icon-shift-on.png";
            case KM.ShiftMode.CapsLock: return "icon-shift-lock.png";
            }
            return _km.autoCap ? "icon-shift-on.png" : "icon-shift.png";
        case KM.Key.Backspace: return "icon-delete.png";
        case KM.Key.Hide: return "icon-hide-keyboard.png";
        }
        return "";
    }
    // icon-*.png sizes: shift 50x50, delete 50x38, hide 50x44.
    function _iconSize(icon) {
        return icon === "icon-delete.png" ? { w: 50, h: 38 } : icon === "icon-hide-keyboard.png" ? { w: 50, h: 44 } : { w: 50, h: 50 };
    }

    // Draw ops for a cap: {text, x, y, w, h, size, bold, color, back, align}
    // or {icon, x, y, w, h}.
    function _keyCap(r, cx, cy, key, use) {
        var ops = [];
        var loc = { x: r.x, y: r.y, w: r.w, h: r.h - 4 };   // location.setBottom(bottom - 4)
        if (key === KM.Key.Emoji) {  // Phoenix: a face drawn in outline, centred (EmojiFace)
            var d = Math.round(Math.min(loc.w, loc.h) * (use === 2 ? 0.55 : 0.45));
            return [{ face: true, x: loc.x + Math.floor((loc.w - d) / 2), y: loc.y + Math.floor((loc.h - d) / 2), w: d, h: d }];
        }
        var useWhite = use === 0 || use === 1;
        var extraLarge = !tablet && (use === 1 || use === 2);
        if (tablet && use === 1)
            loc.y += 2;                                          // pressed: 2 px lower
        var activeColor = tablet ? cActiveColor : (useWhite ? cActiveColor : cPopoutTextColor);
        var activeBack = tablet ? cActiveColorBack : (useWhite ? cActiveColorBack : cPopoutTextColorBack);
        var mainColor = activeColor, mainBack = activeBack;
        var altColor = cDisabledColor, altBack = cDisabledColorBack;
        var capitalize = _km.isCapOrAutoCapActive();
        var text = "", altText = "";
        var twoH = false, twoV = false, useTwo = false;
        if (key === KM.Key.Space) {
            text = "";                                           // no candidate bar
        } else if (KM.isUnicodeKey(key)) {
            var plain = _km.mapPage(cx, cy, 0), alt = _km.mapPage(cx, cy, 1);
            var c = String.fromCharCode(key);
            if (plain !== alt && alt !== KM.Key.None) {
                if (tablet) {
                    twoH = cy === 0 && !KM.isFunctionKey(plain);
                    twoV = !KM.isFunctionKey(plain) && cy > 0 && !KM.isLetter(plain);
                } else {
                    useTwo = twoV = !KM.isFunctionKey(plain) && !KM.isLetter(plain);
                }
                if (twoH || twoV) {
                    if (key === plain) {
                        text = capitalize ? String.fromCharCode(plain) : KM.lower(String.fromCharCode(plain));
                        altText = KM.lower(String.fromCharCode(alt));
                    } else {
                        mainColor = cDisabledColor; mainBack = cDisabledColorBack;
                        altColor = activeColor; altBack = activeBack;
                        text = KM.lower(String.fromCharCode(plain));
                        altText = capitalize ? String.fromCharCode(alt) : KM.lower(String.fromCharCode(alt));
                    }
                } else {
                    text = capitalize ? c : KM.lower(c);
                }
            } else {
                text = capitalize ? c : KM.lower(c);
            }
        } else {
            var emoticonGraphic = KM.isEmoticonKey(key) && (!tablet || (_km.editorState.flags & KM.FieldFlags.Emoticons));
            text = _km.displayString(key, false);
            if (emoticonGraphic || text === "") {
                var icon = _keyIcon(key);
                if (icon !== "") {
                    var m = 2;
                    var box = { x: loc.x + m, y: loc.y + m, w: loc.w - 2 * m, h: loc.h - 2 * m };
                    var s = _iconSize(icon);
                    // drawCenteredPixmap: shrunk to fit, else centred at size.
                    var w = s.w, h = s.h;
                    if (h > box.h || w > box.w) {
                        if (h * box.w > box.h * w) { w = Math.floor(box.h * s.w / s.h); h = box.h; }
                        else { h = Math.floor(box.w * s.h / s.w); w = box.w; }
                    }
                    // Its @2x / @3x art on a denser screen (Theme.variant).
                    ops.push({ icon: String(Theme.variant(_art + icon, pixelScale)), x: box.x + Math.floor((box.w - w) / 2), y: box.y + Math.floor((box.h - h) / 2), w: w, h: h });
                }
                // The emoticon pictures are not in the Apache-2.0 art: their text.
                if (!emoticonGraphic)
                    text = "";
            }
        }
        if (text.length === 0)
            return ops;

        var bold = extraLarge;
        var forceAlignHCenter = false;
        var height = loc.h;
        var fontSize = extraLarge ? 32 : 24;
        if (tablet && !twoV && !twoH && !KM.isFunctionKey(key))
            fontSize = 26;
        var centerOffset = 1;
        if (!tablet && useTwo && use === 2) { twoH = true; centerOffset = 2; }
        if (tablet && twoV && Math.floor(height / 3) < fontSize - 2) { twoH = true; centerOffset = 2; }
        if (Math.floor(height / 2) < fontSize)
            fontSize = Math.floor((height + 1) / 2) + (extraLarge ? 4 : 0);
        if (text.length > 1) {
            if (!extraLarge)
                bold = KM.isFunctionKey(key) && !KM.isTextShortcutKey(key);
            fontSize = Math.min(fontSize, 22);
            var gap;
            while ((gap = Math.ceil(_textWidth(text, fontSize, bold)) + 16 - loc.w) > 0 && fontSize > 1) {
                forceAlignHCenter = true;
                fontSize -= Math.max(1, Math.floor(gap / text.length));
            }
            if (gap > -8)
                forceAlignHCenter = true;
        }
        var ac = activeColor;
        function fsize(t, color) {   // font_size(): 75% for the inactive half
            return !Qt.colorEqual(color, ac) ? Math.floor(fontSize * 75 / 100) : (_boost(t) ? fontSize + 2 : fontSize);
        }
        if (twoH) {
            if (Qt.colorEqual(mainColor, activeColor)) { loc.x += 4; loc.w -= 9; loc.y += 1; }
            else { loc.x += 5; loc.w -= 9; loc.y += 1; }
            if (!_landscape)
                fontSize -= 1;
            var half = Math.floor(loc.w / 2);
            ops.push({ text: text, x: loc.x + half - centerOffset, y: loc.y, w: half, h: loc.h, size: fsize(text, mainColor), bold: bold, color: mainColor, back: mainBack, align: "center" });
            ops.push({ text: altText, x: loc.x + centerOffset, y: loc.y, w: half, h: loc.h, size: fsize(altText, altColor), bold: bold, color: altColor, back: altBack, align: "center" });
        } else if (twoV) {
            var boxheight = Math.floor(loc.h / 3);
            var bottom = loc.y + loc.h - 1;
            ops.push({ text: text, x: loc.x, y: bottom - boxheight - 10 + (_boost(text) ? -2 : 0), w: loc.w, h: boxheight, size: fsize(text, mainColor), bold: bold, color: mainColor, back: mainBack, align: "center" });
            ops.push({ text: altText, x: loc.x, y: loc.y + 10, w: loc.w, h: boxheight, size: fsize(altText, altColor), bold: bold, color: altColor, back: altBack, align: "center" });
        } else if (tablet && key === KM.Key.Return) {
            // Smaller, bottom right (TabletKeyboard.cpp:1688-1698).
            var rh = Math.floor(height * 80 / 100 + _trim);
            if (forceAlignHCenter)
                ops.push({ text: text, x: loc.x, y: loc.y, w: loc.w, h: rh, size: Math.min(height, fontSize - 2), bold: bold, color: cFunctionColor, back: cFunctionColorBack, align: "bottomHCenter" });
            else
                ops.push({ text: text, x: loc.x, y: loc.y, w: Math.floor(loc.w * 85 / 100 + _trim), h: rh, size: Math.min(height, fontSize - 2), bold: bold, color: cFunctionColor, back: cFunctionColorBack, align: "bottomRight" });
        } else {
            var size = Math.min(height, fontSize);
            var color = mainColor, back = tablet ? mainBack : cFunctionColorBack;
            if (tablet && cy > 0 && KM.isFunctionKey(key) && !KM.isTextShortcutKey(key)) {
                color = cFunctionColor;
                back = cFunctionColorBack;
            } else if (tablet) {
                color = cActiveColor;
                back = cActiveColorBack;
            }
            ops.push({ text: text, x: loc.x, y: loc.y, w: loc.w, h: loc.h, size: size, bold: bold, color: color, back: back, align: "center" });
        }
        return ops;
    }

    // ---- Touches (updateTouch, releaseTouch, touchEvent) ---------------------------------

    function _now() { return Date.now(); }

    function _sameCoord(a, b) {
        if (!a || !b)
            return a === b;
        return a.x === b.x && a.y === b.y;
    }

    function _updateTouch(id, px, py) {
        var now = _now();
        var rectTop = _km.rect.y;
        var tpx = px, tpy = py - rectTop;                 // touchPosition, keymap relative
        if (trackpad) {
            if (String(id) === _trackpadId)
                _moveTrackpad(tpx, tpy);
            else if (_touches[id] === undefined)          // a second finger: selects while down
                _touches[id] = { visible: false, consumed: true, coord: null, first: { x: tpx, y: tpy },
                                 last: { x: tpx, y: tpy }, time: now };
            return;
        }
        var spaceTouch = _touches[id];
        if (spaceTouch && spaceTouch.onSpace && !spaceTouch.consumed && Object.keys(_touches).length === 1
                && Math.abs(tpx - spaceTouch.first.x) > cTrackpadSlop) {
            // Slid along the space bar: cursor control at once.
            spaceTouch.last = { x: tpx, y: tpy };
            _startTrackpad(String(id));
            return;
        }
        // Swipe typing: one finger from a letter across to other letters.
        if (_swipeId !== "") {
            if (String(id) === _swipeId) {
                _swipePath.push({ x: px, y: py });
                swipeTrail.requestPaint();
            }
            return;
        }
        if (spaceTouch && _swipeCanStart(spaceTouch)) {
            spaceTouch.path.push({ x: px, y: py });
            var from = spaceTouch.path[0];
            var startLetter = _letterAt(from.x, from.y), here = _letterAt(px, py);
            if (startLetter && here && here !== startLetter
                    && Math.hypot(px - from.x, py - from.y) > _letterKeys().width * 0.8) {
                _stopRepeat();
                spaceTouch.consumed = true;
                spaceTouch.visible = false;
                _swipeId = String(id);
                _swipePath = spaceTouch.path;
                _triggerRepaint();
                swipeTrail.requestPaint();
                return;
            }
        }
        var ext = _pointToExtendedPopup(tpx, tpy);
        var keyCoord = (!ext.inside && py > rectTop - _topPadding) ? _km.pointToKeyboard(px, py) : null;
        var touches = _touches;
        var newTouch = touches[id] === undefined;
        if (newTouch)
            touches[id] = { visible: true, consumed: false, coord: null, first: { x: tpx, y: tpy }, last: { x: tpx, y: tpy }, time: 0,
                            path: [{ x: px, y: py }] };
        var touch = touches[id];
        var newKey = keyCoord ? _km.map(keyCoord.x, keyCoord.y) : KM.Key.None;
        if (newTouch)
            touch.onSpace = newKey === KM.Key.Space;
        else if (newKey !== KM.Key.Space)
            touch.onSpace = false;
        if (ext.key !== KM.Key.None) {
            if (newTouch)
                _makeSound(ext.key);
            if (ext.key !== _extendedKeyShown || (touch.visible && !_sameCoord(touch.coord, keyCoord))) {
                _extendedKeyShown = ext.key;
                _triggerRepaint();
            }
        } else if (newTouch || !_sameCoord(touch.coord, keyCoord)) {
            _triggerRepaint();
            if (touch.visible && !touch.consumed) {
                if (!_sameCoord(keyCoord, _repeatKey)) {
                    if (!tablet && newTouch && newKey === KM.Key.EmoticonOptions) {
                        // The emoticon key opens its popup at once (:650-656).
                        if (!_setExtendedKeys(keyCoord, true))
                            _extendedKeys = null;
                        touch.consumed = true;
                        _stopRepeat();
                    } else if (newTouch && (_canRepeat(newKey) || (keyCoord && _km.extendedChars(keyCoord.x, keyCoord.y))
                                            || (newKey === KM.Key.Hide && Object.keys(touches).length === 1))) {
                        repeatTimer.interval = newKey === KM.Key.Hide ? cFirstRepeatLongDelay : cFirstRepeatDelay;
                        repeatTimer.restart();
                        _repeatKey = keyCoord;
                        _repeatStartTime = now;
                    } else {
                        _stopRepeat();
                    }
                }
            }
            if (newTouch) {
                // Send pressed keys not already sent out.
                _makeSound(newKey);
                for (var other in touches) {
                    if (other === String(id))
                        continue;
                    var o = touches[other];
                    if (o.visible) {
                        var okey = o.coord ? _km.map(o.coord.x, o.coord.y) : KM.Key.None;
                        if (okey !== KM.Key.Alt && okey !== KM.Key.Shift && okey !== KM.Key.Hide && !o.consumed) {
                            _handleKey(okey, o.last);
                            o.visible = false;
                        }
                        o.consumed = true;
                    }
                }
            }
            if (touch.visible && ((newKey === KM.Key.Alt && !_extendedKeys && _setSymbolKeyDown(true))
                                  || (newKey === KM.Key.Shift && _setShiftKeyDown(true)))) {
                if (_extendedKeys)
                    touch.consumed = true;
            }
        }
        touch.coord = keyCoord;
        if (_extendedKeys && touch.visible !== (ext.key === KM.Key.None)) {
            // Show the keyboard key when not on the extended bar.
            touch.visible = !touch.visible;
            _triggerRepaint();
        }
        touch.last = { x: tpx, y: tpy };
        touch.time = now;
    }

    function _releaseTouch(id) {
        var touch = _touches[id];
        if (!touch)
            return;
        if (String(id) === _swipeId) {
            var lk = _letterKeys();
            var words = TA.swipe(_swipePath, lk.keys, lk.width, tablet ? 5 : 3);
            _cancelSwipe();
            _commitSwipe(words);
            return;
        }
        if (trackpad) {
            if (String(id) === _trackpadId)
                _endTrackpad();
            return;
        }
        if (_extendedKeys) {
            var ext = _pointToExtendedPopup(touch.last.x, touch.last.y);
            if (!ext.inside) {
                var key = touch.coord ? _km.map(touch.coord.x, touch.coord.y) : KM.Key.None;
                if (key === KM.Key.Shift || key === KM.Key.Alt)
                    _handleKey(key, touch.last);
                else if (tablet)
                    _triggerRepaint();
                else if (!_setExtendedKeys(touch.coord, true) && !touch.consumed)
                    _clearExtendedKeys();
                else
                    _triggerRepaint();
                if (tablet)
                    _clearExtendedKeys();
            } else {
                if (ext.key !== KM.Key.None)
                    _handleKey(ext.key, null);
                _clearExtendedKeys();
            }
        } else if (touch.coord && _km.isValid(touch.coord.x, touch.coord.y)) {
            var send = touch.visible && !touch.consumed;
            var k = _km.map(touch.coord.x, touch.coord.y);
            if (k === KM.Key.Alt) {
                _setSymbolKeyDown(false);
            } else if (k === KM.Key.Shift) {
                _setShiftKeyDown(false);
            } else {
                touch.visible = false;         // no longer pressed
                touch.consumed = true;
                if (_km.shiftDown || _km.symbolDown) {
                    // The shift or symbol key held down was used: releasing it
                    // does nothing more.
                    for (var other in _touches) {
                        if (other === String(id))
                            continue;
                        var o = _touches[other];
                        var ok = o.coord ? _km.map(o.coord.x, o.coord.y) : KM.Key.None;
                        if (ok === KM.Key.Alt || ok === KM.Key.Shift)
                            o.consumed = true;
                    }
                }
            }
            if (send)
                _handleKey(k, touch.last);
            _triggerRepaint();
            if (_sameCoord(touch.coord, _repeatKey))
                _stopRepeat();
        }
    }

    // A touch may become a swipe: one finger, from a letter, in a text field,
    // on the letters page, nothing else going on.
    function _swipeCanStart(touch) {
        return swipeTyping && assistField && !touch.consumed && touch.visible && touch.path !== undefined
            && !_extendedKeys && !emojiOpen && !trackpad && _km.symbolMode === KM.SymbolMode.Off
            && Object.keys(_touches).length === 1;
    }
    function _cancelSwipe() {
        _swipeId = "";
        _swipePath = [];
        swipeTrail.requestPaint();
    }

    // Everything released (QEvent::TouchEnd).
    function _touchEnd() {
        _cancelSwipe();
        _endTrackpad();
        _touches = ({});
        _stopRepeat();
        _setShiftKeyDown(false);
        _setSymbolKeyDown(false);
        _triggerRepaint();
    }

    // ---- Cursor control (Phoenix) -----------------------------------------------------------

    function _startTrackpad(id) {
        var touch = _touches[id];
        _stopRepeat();
        touch.consumed = true;           // the space is not typed
        touch.visible = false;
        _trackpadAnchor = { x: touch.last.x, y: touch.last.y };
        _trackpadId = String(id);
        _resetShortcuts();
        _assistReset();
        _triggerRepaint();
    }

    function _endTrackpad() {
        if (!trackpad)
            return;
        _trackpadId = "";
        _trackpadAnchor = null;
        _triggerRepaint();
    }

    // Arrow keys for each step from the anchor; Shift while another finger
    // is down (selecting).
    function _moveTrackpad(tx, ty) {
        var touch = _touches[_trackpadId];
        touch.last = { x: tx, y: ty };
        var mods = Object.keys(_touches).length > 1 ? Qt.ShiftModifier : Qt.NoModifier;
        var nx = Math.trunc((tx - _trackpadAnchor.x) / cTrackpadStepX);
        var ny = Math.trunc((ty - _trackpadAnchor.y) / cTrackpadStepY);
        for (var i = 0; i < Math.abs(nx); ++i)
            _sendKeyDownUp(nx < 0 ? KM.Key.Left : KM.Key.Right, mods);
        for (i = 0; i < Math.abs(ny); ++i)
            _sendKeyDownUp(ny < 0 ? KM.Key.Up : KM.Key.Down, mods);
        _trackpadAnchor = { x: _trackpadAnchor.x + nx * cTrackpadStepX, y: _trackpadAnchor.y + ny * cTrackpadStepY };
    }

    // A flick from the screen's edge started on the keyboard: its touches
    // type nothing (screenEdgeFlickEvent).
    function screenEdgeFlick() {
        for (var id in _touches)
            _touches[id].consumed = true;
    }

    // ---- Keys (handleKey) ------------------------------------------------------------------

    function _handleKey(key, where) {
        if (emojiSearch && _emojiSearchKey(key))
            return;
        var shiftMode = _km.shiftMode, symbolMode = _km.symbolMode;
        var consumeMode = false;
        var qtkey = 0;          // Qt::Key_unknown
        if (KM.isUnicodeKey(key)) {
            qtkey = key;
        } else if (KM.isTextShortcutKey(key)) {
            qtkey = key;
        } else if (KM.isComboKey(key)) {
            // selectKeyboardCombo: no combos.
        } else {
            switch (key) {
            case KM.Key.Backspace:
                qtkey = KM.Key.Backspace;
                break;
            case KM.Key.Return:
                qtkey = key;
                break;
            case KM.Key.Control:     // cKey_SymbolPicker
                qtkey = KM.Key.Control;
                break;
            case KM.Key.Alt:         // cKey_Symbol
                if (_extendedKeys)
                    _clearExtendedKeys();
                else if (_km.symbolMode === KM.SymbolMode.Lock)
                    symbolMode = KM.SymbolMode.Off;
                else {
                    symbolMode = KM.SymbolMode.Lock;
                    shiftMode = KM.ShiftMode.Off;
                }
                break;
            case KM.Key.Shift:
                var now = _now();
                if (_lastUnlockTime + doubleTapDuration > now) {
                    // A quick tap after unlocking: eaten, and the next is like nothing happened.
                    _lastUnlockTime = 0;
                    now = 0;
                } else if (_lastShiftTime + doubleTapDuration > now) {
                    shiftMode = KM.ShiftMode.CapsLock;
                } else if (shiftMode === KM.ShiftMode.CapsLock) {
                    shiftMode = KM.ShiftMode.Off;
                    _lastUnlockTime = now;
                } else if (shiftMode === KM.ShiftMode.Off) {
                    shiftMode = KM.ShiftMode.Once;
                } else {
                    shiftMode = KM.ShiftMode.Off;
                }
                _lastShiftTime = now;
                if (_km.setAutoCap(false))
                    _layoutChanged();
                break;
            case KM.Key.Hide:
                kb.hideRequested();
                break;
            case KM.Key.Emoji:
                openEmoji();
                break;
            case KM.Key.Left:
            case KM.Key.Right:
                qtkey = key;
                break;
            case KM.Key.Up:
            case KM.Key.Down:
            case KM.Key.PageUp:
            case KM.Key.PageDown:
            case KM.Key.Home:
            case KM.Key.End:
                if (tablet)
                    qtkey = key;
                break;
            case KM.Key.Tab:
                qtkey = KM.Key.Tab;      // tabAction(): Tab
                break;
            default:
                if (tablet && KM.isSizeKey(key))
                    kb.keyboardSize = key - KM.Key.ResizeDefault;   // selectKeyboardSize
                break;
            }
        }
        if (qtkey !== 0) {
            consumeMode = true;
            // Text Assist: backspace takes a correction back; a space or
            // punctuation puts one in first.
            if (qtkey === KM.Key.Backspace && _undoCorrection()) {
                qtkey = 0;
                _resetShortcuts();        // the space before it is gone: no ". " on the next
            } else if (qtkey === KM.Key.Space || (KM.isUnicodeKey(key) && key < 128 && ".,!?;:".indexOf(String.fromCharCode(key)) >= 0)) {
                if (_swipeWords && qtkey !== KM.Key.Space) {
                    _swipeWords = false;      // punctuation right after a swiped word
                }
                _autoCorrect();
            }
        }
        if (qtkey !== 0) {
            if (KM.isTextShortcutKey(key)) {
                kb.textCommitted(_km.displayString(key, false));
                _resetShortcuts();
            } else {
                var k = _filterShortcut(qtkey);
                if (KM.isFunctionKey(k)) {
                    if (k === KM.Key.Tab && !tablet)
                        kb.textCommitted("\t");
                    else
                        _sendKeyDownUp(k, _km.shiftDown ? Qt.ShiftModifier : Qt.NoModifier);
                } else if (k > 0 && k < 128) {
                    _sendKeyDownUp(k, _km.isCapActive() ? Qt.ShiftModifier : Qt.NoModifier);   // a basic keystroke
                } else if (_km.isCapActive()) {
                    _sendKeyDownUp(KM.upper(String.fromCharCode(k)).charCodeAt(0), Qt.ShiftModifier);
                } else {
                    _sendKeyDownUp(KM.lower(String.fromCharCode(k)).charCodeAt(0), Qt.NoModifier);
                }
            }
            if (qtkey === KM.Key.Space || qtkey === KM.Key.Return)
                symbolMode = KM.SymbolMode.Off;
        }
        if (consumeMode && _km.shiftMode === KM.ShiftMode.Once)
            shiftMode = KM.ShiftMode.Off;
        var changed = false;
        if (_km.shiftMode !== shiftMode && _km.setShiftMode(shiftMode))
            changed = true;
        if (_km.symbolMode !== symbolMode && _km.setSymbolMode(symbolMode))
            changed = true;
        if (changed)
            _layoutChanged();
    }

    function _sendKeyDownUp(key, modifiers) {
        kb.keyTyped(key, modifiers);
        _swipeWords = false;
        _swipeNeedsSpace = false;
        _trackKey(key, modifiers);
    }

    // ShortcutsHandler: two spaces within a second type ". " (the first
    // space goes back, a period, then right), in text fields, when the
    // preference is on and the word did not end in punctuation.
    function _resetShortcuts(state) {
        if (state !== undefined)
            _doubleSpacePeriod = (KM.editorState(state).type === KM.FieldType.Text) && spaces2period;
        _lastSpaceTime = 0;
        _lastKey = KM.Key.A;
    }
    function _filterShortcut(key) {
        if (!_doubleSpacePeriod)
            return key;
        if (key === KM.Key.Space && _lastSpaceTime) {
            if (_lastSpaceTime + 1000 > _now()) {
                _sendKeyDownUp(KM.Key.Left, Qt.NoModifier);
                _sendKeyDownUp(0x2e, Qt.NoModifier);
                key = KM.Key.Right;
            }
            _lastSpaceTime = 0;
            _lastKey = 0;
        } else if (key === KM.Key.Space && _lastKey !== 0 && !(_lastKey < 128 && ".,;:!?".indexOf(String.fromCharCode(_lastKey)) >= 0)) {
            _lastSpaceTime = _now();
        } else {
            _lastSpaceTime = 0;
            if (key === KM.Key.Backspace)
                _lastKey = KM.Key.A;
            else if (key === KM.Key.Space || !KM.isUnicodeKey(key))
                _lastKey = 0;
            else
                _lastKey = key;
        }
        return key;
    }

    function _setShiftKeyDown(down) {
        if (_km.setShiftKeyDown(down)) {
            _layoutChanged();
            return true;
        }
        return false;
    }
    function _setSymbolKeyDown(down) {
        if (_km.setSymbolKeyDown(down)) {
            _layoutChanged();
            return true;
        }
        return false;
    }

    function _makeSound(key) {
        if (!tapSounds || key === KM.Key.None)
            return;
        kb.feedback(key === KM.Key.Space ? "space" : key === KM.Key.Backspace ? "backspace"
                    : key === KM.Key.Return ? "return" : "key");
    }

    // ---- Repeat and long press (repeatChar) -------------------------------------------------

    function _canRepeat(key) {
        return key === KM.Key.Space || key === KM.Key.Backspace || key === KM.Key.Left || key === KM.Key.Right;
    }
    function _stopRepeat() {
        repeatTimer.stop();
        _repeatKey = null;
        _repeatStartTime = 0;
    }
    Timer {
        id: repeatTimer
        repeat: true
        onTriggered: kb._repeatChar()
    }
    function _repeatChar() {
        if (!_repeatKey || !_km.isValid(_repeatKey.x, _repeatKey.y)) {
            _stopRepeat();
            return;
        }
        var key = _km.map(_repeatKey.x, _repeatKey.y);
        if (key === KM.Key.Space) {
            // Held: cursor control, with one finger on the keyboard.
            var ids = Object.keys(_touches);
            if (ids.length === 1 && _sameCoord(_touches[ids[0]].coord, _repeatKey) && !_touches[ids[0]].consumed)
                _startTrackpad(ids[0]);
            else
                _stopRepeat();
            return;
        }
        if (_canRepeat(key)) {
            _makeSound(key);
            var wordDelete = _km.shiftDown || (_now() - _repeatStartTime > cWordDeleteDelay);
            if (key === KM.Key.Backspace)
                _sendKeyDownUp(KM.Key.Backspace, wordDelete ? Qt.ShiftModifier : Qt.NoModifier);
            else
                _sendKeyDownUp(key, _km.isCapActive() ? Qt.ShiftModifier : Qt.NoModifier);
            var interval = wordDelete ? cWordDeleteRepeatDelay : cLetterDeleteRepeatDelay;
            if (repeatTimer.interval !== interval)
                repeatTimer.interval = interval;
        } else {
            if (_setExtendedKeys(_repeatKey, false)) {
                for (var id in _touches)
                    if (_sameCoord(_touches[id].coord, _repeatKey))
                        _touches[id].consumed = true;
            }
            _stopRepeat();
        }
    }

    // ---- Extended keys popup ------------------------------------------------------------

    function _extendedSpec() {     // getExtendedPopupSpec
        var cells = _extendedKeys ? _extendedKeys.length : 0;
        var lines = cells > cPopupSingleLineMax ? 2 : 1;
        return { cells: cells, lines: lines, lineLength: Math.floor((cells + lines - 1) / lines) };
    }

    function _setExtendedKeys(coord, cancelIfSame) {
        var ext = coord ? _km.extendedChars(coord.x, coord.y) : null;
        if (cancelIfSame && ext === _extendedKeys)
            return false;
        _extendedKeys = ext;
        if (ext) {
            var spec = _extendedSpec();
            var popupHeight = spec.lines > 1 ? _popup2Height : _popupHeight;
            _extendedKeyShown = 0;
            var z = _km.keyZone(coord.x, coord.y);
            _extendedPointer = z.x + Math.trunc(z.width / 2);
            var f = { x: _extendedPointer - Math.trunc(_popupKeyWidth / 2) - cPopupLeftSide,
                      y: z.y - popupHeight + 10,
                      w: cPopupLeftSide + cPopupRightSide + spec.lineLength * _popupKeyWidth,
                      h: popupHeight };
            var keymapRight = _km.rect.x + _km.rect.width - 1;
            if (f.x < 0)
                f.x = 0;
            else if (f.x + f.w - 1 > keymapRight)
                f.x -= f.x + f.w - 1 - keymapRight;
            // Phoenix: wider than the keys (six to a line, on the phone),
            // the plugin's frame went off the left edge, hiding half of the
            // first key; the keys are centred instead, the frame's sides
            // beyond the edges.
            var cellsWidth = spec.lineLength * _popupKeyWidth;
            if (f.w > _km.rect.width)
                f.x = _km.rect.x + Math.floor((_km.rect.width - cellsWidth) / 2) - cPopupLeftSide;
            _extendedFrame = f;
            _triggerRepaint();
            return true;
        }
        return false;
    }

    function _clearExtendedKeys() {
        _extendedKeys = null;
        _triggerRepaint();
    }

    // pointToExtendedPopup: on the popup? and which cell (0 between cells).
    function _pointToExtendedPopup(px, py) {
        var rectTop = _km.rect.y;
        var f = _extendedFrame;
        if (_extendedKeys && f && px >= f.x && px <= f.x + f.w - 1 && py + rectTop >= f.y && py + rectTop <= f.y + f.h - 1) {
            var wx = Math.trunc(px) - f.x - cPopupLeftSide;
            var wy = Math.trunc(py) - f.y + rectTop - cPopupTopToKey;
            var spec = _extendedSpec();
            var x = Math.min(Math.trunc(wx / _popupKeyWidth), spec.lineLength - 1);
            var y = Math.trunc(wy / _popupKeyHalf);
            var index = y === 0 ? x : x + spec.lineLength;
            var key = index >= 0 && index < spec.cells ? _extendedKeys[index] : 0;
            return { inside: true, key: key };
        }
        return { inside: false, key: 0 };
    }

    // The keys pressed now (drawn pressed), and the extended key under a
    // finger.
    property var _pressed: []
    function _computePressed() {
        var out = [];
        if (trackpad)
            return out;
        for (var id in _touches) {
            var t = _touches[id];
            if (_pointToExtendedPopup(t.last.x, t.last.y).inside)
                continue;
            if (!t.visible || !t.coord)
                continue;
            var z = _km.keyZone(t.coord.x, t.coord.y);
            if (z.count <= 0)
                continue;
            var key = _km.map(t.coord.x, t.coord.y);
            if (key === KM.Key.None)
                continue;
            var r = { x: z.x, y: z.y, w: z.width, h: z.height };
            var p = { x: r.x, y: r.y, w: r.w, h: r.h, background: _keyBackground(t.coord.x, t.coord.y, key),
                      caps: _keyCap(r, t.coord.x, t.coord.y, key, 1),
                      ellipsis: _extendedKeys !== null && _km.extendedChars(t.coord.x, t.coord.y) !== null,
                      preview: null };
            if (!tablet && !_extendedKeys && key !== KM.Key.Shift && key !== KM.Key.Alt && key !== KM.Key.Space
                    && key !== KM.Key.Return && key !== KM.Key.Backspace) {
                // The key, enlarged above the finger (PhoneKeyboard.cpp:1211-1218).
                var left = Math.trunc((r.x + (r.x + r.w - 1) - _popupWidth) / 2), top = r.y - _popupHeight;
                var dest = { x: left + Math.trunc((_popupWidth - _popupKeyWidth) / 2), y: top + cPopupTopToKey, w: _popupKeyWidth, h: _popupKeyHalf };
                p.preview = { x: left, y: top, key: dest, caps: _keyCap(dest, t.coord.x, t.coord.y, key, 2) };
            }
            out.push(p);
        }
        return out;
    }

    // The extended keys popup: frame, pointer, cells.
    property var _popup: null
    function _computePopup() {
        if (!_extendedKeys || !_extendedFrame)
            return null;
        var spec = _extendedSpec();
        var f = _extendedFrame;
        // The cell under a finger is highlighted.
        var extendedKey = 0;
        for (var id in _touches) {
            var ext = _pointToExtendedPopup(_touches[id].last.x, _touches[id].last.y);
            if (ext.inside)
                extendedKey = ext.key;
        }
        var cells = [];
        var top = f.y + cPopupTopToKey, left = f.x + cPopupLeftSide;
        for (var k = 0; k < _extendedKeys.length; ++k) {
            var key = _extendedKeys[k];
            var cx = left + (k < spec.lineLength ? k : k - spec.lineLength) * _popupKeyWidth;
            var cy = top + (k < spec.lineLength ? 0 : _popup2Height - _popupHeight);
            var text = _km.displayString(key, false);
            var current = tablet && KM.isSizeKey(key) && _requestedHeight === _tabletPresets[key - KM.Key.ResizeTiny];
            cells.push({ x: cx, y: cy, highlighted: extendedKey === key && key !== 0, text: text,
                         size: text.length < 6 ? cPopupFontSize : cPopupFontSize - 8,
                         color: current ? cBlueColor : cPopoutTextColor, back: current ? cBlueColorBack : cPopoutTextColorBack,
                         bold: current });
        }
        return { x: f.x, y: f.y, w: f.w, h: f.h, twoLines: spec.lines > 1, pointer: _extendedPointer, cells: cells };
    }

    // ---- Drawing -------------------------------------------------------------------

    // A key tile: one half (unpressed above, pressed below) of a key image,
    // 9-tiled with the plugin's corner sizes and trim
    // (NineTileSprites::nineTileDraw, IMEPixmap.cpp:201-275).
    component KeyTile: Item {
        id: tile
        property string source
        property bool pressed: false
        property int half: 48
        property int corner: 22
        property real trim: 0
        property real insetV: 0
        Item {
            y: tile.insetV
            width: tile.width
            height: tile.height - 2 * tile.insetV
            clip: true
            BorderImage {
                source: tile.source
                x: -tile.trim
                y: (tile.pressed ? -tile.half : 0) - tile.trim
                width: parent.width + 2 * tile.trim
                height: parent.height + 2 * tile.trim + tile.half
                border.left: tile.corner
                border.right: tile.corner
                border.top: tile.pressed ? tile.half + tile.corner : tile.corner
                border.bottom: tile.pressed ? tile.corner : tile.half + tile.corner
            }
        }
    }

    // A cap's draw ops. Text is drawn twice when its back colour differs:
    // the back one pixel lower (DoubleDrawRendererT::renderNow,
    // GlyphCache.h:276-293).
    component Caps: Item {
        id: capsItem
        property var ops: []
        Repeater {
            model: capsItem.ops
            delegate: Item {
                id: op
                required property var modelData
                x: modelData.x
                y: modelData.y
                width: modelData.w
                height: modelData.h
                readonly property bool shadow: modelData.text !== undefined && !Qt.colorEqual(modelData.color, modelData.back)
                EmojiFace {
                    visible: op.modelData.face === true
                    anchors.fill: parent
                }
                Image {
                    visible: op.modelData.icon !== undefined
                    anchors.fill: parent
                    source: op.modelData.icon !== undefined ? op.modelData.icon : ""
                    smooth: true
                    mipmap: true
                }
                Repeater {
                    model: op.modelData.text !== undefined ? (op.shadow ? 2 : 1) : 0
                    delegate: Text {
                        required property int index
                        readonly property bool back: op.shadow && index === 0
                        x: 0
                        y: back ? 1 : 0
                        width: op.width
                        height: op.height - (op.shadow ? 1 : 0)
                        text: op.modelData.text
                        color: back ? op.modelData.back : op.modelData.color
                        font.family: op.modelData.emoji ? Theme.emojiFontFamily : Theme.fontFamily
                        font.pixelSize: Math.max(1, op.modelData.size)
                        font.bold: op.modelData.bold
                        horizontalAlignment: op.modelData.align === "bottomRight" ? Text.AlignRight : Text.AlignHCenter
                        verticalAlignment: op.modelData.align === "center" ? Text.AlignVCenter : Text.AlignBottom
                        textFormat: Text.PlainText
                    }
                }
            }
        }
    }

    // Phoenix: the emoji key's cap, a smiling face in outline (no fill),
    // drawn from rectangles so it is sharp at any scale.
    component EmojiFace: Item {
        id: face
        objectName: "emojiFace"
        readonly property real d: Math.min(width, height)
        readonly property real line: Math.max(1.5, d * 0.08)
        Rectangle {
            objectName: "emojiFaceRing"
            anchors.fill: parent
            radius: width / 2
            color: "transparent"
            border.color: kb.cEmojiKeyColor
            border.width: face.line
        }
        Repeater {
            model: [0.34, 0.66]
            delegate: Rectangle {
                required property real modelData
                width: face.line * 1.4
                height: face.line * 1.8
                radius: width / 2
                x: face.d * modelData - width / 2
                y: face.d * 0.36 - height / 2
                color: kb.cEmojiKeyColor
            }
        }
        // The smile: the lower part of a smaller ring.
        Item {
            x: 0
            y: face.d * 0.56
            width: face.d
            height: face.d - y
            clip: true
            Rectangle {
                x: face.d * 0.25
                y: face.d * 0.25 - parent.y
                width: face.d * 0.5
                height: width
                radius: width / 2
                color: "transparent"
                border.color: kb.cEmojiKeyColor
                border.width: face.line
            }
        }
    }

    // The ellipsis on keys with extended characters while a popup shows.
    component Ellipsis: Text {
        property var r
        x: r.x
        y: r.y
        width: r.w - 9 + kb._trim
        height: r.h - 9 + kb._trim
        text: "…"
        color: kb.cActiveColor
        font.family: Theme.fontFamily
        font.pixelSize: kb.cElipsisFontSize
        horizontalAlignment: Text.AlignRight
        verticalAlignment: Text.AlignBottom
    }

    Item {
        id: frame
        objectName: "keyboardFrame"
        visible: !kb.emojiOpen || kb.emojiSearch
        // Above the candidate bar: the extended keys and the phone's key
        // preview rise from the top row over it.
        z: 1
        y: kb.candidateBarHeight
        width: kb._spaceWidth
        height: kb._keymapHeight + kb._topPadding
        scale: kb.pixelScale
        transformOrigin: Item.TopLeft

        // keyboard-bg.png stretched over the keyboard.
        Image {
            anchors.fill: parent
            source: kb._art + "keyboard-bg.png"
            fillMode: Image.Stretch
        }

        Repeater {
            model: kb._keys
            delegate: Item {
                id: keyItem
                required property var modelData
                // Faded while the keyboard is a trackpad.
                opacity: kb.trackpad ? 0.25 : 1
                Behavior on opacity { NumberAnimation { duration: 150 } }
                x: modelData.x
                y: modelData.y
                width: modelData.w
                height: modelData.h
                KeyTile {
                    anchors.fill: parent
                    source: kb._art + keyItem.modelData.background
                    half: kb._keyHalfFor(keyItem.modelData.background)
                    corner: kb._corner
                    trim: kb.tablet ? kb._trim : kb.cPhoneKeyTrim
                    insetV: kb.tablet ? 0 : kb.cPhoneKeyInsetV
                }
                Caps {
                    x: -keyItem.x
                    y: -keyItem.y
                    ops: keyItem.modelData.caps
                }
                Ellipsis {
                    visible: keyItem.modelData.ellipsis
                    r: ({ x: 0, y: 0, w: keyItem.width, h: keyItem.height })
                }
            }
        }

        // A swipe's trail over the keys (Text Assist).
        Canvas {
            id: swipeTrail
            objectName: "swipeTrail"
            anchors.fill: parent
            z: 2
            onPaint: {
                var ctx = getContext("2d");
                ctx.clearRect(0, 0, width, height);
                var pts = kb._swipePath;
                if (kb._swipeId === "" || pts.length < 2)
                    return;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.strokeStyle = Qt.rgba(75 / 255, 151 / 255, 222 / 255, 0.85);
                ctx.lineWidth = kb.tablet ? 10 : 12;
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (var i = 1; i < pts.length; ++i)
                    ctx.lineTo(pts[i].x, pts[i].y);
                ctx.stroke();
            }
        }

        // Pressed keys: the background behind, the pressed half, the cap;
        // on the phone the key enlarged above.
        Repeater {
            model: kb._pressed
            delegate: Item {
                id: pressedItem
                required property var modelData
                Item {
                    x: pressedItem.modelData.x
                    y: pressedItem.modelData.y
                    width: pressedItem.modelData.w
                    height: pressedItem.modelData.h
                    clip: true
                    Image {
                        y: -pressedItem.modelData.y
                        width: parent.width
                        height: frame.height
                        source: kb._art + "keyboard-bg.png"
                        fillMode: Image.Stretch
                    }
                    KeyTile {
                        anchors.fill: parent
                        objectName: "pressedKey"
                        source: kb._art + pressedItem.modelData.background
                        pressed: true
                        half: kb._keyHalfFor(pressedItem.modelData.background)
                        corner: kb._corner
                        trim: kb.tablet ? kb._trim : kb.cPhoneKeyTrim
                    insetV: kb.tablet ? 0 : kb.cPhoneKeyInsetV
                    }
                    Ellipsis {
                        visible: pressedItem.modelData.ellipsis
                        r: ({ x: 0, y: 0, w: pressedItem.modelData.w, h: pressedItem.modelData.h })
                    }
                }
                Caps { ops: pressedItem.modelData.caps }
                Item {
                    visible: pressedItem.modelData.preview !== null
                    objectName: "keyPreview"
                    Image {
                        x: pressedItem.modelData.preview ? pressedItem.modelData.preview.x : 0
                        y: pressedItem.modelData.preview ? pressedItem.modelData.preview.y : 0
                        source: kb._art + "popup-bg.png"
                    }
                    Image {
                        readonly property var d: pressedItem.modelData.preview ? pressedItem.modelData.preview.key : ({ x: 0, y: 0, w: 0, h: 0 })
                        x: d.x
                        y: d.y
                        width: d.w
                        height: d.h
                        source: kb._art + "popup-key.png"
                        sourceClipRect: Qt.rect(0, kb._popupKeyHalf, kb._popupKeyWidth, kb._popupKeyHalf)
                    }
                    Caps { ops: pressedItem.modelData.preview ? pressedItem.modelData.preview.caps : [] }
                }
            }
        }

        // The extended keys popup (paint, PhoneKeyboard.cpp:1227-1284).
        Item {
            id: popup
            objectName: "extendedKeys"
            readonly property var p: kb._popup
            visible: p !== null
            readonly property string img: kb._art + (p && p.twoLines ? "popup-bg-2.png" : "popup-bg.png")
            readonly property int ph: p && p.twoLines ? kb._popup2Height : kb._popupHeight
            readonly property int fillLeft: p ? p.x + kb.cPopupSide : 0
            readonly property int fillRight: p ? p.x + p.w - kb.cPopupSide : 0
            readonly property int pointerLeft: p ? p.pointer - Math.trunc(kb.cPopupPointerWidth / 2) : 0
            readonly property int pointerRight: pointerLeft + kb.cPopupPointerWidth
            Image {   // left side
                x: popup.p ? popup.p.x : 0; y: popup.p ? popup.p.y : 0
                width: kb.cPopupSide; height: popup.ph
                source: popup.img
                sourceClipRect: Qt.rect(0, 0, kb.cPopupSide, popup.ph)
            }
            Image {   // right side
                x: popup.fillRight; y: popup.p ? popup.p.y : 0
                width: kb.cPopupSide; height: popup.ph
                source: popup.img
                sourceClipRect: Qt.rect(kb._popupWidth - kb.cPopupSide, 0, kb.cPopupSide, popup.ph)
            }
            Image {   // fill, left of the pointer
                visible: popup.fillLeft < popup.pointerLeft
                x: popup.fillLeft; y: popup.p ? popup.p.y : 0
                width: Math.max(0, popup.pointerLeft - popup.fillLeft); height: popup.ph
                source: popup.img
                sourceClipRect: Qt.rect(kb.cPopupSide, 0, 1, popup.ph)
            }
            Image {   // fill, right of the pointer
                visible: popup.pointerRight < popup.fillRight
                x: popup.pointerRight; y: popup.p ? popup.p.y : 0
                width: Math.max(0, popup.fillRight - popup.pointerRight); height: popup.ph
                source: popup.img
                sourceClipRect: Qt.rect(kb.cPopupSide, 0, 1, popup.ph)
            }
            Image {   // pointer
                x: popup.pointerLeft; y: popup.p ? popup.p.y : 0
                width: kb.cPopupPointerWidth; height: popup.ph
                source: popup.img
                sourceClipRect: Qt.rect(kb.cPopupPointerStart, 0, kb.cPopupPointerWidth, popup.ph)
            }
            Repeater {
                model: popup.p ? popup.p.cells : []
                delegate: Item {
                    id: cell
                    required property var modelData
                    required property int index
                    objectName: "extendedKey" + index
                    x: modelData.x
                    y: modelData.y
                    width: kb._popupKeyWidth
                    height: kb._popupKeyHalf
                    Image {
                        anchors.fill: parent
                        source: kb._art + "popup-key.png"
                        sourceClipRect: Qt.rect(0, cell.modelData.highlighted ? kb._popupKeyHalf : 0, kb._popupKeyWidth, kb._popupKeyHalf)
                    }
                    Caps {
                        ops: [{ text: cell.modelData.text, x: 0, y: 0, w: kb._popupKeyWidth - 3, h: kb._popupKeyHalf - 2,
                                size: cell.modelData.size, bold: cell.modelData.bold, color: cell.modelData.color,
                                back: cell.modelData.back, align: "center" }]
                    }
                }
            }
        }
    }

    // ---- Touch input (IMEView) ---------------------------------------------------------
    // The keys and the 40 px above them; while the extended keys show, the
    // whole screen (m_hitRegion = the available space).

    property bool _grace: false
    Timer { id: graceTimer; interval: 500; onTriggered: kb._grace = false }

    MultiPointTouchArea {
        id: touchArea
        objectName: "keyboardTouch"
        readonly property bool whole: kb._extendedKeys !== null && kb.parent !== null
        // Over the candidate bar too while the extended keys show: those
        // over it are tapped, not the words under them.
        z: whole ? 2 : 0
        x: whole ? -kb.x : 0
        y: whole ? -kb.y : (kb._grace ? -kb.graceZone * kb.pixelScale : 0)
        width: whole ? kb.parent.width : kb.width
        height: whole ? kb.parent.height : kb.height - y
        enabled: kb.acceptingInput && kb.shown && (!kb.emojiOpen || kb.emojiSearch)
        mouseEnabled: true
        maximumTouchPoints: 10

        function pos(tp) { return touchArea.mapToItem(frame, tp.x, tp.y); }
        onPressed: (points) => {
            // Mapped before the area grows by the grace zone.
            var ps = [];
            for (var i = 0; i < points.length; ++i)
                ps.push(pos(points[i]));
            kb._grace = true;
            graceTimer.restart();
            for (i = 0; i < points.length; ++i)
                kb._updateTouch(points[i].pointId, ps[i].x, ps[i].y);
        }
        onUpdated: (points) => {
            for (var i = 0; i < points.length; ++i) {
                if (kb._touches[points[i].pointId] === undefined)
                    continue;
                var p = pos(points[i]);
                kb._updateTouch(points[i].pointId, p.x, p.y);
            }
        }
        onReleased: (points) => {
            for (var i = 0; i < points.length; ++i) {
                var id = points[i].pointId;
                if (kb._touches[id] !== undefined) {
                    kb._releaseTouch(id);
                    delete kb._touches[id];
                }
            }
            if (Object.keys(kb._touches).length === 0)
                kb._touchEnd();
        }
        onCanceled: kb._touchEnd()
    }

    // The candidate bar above the keys (Text Assist).
    CandidateBar {
        keyboard: kb
        width: parent.width
        height: kb.candidateBarHeight
        visible: kb.candidateBarShown
    }

    // The emoji page over the keys, and while searching, the search above
    // them (Phoenix, GAPS V6).
    EmojiPanel {
        keyboard: kb
        anchors.fill: parent
        visible: kb.emojiOpen && !kb.emojiSearch
    }
    EmojiSearchBar {
        keyboard: kb
        width: parent.width
        y: -height
        visible: kb.emojiOpen && kb.emojiSearch
    }
}
