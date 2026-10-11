// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Assistant (org.webosphoenix.assistant, docs/M6-PLAN.md F3): the Phoenix
// Assistant's conversations. The one in use, drawn like a Messaging thread
// (the user's words on the right, the assistant's on the left with who
// answered: the phone's commands, the on-device model or a cloud model),
// with the answers' choices ("Ask <cloud model>", "Search the web",
// "Connect model", which asks which kind and goes on in Settings) and
// read-backs ("Send ... to Sam?") as buttons, and the requests an answer
// suggests ("Did you mean ...?"), which go to the field; a text field and the
// microphone (org.webosphoenix.dictation). Conversations lists the past
// ones: open one to go on with it, start a new one, delete one. The
// shell's assistant view (hold the launcher button) shows the same thread
// in use: both go through org.webosphoenix.assistant.
//
// Laid out as a TouchPad app (phoenix-ui's SlidingPanes, after Enyo 1.0's
// SlidingPane): wider than 500 px, Conversations (conversations.tsx) at the
// left, 320 px, and the conversation beside it, which can be dragged over
// the list and back (its edge, or the grip in its compose bar); narrower,
// the conversation slides in over the list and Back (or a drag to the
// right) shows the list. It follows the card's width live (the simulator's
// adaptive layout, a rotation). Hold a conversation or a message, or
// right-click it, for Open in New Card: another card of the app with that
// conversation; each card keeps to its own conversation.
//
// The empty conversation shows a few things to ask (examples.ts), a
// different few every few seconds; a tap puts one in the field.
//
// The assistant's bird (docs/ASSISTANT-CHARACTER.md, bird/) greets on the
// empty conversation, thinks while it loads and while a request waits,
// then works and cheers (done) when a command ran, shrugs at "I can't do
// that", or says oops when something failed, as in the shell's view.
//
// A text-messaging chat (chat.tsx): a small bird is the assistant's avatar
// beside its words and in the header, asking while a follow-up question
// waits; a follow-up's answers are quick-reply chips; Conversations shows
// how many follow-ups wait unread in each.
//
// Launch params: {text} asks it (Just Type's "Ask Assistant"); {threadId}
// (or {conversationId}, Open in New Card) opens that conversation, and with {retry: true} asks again the question
// that waited for a model (Settings' "Back to Your Question"); {followUp:
// id} is a follow-up's notification tapped: the conversation it waits in
// (followUpOpen); {timerDone: {id, label, seconds}} is a timer
// the assistant set going off (its activity's callback): a notification,
// the alarm sound and, when speech is on, the words.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
    apps, assistant, audio, dictation, filePicker, postNotification, shareSheet, tts, ASSISTANT_APP_ID, ASSISTANT_ERRORS,
    type AssistantMessage, type AssistantSettings, type AssistantThread, type ConnectMode, type Listening, type LunaError,
} from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import {
    AppMenu, BackProvider, Button, ContextMenu, cx, Dialog, GrabButton, PaneHeader, SlidingPanes, useBack, useLongPress, useMultiView,
    type ContextMenuItem, type PaneView,
} from "@phoenix/ui";
import { Bird, moveMs, useBirdMotion } from "./bird/Bird";
import { useBirdReactions } from "./bird/reactions";
import type { BirdPose } from "./bird/birdData";
import { base64, conversationText, exportConversation, exportName, type ExportedConversation } from "./exportConversation";
import { beatsFor, birdPose, outcomeOf, type Beat } from "./bird/pose";
import { EXAMPLES, examplesFrom } from "./examples";
import { Avatar, QuickReplies, restingPose, waitingFollowUp, withoutFollowUps } from "./chat";
import { Attachments } from "./Attachments";
import { ConversationList, copyText, openInNewCard } from "./conversations";

const errorText = (e: unknown) => (e as LunaError).errorText ?? (e instanceof Error ? e.message : String(e));

interface Launch {
    text?: string;
    threadId?: string;
    /** Open in New Card: the conversation this card shows. */
    conversationId?: string;
    retry?: boolean;
    /** A follow-up question's notification tapped: the conversation it waits in. */
    followUp?: string;
    timerDone?: { id?: string; label?: string; seconds?: number };
}

const VIA: Record<string, string> = { commands: "On the phone", "on-device": "On device", cloud: "Cloud" };

// ---- One message ---------------------------------------------------------------------------

// The on-device model at work (the service's thread.working): what it is
// doing, for how long, and when it will give up, so a slow answer is not
// a spinner without end (assistant.js bounded).
export function Working({ w }: { w: NonNullable<AssistantThread["working"]> }) {
    const [, tick] = useState(0);
    useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(t); }, []);
    const now = Date.now();
    const secs = (ms: number) => Math.max(0, Math.round(ms / 1000));
    const what = w.stage === "starting" ? "Starting the on-device model" : "Thinking it over on this device";
    return (
        <div className="as-working" data-testid="as-working" data-stage={w.stage}>
            {what} · {secs(now - w.since)} s{now < w.until ? ` (I'll stop in ${secs(w.until - now)} s)` : ""}
        </div>
    );
}

function Bubble({ m, busy, onChoose, onConfirm, onSuggest, avatar, onMenu }: {
    m: AssistantMessage; busy: boolean;
    onChoose: (m: AssistantMessage, id: string) => void; onConfirm: (m: AssistantMessage, yes: boolean) => void;
    onSuggest: (words: string) => void;
    /** The bird beside the assistant's words (chat.tsx). */
    avatar?: ReactNode;
    /** Held or right-clicked: its menu (Open in New Card, Copy). */
    onMenu?: (m: AssistantMessage, el: HTMLElement) => void;
}) {
    const press = useLongPress((el) => onMenu?.(m, el));
    const mine = m.role === "user";
    const asking = m.status === "pending" && !!m.confirm;
    const choices = m.choices && !m.chosen ? m.choices : [];
    // Requests close to words it did not understand ("Did you mean ...?").
    const suggest = choices.length && Array.isArray(m.data?.suggest) ? (m.data!.suggest as string[]) : [];
    const yes = m.command === "text" ? "Send" : m.command === "call" ? "Call" : "Yes";
    return (
        <div className={cx("as-row", mine ? "out" : "in", !!avatar && "with-avatar")} data-testid={`as-msg-${m.id}`}>
            <div className="as-line">
                {avatar}
                <div className={cx("as-bubble", mine ? "out" : "in", m.status === "failed" && "failed", m.status === "cancelled" && "cancelled")}
                     {...(onMenu ? press : {})}>
                    {m.text}
                </div>
            </div>
            <Attachments m={m} onShow={(i) => onChoose(m, `show:${i}`)} onSuggest={onSuggest} />
            {m.followUp && choices.length > 0 && <QuickReplies m={m} busy={busy} onChoose={onChoose} />}
            {!mine && (m.source || m.via) && (
                <div className="as-via">{m.source || VIA[m.via ?? ""] || ""}</div>
            )}
            {(asking || (choices.length > 0 && !m.followUp)) && (
                <div className="as-actions">
                    {choices.map((c) => (
                        <Button key={c.id} variant={c.id.startsWith("cloud:") ? "affirmative" : undefined} disabled={busy}
                                data-testid={`as-choice-${c.id}`} onClick={() => onChoose(m, c.id)}>{c.label}</Button>
                    ))}
                    {suggest.map((w, i) => (
                        <button key={w} type="button" className="as-chip" data-testid={`as-suggest-${i}`} onClick={() => onSuggest(w)}>{w}</button>
                    ))}
                    {asking && <Button variant="affirmative" disabled={busy} data-testid="as-confirm-yes" onClick={() => onConfirm(m, true)}>{yes}</Button>}
                    {asking && <Button disabled={busy} data-testid="as-confirm-no" onClick={() => onConfirm(m, false)}>Cancel</Button>}
                </div>
            )}
        </div>
    );
}

// ---- The bird's beats ------------------------------------------------------------------------------

/** Plays beats (poses for a time) one after another; the one playing, or null. */
function useBeats(speed: number): [BirdPose | null, (beats: Beat[]) => void] {
    const [beat, setBeat] = useState<BirdPose | null>(null);
    const timer = useRef(0);
    const play = useCallback((beats: Beat[]) => {
        window.clearTimeout(timer.current);
        const next = (rest: Beat[]) => {
            const [b, ...more] = rest;
            setBeat(b ? b.pose : null);
            if (b) timer.current = window.setTimeout(() => next(more), Math.max(1, b.ms * speed));
        };
        next(beats);
    }, [speed]);
    useEffect(() => () => window.clearTimeout(timer.current), []);
    return [beat, play];
}

// ---- Connect model: which kind -------------------------------------------------------------------

const KINDS: { mode: ConnectMode; title: string; detail: string }[] = [
    { mode: "local", title: "On-Device Model", detail: "Private and offline: nothing leaves the phone. One comes with it; larger ones are 1.8 to 19 GB downloads." },
    { mode: "cloud", title: "Cloud Model", detail: "Anthropic, OpenAI, Gemini or a compatible server, with your API key." },
    { mode: "both", title: "Both", detail: "On-device first; the cloud model for what it can't do." },
];

function ConnectChooser({ open, onChoose, onClose }: { open: boolean; onChoose: (mode: ConnectMode) => void; onClose: () => void }) {
    return (
        <Dialog open={open} onClose={onClose} testId="as-connect" title="Connect a Model"
                message="For questions and requests the phone's own commands don't know.">
            {KINDS.map((k) => (
                <button key={k.mode} type="button" className="as-kind" data-testid={`as-connect-${k.mode}`} onClick={() => onChoose(k.mode)}>
                    <b>{k.title}</b><span>{k.detail}</span>
                </button>
            ))}
            <Button onClick={onClose}>Cancel</Button>
        </Dialog>
    );
}

// ---- Things to ask, on an empty conversation ------------------------------------------------------

function Examples({ onPick, speed }: { onPick: (words: string) => void; speed: number }) {
    const [first, setFirst] = useState(() => Math.floor(Math.random() * EXAMPLES.length));
    const [fading, setFading] = useState(false);
    // Two on a phone (all in sight above the field), three on a tablet.
    const shown = window.innerWidth < 600 ? 2 : 3;
    useEffect(() => {
        const t = window.setInterval(() => {
            setFading(true);
            window.setTimeout(() => { setFirst((i) => (i + shown) % EXAMPLES.length); setFading(false); }, 250 * speed);
        }, 5000);
        return () => window.clearInterval(t);
    }, [speed, shown]);
    return (
        <div className="as-examples" data-testid="as-examples">
            <div className="as-examples-label">Try asking</div>
            <div className={cx("as-examples-list", fading && "fading")}>
                {examplesFrom(first, shown).map((w, i) => (
                    <button key={w} type="button" className="as-chip" data-testid={`as-example-${i}`} onClick={() => onPick(w)}>{w}</button>
                ))}
            </div>
        </div>
    );
}

// ---- A message held or right-clicked ------------------------------------------------------------

function messageMenu(m: AssistantMessage): ContextMenuItem[] {
    return [
        { label: "Open in New Card", testId: "as-menu-newcard", onSelect: () => { void openInNewCard(m.threadId).catch(() => undefined); } },
        { label: "Copy", testId: "as-menu-copy", onSelect: () => { void copyText(m.text); } },
    ];
}

// ---- The conversation in use -------------------------------------------------------------------

function Conversation({ threadId, onThread, retry, onPose, grab, shown = true }: {
    /** This card's conversation ("": the one in use, which it then keeps to). */
    threadId: string; onThread: (id: string) => void; retry: object | null;
    /** The bird's pose as the conversation goes, for the header's. */
    onPose?: (pose: BirdPose) => void;
    /** The panes side by side: the grip that drags this one over the list. */
    grab?: boolean;
    /** In sight (not slid away behind the list): what arrives is read. */
    shown?: boolean;
}) {
    const [thread, setThread] = useState<AssistantThread | null>(null);
    const [messages, setMessages] = useState<AssistantMessage[]>([]);
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [listening, setListening] = useState<"" | "listening" | "transcribing">("");
    const [canListen, setCanListen] = useState(false);
    const mic = useRef<Listening | null>(null);
    const end = useRef<HTMLDivElement>(null);
    const motion = useBirdMotion();
    const [loaded, setLoaded] = useState(false);
    const [greeting, setGreeting] = useState(false);
    const [beat, play] = useBeats(motion.speed);
    // The bird reacting to the typing, a scroll, a tap (bird/reactions.ts).
    const birdr = useBirdReactions({ speed: motion.speed });
    const [connecting, setConnecting] = useState<AssistantMessage | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const [menu, setMenu] = useState<{ m: AssistantMessage; el: HTMLElement } | null>(null);

    // The one in use, once known, stays this card's: another card going
    // on in another conversation does not change what this one shows.
    // Its conversation deleted (here or in another card): the one in use.
    useEffect(() => {
        const sub = assistant.watchThread(threadId || undefined, (t, list) => {
            setThread(t); setMessages(list); setLoaded(true);
            if (!threadId && t) onThread(t.id);
        }, (e) => {
            if (threadId && e.errorCode === ASSISTANT_ERRORS.NOT_FOUND) { onThread(""); return; }
            setError(errorText(e)); setLoaded(true);
        });
        return () => sub.cancel();
    }, [threadId]);    // eslint-disable-line react-hooks/exhaustive-deps
    // Loaded: once it has entered (born of embers, it drops in), a wave,
    // then it idles; a tap waves again, or giggles or spins.
    const wave = useCallback((after: number) => {
        const a = window.setTimeout(() => setGreeting(true), after);
        const b = window.setTimeout(() => setGreeting(false), after + 900 * motion.speed);
        return () => { window.clearTimeout(a); window.clearTimeout(b); };
    }, [motion.speed]);
    useEffect(() => (loaded ? wave(moveMs("enter", motion.speed, motion.still)) : undefined), [loaded]);    // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { dictation.status().then((s) => setCanListen(s.available), () => setCanListen(false)); }, []);
    useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [messages.length, busy]);
    useEffect(() => () => mic.current?.cancel(), []);

    const run = useCallback((p: Promise<{ thread: AssistantThread; messages?: AssistantMessage[] }>) => {
        setBusy(true);
        setError("");
        play([]);
        p.then((r) => {
            if (r.thread && r.thread.id !== threadId) onThread(r.thread.id);
            play(beatsFor(outcomeOf(withoutFollowUps(r.messages))));
        }, (e) => { setError(errorText(e)); play(beatsFor("failed")); })
            .finally(() => setBusy(false));
    }, [threadId, onThread, play]);

    // The question that waited for a model, asked again (once per launch that says so).
    const retried = useRef<object | null>(null);
    useEffect(() => {
        if (!retry || retried.current === retry || !threadId) return;
        retried.current = retry;
        run(assistant.retry(threadId));
    }, [retry, threadId, run]);
    // Words to change or send: an example, a suggestion.
    const suggest = (words: string) => {
        setText(words);
        window.setTimeout(() => {
            const el = input.current;
            if (el) { el.focus(); el.setSelectionRange(words.length, words.length); }
        });
    };
    const choose = (m: AssistantMessage, id: string) => {
        if (id === "connect") setConnecting(m);
        else run(assistant.choose(m.threadId, m.id, id));
    };
    const connect = (mode: ConnectMode) => {
        const m = connecting;
        setConnecting(null);
        if (m) assistant.connect({ threadId: m.threadId, messageId: m.id, mode }).catch((e) => setError(errorText(e)));
    };

    // Read: follow-ups that arrived here, in sight, count unread no more.
    useEffect(() => { if (shown && thread?.unread) void assistant.markRead(thread.id).catch(() => undefined); }, [thread, shown]);
    const waiting = waitingFollowUp(messages);
    const pose = restingPose(birdPose({ loading: !loaded, busy, beat, greeting: false }), !!waiting);
    useEffect(() => { onPose?.(pose); }, [pose, onPose]);
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

    const ask = useCallback((words: string) => {
        const t = words.trim();
        if (!t || busy) return;
        setText("");
        birdr.sent();
        birdr.typed("");
        run(assistant.ask(t, thread ? { threadId: thread.id } : {}));
    }, [busy, run, thread, birdr]);

    const listen = () => {
        if (mic.current) { mic.current.stop(); return; }
        setListening("listening");
        setError("");
        const l = dictation.listen({ autoStop: true, onState: (s) => setListening(s) });
        mic.current = l;
        l.result.then((heard) => {
            mic.current = null;
            setListening("");
            if (heard) ask(heard);
        }, (e) => { mic.current = null; setListening(""); setError(errorText(e)); });
    };

    return (
        <div className="as-conversation">
            <div className="as-scroll" data-testid="as-thread" onScroll={birdr.scrolled}>
                {messages.length === 0 && !busy && !beat && (
                    <div className="as-empty" data-testid="as-empty">
                        <Bird pose={birdPose({ loading: !loaded, busy: false, beat: null, greeting, listening })} size={window.innerHeight < 520 ? 96 : 120} speed={motion.speed} still={motion.still}
                              start="enter" react={birdr.react} gaze={birdr.gaze} fidgety={birdr.fidgety}
                              onClick={() => { if (!greeting && birdr.tap() === "wave") wave(0); }} />
                        {loaded && <p>Ask me a question, or tell me what to do: events, reminders, alarms, notes, messages, music, settings and more.</p>}
                        {loaded && <Examples onPick={suggest} speed={motion.speed} />}
                    </div>
                )}
                {messages.map((m) => (
                    <Bubble key={m.id} m={m} busy={busy} onChoose={choose} onSuggest={suggest} onMenu={(msg, el) => setMenu({ m: msg, el })}
                            onConfirm={(msg, yes) => run(assistant.confirm(msg.threadId, msg.id, yes))}
                            avatar={m.role === "assistant" ? <Avatar pose={pose} live={m === lastAssistant && !busy && !beat}
                                                                     speed={motion.speed} still={motion.still} /> : undefined} />
                ))}
                {(busy || beat) && (
                    <div className="as-work" data-testid="as-work">
                        <Bird pose={birdPose({ loading: false, busy, beat, greeting: false })} size={72} testId="as-bird-work"
                              speed={motion.speed} still={motion.still} start={busy ? "cheer" : undefined} />
                        {busy && (
                            <div className="as-work-say">
                                <div className="as-bubble in as-thinking" data-testid="as-thinking"><span /><span /><span /></div>
                                {thread?.working && <Working w={thread.working} />}
                            </div>
                        )}
                    </div>
                )}
                {error && <div className="as-error" data-testid="as-error">{error}</div>}
                <div ref={end} />
            </div>
            <form className="as-compose" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
                {grab && <GrabButton testId="as-grab" />}
                <input ref={input} className="as-input" data-testid="as-input" value={text} disabled={busy}
                       placeholder={listening === "listening" ? "Listening…" : listening === "transcribing" ? "Transcribing…" : waiting ? "Reply" : "Ask anything"}
                       onChange={(e) => { birdr.typed(e.target.value, e.target.selectionStart); setText(e.target.value); }} enterKeyHint="send" />
                {canListen && (
                    <button type="button" className={cx("as-mic", listening && "on")} aria-label="Speak" data-testid="as-mic" onClick={listen}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7" /></svg>
                    </button>
                )}
                <button type="submit" className="as-send" disabled={busy || !text.trim()} data-testid="as-send" aria-label="Send">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z" /></svg>
                </button>
            </form>
            <ConnectChooser open={connecting !== null} onChoose={connect} onClose={() => setConnecting(null)} />
            <ContextMenu anchor={menu?.el ?? null} onClose={() => setMenu(null)} items={menu ? messageMenu(menu.m) : []} />
        </div>
    );
}

// ---- A timer going off ---------------------------------------------------------------------------

function useTimerDone(launch: Launch, settings: AssistantSettings | null) {
    const handled = useRef<Launch | null>(null);
    useEffect(() => {
        const t = launch.timerDone;
        if (!t || handled.current === launch) return;
        handled.current = launch;
        const words = t.label ? `Your ${t.label} timer is done.` : "Your timer is done.";
        postNotification({ appId: ASSISTANT_APP_ID, title: "Timer", body: words, params: {} });
        void audio.playSound("/usr/palm/sounds/alert.wav", "palerts").catch(() => undefined);
        if (settings?.speak !== false) void tts.speak(words).catch(() => undefined);
    }, [launch, settings]);
}

// ---- Export Conversation ---------------------------------------------------------------------------
// The conversation as JSON or text (exportConversation.ts): shared with
// the share sheet, or saved with the save picker. For the owner's test
// sessions: what was asked, what answered it and how, and how long it took.
function ExportDialog({ open, threadId, settings, onClose }: { open: boolean; threadId: string; settings: AssistantSettings | null; onClose: () => void }) {
    const [status, setStatus] = useState("");
    const [made, setMade] = useState<ExportedConversation | null>(null);
    useEffect(() => {
        if (!open) return;
        setStatus("");
        setMade(null);
        let live = true;
        assistant.thread(threadId || undefined).then((r) => {
            if (live && r.thread) setMade(exportConversation(r.thread, r.messages, settings));
            else if (live) setStatus("There's no conversation to export yet.");
        }, () => { if (live) setStatus("Couldn't read the conversation."); });
        return () => { live = false; };
    }, [open, threadId, settings]);
    const save = async (ext: "json" | "txt") => {
        if (!made) return;
        const text = ext === "json" ? JSON.stringify(made, null, 1) : conversationText(made);
        try {
            const r = await filePicker.save({ name: exportName(made, ext), data: base64(text), mimeType: ext === "json" ? "application/json" : "text/plain",
                                              title: "Save Conversation" });
            if ("path" in r) { setStatus(`Saved to ${r.path}`); onClose(); }
        } catch { setStatus("Couldn't save it."); }
    };
    const share = async () => {
        if (!made) return;
        try {
            const r = await shareSheet.open({ title: `Assistant: ${made.thread.title || "conversation"}`, text: conversationText(made) });
            if (r.action !== "cancel") onClose();
        } catch { setStatus("Couldn't share it."); }
    };
    return (
        <Dialog open={open} onClose={onClose} testId="as-export" title="Export Conversation"
                message={status || (made ? `${made.messages.length} messages, with what answered each and how long it took.` : "Reading the conversation...")}>
            <Button data-testid="as-export-share" disabled={!made} onClick={() => { void share(); }}>Share</Button>
            <Button data-testid="as-export-json" disabled={!made} onClick={() => { void save("json"); }}>Save as JSON</Button>
            <Button data-testid="as-export-text" disabled={!made} onClick={() => { void save("txt"); }}>Save as Text</Button>
            <Button onClick={onClose}>Cancel</Button>
        </Dialog>
    );
}

// ---- The app -------------------------------------------------------------------------------------

function Main() {
    const launch = useLaunchParams<Launch>();
    const settings = useLuna<AssistantSettings>((cb, err) => assistant.watchSettings(cb, err), []).value;
    const threads = useLuna<AssistantThread[]>((cb, err) => assistant.watchThreads((list) => cb(list), err), []).value ?? null;
    const multiView = useMultiView();
    // The pane at the left (SlidingPanes): side by side, the list (the
    // conversation beside it); one at a time, the conversation.
    const [view, setView] = useState<PaneView>(multiView ? "list" : "detail");
    // This card's conversation; opened (open, New Conversation) it starts afresh.
    const [threadId, setThreadId] = useState("");
    const [opened, setOpened] = useState(0);
    const [asked, setAsked] = useState<Launch | null>(null);
    const [retry, setRetry] = useState<Launch | null>(null);
    const [pose, setPose] = useState<BirdPose>("idle");
    const [exporting, setExporting] = useState(false);
    const motion = useBirdMotion();

    useTimerDone(launch, settings ?? null);
    // Across the pivot (the card resized, rotated): side by side both
    // show; one at a time, the conversation. In the same render, so the
    // panes snap to the new layout rather than slide.
    const [wasMulti, setWasMulti] = useState(multiView);
    if (wasMulti !== multiView) {
        setWasMulti(multiView);
        setView(multiView ? "list" : "detail");
    }
    const lastMulti = useRef(multiView);
    lastMulti.current = multiView;
    useBack(() => { setView("list"); return true; }, view === "detail");

    const show = useCallback((id: string) => {
        setThreadId(id);
        setOpened((n) => n + 1);
        if (!lastMulti.current) setView("detail");
    }, []);
    // {threadId} or {conversationId} opens it (the system's view hands its
    // conversation on this way; Open in New Card); {text} asks it in the
    // conversation in use.
    useEffect(() => {
        if (asked === launch) return;
        setAsked(launch);
        const id = launch.conversationId || launch.threadId;
        if (id) {
            show(id);
            void assistant.setCurrent(id).catch(() => undefined);
            if (launch.retry) setRetry(launch);
        }
        if (launch.text) void assistant.ask(launch.text, id ? { threadId: id } : {}).catch(() => undefined);
        // A follow-up's notification: its conversation, where the question waits.
        if (launch.followUp) void assistant.openFollowUp(launch.followUp).then((r) => show(r.thread.id), () => undefined);
    }, [launch, asked, show]);

    const open = (id: string) => { void assistant.setCurrent(id).then(() => show(id), () => undefined); };
    const fresh = () => { void assistant.newThread().then((t) => show(t.id), () => undefined); };
    const prefs = () => { void apps.launch("org.webosphoenix.settings", { page: "assistant" }); };
    const title = threads?.find((t) => t.id === threadId)?.title || "Assistant";

    const detail = (
        <div className="as-chat">
            <PaneHeader className="as-header">
                {view === "detail" && (
                    <button type="button" className="as-header-button" data-testid="as-conversations" aria-label="Conversations"
                            onClick={() => setView("list")}>Conversations</button>
                )}
                <div className="as-header-bird"><Bird pose={pose} size={30} testId="as-header-bird" speed={motion.speed} still={motion.still} /></div>
                <div className="as-header-title" data-testid="as-title">{title}</div>
            </PaneHeader>
            {settings && !settings.enabled ? (
                <div className="as-off" data-testid="as-off">
                    <p>The assistant is turned off.</p>
                    <Button onClick={prefs}>Settings</Button>
                </div>
            ) : <Conversation key={opened} threadId={threadId} onThread={setThreadId} retry={retry} onPose={setPose} grab={multiView}
                                  shown={multiView || view === "detail"} />}
        </div>
    );

    return (
        <div className="as-app">
            <AppMenu items={[
                { label: "New Conversation", onSelect: fresh },
                { label: "Conversations", onSelect: () => setView("list") },
                { label: "Export Conversation", onSelect: () => setExporting(true) },
                { label: "Preferences", onSelect: prefs },
            ]} />
            <ExportDialog open={exporting} threadId={threadId} settings={settings ?? null} onClose={() => setExporting(false)} />
            <SlidingPanes testId="as-panes" multiView={multiView} selected={view} onSelect={setView}
                          list={<ConversationList threads={threads} selected={threadId} onOpen={open} onNew={fresh} />}
                          detail={detail} />
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <Main />
        </BackProvider>
    );
}
