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
            // 377 keyboard pixels upright (PhoneKeyboard.cpp:231), the Pre 3's
            // 1.5 per shell pixel at density 1.
            compare(Theme.keyboardScale, 1 / 1.5);
            fuzzyCompare(kb.keyboardHeight, 377 / 1.5, 0.01);
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
            mouseMove(kb, p.x, p.y);
            mouseRelease(kb, p.x, p.y);
            compare(field.text, "è");
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

        function test_landscape() {
            showKeyboard();
            sys.deviceOrientation = "left";
            tryCompare(shell, "uiOrientation", "left", 3000);
            // 260 keyboard pixels on its side (PhoneKeyboard.cpp:232), at once.
            tryVerify(function() { return Math.abs(kb.keyboardHeight - 260 / 1.5) < 0.01; }, 3000);
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
    }
}
