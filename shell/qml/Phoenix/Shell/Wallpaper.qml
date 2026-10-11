// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Wallpaper. The stock Palm wallpapers are not in the open-source release;
// Phoenix's own are in Settings (apps/settings/public/wallpapers, drawn by
// tools/wallpapers/generate.py), the default Theme.defaultWallpaperPath.
// Any picture can be set via source. It fills the screen, cropped about the
// centre: the bundled ones are squares, so one picture serves the screen
// upright and sideways, as the TouchPad's square wallpapers did
// (WindowServerLuna.cpp:89-156, the card view's wallpaper turned with the
// screen). Without a picture (or one that cannot be read), a night-sky
// gradient in the default's colours.

import QtQuick
import QtQuick.Window

Item {
    id: wallpaper
    property url source: ""

    Rectangle {
        anchors.fill: parent
        visible: picture.status !== Image.Ready
        gradient: Gradient {
            GradientStop { position: 0.0; color: "#01030a" }
            GradientStop { position: 0.45; color: "#061629" }
            GradientStop { position: 0.72; color: "#0d3438" }
            GradientStop { position: 1.0; color: "#03080b" }
        }
    }

    Image {
        id: picture
        anchors.fill: parent
        visible: status === Image.Ready
        source: wallpaper.source
        fillMode: Image.PreserveAspectCrop
        // Decoded at the size the screen shows, not the file's (a 2048 px
        // square is 16 MB decoded; a Pre's screen needs a 480 px one). The
        // screen's longer side, so turning it does not decode it again;
        // in steps, so resizing the simulator's window does not either.
        readonly property int pixels: Math.ceil(Math.max(wallpaper.width, wallpaper.height) * Screen.devicePixelRatio / 128) * 128
        sourceSize: pixels > 0 ? Qt.size(pixels, pixels) : Qt.size(-1, -1)
    }
}
