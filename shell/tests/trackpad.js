// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A trackpad's two-finger swipe as the platform delivers it (TrackpadSwipe),
// for the tests: wheel events with a pixel delta and scroll phases, sent
// through the window by Phoenix.Native's KeyInjector.sendWheel.
//
// swipe(test, injector, item, x, y, dx, dy, opts) at (x, y) in item moves
// the content by (dx, dy) in `steps` events `interval` ms apart:
//   ScrollBegin (no delta), ScrollUpdate * steps, then as macOS does when
//   the fingers lift (qnsview_mouse.mm): with `momentum` (a count of
//   events), the momentum carries on in the same direction (its first event
//   a ScrollUpdate, the fingers' ScrollEnd dropped; with `endBeforeMomentum`
//   the fingers' ScrollEnd comes first, and the momentum begins with a
//   ScrollBegin), then ScrollEnd; without, ScrollEnd at once. The swipe ends with its
//   phases; then a pause (`settle` ms, default 200) for what follows.
// Returns the number of events accepted. The surfaces under the same root
// take the tests' clock (useClock).

.pragma library

// The surfaces' clock (TrackpadSwipe.clock) while the tests swipe: it moves
// only as the events are sent, `interval` ms apart, so a busy machine's
// pauses between them change neither a swipe's speed nor the momentum's
// gaps; and with the scroll phases a swipe ends when they say, not after
// a pause. A swipe's events are a second after the last one's.
var time = 1000;
function clock() { return time; }
function useClock(item) {
    var top = item;
    while (top.parent)
        top = top.parent;
    (function walk(o) {
        if (o.hasOwnProperty("momentumGap") && o.hasOwnProperty("clock"))
            o.clock = clock;
        for (var i = 0; i < o.children.length; ++i)
            walk(o.children[i]);
    })(top);
}

function swipe(test, injector, item, x, y, dx, dy, opts) {
    opts = opts || {};
    var n = opts.steps || 10, interval = opts.interval || 8, m = opts.momentum || 0;
    var accepted = 0;
    useClock(item);
    time += 1000;
    function send(px, py, phase) {
        var p = Qt.point(Math.round(px), Math.round(py));
        if (injector.sendWheel(item, x, y, p, Qt.point(p.x * 2, p.y * 2), phase, true))
            ++accepted;
    }
    send(0, 0, Qt.ScrollBegin);
    for (var i = 0; i < n; ++i) {
        time += interval;
        send(dx / n, dy / n, Qt.ScrollUpdate);
        test.wait(interval);
    }
    if (m > 0) {
        if (opts.endBeforeMomentum)
            send(0, 0, Qt.ScrollEnd);
        for (var k = 0; k < m; ++k) {
            // Decaying, as the system's momentum does, from the swipe's pace.
            var f = Math.pow(0.85, k + 1);
            var phase = k === 0 ? (opts.endBeforeMomentum ? Qt.ScrollBegin : Qt.ScrollUpdate) : Qt.ScrollMomentum;
            // The momentum's first event comes with the fingers' end, at once.
            if (k > 0)
                time += interval;
            send(dx / n * f, dy / n * f, phase);
            test.wait(interval);
        }
    }
    send(0, 0, Qt.ScrollEnd);
    test.wait(opts.settle !== undefined ? opts.settle : 200);
    return accepted;
}

// A mouse wheel's notch (angleDelta only, no phase), as xdotool's buttons
// 4-7 give: dx, dy in notches (+1 up / left).
function notch(test, injector, item, x, y, dx, dy) {
    useClock(item);
    time += 1000;
    return injector.sendWheel(item, x, y, Qt.point(0, 0), Qt.point(dx * 120, dy * 120), Qt.NoScrollPhase, false);
}
