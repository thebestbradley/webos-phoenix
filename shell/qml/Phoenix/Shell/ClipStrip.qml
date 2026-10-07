// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The keyboard's clip strip (Phoenix, M6 F2), in place of the keys: the
// clipboard history (org.webosphoenix.clipboard) as a row of small cards,
// newest first, scrolled sideways like card view, under category tabs
// (Recent, Pinned, then the user's categories). A tap pastes a clip where
// the cursor is; a hold opens its actions (Pin or Unpin, Save to a
// category, Delete, Open Clipboard) in the system's popup art, as the edit
// popup's. ABC, Back, or the clipboard key again bring the keys back.
//
// The cards are drawn as card view draws an app's card, small: rounded
// corners and card-shadow-tile.png's drop shadow (CardDropShadowEffect.cpp,
// as Card.qml), the clip's text on a white page, the app it came from and
// how long ago under it. A sensitive clip is masked (••••) with what it is
// (a password, a code); it pastes only into a password field.
//
// Drawn on the keyboard's own background, sized from the keyboard's height
// (the phone's 377 keyboard pixels, the tablet's 340), as the emoji page.

import QtQuick

Item {
    id: strip
    objectName: "clipStrip"

    // The VirtualKeyboard: its clipboard client, and where pastes go.
    required property Item keyboard
    readonly property var client: keyboard.clipboard

    // "recent", "pinned" or a category id.
    property string category: "recent"
    readonly property var _tabs: {
        var t = [{ id: "recent", name: qsTr("Recent") }, { id: "pinned", name: qsTr("Pinned") }];
        var cats = client && client.categories ? client.categories : [];
        for (var i = 0; i < cats.length; ++i)
            t.push({ id: cats[i].id, name: cats[i].name });
        return t;
    }
    readonly property var clips: client && client.clips ? client.clips : []
    readonly property real unit: height / (keyboard.tablet ? 340 : 377)
    readonly property real tabHeight: Math.round(height * 0.17)
    readonly property real cardHeight: Math.round((height - tabHeight) * 0.66)
    readonly property real cardWidth: Math.round(cardHeight * (keyboard.tablet ? 0.8 : 0.72))

    onVisibleChanged: {
        menu.close();
        if (visible) {
            category = "recent";
            cards.positionViewAtBeginning();
            if (client)
                client.refresh(category);
        }
    }
    onCategoryChanged: {
        menu.close();
        if (visible && client)
            client.refresh(category);
    }
    // A category that went away: back to Recent.
    on_TabsChanged: {
        for (var i = 0; i < _tabs.length; ++i)
            if (_tabs[i].id === category)
                return;
        category = "recent";
    }

    function kindName(clip) {
        switch (clip.kind) {
        case "password": return qsTr("Password");
        case "otp": return qsTr("One-time code");
        case "otpauth": return qsTr("Authenticator link");
        case "totp": return qsTr("Authenticator key");
        }
        return qsTr("Secret");
    }
    function appName(id) {
        var c = client && client.appTitle ? client.appTitle(id) : "";
        if (c)
            return c;
        // Not installed (any more): the id's last part ("messaging" -> "Messaging").
        var last = String(id || "").split(".").pop();
        return last ? last.charAt(0).toUpperCase() + last.slice(1) : "";
    }
    function age(time) {
        var s = Math.max(0, Math.round((Date.now() - time) / 1000));
        if (s < 60) return qsTr("now");
        if (s < 3600) return qsTr("%1 min").arg(Math.floor(s / 60));
        if (s < 86400) return qsTr("%1 h").arg(Math.floor(s / 3600));
        return qsTr("%1 d").arg(Math.floor(s / 86400));
    }

    // The keyboard's background, and a tap on it is the strip's, not the app's.
    Image {
        anchors.fill: parent
        source: strip.keyboard._artFile("keyboard-bg.png")
        fillMode: Image.Stretch
    }
    MouseArea {
        anchors.fill: parent
        onClicked: menu.close()
    }

    // ABC and the tabs.
    Item {
        id: top
        width: parent.width
        height: strip.tabHeight

        Item {
            id: abc
            objectName: "clipAbc"
            width: height * 1.6
            height: parent.height
            Rectangle {
                anchors.fill: parent
                anchors.margins: Math.round(4 * strip.unit)
                radius: 5 * strip.unit
                color: abcArea.pressed ? Theme.highlight : "#3c3c3c"
                border.color: "#1e1e1e"
            }
            Text {
                anchors.centerIn: parent
                text: "ABC"
                color: "#e2e2e2"
                font.family: Theme.fontFamily
                font.pixelSize: Math.round(parent.height * 0.36)
            }
            MouseArea {
                id: abcArea
                anchors.fill: parent
                onClicked: strip.keyboard.closeClips()
            }
        }

        ListView {
            id: tabs
            objectName: "clipTabs"
            anchors.left: abc.right
            anchors.right: parent.right
            height: parent.height
            orientation: ListView.Horizontal
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            model: strip._tabs
            delegate: Item {
                id: tab
                required property var modelData
                objectName: "clipTab-" + modelData.id
                width: label.implicitWidth + 28 * strip.unit
                height: tabs.height
                Text {
                    id: label
                    anchors.centerIn: parent
                    text: tab.modelData.name
                    color: strip.category === tab.modelData.id ? "#ffffff" : "#a8a8a8"
                    font.family: Theme.fontFamily
                    font.pixelSize: Math.round(tabs.height * 0.36)
                    font.bold: strip.category === tab.modelData.id
                }
                Rectangle {
                    visible: strip.category === tab.modelData.id
                    anchors.bottom: parent.bottom
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: parent.width * 0.7
                    height: Math.max(2, Math.round(tabs.height * 0.06))
                    color: Theme.highlight
                }
                MouseArea {
                    anchors.fill: parent
                    onClicked: strip.category = tab.modelData.id
                }
            }
        }
        // The line under the tabs.
        Rectangle {
            anchors.bottom: parent.bottom
            width: parent.width
            height: Math.max(1, Math.round(strip.unit))
            color: Qt.rgba(0, 0, 0, 0.45)
        }
    }

    // The cards.
    ListView {
        id: cards
        objectName: "clipCards"
        anchors.top: top.bottom
        anchors.bottom: parent.bottom
        width: parent.width
        orientation: ListView.Horizontal
        spacing: Math.round(18 * strip.unit)
        leftMargin: Math.round(22 * strip.unit)
        rightMargin: Math.round(22 * strip.unit)
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        model: strip.clips
        delegate: Item {
            id: cardItem
            required property var modelData
            required property int index
            readonly property var clipData: modelData
            objectName: "clipCard-" + modelData.id
            width: strip.cardWidth
            height: cards.height

            Item {
                id: face
                y: Math.round((cards.height - strip.cardHeight) * 0.38)
                width: parent.width
                height: strip.cardHeight
                scale: tapArea.pressed ? 0.96 : 1
                Behavior on scale { NumberAnimation { duration: 80 } }

                // card-shadow-tile.png, as Card.qml draws it, at this size.
                BorderImage {
                    readonly property real k: strip.cardWidth / 320
                    x: -20 * k
                    y: -20 * k + 5 * k
                    width: (face.width + 40 * k) / k
                    height: (face.height + 40 * k) / k
                    scale: k
                    transformOrigin: Item.TopLeft
                    source: Theme.asset("card-shadow-tile.png")
                    border { left: Theme.artBorder(43, source); top: Theme.artBorder(43, source); right: Theme.artBorder(43, source); bottom: Theme.artBorder(43, source) }
                }
                Rectangle {
                    id: page
                    anchors.fill: parent
                    radius: Math.round(strip.cardWidth * 0.06)
                    color: cardItem.clipData.sensitive ? "#2b2b2b" : "#ffffff"
                    clip: true

                    // Text and links.
                    Column {
                        visible: cardItem.clipData.type !== "image" && !cardItem.clipData.sensitive
                        x: Math.round(10 * strip.unit)
                        y: Math.round(9 * strip.unit)
                        width: page.width - 2 * x
                        spacing: Math.round(4 * strip.unit)
                        Text {
                            visible: cardItem.clipData.type === "link" && !!cardItem.clipData.title
                            width: parent.width
                            text: cardItem.clipData.title || ""
                            color: "#202020"
                            font.family: Theme.fontFamily
                            font.pixelSize: Math.round(15 * strip.unit)
                            font.bold: true
                            wrapMode: Text.Wrap
                            maximumLineCount: 2
                            elide: Text.ElideRight
                        }
                        Text {
                            objectName: "clipText"
                            width: parent.width
                            height: page.height - parent.y - Math.round(9 * strip.unit) - (cardItem.clipData.type === "link" && cardItem.clipData.title ? Math.round(44 * strip.unit) : 0)
                            text: cardItem.clipData.text || ""
                            color: cardItem.clipData.type === "link" ? "#1f5fa8" : "#303030"
                            font.family: Theme.fontFamily
                            font.pixelSize: Math.round(14 * strip.unit)
                            wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                            elide: Text.ElideRight
                            clip: true
                        }
                    }
                    // A picture.
                    Image {
                        visible: cardItem.clipData.type === "image"
                        anchors.fill: parent
                        source: cardItem.clipData.type === "image" ? cardItem.clipData.image : ""
                        fillMode: Image.PreserveAspectCrop
                        asynchronous: true
                    }
                    // A secret: masked.
                    Column {
                        visible: cardItem.clipData.sensitive
                        anchors.centerIn: parent
                        width: page.width - Math.round(16 * strip.unit)
                        spacing: Math.round(6 * strip.unit)
                        Text {
                            objectName: "clipMask"
                            width: parent.width
                            horizontalAlignment: Text.AlignHCenter
                            text: "•".repeat(Math.max(4, Math.min(8, cardItem.clipData.length || 8)))
                            color: "#ffffff"
                            font.family: Theme.fontFamily
                            font.pixelSize: Math.round(20 * strip.unit)
                        }
                        Text {
                            width: parent.width
                            horizontalAlignment: Text.AlignHCenter
                            text: strip.kindName(cardItem.clipData)
                            color: "#b8b8b8"
                            font.family: Theme.fontFamily
                            font.pixelSize: Math.round(12 * strip.unit)
                            elide: Text.ElideRight
                        }
                    }
                    // Pinned: a folded corner in the highlight colour.
                    Rectangle {
                        objectName: "clipPinned"
                        visible: cardItem.clipData.pinned
                        width: Math.round(30 * strip.unit)
                        height: width
                        rotation: 45
                        x: page.width - width / 2
                        y: -height / 2
                        color: Theme.highlight
                    }
                }
            }
            // Where it came from, and when.
            Text {
                anchors.top: face.bottom
                anchors.topMargin: Math.round(7 * strip.unit)
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                text: strip.appName(cardItem.clipData.source) + " · " + strip.age(cardItem.clipData.time)
                color: "#c8c8c8"
                font.family: Theme.fontFamily
                font.pixelSize: Math.round(12 * strip.unit)
                elide: Text.ElideRight
            }
            MouseArea {
                id: tapArea
                objectName: "clipCardArea"
                x: face.x
                y: face.y
                width: face.width
                height: face.height
                onClicked: {
                    if (menu.visible) {
                        menu.close();
                        return;
                    }
                    strip.keyboard.pasteClip(cardItem.clipData);
                }
                onPressAndHold: menu.openFor(cardItem.clipData, cardItem)
            }
        }

        Text {
            objectName: "clipEmpty"
            anchors.centerIn: parent
            width: parent.width * 0.8
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.Wrap
            visible: cards.count === 0
            text: strip.category === "recent" ? qsTr("What you copy shows up here")
                : strip.category === "pinned" ? qsTr("Hold a clip to pin it") : qsTr("Hold a clip to save it here")
            color: "#a0a0a0"
            font.family: Theme.fontFamily
            font.pixelSize: Math.round(strip.tabHeight * 0.38)
        }
    }

    // A line for a moment (a secret that cannot be pasted here).
    Rectangle {
        objectName: "clipMessage"
        visible: strip.keyboard.clipsMessage !== ""
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: Math.round(8 * strip.unit)
        width: Math.min(parent.width - 20 * strip.unit, msg.implicitWidth + 28 * strip.unit)
        height: msg.implicitHeight + 14 * strip.unit
        radius: height / 2
        color: Qt.rgba(0, 0, 0, 0.8)
        Text {
            id: msg
            anchors.centerIn: parent
            width: parent.width - 20 * strip.unit
            horizontalAlignment: Text.AlignHCenter
            elide: Text.ElideRight
            text: strip.keyboard.clipsMessage
            color: "#ffffff"
            font.family: Theme.fontFamily
            font.pixelSize: Math.round(13 * strip.unit)
        }
    }

    // A held clip's actions, in the system's popup art (as EditPopup): a row
    // of actions; Save to... turns it into the categories.
    Item {
        id: menu
        objectName: "clipMenu"
        property var clip: null
        property bool choosing: false        // the categories, for Save to...
        visible: clip !== null
        anchors.fill: parent
        z: 10

        function openFor(c, item) {
            choosing = false;
            clip = c;
            // The middle of the card held.
            var p = item.mapToItem(strip, item.width / 2, Math.round((cards.height - strip.cardHeight) * 0.38) + strip.cardHeight / 2);
            anchorX = p.x;
            anchorY = p.y;
        }
        function close() { clip = null; choosing = false; }
        property real anchorX: 0
        property real anchorY: 0
        readonly property var items: {
            if (!clip)
                return [];
            if (choosing) {
                var list = [{ id: "cat:", label: qsTr("None"), on: !clip.category }];
                var cats = strip.client && strip.client.categories ? strip.client.categories : [];
                for (var i = 0; i < cats.length; ++i)
                    list.push({ id: "cat:" + cats[i].id, label: cats[i].name, on: clip.category === cats[i].id });
                if (cats.length === 0)
                    list.push({ id: "app", label: qsTr("New Category…") });
                return list;
            }
            return [{ id: clip.pinned ? "unpin" : "pin", label: clip.pinned ? qsTr("Unpin") : qsTr("Pin") },
                    { id: "save", label: qsTr("Save to…") },
                    { id: "delete", label: qsTr("Delete") },
                    { id: "app", label: qsTr("Open Clipboard") }];
        }
        function choose(id) {
            var c = clip;
            if (id === "save") {
                choosing = true;
                return;
            }
            close();
            if (!strip.client)
                return;
            if (id === "pin" || id === "unpin")
                strip.client.setPinned(c, id === "pin");
            else if (id === "delete")
                strip.client.remove(c);
            else if (id === "app")
                strip.client.openApp();
            else if (id.indexOf("cat:") === 0)
                strip.client.setCategory(c, id.slice(4));
        }

        MouseArea {
            anchors.fill: parent
            onClicked: menu.close()
        }
        ArtBorderImage {
            id: bubble
            readonly property real pad: Theme.artBorder(10, source)
            width: Math.min(strip.width, row.width + 2 * pad)
            height: Math.round(44 * strip.unit) + 2 * pad
            x: Math.max(0, Math.min(strip.width - width, menu.anchorX - width / 2))
            y: Math.max(0, Math.min(strip.height - height, menu.anchorY - height / 2))
            source: Theme.asset("popup-bg.png")
            border { left: Theme.artBorder(19, source); top: Theme.artBorder(19, source); right: Theme.artBorder(19, source); bottom: Theme.artBorder(19, source) }
            Flickable {
                x: bubble.pad
                y: bubble.pad
                width: bubble.width - 2 * bubble.pad
                height: bubble.height - 2 * bubble.pad
                contentWidth: row.width
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                Row {
                    id: row
                    objectName: "clipMenuRow"
                    height: parent.height
                    Repeater {
                        model: menu.items
                        delegate: Item {
                            id: entry
                            required property var modelData
                            required property int index
                            objectName: "clipMenu-" + modelData.id
                            width: entryLabel.implicitWidth + 28 * strip.unit
                            height: row.height
                            Rectangle {
                                visible: entry.index > 0
                                width: Math.max(1, strip.unit)
                                height: parent.height - 16 * strip.unit
                                anchors.verticalCenter: parent.verticalCenter
                                color: "#5a5a5a"
                            }
                            Rectangle {
                                anchors.fill: parent
                                anchors.margins: 3 * strip.unit
                                radius: 6 * strip.unit
                                color: Theme.highlight
                                visible: entryArea.pressed || entry.modelData.on === true
                                opacity: entryArea.pressed ? 1 : 0.45
                            }
                            Text {
                                id: entryLabel
                                anchors.centerIn: parent
                                text: entry.modelData.label
                                color: Theme.text
                                font.family: Theme.fontFamily
                                font.pixelSize: Math.round(16 * strip.unit)
                            }
                            MouseArea {
                                id: entryArea
                                anchors.fill: parent
                                onClicked: menu.choose(entry.modelData.id)
                            }
                        }
                    }
                }
            }
        }
    }
}
