// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Launcher editing: the layout rules (LauncherLayout.js) and the gestures
// (press and hold, drag within a page, onto a tab, into and out of the
// dock, delete), and the icon menu (press and hold or a right click: each
// of its rows, and the drag out of it).

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

    Component {
        id: spyComponent
        SignalSpy {}
    }

    TestCase {
        name: "LauncherLayout"

        readonly property var entries: [
            { id: "b", title: "Bravo", tab: 0, quickLaunch: 2 },
            { id: "a", title: "Alpha", tab: 0, quickLaunch: 1 },
            { id: "s", title: "Setting", tab: 2, quickLaunch: 0 },
            { id: "h", title: "Hidden", tab: -1, quickLaunch: 0 }
        ]

        // Pages: apps, downloads, favorites, prefs ("Settings").
        function test_buildSortsNewAppsAndFillsTheDock() {
            var l = LauncherLayout.build(entries, null);
            compare(l.pages, [["a", "b"], [], [], ["s"]]);
            compare(l.designators, ["apps", "downloads", "favorites", "prefs"]);
            compare(l.dock, ["a", "b"]);
        }

        function test_buildKeepsTheSavedOrderAndAddsNewApps() {
            var saved = { pages: [["b"], ["a"], [], []], dock: ["b"], removed: [] };
            var l = LauncherLayout.build(entries, saved);
            compare(l.pages, [["b"], ["a"], [], ["s"]]);
            compare(l.dock, ["b"]);
            // An app that is gone drops out; a deleted one stays deleted.
            l = LauncherLayout.build(entries.slice(1), { pages: [["b", "a"], [], [], ["s"]], dock: ["b"], removed: ["s"] });
            compare(l.pages, [["a"], [], [], []]);
            compare(l.dock, []);
        }

        // A layout saved before Favorites (three pages: apps, downloads,
        // prefs) keeps its pages; Favorites joins empty.
        function test_buildReadsAThreePageLayout() {
            var l = LauncherLayout.build(entries, { pages: [["b"], ["a"], ["s"]], dock: [], removed: [] });
            compare(l.pages, [["b"], ["a"], [], ["s"]]);
        }

        // Where a new app goes (LauncherLayout.pageFor): Favorites for a
        // launch point an app added; the page appinfo.json names; the page
        // its category or keywords name (the keyword map); the app catalog
        // and apps the user installed to Downloads; built-in Settings
        // category apps to Settings; the rest to Apps.
        function test_newAppPlacement() {
            compare(LauncherLayout.pageFor({ id: "00123456", dynamic: true }), "favorites");
            compare(LauncherLayout.pageFor({ id: "x", page: "downloads", installed: false }), "downloads");
            compare(LauncherLayout.pageFor({ id: "x", page: "apps", installed: true }), "apps");
            compare(LauncherLayout.pageFor({ id: "x", installed: true, keywords: ["Tools", "Preferences"] }), "prefs");
            compare(LauncherLayout.pageFor({ id: "x", installed: true, category: "settings" }), "prefs");
            compare(LauncherLayout.pageFor({ id: "x", installed: true, keywords: ["example_dummy"] }), "downloads",
                    "a keyword for a page that does not exist is passed over");
            compare(LauncherLayout.pageFor({ id: "org.webosphoenix.marketplace" }), "downloads");
            compare(LauncherLayout.pageFor({ id: "x", installed: true }), "downloads");
            compare(LauncherLayout.pageFor({ id: "x", category: "Settings" }), "prefs");
            compare(LauncherLayout.pageFor({ id: "x" }), "apps");
            compare(LauncherLayout.pageFor({ id: "x", tab: 1 }), "downloads");
            var l = LauncherLayout.build(entries.concat([
                { id: "00000042", appId: "a", title: "Shortcut", tab: 0, quickLaunch: 0, dynamic: true },
                { id: "dl", title: "Downloaded", tab: 0, quickLaunch: 0, installed: true }]), null);
            compare(l.pages, [["a", "b"], ["dl"], ["00000042"], ["s"]]);
        }

        // app_blacklist.conf: never in the launcher, nor in the dock.
        function test_blacklist() {
            verify(LauncherLayout.isBlacklisted("com.palm.sysapp.launchermode0"));
            var l = LauncherLayout.build(entries.concat([
                { id: "com.palm.sysapp.launchermode0", title: "Anger My Cards", tab: 0, quickLaunch: 5 }]), null);
            compare(LauncherLayout.pageOf(l, "com.palm.sysapp.launchermode0"), -1);
            compare(l.dock.indexOf("com.palm.sysapp.launchermode0"), -1);
        }

        function test_moveAndDock() {
            var l = LauncherLayout.build(entries, null);
            l = LauncherLayout.move(l, "a", 0, 1);
            compare(l.pages[0], ["b", "a"]);
            l = LauncherLayout.move(l, "a", 1, -1);
            compare(l.pages, [["b"], ["a"], [], ["s"]]);
            // A full dock swaps out the app in the slot dropped on.
            l = LauncherLayout.addToDock(l, "s", 0, 2);
            compare(l.dock, ["s", "b"]);
            // Already in the dock: it moves.
            l = LauncherLayout.addToDock(l, "b", 0, 2);
            compare(l.dock, ["b", "s"]);
            l = LauncherLayout.removeFromDock(l, "b");
            compare(l.dock, ["s"]);
            l = LauncherLayout.remove(l, "s");
            compare(l.pages, [["b"], ["a"], [], []]);
            compare(l.dock, []);
            compare(l.removed, ["s"]);
            // A launch point removed is simply gone.
            l = LauncherLayout.drop(l, "a");
            compare(l.pages, [["b"], [], [], []]);
            compare(l.removed, ["s"]);
        }
    }

    TestCase {
        name: "LauncherLayoutFavorites"

        // The icon menu's Favorite: to the Favorites page; Unfavorite: back
        // to the page the app would have had (Apps for a launch point).
        function test_favoriteAndUnfavorite() {
            var l = LauncherLayout.build([{ id: "a", title: "A", tab: 0, quickLaunch: 0 },
                                          { id: "s", title: "S", tab: 2, quickLaunch: 0 }], null);
            l = LauncherLayout.favorite(l, "s");
            verify(LauncherLayout.isFavorite(l, "s"));
            compare(l.pages, [["a"], [], ["s"], []]);
            l = LauncherLayout.unfavorite(l, "s", { id: "s", tab: 2 });
            compare(l.pages, [["a"], [], [], ["s"]]);
            l = LauncherLayout.unfavorite(LauncherLayout.favorite(l, "a"), "a", { id: "a", dynamic: true });
            compare(l.pages[0], ["a"]);
            verify(!LauncherLayout.dockFull(l, 1));
            verify(LauncherLayout.dockFull(LauncherLayout.addToDock(l, "a", 0, 1), 1));
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

        property var startLayout: null
        function init() {
            startLayout = shell.launcherLayout;
            shell.unlock();
            // An app the last test launched has had its prepare step
            // (cardPrepareAddDuration) and risen, which closes the launcher.
            tryVerify(function() { return shell.cardView.waitingUid === "" && !shell.cardView.preparing; }, 3000);
            tryVerify(function() { return !shell.cardView.maximizing; }, 3000);
            shell.cardView.maximizeProgress = 0;
            launcher.editMode = false;
            launcher.showPage(0);
            if (!shell.launcherOpen)
                shell.gestureUp();
            tryCompare(launcher, "hidden", 0, 2000);
            // Let the page slide back into place.
            wait(Theme.cardSlideDuration + 100);
            // Pages scrolled by an earlier drag (the page's bottom edge, on
            // the way to the dock) start at the top again.
            var pagesView = findChild(launcher, function(o) { return o.orientation === ListView.Horizontal; });
            for (var i = 0; pagesView && i < pagesView.contentItem.children.length; ++i) {
                var page = pagesView.contentItem.children[i];
                if (page.hasOwnProperty("contentY"))
                    page.contentY = 0;
            }
        }

        function cleanup() {
            launcher.closeGroup();
            launcher.nameDialog.close();
            launcher.addTabShown = false;
            // A test that failed half way leaves its groups and tabs.
            if (startLayout && JSON.stringify(startLayout) !== JSON.stringify(shell.launcherLayout))
                shell.setLauncherLayout(startLayout);
            var menu = iconMenu();
            if (menu && menu.open)
                menu.open = false;
            var dialog = findChild(shell, function(o) { return o.objectName === "deleteDialog"; });
            if (dialog)
                dialog.appId = "";
            if (shell.launcherOpen)
                shell.gestureUp();
        }

        function iconMenu() {
            return findChild(shell, function(o) { return o.objectName === "iconMenu"; });
        }
        function menuNames() {
            return iconMenu().items.map(function(i) { return i.name; });
        }
        function menuRow(name) {
            return findChild(iconMenu(), function(o) { return o.objectName === "iconMenu_" + name; });
        }
        // Press and hold an icon, let go without moving: the menu opens.
        // The holds below wait for what the hold does, not for a fixed time:
        // a wait() that a busy machine starves past its end returns without
        // running the hold's timer, and the finger would lift first.
        function holdForMenu(p) {
            mousePress(shell, p.x, p.y);
            tryCompare(iconMenu(), "open", true, 3000);
            mouseRelease(shell, p.x, p.y);
            tryCompare(iconMenu(), "open", true, 1000);
            wait(Theme.statusBarMenuFadeDuration + 50);
        }
        // A launcher entry of its own for a test (the simulator's fields).
        function addEntry(fields) {
            windows.apps.append(Object.assign(windows._launcherFields(), {
                title: "Test", color: "#555c66", glyph: "T", tab: 0, quickLaunch: 0,
                icon: "", largeIcon: "", splashIcon: "", splashBackground: "", web: false, main: "", noWindow: false,
                orientation: "", webAppId: "", params: "", dir: "", removable: false, version: "" }, fields));
            if (fields.tab !== -1)
                tryVerify(function() { return LauncherLayout.pageOf(shell.launcherLayout, fields.appId) >= 0; }, 1000);
        }
        function removeEntry(id) {
            for (var i = windows.apps.count - 1; i >= 0; --i)
                if (windows.apps.get(i).appId === id)
                    windows.apps.remove(i);
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
            tryVerify(function() { return iconMenu().open || launcher.draggedId !== ""; }, 3000, "the hold took");
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
            // Still there while the launcher hides; gone once it has. (Or
            // after launchFeedbackTimeout, on the clock, should the hide
            // take longer: it moves on only as frames are drawn, which a
            // busy machine draws slowly.)
            verify(launcher.hidden < 1);
            compare(launcher.feedbackId, id);
            // Exactly 1, as Launcher's onHiddenChanged asks (tryCompare
            // would take 0.99999 for 1 a frame early).
            tryVerify(function() { return launcher.hidden === 1; }, Theme.launchFeedbackTimeout + 2000);
            compare(launcher.feedbackId, "");
        }

        // GAPS V8 (3): the arrows move a focus ring over the icons, Tab
        // goes to the next page, Enter opens the icon, Esc closes.
        function test_keyboardNavigation() {
            shell.forceActiveFocus();
            var page = shell.launcherLayout.pages[0];
            keyClick(Qt.Key_Right);
            compare(launcher.keyIndex, 0);
            var ring = findChild(launcher, function(o) { return o.objectName === "launcherFocusRing" && o.visible; });
            verify(ring, "the focus ring shows");
            keyClick(Qt.Key_Right);
            compare(launcher.keyIndex, 1);
            keyClick(Qt.Key_Down);
            compare(launcher.keyIndex, 1 + launcher.columns < page.length ? 1 + launcher.columns : 1);
            keyClick(Qt.Key_Up);
            keyClick(Qt.Key_Left);
            compare(launcher.keyIndex, 0);
            keyClick(Qt.Key_Tab);
            compare(launcher.currentPage, 1);
            keyClick(Qt.Key_Backtab);
            compare(launcher.currentPage, 0);
            keyClick(Qt.Key_Right);
            var spy = createTemporaryObject(spyComponent, root, { target: launcher, signalName: "launchRequested" });
            keyClick(Qt.Key_Return);
            compare(spy.count, 1);
            compare(spy.signalArguments[0][0], shell.launcherLayout.pages[0][1]);
            tryVerify(function() { return !shell.launcherOpen; }, 2000);
            // Opened again, Esc closes it.
            shell.gestureUp();
            tryCompare(launcher, "hidden", 0, 2000);
            compare(launcher.keyIndex, -1);
            shell.forceActiveFocus();
            keyClick(Qt.Key_Escape);
            tryVerify(function() { return !shell.launcherOpen; }, 2000);
        }

        // GAPS V8 (3): in card view Down rings the dock's first icon,
        // Right moves along, Enter launches it, Up leaves the dock.
        function test_dockKeyboard() {
            shell.gestureUp();            // close the launcher: card view
            tryVerify(function() { return !shell.launcherOpen; }, 2000);
            shell.forceActiveFocus();
            var saved = shell.launcherLayout;
            if (dock.pinned.length === 0)
                shell.setLauncherLayout(LauncherLayout.addToDock(shell.launcherLayout, shell.launcherLayout.pages[0][0], 0, Theme.quickLaunchMaxItems - 1));
            tryVerify(function() { return dock.pinned.length >= 1; }, 1000);
            keyClick(Qt.Key_Down);
            compare(dock.keySlot, 0);
            keyClick(Qt.Key_Right);
            compare(dock.keySlot, 1);
            keyClick(Qt.Key_Up);
            compare(dock.keySlot, -1);
            // Enter on an app launches it.
            keyClick(Qt.Key_Down);
            var spy = createTemporaryObject(spyComponent, root, { target: dock, signalName: "launchRequested" });
            keyClick(Qt.Key_Return);
            compare(spy.count, 1);
            compare(spy.signalArguments[0][0], dock.pinned[0].appId);
            compare(dock.keySlot, -1);
            shell.setLauncherLayout(saved);
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.cardView.maximizeProgress = 0;
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

        // An empty page says how to fill it (ReorderablePage); a page with
        // apps does not.
        function test_emptyPageHint() {
            var hints = [];
            function collect(o) { if (o.objectName === "launcherEmptyPage") hints.push(o); for (var i = 0; i < o.children.length; ++i) collect(o.children[i]); }
            collect(shell);
            compare(hints.length, shell.launcherLayout.pages.length);
            for (var t = 0; t < hints.length; ++t)
                compare(hints[t].visible, shell.launcherLayout.pages[t].length === 0, "page " + t);
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
            var decorator = Qt.point(c.x - Theme.launcherIconSize / 2 + Theme.px(4), c.y - Theme.launcherIconSize / 2 + Theme.px(4));
            mouseClick(shell, decorator.x, decorator.y);
            // AppInfoDialog: "Remove Application?", the app's title (and
            // version), Cancel and Remove.
            var dialog = findChild(shell, function(o) { return o.objectName === "deleteDialog"; });
            tryCompare(dialog, "opacity", 1, 1000);
            compare(findChild(shell, function(o) { return o.objectName === "deleteDialogMessage"; }).text.indexOf(launcher.entry(id).title), 0);
            mouseClick(findChild(shell, function(o) { return o.objectName === "deleteDialogCancel"; }));
            tryCompare(dialog, "visible", false, 1000);
            verify(LauncherLayout.pageOf(shell.launcherLayout, id) >= 0, "Cancel keeps it");
            // With a keyboard (GAPS V8 (3)): Esc cancels; Tab rings Cancel
            // first, again Remove, Enter presses it.
            mouseClick(shell, decorator.x, decorator.y);
            tryCompare(dialog, "opacity", 1, 1000);
            shell.forceActiveFocus();
            keyClick(Qt.Key_Escape);
            tryCompare(dialog, "visible", false, 1000);
            verify(LauncherLayout.pageOf(shell.launcherLayout, id) >= 0, "Esc keeps it");
            mouseClick(shell, decorator.x, decorator.y);
            tryCompare(dialog, "opacity", 1, 1000);
            shell.forceActiveFocus();
            keyClick(Qt.Key_Tab);
            verify(findChild(shell, function(o) { return o.objectName === "deleteDialogCancel"; }).keyFocused);
            keyClick(Qt.Key_Tab);
            verify(findChild(shell, function(o) { return o.objectName === "deleteDialogRemove"; }).keyFocused);
            keyClick(Qt.Key_Return);
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

        // Apps, Downloads, Favorites, Settings (the TouchPad's pages); an
        // empty Favorites page says how to fill it.
        function test_favoritesTab() {
            compare(launcher.tabs, ["Apps", "Downloads", "Favorites", "Settings"]);
            compare(shell.launcherLayout.designators[2], "favorites");
            var tab = launcher.mapToItem(shell, launcher.tabWidth * 2.5, Theme.launcherTabHeight / 2);
            mouseClick(shell, tab.x, tab.y);
            compare(launcher.currentPage, 2);
        }

        // Held at a page's right edge, the icon goes to the next page at
        // once, and again after 1500 ms there (not before); let go inside
        // the page, it stays there.
        function test_edgeDragMovesToTheNextPage() {
            var id = shell.launcherLayout.pages[0][0];
            var from = iconPoint(0);
            var edge = launcher.mapToItem(shell, launcher.width - Theme.launcherEdgeWidth / 2, Theme.launcherTabHeight + launcher.pageTopMargin + 100);
            mousePress(shell, from.x, from.y);
            tryVerify(function() { return iconMenu().open || launcher.draggedId !== ""; }, 3000, "the hold took");
            for (var i = 1; i <= 8; ++i)
                mouseMove(shell, from.x + (edge.x - from.x) * i / 8, from.y + (edge.y - from.y) * i / 8, 10);
            tryCompare(launcher, "currentPage", 1, 1000);
            compare(LauncherLayout.pageOf(shell.launcherLayout, id), 1);
            wait(1000);
            compare(launcher.currentPage, 1, "not again before 1500 ms");
            tryCompare(launcher, "currentPage", 2, 1500);
            compare(LauncherLayout.pageOf(shell.launcherLayout, id), 2);
            // Back inside the page and let go: it stays on Favorites.
            var inside = launcher.mapToItem(shell, launcher.width / 2, Theme.launcherTabHeight + launcher.pageTopMargin + 40);
            mouseMove(shell, inside.x, inside.y, 10);
            mouseRelease(shell, inside.x, inside.y);
            wait(Theme.launcherReorderDuration + 50);
            compare(LauncherLayout.pageOf(shell.launcherLayout, id), 2);
            shell.setLauncherLayout(LauncherLayout.move(shell.launcherLayout, id, 0, 0));
        }

        function cellOf(id) {
            var page = LauncherLayout.pageOf(shell.launcherLayout, id);
            var index = shell.launcherLayout.pages[page].indexOf(id);
            return findChild(launcher, function(o) { return o.hasOwnProperty("notReady") && o.appId === id; });
        }

        // An app being installed: its icon (on Downloads) at half opacity
        // with the progress strip's frame for its progress; a tap does not
        // launch it. Failed: the warning badge; a tap asks to try again or
        // remove it (as Software Manager did).
        function test_installBadges() {
            windows._installStatus({ appId: "com.example.newapp", state: "installing", progress: 50, title: "New App" });
            tryVerify(function() { return LauncherLayout.pageOf(shell.launcherLayout, "com.example.newapp") === 1; }, 1000);
            launcher.showPage(1);
            wait(Theme.cardSlideDuration + 100);
            var cell = cellOf("com.example.newapp");
            verify(cell, "a pending icon");
            verify(cell.notReady);
            var badge = findChild(cell, function(o) { return o.objectName === "launcherInstallBadge"; });
            verify(badge.visible);
            compare(badge.frame, 9);
            windows._installStatus({ appId: "com.example.newapp", state: "installing", progress: 100 });
            tryCompare(badge, "frame", 18);
            // A tap does not launch it.
            var cards = windows.cards.count;
            var p = badge.mapToItem(shell, -10, 30);
            mouseClick(shell, p.x, p.y);
            wait(100);
            compare(windows.cards.count, cards);
            // It fails: the warning badge; a tap asks.
            windows._installStatus({ appId: "com.example.newapp", state: "failed", reason: "The package has no app",
                                     retry: { uri: "luna://com.webos.appInstallService/install", params: { id: "com.example.newapp", ipkUrl: "/media/internal/new.ipk" } } });
            tryCompare(cell, "installState", "failed");
            mouseClick(shell, p.x, p.y);
            var dialog = findChild(shell, function(o) { return o.objectName === "deleteDialog"; });
            tryCompare(dialog, "opacity", 1, 1000);
            compare(findChild(shell, function(o) { return o.objectName === "deleteDialogTitle"; }).text, "Installation Failed");
            compare(findChild(shell, function(o) { return o.objectName === "deleteDialogMessage"; }).text, "New App: The package has no app");
            var retry = findChild(shell, function(o) { return o.objectName === "deleteDialogRetry"; });
            verify(retry.visible, "it can be tried again");
            // Try Again: installing again; with no page to install it here,
            // it fails again.
            mouseClick(retry);
            tryCompare(dialog, "visible", false, 1000);
            tryCompare(cell, "installState", "failed", 2000);
            mouseClick(shell, p.x, p.y);
            tryCompare(dialog, "opacity", 1, 1000);
            mouseClick(findChild(shell, function(o) { return o.objectName === "deleteDialogRemove"; }));
            tryVerify(function() { return LauncherLayout.pageOf(shell.launcherLayout, "com.example.newapp") < 0; }, 1000);
            compare(windows.installInfo("com.example.newapp"), null);
        }

        // ---- The icon menu (docs/M6-PLAN.md F1) ------------------------------------

        // Held for 500 ms: the icon lifts, the rest dims, the menu opens
        // beside it with a haptic tick; edit mode waits. A tap outside
        // closes it.
        function test_holdOpensTheIconMenu() {
            var id = shell.launcherLayout.pages[0][0];
            var haptics = shell.iconMenuHaptics;
            var spy = createTemporaryObject(spyComponent, root, { target: launcher, signalName: "launchRequested" });
            holdForMenu(iconPoint(0));
            var menu = iconMenu();
            compare(menu.appId, id);
            compare(menu.from, "page");
            verify(!launcher.editMode, "the menu, not edit mode");
            compare(spy.count, 0, "a hold does not launch");
            compare(shell.iconMenuHaptics, haptics + 1, "a haptic tick");
            compare(shell.deviceServices.vibration, "tapdown");
            var lifted = findChild(menu, function(o) { return o.objectName === "iconMenuIcon"; });
            tryCompare(lifted, "scale", 1.15, 1000);
            var dim = findChild(menu, function(o) { return o.objectName === "iconMenuDim"; });
            tryCompare(dim, "opacity", 0.5, 1000);
            verify(dim.visible && dim.width === shell.width, "the rest dims");
            var names = menuNames();
            compare(names[0], "move");
            verify(names.indexOf("info") === names.length - 1, "App Info last");
            verify(names.indexOf("favorite") >= 0);
            verify(names.indexOf("dock") >= 0 || names.indexOf("undock") >= 0);
            // Beside the icon, inside the screen.
            var panel = findChild(menu, function(o) { return o.objectName === "iconMenuPanel"; });
            verify(panel.x >= -Theme.px(11) && panel.x + panel.width <= shell.width + Theme.px(11));
            // A tap outside closes it.
            mouseClick(shell, Theme.px(6), shell.height * 0.6);
            tryCompare(menu, "open", false, 1000);
            verify(shell.launcherOpen);
        }

        // A right click opens it at once and launches nothing; Back closes
        // it and leaves the launcher open.
        function test_rightClickOpensTheIconMenu() {
            var id = shell.launcherLayout.pages[0][1];
            var spy = createTemporaryObject(spyComponent, root, { target: launcher, signalName: "launchRequested" });
            var p = iconPoint(1);
            mouseClick(shell, p.x, p.y, Qt.RightButton);
            tryCompare(iconMenu(), "open", true, 500);
            compare(iconMenu().appId, id);
            compare(spy.count, 0);
            shell.gestureBack();
            verify(!iconMenu().open);
            verify(shell.launcherOpen, "Back closed the menu only");
            // Esc too.
            mouseClick(shell, p.x, p.y, Qt.RightButton);
            tryCompare(iconMenu(), "open", true, 500);
            shell.forceActiveFocus();
            keyClick(Qt.Key_Escape);
            verify(!iconMenu().open);
            verify(shell.launcherOpen);
        }

        // From the keyboard: the Menu key on the focus ring opens it; Down
        // rings a row, Enter chooses it.
        function test_menuKeyOpensTheIconMenu() {
            shell.forceActiveFocus();
            keyClick(Qt.Key_Right);
            keyClick(Qt.Key_Menu);
            verify(iconMenu().open);
            compare(iconMenu().appId, shell.launcherLayout.pages[0][0]);
            keyClick(Qt.Key_Down);
            compare(iconMenu().keyIndex, 0);
            keyClick(Qt.Key_Return);
            verify(!iconMenu().open);
            compare(launcher.draggedId, shell.launcherLayout.pages[0][0], "Move picked it up");
            keyClick(Qt.Key_Escape);
            compare(launcher.draggedId, "");
        }

        // Held, then moved on: the menu gives way to edit mode's drag,
        // which reorders as before.
        function test_dragOutOfTheMenuReorders() {
            var first = shell.launcherLayout.pages[0][0];
            var from = iconPoint(0), to = iconPoint(2);
            mousePress(shell, from.x, from.y);
            tryVerify(function() { return iconMenu().open; }, 3000, "the menu is open under the finger");
            verify(iconMenu().open, "the menu is open under the finger");
            for (var i = 1; i <= 12; ++i)
                mouseMove(shell, from.x + (to.x - from.x) * i / 12, from.y + (to.y - from.y) * i / 12, 10);
            verify(!iconMenu().open, "the drag closed it");
            verify(launcher.editMode);
            compare(launcher.draggedId, first);
            mouseRelease(shell, to.x, to.y);
            wait(Theme.launcherReorderDuration + 50);
            compare(shell.launcherLayout.pages[0].indexOf(first), 2);
            shell.setLauncherLayout(LauncherLayout.move(shell.launcherLayout, first, 0, 0));
        }

        // Move: edit mode with the icon picked up; the next tap puts it there.
        function test_menuMove() {
            var id = shell.launcherLayout.pages[0][0];
            holdForMenu(iconPoint(0));
            mouseClick(menuRow("move"));
            verify(launcher.editMode);
            compare(launcher.draggedId, id, "picked up");
            var to = iconPoint(2);
            mouseClick(shell, to.x, to.y);
            wait(Theme.launcherReorderDuration + 50);
            compare(launcher.draggedId, "");
            compare(shell.launcherLayout.pages[0].indexOf(id), 2);
            // In edit mode a hold picks the icon up at once (no menu).
            mousePress(shell, to.x, to.y);
            tryCompare(launcher, "draggedId", id, 3000);
            verify(!iconMenu().open);
            compare(launcher.draggedId, id);
            mouseRelease(shell, to.x, to.y);
            wait(Theme.launcherReorderDuration + 50);
            compare(shell.launcherLayout.pages[0].indexOf(id), 2);
            // Picked up again by Move, Back puts it back where it was.
            launcher.editMode = false;
            holdForMenu(iconPoint(2));
            mouseClick(menuRow("move"));
            compare(launcher.draggedId, id);
            shell.gestureBack();
            compare(launcher.draggedId, "");
            compare(shell.launcherLayout.pages[0].indexOf(id), 2);
            shell.setLauncherLayout(LauncherLayout.move(shell.launcherLayout, id, 0, 0));
        }

        // Add to Dock / Remove from Dock; a full dock offers it greyed.
        function test_menuDock() {
            var saved = shell.launcherLayout;
            while (shell.launcherLayout.dock.length >= Theme.quickLaunchMaxItems - 1)
                shell.setLauncherLayout(LauncherLayout.removeFromDock(shell.launcherLayout, shell.launcherLayout.dock[0]));
            var page = shell.launcherLayout.pages[0];
            var index = -1;
            for (var i = 0; i < page.length && index < 0; ++i)
                if (shell.launcherLayout.dock.indexOf(page[i]) < 0)
                    index = i;
            var id = page[index];
            holdForMenu(iconPoint(index));
            verify(menuRow("dock").available);
            mouseClick(menuRow("dock"));
            verify(!iconMenu().open);
            compare(shell.launcherLayout.dock[shell.launcherLayout.dock.length - 1], id, "at the end of the dock");
            holdForMenu(iconPoint(index));
            verify(menuNames().indexOf("dock") < 0);
            mouseClick(menuRow("undock"));
            compare(shell.launcherLayout.dock.indexOf(id), -1);
            // Full: Add to Dock cannot be chosen.
            var others = page.filter(function(x) { return x !== id; });
            var l = shell.launcherLayout;
            for (var k = 0; l.dock.length < Theme.quickLaunchMaxItems - 1; ++k)
                l = LauncherLayout.addToDock(l, others[k], l.dock.length, Theme.quickLaunchMaxItems - 1);
            shell.setLauncherLayout(l);
            holdForMenu(iconPoint(page.indexOf(id)));
            verify(!menuRow("dock").available, "the dock is full");
            mouseClick(menuRow("dock"));
            verify(iconMenu().open, "greyed: nothing happens");
            compare(shell.launcherLayout.dock.indexOf(id), -1);
            shell.setLauncherLayout(saved);
        }

        // Favorite takes the app to the Favorites page; Unfavorite back.
        function test_menuFavorite() {
            var id = shell.launcherLayout.pages[0][0];
            holdForMenu(iconPoint(0));
            mouseClick(menuRow("favorite"));
            compare(LauncherLayout.pageOf(shell.launcherLayout, id), 2);
            compare(JSON.parse(windows.savedLauncherLayout()).pages[2].indexOf(id) >= 0, true, "kept");
            launcher.showPage(2);
            wait(Theme.cardSlideDuration + 100);
            holdForMenu(iconPoint(shell.launcherLayout.pages[2].indexOf(id)));
            verify(menuNames().indexOf("favorite") < 0);
            mouseClick(menuRow("unfavorite"));
            compare(LauncherLayout.pageOf(shell.launcherLayout, id), 0, "back to its own page");
            shell.setLauncherLayout(LauncherLayout.move(shell.launcherLayout, id, 0, 0));
        }

        // Uninstall: only for apps that can be deleted, asking first.
        function test_menuUninstall() {
            var ids = shell.launcherLayout.pages[0];
            var index = -1;
            for (var i = 0; i < ids.length && index < 0; ++i)
                if (launcher.entry(ids[i]).removable)
                    index = i;
            holdForMenu(iconPoint(index));
            mouseClick(menuRow("uninstall"));
            var dialog = findChild(shell, function(o) { return o.objectName === "deleteDialog"; });
            tryCompare(dialog, "opacity", 1, 1000);
            compare(findChild(shell, function(o) { return o.objectName === "deleteDialogTitle"; }).text, "Remove Application?");
            mouseClick(findChild(shell, function(o) { return o.objectName === "deleteDialogCancel"; }));
            tryCompare(dialog, "visible", false, 1000);
            verify(LauncherLayout.pageOf(shell.launcherLayout, ids[index]) >= 0);
            // A built-in app has none.
            addEntry({ appId: "com.example.builtin", title: "Built In", removable: false, page: "downloads" });
            var at = LauncherLayout.pageOf(shell.launcherLayout, "com.example.builtin");
            launcher.showPage(at);
            wait(Theme.cardSlideDuration + 100);
            holdForMenu(iconPoint(shell.launcherLayout.pages[at].indexOf("com.example.builtin")));
            verify(menuNames().indexOf("uninstall") < 0);
            iconMenu().open = false;
            removeEntry("com.example.builtin");
        }

        // App Info: title, version, id and size; Uninstall asks first.
        function test_menuAppInfo() {
            addEntry({ appId: "com.example.info", title: "Info App", page: "downloads", version: "2.1.0", size: 3 * 1024 * 1024, removable: true });
            var at = LauncherLayout.pageOf(shell.launcherLayout, "com.example.info");
            launcher.showPage(at);
            wait(Theme.cardSlideDuration + 100);
            holdForMenu(iconPoint(shell.launcherLayout.pages[at].indexOf("com.example.info")));
            mouseClick(menuRow("info"));
            var dialog = findChild(shell, function(o) { return o.objectName === "deleteDialog"; });
            tryCompare(dialog, "opacity", 1, 1000);
            compare(findChild(shell, function(o) { return o.objectName === "deleteDialogTitle"; }).text, "Info App");
            compare(findChild(shell, function(o) { return o.objectName === "deleteDialogMessage"; }).text,
                    "Version 2.1.0\nID: com.example.info\nSize: 3.0 MB");
            verify(!findChild(shell, function(o) { return o.objectName === "deleteDialogRemove"; }).visible);
            var uninstall = findChild(shell, function(o) { return o.objectName === "deleteDialogUninstall"; });
            verify(uninstall.visible);
            mouseClick(uninstall);
            compare(findChild(shell, function(o) { return o.objectName === "deleteDialogTitle"; }).text, "Remove Application?");
            // Remove shows in Uninstall's place: the buttons' Column lays
            // itself out again at its next polish (before a click is
            // delivered, Qt 6.11), so it is clicked where it ends up.
            var remove = findChild(shell, function(o) { return o.objectName === "deleteDialogRemove"; });
            verify(remove.visible);
            waitForItemPolished(remove.parent);
            mouseClick(remove);
            compare(LauncherLayout.pageOf(shell.launcherLayout, "com.example.info"), -1);
            removeEntry("com.example.info");
        }

        // New Window: only for apps that run several at once; another card
        // while one runs.
        function test_menuNewWindow() {
            addEntry({ appId: "com.example.multi", title: "Multi", page: "downloads", multipleInstances: true });
            var at = LauncherLayout.pageOf(shell.launcherLayout, "com.example.multi");
            var first = windows.launch("com.example.multi");
            verify(first !== "");
            launcher.showPage(at);
            wait(Theme.cardSlideDuration + 100);
            holdForMenu(iconPoint(shell.launcherLayout.pages[at].indexOf("com.example.multi")));
            mouseClick(menuRow("newWindow"));
            var n = 0;
            for (var i = 0; i < windows.cards.count; ++i)
                if (windows.cards.get(i).appId === "com.example.multi")
                    ++n;
            compare(n, 2, "a second window");
            tryVerify(function() { return !shell.launcherOpen; }, 2000);
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            shell.cardView.maximizeProgress = 0;
            // Others have none.
            shell.gestureUp();
            tryCompare(launcher, "hidden", 0, 2000);
            wait(Theme.cardSlideDuration + 100);
            holdForMenu(iconPoint(0));
            verify(menuNames().indexOf("newWindow") < 0);
            iconMenu().open = false;
            removeEntry("com.example.multi");
        }

        // Share: an app with a web address shares it through the share
        // sheet, from its page laid over everything; others have no Share.
        function test_menuShare() {
            addEntry({ appId: "org.webosphoenix.sharesheet", title: "Share", tab: -1 });
            addEntry({ appId: "00000077", title: "Site", dynamic: true, removable: true,
                       webAppId: "org.webosphoenix.browser", params: "{\"url\":\"https://example.com/\"}" });
            compare(shell.shareLink("00000077"), "https://example.com/");
            launcher.showPage(2);
            wait(Theme.cardSlideDuration + 100);
            holdForMenu(iconPoint(shell.launcherLayout.pages[2].indexOf("00000077")));
            compare(menuNames()[1], "share");
            compare(menuRow("uninstall").modelData.text, "Remove", "a launch point is removed");
            verify(menuNames().indexOf("favorite") < 0 && menuNames().indexOf("unfavorite") < 0, "it lives on Favorites");
            mouseClick(menuRow("share"));
            var host = findChild(shell, function(o) { return o.objectName === "shareHost"; });
            verify(host.windowKey !== "");
            compare(windows.systemWindows.get(windows.systemWindows.count - 1).kind, "share");
            verify(host.visible);
            // The page closes itself when the sheet is done.
            windows.closeSystemWindow(host.windowKey);
            compare(host.windowKey, "");
            launcher.showPage(0);
            wait(Theme.cardSlideDuration + 100);
            holdForMenu(iconPoint(0));
            verify(menuNames().indexOf("share") < 0, "no link, no Share");
            iconMenu().open = false;
            removeEntry("00000077");
            removeEntry("org.webosphoenix.sharesheet");
        }

        // The dock's icons have the menu too, over the dock.
        function test_dockIconMenu() {
            var saved = shell.launcherLayout;
            shell.gestureUp();            // card view: the dock
            tryVerify(function() { return !shell.launcherOpen; }, 2000);
            if (dock.pinned.length === 0)
                shell.setLauncherLayout(LauncherLayout.addToDock(shell.launcherLayout, shell.launcherLayout.pages[0][0], 0, Theme.quickLaunchMaxItems - 1));
            tryVerify(function() { return dock.pinned.length >= 1; }, 1000);
            var id = dock.pinned[0].appId;
            var p = dock.mapToItem(shell, dock.slotCentre(0), Theme.quickLaunchIconY + dock.iconSize / 2);
            holdForMenu(p);
            compare(iconMenu().appId, id);
            compare(iconMenu().from, "dock");
            compare(iconMenu().side, "above");
            mouseClick(menuRow("undock"));
            compare(shell.launcherLayout.dock.indexOf(id), -1);
            shell.setLauncherLayout(saved);
            // Held and moved on: the dock's drag, as before.
            tryVerify(function() { return dock.pinned.length >= 1; }, 1000);
            id = dock.pinned[0].appId;
            mousePress(shell, p.x, p.y);
            tryVerify(function() { return iconMenu().open; }, 3000, "the dock icon's menu opens");
            verify(iconMenu().open);
            mouseMove(shell, p.x + 20, p.y - 40, 10);
            compare(iconMenu().open, false);
            compare(dock.draggedId, id);
            mouseMove(shell, p.x + 20, shell.height / 3, 10);
            mouseRelease(shell, p.x + 20, shell.height / 3);
            compare(shell.launcherLayout.dock.indexOf(id), -1, "dragged off the dock");
            shell.setLauncherLayout(saved);
        }

        // A launch point an app added (addLaunchPoint) is on Favorites; in
        // edit mode it has the remove decorator, and asks "Remove Shortcut?".
        function test_shortcutOnFavorites() {
            windows.apps.append(Object.assign(windows._launcherFields(), {
                appId: "00000042", title: "Example", color: "#555c66", glyph: "E", tab: 0, quickLaunch: 0,
                icon: "", largeIcon: "", splashIcon: "", splashBackground: "", web: false, main: "", noWindow: false,
                orientation: "", webAppId: "org.webosphoenix.browser", params: "{\"url\":\"https://example.com\"}", dir: "",
                removable: true, version: "", dynamic: true }));
            tryVerify(function() { return LauncherLayout.pageOf(shell.launcherLayout, "00000042") === 2; }, 1000);
            launcher.showPage(2);
            wait(Theme.cardSlideDuration + 100);
            launcher.editMode = true;
            var cell = cellOf("00000042");
            var decorator = findChild(cell, function(o) { return o.objectName === "launcherRemoveDecorator"; });
            verify(decorator.visible);
            verify(String(decorator.children[0].source).indexOf("edit-button-remove") >= 0);
            var c = decorator.mapToItem(shell, decorator.width / 2 + Theme.px(4), decorator.height / 2 + Theme.px(4));
            mouseClick(shell, c.x, c.y);
            var dialog = findChild(shell, function(o) { return o.objectName === "deleteDialog"; });
            tryCompare(dialog, "opacity", 1, 1000);
            compare(findChild(shell, function(o) { return o.objectName === "deleteDialogTitle"; }).text, "Remove Shortcut?");
            compare(findChild(shell, function(o) { return o.objectName === "deleteDialogMessage"; }).text, "Example (Web)");
            mouseClick(findChild(shell, function(o) { return o.objectName === "deleteDialogRemove"; }));
            compare(LauncherLayout.pageOf(shell.launcherLayout, "00000042"), -1);
            verify(shell.launcherLayout.removed.indexOf("00000042") < 0, "a launch point is not remembered as deleted");
            windows.apps.remove(windows.apps.count - 1);
        }

        // ---- Groups and tabs (LunaCE; docs/M6-PLAN.md F4) ----------------------------

        // Hold an icon, carry it to `to` and rest there `rest` ms before
        // letting go.
        // Each step waits for what it causes, not for time: the hold has
        // opened the menu before the finger moves (a busy machine runs the
        // hold's timer late, and a move before it would scroll the page),
        // and the icon is carried before it goes on. Then one move to `to`:
        // the icons make room once the dragged one rests 150 ms over a
        // place (Theme.launcherReorderDelay), and on a slow machine small
        // steps through the target's edge took longer than that, so b made
        // room and moved from under the finger before it reached b's centre
        // (macOS CI). target: the id the rest should group with ("" for
        // none), waited for before letting go.
        function holdDragAndRest(from, to, rest, target) {
            var menu = iconMenu();
            mousePress(shell, from.x, from.y);
            tryVerify(function() { return menu.open; }, 3000, "the hold opened the icon menu");
            var d = Qt.styleHints.startDragDistance + 4, len = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
            mouseMove(shell, from.x + (to.x - from.x) * d / len, from.y + (to.y - from.y) * d / len);
            tryVerify(function() { return launcher.dragging; }, 2000, "the icon is carried");
            mouseMove(shell, to.x, to.y);
            if (target)
                tryCompare(launcher, "groupTarget", target, 3000);
            else
                wait(rest);
            mouseRelease(shell, to.x, to.y);
        }
        function groupIds() {
            return Object.keys(shell.launcherLayout.groups || {});
        }

        // An icon carried onto another's centre and held there joins it in
        // a group, where the other was; passing over icons does not move them.
        function test_dragOntoACentreMakesAGroup() {
            var saved = shell.launcherLayout;
            var page = shell.launcherLayout.pages[0];
            var a = page[0], b = page[1], c = page[2];
            waitForItemPolished(launcher);
            holdDragAndRest(iconPoint(0), iconPoint(1), 0, b);
            var g = shell.launcherLayout.pages[0][0];
            verify(LauncherLayout.isGroup(g), "a group where the icon was: " + g);
            compare(shell.launcherLayout.groups[g].members, [b, a]);
            compare(shell.launcherLayout.groups[g].title, "Group");
            compare(shell.launcherLayout.pages[0][1], c);
            // Its tile shows the apps, its name under it.
            tryVerify(function() { return findChild(launcher, function(o) { return o.objectName === "groupTile" && o.visible; }) !== null; }, 1000);
            // Let go before resting: no group, a move.
            launcher.editMode = false;
            shell.setLauncherLayout(saved);
            holdDragAndRest(iconPoint(0), iconPoint(2), 0, "");
            compare(groupIds().length, 0);
            compare(shell.launcherLayout.pages[0].indexOf(a), 2);
            shell.setLauncherLayout(saved);
        }

        // A tap opens the group; its apps launch from it; a tap on its name
        // renames it; Back closes it.
        function test_groupOverlay() {
            var saved = shell.launcherLayout;
            var page = shell.launcherLayout.pages[0];
            var a = page[0], b = page[1];
            shell.setLauncherLayout(LauncherLayout.makeGroup(shell.launcherLayout, a, b));
            var g = shell.launcherLayout.pages[0][0];
            var p = iconPoint(0);
            mouseClick(shell, p.x, p.y);
            compare(launcher.openGroupId, g);
            var view = findChild(launcher, function(o) { return o.objectName === "launcherGroup"; });
            tryCompare(view, "visible", true, 1000);
            compare(view.members.map(function(m) { return m.appId; }), [b, a]);
            // Rename.
            var titleArea = findChild(view, function(o) { return o.objectName === "launcherGroupTitleArea"; });
            mouseClick(titleArea);
            var field = findChild(view, function(o) { return o.objectName === "launcherGroupTitleField"; });
            tryCompare(field, "activeFocus", true, 1000);
            field.text = "Accessories";
            keyClick(Qt.Key_Return);
            compare(shell.launcherLayout.groups[g].title, "Accessories");
            compare(findChild(view, function(o) { return o.objectName === "launcherGroupTitle"; }).text, "Accessories");
            // Back closes it, the launcher stays.
            shell.gestureBack();
            compare(launcher.openGroupId, "");
            verify(shell.launcherLayout && shell.launcherOpen);
            // A member launches.
            mouseClick(shell, p.x, p.y);
            tryCompare(view, "open", true, 1000);
            var member = findChild(view, function(o) { return o.objectName === "launcherGroupMember_" + a; });
            waitForItemPolished(member);
            var spy = createTemporaryObject(spyComponent, root, { target: launcher, signalName: "launchRequested" });
            var mp = member.mapToItem(shell, member.width / 2, Theme.launcherIconSize / 2);
            mouseClick(shell, mp.x, mp.y);
            compare(spy.count, 1);
            compare(spy.signalArguments[0][0], a);
            compare(launcher.openGroupId, "");
            tryVerify(function() { return !shell.launcherOpen; }, 2000);
            shell.gestureUp();
            tryCompare(launcher, "hidden", 0, 2000);
            shell.setLauncherLayout(saved);
        }

        // Holding an app in a group opens its menu, with Remove from Folder,
        // which takes it out (the group, down to one, dissolves); carried
        // on from the hold, it leaves the group onto the page.
        function test_groupMemberMenuAndDragOut() {
            var saved = shell.launcherLayout;
            var page = shell.launcherLayout.pages[0];
            var a = page[0], b = page[1], c = page[2];
            var l = LauncherLayout.makeGroup(shell.launcherLayout, a, b);
            shell.setLauncherLayout(LauncherLayout.makeGroup(l, c, LauncherLayout.pageOf(l, a) >= 0 ? a : "group:1"));
            var g = shell.launcherLayout.pages[0][0];
            compare(shell.launcherLayout.groups[g].members, [b, a, c]);
            var p = iconPoint(0);
            mouseClick(shell, p.x, p.y);
            var view = findChild(launcher, function(o) { return o.objectName === "launcherGroup"; });
            tryCompare(view, "open", true, 1000);
            var member = findChild(view, function(o) { return o.objectName === "launcherGroupMember_" + a; });
            waitForItemPolished(member);
            var mp = member.mapToItem(shell, member.width / 2, Theme.launcherIconSize / 2);
            holdForMenu(mp);
            compare(iconMenu().from, "group");
            verify(menuNames().indexOf("ungroup") >= 0, "Remove from Folder: " + menuNames());
            verify(menuNames().indexOf("favorite") < 0);
            mouseClick(menuRow("ungroup"));
            compare(shell.launcherLayout.groups[g].members, [b, c]);
            compare(shell.launcherLayout.pages[0].slice(0, 2), [g, a]);
            // The other way out: hold, then carry it.
            tryCompare(view, "open", true, 1000);
            member = findChild(view, function(o) { return o.objectName === "launcherGroupMember_" + c; });
            waitForItemPolished(member);
            mp = member.mapToItem(shell, member.width / 2, Theme.launcherIconSize / 2);
            var to = iconPoint(5);
            mousePress(shell, mp.x, mp.y);
            tryVerify(function() { return iconMenu().open; }, 3000, "the hold opened the icon menu");
            for (var i = 1; i <= 10; ++i)
                mouseMove(shell, mp.x + (to.x - mp.x) * i / 10, mp.y + (to.y - mp.y) * i / 10, 10);
            compare(launcher.openGroupId, g);
            verify(launcher.draggedId === c, "carried: " + launcher.draggedId);
            mouseRelease(shell, to.x, to.y);
            // Down to one: dissolved, b in its place.
            tryCompare(launcher, "openGroupId", "", 1000);
            compare(groupIds().length, 0);
            compare(shell.launcherLayout.pages[0][0], b);
            verify(shell.launcherLayout.pages[0].indexOf(c) > 0, "on the page");
            launcher.editMode = false;
            shell.setLauncherLayout(saved);
        }

        // Tabs: "+" in edit mode (or held on the strip's empty part) adds
        // one, named in the dialog; holding a tab renames it; one the user
        // added has a trash can; the first four do not. Up to six.
        function test_tabsAddRenameRemove() {
            var saved = shell.launcherLayout;
            launcher.editMode = true;
            var plus = findChild(launcher, function(o) { return o.objectName === "launcherAddTab"; });
            tryCompare(plus, "visible", true, 1000);
            waitForItemPolished(plus.parent);
            mouseClick(plus);
            var dialog = findChild(launcher, function(o) { return o.objectName === "launcherNameDialog"; });
            tryCompare(dialog, "open", true, 1000);
            compare(dialog.heading, "New Tab");
            verify(!launcher.editMode);
            tryCompare(dialog.field, "activeFocus", true, 1000);
            dialog.field.text = "My Stuff";
            keyClick(Qt.Key_Return);
            compare(launcher.tabs.length, 5);
            compare(launcher.tabs[4], "My Stuff");
            compare(launcher.currentPage, 4);
            // Hold a built-in tab: rename, no trash.
            var tab0 = findChild(launcher, function(o) { return o.objectName === "launcherTab_2"; });
            mousePress(tab0);
            tryCompare(dialog, "open", true, 3000);
            mouseRelease(tab0);
            tryCompare(dialog, "open", true, 1000);
            compare(dialog.heading, "Rename Tab");
            compare(dialog.text, "Favorites");
            verify(!findChild(dialog, function(o) { return o.objectName === "launcherNameDelete"; }).visible);
            dialog.field.text = "Games";
            keyClick(Qt.Key_Return);
            compare(launcher.tabs[2], "Games");
            // Back leaves the dialog without a change.
            var tab4 = findChild(launcher, function(o) { return o.objectName === "launcherTab_4"; });
            mousePress(tab4);
            tryCompare(dialog, "open", true, 3000);
            mouseRelease(tab4);
            tryCompare(dialog, "open", true, 1000);
            dialog.field.text = "Other";
            shell.gestureBack();
            verify(!dialog.open);
            verify(shell.launcherOpen);
            compare(launcher.tabs[4], "My Stuff");
            // The trash can removes an added tab.
            mousePress(tab4);
            tryCompare(dialog, "open", true, 3000);
            mouseRelease(tab4);
            tryCompare(dialog, "open", true, 1000);
            var trash = findChild(dialog, function(o) { return o.objectName === "launcherNameDelete"; });
            verify(trash.visible);
            mouseClick(trash);
            compare(launcher.tabs.length, 4);
            // Six at most: no "+" then.
            var l = shell.launcherLayout;
            l = LauncherLayout.addTab(LauncherLayout.addTab(l, "Five"), "Six");
            shell.setLauncherLayout(l);
            launcher.editMode = true;
            compare(launcher.tabs.length, 6);
            verify(!plus.visible);
            launcher.editMode = false;
            shell.setLauncherLayout(saved);
            compare(launcher.tabs.length, 4);
        }

        // Settings > Advanced > Launcher grid: dense puts four across a phone.
        function test_gridDensity() {
            compare(launcher.columns, 3);
            shell.system.tweaks = { gridDensity: "dense" };
            compare(launcher.columns, 4);
            shell.system.tweaks = {};
            compare(launcher.columns, 3);
        }
    }

    // App groups (folders) and tabs (LunaCE; docs/M6-PLAN.md F4).
    TestCase {
        name: "LauncherLayoutGroupsAndTabs"

        readonly property var entries: [
            { id: "a", title: "A", tab: 0, quickLaunch: 0 },
            { id: "b", title: "B", tab: 0, quickLaunch: 0 },
            { id: "c", title: "C", tab: 0, quickLaunch: 0 },
            { id: "d", title: "D", tab: 0, quickLaunch: 1 }
        ]

        function test_groupMakeJoinAndDissolve() {
            var l = LauncherLayout.build(entries, null);
            compare(l.pages[0], ["a", "b", "c", "d"]);
            // c onto b's centre: a group where b was.
            l = LauncherLayout.makeGroup(l, "c", "b");
            compare(l.pages[0], ["a", "group:1", "d"]);
            compare(l.groups["group:1"], { title: "Group", members: ["b", "c"] });
            compare(LauncherLayout.groupOf(l, "c"), "group:1");
            compare(LauncherLayout.entryPage(l, "c"), 0);
            // d onto the group: it joins; still in the dock.
            l = LauncherLayout.makeGroup(l, "d", "group:1");
            compare(l.groups["group:1"].members, ["b", "c", "d"]);
            compare(l.pages[0], ["a", "group:1"]);
            compare(l.dock, ["d"]);
            // Groups do not nest; a member onto its own group stays.
            compare(LauncherLayout.makeGroup(l, "group:1", "a").pages[0], ["a", "group:1"]);
            compare(LauncherLayout.makeGroup(l, "d", "group:1").groups["group:1"].members, ["b", "c", "d"]);
            l = LauncherLayout.renameGroup(l, "group:1", "  Games ");
            compare(l.groups["group:1"].title, "Games");
            // Out of the group: after it on its page, or where asked.
            l = LauncherLayout.removeFromGroup(l, "b");
            compare(l.pages[0], ["a", "group:1", "b"]);
            l = LauncherLayout.removeFromGroup(l, "c", 1, -1);
            // One left: the group dissolves, the app in its place.
            compare(l.pages[0], ["a", "d", "b"]);
            compare(l.pages[1], ["c"]);
            compare(l.groups, {});
        }

        function test_deletedMemberAndSavedGroups() {
            var l = LauncherLayout.makeGroup(LauncherLayout.build(entries, null), "a", "b");
            l = LauncherLayout.makeGroup(l, "c", "group:1");
            // Deleted: out of its group.
            l = LauncherLayout.remove(l, "a");
            compare(l.groups["group:1"].members, ["b", "c"]);
            // Kept across sessions (JSON); an app that is gone leaves it,
            // and down to one the group dissolves.
            var saved = JSON.parse(JSON.stringify(l));
            var again = LauncherLayout.build(entries, saved);
            compare(again.pages[0], ["group:1", "d"]);
            compare(again.groups["group:1"].members, ["b", "c"]);
            again = LauncherLayout.build(entries.filter(function(e) { return e.id !== "c"; }), saved);
            compare(again.pages[0], ["b", "d"]);
            compare(again.groups, {});
            // A layout saved before groups reads as before.
            compare(LauncherLayout.build(entries, { pages: [["d", "c"], [], [], []], dock: [], removed: [] }).pages[0], ["d", "c", "a", "b"]);
        }

        function test_tabs() {
            var l = LauncherLayout.build(entries, null);
            compare(LauncherLayout.tabTitle(l, 2), "Favorites");
            // Up to six; the added ones are "user:n".
            l = LauncherLayout.addTab(l, " My Stuff ");
            l = LauncherLayout.addTab(l, "Games");
            compare(l.pages.length, 6);
            compare(l.designators.slice(4), ["user:1", "user:2"]);
            compare(LauncherLayout.tabTitle(l, 4), "My Stuff");
            verify(!LauncherLayout.canAddTab(l));
            compare(LauncherLayout.addTab(l, "More").pages.length, 6);
            // Renamed, the first four too; an empty name changes nothing.
            l = LauncherLayout.renameTab(l, 2, "Games");
            compare(LauncherLayout.tabTitle(l, 2), "Games");
            compare(LauncherLayout.tabTitle(LauncherLayout.renameTab(l, 2, " "), 2), "Games");
            // Removed: only the added ones; their icons go to Apps.
            l = LauncherLayout.move(l, "a", 4, -1);
            compare(LauncherLayout.removeTab(l, 1).pages.length, 6);
            l = LauncherLayout.removeTab(l, 4);
            compare(l.pages.length, 5);
            compare(l.designators[4], "user:2");
            compare(l.pages[0], ["b", "c", "d", "a"]);
            // Kept across sessions with their names and icons.
            l = LauncherLayout.move(l, "b", 4, -1);
            var again = LauncherLayout.build(entries, JSON.parse(JSON.stringify(l)));
            compare(again.designators, ["apps", "downloads", "favorites", "prefs", "user:2"]);
            compare(again.pages[4], ["b"]);
            compare(LauncherLayout.tabTitle(again, 4), "Games");
            compare(LauncherLayout.tabTitle(again, 2), "Games");
            // A new tab comes back as a new number.
            compare(LauncherLayout.addTab(again, "X").designators[5], "user:1");
        }
    }

    // Keep-alive (luna.conf [KeepAlive]): the phone's Phone app stays
    // running when its last card closes, and its card comes back on the
    // next launch; the angry card closes it for good. The running apps
    // have process ids (applicationManager/running, close).
    TestCase {
        name: "KeepAlive"
        when: windowShown

        function test_keepAliveLists() {
            // Phones: luna.conf; the Phoenix apps for the original ids.
            compare(windows.keepAliveApps, ["org.webosphoenix.phone"]);
            compare(windows.launchAtBootApps, ["org.webosphoenix.phone", "com.palm.app.email", "com.palm.app.calendar",
                                               "org.webosphoenix.messaging", "org.webosphoenix.camera"]);
            compare(windows.keepAliveUntilMemoryPressureApps, ["com.palm.app.browser"]);
        }

        function test_phoneStaysAlive() {
            var uid = windows.launch("org.webosphoenix.phone");
            verify(uid !== "");
            var pid = windows._pidOf("org.webosphoenix.phone");
            windows.close(uid);
            compare(windows.runningUid("org.webosphoenix.phone"), "");
            verify(windows.running().some(function (r) { return r.id === "org.webosphoenix.phone" && r.processid === pid; }),
                   "still running, without a card");
            compare(windows.launch("org.webosphoenix.phone"), uid, "the same window comes back");
            verify(windows.windowFor(uid) !== null);
            // Thrown away angrily: closed for good.
            windows.close(uid, true);
            verify(!windows.running().some(function (r) { return r.id === "org.webosphoenix.phone"; }));
        }

        // [KeepAliveUntilMemPressure]: the browser stays until memory runs low.
        function test_browserUntilMemoryPressure() {
            windows.apps.append(Object.assign(windows._launcherFields(), {
                appId: "com.palm.app.browser", title: "Web", color: "#2a9bbd", glyph: "W", tab: -1, quickLaunch: 0,
                icon: "", largeIcon: "", splashIcon: "", splashBackground: "", web: false, main: "", noWindow: false,
                orientation: "", webAppId: "", params: "", dir: "", removable: false, version: "" }));
            var uid = windows.launch("com.palm.app.browser");
            windows.close(uid);
            verify(windows.running().some(function (r) { return r.id === "com.palm.app.browser"; }), "kept while memory lasts");
            windows.memory.forceLow = true;
            verify(!windows.running().some(function (r) { return r.id === "com.palm.app.browser"; }), "closed when memory runs low");
            // Low already: closing its card closes it.
            windows.memory.forceLow = false;
            uid = windows.launch("com.palm.app.browser");
            windows.memory.forceLow = true;
            windows.close(uid);
            verify(!windows.running().some(function (r) { return r.id === "com.palm.app.browser"; }));
            windows.memory.forceLow = false;
            windows.apps.remove(windows.apps.count - 1);
        }

        function test_otherAppsClose() {
            var uid = windows.launch("org.webosphoenix.maps");
            windows.close(uid);
            verify(!windows.running().some(function (r) { return r.id === "org.webosphoenix.maps"; }));
        }

        // The runtime's applicationManager running and close, answered
        // through the pages' status (installerResult for the request).
        function test_runningAndCloseForTheRuntime() {
            var uid = windows.launch("org.webosphoenix.maps");
            windows._appManagerOp({ requestId: "r1", op: "running" });
            var r = windows._pendingStatus.installerResult;
            compare(r.requestId, "r1");
            var maps = r.running.filter(function (x) { return x.id === "org.webosphoenix.maps"; })[0];
            verify(maps && /^\d+$/.test(maps.processid), "running: {id, processid}");
            windows._appManagerOp({ requestId: "r2", op: "close", processId: maps.processid });
            compare(windows._pendingStatus.installerResult.ok, true);
            compare(windows.cardIndex(uid), -1, "close: the app's card is gone");
            windows._appManagerOp({ requestId: "r3", op: "nonsense" });
            compare(windows._pendingStatus.installerResult.ok, false);
        }

        // applicationManager/launch replies the process id of the app it
        // started: the one running lists and close takes.
        function test_launchReplyIsTheRunningProcessId() {
            windows._hostMessage("org.webosphoenix.calendar", "", "launch", { id: "org.webosphoenix.maps", params: {} });
            windows._appManagerOp({ requestId: "p1", op: "processId", appId: "org.webosphoenix.maps", params: {} });
            var pid = windows._pendingStatus.installerResult.processId;
            verify(/^\d+$/.test(pid), "a process id: " + pid);
            windows._appManagerOp({ requestId: "p2", op: "running" });
            var maps = windows._pendingStatus.installerResult.running.filter(function (x) { return x.id === "org.webosphoenix.maps"; })[0];
            compare(maps.processid, pid);
            windows._appManagerOp({ requestId: "p3", op: "close", processId: pid });
            compare(windows.runningUid("org.webosphoenix.maps"), "");
            // Not running: no process id.
            windows._appManagerOp({ requestId: "p4", op: "processId", appId: "org.webosphoenix.maps", params: {} });
            compare(windows._pendingStatus.installerResult.processId, "");
        }

        function test_closeProcess() {
            var uid = windows.launch("org.webosphoenix.maps");
            var pid = windows._pidOf("org.webosphoenix.maps");
            windows.closeProcess(pid);
            compare(windows.cardIndex(uid), -1);
            verify(!windows.running().some(function (r) { return r.id === "org.webosphoenix.maps"; }));
        }
    }
}
