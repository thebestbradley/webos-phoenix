// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Wraps a compositor surface item so the card can size it like any other
// Item. The client decides the surface's real size, so we scale it to fit
// rather than resizing it (resizing would force the app to re-layout on
// every card animation frame).
//
// The card's edit popup (GAPS E1) is drawn here, over the surface: the page
// says where its selection is ("editMenu", in its own CSS pixels, with its
// viewport's width; phoenix-runtime.js on a device), and the command the
// user picks goes back to the page (editTriggered: LsmWindowSource sends
// it as the page's "editAction" event), as phoenix-sim's WebAppWindow
// draws the popup over its web view.

import QtQuick
import Phoenix.Shell

Item {
    id: host
    property Item surface

    signal editTriggered(string action)

    clip: true

    onSurfaceChanged: {
        if (!surface)
            return;
        surface.parent = host;
        surface.x = 0;
        surface.y = 0;
        surface.transformOrigin = Item.TopLeft;
        surface.visible = true;
        editPopup.z = 1;
    }

    Binding {
        target: host.surface
        when: host.surface && host.surface.width > 0 && host.surface.height > 0
        property: "scale"
        value: host.surface ? Math.min(host.width / host.surface.width, host.height / host.surface.height) : 1
    }

    // The keyboard to the page (Just Type's, once it shows the text).
    function focusPage() {
        if (surface)
            surface.forceActiveFocus();
    }

    // The page's CSS pixels in this item's: its viewport spans the surface,
    // as scaled here.
    function pageScale(viewportWidth) {
        var shown = surface && surface.width > 0 ? surface.width * surface.scale : width;
        return viewportWidth > 0 ? shown / viewportWidth : 1;
    }

    // p: {x, y, width, height, viewportWidth, canSelectAll, canCut, canCopy,
    // canPaste} (the runtime's "editMenu").
    function openEditPopup(p) {
        var list = [];
        if (p.canSelectAll) list.push("selectAll");
        if (p.canCut) list.push("cut");
        if (p.canCopy) list.push("copy");
        if (p.canPaste) list.push("paste");
        if (list.length === 0)
            return false;
        var s = pageScale(Number(p.viewportWidth) || 0);
        editPopup.open(Qt.rect((Number(p.x) || 0) * s, (Number(p.y) || 0) * s,
                               (Number(p.width) || 0) * s, (Number(p.height) || 0) * s), list);
        return true;
    }
    readonly property alias editPopupItem: editPopup

    EditPopup {
        id: editPopup
        anchors.fill: parent
        onTriggered: (action) => host.editTriggered(action)
    }
}
