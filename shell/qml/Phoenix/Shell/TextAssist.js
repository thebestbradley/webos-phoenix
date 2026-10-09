// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Text Assist (GAPS V3): what the keyboard suggests as you type, what it
// corrects, and which word a swipe across the keys meant. A word list for
// the keyboard's language (WordsEnUS.js, WordsDe.js, WordsFr.js, from AOSP
// LatinIME, Apache-2.0; setLanguage) and what the user types themselves,
// learned on the device and nowhere else:
//
//   setLanguage(lang, layout)  "en", "de", "fr" or "none" (no suggestions
//                         or corrections), and the keyboard's layout
//                         ("qwerty", "qwertz", "azerty": which keys are
//                         neighbours)
//   suggest(word, prev)   completions and corrections of the word being
//                         typed; with no word, the next word after `prev`
//   correction(word)      the word the space bar puts in its place, or ""
//   swipe(path, keys)     the words a swipe across the keys may be
//   learn(prev, word)     a word the user typed (after `prev`)
//   setUserShortcuts(map), shortcut(word)
//                         the user's own shortcuts (Settings > Text Assist >
//                         Shortcuts): "omw" for "On my way"
//   setDictionary(words), addToDictionary(word), inDictionary(word)
//                         the personal dictionary (Settings > Text Assist >
//                         Personal Dictionary): words the user added, never
//                         corrected away, suggested as they are written
//   learnedWords(), removeLearned(word, at)
//                         the words it learned that its list lacks, and one
//                         of them dropped (removed from the dictionary)
//
// Corrections are words one edit away (a letter added, missing, swapped
// with its neighbour, or another letter, cheaper when the keys are
// neighbours), or two edits for longer words; the space bar only puts one
// in when the typed word is not a word and the correction is clearly
// better. A swipe is matched by its shape (SHARK2, Kristensson and Zhai
// 2004, "location channel"): the path, resampled, against each candidate
// word's path through its keys' centres; with the word's frequency.

.pragma library
.import "WordsEnUS.js" as WordsEn
.import "WordsDe.js" as WordsDe
.import "WordsFr.js" as WordsFr

// ---- Languages ---------------------------------------------------------------

var LISTS = { en: WordsEn, de: WordsDe, fr: WordsFr };
// The letters words are made of: ASCII and Latin-1's (umlauts, accents,
// ß), and œ.
var LETTER = "A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0152\u0153";
var _wordRe = new RegExp("^[" + LETTER + "']+$");
var _learnRe = new RegExp("^[" + LETTER + "][" + LETTER + "']*$");
// Letters a word may need beyond a-z (missing, or typed as their plain
// letter: "fur" for "für", which is a cheap correction).
var EXTRA_LETTERS = { en: "", de: "\u00e4\u00f6\u00fc\u00df", fr: "\u00e0\u00e2\u00e6\u00e7\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u0153\u00f9\u00fb\u00fc\u00ff" };
// The commonest first words (the list's own for German and French).
var COMMON_NEXT_EN = ["I", "the", "to", "and", "a", "you", "it", "is", "in", "that"];

var _lang = "en";
var _layout = "qwerty";
var _loadedLang = "";
function setLanguage(lang, layout) {
    lang = String(lang || "en").toLowerCase();
    _lang = LISTS[lang] ? lang : "none";
    var l = String(layout || "qwerty").toLowerCase();
    if (l !== _layout) {
        _layout = l;
        _near = null;
    }
}
function language() { return _lang; }
// The word without its accents.
function _fold(w) { return w.split("").map(_base).join(""); }

// Its plain letter ("u" for "ü"; "ss" is two keys, so ß is "s").
function _base(ch) {
    if (ch === "\u00df") return "s";
    if (ch === "\u0153") return "o";
    if (ch === "\u00e6") return "a";
    return ch.normalize("NFD").charAt(0);
}

// ---- The word list -------------------------------------------------------------

var _byLower = null;     // lower-case word -> {w (as written), f}
var _sorted = null;      // lower-case words, sorted (prefix search)
var _known = null;       // words never suggested, left alone
var _shortcuts = null;   // typed (lower) -> correction
var _byFirst = null;     // first letter -> [entry] (swipe candidates)
var _common = [];        // the commonest words (between words)
var _dicts = {};         // lang -> the above, once loaded

function _load() {
    if (_loadedLang === _lang)
        return;
    _loadedLang = _lang;
    var d = _dicts[_lang];
    if (!d) {
        d = _lang === "none" ? { byLower: {}, sorted: [], known: {}, shortcuts: {}, byFirst: {}, common: [] }
                             : _build(LISTS[_lang]);
        _dicts[_lang] = d;
    }
    _byLower = d.byLower; _sorted = d.sorted; _known = d.known;
    _shortcuts = d.shortcuts; _byFirst = d.byFirst; _common = d.common;
}

function _build(Words) {
    _byLower = {};
    _byFirst = {};
    var lines = Words.words.split("\n");
    for (var i = 0; i < lines.length; ++i) {
        var tab = lines[i].indexOf("\t");
        var w = lines[i].substring(0, tab), f = +lines[i].substring(tab + 1);
        var lw = w.toLowerCase();
        if (_byLower[lw])
            continue;                  // "May" after "may": the first (more frequent) wins
        var e = { w: w, lw: lw, f: f };
        _byLower[lw] = e;
        if (_wordRe.test(lw) && lw.length >= 2) {
            // Swiped from its first letter's key ("ü" is on "u").
            var c = _base(lw.charAt(0));
            (_byFirst[c] = _byFirst[c] || []).push(e);
        }
    }
    var known = {};
    Words.known.split("\n").forEach(function (w) { if (w) known[w.toLowerCase()] = true; });
    var shortcuts = {};
    Words.shortcuts.split("\n").forEach(function (l) {
        var t = l.split("\t");
        if (t.length === 2)
            shortcuts[t[0].toLowerCase()] = t[1];
    });
    var common = [];
    for (i = 0; i < lines.length && common.length < 10; ++i) {
        var cw = lines[i].substring(0, lines[i].indexOf("\t"));
        if (_wordRe.test(cw))
            common.push(cw);
    }
    return { byLower: _byLower, sorted: Object.keys(_byLower).sort(), known: known, shortcuts: shortcuts,
             byFirst: _byFirst, common: Words === WordsEn ? COMMON_NEXT_EN : common };
}

// ---- What the user types (learned; kept by the shell) --------------------------

// words: lw -> {w, n}; next: prev -> {lw: n}; forgotten: when the user last
// asked for them to be forgotten (ms).
var _user = { words: {}, next: {}, forgotten: 0, removed: {} };
var USER_WORDS_MAX = 2000;
var NEXT_MAX = 400;

function userData() { return JSON.stringify(_user); }
function setUserData(json) {
    var u = null;
    try { u = JSON.parse(json || "{}"); } catch (e) { u = null; }
    _user = { words: (u && u.words) || {}, next: (u && u.next) || {}, forgotten: (u && u.forgotten) || 0,
              removed: (u && u.removed) || {} };
}
function forget(at) { _user = { words: {}, next: {}, forgotten: at || Date.now(), removed: _user.removed || {} }; }
function forgottenAt() { return _user.forgotten || 0; }
// How many words it has learned.
function learnedCount() { return Object.keys(_user.words).length; }
// The words it learned that are not in its list (typed twice, so words to
// it: isWord), as written, sorted: what Settings > Text Assist > Personal
// Dictionary lists as learned. "the" typed a hundred times is not one.
function learnedWords() {
    _load();
    return Object.keys(_user.words).filter(function (k) {
        return _user.words[k].n >= 2 && !_byLower[k] && !_known[k];
    }).sort().map(function (k) { return _user.words[k].w; });
}
// Settings > Text Assist > Personal Dictionary: a learned word deleted at
// `at` (ms): dropped, with what followed it, once (the time is kept, as
// forget's). Typed again, it is learned again.
function removeLearned(word, at) {
    var lw = String(word || "").toLowerCase();
    if (!lw || !(at > 0) || (_user.removed[lw] || 0) >= at)
        return false;
    _user.removed[lw] = at;
    delete _user.words[lw];
    delete _user.next[lw];
    Object.keys(_user.next).forEach(function (p) { delete _user.next[p][lw]; });
    // Only the latest removals are kept: older ones were applied already.
    var keys = Object.keys(_user.removed);
    if (keys.length > REMOVED_MAX) {
        keys.sort(function (a, b) { return _user.removed[a] - _user.removed[b]; });
        keys.slice(0, keys.length - REMOVED_MAX).forEach(function (k) { delete _user.removed[k]; });
    }
    return true;
}
var REMOVED_MAX = 500;

// ---- The personal dictionary ------------------------------------------------------

// The words the user added (system preference x_palm_textinput.userWords,
// Settings > Text Assist > Personal Dictionary, or "Add" in the candidate
// bar after putting back a word a correction replaced): lw -> as written.
// In every language: they are the user's.
var _dict = {};
function setDictionary(words) {
    _dict = {};
    (words || []).forEach(function (w) {
        w = String(w || "").trim();
        if (w && _learnRe.test(w))
            _dict[w.toLowerCase()] = w;
    });
}
function addToDictionary(word) {
    var w = String(word || "").trim();
    if (!w || !_learnRe.test(w))
        return false;
    _dict[w.toLowerCase()] = w;
    return true;
}
function inDictionary(word) { return !!_dict[String(word || "").toLowerCase()]; }
// The dictionary's words beginning with `lp` that the list lacks.
function _dictEntries(test) {
    var out = [];
    Object.keys(_dict).forEach(function (k) {
        if (test(k) && !_byLower[k] && !(_user.words[k] && _user.words[k].n >= 2))
            out.push({ w: _dict[k], lw: k, f: frequency(k) });
    });
    return out;
}

// A word the user typed (and kept: not corrected away), after `prev`.
function learn(prev, word) {
    _load();
    if (!word || !_learnRe.test(word))
        return;
    var lw = word.toLowerCase();
    var u = _user.words[lw] || { w: word, n: 0 };
    u.n += 1;
    // As the user writes it, unless the list has it capitalized (a name).
    if (!_byLower[lw] || _byLower[lw].w === lw)
        u.w = word === word.toUpperCase() && word.length > 1 ? u.w : (lw === word || !_byLower[lw] ? word : u.w);
    _user.words[lw] = u;
    if (prev) {
        var lp = prev.toLowerCase();
        var n = _user.next[lp] || {};
        n[lw] = (n[lw] || 0) + 1;
        _user.next[lp] = n;
    }
    _trim();
}
function _trim() {
    var keys = Object.keys(_user.words);
    if (keys.length > USER_WORDS_MAX) {
        keys.sort(function (a, b) { return _user.words[a].n - _user.words[b].n; });
        keys.slice(0, keys.length - USER_WORDS_MAX).forEach(function (k) { delete _user.words[k]; });
    }
    var prevs = Object.keys(_user.next);
    if (prevs.length > NEXT_MAX)
        prevs.slice(0, prevs.length - NEXT_MAX).forEach(function (k) { delete _user.next[k]; });
}

// ---- Looking words up -----------------------------------------------------------

// Its frequency (0-255), counting what the user typed; -1: not a word.
function frequency(word) {
    _load();
    var lw = String(word).toLowerCase();
    var e = _byLower[lw], u = _user.words[lw];
    var f = e ? e.f : -1;
    if (u && u.n >= 2)
        f = Math.max(f, 120 + Math.min(80, u.n * 10));
    // A word of the user's dictionary counts as a common one.
    if (_dict[lw])
        f = Math.max(f, 160);
    return f;
}
function isWord(word) {
    _load();
    var lw = String(word).toLowerCase();
    return !!(_byLower[lw] || _known[lw] || _dict[lw] || (_user.words[lw] && _user.words[lw].n >= 2));
}
function _written(lw) {
    if (_dict[lw])
        return _dict[lw];
    var u = _user.words[lw];
    if (u && u.n >= 2 && !_byLower[lw])
        return u.w;
    return _byLower[lw] ? _byLower[lw].w : (u ? u.w : lw);
}
// As typed: "Hello" for "hello" after a capital, "HELLO" in capitals.
function _isUpper(ch) { return ch !== ch.toLowerCase() && ch === ch.toUpperCase(); }
function _match(typed, word) {
    if (typed.length > 1 && typed === typed.toUpperCase() && typed !== typed.toLowerCase())
        return word.toUpperCase();
    if (_isUpper(typed.charAt(0)))
        return word.charAt(0).toUpperCase() + word.slice(1);
    return word;
}

function _lowerBound(prefix) {
    var lo = 0, hi = _sorted.length;
    while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (_sorted[mid] < prefix) lo = mid + 1; else hi = mid;
    }
    return lo;
}
function _completions(lp, max) {
    var out = [];
    for (var i = _lowerBound(lp); i < _sorted.length && _sorted[i].indexOf(lp) === 0; ++i)
        out.push(_byLower[_sorted[i]]);
    Object.keys(_user.words).forEach(function (k) {
        if (k.indexOf(lp) === 0 && !_byLower[k] && _user.words[k].n >= 2)
            out.push({ w: _user.words[k].w, lw: k, f: frequency(k) });
    });
    out = out.concat(_dictEntries(function (k) { return k.indexOf(lp) === 0; }));
    out.sort(function (a, b) { return frequency(b.lw) - frequency(a.lw); });
    return out.slice(0, max);
}

// ---- Corrections ----------------------------------------------------------------

// The letter keys' neighbours on the keyboard's layout (a swapped
// neighbour is a cheaper mistake than any other letter).
var ROWS = { qwerty: ["qwertyuiop", "asdfghjkl", "zxcvbnm"],
             qwertz: ["qwertzuiop", "asdfghjkl", "yxcvbnm"],
             azerty: ["azertyuiop", "qsdfghjklm", "wxcvbn"] };
var _near = null;
function _neighbours() {
    if (_near)
        return _near;
    _near = {};
    var pos = {};
    (ROWS[_layout] || ROWS.qwerty).forEach(function (row, r) {
        for (var c = 0; c < row.length; ++c)
            pos[row.charAt(c)] = { x: c + r * 0.5, y: r };
    });
    Object.keys(pos).forEach(function (a) {
        _near[a] = {};
        Object.keys(pos).forEach(function (b) {
            var dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y;
            if (a !== b && dx * dx + dy * dy <= 1.6)
                _near[a][b] = true;
        });
    });
    return _near;
}

var ALPHABET = "abcdefghijklmnopqrstuvwxyz'";
function _alphabet() { return ALPHABET + (EXTRA_LETTERS[_lang] || ""); }
// Words one edit from `w`: {word: cost}: 0.5 a doubled letter typed once,
// 1 a neighbour key or two letters swapped, 1.5 any other edit, 2.2 the
// last letter typed taken away.
function _edits(w, into) {
    var near = _neighbours();
    var ALPHABET = _alphabet();
    function add(c, cost) { if (!(c in into) || into[c] > cost) into[c] = cost; }
    for (var i = 0; i <= w.length; ++i) {
        var a = w.substring(0, i), b = w.substring(i);
        if (b.length) {
            // A letter too many (the last one less likely: it was just typed).
            add(a + b.substring(1), b.length === 1 ? 2.2 : 1.5);
            if (b.length > 1)
                add(a + b.charAt(1) + b.charAt(0) + b.substring(2), 1);     // two swapped
            for (var k = 0; k < ALPHABET.length; ++k) {
                var ch = ALPHABET.charAt(k);
                if (ch !== b.charAt(0))
                    // Another letter; the accented one for its plain letter
                    // (typed without the accent) the cheapest.
                    add(a + ch + b.substring(1), _base(ch) === b.charAt(0) && ch !== b.charAt(0) ? 0.5
                                                 : near[b.charAt(0)] && near[b.charAt(0)][ch] ? 1 : 1.5);
            }
        }
        for (k = 0; k < ALPHABET.length; ++k) {
            // A letter missing; a doubled letter typed once is the commonest.
            var ins = ALPHABET.charAt(k);
            add(a + ins + b, ins === a.charAt(a.length - 1) || ins === b.charAt(0) ? 0.5 : 1.5);
        }
    }
    return into;
}
// Real words close to `lw`, best first: [{lw, score}].
function _corrections(lw, max) {
    var one = _edits(lw, {});
    var found = [];
    var seen = {};
    function consider(c, cost) {
        if (seen[c] || c === lw)
            return;
        var f = frequency(c);
        if (f < 0 || (_byLower[c] && c === c.toUpperCase()))
            return;
        seen[c] = true;
        found.push({ lw: c, cost: cost, score: f - 70 * cost });
    }
    Object.keys(one).forEach(function (c) { consider(c, one[c]); });
    if (found.length === 0 && lw.length >= 4) {
        Object.keys(one).forEach(function (c) {
            if (one[c] > 1)
                return;              // a second edit only after a likely first one
            var two = _edits(c, {});
            Object.keys(two).forEach(function (d) { consider(d, one[c] + two[d]); });
        });
    }
    found.sort(function (a, b) { return b.score - a.score; });
    return found.slice(0, max);
}

// The word the space bar puts in place of `word`, or "" to leave it.
function correction(word) {
    _load();
    if (!word || !_wordRe.test(word) || _lang === "none")
        return "";
    var lw = word.toLowerCase();
    // Contractions typed without their apostrophe ("im", "dont", "ill").
    var s = _shortcuts[lw];
    if (s && s.replace(/'/g, "").toLowerCase() === lw)
        return _match(word, s);
    if (isWord(word) || word.length < 2)
        return "";
    // Capitals inside a word ("iPhone", "McDonald"): typed on purpose.
    if (word.substring(1) !== word.substring(1).toLowerCase() && word !== word.toUpperCase())
        return "";
    var best = _corrections(lw, 2);
    // Short words are too easily another word: only two letters swapped,
    // or the same letters with their accents ("fur" for "für").
    if (lw.length <= 3)
        best = best.filter(function (b) {
            return (b.cost === 1 && b.lw.length === lw.length && b.lw.split("").sort().join("") === lw.split("").sort().join(""))
                || (b.lw !== lw && _fold(b.lw) === _fold(lw));
        });
    if (!best.length || best[0].score < 0)
        return "";
    // Clearly better than the next one, or the only one.
    if (best.length > 1 && best[0].score - best[1].score < 5 && best[0].lw.length !== lw.length)
        return "";
    return _match(word, _written(best[0].lw));
}

// ---- The user's shortcuts ---------------------------------------------------------

// Settings > Text Assist > Shortcuts (the preference x_palm_textinput, whose
// shortcutChecking says whether they are used): what is typed, in any case,
// -> what the space bar puts in for it. Unlike corrections they apply in any
// language (and with none), and to real words too: the user asked for them.
var _userShortcuts = {};
function setUserShortcuts(map) {
    _userShortcuts = {};
    Object.keys(map || {}).forEach(function (k) {
        var v = map[k];
        if (k && typeof v === "string" && v !== "")
            _userShortcuts[String(k).toLowerCase()] = v;
    });
}
// What `word` stands for, capitalized as typed ("Omw": "On my way"), or "".
function shortcut(word) {
    if (!word)
        return "";
    var s = _userShortcuts[String(word).toLowerCase()];
    return s ? _match(word, s) : "";
}

// ---- Suggestions -----------------------------------------------------------------

// What the candidate bar shows for `word` (being typed; "" when between
// words) after `prev`: [{text, kind}], kind "typed" (the word as typed,
// kept), "correction" (what the space bar puts in), "word".
function suggest(word, prev, max) {
    _load();
    max = max || 3;
    var out = [], seen = {};
    if (_lang === "none")
        return out;
    function push(text, kind) {
        var k = text.toLowerCase();
        if (seen[k] || out.length >= max)
            return;
        seen[k] = true;
        out.push({ text: text, kind: kind });
    }
    if (!word) {
        // The next word: what the user has written after `prev`, then the commonest.
        var lp = (prev || "").toLowerCase(), n = _user.next[lp] || {};
        Object.keys(n).sort(function (a, b) { return n[b] - n[a]; }).forEach(function (k) { push(_written(k), "word"); });
        if (/[.!?]$/.test(prev || "") || !prev)
            _common.forEach(function (w) { push(w.charAt(0).toUpperCase() + w.slice(1), "word"); });
        else
            _common.forEach(function (w) { push(w, "word"); });
        return out;
    }
    var lw = word.toLowerCase();
    var fix = correction(word);
    if (fix) {
        push(word, "typed");
        push(fix, "correction");
    } else {
        push(word, "typed");
    }
    // Completions of what is typed, then corrections.
    _completions(lw, max + 2).forEach(function (e) { if (e.lw !== lw) push(_match(word, _written(e.lw)), "word"); });
    if (out.length < max)
        _corrections(lw, max).forEach(function (c) { push(_match(word, _written(c.lw)), "word"); });
    return out;
}

// ---- Swipe typing ----------------------------------------------------------------

var SAMPLES = 32;

function _resample(pts, n) {
    if (pts.length === 0)
        return [];
    if (pts.length === 1) {
        var one = [];
        for (var k = 0; k < n; ++k) one.push(pts[0]);
        return one;
    }
    var total = 0;
    for (var i = 1; i < pts.length; ++i)
        total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (total === 0)
        return _resample([pts[0]], n);
    var step = total / (n - 1), out = [pts[0]], acc = 0;
    var prev = pts[0];
    for (i = 1; i < pts.length && out.length < n; ++i) {
        var cur = pts[i];
        var d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
        while (acc + d >= step && out.length < n) {
            var t = (step - acc) / d;
            var p = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) };
            out.push(p);
            d -= step - acc;
            acc = 0;
            prev = p;
        }
        acc += d;
        prev = cur;
    }
    while (out.length < n)
        out.push(pts[pts.length - 1]);
    return out;
}

function _nearestKeys(p, keys, within) {
    var out = [];
    Object.keys(keys).forEach(function (c) {
        var k = keys[c], d = Math.hypot(p.x - k.x, p.y - k.y);
        if (d <= within)
            out.push(c);
    });
    return out;
}

// The words a swipe meant, best first: [{text, score}]. path: [{x, y}] in
// the keyboard's pixels; keys: letter -> {x, y} (key centres); keyWidth.
function swipe(path, keys, keyWidth, max) {
    _load();
    max = max || 4;
    if (!path || path.length < 2 || _lang === "none")
        return [];
    var pts = _resample(path, SAMPLES);
    var len = 0;
    for (var i = 1; i < path.length; ++i)
        len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    var starts = _nearestKeys(path[0], keys, keyWidth * 1.1);
    var ends = {};
    _nearestKeys(path[path.length - 1], keys, keyWidth * 1.1).forEach(function (c) { ends[c] = true; });
    var scored = [];
    starts.forEach(function (c) {
        var list = (_byFirst[c] || []).slice();
        Object.keys(_user.words).forEach(function (k) {
            if (k.charAt(0) === c && !_byLower[k] && _user.words[k].n >= 2)
                list.push({ w: _user.words[k].w, lw: k, f: frequency(k) });
        });
        list = list.concat(_dictEntries(function (k) { return k.charAt(0) === c; }));
        for (var j = 0; j < list.length; ++j) {
            // Its keys: accented letters on their plain letter's key.
            var e = list[j], lw = e.lw.replace(/'/g, "").split("").map(_base).join("");
            if (!ends[lw.charAt(lw.length - 1)])
                continue;
            // The word's path: its keys' centres, a doubled letter once.
            var ideal = [], idealLen = 0, ok = true;
            for (var m = 0; m < lw.length; ++m) {
                var kc = keys[lw.charAt(m)];
                if (!kc) { ok = false; break; }
                if (ideal.length && ideal[ideal.length - 1] === kc)
                    continue;
                if (ideal.length)
                    idealLen += Math.hypot(kc.x - ideal[ideal.length - 1].x, kc.y - ideal[ideal.length - 1].y);
                ideal.push(kc);
            }
            if (!ok || ideal.length < 2)
                continue;
            // Much shorter or longer than the swipe: not this one.
            if (idealLen > len * 1.6 + keyWidth || idealLen < len * 0.4 - keyWidth)
                continue;
            var res = _resample(ideal, SAMPLES), dist = 0;
            for (m = 0; m < SAMPLES; ++m)
                dist += Math.hypot(res[m].x - pts[m].x, res[m].y - pts[m].y);
            dist /= SAMPLES * keyWidth;
            scored.push({ lw: e.lw, score: frequency(e.lw) / 255 - dist * 2.2 });
        }
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, max).map(function (s) { return { text: _written(s.lw), score: s.score }; });
}
