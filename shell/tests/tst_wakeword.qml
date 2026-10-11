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
        property var chosen: []
        property var phrases: []
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
        // Buttons asked aloud, waiting (the service's data.asked).
        function offered() {
            for (var i = messages.length - 1; i >= 0; --i)
                if (messages[i].role === "assistant")
                    return messages[i].data && messages[i].data.asked && !messages[i].chosen ? messages[i] : null;
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
                var p = pending(), o = offered();
                if (params.voice && (/^i'm done/i.test(params.text) || (params.checkIn && /^no/i.test(params.text)))) {
                    added.push(msg({ role: "assistant", text: "Okay, bye for now!", status: "goodbye" }));
                } else if (/^yes/i.test(params.text) && p) {
                    p.status = "done";
                    added.push(msg({ role: "assistant", text: "Sent to Sam.", command: "text", status: "done" }));
                } else if (/^yes/i.test(params.text) && o) {
                    // Yes to "Want me to search the web for that?": the search, the browser in front.
                    o.chosen = "web";
                    added.push(msg({ role: "assistant", text: "Searching the web for “who won the 1998 world series”.", command: "search", status: "done",
                                     data: { opened: true } }));
                } else if (/^who won/i.test(params.text)) {
                    added.push(msg({ role: "assistant", text: "I can't answer that on my own yet. Want me to search the web for that?", kind: "fallback",
                                     choices: [{ id: "web", label: "Search the web" }, { id: "connect", label: "Connect model" }],
                                     data: params.voice ? { asked: true } : {} }));
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
            } else if (method === "choose") {
                // A button tapped in a spoken conversation: Sam Lee's read-back.
                chosen.push(JSON.parse(JSON.stringify(params)));
                var said2 = msg({ role: "assistant", text: "Send \"hi\" to Sam Lee?", command: "text", status: "pending", confirm: { command: "text", args: {} } });
                messages = messages.concat([said2]);
                reply.thread = { id: tid };
                reply.messages = [said2];
            } else if (method === "sessionPhrase") {
                phrases.push(params.kind);
                var said = msg(params.kind === "goodbye" ? { role: "assistant", text: "Bye for now!", status: "goodbye" }
                                                         : { role: "assistant", text: "Anything else?", kind: "checkIn" });
                messages = messages.concat([said]);
                reply.text = said.text;
                reply.messages = [said];
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
            // The wait after an answer, short for the tests (Settings: 15 s
            // to 2 min), and the check-in's.
            overlay.voiceWaitMs = 1500;
            overlay.checkInWaitMs = 1000;
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
            fake.chosen = [];
            fake.phrases = [];
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
            listenFor(["hey-phoenix-timer.wav", "yes.wav", "quiet.wav"]);
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
            // It stays open, listening on, for the wait (not 4 s and gone)...
            tryCompare(overlay, "listening", true, 3000);
            compare(fake.phrases.length, 0);
            // ... then checks in, listens again, and says goodbye.
            tryVerify(function () { return fake.phrases.length === 1; }, 6000, "the check-in");
            compare(fake.phrases[0], "checkIn");
            compare(overlay.open, true);
            tryCompare(overlay, "listening", true, 3000);
            tryVerify(function () { return fake.phrases.length === 2; }, 6000, "the goodbye");
            compare(fake.phrases[1], "goodbye");
            // Not until the goodbye has been said.
            fakeSpeech.speaking = true;
            wait(600);
            compare(overlay.open, true);
            fakeSpeech.speaking = false;
            // Then it closes by itself, and stands by again.
            tryCompare(overlay, "open", false, 5000);
            tryCompare(shell.dictation, "standingBy", true, 3000);
            compare(microphone(), "standby");
        }

        // "Hey Phoenix", a pause (the chime, the view opening), then the
        // request: it listens on. The phrase is not the request's speech:
        // counted as such, the pause after it ended the recording with
        // only "Hey Phoenix" in it, and the view closed unasked.
        function test_wakeThenAPauseThenTheRequest() {
            var transcriber = shell.dictationCommand;
            // The phrase alone is heard as itself; the request as the request.
            shell.dictationCommand = ["sh", "-c", "b=$(wc -c < \"$0\"); if [ \"$b\" -gt 120000 ]; then t='text sam hi'; else t='Hey Phoenix.'; fi; "
                                      + "printf '{\"returnValue\":true,\"text\":\"%s\"}' \"$t\"", "%f"];
            try {
                var heard = shell.wakeWordHeard;
                listenFor(["hey-phoenix.wav", "talk.wav"]);
                tryCompare(shell, "wakeWordHeard", heard + 1, 5000);
                tryCompare(overlay, "open", true, 1000);
                compare(overlay.listening, true);
                // Still listening through the pause, and the request is asked.
                tryVerify(function () { return fake.asks.length === 1; }, 15000, "the request asked");
                compare(fake.asks[0].text, "text sam hi");
                compare(fake.asks[0].voice, true);
            } finally {
                shell.dictationCommand = transcriber;
            }
        }
        // Woken with nothing said at all: it listens on a while, then
        // closes without a word.
        function test_wakeThenNothingClosesQuietly() {
            overlay.wakeWaitMs = 1000;
            try {
                listenFor(["hey-phoenix.wav"]);
                tryCompare(overlay, "open", true, 5000);
                tryCompare(overlay, "open", false, 15000);
                compare(fake.asks.length, 0);
                compare(fake.phrases.length, 0);
            } finally {
                overlay.wakeWaitMs = 15000;
            }
        }

        // "I'm done" in a spoken conversation: the goodbye, then it closes.
        function test_imDoneSaysGoodbyeAndCloses() {
            shell.dictationInputFiles = [root.recordings + "quiet.wav"];
            shell.assistantSettings = { enabled: true };
            shell.openAssistant(false);
            tryCompare(overlay, "open", true, 2000);
            overlay.voice = true;
            overlay.ask("set a timer");
            tryVerify(function () { return fake.asks.length === 1; }, 3000);
            tryCompare(overlay, "listening", true, 3000);
            overlay.stopListening(true);
            overlay.ask("I'm done");
            tryVerify(function () { return fake.asks.length === 2; }, 3000);
            compare(fake.asks[1].voice, true);
            tryCompare(overlay, "open", false, 3000);
            compare(fake.phrases.length, 0);
        }

        // Started with the microphone (not the wake word): the same wait,
        // check-in and goodbye; "no" to the check-in ends it.
        function test_microphoneConversationWaitsThenNoEndsIt() {
            shell.dictationInputFiles = [root.recordings + "yes.wav", root.recordings + "quiet.wav"];
            shell.assistantSettings = { enabled: true };
            shell.openAssistant(false);
            tryCompare(overlay, "open", true, 2000);
            compare(overlay.handsFree, false);
            overlay.listen();
            tryVerify(function () { return fake.asks.length === 1; }, 8000, "the request");
            compare(fake.asks[0].text, "yes");
            tryVerify(function () { return fake.phrases.length === 1; }, 8000, "the check-in");
            compare(overlay.open, true);
            tryCompare(overlay, "listening", true, 3000);
            overlay.stopListening(true);
            overlay.ask("no thanks");
            tryVerify(function () { return fake.asks.length === 2; }, 3000);
            compare(fake.asks[1].checkIn, true);
            tryCompare(overlay, "open", false, 3000);
            compare(fake.phrases.length, 1);
        }

        // Talk mode: "Search the web" asked aloud (docs/AI-AND-MCP.md
        // "Every button, asked aloud"): the bird asks, the microphone
        // listens; a spoken "yes" searches, and once that is said the view
        // makes way for the browser.
        function test_buttonsAskedAloudThenYesSearches() {
            shell.dictationInputFiles = [root.recordings + "yes.wav", root.recordings + "quiet.wav"];
            shell.assistantSettings = { enabled: true };
            shell.openAssistant(false);
            tryCompare(overlay, "open", true, 2000);
            overlay.voice = true;
            overlay.ask("who won the 1998 world series");
            tryVerify(function () { return fake.asks.length === 1; }, 3000);
            // Its question spoken, then the answer listened for.
            fakeSpeech.speaking = true;
            tryVerify(function () { return overlay.asking; }, 3000, "the bird asks");
            wait(600);
            compare(overlay.listening, false);
            fakeSpeech.speaking = false;
            tryCompare(overlay, "listening", true, 3000);
            tryVerify(function () { return fake.asks.length === 2; }, 8000, "the spoken answer");
            compare(fake.asks[1].text, "yes");
            compare(fake.asks[1].voice, true);
            compare(fake.messages[fake.messages.length - 1].command, "search");
            // Said, then out of the browser's way.
            fakeSpeech.speaking = true;
            wait(600);
            compare(overlay.open, true);
            fakeSpeech.speaking = false;
            tryCompare(overlay, "open", false, 3000);
            compare(fake.phrases.length, 0);
        }
        // The same choice by touch, in a spoken conversation: asked as
        // spoken (what comes next is asked aloud), and the session goes on
        // listening for it.
        function test_aTapGoesOnListening() {
            shell.dictationInputFiles = [root.recordings + "quiet.wav"];
            shell.assistantSettings = { enabled: true };
            shell.openAssistant(false);
            tryCompare(overlay, "open", true, 2000);
            overlay.voice = true;
            overlay.ask("who won the 1998 world series");
            tryVerify(function () { return overlay.asking; }, 3000, "the question waits");
            overlay.stopListening(true);
            var which = fake.msg({ role: "assistant", text: "Which one: Sam Delgado or Sam Lee?", command: "text", status: "ask",
                                   choices: [{ id: "pick:0", label: "Sam Delgado" }, { id: "pick:1", label: "Sam Lee" }],
                                   data: { awaiting: { command: "text", field: "who", options: ["Sam Delgado", "Sam Lee"] } } });
            fake.messages = fake.messages.concat([which]);
            overlay.choose(which, which.choices[1]);
            tryVerify(function () { return fake.chosen.length === 1; }, 3000);
            compare(fake.chosen[0].voice, true);
            tryCompare(overlay, "listening", true, 3000);
            verify(overlay.open);
        }
        // Typed: the same search closes the view at once (as the button does).
        function test_typedSearchMakesWayAtOnce() {
            shell.assistantSettings = { enabled: true };
            shell.openAssistant(false);
            tryCompare(overlay, "open", true, 2000);
            overlay.ask("who won the 1998 world series");
            tryVerify(function () { return fake.asks.length === 1; }, 3000);
            tryCompare(overlay, "busy", false, 3000);
            verify(!overlay.asking);
            fake.messages[fake.messages.length - 1].data = { asked: true };
            overlay.ask("yes");
            tryCompare(overlay, "open", false, 3000);
        }
        // A read-back unanswered: listened for only until the wait is over
        // (it listened on for ever), then the check-in (where the service
        // cancels it: assistant.js endChoice).
        function test_readBackListensOnlyForTheWait() {
            shell.dictationInputFiles = [root.recordings + "quiet.wav"];
            shell.assistantSettings = { enabled: true };
            shell.openAssistant(false);
            tryCompare(overlay, "open", true, 2000);
            overlay.voice = true;
            overlay.ask("text sam hi");
            tryVerify(function () { return fake.asks.length === 1; }, 3000);
            tryCompare(overlay, "listening", true, 3000);
            verify(overlay.asking);
            tryVerify(function () { return fake.phrases.length === 1; }, 8000, "the check-in");
            compare(fake.phrases[0], "checkIn");
            compare(fake.asks.length, 1);
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
            // Nothing of the apps behind the lock shows through.
            compare(overlay.backdrop, null);
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
