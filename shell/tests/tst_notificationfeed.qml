// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// NotificationFeed.qml: the notification list as the services read it
// (newest first, a dashboard's words, the lock screen and its previews),
// given to the window source; each new notification offered to the
// Assistant to announce, and the reply listened for when it asks. And the
// simulator's source: when each came, a dashboard's words from its page,
// and the list given to the pages (org.webosphoenix.system getNotifications).

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    QtObject {
        id: fakeSource
        property ListModel notifications: ListModel {}
        property var published: []
        property var calls: []
        function appInfo(appId) {
            return { "org.webosphoenix.messaging": { title: "Messaging" }, "com.palm.app.email": { title: "Email" } }[appId] || null;
        }
        function publishNotifications(d) { published = published.concat([d]); }
        function lunaCall(uri, params, cb) {
            calls = calls.concat([{ uri: uri, params: params }]);
            Qt.callLater(function () {
                cb({ returnValue: true, spoken: /messaging/.test(params.appId), listen: /messaging/.test(params.appId), threadId: "t1" });
            });
        }
        function add(o) {
            notifications.append(Object.assign({ id: "", appId: "", title: "", body: "", windowKey: "", ongoing: false, time: 0,
                                                 dashboardTitle: "", dashboardBody: "" }, o));
        }
    }

    NotificationFeed {
        id: feed
        source: fakeSource
    }
    SignalSpy { id: replies; target: feed; signalName: "replyByVoice" }

    SimWindowSource { id: windows }

    TestCase {
        name: "NotificationFeed"
        when: windowShown

        function init() {
            fakeSource.notifications.clear();
            fakeSource.published = [];
            fakeSource.calls = [];
            feed.locked = false;
            feed.previews = true;
            feed.headphones = false;
            replies.clear();
        }

        function test_listNewestFirstWithDashboardWords() {
            fakeSource.add({ id: "a", appId: "org.webosphoenix.messaging", title: "Sam", body: "Running late", time: 1000 });
            fakeSource.add({ id: "b", appId: "com.palm.app.email", title: "Email", windowKey: "dash1", time: 3000,
                             dashboardTitle: "Alex Rivera", dashboardBody: "Invoice 2231" });
            fakeSource.add({ id: "c", appId: "org.webosphoenix.files", title: "Downloading", body: "50%", ongoing: true, time: 2000 });
            var d = feed.digest();
            compare(d.map(function (n) { return n.id; }), ["b", "c", "a"]);
            compare(d[0].title, "Alex Rivera");
            compare(d[0].body, "Invoice 2231");
            compare(d[0].app, "Email");
            compare(d[2].app, "Messaging");
            verify(d[1].ongoing);
        }

        function test_publishesWhatChanges() {
            fakeSource.add({ id: "a", appId: "org.webosphoenix.messaging", title: "Sam", body: "Hi", time: 1000 });
            tryVerify(function () { return fakeSource.published.length > 0; }, 2000);
            var last = fakeSource.published[fakeSource.published.length - 1];
            compare(last.notifications.length, 1);
            verify(!last.locked);
            verify(last.previews);
            feed.locked = true;
            feed.previews = false;
            tryVerify(function () {
                var p = fakeSource.published[fakeSource.published.length - 1];
                return p.locked && !p.previews;
            }, 2000);
            fakeSource.notifications.remove(0);
            tryVerify(function () { return fakeSource.published[fakeSource.published.length - 1].notifications.length === 0; }, 2000);
        }

        function test_announcesEachNewOneAndListensWhenAsked() {
            feed.headphones = true;
            fakeSource.add({ id: "a", appId: "org.webosphoenix.messaging", title: "Sam", body: "Where are you?", time: 1000 });
            fakeSource.add({ id: "b", appId: "org.webosphoenix.files", title: "Downloading", body: "50%", ongoing: true, time: 1000 });
            fakeSource.add({ id: "c", appId: "org.webosphoenix.assistant", title: "Where is it?", body: "", time: 1000 });
            tryVerify(function () { return fakeSource.calls.length > 0; }, 2000);
            wait(200);
            compare(fakeSource.calls.length, 1);
            compare(fakeSource.calls[0].uri, "luna://org.webosphoenix.assistant/announce");
            compare(fakeSource.calls[0].params.title, "Sam");
            compare(fakeSource.calls[0].params.body, "Where are you?");
            compare(fakeSource.calls[0].params.app, "Messaging");
            verify(fakeSource.calls[0].params.headphones);
            replies.wait(2000);
            compare(replies.signalArguments[0][0], "t1");
        }

        // A stack (NotificationStacks.js): each layer is a notification of
        // its own in the list, and a layer pushed on it is announced.
        function test_stackLayers() {
            windows.notifications.clear();
            var stackFeed = Qt.createQmlObject("import Phoenix.Shell; NotificationFeed {}", root);
            var calls = [];
            stackFeed.source = { notifications: windows.notifications, appInfo: windows.appInfo,
                                 publishNotifications: function () {}, lunaCall: function (uri, p, cb) { calls.push(p); cb({ returnValue: true }); } };
            wait(200);
            windows.notify("org.webosphoenix.messaging", "Sam", "First", null, { group: "sam" });
            tryVerify(function () { return calls.length === 1; }, 2000);
            windows.notify("org.webosphoenix.messaging", "Sam", "Second", null, { group: "sam" });
            tryVerify(function () { return calls.length === 2; }, 2000);
            compare(calls[1].body, "Second");
            compare(windows.notifications.count, 1);
            var d = stackFeed.digest();
            compare(d.length, 2);
            compare(d.map(function (n) { return n.body; }).sort(), ["First", "Second"]);
            verify(d[0].time >= d[1].time);
            stackFeed.destroy();
        }

        function test_simulatorSourceKeepsTimeAndDashboardWords() {
            var before = Date.now();
            windows.notify("org.webosphoenix.messaging", "Sam", "Hi", null);
            var n = windows.notifications.get(windows.notifications.count - 1);
            verify(n.time >= before);
            compare(n.dashboardTitle, "");
            // A dashboard window's page says its words (runtime: windowProperties {dashboardText}).
            windows.notifications.append({ id: "dash9", appId: "com.palm.app.email", title: "Email", body: "", color: "#666666", glyph: "!", icon: "",
                                           params: "", windowKey: "dash9", clickableWhenLocked: false, ongoing: false, progress: -1, tag: "",
                                           actions: "", time: Date.now(), dashboardTitle: "", dashboardBody: "" });
            windows._systemWindowProperties("dash9", { dashboardText: { title: "Alex Rivera", body: "Invoice 2231" } });
            var dsh = windows.notifications.get(windows.notifications.count - 1);
            compare(dsh.dashboardTitle, "Alex Rivera");
            compare(dsh.dashboardBody, "Invoice 2231");
            // The list goes to the pages as the shell's own status.
            windows.publishNotifications({ notifications: [{ id: "x" }], locked: false, previews: true });
            compare(windows._shellStatus.notifications.notifications[0].id, "x");
        }
    }
}
