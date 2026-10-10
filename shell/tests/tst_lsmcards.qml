// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device window source's decisions (Phoenix.Lsm LsmCards.js), driven
// with the window properties WebAppMgr and phoenix-runtime.js set on a card's
// surface: the card's fields, where a new card goes (launchingAppId,
// CardWindowManager::prepareAddWindowSibling) and what Back does
// (_WEBOS_ACCESS_POLICY_KEYS_BACK, phoenixReturnTo). LsmWindowSource itself
// needs luna-surfacemanager's QML modules, which only a device has.

import QtQuick
import QtTest
import "../qml/Phoenix/Lsm/LsmCards.js" as LsmCards

TestCase {
    name: "LsmCards"

    // What WebAppMgr sets on a web app's surface (web_app_wayland.cc:212-227).
    function wam(extra) {
        var p = { appId: "org.webosphoenix.photos", instanceId: "1", launchingAppId: "org.webosphoenix.assistant",
                  title: "Photos", _WEBOS_WINDOW_CLASS: "0", _WEBOS_ACCESS_POLICY_KEYS_BACK: "true",
                  _WEBOS_ACCESS_POLICY_KEYS_EXIT: "false" };
        for (var k in extra || {})
            p[k] = extra[k];
        return p;
    }

    function test_fieldsWithoutRequests() {
        var f = LsmCards.cardFields(wam());
        compare(f.fullScreen, false);
        compare(f.statusBarColor, -1);
        compare(f.orientation, "free");
        compare(f.blockScreenTimeout, false);
        compare(f.launchingAppId, "org.webosphoenix.assistant");
        compare(f.returnTo, "");
        compare(f.backPolicy, "page");
        compare(f.back, "");
        // No properties at all (not a web app): the same defaults.
        compare(LsmCards.cardFields(undefined).orientation, "free");
        compare(LsmCards.cardFields({}).backPolicy, "page");
    }

    function test_fieldsFromTheRuntime() {
        var f = LsmCards.cardFields(wam({ phoenixFullScreen: "true", phoenixStatusBarColor: String(0x336699),
                                          phoenixOrientation: "landscape", phoenixBlockScreenTimeout: "true",
                                          phoenixReturnTo: "org.webosphoenix.assistant", phoenixBack: "17-1" }));
        compare(f.fullScreen, true);
        compare(f.statusBarColor, 0x336699);
        compare(f.orientation, "landscape");
        compare(f.blockScreenTimeout, true);
        compare(f.returnTo, "org.webosphoenix.assistant");
        compare(f.back, "17-1");
        // Typed values too, and the colour's other spellings.
        compare(LsmCards.cardFields({ phoenixFullScreen: true }).fullScreen, true);
        compare(LsmCards.color("#ff8000"), 0xff8000);
        compare(LsmCards.color("0x0000ff"), 0x0000ff);
        compare(LsmCards.color(0x1000000 + 0x123456), 0x123456);
        compare(LsmCards.color("blue"), -1);
        compare(LsmCards.color(""), -1);
        compare(LsmCards.orientation("Portrait"), "portrait");
        compare(LsmCards.orientation("diagonal"), "free");
    }

    function cardsOf(list) {
        return list.map(function(c) { return { uid: c[0], appId: c[1], groupId: c[2] }; });
    }

    // CardWindowManager.cpp:556-578.
    function test_placement() {
        var cards = cardsOf([["s1", "org.webosphoenix.email", "g1"], ["s2", "org.webosphoenix.music", "g2"],
                             ["s3", "org.webosphoenix.memos", "g3"], ["s4", "org.webosphoenix.memos.x", "g3"]]);
        // Launched by the card in front (Email): joins Email's stack, at its front.
        var p = LsmCards.placement(cards, "com.palm.app.browser", "org.webosphoenix.email", "s1", "");
        compare(p.at, 1);
        compare(p.groupOf, "s1");
        // Launched by Email while Music is in front: a new stack right of
        // where the shell launched from (none: at the end).
        p = LsmCards.placement(cards, "com.palm.app.browser", "org.webosphoenix.email", "s2", "");
        compare(p.groupOf, "");
        compare(p.at, 4);
        // In card view nothing is focused: new stack right of afterUid's.
        p = LsmCards.placement(cards, "com.palm.app.browser", "org.webosphoenix.email", "", "s3");
        compare(p.groupOf, "");
        compare(p.at, 4);
        p = LsmCards.placement(cards, "com.palm.app.browser", "", "", "s1");
        compare(p.at, 1);
        compare(p.groupOf, "");
        // The shell (luna-surfacemanager) launching is not an app's launch.
        p = LsmCards.placement(cards, "com.palm.app.browser", "com.webos.surfacemanager", "s1", "");
        compare(p.groupOf, "");
        // A further window of an app: its stack, after the stack's last card.
        p = LsmCards.placement(cards, "org.webosphoenix.memos", "", "s1", "");
        compare(p.groupOf, "s3");
        compare(p.at, 4);
    }

    function test_back() {
        // The page takes Back: the key goes to it.
        var f = LsmCards.cardFields(wam());
        compare(LsmCards.backAction(f, "org.webosphoenix.photos", "s1"), "key");
        // WebAppMgr: the page cannot take it ("LSM should handle it").
        f = LsmCards.cardFields(wam({ _WEBOS_ACCESS_POLICY_KEYS_BACK: "false" }));
        compare(LsmCards.backAction(f, "org.webosphoenix.photos", ""), "minimize");
        // ... and it was opened {returnToCaller}, its caller still running.
        f = LsmCards.cardFields(wam({ _WEBOS_ACCESS_POLICY_KEYS_BACK: "false", phoenixReturnTo: "org.webosphoenix.assistant" }));
        compare(LsmCards.backAction(f, "org.webosphoenix.photos", "s1"), "return");
        // The caller has gone: minimize.
        compare(LsmCards.backAction(f, "org.webosphoenix.photos", ""), "minimize");
        // A Back the page did not take (phoenixBack): the same choice.
        f = LsmCards.cardFields(wam({ phoenixReturnTo: "org.webosphoenix.assistant", phoenixBack: "1" }));
        compare(LsmCards.unhandledBack(f, "org.webosphoenix.photos", "s1"), "return");
        f = LsmCards.cardFields(wam({ phoenixBack: "1" }));
        compare(LsmCards.unhandledBack(f, "org.webosphoenix.photos", "s1"), "minimize");
        // An app is not its own caller, nor is the launcher.
        f = LsmCards.cardFields(wam({ phoenixReturnTo: "org.webosphoenix.photos" }));
        compare(LsmCards.unhandledBack(f, "org.webosphoenix.photos", "s9"), "minimize");
        f = LsmCards.cardFields(wam({ phoenixReturnTo: "com.palm.launcher" }));
        compare(LsmCards.unhandledBack(f, "org.webosphoenix.photos", "s9"), "minimize");
    }
}
