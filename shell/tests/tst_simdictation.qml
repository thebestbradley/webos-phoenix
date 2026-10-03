// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shell's microphone lent to an app (org.webosphoenix.dictation, Voice
// Dial): SimWindowSource takes a window's "dictation" host messages to the
// shell's Dictation and its states back to that window only. A stand-in
// Dictation records what it is asked; runs without Qt WebEngine.

import QtQuick
import QtTest
import Phoenix.Sim

Item {
    id: root
    width: 320
    height: 480

    SimWindowSource { id: windows }

    // Stands in for a WebAppWindow: the dictation events the shell sends it.
    Component {
        id: fakePage
        QtObject {
            property var events: []
            function runScript(js) {
                var m = /dictationEvent\((.*)\)$/.exec(js);
                if (m)
                    events = events.concat([JSON.parse(m[1])]);
            }
        }
    }

    // Stands in for Phoenix.Native Dictation.
    QtObject {
        id: mic
        property string owner: ""
        property string prompt: ""
        property bool autoStop: false
        property bool listening: false
        property bool busy: false
        property var calls: []
        signal stateChanged()
        signal transcribed(string text, string error)
        function start() { calls = calls.concat(["start"]); listening = true; stateChanged(); }
        function stop() { calls = calls.concat(["stop"]); listening = false; busy = true; stateChanged(); }
        function cancel() { calls = calls.concat(["cancel"]); listening = false; busy = false; stateChanged(); }
        function finish(text, error) { busy = false; stateChanged(); transcribed(text, error); }
    }

    TestCase {
        name: "SimDictation"
        when: windowShown

        property var a: null
        property var b: null

        function init() {
            a = fakePage.createObject(root);
            b = fakePage.createObject(root);
            windows._windows["w1"] = a;
            windows._windows["w2"] = b;
            mic.owner = ""; mic.listening = false; mic.busy = false; mic.calls = [];
            windows.dictation = mic;
        }
        function cleanup() {
            delete windows._windows["w1"];
            delete windows._windows["w2"];
            a.destroy();
            b.destroy();
        }

        function test_noMicrophone() {
            windows.dictation = null;
            windows._hostMessage("org.webosphoenix.voicedial", "w1", "dictation", { op: "start" });
            compare(a.events.length, 1);
            compare(a.events[0].state, "error");
            verify(/not available/.test(a.events[0].errorText));
        }

        function test_listenTranscribeForItsWindowOnly() {
            windows._hostMessage("org.webosphoenix.voicedial", "w1", "dictation",
                                 { op: "start", prompt: "Call Ada Palmer.", autoStop: true });
            compare(mic.calls, ["start"]);
            compare(mic.owner, "w1");
            compare(mic.prompt, "Call Ada Palmer.");
            verify(mic.autoStop);
            compare(a.events, [{ state: "listening" }]);

            // Another window: the microphone is in use; its stop is not obeyed.
            windows._hostMessage("org.webosphoenix.other", "w2", "dictation", { op: "start" });
            windows._hostMessage("org.webosphoenix.other", "w2", "dictation", { op: "stop" });
            compare(b.events.length, 1);
            compare(b.events[0].state, "error");
            verify(/in use/.test(b.events[0].errorText));
            compare(mic.calls, ["start"]);

            windows._hostMessage("org.webosphoenix.voicedial", "w1", "dictation", { op: "stop" });
            compare(mic.calls, ["start", "stop"]);
            compare(a.events[a.events.length - 1], { state: "transcribing" });
            mic.finish("Call Ada Palmer.", "");
            compare(a.events[a.events.length - 1], { state: "done", text: "Call Ada Palmer." });
            compare(b.events.length, 1);
            // Free again, the prompt and autoStop gone.
            compare(mic.owner, "");
            compare(mic.prompt, "");
            verify(!mic.autoStop);
        }

        function test_errorsAndCancel() {
            windows._hostMessage("org.webosphoenix.voicedial", "w1", "dictation", { op: "start", autoStop: true });
            mic.listening = false;
            mic.finish("", "Nothing was heard.");
            compare(a.events[a.events.length - 1], { state: "error", errorText: "Nothing was heard." });

            windows._hostMessage("org.webosphoenix.voicedial", "w1", "dictation", { op: "start" });
            windows._hostMessage("org.webosphoenix.voicedial", "w1", "dictation", { op: "cancel" });
            compare(mic.calls[mic.calls.length - 1], "cancel");
            compare(mic.owner, "");
        }

        function test_keyboardTranscriptsStayWithTheKeyboard() {
            // The keyboard's own recording (owner ""): no window hears it.
            mic.start();
            mic.stop();
            mic.finish("hello there", "");
            compare(a.events.length, 0);
            compare(b.events.length, 0);
        }
    }
}
