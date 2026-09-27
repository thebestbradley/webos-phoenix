// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Wallpaper. The stock Palm wallpapers are not in the open-source release,
// so the default is a drawn dusk gradient; any image can be set via source.

import QtQuick

Item {
    id: wallpaper
    property url source: ""

    Rectangle {
        anchors.fill: parent
        visible: wallpaper.source == ""
        gradient: Gradient {
            GradientStop { position: 0.0; color: "#0b1a33" }
            GradientStop { position: 0.55; color: "#24477a" }
            GradientStop { position: 0.85; color: "#c0643c" }
            GradientStop { position: 1.0; color: "#e8a04c" }
        }
    }

    Image {
        anchors.fill: parent
        visible: wallpaper.source != ""
        source: wallpaper.source
        fillMode: Image.PreserveAspectCrop
    }
}
