// Copyright (c) 2026 webOS Phoenix contributors
// Copyright (c) 2008-2013 LG Electronics, Inc. (the original)
// SPDX-License-Identifier: Apache-2.0
//
// The PIN / password panel of the lock screen: a port of luna-sysmgr's
// uiComponents/UnlockPanel (UnlockPanel.qml, PINPad.qml, PINButton.qml,
// PasswordField.qml) and uiComponents/ActionButton from QtQuick 1 to Qt 6,
// with the same art (images/pin/*, popup-bg.png) and metrics in legacy
// pixels. LockWindow drives it; see LockScreen.qml.
//
// Phoenix adds an Emergency Call button above Cancel and Done: the webOS
// phones' PIN screen came from the phone app (LockWindow.cpp:625-667, "The
// PIN/password unlock window was not received from the Phone app") and
// offered emergency calls; the TouchPad's UnlockPanel, the only one
// released, had no phone. Same button art (ActionButton, pin/button-black).
//
// Side by side (Phoenix): the panel is about 430 px tall stacked, more than
// a phone on its side has (320 less the status bar), and LockWindow centred
// it (LockWindow.cpp:479), so its title and Cancel / Done were off the
// screen. The original never showed the PIN pad on a phone turned sideways
// (the TouchPad's panel fits either way; the phones' PIN screen was the
// Phone app's, upright). When the lock screen says the stacked panel does
// not fit (availableHeight), a PIN panel puts the title, the field and the
// buttons in a column at the left and the keypad at the right, a little
// narrower if it must. Upright and on the tablet nothing changes.

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

    // Show the Emergency Call button (the shell has an emergency window to open).
    property bool emergencyAvailable: false

    // The room the lock screen has for the panel (0: as much as it needs).
    property real availableWidth: 0
    property real availableHeight: 0
    // The original's stacked layout, and its height.
    readonly property real stackedHeight: _stackedHeight(isPINEntry, emergencyAvailable)
    function _stackedHeight(pin, emergency) {
        // title, field, keypad, emergency call, Cancel / Done (as laid out below)
        var title = edgeOffset + margin + topOffset + titleText.height;
        var field = pin ? inputField.height + Theme.px(12) : Theme.px(6) + Theme.px(50);
        var keys = pin ? Theme.px(230) : 0;
        var em = emergency ? Theme.px(44) + margin + 1 : 0;
        return title + field + keys + em + Theme.px(52) + edgeOffset + margin;
    }
    readonly property bool sideBySide: isPINEntry && availableHeight > 0 && stackedHeight > availableHeight
    // Side by side: the column at the left, the keypad (320 wide, as the
    // original, unless the screen is narrower) at the right.
    readonly property real sideColumnWidth: Theme.px(150)
    readonly property real keypadWidth: sideBySide && availableWidth > 0
        ? Math.max(Theme.px(220), Math.min(Theme.px(320), availableWidth - 2 * edgeOffset - margin - sideColumnWidth))
        : Theme.px(320)
    readonly property real _columnX: edgeOffset + margin
    readonly property real _columnWidth: sideBySide ? sideColumnWidth - margin : Theme.px(320) - 2 * margin

    signal entryCanceled()
    signal passwordSubmitted(string password, bool isPIN)
    signal emergencyRequested()

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

    width: sideBySide ? 2 * edgeOffset + sideColumnWidth + margin + keypadWidth : Theme.px(320) + 2 * edgeOffset
    height: sideBySide
        ? Math.max(buttonGrid.y + buttonGrid.height, keyPad.y + keyPad.height) + edgeOffset + margin
        : buttonGrid.y + buttonGrid.height + edgeOffset + margin

    ArtBorderImage {
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
        x: panel.sideBySide ? panel.edgeOffset + Theme.centred(panel.sideColumnWidth, width)
                            : Theme.centred(panel.width, width)
        width: Math.min(implicitWidth, panel.sideBySide ? panel.sideColumnWidth : panel.width)
        elide: Text.ElideRight
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

        width: panel.sideBySide ? panel.sideColumnWidth - Theme.px(4) : Theme.px(320 - 4)
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

        ArtBorderImage {
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
        x: panel.sideBySide ? panel.edgeOffset + panel.sideColumnWidth + panel.margin : panel.edgeOffset
        y: panel.sideBySide ? panel.edgeOffset + panel.margin : passwordField.y + passwordField.height
        width: panel.keypadWidth
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

    // ---- Emergency Call (Phoenix) ----------------------------------------------

    ActionButton {
        id: emergencyButton
        objectName: "unlockEmergency"
        visible: panel.emergencyAvailable
        caption: qsTr("Emergency Call")
        captionColor: "#ff9d93"
        width: panel._columnWidth
        height: visible ? Theme.px(44) : 0
        x: panel._columnX
        anchors.top: panel.isPINEntry && !panel.sideBySide ? keyPad.bottom : passwordField.bottom
        anchors.topMargin: panel.sideBySide ? panel.margin : 0
        onAction: panel.emergencyRequested()
    }

    // ---- Cancel / Done (ActionButton.qml) --------------------------------------

    Grid {
        id: buttonGrid
        width: panel._columnWidth
        x: panel._columnX
        anchors.top: emergencyButton.bottom
        anchors.topMargin: emergencyButton.visible || panel.sideBySide ? panel.margin + 1 : 0
        // Side by side: Cancel above Done, each the column's width.
        columns: panel.sideBySide ? 1 : 2
        spacing: panel.margin + 1

        ActionButton {
            objectName: "unlockCancel"
            caption: qsTr("Cancel")
            width: panel.sideBySide ? buttonGrid.width : buttonGrid.width / 2 - panel.margin / 2
            height: Theme.px(52)
            onAction: panel.entryCanceled()
        }
        ActionButton {
            objectName: "unlockDone"
            caption: qsTr("Done")
            affirmative: true
            width: panel.sideBySide ? buttonGrid.width : buttonGrid.width / 2 - panel.margin / 2
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

        ArtBorderImage {
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
}
