// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's system view (docs/M6-PLAN.md F3): the
// conversation in use floats over whatever is on screen, on a translucent,
// blurred backdrop (BackdropBlur over Shell.backdrop), like the recent Siri.
// A Phoenix addition: webOS had no assistant. Opened by holding the
// launcher button in the quick launch bar (QuickLaunch.assistantRequested).
//
// Each opening starts a new, empty conversation: its first request makes
// the thread (ask {newThread}), so one opened and closed without a word
// leaves nothing behind, and the ones before stay in the Assistant app's
// Conversations. The app's icon in the corner closes the view and opens
// the app on the conversation, to go on there. A text field (the keyboard
// comes up for it as for any shell field) and a microphone (the shell's
// dictation, whisper.cpp, ending by itself when the speaker stops). The
// answers' choices ("Ask <cloud model>", "Search the web", "Connect
// model") and read-backs ("Send ... to Sam?") are buttons. Connect model
// asks which kind (on-device, cloud or both) in a small sheet, then the
// service opens Settings > Assistant for it and the question waits there
// (connect; the Assistant app asks it again once the model is in). Empty,
// it shows a few things to ask, a different few every few seconds; a tap
// puts one in the field to change or send, as do the requests an answer
// suggests ("Did you mean ...?"). A tap outside the conversation, Back or
// Escape closes it.
//
// Motion (all through Theme.motion, so Settings > Advanced > Animation
// speed and reduced motion apply): the blur and the dim fade in while the
// panel grows out of the launcher button that was held (origin), and go
// back into it as it closes, over the launcher's own time
// (Theme.launcherDuration, lunaAnimations.conf:83-84); a message slides in
// from its side as an app's scene is pushed (cardTransitionDuration, curve
// 20 OutQuad); its choices follow one after another; rings spread from the
// microphone while it listens; three dots bounce in a bubble while the
// assistant thinks.
//
// The assistant's bird (AssistantBird, docs/ASSISTANT-CHARACTER.md) sits at
// the top of the panel and plays the storyboard: it rises with the panel
// asleep, wakes and waves (hello), listens while the microphone is on,
// thinks while a request waits, works then cheers (done) when a command
// ran, speaks while the answer is spoken, asks while a read-back waits,
// shrugs (confused) at "I can't do that" with its choices, says oops (shy)
// when something failed, and idles otherwise; it falls asleep again as the
// panel goes back into the button. Where the panel is short (a phone's
// keyboard up, landscape) it sits small beside the field.
//
// Voice (docs/AI-AND-MCP.md, Voice): a request spoken into the microphone
// is answered aloud (the service's Voice replies), and a read-back ("Send
// it?") listens for the answer at once, without the wake word. Opened by
// the wake word ("Hey Phoenix", handsFree), it listens as it opens and
// closes by itself once the conversation is idle. Over the lock screen
// (locked) the service does only what shows nothing private; for the rest
// it says to unlock, and unlockNeeded hands the words to the shell, which
// asks again once the phone is unlocked.
//
// All through the window source's lunaCall (in phoenix-sim the runtime's
// service in the system UI page; on a device the bus).

import QtQuick
import Qt5Compat.GraphicalEffects
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
    // Where it grows from and goes back to: the held launcher button, in
    // this item's coordinates (the shell sets it); else the bottom's middle.
    property point origin: Qt.point(width / 2, height)
    // The Assistant app's icon (its launcher entry's), for the app button.
    property url appIcon: ""
    // The shell's speech (Phoenix.Native Speech), or null: the bird speaks
    // while it does.
    property var speech: null

    // Over the lock screen (opened by the wake word there).
    property bool locked: false
    // The turn in progress was spoken: answered aloud, a read-back listens
    // for its answer.
    property bool voice: false
    // Opened by the wake word: closes by itself after a quiet moment.
    property bool handsFree: false
    // How long a hands-free conversation stays open once it is idle.
    property int idleCloseMs: 4000

    signal closeRequested()
    // Asked over the lock screen for what needs it unlocked: the words, to
    // ask again then.
    signal unlockNeeded(string text)
    // The app button: open the Assistant app on this conversation ("" for
    // none yet).
    signal appRequested(string threadId)

    readonly property string service: "luna://org.webosphoenix.assistant/"
    property string threadId: ""
    property var messages: []
    property bool busy: false
    property bool listening: false
    property string status: ""          // a line under the conversation: "Listening…", an error

    // What to ask, for the empty conversation: one of each kind of command
    // (docs/AI-AND-MCP.md, the commands), shown a few at a time. Each one
    // the grammar takes as it stands (apps/assistant/service/grammar.test.ts
    // reads this list).
    readonly property var examples: [
        qsTr("Add a meeting with Sam tomorrow at 3"), qsTr("What's on my calendar this week?"),
        qsTr("Remind me to call Mom at 6"), qsTr("Set an alarm for 7am weekdays"),
        qsTr("Set a timer for 10 minutes"), qsTr("New note: buy flowers"),
        qsTr("Add milk to my shopping list"), qsTr("Email Priya saying see you soon"),
        qsTr("Play some music by Miles Davis"), qsTr("Turn on the flashlight"),
        qsTr("Convert 10 miles to km"), qsTr("What's the weather tomorrow?"),
        qsTr("Text Sam I'm running late"), qsTr("Set brightness to 50%"),
        qsTr("What time is it in Tokyo?"), qsTr("Navigate to the nearest coffee shop"),
        qsTr("Show my photos from yesterday"), qsTr("What's 15% of 80?")
    ]
    // How many show at once, and the first of them.
    readonly property int examplesShown: Theme.tablet ? 3 : 2
    property int exampleIndex: 0
    function examplesNow() {
        var out = [];
        for (var i = 0; i < examplesShown; ++i)
            out.push(examples[(exampleIndex + i) % examples.length]);
        return out;
    }
    // Put words in the field, to change or send (an example, a suggestion).
    function suggest(text) {
        input.text = text;
        input.forceActiveFocus();
        input.cursorPosition = input.text.length;
    }

    // "Connect model": the message whose choice it was, while the sheet
    // asking which kind shows; then connect takes it to Settings.
    property var connecting: null
    function connectModel(mode) {
        var m = connecting;
        connecting = null;
        if (!m || busy)
            return;
        busy = true;
        _call("connect", { threadId: threadId, messageId: m.id, mode: mode }, function (r) {
            ov.busy = false;
            if (r && r.returnValue !== false)
                ov.closeRequested();
            else
                ov.status = String((r && r.errorText) || qsTr("Something went wrong."));
        });
    }

    // 0 closed, 1 open: the backdrop's fade and the panel's growth.
    property real shown: open ? 1 : 0
    Behavior on shown {
        NumberAnimation {
            duration: Theme.launcherDuration
            easing.type: ov.open ? Easing.OutCubic : Easing.InCubic
        }
    }
    visible: shown > 0
    enabled: open

    // Each opening is a conversation of its own: replies to an earlier
    // one's requests (still on their way as it closed) are dropped.
    property int _session: 0
    // Messages already shown (by id): only new ones slide in.
    property var _seen: ({})
    property int _pending: 0

    onOpenChanged: {
        _beats = [];
        beat = "";
        beatTimer.stop();
        connecting = null;
        if (open) {
            exampleIndex = Math.floor(Math.random() * examples.length);
            // The bird enters as the panel grows (born of a swirl of
            // embers, it drops in and lands), then waves.
            _wake = "enter";
            _taps = 0;
            wakeTimer.interval = Math.max(1, bird.enter(Math.round(Theme.launcherDuration * 0.6)));
            wakeTimer.restart();
            ++_session;
            _fetchVocabulary();
            if (!listening)
                status = "";
            busy = false;
            threadId = "";
            messages = [];
            _seen = {};
            // Voice first where there is a microphone (a tap on the field
            // brings the keyboard); else the keyboard at once.
            if (listenOnOpen && dictation)
                Qt.callLater(listen);
            else if (!dictation)
                Qt.callLater(function () { input.forceActiveFocus(); });
            else
                ov.forceActiveFocus();
        } else {
            // A follow-up question left unanswered waits for later (a
            // notification, lib/followups.js).
            if (threadId !== "")
                _call("followUpLeave", { threadId: threadId });
            _wake = "";
            wakeTimer.stop();
            // It leaves: a leap, and it bursts into embers.
            bird.leave();
            followTimer.stop();
            ++_session;
            busy = false;
            voice = false;
            handsFree = false;
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
        var session = _session;
        source.lunaCall(service + method, params || {}, function (r) {
            if (session !== ov._session)
                return;
            if (done)
                done(r);
        });
    }

    // This conversation's messages, once it has a thread.
    function refresh() {
        if (threadId === "")
            return;
        _call("thread", { id: threadId }, function (r) {
            if (!r || r.returnValue === false)
                return;
            ov.messages = r.messages || [];
        });
    }

    // A delegate asks whether its message is new here (it slides in) and
    // marks it seen. The user's own words were shown at once as they were
    // sent ("pending-user"): the thread's copy of them does not come in again.
    function _arrives(m) {
        if (m && m.thinking)
            return true;
        if (!m || !m.id || _seen[m.id])
            return false;
        _seen[m.id] = true;
        if (m.role === "user" && _seen["text:" + m.text]) {
            delete _seen["text:" + m.text];
            return false;
        }
        return true;
    }

    function _settled(r) {
        busy = false;
        if (!r) {
            status = qsTr("The assistant is not running.");
            _play(beatsFor("failed"));
            return;
        }
        if (r.returnValue === false) {
            status = String(r.errorText || qsTr("Something went wrong."));
            _play(beatsFor("failed"));
            return;
        }
        _play(beatsFor(outcomeOf(r.messages)));
        if (r.thread)
            threadId = r.thread.id;
        refresh();
    }

    // done (optional) hears the reply, after the view has.
    function ask(text, done) {
        text = String(text || "").trim();
        if (!text || busy)
            return;
        busy = true;
        status = "";
        // Shown at once; the thread comes back with the answer.
        _seen["text:" + text] = true;
        messages = messages.concat([{ id: "pending-user-" + (++_pending), role: "user", text: text }]);
        // The first request makes this opening's thread.
        var p = { text: text };
        if (voice)
            p.voice = true;
        if (locked)
            p.locked = true;
        if (threadId !== "")
            p.threadId = threadId;
        else
            p.newThread = true;
        _call("ask", p, function (r) {
            _settled(r);
            ov._afterReply();
            if (done)
                done(r);
        });
    }
    function choose(message, choice) {
        if (busy)
            return;
        // Which kind first, here; then on to Settings.
        if (choice.id === "connect") {
            connecting = message;
            // The keyboard down: the sheet has the panel's height.
            input.focus = false;
            ov.forceActiveFocus();
            return;
        }
        busy = true;
        _call("choose", { threadId: threadId, messageId: message.id, choice: choice.id }, function (r) {
            _settled(r);
            // Settings, the browser or the app offered came up: out of their way.
            if (r && r.returnValue !== false && (choice.id === "settings" || choice.id === "web" || choice.id === "open"))
                ov.closeRequested();
        });
    }
    function confirm(message, accept) {
        if (busy)
            return;
        busy = true;
        var p = { threadId: threadId, messageId: message.id, accept: accept };
        if (voice)
            p.voice = true;
        _call("confirm", p, function (r) {
            _settled(r);
            ov._afterReply();
        });
    }
    // New: a fresh conversation here. The one before is kept (it has
    // words); the new one is made by its first request.
    function newConversation() {
        ++_session;
        busy = false;
        threadId = "";
        messages = [];
        status = "";
        connecting = null;
        input.forceActiveFocus();
    }
    // The app button: on to the Assistant app with this conversation.
    function openApp() {
        appRequested(threadId);
    }

    // ---- The bird ----------------------------------------------------------------------
    // What a request's reply was, from its new messages (the service's
    // message status, apps/assistant/service/assistant.js): "done" (a
    // command ran), "failed", "asking" (a read-back waits), "choices"
    // ("I can't do that" with Ask/Search), "cancelled", or "answer".
    function outcomeOf(list) {
        var last = null;
        // A follow-up question after a command is not the outcome: done
        // plays, then the bird asks.
        for (var i = (list || []).length - 1; i >= 0 && !last; --i)
            if (list[i] && list[i].role === "assistant" && !(list[i].followUp && list[i].status !== "failed"))
                last = list[i];
        if (!last)
            return "answer";
        if (last.status === "failed")
            return "failed";
        if (last.status === "pending" && last.confirm)
            return "asking";
        // (A command done may offer its app, "Open Calendar": still done.)
        if (last.status === "done" && last.command)
            return "done";
        if (last.choices && last.choices.length && !last.chosen)
            return "choices";
        if (last.status === "cancelled")
            return "cancelled";
        return "answer";
    }
    // The poses an outcome plays, each for a time (ms at normal speed),
    // before the bird goes back to what is going on (Story.dc.html: working
    // on it, then done's hop of about 700 ms; a shrug or an oops, then it
    // bounces back).
    function beatsFor(outcome) {
        switch (outcome) {
        case "done": return [{ pose: "working", ms: 450 }, { pose: "done", ms: 700 }];
        case "failed": return [{ pose: "shy", ms: 1500 }];
        case "choices": return [{ pose: "confused", ms: 1500 }];
        default: return [];
        }
    }
    // Beats follow Animation speed, not Reduce motion (they say what
    // happened; the bird holds each still then).
    function _beatMs(ms) { return Math.max(1, Math.round(ms * Theme.animationScale)); }
    property var _beats: []
    property string beat: ""
    function _play(list) {
        _beats = (list || []).slice();
        _nextBeat();
    }
    function _nextBeat() {
        if (_beats.length === 0) {
            beat = "";
            beatTimer.stop();
            // No speech with the answer: a nod as it appears.
            if (!speaking)
                bird.nod();
            return;
        }
        var b = _beats.shift();
        beat = b.pose;
        beatTimer.interval = _beatMs(b.ms);
        beatTimer.restart();
    }
    Timer { id: beatTimer; onTriggered: ov._nextBeat() }
    // Opening: its entrance while the panel grows, then a wave.
    property string _wake: ""
    Timer {
        id: wakeTimer
        onTriggered: {
            // The wave, unless something has gone on meanwhile.
            if (ov._wake === "enter" && ov.messages.length === 0 && !ov.busy && !ov.listening) {
                ov._wake = "hello";
                interval = ov._beatMs(650);
                restart();
            } else {
                ov._wake = "";
            }
        }
    }
    readonly property bool speaking: !!speech && !!speech.speaking
    // A read-back waiting for its answer, or a follow-up question (the
    // service's lib/followups.js: "Where is it?" with its answers): the bird
    // asks, and a spoken turn listens for the answer.
    readonly property bool asking: {
        for (var i = messages.length - 1; i >= 0; --i)
            if (messages[i].role === "assistant")
                return (messages[i].status === "pending" && !!messages[i].confirm) || (!!messages[i].followUp && !messages[i].chosen);
        return false;
    }
    // (What goes on comes before the opening's wave: a request asked
    // while it enters plays over the entrance.)
    readonly property string birdPose: !open ? "asleep"
        : listening ? (dictation && dictation.busy ? "thinking" : "listening")
        : busy ? "thinking"
        : beat !== "" ? beat
        : _wake === "hello" ? "hello"
        : speaking ? "speaking"
        : asking ? "asking"
        : "idle"

    // ---- The bird's reactions (docs/ASSISTANT-CHARACTER.md, Reactions) ----------------
    // While words are typed it watches them (its eyes on the caret) and
    // pecks as each comes; a deletion makes it wince; a pause, ponder; a
    // request sent, cheer; a tap waves (the first) or giggles or spins; the
    // keyboard moving it, a scoot; a scroll, a glance along.
    readonly property var _reactions: bird.art.motion.reactions
    readonly property bool _typing: input.activeFocus && input.text !== ""
    property int _typedLength: 0
    // Clearing the field as a request is sent is no deletion.
    property bool _sending: false
    function _typed() {
        var n = input.text.length, was = _typedLength;
        _typedLength = n;
        if (!open || _sending || !input.activeFocus || birdPose !== "idle" || n === was)
            return;
        bird.react(n > was ? _reactions.type : _reactions.erase);
        pauseTimer.restart();
    }
    // A pause after typing: a curious tilt.
    Timer {
        id: pauseTimer
        interval: ov._reactions.pauseAfter
        onTriggered: if (ov._typing && ov.birdPose === "idle") bird.react(ov._reactions.pause)
    }
    // Its gaze: at the caret while words are typed, along a scroll; else ahead.
    property real _glance: 0
    readonly property point _gaze: {
        if (_glance !== 0)
            return Qt.point(0, _glance);
        if (!_typing)
            return Qt.point(0, 0);
        var c = input.cursorRectangle;
        var p = input.mapToItem(bird, c.x + c.width / 2, c.y + c.height / 2);
        return Qt.point(Math.max(-1, Math.min(1, (p.x - bird.width / 2) / (bird.width * 1.5))),
                        Math.max(-1, Math.min(1, (p.y - bird.height * 0.4) / (bird.height * 1.2))));
    }
    // A tap: the wave first, then the wave or a reaction at random (never
    // the same twice running).
    property int _taps: 0
    property string _lastTap: ""
    function tapBird() {
        if (birdPose !== "idle" || bird.move !== "")
            return;
        var all = ["wave"].concat(_reactions.tap);
        var pick = _taps === 0 ? "wave" : all.filter(function (n) { return n !== ov._lastTap; })[Math.floor(Math.random() * (all.length - 1))];
        ++_taps;
        _lastTap = pick;
        if (pick === "wave")
            _play([{ pose: "hello", ms: 900 }]);
        else
            bird.react(pick);
    }
    // The keyboard moving it beside the field and back: a scoot.
    onBirdBesideChanged: if (_birdMoves) bird.react(_reactions.move)

    // ---- Voice --------------------------------------------------------------------------
    // The wake word was heard: listening at once (the words after "Hey
    // Phoenix" in the same breath are already on their way).
    function startVoice() {
        handsFree = true;
        listen();
    }
    // Asked again by voice (after the unlock).
    function askByVoice(text) {
        voice = true;
        handsFree = true;
        ask(text);
    }
    // A spoken turn's reply: once it has been said (and its beats played),
    // a read-back listens for Yes or No; over the lock screen, what needs
    // the unlock goes to the shell; hands-free, it closes after a moment.
    function _afterReply() {
        if (!voice && !handsFree)
            return;
        _followGrace = 3;
        _idleMs = 0;
        _followDone = false;
        followTimer.restart();
    }
    property int _followGrace: 0
    property int _idleMs: 0
    property bool _followDone: false
    function _lastAssistant() {
        for (var i = messages.length - 1; i >= 0; --i)
            if (messages[i].role === "assistant")
                return messages[i];
        return null;
    }
    function _lastUserText() {
        for (var i = messages.length - 1; i >= 0; --i)
            if (messages[i].role === "user")
                return messages[i].text;
        return "";
    }
    Timer {
        id: followTimer
        interval: 250
        repeat: true
        onTriggered: {
            // Speech starts a moment after the reply: a little grace.
            if (!ov.open || ov.busy || ov.listening || ov.beat !== "" || ov.speaking || ov._followGrace > 0) {
                ov._followGrace = Math.max(0, ov._followGrace - 1);
                ov._idleMs = 0;
                return;
            }
            if (!ov._followDone) {
                ov._followDone = true;
                var last = ov._lastAssistant();
                if (ov.voice && ov.asking) {
                    stop();
                    ov.listen();
                    return;
                }
                if (last && last.status === "locked") {
                    stop();
                    ov.unlockNeeded(ov._lastUserText());
                    ov.closeRequested();
                    return;
                }
            }
            if (!ov.handsFree) {
                stop();
                return;
            }
            ov._idleMs += interval;
            if (ov._idleMs >= ov.idleCloseMs) {
                stop();
                ov.closeRequested();
            }
        }
    }
    // "Hey Phoenix, ..." came through whole: the request is what follows.
    function withoutWakeWord(text) {
        return String(text || "").replace(/^\s*(?:hey|hi|okay|ok|a|hay|eh)[,.!]?\s+(?:phoenix|ph?oenix|fenix|feenix|phenix)\b[,.!?]*\s*/i, "").trim();
    }

    // ---- The microphone ----------------------------------------------------------------
    readonly property string _owner: "assistant"
    // Words to expect, whisper's prompt (the service's vocabulary: the wake
    // phrase and the contacts' names, so "call Marcus" is not "Carl
    // Marquez"), fetched as the view opens.
    property string _vocabulary: "Hey Phoenix, set a timer."
    function _fetchVocabulary() {
        _call("vocabulary", {}, function (r) {
            if (!r || r.returnValue === false || !r.prompt)
                return;
            ov._vocabulary = r.prompt;
            if (ov.dictation && ov.dictation.owner === ov._owner)
                ov.dictation.prompt = ov._vocabulary;
        });
    }
    function listen() {
        if (!dictation || dictation.busy)
            return;
        voice = true;
        if (dictation.listening) {
            if (dictation.owner === _owner)
                dictation.stop();
            return;
        }
        input.focus = false;
        dictation.owner = _owner;
        dictation.prompt = _vocabulary;
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
            var words = ov.withoutWakeWord(text);
            if (!error && words)
                ov.ask(words);
            else if (ov.handsFree)
                ov._afterReply();           // nothing (more) said: it closes after a moment
        }
    }

    Keys.onEscapePressed: { if (connecting !== null) connecting = null; else closeRequested(); }
    // Typed with the field not in focus (voice first, a hardware keyboard):
    // the words go to the field, not to Just Type behind the view.
    Keys.onPressed: (event) => {
        if (event.text.length !== 1 || event.text < " " || event.text === "\u007f"
                || (event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier)) || busy || connecting !== null)
            return;
        input.forceActiveFocus();
        input.insert(input.cursorPosition, event.text);
        event.accepted = true;
    }
    // Over everything: Enter does not reach the card behind (it would
    // maximize it).
    Keys.onReturnPressed: (event) => { event.accepted = true; }
    Keys.onEnterPressed: (event) => { event.accepted = true; }

    // ---- The backdrop ----------------------------------------------------------------
    // The blur and the dim fade in and out together.
    Item {
        id: backdropLayer
        objectName: "assistantBackdrop"
        anchors.fill: parent
        opacity: ov.shown
        BackdropBlur {
            anchors.fill: parent
            source: ov.visible ? ov.backdrop : null
            radius: Theme.px(48)
        }
        Rectangle {
            anchors.fill: parent
            // Darker where nothing blurs (the software renderer, the lock screen).
            color: GraphicsInfo.api === GraphicsInfo.Software || !ov.backdrop ? "#D8101418" : "#80101418"
        }
    }
    // The glow along the bottom while it listens or thinks.
    Rectangle {
        objectName: "assistantGlow"
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.bottomMargin: ov.bottomInset
        height: Theme.px(6)
        visible: ov.open && (ov.listening || ov.busy)
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0.0; color: "#5ac8fa" }
            GradientStop { position: 0.35; color: "#af52de" }
            GradientStop { position: 0.7; color: "#ff2d55" }
            GradientStop { position: 1.0; color: "#ff9500" }
        }
        SequentialAnimation on opacity {
            running: ov.visible && (ov.listening || ov.busy)
            loops: Animation.Infinite
            NumberAnimation { from: 0.4; to: 1; duration: Theme.motion(700); easing.type: Easing.InOutQuad }
            NumberAnimation { from: 1; to: 0.4; duration: Theme.motion(700); easing.type: Easing.InOutQuad }
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
    // The panel's growth: from a fifth of its size at the origin.
    readonly property real _panelScale: 0.2 + 0.8 * shown
    // The bird: 72 to 104 px at the top in the middle, over the
    // conversation, which scrolls on behind it; where the panel is too
    // short for that and a conversation (a phone's keyboard up, a phone on
    // its side), small beside the field.
    readonly property bool birdBeside: panel.height < Theme.px(360)
    readonly property real birdSize: birdBeside ? Theme.px(44)
                                                : Math.max(Theme.px(72), Math.min(Theme.px(104), Math.round(panel.height * 0.15)))
    // Moves between the two only once the panel is up.
    readonly property bool _birdMoves: shown === 1

    Item {
        id: panel
        objectName: "assistantPanel"
        width: ov.panelWidth
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.statusBarHeight + Theme.px(12)
        anchors.bottom: parent.bottom
        anchors.bottomMargin: ov.bottomInset + Theme.px(16)
        opacity: Math.min(1, ov.shown * 1.5)
        transform: Scale {
            origin.x: ov.origin.x - panel.x
            origin.y: ov.origin.y - panel.y
            xScale: ov._panelScale
            yScale: ov._panelScale
        }

        // Taps on the conversation stay in it.
        MouseArea {
            x: 0; width: parent.width
            y: list.y + Math.max(0, list.height - list.contentHeight)
            height: parent.height - y
        }

        // The Assistant app: the conversation goes on there.
        Item {
            id: appButton
            objectName: "assistantApp"
            anchors.left: parent.left
            anchors.verticalCenter: heading.verticalCenter
            width: Theme.px(28)
            height: width
            scale: appArea.pressed ? 0.9 : 1
            Behavior on scale { NumberAnimation { duration: Theme.motion(80) } }
            Image {
                id: appIconImage
                anchors.fill: parent
                source: ov.appIcon
                sourceSize.width: width * 2
                sourceSize.height: height * 2
                smooth: true
                visible: status === Image.Ready
            }
            // No icon file (a test, a bare simulator): a speech bubble.
            Rectangle {
                visible: !appIconImage.visible
                anchors.fill: parent
                radius: width / 2
                color: "#40FFFFFF"
                border.color: "#B0FFFFFF"
                border.width: Math.max(1, Theme.px(1.5))
                Row {
                    anchors.centerIn: parent
                    spacing: Theme.px(2)
                    Repeater {
                        model: 3
                        delegate: Rectangle { width: Theme.px(3.5); height: width; radius: width / 2; color: "#FFFFFF" }
                    }
                }
            }
            MouseArea {
                id: appArea
                anchors.fill: parent
                anchors.margins: -Theme.px(10)
                onClicked: ov.openApp()
            }
        }
        Text {
            id: heading
            anchors.left: appButton.right
            anchors.leftMargin: Theme.px(10)
            anchors.right: newButton.left
            anchors.top: parent.top
            height: Theme.px(28)
            verticalAlignment: Text.AlignVCenter
            text: qsTr("Assistant")
            color: "#B0FFFFFF"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(14)
            font.bold: true
            MouseArea { anchors.fill: parent; onClicked: ov.openApp() }
        }
        Text {
            id: newButton
            objectName: "assistantNew"
            anchors.right: parent.right
            anchors.verticalCenter: heading.verticalCenter
            visible: ov.messages.length > 0
            text: qsTr("New")
            color: "#B0FFFFFF"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.px(14)
            MouseArea { anchors.fill: parent; anchors.margins: -Theme.px(10); onClicked: ov.newConversation() }
        }

        // The assistant's bird. A tap waves hello.
        AssistantBird {
            id: bird
            // Over the conversation, which passes behind it.
            z: 1
            pose: ov.birdPose
            glow: true
            // Listening: the microphone's loudness where the dictation has it.
            level: ov.listening && ov.dictation && ov.dictation.listening && ("loudness" in ov.dictation) ? ov.dictation.loudness : -1
            width: ov.birdSize
            x: ov.birdBeside ? 0 : Math.round((panel.width - width) / 2)
            // Beside the field: its feet on the field's bottom line.
            y: ov.birdBeside ? field.y + field.height - Math.round(height * 412 / 440) : heading.y + heading.height
            Behavior on width { enabled: ov._birdMoves; NumberAnimation { duration: Theme.motion(250); easing.type: Easing.InOutQuad } }
            Behavior on x { enabled: ov._birdMoves; NumberAnimation { duration: Theme.motion(250); easing.type: Easing.InOutQuad } }
            Behavior on y { enabled: ov._birdMoves; NumberAnimation { duration: Theme.motion(250); easing.type: Easing.InOutQuad } }
            MouseArea {
                anchors.fill: parent
                onClicked: ov.tapBird()
            }
            gazeX: ov._gaze.x
            gazeY: ov._gaze.y
            fidgety: !ov._typing
        }

        // The conversation's top edge: clear to opaque over 28 px.
        Rectangle {
            id: listFade
            anchors.fill: list
            visible: false
            layer.enabled: true
            gradient: Gradient {
                GradientStop { position: 0; color: "transparent" }
                GradientStop { position: Math.min(1, Theme.px(28) / Math.max(1, listFade.height)); color: "black" }
                GradientStop { position: 1; color: "black" }
            }
        }

        ListView {
            id: list
            objectName: "assistantMessages"
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: heading.bottom
            anchors.topMargin: Theme.px(4)
            anchors.bottom: statusLine.top
            anchors.bottomMargin: Theme.px(6)
            // The conversation runs on up behind the bird; scrolled back to
            // its start, the first message comes clear below it.
            topMargin: ov.birdBeside ? Theme.px(4) : bird.height
            Behavior on topMargin { enabled: ov._birdMoves; NumberAnimation { duration: Theme.motion(250); easing.type: Easing.InOutQuad } }
            clip: true
            // It fades out under the heading rather than being cut off
            // (not with the software renderer, which cannot run the effect).
            layer.enabled: GraphicsInfo.api !== GraphicsInfo.Software
            layer.smooth: true
            layer.effect: OpacityMask { maskSource: listFade }
            spacing: Theme.px(8)
            // The latest at the bottom, as in a conversation; while it
            // thinks, a bubble of bouncing dots after the request.
            verticalLayoutDirection: ListView.BottomToTop
            model: ov.messages.concat(ov.busy ? [{ id: "thinking", role: "assistant", text: "", thinking: true }] : []).reverse()
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight + topMargin > height
            // The bird glances along a scroll, the way the words go.
            property real _from: 0
            onMovementStarted: { _from = contentY; glanceTimer.restart(); }
            onMovementEnded: { glanceTimer.stop(); ov._glance = 0; }
            Timer {
                id: glanceTimer
                interval: 120
                onTriggered: if (list.contentY !== list._from) ov._glance = list.contentY > list._from ? -1 : 1
            }
            delegate: Item {
                id: row
                required property var modelData
                readonly property bool mine: modelData.role === "user"
                readonly property bool thinking: !!modelData.thinking
                // 0 to 1 as it arrives (1 at once for one seen before).
                property real appear: 1
                property real choicesAppear: 1
                width: list.width
                height: bubble.height + (actions.visible ? actions.height + Theme.px(6) : 0)

                Component.onCompleted: {
                    if (ov._arrives(modelData)) {
                        appear = 0;
                        choicesAppear = 0;
                        arrival.start();
                    }
                }
                // An app's scene push: conf/lunaAnimations.conf:61-62
                // cardTransitionDuration, curve 20 OutQuad (Theme).
                ParallelAnimation {
                    id: arrival
                    NumberAnimation { target: row; property: "appear"; to: 1; duration: Theme.cardTransitionDuration; easing.type: Easing.OutQuad }
                    SequentialAnimation {
                        PauseAnimation { duration: Theme.motion(120) }
                        NumberAnimation { target: row; property: "choicesAppear"; to: 1; duration: Theme.cardTransitionDuration + Theme.motion(80) * Math.max(0, actions.count - 1) }
                    }
                }

                Rectangle {
                    id: bubble
                    objectName: row.thinking ? "assistantThinking" : "assistantBubble"
                    anchors.right: row.mine ? parent.right : undefined
                    anchors.left: row.mine ? undefined : parent.left
                    width: row.thinking ? dotsRow.width + Theme.px(28) : Math.min(list.width * 0.86, words.implicitWidth + Theme.px(24))
                    height: row.thinking ? Theme.px(36) : words.implicitHeight + Theme.px(16) + (via.visible ? via.height : 0)
                    radius: Theme.px(14)
                    color: row.mine ? "#E8FFFFFF" : (row.modelData.status === "failed" ? "#B04A2020" : "#A0303438")
                    border.color: row.mine ? "transparent" : "#40FFFFFF"
                    border.width: row.mine ? 0 : 1
                    opacity: row.appear
                    transform: Translate {
                        x: (row.mine ? 1 : -1) * (1 - row.appear) * Theme.px(28)
                        y: (1 - row.appear) * Theme.px(12)
                    }
                    Text {
                        id: words
                        visible: !row.thinking
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
                        visible: !row.mine && !row.thinking && !!row.modelData.source
                        text: row.modelData.source || ""
                        color: "#90FFFFFF"
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.px(11)
                    }
                    // Thinking: three dots rising in turn.
                    Row {
                        id: dotsRow
                        visible: row.thinking
                        anchors.centerIn: parent
                        spacing: Theme.px(5)
                        Repeater {
                            model: row.thinking ? 3 : 0
                            delegate: Rectangle {
                                id: dot
                                required property int index
                                width: Theme.px(7); height: width; radius: width / 2
                                color: "#FFFFFF"
                                opacity: 0.35 + 0.65 * lift
                                property real lift: 0
                                transform: Translate { y: -dot.lift * Theme.px(5) }
                                SequentialAnimation on lift {
                                    running: ov.visible && row.thinking
                                    loops: Animation.Infinite
                                    PauseAnimation { duration: dot.index * Theme.motion(140) }
                                    NumberAnimation { from: 0; to: 1; duration: Theme.motion(280); easing.type: Easing.OutQuad }
                                    NumberAnimation { from: 1; to: 0; duration: Theme.motion(280); easing.type: Easing.InQuad }
                                    PauseAnimation { duration: (2 - dot.index) * Theme.motion(140) + Theme.motion(200) }
                                }
                            }
                        }
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
                    // Requests close to words it did not understand: to the field.
                    readonly property var suggestions: row.modelData.data && row.modelData.data.suggest && choices.length > 0 ? row.modelData.data.suggest : []
                    readonly property int count: choices.length + suggestions.length + (asking ? 2 : 0)

                    visible: asking || choices.length > 0
                    // Button k of n appears after the ones before it (an
                    // even share of choicesAppear each, overlapping).
                    function shareOf(k) {
                        var n = Math.max(1, count);
                        var start = k / (n + 1);
                        return Math.max(0, Math.min(1, (row.choicesAppear - start) / (2 / (n + 1))));
                    }
                    Repeater {
                        model: actions.choices
                        delegate: ActionButton {
                            id: choiceButton
                            required property var modelData
                            required property int index
                            objectName: "assistantChoice-" + modelData.id
                            width: Math.min(list.width, label.implicitWidth + Theme.px(40))
                            height: Theme.px(40)
                            caption: modelData.label
                            affirmative: modelData.id.indexOf("cloud:") === 0
                            onAction: ov.choose(row.modelData, modelData)
                            readonly property real appear: actions.shareOf(index)
                            opacity: appear
                            scale: 0.85 + 0.15 * appear
                            Text { id: label; visible: false; text: parent.caption; font.pixelSize: Theme.px(16); font.bold: true; font.family: Theme.fontFamily }
                        }
                    }
                    Repeater {
                        model: actions.suggestions
                        delegate: AssistantChip {
                            required property var modelData
                            required property int index
                            objectName: "assistantSuggest-" + index
                            text: modelData
                            maxWidth: list.width
                            onClicked: ov.suggest(modelData)
                            readonly property real appear: actions.shareOf(actions.choices.length + index)
                            opacity: appear
                            scale: 0.85 + 0.15 * appear
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
                        readonly property real appear: actions.shareOf(actions.choices.length + actions.suggestions.length)
                        opacity: appear
                        scale: 0.85 + 0.15 * appear
                    }
                    ActionButton {
                        objectName: "assistantConfirmNo"
                        visible: actions.asking
                        width: Theme.px(120)
                        height: Theme.px(40)
                        caption: qsTr("Cancel")
                        onAction: ov.confirm(row.modelData, false)
                        readonly property real appear: actions.shareOf(actions.choices.length + actions.suggestions.length + 1)
                        opacity: appear
                        scale: 0.85 + 0.15 * appear
                    }
                }
            }

            // Nothing asked yet: a few things to ask, a different few
            // every few seconds (faded over; held still while one is
            // being typed or said).
            Column {
                id: hint
                objectName: "assistantHint"
                anchors.bottom: parent.bottom
                anchors.horizontalCenter: parent.horizontalCenter
                width: parent.width
                spacing: Theme.px(8)
                visible: ov.messages.length === 0 && !ov.busy
                property real fade: 1
                Text {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    text: qsTr("Try asking")
                    color: "#A0FFFFFF"
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.px(Theme.tablet ? 15 : 13)
                }
                // In a line where they fit, else one under another; centred.
                Grid {
                    id: exampleFlow
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: Theme.px(8)
                    opacity: hint.fade
                    horizontalItemAlignment: Grid.AlignHCenter
                    columns: oneLine ? ov.examplesShown : 1
                    readonly property bool oneLine: {
                        var w = -spacing;
                        for (var i = 0; i < children.length; ++i)
                            if (children[i].text !== undefined)
                                w += children[i].width + spacing;
                        return w <= hint.width;
                    }
                    Repeater {
                        model: ov.examplesNow()
                        delegate: AssistantChip {
                            required property var modelData
                            required property int index
                            objectName: "assistantExample-" + index
                            text: modelData
                            maxWidth: hint.width
                            onClicked: ov.suggest(modelData)
                        }
                    }
                }
                SequentialAnimation {
                    id: nextExamples
                    NumberAnimation { target: hint; property: "fade"; to: 0; duration: Theme.motion(250); easing.type: Easing.InQuad }
                    ScriptAction { script: ov.exampleIndex = (ov.exampleIndex + ov.examplesShown) % ov.examples.length }
                    NumberAnimation { target: hint; property: "fade"; to: 1; duration: Theme.motion(250); easing.type: Easing.OutQuad }
                }
                Timer {
                    interval: 5000
                    repeat: true
                    running: hint.visible && ov.open && input.text === "" && !ov.listening && ov.connecting === null
                    onTriggered: nextExamples.restart()
                }
            }
        }

        // Listening, transcribing, or what went wrong.
        Item {
            id: statusLine
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: field.top
            anchors.bottomMargin: Theme.px(8)
            height: ov.status !== "" ? Theme.px(20) : 0
            Behavior on height { NumberAnimation { duration: Theme.motion(150); easing.type: Easing.OutQuad } }
            clip: true
            Text {
                objectName: "assistantStatus"
                anchors.left: parent.left
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
            anchors.leftMargin: ov.birdBeside ? ov.birdSize + Theme.px(6) : 0
            Behavior on anchors.leftMargin { enabled: ov._birdMoves; NumberAnimation { duration: Theme.motion(250); easing.type: Easing.InOutQuad } }
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
                // Not disabled while it thinks: the field keeps the focus,
                // so the keyboard stays and Enter's release does not reach
                // the card behind (ask() waits for the answer anyway).
                readOnly: ov.busy
                // A tap on the field: the user is here, it does not close by itself.
                // Listening for a read-back's answer stops: it will be typed.
                onActiveFocusChanged: {
                    if (!activeFocus)
                        return;
                    ov.handsFree = false;
                    followTimer.stop();
                    ov.stopListening(true);
                }
                Keys.onEscapePressed: { if (ov.connecting !== null) ov.connecting = null; else ov.closeRequested(); }
                // Enter is the field's alone: TextInput lets it go on after
                // accepted(), and the shell behind would take it (the card
                // in focus maximized).
                Keys.onReturnPressed: (event) => { submit(); event.accepted = true; }
                Keys.onEnterPressed: (event) => { submit(); event.accepted = true; }
                onAccepted: submit()
                function submit() {
                    if (ov.busy)
                        return;
                    // Typed: answered as typed requests are, and it stays open.
                    ov.voice = false;
                    ov.handsFree = false;
                    var t = text;
                    ov._sending = true;
                    text = "";
                    ov._sending = false;
                    ov.ask(t);
                    if (ov.busy)
                        bird.react(ov._reactions.send);
                }
                onTextChanged: ov._typed()
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
        // While it listens, rings spread from the microphone one after
        // another (the dictation gives no level to follow).
        Repeater {
            model: 3
            delegate: Rectangle {
                id: ring
                required property int index
                objectName: "assistantMicRing"
                visible: mic.visible && ov.listening
                x: mic.x
                y: mic.y
                width: mic.width
                height: mic.height
                radius: width / 2
                color: "transparent"
                border.color: "#FF3B30"
                border.width: Theme.px(2)
                property real spread: 0
                scale: 1 + 0.9 * spread
                opacity: 0.8 * (1 - spread)
                SequentialAnimation on spread {
                    running: ring.visible && ov.visible
                    loops: Animation.Infinite
                    PauseAnimation { duration: ring.index * Theme.motion(400) }
                    NumberAnimation { from: 0; to: 1; duration: Theme.motion(1200); easing.type: Easing.OutCubic }
                    PauseAnimation { duration: (2 - ring.index) * Theme.motion(400) }
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
            Behavior on color { ColorAnimation { duration: Theme.motion(150) } }
            // A gentle breath while it listens.
            SequentialAnimation on scale {
                running: ov.listening && ov.visible
                loops: Animation.Infinite
                NumberAnimation { from: 1; to: 1.08; duration: Theme.motion(600); easing.type: Easing.InOutQuad }
                NumberAnimation { from: 1.08; to: 1; duration: Theme.motion(600); easing.type: Easing.InOutQuad }
                onRunningChanged: if (!running) mic.scale = 1
            }
            // A microphone (MicGlyph, drawn as a vector).
            MicGlyph {
                anchors.centerIn: parent
                width: Theme.px(26)
                height: width
                color: ov.listening ? "#FFFFFF" : "#202428"
            }
            MouseArea {
                anchors.fill: parent
                onClicked: ov.listening ? ov.dictation.stop() : ov.listen()
            }
        }

        // "Connect model": which kind, over the bottom of the panel (a
        // tap on its backdrop, Back or Escape lets it go).
        MouseArea {
            objectName: "assistantConnectScrim"
            z: 2                                    // over the bird
            anchors.fill: parent
            visible: ov.connecting !== null
            onClicked: ov.connecting = null
        }
        Rectangle {
            id: connectSheet
            objectName: "assistantConnect"
            z: 2
            visible: ov.connecting !== null
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            // Scrolls where the panel is short (a phone on its side).
            height: Math.min(parent.height, connectColumn.implicitHeight + Theme.px(24))
            radius: Theme.px(16)
            clip: true
            color: "#FA1C2024"
            border.color: "#50FFFFFF"
            border.width: 1
            opacity: visible ? 1 : 0
            Behavior on opacity { NumberAnimation { duration: Theme.motion(150) } }
            MouseArea { anchors.fill: parent }       // taps stay on it
            Flickable {
                anchors.fill: parent
                contentHeight: connectColumn.implicitHeight + Theme.px(24)
                interactive: contentHeight > height
                boundsBehavior: Flickable.StopAtBounds
                Column {
                    id: connectColumn
                    x: Theme.px(16)
                    y: Theme.px(12)
                    width: connectSheet.width - Theme.px(32)
                    spacing: Theme.px(4)
                    Text {
                        width: parent.width
                        text: qsTr("Connect a model")
                        color: "#FFFFFF"
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.px(Theme.tablet ? 19 : 17)
                        font.bold: true
                    }
                    Text {
                        width: parent.width
                        bottomPadding: Theme.px(4)
                        wrapMode: Text.Wrap
                        text: qsTr("For questions and requests the phone's own commands don't know.")
                        color: "#B0FFFFFF"
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.px(13)
                    }
                    Repeater {
                        model: [
                            { mode: "local", title: qsTr("On-device model"),
                              detail: qsTr("Private and offline: nothing leaves the phone. A 0.5 to 2.5 GB download.") },
                            { mode: "cloud", title: qsTr("Cloud model"),
                              detail: qsTr("Anthropic, OpenAI, Gemini or a compatible server, with your API key.") },
                            { mode: "both", title: qsTr("Both"),
                              detail: qsTr("On-device first; the cloud model for what it can't do.") }
                        ]
                        delegate: Rectangle {
                            required property var modelData
                            objectName: "assistantConnect-" + modelData.mode
                            width: connectColumn.width
                            height: kindText.implicitHeight + Theme.px(16)
                            radius: Theme.px(10)
                            color: kindArea.pressed ? "#40FFFFFF" : "#1AFFFFFF"
                            Column {
                                id: kindText
                                x: Theme.px(12)
                                anchors.verticalCenter: parent.verticalCenter
                                width: parent.width - Theme.px(24)
                                Text {
                                    width: parent.width
                                    text: modelData.title
                                    color: "#FFFFFF"
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.px(Theme.tablet ? 17 : 15)
                                    font.bold: true
                                }
                                Text {
                                    width: parent.width
                                    wrapMode: Text.Wrap
                                    text: modelData.detail
                                    color: "#C0FFFFFF"
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.px(Theme.tablet ? 14 : 12)
                                }
                            }
                            MouseArea {
                                id: kindArea
                                anchors.fill: parent
                                onClicked: ov.connectModel(modelData.mode)
                            }
                        }
                    }
                    Text {
                        objectName: "assistantConnectCancel"
                        width: parent.width
                        topPadding: Theme.px(6)
                        horizontalAlignment: Text.AlignHCenter
                        text: qsTr("Cancel")
                        color: "#D0FFFFFF"
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.px(15)
                        MouseArea { anchors.fill: parent; anchors.margins: -Theme.px(6); onClicked: ov.connecting = null }
                    }
                }
            }
        }
    }
}
