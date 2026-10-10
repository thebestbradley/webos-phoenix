// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Card stack geometry, ported from Open webOS luna-sysmgr
// Src/lunaui/cards/CardGroup.cpp and CardWindowManager.cpp.
//
// Pure functions: given the stacks (groups) and the view state, return where
// every card goes. CardView binds its delegates to the result.

.pragma library

function mix(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// How far the fan inside a stack can scroll (CardGroup.cpp:776-791):
// one card 0, two cards 0.5, three or four cards 1, more [1, n - 3].
function clampFanPosition(pos, n) {
    if (n <= 1) return 0;
    if (n === 2) return 0.5;
    if (n <= 4) return 1.0;
    return clamp(pos, 1, n - 3);
}

// A tap on card k of the open stack (n cards, fan position pos): maximize
// it, or scroll the fan when the card is too buried to be meant
// (CardGroup::shouldMaximizeOrScroll, CardGroup.cpp:400-474; four cards
// stay put, kMaxStationaryCards). Returns {maximize: true} or
// {maximize: false, fan: the new position}.
function tapOnFan(k, n, pos) {
    var S = 4;
    if (n <= S)
        return { maximize: true };
    if (pos > n - S) {
        if (k >= n - S)
            return { maximize: true };
        return { maximize: false, fan: clampFanPosition(pos - (S - 1), n) };
    }
    if (k <= pos) {
        if (k >= pos - 1)
            return { maximize: true };
        return { maximize: false, fan: clampFanPosition(pos - (S - 1), n) };
    }
    if (k <= pos + 2)
        return { maximize: true };
    return { maximize: false, fan: clampFanPosition(pos + (S - 1), n) };
}

// Offset of card k in an open (active) stack, relative to the stack origin.
// CardGroup::calculateOpenedPositions, CardGroup.cpp:699-740.
function openedOffset(k, pos, p) {
    var aw = p.cardWidth * p.activeScale;
    var x = ((k - pos) / 3.0) * aw * p.groupingFactor;
    var rOff = p.activeScale * 50 * p.u + aw;
    var lOff = -(p.activeScale * 100 * p.u);
    // Compress the far ends of long fans.
    if (x > rOff)
        x = (x + 4 * rOff) / 5;
    else if (x < lOff)
        x = (x + 4 * lOff) / 5;
    // The tilt and the drop as on a card no wider than the devices'
    // (p.maxCardWidth: a Pre 3 on its side, a TouchPad): the original's
    // formula is in its pixels, and a phone layout in a window as wide as a
    // tablet (phoenix-sim --phone, resized) turned the next card 16 degrees
    // and the one after 30 (the owner, 10 October 2026). Unchanged at the
    // devices' sizes.
    var t = p.maxCardWidth > 0 ? x * Math.min(1, p.maxCardWidth * p.u / p.cardWidth) : x;
    return {
        x: x,
        // Cards right of centre drop slightly and tilt clockwise.
        y: t > 0 ? t / 15 : 0,
        rot: (t / p.u) / (p.activeScale * p.rotFactor)
    };
}

// groups: [{ id, uids: [..] }] in screen order.
// p: {
//   viewWidth, cardWidth, cardHeight, u,
//   activeScale, nonActiveScale, groupingFactor, rotFactor, gap,
//   maxCardWidth,    the widest card the devices have, legacy px (the tilt's)
//   position,        fractional index of the stack at the centre
//   fan,             { groupId: fan position }
//   focus,           { groupId: uid of the stack's active card }
//   maximize,        0..1 for the current stack's active card
//   stackMaximize,   0..1 for the current stack's own cards, when they move
//                    on their own clock (a minimize: CardGroup::animateOpen,
//                    200 ms OutCubic, while the stacks slide over 300 ms;
//                    CardWindowManager.cpp:2490-2495); else maximize
//   originY, maximizedCenterY
// }
// Returns { cards: { uid: {cx, cy, scale, rot, z, group, k, focused} },
//           anchors: [..], columns: [{left, right}] (each stack's extent on
//           screen, CardGroup's m_leftWidth / m_rightWidth), currentGroup }
function compute(groups, p) {
    var G = groups.length;
    var result = { cards: {}, anchors: [], columns: [], currentGroup: -1 };
    if (G === 0)
        return result;

    var current = clamp(Math.round(p.position), 0, G - 1);
    result.currentGroup = current;
    var m = p.maximize;
    var ms = p.stackMaximize !== undefined ? p.stackMaximize : m;

    var laid = [];      // per group: [{x, y, scale, rot}]
    var lefts = [];
    var rights = [];

    // How open each stack is: CardGroup::calculateOpenedPositions(xOffset),
    // CardGroup.cpp:698-742. Every stack is laid out from its centre's
    // distance to the screen's centre (slideAllGroupsOnTouchUpdate, and
    // slideAllGroups' animateClose for the rest): open at the centre,
    // folding up linearly over one active card width, then fully folded,
    // its cards 10 px apart. The distance comes from the stacks' widths,
    // which come from how open they are: a first pass lays them out by
    // their index's distance, the second from where that put them (the
    // original also uses the widths of its previous layout).
    var aw = p.cardWidth * p.activeScale;
    // Set by layOut (declared first: Qt warned of their use before it).
    var anchors, scroll;
    function layOut(openness) {
        laid = []; lefts = []; rights = [];
        for (var g = 0; g < G; ++g) {
            var grp = groups[g];
            var n = grp.uids.length;
            var amt = openness(g);
            var pos = clampFanPosition(p.fan[grp.id] !== undefined ? p.fan[grp.id] : 1e9, n);
            var cards = [];
            var left = Infinity, right = -Infinity;
            for (var k = 0; k < n; ++k) {
                var o = openedOffset(k, pos, p);
                var c = {
                    x: o.x * amt + (1 - amt) * 10 * p.u * k,
                    y: o.y * amt,
                    scale: mix(p.nonActiveScale, p.activeScale, amt),
                    rot: o.rot * amt
                };
                var hw = p.cardWidth * c.scale / 2;
                left = Math.min(left, c.x - hw);
                right = Math.max(right, c.x + hw);
                cards.push(c);
            }
            // A maximizing card pushes its neighbours away as it grows.
            if (g === current && m > 0) {
                left = mix(left, -p.viewWidth / 2, m);
                right = mix(right, p.viewWidth / 2, m);
            }
            laid.push(cards);
            lefts.push(left);
            rights.push(right);
        }
        // Stacks sit side by side with a fixed gap between their bounds
        // (CardWindowManager.cpp:2501-2537).
        anchors = [0];
        for (g = 1; g < G; ++g)
            anchors.push(anchors[g - 1] + rights[g - 1] + p.gap - lefts[g]);
        scroll = anchorAt(p.position);
    }

    // Interpolate the scroll offset; extrapolate past the ends for rubber-banding.
    function anchorAt(t) {
        if (G === 1)
            return t * p.viewWidth;
        if (t <= 0)
            return anchors[0] + t * (anchors[1] - anchors[0]);
        if (t >= G - 1)
            return anchors[G - 1] + (t - (G - 1)) * (anchors[G - 1] - anchors[G - 2]);
        var i = Math.floor(t);
        return mix(anchors[i], anchors[i + 1], t - i);
    }
    function amountOpen(offset) {
        return Math.max(1, aw - Math.abs(offset)) / aw;
    }

    layOut(function (g) { return amountOpen((g - p.position) * aw); });
    var offsets = [];
    for (var g = 0; g < G; ++g)
        offsets.push(anchors[g] - scroll);
    layOut(function (g) { return amountOpen(offsets[g]); });
    result.anchors = anchors;

    for (g = 0; g < G; ++g) {
        var at = p.viewWidth / 2 + anchors[g] - scroll;
        result.columns.push({ left: at + lefts[g], right: at + rights[g] });
    }

    for (g = 0; g < G; ++g) {
        var grp = groups[g];
        var n = grp.uids.length;
        var focusUid = p.focus[grp.id];
        var f = grp.uids.indexOf(focusUid);
        if (f < 0)
            f = n - 1;
        for (var k = 0; k < n; ++k) {
            var c = laid[g][k];
            var r = {
                cx: p.viewWidth / 2 + anchors[g] - scroll + c.x,
                cy: p.originY + c.y,
                scale: c.scale,
                rot: c.rot,
                z: (g === current ? 1000 : 100 - Math.abs(g - current)) + k,
                group: g,
                k: k,
                focused: g === current && k === f
            };
            if (g === current && ms > 0) {
                // CardGroup::maximizeActiveCard, CardGroup.cpp:325-373. The
                // stack keeps its order all the way (z is the list order:
                // CardGroup::raiseCards, :577-592, no z changes anywhere in
                // lunaui/cards): a card from the back of the stack grows
                // behind the cards in front of it while they slide off to
                // the right, and when it minimizes they slide back over it.
                // (It was lifted above them while maximized and dropped
                // behind them as the minimize ended: it seemed to dissolve
                // through the card in front.)
                if (k === f) {
                    r.cx = mix(r.cx, p.viewWidth / 2, ms);
                    r.cy = mix(r.cy, p.maximizedCenterY, ms);
                    r.scale = mix(r.scale, 1, ms);
                    r.rot = mix(r.rot, 0, ms);
                } else {
                    // Cards below fly off left, cards above fly off right,
                    // at the maximized card's height and level (:344-370).
                    r.cx = mix(r.cx, p.viewWidth / 2 + (k < f ? -1 : 1) * p.viewWidth, ms);
                    r.cy = mix(r.cy, p.maximizedCenterY, ms);
                    r.rot = mix(r.rot, 0, ms);
                }
            }
            result.cards[grp.uids[k]] = r;
        }
    }
    return result;
}
