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
    // The app of the surface, and the Sign In card's bar when it is that
    // card (LsmWindowSource.signInCard: {host, secure} from the OAuth
    // service; Phoenix.Shell SignInBar). The surface then sits under the
    // bar, scaled to the room left: WebAppMgr sizes its window itself.
    property string appId: ""
    property var signIn: null

    signal editTriggered(string action)
    signal signInCancel()

    clip: true

    onSurfaceChanged: {
        if (!surface)
            return;
        surface.parent = content;
        surface.x = 0;
        surface.y = 0;
        surface.transformOrigin = Item.TopLeft;
        surface.visible = true;
        editPopup.z = 1;
    }

    SignInBar {
        id: signInBar
        objectName: "surfaceSignInBar"
        visible: host.signIn !== null
        anchors { left: parent.left; right: parent.right; top: parent.top }
        height: host.signIn !== null ? Theme.px(40) : 0
        hostName: host.signIn ? String(host.signIn.host || "") : ""
        secure: !!(host.signIn && host.signIn.secure)
        onCancel: host.signInCancel()
    }

    Item {
        id: content
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom; top: signInBar.bottom }
        clip: true
    }

    Binding {
        target: host.surface
        when: host.surface && host.surface.width > 0 && host.surface.height > 0
        property: "scale"
        value: host.surface ? Math.min(content.width / host.surface.width, content.height / host.surface.height) : 1
    }
    // Under the bar the surface is narrower than the card: centred.
    Binding {
        target: host.surface
        when: host.surface && host.surface.width > 0
        property: "x"
        value: host.surface ? Math.max(0, (content.width - host.surface.width * host.surface.scale) / 2) : 0
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
        anchors.fill: content
        onTriggered: (action) => host.editTriggered(action)
    }
}
