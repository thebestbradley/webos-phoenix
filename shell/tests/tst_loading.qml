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
            var loading = null;
            // The CardLoading child of the content host.
            for (var i = 0; i < card.children.length && !loading; ++i)
                for (var j = 0; j < card.children[i].children.length; ++j)
                    if (card.children[i].children[j].hasOwnProperty("active")) {
                        loading = card.children[i].children[j];
                        break;
                    }
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
