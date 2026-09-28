// Copyright (c) 2026 webOS Phoenix contributors
// Copyright (c) 2008-2013 LG Electronics, Inc. (the original)
// SPDX-License-Identifier: Apache-2.0
//
// The PIN / password panel of the lock screen: a port of luna-sysmgr's
// uiComponents/UnlockPanel (UnlockPanel.qml, PINPad.qml, PINButton.qml,
// PasswordField.qml) and uiComponents/ActionButton from QtQuick 1 to Qt 6,
// with the same art (images/pin/*, popup-bg.png) and metrics in legacy
// pixels. LockWindow drives it; see LockScreen.qml.

import QtQuick

FocusScope {
    id: panel

    property int edgeOffset: Theme.px(11)
    property int margin: Theme.px(6)
    property int topOffset: Theme.px(4)
    property bool isPINEntry: true
    property int minPassLength: 4
    property bool enforceMinLength: false
    property string queuedTitle: ""
    property string queuedHint: ""
    readonly property alias title: titleText.text
    readonly property alias hint: passwordField.hint
    readonly property alias enteredText: passwordField.enteredText

    signal entryCanceled()
    signal passwordSubmitted(string password, bool isPIN)

    function setupDialog(isPIN, title, hintMessage, enforceLength, minLen) {
        isPINEntry = isPIN;
        titleText.text = title;
        enforceMinLength = enforceLength;
        minPassLength = minLen;
        passwordField.clearAll();
        passwordField.hint = hintMessage;
    }

    function queueUpTitle(newTitle, newHint) {
        queuedTitle = newTitle;
        queuedHint = newHint;
    }

    // The next key after "PIN Incorrect" puts the title back.
    function _showQueued() {
        if (queuedTitle !== "") {
            titleText.text = queuedTitle;
            queuedTitle = "";
        }
        if (queuedHint !== "") {
            passwordField.hint = queuedHint;
            queuedHint = "";
        }
    }

    function _submit() {
        if (passwordField.enteredText.length > 0)
            passwordSubmitted(passwordField.enteredText, isPINEntry);
    }

    width: Theme.px(320) + 2 * edgeOffset
    height: buttonGrid.y + buttonGrid.height + edgeOffset + margin

    BorderImage {
        anchors.fill: parent
        source: Theme.asset("popup-bg.png")
        border { left: Theme.artBorder(35, source); top: Theme.artBorder(40, source); right: Theme.artBorder(35, source); bottom: Theme.artBorder(40, source) }
    }

    // Taps between the controls stay on the panel.
    MouseArea { anchors.fill: parent }

    Text {
        id: titleText
        font.family: Theme.fontFamily
        font.pixelSize: Theme.px(18)
        font.bold: true
        color: "#FFFFFF"
        anchors.horizontalCenter: parent.horizontalCenter
        y: panel.edgeOffset + panel.margin + panel.topOffset
        text: qsTr("Device Locked")
    }

    // ---- PasswordField.qml ---------------------------------------------------

    Item {
        id: passwordField
        property int maxPINLength: 30
        property int maxPassLength: 30
        property alias enteredText: inputField.text
        property string hint: ""

        width: Theme.px(320 - 4)
        height: panel.isPINEntry ? inputField.height + Theme.px(12) : Theme.px(50)
        x: panel.edgeOffset + Theme.px(3)
        y: titleText.y + titleText.height + (panel.isPINEntry ? 0 : Theme.px(6))

        function keyInput(keyText, isNumber) {
            if (inputField.text.length < (panel.isPINEntry ? maxPINLength : maxPassLength)
                    && (!panel.isPINEntry || isNumber))
                inputField.text += keyText;
        }
        function clearAll() { inputField.text = ""; }
        function deleteOne() {
            if (inputField.text.length > 0)
                inputField.text = inputField.text.slice(0, -1);
        }

        BorderImage {
            visible: !panel.isPINEntry
            anchors.fill: parent
            source: Theme.asset("pin/password-lock-field.png")
            border { left: Theme.artBorder(30, source); top: Theme.artBorder(10, source); right: Theme.artBorder(30, source); bottom: Theme.artBorder(10, source) }
        }

        TextInput {
            id: inputField
            objectName: "unlockField"
            width: parent.width - Theme.px(16)
            anchors.centerIn: parent
            echoMode: TextInput.Password
            passwordCharacter: "•"
            cursorVisible: !panel.isPINEntry
            readOnly: true
            activeFocusOnPress: false
            horizontalAlignment: panel.isPINEntry ? TextInput.AlignHCenter : TextInput.AlignLeft
            color: panel.isPINEntry ? "#FFFFFF" : "#000000"
            font.bold: true
            font.pixelSize: Theme.px(18)
            font.letterSpacing: Theme.px(2)
            font.family: Theme.fontFamily
        }

        Text {
            visible: inputField.text.length === 0
            color: "#9C9C9C"
            font.pixelSize: Theme.px(17)
            font.family: Theme.fontFamily
            width: parent.width - Theme.px(20)
            anchors.centerIn: parent
            horizontalAlignment: panel.isPINEntry ? Text.AlignHCenter : Text.AlignLeft
            text: passwordField.hint
        }
    }

    // ---- PINPad.qml ------------------------------------------------------------

    Item {
        id: keyPad
        visible: panel.isPINEntry
        x: panel.edgeOffset
        anchors.top: passwordField.bottom
        width: Theme.px(320)
        height: visible ? Theme.px(230) : 0

        Image {
            anchors.fill: parent
            source: Theme.asset("pin/pin-grid.png")
        }

        Grid {
            id: keys
            y: Theme.px(4)
            width: parent.width
            height: parent.height - Theme.px(4) - Theme.px(6)
            columns: 3

            Repeater {
                model: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "\b"]
                delegate: PinButton {
                    required property string modelData
                    required property int index
                    // The middle and right columns are a pixel wider (PINPad.qml).
                    width: keys.width / 3 + (index % 3 === 0 ? 0 : 1)
                    height: keys.height / 4
                    caption: modelData
                    // The blank left of 0 keeps its cell (a hidden Grid child would not).
                    enabled: modelData !== ""
                    imgSource: modelData === "\b" ? Theme.asset("pin/icon-delete.png") : ""
                    onAction: (text) => {
                        if (text === "\b") {
                            passwordField.deleteOne();
                        } else {
                            passwordField.keyInput(text, true);
                            panel._showQueued();
                        }
                    }
                }
            }
        }
    }

    // ---- Cancel / Done (ActionButton.qml) --------------------------------------

    Grid {
        id: buttonGrid
        width: Theme.px(320) - 2 * panel.margin
        x: panel.edgeOffset + panel.margin
        anchors.top: panel.isPINEntry ? keyPad.bottom : passwordField.bottom
        columns: 2
        spacing: panel.margin + 1

        ActionButton {
            objectName: "unlockCancel"
            caption: qsTr("Cancel")
            width: buttonGrid.width / 2 - panel.margin / 2
            height: Theme.px(52)
            onAction: panel.entryCanceled()
        }
        ActionButton {
            objectName: "unlockDone"
            caption: qsTr("Done")
            affirmative: true
            width: buttonGrid.width / 2 - panel.margin / 2
            height: Theme.px(52)
            active: passwordField.enteredText.length >= (panel.enforceMinLength ? panel.minPassLength : 1)
            onAction: panel._submit()
        }
    }

    // ---- Keyboard entry (UnlockPanel.qml Keys handlers) ------------------------

    focus: true
    Keys.onPressed: (event) => {
        event.accepted = true;
        if (event.key === Qt.Key_Backspace || event.key === Qt.Key_Delete) {
            passwordField.deleteOne();
        } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            panel._submit();
        } else if (event.key === Qt.Key_Escape) {
            panel.entryCanceled();
        } else if (event.text.length > 0 && event.text.charCodeAt(0) >= 32) {
            passwordField.keyInput(event.text, event.key >= Qt.Key_0 && event.key <= Qt.Key_9);
            panel._showQueued();
        }
    }

    component PinButton: Item {
        id: pinButton
        property bool isPressed: false
        property string caption: ""
        property string imgSource: ""
        signal action(string text)

        BorderImage {
            anchors.fill: parent
            visible: pinButton.isPressed
            source: Theme.asset("pin/pin-key-highlight.png")
            border { left: Theme.artBorder(10, source); top: Theme.artBorder(10, source); right: Theme.artBorder(10, source); bottom: Theme.artBorder(10, source) }
        }
        Text {
            visible: pinButton.caption !== "" && pinButton.imgSource === ""
            anchors.centerIn: parent
            text: pinButton.caption
            color: "#FFFFFF"
            font.bold: true
            font.pixelSize: Theme.px(30)
            font.family: Theme.fontFamily
        }
        Image {
            visible: pinButton.imgSource !== ""
            anchors.centerIn: parent
            width: Theme.px(50)
            height: Theme.px(50)
            source: pinButton.imgSource
        }
        MouseArea {
            objectName: "pinKey" + (pinButton.caption === "\b" ? "Delete" : pinButton.caption)
            anchors.fill: parent
            onPressed: pinButton.isPressed = true
            onReleased: pinButton.isPressed = false
            onCanceled: pinButton.isPressed = false
            onClicked: pinButton.action(pinButton.caption)
        }
    }

    component ActionButton: Item {
        id: actionButton
        property bool isPressed: false
        property bool active: true
        property string caption: ""
        property bool affirmative: false
        readonly property real inactiveOpacity: 0.70
        signal action()

        BorderImage {
            anchors.fill: parent
            source: Theme.asset(actionButton.affirmative
                                ? (actionButton.isPressed ? "pin/button-green-press.png" : "pin/button-green.png")
                                : (actionButton.isPressed ? "pin/button-black-press.png" : "pin/button-black.png"))
            border { left: Theme.artBorder(10, source); top: Theme.artBorder(10, source); right: Theme.artBorder(10, source); bottom: Theme.artBorder(10, source) }
            opacity: actionButton.active ? 1.0 : actionButton.inactiveOpacity
        }
        Text {
            anchors.centerIn: parent
            text: actionButton.caption
            color: "#FFFFFF"
            font.bold: true
            font.pixelSize: Theme.px(16)
            font.family: Theme.fontFamily
            opacity: actionButton.active ? 1.0 : actionButton.inactiveOpacity
        }
        MouseArea {
            anchors.fill: parent
            onPressed: if (actionButton.active) actionButton.isPressed = true
            onReleased: actionButton.isPressed = false
            onCanceled: actionButton.isPressed = false
            onClicked: if (actionButton.active) actionButton.action()
        }
    }
}
