// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The keyboard's emoji page (Phoenix, GAPS V6), over the keys: category
// tabs (recents first, then emoji-test.txt's groups in CLDR order), a grid
// of emoji, and ABC, space and delete. Tap an emoji to type it; hold one
// with skin tones to pick a tone, which it then keeps. The search tab
// brings the keys back to type an emoji's name (EmojiSearchBar).
//
// Drawn on the keyboard's own background; emoji in the colour emoji font
// (assets/fonts/noto-color-emoji) through the text font's fallback.

import QtQuick
import "KeyboardKeymap.js" as KM

Item {
    id: panel
    objectName: "emojiPanel"

    // The VirtualKeyboard: its emoji state, and where keys go.
    required property Item keyboard

    // "recent" or a category key (EmojiData.js).
    property string category: "smileys"
    readonly property var _tabs: [{ key: "recent", icon: "🕘" }].concat(keyboard.emojiCategories)
    readonly property int columns: keyboard.tablet ? 12 : 8
    readonly property real cell: width / columns
    readonly property real tabHeight: Math.round(height * 0.15)
    readonly property real barHeight: Math.round(height * 0.17)

    // Opened on the recents when there are some.
    onVisibleChanged: {
        if (visible) {
            category = keyboard._emojiRecent.length ? "recent" : "smileys";
            grid.positionViewAtBeginning();
        }
        tones.close();
    }

    function _model() {
        if (category === "recent")
            return keyboard._emojiRecent.map(function (e) { return { e: e, n: "" }; });
        for (var i = 0; i < keyboard.emojiCategories.length; ++i)
            if (keyboard.emojiCategories[i].key === category)
                return keyboard.emojiCategories[i].emoji;
        return [];
    }

    Image {
        anchors.fill: parent
        source: keyboard._art + "keyboard-bg.png"
        fillMode: Image.Stretch
    }

    // Category tabs, and search last.
    Row {
        id: tabs
        width: parent.width
        height: panel.tabHeight
        Repeater {
            model: panel._tabs.concat([{ key: "search", icon: "🔍" }])
            delegate: Item {
                id: tab
                required property var modelData
                objectName: "emojiTab-" + modelData.key
                width: tabs.width / (panel._tabs.length + 1)
                height: tabs.height
                Text {
                    anchors.centerIn: parent
                    text: tab.modelData.icon
                    font.family: Theme.emojiFontFamily
                    font.pixelSize: Math.round(tabs.height * 0.5)
                    opacity: panel.category === tab.modelData.key ? 1 : 0.55
                }
                Rectangle {
                    visible: panel.category === tab.modelData.key
                    anchors.bottom: parent.bottom
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: parent.width * 0.6
                    height: Math.max(2, Math.round(tabs.height * 0.06))
                    color: Theme.highlight
                }
                MouseArea {
                    anchors.fill: parent
                    onClicked: {
                        if (tab.modelData.key === "search") {
                            panel.keyboard.startEmojiSearch();
                            return;
                        }
                        panel.category = tab.modelData.key;
                        grid.positionViewAtBeginning();
                    }
                }
            }
        }
    }

    GridView {
        id: grid
        objectName: "emojiGrid"
        anchors.top: tabs.bottom
        anchors.bottom: bar.top
        width: parent.width
        clip: true
        cellWidth: panel.cell
        cellHeight: panel.cell
        boundsBehavior: Flickable.StopAtBounds
        model: panel._model()
        delegate: Item {
            id: cellItem
            required property var modelData
            readonly property string shown: panel.keyboard.emojiFor(modelData)
            objectName: "emoji-" + modelData.e
            width: grid.cellWidth
            height: grid.cellHeight
            Rectangle {
                anchors.fill: parent
                anchors.margins: 2
                radius: 6
                color: Theme.highlight
                opacity: 0.5
                visible: area.pressed
            }
            Text {
                anchors.centerIn: parent
                text: cellItem.shown
                font.family: Theme.emojiFontFamily
                font.pixelSize: Math.round(panel.cell * 0.62)
            }
            // Has skin tones: a small mark in the corner, as on other keyboards.
            Text {
                visible: !!cellItem.modelData.t
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 2
                text: "◢"
                color: "#8a8a8a"
                font.pixelSize: Math.round(panel.cell * 0.14)
            }
            MouseArea {
                id: area
                anchors.fill: parent
                onClicked: panel.keyboard.chooseEmoji(cellItem.shown)
                onPressAndHold: {
                    if (cellItem.modelData.t)
                        tones.openFor(cellItem.modelData, cellItem);
                }
            }
        }
        Text {
            objectName: "emojiEmpty"
            anchors.centerIn: parent
            visible: grid.count === 0
            text: qsTr("Emoji you use show up here")
            color: "#a0a0a0"
            font.family: Theme.fontFamily
            font.pixelSize: Math.round(panel.tabHeight * 0.4)
        }
    }

    // ABC, space, delete.
    Row {
        id: bar
        anchors.bottom: parent.bottom
        width: parent.width
        height: panel.barHeight
        component BarKey: Item {
            id: bk
            property alias label: lbl.text
            property real weight: 1
            signal pressed
            signal released
            signal clicked
            width: bar.width * weight / 6
            height: bar.height
            Rectangle {
                anchors.fill: parent
                anchors.margins: 3
                radius: 5
                color: ma.pressed ? Theme.highlight : "#3c3c3c"
                border.color: "#1e1e1e"
            }
            Text {
                id: lbl
                anchors.centerIn: parent
                color: "#e2e2e2"
                font.family: Theme.fontFamily
                font.pixelSize: Math.round(bar.height * 0.38)
            }
            MouseArea {
                id: ma
                anchors.fill: parent
                onPressed: bk.pressed()
                onReleased: bk.released()
                onCanceled: bk.released()
                onClicked: bk.clicked()
            }
        }
        BarKey {
            objectName: "emojiAbc"
            label: "ABC"
            onClicked: panel.keyboard.closeEmoji()
        }
        BarKey {
            objectName: "emojiSpace"
            weight: 4
            label: ""
            onClicked: panel.keyboard._sendKeyDownUp(KM.Key.Space, Qt.NoModifier)
        }
        BarKey {
            objectName: "emojiBackspace"
            label: "⌫"
            // Held, it repeats, as the keyboard's delete key does.
            onPressed: { panel.keyboard._sendKeyDownUp(KM.Key.Backspace, Qt.NoModifier); repeat.interval = panel.keyboard.cFirstRepeatDelay; repeat.start(); }
            onReleased: repeat.stop()
            Timer {
                id: repeat
                repeat: true
                onTriggered: { interval = panel.keyboard.cLetterDeleteRepeatDelay; panel.keyboard._sendKeyDownUp(KM.Key.Backspace, Qt.NoModifier); }
            }
        }
    }

    // The skin tones of the emoji held: the emoji itself and its five tones.
    Item {
        id: tones
        objectName: "emojiTones"
        property var entry: null
        visible: entry !== null
        anchors.fill: parent
        function openFor(entry, item) {
            tones.entry = entry;
            var p = item.mapToItem(panel, 0, 0);
            strip.x = Math.max(0, Math.min(panel.width - strip.width, p.x + item.width / 2 - strip.width / 2));
            strip.y = Math.max(0, p.y - strip.height);
        }
        function close() { entry = null; }
        MouseArea {
            anchors.fill: parent
            onClicked: tones.close()
        }
        Rectangle {
            id: strip
            width: panel.cell * 6 + 8
            height: panel.cell + 8
            radius: 8
            color: "#e2e2e2"
            border.color: "#7a7a7a"
            Row {
                objectName: "emojiToneRow"
                x: 4
                y: 4
                Repeater {
                    model: tones.entry ? [tones.entry.e].concat(tones.entry.t) : []
                    delegate: Item {
                        id: toneItem
                        required property string modelData
                        required property int index
                        objectName: "emojiTone-" + index
                        width: panel.cell
                        height: panel.cell
                        Rectangle {
                            anchors.fill: parent
                            radius: 6
                            color: Theme.highlight
                            opacity: 0.5
                            visible: toneArea.pressed || panel.keyboard.emojiFor(tones.entry) === toneItem.modelData
                        }
                        Text {
                            anchors.centerIn: parent
                            text: toneItem.modelData
                            font.family: Theme.emojiFontFamily
                            font.pixelSize: Math.round(panel.cell * 0.62)
                        }
                        MouseArea {
                            id: toneArea
                            anchors.fill: parent
                            onClicked: {
                                // Close last: closing destroys this delegate.
                                panel.keyboard.chooseEmoji(toneItem.modelData, tones.entry.e);
                                tones.close();
                            }
                        }
                    }
                }
            }
        }
    }
}
