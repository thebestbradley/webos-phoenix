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
import Qt5Compat.GraphicalEffects
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
    // The time a touch's flick is measured by (ms); tests set their own.
    property var clock: function () { return Date.now(); }
    readonly property bool maximized: maximizeProgress === 1
    // The card in front asked for the whole screen (enableFullScreenMode).
    readonly property bool currentFullScreen: {
        revision;
        for (var i = 0; source && i < source.cards.count; ++i)
            if (source.cards.get(i).uid === currentUid)
                return source.cards.get(i).fullScreen === true;
        return false;
    }
    // The card in front keeps the screen on (its window property
    // blockScreenTimeout, e.g. a video playing).
    readonly property bool currentBlocksScreenTimeout: {
        revision;
        for (var i = 0; source && i < source.cards.count; ++i)
            if (source.cards.get(i).uid === currentUid)
                return source.cards.get(i).blockScreenTimeout === true;
        return false;
    }
    // The status bar colour the card in front asked for
    // (setWindowProperties statusBarColor, 0xRRGGBB), or "" for none.
    readonly property string currentStatusBarColor: {
        revision;
        for (var i = 0; source && i < source.cards.count; ++i) {
            if (source.cards.get(i).uid === currentUid) {
                var c = source.cards.get(i).statusBarColor;
                return typeof c === "number" && c >= 0 ? "#" + ("000000" + c.toString(16)).slice(-6) : "";
            }
        }
        return "";
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
    // A card starts closing: the user threw it away, or (byApp) its window
    // closed itself. CardWindowManager::closeWindow played "appclose" for
    // the first (CardWindowManager.cpp:2889-2893).
    signal cardClosing(string uid, bool byApp)
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

    // duration: the trackpad's quicker settle (Theme.wheelSettleDuration).
    function slideTo(groupIndex, duration) {
        slideAnim.stop();
        slideAnim.to = Math.max(0, Math.min(groupCount - 1, groupIndex));
        slideAnim.duration = duration !== undefined ? duration : Theme.cardSlideDuration;
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
        // The first time in card view, the "Dismissing Cards" tutorial
        // (MinimizeState::onEntry -> CardWindowManager::firstCardAlert,
        // CardWindowManagerStates.cpp:182-191, CardWindowManager.cpp:1167-1187):
        // the window source shows it, once.
        if (currentUid !== "" && source && typeof source.firstCardAlert === "function")
            source.firstCardAlert();
    }

    // Advanced gestures (G5): the card beside the active one, through its
    // stack and on into the next (CardWindowManager::switchToNextApp /
    // PrevApp and their Maximized forms, CardWindowManager.cpp:2223-2480;
    // CardGroup::makeNextCardActive). toRight: the next card (the back card
    // of the next stack after the stack's front one). Maximized, the new
    // card is maximized; at the last card the maximized card shifts 40 px
    // and slides back. Returns whether the card changed.
    property real edgeNudge: 0
    NumberAnimation on edgeNudge {
        id: edgeNudgeAnim
        running: false
        to: 0
        duration: Theme.cardMaximizeDuration
        easing.type: Theme.cardEasing
    }
    function switchApp(toRight) {
        // From where a slide is going: a second swipe during it goes on
        // from that card (CardWindowManager's active group changes at once).
        var g = slideAnim.running ? Math.round(slideAnim.to) : currentGroup;
        if (g < 0 || g >= groupCount)
            return false;
        var uids = groups[g].uids;
        var i = uids.indexOf(focusOf(groups[g]));
        var next = "";
        if (toRight)
            next = i < uids.length - 1 ? uids[i + 1] : g < groupCount - 1 ? groups[g + 1].uids[0] : "";
        else
            next = i > 0 ? uids[i - 1] : g > 0 ? groups[g - 1].uids[groups[g - 1].uids.length - 1] : "";
        if (next === "") {
            if (maximized) {
                edgeNudge = (toRight ? -40 : 40) * Theme.u;
                edgeNudgeAnim.restart();
            } else {
                slideTo(g);
            }
            return false;
        }
        animateLayout(Theme.cardSlideDuration);
        if (maximized) {
            cardMinimized(currentUid);
            maximize(next);
        } else {
            setFocus(next);
            slideTo(groupIndexOf(next));
        }
        return true;
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
        if (_newCards[uid]) {
            delete _newCards[uid];
            _prepareRise(uid, g);
            return;
        }
        setFocus(uid);
        position = g;
        maximizeAnim.stop();
        maximizeAnim.to = 1;
        maximizeAnim.duration = Theme.cardLaunchDuration;
        maximizeAnim.start();
        cardMaximized(uid);
    }

    // ---- A new card rises (CardWindowManager::prepareAddWindowSibling,
    // setActiveCardOffScreen, PreparingState, LoadingState,
    // addWindowTimedOutNormal, maximizeActiveWindow) --------------------------
    // The card in front zooms out to card view while the stacks slide so the
    // new card's stack is centred (slideAllGroups, 300 ms); the new card
    // waits full size just below the screen, in its launcher's stack when
    // the app in front opened it. When the app is ready it rises to
    // maximized, 300 ms OutQuart (cardMaximize). If it is not ready after
    // cardAddMaxDuration (750 ms), it slides into its place in the stack
    // showing its loading screen instead, and maximizes once the app is
    // ready. A touch before that stays in card view.
    property string risingUid: ""
    // The card waiting in card view for its app (LoadingState).
    property string loadingUid: ""
    readonly property bool preparing: riseTimeout.running || _risePending
    property bool _risePending: false
    property bool _inPrepare: false
    property var _newCards: ({})
    Connections {
        target: cards
        function onItemAdded(index, item) { view._newCards[item.uid] = true; }
    }

    function _prepareRise(uid, g) {
        riseTimeout.stop();
        _risePending = false;
        loadingUid = "";
        maximizeAnim.stop();
        _inPrepare = true;
        // Below the screen first, before any animation is on, so the new
        // card does not glide there.
        risingUid = uid;
        if (maximizeProgress > 0 || Math.abs(position - g) > 0.001)
            animateLayout(Theme.cardSlideDuration);
        setFocus(uid);
        position = g;
        maximizeProgress = 0;
        _inPrepare = false;
        var card = cardItem(uid);
        if (!card || !card.loading)
            _rise();
        else
            riseTimeout.restart();
    }
    function _rise() {
        riseTimeout.stop();
        if (risingUid === "" || (maximizeAnim.running && maximizeAnim.to === 1))
            return;
        // After the zoom out and a short settle (cardPrepareAddDuration):
        // the cards' layout animation would drag the rise, and a rise that
        // starts the moment the zoom out ends looks like a bounce.
        if (layoutAnimTimer.running || riseSettle.running) {
            _risePending = true;
            return;
        }
        _risePending = false;
        maximizeAnim.to = 1;
        // A new card rises at the launch pace (cardLaunchDuration, 400 ms).
        maximizeAnim.duration = Theme.cardLaunchDuration;
        maximizeAnim.start();
        cardMaximized(risingUid);
    }
    // Not ready in time: into its place in the stack, loading.
    function _slideInLoading() {
        if (risingUid === "")
            return;
        _risePending = false;
        loadingUid = risingUid;
        animateLayout(Theme.cardSlideDuration);
        risingUid = "";
    }
    function cancelRise() {
        riseTimeout.stop();
        riseSettle.stop();
        _risePending = false;
        risingUid = "";
        loadingUid = "";
    }
    Timer {
        id: riseTimeout
        interval: Theme.cardAddMaxDuration
        onTriggered: view._slideInLoading()
    }
    Connections {
        target: layoutAnimTimer
        function onRunningChanged() { if (!layoutAnimTimer.running && view._risePending) riseSettle.restart(); }
    }
    Timer {
        id: riseSettle
        interval: Theme.cardPrepareAddDuration
        onTriggered: if (view._risePending) view._rise()
    }
    // The app became ready: rise from below, or maximize from card view.
    Connections {
        target: view.risingUid !== "" ? view.cardItem(view.risingUid) : null
        function onLoadingChanged() { if (riseTimeout.running) view._rise(); }
    }
    Connections {
        target: view.loadingUid !== "" ? view.cardItem(view.loadingUid) : null
        function onLoadingChanged() {
            var uid = view.loadingUid;
            var card = view.cardItem(uid);
            if (!card || card.loading)
                return;
            view.loadingUid = "";
            if (view.maximizeProgress === 0 && view.currentUid === uid)
                view.maximize(uid);
        }
    }
    onMaximizedChanged: if (maximized) { risingUid = ""; loadingUid = ""; }
    // Any other way back to card view ends the rise.
    Connections {
        target: maximizeAnim
        function onRunningChanged() {
            if (!maximizeAnim.running && !view.maximized && !view.preparing)
                view.risingUid = "";
        }
    }
    onMaximizeProgressChanged: {
        if (maximizeProgress === 0 && risingUid !== "" && !preparing && !_inPrepare && !maximizeAnim.running)
            risingUid = "";
    }

    // CardWindowManager::closeWindow: in card view the card is thrown off
    // the top, 300 ms OutCubic, while the others slide into place
    // (removeCardFromGroup -> slideAllGroups) at the same time. It does not
    // fade. The window closes once it is off.
    function close(uid, byApp) {
        if (closing[uid])
            return;
        var g = groupIndexOf(uid);
        if (g < 0)
            return;
        // The app closed its own window: no keep-alive for it.
        if (byApp)
            _noKeepAlive[uid] = true;
        cardClosing(uid, !!byApp);
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
        var c = {}, risingHere = false, loadingHere = false;
        for (var i = 0; source && i < source.cards.count; ++i) {
            var uid = source.cards.get(i).uid;
            if (closing[uid])
                c[uid] = closing[uid];
            if (uid === risingUid)
                risingHere = true;
            if (uid === loadingUid)
                loadingHere = true;
        }
        if (loadingUid !== "" && !loadingHere)
            loadingUid = "";
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
        // The window source may keep the app running without its card
        // (keep-alive), unless it was thrown away angrily or the app
        // closed it (disableKeepAlive).
        var noKeepAlive = !!_noKeepAlive[uid];
        delete _noKeepAlive[uid];
        source.close(uid, noKeepAlive);
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
            readonly property var info: view.source && typeof view.source.appInfo === "function" ? view.source.appInfo(model.appId) : null
            largeIcon: info && info.largeIcon ? info.largeIcon : ""
            splashIcon: info && info.splashIcon ? info.splashIcon : ""
            splashBackground: info && info.splashBackground ? info.splashBackground : ""
            width: view.windowWidth
            height: view.windowHeight
            window: view.source.windowFor(uid)
            centerX: (rising ? view.width / 2 : lifted ? view.reorderX : place ? place.cx : view.width / 2)
                     + (place && place.focused ? view.edgeNudge : 0)
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

    // ---- Scene transitions (Card.prepareSceneTransition) -------------------------------

    Connections {
        target: view.source
        ignoreUnknownSignals: true
        function onSceneTransitionRequested(uid, op, transition, isPop) {
            var card = view.cardItem(uid);
            var src = view.source;
            var prepared = function () {
                if (src && typeof src.sceneTransitionPrepared === "function")
                    src.sceneTransitionPrepared(uid);
            };
            if (!card) {
                if (op === "prepare")
                    prepared();
                return;
            }
            if (op === "prepare")
                card.prepareSceneTransition(isPop, prepared);
            else if (op === "run")
                card.runSceneTransition(transition, isPop);
            else if (op === "cancel")
                card.cancelSceneTransition();
        }
        // Touch to Share sent the app's data: if its card is the maximized
        // one, it goes to card view and a ghost of it is thrown off the top
        // once it is there (MaximizeState::processTouchToShareTransfer,
        // CardWindowManagerStates.cpp:485-492; MinimizeState::animationsFinished
        // -> performPendingTouchToShareActions, :158-161).
        function onTouchToShareTransferred(appId) {
            if (!view.maximized || view.currentUid === "")
                return;
            var i = view.indexOf(view.currentUid);
            if (i < 0 || view.source.cards.get(i).appId !== appId)
                return;
            // The picture is taken now (CardWindow::createGhost copies the
            // app's buffer, the same until the ghost is made): the ghost
            // waits, hidden, until the card is in card view.
            var uid = view.currentUid;
            var card = view.cardItem(uid);
            if (card) {
                card.grabCard(function (result) {
                    if (result)
                        view._makeGhost(uid, result);
                });
            }
            view.minimize();
        }
    }

    // ---- Touch to Share: the ghost card ------------------------------------------------
    // CardWindowManager::performPendingTouchToShareActions
    // (CardWindowManager.cpp:2923-2957): a copy of the card
    // (CardWindow::createGhost, CardWindow.cpp:2473-2483: its picture in its
    // rounded outline, GhostCard.cpp) over the card, at half opacity, moves
    // from the card's place straight up until its centre is half a window
    // above the top of the screen, growing to GhostCardFinalRatio (0.85) of
    // the window, over cardGhostDuration (750 ms, OutQuart); then it is
    // deleted (slotTouchToShareAnimationFinished). Thrown once the card view
    // is still (MinimizeState::animationsFinished).
    Connections {
        target: maximizeAnim
        function onRunningChanged() {
            if (!maximizeAnim.running && view.maximizeProgress === 0)
                view._throwWaitingGhosts();
        }
    }
    // The ghost is made while the grab result is alive (the callback): the
    // Image reads the picture at once (asynchronous: false), so the result
    // may go.
    function _makeGhost(uid, result) {
        var card = cardItem(uid);
        if (!card)
            return;
        ghostComponent.createObject(view, {
            uid: uid,
            picture: result.url,
            width: card.width,
            height: card.height
        });
        if (maximizeProgress === 0 && !maximizeAnim.running)
            _throwWaitingGhosts();
    }
    function _throwWaitingGhosts() {
        for (var i = 0; i < children.length; ++i) {
            var g = children[i];
            if (g.objectName !== "ghostCard" || !g.waiting)
                continue;
            var card = cardItem(g.uid);
            if (!card) {
                g.destroy();
                continue;
            }
            g.startCenterX = card.centerX;
            g.startCenterY = card.centerY;
            g.startScale = card.cardScale;
            g.rotation = card.rotation;
            g.z = card.z + 0.5;
            g.waiting = false;
            g.throwIt();
        }
    }
    // The ghosts in flight (tests).
    property int ghostCount: 0
    Component {
        id: ghostComponent
        Item {
            id: ghost
            objectName: "ghostCard"
            property string uid
            property url picture
            // Made, not yet thrown (its card is on its way to card view).
            property bool waiting: true
            property real startCenterX
            property real startCenterY
            property real startScale: 1
            property real t: 0
            // Its centre ends half a window above the top: offTop, :2946-2948.
            readonly property real endCenterY: -height / 2
            x: startCenterX - width / 2
            y: startCenterY + (endCenterY - startCenterY) * t - height / 2
            scale: startScale + (Theme.ghostCardFinalRatio - startScale) * t
            transformOrigin: Item.Center
            opacity: 0.5
            visible: !waiting
            readonly property bool masked: GraphicsInfo.api !== GraphicsInfo.Software
            Image {
                id: ghostPicture
                anchors.fill: parent
                source: ghost.picture
                smooth: true
                cache: false
                asynchronous: false
                visible: !ghost.masked
            }
            // In the card's rounded outline (Card.qml's corners).
            CardCornerMask {
                id: ghostCorners
                anchors.fill: parent
                visible: false
                layer.enabled: true
            }
            OpacityMask {
                anchors.fill: parent
                visible: ghost.masked
                source: ghostPicture
                maskSource: ghostCorners
            }
            function throwIt() {
                view.ghostCount++;
                throwAnim.start();
            }
            Component.onDestruction: if (!waiting) view.ghostCount--
            NumberAnimation {
                id: throwAnim
                target: ghost
                property: "t"
                from: 0
                to: 1
                duration: Theme.cardGhostDuration
                easing.type: Easing.OutQuart
                onFinished: ghost.destroy()
            }
        }
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

        // CardGroup.cpp:600: a card's unscaled width moves the fan three
        // positions.
        function fanUnit() { return view.windowWidth / 3; }

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
            // Waiting in card view for its app: it stays there
            // (LoadingState::handleTouchBegin).
            view.loadingUid = "";
            var now = Date.now();
            var started = view.clock();
            for (var i = 0; i < points.length; ++i) {
                var p = points[i];
                var uid = cardAt(p.x, p.y);
                fingers[p.pointId] = { startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, lastTime: now, startTime: started,
                                       vx: 0, vy: 0, uid: owned(uid) ? "" : uid, axis: "",
                                       withinGroup: true, panX: 0, panFrom: 0 };
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
            // This event's movement; on the one that locks the axis, all of
            // it since the touch began (CardWindowManager.cpp:1462-1480).
            var stepX = f.prevX !== undefined ? f.lastX - f.prevX : dx;
            var locking = f.axis === "";
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
            if (f.axis !== "")
                f.prevX = f.lastX;
            if (locking && f.axis === "h")
                stepX = dx;
            if (f.axis === "h") {
                // A long stack's fan first, three positions a card's width
                // (unscaled; CardGroup::adjustHorizontally), until it is at
                // its end that way; from then on, for the rest of the
                // gesture, the stacks (CardWindowManager.cpp:1480-1499,
                // m_trackWithinGroup; CardGroup::atEdge).
                if (f.withinGroup) {
                    var fanBefore = currentFan();
                    if (stepX !== 0)
                        setCurrentFan(fanBefore - stepX / fanUnit());
                    var moved = currentFan() - fanBefore;
                    var wanted = stepX !== 0 ? -stepX / fanUnit() : 0;
                    if (stepX !== 0 && Math.abs(moved - wanted) > 1e-6) {
                        f.withinGroup = false;
                        f.panFrom = view.position;
                        f.panX = (wanted - moved) * fanUnit();
                    }
                } else {
                    f.panX += -stepX;
                }
                if (!f.withinGroup) {
                    var pos = f.panFrom + f.panX / view.groupSpacing();
                    // Rubber-band past the ends.
                    var last = view.groupCount - 1;
                    if (pos < 0) pos = pos / 3;
                    if (pos > last) pos = last + (pos - last) / 3;
                    view.position = pos;
                }
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
                // A flick: the whole gesture's average velocity, |vx| + |vy|
                // between 2.5 and 11 px/ms (FlickGestureRecognizer.cpp:
                // 95-104). Still in the fan, the fan carries on, a position
                // per 10 px/ms (CardGroup::flick); else the next or previous
                // stack from the one the gesture began on. Without one, the
                // stack nearest the centre (CardWindowManager.cpp:1574-1600,
                // 1720-1735).
                var elapsed = view.clock() - f.startTime;
                var ax = elapsed > 0 ? (f.lastX - f.startX) / elapsed : 0;
                var ay = elapsed > 0 ? (f.lastY - f.startY) / elapsed : 0;
                var speed = Math.abs(ax) + Math.abs(ay);
                var flicked = !cancelled && f.lastX !== f.startX
                              && speed >= Theme.flickMinVelocity && speed <= Theme.flickMaxVelocity;
                var from = Math.round(startPosition);
                if (flicked && f.withinGroup) {
                    view.animateLayout(200);
                    setCurrentFan(currentFan() - Math.round(ax / Theme.u) / 10);
                    view.slideTo(from);
                } else if (flicked) {
                    view.slideTo(from + (ax > 0 ? -1 : 1));
                } else {
                    view.slideTo(Math.round(view.position));
                }
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

        // Tap on the open stack maximizes the tapped card, unless it lies
        // too deep in a long fan, which then scrolls to it; a tap on or
        // beside another stack switches to it; one in the open stack's
        // column on no card leaves things as they are
        // (CardWindowManager::handleTapGestureMinimized, CardWindowManager.cpp:
        // 2151-2195; CardGroup::shouldMaximizeOrScroll, withinColumn).
        function tap(uid, x) {
            var g = uid !== "" ? view.groupIndexOf(uid) : -1;
            if (g === view.currentGroup) {
                var grp = view.groups[g];
                var t = CardLayout.tapOnFan(grp.uids.indexOf(uid), grp.uids.length, currentFan());
                if (t.maximize) {
                    view.maximize(uid);
                } else {
                    view.animateLayout(Theme.cardSlideDuration);
                    setCurrentFan(t.fan);
                    view.slideTo(g);
                }
            } else if (g >= 0) {
                view.slideTo(g);
            } else {
                var col = view.layout.columns[view.currentGroup];
                if (col && x >= col.left && x <= col.right)
                    view.slideTo(view.currentGroup);
                else
                    view.slideTo(view.currentGroup + (x < view.width / 2 ? -1 : 1));
            }
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

    // ---- Trackpad and mouse wheel (Phoenix) ---------------------------------------------
    // webOS had only the touch screen. On a desktop, a laptop or a tablet
    // with a trackpad, a two-finger swipe does what one finger does on the
    // screen: sideways it pans between stacks (and through a long stack's
    // fan first), up it throws the card under the pointer away. The swipe
    // follows the content the way the system scrolls (natural scrolling or
    // not). It ends when the fingers lift (the scroll phase says so, or the
    // events stop): it then snaps at once, as a finger's release does, to
    // the stack it was heading for (a quick swipe goes on to the next one),
    // and the momentum events the system sends after the fingers lift are
    // ignored, so the snap is not pulled back and forth.
    // A mouse wheel moves one stack per notch.
    MouseArea {
        id: wheel
        objectName: "cardWheel"
        anchors.fill: parent
        enabled: touch.enabled
        acceptedButtons: Qt.NoButton

        property string axis: ""          // "", "h", "v" or "done"
        property string uid: ""
        property real sumX: 0
        property real sumY: 0
        property real startPosition: 0
        property real startFan: 0
        property real lastTime: 0
        property real vx: 0
        property real vy: 0
        // After a swipe: the momentum that follows it is ignored until the
        // events stop or a new swipe begins.
        property bool settling: false

        Timer {
            id: wheelEnd
            interval: Theme.wheelGestureEndDelay
            onTriggered: wheel.finish()
        }
        Timer {
            id: settleEnd
            interval: Theme.wheelGestureEndDelay
            onTriggered: wheel.settling = false
        }

        onWheel: (e) => {
            if (touch.fingerCount() > 0 || view.preparing) {
                e.accepted = false;
                return;
            }
            // Fingers down again: a new swipe, whatever is still settling.
            if (e.phase === Qt.ScrollBegin)
                settling = false;
            if (settling) {
                settleEnd.restart();
                return;
            }
            // The fingers lifted: momentum (or the end) follows.
            if (axis !== "" && (e.phase === Qt.ScrollMomentum || e.phase === Qt.ScrollEnd)) {
                finish();
                return;
            }
            if (e.phase === Qt.ScrollMomentum || e.phase === Qt.ScrollEnd)
                return;
            if (e.pixelDelta.x === 0 && e.pixelDelta.y === 0) {
                // A mouse wheel: one stack per notch.
                var d = Math.abs(e.angleDelta.x) > Math.abs(e.angleDelta.y) ? e.angleDelta.x : e.angleDelta.y;
                if (d !== 0 && axis === "")
                    view.slideTo(view.currentGroup + (d < 0 ? 1 : -1));
                return;
            }
            swipe(e.x, e.y, e.pixelDelta.x, e.pixelDelta.y);
        }

        // One step of a two-finger swipe at (x, y), moving the content by
        // (dx, dy) pixels. time: when it happened, in ms (tests give their
        // own clock; the default is now).
        function swipe(x, y, dx, dy, time) {
            wheelEnd.restart();
            var now = time === undefined ? Date.now() : time;
            if (lastTime > 0 && now > lastTime) {
                // Smoothed: trackpad events come unevenly.
                vx = 0.6 * dx / (now - lastTime) + 0.4 * vx;
                vy = dy / (now - lastTime);
            }
            lastTime = now;
            sumX += dx;
            sumY += dy;
            if (axis === "") {
                // Lock to an axis as a finger does (horizontalLockRatio).
                if (sumX * sumX + sumY * sumY < Theme.tapRadius * Theme.tapRadius)
                    return;
                if (Math.abs(sumX) > Theme.horizontalLockRatio * Math.abs(sumY)) {
                    axis = "h";
                    slideAnim.stop();
                    startPosition = view.position;
                    startFan = touch.currentFan();
                } else {
                    var g = view.groups[view.currentGroup];
                    uid = touch.cardAt(x, y) || (g ? view.focusOf(g) : "");
                    axis = uid !== "" ? "v" : "done";
                }
            }
            if (axis === "h") {
                var fanUnit = touch.fanUnit();
                var wantFan = startFan - sumX / fanUnit;
                touch.setCurrentFan(wantFan);
                var leftover = (wantFan - touch.currentFan()) * fanUnit;
                var pos = startPosition + leftover / view.groupSpacing();
                var last = view.groupCount - 1;
                if (pos < 0) pos = pos / 3;
                if (pos > last) pos = last + (pos - last) / 3;
                view.position = pos;
            } else if (axis === "v") {
                var c = view.cardItem(uid);
                // Up it goes; pulled down it gives a little and comes back.
                if (c)
                    c.flickOffset = sumY < 0 ? sumY : sumY / 3;
            }
        }

        // The fingers lifted: settle as a finger's release does, at once.
        function finish() {
            wheelEnd.stop();
            if (axis === "h") {
                view.slideTo(settleTarget(), Theme.wheelSettleDuration);
            } else if (axis === "v") {
                var c = view.cardItem(uid);
                if (c)
                    view.animateFlick(c, touch.shouldClose(c, Math.min(vy, 0))
                                         || c.flickOffset < -view.windowHeight * view.activeScale / 3);
            }
            if (axis !== "") {
                settling = true;
                settleEnd.restart();
            }
            axis = "";
            uid = "";
            sumX = 0;
            sumY = 0;
            lastTime = 0;
            vx = 0;
            vy = 0;
        }

        // Where a sideways swipe settles: a quick one goes on to the next
        // stack (as a finger's flick); otherwise the stack it was heading for
        // once it is past a third of the way there, not the nearest one, so a
        // swipe that stops between two cards does not drift back.
        function settleTarget() {
            var from = Math.round(startPosition), pos = view.position;
            var dir = pos > startPosition + 0.001 ? 1 : pos < startPosition - 0.001 ? -1 : 0;
            var target;
            if (Math.abs(vx) > Theme.wheelFlickVelocity && Math.round(pos) === from)
                target = from + (vx < 0 ? 1 : -1);
            else if (dir > 0)
                target = Math.floor(pos) + (pos - Math.floor(pos) > 0.35 ? 1 : 0);
            else if (dir < 0)
                target = Math.ceil(pos) - (Math.ceil(pos) - pos > 0.35 ? 1 : 0);
            else
                target = Math.round(pos);
            return target;
        }
    }

    // The angry card is slung from the bottom of the screen up and off the
    // top (closeWindow always throws cards off the top: CardWindowManager.cpp
    // 2866-2878), then closed without keep-alive. On the device, upside down,
    // it played the "birdappclose" sound (:1280-1283, 2890-2891).
    signal angryCardClosed(string uid)
    function slingshot(card) {
        if (card.uid === pinnedUid) {
            flickAnimation.createObject(card, { target: card, closing: false, to: 0 }).start();
            return;
        }
        angryCardClosed(card.uid);
        _noKeepAlive[card.uid] = true;
        view.close(card.uid);
    }
    // Cards closed without keep-alive (the angry card, the app's own close).
    property var _noKeepAlive: ({})

    // A card the user cannot flick away (First Use's, Shell.firstUse): it
    // springs back. Phoenix addition.
    property string pinnedUid: ""

    // Throw a flicked card off the top and close it, or spring it back. One
    // animation per card, so several can go at once.
    function animateFlick(card, close) {
        if (close && card.uid !== pinnedUid)
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
