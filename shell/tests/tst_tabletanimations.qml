// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The original's animations Phoenix had missing (docs/spec/ANIMATIONS.md),
// on a tablet: the status bar's notification group fading in and out, its
// icons fading for a banner, and a row its app takes away sliding out of
// the drop-down.
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 1024
    height: 768

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "tablet"
        density: 1
        hardwareHomeButton: true
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    TestCase {
        name: "TabletAnimations"
        when: windowShown

        function init() {
            Theme.reduceMotion = false;
            shell.unlock();
            shell.notifications.dashboardOpen = false;
            while (windows.notifications.count > 0)
                windows.notifications.remove(0);
            shell.notifications.bannerActive = false;
        }
        function cleanup() {
            Theme.reduceMotion = false;
            init();
        }

        // The group fades in with the first notification (300 ms, linear),
        // its icons out while a banner shows and back after it.
        function test_notificationGroupAndIconsFade() {
            var icons = findChild(shell, "tabletNotificationIcons");
            var sep = findChild(shell, "notificationSeparator");
            tryCompare(icons, "opacity", 0, 2000);
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "Hi");
            // The banner first: the icons stay out.
            tryVerify(function() { return shell.notifications.bannerActive; }, 2000);
            compare(icons.opacity, 0);
            shell.notifications.bannerActive = false;
            // Fading, not there at once.
            verify(icons.opacity < 1, "fades in");
            tryCompare(icons, "opacity", 1, 2000);
            compare(sep.opacity, 1);
            // A banner: the icons fade out under it.
            shell.notifications.bannerActive = true;
            verify(icons.opacity > 0, "fades out");
            tryCompare(icons, "opacity", 0, 2000);
            shell.notifications.bannerActive = false;
            tryCompare(icons, "opacity", 1, 2000);
            // The last one gone: the group fades out.
            windows.notifications.remove(0);
            verify(icons.opacity > 0, "the group fades out");
            tryCompare(icons, "opacity", 0, 2000);
            // Reduce motion: at once.
            Theme.reduceMotion = true;
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "Again");
            shell.notifications.bannerActive = false;
            tryCompare(icons, "opacity", 1, 200);
        }

        // A row its app takes away slides on a width and a half before it
        // goes; one swiped away does not slide twice.
        function test_rowRemovedByItsAppSlidesOut() {
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "One");
            windows.notify("org.webosphoenix.email", "Mail", "Two");
            shell.notifications.bannerActive = false;
            shell.notifications.dashboardOpen = true;
            var menu = findChild(shell, "dashboardMenu");
            tryCompare(menu, "opacity", 1, 2000);
            windows.notifications.remove(0);
            var ghost = findChild(menu, "dashboardMenuLeavingRow");
            verify(ghost, "a copy of the row slides out");
            compare(ghost.title, "Palm Pre");
            tryVerify(function() { return ghost.x > 0; }, 1000);
            tryVerify(function() { return findChild(menu, "dashboardMenuLeavingRow") === null; }, 2000, "and goes");
            // Swiped away (the row has slid already): no copy.
            var container = findChild(menu, "dashboardMenuContainer");
            var row = null;
            for (var i = 0; i < container.children.length && !row; ++i)
                if (container.children[i].hasOwnProperty("wheelMove"))
                    row = container.children[i];
            verify(row);
            row.wheelMove(row.width / 2);
            row.wheelRelease();
            tryCompare(windows.notifications, "count", 0, 2000);
            compare(findChild(menu, "dashboardMenuLeavingRow"), null);
            shell.notifications.dashboardOpen = false;
        }
    }
}
