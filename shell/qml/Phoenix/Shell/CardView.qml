// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The webOS card view: running apps as cards, grouped into stacks.
//
//  * swipe sideways to move between stacks (and through long stacks)
//  * tap a card to maximize it
//  * flick a card up and off the screen to close it
//  * press and hold a card to lift it, then drag to reorder it within its
//    stack, or into the left/right edge of the screen to move it out of its
//    stack and into the neighbouring one
//
// Geometry lives in CardLayout.js, ported from Src/lunaui/cards/CardGroup.cpp
// and CardWindowManager.cpp. Stacks are runs of consecutive cards in
// source.cards that share a groupId. Maximizing is one 0..1 progress value,
// so the growing card pushes everything else off-screen as in the original.

import QtQuick
import "CardLayout.js" as CardLayout

Item {
    id: view

    // Window source (see Phoenix.Sim.SimWindowSource for the interface).
    property var source
    readonly property int count: source ? source.cards.count : 0

    // Fractional index of the stack at the centre of the screen.
    property real position: 0
    // Per-stack fan scroll position and active card, keyed by groupId.
    property var fanPositions: ({})
    property var groupFocus: ({})

    // 0 == card view, 1 == current card maximized.
    property real maximizeProgress: 0
    readonly property bool maximized: maximizeProgress === 1
    // The card in front asked for the whole screen (enableFullScreenMode).
    readonly property bool currentFullScreen: {
        revision;
        for (var i = 0; source && i < source.cards.count; ++i)
            if (source.cards.get(i).uid === currentUid)
                return source.cards.get(i).fullScreen === true;
        return false;
    }
    // On its way back to card view: gestures treat it as there already.
    readonly property bool minimizing: maximizeAnim.running && maximizeAnim.to === 0
    // On its way up to maximized (or waiting below the screen to rise).
    readonly property bool maximizing: (maximizeAnim.running && maximizeAnim.to === 1) || preparing
    // Cards are moving (CardWindowManager::okToResize: its animations,
    // CardWindowManager.cpp:257-262): the UI does not turn meanwhile.
    readonly property bool animating: slideAnim.running || maximizeAnim.running || layoutAnimTimer.running || preparing

    // How the UI is turned (UiRotation.uiOrientation) and whether it is
    // taller than wide: cards whose app asked for another orientation are
    // drawn turned (CardWindow::refreshAdjustmentAngle).
    property string uiOrientation: "up"
    property bool uiPortrait: height > width
    // The orientation the card's app asked for (PalmSystem.setWindowOrientation):
    // "free", "up", "down", "left", "right", "landscape" or "portrait".
    function orientationOf(uid) {
        var i = indexOf(uid);
        var o = i >= 0 ? source.cards.get(i).orientation : undefined;
        return o === undefined || o === null || o === "" ? "free" : o;
    }

    // Area a maximized window occupies.
    property real topInset: Theme.statusBarHeight
    property real bottomInset: Theme.gestureAreaHeight
    readonly property real windowWidth: width
    readonly property real windowHeight: height - topInset - bottomInset

    signal cardClosed(string uid)
    signal cardMaximized(string uid)
    signal cardMinimized(string uid)

    // ---- Stacks -------------------------------------------------------------------

    // Bumped whenever the card model changes so bindings re-read it.
    property int revision: 0
    Connections {
        target: view.source ? view.source.cards : null
        function onRowsInserted() { view.revision++; }
        function onRowsRemoved() { view._forgetClosed(); view.revision++; }
        function onRowsMoved() { view.revision++; }
        function onDataChanged() { view.revision++; }
        function onModelReset() { view._forgetClosed(); view.revision++; }
    }

    // Cards on their way off the top: uid -> where they were. They are out
    // of the layout already, so the rest close the gap while they fly.
    property var closing: ({})

    // [{ id, uids: [..], start }] in screen order.
    readonly property var groups: {
        revision;
        var list = [];
        var n = source ? source.cards.count : 0;
        for (var i = 0; i < n; ++i) {
            var c = source.cards.get(i);
            if (closing[c.uid])
                continue;
            if (list.length === 0 || list[list.length - 1].id !== c.groupId)
                list.push({ id: c.groupId, uids: [], start: i });
            list[list.length - 1].uids.push(c.uid);
        }
        return list;
    }
    readonly property int groupCount: groups.length
    readonly property int currentGroup: groupCount > 0 ? Math.max(0, Math.min(groupCount - 1, Math.round(position))) : -1

    function focusOf(group) {
        var f = groupFocus[group.id];
        return group.uids.indexOf(f) >= 0 ? f : group.uids[group.uids.length - 1];
    }

    readonly property string currentUid: currentGroup >= 0 ? focusOf(groups[currentGroup]) : ""
    readonly property string currentTitle: {
        revision;
        var i = indexOf(currentUid);
        return i >= 0 ? source.cards.get(i).title : "";
    }

    function groupIndexOf(uid) {
        for (var g = 0; g < groups.length; ++g)
            if (groups[g].uids.indexOf(uid) >= 0)
                return g;
        return -1;
    }

    function setFocus(uid) {
        var g = groupIndexOf(uid);
        if (g < 0)
            return;
        var f = Object.assign({}, groupFocus);
        f[groups[g].id] = uid;
        groupFocus = f;
    }

    // ---- Layout ---------------------------------------------------------------------

    function mix(a, b, t) { return a + (b - a) * t }

    // CardWindowManager.cpp:2782-2786
    readonly property real activeScale: Math.max(Theme.minimumCardScale,
        (windowHeight - Theme.searchPillAllowance) * Theme.activeCardRatio / windowHeight)
    readonly property real nonActiveScale: Math.max(Theme.minimumCardScale,
        (windowHeight - Theme.searchPillAllowance) * Theme.nonActiveCardRatio / windowHeight)
    // Kept under their old names for tests and callers.
    readonly property real baseActiveScale: activeScale
    readonly property real baseNonActiveScale: nonActiveScale
    // CardWindowManager.cpp:287 / :2795 -- kWindowOrigin
    readonly property real cardOriginY: topInset + Theme.searchPillAllowance
                                        + (windowHeight - Theme.searchPillAllowance) * Theme.cardOriginRatio
    readonly property real maximizedCenterY: topInset + windowHeight / 2

    readonly property var layout: CardLayout.compute(groups, {
        viewWidth: width,
        cardWidth: windowWidth,
        cardHeight: windowHeight,
        u: Theme.u,
        activeScale: activeScale,
        nonActiveScale: nonActiveScale,
        groupingFactor: Theme.cardGroupingXDistanceFactor,
        rotFactor: Theme.cardGroupRotFactor,
        gap: Theme.gapBetweenCards,
        position: position,
        fan: fanPositions,
        focus: groupFocus,
        maximize: maximizeProgress,
        originY: cardOriginY,
        maximizedCenterY: maximizedCenterY
    })

    // Screen distance between the current stack and the next (for drags).
    function groupSpacing() {
        var a = layout.anchors;
        if (a.length < 2)
            return width;
        var g = Math.max(0, Math.min(a.length - 2, Math.floor(position)));
        return Math.max(1, a[g + 1] - a[g]);
    }

    // Discrete layout changes (close, reorder) animate; drags don't.
    property int layoutAnimationDuration: 0
    function animateLayout(duration) {
        layoutAnimationDuration = duration;
        layoutAnimTimer.interval = duration;
        layoutAnimTimer.restart();
    }
    Timer {
        id: layoutAnimTimer
        onTriggered: view.layoutAnimationDuration = 0
    }

    // ---- Public API -------------------------------------------------------------------

    function indexOf(uid) {
        var n = source ? source.cards.count : 0;
        for (var i = 0; i < n; ++i)
            if (source.cards.get(i).uid === uid)
                return i;
        return -1;
    }

    function slideTo(groupIndex) {
        slideAnim.stop();
        slideAnim.to = Math.max(0, Math.min(groupCount - 1, groupIndex));
        slideAnim.start();
    }

    function maximize(uid) {
        if (uid === undefined)
            uid = currentUid;
        var g = groupIndexOf(uid);
        if (g < 0)
            return;
        setFocus(uid);
        if (Math.abs(position - g) > 0.001)
            slideTo(g);
        maximizeAnim.stop();
        maximizeAnim.to = 1;
        maximizeAnim.duration = Theme.cardMaximizeDuration;
        maximizeAnim.start();
        cardMaximized(uid);
    }

    function minimize() {
        cancelRise();
        if (count === 0)
            return;
        maximizeAnim.stop();
        maximizeAnim.to = 0;
        maximizeAnim.duration = Theme.cardMinimizeDuration;
        maximizeAnim.start();
        cardMinimized(currentUid);
    }

    // Jump straight to card view on a stack, without animating.
    function jumpTo(groupIndex) {
        cancelRise();
        slideAnim.stop();
        maximizeAnim.stop();
        maximizeProgress = 0;
        position = Math.max(0, Math.min(groupCount - 1, groupIndex));
    }

    // Show a freshly launched (or re-launched) card maximized.
    function focusLaunched(uid) {
        var g = groupIndexOf(uid);
        if (g < 0)
            return;
        slideAnim.stop();
        setFocus(uid);
        position = g;
        maximizeAnim.stop();
        if (_newCards[uid]) {
            delete _newCards[uid];
            _prepareRise(uid);
            return;
        }
        maximizeAnim.to = 1;
        maximizeAnim.duration = Theme.cardLaunchDuration;
        maximizeAnim.start();
        cardMaximized(uid);
    }

    // ---- A new card rises (CardWindowManager::prepareAddWindow,
    // setActiveCardOffScreen, PreparingState, maximizeActiveWindow) ----------
    // It waits full size just below the screen, its stack in place, until
    // the app is ready or cardAddMaxDuration (750 ms) has passed, then rises
    // to maximized, 300 ms OutQuart (cardMaximize). A touch before that
    // cancels to card view.
    property string risingUid: ""
    readonly property bool preparing: riseTimeout.running
    property var _newCards: ({})
    Connections {
        target: cards
        function onItemAdded(index, item) { view._newCards[item.uid] = true; }
    }

    function _prepareRise(uid) {
        risingUid = uid;
        maximizeProgress = 0;
        var card = cardItem(uid);
        if (!card || !card.loading)
            _rise();
        else
            riseTimeout.restart();
    }
    function _rise() {
        riseTimeout.stop();
        if (risingUid === "" || maximizeProgress > 0)
            return;
        maximizeAnim.to = 1;
        maximizeAnim.duration = Theme.cardMaximizeDuration;
        maximizeAnim.start();
        cardMaximized(risingUid);
    }
    function cancelRise() {
        riseTimeout.stop();
        risingUid = "";
    }
    Timer {
        id: riseTimeout
        interval: Theme.cardAddMaxDuration
        onTriggered: view._rise()
    }
    // The app became ready before the timeout.
    Connections {
        target: view.risingUid !== "" ? view.cardItem(view.risingUid) : null
        function onLoadingChanged() { if (view.preparing) view._rise(); }
    }
    onMaximizedChanged: if (maximized) risingUid = ""
    // Any other way back to card view ends the rise.
    Connections {
        target: maximizeAnim
        function onRunningChanged() {
            if (!maximizeAnim.running && !view.maximized && !riseTimeout.running)
                view.risingUid = "";
        }
    }
    onMaximizeProgressChanged: {
        if (maximizeProgress === 0 && risingUid !== "" && !riseTimeout.running && !maximizeAnim.running)
            risingUid = "";
    }

    // CardWindowManager::closeWindow: in card view the card is thrown off
    // the top, 300 ms OutCubic, while the others slide into place
    // (removeCardFromGroup -> slideAllGroups) at the same time. It does not
    // fade. The window closes once it is off.
    function close(uid) {
        if (closing[uid])
            return;
        var g = groupIndexOf(uid);
        if (g < 0)
            return;
        var place = layout.cards[uid];
        var card = cardItem(uid);
        var fly = card && place && maximizeProgress === 0;
        var group = groups[g];
        var k = group.uids.indexOf(uid);
        var stackSurvives = group.uids.length > 1;
        // The neighbouring card in the stack takes focus.
        if (stackSurvives && focusOf(group) === uid)
            setFocus(group.uids[k > 0 ? k - 1 : 1]);
        animateLayout(fly ? Theme.cardDeleteDuration : Theme.cardShuffleReorderDuration);
        var wasLastGroup = g === groupCount - 1;
        var c = Object.assign({}, closing);
        c[uid] = place || { cx: width / 2, cy: cardOriginY, scale: activeScale, rot: 0, z: 0, focused: false };
        closing = c;
        if (!stackSurvives) {
            if (wasLastGroup && position > 0)
                slideTo(groupCount - 1);
            else if (g < position)
                position = Math.max(0, position - 1);
        }
        if (fly)
            flickAnimation.createObject(card, { target: card, closing: true,
                                                to: -(place.cy + card.height * place.scale / 2) }).start();
        else
            _finishClose(uid);
    }

    // A card closed from elsewhere (the app, the source) while flying off
    // or rising.
    function _forgetClosed() {
        var c = {}, risingHere = false;
        for (var i = 0; source && i < source.cards.count; ++i) {
            var uid = source.cards.get(i).uid;
            if (closing[uid])
                c[uid] = closing[uid];
            if (uid === risingUid)
                risingHere = true;
        }
        if (Object.keys(closing).length !== Object.keys(c).length)
            closing = c;
        if (risingUid !== "" && !risingHere) {
            cancelRise();
            maximizeAnim.stop();
            if (count === 0 || maximizeProgress < 1)
                maximizeProgress = 0;
        }
    }

    function _finishClose(uid) {
        if (!closing[uid])
            return;
        var c = Object.assign({}, closing);
        delete c[uid];
        closing = c;
        source.close(uid);
        if (count === 0)
            maximizeProgress = 0;
        cardClosed(uid);
    }

    // ---- Reorder (CardWindowManager.cpp:1876-2040) --------------------------------------

    property string reorderUid: ""
    property real reorderX: 0
    property real reorderY: 0
    property string reorderZone: "center"      // "left", "center", "right"

    function reorderZoneAt(x) {
        var slice = width / Theme.reorderMarginSlice;
        return x < slice ? "left" : x > width - slice ? "right" : "center";
    }

    function enterReorder(uid, x, y) {
        var g = groupIndexOf(uid);
        if (g < 0)
            return;
        setFocus(uid);
        slideTo(g);
        reorderUid = uid;
        reorderX = x;
        reorderY = y;
        reorderZone = reorderZoneAt(x);
    }

    function moveReorder(x, y) {
        reorderX = x;
        reorderY = y;
        var zone = reorderZoneAt(x);
        if (zone !== reorderZone) {
            reorderZone = zone;
            if (zone === "right")
                moveReorderSlot(1);
            else if (zone === "left")
                moveReorderSlot(-1);
        }
        if (zone === "center")
            moveReorderSlotCenter();
    }

    function exitReorder() {
        if (reorderUid === "")
            return;
        var uid = reorderUid;
        reorderUid = "";
        reorderCycle.stop();
        animateLayout(Theme.cardSlideDuration);
        slideTo(groupIndexOf(uid));
    }

    // Shuffle inside the stack when the lifted card passes a neighbour
    // (CardGroup::moveActiveCard).
    function moveReorderSlotCenter() {
        var g = groupIndexOf(reorderUid);
        if (g < 0)
            return;
        var uids = groups[g].uids;
        var k = uids.indexOf(reorderUid);
        var target = k;
        for (var i = 0; i < k; ++i)
            if (reorderX < layout.cards[uids[i]].cx) { target = i; break; }
        if (target === k)
            for (i = uids.length - 1; i > k; --i)
                if (reorderX > layout.cards[uids[i]].cx) { target = i; break; }
        if (target !== k) {
            animateLayout(Theme.cardShuffleReorderDuration);
            source.moveCard(groups[g].start + k, groups[g].start + target);
        }
    }

    // One step right (+1) or left (-1): through the stack, then out of it
    // into a new stack, then into the neighbouring stack.
    function moveReorderSlot(dir) {
        var g = groupIndexOf(reorderUid);
        if (g < 0)
            return;
        var group = groups[g];
        var n = group.uids.length;
        var k = group.uids.indexOf(reorderUid);
        var atEdge = dir > 0 ? k === n - 1 : k === 0;
        if (!atEdge) {
            animateLayout(Theme.cardShuffleReorderDuration);
            source.moveCard(group.start + k, group.start + k + dir);
        } else if (n > 1) {
            // Leave the stack: the card becomes its own stack on that side.
            animateLayout(Theme.cardGroupReorderDuration);
            source.setCardGroup(reorderUid, source.newGroupId());
            position = g + (dir > 0 ? 1 : 0);
        } else if (g + dir >= 0 && g + dir < groupCount) {
            // A lone card joins the neighbouring stack at the near end.
            animateLayout(Theme.cardGroupReorderDuration);
            source.setCardGroup(reorderUid, groups[g + dir].id);
            position = dir > 0 ? g : g - 1;
        } else {
            return;
        }
        setFocus(reorderUid);
        reorderCycle.dir = dir;
        reorderCycle.interval = view.layoutAnimationDuration;
        reorderCycle.restart();
    }

    // Keep stepping while the card is held in an edge zone
    // (ReorderState::animationsFinished).
    Timer {
        id: reorderCycle
        property int dir: 0
        onTriggered: {
            if (view.reorderUid !== "" && view.reorderZone === (dir > 0 ? "right" : "left"))
                view.moveReorderSlot(dir);
        }
    }

    // ---- Animations -------------------------------------------------------------------

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

    // ---- Cards --------------------------------------------------------------------------

    Repeater {
        id: cards
        model: view.source ? view.source.cards : null

        delegate: Card {
            id: cardDelegate
            required property int index
            required property var model

            readonly property var place: view.closing[uid] || view.layout.cards[uid] || null
            // Rising from below the screen: full size, straight up.
            readonly property bool rising: view.risingUid === uid
            readonly property bool lifted: view.reorderUid === uid

            uid: model.uid
            title: model.title
            icon: {
                var info = view.source && typeof view.source.appInfo === "function" ? view.source.appInfo(model.appId) : null;
                return info && info.icon ? info.icon : "";
            }
            largeIcon: {
                var info = view.source && typeof view.source.appInfo === "function" ? view.source.appInfo(model.appId) : null;
                return info && info.largeIcon ? info.largeIcon : "";
            }
            width: view.windowWidth
            height: view.windowHeight
            window: view.source.windowFor(uid)
            centerX: rising ? view.width / 2 : lifted ? view.reorderX : place ? place.cx : view.width / 2
            centerY: rising ? view.mix(view.height + height / 2, view.maximizedCenterY, view.maximizeProgress)
                   : lifted ? view.reorderY : place ? place.cy : view.cardOriginY
            cardScale: rising ? 1 : lifted ? view.activeScale : place ? place.scale : view.activeScale
            rotation: rising || lifted || !place ? 0 : place.rot
            rounded: view.maximizeProgress < 1
            appOrientation: model.orientation !== undefined && model.orientation !== "" ? model.orientation : "free"
            uiOrientation: view.uiOrientation
            uiPortrait: view.uiPortrait
            interactive: view.maximized && place !== null && place.focused
            dimmed: place === null || !place.focused
            reordering: lifted
            layoutAnimationDuration: lifted || view.closing[uid] ? 0 : view.layoutAnimationDuration
            z: lifted || rising ? 3000 : place ? place.z : 0
            visible: centerX + width * cardScale / 2 > -view.width
                     && centerX - width * cardScale / 2 < view.width * 2
        }
    }

    function cardItem(uid) {
        for (var i = 0; i < cards.count; ++i) {
            var c = cards.itemAt(i);
            if (c && c.uid === uid)
                return c;
        }
        return null;
    }

    // ---- Touch handling in card view ----------------------------------------------------
    // Every finger can flick a card up and away, any card on screen,
    // including the stacks peeking in at the sides, and several at once
    // (CardWindowManager handles each touch point's flick on its own card).
    // The first finger also pans between stacks, taps and holds to reorder.

    MultiPointTouchArea {
        id: touch
        anchors.fill: parent
        enabled: view.maximizeProgress === 0 && view.count > 0
        mouseEnabled: true
        maximumTouchPoints: 5

        // pointId -> {startX, startY, lastX, lastY, lastTime, vx, vy, uid, axis}
        // axis: "", "h" (pan), "v" (flicking uid), "reorder" or "done".
        property var fingers: ({})
        property int primary: -1          // the finger that pans, taps and reorders
        property real startPosition
        property real startFan

        Timer {
            id: holdTimer
            interval: Theme.tapAndHoldInterval
            onTriggered: touch.hold()
        }

        // Topmost card under the point.
        function cardAt(px, py) {
            var best = "", bestZ = -1;
            for (var uid in view.layout.cards) {
                var p = view.layout.cards[uid];
                var c = view.cardItem(uid);
                var w = view.windowWidth * p.scale, h = view.windowHeight * p.scale;
                var dy = c ? c.flickOffset : 0;
                if (Math.abs(px - p.cx) <= w / 2 && Math.abs(py - (p.cy + dy)) <= h / 2 && p.z > bestZ) {
                    best = uid;
                    bestZ = p.z;
                }
            }
            return best;
        }

        // A card another finger is already flicking.
        function owned(uid) {
            for (var id in fingers)
                if (fingers[id].uid === uid && fingers[id].axis === "v")
                    return true;
            return false;
        }

        function currentFan() {
            var g = view.groups[view.currentGroup];
            return g ? CardLayout.clampFanPosition(view.fanPositions[g.id] !== undefined ? view.fanPositions[g.id] : 1e9,
                                                   g.uids.length) : 0;
        }

        function setCurrentFan(v) {
            var g = view.groups[view.currentGroup];
            var f = Object.assign({}, view.fanPositions);
            f[g.id] = CardLayout.clampFanPosition(v, g.uids.length);
            view.fanPositions = f;
        }

        onPressed: (points) => {
            // A touch while a new card waits to rise: back to card view
            // (PreparingState::handleTouchBegin -> minimizeActiveWindow).
            if (view.preparing) {
                view.cancelRise();
                return;
            }
            var now = Date.now();
            for (var i = 0; i < points.length; ++i) {
                var p = points[i];
                var uid = cardAt(p.x, p.y);
                fingers[p.pointId] = { startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, lastTime: now,
                                       vx: 0, vy: 0, uid: owned(uid) ? "" : uid, axis: "" };
                if (primary === -1) {
                    primary = p.pointId;
                    slideAnim.stop();
                    startPosition = view.position;
                    startFan = currentFan();
                    holdTimer.restart();
                }
            }
        }

        function hold() {
            var f = fingers[primary];
            if (!f || f.axis !== "" || f.uid === "")
                return;
            if (view.groupIndexOf(f.uid) === view.currentGroup) {
                f.axis = "reorder";
                view.enterReorder(f.uid, f.lastX, f.lastY);
            } else {
                // Held beside the stack: switch stacks (CardWindowManager.cpp:1655-1660).
                view.slideTo(view.currentGroup + (f.lastX < view.width / 2 ? -1 : 1));
                f.axis = "done";
            }
        }

        onUpdated: (points) => {
            var now = Date.now();
            for (var i = 0; i < points.length; ++i) {
                var p = points[i], f = fingers[p.pointId];
                if (!f)
                    continue;
                var dt = Math.max(1, now - f.lastTime);
                f.vx = (p.x - f.lastX) / dt;
                f.vy = (p.y - f.lastY) / dt;
                f.lastX = p.x; f.lastY = p.y; f.lastTime = now;
                move(p.pointId, f);
            }
        }

        function move(id, f) {
            if (f.axis === "reorder") {
                view.moveReorder(f.lastX, f.lastY);
                return;
            }
            var dx = f.lastX - f.startX, dy = f.lastY - f.startY;
            // Lock to an axis once outside the tap radius
            // (CardWindowManager.cpp:1464-1476). Only the first finger pans.
            if (f.axis === "" && dx * dx + dy * dy > Theme.tapRadius * Theme.tapRadius) {
                if (id === primary)
                    holdTimer.stop();
                if (Math.abs(dx) > Theme.horizontalLockRatio * Math.abs(dy))
                    f.axis = id === primary ? "h" : "done";
                else if (f.uid !== "" && !owned(f.uid))
                    f.axis = "v";
                else
                    f.axis = "done";
            }
            if (f.axis === "h") {
                // Scroll the fan of a long stack first, then the stacks
                // (CardWindowManager.cpp:1482-1499).
                var fanUnit = view.windowWidth * view.activeScale / 3;
                var wantFan = startFan - dx / fanUnit;
                setCurrentFan(wantFan);
                var leftover = (wantFan - currentFan()) * fanUnit;
                var pos = startPosition + leftover / view.groupSpacing();
                // Rubber-band past the ends.
                var last = view.groupCount - 1;
                if (pos < 0) pos = pos / 3;
                if (pos > last) pos = last + (pos - last) / 3;
                view.position = pos;
            } else if (f.axis === "v") {
                // The card follows the finger both ways; pulled down it
                // stretches toward the angry card (CardWindowManager.cpp:1523-1533).
                var c = view.cardItem(f.uid);
                if (c)
                    c.flickOffset = dy;
            }
        }

        onReleased: (points) => {
            for (var i = 0; i < points.length; ++i)
                release(points[i].pointId, false);
        }
        onCanceled: (points) => {
            for (var i = 0; i < points.length; ++i)
                release(points[i].pointId, true);
        }

        function release(id, cancelled) {
            var f = fingers[id];
            delete fingers[id];
            if (id === primary) {
                primary = -1;
                holdTimer.stop();
            }
            if (!f)
                return;
            if (f.axis === "reorder") {
                view.exitReorder();
            } else if (f.axis === "h") {
                // Carry momentum: a quick flick advances one stack.
                var target = Math.round(view.position);
                if (!cancelled && Math.abs(f.vx) > 0.5 && target === Math.round(startPosition))
                    target += f.vx < 0 ? 1 : -1;
                view.slideTo(target);
            } else if (f.axis === "v") {
                var c = view.cardItem(f.uid);
                if (c) {
                    if (!cancelled && isAngry(c))
                        view.slingshot(c);
                    else
                        view.animateFlick(c, !cancelled && shouldClose(c, f.vy));
                }
            } else if (f.axis === "" && !cancelled && fingerCount() === 0) {
                tap(f.uid, f.lastX);
            }
        }

        function fingerCount() {
            return Object.keys(fingers).length;
        }

        // Tap on the open stack maximizes the tapped card; a tap on or beside
        // another stack switches to it (CardWindowManager.cpp:2151-2195).
        function tap(uid, x) {
            var g = uid !== "" ? view.groupIndexOf(uid) : -1;
            if (g === view.currentGroup)
                view.maximize(uid);
            else if (g >= 0)
                view.slideTo(g);
            else
                view.slideTo(view.currentGroup + (x < view.width / 2 ? -1 : 1));
        }

        // The "angry card": let go with the card's centre below the bottom of
        // the screen and it is force-closed (CardWindowManager.cpp:1714-1716).
        function isAngry(c) {
            var p = view.layout.cards[c.uid];
            return p && p.cy + c.flickOffset > view.height;
        }

        // CardWindowManager.cpp:1700-1708: far enough, fast enough, and faster
        // the shorter the drag; or let go with the card's centre above the
        // top of the screen (:1588-1591, 1712-1714).
        function shouldClose(c, vy) {
            var u = Theme.u, dy = c.flickOffset;
            var flicked = dy < -Theme.cardCloseMinDistance
                          && vy < -Theme.cardCloseMinVelocity
                          && vy < 550 * u * u / dy;
            var p = view.layout.cards[c.uid];
            return flicked || (p !== undefined && p.cy + dy < 0);
        }
    }

    // The angry card is slung from the bottom of the screen up and off the
    // top (closeWindow always throws cards off the top: CardWindowManager.cpp
    // 2866-2878), then closed without keep-alive. On the device, upside down,
    // it played the "birdappclose" sound (:1280-1283, 2890-2891).
    signal angryCardClosed(string uid)
    function slingshot(card) {
        angryCardClosed(card.uid);
        view.close(card.uid);
    }

    // Throw a flicked card off the top and close it, or spring it back. One
    // animation per card, so several can go at once.
    function animateFlick(card, close) {
        if (close)
            view.close(card.uid);
        else
            flickAnimation.createObject(card, { target: card, closing: false, to: 0 }).start();
    }

    Component {
        id: flickAnimation
        NumberAnimation {
            property bool closing
            property: "flickOffset"
            duration: closing ? Theme.cardDeleteDuration : Theme.cardSlideDuration
            easing.type: closing ? Theme.cardDeleteEasing : Theme.cardEasing
            onFinished: {
                if (closing && target)
                    view._finishClose(target.uid);
                destroy();
            }
        }
    }
}
