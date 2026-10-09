// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What an answer found, shown under it in the Assistant's view
// (AssistantOverlay.qml): the message's data.attachments
// (apps/assistant/service/assistant.js outcome), as
//   {type: "images", total, items: [{path, open}]}  a strip of thumbnails,
//       "+N more" past those shown;
//   {type: "cards", items: [{title, subtitle?, detail?, open?}]}  a card
//       each (an event, a contact, a memo, an email).
// A tap on one is shown(index), index across every attachment's items (the
// service's choice "show:<index>" opens its app on it). The conversation
// stays in front: the app is only brought forward by that tap or "Open ...".
//
// Thumbnails: the simulator's media are in the page's IndexedDB, which the
// shell cannot read, so source.lunaCall asks the runtime for a small copy
// (com.webos.service.mediaindexer phoenix/thumbnail); where that does not
// answer (a device), the file itself.

import QtQuick
import Phoenix.Shell

Column {
    id: att
    property var attachments: []
    property var source: null
    property real maxWidth: Theme.px(300)
    signal shown(int index)

    spacing: Theme.px(6)
    visible: attachments && attachments.length > 0

    // index of an attachment's first item among all of them.
    function firstIndex(a) {
        var n = 0;
        for (var i = 0; i < a; ++i)
            n += (attachments[i].items || []).length;
        return n;
    }

    Repeater {
        model: att.attachments || []
        delegate: Loader {
            id: part
            required property var modelData
            required property int index
            sourceComponent: modelData.type === "images" ? strip : modelData.type === "cards" ? cards : null
            readonly property int base: att.firstIndex(index)
            readonly property var shown: modelData

            Component {
                id: strip
                Flow {
                    objectName: "assistantImages"
                    width: att.maxWidth
                    spacing: Theme.px(6)
                    readonly property real cell: Theme.px(Theme.tablet ? 84 : 64)
                    Repeater {
                        model: part.shown.items || []
                        delegate: Rectangle {
                            id: thumb
                            required property var modelData
                            required property int index
                            objectName: "assistantImage-" + index
                            width: parent.cell
                            height: parent.cell
                            radius: Theme.px(6)
                            clip: true
                            color: "#30FFFFFF"
                            border.color: "#50FFFFFF"
                            border.width: 1
                            property string url: ""
                            Component.onCompleted: {
                                var path = modelData.path, size = Math.round(width * 2);
                                if (att.source && typeof att.source.lunaCall === "function") {
                                    att.source.lunaCall("luna://com.webos.service.mediaindexer/phoenix/thumbnail", { path: path, size: size }, function (r) {
                                        thumb.url = r && r.returnValue !== false && r.url ? r.url : "file://" + path;
                                    });
                                } else {
                                    thumb.url = "file://" + path;
                                }
                            }
                            Image {
                                anchors.fill: parent
                                anchors.margins: 1
                                source: thumb.url
                                fillMode: Image.PreserveAspectCrop
                                asynchronous: true
                                sourceSize.width: thumb.width * 2
                            }
                            MouseArea {
                                anchors.fill: parent
                                onClicked: att.shown(part.base + thumb.index)
                            }
                        }
                    }
                    Text {
                        visible: (part.shown.total || 0) > (part.shown.items || []).length
                        height: parent.cell
                        verticalAlignment: Text.AlignVCenter
                        text: qsTr("+%1 more").arg((part.shown.total || 0) - (part.shown.items || []).length)
                        color: "#D0FFFFFF"
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.px(14)
                    }
                }
            }
            Component {
                id: cards
                Column {
                    spacing: Theme.px(4)
                    Repeater {
                        model: part.shown.items || []
                        delegate: Rectangle {
                            id: card
                            required property var modelData
                            required property int index
                            objectName: "assistantCard-" + index
                            width: att.maxWidth
                            height: cardText.implicitHeight + Theme.px(16)
                            radius: Theme.px(10)
                            color: cardArea.pressed ? "#50FFFFFF" : "#30FFFFFF"
                            border.color: "#50FFFFFF"
                            border.width: 1
                            Column {
                                id: cardText
                                x: Theme.px(12)
                                y: Theme.px(8)
                                width: parent.width - Theme.px(24)
                                Text {
                                    width: parent.width
                                    text: card.modelData.title || ""
                                    elide: Text.ElideRight
                                    color: "#FFFFFF"
                                    font.family: Theme.fontFamily
                                    font.bold: true
                                    font.pixelSize: Theme.px(Theme.tablet ? 16 : 14)
                                }
                                Text {
                                    width: parent.width
                                    visible: text !== ""
                                    text: card.modelData.subtitle || ""
                                    elide: Text.ElideRight
                                    color: "#D0FFFFFF"
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.px(13)
                                }
                                Text {
                                    width: parent.width
                                    visible: text !== ""
                                    text: card.modelData.detail || ""
                                    wrapMode: Text.Wrap
                                    maximumLineCount: 3
                                    elide: Text.ElideRight
                                    color: "#B0FFFFFF"
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.px(13)
                                    textFormat: Text.PlainText
                                }
                            }
                            MouseArea {
                                id: cardArea
                                anchors.fill: parent
                                enabled: !!card.modelData.open
                                onClicked: att.shown(part.base + card.index)
                            }
                        }
                    }
                }
            }
        }
    }
}
