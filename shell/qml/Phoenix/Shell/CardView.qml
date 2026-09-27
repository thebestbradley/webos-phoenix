// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The webOS card view: running apps as a horizontal row of cards.
//
//  * swipe sideways to move between cards
//  * tap a card to maximize it
//  * flick a card up and off the screen to close the app
//
// Geometry follows Src/lunaui/cards/CardWindowManager.cpp: the focused card
// is drawn at the active scale, its neighbours at the non-active scale, and
// the row's centre sits cardOriginRatio of the way down the space below the
// search pill allowance. Maximizing is a single 0..1 progress value, so the
// neighbours are pushed off-screen by the growing card just as they were in
// the original.

import QtQuick

Item {
    id: view

    // Window source (see Phoenix.Sim.SimWindowSource for the interface).
    property var source
    readonly property int count: source ? source.cards.count : 0

    // Fractional index of the card at the centre of the screen.
    property real position: 0
    readonly property int currentIndex: Math.max(0, Math.min(count - 1, Math.round(position)))
    readonly property string currentUid: count > 0 ? source.cards.get(currentIndex).uid : ""
    readonly property string currentTitle: count > 0 ? source.cards.get(currentIndex).title : ""

    // 0 == card view, 1 == current card maximized.
    property real maximizeProgress: 0
    readonly property bool maximized: maximizeProgress === 1

    // Area a maximized window occupies.
    property real topInset: Theme.statusBarHeight
    property real bottomInset: Theme.gestureAreaHeight
    readonly property real windowWidth: width
    readonly property real windowHeight: height - topInset - bottomInset

    signal cardClosed(string uid)
    signal cardMaximized(string uid)
    signal cardMinimized(string uid)

    // ---- Layout -------------------------------------------------------------

    function mix(a, b, t) { return a + (b - a) * t }

    // CardWindowManager.cpp:2782-2786
    readonly property real baseActiveScale: Math.max(Theme.minimumCardScale,
        (windowHeight - Theme.searchPillAllowance) * Theme.activeCardRatio / windowHeight)
    readonly property real baseNonActiveScale: Math.max(Theme.minimumCardScale,
        (windowHeight - Theme.searchPillAllowance) * Theme.nonActiveCardRatio / windowHeight)
    readonly property real activeScale: mix(baseActiveScale, 1.0, maximizeProgress)
    readonly property real nonActiveScale: mix(baseNonActiveScale, 1.0, maximizeProgress)
    // Centre-to-centre distance between neighbouring cards.
    readonly property real spacing: windowWidth * (activeScale + nonActiveScale) / 2 + Theme.gapBetweenCards
    // CardWindowManager.cpp:287 / :2795 -- kWindowOrigin
    readonly property real cardOriginY: topInset + Theme.searchPillAllowance
                                        + (windowHeight - Theme.searchPillAllowance) * Theme.cardOriginRatio
    readonly property real maximizedCenterY: topInset + windowHeight / 2

    function scaleFor(index) {
        var d = Math.min(1, Math.abs(index - position));
        return mix(activeScale, nonActiveScale, d);
    }

    // ---- Public API -----------------------------------------------------------

    function indexOf(uid) {
        for (var i = 0; i < count; ++i)
            if (source.cards.get(i).uid === uid)
                return i;
        return -1;
    }

    function slideTo(index) {
        slideAnim.stop();
        slideAnim.to = Math.max(0, Math.min(count - 1, index));
        slideAnim.start();
    }

    function maximize(uid) {
        var i = uid !== undefined ? indexOf(uid) : currentIndex;
        if (i < 0)
            return;
        if (Math.abs(position - i) > 0.001)
            slideTo(i);
        maximizeAnim.stop();
        maximizeAnim.to = 1;
        maximizeAnim.duration = Theme.cardMaximizeDuration;
        maximizeAnim.start();
        cardMaximized(source.cards.get(i).uid);
    }

    function minimize() {
        if (count === 0)
            return;
        maximizeAnim.stop();
        maximizeAnim.to = 0;
        maximizeAnim.duration = Theme.cardMinimizeDuration;
        maximizeAnim.start();
        cardMinimized(currentUid);
    }

    // Show a freshly launched (or re-launched) card maximized.
    function focusLaunched(uid) {
        var i = indexOf(uid);
        if (i < 0)
            return;
        slideAnim.stop();
        position = i;
        maximizeAnim.stop();
        maximizeAnim.to = 1;
        maximizeAnim.duration = Theme.cardLaunchDuration;
        maximizeAnim.start();
        cardMaximized(uid);
    }

    function close(uid) {
        var i = indexOf(uid);
        if (i < 0)
            return;
        // Cards to the right of the closed one shuffle left (cardShuffleReorder).
        shuffleTimer.restart();
        view.shuffling = true;
        var wasLast = i === count - 1;
        source.close(uid);
        if (wasLast && position > 0)
            slideTo(count - 1);
        else if (i < position)
            position = Math.max(0, position - 1);
        if (count === 0)
            maximizeProgress = 0;
        cardClosed(uid);
    }

    // ---- Animations -------------------------------------------------------------

    NumberAnimation {
        id: slideAnim
        target: view; property: "position"
        duration: Theme.cardSlideDuration
        easing.type: Theme.cardEasing
    }

    NumberAnimation {
        id: maximizeAnim
        target: view; property: "maximizeProgress"
        easing.type: Theme.cardEasing
    }

    property bool shuffling: false
    Timer {
        id: shuffleTimer
        interval: Theme.cardShuffleReorderDuration
        onTriggered: view.shuffling = false
    }

    // ---- Cards ------------------------------------------------------------------

    Repeater {
        id: cards
        model: view.source ? view.source.cards : null

        delegate: Card {
            id: cardDelegate
            required property int index
            required property var model

            uid: model.uid
            title: model.title
            width: view.windowWidth
            height: view.windowHeight
            window: view.source.windowFor(uid)
            centerX: view.width / 2 + (index - view.position) * view.spacing
            centerY: view.mix(view.cardOriginY, view.maximizedCenterY, view.maximizeProgress)
            cardScale: view.scaleFor(index)
            rounded: view.maximizeProgress < 1
            interactive: view.maximized && index === view.currentIndex
            dimmed: index !== view.currentIndex
            shuffleAnimation: view.shuffling
            z: index === view.currentIndex ? 2 : 1
            visible: centerX + width * cardScale / 2 > -view.width
                     && centerX - width * cardScale / 2 < view.width * 2
        }
    }

    // ---- Touch handling in card view ------------------------------------------------

    MouseArea {
        id: touch
        anchors.fill: parent
        enabled: view.maximizeProgress === 0 && view.count > 0


        property real startX
        property real startY
        property real startPosition
        property string axis: ""          // "", "h" or "v"
        property int flickIndex: -1
        property real lastX
        property real lastY
        property real lastTime
        property real velocityX
        property real velocityY

        function cardAt(px, py) {
            for (var i = 0; i < cards.count; ++i) {
                var c = cards.itemAt(i);
                if (!c)
                    continue;
                var w = c.width * c.cardScale, h = c.height * c.cardScale;
                if (Math.abs(px - c.centerX) <= w / 2 && Math.abs(py - (c.centerY + c.flickOffset)) <= h / 2)
                    return i;
            }
            return -1;
        }

        onPressed: (mouse) => {
            slideAnim.stop();
            startX = lastX = mouse.x;
            startY = lastY = mouse.y;
            lastTime = Date.now();
            velocityX = velocityY = 0;
            startPosition = view.position;
            axis = "";
            flickIndex = cardAt(mouse.x, mouse.y);
        }

        onPositionChanged: (mouse) => {
            var now = Date.now(), dt = Math.max(1, now - lastTime);
            velocityX = (mouse.x - lastX) / dt;
            velocityY = (mouse.y - lastY) / dt;
            lastX = mouse.x; lastY = mouse.y; lastTime = now;

            var dx = mouse.x - startX, dy = mouse.y - startY;
            // Lock to an axis once outside the tap radius
            // (CardWindowManager.cpp:1464-1476).
            if (axis === "" && dx * dx + dy * dy > Theme.tapRadius * Theme.tapRadius) {
                if (Math.abs(dx) > Theme.horizontalLockRatio * Math.abs(dy))
                    axis = "h";
                else if (flickIndex >= 0)
                    axis = "v";
            }
            if (axis === "h") {
                var p = startPosition - dx / view.spacing;
                // Rubber-band past the ends.
                if (p < 0) p = p / 3;
                if (p > view.count - 1) p = (view.count - 1) + (p - (view.count - 1)) / 3;
                view.position = p;
            } else if (axis === "v") {
                var c = cards.itemAt(flickIndex);
                if (c)
                    c.flickOffset = dy < 0 ? dy : dy / 4;
            }
        }

        onReleased: (mouse) => {
            if (axis === "h") {
                // Carry momentum: a quick flick advances one card.
                var target = Math.round(view.position);
                if (Math.abs(velocityX) > 0.5 && target === Math.round(startPosition))
                    target += velocityX < 0 ? 1 : -1;
                view.slideTo(target);
            } else if (axis === "v") {
                var c = cards.itemAt(flickIndex);
                if (c) {
                    if (shouldClose(c.flickOffset, velocityY, c.height * c.cardScale))
                        throwAway(c);
                    else
                        springBack.startFor(c);
                }
            } else if (flickIndex >= 0) {
                view.maximize(view.source.cards.get(flickIndex).uid);
            }
            axis = "";
        }

        // CardWindowManager.cpp:1700-1708: far enough, fast enough, and faster
        // the shorter the drag. Dragging more than half the card off also
        // closes it (inferred), which makes mouse use in the simulator work.
        function shouldClose(dy, vy, cardHeight) {
            var u = Theme.u;
            var flicked = dy < -Theme.cardCloseMinDistance
                          && vy < -Theme.cardCloseMinVelocity
                          && vy < 550 * u * u / dy;
            return flicked || -dy > cardHeight / 2;
        }

        function throwAway(c) {
            throwAnim.card = c;
            throwAnim.to = -view.height;
            throwAnim.start();
        }
    }

    NumberAnimation {
        id: throwAnim
        property Item card
        target: card; property: "flickOffset"
        duration: Theme.cardDeleteDuration
        easing.type: Theme.cardDeleteEasing
        onFinished: if (card) view.close(card.uid)
    }

    NumberAnimation {
        id: springBack
        property: "flickOffset"
        to: 0
        duration: Theme.cardSlideDuration
        easing.type: Theme.cardEasing
        function startFor(c) { target = c; start(); }
    }
}
