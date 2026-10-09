// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A trackpad's two-finger swipe and a mouse wheel over a surface (Phoenix:
// webOS had only the touch screen). Card view's handling (CardView.qml),
// shared by the surfaces that move as it does: the clip strip, the
// launcher's pages, the notification rows and lists.
//
// A swipe (wheel events with a pixel delta) locks to an axis as a finger
// does (horizontalLockRatio, past lockDistance), then follows the content
// the way the system scrolls (natural scrolling or not). It ends when the
// fingers lift: the scroll phase says so (ScrollEnd, or the momentum that
// follows), or the events stop for wheelGestureEndDelay. The surface then
// settles at once, as from a finger's release, and the momentum the system
// sends after the lift is ignored so the settled content is not pulled
// back and forth. A vertical swipe that scrolls a list (verticalMomentum)
// instead follows the momentum to its end, as a list scrolls on the Mac.
//
// Momentum on macOS (qtbase src/plugins/platforms/cocoa/qnsview_mouse.mm,
// scrollWheel:): the fingers' NSEventPhaseEnded is dropped when a momentum
// phase is seen queued behind it; the momentum begins as a ScrollUpdate
// (or a ScrollBegin when it was not seen), goes on as ScrollMomentum and
// ends with ScrollEnd. A mouse wheel, and X11's wheel buttons (xdotool),
// send angleDelta notches with no pixel delta and no phase: notched().
//
// The surface listens to:
//   started(x, y)    the swipe locked to `axis` ("h" or "v") at (x, y); set
//                    axis = "done" to swallow the rest of it, or "pass" to
//                    let it through to what is underneath
//   moved(dx, dy)    the content moves by (dx, dy) pixels; the first move
//                    carries everything since the swipe began; sumX and
//                    sumY hold the whole swipe
//   ended()          the fingers lifted (vx, vy: the speed, pixels per ms)
//   notched(dx, dy, event)  a mouse wheel's notch (angleDelta, 120 a notch);
//                    event.accepted = false lets it through
// and settleTarget(start, position) picks the page, card or clip a
// sideways swipe settles on, as card view's stacks do.

import QtQuick

MouseArea {
    id: area
    acceptedButtons: Qt.NoButton

    // A function returning true while the surface takes no wheel events
    // (a finger is down on it, say): they go through to what is beneath.
    property var blocked: null
    property real lockDistance: Theme.tapRadius
    // A vertical swipe goes on with the momentum after the fingers lift.
    property bool verticalMomentum: false

    property string axis: ""          // "", "h", "v", "done" or "pass"
    property real sumX: 0
    property real sumY: 0
    property real lastTime: 0
    property real vx: 0
    property real vy: 0
    property real startX: 0
    property real startY: 0
    // After a swipe: the momentum that follows it is ignored until the
    // events stop or a new swipe begins.
    property bool settling: false
    property real endedAt: 0
    // ms after a swipe's end within which a ScrollBegin is its momentum.
    property int momentumGap: 50
    // When the fingers of a list's scroll lifted (0: not yet).
    property real liftedAt: 0
    // The swipe's events carry scroll phases (a Mac trackpad): it ends
    // when they say so; the pause that ends a swipe without phases
    // (wheelGestureEndDelay) only guards against an end that never comes.
    property bool phased: false
    property int phasedEndDelay: 2000
    // The time in ms, for the swipe's speed and the momentum's gaps
    // (a test sets its own clock, so how busy the machine is does not
    // change what a swipe was).
    property var clock: null
    function now() { return clock ? clock() : Date.now(); }

    signal started(real x, real y)
    signal moved(real dx, real dy)
    signal ended()
    signal notched(real dx, real dy, var event)

    Timer {
        id: gestureEnd
        interval: area.phased ? area.phasedEndDelay : Theme.wheelGestureEndDelay
        onTriggered: area.finish()
    }
    Timer {
        id: settleEnd
        interval: Theme.wheelGestureEndDelay
        onTriggered: area.settling = false
    }

    onWheel: (e) => {
        if (area.blocked && area.blocked()) {
            e.accepted = false;
            return;
        }
        var momentum = e.phase === Qt.ScrollMomentum, end = e.phase === Qt.ScrollEnd;
        // A list scrolling on with the momentum: until the events stop, a
        // mouse wheel turns, or the fingers come down again (a ScrollBegin
        // later than momentumGap after the fingers' ScrollEnd).
        if (axis === "v" && verticalMomentum) {
            var notch = e.phase === Qt.NoScrollPhase && e.pixelDelta.x === 0 && e.pixelDelta.y === 0;
            var again = e.phase === Qt.ScrollBegin && liftedAt > 0 && now() - liftedAt > momentumGap;
            if (notch || again) {
                finish();
            } else {
                if (end)
                    liftedAt = now();
                else
                    swipe(e.x, e.y, e.pixelDelta.x, e.pixelDelta.y);
                return;
            }
        }
        // Fingers down again: a new swipe, whatever is still settling. Not
        // the momentum begun as a ScrollBegin right after the fingers'
        // ScrollEnd: fingers cannot lift and land again that quickly.
        if (e.phase === Qt.ScrollBegin && !(settling && now() - endedAt < momentumGap))
            settling = false;
        // A mouse wheel's notch is no momentum: it is not ignored.
        if (e.phase === Qt.NoScrollPhase && e.pixelDelta.x === 0 && e.pixelDelta.y === 0)
            settling = false;
        if (settling) {
            settleEnd.restart();
            return;
        }
        if (axis === "pass") {
            gestureEnd.restart();
            e.accepted = false;
            if (end)
                finish();
            return;
        }
        // The fingers lifted: momentum (or the end) follows.
        if (axis !== "" && (momentum || end)) {
            finish();
            return;
        }
        if (momentum || end)
            return;
        if (e.pixelDelta.x === 0 && e.pixelDelta.y === 0) {
            if (axis === "" && (e.angleDelta.x !== 0 || e.angleDelta.y !== 0))
                notched(e.angleDelta.x, e.angleDelta.y, e);
            return;
        }
        phased = e.phase !== Qt.NoScrollPhase;
        swipe(e.x, e.y, e.pixelDelta.x, e.pixelDelta.y);
        if (axis === "pass")
            e.accepted = false;
    }

    // One step of a two-finger swipe at (x, y), moving the content by
    // (dx, dy) pixels. time: when it happened, in ms (tests give their own
    // clock; the default is now).
    function swipe(x, y, dx, dy, time) {
        gestureEnd.restart();
        var t = time === undefined ? now() : time;
        if (lastTime > 0 && t > lastTime) {
            // Smoothed: trackpad events come unevenly.
            vx = 0.6 * dx / (t - lastTime) + 0.4 * vx;
            vy = dy / (t - lastTime);
        }
        lastTime = t;
        sumX += dx;
        sumY += dy;
        if (axis === "") {
            // Lock to an axis as a finger does (horizontalLockRatio).
            if (sumX * sumX + sumY * sumY < lockDistance * lockDistance)
                return;
            axis = Math.abs(sumX) > Theme.horizontalLockRatio * Math.abs(sumY) ? "h" : "v";
            startX = x;
            startY = y;
            started(x, y);
            if (axis === "h" || axis === "v")
                moved(sumX, sumY);
            return;
        }
        if (axis === "h" || axis === "v")
            moved(dx, dy);
    }

    // The fingers lifted: the surface settles.
    function finish() {
        gestureEnd.stop();
        endedAt = now();
        var was = axis;
        if (was === "h" || was === "v")
            ended();
        if (was !== "" && was !== "pass" && !(was === "v" && verticalMomentum)) {
            settling = true;
            settleEnd.restart();
        }
        axis = "";
        liftedAt = 0;
        phased = false;
        sumX = 0;
        sumY = 0;
        lastTime = 0;
        vx = 0;
        vy = 0;
    }

    // Where a sideways swipe that began at index `start` and is now at the
    // fractional index `pos` (rising as the content moves left) settles: a
    // quick one goes on to the next (as a finger's flick); otherwise the one
    // it was heading for once it is past a third of the way there, not the
    // nearest, so a swipe that stops between two does not drift back.
    function settleTarget(start, pos) {
        var from = Math.round(start);
        var dir = pos > start + 0.001 ? 1 : pos < start - 0.001 ? -1 : 0;
        if (Math.abs(vx) > Theme.wheelFlickVelocity && Math.round(pos) === from)
            return from + (vx < 0 ? 1 : -1);
        if (dir > 0)
            return Math.floor(pos) + (pos - Math.floor(pos) > 0.35 ? 1 : 0);
        if (dir < 0)
            return Math.ceil(pos) - (Math.ceil(pos) - pos > 0.35 ? 1 : 0);
        return Math.round(pos);
    }

    // Scrolls a vertical Flickable by dy content pixels, within its bounds.
    function scrollBy(flick, dy) {
        if (!flick)
            return;
        var top = flick.originY - flick.topMargin;
        var bottom = Math.max(top, flick.originY + flick.contentHeight + flick.bottomMargin - flick.height);
        flick.contentY = Math.max(top, Math.min(bottom, flick.contentY - dy));
    }
}
