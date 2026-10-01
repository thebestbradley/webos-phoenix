// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The virtual keyboards' key maps, ported from Open webOS's keyboard plugin
// (openwebos/keyboard-efigs, Apache-2.0; src/PhoneKeymap.cpp,
// src/TabletKeymap.cpp; the shared defines in include/PhoneKeymap.h and
// include/TabletKeymap.h): the QWERTY, QWERTZ and AZERTY layouts of the
// phone keyboard (4 rows of 12 weighted cells) and of the tablet keyboard
// (5 rows), the extended characters a long press offers, the bottom rows for
// e-mail and URL fields, and the geometry: how weights become key rectangles
// (updateLimits, keyboardToKeyZone) and which key a touch lands on
// (pointToKeyboard, with its "diamond" correction towards the row above or
// below).
//
// Keys are Qt::Key values, as in the original (UKey). A printable key's code
// is its character, upper case for letters (Qt::Key_A = 'A', Qt::Key_Agrave
// = 'À', ...), so the tables below spell keys and extended characters as
// strings: each character is one key.
//
// Shipping builds (SHIPPING_VERSION) left out the debugging "options" and
// layout switching popups on X and B (PhoneKeymap.cpp:107-114,
// TabletKeymap.cpp:101-108); so does this port.

.pragma library

// ---- Keys (Qt::Key) --------------------------------------------------------------

var Key = {
    None: 0,
    Space: 0x20,
    Escape: 0x01000000,
    Tab: 0x01000001,
    Backspace: 0x01000003,
    Return: 0x01000004,
    Home: 0x01000010,
    End: 0x01000011,
    Left: 0x01000012,
    Up: 0x01000013,
    Right: 0x01000014,
    Down: 0x01000015,
    PageUp: 0x01000016,
    PageDown: 0x01000017,
    Shift: 0x01000020,
    Control: 0x01000021,       // cKey_SymbolPicker
    Alt: 0x01000023,           // cKey_Symbol: the "123" / "+ = [ ]" key
    AltGr: 0x01001103,
    A: 0x41,
    Z: 0x5a,
    // Keys of the plugin's own (PhoneKeymap.h:47-89, TabletKeymap.h:47-92).
    ToggleSuggestions: 0x01200200,
    ToggleLanguage: 0x01200201,
    SwitchToQwerty: 0x01200202,
    SwitchToAzerty: 0x01200203,
    SwitchToQwertz: 0x01200204,
    ShowXT9Regions: 0x01200209,
    CreateDefaultKeyboards: 0x0120020D,
    ClearDefaultKeyboards: 0x0120020E,
    Hide: 0x0120020F,
    ShowKeymapRegions: 0x01200210,
    StartStopRecording: 0x01200211,
    MorePopup: 0x01200212,     // phone
    ResizeTiny: 0x01200212,    // tablet (the same value, another keyboard)
    ResizeSmall: 0x01200213,
    ResizeDefault: 0x01200214,
    ResizeLarge: 0x01200215,
    ToggleSoundFeedback: 0x01200216,
    ResizeHandle: 0x01200217,
    DotCom: 0x01200300,
    DotOrg: 0x01200301,
    DotNet: 0x01200302,
    DotEdu: 0x01200303,
    DotGov: 0x01200304,
    DotCoUK: 0x01200305,
    DotDe: 0x01200306,
    DotFr: 0x01200307,
    DotUs: 0x01200308,
    ColonSlashSlash: 0x01200309,   // phone
    WWW: 0x01200309,               // tablet
    HTTPColonSlashSlash: 0x0120030A,
    HTTPSColonSlashSlash: 0x0120030B,
    EmoticonFrown: 0x0120030C,
    EmoticonCry: 0x0120030D,
    EmoticonSmile: 0x0120030E,
    EmoticonWink: 0x0120030F,
    EmoticonYuck: 0x01200310,
    EmoticonGasp: 0x01200311,
    EmoticonHeart: 0x01200312,
    EmoticonOptions: 0x01200313,
    // Phoenix: opens the emoji page (GAPS V6). In the plugin's range of its
    // own keys, unused there.
    Emoji: 0x01200220,
    ComboFirst: 0x01200400,
    ComboLast: 0x012004ff
};

function isUnicodeKey(k) { return k >= 0x20 && k < Key.Escape; }
function isFunctionKey(k) { return k >= Key.Escape; }
function isTextShortcutKey(k) { return k >= 0x01200300 && k <= 0x012003FF; }
function isComboKey(k) { return k >= Key.ComboFirst && k <= Key.ComboLast; }
function isEmoticonKey(k) { return k >= Key.EmoticonFrown && k <= Key.EmoticonOptions; }
function isLetter(k) { return k >= Key.A && k <= Key.Z; }
function isSizeKey(k) { return k >= Key.ResizeTiny && k <= Key.ResizeLarge; }

// QChar::toUpper / toLower: one character in, one out.
function upper(c) {
    var u = c.toUpperCase();
    return u.length === 1 ? u : c;
}
function lower(c) {
    var l = c.toLowerCase();
    return l.length === 1 ? l : l.charAt(0);
}
function chr(k) { return String.fromCharCode(k); }

// A string of characters as keys; a trailing cKey_None ends each list.
function keys(s) {
    var out = [];
    for (var i = 0; i < s.length; ++i)
        out.push(s.charCodeAt(i));
    return out;
}
function code(c) { return c.charCodeAt(0); }

// { weight, key, alt, extended, altExtended }
function K(w, k, a, e, ae) {
    return { w: w, key: k, alt: a === undefined ? k : a, ext: e || null, altExt: ae || null };
}
function NOKEY() { return K(0, Key.None, Key.None); }
function nokeys(n) { var r = []; for (var i = 0; i < n; ++i) r.push(NOKEY()); return r; }
// A row of printable keys with their alternates: "qQ1" style pairs.
function pairs(w, plain, alt, exts, altExts) {
    var r = [];
    for (var i = 0; i < plain.length; ++i)
        r.push(K(w, typeof plain[i] === "number" ? plain[i] : code(plain[i]),
                 typeof alt[i] === "number" ? alt[i] : code(alt[i]),
                 exts ? exts[i] : null, altExts ? altExts[i] : null));
    return r;
}

// ---- Extended characters (PhoneKeymap.cpp:31-105, TabletKeymap.cpp:31-83) ---------

var X = {
    A: keys("AÀÁÂÃÄÅæª"),
    C: keys("CÇć©¢"),
    D: keys("Dð†‡"),
    E: keys("EÈÉÊËęē"),
    G: keys("Gğ"),
    I: keys("IÌÍÎÏİı"),
    L: keys("LŁ"),
    M: keys("Mµ"),
    N: keys("Nñń"),
    O: keys("OÒÓÔÕÖØőœºω"),
    P: keys("P§π"),
    R: keys("R®"),
    S: keys("SšŞßσ"),
    T: keys("T™Þ"),
    U: keys("UÙÚÛÜű"),
    Y: keys("YÝÿ"),
    Z: keys("Zžźż")
};

// ---- The phone keyboard (PhoneKeymap.cpp) ------------------------------------------

var PX = {
    q1: keys("1!¼½"), q2: keys("2@"), q3: keys("3#¾"), q4: keys("4$"), q5: keys("5%‰"),
    q6: keys("6^"), q7: keys("7&"), q8: keys("8*"), q9: keys("9("), q0: keys("0)"),
    exclam: keys("!~¡"), at: keys("@©®™"), numberSign: keys("#"), dollar: keys("$£¥€¤"),
    percent: keys("%"), ampersand: keys("&"), asterisk: keys("*"),
    parenLeft: keys("([{"), parenRight: keys(")]}"),
    semicolon: keys(";"), colon: keys(":"), equal: keys("="), plus: keys("+×÷±"),
    minus: keys("-_¬"), apostrophe: keys("'`‘’"), quoteDbl: keys("\"“”«»"),
    commaSlash: keys(",/\\"),                          // sCommaSlash_extended (:103)
    periodQuestion: keys(".?•…¿"),                     // sQwertyPeriodQuestion_extended (:81)
    emoticons: [Key.EmoticonSmile, Key.EmoticonWink, Key.EmoticonFrown, Key.EmoticonCry,
                Key.EmoticonYuck, Key.EmoticonGasp, Key.EmoticonHeart],
    dotCom: [Key.DotCom, Key.DotNet, Key.DotEdu, Key.DotOrg, Key.DotCoUK],
    url: [Key.ColonSlashSlash, Key.HTTPColonSlashSlash, Key.HTTPSColonSlashSlash],
    commaQuestion: keys(",?¿"),
    periodExclamation: keys(".!•…¡")
};

var SPACE_KEY_WEIGHT = 4;   // PhoneKeymap.cpp:27

function phoneBottomRow(symbolWeight, returnWeight) {
    // QWERT_BOTTOM_ROW / AZERTY_BOTTOM (:145-154, :264-273)
    return [K(symbolWeight, Key.Alt), NOKEY(), NOKEY(), NOKEY(), K(SPACE_KEY_WEIGHT, Key.Space),
            NOKEY(), NOKEY(), K(returnWeight, Key.Return)].concat(nokeys(4));
}

function phoneQwerty() {   // sQwerty (:156-161)
    return [
        pairs(1, "QWERTYUIOP", "1234567890",
              [null, null, X.E, X.R, X.T, X.Y, X.U, X.I, X.O, X.P],
              [PX.q1, PX.q2, PX.q3, PX.q4, PX.q5, PX.q6, PX.q7, PX.q8, PX.q9, PX.q0]).concat(nokeys(2)),
        [K(-0.5, code("A"), code("<"), X.A, PX.exclam)]
            .concat(pairs(1, "ASDFGHJKL", "!@#$%&*()",
                          [X.A, X.S, X.D, null, X.G, null, null, null, X.L],
                          [PX.exclam, PX.at, PX.numberSign, PX.dollar, PX.percent, PX.ampersand, PX.asterisk, PX.parenLeft, PX.parenRight]))
            .concat([K(-0.5, code("L"), code(")"), X.L, PX.parenRight), NOKEY()]),
        [K(1.25, Key.Shift, Key.ToggleLanguage, null, "languages"), K(-0.25, code("Z"), code(";"), X.Z, PX.semicolon)]
            .concat(pairs(1, "ZXCVBNM", ";:=+-'\"",
                          [X.Z, null, X.C, null, null, X.N, X.M],
                          [PX.semicolon, PX.colon, PX.equal, PX.plus, PX.minus, PX.apostrophe, PX.quoteDbl]))
            .concat([K(-0.25, Key.Backspace), K(1.25, Key.Backspace), NOKEY()]),
        phoneBottomRow(1.5, 1.5)
    ];
}

function phoneQwertz() {   // sQwertz (:208-213)
    return [
        pairs(1, "QWERTZUIOP", "1234567890", [null, null, X.E, X.R, X.T, X.Z, X.U, X.I, X.O, X.P]).concat(nokeys(2)),
        [K(-0.5, code("A"), code("!"), X.A)]
            .concat(pairs(1, "ASDFGHJKL", "!@#$%&*()", [X.A, X.S, X.D, null, X.G, null, null, null, X.L]))
            .concat([K(-0.5, code("L"), code(")"), X.L), NOKEY()]),
        [K(1.25, Key.Shift, Key.ToggleLanguage, null, "languages"), K(-0.25, code("Y"), code(";"), X.Y)]
            .concat(pairs(1, "YXCVBNM", ";:=+-'\"", [X.Y, null, X.C, null, null, X.N, X.M]))
            .concat([K(-0.25, Key.Backspace), K(1.25, Key.Backspace), NOKEY()]),
        phoneBottomRow(1.5, 1.5)
    ];
}

function phoneAzerty() {   // sAzerty (:275-280)
    return [
        pairs(1, "AZERTYUIOP", "1234567890", [X.A, null, X.E, X.R, X.T, X.Y, X.U, X.I, X.O, X.P])
            .concat([K(-0.5, code("P"), code("]")), NOKEY()]),
        [K(-0.5, code("Q"), code("<"))]
            .concat(pairs(1, "QSDFGHJKLM", "!@#$%&*()^", [null, X.S, X.D, null, X.G, null, null, null, X.L, X.M]))
            .concat([NOKEY()]),
        [K(1.25, Key.Shift, Key.ToggleLanguage, null, "languages"), K(-0.25, Key.Shift, Key.ToggleLanguage, null, "languages")]
            .concat(pairs(1, "WXCVBN", ";:=+-'", [null, null, X.C, null, null, X.N]))
            .concat([K(1.5, code("'"), code("@")), K(-0.25, Key.Backspace), K(1.25, Key.Backspace)]),
        phoneBottomRow(2, 2)
    ];
}

// The keys around the space bar (beforeSpace, leftSpace, rightSpace,
// afterSpace) for plain, symbol, e-mail and URL fields (:284-308).
function phoneCustom(azerty) {
    var hidden = NOKEY();
    var commaSlash = K(1.5, code(","), code("/"), PX.commaSlash);
    var periodQuestion = K(1.5, code("."), code("?"), PX.periodQuestion);
    var commaQuestion = K(1.5, code(","), code("?"), PX.commaQuestion);
    var periodExclamation = K(1.5, code("."), code("!"), PX.periodExclamation);
    var before = azerty ? commaQuestion : commaSlash;
    var after = azerty ? periodExclamation : periodQuestion;
    var emoticons = K(1.5, Key.EmoticonOptions, Key.EmoticonOptions, PX.emoticons, PX.emoticons);
    var more = K(1.5, Key.MorePopup, Key.MorePopup);
    var at = K(1, code("@"));
    var dotCom = K(1, Key.DotCom, Key.DotCom, PX.dotCom);
    var slash = K(1, code("/"));
    var colon = K(1, code(":"), code(":"), PX.url);
    return {
        plain: [before, hidden, hidden, after],
        symbol: [emoticons, hidden, hidden, more],
        email: [before, at, dotCom, after],
        url: [slash, colon, dotCom, after]
    };
}

var phoneFamilies = {
    // LayoutFamily(name, defaultLanguage, ..., symbol_x, space_x, return_x,
    // return_y, return weight, symbol weight, ..., needNumLock) (:310-312)
    qwerty: { name: "qwerty", language: "en", symbolX: 0, spaceX: 4, returnX: 7, returnY: 3, needNumLock: false, layout: phoneQwerty, custom: function () { return phoneCustom(false); } },
    qwertz: { name: "qwertz", language: "de", symbolX: 0, spaceX: 4, returnX: 7, returnY: 3, needNumLock: false, layout: phoneQwertz, custom: function () { return phoneCustom(false); } },
    azerty: { name: "azerty", language: "fr", symbolX: 0, spaceX: 4, returnX: 7, returnY: 3, needNumLock: false, layout: phoneAzerty, custom: function () { return phoneCustom(true); } }
};

// ---- The tablet keyboard (TabletKeymap.cpp) ------------------------------------------

var TX = {
    q1: keys("1!¹¼½¡"), q2: keys("2@²"), q3: keys("3#³¾"), q4: keys("4$€£¥¢¤"), q5: keys("5%‰"),
    q6: keys("6^"), q7: keys("7&"), q8: keys("8*"), q9: keys("9([{"), q0: keys("0)]}"),
    z1: keys("1!¹¼½¡"), z2: keys("2\"²”„“«»"), z3: keys("3@³¾"), z4: keys("4$€£¥¢¤"), z5: keys("5%‰"),
    z6: keys("6&"), z7: keys("7/\\"), z8: keys("8([{"), z9: keys("9)]}"), z0: keys("0="),
    a1: keys("1&¹¼½"), a2: keys("2É²"), a3: keys("3\"³¾“”«»"), a4: keys("4'‘’"), a5: keys("5([{"),
    a6: keys("6-±¬"), a7: keys("7È`"), a8: keys("8)]}"), a9: keys("9Ç¢$€£¥¤"), a0: keys("0À%‰"),
    hide: [Key.ResizeTiny, Key.ResizeSmall, Key.ResizeDefault, Key.ResizeLarge],
    singleAndDoubleQuote: keys("'\"`‘’“”«»"),
    periodQuestion: keys(".?•…¿"),
    minusUnderscore: keys("-_±¬"),
    commaSlash: keys(",/\\"),
    url: [Key.HTTPColonSlashSlash, Key.HTTPSColonSlashSlash, Key.WWW],
    qwertyDotCom: [Key.DotCom, Key.DotNet, Key.DotOrg, Key.DotEdu],
    qwertzDotCom: [Key.DotCom, Key.DotDe, Key.DotNet, Key.DotOrg, Key.DotEdu],
    azertyDotCom: [Key.DotCom, Key.DotFr, Key.DotNet, Key.DotOrg, Key.DotEdu],
    commaSemiColon: keys(",;"),
    periodColon: keys(".:•…"),
    ssharpQuestion: keys("ß?¿"),
    minusApostrophe: keys("-'±¬`‚‘’"),
    commaQuestion: keys(",?¿"),
    periodSemicolon: keys(".;•…"),
    colonSlash: keys(":/\\"),
    atUnderscore: keys("@_"),
    exclamAsterisk: keys("!*¡")
};

var SPACE_SIZE = 5;   // TabletKeymap.cpp:27
var emoticonRow = [Key.EmoticonSmile, Key.EmoticonWink, Key.EmoticonFrown, Key.EmoticonCry,
                   Key.EmoticonYuck, Key.EmoticonGasp, Key.EmoticonHeart];

function tabletQwertyBottom(kind) {   // QWERTY_BOTTOM_ROW_* (:152-186)
    var tail = [K(1, code("'"), code("\""), TX.singleAndDoubleQuote), K(1, code("-"), code("_"), TX.minusUnderscore),
                K(1, Key.Hide, Key.Hide, TX.hide)].concat(nokeys(3));
    if (kind === "url")
        return [K(1, Key.Tab), K(2, Key.Alt), NOKEY(), K(1, code("/"), code("/"), TX.url), K(SPACE_SIZE - 2, Key.Space),
                K(1, Key.DotCom, Key.DotCom, TX.qwertyDotCom)].concat(tail);
    if (kind === "email")
        return [K(1, Key.Tab), K(2, Key.Alt), NOKEY(), K(1, code("@")), K(SPACE_SIZE - 2, Key.Space),
                K(1, Key.DotCom, Key.DotCom, TX.qwertyDotCom)].concat(tail);
    return [K(1, Key.Tab), K(2, Key.Alt), NOKEY(), NOKEY(), K(SPACE_SIZE, Key.Space), NOKEY()].concat(tail);
}

function tabletQwerty() {   // sQwerty (:188-194)
    return [
        [K(-0.5, code("Q"), code("["))]
            .concat(pairs(1, "1234567890", "!@#$%^&*()", [TX.q1, TX.q2, TX.q3, TX.q4, TX.q5, TX.q6, TX.q7, TX.q8, TX.q9, TX.q0]))
            .concat([K(-0.5, Key.Backspace)]),
        pairs(1, "QWERTYUIOP", ["`", "~", 0x20ac, "£", "\\", "|", "{", "}", "[", "]"],
              [null, null, X.E, X.R, X.T, X.Y, X.U, X.I, X.O, X.P]).concat([K(1, Key.Backspace), NOKEY()]),
        [K(-0.5, code("A"), code("<"))]
            .concat(pairs(1, "ASDFGHJKL", ["<", ">", "=", "+", 0xd7, 0xf7, "°", ";", ":"],
                          [X.A, X.S, X.D, null, X.G, null, null, null, X.L]))
            .concat([K(1.5, Key.Return), NOKEY()]),
        [K(1, Key.Shift)]
            .concat(pairs(1, "ZXCVBNM,.", emoticonRow.concat([code("/"), code("?")]),
                          [X.Z, null, X.C, null, null, X.N, X.M, TX.commaSlash, TX.periodQuestion]))
            .concat([K(1, Key.Shift), NOKEY()]),
        tabletQwertyBottom("")
    ];
}

function tabletQwertzBottom(kind) {   // QWERTZ_BOTTOM_ROW_* (:258-292)
    var tail = [K(1, code("ß"), code("?"), TX.ssharpQuestion), K(1, code("-"), code("'"), TX.minusApostrophe),
                K(1, Key.Hide, Key.Hide, TX.hide)].concat(nokeys(3));
    if (kind === "url")
        return [K(1, Key.Tab), K(2, Key.Alt), NOKEY(), K(1, code("/")), K(SPACE_SIZE - 2, Key.Space),
                K(1, Key.DotCom, Key.DotCom, TX.qwertzDotCom)].concat(tail);
    if (kind === "email")
        return [K(1, Key.Tab), K(2, Key.Alt), NOKEY(), K(1, code("@")), K(SPACE_SIZE - 2, Key.Space),
                K(1, Key.DotCom, Key.DotCom, TX.qwertzDotCom)].concat(tail);
    return [K(1, Key.Tab), K(2, Key.Alt), NOKEY(), NOKEY(), K(SPACE_SIZE, Key.Space), NOKEY()].concat(tail);
}

function tabletQwertz() {   // sQwertz (:294-300)
    return [
        [K(-0.5, code("Q"), code("["))]
            .concat(pairs(1, "1234567890", "!\"@$%&/()=", [TX.z1, TX.z2, TX.z3, TX.z4, TX.z5, TX.z6, TX.z7, TX.z8, TX.z9, TX.z0]))
            .concat([K(-0.5, Key.Backspace)]),
        pairs(1, "QWERTZUIOP", ["`", "~", 0x20ac, "^", "\\", "|", "{", "}", "[", "]"],
              [null, null, X.E, X.R, X.T, X.Z, X.U, X.I, X.O, X.P]).concat([K(1, Key.Backspace), NOKEY()]),
        [K(-0.5, code("A"), code("<"))]
            .concat(pairs(1, "ASDFGHJKL", ["<", ">", "_", "+", 0xd7, 0xf7, "°", "*", "#"],
                          [X.A, X.S, X.D, null, X.G, null, null, null, X.L]))
            .concat([K(1.5, Key.Return), NOKEY()]),
        [K(1, Key.Shift)]
            .concat(pairs(1, "YXCVBNM,.", emoticonRow.concat([code(";"), code(":")]),
                          [X.Y, null, X.C, null, null, X.N, X.M, TX.commaSemiColon, TX.periodColon]))
            .concat([K(1, Key.Shift), NOKEY()]),
        tabletQwertzBottom("")
    ];
}

function tabletAzertyBottom(kind) {   // AZERTY_BOTTOM_* (:369-403)
    var tail = [K(1, code("@"), code("_"), TX.atUnderscore), K(1, code("!"), code("*"), TX.exclamAsterisk),
                K(1.5, Key.Hide, Key.Hide, TX.hide)].concat(nokeys(3));
    if (kind === "url")
        return [K(1, Key.Tab), K(2, Key.Alt), NOKEY(), K(1, code("/")), K(SPACE_SIZE - 2, Key.Space),
                K(1, Key.DotCom, Key.DotCom, TX.azertyDotCom)].concat(tail);
    if (kind === "email")
        return [K(1, Key.Tab), K(2, Key.Alt), NOKEY(), NOKEY(), K(SPACE_SIZE - 1, Key.Space),
                K(1, Key.DotCom, Key.DotCom, TX.azertyDotCom)].concat(tail);
    return [K(1, Key.Tab), K(2, Key.Alt), NOKEY(), NOKEY(), K(SPACE_SIZE, Key.Space), NOKEY()].concat(tail);
}

function tabletAzerty() {   // sAzerty (:405-411)
    return [
        [K(-0.5, code("&"), code("1"))]
            .concat(pairs(1, "&É\"'(-È)ÇÀ", "1234567890", [TX.a1, TX.a2, TX.a3, TX.a4, TX.a5, TX.a6, TX.a7, TX.a8, TX.a9, TX.a0]))
            .concat([K(-1, Key.Backspace)]),
        pairs(1, "AZERTYUIOP", ["~", "#", 0x20ac, "$", "\\", "|", "{", "}", "[", "]"],
              [X.A, X.Z, X.E, X.R, X.T, X.Y, X.U, X.I, X.O, X.P]).concat([K(1.5, Key.Backspace), NOKEY()]),
        [K(-0.5, code("Q"), code("<"))]
            .concat(pairs(1, "QSDFGHJKLM", ["<", ">", "=", "+", 0xd7, 0xf7, "%", "°", 0xa8, "^"],
                          [null, X.S, X.D, null, X.G, null, null, null, X.L, X.M]))
            .concat([K(1, Key.Return)]),
        [K(1, Key.Shift)]
            .concat(pairs(1, "WXCVBN,.:", emoticonRow.slice(0, 6).concat([code("?"), code(";"), code("/")]),
                          [null, null, X.C, null, null, X.N, TX.commaQuestion, TX.periodSemicolon, TX.colonSlash]))
            .concat([K(1.5, Key.Shift), NOKEY()]),
        tabletAzertyBottom("")
    ];
}

// "+ = [  ]", "Q w y": the spaces are HAIR SPACE (U+200A) (:417-425).
var hair = " ";
var tabletFamilies = {
    qwerty: { name: "qwerty", language: "en", symbolLabel: "+" + hair + "=" + hair + "[" + hair + hair + "]",
              noLanguageLabel: "Q" + hair + "w" + hair + "y", tabX: 0, symbolX: 1, returnX: 10, returnY: 2, needNumLock: false,
              layout: tabletQwerty, bottomRow: tabletQwertyBottom },
    qwertz: { name: "qwertz", language: "de", symbolLabel: "+" + hair + "~" + hair + "[" + hair + hair + "]",
              noLanguageLabel: "Q" + hair + "w" + hair + "z", tabX: 0, symbolX: 1, returnX: 10, returnY: 2, needNumLock: false,
              layout: tabletQwertz, bottomRow: tabletQwertzBottom },
    azerty: { name: "azerty", language: "fr", symbolLabel: "+" + hair + "=" + hair + "[" + hair + hair + "]",
              noLanguageLabel: "A" + hair + "z" + hair + "y", tabX: 0, symbolX: 1, returnX: 11, returnY: 2, needNumLock: true,
              layout: tabletAzerty, bottomRow: tabletAzertyBottom }
};

// ---- Phoenix: the emoji key (GAPS V6) ---------------------------------------------------
// Beside the space bar in text fields, in a slot the original leaves empty
// there (the phone's leftSpace, the tablet's free key before the space bar),
// the space bar giving up one weight, as for the e-mail and URL keys. Not in
// password, number and phone fields.

function phoneCustomWithEmoji(custom) {
    var plain = custom.plain.slice();
    plain[1] = K(1, Key.Emoji);
    return { plain: plain, plainNoEmoji: custom.plain, symbol: custom.symbol, email: custom.email, url: custom.url };
}

function tabletRowWithEmoji(row) {
    row = row.slice();
    for (var x = 1; x < row.length; ++x) {
        if (row[x].key === Key.Space && row[x - 1].w === 0) {
            row[x - 1] = K(1, Key.Emoji);
            row[x] = K(row[x].w - 1, Key.Space);
            break;
        }
    }
    return row;
}

function emojiAllowed(type) {
    return type !== FieldType.Password && type !== FieldType.Number && type !== FieldType.Phone;
}

// ---- PalmIME::EditorState (luna-webkit-api palmimedefines.h:33-80) ---------------------

var FieldType = { Text: 0, Password: 1, Search: 2, Range: 3, Email: 4, Number: 5, Phone: 6, URL: 7, Color: 8 };
var FieldAction = { None: 0, Next: 0x2, Previous: 0x8 };
var FieldFlags = { None: 0, Emoticons: 0x1 };

function editorState(s) {
    s = s || {};
    return { type: s.type || 0, actions: s.actions || 0, flags: s.flags || 0, enterKeyLabel: s.enterKeyLabel || "" };
}
function sameState(a, b) {
    return a.type === b.type && a.actions === b.actions && a.flags === b.flags && a.enterKeyLabel === b.enterKeyLabel;
}

var ShiftMode = { Off: 0, Once: 1, CapsLock: 2 };
var SymbolMode = { Off: 0, Lock: 1 };

// ---- The key map --------------------------------------------------------------------
// One instance per keyboard: PhoneKeymap and TabletKeymap in one, `tablet`
// choosing. The layout tables are copied, since the original rewrote its
// (static) bottom row in place as fields changed.

function Keymap(tablet, familyName) {
    this.tablet = !!tablet;
    this.rows = tablet ? 5 : 4;          // cKeymapRows
    this.columns = 12;                   // cKeymapColumns
    this.shiftMode = ShiftMode.Off;
    this.symbolMode = SymbolMode.Off;
    this.shiftDown = false;
    this.symbolDown = false;
    this.autoCap = false;
    this.numLock = false;
    this.editorState = editorState();
    this.page = 0;                       // eLayoutPage_plain / _Alternate
    this.rect = { x: 0, y: 0, width: 0, height: 0 };
    this.rowHeight = [];
    for (var r = 0; r < this.rows; ++r)
        this.rowHeight.push(1);
    this.hlimits = [];
    this.vlimits = [];
    this.limitsDirty = true;
    this.limitsVersion = 0;
    this.languageName = "";
    this.customEnter = "";
    this.localized = { Enter: qsTrLike("Enter"), Tab: qsTrLike("Tab"), Next: qsTrLike("Next"), Previous: qsTrLike("Prev") };
    this.setLayoutFamily(familyName || "qwerty", true);
}

// IMEDataInterface::getLocalizedString: the shell has no translations yet.
function qsTrLike(s) { return s; }

Keymap.prototype.families = function () { return this.tablet ? tabletFamilies : phoneFamilies; };

Keymap.prototype.setLayoutFamily = function (name, force) {
    var fams = this.families();
    var family = fams[String(name).toLowerCase()] || fams.qwerty;
    if (!force && family === this.family)
        return false;
    this.family = family;
    this.layout = family.layout();
    if (this.tablet) {
        this.bottomRows = { "": tabletRowWithEmoji(family.bottomRow("")), noEmoji: family.bottomRow(""),
                            url: family.bottomRow("url"), email: family.bottomRow("email") };
        this.updateLanguageKey();
    } else {
        this.custom = phoneCustomWithEmoji(family.custom());
    }
    this.setEditorState(this.editorState, true);
    this.limitsDirty = true;
    return true;
};

Keymap.prototype.wkey = function (x, y) { return this.layout[y][x]; };
Keymap.prototype.weight = function (x, y) { return this.layout[y][x].w; };
Keymap.prototype.isValid = function (x, y) { return x >= 0 && x < this.columns && y >= 0 && y < this.rows; };

Keymap.prototype.setRect = function (x, y, w, h) {
    this.rect = { x: x, y: y, width: w, height: h };
    this.limitsDirty = true;
};
Keymap.prototype.setRowHeight = function (row, h) {
    if (row >= 0 && row < this.rows)
        this.rowHeight[row] = h;
};

Keymap.prototype.isSymbolActive = function () { return ((this.symbolMode === SymbolMode.Lock) ? 1 : 0) + (this.symbolDown ? 1 : 0) === 1; };
Keymap.prototype.isShiftActive = function () { return ((this.shiftMode === ShiftMode.Once) ? 1 : 0) + (this.shiftDown ? 1 : 0) === 1; };
Keymap.prototype.isCapsLocked = function () { return this.shiftMode === ShiftMode.CapsLock; };
Keymap.prototype.isCapActive = function () {
    return (this.shiftDown && this.shiftMode === ShiftMode.Off) || (!this.shiftDown && this.shiftMode !== ShiftMode.Off);
};
Keymap.prototype.isCapOrAutoCapActive = function () { return this.autoCap || this.isCapActive(); };

// updateLimits (PhoneKeymap.cpp:439-478, TabletKeymap.cpp:574-613)
Keymap.prototype.updateLimits = function () {
    if (this.limitsDirty) {
        var rectWidth = this.rect.width, x, y;
        if (rectWidth > 0) {
            this.hlimits = [];
            for (y = 0; y < this.rows; ++y) {
                var width = 0.0001;   // handle possible rounding errors by nudging up
                var row = [];
                for (x = 0; x < this.columns; ++x) {
                    width += Math.abs(this.weight(x, y));
                    row.push(width);
                }
                for (x = 0; x < this.columns; ++x)
                    row[x] = row[x] * rectWidth / width;
                this.hlimits.push(row);
            }
        }
        var rectHeight = this.rect.height;
        if (rectHeight > 0) {
            var height = 0.0001;
            this.vlimits = [];
            for (y = 0; y < this.rows; ++y) {
                height += this.rowHeight[y];
                this.vlimits.push(height);
            }
            for (y = 0; y < this.rows; ++y)
                this.vlimits[y] = this.vlimits[y] * rectHeight / height;
        }
        this.limitsDirty = false;
        ++this.limitsVersion;
    }
    return this.limitsVersion;
};

// keyboardToKeyZone: the key's rectangle; 1 for a key to draw, -1 for an
// invisible one (negative weight: a wider touch area for its neighbour),
// 0 for none (:621-643).
Keymap.prototype.keyZone = function (x, y) {
    if (!this.isValid(x, y))
        return { count: 0 };
    this.updateLimits();
    var left = Math.trunc(this.rect.x + (x > 0 ? this.hlimits[y][x - 1] : 0));
    var right = Math.trunc(this.rect.x + this.hlimits[y][x] - 1);
    var bottom = Math.trunc(this.rect.y + this.vlimits[y] - 1);
    var top = Math.trunc(this.rect.y + (y > 0 ? this.vlimits[y - 1] : 0));
    var count = right > left ? (this.weight(x, y) < 0 ? -1 : 1) : 0;
    return { count: count, x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
};

// map: the key at (x, y) in the current state (:645-663; TabletKeymap.cpp:129-167).
Keymap.prototype.map = function (x, y) {
    if (!this.isValid(x, y))
        return Key.None;
    var wkey = this.wkey(x, y);
    var key = wkey.key;
    var numLock = this.tablet ? (this.numLock || (this.family.needNumLock && this.shiftMode === ShiftMode.CapsLock)) : this.numLock;
    if (numLock && wkey.alt >= code("0") && wkey.alt <= code("9")) {
        if (!this.isShiftActive())
            key = wkey.alt;
    } else {
        // For letters (and, on the phone, function keys) the alternate page
        // when symbol is active; for the others when shift is.
        var letterLike = isLetter(key) || (!this.tablet && isFunctionKey(key));
        if (letterLike ? this.page === 1 : this.isShiftActive())
            key = wkey.alt;
    }
    return key;
};
Keymap.prototype.mapPage = function (x, y, page) {
    if (!this.isValid(x, y))
        return Key.None;
    return page === 0 ? this.wkey(x, y).key : this.wkey(x, y).alt;
};

Keymap.prototype.setShiftMode = function (m) {
    if (this.shiftMode === m)
        return false;
    this.shiftMode = m;
    this.updateMapping();
    return true;
};
Keymap.prototype.setSymbolMode = function (m) {
    if (this.symbolMode === m)
        return false;
    this.symbolMode = m;
    this.updateMapping();
    return true;
};
Keymap.prototype.setShiftKeyDown = function (down) {
    if (this.shiftDown === down)
        return false;
    this.shiftDown = down;
    return true;
};
Keymap.prototype.setSymbolKeyDown = function (down) {
    this.symbolDown = down;
    return this.updateMapping();
};
Keymap.prototype.setAutoCap = function (on) {
    if (this.autoCap === on)
        return false;
    this.autoCap = on;
    return true;
};

Keymap.prototype.updateMapping = function () {
    var page = this.isSymbolActive() ? 1 : 0;
    if (page === this.page)
        return false;
    this.page = page;
    // The phone's keys around the space bar follow the page (:609-619).
    if (!this.tablet)
        this.setEditorState(this.editorState, false);
    return true;
};

function sameKey(a, b) {
    return a.w === b.w && a.key === b.key && a.alt === b.alt && a.ext === b.ext && a.altExt === b.altExt;
}

// setEditorState: the field's type picks the keys around the space bar
// (phone, :530-607) or the bottom row (tablet, :665-725).
Keymap.prototype.setEditorState = function (state, force) {
    var layoutChanged = false, weightChanged = false, numLock = false;
    state = editorState(state);
    if (force || !sameState(this.editorState, state)) {
        layoutChanged = true;
        this.editorState = state;
        this.customEnter = state.enterKeyLabel;
    }
    var type = this.editorState.type;
    if ((type === FieldType.Phone || type === FieldType.Number) && this.family.needNumLock)
        numLock = true;
    var lastRow = this.rows - 1, x;
    if (this.tablet) {
        var newRow = this.bottomRows[type === FieldType.Email ? "email" : type === FieldType.URL ? "url"
                                     : emojiAllowed(type) ? "" : "noEmoji"];
        this.updateLanguageKey(newRow);
        var row = this.layout[lastRow];
        for (x = 0; x < this.columns; ++x) {
            if (row[x].w !== newRow[x].w)
                weightChanged = true;
            else if (sameKey(row[x], newRow[x]))
                continue;
            else
                layoutChanged = true;
            row[x] = newRow[x];
        }
    } else {
        var c = this.isSymbolActive() ? this.custom.symbol : emojiAllowed(type) ? this.custom.plain : this.custom.plainNoEmoji;
        if (type === FieldType.Email)
            c = this.custom.email;
        else if (type === FieldType.URL)
            c = this.custom.url;
        var sx = this.family.spaceX;
        var spaceWeight = SPACE_KEY_WEIGHT - c[1].w - c[2].w;
        if (this.layout[lastRow][sx].w !== spaceWeight) {
            this.layout[lastRow][sx] = K(spaceWeight, Key.Space);
            weightChanged = true;
        }
        var slots = [sx - 2, sx - 1, sx + 1, sx + 2];
        for (var i = 0; i < 4; ++i) {
            var cur = this.layout[lastRow][slots[i]];
            if (!sameKey(cur, c[i])) {
                if (cur.w !== c[i].w)
                    weightChanged = true;
                else
                    layoutChanged = true;
                this.layout[lastRow][slots[i]] = c[i];
            }
        }
    }
    if (weightChanged)
        this.limitsDirty = true;
    if (numLock !== this.numLock) {
        this.numLock = numLock;
        layoutChanged = true;
    }
    return layoutChanged || weightChanged;
};

// The tablet's language key beside the symbol key, shown when there is a
// language to name (updateLanguageKey, :551-572). Without keyboard combos
// (VirtualKeyboardPreferences) there is none: the symbol key is 2 wide.
Keymap.prototype.updateLanguageKey = function (row) {
    if (!this.tablet)
        return false;
    row = row || this.layout[this.rows - 1];
    var sym = row[this.family.symbolX], lang = row[this.family.symbolX + 1];
    var before = [sym.w, lang.w];
    if (this.languageName !== "") {
        row[this.family.symbolX] = K(1, sym.key, sym.alt, sym.ext, sym.altExt);
        row[this.family.symbolX + 1] = K(1, Key.ToggleLanguage, Key.ToggleLanguage, "languages");
    } else {
        row[this.family.symbolX] = K(2, sym.key, sym.alt, sym.ext, sym.altExt);
        row[this.family.symbolX + 1] = NOKEY();
    }
    return before[0] !== row[this.family.symbolX].w || before[1] !== row[this.family.symbolX + 1].w;
};

// Horizontal centre of a key for the diamond correction (:665-691).
Keymap.prototype.xCenterOfKey = function (touchX, x, y, weight) {
    var leftSide = Math.trunc(x > 0 ? this.hlimits[y][x - 1] : 0);
    var rightSide = Math.trunc(this.hlimits[y][x]);
    var center = Math.trunc((leftSide + rightSide) / 2);
    if (weight > 1) {
        var radius = Math.trunc((rightSide - leftSide) / (weight * 2));
        if (touchX < center) {
            var leftMost = leftSide + radius;
            center = touchX < leftMost ? leftMost : touchX;
        } else {
            var rightMost = rightSide - radius;
            center = touchX > rightMost ? rightMost : touchX;
        }
    }
    return center;
};

// Vertical centre of a row: the top and bottom rows' effective height is
// reduced (phone :693-705; tablet :198-212, the space bar less so).
Keymap.prototype.yCenterOfRow = function (y, key) {
    var top_y = Math.trunc(y > 0 ? this.vlimits[y - 1] : 0);
    var lower_y = Math.trunc(this.vlimits[y]);
    if (y === 0)
        return Math.trunc(lower_y / 4);
    if (y < this.rows - 1)
        return Math.trunc((top_y + lower_y) / 2);
    if (this.tablet && key === Key.Space)
        return Math.trunc((top_y + lower_y) / 2);
    return Math.trunc((top_y + 2 * lower_y) / 3);
};

function adjustedWeight(wkey) {   // TabletKeymap.cpp:217-237
    if (wkey.w < 1)
        return 0.3;
    switch (wkey.key) {
    case Key.Hide: return 0.4;
    case Key.Tab: return 0.7;
    case Key.Space: return 0.9;
    }
    return 1.0;
}

// pointToKeyboard: the key coordinate under a point in keyboard pixels, or
// null outside (phone :709-775; tablet :239-316).
Keymap.prototype.pointToKeyboard = function (px, py) {
    this.updateLimits();
    var locy = Math.trunc(py) - this.rect.y + 1;
    var y = 0;
    while (locy > this.vlimits[y] && ++y < this.rows)
        ;
    if (y >= this.rows)
        return null;
    var locx = Math.trunc(px) + 1;
    var x = 0;
    while (locx > this.hlimits[y][x] && ++x < this.columns)
        ;
    if (x >= this.columns)
        return null;
    var changed = false;
    var wkey = this.wkey(x, y);
    // Closer to a key in the row above or below?
    var center_y = this.yCenterOfRow(y, wkey.key);
    var min = Math.trunc((this.vlimits[y] - (y > 0 ? this.vlimits[y - 1] : 0)) / 10);
    var oy = -1;
    if (y > 0 && locy < center_y - min)
        oy = y - 1;
    else if (y < this.rows - 1 && locy > center_y + min)
        oy = y + 1;
    if (oy >= 0) {
        var ox = x;
        while (ox > 0 && locx < this.hlimits[oy][ox])
            --ox;
        while (locx > this.hlimits[oy][ox] && ++ox < this.columns)
            ;
        if (ox < this.columns) {
            var center_x = this.xCenterOfKey(locx, x, y, wkey.w);
            var owkey = this.wkey(ox, oy);
            var center_ox = this.xCenterOfKey(locx, ox, oy, owkey.w);
            var center_oy = this.yCenterOfRow(oy, owkey.key);
            var use_o;
            if (this.tablet) {
                var first_d = (locy - center_y) * (locy - center_y);
                var o_d = (locy - center_oy) * (locy - center_oy);
                if (Math.abs(center_x - center_ox) > 2) {
                    first_d += (locx - center_x) * (locx - center_x);
                    o_d += (locx - center_ox) * (locx - center_ox);
                }
                use_o = o_d * adjustedWeight(wkey) < first_d * adjustedWeight(owkey);
            } else {
                var fd = (locy - center_y) * (locy - center_y) + (locx - center_x) * (locx - center_x);
                var od = (locy - center_oy) * (locy - center_oy) + (locx - center_ox) * (locx - center_ox);
                var ow = owkey.w;
                if (ow < 1 && wkey.w >= 1)
                    use_o = 3 * od < fd;
                else if (wkey.w < 1 && ow >= 1)
                    use_o = od < 3 * fd;
                else
                    use_o = od < fd;
            }
            if (use_o) {
                x = ox;
                y = oy;
                changed = true;
            }
        }
    }
    if (!changed && wkey.w < 0) {
        // An invisible key: the visible neighbour with the same key.
        search:
        for (var xo = x === 0 ? 0 : x - 1; xo <= x + 1 && xo < this.columns; ++xo)
            for (var yo = y === 0 ? 0 : y - 1; yo <= y + 1 && yo < this.rows; ++yo)
                if ((x !== xo || y !== yo) && this.wkey(xo, yo).key === wkey.key) {
                    x = xo;
                    y = yo;
                    break search;
                }
    }
    return { x: x, y: y };
};

// getExtendedChars: what a long press on the key offers (phone :885-896,
// tablet :520-529); null for none.
Keymap.prototype.extendedChars = function (x, y) {
    if (!this.isValid(x, y))
        return null;
    var wkey = this.wkey(x, y);
    var ext;
    if (this.tablet) {
        ext = (!isLetter(wkey.key) || !this.isSymbolActive()) ? wkey.ext : null;
    } else if (isLetter(wkey.key) || isFunctionKey(wkey.key)) {
        ext = (this.page === 1 && wkey.key !== wkey.alt) ? wkey.altExt : wkey.ext;
    } else {
        ext = wkey.ext;
    }
    // Keyboard combos (languages): none without VirtualKeyboardPreferences.
    if (ext === "languages")
        return null;
    return ext && ext.length > 0 ? ext : null;
};

// getKeyDisplayString (phone :911-992, tablet :546-636).
Keymap.prototype.displayString = function (key, logging) {
    if (isFunctionKey(key)) {
        if (isComboKey(key))
            return "";
        switch (key) {
        case Key.Return: return this.customEnter === "" ? this.localized.Enter : this.customEnter;
        case Key.Emoji: return "\uD83D\uDE42";   // 🙂
        case Key.Tab: return this.localized.Tab;   // tabAction(): always Tab on the tablet (:531-534)
        case Key.EmoticonOptions: return ":)";
        case Key.EmoticonFrown: return ":-(";
        case Key.EmoticonCry: return ":'(";
        case Key.EmoticonSmile: return ":-)";
        case Key.EmoticonWink: return ";-)";
        case Key.EmoticonYuck: return ":-P";
        case Key.EmoticonGasp: return ":-O";
        case Key.EmoticonHeart: return "<3";
        case Key.Alt:
            if (this.tablet)
                return this.symbolMode === SymbolMode.Lock ? "A" + hair + "B" + hair + "C" : this.family.symbolLabel;
            return this.symbolMode === SymbolMode.Lock ? "ABC" : "123";
        case Key.DotCom: return ".com";
        case Key.DotCoUK: return ".co.uk";
        case Key.DotOrg: return ".org";
        case Key.DotDe: return ".de";
        case Key.DotEdu: return ".edu";
        case Key.DotFr: return ".fr";
        case Key.DotGov: return ".gov";
        case Key.DotNet: return ".net";
        case Key.DotUs: return ".us";
        case Key.HTTPColonSlashSlash: return "http://";
        case Key.HTTPSColonSlashSlash: return "https://";
        case Key.ToggleLanguage: return this.languageName;
        case Key.Shift: return logging ? "Shift" : "";
        case Key.Hide: return logging ? "Hide" : "";
        case Key.Backspace: return logging ? "Backspace" : "";
        }
        if (key === Key.WWW)
            return this.tablet ? "www." : "://";
        if (this.tablet) {
            switch (key) {
            case Key.ResizeTiny: return logging ? "<XS>" : "XS";
            case Key.ResizeSmall: return logging ? "<S>" : "S";
            case Key.ResizeDefault: return logging ? "<M>" : "M";
            case Key.ResizeLarge: return logging ? "<L>" : "L";
            }
        } else if (key === Key.MorePopup) {
            return "...";
        }
        return "";
    }
    var c = chr(key);
    return this.isCapOrAutoCapActive() ? upper(c) : lower(c);
};
