// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The keyboard's clipboard key and clip strip (Phoenix, M6 F2;
// ClipStrip.qml, CandidateBar.qml, VirtualKeyboard.qml "Clipboard"): the
// key at the left of the candidate bar in every field, the strip of clip
// cards in place of the keys with its category tabs, a tap pasting through
// the IME's commit, a hold's actions, and Back, ABC or the key bringing
// the keys back. The clipboard service is a stand-in (the shell's
// ClipboardClient talks to org.webosphoenix.clipboard; its own tests are
// in apps/shared/luna/src/clipboard.test.ts).
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

    TextInput {
        id: field
        x: 10
        y: 40
        width: 200
        height: 20
    }

    // Stands in for ClipboardClient.
    QtObject {
        id: fake
        property bool keyAvailable: true
        property var clips: []
        property var categories: [{ id: "cwork", name: "Work" }]
        property var calls: []
        property string secret: "s3cret-Pass!"
        function refresh(cat) { calls.push("refresh " + (cat === undefined ? "" : cat)); }
        function paste(clip, done) { calls.push("paste " + clip.id); done(secret); }
        function setPinned(clip, on) { calls.push((on ? "pin " : "unpin ") + clip.id); }
        function setCategory(clip, id) { calls.push("category " + clip.id + " " + id); }
        function remove(clip) { calls.push("delete " + clip.id); }
        function openApp() { calls.push("app"); }
        function appTitle(id) { return id === "org.webosphoenix.notes" ? "Notes" : ""; }
    }

    SignalSpy { id: images; target: shell.keyboard; signalName: "imagePasteRequested" }

    TestCase {
        name: "ClipStrip"
        when: windowShown

        readonly property var kb: shell.keyboard

        function initTestCase() {
            kb.clipboard = fake;
        }

        function init() {
            sys.deviceOrientation = "up";
            tryCompare(shell, "uiOrientation", "up", 3000);
            tryVerify(function() { return !shell.rotator.rotating; }, 3000);
            field.echoMode = TextInput.Normal;
            field.focus = false;
            shell.forceActiveFocus();
            shell.unlock();
            tryCompare(shell, "keyboardOpen", false, 2000);
            tryCompare(shell.notifications, "negativeSpace", 0, 2000);
            field.text = "";
            fake.keyAvailable = true;
            fake.calls = [];
            fake.clips = [
                { id: "a", type: "text", text: "Hello from Notes", source: "org.webosphoenix.notes", time: Date.now() - 120000, pinned: false, category: "", sensitive: false },
                { id: "b", type: "link", text: "https://webosphoenix.org", title: "Phoenix", source: "", time: Date.now(), pinned: true, category: "cwork", sensitive: false },
                { id: "c", type: "text", source: "org.webosphoenix.passwords", time: Date.now(), pinned: false, category: "", sensitive: true, kind: "password", length: 12 },
                { id: "d", type: "image", image: "", source: "", time: Date.now(), pinned: false, category: "", sensitive: false }
            ];
            images.clear();
        }

        function showKeyboard(password) {
            // The field's type is read as it takes the focus.
            if (shell.keyboardOpen) {
                kb.closeClips();
                field.focus = false;
                shell.forceActiveFocus();
                tryCompare(shell, "keyboardOpen", false, 2000);
            }
            field.echoMode = password ? TextInput.Password : TextInput.Normal;
            field.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", true, 2000);
            tryCompare(shell.notifications, "negativeSpace", kb.keyboardHeight, 2000);
        }

        function openStrip() {
            var key = findChild(kb, "clipboardKey");
            tryCompare(key, "visible", true, 1000);
            mouseClick(key);
            tryCompare(kb, "clipsOpen", true, 1000);
            var strip = findChild(kb, "clipStrip");
            tryCompare(strip, "visible", true, 1000);
            return strip;
        }

        function card(id) {
            var c;
            tryVerify(function () { c = findChild(kb, "clipCard-" + id); return c !== null; }, 1000, "card " + id);
            return findChild(c, "clipCardArea");
        }

        // The menu's entries once the Row has placed them: new delegates
        // all sit at x 0 (the last on top) until the Row's polish, which
        // comes with a frame, sooner or later depending on the backend.
        function menuLaidOut() {
            var row = findChild(kb, "clipMenuRow");
            verify(row !== null);
            waitForItemPolished(row, 2000);
            tryVerify(function () {
                var x = 0, n = 0;
                for (var i = 0; i < row.children.length; ++i) {
                    var c = row.children[i];
                    if (String(c.objectName).indexOf("clipMenu-") !== 0)
                        continue;
                    if (Math.abs(c.x - x) > 0.5)
                        return false;
                    x += c.width;
                    ++n;
                }
                return n > 0 && Math.abs(row.width - x) < 0.5;
            }, 2000, "the menu's entries laid out");
        }
        function menuEntry(id) {
            menuLaidOut();
            var e = findChild(kb, "clipMenu-" + id);
            verify(e !== null, "menu entry " + id);
            return e;
        }

        // Press and hold a card until its actions are up (and laid out).
        function hold(id) {
            var menu = findChild(kb, "clipMenu");
            mousePress(card(id));
            tryCompare(menu, "visible", true, 2000);
            mouseRelease(card(id));
            menuLaidOut();
        }

        function test_keyInEveryFieldWhileOn() {
            showKeyboard(false);
            verify(kb.candidateBarShown);
            verify(findChild(kb, "clipboardKey").visible);
            // A password field: the bar holds only the key.
            showKeyboard(true);
            verify(!kb.assistBarShown);
            verify(kb.candidateBarShown);
            verify(findChild(kb, "clipboardKey").visible);
            compare(kb.candidates.length, 0);
            // Off: no key, and no bar in a password field.
            fake.keyAvailable = false;
            verify(!kb.candidateBarShown);
            fake.keyAvailable = true;
        }

        function test_keyOpensTheStripInPlaceOfTheKeys() {
            showKeyboard(false);
            var strip = openStrip();
            verify(!findChild(kb, "keyboardFrame").visible);
            verify(!findChild(kb, "keyboardTouch").enabled);
            // Opening asks for the Recent clips.
            verify(fake.calls.indexOf("refresh recent") >= 0, fake.calls);
            // Tabs: Recent, Pinned, then the user's categories.
            verify(findChild(kb, "clipTab-recent") !== null);
            verify(findChild(kb, "clipTab-pinned") !== null);
            var work = findChild(kb, "clipTab-cwork");
            verify(work !== null);
            mouseClick(work);
            compare(strip.category, "cwork");
            verify(fake.calls.indexOf("refresh cwork") >= 0, fake.calls);
            // The cards: masked secrets show no text.
            var c = findChild(kb, "clipCard-c");
            verify(c !== null);
            compare(findChild(c, "clipMask").text, "••••••••");
            verify(findChild(findChild(kb, "clipCard-b"), "clipPinned").visible);
            verify(!findChild(findChild(kb, "clipCard-a"), "clipPinned").visible);
        }

        function test_tapPastesThroughTheImeAndBringsTheKeysBack() {
            showKeyboard(false);
            openStrip();
            mouseClick(card("a"));
            tryCompare(field, "text", "Hello from Notes", 1000);
            compare(kb.clipsOpen, false);
            verify(findChild(kb, "keyboardFrame").visible);
        }

        function test_secretPastesOnlyIntoAPasswordField() {
            showKeyboard(false);
            openStrip();
            mouseClick(card("c"));
            tryCompare(findChild(kb, "clipMessage"), "visible", true, 1000);
            compare(field.text, "");
            verify(kb.clipsOpen);
            compare(fake.calls.indexOf("paste c"), -1);
            showKeyboard(true);
            openStrip();
            mouseClick(card("c"));
            tryCompare(field, "text", fake.secret, 1000);
            verify(fake.calls.indexOf("paste c") >= 0);
            verify(!kb.clipsOpen);
        }

        function test_imageGoesToTheShell() {
            showKeyboard(false);
            openStrip();
            // The fourth card, scrolled into view.
            var list = findChild(kb, "clipCards");
            list.positionViewAtEnd();
            waitForItemPolished(list, 2000);
            tryVerify(function () {
                var p = card("d").mapToItem(kb, 0, 0);
                return p.x >= 0 && p.x + card("d").width <= kb.width;
            }, 2000, "the fourth card in view");
            mouseClick(card("d"));
            compare(images.count, 1);
            compare(images.signalArguments[0][0].id, "d");
        }

        function test_holdOpensTheActions() {
            showKeyboard(false);
            openStrip();
            var menu = findChild(kb, "clipMenu");
            hold("a");
            mouseClick(menuEntry("pin"));
            verify(fake.calls.indexOf("pin a") >= 0, fake.calls);
            compare(menu.visible, false);
            // Unpin for a pinned one; Save to... lists the categories.
            hold("b");
            verify(findChild(kb, "clipMenu-unpin") !== null);
            mouseClick(menuEntry("save"));
            mouseClick(menuEntry("cat:"));
            verify(fake.calls.indexOf("category b ") >= 0, fake.calls);
            hold("a");
            mouseClick(menuEntry("save"));
            mouseClick(menuEntry("cat:cwork"));
            verify(fake.calls.indexOf("category a cwork") >= 0, fake.calls);
            hold("a");
            mouseClick(menuEntry("delete"));
            verify(fake.calls.indexOf("delete a") >= 0, fake.calls);
            hold("a");
            mouseClick(menuEntry("app"));
            verify(fake.calls.indexOf("app") >= 0, fake.calls);
            // Nothing was pasted by the holds.
            compare(field.text, "");
        }

        function test_backAbcAndHidingBringTheKeysBack() {
            showKeyboard(false);
            openStrip();
            shell.gestureBack();
            compare(kb.clipsOpen, false);
            verify(shell.keyboardOpen);
            openStrip();
            mouseClick(findChild(kb, "clipAbc"));
            compare(kb.clipsOpen, false);
            openStrip();
            // The emoji page and the strip are never up together.
            kb.openEmoji();
            compare(kb.clipsOpen, false);
            kb.closeEmoji();
            openStrip();
            field.focus = false;
            shell.forceActiveFocus();
            tryCompare(shell, "keyboardOpen", false, 2000);
            compare(kb.clipsOpen, false);
        }

        function test_strings() {
            showKeyboard(false);
            var strip = openStrip();
            compare(strip.appName("org.webosphoenix.notes"), "Notes");
            compare(strip.kindName({ kind: "otp" }), "One-time code");
            compare(strip.age(Date.now() - 120000), "2 min");
        }
    }
}
