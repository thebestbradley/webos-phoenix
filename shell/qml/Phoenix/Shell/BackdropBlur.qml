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
// launcher). Off without a GPU (RenderInfo.softwareRendering): Qt Quick's
// software renderer cannot run the effects, and OpenGL or Vulkan on a
// software rasteriser (Mesa's llvmpipe in a VM or a container) would draw
// the scene behind again and blur it on the CPU whenever it changes, which
// slows every frame. The surface is then drawn over the unblurred scene, as
// LunaSysMgr drew it. PHOENIX_SOFTWARE_RENDERING (phoenix-sim
// --software-rendering) forces it either way.

import QtQuick
import Qt5Compat.GraphicalEffects
import Phoenix.Native

Item {
    id: blur

    // The scene behind the surface.
    property Item source: null
    // The surface's artwork, whose shape and alpha the blur keeps to.
    property Item mask: null
    property real radius: Theme.px(Theme.backdropBlurRadius)

    visible: source !== null && width > 0 && height > 0 && !RenderInfo.softwareRendering

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
