// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The community's notification options (docs/M6-PLAN.md F4 item 4) in the
// shell: private previews on the lock screen ("New Message"), and a
// notification's sound repeated until it is seen.
// Run: qmltestrunner -import qml -input tests

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
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    TestCase {
        name: "NotificationOptions"
        when: windowShown

        function init() {
            shell.unlock();
            windows.notifications.clear();
            sys.lockScreenPreviews = true;
            sys.notificationRepeat = { enabled: false, minutes: 2, apps: {} };
            shell.markNotificationsSeen();
            shell.notifications.dashboardOpen = false;
        }
        function cleanup() {
            shell.unlock();
            windows.notifications.clear();
            sys.notificationRepeat = { enabled: false, minutes: 2, apps: {} };
            shell.markNotificationsSeen();
        }

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

        // Show previews off: the locked screen's banner and dashboard say
        // "New Message" under the app's name, not who sent what.
        function test_privatePreviews() {
            shell.lock();
            windows.notify("org.webosphoenix.messaging", "Mary Spetzler", "Dinner at 8?");
            var text = findChild(shell, "lockBannerText");
            tryCompare(text, "text", "Mary Spetzler: Dinner at 8?", 2000);
            sys.lockScreenPreviews = false;
            compare(text.text, "New Message");
            // Once the banner has gone, the dashboard.
            tryVerify(function() { return lockItems().length === 1; }, 8000);
            var item = lockItems()[0];
            compare(item.body, "New Message");
            compare(item.title, "Messaging");
            sys.lockScreenPreviews = true;
            compare(item.body, "Dinner at 8?");
            compare(item.title, "Mary Spetzler");
            // Not locked: everything, as before.
            sys.lockScreenPreviews = false;
            shell.unlock();
            compare(shell.notifications.model.get(0).body, "Dinner at 8?");
        }

        // Repeat alerts: the sound again every interval while the app has a
        // notification nobody has looked at; the dashboard opened stops it.
        function test_repeatUntilSeen() {
            sys.notificationRepeat = { enabled: true, minutes: 0.005, apps: {} };   // 300 ms
            windows.notify("org.webosphoenix.messaging", "Mary", "Hi");
            windows.soundRequested("org.webosphoenix.messaging", "notifications", "", 0);
            var before = shell.notificationRepeats;
            tryVerify(function() { return shell.notificationRepeats >= before + 2; }, 3000);
            shell.notifications.dashboardOpen = true;
            var seen = shell.notificationRepeats;
            wait(800);
            compare(shell.notificationRepeats, seen);
            shell.notifications.dashboardOpen = false;
            // An app turned off repeats nothing; nor one whose notification
            // went.
            sys.notificationRepeat = { enabled: true, minutes: 0.005, apps: { "org.webosphoenix.messaging": false } };
            windows.soundRequested("org.webosphoenix.messaging", "notifications", "", 0);
            wait(800);
            compare(shell.notificationRepeats, seen);
            sys.notificationRepeat = { enabled: true, minutes: 0.005, apps: {} };
            windows.soundRequested("org.webosphoenix.messaging", "notifications", "", 0);
            windows.notifications.clear();
            wait(800);
            compare(shell.notificationRepeats, seen);
            // Off: no repeats.
            sys.notificationRepeat = { enabled: false, minutes: 0.005, apps: {} };
            windows.notify("org.webosphoenix.messaging", "Mary", "Hi");
            windows.soundRequested("org.webosphoenix.messaging", "notifications", "", 0);
            wait(800);
            compare(shell.notificationRepeats, seen);
        }
    }
}
