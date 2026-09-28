// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A faint blur of whatever is behind a see-through surface (the dock's
// glass, the search pill, drop-down menus, alerts), under its artwork: the
// surface still reads as translucent, and its text reads more easily. A
// Phoenix addition; LunaSysMgr drew these surfaces over the unblurred scene.
//
// Place it first inside the surface, filling it:
//   BackdropBlur { anchors.fill: parent; source: shell.backdrop; mask: art }
// where mask is the surface's artwork (the blur keeps to its shape and
// alpha) and source the scene behind (Shell.backdrop: wallpaper, cards,
// launcher). Off with the software renderer, which cannot run the effects.

import QtQuick
import Qt5Compat.GraphicalEffects

Item {
    id: blur

    // The scene behind the surface.
    property Item source: null
    // The surface's artwork, whose shape and alpha the blur keeps to.
    property Item mask: null
    property real radius: Theme.px(Theme.backdropBlurRadius)

    visible: source !== null && width > 0 && height > 0 && GraphicsInfo.api !== GraphicsInfo.Software

    // Where this surface sits over the source. Re-evaluated as the surface or
    // its parent moves (the dock slides with the cards).
    readonly property rect region: {
        var deps = [x, y, width, height, parent ? parent.x + parent.y : 0,
                    parent && parent.parent ? parent.parent.x + parent.parent.y : 0];
        return source && visible ? mapToItem(source, 0, 0, width, height) : Qt.rect(0, 0, 0, 0);
    }

    ShaderEffectSource {
        id: snapshot
        anchors.fill: parent
        sourceItem: blur.visible ? blur.source : null
        sourceRect: blur.region
        live: true
        hideSource: false
        visible: false
    }

    FastBlur {
        id: blurred
        anchors.fill: parent
        source: snapshot
        radius: blur.radius
        visible: blur.mask === null
    }

    OpacityMask {
        anchors.fill: parent
        visible: blur.mask !== null
        source: blurred
        maskSource: blur.mask
    }
}
