// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The app menu the shell draws for a site's card (SiteMenu): Back and
// Forward only when there is history that way, Reload, Copy Link (the
// system clipboard), Open in Browser.

import QtQuick
import QtTest
import Phoenix.Shell

Item {
    id: root
    width: 320
    height: 480

    SiteMenu {
        id: menu
        anchors.fill: parent
        onCloseRequested: open = false
        property var actions: []
        onAction: (name) => actions.push(name)
    }
    TextEdit { id: pasteTarget }

    TestCase {
        name: "SiteMenu"
        when: windowShown

        function tapEntry(name) {
            var e = findChild(menu, "siteMenu_" + name);
            verify(e, name);
            mouseClick(e, e.width / 2, e.height / 2);
        }

        function test_entries() {
            menu.actions = [];
            menu.canGoBack = false;
            menu.canGoForward = true;
            menu.url = "https://example.com/page";
            menu.open = true;
            tryCompare(findChild(menu, "siteMenu_back").parent.parent, "opacity", 1, 1000);
            tapEntry("back");                 // no history back: nothing
            verify(menu.open);
            compare(menu.actions.length, 0);
            tapEntry("forward");
            compare(menu.actions, ["forward"]);
            verify(!menu.open, "it closes after a choice");
            menu.open = true;
            wait(250);
            tapEntry("reload");
            compare(menu.actions, ["forward", "reload"]);
            menu.open = true;
            wait(250);
            tapEntry("copy");
            pasteTarget.text = "";
            pasteTarget.paste();
            compare(pasteTarget.text, "https://example.com/page");
            menu.open = true;
            wait(250);
            tapEntry("browser");
            compare(menu.actions, ["forward", "reload", "browser"]);
        }
    }
}
