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

    // The lowest maximizeProgress since it was reset (test_returnToTheCaller).
    property real lowestProgress: 1
    // While set, every frame of a maximize or minimize is checked with it
    // (test_backCardKeepsItsPlaceInTheStack): polling can miss the frames
    // in the middle of a 300 ms animation on a slow machine.
    property var onProgress: null
    Connections {
        target: shell.cardView
        function onMaximizeProgressChanged() {
            root.lowestProgress = Math.min(root.lowestProgress, shell.cardView.maximizeProgress);
            if (root.onProgress)
                root.onProgress(shell.cardView.maximizeProgress);
        }
    }

    TestCase {
        name: "Stacks"
        when: windowShown

        property var cv: shell.cardView

        function init() {
            root.onProgress = null;
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

        // The fan's tilt and drop are the original's at the devices' sizes
        // (a Pre's 320 px card), and do not grow past a Pre 3's on its side
        // in a phone layout as wide as a tablet (phoenix-sim --phone,
        // resized: the next card was turned 16 degrees, the owner, 10
        // October 2026).
        function test_fanTiltAtDeviceSizesAndCappedWide() {
            function fan(cardWidth, maxCardWidth) {
                var p = { viewWidth: cardWidth, cardWidth: cardWidth, cardHeight: 480, u: 1,
                          activeScale: 0.6, nonActiveScale: 0.5, groupingFactor: 1, rotFactor: 30, gap: 0,
                          maxCardWidth: maxCardWidth, position: 0, fan: { g: 0 }, focus: {}, maximize: 0,
                          originY: 240, maximizedCenterY: 240 };
                return CardLayout.compute([{ id: "g", uids: ["a", "b", "c"] }], p).cards;
            }
            // A Pre: as the formula, x / (activeScale * rotFactor).
            var pre = fan(320, 533);
            var x = pre.b.cx - pre.a.cx;
            fuzzyCompare(pre.b.rot - pre.a.rot, x / (0.6 * 30), 0.001);
            verify(Math.abs(pre.b.rot) < 5, "a few degrees: " + pre.b.rot);
            // 1426 px wide: the cards as far apart, the tilt no more than a
            // 533 px card's.
            var wide = fan(1426, 533);
            var capped = fan(533, 533);
            verify(wide.b.cx - wide.a.cx > x, "the cards keep their (wider) places");
            fuzzyCompare(wide.b.rot, capped.b.rot, 0.001);
            fuzzyCompare(wide.c.rot, capped.c.rot, 0.001);
            verify(Math.abs(wide.c.rot) < 15, "the third card: " + wide.c.rot);
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

        // C5: a finger moving dx px over ms milliseconds, in steps, on the
        // card view's flick clock.
        property real fakeTime: 0
        function swipe(x0, y, dx, ms) {
            cv.clock = function () { return fakeTime; };
            mousePress(cv, x0, y);
            var steps = 6;
            for (var i = 1; i <= steps; ++i) {
                fakeTime += ms / steps;
                mouseMove(cv, x0 + dx * i / steps, y);
            }
            mouseRelease(cv, x0 + dx, y);
            cv.clock = function () { return Date.now(); };
        }

        // A flick (the whole gesture's average 2.5-11 px/ms) moves one
        // stack from where it began; the same distance slowly snaps back.
        function test_flickBetweenStacks() {
            makeStacks();
            cv.jumpTo(0);
            var y = cv.cardOriginY;
            // 70 px in ~20 ms: 3.5 px/ms.
            swipe(250, y, -70, 20);
            tryCompare(cv, "position", 1, 2000);
            // 70 px in ~700 ms: 0.1 px/ms, not a flick: back to stack 1.
            swipe(250, y, -70, 700);
            tryCompare(cv, "position", 1, 2000);
            // Faster than 11 px/ms is not a flick either: 80 px in 5 ms.
            swipe(250, y, -80, 5);
            tryCompare(cv, "position", 1, 2000);
        }

        // In a long fan a drag moves three positions per unscaled card
        // width, and a flick there carries the fan on (CardGroup::flick).
        function test_fanDragAndFlick() {
            var first = windows.launch("org.webosphoenix.email", "");
            for (var i = 0; i < 5; ++i)
                windows.openChild(first);
            wait(50);
            cv.jumpTo(0);
            var gid = cv.groups[0].id;
            compare(cv.fanPositions[gid] === undefined ? 3 : cv.fanPositions[gid], 3);
            var y = cv.cardOriginY;
            // A slow drag right of a third of a card's width: one position.
            swipe(100, y, cv.windowWidth / 3, 600);
            fuzzyCompare(cv.fanPositions[gid], 2, 0.05);
            compare(cv.position, 0);
            // A flick right at 4 px/ms: 40 px of drag, then 0.4 more.
            swipe(100, y, 40, 10);
            fuzzyCompare(cv.fanPositions[gid], 2 - 40 / (cv.windowWidth / 3) - 0.4, 0.05);
            compare(cv.position, 0);
        }

        // A finger moving through a long fan sends its cards to their new
        // places over 200 ms OutCubic on each move (adjustHorizontally, then
        // slideAllGroups -> CardGroup::animateOpen(200, OutCubic),
        // CardWindowManager.cpp:1482-1490, 2495): the cards ease after the
        // finger. Once the fan is at its end the stacks follow the finger
        // directly (slideAllGroupsOnTouchUpdate).
        function test_fanEasesAfterTheFinger() {
            var first = windows.launch("org.webosphoenix.email", "");
            for (var i = 0; i < 5; ++i)
                windows.openChild(first);
            wait(50);
            cv.jumpTo(0);
            wait(50);
            var uid = cv.groups[0].uids[3];
            var card = cv.cardItem(uid);
            var y = cv.cardOriginY;
            mousePress(cv, 60, y);
            mouseMove(cv, 60 + Theme.tapRadius + 2, y);
            // Each move restarts the 200 ms ease from where the card is.
            var steps = 0;
            var lag = 0;
            for (var k = 1; k <= 4; ++k) {
                var before = card.x;
                mouseMove(cv, 60 + Theme.tapRadius + 2 + 12 * k, y);
                compare(cv.layoutAnimationDuration, Theme.cardFanDuration, "a move in the fan eases");
                var target = cv.layout.cards[uid].cx - card.width / 2;
                if (Math.abs(target - before) > 1) {
                    steps++;
                    // Not there on the move itself: it eases after it.
                    if (Math.abs(card.x - target) > 0.5)
                        lag++;
                }
                wait(20);
            }
            verify(steps > 0, "the fan moved");
            compare(lag, steps, "the cards ease after the finger, not jump with it");
            var last = cv.layout.cards[uid].cx - card.width / 2;
            tryVerify(function () { return Math.abs(card.x - last) < 0.5; }, 1000, "and arrive");
            // On to the end of the fan and beyond: the stacks themselves now
            // follow the finger, at once.
            for (k = 1; k <= 30 && cv.position === 0; ++k)
                mouseMove(cv, 60 + Theme.tapRadius + 2 + 48 + 25 * k, y);
            verify(cv.position < 0, "past the fan's end the stack pans (rubber band)");
            compare(cv.layoutAnimationDuration, 0, "following the finger directly");
            mouseRelease(cv, 300, y);
            tryCompare(cv, "position", 0, 2000);
        }

        // On a minimize the stack in front's own cards go to their places in
        // the fan over 200 ms OutCubic, while the stacks slide over 300 ms
        // OutQuart (minimizeActiveWindow -> slideAllGroups: animateOpen(200,
        // OutCubic) for the active group, cardSlide for the groups' x;
        // CardWindowManager.cpp:1142-1160, 2481-2537): the card is in its
        // place in the fan before the neighbouring stacks are.
        function test_minimizeFansTheStackOnItsOwnClock() {
            var s = makeStacks();
            cv.maximize(s.c1);
            tryVerify(function () { return shell.maximized; }, 2000);
            var settledEarly = false, ahead = true, frames = 0;
            var check = function () {
                if (!cv._stackOwn)
                    return;
                frames++;
                // OutCubic over 200 ms is ahead of OutQuart over 300 ms all
                // the way (the same start): never further from card view.
                if (cv.stackProgress > cv.maximizeProgress + 0.02)
                    ahead = false;
                if (cv.stackProgress === 0 && cv.maximizeProgress > 0) {
                    settledEarly = true;
                    // The card is in its fan place: card view's scale, level
                    // with the stack.
                    fuzzyCompare(cv.layout.cards[s.c1].scale, cv.activeScale, 0.0001);
                    fuzzyCompare(cv.layout.cards[s.c1].cy, cv.cardOriginY + Math.max(0, (cv.layout.cards[s.c1].cx - cv.width / 2)) / 15, 1);
                }
            };
            root.onProgress = check;
            cv.minimize();
            tryVerify(function () { return cv.maximizeProgress === 0; }, 2000);
            root.onProgress = null;
            verify(frames > 0, "frames of the minimize");
            verify(ahead, "the stack's cards ahead of the slide");
            verify(settledEarly, "the stack in its fan while the slide goes on");
            tryCompare(cv, "_stackOwn", false, 1000);
            // A maximize that takes over a minimize carries the stack on
            // from where it is (no jump back to the slide's progress).
            // (The moment is caught on the frame it comes, not by polling:
            // the window is about 100 ms, which a slow machine's polls miss.)
            cv.maximize(s.c1);
            tryVerify(function () { return shell.maximized; }, 2000);
            var startCx = NaN, jump = NaN;
            root.onProgress = function () {
                if (!isNaN(startCx) || !(cv.stackProgress < 0.5 && cv.maximizeProgress > 0.1))
                    return;
                startCx = cv.layout.cards[s.c1].cx;
                cv.maximize(s.c1);
                jump = Math.abs(cv.layout.cards[s.c1].cx - startCx);
            };
            cv.minimize();
            tryVerify(function () { return !isNaN(jump); }, 2000, "the minimize reached the stack's half while the slide went on");
            root.onProgress = null;
            verify(jump < 1, "the card carries on from where it is (" + jump + ")");
            tryVerify(function () { return shell.maximized; }, 2000);
            fuzzyCompare(cv.layout.cards[s.c1].scale, 1, 0.0001);
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

        // A card from the back of a stack keeps its place in the stack's
        // order while it maximizes and minimizes (z is CardGroup's list
        // order, raiseCards; nothing in lunaui/cards changes z): the cards
        // in front stay over it as they slide off and back. It was lifted
        // above them while maximized and dropped behind as the minimize
        // ended, which looked like it dissolved through the card in front.
        function test_backCardKeepsItsPlaceInTheStack() {
            var s = makeStacks();
            var z = function (uid) { return cv.layout.cards[uid].z; };
            var below = z(s.c1) < z(s.c2) && z(s.msg) < z(s.c1);
            verify(below, "front to back: c2, c1, msg");
            // Every frame between card view and maximized: under the card
            // in front.
            var frames = 0, over = 0;
            root.onProgress = function (p) {
                if (p > 0 && p < 1) {
                    frames++;
                    if (!(z(s.c1) < z(s.c2)))
                        over++;
                }
            };
            cv.maximize(s.c1);
            tryVerify(function () { return shell.maximized; }, 2000);
            root.onProgress = null;
            verify(frames > 0, "maximizing: frames between card view and maximized");
            compare(over, 0, "maximizing: still under the card in front");
            verify(z(s.c1) < z(s.c2) && z(s.msg) < z(s.c1), "maximized: the same order");
            // The card in front sits level, at the maximized card's height,
            // off to the right (CardGroup.cpp:344-370).
            compare(cv.layout.cards[s.c2].rot, 0);
            fuzzyCompare(cv.layout.cards[s.c2].cy, cv.maximizedCenterY, 0.5);
            var before = z(s.c1);
            var moved = 0;
            root.onProgress = function () { if (z(s.c1) !== before) moved++; };
            cv.minimize();
            tryVerify(function () { return cv.maximizeProgress === 0; }, 2000);
            root.onProgress = null;
            compare(moved, 0, "minimizing: no change in z on any frame");
            compare(z(s.c1), before, "minimized: no change in z");
            compare(uidsOf(1), [s.msg, s.c1, s.c2].join(","));
        }

        // A maximized card its app closes slides straight up off the top at
        // full size (removeWindowNoModality, CardWindowManager.cpp:672-696)
        // while the rest go back to card view: its stack's other cards over
        // 200 ms from where they were, the card behind it now the stack's
        // active card (CardGroup::removeFromGroup); nothing re-maximizes for
        // a card nobody launched.
        function test_maximizedCardFliesOffTheTop() {
            var s = makeStacks();
            cv.maximize(s.c2);
            tryVerify(function () { return shell.maximized; }, 2000);
            var card = cv.cardItem(s.c2);
            var cx = card.centerX;
            var frames = 0, bad = 0, lastOffset = 0, rose = 0;
            var watch = function () {
                frames++;
                if (card.scale !== 1 || card.centerX !== cx || card.opacity !== 1)
                    bad++;
                if (card.flickOffset > lastOffset)
                    rose++;
                lastOffset = card.flickOffset;
            };
            card.flickOffsetChanged.connect(watch);
            windows.cardCloseRequested(s.c2);
            compare(cv.maximizeProgress, 0, "back to card view");
            compare(cv.currentUid, s.c1, "the card behind it is in front of its stack");
            compare(cv.cardItem(s.c1).layoutAnimationDuration, Theme.cardFanDuration, "its stack eases into the fan over 200 ms");
            compare(cv.cardItem(s.email).layoutAnimationDuration, Theme.cardSlideDuration, "the other stacks slide over 300 ms");
            verify(card.z > cv.cardItem(s.c1).z, "over the rest while it goes");
            tryVerify(function () { return windows.cardIndex(s.c2) < 0; }, 2000, "closed once off the top");
            verify(frames > 2, "frames of the slide");
            compare(bad, 0, "full size, straight up, not faded");
            compare(rose, 0, "only up");
            wait(Theme.cardSlideDuration + 100);
            verify(!shell.maximized, "stays in card view");
            compare(cv.restoreUid, "");
        }

        // A card the app in front launched joins its stack (C8); when the app
        // closes it while it is maximized, card view settles and then the
        // card that launched it maximizes again (restoreCardToMaximized,
        // CardWindowManager.cpp:561-568, 2812-2821;
        // MinimizeState::animationsFinished, CardWindowManagerStates.cpp:
        // 158-165).
        function test_closedChildReMaximizesItsLauncher() {
            var a = windows.launch("org.webosphoenix.messaging", "");
            wait(0);
            cv.maximize(a);
            tryVerify(function () { return shell.maximized; }, 2000);
            windows._hostMessage("org.webosphoenix.messaging", a, "launch", { id: "org.webosphoenix.photos" });
            var ph = windows.runningUid("org.webosphoenix.photos");
            tryVerify(function () { return shell.maximized && cv.currentUid === ph; }, 3000, "Photos maximized");
            compare(cv.restoreUid, a, "launched by the card in front, in its stack");
            root.lowestProgress = 1;
            var restoredAt = -1, closedAt = Date.now();
            var watch = function () { if (restoredAt < 0 && cv.maximizeProgress > 0) restoredAt = Date.now() - closedAt; };
            cv.maximizeProgressChanged.connect(watch);
            windows.cardCloseRequested(ph);
            tryVerify(function () { return shell.maximized && cv.currentUid === a; }, 3000, "the launcher maximized again");
            cv.maximizeProgressChanged.disconnect(watch);
            compare(root.lowestProgress, 0, "through card view");
            verify(restoredAt >= Theme.cardSlideDuration * 0.95, "once card view settled (" + restoredAt + " ms)");
            compare(cv.restoreUid, "");
            compare(windows.cardIndex(ph), -1);

            // Minimized by the user first: no restore (minimizeActiveWindow
            // -> disableCardRestoreToMaximized, :1144).
            windows._hostMessage("org.webosphoenix.messaging", a, "launch", { id: "org.webosphoenix.photos" });
            ph = windows.runningUid("org.webosphoenix.photos");
            tryVerify(function () { return shell.maximized && cv.currentUid === ph; }, 3000);
            compare(cv.restoreUid, a);
            cv.minimize();
            compare(cv.restoreUid, "");
            tryCompare(cv, "maximizeProgress", 0, 2000);
            cv.maximize(ph);
            tryVerify(function () { return shell.maximized; }, 2000);
            windows.cardCloseRequested(ph);
            wait(Theme.cardSlideDuration + 300);
            verify(!shell.maximized, "stays in card view");
            compare(cv.currentUid, a);
        }

        // Back in an app another one opened (the window source's
        // cardReturnRequested): the app's card goes back into card view, the
        // card that opened it maximizes again with the app sliding off over
        // it, and then the app is behind it in the stack, still open.
        function test_returnToTheCaller() {
            var a = windows.launch("org.webosphoenix.messaging", "");
            wait(0);
            cv.maximize(a);
            tryVerify(function () { return shell.maximized; }, 2000, "the caller maximized");
            windows._hostMessage("org.webosphoenix.messaging", a, "launch", { id: "org.webosphoenix.photos" });
            var ph = windows.runningUid("org.webosphoenix.photos");
            verify(ph !== "");
            tryVerify(function () { return shell.maximized && cv.currentUid === ph; }, 3000, "Photos maximized");
            compare(cv.groups[0].uids.join(","), [a, ph].join(","), "Photos in front of the card that opened it");
            root.lowestProgress = 1;
            windows._hostMessage("org.webosphoenix.photos", ph, "launch", { id: "org.webosphoenix.messaging", params: {}, returnTo: true });
            // Card view first...
            // ...then the caller maximized, Photos sliding off over it. (Card
            // view lasts a moment: the lowest progress on the way tells.)
            tryVerify(function () { return shell.maximized && cv.currentUid === a; }, 2000, "the caller maximized again");
            compare(root.lowestProgress, 0, "through card view");
            verify(windows.cardIndex(ph) >= 0, "Photos still open");
            tryCompare(cv, "_returning", null, 2000);
            compare(cv.groups[0].uids.join(","), [ph, a].join(","), "and behind the caller in the stack");
        }
    }
}
