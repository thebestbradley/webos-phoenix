// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Card stack (CardGroup) behaviour, checked against the rules ported from
// luna-sysmgr's CardGroup.cpp and CardWindowManager.cpp.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim
import "../qml/Phoenix/Shell/CardLayout.js" as CardLayout

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus {}
    }

    TestCase {
        name: "Stacks"
        when: windowShown

        property var cv: shell.cardView

        function init() {
            while (windows.cards.count > 0)
                windows.close(windows.cards.get(0).uid);
            cv.reorderUid = "";
            cv.jumpTo(0);
            shell.unlock();
        }

        // email | messaging, child, child | calendar ; showing the messaging stack
        function makeStacks() {
            var e = windows.launch("org.webosphoenix.email", "");
            var m = windows.launch("org.webosphoenix.messaging", e);
            windows.launch("org.webosphoenix.calendar", m);
            var c1 = windows.openChild(m);
            var c2 = windows.openChild(m);
            wait(0);
            cv.jumpTo(1);
            return { email: e, msg: m, c1: c1, c2: c2 };
        }

        function uidsOf(g) { return cv.groups[g].uids.join(","); }

        function test_fanClamp() {
            compare(CardLayout.clampFanPosition(5, 1), 0);
            compare(CardLayout.clampFanPosition(5, 2), 0.5);
            compare(CardLayout.clampFanPosition(0, 3), 1);
            compare(CardLayout.clampFanPosition(9, 4), 1);
            compare(CardLayout.clampFanPosition(9, 7), 4);
            compare(CardLayout.clampFanPosition(0, 7), 1);
        }

        function test_childJoinsParentStack() {
            var s = makeStacks();
            compare(cv.groupCount, 3);
            compare(uidsOf(1), [s.msg, s.c1, s.c2].join(","));
            // New app from the messaging stack: new stack to its right.
            var w = windows.launch("org.webosphoenix.browser", s.c2);
            compare(cv.groupCount, 4);
            compare(uidsOf(2), w);
        }

        // CardWindowManager.cpp:561-567: an app the card in front launches
        // joins that card's stack; from anywhere else it gets a stack of its own.
        function test_launchedByTheFrontCardJoinsItsStack() {
            var s = makeStacks();
            cv.maximize(s.c2);
            tryVerify(function() { return cv.maximized; }, 2000);
            compare(windows.focusedUid, s.c2);
            windows._hostMessage("org.webosphoenix.messaging", s.c2, "launch", { id: "org.webosphoenix.browser" });
            compare(cv.groupCount, 3);
            var uids = uidsOf(1).split(",");
            compare(uids.length, 4);
            compare(windows.cards.get(windows.cardIndex(uids[3])).appId, "org.webosphoenix.browser");
            // Not in front: a stack of its own.
            cv.jumpTo(0);
            compare(windows.focusedUid, "");
            windows._hostMessage("org.webosphoenix.messaging", s.c1, "launch", { id: "org.webosphoenix.memos" });
            compare(cv.groupCount, 4);
        }

        function test_childIsFocusedAndMaximized() {
            var e = windows.launch("org.webosphoenix.email", "");
            var c = windows.openChild(e);
            tryVerify(function() { return shell.maximized; }, 2000);
            compare(cv.currentUid, c);
        }

        function test_fanGeometry() {
            var e = windows.launch("org.webosphoenix.email", "");
            var c = windows.openChild(e);
            wait(0);
            cv.jumpTo(0);
            var a = cv.layout.cards[e], b = cv.layout.cards[c];
            // Two cards: fan position 0.5, offsets -/+ aw/6.
            var aw = cv.windowWidth * cv.activeScale;
            fuzzyCompare(b.cx - a.cx, aw / 3, 0.01);
            // Only the right card drops (x/15, CardGroup.cpp:724); both tilt,
            // in opposite directions (CardGroup.cpp:713,725).
            fuzzyCompare(a.cy, cv.cardOriginY, 0.01);
            fuzzyCompare(b.cy - a.cy, (aw / 6) / 15, 0.01);
            verify(b.rot > 0);
            fuzzyCompare(a.rot, -b.rot, 0.0001);
            verify(b.z > a.z);
        }

        // A stack more than an active card's width from the centre is
        // folded: CardGroup::calculateOpenedPositions(xOffset) with
        // max(1, aw - |x|) / aw open, its cards 10 px apart, at the small
        // scale, flat (slideAllGroups' animateClose, CardGroup.cpp:698-742).
        function test_restingStackFoldsTenPixelSteps() {
            var s = makeStacks();
            cv.jumpTo(0);
            var p0 = cv.layout.cards[s.msg], p1 = cv.layout.cards[s.c1], p2 = cv.layout.cards[s.c2];
            var aw = cv.windowWidth * cv.activeScale;
            var amt = 1 / aw;
            fuzzyCompare(p0.scale, cv.nonActiveScale + (cv.activeScale - cv.nonActiveScale) * amt, 0.0001);
            verify(Math.abs(p1.cx - p0.cx - 10) < 1);
            verify(Math.abs(p2.cx - p1.cx - 10) < 1);
            verify(Math.abs(p0.rot) < 0.1);
            compare(p0.cy, cv.cardOriginY);
        }

        // Dragging toward a stack opens it as its centre nears the
        // screen's, and folds the one it leaves (C10).
        function test_stacksOpenByTheirDistanceFromTheCentre() {
            var s = makeStacks();
            cv.jumpTo(0);
            var gap0 = cv.layout.cards[s.c1].cx - cv.layout.cards[s.msg].cx;
            cv.position = 0.5;
            var gapHalf = cv.layout.cards[s.c1].cx - cv.layout.cards[s.msg].cx;
            cv.position = 1;
            var gap1 = cv.layout.cards[s.c1].cx - cv.layout.cards[s.msg].cx;
            verify(gap0 < gapHalf && gapHalf < gap1, gap0 + " " + gapHalf + " " + gap1);
            // Open at the centre: the opened fan's own spacing.
            fuzzyCompare(cv.layout.cards[s.msg].scale, cv.activeScale, 0.0001);
        }

        function test_closeInStackKeepsStack() {
            var s = makeStacks();
            cv.setFocus(s.c2);
            cv.close(s.c2);
            compare(cv.groupCount, 3);
            compare(cv.position, 1);
            compare(cv.currentUid, s.c1);
        }

        function test_tapOtherStackSlidesToIt() {
            var s = makeStacks();
            cv.jumpTo(0);
            var p = cv.layout.cards[s.msg];
            // Anywhere right of the open stack switches to the next one.
            mouseClick(cv, cv.width - 5, cv.cardOriginY);
            tryCompare(cv, "position", 1, 2000);
            verify(!shell.maximized);
        }

        function test_reorderOutOfStackThenIntoNext() {
            var s = makeStacks();
            // Lift the top card of the messaging stack.
            cv.setFocus(s.c2);
            var p = cv.layout.cards[s.c2];
            cv.enterReorder(s.c2, p.cx, p.cy);
            // Into the right edge zone: leaves the stack as its own stack.
            cv.moveReorder(cv.width - 2, p.cy);
            compare(cv.groupCount, 4);
            compare(uidsOf(1), [s.msg, s.c1].join(","));
            compare(uidsOf(2), s.c2);
            // Held there: after the animation it joins the calendar stack at its back.
            tryCompare(cv, "groupCount", 3, 2000);
            compare(cv.groups[2].uids[0], s.c2);
            compare(cv.groups[2].uids.length, 2);
            cv.moveReorder(cv.width / 2, p.cy);
            cv.exitReorder();
            compare(cv.reorderUid, "");
        }

        function test_reorderLeftFromBottomCreatesStackOnLeft() {
            var s = makeStacks();
            cv.setFocus(s.msg);
            var p = cv.layout.cards[s.msg];
            cv.enterReorder(s.msg, p.cx, p.cy);
            cv.moveReorder(2, p.cy);
            compare(cv.groupCount, 4);
            compare(uidsOf(1), s.msg);
            compare(uidsOf(2), [s.c1, s.c2].join(","));
            cv.exitReorder();
        }

        function test_reorderShufflesWithinStack() {
            var s = makeStacks();
            cv.setFocus(s.c2);
            var p = cv.layout.cards[s.c2];
            var left = cv.layout.cards[s.msg];
            cv.enterReorder(s.c2, p.cx, p.cy);
            // Past the bottom card, still in the centre zone.
            cv.moveReorder(Math.max(cv.width / 5 + 1, left.cx - 1), p.cy);
            compare(uidsOf(1), [s.c2, s.msg, s.c1].join(","));
            cv.exitReorder();
        }

        function test_pressAndHoldEntersReorder() {
            var s = makeStacks();
            var p = cv.layout.cards[cv.currentUid];
            mousePress(cv, p.cx, p.cy);
            tryVerify(function() { return cv.reorderUid !== ""; }, 2000);
            mouseMove(cv, p.cx + 5, p.cy + 5);
            mouseRelease(cv, p.cx + 5, p.cy + 5);
            compare(cv.reorderUid, "");
            verify(!shell.maximized);
        }

        function test_maximizeWithinStack() {
            var s = makeStacks();
            cv.maximize(s.c1);
            tryVerify(function() { return shell.maximized; }, 2000);
            compare(cv.currentUid, s.c1);
            var p = cv.layout.cards[s.c1];
            fuzzyCompare(p.scale, 1, 0.0001);
            // The other cards of the stack fly off either side.
            verify(cv.layout.cards[s.msg].cx < 0);
            verify(cv.layout.cards[s.c2].cx > cv.width);
        }
    }
}
