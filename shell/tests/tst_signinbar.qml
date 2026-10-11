// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Sign In card's bar (Phoenix.Shell SignInBar): the host, the lock
// (closed and green for https only), Cancel.

import QtQuick
import QtTest
import Phoenix.Shell

Item {
    id: root
    width: 320
    height: 200

    SignInBar {
        id: bar
        width: root.width
        hostName: "accounts.example.com"
        secure: true
    }
    SignalSpy { id: cancelSpy; target: bar; signalName: "cancel" }

    TestCase {
        name: "SignInBar"
        when: windowShown

        function test_hostLockAndCancel() {
            compare(findChild(bar, "signInHost").text, "accounts.example.com");
            verify(findChild(bar, "signInLock").secure);
            bar.secure = false;
            verify(!findChild(bar, "signInLock").secure);
            // A long host keeps its end (the registrable domain) in view.
            bar.hostName = "a-very-long-subdomain.of-some-identity-provider.login.example.com";
            compare(findChild(bar, "signInHost").elide, Text.ElideLeft);
            verify(findChild(bar, "signInHost").width < bar.width);
            mouseClick(findChild(bar, "signInCancel"));
            compare(cancelSpy.count, 1);
        }
    }
}
