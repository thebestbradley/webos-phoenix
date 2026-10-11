// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ember Glass's highlight inside the top of a rounded glass shape
// (base.css: inset 0 1px 0 var(--edge), on cards, sheets, the dock and
// Just Type's bar): a 1 px line under the top edge that follows the corners
// round and fades out down their sides. A straight line would stand out of
// the shape where a corner curves away from it.
//
// Fill the shape with it: EgHighlight { anchors.fill: parent; ... }.

import QtQuick

Item {
    id: hl

    property color color: Theme.eg.glassHighlight
    property real topLeftRadius: 0
    property real topRightRadius: 0
    // How far in from the shape's edge (its rim's width).
    property real inset: 0

    // The top of the shape only: the corners' upper halves, where an inset
    // shadow 1 px down shows (it thins to nothing as the edge turns down).
    clip: true
    height: Math.max(Theme.px(2), Math.max(topLeftRadius, topRightRadius) / 2 + inset)

    Rectangle {
        x: hl.inset
        y: hl.inset
        width: hl.width - 2 * hl.inset
        // As tall as the shape (its corners round as the shape's).
        height: Math.max(hl.parent ? hl.parent.height : 0, 2 * Math.max(hl.topLeftRadius, hl.topRightRadius)) - 2 * hl.inset
        topLeftRadius: Math.max(0, hl.topLeftRadius - hl.inset)
        topRightRadius: Math.max(0, hl.topRightRadius - hl.inset)
        color: "transparent"
        border.color: hl.color
        border.width: Math.max(1, Theme.u)
        antialiasing: true
    }
}
