// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A BorderImage of the shell's Open webOS art (Theme.asset) drawn at the
// density: its borders, and the tiles of a Repeat or Round middle, come out
// the 1x art's size times Theme.u, whichever variant the source is
// (docs/spec/hidpi-art.md). Use it as a BorderImage, with borders in the
// 1x art's pixels through Theme.artBorder(v, source):
//
//   ArtBorderImage {
//       anchors.fill: parent
//       source: Theme.asset("popup-bg.png")
//       border { left: Theme.artBorder(19, source); ... }
//   }
//
// A BorderImage draws its borders as many of its own (logical) pixels as
// they are long, and those are the 1x art's pixels (Qt reads @2x / @3x
// files as having that pixel ratio, artBorder scales @1.5x ones). The
// shell's pixels are Theme.u times bigger, so the image is laid out that
// much smaller and scaled up: at u 1 it is a plain BorderImage.
// Children go on top, unscaled.

import QtQuick

Item {
    id: art

    property url source
    property alias border: image.border
    property alias horizontalTileMode: image.horizontalTileMode
    property alias verticalTileMode: image.verticalTileMode
    property alias smooth: image.smooth
    property alias mirror: image.mirror
    property alias cache: image.cache
    property alias asynchronous: image.asynchronous
    readonly property alias status: image.status

    // Shell pixels per pixel of the BorderImage.
    readonly property real artScale: Theme.artDrawScale(source)

    BorderImage {
        id: image
        width: art.width / art.artScale
        height: art.height / art.artScale
        scale: art.artScale
        transformOrigin: Item.TopLeft
        source: art.source
    }
}
