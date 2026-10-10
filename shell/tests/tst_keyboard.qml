// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The phone's virtual keyboard (VirtualKeyboard.qml; openwebos/keyboard-efigs
// PhoneKeyboard) and the shell's IME rules (IMEController,
// InputWindowManager): it comes up when a field gets the focus, takes the
// negative space over 400 ms so the app shrinks into the positive space,
// types with real key events, and goes when the field loses the focus.
// Needs Phoenix.Native (KeyInjector): run with the build tree's modules.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        density: 1
        virtualKeyboard: true
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    // A text field of the shell's (as Just Type's stand-in).
    TextInput {
        id: field
        x: 10
        y: 40
        width: 200
        height: 20
    }

    SignalSpy { id: typed; target: shell.keyboard; signalName: "keyTyped" }
    // A keyboard of its own, never re-made (the shell's is, as the test
    // window settles, which hid a keymap bound to numberRow).
    Component {
        id: freshKeyboard
        VirtualKeyboard { availableWidth: 320; availableHeight: 480 }
    }

    TestCase {
        name: "PhoneKeyboard"
        when: windowShown

        readonly property var kb: shell.keyboard

        function init() {
            sys.deviceOrientation = "up";
            tryCompare(shell, "uiOrientation", "up", 3000);
            tryVerify(function() { return !shell.rotator.rotating; }, 3000);
            field.inputMethodHints = Qt.ImhNone;
            field.echoMode = TextInput.Normal;
            kb.emojiPrefs = "{}";
            sys.tweaks = {};
            field.focus = false;
            shell.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", false, 2000);
            tryCompare(shell.notifications, "negativeSpace", 0, 2000);
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.cardView.maximizeProgress = 0;
            shell.unlock();
            field.text = "";
            typed.clear();
        }

        function showKeyboard() {
            field.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", true, 2000);
            tryCompare(shell.notifications, "negativeSpace", kb.keyboardHeight, 2000);
            tryVerify(function() { return kb.keyRect("q") !== null; }, 1000);
        }

        function tapKey(name) {
            var r;
            tryVerify(function() { r = kb.keyRect(name); return r !== null; }, 1000, "key " + name);
            mouseClick(kb, r.x + r.width / 2, r.y + r.height / 2);
            wait(20);
        }

        function type(names) {
            for (var i = 0; i < names.length; ++i)
                tapKey(names[i]);
        }

        function test_showsOnFocusAndTakesTheNegativeSpace() {
            verify(!shell.keyboardOpen);
            verify(!kb.visible);
            field.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", true, 1000);
            // 336 keyboard pixels upright (Phoenix; the plugin's 377,
            // PhoneKeyboard.cpp:231), the Pre 3's 1.5 per shell pixel at
            // density 1.
            compare(Theme.keyboardScale, 1 / 1.5);
            fuzzyCompare(kb.keysHeight, 336 / 1.5, 0.01);
            // With Text Assist's candidate bar above the keys in a text field.
            verify(kb.candidateBarShown);
            fuzzyCompare(kb.keyboardHeight, kb.keysHeight + 54 / 1.5, 0.01);
            tryCompare(shell.notifications, "negativeSpace", kb.keyboardHeight, 2000);
            verify(kb.visible);
            // The keyboard's top is the negative space's (slotNegativeSpaceChanged).
            fuzzyCompare(kb.y, shell.uiRoot.height - kb.keyboardHeight, 0.01);
            // Apps end where it begins.
            fuzzyCompare(shell.cardView.windowHeight, shell.uiRoot.height - Theme.statusBarHeight - kb.keyboardHeight, 0.01);
        }

        // A hardware keyboard attached (GAPS V8 (1)): a field taking the
        // focus leaves the keyboard down and shows the keyboard button;
        // the button brings it up, and a key typed on the hardware keyboard
        // puts it away again. Detached, it comes up as usual.
        function test_hardwareKeyboardKeepsItDown() {
            sys.hardwareKeyboard = true;
            var button = findChild(shell, "showKeyboardButton");
            field.forceActiveFocus();
            tryCompare(button, "visible", true, 1000);
            wait(300);
            verify(!shell.keyboardOpen);
            compare(shell.notifications.negativeSpace, 0);
            mouseClick(button);
            tryCompare(shell, "keyboardOpen", true, 1000);
            verify(!button.visible);
            keyClick(Qt.Key_A);
            compare(field.text, "a");
            tryCompare(shell, "keyboardOpen", false, 1000);
            verify(field.activeFocus);
            tryCompare(button, "visible", true, 1000);
            sys.hardwareKeyboard = false;
            tryCompare(shell, "keyboardOpen", true, 1000);
            verify(!button.visible);
        }

        function test_showAndHideAnimateOver400ms() {
            compare(Theme.positiveSpaceDuration, 400);
            field.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", true, 1000);
            var target = kb.keyboardHeight;
            wait(150);
            var mid = shell.notifications.negativeSpace;
            verify(mid > 0 && mid < target, "half way: " + mid);
            tryCompare(shell.notifications, "negativeSpace", target, 600);
            field.focus = false;
            shell.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", false, 1000);
            wait(150);
            mid = shell.notifications.negativeSpace;
            verify(mid > 0 && mid < target, "half way down: " + mid);
            // It slides out with the space, then is gone.
            verify(kb.visible);
            tryCompare(shell.notifications, "negativeSpace", 0, 600);
            tryCompare(kb, "visible", false, 500);
        }

        function test_keysType() {
            showKeyboard();
            type(["h", "i", "Space"]);
            compare(field.text, "hi ");
            tapKey("Backspace");
            compare(field.text, "hi");
            // Real key events went to the field.
            verify(typed.count >= 4);
        }

        function test_shift() {
            showKeyboard();
            tapKey("Shift");
            tryVerify(function() { return kb.keyRect("H") !== null; }, 1000, "caps shown");
            type(["H", "i"]);
            compare(field.text, "Hi");
            // Two taps within 500 ms lock it (DOUBLE_TAP_DURATION).
            wait(600);
            tapKey("Shift");
            tapKey("Shift");
            compare(kb.keymap.shiftMode, 2);
            type(["O", "K"]);
            compare(field.text, "HiOK");
            wait(600);
            tapKey("Shift");
            compare(kb.keymap.shiftMode, 0);
            tapKey("a");
            compare(field.text, "HiOKa");
        }

        // Settings > Text Assist > Number row (docs/M6-PLAN.md F4): a row
        // of digits above the letters, three quarters of a letter row; the
        // keyboard grows by it and the letter keys keep their size. Off by
        // default.
        function test_numberRow() {
            showKeyboard();
            var q = kb.keyRect("q"), height = kb.keysHeight;
            verify(kb.keyRect("1") === null, "no number row by default");
            field.focus = false;
            shell.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", false, 2000);
            sys.tweaks = { numberRow: true };
            showKeyboard();
            fuzzyCompare(kb.keysHeight, Math.round(336 * 236 / 200) / 1.5, 0.01);
            var one = kb.keyRect("1"), q2 = kb.keyRect("q");
            verify(one !== null && one.y < q2.y, "the digits above the letters");
            fuzzyCompare(q2.height, q.height, 1);
            fuzzyCompare(one.height, q.height * 36 / 48, 1);
            type(["1", "2", "q"]);
            compare(field.text, "12q");
            field.focus = false;
            shell.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", false, 2000);
            sys.tweaks = {};
            showKeyboard();
            fuzzyCompare(kb.keysHeight, height, 0.01);
            verify(kb.keyRect("1") === null);
        }

        // Changed while the keyboard is up, or after it has been (Settings >
        // Text Assist in a card beside the field): it follows, both ways.
        function test_numberRowWhileOpen() {
            showKeyboard();
            verify(kb.keyRect("1") === null);
            // The same keymap, changed in place: not a new, unsized one (it
            // was a binding on numberRow, and the keyboard kept its rows).
            sys.tweaks = { numberRow: true };
            tryVerify(function () { return kb.keyRect("1") !== null; }, 2000, "on while open");
            type(["1", "q"]);
            compare(field.text, "1q");
            sys.tweaks = {};
            tryVerify(function () { return kb.keyRect("1") === null; }, 2000, "off while open");
            type(["q"]);
            compare(field.text, "1qq");
        }

        // The number row changes the keymap in place: it is not made again
        // (a binding on numberRow made a new, unsized keymap, and the
        // keyboard kept its old rows, its repaint failing on it).
        function test_numberRowKeepsTheKeymap() {
            var k = createTemporaryObject(freshKeyboard, root);
            verify(k);
            var km = k._km;
            verify(km.rect.width > 0, "laid out");
            k.numberRow = true;
            verify(k._km === km, "the same keymap");
            compare(km.rows, 5);
            verify(km.rect.width > 0, "still laid out");
            k.numberRow = false;
            verify(k._km === km);
            compare(km.rows, 4);
        }

        function test_symbols() {
            showKeyboard();
            tapKey("123");
            // The letters' other page: Q is 1, W 2 (PhoneKeymap.cpp:116-125).
            tryVerify(function() { return kb.keyRect("ABC") !== null; }, 1000);
            type(["1", "2"]);
            compare(field.text, "12");
            // The keys around the space bar change too: the emoticon key.
            verify(kb.keyRect(":)") !== null);
            // Space ends the symbol lock.
            tapKey("Space");
            tryVerify(function() { return kb.keyRect("123") !== null; }, 1000);
            tapKey("q");
            compare(field.text, "12 q");
        }

        function test_extendedCharacters() {
            showKeyboard();
            var r = kb.keyRect("e");
            mousePress(kb, r.x + r.width / 2, r.y + r.height / 2);
            // A long press (350 ms, cFirstRepeatDelay) pops the accents up.
            var popup = findChild(kb, "extendedKeys");
            tryCompare(popup, "visible", true, 1000);
            // Slide onto the second cell, è (sE_extended), and let go.
            var cell = findChild(kb, "extendedKey1");
            verify(cell);
            var p = cell.mapToItem(kb, cell.width / 2, cell.height / 2);
            // The top row's accents rise over the candidate bar, in front of
            // it (they were drawn behind it: neither seen nor reachable).
            verify(kb.candidateBarShown);
            verify(p.y < kb.candidateBarHeight, "the popup reaches into the candidate bar");
            // Down the bar where the popup crosses it: mostly the popup's
            // light art (its keys and frame; a dark seam between them), not
            // the bar (black over the keys).
            var shot = grabImage(shell), light = 0, n = 0;
            for (var yy = 2; yy < kb.candidateBarHeight - 2; yy += 2, ++n) {
                var q = kb.mapToItem(shell, p.x, yy);
                if (shot.pixel(Math.round(q.x), Math.round(q.y)).r > 0.65)
                    ++light;
            }
            verify(light > n * 0.6, "the popup in front of the candidate bar (" + light + " of " + n + " light)");
            mouseMove(kb, p.x, p.y);
            mouseRelease(kb, p.x, p.y);
            compare(field.text, "è");
            tryCompare(popup, "visible", false, 1000);
        }

        // Let go on the key: the accents stay up (the phone), and a tap on
        // one over the candidate bar types it (the bar does not take it).
        function test_extendedCharactersTapOverBar() {
            showKeyboard();
            var r = kb.keyRect("o");          // two lines of accents
            mousePress(kb, r.x + r.width / 2, r.y + r.height / 2);
            var popup = findChild(kb, "extendedKeys");
            tryCompare(popup, "visible", true, 1000);
            mouseRelease(kb, r.x + r.width / 2, r.y + r.height / 2);
            verify(popup.visible);
            // Six to a line, as wide as the keys: all of each on the screen.
            for (var j = 0; j < 6; ++j) {
                var e = findChild(kb, "extendedKey" + j);
                var lt = e.mapToItem(kb, 0, 0), rb = e.mapToItem(kb, e.width, e.height);
                verify(lt.x >= -0.5 && rb.x <= kb.width + 0.5, "extendedKey" + j + " on the screen (" + lt.x + ".." + rb.x + ")");
            }
            // A cell of the lower line, over the bar.
            var cell = null, p = null;
            for (var i = 0; !cell; ++i) {
                var c = findChild(kb, "extendedKey" + i);
                verify(c, "a cell over the candidate bar");
                var q = c.mapToItem(kb, c.width / 2, c.height / 2);
                if (q.y > 0 && q.y < kb.candidateBarHeight) {
                    cell = c;
                    p = q;
                }
            }
            mouseClick(kb, p.x, p.y);
            compare(field.text, cell.modelData.text);
            tryCompare(popup, "visible", false, 1000);
        }

        // The keys' feedback sounds (SysmgrIMEDataInterface.cpp:199-205),
        // played from the Phoenix mimics on the feedback stream.
        function test_keySounds() {
            showKeyboard();
            var dir = "/usr/share/phoenix/sounds/feedback/";
            var n = windows.soundCount;
            tapKey("a");
            compare(windows.soundCount, n + 1);
            compare(windows.lastSound.path, dir + "key.wav");
            compare(windows.lastSound.stream, "feedback");
            tapKey("Space");
            compare(windows.lastSound.path, dir + "space.wav");
            tapKey("Backspace");
            compare(windows.lastSound.path, dir + "backspace.wav");
            tapKey("Enter");
            compare(windows.lastSound.path, dir + "return.wav");
            // Keyboard clicks off (VirtualKeyboardPreferences TapSounds, the
            // runtime's x_palm_virtualkeyboard_prefs): silent.
            sys.tapSounds = false;
            n = windows.soundCount;
            tapKey("a");
            compare(windows.soundCount, n);
            sys.tapSounds = true;
            // "System Sounds" off: silent too (SoundPlayerPool::playFeedback).
            sys.systemSounds = false;
            tapKey("a");
            compare(windows.soundCount, n);
            sys.systemSounds = true;
            // Muted: nothing plays.
            sys.muted = true;
            tapKey("a");
            compare(windows.soundCount, n);
            sys.muted = false;
            tapKey("a");
            compare(windows.soundCount, n + 1);
        }

        function test_emailField() {
            field.inputMethodHints = Qt.ImhEmailCharactersOnly;
            showKeyboard();
            // cCustom_QWERT_email: "@" and ".com" beside the space bar.
            tryVerify(function() { return kb.keyRect("@") !== null && kb.keyRect(".com") !== null; }, 1000);
            type(["a", "@"]);
            tapKey(".com");
            compare(field.text, "a@.com");
        }

        function test_doubleSpaceTypesAPeriod() {
            showKeyboard();
            type(["o", "k", "Space", "Space"]);
            compare(field.text, "ok. ");
        }

        // Cursor control (GAPS V4): holding the space bar, or sliding along
        // it, makes the keyboard a trackpad; a tap still types a space.
        function spaceCenter() {
            var r;
            tryVerify(function() { r = kb.keyRect("Space"); return r !== null; }, 1000);
            return Qt.point(r.x + r.width / 2, r.y + r.height / 2);
        }
        function stepX() { return kb.cTrackpadStepX * kb.pixelScale; }

        function test_spaceHoldMovesTheCursor() {
            showKeyboard();
            field.text = "hello world";
            field.cursorPosition = 11;
            var c = spaceCenter();
            mousePress(kb, c.x, c.y);
            tryCompare(kb, "trackpad", true, 1000);
            // The keys fade.
            tryVerify(function() { return findChild(kb, "keyboardFrame").children[1].opacity < 1; }, 1000);
            mouseMove(kb, c.x - 5.5 * stepX(), c.y);
            compare(field.cursorPosition, 6);
            // Steps count from the last one taken (-5): two right.
            mouseMove(kb, c.x - 2.5 * stepX(), c.y);
            compare(field.cursorPosition, 8);
            mouseRelease(kb, c.x - 2.5 * stepX(), c.y);
            verify(!kb.trackpad);
            compare(field.text, "hello world");     // no space typed
            compare(field.selectedText, "");
        }

        function test_spaceSlideStartsAtOnce() {
            showKeyboard();
            field.text = "abcdef";
            field.cursorPosition = 6;
            var c = spaceCenter();
            mousePress(kb, c.x, c.y);
            // Past the slop at once, before the hold delay.
            var slop = (kb.cTrackpadSlop + 1) * kb.pixelScale;
            mouseMove(kb, c.x - slop, c.y, 0);
            verify(kb.trackpad);
            mouseMove(kb, c.x - slop - 2.5 * stepX(), c.y, 0);
            mouseRelease(kb, c.x - slop - 2.5 * stepX(), c.y, 0);
            compare(field.text, "abcdef");
            compare(field.cursorPosition, 4);
        }

        function test_spaceTapStillTypes() {
            showKeyboard();
            type(["a", "Space", "b"]);
            compare(field.text, "a b");
            verify(!kb.trackpad);
        }

        function test_secondFingerSelects() {
            showKeyboard();
            field.text = "hello world";
            field.cursorPosition = 11;
            var c = spaceCenter();
            var q = kb.keyRect("q");
            var t = touchEvent(kb);
            t.press(0, kb, c.x, c.y).commit();
            tryCompare(kb, "trackpad", true, 1000);
            // A second finger down: the moves select.
            t.stationary(0).press(1, kb, q.x + 5, q.y + 5).commit();
            t.move(0, kb, c.x - 5.5 * stepX(), c.y).stationary(1).commit();
            // (Touch events reach the area on the next pass of the event loop.)
            tryCompare(field, "selectedText", "world", 1000);
            t.stationary(0).release(1, kb, q.x + 5, q.y + 5).commit();
            t.release(0, kb, c.x - 5.5 * stepX(), c.y).commit();
            tryCompare(kb, "trackpad", false, 1000);
            compare(field.text, "hello world");
        }

        // The gesture bar: with the keyboard up, hold and slide to move the
        // cursor a character at a time; the hold is not a gesture.
        function test_gestureBarMovesTheCursor() {
            showKeyboard();
            field.text = "abcdef";
            field.cursorPosition = 6;
            var bar = findChild(shell, "gestureBar");
            verify(bar.cursorControl);
            var x = bar.width / 2, y = bar.height / 2;
            mousePress(bar, x, y);
            tryCompare(bar, "cursorActive", true, 1000);
            mouseMove(bar, x - 3.5 * bar.cursorStepWidth, y);
            compare(field.cursorPosition, 3);
            mouseRelease(bar, x - 3.5 * bar.cursorStepWidth, y);
            verify(!bar.cursorActive);
            verify(shell.keyboardOpen);
            compare(shell.cardView.maximizeProgress, 0);
        }

        // Emoji (GAPS V6): the emoji key beside the space bar opens the
        // emoji page; an emoji types, joins the recents, keeps its tone.
        readonly property string smile: "\uD83D\uDE42"
        readonly property string grin: "\uD83D\uDE00"
        readonly property string wave: "\uD83D\uDC4B"
        readonly property string waveMedium: "\uD83D\uDC4B\uD83C\uDFFD"

        function openEmoji() {
            showKeyboard();
            tapKey(smile);
            tryCompare(kb, "emojiOpen", true, 1000);
            var panel = findChild(kb, "emojiPanel");
            tryCompare(panel, "visible", true, 1000);
            return panel;
        }
        function cellFor(panel, emoji) {
            var grid = findChild(panel, "emojiGrid");
            var model = grid.model;
            for (var i = 0; i < model.length; ++i)
                if (model[i].e === emoji)
                    grid.positionViewAtIndex(i, GridView.Center);
            waitForItemPolished(grid);
            var cell;
            tryVerify(function() { cell = findChild(grid, "emoji-" + emoji); return cell && cell.visible; }, 1000, "cell " + emoji);
            return cell;
        }

        // The emoji key's cap: a face in yellow outline, no fill (Phoenix),
        // inside the key.
        function shownChild(item, name) {
            for (var i = 0; i < item.children.length; ++i) {
                var c = item.children[i];
                if (!c.visible)
                    continue;
                if (c.objectName === name)
                    return c;
                var f = shownChild(c, name);
                if (f)
                    return f;
            }
            return null;
        }
        function test_emojiKeyFace() {
            showKeyboard();
            var r = kb.keyRect(smile);
            verify(r);
            var face = shownChild(kb, "emojiFace");
            verify(face, "the face on the key");
            var ring = findChild(face, "emojiFaceRing");
            compare(ring.color.a, 0);
            verify(Qt.colorEqual(ring.border.color, kb.cEmojiKeyColor));
            var c = face.mapToItem(kb, face.width / 2, face.height / 2);
            verify(Math.abs(c.x - (r.x + r.width / 2)) < 3, "centred across the key");
            verify(c.y > r.y && c.y < r.y + r.height);
            // The middle of the face is the key, not yellow.
            var at = face.mapToItem(shell, face.width / 2, face.height / 2);
            var px = grabImage(shell).pixel(Math.round(at.x), Math.round(at.y));
            verify(px.r < 0.3 && px.g < 0.3, "no fill (" + px + ")");
        }

        // The phone's bordered keys stand 4 px apart (their art's black
        // edge trimmed), not 10.
        function test_borderedKeysSpacing() {
            showKeyboard();
            var shot = grabImage(shell);
            var r = kb.keyRect("Space");
            verify(r);
            var y = kb.mapToItem(shell, 0, r.y + r.height / 2).y;
            // From inside the space bar, leftwards: its fill and border
            // (grey), then the black between the keys.
            var x = Math.round(kb.mapToItem(shell, r.x + 10 * kb.pixelScale, 0).x);
            var lum = function(x) { var c = shot.pixel(x, Math.round(y)); return c.r; };
            while (lum(x) > 0.03) --x;
            var dark = 0;
            for (; lum(x) <= 0.03 && dark < 30; --x)
                ++dark;
            dark /= kb.pixelScale;         // in keyboard pixels
            verify(dark >= 2 && dark <= 6, "gap " + dark + " px");
        }

        // The bottom row's cells fit their labels (Phoenix): 123 a letter
        // and a quarter, the keys beside the space bar a letter, Return a
        // letter and a half, the space bar the rest; the row's total width
        // is the original's.
        function test_bottomRowCells() {
            showKeyboard();
            var letter = kb.keyRect("q").width;
            var near = function(a, b, what) { verify(Math.abs(a - b) < 1.5, what + " (" + a + " vs " + b + ")"); };
            near(kb.keyRect("123").width, 1.25 * letter, "123");
            near(kb.keyRect(smile).width, letter, "the emoji key");
            near(kb.keyRect("Space").width, 4.25 * letter, "the space bar");
            // The row spans the keyboard, as the letters' rows do.
            near(kb.keyRect("Space").x + kb.keyRect("Space").width + 2.5 * letter, kb.width, "the period and Return");
        }

        // The phone's bordered keys are charcoal (Phoenix): a face close to
        // its rim, not a near-black face in a grey outline.
        function test_borderedKeysCharcoal() {
            showKeyboard();
            var r = kb.keyRect("Space");
            var c = kb.mapToItem(shell, r.x + r.width / 2, r.y + r.height / 2);
            var px = grabImage(shell).pixel(Math.round(c.x), Math.round(c.y));
            verify(px.r > 0.10 && px.r < 0.16, "a charcoal face, near black (" + px + ")");
        }

        // Turned between phone and tablet (the sim's "auto" form factor
        // follows the window's size) the keys never ask one art folder for
        // the other's images (key-gray-short.png is the tablet's only).
        function test_formFactorFlipKeepsArtTogether() {
            showKeyboard();
            failOnWarning(/Cannot open/);
            kb.tablet = true;
            wait(50);
            kb.tablet = false;
            wait(50);
            verify(kb.keyRect("q") !== null);
        }

        function test_emojiKeyTypesAnEmoji() {
            var panel = openEmoji();
            // No recents yet: smileys first.
            compare(panel.category, "smileys");
            verify(!findChild(kb, "keyboardFrame").visible);
            mouseClick(cellFor(panel, grin));
            compare(field.text, grin);
            compare(JSON.parse(kb.emojiPrefs).recent, [grin]);
            // ABC: the letters again.
            mouseClick(findChild(panel, "emojiAbc"));
            verify(!kb.emojiOpen);
            type(["a"]);
            compare(field.text, grin + "a");
        }

        function test_emojiSpaceAndDelete() {
            var panel = openEmoji();
            mouseClick(cellFor(panel, grin));
            mouseClick(findChild(panel, "emojiSpace"));
            compare(field.text, grin + " ");
            mouseClick(findChild(panel, "emojiBackspace"));
            compare(field.text, grin);
        }

        function test_emojiRecentsAndTones() {
            var panel = openEmoji();
            // Hold the waving hand: its tones; the medium one types and stays.
            mousePress(cellFor(panel, wave));
            var tones = findChild(panel, "emojiTones");
            tryCompare(tones, "visible", true, 2000);
            mouseRelease(cellFor(panel, wave));
            // (A Row places its items when polished.)
            waitForItemPolished(findChild(tones, "emojiToneRow"));
            mouseClick(findChild(tones, "emojiTone-3"));
            compare(field.text, waveMedium);
            verify(!tones.visible);
            compare(JSON.parse(kb.emojiPrefs).tones[wave], waveMedium);
            mouseClick(cellFor(panel, wave));
            compare(field.text, waveMedium + waveMedium);
            // Reopened, it starts on the recents.
            mouseClick(findChild(panel, "emojiAbc"));
            tapKey(smile);
            tryCompare(panel, "visible", true, 1000);
            compare(panel.category, "recent");
            verify(cellFor(panel, waveMedium));
        }

        function test_emojiSurvivesInPrefs() {
            kb.emojiPrefs = JSON.stringify({ recent: [grin], tones: {} });
            var panel = openEmoji();
            compare(panel.category, "recent");
            verify(cellFor(panel, grin));
        }

        function test_emojiSearch() {
            var panel = openEmoji();
            mouseClick(findChild(panel, "emojiTab-search"));
            tryCompare(kb, "emojiSearch", true, 1000);
            var bar = findChild(kb, "emojiSearchBar");
            verify(bar.visible);
            verify(!panel.visible);
            verify(findChild(kb, "keyboardFrame").visible);
            // The keys type the search, not the field.
            type(["w", "a", "v", "i", "n"]);
            compare(kb.emojiQuery, "wavin");
            compare(field.text, "");
            var result;
            tryVerify(function() { result = findChild(bar, "emojiResult-" + wave); return result !== null; }, 1000);
            mouseClick(result);
            compare(field.text, wave);
            tapKey("Space");
            type(["h"]);
            compare(kb.emojiQuery, "wavin h");
            // Back: the emoji page.
            mouseClick(findChild(bar, "emojiSearchBack"));
            verify(!kb.emojiSearch);
            tryCompare(panel, "visible", true, 1000);
        }

        function test_emojiClosesWithTheKeyboard() {
            openEmoji();
            field.focus = false;
            shell.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", false, 2000);
            verify(!kb.emojiOpen);
        }

        function test_noEmojiKeyInPasswordFields() {
            field.echoMode = TextInput.Password;
            showKeyboard();
            verify(kb.keyRect(smile) === null);
            field.echoMode = TextInput.Normal;
        }

        function test_landscape() {
            showKeyboard();
            sys.deviceOrientation = "left";
            tryCompare(shell, "uiOrientation", "left", 3000);
            // 260 keyboard pixels on its side (PhoneKeyboard.cpp:232), at once.
            tryVerify(function() { return Math.abs(kb.keysHeight - 260 / 1.5) < 0.01; }, 3000);
            tryCompare(shell.notifications, "negativeSpace", kb.keyboardHeight, 3000);
            fuzzyCompare(kb.width, shell.uiRoot.width, 0.01);
        }

        function test_hidesWhenTheFieldLosesTheFocus() {
            showKeyboard();
            field.focus = false;
            shell.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", false, 1000);
            tryCompare(shell.notifications, "negativeSpace", 0, 1000);
            tryCompare(kb, "visible", false, 500);
            fuzzyCompare(shell.cardView.windowHeight, shell.uiRoot.height - Theme.statusBarHeight, 0.01);
        }

        // A web page's field (inputFocusChanged from the window source): the
        // keyboard follows its card, maximized or not.
        function test_webFieldFollowsItsCard() {
            var uid = windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            windows.inputFocusChanged(uid, true, { type: 4 });
            tryCompare(shell, "keyboardOpen", true, 1000);
            compare(kb.editorState.type, 4);
            shell.cardView.minimize();
            tryCompare(shell, "keyboardOpen", false, 2000);
            shell.cardView.maximize();
            tryCompare(shell, "keyboardOpen", true, 2000);
            windows.inputFocusChanged(uid, false, null);
            tryCompare(shell, "keyboardOpen", false, 1000);
        }

        // The emoticon keys show pictures (TabletKeyboard.cpp:1571-1597):
        // the colour emoji font's faces, as /usr/palm/emoticons was never
        // released; they still type the original's text.
        function test_emoticonPictures() {
            var wink = 0x0120030F, heart = 0x01200312;     // cKey_Emoticon_Wink, _Heart
            var ops = kb._keyCap({ x: 0, y: 0, w: 60, h: 64 }, 30, 32, wink, 0);
            compare(ops.length, 1);
            compare(ops[0].text, "😉");
            verify(ops[0].emoji);
            compare(ops[0].x, 8);                            // cPixMargin
            compare(kb._keyCap({ x: 0, y: 0, w: 60, h: 64 }, 30, 32, heart, 0)[0].text, "❤️");
            compare(kb._km.displayString(wink, false), ";-)");
        }

        // The app is resized when the original resized it
        // (CardWindowManagerStates.cpp:256-318): the keyboard coming up
        // slides over it and it shrinks at the end; the keyboard going, it
        // grows at the start.
        function test_resizeTiming() {
            var uid = windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            var full = shell.cardView.windowHeight;
            windows.inputFocusChanged(uid, true, { type: 0 });
            tryCompare(shell, "keyboardOpen", true, 1000);
            var target = kb.keyboardHeight;
            wait(150);
            var mid = shell.notifications.negativeSpace;
            verify(mid > 0 && mid < target, "sliding: " + mid);
            compare(shell.cardView.windowHeight, full);           // not yet
            tryCompare(shell.notifications, "negativeSpace", target, 600);
            fuzzyCompare(shell.cardView.windowHeight, full - target, 0.01);   // at the end
            windows.inputFocusChanged(uid, false, null);
            tryCompare(shell, "keyboardOpen", false, 1000);
            wait(50);
            verify(shell.notifications.negativeSpace > 0, "still sliding down");
            compare(shell.cardView.windowHeight, full);           // at once
            tryCompare(shell.notifications, "negativeSpace", 0, 600);
        }

        // PalmSystem.allowResizeOnPositiveSpaceChange(false) (Enyo's
        // enyo.keyboard.setResizesWindow(false)): the card keeps its size,
        // the keyboard over its bottom, and the page is told the positive
        // space instead (CardWindowManagerStates.cpp:85-98).
        function test_allowResizeOnPositiveSpaceChange() {
            var uid = windows.launch("org.webosphoenix.email", "");
            shell.cardView.maximize();
            tryVerify(function() { return shell.maximized; }, 2000);
            var card = shell.cardView.cardItem(uid);
            var full = card.height;
            var fullY = card.mapToItem(shell, 0, 0).y;
            for (var i = 0; i < windows.cards.count; ++i)
                if (windows.cards.get(i).uid === uid)
                    windows.cards.setProperty(i, "allowResize", false);
            // The page (a stand-in): what the shell runs in it.
            var real = windows._windows[uid];
            var spy = Qt.createQmlObject("import QtQuick; QtObject { property var calls: []; function runScript(js) { "
                + "var m = /positiveSpaceChanged\\((\\d+),(\\d+)\\)$/.exec(js); if (m) calls = calls.concat([[+m[1], +m[2]]]); } }", root);
            windows._windows[uid] = spy;
            windows.inputFocusChanged(uid, true, { type: 0 });
            tryCompare(shell, "keyboardOpen", true, 1000);
            tryCompare(shell.notifications, "negativeSpace", kb.keyboardHeight, 1000);
            wait(50);
            compare(card.height, full);
            fuzzyCompare(card.mapToItem(shell, 0, 0).y, fullY, 0.5);
            // Mojo.positiveSpaceChanged(width, height) at the end of the slide.
            verify(spy.calls.length >= 1, JSON.stringify(spy.calls));
            var last = spy.calls[spy.calls.length - 1];
            compare(last[0], Math.round(shell.cardView.windowWidth));
            compare(last[1], Math.round(shell.uiRoot.height - Theme.statusBarHeight - kb.keyboardHeight));
            windows.inputFocusChanged(uid, false, null);
            tryCompare(shell.notifications, "negativeSpace", 0, 1000);
            compare(card.height, full);
            windows._windows[uid] = real;
            spy.destroy();
        }

        // The lock screen takes the focus: only its password panel types.
        function test_lockScreen() {
            showKeyboard();
            shell.lock();
            tryCompare(shell, "keyboardOpen", false, 1000);
            // A password (LockWindow::slotPinPanelFocusRequest), over the lock screen.
            var panel = shell.lockScreen.unlockPanel;
            panel.setupDialog(false, "Device Locked", "Enter Password", false, 0);
            panel.shown = true;
            panel.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", true, 1000);
            compare(kb.editorState.type, 1);
            tryCompare(shell.notifications, "negativeSpace", kb.keyboardHeight, 1000);
            verify(kb.visible);
            type(["o", "k"]);
            compare(panel.enteredText, "ok");
            panel.shown = false;
            tryCompare(shell, "keyboardOpen", false, 1000);
            // A PIN has its own keypad.
            panel.setupDialog(true, "Device Locked", "Enter PIN", false, 0);
            panel.shown = true;
            wait(400);
            verify(!shell.keyboardOpen);
            panel.shown = false;
            shell.unlock();
            field.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", true, 1000);
        }
    
        // ---- Text Assist (GAPS V2, V3) ---------------------------------------------------

        function candidateTexts() {
            return kb.candidates.map(function (c) { return c.text; });
        }
        function tapCandidate(text) {
            var bar = findChild(kb, "candidateBar");
            var cells = [];
            (function walk(o) {
                for (var i = 0; i < o.children.length; ++i) {
                    if (o.children[i].objectName === "candidate")
                        cells.push(o.children[i]);
                    walk(o.children[i]);
                }
            })(bar);
            for (var i = 0; i < cells.length; ++i) {
                if (cells[i].modelData.text === text) {
                    // The bar's Row places its cells when next polished
                    // (before the next frame), after the candidates change;
                    // a finger's tap comes after that frame, so this one
                    // must (Qt 6.11 lays out before delivering the click).
                    waitForItemPolished(cells[i].parent);
                    var p = cells[i].mapToItem(kb, cells[i].width / 2, cells[i].height / 2);
                    mouseClick(kb, p.x, p.y);
                    wait(20);
                    return;
                }
            }
            fail("no candidate " + text + " in " + JSON.stringify(candidateTexts()));
        }

        function test_textAssistSuggestsAndCompletes() {
            kb.textAssistData = "";
            showKeyboard();
            verify(findChild(kb, "candidateBar").visible);
            type(["h", "e", "l"]);
            compare(field.text.toLowerCase(), "hel");
            tryVerify(function() { return candidateTexts().length === 3; }, 1000);
            var texts = candidateTexts().map(function (t) { return t.toLowerCase(); });
            compare(texts[0], "hel");
            verify(texts.indexOf("help") > 0 || texts.indexOf("held") > 0, JSON.stringify(texts));
            tapCandidate(kb.candidates[1].text);
            compare(field.text.toLowerCase(), texts[1] + " ");
            // Between words: the next word.
            verify(kb.candidates.length > 0);
        }

        function test_textAssistCorrectsOnSpaceAndBackspaceUndoes() {
            showKeyboard();
            type(["t", "e", "h"]);
            compare(kb.candidates[1].kind, "correction");
            compare(kb.candidates[1].text.toLowerCase(), "the");
            tapKey("Space");
            compare(field.text.toLowerCase(), "the ");
            // Backspace right after: the word as typed, kept.
            tapKey("Backspace");
            compare(field.text.toLowerCase(), "teh");
            tapKey("Space");
            compare(field.text.toLowerCase(), "teh ");
            // Contractions: "dont" becomes "don't".
            type(["d", "o", "n", "t"]);
            tapKey("Space");
            compare(field.text.toLowerCase(), "teh don't ");
        }

        // The text around the cursor (GAPS V3): a field with text already in
        // it, or a cursor moved by a tap, predicts and corrects from the
        // field's own words, not only what the keyboard typed.
        function test_surroundingText() {
            kb.textAssistData = "";
            field.text = "I said teh";
            field.cursorPosition = field.text.length;
            showKeyboard();
            // The word before the cursor is the one being typed: its
            // correction is in the bar, and the space bar puts it in.
            tryVerify(function() { return kb.candidates.some(function (c) { return c.kind === "correction"; }); }, 1000,
                      JSON.stringify(candidateTexts()));
            compare(kb.candidates.filter(function (c) { return c.kind === "correction"; })[0].text.toLowerCase(), "the");
            tapKey("Space");
            compare(field.text, "I said the ");
            // The cursor moved elsewhere (a tap, not just after a key: a
            // move within 300 ms of one is the keyboard's own): read again
            // from there.
            wait(350);
            field.text = "Hello. Good wor";
            field.cursorPosition = field.text.length;
            tryCompare(kb, "_word", "wor", 1000);
            verify(candidateTexts().map(function (t) { return t.toLowerCase(); }).indexOf("work") > 0,
                   JSON.stringify(candidateTexts()));
            compare(kb._prevWord, "Good");
            verify(!kb._sentenceStart);
            // After ". " a sentence starts; inside a word nothing is being
            // typed (a correction would cut it in two).
            field.cursorPosition = 7;          // "Hello. |Good"
            tryCompare(kb, "_sentenceStart", true, 1000);
            compare(kb._word, "");
            compare(kb._prevWord, "Hello");
            field.cursorPosition = 13;         // "w|or"
            tryCompare(kb, "_sentenceStart", false, 1000);
            compare(kb._word, "");
            compare(kb._prevWord, "Good");
            // The arrows: read again once the cursor has moved.
            field.cursorPosition = 3;
            wait(350);
            tapKey("Space");                    // "Hel lo."
            compare(field.text, "Hel lo. Good wor");
            wait(350);
            field.cursorPosition = field.text.length;
            tryCompare(kb, "_word", "wor", 1000);
        }

        // Emoji suggestions for words (GAPS V3, V6): CLDR's keywords; a tap
        // puts the emoji in place of the word, and it joins the recents.
        function test_emojiSuggestions() {
            kb.textAssistData = "";
            showKeyboard();
            type(["p", "i", "z", "z", "a"]);
            tryVerify(function() { return kb.candidates.some(function (c) { return c.kind === "emoji"; }); }, 1000,
                      JSON.stringify(candidateTexts()));
            var em = kb.candidates.filter(function (c) { return c.kind === "emoji"; })[0];
            compare(em.text, "🍕");
            compare(kb.candidates[kb.candidates.length - 1].kind, "emoji");
            compare(kb.candidates.length, 3);          // the phone's three cells
            tapCandidate(em.text);
            compare(field.text, "🍕 ");
            compare(kb._emojiRecent[0], "🍕");
            // No emoji for words without one, nor with the setting off.
            type(["q", "z", "x"]);
            verify(!kb.candidates.some(function (c) { return c.kind === "emoji"; }));
            kb.emojiSuggestions = false;
            type(["Backspace", "Backspace", "Backspace"]);
            type(["c", "a", "t"]);
            verify(!kb.candidates.some(function (c) { return c.kind === "emoji"; }), JSON.stringify(candidateTexts()));
            kb.emojiSuggestions = true;
        }

        // Settings > Text Assist > Shortcuts (x_palm_textinput): the space bar
        // puts in what a shortcut stands for, with auto-correct off too;
        // backspace puts the shortcut back; the switch turns them off.
        function test_textAssistShortcuts() {
            var before = sys.textAssist;
            sys.textAssist = { suggestions: true, autoCorrect: false, swipe: true, spaces2period: true, forgetWords: 0,
                               shortcuts: { omw: "On my way", brb: "be right back" }, shortcutsOn: true };
            showKeyboard();
            type(["o", "m", "w"]);
            compare(kb.candidates[0].kind, "typed");
            compare(kb.candidates[1].kind, "correction");
            compare(kb.candidates[1].text, "On my way");
            tapKey("Space");
            compare(field.text, "On my way ");
            tapKey("Backspace");
            compare(field.text.toLowerCase(), "omw");
            tapKey("Space");
            compare(field.text.toLowerCase(), "omw ");
            // Capitalized as typed.
            tapKey("Shift");
            type(["b", "r", "b", "Space"]);
            compare(field.text.toLowerCase().slice(0, 4), "omw ");
            compare(field.text.slice(4), "Be right back ");
            // Off: left as typed.
            sys.textAssist = { suggestions: true, autoCorrect: false, swipe: true, spaces2period: true, forgetWords: 0,
                               shortcuts: { omw: "On my way" }, shortcutsOn: false };
            type(["o", "m", "w"]);
            verify(!kb.candidates.some(function (c) { return c.text === "On my way"; }), JSON.stringify(kb.candidates));
            tapKey("Space");
            verify(/omw $/.test(field.text), field.text);
            sys.textAssist = before;
        }

        function test_textAssistLearnsTheNextWord() {
            kb.textAssistData = "";
            showKeyboard();
            for (var n = 0; n < 2; ++n)
                type(["s", "e", "e", "Space", "y", "o", "u", "Space"]);
            type(["s", "e", "e", "Space"]);
            compare(candidateTexts()[0], "you");
            verify(kb.textAssistData.indexOf("\"see\"") >= 0, "kept for the next run");
            // Settings > Text Assist > Forget Learned Words.
            kb.forgetWordsAt = Date.now();
            verify(kb.textAssistData.indexOf("\"see\"") < 0, "forgotten");
            type(["s", "e", "e", "Space"]);
            verify(candidateTexts()[0] !== "you");
            kb.forgetWordsAt = 0;
        }

        // Settings > Text Assist > Personal Dictionary (x_palm_textinput
        // userWords): its words are never corrected and are suggested; a
        // learned word deleted there (removedWords) is forgotten.
        function test_personalDictionary() {
            var before = sys.textAssist;
            kb.textAssistData = "";
            function assist(userWords, removedWords) {
                sys.textAssist = { suggestions: true, autoCorrect: true, swipe: true, spaces2period: true, forgetWords: 0,
                                   shortcuts: {}, shortcutsOn: true, userWords: userWords, removedWords: removedWords };
            }
            assist(["teh", "Zorblax"], {});
            showKeyboard();
            type(["t", "e", "h"]);
            verify(!kb.candidates.some(function (c) { return c.kind === "correction"; }), JSON.stringify(kb.candidates));
            tapKey("Space");
            compare(field.text, "teh ");
            // Suggested as written.
            type(["z", "o", "r", "b"]);
            verify(candidateTexts().indexOf("Zorblax") > 0, JSON.stringify(candidateTexts()));
            tapCandidate("Zorblax");
            compare(field.text, "teh Zorblax ");

            // Learned (typed twice), listed for Settings, suggested; then
            // deleted from the dictionary: forgotten, no longer suggested.
            field.text = "";
            assist([], {});
            for (var n = 0; n < 2; ++n)
                type(["k", "w", "y", "j", "i", "b", "o", "Space"]);
            compare(kb.learnedWords, ["kwyjibo"]);
            verify(kb.learnedWords.indexOf("see") < 0, "words of the list are not listed");
            type(["k", "w", "y", "j"]);
            verify(candidateTexts().indexOf("kwyjibo") > 0, JSON.stringify(candidateTexts()));
            type(["Backspace", "Backspace", "Backspace", "Backspace"]);
            assist([], { kwyjibo: Date.now() });
            compare(kb.learnedWords, []);
            type(["k", "w", "y", "j"]);
            verify(candidateTexts().indexOf("kwyjibo") < 0, JSON.stringify(candidateTexts()));
            // Applied once: typed again, it is learned again.
            type(["Backspace", "Backspace", "Backspace", "Backspace"]);
            for (n = 0; n < 2; ++n)
                type(["k", "w", "y", "j", "i", "b", "o", "Space"]);
            compare(kb.learnedWords, ["kwyjibo"]);
            sys.textAssist = before;
            kb.textAssistData = "";
        }

        // Backspace putting back a word a correction replaced offers "Add" at
        // the end of the bar; tapped, the word joins the personal dictionary
        // (the system's x_palm_textinput.userWords) and is not corrected again.
        function test_addToDictionaryAfterUndo() {
            var before = sys.textAssist;
            var added = [];
            function onAdded(w) { added.push(w); }
            sys.dictionaryWordAdded.connect(onAdded);
            showKeyboard();
            type(["t", "e", "h", "Space"]);
            compare(field.text.toLowerCase(), "the ");
            tapKey("Backspace");
            compare(field.text.toLowerCase(), "teh");
            var last = kb.candidates[kb.candidates.length - 1];
            compare(last.kind, "add");
            compare(last.text.toLowerCase(), "teh");
            tapCandidate(last.text);
            compare(field.text.toLowerCase(), "teh", "the text is left alone");
            compare(added.length, 1);
            verify(sys.textAssist.userWords.some(function (w) { return w.toLowerCase() === "teh"; }), JSON.stringify(sys.textAssist.userWords));
            verify(!kb.candidates.some(function (c) { return c.kind === "add"; }), "offered once");
            tapKey("Space");
            type(["t", "e", "h", "Space"]);
            compare(field.text.toLowerCase(), "teh teh ");
            // A shortcut put back is not offered.
            sys.textAssist = { suggestions: true, autoCorrect: true, swipe: true, spaces2period: true, forgetWords: 0,
                               shortcuts: { omw: "On my way" }, shortcutsOn: true, userWords: [], removedWords: {} };
            type(["o", "m", "w", "Space", "Backspace"]);
            verify(/omw$/.test(field.text), field.text);
            verify(!kb.candidates.some(function (c) { return c.kind === "add"; }), JSON.stringify(kb.candidates));
            // Nor after a word typed on.
            tapKey("Space");
            type(["t", "e", "h", "Space", "Backspace", "s"]);
            verify(!kb.candidates.some(function (c) { return c.kind === "add"; }), JSON.stringify(kb.candidates));
            sys.dictionaryWordAdded.disconnect(onAdded);
            sys.textAssist = before;
        }

        // Settings > Text Assist > Keyboards: the language key (Shift on the
        // symbol page) goes to the next keyboard; its layout and words follow.
        function test_keyboardsAndLanguageKey() {
            sys.keyboards = [{ layout: "qwerty", language: "en" }, { layout: "qwertz", language: "de" },
                             { layout: "qwerty", language: "none" }];
            sys.keyboard = sys.keyboards[0];
            showKeyboard();
            compare(kb.layoutName, "qwerty");
            tapKey("123");
            tapKey("En");
            compare(sys.keyboard.language, "de", "the next keyboard, kept by the system");
            compare(kb.layoutName, "qwertz");
            compare(kb.language, "de");
            // QWERTZ: z where QWERTY has y.
            tapKey("ABC");
            tryVerify(function() { return kb.keyRect("z") !== null && kb.keyRect("y") !== null; }, 1000);
            verify(kb.keyRect("z").y < kb.keyRect("y").y, "z on the top row");
            // German words: "fur" is "für".
            type(["f", "u", "r"]);
            tryVerify(function() { return kb.candidates.length > 1; }, 1000);
            compare(kb.candidates[1].kind, "correction");
            compare(kb.candidates[1].text, "für");
            tapKey("Space");
            compare(field.text, "für ");
            // Then the keyboard without words: no corrections, struck through.
            tapKey("123");
            tapKey("De");
            compare(sys.keyboard.language, "none");
            tapKey("ABC");
            type(["t", "e", "h", "Space"]);
            compare(field.text, "für teh ");
            // And round to the first.
            tapKey("123");
            tapKey("En-");
            compare(sys.keyboard.language, "en");
            sys.keyboards = [{ layout: "qwerty", language: "en" }];
            sys.keyboard = sys.keyboards[0];
        }

        // Several keyboards side by side (GAPS V7): with another installed
        // the language key is the globe; a tap goes through the languages,
        // then to the next keyboard, kept by the system. The Phoenix
        // keyboard: the same keys, flat, without the art.
        function test_globeKeySwitchesKeyboards() {
            sys.keyboards = [{ layout: "qwerty", language: "en" }, { layout: "qwertz", language: "de" }];
            sys.keyboard = sys.keyboards[0];
            sys.installedKeyboards = ["classic", "phoenix", "ose"];
            sys.keyboardId = "classic";
            showKeyboard();
            compare(kb.otherKeyboards, ["phoenix"]);             // OSE's is not drawn here
            verify(!kb.phoenixLook);
            tapKey("123");
            tapKey("🌐");                              // the globe: the next language
            compare(sys.keyboard.language, "de");
            compare(sys.keyboardId, "classic");
            tapKey("🌐");                              // then the next keyboard
            compare(sys.keyboardId, "phoenix");
            compare(sys.keyboard.language, "en");
            verify(kb.phoenixLook);
            verify(!kb.touchpadLook);
            compare(kb.otherKeyboards, ["classic"]);
            // Flat keys: no art drawn.
            tapKey("ABC");
            var flat = 0;
            (function walk(o) {
                for (var i = 0; i < o.children.length; ++i) {
                    if (o.children[i].flat === true)
                        ++flat;
                    walk(o.children[i]);
                }
            })(kb);
            verify(flat > 20, "flat keys: " + flat);
            type(["h", "i"]);
            compare(field.text.toLowerCase(), "hi");
            // Back round to webOS Classic.
            tapKey("123");
            tapKey("🌐");
            compare(sys.keyboard.language, "de");
            tapKey("🌐");
            compare(sys.keyboardId, "classic");
            sys.installedKeyboards = ["classic"];
            sys.keyboardId = "classic";
            sys.keyboards = [{ layout: "qwerty", language: "en" }];
            sys.keyboard = sys.keyboards[0];
            verify(kb.otherKeyboards.length === 0);
        }

        // Held, the language key lists the keyboards (selectKeyboardCombo).
        function test_languageKeyHeldLists() {
            sys.keyboards = [{ layout: "qwerty", language: "en" }, { layout: "azerty", language: "fr" }];
            sys.keyboard = sys.keyboards[0];
            showKeyboard();
            tapKey("123");
            var r = kb.keyRect("En");
            verify(r !== null);
            mousePress(kb, r.x + r.width / 2, r.y + r.height / 2);
            tryVerify(function() { return kb._extendedKeys !== null; }, 2000, "the list");
            var popup = kb._popup || kb._computePopup();
            compare(popup.cells.map(function (c) { return c.text; }), ["En", "Fr"]);
            // Slide onto Fr and let go.
            var cell = popup.cells[1];
            mouseMove(kb, (cell.x + kb._popupKeyWidth / 2) * kb.pixelScale, (cell.y + kb._popupKeyHalf / 2) * kb.pixelScale + kb.candidateBarHeight);
            mouseRelease(kb, (cell.x + kb._popupKeyWidth / 2) * kb.pixelScale, (cell.y + kb._popupKeyHalf / 2) * kb.pixelScale + kb.candidateBarHeight);
            compare(sys.keyboard.layout, "azerty");
            compare(kb.layoutName, "azerty");
            sys.keyboards = [{ layout: "qwerty", language: "en" }];
            sys.keyboard = sys.keyboards[0];
        }

        // One finger across the keys, without lifting.
        function swipe(keys) {
            var pts = keys.map(function (k) {
                var r = kb.keyRect(k);
                return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            });
            mousePress(kb, pts[0].x, pts[0].y);
            for (var i = 1; i < pts.length; ++i) {
                for (var s = 1; s <= 6; ++s) {
                    mouseMove(kb, pts[i - 1].x + (pts[i].x - pts[i - 1].x) * s / 6, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * s / 6);
                    wait(10);
                }
            }
            mouseRelease(kb, pts[pts.length - 1].x, pts[pts.length - 1].y);
            wait(20);
        }

        function test_swipeTyping() {
            showKeyboard();
            swipe(["h", "e", "l", "o"]);
            verify(findChild(kb, "swipeTrail") !== null);
            // A space after it (the owner, 8 October 2026).
            compare(field.text.toLowerCase(), "hello ");
            // The other words it may have been, in the bar.
            verify(kb.candidates.length > 1);
            compare(kb.candidates[0].text.toLowerCase(), "hello");
        }

        // The space after a swiped word: the next swipe needs none, a space
        // typed is not a second, punctuation goes before it, backspace
        // takes it and the word is being typed again; a candidate picked
        // keeps it.
        function test_swipeAutoSpace() {
            showKeyboard();
            swipe(["h", "e", "l", "o"]);
            compare(field.text, "Hello ");
            swipe(["t", "h", "e", "r", "e"]);
            compare(field.text, "Hello there ");
            // Punctuation before the space, and the space after it.
            tapKey(",");
            compare(field.text, "Hello there, ");
            // A space typed now is not a second one.
            tapKey("Space");
            compare(field.text, "Hello there, ");
            // A typed space after that is the user's.
            type(["h", "i"]);
            compare(field.text, "Hello there, hi");
            tapKey("Space");
            compare(field.text, "Hello there, hi ");
            // A swipe right after typed letters gets a space before it.
            field.text = "";
            kb._sentenceStart = true;
            kb._assistReset();
            type(["o", "k"]);
            swipe(["h", "e", "l", "o"]);
            compare(field.text.toLowerCase(), "ok hello ");
            // Backspace takes the space: the word is being typed again.
            tapKey("Backspace");
            compare(field.text.toLowerCase(), "ok hello");
            compare(kb._word.toLowerCase(), "hello");
            type(["s"]);
            compare(field.text.toLowerCase(), "ok hellos");
        }

        function test_swipeAutoSpaceSentence() {
            showKeyboard();
            swipe(["h", "e", "l", "o"]);
            // A period before the space; the next swipe is capitalized.
            tapKey(".");
            compare(field.text, "Hello. ");
            swipe(["t", "h", "e", "r", "e"]);
            compare(field.text, "Hello. There ");
            // Two spaces after the word: the first is the automatic one,
            // the second types ". " (Quick period).
            tapKey("Space");
            tapKey("Space");
            compare(field.text, "Hello. There. ");
        }

        // After a swipe, a candidate replaces the word and keeps one space.
        function test_swipeCandidateKeepsTheSpace() {
            showKeyboard();
            swipe(["h", "e", "l", "o"]);
            compare(field.text, "Hello ");
            verify(kb.candidates.length > 1, JSON.stringify(kb.candidates));
            var other = kb.candidates[1].text;
            tapCandidate(other);
            compare(field.text, other + " ");
            // And a space typed after it is not a second one.
            tapKey("Space");
            compare(field.text, other + " ");
        }

        // A candidate tapped while typing: its space too is the automatic one.
        function test_candidateAutoSpace() {
            kb.textAssistData = "";
            showKeyboard();
            type(["h", "e", "l"]);
            tryVerify(function() { return kb.candidates.length === 3; }, 1000);
            var word = kb.candidates[1].text;
            tapCandidate(word);
            compare(field.text, word + " ");
            tapKey(",");
            compare(field.text, word + ", ");
        }

        // Tapped typing is as it was: every space typed is typed.
        function test_tappedTypingUnchanged() {
            var before = sys.textAssist;
            sys.textAssist = { suggestions: true, autoCorrect: false, swipe: true, spaces2period: false, forgetWords: 0,
                               shortcuts: {}, shortcutsOn: true };
            showKeyboard();
            type(["h", "i", "Space", "Space"]);
            compare(field.text.toLowerCase(), "hi  ");
            tapKey(",");
            compare(field.text.toLowerCase(), "hi  ,");
            sys.textAssist = before;
        }

        // The trail keeps only the swipe's recent end, fading and thinning
        // toward its older end (deterministic: the segments at a time).
        function test_swipeTrailFades() {
            showKeyboard();
            var key = 48;
            // A long swipe, 1 px per ms, left to right.
            var path = [];
            for (var i = 0; i <= 1000; i += 10)
                path.push({ x: i, y: 50, t: i });
            var segs = kb._trailSegments(path, 1000, key);
            verify(segs.length > 0);
            // At most cTrailKeys keys long, and no older than cTrailTime.
            var head = segs[segs.length - 1], tail = segs[0];
            compare(head.x1, 1000);
            var reach = Math.min(kb.cTrailKeys * key, kb.cTrailTime);
            fuzzyCompare(head.x1 - tail.x0, reach, 0.5);
            // Fading and thinning toward the old end.
            for (i = 1; i < segs.length; ++i) {
                verify(segs[i].alpha >= segs[i - 1].alpha, "alpha rises toward the finger");
                verify(segs[i].width >= segs[i - 1].width, "width rises toward the finger");
                fuzzyCompare(segs[i].alpha, segs[i - 1].alpha1, 1e-9);
            }
            verify(tail.alpha < 0.15 * kb.cTrailAlpha, "the old end nearly gone: " + tail.alpha);
            verify(head.alpha > 0.9 * kb.cTrailAlpha, "the finger's end strong: " + head.alpha);
            compare(head.alpha1, kb.cTrailAlpha);
            // The finger resting: the trail fades away with time.
            var later = kb._trailSegments(path, 1000 + kb.cTrailTime / 2, key);
            verify(later.length > 0 && later[later.length - 1].alpha < 0.6 * kb.cTrailAlpha);
            compare(kb._trailSegments(path, 1000 + kb.cTrailTime, key).length, 0);
            // A slow swipe: cut by time, not length.
            var slow = [];
            for (i = 0; i <= 100; i += 10)
                slow.push({ x: i, y: 50, t: i * 20 });
            segs = kb._trailSegments(slow, 2000, key);
            fuzzyCompare(segs[segs.length - 1].x1 - segs[0].x0, kb.cTrailTime / 20, 0.5);
        }

        // Mid-swipe, the trail on the screen: blue near the finger, none at
        // the start of a long swipe (cut by length: the tail's time is made
        // long here, so how late a slow machine draws or grabs the frame
        // does not matter; the fade with time is test_swipeTrailFades').
        function test_swipeTrailOnScreen() {
            showKeyboard();
            var time = kb.cTrailTime;
            kb.cTrailTime = 60000;
            var a = kb.keyRect("q"), b = kb.keyRect("p");
            var y = a.y + a.height / 2;
            mousePress(kb, a.x + a.width / 2, y);
            for (var s = 1; s <= 30; ++s) {
                mouseMove(kb, a.x + a.width / 2 + (b.x - a.x) * s / 30, y);
                wait(16);
            }
            var blue = function (shot, x) {
                var p = kb.mapToItem(shell, x, y);
                var c = shot.pixel(Math.round(p.x), Math.round(p.y));
                return c.b - c.r;
            };
            var behind = 0, start = 1;
            // Painted on a coming frame (Canvas.requestPaint).
            for (var n = 0; n < 50 && behind <= 0.2; ++n) {
                wait(20);
                var shot = grabImage(shell);
                behind = blue(shot, b.x + b.width / 2 - 8);
                start = blue(shot, a.x + a.width / 2 + 4);
            }
            // Let go before checking: a failure must not leave the finger down.
            mouseRelease(kb, b.x + b.width / 2, y);
            kb.cTrailTime = time;
            verify(behind > 0.2, "the trail behind the finger: " + behind);
            verify(start < 0.05, "the swipe's start no longer shown: " + start);
        }

        // Settings > Text Assist > Keyboard style: the phone takes the
        // TouchPad's look at once, and back.
        function test_keyboardStyle() {
            showKeyboard();
            compare(kb.touchpadLook, false);
            verify(kb._art.indexOf("keyboard-phone/") >= 0);
            var lum = function () {
                var r = kb.keyRect("g");
                var c = kb.mapToItem(shell, r.x + r.width * 0.2, r.y + r.height / 2);
                var p = grabImage(shell).pixel(Math.round(c.x), Math.round(c.y));
                return (p.r + p.g + p.b) / 3;
            };
            verify(lum() < 0.1, "black letters");
            sys.tweaks = { keyboardStyle: "touchpad" };
            tryCompare(kb, "touchpadLook", true, 1000);
            verify(kb._art.indexOf("keyboard-tablet/") >= 0);
            tryVerify(function () { return lum() > 0.6; }, 1000, "the TouchPad's light letter keys");
            // The letters still type, in the same places.
            type(["h", "i"]);
            compare(field.text, "hi");
            sys.tweaks = { keyboardStyle: "black" };
            tryCompare(kb, "touchpadLook", false, 1000);
            tryVerify(function () { return lum() < 0.1; }, 1000);
            sys.tweaks = {};
        }

        // Dictation: the bar's microphone; what was said is typed at the cursor.
        // (The transcriber here is a stand-in command with transcribe's reply.)
        function test_dictation() {
            if (kb.dictation === null)
                skip("built without Qt Multimedia: no microphone");
            showKeyboard();
            verify(findChild(kb, "dictationKey").visible);
            var old = kb.dictation.command;
            kb.dictation.command = ["sh", "-c", "echo '{\"returnValue\":true,\"text\":\" hello there. \"}'"];
            kb.dictation.transcribeFile("/dev/null");
            verify(kb.dictation.busy);
            tryCompare(field, "text", "Hello there.", 3000);
            verify(!kb.dictation.busy);
            // Not installed: said in the bar, nothing typed.
            kb.dictation.command = ["sh", "-c", "echo '{\"returnValue\":false,\"errorCode\":2,\"errorText\":\"Speech recognition is not installed\"}'; exit 1"];
            kb.dictation.transcribeFile("/dev/null");
            tryCompare(kb, "dictationMessage", "Speech recognition is not installed", 3000);
            compare(field.text, "Hello there.");
            // An app's recording (Voice Dial's) is not typed, nor shown in the bar.
            kb.dictation.owner = "w7";
            kb.dictation.command = ["sh", "-c", "echo '{\"returnValue\":true,\"text\":\"call ada\"}'"];
            var heard = "";
            var take = function(t) { heard = t; };
            kb.dictation.transcribed.connect(take);
            kb.dictation.transcribeFile("/dev/null");
            verify(!findChild(kb, "candidateBar").transcribing);
            tryCompare(kb.dictation, "busy", false, 3000);
            kb.dictation.transcribed.disconnect(take);
            compare(heard, "call ada");
            compare(field.text, "Hello there.");
            kb.dictation.owner = "";
            // Punctuation said aloud is typed as the mark; the recognizer's
            // own commas around the word go.
            kb.dictation.command = ["sh", "-c", "echo '{\"returnValue\":true,\"text\":\"see you soon, comma, Ada period\"}'"];
            kb.dictation.transcribeFile("/dev/null");
            tryCompare(field, "text", "Hello there. See you soon, Ada.", 3000);
            kb.dictation.command = old;
        }

        // While dictating: the status bar's microphone is on, and what was
        // said so far shows in the bar as it is said (GAPS V2). The
        // microphone is a WAV file here (phoenix-sim --microphone-file).
        function test_dictationWhileSpeaking() {
            if (kb.dictation === null)
                skip("built without Qt Multimedia: no microphone");
            if (kb.dictation.partialInterval === undefined)
                skip("Phoenix.Native without partialText: build this checkout's");
            showKeyboard();
            field.text = "";
            var old = kb.dictation.command, oldFiles = kb.dictation.inputFiles;
            var wav = String(Qt.resolvedUrl("../../services/wakeword/tests/data/hey-phoenix-timer.wav")).replace(/^file:\/\//, "");
            kb.dictation.inputFiles = [wav];
            kb.dictation.partialInterval = 300;
            kb.dictation.command = ["sh", "-c", "echo '{\"returnValue\":true,\"text\":\"set a timer comma please\"}'"];
            var bar = findChild(shell, "statusBar");
            compare(bar.microphone, "");
            kb.toggleDictation();
            verify(kb.dictation.listening);
            compare(bar.microphone, "on");
            var status = findChild(kb, "dictationStatus");
            tryVerify(function () { return kb.dictation.partialText !== ""; }, 3000);
            compare(status.text, "set a timer, please");
            verify(status.visible);
            kb.toggleDictation();                    // done
            tryCompare(field, "text", "Set a timer, please", 3000);
            compare(bar.microphone, "");
            compare(kb.dictation.partialText, "");
            kb.dictation.command = old;
            kb.dictation.inputFiles = oldFiles;
            kb.dictation.partialInterval = 2000;
        }

        function test_noCandidateBarInPasswordFields() {
            field.echoMode = TextInput.Password;
            showKeyboard();
            verify(!kb.candidateBarShown);
            fuzzyCompare(kb.keyboardHeight, kb.keysHeight, 0.01);
            field.echoMode = TextInput.Normal;
        }
}
}
