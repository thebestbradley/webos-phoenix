// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Launcher editing: the layout rules (LauncherLayout.js) and the gestures
// (press and hold, drag within a page, onto a tab, into and out of the
// dock, delete).

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim
import "../qml/Phoenix/Shell/LauncherLayout.js" as LauncherLayout

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus {}
    }

    TestCase {
        name: "LauncherLayout"

        readonly property var entries: [
            { id: "b", title: "Bravo", tab: 0, quickLaunch: 2 },
            { id: "a", title: "Alpha", tab: 0, quickLaunch: 1 },
            { id: "s", title: "Setting", tab: 2, quickLaunch: 0 },
            { id: "h", title: "Hidden", tab: -1, quickLaunch: 0 }
        ]

        function test_buildSortsNewAppsAndFillsTheDock() {
            var l = LauncherLayout.build(entries, 3, null);
            compare(l.pages, [["a", "b"], [], ["s"]]);
            compare(l.dock, ["a", "b"]);
        }

        function test_buildKeepsTheSavedOrderAndAddsNewApps() {
            var saved = { pages: [["b"], ["a"], []], dock: ["b"], removed: [] };
            var l = LauncherLayout.build(entries, 3, saved);
            compare(l.pages, [["b"], ["a"], ["s"]]);
            compare(l.dock, ["b"]);
            // An app that is gone drops out; a deleted one stays deleted.
            l = LauncherLayout.build(entries.slice(1), 3, { pages: [["b", "a"], [], ["s"]], dock: ["b"], removed: ["s"] });
            compare(l.pages, [["a"], [], []]);
            compare(l.dock, []);
        }

        function test_moveAndDock() {
            var l = LauncherLayout.build(entries, 3, null);
            l = LauncherLayout.move(l, "a", 0, 1);
            compare(l.pages[0], ["b", "a"]);
            l = LauncherLayout.move(l, "a", 1, -1);
            compare(l.pages, [["b"], ["a"], ["s"]]);
            // A full dock swaps out the app in the slot dropped on.
            l = LauncherLayout.addToDock(l, "s", 0, 2);
            compare(l.dock, ["s", "b"]);
            // Already in the dock: it moves.
            l = LauncherLayout.addToDock(l, "b", 0, 2);
            compare(l.dock, ["b", "s"]);
            l = LauncherLayout.removeFromDock(l, "b");
            compare(l.dock, ["s"]);
            l = LauncherLayout.remove(l, "s");
            compare(l.pages, [["b"], ["a"], []]);
            compare(l.dock, []);
            compare(l.removed, ["s"]);
        }
    }

    TestCase {
        name: "LauncherEditing"
        when: windowShown

        property var launcher: null
        property var dock: null

        function findChild(item, test) {
            if (test(item))
                return item;
            for (var i = 0; i < item.children.length; ++i) {
                var f = findChild(item.children[i], test);
                if (f)
                    return f;
            }
            return null;
        }

        function initTestCase() {
            launcher = findChild(shell, function(o) { return o.hasOwnProperty("editMode") && o.hasOwnProperty("tabs"); });
            dock = findChild(shell, function(o) { return o.hasOwnProperty("pinned") && o.hasOwnProperty("slotAt"); });
            verify(launcher && dock);
            tryVerify(function() { return shell.launcherLayout !== null; }, 2000);
        }

        function init() {
            shell.unlock();
            shell.cardView.maximizeProgress = 0;
            launcher.editMode = false;
            launcher.showPage(0);
            if (!shell.launcherOpen)
                shell.gestureUp();
            tryCompare(launcher, "hidden", 0, 2000);
            // Let the page slide back into place.
            wait(Theme.cardSlideDuration + 100);
        }

        function cleanup() {
            if (shell.launcherOpen)
                shell.gestureUp();
        }

        // Centre of the icon at index on the current page, in shell coordinates.
        function iconPoint(index) {
            var col = index % Theme.launcherColumns, row = Math.floor(index / Theme.launcherColumns);
            var x = (col + 0.5) * launcher.cellWidth;
            var y = Theme.launcherTabHeight + launcher.pageTopMargin + row * launcher.cellHeight + Theme.launcherIconSize / 2;
            return launcher.mapToItem(shell, x, y);
        }

        function holdAndDrag(from, to) {
            mousePress(shell, from.x, from.y);
            wait(Theme.tapAndHoldInterval + 150);
            var steps = 12;
            for (var i = 1; i <= steps; ++i) {
                mouseMove(shell, from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, 10);
            }
            wait(50);
            mouseRelease(shell, to.x, to.y);
            wait(Theme.launcherReorderDuration + 50);
        }

        // A tap puts launcher-touch-feedback.png behind the icon; it goes
        // when the launcher hides (LauncherObject::setAppLaunchFeedback).
        function test_tapShowsLaunchFeedback() {
            var id = shell.launcherLayout.pages[0][0];
            var p = iconPoint(0);
            mouseClick(shell, p.x, p.y);
            compare(launcher.feedbackId, id);
            var shown = findChild(launcher, function(o) {
                return o.objectName === "launchFeedback" && o.visible;
            });
            verify(shown, "the feedback image shows");
            compare(shown.width, Theme.px(90));
            // Still there while the launcher hides; gone once it has.
            verify(launcher.hidden < 1);
            tryCompare(launcher, "feedbackId", "", 2000);
            compare(launcher.hidden, 1);
        }

        // 16 px bold white / #C8C8C8 tabs, at most 150 px each.
        function test_tabs() {
            verify(launcher.tabWidth <= Theme.px(150));
            compare(Theme.launcherTabFontSize, Theme.px(16));
        }

        function test_holdEntersEditModeAndReorders() {
            var page = shell.launcherLayout.pages[0];
            verify(page.length >= 3);
            var first = page[0];
            holdAndDrag(iconPoint(0), iconPoint(2));
            verify(launcher.editMode, "press and hold enters edit mode");
            compare(shell.launcherLayout.pages[0].indexOf(first), 2);
            // Back hides the launcher, which ends edit mode
            // (SystemUiController :438-441, slotSystemHidingLauncher).
            shell.gestureBack();
            verify(!launcher.editMode);
            verify(!shell.launcherOpen);
        }

        function test_dragOntoATabMovesToThatPage() {
            var id = shell.launcherLayout.pages[0][0];
            // Holding enters edit mode, which narrows the tabs for Done.
            launcher.editMode = true;
            var tab = launcher.mapToItem(shell, launcher.tabWidth * 1.5, Theme.launcherTabHeight / 2);
            holdAndDrag(iconPoint(0), tab);
            compare(LauncherLayout.pageOf(shell.launcherLayout, id), 1);
            compare(launcher.currentPage, 1);
        }

        function test_dragIntoAndOutOfTheDock() {
            var layout = shell.launcherLayout;
            // Make room: the dock holds quickLaunchMaxItems - 1 apps.
            while (shell.launcherLayout.dock.length >= Theme.quickLaunchMaxItems - 1)
                shell.setLauncherLayout(LauncherLayout.removeFromDock(shell.launcherLayout, shell.launcherLayout.dock[0]));
            var candidates = shell.launcherLayout.pages[0].filter(function(id) { return shell.launcherLayout.dock.indexOf(id) < 0; });
            var id = candidates[0];
            var index = shell.launcherLayout.pages[0].indexOf(id);
            var dockPoint = dock.mapToItem(shell, dock.width / 2, dock.height / 2);
            holdAndDrag(iconPoint(index), dockPoint);
            verify(shell.launcherLayout.dock.indexOf(id) >= 0, "dropped on the dock: in the dock");
            // Hold it in the dock and drag it up into the launcher: out of the dock.
            var slot = shell.launcherLayout.dock.indexOf(id);
            var from = dock.mapToItem(shell, dock.slotWidth * (slot + 0.5), dock.height / 2);
            holdAndDrag(from, iconPoint(1));
            compare(shell.launcherLayout.dock.indexOf(id), -1);
            verify(LauncherLayout.pageOf(shell.launcherLayout, id) >= 0, "still in the launcher");
            shell.setLauncherLayout(layout);
        }

        function test_deleteARemovableApp() {
            // Placeholder apps stand in for downloaded ones and can be deleted.
            var ids = shell.launcherLayout.pages[0];
            var index = -1;
            for (var i = 0; i < ids.length && index < 0; ++i) {
                var e = launcher.entry(ids[i]);
                if (e && e.removable)
                    index = i;
            }
            verify(index >= 0, "a removable app on the first page");
            var id = ids[index];
            launcher.editMode = true;
            wait(50);
            var c = iconPoint(index);
            // The delete decorator, at the icon's top left.
            mouseClick(shell, c.x - Theme.launcherIconSize / 2 + Theme.px(4), c.y - Theme.launcherIconSize / 2 + Theme.px(4));
            var button = findChild(shell, function(o) { return o.objectName === "deleteDialogButton0"; });
            verify(button && button.visible, "asks first");
            mouseClick(button);
            compare(LauncherLayout.pageOf(shell.launcherLayout, id), -1);
            verify(shell.launcherLayout.removed.indexOf(id) >= 0);
        }

        // A restored backup's layout (the window source's
        // launcherLayoutRestored) replaces this one and is kept; apps that
        // are not installed are dropped from it.
        function test_restoredLayout() {
            var ids = shell.launcherLayout.pages[0].slice(0, 3);
            verify(ids.length === 3);
            var restored = { pages: [[ids[2], ids[0], "com.example.gone"], [ids[1]], []], dock: [ids[0]], removed: [] };
            windows.launcherLayoutRestored(JSON.stringify(restored));
            compare(shell.launcherLayout.pages[0].slice(0, 2), [ids[2], ids[0]]);
            compare(LauncherLayout.pageOf(shell.launcherLayout, ids[1]), 1);
            compare(LauncherLayout.pageOf(shell.launcherLayout, "com.example.gone"), -1);
            compare(shell.launcherLayout.dock, [ids[0]]);
            compare(JSON.parse(windows.savedLauncherLayout()).dock, [ids[0]]);
            windows.launcherLayoutRestored("not json");
            compare(shell.launcherLayout.dock, [ids[0]]);
        }
    }
}
