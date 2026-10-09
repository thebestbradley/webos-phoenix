// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim's Incoming Call (F4; SimWindowSource.simulateIncomingCall):
// Phone is a launch-at-boot app, its page running without a card from the
// start (parked). The call goes to that page, which raises the
// incoming-call alert; it had launched Phone instead (its card came up)
// and waited for a load that had long happened, so no call came in.

import QtQuick
import QtTest
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    SimWindowSource { id: windows }

    // Stands in for Phone's page started at boot.
    QtObject {
        id: phonePage
        property var ran: []
        readonly property var view: ({ loading: false })
        function runScript(js, done) { ran = ran.concat([js]); if (done) done(null); }
    }

    TestCase {
        name: "SimIncomingCall"
        when: windowShown

        function test_theCallGoesToPhonesBootPage() {
            // A web app, as with the simulator's rootfs.
            for (var i = 0; i < windows.apps.count; ++i)
                if (windows.apps.get(i).appId === windows.phoneAppId)
                    windows.apps.setProperty(i, "web", true);
            var w = windows._windows;
            w["w900"] = phonePage;
            windows._windows = w;
            windows._parked = { "w900": { appId: windows.phoneAppId, title: "Phone", orientation: "" } };
            var cards = windows.cards.count;
            windows.simulateIncomingCall();
            compare(phonePage.ran.length, 1, "the call reaches the page at once");
            verify(/simulateIncomingCall\(\)/.test(phonePage.ran[0]));
            compare(windows.cards.count, cards, "no card: Phone's alert comes up, its card only on Answer");
            compare(windows.runningUid(windows.phoneAppId), "");
        }
    }
}
