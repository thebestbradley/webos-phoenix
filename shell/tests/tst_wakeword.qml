// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// "Hey Phoenix" (docs/AI-AND-MCP.md, Voice): with Settings > Assistant's
// wake word on, the shell's Dictation stands by (the status bar's faint
// microphone); the spotter hears the phrase in the microphone; a chime and
// the assistant's view opens listening, with the request said in the same
// breath; the answer is spoken; a read-back listens for Yes without the
// wake word; the view closes by itself once idle, and it stands by again.
// Over the lock screen only with "When the screen is off or locked", and
// what needs the unlock is asked again after it.
//
// The real Dictation plays the tests' recordings (services/wakeword/tests/
// data) as the microphone. The spotter and the transcriber are stand-ins:
// the spotter hears the phrase after 1.2 s of audio (where phoenix-wakeword
// hears it in hey-phoenix-timer.wav; build/wakeword-test runs the real one
// on these recordings), the transcriber says "text sam hi" for a long
// recording and "yes" for a short one. The service is a stand-in too.

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

    readonly property string recordings: String(Qt.resolvedUrl("../../services/wakeword/tests/data/")).replace(/^file:\/\//, "")

    // Stands in for org.webosphoenix.assistant.
    QtObject {
        id: fake
        property var asks: []
        property var messages: []
        property string tid: ""
        property int n: 0
        function msg(o) { n++; o.id = "m" + n; o.threadId = tid; o.time = n; return o; }
        function pending() {
            for (var i = messages.length - 1; i >= 0; --i)
                if (messages[i].role === "assistant")
                    return messages[i].status === "pending" ? messages[i] : null;
            return null;
        }
        function lunaCall(uri, params, cb) {
            var method = uri.replace(/^.*\//, "");
            var reply = { returnValue: true };
            if (method === "getSettings") {
                reply.settings = shell.assistantSettings;
            } else if (method === "thread") {
                reply.thread = { id: tid };
                reply.messages = messages.slice();
            } else if (method === "ask") {
                asks.push(JSON.parse(JSON.stringify(params)));
                if (params.newThread || tid === "") {
                    tid = "t" + asks.length;
                    messages = [];
                }
                var added = [msg({ role: "user", text: params.text })];
                var p = pending();
                if (/^yes/i.test(params.text) && p) {
                    p.status = "done";
                    added.push(msg({ role: "assistant", text: "Sent to Sam.", command: "text", status: "done" }));
                } else if (/^text/i.test(params.text) && params.locked) {
                    added.push(msg({ role: "assistant", text: "Unlock your phone first, and I'll do that.", command: "text", status: "locked" }));
                } else if (/^text/i.test(params.text)) {
                    added.push(msg({ role: "assistant", text: "Send \"hi\" to Sam?", command: "text", status: "pending",
                                     confirm: { command: "text", args: {} } }));
                } else {
                    added.push(msg({ role: "assistant", text: "Timer set for 10 minutes.", command: "timer", status: "done" }));
                }
                messages = messages.concat(added);
                reply.thread = { id: tid };
                reply.messages = added;
            }
            Qt.callLater(function () { cb(reply); });
        }
    }
    QtObject { id: fakeSpeech; property bool speaking: false }

    TestCase {
        name: "WakeWord"
        when: windowShown

        property var overlay: null
        property var dictation: null

        function initTestCase() {
            overlay = findChild(shell, "assistantOverlay");
            verify(overlay);
            overlay.source = fake;
            overlay.speech = fakeSpeech;
            overlay.idleCloseMs = 1000;
            // The spotter: hears it once, after 1.2 s of audio.
            shell.wakeWordCommand = ["sh", "-c", "echo '{\"ready\":true}'; head -c 38400 >/dev/null; "
                                     + "echo '{\"wake\":\"hey phoenix\",\"start\":0.5,\"end\":1.2,\"heard\":\"hey phoenix\"}'; cat >/dev/null"];
            // The transcriber: the request for a long recording, "yes" for a short one.
            shell.dictationCommand = ["sh", "-c", "b=$(wc -c < \"$0\"); if [ \"$b\" -gt 70000 ]; then t='text sam hi'; else t='yes'; fi; "
                                      + "printf '{\"returnValue\":true,\"text\":\"%s\"}' \"$t\"", "%f"];
        }

        function init() {
            shell.assistantSettings = {};
            shell.dictationInputFiles = [];
            shell.unlock();
            shell.closeAssistant();
            fake.asks = [];
            fake.messages = [];
            fake.tid = "";
            fakeSpeech.speaking = false;
            tryCompare(overlay, "visible", false, 3000);
        }
        function cleanup() {
            shell.assistantSettings = {};
            shell.dictationInputFiles = [];
            shell.unlock();
        }

        function microphone() { return findChild(shell, "statusBar").microphone; }
        function listenFor(files, more) {
            shell.dictationInputFiles = files.map(function (f) { return root.recordings + f; });
            var s = { enabled: true, wakeWord: true };
            for (var k in (more || {}))
                s[k] = more[k];
            shell.assistantSettings = s;
            dictation = shell.dictation;
            verify(dictation && dictation.wakeAvailable);
        }

        function test_theTranscriptWithoutThePhrase() {
            compare(overlay.withoutWakeWord("Hey Phoenix, text Sam I'm running late."), "text Sam I'm running late.");
            compare(overlay.withoutWakeWord("hey, phoenix set a timer"), "set a timer");
            compare(overlay.withoutWakeWord("Hey Phoenix."), "");
            compare(overlay.withoutWakeWord("Phoenix weather"), "Phoenix weather");
        }

        function test_offUntilTurnedOn() {
            shell.dictationInputFiles = [root.recordings + "hey-phoenix-timer.wav"];
            compare(shell.wakeWordOn, false);
            compare(shell.dictation.standingBy, false);
            compare(microphone(), "");
            listenFor(["hey-phoenix-timer.wav"]);
            tryCompare(shell.dictation, "standingBy", true, 2000);
            compare(microphone(), "standby");
            shell.assistantSettings = { enabled: false, wakeWord: true };
            tryCompare(shell.dictation, "standingBy", false, 2000);
            compare(shell.dictation.wakeWord, false);
            compare(microphone(), "");
        }

        function test_wakeAskReadBackYesAndClose() {
            var heard = shell.wakeWordHeard;
            listenFor(["hey-phoenix-timer.wav", "yes.wav"]);
            tryCompare(shell.dictation, "standingBy", true, 2000);
            // Heard: a chime, the view listening, the microphone orange.
            tryCompare(shell, "wakeWordHeard", heard + 1, 5000);
            compare(shell.sounds.last.name, "listen");
            tryCompare(overlay, "open", true, 1000);
            compare(overlay.listening, true);
            compare(overlay.birdPose === "listening" || overlay.birdPose === "asleep" || overlay.birdPose === "hello", true);
            compare(microphone(), "on");
            // The request said after the phrase, asked as spoken.
            tryVerify(function () { return fake.asks.length === 1; }, 8000, "the request asked");
            compare(fake.asks[0].text, "text sam hi");
            compare(fake.asks[0].voice, true);
            compare(fake.asks[0].locked, undefined);
            // Spoken, then the read-back listens for the answer, no wake word.
            fakeSpeech.speaking = true;
            wait(800);
            compare(overlay.listening, false);
            fakeSpeech.speaking = false;
            tryCompare(overlay, "listening", true, 3000);
            tryVerify(function () { return fake.asks.length === 2; }, 8000, "the answer asked");
            compare(fake.asks[1].text, "yes");
            compare(fake.asks[1].voice, true);
            compare(fake.messages[fake.messages.length - 1].text, "Sent to Sam.");
            compare(shell.wakeWordHeard, heard + 1);
            // Idle: it closes by itself, and stands by again.
            tryCompare(overlay, "open", false, 5000);
            tryCompare(shell.dictation, "standingBy", true, 3000);
            compare(microphone(), "standby");
        }

        function test_typingKeepsItOpen() {
            listenFor(["hey-phoenix-timer.wav", "yes.wav"]);
            tryCompare(overlay, "open", true, 5000);
            tryVerify(function () { return fake.asks.length === 1; }, 8000);
            tryCompare(overlay, "busy", false, 3000);
            var input = findChild(overlay, "assistantInput");
            input.forceActiveFocus();
            compare(overlay.handsFree, false);
            // No longer listening for the read-back's answer, now or later.
            compare(overlay.listening, false);
            wait(1500);
            compare(overlay.listening, false);
            input.text = "set a timer";
            input.accepted();
            tryVerify(function () { return fake.asks.length >= 2 && fake.asks[fake.asks.length - 1].text === "set a timer"; }, 3000);
            compare(fake.asks[fake.asks.length - 1].voice, undefined);
            wait(2000);
            compare(overlay.open, true);
        }

        function test_lockedOnlyWhenAllowed() {
            listenFor(["hey-phoenix-timer.wav"]);
            tryCompare(shell.dictation, "standingBy", true, 2000);
            shell.lock();
            tryCompare(shell.dictation, "standingBy", false, 2000);
            compare(microphone(), "");
            shell.assistantSettings = { enabled: true, wakeWord: true, wakeWhenLocked: true };
            tryCompare(shell.dictation, "standingBy", true, 2000);
        }

        function test_lockedAsksToUnlockThenAsksAgain() {
            shell.lock();
            listenFor(["hey-phoenix-timer.wav"], { wakeWhenLocked: true });
            tryCompare(overlay, "open", true, 5000);
            tryVerify(function () { return fake.asks.length === 1; }, 8000);
            compare(fake.asks[0].locked, true);
            compare(fake.asks[0].voice, true);
            // "Unlock first": the view goes; unlocked, the same words again.
            tryCompare(overlay, "open", false, 5000);
            compare(shell.locked, true);
            shell.unlock();
            tryVerify(function () { return fake.asks.length === 2; }, 3000);
            compare(fake.asks[1].text, "text sam hi");
            compare(fake.asks[1].locked, undefined);
            compare(fake.asks[1].voice, true);
            tryCompare(overlay, "open", true, 1000);
        }
    }
}
