// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The AirPods card (docs/ACCESSORIES.md): a popup alert, in the popup
// alert's place as LunaSysMgr's own were (MemoryAlert.qml: the title 18 px
// bold, the message 14 px bold, white, 6 px margins, 52 px buttons; the
// bottom of a phone, a tablet's top right), shown by EarbudsMonitor when a
// case opens nearby, as an iPhone's AirPods card:
//
//   "pair"     AirPods not paired here: their model, the earbuds and case
//              drawn, each battery, Connect and Not Now. Connecting asks for
//              the case's pairing mode (non-Apple devices pair only then:
//              Apple, "Connect AirPods to a non-Apple device"), then shows
//              the pairing's progress (org.webosphoenix.earbuds pairing).
//   "battery"  AirPods paired here: their name and batteries, a few
//              seconds, with Done.

import QtQuick

Item {
    id: card
    objectName: "earbudsAlert"

    // "pair" or "battery".
    property string kind: "pair"
    // The nearby AirPods (status.nearby[i]) and the paired ones (devices[i]) if any.
    property var nearby: null
    property var device: null
    // org.webosphoenix.earbuds' pairing for these ({state, error}), or null.
    property var pairing: null
    property bool connecting: false
    readonly property int margin: Theme.px(6)
    readonly property int topOffset: Theme.px(4)

    signal connectPressed
    signal notNowPressed
    signal cancelPressed
    signal donePressed

    readonly property var battery: device && device.aap ? device.battery : nearby ? nearby.battery : null
    readonly property var charging: device && device.aap ? device.charging : nearby ? nearby.charging : null
    readonly property string state_: pairing ? pairing.state : connecting ? "searching" : ""
    readonly property string title: kind === "battery" && device ? device.name
                                    : nearby && nearby.modelName ? nearby.modelName : qsTr("AirPods")
    readonly property string message: {
        if (kind === "battery")
            return device && device.connected ? qsTr("Connected") : qsTr("Paired with this device");
        switch (state_) {
        case "searching": return qsTr("Hold the button on the back of the case until the light flashes white.");
        case "pairing": return qsTr("Pairing...");
        case "connecting": return qsTr("Connecting...");
        case "failed": return pairing && pairing.error ? pairing.error : qsTr("The AirPods could not be connected.");
        }
        return qsTr("Not connected to this device.");
    }
    readonly property bool busy: state_ === "searching" || state_ === "pairing" || state_ === "connecting"

    Text {
        id: titleText
        objectName: "earbudsAlertTitle"
        x: card.margin
        y: card.margin + card.topOffset
        width: card.width - 2 * card.margin
        elide: Text.ElideRight
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(18)
        font.bold: true
        color: "#FFFFFF"
        text: card.title
    }

    Item {
        id: middle
        x: card.margin
        y: titleText.y + titleText.height + card.margin
        width: card.width - 2 * card.margin
        height: Theme.px(96)

        EarbudsArt {
            id: art
            x: Theme.px(4)
            anchors.verticalCenter: parent.verticalCenter
            kind: card.nearby ? card.nearby.kind : card.device ? card.device.kind : ""
            lidOpen: !card.nearby || card.nearby.lidOpen
        }

        // Each battery as the status bar shows the device's: its name, the
        // status bar's battery icon (charging, when it is: StatusBar.qml,
        // StatusBarBattery.cpp:150-172), the level in its colours.
        Column {
            objectName: "earbudsAlertBatteries"
            x: art.x + art.width + Theme.px(18)
            width: parent.width - x
            anchors.verticalCenter: parent.verticalCenter
            spacing: Theme.px(8)
            Repeater {
                model: [{ key: "left", label: qsTr("Left") }, { key: "right", label: qsTr("Right") }, { key: "case", label: qsTr("Case") }]
                delegate: Item {
                    id: gauge
                    required property var modelData
                    readonly property real level: card.battery && typeof card.battery[modelData.key] === "number" ? card.battery[modelData.key] : -1
                    readonly property bool charging: !!card.charging && !!card.charging[modelData.key]
                    readonly property int step: Theme.batteryState(Math.max(0, level))
                    objectName: "earbudsAlertBattery_" + modelData.key
                    width: parent.width
                    height: Theme.px(22)
                    Text {
                        id: label
                        width: Theme.px(52)
                        anchors.verticalCenter: parent.verticalCenter
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.px(16)
                        font.bold: true
                        color: "#FFFFFF"
                        text: gauge.modelData.label
                    }
                    Image {
                        id: icon
                        x: label.width
                        anchors.verticalCenter: parent.verticalCenter
                        source: gauge.level < 0 ? Theme.asset("statusBar/battery-error.png")
                                : gauge.charging && gauge.step === 12 ? Theme.asset("statusBar/battery-charged.png")
                                : gauge.charging ? Theme.asset("statusBar/battery-charging-" + gauge.step + ".png")
                                : Theme.asset("statusBar/battery-" + Math.min(gauge.step, 11) + ".png")
                        width: Theme.artWidth(source)
                        height: Theme.artHeight(source)
                    }
                    Text {
                        objectName: "value"
                        x: icon.x + icon.width + Theme.px(8)
                        anchors.verticalCenter: parent.verticalCenter
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.px(16)
                        font.bold: true
                        color: gauge.level < 0 ? "#8a8a86" : gauge.charging ? "#8CE05A"
                             : gauge.level <= Theme.batteryChargeLevels[0] ? "#FF4D40"
                             : gauge.level <= Theme.batteryChargeLevels[1] ? "#FFC21A" : "#FFFFFF"
                        text: gauge.level >= 0 ? Math.round(gauge.level) + "%" : "--"
                    }
                }
            }
        }
    }

    Item {
        id: line
        x: card.margin
        y: middle.y + middle.height + card.margin
        width: card.width - 2 * card.margin
        height: Math.max(msgText.height, spinner.height)
        Image {
            id: spinner
            visible: card.busy
            width: visible ? Theme.px(24) : 0
            height: Theme.px(24)
            source: Theme.asset("spinner.png")
            smooth: true
            property int frame: 0
            rotation: frame * 360 / Theme.spinnerFrames
            NumberAnimation on frame { running: card.busy; from: 0; to: Theme.spinnerFrames; duration: Theme.spinnerDuration; loops: Animation.Infinite }
        }
        Text {
            id: msgText
            objectName: "earbudsAlertMessage"
            x: spinner.width + (spinner.visible ? Theme.px(6) : 0)
            width: parent.width - x
            wrapMode: Text.Wrap
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(14)
            font.bold: true
            color: "#FFFFFF"
            text: card.message
        }
    }

    // The buttons: Connect and Not Now, Cancel while pairing, Done.
    Row {
        objectName: "earbudsAlertButtons"
        x: card.margin + 1
        y: line.y + line.height + card.margin
        width: card.width - 2 * card.margin - 1
        spacing: Theme.px(6)
        readonly property int twoWide: (width - spacing) / 2
        ActionButton {
            objectName: "earbudsAlertConnect"
            visible: card.kind === "pair" && !card.busy
            width: parent.twoWide
            height: Theme.px(52)
            affirmative: true
            caption: card.state_ === "failed" ? qsTr("Try Again") : qsTr("Connect")
            onAction: card.connectPressed()
        }
        ActionButton {
            objectName: "earbudsAlertNotNow"
            visible: card.kind === "pair" && !card.busy
            width: parent.twoWide
            height: Theme.px(52)
            caption: qsTr("Not Now")
            onAction: card.notNowPressed()
        }
        ActionButton {
            objectName: "earbudsAlertCancel"
            visible: card.kind === "pair" && card.busy
            width: parent.width
            height: Theme.px(52)
            caption: qsTr("Cancel")
            onAction: card.cancelPressed()
        }
        ActionButton {
            objectName: "earbudsAlertDone"
            visible: card.kind === "battery"
            width: parent.width
            height: Theme.px(52)
            caption: qsTr("Done")
            onAction: card.donePressed()
        }
    }
}
