// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Assistant (org.webosphoenix.assistant, docs/M6-PLAN.md F3): the Phoenix
// Assistant's conversations. The one in use, drawn like a Messaging thread
// (the user's words on the right, the assistant's on the left with who
// answered: the phone's commands, the on-device model or a cloud model),
// with the answers' choices ("Ask <cloud model>", "Search the web") and
// read-backs ("Send ... to Sam?") as buttons; a text field and the
// microphone (org.webosphoenix.dictation). Conversations lists the past
// ones: open one to go on with it, start a new one, delete one. The
// shell's assistant view (hold the launcher button) shows the same thread
// in use: both go through org.webosphoenix.assistant.
//
// Launch params: {text} asks it (Just Type's "Ask Assistant"); {threadId}
// opens that conversation; {timerDone: {id, label, seconds}} is a timer
// the assistant set going off (its activity's callback): a notification,
// the alarm sound and, when speech is on, the words.

import { useCallback, useEffect, useRef, useState } from "react";
import {
    apps, assistant, audio, dictation, postNotification, tts, ASSISTANT_APP_ID,
    type AssistantMessage, type AssistantSettings, type AssistantThread, type Listening, type LunaError,
} from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import { AppMenu, BackProvider, Button, cx, Dialog, Page, PageHeader, Row, Spinner, useBack } from "@phoenix/ui";

const errorText = (e: unknown) => (e as LunaError).errorText ?? (e instanceof Error ? e.message : String(e));

interface Launch {
    text?: string;
    threadId?: string;
    timerDone?: { id?: string; label?: string; seconds?: number };
}

function when(time: number, now = Date.now()): string {
    const d = new Date(time), n = new Date(now);
    if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const VIA: Record<string, string> = { commands: "On the phone", "on-device": "On device", cloud: "Cloud" };

// ---- One message ---------------------------------------------------------------------------

function Bubble({ m, busy, onChoose, onConfirm }: {
    m: AssistantMessage; busy: boolean;
    onChoose: (m: AssistantMessage, id: string) => void; onConfirm: (m: AssistantMessage, yes: boolean) => void;
}) {
    const mine = m.role === "user";
    const asking = m.status === "pending" && !!m.confirm;
    const choices = m.choices && !m.chosen ? m.choices : [];
    const yes = m.command === "text" ? "Send" : m.command === "call" ? "Call" : "Yes";
    return (
        <div className={cx("as-row", mine ? "out" : "in")} data-testid={`as-msg-${m.id}`}>
            <div className={cx("as-bubble", mine ? "out" : "in", m.status === "failed" && "failed", m.status === "cancelled" && "cancelled")}>
                {m.text}
            </div>
            {!mine && (m.source || m.via) && (
                <div className="as-via">{m.source || VIA[m.via ?? ""] || ""}</div>
            )}
            {(asking || choices.length > 0) && (
                <div className="as-actions">
                    {choices.map((c) => (
                        <Button key={c.id} variant={c.id.startsWith("cloud:") ? "affirmative" : undefined} disabled={busy}
                                data-testid={`as-choice-${c.id}`} onClick={() => onChoose(m, c.id)}>{c.label}</Button>
                    ))}
                    {asking && <Button variant="affirmative" disabled={busy} data-testid="as-confirm-yes" onClick={() => onConfirm(m, true)}>{yes}</Button>}
                    {asking && <Button disabled={busy} data-testid="as-confirm-no" onClick={() => onConfirm(m, false)}>Cancel</Button>}
                </div>
            )}
        </div>
    );
}

// ---- The conversation in use -------------------------------------------------------------------

function Conversation({ threadId, onThread }: { threadId: string; onThread: (id: string) => void }) {
    const [thread, setThread] = useState<AssistantThread | null>(null);
    const [messages, setMessages] = useState<AssistantMessage[]>([]);
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [listening, setListening] = useState<"" | "listening" | "transcribing">("");
    const [canListen, setCanListen] = useState(false);
    const mic = useRef<Listening | null>(null);
    const end = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const sub = assistant.watchThread(threadId || undefined, (t, list) => { setThread(t); setMessages(list); },
                                          (e) => setError(errorText(e)));
        return () => sub.cancel();
    }, [threadId]);
    useEffect(() => { dictation.status().then((s) => setCanListen(s.available), () => setCanListen(false)); }, []);
    useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [messages.length, busy]);
    useEffect(() => () => mic.current?.cancel(), []);

    const run = useCallback((p: Promise<{ thread: AssistantThread }>) => {
        setBusy(true);
        setError("");
        p.then((r) => { if (r.thread && r.thread.id !== threadId) onThread(r.thread.id); },
               (e) => setError(errorText(e)))
            .finally(() => setBusy(false));
    }, [threadId, onThread]);

    const ask = useCallback((words: string) => {
        const t = words.trim();
        if (!t || busy) return;
        setText("");
        run(assistant.ask(t, thread ? { threadId: thread.id } : {}));
    }, [busy, run, thread]);

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
            <div className="as-scroll" data-testid="as-thread">
                {messages.length === 0 && !busy && (
                    <div className="as-empty" data-testid="as-empty">
                        <img src="icon-256x256.png" alt="" />
                        <p>Ask me to set a timer, text someone, turn on the flashlight, get directions, or anything else.</p>
                    </div>
                )}
                {messages.map((m) => (
                    <Bubble key={m.id} m={m} busy={busy}
                            onChoose={(msg, id) => run(assistant.choose(msg.threadId, msg.id, id))}
                            onConfirm={(msg, yes) => run(assistant.confirm(msg.threadId, msg.id, yes))} />
                ))}
                {busy && <div className="as-row in"><div className="as-bubble in as-thinking" data-testid="as-thinking"><span /><span /><span /></div></div>}
                {error && <div className="as-error" data-testid="as-error">{error}</div>}
                <div ref={end} />
            </div>
            <form className="as-compose" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
                <input className="as-input" data-testid="as-input" value={text} disabled={busy}
                       placeholder={listening === "listening" ? "Listening…" : listening === "transcribing" ? "Transcribing…" : "Ask anything"}
                       onChange={(e) => setText(e.target.value)} enterKeyHint="send" />
                {canListen && (
                    <button type="button" className={cx("as-mic", listening && "on")} aria-label="Speak" data-testid="as-mic" onClick={listen}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7" /></svg>
                    </button>
                )}
                <button type="submit" className="as-send" disabled={busy || !text.trim()} data-testid="as-send" aria-label="Send">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z" /></svg>
                </button>
            </form>
        </div>
    );
}

// ---- Conversations ----------------------------------------------------------------------------

function Conversations({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
    const [threads, setThreads] = useState<AssistantThread[] | null>(null);
    const [current, setCurrent] = useState("");
    const [deleting, setDeleting] = useState<AssistantThread | null>(null);
    useEffect(() => {
        const sub = assistant.watchThreads((list, cur) => { setThreads(list); setCurrent(cur); });
        return () => sub.cancel();
    }, []);
    return (
        <Page>
            <PageHeader title="Conversations" icon="icon.png" />
            <div className="as-list-actions">
                <Button variant="affirmative" data-testid="as-new" onClick={onNew}>New Conversation</Button>
            </div>
            {!threads && <div className="as-loading"><Spinner /></div>}
            {threads && threads.length === 0 && <div className="as-none" data-testid="as-none">No conversations yet.</div>}
            {threads?.map((t) => (
                <Row key={t.id} testId={`as-thread-${t.id}`} title={<span className={cx(t.id === current && "as-current")}>{t.title || "New conversation"}</span>}
                     subtitle={`${when(t.updated)} · ${t.last}`} onClick={() => onOpen(t.id)}>
                    <button type="button" className="as-delete" data-testid={`as-delete-${t.id}`} aria-label="Delete"
                            onClick={(e) => { e.stopPropagation(); setDeleting(t); }}>Delete</button>
                </Row>
            ))}
            <Dialog open={deleting !== null} onClose={() => setDeleting(null)} testId="as-delete-dialog"
                    title="Delete this conversation?" message={deleting ? `"${deleting.title}" and its messages go.` : ""}>
                <Button variant="negative" data-testid="as-delete-ok" onClick={() => {
                    const t = deleting;
                    setDeleting(null);
                    if (t) void assistant.deleteThread(t.id);
                }}>Delete</Button>
                <Button onClick={() => setDeleting(null)}>Cancel</Button>
            </Dialog>
        </Page>
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

// ---- The app -------------------------------------------------------------------------------------

function Main() {
    const launch = useLaunchParams<Launch>();
    const settings = useLuna<AssistantSettings>((cb, err) => assistant.watchSettings(cb, err), []).value;
    const [view, setView] = useState<"thread" | "list">("thread");
    const [threadId, setThreadId] = useState("");
    const [asked, setAsked] = useState<Launch | null>(null);

    useTimerDone(launch, settings ?? null);
    useBack(() => { setView("thread"); return true; }, view === "list");

    // {threadId} opens it; {text} asks it in the conversation in use.
    useEffect(() => {
        if (asked === launch) return;
        setAsked(launch);
        if (launch.threadId) {
            setThreadId(launch.threadId);
            void assistant.setCurrent(launch.threadId).catch(() => undefined);
        }
        if (launch.text) void assistant.ask(launch.text, launch.threadId ? { threadId: launch.threadId } : {}).catch(() => undefined);
    }, [launch, asked]);

    const open = (id: string) => {
        void assistant.setCurrent(id).then(() => { setThreadId(id); setView("thread"); });
    };
    const fresh = () => {
        void assistant.newThread().then((t) => { setThreadId(t.id); setView("thread"); });
    };
    const prefs = () => { void apps.launch("org.webosphoenix.settings", { page: "assistant" }); };

    return (
        <div className="as-app">
            <AppMenu items={[
                { label: "New Conversation", onSelect: fresh },
                { label: "Conversations", onSelect: () => setView("list") },
                { label: "Preferences", onSelect: prefs },
            ]} />
            {view === "list" ? <Conversations onOpen={open} onNew={fresh} /> : (
                <>
                    <div className="as-header">
                        <PageHeader title="Assistant" icon="icon.png" />
                        <button type="button" className="as-header-button" data-testid="as-conversations" onClick={() => setView("list")}>Conversations</button>
                    </div>
                    {settings && !settings.enabled ? (
                        <div className="as-off" data-testid="as-off">
                            <p>The assistant is turned off.</p>
                            <Button onClick={prefs}>Settings</Button>
                        </div>
                    ) : <Conversation key={threadId} threadId={threadId} onThread={setThreadId} />}
                </>
            )}
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
