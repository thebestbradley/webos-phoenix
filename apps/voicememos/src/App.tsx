// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Voice Memos: the webOS 2.x Voice Memos app rebuilt. A light Heritage list
// of memos under day dividers (title, time, length), the big red record
// button in the command menu, and a dark recording sheet with the elapsed
// time, a level meter, pause / resume and stop. Tapping a memo opens it in
// place: play with a scrubber, its transcript, and Transcribe, Share,
// Rename and Delete. The search field finds memos by title and transcript.
//
// Services:
//   org.webosphoenix.service.mediafiles write / remove and
//       com.webos.service.mediaindexer requestMediaScan / requestDelete: the
//       WAV files, as the Camera saves its pictures, so Files and the media
//       indexer see them (/media/internal/voicememos)
//   com.palm.db (db8) org.webosphoenix.voicememo:1: the memos (memos.ts);
//       Just Type searches them through appinfo.json's "dbsearch"
//   org.webosphoenix.transcriber transcribe {path, language, subscribe}:
//       speech to text (whisper.cpp on a device), with progress
//   com.webos.applicationManager launch: share by Email ({attachments}) or
//       Messaging ({attachment}), as Photos does, or open with another app
//
// Launch params: {memoId} opens that memo (Just Type's content search),
// {newMemo: "title"} starts recording one (Just Type's "New Voice Memo").

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    apps, db, mediaFiles, mediaIndexer, openWith, transcriber, TRANSCRIBE_ERRORS, type LunaError, type MimeHandler, type Subscription,
    type TranscribeProgress,
} from "@phoenix/luna";
import { useLaunchParams, useLuna, useMediaUrl } from "@phoenix/luna/react";
import {
    BackProvider, Button, cx, Dialog, Divider, ErrorText, formatSeconds, formatTime, Glyph, ListSelector, Note, PageHeader, PopupMenu, Row,
    Slider, Spinner, TextField, ToggleButton, Toolbar, ToolSpacer, useBack, type Option,
} from "@phoenix/ui";
import {
    byDay, LANGUAGES, loadPrefs, matches, MEMO_DIR, MEMO_KIND, MEMO_MIME, memoFileName, nextTitle, savePrefs, searchTextOf, snippet, spokenText,
    type Memo, type MemoTranscript, type Prefs,
} from "./memos";
import { VoiceRecorder, toWav, type RecorderState } from "./recorder";
import { seedDemoMemos } from "./samples";

const errorText = (e: unknown) => (e as { errorText?: string }).errorText ?? (e instanceof Error ? e.message : String(e));

type Sheet = { kind: "rename"; memo: Memo } | { kind: "delete"; memo: Memo } | { kind: "prefs" } | null;
type Menu = { kind: "app" | "share"; anchor: HTMLElement; memo?: Memo } | null;

// ---- Glyphs drawn for Voice Memos (32x32, like @phoenix/ui's) -------------------------------

function Mic({ size = 24 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" fill="currentColor">
            <path d="M16 3a5 5 0 0 1 5 5v8a5 5 0 0 1-10 0V8a5 5 0 0 1 5-5zM8 14h2.5v2a5.5 5.5 0 0 0 11 0v-2H24v2a8 8 0 0 1-6.7 7.9V27h4v2.5h-10.6V27h4v-3.1A8 8 0 0 1 8 16z" />
        </svg>
    );
}

// ---- Recording sheet -------------------------------------------------------------------

const METER_BARS = 20;

function RecordSheet({ title, language, onSaved, onClose }: {
    title: string;
    language: string;
    onSaved: (recorded: Blob, liveText: string) => Promise<void>;
    onClose: () => void;
}) {
    const rec = useRef<VoiceRecorder | null>(null);
    const live = useRef<{ sub: Subscription | null; text: string[] }>({ sub: null, text: [] });
    const [state, setState] = useState<RecorderState | "starting" | "saving">("starting");
    const [error, setError] = useState("");
    const [elapsed, setElapsed] = useState(0);
    const [level, setLevel] = useState(0);
    const liveOn = useRef(false);

    const listen = useCallback(() => {
        if (!liveOn.current || live.current.sub) return;
        live.current.sub = transcriber.listen(language, (t) => live.current.text.push(t), () => {
            live.current.sub?.cancel();
            live.current.sub = null;
            liveOn.current = false;   // not available after all (no network, no permission)
        });
    }, [language]);
    const unlisten = () => { live.current.sub?.cancel(); live.current.sub = null; };

    useEffect(() => {
        const r = new VoiceRecorder();
        rec.current = r;
        let alive = true;
        r.start().then(async () => {
            if (!alive) { void r.stop(false); return; }
            setState("recording");
            // Live captions where the simulator has the browser's speech recognition.
            try { liveOn.current = !!(await transcriber.status()).live; } catch { liveOn.current = false; }
            if (alive && r.state === "recording") listen();
        }, (e: { name?: string }) => {
            if (!alive) return;
            setState("stopped");
            setError(e.name === "NotAllowedError" || e.name === "SecurityError"
                ? "Voice Memos may not use the microphone. Allow it and try again."
                : "No microphone was found.");
        });
        return () => {
            alive = false;
            unlisten();
            if (r.state !== "stopped") void r.stop(false);
        };
    }, [listen]);

    // Elapsed time and level, about 20 times a second.
    useEffect(() => {
        if (state !== "recording" && state !== "paused") return;
        let raf = 0, last = 0;
        const tick = (t: number) => {
            if (t - last > 50) {
                last = t;
                setElapsed(rec.current?.elapsed() ?? 0);
                setLevel(rec.current?.level() ?? 0);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [state]);

    const pauseResume = () => {
        const r = rec.current;
        if (!r) return;
        if (r.state === "recording") { r.pause(); unlisten(); }
        else { r.resume(); listen(); }
        setState(r.state);
    };

    const stop = async () => {
        const r = rec.current;
        if (!r || (state !== "recording" && state !== "paused")) return;
        setState("saving");
        unlisten();
        const blob = await r.stop(true);
        if (!blob) { onClose(); return; }
        try {
            await onSaved(blob, live.current.text.join(" "));
            onClose();
        } catch (e) {
            console.warn("[voicememos] saving failed", e);
            setError("The memo could not be saved: " + errorText(e));
            setState("stopped");
        }
    };

    const discard = () => {
        unlisten();
        void rec.current?.stop(false);
        onClose();
    };

    useBack(() => { if (state === "recording" || state === "paused") void stop(); else if (state !== "saving") onClose(); return true; });

    const lit = Math.round(level * METER_BARS);
    return (
        <div className="vm-recording" data-testid="recording">
            <div className="vm-rec-title">{title}</div>
            <div className={cx("vm-rec-state", state)} data-testid="rec-state">
                {state === "starting" && "Starting…"}
                {state === "recording" && <><span className="vm-rec-dot" />Recording</>}
                {state === "paused" && "Paused"}
                {state === "saving" && "Saving…"}
            </div>
            <div className="vm-rec-time" data-testid="rec-time">{formatSeconds(elapsed)}</div>
            <div className="vm-meter" role="meter" aria-label="Level" aria-valuemin={0} aria-valuemax={METER_BARS} aria-valuenow={lit} data-testid="level">
                {Array.from({ length: METER_BARS }, (_, i) => (
                    <span key={i} className={cx(i < lit && "on", i >= METER_BARS * 0.85 ? "red" : i >= METER_BARS * 0.65 ? "yellow" : "green")} />
                ))}
            </div>
            {error && <div className="vm-rec-error" role="alert" data-testid="rec-error">{error}</div>}
            <div className="vm-rec-buttons">
                {error ? (
                    <Button onClick={onClose} data-testid="rec-close">Close</Button>
                ) : (
                    <>
                        <Button variant="dark" disabled={state !== "recording" && state !== "paused"} onClick={pauseResume} data-testid="rec-pause">
                            {state === "paused" ? "Resume" : "Pause"}
                        </Button>
                        <Button variant="negative" busy={state === "saving"} disabled={state !== "recording" && state !== "paused"}
                                onClick={() => void stop()} data-testid="rec-stop">Stop</Button>
                        <button type="button" className="vm-rec-discard" disabled={state === "saving"} onClick={discard} data-testid="rec-discard">
                            Discard
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

// ---- One memo --------------------------------------------------------------------------------

interface Work {
    progress: TranscribeProgress | null;
    error?: string;
}

function Player({ memo, audio }: { memo: Memo; audio: HTMLAudioElement }) {
    const url = useMediaUrl(memo.path);
    const [pos, setPos] = useState(0);
    const [dur, setDur] = useState(memo.duration);
    const [playing, setPlaying] = useState(false);
    const [scrub, setScrub] = useState<number | null>(null);

    useEffect(() => {
        if (!url) return;
        audio.src = url;
        audio.load();
        setPos(0);
        const onTime = () => setPos(audio.currentTime);
        const onMeta = () => { if (isFinite(audio.duration) && audio.duration > 0) setDur(audio.duration); };
        const onPlay = () => setPlaying(true);
        const onPause = () => setPlaying(false);
        audio.addEventListener("timeupdate", onTime);
        audio.addEventListener("loadedmetadata", onMeta);
        audio.addEventListener("play", onPlay);
        audio.addEventListener("pause", onPause);
        audio.addEventListener("ended", onPause);
        return () => {
            audio.pause();
            audio.removeEventListener("timeupdate", onTime);
            audio.removeEventListener("loadedmetadata", onMeta);
            audio.removeEventListener("play", onPlay);
            audio.removeEventListener("pause", onPause);
            audio.removeEventListener("ended", onPause);
        };
    }, [audio, url]);

    const shown = scrub ?? pos;
    return (
        <div className="vm-player">
            <button type="button" className={cx("vm-play", playing && "playing")} aria-label={playing ? "Pause" : "Play"} data-testid="play"
                    disabled={!url} onClick={() => { if (audio.paused) void audio.play().catch(() => {}); else audio.pause(); }}>
                <Glyph name={playing ? "pause" : "play"} size={20} />
            </button>
            <div className="vm-scrub">
                <Slider progress value={shown} min={0} max={Math.max(0.1, dur)} step={0.1} label="Position" testId="scrubber"
                        onChange={setScrub} onChangeComplete={(v) => { setScrub(null); audio.currentTime = v; setPos(v); }} />
                <div className="vm-times">
                    <span data-testid="elapsed">{formatSeconds(shown)}</span>
                    <span>-{formatSeconds(Math.max(0, dur - shown))}</span>
                </div>
            </div>
        </div>
    );
}

function MemoItem({ memo, open, query, work, audio, onToggle, onTranscribe, onShare, onRename, onDelete, onSeek }: {
    memo: Memo;
    open: boolean;
    query: string;
    work?: Work;
    audio: HTMLAudioElement;
    onToggle: () => void;
    onTranscribe: () => void;
    onShare: (anchor: HTMLElement) => void;
    onRename: () => void;
    onDelete: () => void;
    onSeek: (t: number) => void;
}) {
    const t = memo.transcript;
    const spoken = spokenText(t);
    const busy = !!work?.progress;
    return (
        <div className={cx("vm-memo", open && "open")} data-testid={`memo-${memo.title}`} data-memo-id={memo._id}>
            <Row className="vm-memo-row" icon={<span className="vm-memo-icon"><Mic size={22} /></span>}
                 title={<span data-testid="memo-title">{memo.title}</span>}
                 subtitle={<>
                     {formatTime(Date.parse(memo.created))}
                     {!open && spoken && <span className="vm-snippet"> {"–"} {snippet(spoken, query, 48)}</span>}
                 </>}
                 value={<span data-testid="memo-duration">{formatSeconds(memo.duration)}</span>}
                 onClick={onToggle} />
            {open && (
                <div className="vm-detail" data-testid="memo-detail">
                    <Player memo={memo} audio={audio} />
                    {busy && (
                        <div className="vm-progress" data-testid="transcribing">
                            <Spinner />
                            <span>{work!.progress!.state === "queued" ? "Waiting to transcribe…"
                                : work!.progress!.state === "converting" ? "Preparing the audio…"
                                : `Transcribing… ${Math.round(work!.progress!.progress)}%`}</span>
                        </div>
                    )}
                    {work?.error && <ErrorText>{work.error}</ErrorText>}
                    {t && !busy && (
                        <div className={cx("vm-transcript", t.placeholder && "placeholder")} data-testid="transcript">
                            {t.segments.length && !t.placeholder
                                ? t.segments.map((s, i) => (
                                    <span key={i} className="vm-segment" role="button" tabIndex={0} title={formatSeconds(s.start)}
                                          onClick={() => onSeek(s.start)}>{s.text} </span>
                                ))
                                : t.text}
                        </div>
                    )}
                    <div className="vm-actions">
                        <button type="button" className="vm-action" disabled={busy} onClick={onTranscribe} data-testid="transcribe">
                            {t && !t.placeholder ? "Transcribe Again" : "Transcribe"}
                        </button>
                        <button type="button" className="vm-action" onClick={(e) => onShare(e.currentTarget)} data-testid="share">Share</button>
                        <button type="button" className="vm-action" onClick={onRename} data-testid="rename">Rename</button>
                        <button type="button" className="vm-action negative" onClick={onDelete} data-testid="delete">Delete</button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ---- Dialogs ----------------------------------------------------------------------------

function RenameDialog({ memo, onClose }: { memo: Memo; onClose: () => void }) {
    const [name, setName] = useState(memo.title);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        const n = name.trim();
        if (!n) { setError("A memo needs a name."); return; }
        if (n === memo.title) { onClose(); return; }
        setBusy(true);
        try {
            await db.merge([{ _id: memo._id, title: n, searchText: searchTextOf(n, memo.transcript) }]);
            onClose();
        } catch (e) {
            setError(errorText(e));
            setBusy(false);
        }
    };
    return (
        <Dialog open title="Rename Memo" onClose={onClose} testId="rename-dialog">
            <TextField value={name} onChange={(v) => { setName(v); setError(""); }} onSubmit={submit} autoFocus maxLength={80} testId="rename-field" />
            {error && <ErrorText>{error}</ErrorText>}
            <div className="vm-dialog-buttons">
                <Button variant="affirmative" busy={busy} onClick={submit} data-testid="rename-ok">Rename</Button>
                <Button onClick={onClose}>Cancel</Button>
            </div>
        </Dialog>
    );
}

function DeleteDialog({ memo, onConfirm, onClose }: { memo: Memo; onConfirm: () => Promise<void>; onClose: () => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    return (
        <Dialog open title={`Delete "${memo.title}"?`} message="The recording and its transcript will be deleted." onClose={onClose} testId="delete-dialog">
            {error && <ErrorText>{error}</ErrorText>}
            <div className="vm-dialog-buttons">
                <Button variant="negative" busy={busy} data-testid="delete-confirm" onClick={async () => {
                    setBusy(true);
                    try { await onConfirm(); onClose(); } catch (e) { setError(errorText(e)); setBusy(false); }
                }}>Delete</Button>
                <Button onClick={onClose}>Cancel</Button>
            </div>
        </Dialog>
    );
}

function PrefsDialog({ prefs, onChange, onClose }: { prefs: Prefs; onChange: (p: Prefs) => void; onClose: () => void }) {
    return (
        <Dialog open title="Preferences" onClose={onClose} testId="prefs-dialog">
            <div className="vm-prefs">
                <Row title="Transcribe automatically">
                    <ToggleButton value={prefs.autoTranscribe} label="Transcribe automatically" testId="pref-auto"
                                  onChange={(v) => onChange({ ...prefs, autoTranscribe: v })} />
                </Row>
                <ListSelector title="Language" value={prefs.language} testId="pref-language"
                              options={LANGUAGES.map((l) => ({ value: l.value, label: l.label }))}
                              onChange={(v) => onChange({ ...prefs, language: v })} />
            </div>
            <Note>On the device, memos are transcribed on the device itself, with whisper.cpp.</Note>
            <div className="vm-dialog-buttons">
                <Button onClick={onClose} data-testid="prefs-done">Done</Button>
            </div>
        </Dialog>
    );
}

// ---- The app -----------------------------------------------------------------------------

function VoiceMemos() {
    const list = useLuna<Memo[]>((cb, err) => db.watch<Memo>({ from: MEMO_KIND, orderBy: "created", desc: true }, cb, err), []);
    const memos = useMemo(() => list.value ?? [], [list.value]);
    const [query, setQuery] = useState("");
    const [openId, setOpenId] = useState<string | null>(null);
    const [recording, setRecording] = useState<{ title: string } | null>(null);
    const [sheet, setSheet] = useState<Sheet>(null);
    const [menu, setMenu] = useState<Menu>(null);
    const [handlers, setHandlers] = useState<MimeHandler[]>([]);
    const [work, setWork] = useState<Record<string, Work>>({});
    const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
    const [seeding, setSeeding] = useState(true);
    const audio = useMemo(() => new Audio(), []);
    const params = useLaunchParams<{ memoId?: string; newMemo?: string }>();
    const memosRef = useRef(memos);
    memosRef.current = memos;

    useEffect(() => { void seedDemoMemos().finally(() => setSeeding(false)); }, []);
    useEffect(() => { void openWith.handlers(MEMO_MIME).then(setHandlers); }, []);
    useEffect(() => () => audio.pause(), [audio]);

    // Just Type: open a memo, or record a new one.
    useEffect(() => {
        if (params.memoId) { setQuery(""); setOpenId(params.memoId); }
        if (typeof params.newMemo === "string") setRecording({ title: params.newMemo.trim() || nextTitle(memosRef.current) });
    }, [params]);
    useEffect(() => {
        if (openId) document.querySelector(`[data-memo-id="${CSS.escape(openId)}"]`)?.scrollIntoView?.({ block: "nearest" });
    }, [openId, memos.length]);

    useBack(() => { setOpenId(null); return true; }, !recording && !!openId);
    useBack(() => { setQuery(""); return true; }, !recording && !openId && !!query);

    const shown = useMemo(() => memos.filter((m) => matches(m, query)), [memos, query]);
    const groups = useMemo(() => byDay(shown), [shown]);

    const setWorkFor = (id: string, w: Work | null) =>
        setWork((all) => { const next = { ...all }; if (w) next[id] = w; else delete next[id]; return next; });

    const transcribe = useCallback(async (memo: Memo) => {
        setWorkFor(memo._id, { progress: { state: "queued", progress: 0 } });
        try {
            let t: MemoTranscript = await transcriber.transcribe(memo.path, prefs.language,
                (p) => setWorkFor(memo._id, { progress: p }));
            // The simulator cannot transcribe a recording; what the browser heard live is the best there is.
            if (t.placeholder && memo.liveText) t = { text: memo.liveText, segments: [], language: prefs.language, engine: "webspeech" };
            const transcript: MemoTranscript = { ...t, placeholder: !!t.placeholder, time: new Date().toISOString() };
            await db.merge([{ _id: memo._id, transcript, searchText: searchTextOf(memo.title, transcript) }]);
            setWorkFor(memo._id, null);
        } catch (e) {
            const le = e as LunaError;
            const text = le.errorCode === TRANSCRIBE_ERRORS.ENGINE_NOT_INSTALLED || le.errorCode === TRANSCRIBE_ERRORS.MODEL_NOT_INSTALLED
                ? errorText(e)
                : "Could not transcribe: " + errorText(e);
            setWorkFor(memo._id, { progress: null, error: text });
        }
    }, [prefs.language]);

    // Save a recording: the WAV file (like the Camera's pictures), the index, the memo.
    const save = async (title: string, recorded: Blob, liveText: string) => {
        let file: { blob: Blob; duration: number };
        try {
            file = await toWav(recorded);
        } catch (e) {
            throw new Error("the recording could not be decoded (" + errorText(e) + ")");
        }
        const now = new Date();
        const path = `${MEMO_DIR}/${memoFileName(now, memos.map((m) => m.path))}`;
        await mediaFiles.write(path, file.blob);
        await mediaIndexer.scan(MEMO_DIR);
        const memo: Omit<Memo, "_id"> = {
            _kind: MEMO_KIND, title, path, duration: file.duration, size: file.blob.size, created: now.toISOString(),
            mimeType: MEMO_MIME, searchText: searchTextOf(title), ...(liveText ? { liveText } : {}),
        };
        const [r] = await db.put([memo]);
        setQuery("");
        setOpenId(r.id);
        if (prefs.autoTranscribe) void transcribe({ ...memo, _id: r.id });
    };

    const remove = async (memo: Memo) => {
        if (openId === memo._id) { audio.pause(); setOpenId(null); }
        await mediaFiles.remove(memo.path).catch((e: LunaError) => { if (!/not found|no such/i.test(e.errorText ?? "")) throw e; });
        await mediaIndexer.forget("storage://" + memo.path).catch(() => {});
        await db.del([memo._id]);
    };

    const shareOptions: Option<string>[] = [
        { label: "Email", value: "email" },
        { label: "Messaging", value: "messaging" },
        ...handlers.filter((h) => h.appId !== "org.webosphoenix.voicememos")
            .map((h) => ({ label: `Open in ${h.title ?? h.appId}`, value: "open:" + h.appId })),
    ];
    const share = (memo: Memo, how: string) => {
        if (how === "email")
            void apps.launch("com.palm.app.email", { attachments: [{ fullPath: memo.path, mimeType: MEMO_MIME }], summary: memo.title });
        else if (how === "messaging")
            void apps.launch("org.webosphoenix.messaging", { attachment: memo.path });
        else if (how.startsWith("open:"))
            void openWith.launch(how.slice(5), memo.path);
    };

    const onAppMenu = (v: string) => { if (v === "prefs") setSheet({ kind: "prefs" }); };

    const empty = !memos.length && !seeding && list.value !== undefined;
    return (
        <div className="vm-app">
            <div className="vm-scroll">
                <div className="vm-page">
                    <PageHeader icon="icon.png" title="Voice Memos">
                        <button type="button" className="vm-menu-button" aria-label="Menu" data-testid="menu"
                                onClick={(e) => setMenu({ kind: "app", anchor: e.currentTarget })}>
                            <Glyph name="menu" size={22} />
                        </button>
                    </PageHeader>
                    <div className="vm-search">
                        <TextField value={query} onChange={setQuery} placeholder="Search memos" testId="search" />
                    </div>
                    {list.value === undefined && <div className="vm-loading"><Spinner large /></div>}
                    {empty && <div className="vm-empty" data-testid="empty">No memos yet. Tap the red button to record one.</div>}
                    {!!memos.length && !shown.length && <div className="vm-empty" data-testid="no-match">No memos match "{query}".</div>}
                    <div data-testid="memo-list">
                        {groups.map((g) => (
                            <div key={g.day}>
                                <Divider caption={g.day} />
                                <div className="vm-list">
                                    {g.memos.map((m) => (
                                        <MemoItem key={m._id} memo={m} open={openId === m._id} query={query} work={work[m._id]} audio={audio}
                                                  onToggle={() => setOpenId(openId === m._id ? null : m._id)}
                                                  onTranscribe={() => void transcribe(m)}
                                                  onShare={(anchor) => setMenu({ kind: "share", anchor, memo: m })}
                                                  onRename={() => setSheet({ kind: "rename", memo: m })}
                                                  onDelete={() => setSheet({ kind: "delete", memo: m })}
                                                  onSeek={(t) => { audio.currentTime = t; void audio.play().catch(() => {}); }} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <Toolbar className="vm-toolbar">
                <ToolSpacer />
                <button type="button" className="vm-record" aria-label="Record" data-testid="record"
                        onClick={() => { audio.pause(); setRecording({ title: nextTitle(memos) }); }}>
                    <span className="vm-record-dot" />
                </button>
                <ToolSpacer />
            </Toolbar>

            {recording && (
                <RecordSheet title={recording.title} language={prefs.language} onClose={() => setRecording(null)}
                             onSaved={(blob, liveText) => save(recording.title, blob, liveText)} />
            )}
            {menu?.kind === "app" && (
                <PopupMenu options={[{ label: "Preferences", value: "prefs" }]} anchor={menu.anchor} onSelect={onAppMenu} onClose={() => setMenu(null)} />
            )}
            {menu?.kind === "share" && menu.memo && (
                <PopupMenu options={shareOptions} anchor={menu.anchor} onSelect={(v) => share(menu.memo!, v)} onClose={() => setMenu(null)} />
            )}
            {sheet?.kind === "rename" && <RenameDialog memo={sheet.memo} onClose={() => setSheet(null)} />}
            {sheet?.kind === "delete" && (
                <DeleteDialog memo={sheet.memo} onConfirm={() => remove(sheet.memo)} onClose={() => setSheet(null)} />
            )}
            {sheet?.kind === "prefs" && (
                <PrefsDialog prefs={prefs} onClose={() => setSheet(null)} onChange={(p) => { setPrefs(p); savePrefs(p); }} />
            )}
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <VoiceMemos />
        </BackProvider>
    );
}
