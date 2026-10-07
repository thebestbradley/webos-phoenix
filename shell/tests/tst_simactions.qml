// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim's functions (sim.qml simActions): the one list its keyboard
// shortcuts, menus, toolbar and Help > Keyboard Shortcuts are made from.
// A key and the menu item made from the same entry do the same thing.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest

Item {
    id: root
    width: 320
    height: 480

    Loader {
        id: sim
        anchors.fill: parent
        source: Qt.resolvedUrl("../qml/sim.qml")
    }

    TestCase {
        name: "SimActions"
        when: windowShown && sim.status === Loader.Ready

        function entries() { return sim.item.simActionList(); }
        function entry(id) {
            var list = entries();
            for (var i = 0; i < list.length; ++i) {
                if (list[i].id === id)
                    return list[i];
            }
            return null;
        }

        function test_theList() {
            var list = entries();
            verify(list.length > 30);
            var ids = {};
            var keys = {};
            for (var i = 0; i < list.length; ++i) {
                var e = list[i];
                if (e.separator)
                    continue;
                verify(e.id !== "", "every entry has an id");
                verify(!ids[e.id], "ids are unique: " + e.id);
                ids[e.id] = true;
                verify(e.text !== "", e.id + " has a name");
                verify(e.run || e.press.length > 0 || e.menu === "", e.id + " does something");
                for (var k = 0; k < e.keys.length; ++k) {
                    verify(!keys[e.keys[k]], "no key twice: " + e.keys[k]);
                    keys[e.keys[k]] = true;
                }
            }
            // The keys the simulator always had.
            var known = ["F2", "F3", "F4", "F5", "Shift+F5", "Ctrl+F5", "F6", "Shift+F6", "F7", "Shift+F7", "Ctrl+F7",
                         "F8", "Shift+F8", "Ctrl+F8", "F9", "F10", "F11", "F12", "Shift+F12", "Ctrl+Left",
                         "Ctrl+Right", "Ctrl+Shift+K", "Ctrl+Shift+R", "Ctrl+Shift+H", "Ctrl+Shift+B",
                         "Ctrl+Shift+M", "Ctrl+Shift+L", "Esc", "Home", "F1"];
            for (var j = 0; j < known.length; ++j)
                verify(keys[known[j]], "listed: " + known[j]);
            // The toolbar's are entries with icons.
            var bar = sim.item.simToolbar;
            for (var t = 0; t < bar.length; ++t) {
                if (bar[t] === "|")
                    continue;
                verify(ids[bar[t]], "toolbar entry exists: " + bar[t]);
                verify(entry(bar[t]).icon !== "", bar[t] + " has an icon");
            }
        }

        // The key and the menu item (simTrigger) are the same entry.
        function test_keyAndMenuItem() {
            verify(!sim.item.simActionChecked("ringer"));
            sim.item.simTrigger("ringer");
            verify(sim.item.simActionChecked("ringer"), "the menu item flips the ringer switch");
            keyClick(Qt.Key_R, Qt.ControlModifier | Qt.ShiftModifier);
            verify(!sim.item.simActionChecked("ringer"), "and so does its key");

            var keyboard = sim.item.simActionChecked("keyboard");
            keyClick(Qt.Key_K, Qt.ControlModifier | Qt.ShiftModifier);
            compare(sim.item.simActionChecked("keyboard"), !keyboard);
            sim.item.simTrigger("keyboard");
            compare(sim.item.simActionChecked("keyboard"), keyboard);
        }

        // The toolbar's keyboard button: with no field in use it opens Just
        // Type and the keyboard comes up for its field; again, it goes down.
        // Not over the lock screen, which has no field to type into here.
        function test_onScreenKeyboard() {
            var shell = null;
            (function walk(o) {
                for (var i = 0; i < o.children.length && !shell; ++i) {
                    if (o.children[i].hasOwnProperty("justTypeOpen"))
                        shell = o.children[i];
                    else
                        walk(o.children[i]);
                }
            })(sim.item);
            verify(shell.locked);
            verify(!sim.item.simActionChecked("virtualKeyboard"));
            sim.item.simTrigger("virtualKeyboard");
            wait(100);
            verify(!shell.justTypeOpen && !sim.item.simActionChecked("virtualKeyboard"), "nothing over the lock screen");

            shell.unlock();
            sim.item.simTrigger("virtualKeyboard");
            verify(shell.justTypeOpen);
            tryVerify(function() { return sim.item.simActionChecked("virtualKeyboard"); }, 3000, "the keyboard comes up");
            keyClick(Qt.Key_O, Qt.ControlModifier | Qt.ShiftModifier);
            tryVerify(function() { return !sim.item.simActionChecked("virtualKeyboard"); }, 3000, "its key puts it down");
            shell.gestureBack();
            tryVerify(function() { return !shell.justTypeOpen; }, 3000);
            shell.lock();
        }

        function test_turn() {
            // The window turns with the device (no phoenix-sim window here).
            var w = root.Window.window;
            var size = [w.width, w.height];
            sim.item.simTrigger("rotateRight");
            tryCompare(w, "width", size[1]);
            compare(w.height, size[0]);
            keyClick(Qt.Key_Left, Qt.ControlModifier);
            tryCompare(w, "width", size[0]);
            compare(w.height, size[1]);
        }
    }
}
