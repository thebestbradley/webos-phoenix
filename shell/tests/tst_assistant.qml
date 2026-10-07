// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix Assistant's view (AssistantOverlay.qml, M6 F3): holding the
// launcher button in the quick launch bar opens it while a tap still opens
// the launcher; Back, Escape and a tap outside close it; typed requests go
// to org.webosphoenix.assistant and the thread comes back with its answers,
// choices ("Search the web") and read-backs (Send / Cancel); with the
// assistant off a hold does nothing. Each opening is a new conversation
// (made by its first request, none for an opening without one); the app
// button opens the Assistant app on it. It grows out of the held button,
// messages slide in, dots bounce while it thinks. The service is a
// stand-in here (its own tests are in apps/assistant/service).

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
        property var asks: []           // ask's params
        property var messages: []       // the current thread's
        property string tid: ""
        property int threads: 0
        property int n: 0
        // true: replies to ask wait in held until release().
        property bool hold: false
        property var held: []
        function release() { var h = held; held = []; for (var i = 0; i < h.length; ++i) h[i](); }
        function msg(o) { n++; o.id = "m" + n; o.threadId = tid; o.time = n; return o; }
        function lunaCall(uri, params, cb) {
            var method = uri.replace(/^.*\//, "");
            calls.push(method + (params.text ? " " + params.text : params.choice ? " " + params.choice : params.accept !== undefined ? " " + params.accept : ""));
            var reply = { returnValue: true };
            if (method === "getSettings") {
                reply.settings = { enabled: enabled };
            } else if (method === "thread") {
                var t = params.id || tid;
                reply.thread = t === tid && tid !== "" ? { id: tid } : null;
                reply.messages = t === tid ? messages.slice() : [];
            } else if (method === "newThread") {
                messages = [];
                tid = "t" + (++threads);
                reply.thread = { id: tid };
            } else if (method === "ask") {
                asks.push(params);
                if (params.newThread || tid === "") {
                    tid = "t" + (++threads);
                    messages = [];
                }
                var added = [msg({ role: "user", text: params.text })];
                if (/^text/.test(params.text))
                    added.push(msg({ role: "assistant", text: "Send \"hi\" to Sam?", command: "text", status: "pending", confirm: { command: "text", args: {} } }));
                else if (/odyssey/.test(params.text))
                    added.push(msg({ role: "assistant", text: "I can't do that on the phone.", choices: [{ id: "web", label: "Search the web" }] }));
                else
                    added.push(msg({ role: "assistant", text: "The flashlight is on.", via: "commands", status: "done" }));
                messages = messages.concat(added);
                reply.thread = { id: tid };
                reply.messages = added;
                if (hold) {
                    held.push(function () { cb(reply); });
                    return;
                }
            } else if (method === "confirm" || method === "choose") {
                var copy = messages.slice();
                for (var i = 0; i < copy.length; ++i)
                    if (copy[i].id === params.messageId) {
                        if (method === "confirm") copy[i].status = params.accept ? "done" : "cancelled";
                        else copy[i].chosen = params.choice;
                    }
                copy.push(msg({ role: "assistant", text: method === "confirm" ? (params.accept ? "Sent to Sam." : "OK, I won't.") : "Searching the web." }));
                messages = copy;
                reply.thread = { id: tid };
                reply.messages = [];
            }
            Qt.callLater(function () { cb(reply); });
        }
    }

    SignalSpy { id: appSpy; target: overlay; signalName: "appRequested" }
    property var overlay: null

    TestCase {
        name: "Assistant"
        when: windowShown

        property var ql: null

        function initTestCase() {
            root.overlay = findChild(shell, "assistantOverlay");
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
            fake.asks = [];
            fake.messages = [];
            fake.tid = "";
            fake.threads = 0;
            fake.hold = false;
            fake.held = [];
            appSpy.clear();
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
            // Grown out of the button, the backdrop faded in.
            tryCompare(overlay, "shown", 1, 3000);
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
                if (d.modelData !== undefined && d.visible && !d.modelData.thinking)
                    out.push(d.modelData.text);
            }
            return out;
        }
        // A message's row once it has slid all the way in (and its buttons
        // have appeared).
        function arrived(text) {
            var list = findChild(overlay, "assistantMessages");
            var row = null;
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
            // A new conversation, empty: nothing asked of the service yet.
            compare(overlay.threadId, "");
            compare(overlay.messages.length, 0);
            verify(findChild(overlay, "assistantHint").visible);
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
            var yes = findChild(arrived("Send \"hi\" to Sam?"), "assistantConfirmYes");
            verify(yes && yes.visible);
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
            var row = arrived("I can't do that on the phone.");
            var web = findChild(row, "assistantChoice-web");
            verify(web && web.visible);
            mouseClick(web, web.width / 2, web.height / 2);
            tryVerify(function () { return fake.calls.indexOf("choose web") >= 0; }, 2000);
            // The browser comes up: the view gets out of its way.
            tryCompare(overlay, "open", false, 2000);
        }

        // Each opening is a conversation of its own: the first request makes
        // its thread, the next ones go on in it; one opened and closed
        // without a word leaves no thread behind.
        function test_eachOpeningIsANewConversation() {
            openByHold();
            type("turn on the flashlight");
            arrived("The flashlight is on.");
            compare(fake.asks[0].newThread, true);
            compare(overlay.threadId, "t1");
            type("turn on the flashlight");
            tryCompare(fake.asks, "length", 2, 2000);
            compare(fake.asks[1].threadId, "t1");
            verify(!fake.asks[1].newThread);
            tryCompare(overlay, "busy", false, 2000);
            keyClick(Qt.Key_Escape);
            tryCompare(overlay, "visible", false, 3000);

            openByHold();
            compare(overlay.threadId, "");
            compare(overlay.messages.length, 0);
            compare(bubbles().length, 0);
            keyClick(Qt.Key_Escape);
            tryCompare(overlay, "visible", false, 3000);
            // Nothing asked of the service for the empty one.
            compare(fake.calls.indexOf("newThread"), -1);
            compare(fake.asks.length, 2);

            openByHold();
            type("who wrote the odyssey");
            arrived("I can't do that on the phone.");
            compare(fake.asks[2].newThread, true);
            compare(overlay.threadId, "t2");
            // New: another fresh one, made by its first request too.
            mouseClick(findChild(overlay, "assistantNew"));
            compare(overlay.threadId, "");
            compare(bubbles().length, 0);
            compare(fake.calls.indexOf("newThread"), -1);
        }

        // The app button: the view closes, the Assistant app comes up on
        // this conversation.
        function test_appButtonOpensTheAppOnTheConversation() {
            openByHold();
            type("turn on the flashlight");
            arrived("The flashlight is on.");
            var app = findChild(overlay, "assistantApp");
            verify(app.visible);
            mouseClick(app);
            compare(appSpy.count, 1);
            compare(appSpy.signalArguments[0][0], overlay.threadId);
            verify(appSpy.signalArguments[0][0] !== "");
            tryCompare(overlay, "open", false, 2000);
            tryCompare(overlay, "visible", false, 3000);
        }

        // While it waits for an answer, a bubble of dots; the answer slides
        // in in its place.
        function test_thinkingThenTheAnswerSlidesIn() {
            openByHold();
            fake.hold = true;
            type("turn on the flashlight");
            tryVerify(function () { var t = findChild(overlay, "assistantThinking"); return t && t.visible; }, 2000);
            verify(overlay.busy);
            fake.release();
            var row = arrived("The flashlight is on.");
            tryVerify(function () { var t = findChild(overlay, "assistantThinking"); return !t || !t.visible; }, 2000);
            // At rest: where it belongs, fully drawn.
            var bubble = findChild(row, "assistantBubble");
            compare(bubble.opacity, 1);
            // The user's words, shown at once, did not come in again.
            compare(bubbles().filter(function (t) { return t === "turn on the flashlight"; }).length, 1);
        }

        // Closing goes back into the button: the view stays drawn until
        // the end of it.
        function test_openAndCloseAnimate() {
            openByHold();
            var panel = findChild(overlay, "assistantPanel");
            compare(panel.opacity, 1);
            compare(findChild(overlay, "assistantBackdrop").opacity, 1);
            keyClick(Qt.Key_Escape);
            compare(overlay.open, false);
            verify(overlay.visible);
            tryVerify(function () { return overlay.shown > 0 && overlay.shown < 1; }, 2000, "closing");
            tryCompare(overlay, "visible", false, 3000);
            compare(overlay.shown, 0);
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
