// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The loading card (CardLoading).
// Run: qmltestrunner -import qml -input tests

import QtQuick
import QtTest
import Phoenix.Shell

Item {
    id: root
    width: 320
    height: 480

    Item {
        id: app
        property bool ready: false
    }

    Card {
        id: card
        width: 320
        height: 452
        window: app
        icon: Qt.resolvedUrl("../assets/openwebos/loading-glow.png")
    }

    TestCase {
        name: "Loading"
        when: windowShown

        function test_coversTheAppUntilItIsReady() {
            verify(card.loading);
            // The CardLoading inside the card, over the app's window.
            function find(item) {
                for (var i = 0; i < item.children.length; ++i) {
                    var c = item.children[i];
                    if (c.hasOwnProperty("active"))
                        return c;
                    var f = find(c);
                    if (f)
                        return f;
                }
                return null;
            }
            var loading = find(card);
            verify(loading);
            compare(loading.opacity, 1);
            verify(loading.visible);
            app.ready = true;
            verify(!card.loading);
            // Cross-fades away over 300 ms.
            wait(100);
            verify(loading.opacity > 0 && loading.opacity < 1);
            tryCompare(loading, "visible", false, 1000);
        }

        function test_windowsWithoutReadyAreNotLoading() {
            card.window = null;
            verify(!card.loading);
        }
    }
}
