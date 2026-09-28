// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Desktop simulator entry point (loaded by phoenix-sim).
//
// Context properties set by phoenix-sim:
//   simScene       "locked" | "cards" | "stacks" | "reorder" | "maximized" | "launcher" |
//                  "dashboard" | "justtype" | "systemmenu" | "empty"
//   simFormFactor  "auto" | "phone" | "tablet"

import QtQuick
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: typeof simFormFactor !== "undefined" ? simFormFactor : "auto"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus {
            id: status
            // Fixed clock for reproducible screenshots.
            fixedTime: typeof simScene !== "undefined" && simScene !== "" ? new Date(2009, 5, 6, 9, 41) : null
        }
    }

    // Build a demo scene, as if the user had been using the phone for a bit.
    Component.onCompleted: {
        var scene = typeof simScene !== "undefined" && simScene !== "" ? simScene : "locked";
        if (scene === "empty")
            return shell.unlock();
        if (scene !== "locked")
            shell.unlock();
        var ids = ["org.webosphoenix.email", "org.webosphoenix.messaging", "org.webosphoenix.calendar",
                   "org.webosphoenix.browser"];
        var last = "";
        for (var i = 0; i < ids.length; ++i)
            last = windows.launch(ids[i], "");
        shell.cardView.position = 1;
        if (scene === "stacks" || scene === "reorder") {
            // Two extra Messaging windows stack with the first.
            var msg = windows.runningUid("org.webosphoenix.messaging");
            windows.openChild(msg);
            windows.openChild(msg);
            // After the child windows' own focus requests have run.
            Qt.callLater(function() {
                var cv = shell.cardView;
                cv.jumpTo(1);
                if (scene === "reorder") {
                    var uid = cv.currentUid;
                    var p = cv.layout.cards[uid];
                    cv.enterReorder(uid, p.cx, p.cy);
                    cv.moveReorder(p.cx + 20, p.cy - 30);
                }
            });
        } else if (scene === "maximized") {
            shell.cardView.maximizeProgress = 1;
        } else if (scene === "systemmenu") {
            shell.openSystemMenu();
        } else if (scene === "launcher") {
            shell.gestureUp();
        } else if (scene === "dashboard" || scene === "locked") {
            windows.notify("org.webosphoenix.messaging", "Palm Pre", "It's good to be back.");
            windows.notify("org.webosphoenix.email", "3 new emails", "webOS Phoenix build passed");
            windows.notify("org.webosphoenix.calendar", "Launch party", "Tomorrow, 9:41 AM");
            if (scene === "dashboard")
                shell.notifications.dashboardOpen = true;
        } else if (scene === "justtype") {
            shell.startJustType("m");
        }
    }
}
