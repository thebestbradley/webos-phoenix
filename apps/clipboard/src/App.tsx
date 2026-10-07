// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Clipboard (org.webosphoenix.clipboard, docs/M6-PLAN.md F2): the clipboard
// history every app's copies go to, as Paste keeps it on macOS, in the
// webOS 2.x Heritage style. Recent, Pinned and the user's categories as
// tabs; search; a clip opens to its whole text, link or picture, where it
// can be copied again, pinned, moved to a category, edited (text) or
// deleted. Categories are added, renamed, reordered and deleted from the
// app menu. The same history shows in the keyboard's clip strip.
//
// A sensitive clip (a password, a one-time code, an Authenticator link or
// key) stays masked until the device passcode is given (the service checks
// it: org.webosphoenix.clipboard/reveal); revealed, it can go to Passwords
// ("Save to Passwords": a new entry, filled in, after Passwords is
// unlocked) or the Authenticator ("Add to Authenticator": its usual
// confirmation). The screen locking hides it again. See
// docs/SECURITY-APPS.md "Clipboard history".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    apps, clipboard, clipDestination, clipMask, deviceLock, type Clip, type ClipboardHistory, type ClipCategory,
} from "@phoenix/luna";
import {
    AppMenu, BackProvider, Button, cx, Dialog, ErrorText, Group, ListSelector, Note, Page, PageHeader, Row, TextField, ToggleButton,
    useBack, type Option,
} from "@phoenix/ui";
import { secretClipboard } from "@phoenix/secrets";

const errorText = (e: unknown) => (e as { errorText?: string }).errorText ?? (e instanceof Error ? e.message : String(e));

const KIND_NAMES: Record<string, string> = {
    password: "Password", otp: "One-time code", otpauth: "Authenticator link", totp: "Authenticator key", secret: "Secret",
};

/** The app a clip came from, by its title when it is installed. */
function useAppTitles(): (id: string) => string {
    const [titles, setTitles] = useState<Record<string, string>>({});
    useEffect(() => {
        let live = true;
        apps.list().then((list) => {
            if (!live) return;
            const t: Record<string, string> = {};
            for (const a of list) t[a.id] = a.title;
            setTitles(t);
        }).catch(() => { /* ids then */ });
        return () => { live = false; };
    }, []);
    return useCallback((id: string) => {
        if (titles[id]) return titles[id];
        if (id === "com.palm.systemui") return "System";
        const last = (id || "").split(".").pop() || "";
        return last ? last.charAt(0).toUpperCase() + last.slice(1) : "Unknown app";
    }, [titles]);
}

function age(time: number, now = Date.now()): string {
    const s = Math.max(0, Math.round((now - time) / 1000));
    if (s < 60) return "Just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    const days = Math.floor(s / 86400);
    return days === 1 ? "Yesterday" : `${days} days ago`;
}

function preview(c: Clip): string {
    if (c.sensitive) return clipMask(c);
    if (c.type === "image") return c.title || "Picture";
    if (c.type === "link") return c.title || c.text || "";
    return (c.text || "").replace(/\s+/g, " ").trim();
}

// ---- The passcode, for a sensitive clip ------------------------------------------------

function RevealDialog({ clip, onRevealed, onClose }: { clip: Clip; onRevealed: (text: string) => void; onClose: () => void }) {
    const [code, setCode] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        setBusy(true);
        try {
            onRevealed(await clipboard.reveal(clip.id, code));
        } catch (e) {
            setError((e as { errorCode?: number }).errorCode === -5 ? "That is not the device passcode." : errorText(e));
            setCode("");
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open title="Device Passcode" onClose={onClose} testId="reveal-dialog"
                message={`Enter the device passcode to see this ${(KIND_NAMES[clip.kind || "secret"] || "secret").toLowerCase()}.`}>
            <TextField value={code} onChange={(v) => { setCode(v); setError(""); }} onSubmit={() => void submit()} type="password"
                       placeholder="Passcode" autoFocus testId="reveal-passcode" />
            {error && <ErrorText testId="reveal-error">{error}</ErrorText>}
            <Button variant="affirmative" busy={busy} onClick={() => void submit()} data-testid="reveal-ok">Show</Button>
            <Button onClick={onClose}>Cancel</Button>
        </Dialog>
    );
}

// ---- One clip ---------------------------------------------------------------------------

function ClipDetail({ clip, categories, appTitle, revealed, onReveal, onClose, onToast }: {
    clip: Clip; categories: ClipCategory[]; appTitle: (id: string) => string; revealed: string | null;
    onReveal: (afterwards?: (text: string) => void) => void; onClose: () => void; onToast: (t: string) => void;
}) {
    const [editing, setEditing] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [error, setError] = useState("");
    useBack(() => {
        if (editing !== null) setEditing(null);
        else onClose();
        return true;
    });
    const destination = clipDestination(clip);
    const run = async (what: () => Promise<unknown>) => {
        setError("");
        try { await what(); } catch (e) { setError(errorText(e)); }
    };

    const copy = async () => {
        if (clip.sensitive) {
            if (revealed === null) return onReveal((t) => void copySecret(t));
            return copySecret(revealed);
        }
        if (clip.type === "image" && clip.image) {
            const blob = await (await fetch(clip.image)).blob();
            const C = (globalThis as { ClipboardItem?: new (items: Record<string, Blob>) => unknown }).ClipboardItem;
            if (C) await navigator.clipboard.write([new C({ [blob.type || "image/png"]: blob }) as ClipboardItem]);
        } else {
            await navigator.clipboard.writeText(clip.text || "");
        }
        onToast("Copied");
    };
    // A secret goes back on the clipboard as Passwords copies one: cleared after 30 s.
    const copySecret = async (text: string) => {
        const ok = await secretClipboard.copy(text, 30);
        onToast(ok ? "Copied; the clipboard clears in 30 seconds" : "The clipboard is not available.");
    };
    // Save to Passwords: a new entry with this password; Add to Authenticator:
    // the link (or key) for its confirmation.
    const send = (text: string) => {
        if (destination === "passwords") {
            void apps.launch("org.webosphoenix.passwords", { newEntry: { password: text } });
        } else if (destination === "authenticator") {
            const otpauth = clip.kind === "otpauth" ? text
                : `otpauth://totp/${encodeURIComponent("Imported key")}?secret=${encodeURIComponent(text.replace(/\s+/g, "").toUpperCase())}`;
            void apps.launch("org.webosphoenix.authenticator", { otpauth });
        }
    };

    const catOptions: Option<string>[] = [{ label: "None", value: "" }, ...categories.map((c) => ({ label: c.name, value: c.id }))];

    return (
        <Page className="cb-detail">
            <PageHeader title={clip.sensitive ? KIND_NAMES[clip.kind || "secret"] : clip.type === "link" ? "Link" : clip.type === "image" ? "Picture" : "Text"} icon="icon.png" />
            <div className="cb-detail-meta" data-testid="detail-meta">{appTitle(clip.source)} · {age(clip.time)}</div>
            <div className={cx("cb-detail-body", clip.sensitive && "secret")} data-testid="detail-body">
                {clip.sensitive ? (
                    revealed !== null
                        ? <div className="cb-secret-text" data-testid="detail-revealed">{revealed}</div>
                        : <div className="cb-mask" data-testid="detail-mask">{clipMask(clip)}</div>
                ) : clip.type === "image" ? (
                    <img className="cb-detail-image" src={clip.image} alt={clip.title || ""} />
                ) : editing !== null ? (
                    <textarea className="cb-edit" value={editing} onChange={(e) => setEditing(e.target.value)} autoFocus data-testid="edit-text" />
                ) : (
                    <>
                        {clip.type === "link" && clip.title && <div className="cb-link-title">{clip.title}</div>}
                        <div className={cx("cb-detail-text", clip.type === "link" && "link")} data-testid="detail-text">{clip.text}</div>
                    </>
                )}
            </div>
            {error && <ErrorText testId="detail-error">{error}</ErrorText>}
            <div className="cb-actions">
                {editing !== null ? (
                    <>
                        <Button variant="affirmative" data-testid="edit-save" disabled={!editing.trim()}
                                onClick={() => void run(async () => { await clipboard.update(clip.id, editing); setEditing(null); })}>Save</Button>
                        <Button onClick={() => setEditing(null)}>Cancel</Button>
                    </>
                ) : (
                    <>
                        {clip.sensitive && revealed === null && <Button variant="affirmative" data-testid="detail-reveal" onClick={() => onReveal()}>Show</Button>}
                        <Button data-testid="detail-copy" onClick={() => void run(copy)}>Copy</Button>
                        {destination && (
                            <Button variant="affirmative" data-testid="detail-send"
                                    onClick={() => revealed !== null ? send(revealed) : onReveal(send)}>
                                {destination === "passwords" ? "Save to Passwords" : "Add to Authenticator"}
                            </Button>
                        )}
                        {clip.type === "link" && clip.text && (
                            <Button data-testid="detail-open" onClick={() => void apps.open(clip.text!)}>Open in Browser</Button>
                        )}
                        {!clip.sensitive && clip.type !== "image" && (
                            <Button data-testid="detail-edit" onClick={() => setEditing(clip.text || "")}>Edit</Button>
                        )}
                    </>
                )}
            </div>
            {editing === null && (
                <Group>
                    <Row title="Pinned" testId="detail-pin">
                        <ToggleButton value={clip.pinned} label="Pinned" testId="detail-pin-toggle"
                                      onChange={(v) => void run(() => clipboard.setPinned(clip.id, v))} />
                    </Row>
                    <ListSelector title="Category" value={clip.category} options={catOptions} testId="detail-category"
                                  onChange={(v) => void run(() => clipboard.setCategory(clip.id, v))} />
                </Group>
            )}
            {editing === null && <Button variant="negative" data-testid="detail-delete" onClick={() => setConfirmDelete(true)}>Delete</Button>}
            <Dialog open={confirmDelete} title="Delete this clip?" onClose={() => setConfirmDelete(false)} testId="delete-dialog">
                <Button variant="negative" data-testid="delete-ok" onClick={() => void run(async () => { await clipboard.remove(clip.id); onClose(); })}>Delete</Button>
                <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </Dialog>
        </Page>
    );
}

// ---- Categories -------------------------------------------------------------------------

function NameDialog({ title, initial, onSubmit, onClose }: { title: string; initial: string; onSubmit: (name: string) => Promise<void>; onClose: () => void }) {
    const [name, setName] = useState(initial);
    const [error, setError] = useState("");
    const submit = async () => {
        if (!name.trim()) return setError("Give it a name.");
        try { await onSubmit(name.trim()); onClose(); } catch (e) { setError(errorText(e)); }
    };
    return (
        <Dialog open title={title} onClose={onClose} testId="name-dialog">
            <TextField value={name} onChange={(v) => { setName(v); setError(""); }} onSubmit={() => void submit()} maxLength={40} autoFocus testId="name-field" />
            {error && <ErrorText>{error}</ErrorText>}
            <Button variant="affirmative" data-testid="name-ok" onClick={() => void submit()}>Done</Button>
            <Button onClick={onClose}>Cancel</Button>
        </Dialog>
    );
}

function Categories({ categories, onClose }: { categories: ClipCategory[]; onClose: () => void }) {
    const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "rename" | "delete"; cat: ClipCategory } | null>(null);
    const [error, setError] = useState("");
    useBack(() => { onClose(); return true; });
    const move = (i: number, by: number) => {
        const ids = categories.map((c) => c.id);
        const j = i + by;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        clipboard.reorderCategories(ids).catch((e) => setError(errorText(e)));
    };
    return (
        <Page className="cb-categories">
            <PageHeader title="Categories" icon="icon.png" />
            <Note>Saved clips stay until you delete them: they neither expire nor count against the history's size.</Note>
            <Group>
                {categories.length === 0 && <Row title={<span className="cb-empty-row">No categories yet</span>} />}
                {categories.map((c, i) => (
                    <Row key={c.id} title={c.name} testId={`category-${c.name}`}>
                        <button type="button" className="cb-small" aria-label="Move up" disabled={i === 0} data-testid={`category-up-${c.name}`} onClick={() => move(i, -1)}>▲</button>
                        <button type="button" className="cb-small" aria-label="Move down" disabled={i === categories.length - 1} data-testid={`category-down-${c.name}`} onClick={() => move(i, 1)}>▼</button>
                        <button type="button" className="cb-small" data-testid={`category-rename-${c.name}`} onClick={() => setDialog({ kind: "rename", cat: c })}>Rename</button>
                        <button type="button" className="cb-small" data-testid={`category-delete-${c.name}`} onClick={() => setDialog({ kind: "delete", cat: c })}>Delete</button>
                    </Row>
                ))}
            </Group>
            {error && <ErrorText>{error}</ErrorText>}
            <Button data-testid="category-new" onClick={() => setDialog({ kind: "new" })}>New Category</Button>
            {dialog?.kind === "new" && <NameDialog title="New Category" initial="" onClose={() => setDialog(null)}
                                                   onSubmit={async (n) => { await clipboard.addCategory(n); }} />}
            {dialog?.kind === "rename" && <NameDialog title="Rename Category" initial={dialog.cat.name} onClose={() => setDialog(null)}
                                                      onSubmit={async (n) => { await clipboard.renameCategory(dialog.cat.id, n); }} />}
            {dialog?.kind === "delete" && (
                <Dialog open title={`Delete “${dialog.cat.name}”?`} message="Its clips stay in the history, in no category." onClose={() => setDialog(null)} testId="category-delete-dialog">
                    <Button variant="negative" data-testid="category-delete-ok"
                            onClick={() => { clipboard.deleteCategory(dialog.cat.id).catch((e) => setError(errorText(e))); setDialog(null); }}>Delete</Button>
                    <Button onClick={() => setDialog(null)}>Cancel</Button>
                </Dialog>
            )}
        </Page>
    );
}

// ---- The list ---------------------------------------------------------------------------

type View = { kind: "list" } | { kind: "clip"; id: string } | { kind: "categories" };

function ClipboardApp() {
    const [tab, setTab] = useState("recent");
    const [query, setQuery] = useState("");
    const [history, setHistory] = useState<ClipboardHistory | null>(null);
    const [error, setError] = useState("");
    const [view, setView] = useState<View>({ kind: "list" });
    const [revealed, setRevealed] = useState<Record<string, string>>({});
    const [revealing, setRevealing] = useState<{ clip: Clip; then?: (text: string) => void } | null>(null);
    const [confirmClear, setConfirmClear] = useState(false);
    const [toast, setToast] = useState("");
    const appTitle = useAppTitles();
    const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const showToast = useCallback((t: string) => {
        setToast(t);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 2500);
    }, []);

    // Every clip (the tabs, search and the detail filter it here), kept up
    // to date from any app's copies.
    useEffect(() => {
        const sub = clipboard.watch({}, setHistory, (e) => setError(errorText(e)));
        return () => sub.cancel();
    }, []);
    // The screen locks: secrets are hidden again.
    useEffect(() => {
        const sub = deviceLock.watchLocked((locked) => {
            if (locked) { setRevealed({}); setRevealing(null); }
        });
        return () => sub.cancel();
    }, []);

    const categories = history?.categories ?? [];
    useEffect(() => {
        if (tab !== "recent" && tab !== "pinned" && !categories.some((c) => c.id === tab)) setTab("recent");
    }, [categories, tab]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (history?.clips ?? []).filter((c) => {
            if (tab === "pinned" && !c.pinned) return false;
            if (tab !== "recent" && tab !== "pinned" && c.category !== tab) return false;
            if (!q) return true;
            if (c.sensitive) return false;
            return [c.text, c.title, appTitle(c.source)].some((s) => (s || "").toLowerCase().includes(q));
        });
    }, [history, tab, query, appTitle]);

    const reveal = (clip: Clip, then?: (text: string) => void) => {
        if (revealed[clip.id] !== undefined) return then?.(revealed[clip.id]);
        setRevealing({ clip, then });
    };

    useBack(() => {
        if (query) { setQuery(""); return true; }
        return false;
    }, view.kind === "list");

    const current = view.kind === "clip" ? history?.clips.find((c) => c.id === view.id) : undefined;
    // The clip went away (deleted here or elsewhere, or expired).
    useEffect(() => {
        if (view.kind === "clip" && history && !current) setView({ kind: "list" });
    }, [view, history, current]);

    const menu = [
        { label: "Categories", onSelect: () => setView({ kind: "categories" }) },
        { label: "Clear History", onSelect: () => setConfirmClear(true) },
        { label: "Preferences", onSelect: () => void apps.launch("org.webosphoenix.settings", { page: "clipboard" }) },
    ];

    let body;
    if (view.kind === "categories") {
        body = <Categories categories={categories} onClose={() => setView({ kind: "list" })} />;
    } else if (view.kind === "clip" && current) {
        body = <ClipDetail key={current.id} clip={current} categories={categories} appTitle={appTitle} revealed={revealed[current.id] ?? null}
                           onReveal={(then) => reveal(current, then)} onClose={() => setView({ kind: "list" })} onToast={showToast} />;
    } else {
        const tabs = [{ id: "recent", name: "Recent" }, { id: "pinned", name: "Pinned" }, ...categories];
        const off = history && !history.settings.enabled;
        body = (
            <Page className="cb-list">
                <PageHeader title="Clipboard" icon="icon.png" />
                <div className="cb-search">
                    <TextField value={query} onChange={setQuery} placeholder="Search clips" testId="search" />
                </div>
                <div className="cb-tabs" role="tablist" data-testid="tabs">
                    {tabs.map((t) => (
                        <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={cx("cb-tab", tab === t.id && "selected")}
                                data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)}>{t.name}</button>
                    ))}
                </div>
                {off && <Note testId="off-note">The clipboard history is off: new copies are not kept. Turn it on in Settings › Clipboard.</Note>}
                {error && <ErrorText>{error}</ErrorText>}
                {history && shown.length === 0 && (
                    <div className="cb-empty" data-testid="empty">
                        {query ? "No clips match." : tab === "recent" ? "What you copy in any app shows up here."
                            : tab === "pinned" ? "Pin a clip to keep it here." : "Move a clip here from its page."}
                    </div>
                )}
                {shown.length > 0 && (
                    <Group>
                        {shown.map((c) => (
                            <Row key={c.id} className={cx("cb-clip-row", c.sensitive && "secret")} testId={`clip-${c.id}`} onClick={() => setView({ kind: "clip", id: c.id })}
                                 icon={c.type === "image" && c.image ? <img className="cb-thumb" src={c.image} alt="" />
                                     : <span className={cx("cb-type", c.sensitive ? "secret" : c.type)} aria-hidden="true" />}
                                 title={<span className="cb-clip-title" data-testid="clip-title">{preview(c)}</span>}
                                 subtitle={<>{c.sensitive && <span className="cb-kind">{KIND_NAMES[c.kind || "secret"]} · </span>}{appTitle(c.source)} · {age(c.time)}
                                     {c.category && <> · {categories.find((x) => x.id === c.category)?.name}</>}</>}>
                                {c.pinned && <span className="cb-pin" title="Pinned" data-testid="clip-pinned" />}
                            </Row>
                        ))}
                    </Group>
                )}
            </Page>
        );
    }

    return (
        <>
            <AppMenu items={menu} />
            {body}
            {revealing && (
                <RevealDialog clip={revealing.clip} onClose={() => setRevealing(null)} onRevealed={(text) => {
                    setRevealed((r) => ({ ...r, [revealing.clip.id]: text }));
                    const then = revealing.then;
                    setRevealing(null);
                    then?.(text);
                }} />
            )}
            <Dialog open={confirmClear} title="Clear the history?" message="Every clip goes, except pinned clips and clips in a category."
                    onClose={() => setConfirmClear(false)} testId="clear-dialog">
                <Button variant="negative" data-testid="clear-ok" onClick={() => {
                    setConfirmClear(false);
                    clipboard.clear().then((n) => showToast(n === 1 ? "1 clip cleared" : `${n} clips cleared`), (e) => setError(errorText(e)));
                }}>Clear History</Button>
                <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
            </Dialog>
            {toast && <div className="cb-toast" role="status" data-testid="toast">{toast}</div>}
        </>
    );
}

export function App() {
    return (
        <BackProvider>
            <ClipboardApp />
        </BackProvider>
    );
}
