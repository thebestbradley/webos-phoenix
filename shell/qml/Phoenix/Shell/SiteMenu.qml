// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The app menu of a web app that is a site (a PWA from the Marketplace,
// and later an Android app's card): the page is the site itself, which has
// no webOS app menu of its own, so the shell draws one under the app's
// name, in the system menu's art (menu-dropdown-bg.png, the same picture
// as Enyo's appmenu.png; menu-selection-gradient-*.png): Back, Forward and
// Reload, then Copy Link and Open in Browser. Phoenix addition.

import QtQuick

Item {
    id: menu
    objectName: "siteMenu"

    property bool open: false
    property bool canGoBack: false
    property bool canGoForward: false
    property string url: ""
    // "back", "forward", "reload", "browser" (copy is done here).
    signal action(string name)
    signal closeRequested

    visible: open || panel.opacity > 0

    // Tap outside to close.
    MouseArea {
        anchors.fill: parent
        enabled: menu.open
        onClicked: menu.closeRequested()
    }

    // For Copy Link: the system clipboard, as text fields put on it.
    TextEdit {
        id: clip
        visible: false
    }
    function copyLink() {
        clip.text = url;
        clip.selectAll();
        clip.copy();
    }

    component Entry: Item {
        id: entry
        property string text
        property string name
        property bool enabled: true
        property bool last: false
        width: parent ? parent.width : 0
        height: Theme.systemMenuRowHeight
        objectName: "siteMenu_" + name
        BorderImage {
            visible: area.pressed && area.containsMouse && entry.enabled
            source: Theme.asset(entry.last ? "menu-selection-gradient-last.png" : "menu-selection-gradient-default.png")
            x: Theme.px(4)
            width: parent.width - Theme.px(8)
            height: parent.height
            border { left: Theme.artBorder(19, source); right: Theme.artBorder(19, source) }
        }
        Text {
            x: Theme.systemMenuIndent
            anchors.verticalCenter: parent.verticalCenter
            text: entry.text
            color: Theme.systemMenuText
            opacity: entry.enabled ? 1 : 0.4
            font.family: Theme.fontFamily
            font.pixelSize: Theme.systemMenuFontSize
        }
        MouseArea {
            id: area
            anchors.fill: parent
            enabled: entry.enabled && menu.open
            onClicked: {
                if (entry.name === "copy")
                    menu.copyLink();
                else
                    menu.action(entry.name);
                menu.closeRequested();
            }
        }
    }
    component Divider: Image {
        width: parent ? parent.width - Theme.systemMenuDividerInset : 0
        x: Theme.systemMenuDividerInset / 2
        height: Theme.px(2)
        source: Theme.asset("menu-divider.png")
    }

    Item {
        id: panel
        x: -Theme.systemMenuEdgeOffset
        y: Theme.statusBarHeight
        width: Theme.px(230)
        height: column.height + Theme.systemMenuBottomMargin
        opacity: menu.open ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.statusBarMenuFadeDuration } }

        BorderImage {
            anchors.fill: parent
            source: Theme.asset("menu-dropdown-bg.png")
            border { left: Theme.artBorder(30, source); top: Theme.artBorder(10, source); right: Theme.artBorder(30, source); bottom: Theme.artBorder(30, source) }
            MouseArea { anchors.fill: parent }   // swallow taps
        }
        Column {
            id: column
            x: Theme.systemMenuSideMargin
            width: parent.width - 2 * Theme.systemMenuSideMargin
            Entry { text: qsTr("Back"); name: "back"; enabled: menu.canGoBack }
            Divider {}
            Entry { text: qsTr("Forward"); name: "forward"; enabled: menu.canGoForward }
            Divider {}
            Entry { text: qsTr("Reload"); name: "reload" }
            Divider {}
            Entry { text: qsTr("Copy Link"); name: "copy"; enabled: menu.url !== "" }
            Divider {}
            Entry { text: qsTr("Open in Browser"); name: "browser"; enabled: menu.url !== ""; last: true }
        }
    }
}
