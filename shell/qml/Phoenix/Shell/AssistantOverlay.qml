// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix Assistant's system view (docs/M6-PLAN.md F3): the
// conversation in use floats over whatever is on screen, on a translucent,
// blurred backdrop (BackdropBlur over Shell.backdrop), like the recent Siri.
// A Phoenix addition: webOS had no assistant. Opened by holding the
// launcher button in the quick launch bar (QuickLaunch.assistantRequested).
//
// It shows the thread in use (org.webosphoenix.assistant thread {}: the
// same one the Assistant app shows), with a text field (the keyboard comes
// up for it as for any shell field) and a microphone (the shell's
// dictation, whisper.cpp, ending by itself when the speaker stops). The
// answers' choices ("Ask <cloud model>", "Search the web") and read-backs
// ("Send ... to Sam?") are buttons. A tap outside the conversation, Back or
// Escape closes it.
//
// All through the window source's lunaCall (in phoenix-sim the runtime's
// service in the system UI page; on a device the bus).

import QtQuick
import Phoenix.Shell

Item {
    id: ov
    objectName: "assistantOverlay"

    property var source: null
    // The shell's dictation (Phoenix.Native Dictation), or null: no microphone.
    property var dictation: null
    // The scene behind (Shell.backdrop), blurred.
    property Item backdrop: null
    // Room the keyboard takes at the bottom.
    property real bottomInset: 0
    property bool open: false
    // Start listening as it opens (a hold that came with the microphone in mind).
    property bool listenOnOpen: false

    signal closeRequested()

    readonly property string service: "luna://org.webosphoenix.assistant/"
    property string threadId: ""
    property var messages: []
    property bool busy: false
    property bool listening: false
    property string status: ""          // a line under the conversation: "Listening…", an error

    visible: opacity > 0
    opacity: open ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: Theme.reduceMotion ? 0 : 200; easing.type: Easing.OutCubic } }
    enabled: open

    onOpenChanged: {
        if (open) {
            status = "";
            refresh();
            // Voice first where there is a microphone (a tap on the field
            // brings the keyboard); else the keyboard at once.
            if (listenOnOpen && dictation)
                Qt.callLater(listen);
            else if (!dictation)
                Qt.callLater(function () { input.forceActiveFocus(); });
            else
                ov.forceActiveFocus();
        } else {
            stopListening(true);
            input.focus = false;
            input.text = "";
        }
    }

    function _call(method, params, done) {
        if (!source || typeof source.lunaCall !== "function") {
            if (done)
                done(null);
            return;
        }
        source.lunaCall(service + method, params || {}, function (r) {
            if (done)
                done(r);
        });
    }

    function refresh() {
        _call("thread", {}, function (r) {
            if (!r || r.returnValue === false)
                return;
            ov.threadId = r.thread ? r.thread.id : "";
            ov.messages = r.messages || [];
        });
    }

    function _settled(r) {
        busy = false;
        if (!r) {
            status = qsTr("The assistant is not running.");
            return;
        }
        if (r.returnValue === false) {
            status = String(r.errorText || qsTr("Something went wrong."));
            return;
        }
        if (r.thread)
            threadId = r.thread.id;
        refresh();
    }

    function ask(text) {
        text = String(text || "").trim();
        if (!text || busy)
            return;
        busy = true;
        status = "";
        // Shown at once; the thread comes back with the answer.
        messages = messages.concat([{ id: "pending-user", role: "user", text: text }]);
        var p = { text: text };
        if (threadId !== "")
            p.threadId = threadId;
        _call("ask", p, _settled);
    }
    function choose(message, choice) {
        if (busy)
            return;
        busy = true;
        _call("choose", { threadId: threadId, messageId: message.id, choice: choice.id }, function (r) {
            _settled(r);
            // Settings or the browser came up: out of their way.
            if (r && r.returnValue !== false && (choice.id === "settings" || choice.id === "web"))
                ov.closeRequested();
        });
    }
    function confirm(message, accept) {
        if (busy)
            return;
        busy = true;
        _call("confirm", { threadId: threadId, messageId: message.id, accept: accept }, _settled);
    }
    function newConversation() {
        _call("newThread", {}, function (r) {
            ov.threadId = r && r.thread ? r.thread.id : "";
            ov.messages = [];
            ov.status = "";
            input.forceActiveFocus();
        });
    }

    // ---- The microphone ----------------------------------------------------------------
    readonly property string _owner: "assistant"
    function listen() {
        if (!dictation || dictation.busy)
            return;
        if (dictation.listening) {
            if (dictation.owner === _owner)
                dictation.stop();
            return;
        }
        input.focus = false;
        dictation.owner = _owner;
        dictation.prompt = "";
        dictation.autoStop = true;
        dictation.start();
        listening = dictation.listening;
        status = listening ? qsTr("Listening…") : qsTr("The microphone is not available.");
    }
    function stopListening(cancel) {
        if (!dictation || !listening)
            return;
        listening = false;
        if (cancel)
            dictation.cancel();
        Qt.callLater(_releaseMicrophone);
    }
    function _releaseMicrophone() {
        if (dictation && dictation.owner === _owner && !dictation.listening && !dictation.busy) {
            dictation.owner = "";
            dictation.autoStop = false;
        }
    }
    Connections {
        target: ov.dictation
        ignoreUnknownSignals: true
        function onStateChanged() {
            if (ov.listening && ov.dictation.busy)
                ov.status = qsTr("Transcribing…");
        }
        function onTranscribed(text, error) {
            if (!ov.listening)
                return;
            ov.listening = false;
            // The keyboard takes transcriptions without an owner: let go
            // only after every listener has seen this one.
            Qt.callLater(ov._releaseMicrophone);
            ov.status = error ? String(error) : "";
            if (!error && String(text || "").trim())
                ov.ask(text);
        }
    }

    Keys.onEscapePressed: closeRequested()

    // ---- The backdrop ----------------------------------------------------------------
    BackdropBlur {
        anchors.fill: parent
        source: ov.open || ov.visible ? ov.backdrop : null
        radius: Theme.px(48)
    }
    Rectangle {
        anchors.fill: parent
        // Darker where nothing blurs (the software renderer).
        color: GraphicsInfo.api === GraphicsInfo.Software ? "#D8101418" : "#80101418"
    }
    // The glow along the bottom while it listens or thinks.
    Rectangle {
        objectName: "assistantGlow"
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.bottomMargin: ov.bottomInset
        height: Theme.px(6)
        visible: ov.listening || ov.busy
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0.0; color: "#5ac8fa" }
            GradientStop { position: 0.35; color: "#af52de" }
            GradientStop { position: 0.7; color: "#ff2d55" }
            GradientStop { position: 1.0; color: "#ff9500" }
        }
        SequentialAnimation on opacity {
            running: ov.listening || ov.busy
            loops: Animation.Infinite
            NumberAnimation { from: 0.4; to: 1; duration: 700; easing.type: Easing.InOutQuad }
            NumberAnimation { from: 1; to: 0.4; duration: 700; easing.type: Easing.InOutQuad }
        }
    }

    // A tap outside the conversation closes it.
    MouseArea {
        objectName: "assistantOutside"
        anchors.fill: parent
        onClicked: ov.closeRequested()
    }

    // ---- The conversation ----------------------------------------------------------------
    readonly property real panelWidth: Math.min(width - Theme.px(24), Theme.px(Theme.tablet ? 560 : 420))

    Item {
        id: panel
        objectName: "assistantPanel"
        width: ov.panelWidth
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.statusBarHeight + Theme.px(12)
        anchors.bottom: parent.bottom
        anchors.bottomMargin: ov.bottomInset + Theme.px(16)

        // Taps on the conversation stay in it.
        MouseArea {
            x: 0; width: parent.width
            y: list.y + Math.max(0, list.height - list.contentHeight)
            height: parent.height - y
        }

        Text {
            id: heading
            anchors.left: parent.left
            anchors.right: newButton.left
            anchors.top: parent.top
            text: qsTr("Phoenix Assistant")
            color: "#B0FFFFFF"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(14)
            font.bold: true
        }
        Text {
            id: newButton
            objectName: "assistantNew"
            anchors.right: parent.right
            anchors.top: parent.top
            visible: ov.messages.length > 0
            text: qsTr("New")
            color: "#B0FFFFFF"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(14)
            MouseArea { anchors.fill: parent; anchors.margins: -Theme.px(10); onClicked: ov.newConversation() }
        }

        ListView {
            id: list
            objectName: "assistantMessages"
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: heading.bottom
            anchors.topMargin: Theme.px(8)
            anchors.bottom: statusLine.top
            anchors.bottomMargin: Theme.px(6)
            clip: true
            spacing: Theme.px(8)
            // The latest at the bottom, as in a conversation.
            verticalLayoutDirection: ListView.BottomToTop
            model: ov.messages.slice().reverse()
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height
            delegate: Item {
                id: row
                required property var modelData
                readonly property bool mine: modelData.role === "user"
                width: list.width
                height: bubble.height + (actions.visible ? actions.height + Theme.px(6) : 0)

                Rectangle {
                    id: bubble
                    objectName: "assistantBubble"
                    anchors.right: row.mine ? parent.right : undefined
                    anchors.left: row.mine ? undefined : parent.left
                    width: Math.min(list.width * 0.86, words.implicitWidth + Theme.px(24))
                    height: words.implicitHeight + Theme.px(16) + (via.visible ? via.height : 0)
                    radius: Theme.px(14)
                    color: row.mine ? "#E8FFFFFF" : (row.modelData.status === "failed" ? "#B04A2020" : "#A0303438")
                    border.color: row.mine ? "transparent" : "#40FFFFFF"
                    border.width: row.mine ? 0 : 1
                    Text {
                        id: words
                        x: Theme.px(12)
                        y: Theme.px(8)
                        width: Math.min(list.width * 0.86 - Theme.px(24), implicitWidth)
                        text: row.modelData.text
                        wrapMode: Text.Wrap
                        color: row.mine ? "#202428" : "#FFFFFF"
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.px(Theme.tablet ? 18 : 16)
                        textFormat: Text.PlainText
                    }
                    Text {
                        id: via
                        anchors.left: words.left
                        anchors.top: words.bottom
                        visible: !row.mine && !!row.modelData.source
                        text: row.modelData.source || ""
                        color: "#90FFFFFF"
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.px(11)
                    }
                }
                Flow {
                    id: actions
                    anchors.top: bubble.bottom
                    anchors.topMargin: Theme.px(6)
                    width: list.width
                    spacing: Theme.px(8)
                    readonly property bool asking: row.modelData.status === "pending" && !!row.modelData.confirm
                    readonly property var choices: row.modelData.choices && !row.modelData.chosen ? row.modelData.choices : []
                    visible: asking || choices.length > 0
                    Repeater {
                        model: actions.choices
                        delegate: ActionButton {
                            required property var modelData
                            objectName: "assistantChoice-" + modelData.id
                            width: Math.min(list.width, label.implicitWidth + Theme.px(40))
                            height: Theme.px(40)
                            caption: modelData.label
                            affirmative: modelData.id.indexOf("cloud:") === 0
                            onAction: ov.choose(row.modelData, modelData)
                            Text { id: label; visible: false; text: parent.caption; font.pixelSize: Theme.px(16); font.bold: true; font.family: Theme.fontFamily }
                        }
                    }
                    ActionButton {
                        objectName: "assistantConfirmYes"
                        visible: actions.asking
                        width: Theme.px(120)
                        height: Theme.px(40)
                        affirmative: true
                        caption: row.modelData.command === "text" ? qsTr("Send") : row.modelData.command === "call" ? qsTr("Call") : qsTr("Yes")
                        onAction: ov.confirm(row.modelData, true)
                    }
                    ActionButton {
                        objectName: "assistantConfirmNo"
                        visible: actions.asking
                        width: Theme.px(120)
                        height: Theme.px(40)
                        caption: qsTr("Cancel")
                        onAction: ov.confirm(row.modelData, false)
                    }
                }
            }

            // Nothing asked yet.
            Text {
                anchors.bottom: parent.bottom
                anchors.horizontalCenter: parent.horizontalCenter
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                visible: ov.messages.length === 0
                wrapMode: Text.Wrap
                text: qsTr("Ask me to set a timer, text someone, turn on the flashlight, open an app, or anything else.")
                color: "#C0FFFFFF"
                font.family: Theme.fontFamily
                font.pixelSize: Theme.px(Theme.tablet ? 20 : 17)
            }
        }

        // Thinking, listening, or what went wrong.
        Item {
            id: statusLine
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: field.top
            anchors.bottomMargin: Theme.px(8)
            height: ov.busy || ov.status !== "" ? Theme.px(20) : 0
            Row {
                id: dots
                visible: ov.busy
                spacing: Theme.px(5)
                anchors.verticalCenter: parent.verticalCenter
                Repeater {
                    model: 3
                    delegate: Rectangle {
                        required property int index
                        width: Theme.px(7); height: width; radius: width / 2
                        color: "#FFFFFF"
                        SequentialAnimation on opacity {
                            running: ov.busy
                            loops: Animation.Infinite
                            PauseAnimation { duration: index * 150 }
                            NumberAnimation { from: 0.25; to: 1; duration: 300 }
                            NumberAnimation { from: 1; to: 0.25; duration: 300 }
                            PauseAnimation { duration: (2 - index) * 150 }
                        }
                    }
                }
            }
            Text {
                objectName: "assistantStatus"
                anchors.left: dots.visible ? dots.right : parent.left
                anchors.leftMargin: dots.visible ? Theme.px(8) : 0
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: ov.status
                elide: Text.ElideRight
                color: "#D0FFFFFF"
                font.family: Theme.fontFamily
                font.pixelSize: Theme.px(13)
            }
        }

        // The text field and the microphone.
        Rectangle {
            id: field
            objectName: "assistantField"
            anchors.left: parent.left
            anchors.right: mic.visible ? mic.left : parent.right
            anchors.rightMargin: mic.visible ? Theme.px(8) : 0
            anchors.bottom: parent.bottom
            height: Theme.px(44)
            radius: height / 2
            color: "#F2FFFFFF"
            TextInput {
                id: input
                objectName: "assistantInput"
                anchors.left: parent.left
                anchors.leftMargin: Theme.px(16)
                anchors.right: parent.right
                anchors.rightMargin: Theme.px(16)
                anchors.verticalCenter: parent.verticalCenter
                color: "#202428"
                font.family: Theme.fontFamily
                font.pixelSize: Theme.px(17)
                clip: true
                enabled: !ov.busy
                Keys.onEscapePressed: ov.closeRequested()
                onAccepted: { var t = text; text = ""; ov.ask(t); }
                Text {
                    anchors.fill: parent
                    verticalAlignment: Text.AlignVCenter
                    visible: input.text === "" && !input.activeFocus
                    text: ov.listening ? qsTr("Listening…") : qsTr("Ask anything")
                    color: "#808890"
                    font: input.font
                }
            }
        }
        Rectangle {
            id: mic
            objectName: "assistantMic"
            visible: !!ov.dictation
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            width: Theme.px(44)
            height: width
            radius: width / 2
            color: ov.listening ? "#FF3B30" : "#F2FFFFFF"
            // A microphone: the capsule, its stand and its foot.
            Rectangle {
                width: Theme.px(10); height: Theme.px(16); radius: width / 2
                anchors.horizontalCenter: parent.horizontalCenter
                y: Theme.px(9)
                color: ov.listening ? "#FFFFFF" : "#202428"
            }
            Rectangle {
                width: Theme.px(16); height: Theme.px(10); radius: Theme.px(8)
                anchors.horizontalCenter: parent.horizontalCenter
                y: Theme.px(18)
                color: "transparent"
                border.color: ov.listening ? "#FFFFFF" : "#202428"
                border.width: Theme.px(2)
                // Only its lower half shows.
                Rectangle { width: parent.width + 2; height: parent.height / 2; y: -1; x: -1; color: mic.color }
            }
            Rectangle {
                width: Theme.px(2); height: Theme.px(6)
                anchors.horizontalCenter: parent.horizontalCenter
                y: Theme.px(28)
                color: ov.listening ? "#FFFFFF" : "#202428"
            }
            Rectangle {
                width: Theme.px(10); height: Theme.px(2)
                anchors.horizontalCenter: parent.horizontalCenter
                y: Theme.px(33)
                color: ov.listening ? "#FFFFFF" : "#202428"
            }
            MouseArea {
                anchors.fill: parent
                onClicked: ov.listening ? ov.dictation.stop() : ov.listen()
            }
        }
    }
}
