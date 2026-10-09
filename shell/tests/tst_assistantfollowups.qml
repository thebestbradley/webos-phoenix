// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Follow-up questions in the Assistant's view (AssistantOverlay.qml; the
// service's lib/followups.js): after a command made something, the
// question comes after its answer with its answers as buttons; the bird
// plays done, then asks while it waits; a tap answers it (choose fu:<n>);
// closing the view with a question waiting leaves it for later
// (followUpLeave). The service is a stand-in, as in tst_assistant.qml.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        density: 1
        virtualKeyboard: true
        source: SimWindowSource { id: windows }
        system: SimSystemStatus { id: sys }
    }

    QtObject {
        id: fake
        property var calls: []
        property var messages: []
        property string tid: ""
        property int n: 0
        function msg(o) { n++; o.id = "m" + n; o.threadId = tid; o.time = n; return o; }
        function lunaCall(uri, params, cb) {
            var method = uri.replace(/^.*\//, "");
            calls.push(method + (params.text ? " " + params.text : params.choice ? " " + params.choice : params.threadId ? " " + params.threadId : ""));
            var reply = { returnValue: true };
            if (method === "getSettings") {
                reply.settings = { enabled: true };
            } else if (method === "thread") {
                reply.thread = tid ? { id: tid } : null;
                reply.messages = messages.slice();
            } else if (method === "ask") {
                if (params.newThread || tid === "") { tid = "t1"; messages = []; }
                var added = [msg({ role: "user", text: params.text }),
                             msg({ role: "assistant", text: "Added “Meeting with Sam” to your calendar, tomorrow at 3:00 PM.", via: "commands",
                                   command: "event", status: "done", choices: [{ id: "open", label: "Open Calendar" }] }),
                             msg({ role: "assistant", text: "Hey, where are you and Sam meeting for your 3 o'clock tomorrow?", via: "commands",
                                   command: "event", followUp: { id: "q1", kind: "location" },
                                   choices: [{ id: "fu:0", label: "Office" }, { id: "fu:1", label: "Video call" }, { id: "fu:skip", label: "Skip" }] })];
                messages = messages.concat(added);
                reply.thread = { id: tid };
                reply.messages = added;
            } else if (method === "choose") {
                var copy = messages.slice();
                for (var i = 0; i < copy.length; ++i)
                    if (copy[i].id === params.messageId) copy[i].chosen = params.choice;
                copy.push(msg({ role: "assistant", text: "Got it, I've put Office as the place.", command: "event", status: "done" }));
                messages = copy;
                reply.thread = { id: tid };
                reply.messages = copy.slice(-1);
            }
            Qt.callLater(function () { cb(reply); });
        }
    }
    QtObject { id: fakeSpeech; property bool speaking: false }
    property var overlay: null
    property var poses: []
    Connections {
        target: root.overlay
        function onBirdPoseChanged() { root.poses = root.poses.concat([root.overlay.birdPose]); }
    }

    TestCase {
        name: "AssistantFollowUps"
        when: windowShown

        function initTestCase() {
            root.overlay = findChild(shell, "assistantOverlay");
            verify(overlay);
            overlay.source = fake;
            overlay.speech = fakeSpeech;
        }

        function arrived(text) {
            var list = findChild(overlay, "assistantMessages"), row = null;
            tryVerify(function () {
                for (var i = 0; i < list.contentItem.children.length; ++i) {
                    var d = list.contentItem.children[i];
                    if (d.modelData !== undefined && d.visible && d.modelData.text === text && d.appear === 1 && d.choicesAppear === 1) {
                        row = d;
                        return true;
                    }
                }
                return false;
            }, 3000, "\"" + text + "\" in");
            return row;
        }

        function test_askedAfterTheAnswerAnsweredWithATapLeftOnClose() {
            shell.unlock();
            shell.openAssistant();
            tryCompare(overlay, "shown", 1, 3000);
            root.poses = [];
            overlay.ask("add a meeting with Sam tomorrow at 3");
            var row = arrived("Hey, where are you and Sam meeting for your 3 o'clock tomorrow?");
            // Done plays (not a shrug at the question's buttons), then it asks.
            compare(overlay.outcomeOf(fake.messages), "done");
            tryCompare(overlay, "birdPose", "asking", 4000);
            verify(root.poses.indexOf("done") >= 0, "done first: " + root.poses);
            verify(root.poses.indexOf("confused") < 0, "no shrug: " + root.poses);
            verify(overlay.asking);
            var office = findChild(row, "assistantChoice-fu:0");
            verify(office && office.visible);
            verify(findChild(row, "assistantChoice-fu:skip").visible);
            mouseClick(office, office.width / 2, office.height / 2);
            tryVerify(function () { return fake.calls.indexOf("choose fu:0") >= 0; }, 2000);
            arrived("Got it, I've put Office as the place.");
            verify(!overlay.asking);
            // A question left waiting as it closes goes for later.
            overlay.ask("add a meeting with Sam on friday at 3");
            arrived("Hey, where are you and Sam meeting for your 3 o'clock tomorrow?");
            shell.closeAssistant();
            tryVerify(function () { return fake.calls.indexOf("followUpLeave t1") >= 0; }, 2000);
            tryCompare(overlay, "visible", false, 3000);
        }
    }
}
