// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Notifications stacked as layers, as webOS's dashboards held them (Enyo
// 1.0 enyo.Dashboard, palm/system/Dashboard.js; dashboard-window/
// DashboardContent.js): an app's notifications of one group are one row,
// newest on top with the count, the next ones peeking out; a swipe on the
// top layer pops it, the last swipe takes the row; a tap opens the app with
// the top layer. NotificationStacks.js, the window source's "notification"
// {group}, Notifications.qml, DashboardItem.qml and the lock screen.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim
import "../qml/Phoenix/Shell/NotificationStacks.js" as Stacks

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    ListModel { id: plain }

    SignalSpy { id: activatedSpy; target: shell.notifications; signalName: "activated" }

    readonly property string messaging: "org.webosphoenix.messaging"

    TestCase {
        name: "NotificationStacks"
        when: windowShown

        function init() {
            shell.unlock();
            sys.lockScreenPreviews = true;
            shell.notifications.dashboardOpen = false;
            shell.notifications.bannerActive = false;
            windows.notifications.clear();
            plain.clear();
            activatedSpy.clear();
        }
        function cleanup() {
            shell.unlock();
            shell.notifications.dashboardOpen = false;
            windows.notifications.clear();
        }

        // A text from someone, as the runtime posts it (phoenix-runtime.js
        // simulateIncomingSms): its conversation is its group.
        function text(from, body, thread) {
            windows._hostMessage(messaging, "", "notification",
                                 { appId: messaging, title: from, body: body, params: { threadId: thread }, group: thread });
        }
        function row(title) {
            for (var i = 0; i < windows.notifications.count; ++i)
                if (windows.notifications.get(i).title === title)
                    return windows.notifications.get(i);
            return null;
        }
        function indexOf(title) {
            for (var i = 0; i < windows.notifications.count; ++i)
                if (windows.notifications.get(i).title === title)
                    return i;
            return -1;
        }
        // The open dashboard's row items (DashboardItem), by their title.
        function dashboardItem(title) {
            var found = null;
            (function walk(o) {
                if (found)
                    return;
                if (o.objectName === "" && o.hasOwnProperty("layerCount") && o.hasOwnProperty("topEdge")
                        && o.title === title && o.visible && o.parent && o.parent.index !== undefined && o.parent.index >= 0)
                    found = o;
                for (var i = 0; i < o.children.length; ++i)
                    walk(o.children[i]);
            })(shell.notifications);
            return found;
        }
        function swipeArea(item) {
            return findChild(item, "dashboardSwipe");
        }
        function openDashboard() {
            shell.notifications.bannerActive = false;
            shell.notifications.dashboardOpen = true;
            tryCompare(shell.notifications, "negativeSpace", shell.notifications.dashboardHeight, 2000);
        }
        // A slow drag on a row, from x along by dx.
        function drag(area, x, dx) {
            var y = area.height / 2;
            mousePress(area, x, y);
            var steps = 12;
            for (var i = 1; i <= steps; ++i) {
                wait(15);
                mouseMove(area, x + dx * i / steps, y);
            }
            mouseRelease(area, x + dx, y);
        }

        // ---- NotificationStacks.js ------------------------------------------------------

        function add(model, appId, title, body, group, tag) {
            return Stacks.push(model, { id: "id" + model.count + title + body, appId: appId, title: title, body: body,
                                        params: JSON.stringify({ t: body }), tag: tag || "", actions: "",
                                        windowKey: "", ongoing: false }, group);
        }

        function test_pushStacksOneGroup() {
            add(plain, "a", "Ada", "1", "t1");
            add(plain, "a", "Ada", "2", "t1");
            add(plain, "a", "Ben", "x", "t2");
            add(plain, "b", "Ada", "other app", "t1");
            add(plain, "a", "Plain", "no group", "");
            add(plain, "a", "Plain", "no group again", "");
            compare(plain.count, 5);
            var ada = plain.get(0);
            compare(ada.layerCount, 2);
            compare(ada.title, "Ada");
            compare(ada.body, "2");
            compare(JSON.parse(ada.params).t, "2");
            compare(Stacks.layersOf(ada).map(function (l) { return l.body; }), ["1", "2"]);
            compare(plain.get(1).layerCount, 1);
            compare(plain.get(2).appId, "b");
            compare(plain.get(3).group, "");
            compare(plain.get(4).group, "");
            // The row stays where it was (a dashboard window did).
            add(plain, "a", "Ada", "3", "t1");
            compare(plain.count, 5);
            compare(plain.get(0).layerCount, 3);
            compare(plain.get(0).body, "3");
        }

        function test_popRemoveAndTags() {
            add(plain, "a", "Ada", "1", "t1", "m1");
            add(plain, "a", "Ada", "2", "t1", "m2");
            add(plain, "a", "Ada", "3", "t1", "m3");
            // A pop shows the layer under the top one.
            verify(!Stacks.pop(plain, 0));
            compare(plain.get(0).layerCount, 2);
            compare(plain.get(0).body, "2");
            compare(plain.get(0).tag, "m2");
            // A tag taken back from inside the stack: the top stays.
            Stacks.removeTagged(plain, "a", "m1");
            compare(plain.get(0).layerCount, 1);
            compare(plain.get(0).body, "2");
            // The last pop takes the row.
            verify(Stacks.pop(plain, 0));
            compare(plain.count, 0);
            // The app read the conversation: the whole stack goes.
            add(plain, "a", "Ada", "1", "t1");
            add(plain, "a", "Ada", "2", "t1");
            add(plain, "a", "Ben", "1", "t2");
            verify(Stacks.removeGroup(plain, "a", "t1"));
            compare(plain.count, 1);
            compare(plain.get(0).title, "Ben");
            verify(!Stacks.removeGroup(plain, "a", "t1"));
            // A row from before stacks (no layers): itself, one layer.
            plain.append({ id: "old", appId: "a", title: "Old", body: "b", params: "", tag: "", actions: "", windowKey: "", ongoing: false });
            compare(Stacks.layersOf(plain.get(1)).length, 1);
            compare(Stacks.layersOf(plain.get(1))[0].title, "Old");
        }

        // ---- The window source --------------------------------------------------------

        // Several texts from two people: one stack each, the newest on
        // top, every one with its banner (the original pushed a layer and
        // a banner).
        function test_twoPeopleTwoStacks() {
            text("Ada Palmer", "Are you there?", "t-ada");
            text("Marcus Reyes", "Lunch at noon?", "t-marcus");
            text("Ada Palmer", "Call me", "t-ada");
            text("Ada Palmer", "It's about Friday", "t-ada");
            text("Marcus Reyes", "Or 1?", "t-marcus");
            compare(windows.notifications.count, 2);
            compare(row("Ada Palmer").layerCount, 3);
            compare(row("Ada Palmer").body, "It's about Friday");
            compare(row("Marcus Reyes").layerCount, 2);
            compare(row("Marcus Reyes").body, "Or 1?");
            compare(JSON.parse(row("Marcus Reyes").params).threadId, "t-marcus");
            // Five banners: one showing, four waiting.
            verify(shell.notifications.bannerActive);
            compare(shell.notifications.bannerQueueLength, 4);
            // One icon per stack in the bar.
            shell.notifications.bannerActive = false;
            var icons = findChild(shell.notifications, "phoneNotificationIcons");
            tryCompare(icons, "visible", true, 2000);
            var shown = 0;
            for (var i = 0; i < icons.children.length; ++i)
                if (icons.children[i].hasOwnProperty("glyph"))
                    ++shown;
            compare(shown, 2);
            // Read: the app takes its stack away.
            windows._hostMessage(messaging, "", "notification", { group: "t-ada", remove: true });
            compare(windows.notifications.count, 1);
            compare(windows.notifications.get(0).title, "Marcus Reyes");
        }

        // ---- The row ------------------------------------------------------------------

        // The count badge, the layers peeking out at the left: the one under
        // the top 12 px left of it, 15 px of it showing, from three layers.
        function test_stackLooksLikeTheOriginals() {
            text("Ada Palmer", "One", "t-ada");
            text("Ada Palmer", "Two", "t-ada");
            text("Ada Palmer", "Three", "t-ada");
            text("Marcus Reyes", "Hi", "t-marcus");
            text("Marcus Reyes", "Hello?", "t-marcus");
            text("Lena Okafor", "Thanks!", "t-lena");
            openDashboard();
            var ada = dashboardItem("Ada Palmer");
            var marcus = dashboardItem("Marcus Reyes");
            var lena = dashboardItem("Lena Okafor");
            verify(ada && marcus && lena);
            var badge = findChild(ada, "dashboardCount");
            verify(badge.visible);
            compare(findChild(ada, "dashboardCountLabel").text, "3");
            compare(findChild(marcus, "dashboardCountLabel").text, "2");
            verify(!findChild(lena, "dashboardCount").visible, "no count on a single notification");
            // Three: the top layer's edge 12 px right of the second's, and
            // 15 px of the second showing, its divider and all.
            compare(ada.topEdge, Theme.dashboardLayerEdge + Theme.dashboardLayerStep);
            var under = findChild(ada, "dashboardUnderLayer");
            verify(under.visible);
            compare(under.width, Theme.dashboardLayerPeek);
            compare(findChild(ada, "dashboardUnderTitle").text, "Ada Palmer");
            // Two: the top layer at the second's place, the one under it
            // (the bottom one) hidden until the top moves.
            compare(marcus.topEdge, Theme.dashboardLayerEdge);
            compare(findChild(marcus, "dashboardUnderLayer").width, 0);
            verify(findChild(marcus, "dashboardTopDivider").visible);
            verify(!findChild(lena, "dashboardTopDivider").visible);
            // The top layer swiped part way shows the one under it.
            marcus.layerX = 40;
            compare(findChild(marcus, "dashboardUnderLayer").width, 40);
            marcus.layerX = 0;
        }

        // A swipe on the top layer pops it and the next one shows; one past
        // 35% of the layer's width; less, it slides back. The last layer's
        // swipe takes the row, as a single notification's.
        function test_swipePopsOneLayer() {
            text("Ada Palmer", "One", "t-ada");
            text("Ada Palmer", "Two", "t-ada");
            text("Ada Palmer", "Three", "t-ada");
            openDashboard();
            var ada = dashboardItem("Ada Palmer");
            var area = swipeArea(ada);
            var w = ada.width - ada.topEdge;
            // A short drag: back where it was, nothing popped.
            drag(area, 120, w * 0.2);
            tryCompare(ada, "layerX", 0, 3000);
            compare(row("Ada Palmer").layerCount, 3);
            compare(ada.x, 0, "the row itself never moved");
            // Past 35%: popped, the next layer on top.
            drag(area, 120, w * 0.5);
            tryCompare(row("Ada Palmer"), "layerCount", 2, 3000);
            compare(row("Ada Palmer").body, "Two");
            compare(windows.notifications.count, 1);
            ada = dashboardItem("Ada Palmer");
            tryCompare(ada, "layerX", 0, 1000);
            compare(ada.body, "Two");
            compare(findChild(ada, "dashboardCountLabel").text, "2");
            // Never leftwards (Enyo's layers: allowLeft false).
            area = swipeArea(ada);
            drag(area, 200, -120);
            compare(row("Ada Palmer").layerCount, 2);
            // Again: one left, no count.
            drag(area, 120, w * 0.5);
            tryCompare(row("Ada Palmer"), "layerCount", 1, 3000);
            compare(row("Ada Palmer").body, "One");
            ada = dashboardItem("Ada Palmer");
            tryVerify(function () { return !findChild(ada, "dashboardCount").visible; }, 1000);
            // The last one: the whole row goes, as a notification of its own.
            area = swipeArea(ada);
            drag(area, 120, 150);
            tryCompare(windows.notifications, "count", 0, 3000);
        }

        // On the icon (the badge's 50 px) the row is dragged, the whole
        // stack with it (DashboardWindowContainer.cpp:193-217).
        function test_swipeOnTheIconTakesTheStack() {
            text("Marcus Reyes", "Hi", "t-marcus");
            text("Marcus Reyes", "Hello?", "t-marcus");
            text("Lena Okafor", "Thanks!", "t-lena");
            openDashboard();
            var area = swipeArea(dashboardItem("Marcus Reyes"));
            drag(area, 20, 160);
            tryCompare(windows.notifications, "count", 1, 3000);
            compare(windows.notifications.get(0).title, "Lena Okafor");
        }

        // A tap opens the app with the top layer's params; the stack is done
        // with (Email's dashboard on a tap, DashboardManager.js:647-661).
        function test_tapOpensTheTopLayer() {
            text("Ada Palmer", "One", "t-ada");
            windows._hostMessage(messaging, "", "notification",
                                 { title: "Ada Palmer", body: "Two", params: { threadId: "t-ada", message: 2 }, group: "t-ada" });
            openDashboard();
            var area = swipeArea(dashboardItem("Ada Palmer"));
            mouseClick(area, 150, area.height / 2);
            compare(activatedSpy.count, 1);
            compare(activatedSpy.signalArguments[0][0], messaging);
            compare(JSON.parse(activatedSpy.signalArguments[0][1]).message, 2);
            tryCompare(windows.notifications, "count", 0, 2000);
        }

        // Select and Clear All act on whole stacks; the keyboard's Delete
        // pops the top layer, as a swipe on it.
        function test_clearAndKeysActOnStacks() {
            text("Ada Palmer", "One", "t-ada");
            text("Ada Palmer", "Two", "t-ada");
            text("Marcus Reyes", "Hi", "t-marcus");
            text("Marcus Reyes", "Hello?", "t-marcus");
            text("Lena Okafor", "Thanks!", "t-lena");
            var notes = shell.notifications;
            compare(notes.clearableCount, 3);
            openDashboard();
            notes.keyRow = indexOf("Ada Palmer");
            verify(notes.handleKey({ key: Qt.Key_Delete }));
            compare(row("Ada Palmer").layerCount, 1);
            compare(windows.notifications.count, 3);
            notes.selecting = true;
            notes.toggleSelected(row("Marcus Reyes").id);
            notes.clearSelected();
            compare(windows.notifications.count, 2);
            verify(row("Marcus Reyes") === null);
            notes.clearAll();
            compare(windows.notifications.count, 0);
        }

        // A pushed layer is a new notification: its banner, even though no
        // row was added.
        function test_pushShowsItsBanner() {
            text("Ada Palmer", "One", "t-ada");
            var notes = shell.notifications;
            notes.bannerActive = false;
            text("Ada Palmer", "Two", "t-ada");
            verify(notes.bannerActive);
            compare(notes.bannerText, "Ada Palmer: Two");
            // A pop is not.
            notes.bannerActive = false;
            windows.popNotificationLayer(0);
            verify(!notes.bannerActive);
        }

        // ---- The lock screen ----------------------------------------------------------

        function lockItems() {
            var out = [];
            (function walk(o) {
                if (o.objectName === "lockDashboardItem")
                    out.push(o);
                for (var i = 0; i < o.children.length; ++i)
                    walk(o.children[i]);
            })(shell);
            return out;
        }

        // A stack shows its count; with previews off, "3 New Messages"
        // under the app's name, nobody's name or words.
        function test_lockScreenCount() {
            shell.lock();
            text("Ada Palmer", "One", "t-ada");
            text("Ada Palmer", "Two", "t-ada");
            text("Ada Palmer", "Three", "t-ada");
            shell.notifications.bannerActive = false;
            tryVerify(function () { return lockItems().length === 1; }, 8000);
            var item = lockItems()[0];
            compare(item.layerCount, 3);
            compare(item.title, "Ada Palmer");
            compare(item.body, "Three");
            verify(findChild(item, "dashboardCount").visible);
            sys.lockScreenPreviews = false;
            compare(item.title, "Messaging");
            compare(item.body, "3 New Messages");
            compare(item.layers, "", "nothing of what the layers say");
            compare(findChild(item, "dashboardCountLabel").text, "3");
            // One more while locked: the count follows.
            text("Ada Palmer", "Four", "t-ada");
            shell.notifications.bannerActive = false;
            tryCompare(item, "body", "4 New Messages", 2000);
            sys.lockScreenPreviews = true;
        }
    }
}
