// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's view (AssistantOverlay.qml, M6 F3): holding the
// launcher button in the quick launch bar opens it while a tap still opens
// the launcher; Back, Escape and a tap outside close it; typed requests go
// to org.webosphoenix.assistant and the thread comes back with its answers,
// choices ("Search the web") and read-backs (Send / Cancel); with the
// assistant off a hold does nothing. Each opening is a new conversation
// (made by its first request, none for an opening without one); the app
// button opens the Assistant app on it. It grows out of the held button,
// messages slide in, dots bounce while it thinks. The bird plays the
// storyboard: asleep as it opens, hello, then listening, thinking, working
// and done, speaking, asking, confused and oops as the conversation goes;
// asleep again as it closes. The service is a stand-in here (its own tests
// are in apps/assistant/service).

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
            calls.push(method + (params.text ? " " + params.text : params.choice ? " " + params.choice : params.accept !== undefined ? " " + params.accept
                                 : params.mode ? " " + params.mode + " " + params.messageId : ""));
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
                else if (/^break/.test(params.text))
                    added.push(msg({ role: "assistant", text: "That didn't work: no torch.", command: "flashlight", status: "failed" }));
                else if (/^hello/.test(params.text))
                    added.push(msg({ role: "assistant", text: "Hello!" }));
                else if (/^add a meeting/.test(params.text))
                    added.push(msg({ role: "assistant", text: "Added \u201cMeeting with Sam\u201d to your calendar, tomorrow at 3:00 PM.", via: "commands",
                                     command: "event", status: "done", choices: [{ id: "open", label: "Open Calendar" }] }));
                else if (/odyssey/.test(params.text))
                    added.push(msg({ role: "assistant", text: "I can't do that on the phone.",
                                     choices: [{ id: "web", label: "Search the web" }, { id: "connect", label: "Connect model" }] }));
                else if (/dentist/.test(params.text))
                    added.push(msg({ role: "assistant", text: "I can't do that on the phone. Did you mean \u201cadd a meeting with Sam tomorrow at 3\u201d?",
                                     choices: [{ id: "web", label: "Search the web" }, { id: "connect", label: "Connect model" }],
                                     data: { suggest: ["add a meeting with Sam tomorrow at 3"] } }));
                else
                    added.push(msg({ role: "assistant", text: "The flashlight is on.", via: "commands", command: "flashlight", status: "done" }));
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
    // The bird's poses as they come (a beat lasts under a second, which
    // polling may miss on a slow machine), its highest hop and its beak's
    // narrowest opening.
    QtObject {
        id: birdSeen
        property var poses: []
        property real maxLift: 0
        property real minFlap: 1
        property real shutAt: 0
        function reset() { poses = []; maxLift = 0; minFlap = 1; shutAt = 0; }
        function had(list) {
            // list in this order (others between allowed).
            var i = 0;
            for (var k = 0; k < poses.length && i < list.length; ++k)
                if (poses[k] === list[i]) ++i;
            return i === list.length;
        }
    }
    Connections {
        target: root.overlay
        function onBirdPoseChanged() { birdSeen.poses = birdSeen.poses.concat([root.overlay.birdPose]); }
        // When the panel ended up shut.
        function onShownChanged() { if (root.overlay.shown === 0) birdSeen.shutAt = Date.now(); }
    }
    Connections {
        target: root.overlay ? findBird() : null
        function onLiftChanged() { birdSeen.maxLift = Math.max(birdSeen.maxLift, target.lift); }
        function onFlapChanged() { birdSeen.minFlap = Math.min(birdSeen.minFlap, target.flap); }
    }
    function findBird() {
        for (var stack = [root.overlay]; stack.length; ) {
            var it = stack.pop();
            if (it.objectName === "assistantBird") return it;
            for (var i = 0; i < it.children.length; ++i) stack.push(it.children[i]);
        }
        return null;
    }
    // Stands in for the shell's speech.
    QtObject { id: fakeSpeech; property bool speaking: false }
    // Stands in for the dictation, with a loudness.
    QtObject {
        id: fakeDictation
        property bool listening: false
        property bool busy: false
        property real loudness: 0
        property string owner: ""
        property string prompt: ""
        property bool autoStop: false
        signal stateChanged()
        signal transcribed(string text, string error)
        function start() { listening = true; stateChanged(); }
        function stop() { listening = false; busy = true; stateChanged(); }
        function cancel() { listening = false; busy = false; stateChanged(); }
    }
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
            overlay.speech = fakeSpeech;
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
            fakeSpeech.speaking = false;
            appSpy.clear();
            tryCompare(overlay, "visible", false, 2000);
            tryVerify(function () { return ql.visible && ql.opacity === 1; }, 3000);
        }

        function launcherButton() {
            return ql.mapToItem(shell, ql.slotCentre(ql.pinned.length), Theme.quickLaunchIconY + ql.iconSize / 2);
        }
        // A press held until `held` says the hold took: waited for as it
        // happens, since a slow machine runs the hold's timer late (a fixed
        // wait may release first, and the press counts as a tap).
        function hold(p, held) {
            mousePress(shell, p.x, p.y);
            tryVerify(held, 5000, "the hold taken");
            mouseRelease(shell, p.x, p.y);
        }
        function opened() { return overlay.open; }
        function openByHold() {
            // The dock back in place (it slides away under the keyboard and
            // back as the keyboard goes), so the hold lands on the button.
            tryVerify(function () { return !shell.keyboardOpen && ql.visible && ql.opacity === 1 && ql.shownProgress === 1; }, 3000, "the dock in place");
            hold(launcherButton(), opened);
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
            hold(launcherButton(), opened);
        }

        function test_backEscapeAndATapOutsideCloseIt() {
            openByHold();
            shell.gestureBack();
            tryCompare(overlay, "open", false, 2000);
            openByHold();
            // Under the bird, above the conversation: outside it.
            var bird = findChild(overlay, "assistantBird");
            var under = bird.mapToItem(shell, bird.width / 2, bird.height + 20);
            mouseClick(shell, under.x, under.y);
            tryCompare(overlay, "open", false, 2000);
            // Beside the panel, at the bird's height: outside it too (the
            // bird takes only taps on itself).
            openByHold();
            var beside = bird.mapToItem(shell, 0, bird.height / 2);
            mouseClick(shell, Theme.px(4), beside.y);
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

        // "Connect model" asks which kind in a sheet over the panel (Escape
        // and Back let the sheet go, not the view); the kind chosen goes to
        // the service with the message, which opens Settings: the view
        // gets out of its way.
        function test_connectModelAsksWhichKind() {
            openByHold();
            type("who wrote the odyssey");
            var row = arrived("I can't do that on the phone.");
            var connect = findChild(row, "assistantChoice-connect");
            verify(connect && connect.visible);
            compare(connect.caption, "Connect model");
            var sheet = findChild(overlay, "assistantConnect");
            verify(!sheet.visible);
            mouseClick(connect, connect.width / 2, connect.height / 2);
            tryVerify(function () { return sheet.visible; }, 2000);
            compare(fake.calls.filter(function (c) { return /^choose|^connect/.test(c); }).length, 0, "nothing asked of the service yet");
            keyClick(Qt.Key_Escape);
            tryVerify(function () { return !sheet.visible; }, 2000);
            compare(overlay.open, true);
            mouseClick(connect, connect.width / 2, connect.height / 2);
            tryVerify(function () { return sheet.visible; }, 2000);
            shell.gestureBack();
            tryVerify(function () { return !sheet.visible; }, 2000);
            compare(overlay.open, true);
            mouseClick(connect, connect.width / 2, connect.height / 2);
            tryVerify(function () { return sheet.visible; }, 2000);
            for (var k = 0; k < 3; ++k)
                verify(findChild(sheet, "assistantConnect-" + ["local", "cloud", "both"][k]).visible);
            var cloud = findChild(sheet, "assistantConnect-cloud");
            mouseClick(cloud, cloud.width / 2, cloud.height / 2);
            tryVerify(function () { return fake.calls.indexOf("connect cloud " + row.modelData.id) >= 0; }, 2000, fake.calls.join(", "));
            tryCompare(overlay, "open", false, 2000);
        }

        // Empty, it shows things to ask, a few at a time, a different few
        // after a while; a tap puts one in the field. So do the requests an
        // answer suggests.
        function test_examplesAndSuggestionsGoToTheField() {
            openByHold();
            var hint = findChild(overlay, "assistantHint");
            verify(hint.visible);
            var first = findChild(hint, "assistantExample-0");
            verify(first && first.visible && first.text !== "");
            verify(findChild(hint, "assistantExample-1").visible);
            var before = overlay.examplesNow().join("|");
            tryVerify(function () { return overlay.examplesNow().join("|") !== before; }, 9000, "a different few");
            first = findChild(hint, "assistantExample-0");
            tryVerify(function () { return first.opacity === 1 && hint.fade === 1; }, 2000);
            var words = first.text;
            mouseClick(first, first.width / 2, first.height / 2);
            var input = findChild(overlay, "assistantInput");
            compare(input.text, words);
            verify(input.activeFocus);
            compare(fake.asks.length, 0, "not asked: the words to change or send");
            type("I have a dentist thing");
            var row = arrived("I can't do that on the phone. Did you mean \u201cadd a meeting with Sam tomorrow at 3\u201d?");
            verify(!hint.visible);
            var s = findChild(row, "assistantSuggest-0");
            verify(s && s.visible);
            mouseClick(s, s.width / 2, s.height / 2);
            compare(input.text, "add a meeting with Sam tomorrow at 3");
        }

        // A command done that offers its app ("Open Calendar"): the bird
        // cheers (no shrug), and the button opens the app, the view out of
        // its way.
        function test_doneOffersItsApp() {
            openByHold();
            birdSeen.reset();
            type("add a meeting with Sam tomorrow at 3");
            var row = arrived("Added \u201cMeeting with Sam\u201d to your calendar, tomorrow at 3:00 PM.");
            poseIs("idle");
            verify(birdSeen.had(["done"]) && birdSeen.poses.indexOf("confused") < 0, "a cheer, no shrug: " + birdSeen.poses);
            var open = findChild(row, "assistantChoice-open");
            verify(open && open.visible);
            mouseClick(open, open.width / 2, open.height / 2);
            tryVerify(function () { return fake.calls.indexOf("choose open") >= 0; }, 2000);
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
            birdSeen.reset();
            var t0 = Date.now();
            keyClick(Qt.Key_Escape);
            compare(overlay.open, false);
            tryCompare(overlay, "visible", false, 3000);
            compare(overlay.shown, 0);
            // It took its time closing (when it shut, recorded as it came: an
            // animation never ends before its duration, however a slow
            // machine draws it in between).
            verify(birdSeen.shutAt - t0 >= Theme.launcherDuration - 20, "closing: " + (birdSeen.shutAt - t0) + " ms");
        }

        // ---- The bird ----------------------------------------------------------------
        function bird() { return findChild(overlay, "assistantBird"); }
        // The bird holds a pose once it has reached it.
        function poseIs(pose, msg) {
            tryVerify(function () { return overlay.birdPose === pose && bird().pose === pose && bird().atRest(); }, 4000, msg || pose);
        }

        // Opening: it enters as the panel grows (born of embers, it drops
        // in and lands, docs/ASSISTANT-CHARACTER.md), waves, then idles.
        function test_birdWakesAsItOpens() {
            var p = launcherButton();
            tryVerify(function () { return !shell.keyboardOpen && ql.visible && ql.opacity === 1 && ql.shownProgress === 1; }, 3000);
            // Asleep (gone) before it opens.
            compare(overlay.birdPose, "asleep");
            birdSeen.reset();
            var entered = [];
            var c = function (name) { entered.push(name); };
            bird().moveEnded.connect(c);
            try {
                hold(p, opened);
                compare(bird().move, "enter");
                tryVerify(function () { return entered.indexOf("enter") >= 0 && overlay._wake === ""; }, 8000, "entered, waved");
            } finally {
                bird().moveEnded.disconnect(c);
            }
            poseIs("idle");
            verify(bird().movesAtRest());
            verify(birdSeen.had(["hello", "idle"]), "hello, then idle: " + birdSeen.poses);
            // At the top in the middle of the panel, 72 to 104 px, over the
            // conversation, which runs on up behind it and, scrolled back
            // to its start, comes clear below it.
            var panel = findChild(overlay, "assistantPanel");
            verify(!overlay.birdBeside);
            verify(bird().width >= Theme.px(72) && bird().width <= Theme.px(104));
            var messages = findChild(overlay, "assistantMessages");
            verify(messages.y < bird().y + bird().height, "the conversation reaches up behind the bird");
            verify(bird().z > messages.z);
            compare(messages.topMargin, bird().height);
            fuzzyCompare(bird().x + bird().width / 2, panel.width / 2, 1);
            // A tap on it waves, and does not close the view.
            birdSeen.reset();
            mouseClick(bird(), bird().width / 2, bird().height / 2);
            verify(overlay.open);
            poseIs("idle");
            verify(birdSeen.had(["hello", "idle"]), "a wave: " + birdSeen.poses);
            // Closing: it leaves (bursting into embers), back into the button.
            keyClick(Qt.Key_Escape);
            compare(overlay.birdPose, "asleep");
            compare(bird().move, "leave");
            verify(bird().gone);
            tryCompare(overlay, "visible", false, 3000);
        }

        // Waiting: thinking; a command that ran: working, then done (the
        // hop), then speaking while the answer is spoken, then idle.
        function test_birdThinksWorksCheersAndSpeaks() {
            openByHold();
            poseIs("idle");
            fake.hold = true;
            type("turn on the flashlight");
            poseIs("thinking");
            birdSeen.reset();
            fakeSpeech.speaking = true;
            fake.release();
            poseIs("speaking");
            verify(birdSeen.had(["working", "done", "speaking"]), "working, done, speaking: " + birdSeen.poses);
            verify(birdSeen.maxLift > 40, "the hop: " + birdSeen.maxLift);
            tryVerify(function () { return birdSeen.minFlap < 0.5; }, 3000, "the beak moving");
            fakeSpeech.speaking = false;
            poseIs("idle");
            compare(bird().lift, 0);
        }

        // A read-back: asking until it is answered; "I can't do that" with
        // its choices: a shrug, then idle; a failure: oops.
        function test_birdAsksShrugsAndSaysOops() {
            openByHold();
            type("text sam hi");
            poseIs("asking");
            var yes = findChild(arrived("Send \"hi\" to Sam?"), "assistantConfirmYes");
            mouseClick(yes, yes.width / 2, yes.height / 2);
            tryVerify(function () { return bubbles().indexOf("Sent to Sam.") >= 0; }, 2000);
            poseIs("idle");

            birdSeen.reset();
            type("who wrote the odyssey");
            arrived("I can't do that on the phone.");
            poseIs("idle");
            verify(birdSeen.had(["thinking", "confused", "idle"]), "a shrug: " + birdSeen.poses);

            birdSeen.reset();
            type("break the flashlight");
            arrived("That didn't work: no torch.");
            poseIs("idle");
            verify(birdSeen.had(["thinking", "shy", "idle"]), "oops: " + birdSeen.poses);
            compare(overlay.outcomeOf([{ role: "assistant", status: "failed" }]), "failed");
            compare(overlay.outcomeOf([{ role: "assistant", status: "done", command: "event", choices: [{ id: "open", label: "Open Calendar" }] }]), "done");
            compare(overlay.outcomeOf([{ role: "assistant", text: "Hello!" }]), "answer");
            compare(overlay.outcomeOf([]), "answer");
        }

        // Listening: the bird listens and follows the microphone's loudness;
        // transcribing, it thinks.
        function test_birdListensToTheMicrophone() {
            var real = overlay.dictation;
            overlay.dictation = fakeDictation;
            try {
                openByHold();
                poseIs("idle");
                overlay.listen();
                poseIs("listening");
                fakeDictation.loudness = 0.7;
                compare(bird().level, 0.7);
                tryCompare(bird(), "voice", 0.7, 2000);
                fakeDictation.stop();
                tryCompare(overlay, "birdPose", "thinking", 2000);
                fakeDictation.busy = false;
                fakeDictation.transcribed("hello there", "");
                tryVerify(function () { return bubbles().indexOf("Hello!") >= 0; }, 2000);
                poseIs("idle");
                compare(bird().level, -1);
            } finally {
                overlay.stopListening(true);
                overlay.dictation = real;
            }
        }

        // The bird reacts to the user (docs/ASSISTANT-CHARACTER.md,
        // Reactions): it watches the words typed and pecks as they come,
        // winces at a deletion, ponders a pause, cheers a request sent;
        // a tap waves, then giggles or spins; it glances along a scroll.
        // Each recorded as it starts.
        function test_birdReactsToTheUser() {
            openByHold();
            var b = bird();
            tryVerify(function () { return overlay._wake === "" && b.move === ""; }, 8000, "entered");
            var started = [];
            // (The keyboard coming up for the field scoots it, whenever it comes: that is
            // test_birdBesideTheFieldWhenShort's.)
            var c = function (name) { if (name !== "scoot") started.push(name); };
            b.moveStarted.connect(c);
            try {
                var input = findChild(overlay, "assistantInput");
                input.forceActiveFocus();
                tryVerify(function () { return b.move === ""; }, 3000, "settled (the keyboard may move it)");
                started = [];
                input.insert(input.cursorPosition, "h");
                compare(started.join(" "), "peck");
                // Watching the words: its eyes on the caret, no idles meanwhile.
                verify(!b.fidgety);
                tryVerify(function () { return Math.abs(b._gx) + Math.abs(b._gy) > 0.3; }, 2000, "looking at the caret: " + b._gx + " " + b._gy);
                tryVerify(function () { return b.move === ""; }, 3000);
                input.insert(input.cursorPosition, "e");
                compare(started.join(" "), "peck peck");
                tryVerify(function () { return b.move === ""; }, 3000);
                input.remove(input.text.length - 1, input.text.length);
                compare(started.join(" "), "peck peck wince");
                // A pause after typing: ponder.
                tryVerify(function () { return started.indexOf("ponder") >= 0; }, overlay._reactions.pauseAfter + 4000, "a curious tilt: " + started);
                tryVerify(function () { return b.move === ""; }, 4000);
                // Sent: a cheer as it starts thinking.
                fake.hold = true;
                input.text = "hello there";
                started = [];
                input.accepted();
                compare(overlay.birdPose, "thinking");
                compare(started.join(" "), "cheer", "no wince as the field is cleared");
                fake.release();
                tryVerify(function () { return bubbles().indexOf("Hello!") >= 0; }, 2000);
                poseIs("idle");
                tryVerify(function () { return b.move === ""; }, 4000);
                // A tap: the wave first, then a giggle or a spin.
                input.focus = false;
                birdSeen.reset();
                mouseClick(b, b.width / 2, b.height / 2);
                tryCompare(overlay, "birdPose", "hello", 1000);
                poseIs("idle");
                started = [];
                mouseClick(b, b.width / 2, b.height / 2);
                verify(started.length === 1 && overlay._reactions.tap.indexOf(started[0]) >= 0, "a reaction: " + started);
                tryVerify(function () { return b.move === ""; }, 4000);
                // A scroll: a glance along it, then ahead again.
                var list = findChild(overlay, "assistantMessages");
                list.movementStarted();
                list.contentY = list.contentY - Theme.px(20);
                tryVerify(function () { return b.gazeY !== 0; }, 2000, "a glance");
                list.movementEnded();
                compare(b.gazeY, 0);
            } finally {
                fake.hold = false;
                b.moveStarted.disconnect(c);
            }
        }

        // A short panel (the phone's keyboard up): the bird sits small
        // beside the field, scooting there.
        function test_birdBesideTheFieldWhenShort() {
            openByHold();
            tryVerify(function () { return overlay._wake === "" && bird().move === ""; }, 8000, "entered");
            var started = [];
            var c = function (name) { started.push(name); };
            bird().moveStarted.connect(c);
            var input = findChild(overlay, "assistantInput");
            mouseClick(input, input.width / 2, input.height / 2);
            tryCompare(shell, "keyboardOpen", true, 2000);
            tryVerify(function () { return overlay.birdBeside; }, 2000);
            bird().moveStarted.disconnect(c);
            verify(started.indexOf("scoot") >= 0, "a scoot: " + started);
            var field = findChild(overlay, "assistantField");
            tryVerify(function () { return bird().width === overlay.birdSize && bird().x === 0 && field.x >= bird().width; }, 2000, "beside the field");
            verify(bird().width < Theme.px(72));
            // Its feet on the field's bottom line, its body beside it.
            tryVerify(function () {
                var b = bird().mapToItem(field, bird().width / 2, bird().height * 412 / 440);
                return Math.abs(b.y - field.height) <= 2;
            }, 2000, "its feet on the field's bottom line");
        }

        SignalSpy { id: dockHeld; signalName: "pressAndHold" }
        function test_offDoesNothing() {
            fake.enabled = false;
            dockHeld.target = findChild(ql, "quickLaunchMouse");
            dockHeld.clear();
            // Held until the dock takes it as a hold (not a tap, which opens the launcher).
            hold(launcherButton(), function () { return dockHeld.count > 0; });
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
