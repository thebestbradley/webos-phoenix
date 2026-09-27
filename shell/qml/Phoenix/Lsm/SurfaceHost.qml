// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Wraps a compositor surface item so the card can size it like any other
// Item. The client decides the surface's real size, so we scale it to fit
// rather than resizing it (resizing would force the app to re-layout on
// every card animation frame).

import QtQuick

Item {
    id: host
    property Item surface

    clip: true

    onSurfaceChanged: {
        if (!surface)
            return;
        surface.parent = host;
        surface.x = 0;
        surface.y = 0;
        surface.transformOrigin = Item.TopLeft;
        surface.visible = true;
    }

    Binding {
        target: host.surface
        when: host.surface && host.surface.width > 0 && host.surface.height > 0
        property: "scale"
        value: host.surface ? Math.min(host.width / host.surface.width, host.height / host.surface.height) : 1
    }
}
