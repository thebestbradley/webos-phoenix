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

        function test_swipeTyping() {
            showKeyboard();
            // Across h, e, l, o: one finger, without lifting.
            var pts = ["h", "e", "l", "o"].map(function (k) {
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
            verify(findChild(kb, "swipeTrail") !== null);
            mouseRelease(kb, pts[3].x, pts[3].y);
            compare(field.text.toLowerCase(), "hello");
            // The other words it may have been, in the bar; a second swipe gets a space.
            verify(kb.candidates.length > 1);
            compare(kb.candidates[0].text.toLowerCase(), "hello");
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
            kb.dictation.command = old;
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
