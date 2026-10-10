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
    // The part of the bottom inset that is the virtual keyboard's: a window
    // that does not resize for it (PalmSystem.allowResizeOnPositiveSpaceChange
    // (false), the card model's allowResize) keeps that much more height,
    // the keyboard over its bottom (CardWindowManagerState::resizeWindow,
    // CardWindowManagerStates.cpp:85-98: adjustForPositiveSpaceSize in place
    // of a resize).
    property real keyboardOverlap: 0

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
            // A modal card is in no stack (CardWindowManager.cpp:524-549).
            if (closing[c.uid] || c.uid === waitingUid || c.modal === true)
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
        // The widest card the devices had, in legacy px: a Pre 3 on its
        // side (800 at 1.5), a TouchPad on its side.
        maxCardWidth: Theme.tablet ? 1024 : 533,
        gap: Theme.gapBetweenCards,
        position: position,
        fan: fanPositions,
        focus: groupFocus,
        maximize: maximizeProgress,
        stackMaximize: _stackOwn ? stackProgress : maximizeProgress,
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
        onTriggered: {
            view.layoutAnimationDuration = 0;
            view._fanEaseUids = ({});
            if (view._restoreAfterClose)
                view._restoreToMaximized();
        }
    }

    // ---- Public API -------------------------------------------------------------------

    function indexOf(uid) {
        var n = source ? source.cards.count : 0;
        for (var i = 0; i < n; ++i)
            if (source.cards.get(i).uid === uid)
                return i;
        return -1;
    }

    // Settings > Advanced (docs/M6-PLAN.md F4; LunaCE's Tweaks): card view
    // wraps from the last stack to the first and back (infinite card
    // cycling, abh_features.json "infiniteCardCyclingEnabled"), and a tap on
    // a stack beside the centre one maximizes its card at once instead of
    // bringing it to the centre (maximize-edges.json
    // "sysUiEnableMaximizeEdges"). Both off, as in LunaCE.
    property bool infiniteCycling: false
    property bool maximizeEdges: false
    // A stack index one past either end, wrapped round when cycling.
    function wrapGroup(i) {
        if (!infiniteCycling || groupCount < 2)
            return i;
        if (i === groupCount)
            return 0;
        if (i === -1)
            return groupCount - 1;
        return i;
    }

    // duration: the trackpad's quicker settle (Theme.wheelSettleDuration).
    function slideTo(groupIndex, duration) {
        slideAnim.stop();
        slideAnim.to = Math.max(0, Math.min(groupCount - 1, wrapGroup(groupIndex)));
        slideAnim.duration = duration !== undefined ? duration : Theme.cardSlideDuration;
        slideAnim.start();
    }

    function maximize(uid) {
        if (uid === undefined)
            uid = currentUid;
        var g = groupIndexOf(uid);
        if (g < 0)
            return;
        if (modalUid !== "" && uid !== modalParentUid)
            dismissModal("switched", false);
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
        // With a modal card up the gesture only takes it away, faded, and
        // its parent stays maximized (minimizeActiveWindow with
        // m_addingModalWindow, CardWindowManager.cpp:1151-1164).
        if (modalUid !== "") {
            dismissModal("minimized", true);
            return;
        }
        cancelRise();
        restoreUid = "";
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
        // Cycling, past the last card is the first (and back).
        var after = wrapGroup(g + 1), before = wrapGroup(g - 1);
        if (toRight)
            next = i < uids.length - 1 ? uids[i + 1] : after >= 0 && after < groupCount && after !== g ? groups[after].uids[0] : "";
        else
            next = i > 0 ? uids[i - 1] : before >= 0 && before < groupCount && before !== g
                                        ? groups[before].uids[groups[before].uids.length - 1] : "";
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
        restoreUid = "";
        dismissModal("switched", false);
        if (maximized) {
            cardMinimized(currentUid);
            maximize(next);
        } else {
            setFocus(next);
            slideTo(groupIndexOf(next));
        }
        return true;
    }

    // Back in an app another one opened (the window source's
    // cardReturnRequested: Photos from the Assistant's thumbnails, Maps on a
    // place): fromUid, maximized, goes back into card view, then the card
    // that opened it maximizes again, as LunaSysMgr re-maximized the card
    // that launched a child once card view settled (restoreCardToMaximized,
    // CardWindowManager.cpp:2812-2821, from MinimizeState::animationsFinished,
    // CardWindowManagerStates.cpp:158-165); the opened app slides off over
    // it, as the cards in front of a maximizing card do. It stays open (the
    // owner), and once the caller fills the screen it is moved behind it in
    // the stack, out of sight: in card view it is the card behind the
    // conversation, not in front of it.
    property var _returning: null
    function returnTo(uid, fromUid) {
        var g = groupIndexOf(uid);
        if (g < 0)
            return;
        _returning = null;
        restoreUid = "";
        dismissModal("switched", false);
        if (!maximized || currentUid !== fromUid) {
            maximize(uid);
            return;
        }
        cancelRise();
        maximizeAnim.stop();
        maximizeAnim.to = 0;
        maximizeAnim.duration = Theme.cardMinimizeDuration;
        maximizeAnim.start();
        cardMinimized(fromUid);
        _returning = { uid: uid, from: fromUid, step: "minimize" };
    }
    function _returnStep() {
        var r = _returning;
        if (!r)
            return;
        if (r.step === "minimize") {
            // Touched meanwhile (another card maximized, a swipe): theirs.
            if (maximizeProgress > 0 || groupIndexOf(r.uid) < 0) {
                _returning = null;
                return;
            }
            r.step = "maximize";
            maximize(r.uid);
            return;
        }
        _returning = null;
        var g = groupIndexOf(r.uid);
        if (g < 0 || g !== groupIndexOf(r.from) || currentUid !== r.uid || maximizeProgress < 0.999)
            return;
        var uids = groups[g].uids;
        var ku = uids.indexOf(r.uid), kf = uids.indexOf(r.from);
        if (kf > ku) {
            layoutAnimationDuration = 0;
            source.moveCard(groups[g].start + kf, groups[g].start + ku);
        }
    }
    // Each step when the one before has run its course (not when stopped:
    // another maximize or minimize took over, and the next step's checks
    // drop the rest).
    Connections {
        target: maximizeAnim
        function onFinished() { if (view._returning) view._returnStep(); }
    }

    // Jump straight to card view on a stack, without animating.
    function jumpTo(groupIndex) {
        cancelRise();
        _cancelWait();
        restoreUid = "";
        slideAnim.stop();
        maximizeAnim.stop();
        maximizeProgress = 0;
        position = Math.max(0, Math.min(groupCount - 1, groupIndex));
    }

    // Show a freshly launched (or re-launched) card maximized.
    function focusLaunched(uid) {
        // The card in front, maximized, when the new card is launched
        // (activeWin, focused: prepareAddWindowSibling).
        var front = maximized && currentUid !== uid ? currentUid : "";
        restoreUid = "";
        // A card added without rising (opened behind the card asking for
        // it, {behind: true}) has taken its place in the stack: when it is
        // brought forward later it maximizes from there, not rises again.
        for (var k in _newCards) {
            if (k !== uid) {
                // Opened behind the card that kept the front ({behind},
                // Phoenix): when that card brings it forward, that is its
                // launch, put off (see restoreUid).
                _openedBehind[k] = uid;
                delete _newCards[k];
            }
        }
        var opener = _openedBehind[uid];
        delete _openedBehind[uid];
        if (_newCards[uid]) {
            if (indexOf(uid) < 0)
                return;
            delete _newCards[uid];
            // One card prepares at a time: one still waiting goes ahead now.
            if (waitingUid !== "")
                _endWait();
            // A new card takes the front from a modal card
            // (CardWindowManager.cpp:507-528, ActiveCardsSwitched).
            dismissModal("switched", false);
            slideAnim.stop();
            // Launched by the card in front into its stack: that card comes
            // back when this one closes while maximized (C8, C12).
            var i = indexOf(uid), j = indexOf(front);
            if (front !== "" && j >= 0 && source.cards.get(i).groupId === source.cards.get(j).groupId)
                restoreUid = front;
            // CardWindow::delayPrepare (CardWindow.cpp:1395-1400): nothing
            // happens for cardPrepareAddDuration (150 ms); then the window
            // is prepared (loadingTimeout, :1452-1494: prepareAddWindow, and
            // at once addWindow if the app is ready by then).
            waitingUid = uid;
            prepareTimer.restart();
            return;
        }
        var g = groupIndexOf(uid);
        if (g < 0)
            return;
        if (opener !== undefined && opener === front && groupIndexOf(front) === g)
            restoreUid = front;
        slideAnim.stop();
        setFocus(uid);
        position = g;
        maximizeAnim.stop();
        maximizeAnim.to = 1;
        maximizeAnim.duration = Theme.cardLaunchDuration;
        maximizeAnim.start();
        cardMaximized(uid);
    }

    // ---- A new card is prepared and rises (CardWindow::delayPrepare,
    // loadingTimeout; CardWindowManager::prepareAddWindowSibling,
    // setActiveCardOffScreen, PreparingState, LoadingState,
    // addWindowTimedOutNormal, maximizeActiveWindow) --------------------------
    // For the first 150 ms (cardPrepareAddDuration) the new card is not
    // there yet: nothing moves, the card in front stays as it is. Then it is
    // prepared: the card in front zooms out to card view while the stacks
    // slide so the new card's stack is centred (slideAllGroups, 300 ms); the
    // new card waits full size just below the screen, in its launcher's
    // stack when the app in front opened it, its loading screen on
    // (startLoadingOverlay). As soon as the app is ready (already, or later)
    // it rises to maximized (PreparingState::windowAdded ->
    // maximizeActiveWindow; the zoom out need not have ended). If it is not
    // ready cardAddMaxDuration (750 ms) after the prepare, it slides into its
    // place in the stack showing its loading screen instead, and maximizes
    // once the app is ready. A touch after the prepare stays in card view
    // (PreparingState/LoadingState::handleTouchBegin).
    property string risingUid: ""
    // The new card in its prepare step: not in the stacks yet, not shown.
    property string waitingUid: ""
    // The card waiting in card view for its app (LoadingState).
    property string loadingUid: ""
    readonly property bool preparing: riseTimeout.running
    property bool _inPrepare: false
    property var _newCards: ({})
    property var _openedBehind: ({})
    Connections {
        target: cards
        function onItemAdded(index, item) { view._newCards[item.uid] = true; }
    }
    Timer {
        id: prepareTimer
        interval: Theme.cardPrepareAddDuration
        onTriggered: view._endWait()
    }
    function _endWait() {
        prepareTimer.stop();
        var uid = waitingUid;
        if (uid === "")
            return;
        // Below the screen as it appears, not for a moment in its stack.
        riseTimeout.stop();
        loadingUid = "";
        risingUid = uid;
        waitingUid = "";
        var g = groupIndexOf(uid);
        if (g < 0) {
            risingUid = "";
            return;
        }
        _prepareRise(uid, g);
    }
    function _cancelWait() {
        prepareTimer.stop();
        waitingUid = "";
    }

    function _prepareRise(uid, g) {
        riseTimeout.stop();
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
        loadingUid = risingUid;
        animateLayout(Theme.cardSlideDuration);
        risingUid = "";
    }
    function cancelRise() {
        riseTimeout.stop();
        risingUid = "";
        loadingUid = "";
    }
    Timer {
        id: riseTimeout
        interval: Theme.cardAddMaxDuration
        onTriggered: view._slideInLoading()
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
    // The card in front, maximized (its app closed it, or the close
    // shortcut), slides straight up off the top at full size over the same
    // 300 ms OutCubic (removeWindowNoModality, CardWindowManager.cpp:
    // 672-696), and the rest go back to card view from where they are
    // (MaximizeState::windowRemoved -> removeCardFromGroupMaximized:
    // signalMinimizeActiveWindow, removeCardFromGroup -> slideAllGroups,
    // :994-1047; the stack's own cards over 200 ms OutCubic, the other
    // stacks over 300 ms). The card next to it in its stack becomes the
    // stack's active card (CardGroup::removeFromGroup, CardGroup.cpp:196-212).
    // If the card was opened by the card that was in front when it was
    // launched (and joined its stack), that card maximizes again once card
    // view has settled (restoreCardToMaximized, :2812-2821, from
    // MinimizeState::animationsFinished, CardWindowManagerStates.cpp:158-165).
    function close(uid, byApp) {
        if (closing[uid])
            return;
        if (uid !== "" && uid === modalUid) {
            // The modal card closed itself (or was closed): it goes at once
            // (removeWindowWithModality, ModalWindowDismissedExternally).
            cardClosing(uid, !!byApp);
            dismissModal("closed", false);
            cardClosed(uid);
            return;
        }
        // Its parent closed: the modal card goes first, at once
        // (ParentCardDismissed, CardWindowManager.cpp:2840-2852).
        if (uid !== "" && uid === modalParentUid)
            dismissModal("parentClosed", false);
        if (uid === waitingUid) {
            // Closed before it was shown (still in its prepare step).
            _cancelWait();
            if (byApp)
                _noKeepAlive[uid] = true;
            cardClosing(uid, !!byApp);
            source.close(uid, !!_noKeepAlive[uid]);
            delete _noKeepAlive[uid];
            cardClosed(uid);
            return;
        }
        var g = groupIndexOf(uid);
        if (g < 0)
            return;
        // The app closed its own window: no keep-alive for it.
        if (byApp)
            _noKeepAlive[uid] = true;
        cardClosing(uid, !!byApp);
        var place = layout.cards[uid];
        var card = cardItem(uid);
        var inFront = uid === currentUid && maximizeProgress > 0;
        if (inFront && risingUid === uid)
            inFront = false;
        var fly = card && place && (maximizeProgress === 0 || inFront);
        var group = groups[g];
        var k = group.uids.indexOf(uid);
        var stackSurvives = group.uids.length > 1;
        var wasLastGroup = g === groupCount - 1;
        if (inFront) {
            _closeInFront(uid, place, g, group, k, stackSurvives, wasLastGroup);
        } else {
            // The neighbouring card in the stack takes focus.
            if (stackSurvives && focusOf(group) === uid)
                setFocus(group.uids[k > 0 ? k - 1 : 1]);
            animateLayout(fly ? Theme.cardDeleteDuration : Theme.cardShuffleReorderDuration);
            var c = Object.assign({}, closing);
            c[uid] = place || { cx: width / 2, cy: cardOriginY, scale: activeScale, rot: 0, z: 0, focused: false };
            closing = c;
            if (!stackSurvives) {
                if (wasLastGroup && position > 0)
                    slideTo(groupCount - 1);
                else if (g < position)
                    position = Math.max(0, position - 1);
            }
        }
        if (fly)
            flickAnimation.createObject(card, { target: card, closing: true,
                                                to: -(place.cy + card.height * place.scale / 2) }).start();
        else
            _finishClose(uid);
    }

    // ---- Modal cards (CardWindowManager::prepareAddWindow, :499-550;
    // CardWindow::setModalParent, positionModalWindowWrpParent,
    // CardWindow.cpp:1842-1866; the parent's 60 % shade, :1593-1599) --------
    // An app the maximized card launched as a modal window
    // (com.palm.systemmanager/launchModalApp) shows over it, 320 x 480,
    // centred on it in the screen's positive space, the parent dimmed under
    // 60 % of #0f0f0f and its touches going to the modal card. It is in no
    // stack and never in card view: the minimize gesture takes it away
    // (faded over 45 ms, kModalWindowAnimationTimeout) and leaves the parent
    // maximized; switching cards, a new card, the parent closing, or its app
    // dismissing it take it away at once (notifySysControllerOfModalStatus,
    // :3130-3175, performPostModalWindowRemovedActions, :914-990).
    property string modalUid: ""
    // The window keys and Back go to: the modal card while it is up, else
    // the card in front (CardWindowManager::activeWindow, :2970-2982).
    readonly property string activeUid: modalUid !== "" && !modalFading ? modalUid : currentUid
    readonly property string modalParentUid: {
        revision;
        var i = indexOf(modalUid);
        return i >= 0 ? (source.cards.get(i).modalParent || "") : "";
    }
    property bool modalFading: false
    readonly property real modalWidth: Math.min(windowWidth, Theme.px(Theme.modalCardWidth))
    // The positive space the modal card is placed in: where the space is
    // going (SystemUiController's target, which positiveSpaceAboutToChange
    // carries), not where its slide is (bottomInset). Set by the shell;
    // the window area otherwise.
    property real positiveSpaceTarget: windowHeight
    // When the positive space changes (the keyboard coming or going, a
    // banner, the dashboard), the modal card is placed again in the new
    // space: centred in it, and no taller than it, never past 480
    // (CardWindow::computeModalWindowPlacementInf, positionModalForLess /
    // MorePositiveSpace, decrease / increaseHeightAndPositionModalCard,
    // CardWindow.cpp:1868-2172). Its height changes at once
    // (resizeModalCard, :2218-2239); it moves to its new place over 500 ms
    // OutCubic (startModalAnimation, :2195-2216: sModalCardAnimationTimeout,
    // :75, cardDeleteCurve 6), started as the space starts to change
    // (CardWindow::positiveSpaceChanged, :2254-2289, from the first step of
    // SystemUiController's slide). While the UI turns it is put there at
    // once (:2268-2272). The original's arithmetic in the parent's
    // coordinates comes down to that centre (the space above it is
    // (newPositiveSpace - height) / 2, and the height never exceeds the space).
    readonly property real modalHeight: Math.min(positiveSpaceTarget, Theme.px(Theme.modalCardHeight))
    readonly property real _modalRestY: topInset + positiveSpaceTarget / 2
    // Placed by _placeModal (no binding: the move must start from where
    // the card is).
    property real modalCenterY: 0
    readonly property bool modalMoving: modalMove.running
    on_ModalRestYChanged: _placeModal(!_uiResizing)
    // The UI turning (or the window resized sideways): no move, only the place.
    property bool _uiResizing: false
    onWidthChanged: {
        _uiResizing = true;
        _placeModal(false);
        Qt.callLater(function () { view._uiResizing = false; });
    }
    function _placeModal(animate) {
        modalMove.stop();
        if (modalUid !== "" && animate && !Theme.reduceMotion && Math.abs(modalCenterY - _modalRestY) >= 0.5) {
            modalMove.from = modalCenterY;
            modalMove.to = _modalRestY;
            modalMove.start();
        } else {
            modalCenterY = _modalRestY;
        }
    }
    NumberAnimation {
        id: modalMove
        target: view
        property: "modalCenterY"
        duration: Theme.modalCardMoveDuration
        easing.type: Easing.OutCubic
    }
    // The window source asks for a modal card (modalCardRequested): shown
    // if its parent is the maximized card and no other modal is up
    // (proceedToAddModalWindow, :425-466), else refused and closed.
    function addModal(uid) {
        var i = indexOf(uid);
        if (i < 0)
            return;
        var parent = source.cards.get(i).modalParent || "";
        var result = modalUid !== "" ? "anotherModalActive"
                   : !maximized || currentUid === "" ? "noMaximizedCard"
                   : currentUid !== parent ? "parentDifferent" : "launched";
        if (result !== "launched") {
            if (source && typeof source.modalResult === "function")
                source.modalResult(uid, result);
            source.close(uid, true);
            return;
        }
        modalFading = false;
        modalUid = uid;
        _placeModal(false);
        if (source && typeof source.modalResult === "function")
            source.modalResult(uid, "launched");
    }
    // Take the modal card away; why: the dismiss reason the window source
    // reports ("minimized", "switched", "parentClosed", "service", "closed").
    function dismissModal(why, animate) {
        if (modalUid === "" || modalFading)
            return;
        if (animate && !Theme.reduceMotion) {
            modalFading = true;
            modalFade.why = why;
            modalFade.restart();
            return;
        }
        _endModal(why);
    }
    function _endModal(why) {
        var uid = modalUid;
        if (uid === "")
            return;
        modalUid = "";
        modalFading = false;
        if (source && typeof source.modalResult === "function")
            source.modalResult(uid, why);
        if (indexOf(uid) >= 0)
            source.close(uid, true);
    }
    Timer {
        id: modalFade
        property string why: ""
        interval: Theme.modalCardFadeDuration
        onTriggered: view._endModal(why)
    }
    Connections {
        target: view.source
        ignoreUnknownSignals: true
        function onModalDismissRequested(uid) { if (uid === view.modalUid) view.dismissModal("service", true); }
    }

    // The card that launched the one in front, when that one joined its
    // stack (prepareAddWindowSibling: m_cardToRestoreToMaximized,
    // CardWindowManager.cpp:561-568); "" when there is none. Anything else
    // that takes the user elsewhere forgets it (disableCardRestoreToMaximized:
    // minimizeActiveWindow, another card being added, switching apps,
    // focusWindow; :551, 1144, 2225-2398, 2703). Phoenix: a card the card in
    // front opened behind itself ({behind}) and later brings forward counts
    // as launched by it then.
    property string restoreUid: ""
    property bool _restoreAfterClose: false
    // The cards of the stack that stays in front while a maximized card
    // closes: they ease to their places in the fan over 200 ms OutCubic
    // from wherever they are; the other stacks slide over 300 ms.
    property var _fanEaseUids: ({})

    function _closeInFront(uid, place, g, group, k, stackSurvives, wasLastGroup) {
        cancelRise();
        _returning = null;
        // The stack in front afterwards: this one, or (it was the stack's
        // only card) the next one, or the one before if it was the last.
        var nb = stackSurvives ? g : wasLastGroup ? g - 1 : g + 1;
        var stay = nb >= 0 && nb < groupCount ? groups[nb].uids : [];
        var ease = {};
        for (var i = 0; i < stay.length; ++i)
            if (stay[i] !== uid)
                ease[stay[i]] = true;
        // Everything eases from where it is drawn now: set before anything
        // moves.
        _fanEaseUids = ease;
        animateLayout(Theme.cardSlideDuration);
        // Where it is, kept as it slides away, over everything.
        var c = Object.assign({}, closing);
        c[uid] = Object.assign({}, place, { z: 4000 });
        closing = c;
        if (stackSurvives && focusOf(group) === uid)
            setFocus(group.uids[k > 0 ? k - 1 : 1]);
        maximizeAnim.stop();
        stackAnim.stop();
        slideAnim.stop();
        _stackOwn = false;
        position = Math.max(0, stackSurvives || !wasLastGroup ? g : g - 1);
        maximizeProgress = 0;
        _restoreAfterClose = restoreUid !== "";
        cardMinimized(uid);
        if (groupCount > 0 && source && typeof source.firstCardAlert === "function")
            source.firstCardAlert();
    }

    // Card view has settled after a maximized card closed: the card that
    // launched it, if it is in the stack in front, maximizes again.
    function _restoreToMaximized() {
        var r = restoreUid;
        _restoreAfterClose = false;
        restoreUid = "";
        if (r === "" || maximizeProgress !== 0 || maximizeAnim.running || groupIndexOf(r) !== currentGroup)
            return;
        maximize(r);
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
        if (waitingUid !== "" && indexOf(waitingUid) < 0)
            _cancelWait();
        if (modalUid !== "" && indexOf(modalUid) < 0) {
            var gone = modalUid;
            modalUid = "";
            modalFading = false;
            if (source && typeof source.modalResult === "function")
                source.modalResult(gone, "closed");
        } else if (modalUid !== "" && indexOf(modalParentUid) < 0) {
            dismissModal("parentClosed", false);
        }
        for (var b in _openedBehind)
            if (indexOf(b) < 0)
                delete _openedBehind[b];
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

    // The current stack's own cards on their way back into card view:
    // CardWindowManager::minimizeActiveWindow -> slideAllGroups moves the
    // stacks (the groups' x) over cardSlide, 300 ms OutQuart, but the cards
    // of the stack in front, the minimizing one among them, to their places
    // in the fan with CardGroup::animateOpen(200, OutCubic)
    // (CardWindowManager.cpp:1142-1160, 2481-2499). So the card is in its
    // place in the fan a third sooner, while the neighbouring stacks are
    // still sliding in. A maximize that takes over carries the cards on
    // from where they are, at its own pace.
    property real stackProgress: 0
    property bool _stackOwn: false
    NumberAnimation {
        id: stackAnim
        target: view; property: "stackProgress"
    }
    Connections {
        target: maximizeAnim
        function onStarted() {
            if (maximizeAnim.to === 0) {
                if (!view._stackOwn)
                    view.stackProgress = view.maximizeProgress;
                view._stackOwn = true;
                stackAnim.stop();
                stackAnim.to = 0;
                stackAnim.duration = Theme.cardFanDuration;
                stackAnim.easing.type = Easing.OutCubic;
                stackAnim.start();
            } else if (view._stackOwn) {
                stackAnim.stop();
                stackAnim.to = maximizeAnim.to;
                stackAnim.duration = maximizeAnim.duration;
                stackAnim.easing.type = maximizeAnim.easing.type;
                stackAnim.start();
            }
        }
        // Stopped, not restarted at once (maximize and minimize stop it
        // and start it again): the stack follows maximizeProgress again.
        function onRunningChanged() {
            if (!maximizeAnim.running)
                Qt.callLater(view._endStackOwn);
        }
    }
    function _endStackOwn() {
        if (maximizeAnim.running)
            return;
        stackAnim.stop();
        _stackOwn = false;
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
            // A modal card, over its parent; and the parent under it.
            readonly property bool modalCard: view.modalUid !== "" && view.modalUid === uid
            readonly property bool modalParent: view.modalUid !== "" && view.modalParentUid === uid
            readonly property Item parentCard: modalCard ? view.cardItem(view.modalParentUid) : null

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
            width: modalCard ? view.modalWidth : view.windowWidth
            // A window that does not resize for the keyboard: as tall as
            // before it came (only the focused card has it in front).
            readonly property real keepHeight: !modalCard && model.allowResize === false && place !== null && place.focused ? view.keyboardOverlap : 0
            height: modalCard ? view.modalHeight : view.windowHeight + keepHeight
            window: view.source.windowFor(uid)
            centerX: modalCard ? (parentCard ? parentCard.centerX : view.width / 2)
                     : (rising ? view.width / 2 : lifted ? view.reorderX : place ? place.cx : view.width / 2)
                       + (place && place.focused ? view.edgeNudge : 0)
            centerY: modalCard ? view.modalCenterY
                   : (rising ? view.mix(view.height + height / 2, view.maximizedCenterY, view.maximizeProgress)
                   : lifted ? view.reorderY : place ? place.cy : view.cardOriginY) + keepHeight * cardScale / 2
            cardScale: modalCard || rising ? 1 : lifted ? view.activeScale : place ? place.scale : view.activeScale
            rotation: modalCard || rising || lifted || !place ? 0 : place.rot
            rounded: modalCard || view.maximizeProgress < 1
            modalShade: modalParent
            appOrientation: model.orientation !== undefined && model.orientation !== "" ? model.orientation : "free"
            uiOrientation: view.uiOrientation
            uiPortrait: view.uiPortrait
            interactive: modalCard ? view.maximized : view.maximized && place !== null && place.focused && !modalParent
            dimmed: !modalCard && (place === null || !place.focused)
            reordering: lifted
            layoutAnimationDuration: lifted || view.closing[uid] || (rising && maximizeAnim.running) ? 0
                                     : view._fanEaseUids[uid] && view.layoutAnimationDuration > 0 ? Theme.cardFanDuration
                                     : view.layoutAnimationDuration
            z: modalCard ? 3500 : lifted || rising ? 3000 : place ? place.z : 0
            opacity: modalCard && view.modalFading ? 0 : reordering ? 0.8 : 1
            Behavior on opacity {
                enabled: cardDelegate.modalCard && view.modalFading
                NumberAnimation { duration: Theme.modalCardFadeDuration }
            }
            // In its prepare step the card is not there yet; its loading
            // screen starts when it is prepared (startLoadingOverlay,
            // CardWindow.cpp:1486-1490).
            prepared: view.waitingUid !== uid
            visible: (modalCard ? view.maximized || view.modalFading
                      : !(model.modal === true)) && prepared && centerX + width * cardScale / 2 > -view.width
                     && centerX - width * cardScale / 2 < view.width * 2
        }
    }

    // The UI is about to turn: the cards off screen keep their windows'
    // size until it has (Card.queueFlip; a window is on screen when it is
    // visible and inside the scene, HostWindow.cpp:152). Called before the
    // UI is resized (UiRotation.rotationStarting).
    function queueFlips() {
        for (var i = 0; i < cards.count; ++i) {
            var c = cards.itemAt(i);
            if (c && !cardOnScreen(c))
                c.queueFlip();
        }
    }
    function cardOnScreen(c) {
        if (!c.visible)
            return false;
        var w = c.width * c.cardScale, h = c.height * c.cardScale;
        var cy = c.centerY + c.flickOffset;
        return c.centerX + w / 2 > 0 && c.centerX - w / 2 < width && cy + h / 2 > 0 && cy - h / 2 < height;
    }
    // The turn is over: they resize now (WindowServer::rotatePendingWindows).
    function rotatePendingWindows() {
        for (var i = 0; i < cards.count; ++i) {
            var c = cards.itemAt(i);
            if (c)
                c.flip();
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
                    // Each move sends the stack's cards to their new places
                    // over 200 ms OutCubic from wherever they are
                    // (adjustHorizontally, then slideAllGroups ->
                    // animateOpen(200, OutCubic): CardWindowManager.cpp:
                    // 1482-1490, 2495): the fan eases after the finger.
                    var fanTarget = CardLayout.clampFanPosition(fanBefore - stepX / fanUnit(),
                                                                view.groups[view.currentGroup].uids.length);
                    if (stepX !== 0 && fanTarget !== fanBefore)
                        view.animateLayout(Theme.cardFanDuration);
                    if (stepX !== 0)
                        setCurrentFan(fanBefore - stepX / fanUnit());
                    var moved = currentFan() - fanBefore;
                    var wanted = stepX !== 0 ? -stepX / fanUnit() : 0;
                    if (stepX !== 0 && Math.abs(moved - wanted) > 1e-6) {
                        f.withinGroup = false;
                        f.panFrom = view.position;
                        f.panX = (wanted - moved) * fanUnit();
                        // From here the stacks follow the finger directly
                        // (slideAllGroupsOnTouchUpdate, :1372-1396).
                        layoutAnimTimer.stop();
                        view.layoutAnimationDuration = 0;
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
                // Upside down, pulled past 15 % of the screen's height, it
                // creaks, once a drag (kAngryCardThreshold, :266; :1523-1527).
                if (!f.stretched && dy > view.height / 2 * 0.30 && view.playAngryCardSounds) {
                    f.stretched = true;
                    view.feedbackSound("carddrag");
                }
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
                    // CardWindowManager.cpp:2162-2165: setActiveCard, then
                    // moveToActiveCard (the fan centred on the tapped card,
                    // CardGroup::moveToActiveCard), then maximize; minimized
                    // again, it comes back centred. (Four cards or fewer:
                    // the fan cannot move, clampFanPosition.)
                    setCurrentFan(grp.uids.indexOf(uid));
                    view.maximize(uid);
                } else {
                    view.animateLayout(Theme.cardSlideDuration);
                    setCurrentFan(t.fan);
                    view.slideTo(g);
                }
            } else if (g >= 0) {
                // A side card (Settings > Advanced): maximized at once.
                if (view.maximizeEdges)
                    view.maximize(uid);
                else
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
    // A mouse wheel moves one stack per notch. TrackpadSwipe holds the
    // swipe's handling, shared with the other surfaces that move this way.
    TrackpadSwipe {
        id: wheel
        objectName: "cardWheel"
        anchors.fill: parent
        enabled: touch.enabled
        blocked: function () { return touch.fingerCount() > 0 || view.preparing; }

        property string uid: ""
        property real startPosition: 0
        property real startFan: 0

        onNotched: (dx, dy) => {
            // A mouse wheel: one stack per notch.
            var d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
            if (d !== 0)
                view.slideTo(view.currentGroup + (d < 0 ? 1 : -1));
        }
        onStarted: (x, y) => {
            if (axis === "h") {
                slideAnim.stop();
                startPosition = view.position;
                startFan = touch.currentFan();
            } else {
                var g = view.groups[view.currentGroup];
                uid = touch.cardAt(x, y) || (g ? view.focusOf(g) : "");
                if (uid === "")
                    axis = "done";
            }
        }
        onMoved: {
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
            } else {
                var c = view.cardItem(uid);
                // Up it goes; pulled down it gives a little and comes back.
                if (c)
                    c.flickOffset = sumY < 0 ? sumY : sumY / 3;
            }
        }
        // The fingers lifted: settle as a finger's release does, at once.
        onEnded: {
            if (axis === "h") {
                view.slideTo(settleTarget(startPosition, view.position), Theme.wheelSettleDuration);
            } else {
                var c = view.cardItem(uid);
                if (c)
                    view.animateFlick(c, touch.shouldClose(c, Math.min(vy, 0))
                                         || c.flickOffset < -view.windowHeight * view.activeScale / 3);
            }
            uid = "";
        }
    }

    // The angry card is slung from the bottom of the screen up and off the
    // top (closeWindow always throws cards off the top: CardWindowManager.cpp
    // 2866-2878), then closed without keep-alive. On the device, upside down,
    // it played the "birdappclose" sound (:1280-1283, 2890-2891).
    signal angryCardClosed(string uid)
    // CardWindowManager::playAngryCardSounds (:1280-1283): only with the UI
    // upside down. feedbackSound: one of the angry card's sounds to play.
    readonly property bool playAngryCardSounds: uiOrientation === "down"
    signal feedbackSound(string name)
    property string _angryUid: ""
    function slingshot(card) {
        if (card.uid === pinnedUid) {
            flickAnimation.createObject(card, { target: card, closing: false, to: 0 }).start();
            return;
        }
        // It flies with "birdappclose" instead of "appclose" (:2890-2893).
        _angryUid = playAngryCardSounds ? card.uid : "";
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
