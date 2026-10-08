// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The keyboard's clipboard key and clip strip (Phoenix, M6 F2;
// ClipStrip.qml, CandidateBar.qml, VirtualKeyboard.qml "Clipboard"): the
// key at the left of the candidate bar in every field, the strip of clip
// cards in place of the keys with its category tabs (the launcher's tab
// bar), the clips as card view's cards (the one in focus centred, the
// others smaller and dimmed beside it, a swipe snapping clip to clip), a
// tap on the middle clip pasting through the IME's commit and on a side
// clip centring it, a hold's actions, and Back, ABC or the key bringing
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
            var s = findChild(kb, "clipStrip");
            tryCompare(s, "visible", true, 1000);
            tryCompare(s, "settled", true, 3000);
            return s;
        }

        function card(id) {
            var c;
            tryVerify(function () { c = findChild(kb, "clipCard-" + id); return c !== null; }, 1000, "card " + id);
            return findChild(c, "clipCardArea");
        }
        function strip() { return findChild(kb, "clipStrip"); }
        function indexOf(id) {
            for (var i = 0; i < fake.clips.length; ++i)
                if (fake.clips[i].id === id)
                    return i;
            return -1;
        }
        // At rest: nothing sliding, opening or switching tabs.
        function settle() {
            tryCompare(strip(), "settled", true, 3000);
        }
        // The clip's face centre, on the screen.
        function centreOf(id) {
            var a = card(id);
            return a.mapToItem(kb, a.width / 2, a.height / 2);
        }
        // A tap on the part of a clip's face that is on the screen (a side
        // clip peeks in).
        function visiblePoint(id) {
            var a = card(id);
            var tl = a.mapToItem(kb, 0, 0), br = a.mapToItem(kb, a.width, a.height);
            var x0 = Math.max(tl.x, 0), x1 = Math.min(br.x, kb.width);
            verify(x1 - x0 > 4, "clip " + id + " on the screen");
            return Qt.point((x0 + x1) / 2, (tl.y + br.y) / 2);
        }
        function clickClip(id) {
            var p = visiblePoint(id);
            mouseClick(kb, p.x, p.y);
        }
        // A tap on a clip, brought to the middle first when it is not
        // there (a tap on each neighbour on the way, as a finger would).
        function tapClip(id) {
            settle();
            var target = indexOf(id);
            while (strip().current !== target) {
                var next = strip().current + (target > strip().current ? 1 : -1);
                clickClip(fake.clips[next].id);
                tryCompare(strip(), "current", next, 2000);
                settle();
            }
            clickClip(id);
        }
        // A finger across the clips: dx in steps, over ms of the strip's clock.
        function swipe(dx, ms) {
            var s = strip();
            var area = findChild(kb, "clipCardsTouch");
            var t = 1000;
            s.clock = function () { return t; };
            var x = area.width / 2, y = s.cardTop + s.cardHeight / 2;
            mousePress(area, x, y);
            var steps = 8;
            for (var i = 1; i <= steps; ++i) {
                t += ms / steps;
                mouseMove(area, x + dx * i / steps, y);
            }
            mouseRelease(area, x + dx, y);
            s.clock = function () { return Date.now(); };
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
            var p = visiblePoint(id);
            mousePress(kb, p.x, p.y);
            tryCompare(menu, "visible", true, 2000);
            mouseRelease(kb, p.x, p.y);
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
            tapClip("c");
            tryCompare(findChild(kb, "clipMessage"), "visible", true, 1000);
            compare(field.text, "");
            verify(kb.clipsOpen);
            compare(fake.calls.indexOf("paste c"), -1);
            showKeyboard(true);
            openStrip();
            tapClip("c");
            tryCompare(field, "text", fake.secret, 1000);
            verify(fake.calls.indexOf("paste c") >= 0);
            verify(!kb.clipsOpen);
        }

        function test_imageGoesToTheShell() {
            showKeyboard(false);
            openStrip();
            // The fourth card, brought to the middle.
            tapClip("d");
            compare(images.count, 1);
            compare(images.signalArguments[0][0].id, "d");
        }

        // As card view: the clip in focus centred, its neighbours beside
        // it smaller (the non-active card scale) and dimmed.
        function test_clipsSitAsCards() {
            showKeyboard(false);
            var s = openStrip();
            compare(s.current, 0);
            compare(s.position, 0);
            var a = centreOf("a"), b = centreOf("b");
            fuzzyCompare(a.x, kb.width / 2, 1);
            verify(b.x > a.x + card("a").width / 2, "the next one to the right");
            verify(b.x - card("b").width * s.sideScale / 2 < kb.width, "peeking in");
            verify(s.sideScale < 1);
            fuzzyCompare(s.sideScale, Theme.nonActiveCardRatio / Theme.activeCardRatio, 0.001);
            var bScale = card("b").mapToItem(kb, card("b").width, 0).x - card("b").mapToItem(kb, 0, 0).x;
            fuzzyCompare(bScale / card("b").width, s.sideScale, 0.01);
            fuzzyCompare(findChild(findChild(kb, "clipCard-b"), "clipDim").opacity, 1 - Theme.cardDimming, 0.001);
            compare(findChild(findChild(kb, "clipCard-a"), "clipDim").opacity, 0);
        }

        // A short slow swipe goes back; a longer one goes on to the clip it
        // passed half of; a flick goes to the next; each ends on a clip.
        function test_swipeSnapsClipToClip() {
            showKeyboard(false);
            var s = openStrip();
            swipe(-s.innerPitch * 0.3, 600);
            settle();
            compare(s.position, 0);
            swipe(-s.innerPitch * 0.7, 900);
            settle();
            compare(s.position, 1);
            fuzzyCompare(centreOf("b").x, kb.width / 2, 1);
            // A flick: past Theme.flickMinVelocity, though short.
            var dx = Math.max(s.innerPitch * 0.25, Theme.flickMinVelocity * 60);
            swipe(-dx, 30);
            settle();
            compare(s.position, 2);
            swipe(dx, 30);
            settle();
            compare(s.position, 1);
            // Past the first, it comes back.
            swipe(s.innerPitch * 1.6, 900);
            settle();
            compare(s.position, 0);
            // A swipe pastes nothing.
            compare(field.text, "");
            verify(kb.clipsOpen);
        }

        // A tap on a side clip brings it to the middle; on the middle one, pastes.
        function test_tapSideCentresTapMiddlePastes() {
            showKeyboard(false);
            var s = openStrip();
            clickClip("b");
            tryCompare(s, "current", 1, 2000);
            settle();
            compare(s.position, 1);
            compare(field.text, "");
            verify(kb.clipsOpen);
            clickClip("a");
            settle();
            compare(s.position, 0);
            compare(field.text, "");
            clickClip("a");
            tryCompare(field, "text", "Hello from Notes", 1000);
            compare(kb.clipsOpen, false);
        }

        // Another tab: the clips slide in from its side, from the first.
        function test_tabsSlideTheClips() {
            showKeyboard(false);
            var s = openStrip();
            clickClip("b");
            settle();
            compare(s.position, 1);
            mouseClick(findChild(kb, "clipTab-pinned"));
            compare(s.category, "pinned");
            compare(s.position, 0);
            settle();
            compare(findChild(kb, "clipCards").opacity, 1);
            // The tab bar is the launcher's.
            verify(String(findChild(kb, "clipTabBar").source).indexOf("launcher3/tab-bg") >= 0);
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
