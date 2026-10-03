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
            mouseClick(shell, decorator.x, decorator.y);
            tryCompare(dialog, "opacity", 1, 1000);
            mouseClick(findChild(shell, function(o) { return o.objectName === "deleteDialogRemove"; }));
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
            wait(Theme.tapAndHoldInterval + 150);
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

        function test_closeProcess() {
            var uid = windows.launch("org.webosphoenix.maps");
            var pid = windows._pidOf("org.webosphoenix.maps");
            windows.closeProcess(pid);
            compare(windows.cardIndex(uid), -1);
            verify(!windows.running().some(function (r) { return r.id === "org.webosphoenix.maps"; }));
        }
    }
}
