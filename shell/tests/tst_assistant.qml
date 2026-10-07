// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix Assistant's view (AssistantOverlay.qml, M6 F3): holding the
// launcher button in the quick launch bar opens it while a tap still opens
// the launcher; Back, Escape and a tap outside close it; typed requests go
// to org.webosphoenix.assistant and the thread comes back with its answers,
// choices ("Search the web") and read-backs (Send / Cancel); with the
// assistant off a hold does nothing. The service is a stand-in here (its
// own tests are in apps/assistant/service).

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

    // Stands in for org.webosphoenix.assistant (lunaCall, as the window source has it).
    QtObject {
        id: fake
        property bool enabled: true
        property var calls: []
        property var messages: []
        property int n: 0
        function msg(o) { n++; o.id = "m" + n; o.threadId = "t1"; o.time = n; return o; }
        function lunaCall(uri, params, cb) {
            var method = uri.replace(/^.*\//, "");
            calls.push(method + (params.text ? " " + params.text : params.choice ? " " + params.choice : params.accept !== undefined ? " " + params.accept : ""));
            var reply = { returnValue: true };
            if (method === "getSettings") {
                reply.settings = { enabled: enabled };
            } else if (method === "thread") {
                reply.thread = messages.length ? { id: "t1" } : null;
                reply.messages = messages.slice();
            } else if (method === "newThread") {
                messages = [];
                reply.thread = { id: "t2" };
            } else if (method === "ask") {
                var added = [msg({ role: "user", text: params.text })];
                if (/^text/.test(params.text))
                    added.push(msg({ role: "assistant", text: "Send \"hi\" to Sam?", command: "text", status: "pending", confirm: { command: "text", args: {} } }));
                else if (/odyssey/.test(params.text))
                    added.push(msg({ role: "assistant", text: "I can't do that on the phone.", choices: [{ id: "web", label: "Search the web" }] }));
                else
                    added.push(msg({ role: "assistant", text: "The flashlight is on.", via: "commands", status: "done" }));
                messages = messages.concat(added);
                reply.thread = { id: "t1" };
                reply.messages = added;
            } else if (method === "confirm" || method === "choose") {
                var copy = messages.slice();
                for (var i = 0; i < copy.length; ++i)
                    if (copy[i].id === params.messageId) {
                        if (method === "confirm") copy[i].status = params.accept ? "done" : "cancelled";
                        else copy[i].chosen = params.choice;
                    }
                copy.push(msg({ role: "assistant", text: method === "confirm" ? (params.accept ? "Sent to Sam." : "OK, I won't.") : "Searching the web." }));
                messages = copy;
                reply.thread = { id: "t1" };
                reply.messages = [];
            }
            Qt.callLater(function () { cb(reply); });
        }
    }

    TestCase {
        name: "Assistant"
        when: windowShown

        property var overlay: null
        property var ql: null

        function initTestCase() {
            overlay = findChild(shell, "assistantOverlay");
            ql = findChild(shell, "quickLaunch");
            verify(overlay && ql);
            overlay.source = fake;
        }

        function init() {
            shell.unlock();
            shell.closeAssistant();
            if (shell.launcherOpen)
                ql.launcherToggled();
            fake.enabled = true;
            fake.calls = [];
            fake.messages = [];
            tryCompare(overlay, "visible", false, 2000);
            tryVerify(function () { return ql.visible && ql.opacity === 1; }, 3000);
        }

        function launcherButton() {
            return ql.mapToItem(shell, ql.slotCentre(ql.pinned.length), Theme.quickLaunchIconY + ql.iconSize / 2);
        }
        function hold(p) {
            mousePress(shell, p.x, p.y);
            wait(Theme.iconMenuHoldInterval + 150);
            mouseRelease(shell, p.x, p.y);
        }
        function openByHold() {
            hold(launcherButton());
            tryCompare(overlay, "open", true, 2000);
            tryCompare(overlay, "opacity", 1, 2000);
        }
        function type(text) {
            var input = findChild(overlay, "assistantInput");
            input.forceActiveFocus();
            input.text = text;
            input.accepted();
        }
        function bubbles() {
            var list = findChild(overlay, "assistantMessages");
            var out = [];
            for (var i = 0; i < list.contentItem.children.length; ++i) {
                var d = list.contentItem.children[i];
                if (d.modelData !== undefined && d.visible)
                    out.push(d.modelData.text);
            }
            return out;
        }

        function test_holdOpensTheAssistantAndATapTheLauncher() {
            var p = launcherButton();
            mouseClick(shell, p.x, p.y);
            tryCompare(shell, "launcherOpen", true, 2000);
            compare(overlay.open, false);
            mouseClick(shell, p.x, p.y);
            tryCompare(shell, "launcherOpen", false, 2000);

            openByHold();
            compare(shell.launcherOpen, false);
            compare(shell.assistantOpen, true);
            verify(fake.calls.indexOf("getSettings") >= 0);
            verify(fake.calls.indexOf("thread") >= 0);
            // A hold over the launcher opens it too, over the launcher.
            shell.closeAssistant();
            ql.launcherToggled();
            tryCompare(shell, "launcherOpen", true, 2000);
            hold(launcherButton());
            tryCompare(overlay, "open", true, 2000);
        }

        function test_backEscapeAndATapOutsideCloseIt() {
            openByHold();
            shell.gestureBack();
            tryCompare(overlay, "open", false, 2000);
            openByHold();
            // Above the conversation: outside it.
            mouseClick(shell, shell.width / 2, Theme.statusBarHeight + 60);
            tryCompare(overlay, "open", false, 2000);
            openByHold();
            keyClick(Qt.Key_Escape);
            tryCompare(overlay, "open", false, 2000);
        }

        function test_askShowsTheThreadWithItsAnswers() {
            openByHold();
            // Voice first where there is a microphone: a tap on the field
            // brings the keyboard (with none, the field has it at once).
            var input = findChild(overlay, "assistantInput");
            if (!input.activeFocus)
                mouseClick(input, input.width / 2, input.height / 2);
            tryVerify(function () { return input.activeFocus; }, 2000);
            tryCompare(shell, "keyboardOpen", true, 2000);
            type("turn on the flashlight");
            tryVerify(function () { return bubbles().indexOf("The flashlight is on.") >= 0; }, 2000);
            compare(bubbles().indexOf("turn on the flashlight") >= 0, true);
            verify(fake.calls.indexOf("ask turn on the flashlight") >= 0);
        }

        // With a microphone (as on a Mac, or --microphone-file here) it opens
        // voice first: no keyboard until the field is tapped.
        function test_voiceFirstWithAMicrophone() {
            shell.dictationInputFiles = ["/nonexistent/quiet.wav"];
            try {
                verify(shell.dictation !== null);
                openByHold();
                var mic = findChild(overlay, "assistantMic");
                verify(mic.visible);
                wait(300);
                compare(shell.keyboardOpen, false);
                var input = findChild(overlay, "assistantInput");
                mouseClick(input, input.width / 2, input.height / 2);
                tryCompare(shell, "keyboardOpen", true, 2000);
            } finally {
                shell.dictationInputFiles = [];
            }
        }

        function test_readBackWaitsForSend() {
            openByHold();
            type("text sam hi");
            var yes = null;
            tryVerify(function () { yes = findChild(overlay, "assistantConfirmYes"); return yes && yes.visible; }, 2000);
            compare(yes.caption, "Send");
            mouseClick(yes, yes.width / 2, yes.height / 2);
            tryVerify(function () { return bubbles().indexOf("Sent to Sam.") >= 0; }, 2000);
            verify(fake.calls.indexOf("confirm true") >= 0);
            // Answered: no more buttons.
            tryVerify(function () { var y = findChild(overlay, "assistantConfirmYes"); return !y || !y.visible; }, 2000);
        }

        function test_choicesAreButtons() {
            openByHold();
            type("who wrote the odyssey");
            var web = null;
            tryVerify(function () { web = findChild(overlay, "assistantChoice-web"); return web && web.visible; }, 2000);
            mouseClick(web, web.width / 2, web.height / 2);
            tryVerify(function () { return fake.calls.indexOf("choose web") >= 0; }, 2000);
            // The browser comes up: the view gets out of its way.
            tryCompare(overlay, "open", false, 2000);
        }

        function test_offDoesNothing() {
            fake.enabled = false;
            hold(launcherButton());
            wait(300);
            compare(overlay.open, false);
            compare(shell.launcherOpen, false);
        }

        function test_notOverTheLockScreen() {
            shell.lock();
            shell.openAssistant(false);
            wait(100);
            compare(overlay.open, false);
            shell.unlock();
            openByHold();
            shell.lock();
            tryCompare(overlay, "open", false, 2000);
        }
    }
}
