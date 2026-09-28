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
    return {
        x: x,
        // Cards right of centre drop slightly and tilt clockwise.
        y: x > 0 ? x / 15 : 0,
        rot: (x / p.u) / (p.activeScale * p.rotFactor)
    };
}

// Offset of card k in a closed stack: the top three cards step 7px right,
// deeper cards sit exactly underneath. CardGroup.cpp:744-771.
function closedOffset(k, n, p) {
    return 7 * p.u * clamp(k - (n - 3), 0, 2);
}

// groups: [{ id, uids: [..] }] in screen order.
// p: {
//   viewWidth, cardWidth, cardHeight, u,
//   activeScale, nonActiveScale, groupingFactor, rotFactor, gap,
//   position,        fractional index of the stack at the centre
//   fan,             { groupId: fan position }
//   focus,           { groupId: uid of the stack's active card }
//   maximize,        0..1 for the current stack's active card
//   originY, maximizedCenterY
// }
// Returns { cards: { uid: {cx, cy, scale, rot, z, group, k, focused} },
//           anchors: [..], currentGroup }
function compute(groups, p) {
    var G = groups.length;
    var result = { cards: {}, anchors: [], currentGroup: -1 };
    if (G === 0)
        return result;

    var current = clamp(Math.round(p.position), 0, G - 1);
    result.currentGroup = current;
    var m = p.maximize;

    var laid = [];      // per group: [{x, y, scale, rot}]
    var lefts = [];
    var rights = [];

    for (var g = 0; g < G; ++g) {
        var grp = groups[g];
        var n = grp.uids.length;
        var a = Math.max(0, 1 - Math.abs(g - p.position));   // how "open" this stack is
        var pos = clampFanPosition(p.fan[grp.id] !== undefined ? p.fan[grp.id] : 1e9, n);
        var cards = [];
        var left = Infinity, right = -Infinity;
        for (var k = 0; k < n; ++k) {
            var o = openedOffset(k, pos, p);
            var c = {
                x: o.x * a + (1 - a) * closedOffset(k, n, p),
                y: o.y * a,
                scale: mix(p.nonActiveScale, p.activeScale, a),
                rot: o.rot * a
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
    var anchors = [0];
    for (g = 1; g < G; ++g)
        anchors.push(anchors[g - 1] + rights[g - 1] + p.gap - lefts[g]);
    result.anchors = anchors;

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
    var scroll = anchorAt(p.position);

    for (g = 0; g < G; ++g) {
        grp = groups[g];
        n = grp.uids.length;
        var focusUid = p.focus[grp.id];
        var f = grp.uids.indexOf(focusUid);
        if (f < 0)
            f = n - 1;
        for (k = 0; k < n; ++k) {
            c = laid[g][k];
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
            if (g === current && m > 0) {
                if (k === f) {
                    // CardGroup::maximizeActiveCard, CardGroup.cpp:325-373
                    r.cx = mix(r.cx, p.viewWidth / 2, m);
                    r.cy = mix(r.cy, p.maximizedCenterY, m);
                    r.scale = mix(r.scale, 1, m);
                    r.rot = mix(r.rot, 0, m);
                    r.z = 2000;
                } else {
                    // Cards below fly off left, cards above fly off right.
                    r.cx = mix(r.cx, p.viewWidth / 2 + (k < f ? -1 : 1) * p.viewWidth, m);
                }
            }
            result.cards[grp.uids[k]] = r;
        }
    }
    return result;
}
