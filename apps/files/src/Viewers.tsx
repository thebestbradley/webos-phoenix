// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The built-in viewers: a black full-card image viewer (swipe or the arrow
// keys for the folder's other pictures, tap for the title and command
// menu) and a text editor that saves back with the file manager service.

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { fileManager, fileUrl, formatSize, looksLikeText, TEXT_EDIT_LIMIT, type FileEntry } from "@phoenix/luna";
import { Button, Dialog, IconToolButton, PageHeader, Spinner, Toolbar, ToolSpacer, useBack } from "@phoenix/ui";

function useFileUrl(path: string): string | undefined {
    const [url, setUrl] = useState<{ path: string; url: string }>();
    useEffect(() => {
        let live = true;
        fileUrl(path).then((u) => { if (live) setUrl({ path, url: u }); }, () => {});
        return () => { live = false; };
    }, [path]);
    return url?.path === path ? url.url : undefined;
}

// ---- Image viewer ---------------------------------------------------------------

export function ImageViewer({ images, start, onClose }: { images: FileEntry[]; start: number; onClose: () => void }) {
    const [index, setIndex] = useState(start);
    const [chrome, setChrome] = useState(true);
    const [broken, setBroken] = useState(false);
    const drag = useRef<{ x: number; moved: boolean } | null>(null);
    const [dx, setDx] = useState(0);
    const cur = images[index];
    const url = useFileUrl(cur.path);

    useBack(() => { onClose(); return true; });
    useEffect(() => setBroken(false), [index]);
    const go = (d: number) => setIndex((i) => Math.max(0, Math.min(images.length - 1, i + d)));
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") go(1);
            else if (e.key === "ArrowLeft") go(-1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [images.length]);

    const down = (e: PointerEvent) => { drag.current = { x: e.clientX, moved: false }; };
    const move = (e: PointerEvent) => {
        if (!drag.current) return;
        const d = e.clientX - drag.current.x;
        if (Math.abs(d) > 8) drag.current.moved = true;
        setDx(d);
    };
    const up = () => {
        const d = drag.current;
        drag.current = null;
        setDx(0);
        if (!d) return;
        if (!d.moved) setChrome((c) => !c);
        else if (dx < -60) go(1);
        else if (dx > 60) go(-1);
    };

    return (
        <div className="fm-viewer" data-testid="image-viewer">
            <div className="fm-viewer-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                {!url && <Spinner large />}
                {url && !broken && (
                    <img className="fm-viewer-image" src={url} alt={cur.name} draggable={false} data-testid="viewer-image"
                         style={{ transform: dx ? `translateX(${dx}px)` : undefined }} onError={() => setBroken(true)} />
                )}
                {broken && <div className="fm-viewer-broken">This picture cannot be shown.</div>}
            </div>
            {chrome && (
                <>
                    <div className="fm-viewer-top">
                        <div className="fm-viewer-title" data-testid="viewer-title">{cur.name}</div>
                        <div className="fm-viewer-sub" data-testid="viewer-index">{index + 1} of {images.length} · {formatSize(cur.size)}</div>
                    </div>
                    <Toolbar kind="dark">
                        <IconToolButton icon="close" label="Close" testId="viewer-close" onClick={onClose} />
                        <ToolSpacer />
                        <IconToolButton icon="prev" label="Previous" testId="viewer-prev" disabled={index === 0} onClick={() => go(-1)} />
                        <IconToolButton icon="next" label="Next" testId="viewer-next" disabled={index === images.length - 1} onClick={() => go(1)} />
                    </Toolbar>
                </>
            )}
        </div>
    );
}

// ---- Text editor ------------------------------------------------------------------

export function TextEditor({ entry, onClose, onSaved }: { entry: FileEntry; onClose: () => void; onSaved: () => void }) {
    const [text, setText] = useState<string | null>(null);
    const [saved, setSaved] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [asking, setAsking] = useState(false);
    const [note, setNote] = useState("");
    const dirty = text !== null && text !== saved;
    const readOnly = !!entry.readOnly;

    useEffect(() => {
        let live = true;
        fileManager.readText(entry.path, TEXT_EDIT_LIMIT).then((t) => {
            if (!live) return;
            if (!looksLikeText(t)) { setError("This file is not text."); return; }
            setText(t);
            setSaved(t);
        }, (e) => { if (live) setError(e.errorText ?? String(e)); });
        return () => { live = false; };
    }, [entry.path]);

    const save = async () => {
        if (text === null || readOnly) return false;
        setBusy(true);
        try {
            await fileManager.writeText(entry.path, text);
            setSaved(text);
            setNote("Saved");
            setTimeout(() => setNote(""), 1800);
            onSaved();
            return true;
        } catch (e) {
            setError((e as { errorText?: string }).errorText ?? String(e));
            return false;
        } finally {
            setBusy(false);
        }
    };
    const close = () => { if (dirty) setAsking(true); else onClose(); };
    useBack(() => { close(); return true; });

    return (
        <div className="fm-editor" data-testid="text-editor">
            <PageHeader icon="icon.png" title={
                <span data-testid="editor-title">{entry.name}{dirty && <span className="fm-dirty" aria-label="unsaved"> *</span>}</span>
            }>
                {readOnly && <span className="fm-badge">Read-only</span>}
            </PageHeader>
            {error && <div className="fm-editor-error" role="alert">{error}</div>}
            {text === null && !error && <div className="fm-loading"><Spinner large /></div>}
            {text !== null && (
                <textarea className="fm-editor-text" value={text} readOnly={readOnly} spellCheck={false} data-testid="editor-text"
                          onChange={(e) => setText(e.target.value)}
                          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); } }} />
            )}
            {note && <div className="fm-toast" data-testid="toast">{note}</div>}
            <Toolbar kind="dark">
                <IconToolButton icon="close" label="Close" testId="editor-close" onClick={close} />
                <ToolSpacer />
                <span className="fm-editor-size">{text !== null ? formatSize(new TextEncoder().encode(text).length) : ""}</span>
                <ToolSpacer />
                <IconToolButton icon="save" caption="Save" testId="editor-save" disabled={!dirty || readOnly || busy} onClick={save} />
            </Toolbar>
            <Dialog open={asking} title="Save changes?" message={`${entry.name} has changes that are not saved.`} onClose={() => setAsking(false)}
                    testId="discard-dialog">
                <div className="fm-dialog-buttons">
                    <Button variant="affirmative" data-testid="discard-save" onClick={async () => { setAsking(false); if (await save()) onClose(); }}>Save</Button>
                    <Button variant="negative" data-testid="discard-confirm" onClick={() => { setAsking(false); onClose(); }}>Discard</Button>
                    <Button onClick={() => setAsking(false)}>Cancel</Button>
                </div>
            </Dialog>
        </div>
    );
}
