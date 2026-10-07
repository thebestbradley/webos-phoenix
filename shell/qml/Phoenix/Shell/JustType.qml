// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// "Just Type": start typing in card view and a universal search opens with
// matching apps, contacts, content, web searches and quick actions.
//
// When the window source provides a Just Type surface (the original
// com.palm.launcher app; see SimWindowSource.justTypeWindow), it is shown
// here and gets the typed text. Otherwise a built-in search of the app
// list stands in.

import QtQuick

Item {
    id: jt

    property var apps
    // The window source; its optional justTypeWindow() supplies the surface.
    property var source
    property bool open: false
    property alias query: input.text
    // What the keyboard (or a popup alert) takes at the bottom: the results
    // end above it, as an app's positive space does
    // (InputWindowManager -> changeNegativeSpace), so they stay in view on
    // small screens.
    property real bottomInset: 0

    // Created once the source's app list is ready, so the page is loaded
    // before the first search.
    property Item surface: null

    function _attachSurface() {
        if (!surface && source && typeof source.justTypeWindow === "function")
            surface = source.justTypeWindow();
    }
    onSourceChanged: Qt.callLater(_attachSurface)
    Component.onCompleted: Qt.callLater(_attachSurface)

    signal launchRequested(string appId)
    signal actionRequested(string action, string text)
    signal closeRequested
    // Copy or Cut put text on the clipboard (for the clipboard history).
    signal copied(string text)

    visible: opacity > 0
    opacity: open ? 1 : 0
    // OverlayWindowManager.cpp:312-313: universalSearchCrossFade, 150 ms
    // OutCubic (lunaAnimations.conf:87-88).
    Behavior on opacity { NumberAnimation { duration: Theme.justTypeFadeDuration; easing.type: Easing.OutCubic } }

    // Typing in card view starts Just Type with the first letter; the page
    // shows it a moment later. Until it does the shell keeps the keyboard
    // and holds what is typed (typeAhead), then hands it on in order.
    property bool _starting: false
    property string _typedAhead: ""
    function typeAhead(text) {
        if (!_starting)
            return false;
        _typedAhead += text;
        return true;
    }
    function start(firstText) {
        _attachSurface();
        open = true;
        if (surface) {
            _starting = true;
            _typedAhead = "";
            source.justTypeStart(firstText || "", function () {
                if (!jt._starting)
                    return;
                var more = jt._typedAhead;
                jt._starting = false;
                jt._typedAhead = "";
                if (more && source.justTypeType)
                    source.justTypeType(more);
                if (jt.open && surface.focusPage)
                    surface.focusPage();
            });
            return;
        }
        input.text = firstText || "";
        input.forceActiveFocus();
    }

    onOpenChanged: {
        if (open)
            return;
        _starting = false;
        _typedAhead = "";
        editPopup.close();
        if (surface)
            source.justTypeStop();
    }

    onSurfaceChanged: {
        if (!surface)
            return;
        surface.parent = surfaceHost;
        surface.x = 0;
        surface.y = 0;
        surface.width = Qt.binding(function() { return surfaceHost.width; });
        surface.height = Qt.binding(function() { return surfaceHost.height; });
        surface.visible = true;
        // Closed, the page cannot keep (or take back) the keyboard: typing
        // in card view must reach the shell to start Just Type again.
        surface.enabled = Qt.binding(function() { return jt.open; });
    }

    // Escape leaves Just Type even while the page has the keyboard.
    Shortcut {
        sequences: ["Esc"]
        enabled: jt.open && jt.surface !== null
        onActivated: jt.closeRequested()
    }

    // The original Just Type page (com.palm.launcher) draws its own
    // background; only the built-in stand-in needs one.
    Rectangle {
        visible: !jt.surface
        anchors.fill: parent
        color: "#e6000000"
    }
    MouseArea {
        anchors.fill: parent
        onClicked: jt.closeRequested()
    }

    Item {
        id: surfaceHost
        visible: jt.surface !== null
        anchors.fill: parent
        anchors.topMargin: Theme.statusBarHeight
        anchors.bottomMargin: jt.bottomInset
    }

    ArtBorderImage {
        id: pill
        visible: !jt.surface
        x: Theme.px(8)
        y: Theme.statusBarHeight + Theme.px(8)
        width: parent.width - Theme.px(16)
        height: Theme.px(36)
        source: Theme.asset("search-pill.png")
        border { left: Theme.artBorder(36, source); right: Theme.artBorder(18, source); top: 0; bottom: 0 }

        TextInput {
            id: input
            objectName: "justTypeInput"
            anchors.left: parent.left
            anchors.leftMargin: Theme.px(36)
            anchors.right: parent.right
            anchors.rightMargin: Theme.px(12)
            anchors.verticalCenter: parent.verticalCenter
            color: Theme.text
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(17)
            Keys.onEscapePressed: jt.closeRequested()
            onAccepted: if (results.count > 0) jt.launchRequested(results.get(0).appId)

            // A long press selects the word and shows the edit popup, as in
            // a web page's text field.
            TapHandler {
                objectName: "justTypeHold"
                onLongPressed: {
                    input.forceActiveFocus();
                    input.cursorPosition = input.positionAt(point.position.x, point.position.y);
                    input.selectWord();
                    var list = ["selectAll"];
                    if (input.selectedText.length > 0)
                        list.push("cut", "copy");
                    if (input.canPaste)
                        list.push("paste");
                    var r = input.positionToRectangle(input.selectionStart);
                    var end = input.positionToRectangle(input.selectionEnd);
                    var at = input.mapToItem(jt, r.x, 0);
                    editPopup.open(Qt.rect(at.x, at.y, end.x - r.x, input.height), list);
                }
            }
        }
    }

    EditPopup {
        id: editPopup
        objectName: "justTypeEditPopup"
        anchors.fill: parent
        onTriggered: (action) => jt.edit(action)
    }

    ListModel { id: results }

    // Edit commands on the search field (the edit popup's, the meta key's).
    function edit(action) {
        switch (action) {
        case "selectAll": input.selectAll(); break;
        case "cut": copied(input.selectedText); input.cut(); break;
        case "copy": copied(input.selectedText); input.copy(); break;
        case "paste": input.paste(); break;
        }
    }

    function refresh() {
        results.clear();
        var q = input.text.toLowerCase();
        if (!apps || q === "")
            return;
        for (var i = 0; i < apps.count; ++i) {
            var a = apps.get(i);
            if (a.title.toLowerCase().indexOf(q) >= 0)
                results.append({ appId: a.appId, title: a.title, color: a.color, glyph: a.glyph,
                                 icon: String(a.icon || ""), largeIcon: String(a.largeIcon || "") });
        }
    }
    Connections {
        target: input
        function onTextChanged() { jt.refresh(); }
    }

    Column {
        visible: !jt.surface
        anchors.top: pill.bottom
        anchors.topMargin: Theme.px(8)
        x: Theme.px(8)
        width: parent.width - Theme.px(16)
        spacing: Theme.px(2)

        Repeater {
            model: results
            delegate: Rectangle {
                id: result
                required property var model
                width: parent.width
                height: Theme.px(44)
                color: resultMouse.pressed ? "#33ffffff" : "transparent"
                AppIcon {
                    id: rIcon
                    anchors.verticalCenter: parent.verticalCenter
                    size: Theme.px(36)
                    showLabel: false
                    color: result.model.color
                    glyph: result.model.glyph
                    source: result.model.icon
                    largeSource: result.model.largeIcon
                }
                Text {
                    anchors.left: rIcon.right
                    anchors.leftMargin: Theme.px(10)
                    anchors.verticalCenter: parent.verticalCenter
                    text: result.model.title
                    color: Theme.text
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.px(17)
                }
                MouseArea {
                    id: resultMouse
                    anchors.fill: parent
                    onClicked: jt.launchRequested(result.model.appId)
                }
            }
        }

        Text {
            visible: input.text !== ""
            topPadding: Theme.px(10)
            text: "Actions: New Email · New Message · New Memo · Search the Web"
            color: Theme.textDim
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(13)
        }
    }
}
