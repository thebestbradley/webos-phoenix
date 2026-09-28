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
// Not ported: the XT9 candidate bar and trace typing (CandidateBar.cpp, a
// licensed engine; off unless turned on), keyboard combos (language key),
// and the emoticon pictures (/usr/palm/emoticons, not in the Apache-2.0
// images): emoticon keys show their text.

import QtQuick
import "KeyboardKeymap.js" as KM

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

    // m_keyboardHeight, in shell pixels: what the keyboard takes from the
    // screen.
    readonly property real keyboardHeight: (_keymapHeight + _topPadding) * pixelScale
    readonly property alias keymap: kb._km
    // For tests: key rectangles in shell pixels, by label.
    function keyRect(label) {
        for (var i = 0; i < _keys.length; ++i) {
            var k = _keys[i];
            if (k.label === label || k.name === label)
                return Qt.rect(k.x * pixelScale, k.y * pixelScale, k.w * pixelScale, k.h * pixelScale);
        }
        return null;
    }

    width: availableWidth
    height: keyboardHeight

    // ---- Art (sizes in pixels, as the plugin read them from the pixmaps) ---------

    readonly property string _art: Theme.asset(tablet ? "keyboard-tablet/" : "keyboard-phone/")
    // keyboard-bg.png: 3x200 phone, 3x340 tablet.
    readonly property int _bgHeight: tablet ? 340 : 200
    // key-*.png: two states stacked, 48x96 phone, 93x140 tablet;
    // key-gray-short.png 93x110 (the tablet's number row).
    readonly property int _keyHalf: tablet ? 70 : 48
    readonly property int _shortKeyHalf: 55
    // 9-tile corners: 22 phone, 13 tablet (PhoneKeyboard.cpp:181, TabletKeyboard.cpp:176).
    readonly property int _corner: tablet ? 13 : 22
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
        // PhoneKeyboard.cpp:231-232: 377 upright, 260 on its side.
        return _landscape ? 260 : 377;
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
        if (shown) {
            _setKeyboardHeight(_requestedHeight > 0 ? _requestedHeight : _presetHeight());
        } else {
            // visibleChanged(false): back to plain letters.
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
        if (KM.isFunctionKey(plain) && !KM.isTextShortcutKey(plain))
            return "key-black.png";
        return KM.isLetter(plain) ? "key-white.png" : "key-gray.png";
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
                    ops.push({ icon: _art + icon, x: box.x + Math.floor((box.w - w) / 2), y: box.y + Math.floor((box.h - h) / 2), w: w, h: h });
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
        var ext = _pointToExtendedPopup(tpx, tpy);
        var keyCoord = (!ext.inside && py > rectTop - _topPadding) ? _km.pointToKeyboard(px, py) : null;
        var touches = _touches;
        var newTouch = touches[id] === undefined;
        if (newTouch)
            touches[id] = { visible: true, consumed: false, coord: null, first: { x: tpx, y: tpy }, last: { x: tpx, y: tpy }, time: 0 };
        var touch = touches[id];
        var newKey = keyCoord ? _km.map(keyCoord.x, keyCoord.y) : KM.Key.None;
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

    // Everything released (QEvent::TouchEnd).
    function _touchEnd() {
        _touches = ({});
        _stopRepeat();
        _setShiftKeyDown(false);
        _setSymbolKeyDown(false);
        _triggerRepaint();
    }

    // A flick from the screen's edge started on the keyboard: its touches
    // type nothing (screenEdgeFlickEvent).
    function screenEdgeFlick() {
        for (var id in _touches)
            _touches[id].consumed = true;
    }

    // ---- Keys (handleKey) ------------------------------------------------------------------

    function _handleKey(key, where) {
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
        clip: true
        BorderImage {
            source: tile.source
            x: -tile.trim
            y: (tile.pressed ? -tile.half : 0) - tile.trim
            width: tile.width + 2 * tile.trim
            height: tile.height + 2 * tile.trim + tile.half
            border.left: tile.corner
            border.right: tile.corner
            border.top: tile.pressed ? tile.half + tile.corner : tile.corner
            border.bottom: tile.pressed ? tile.corner : tile.half + tile.corner
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
                        font.family: Theme.fontFamily
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
                x: modelData.x
                y: modelData.y
                width: modelData.w
                height: modelData.h
                KeyTile {
                    anchors.fill: parent
                    source: kb._art + keyItem.modelData.background
                    half: kb._keyHalfFor(keyItem.modelData.background)
                    corner: kb._corner
                    trim: kb._trim
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
                        trim: kb._trim
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
        x: whole ? -kb.x : 0
        y: whole ? -kb.y : (kb._grace ? -kb.graceZone * kb.pixelScale : 0)
        width: whole ? kb.parent.width : kb.width
        height: whole ? kb.parent.height : kb.height - y
        enabled: kb.acceptingInput && kb.shown
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
}
