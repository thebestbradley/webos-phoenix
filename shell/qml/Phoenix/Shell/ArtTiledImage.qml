// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shell's Open webOS art (Theme.asset) tiled over the item
// (fillMode Image.Tile, TileHorizontally or TileVertically), each tile the
// 1x art's size times Theme.u, whichever variant the source is
// (docs/spec/hidpi-art.md). An Image tiles in its own (logical) pixels,
// the 1x art's for a @2x / @3x file (Qt reads them as having that pixel
// ratio); the shell's pixels are Theme.u times bigger, so the image is laid
// out that much smaller and scaled up: at u 1 it is a plain Image.

import QtQuick

Item {
    id: art

    property url source
    property alias fillMode: image.fillMode
    property alias horizontalAlignment: image.horizontalAlignment
    property alias verticalAlignment: image.verticalAlignment
    property alias smooth: image.smooth
    readonly property alias status: image.status

    // Shell pixels per pixel of the Image.
    readonly property real artScale: Theme.artDrawScale(source)

    Image {
        id: image
        width: art.width / art.artScale
        height: art.height / art.artScale
        scale: art.artScale
        transformOrigin: Item.TopLeft
        source: art.source
        fillMode: Image.Tile
    }
}
