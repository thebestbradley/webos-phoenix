// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The preview a screen capture's notification opens ({path}; without one,
// the newest capture): the picture, and
//   Crop     drag the corners (or the middle) of a frame; Reset, Done
//   Markup   draw with a pen in six colours; Undo
//   Share    Email (attachments: [{fullPath, mimeType}]) or Messaging
//            ({attachment}), as Photos shares
//   Delete   the file and its index entry, after asking
//   Save     once edited: the edits written over the capture (Revert
//            drops them); Done otherwise
// Edits are kept as data (editor.ts) and drawn at the picture's own size
// when saved. docs/SCREENSHOTS.md SC2.
//
// Services: org.webosphoenix.service.mediafiles write / remove;
// com.webos.service.mediaindexer getImageList, requestMediaScan,
// requestDelete.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { apps, mediaFiles, mediaIndexer, MEDIA_ROOT } from "@phoenix/luna";
import { useLaunchParams, useMediaUrl } from "@phoenix/luna/react";
import { BackProvider, Button, Dialog, IconToolButton, PopupMenu, Toolbar, ToolSpacer, useBack } from "@phoenix/ui";
import {
    dragCrop, drawStrokes, fit, isEdited, noEdits, normalizeCrop, PEN_COLORS, penWidth, visibleRect,
    type Edits, type Handle, type Point, type Rect, type Size,
} from "./editor";

export const CAPTURE_DIR = MEDIA_ROOT + "/screencaptures";
type Mode = "view" | "crop" | "markup";

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("could not load " + src));
        img.src = src;
    });
}

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.png$/i, "");

export function App() {
    return (
        <BackProvider>
            <Preview />
        </BackProvider>
    );
}

function Preview() {
    const params = useLaunchParams<{ path?: string }>();
    const [path, setPath] = useState<string | null | undefined>(params.path);
    // Without a path: the newest capture.
    useEffect(() => {
        if (params.path) { setPath(params.path); return; }
        mediaIndexer.images().then((list) => {
            const caps = list.filter((i) => i.file_path.startsWith(CAPTURE_DIR + "/"))
                .sort((a, b) => String(b.last_modified_date).localeCompare(String(a.last_modified_date)));
            setPath(caps[0]?.file_path ?? null);
        }, () => setPath(null));
    }, [params.path]);

    if (path === undefined) return <div className="sc-app" />;
    if (path === null) {
        return (
            <div className="sc-app" data-testid="no-captures">
                <div className="sc-top">
                    <div className="sc-title">Screen Captures</div>
                    <button type="button" className="sc-top-button primary" onClick={() => window.close()}>Done</button>
                </div>
                <div className="sc-empty">
                    <img src="icon-256x256.png" width={96} height={96} alt="" />
                    <h2>No screen captures yet</h2>
                    <p>Press Home and Power together to capture the screen.</p>
                    <p>With a keyboard: Print Screen, or Ctrl+Alt+P.</p>
                    <p>Captures are kept in Photos, in Screen Captures.</p>
                </div>
            </div>
        );
    }
    return <Editor key={path} path={path} />;
}

function Editor({ path }: { path: string }) {
    const url = useMediaUrl(path);
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [failed, setFailed] = useState(false);
    const [edits, setEdits] = useState<Edits>(noEdits);
    const [mode, setMode] = useState<Mode>("view");
    const [draftCrop, setDraftCrop] = useState<Rect | null>(null);
    const [color, setColor] = useState(PEN_COLORS[0]);
    const [sharing, setSharing] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [busy, setBusy] = useState(false);
    const [toast, setToast] = useState("");
    const shareButton = useRef<HTMLDivElement>(null);
    const stage = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const [box, setBox] = useState<Size>({ width: 0, height: 0 });

    useEffect(() => {
        if (url) loadImage(url).then(setImage, () => setFailed(true));
    }, [url]);
    useEffect(() => {
        const el = stage.current;
        if (!el) return;
        const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(""), 2500);
        return () => clearTimeout(t);
    }, [toast]);

    const size: Size = image ? { width: image.naturalWidth, height: image.naturalHeight } : { width: 0, height: 0 };
    // Cropping shows the whole picture with the frame on it.
    const shown: Rect = mode === "crop" ? { x: 0, y: 0, ...size } : visibleRect(edits, size);
    const view = fit(shown, box);

    // Draw the picture and the strokes at the screen's size.
    useEffect(() => {
        const c = canvas.current;
        if (!c || !image) return;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(shown.width * view.scale)), h = Math.max(1, Math.round(shown.height * view.scale));
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        c.style.width = w + "px";
        c.style.height = h + "px";
        c.style.left = view.x + "px";
        c.style.top = view.y + "px";
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.scale(view.scale * dpr, view.scale * dpr);
        ctx.translate(-shown.x, -shown.y);
        ctx.drawImage(image, 0, 0);
        drawStrokes(ctx, edits.strokes);
    }, [image, edits, shown.x, shown.y, shown.width, shown.height, view.scale, view.x, view.y]);

    // Screen point -> picture pixels.
    const toImage = useCallback((e: { clientX: number; clientY: number }): Point => {
        const r = stage.current!.getBoundingClientRect();
        return { x: shown.x + (e.clientX - r.left - view.x) / view.scale, y: shown.y + (e.clientY - r.top - view.y) / view.scale };
    }, [shown.x, shown.y, view.x, view.y, view.scale]);

    // ---- Markup ----
    const drawing = useRef<number | null>(null);
    const penDown = (e: ReactPointerEvent) => {
        if (mode !== "markup" || !image) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drawing.current = e.pointerId;
        const p = toImage(e);
        setEdits((ed) => ({ ...ed, strokes: [...ed.strokes, { color, width: penWidth(size), points: [p] }] }));
    };
    const penMove = (e: ReactPointerEvent) => {
        if (drawing.current !== e.pointerId) return;
        const p = toImage(e);
        setEdits((ed) => {
            const strokes = ed.strokes.slice();
            const last = strokes[strokes.length - 1];
            strokes[strokes.length - 1] = { ...last, points: [...last.points, p] };
            return { ...ed, strokes };
        });
    };
    const penUp = (e: ReactPointerEvent) => { if (drawing.current === e.pointerId) drawing.current = null; };
    const undo = () => setEdits((ed) => ({ ...ed, strokes: ed.strokes.slice(0, -1) }));

    // ---- Crop ----
    const startCrop = () => { setDraftCrop(edits.crop ?? { x: 0, y: 0, ...size }); setMode("crop"); };
    const finishCrop = () => { setEdits((ed) => ({ ...ed, crop: normalizeCrop(draftCrop, size) })); setMode("view"); };
    const cropDrag = useRef<{ handle: Handle; last: Point; id: number } | null>(null);
    const handleDown = (handle: Handle) => (e: ReactPointerEvent) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        cropDrag.current = { handle, last: toImage(e), id: e.pointerId };
    };
    const handleMove = (e: ReactPointerEvent) => {
        const d = cropDrag.current;
        if (!d || d.id !== e.pointerId || !draftCrop) return;
        const p = toImage(e);
        setDraftCrop(dragCrop(draftCrop, d.handle, p.x - d.last.x, p.y - d.last.y, size));
        d.last = p;
    };
    const handleUp = () => { cropDrag.current = null; };

    useBack(() => {
        if (sharing) setSharing(false);
        else if (mode === "crop") setMode("view");
        else if (mode === "markup") setMode("view");
        else return false;
        return true;
    });

    // ---- Save, share, delete ----
    const render = (): Promise<Blob> => new Promise((resolve, reject) => {
        if (!image) return reject(new Error("no picture"));
        const r = visibleRect(edits, size);
        const out = document.createElement("canvas");
        out.width = r.width;
        out.height = r.height;
        const ctx = out.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        ctx.translate(-r.x, -r.y);
        ctx.drawImage(image, 0, 0);
        drawStrokes(ctx, edits.strokes);
        out.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode"))), "image/png");
    });
    const save = async (): Promise<boolean> => {
        if (!isEdited(edits)) return true;
        setBusy(true);
        try {
            const blob = await render();
            await mediaFiles.write(path, blob);
            await mediaIndexer.scan(CAPTURE_DIR);
            // The saved picture is the new original.
            setImage(await loadImage(URL.createObjectURL(blob)));
            setEdits(noEdits());
            setToast("Saved");
            return true;
        } catch {
            setToast("Could not save");
            return false;
        } finally {
            setBusy(false);
        }
    };
    const share = async (target: string) => {
        setSharing(false);
        if (!(await save())) return;
        if (target === "email")
            void apps.launch("com.palm.app.email", { attachments: [{ fullPath: path, mimeType: "image/png" }] });
        else
            void apps.launch("org.webosphoenix.messaging", { attachment: path });
    };
    const remove = async () => {
        setConfirmDelete(false);
        try {
            await mediaFiles.remove(path);
            await mediaIndexer.forget("storage://" + path).catch(() => {});
            window.close();
        } catch {
            setToast("Could not delete");
        }
    };

    if (failed) return <div className="sc-app sc-empty" data-testid="missing">This screen capture is no longer on the device.</div>;
    const edited = isEdited(edits);
    const frame = draftCrop && mode === "crop" ? {
        left: view.x + (draftCrop.x - shown.x) * view.scale, top: view.y + (draftCrop.y - shown.y) * view.scale,
        width: draftCrop.width * view.scale, height: draftCrop.height * view.scale,
    } : null;

    return (
        <div className="sc-app" data-testid="preview" data-image-width={size.width} data-image-height={size.height}>
            <div className="sc-top">
                <div className="sc-title" data-testid="title">{nameOf(path)}</div>
                {mode === "view" && (edited ? (
                    <>
                        <button type="button" className="sc-top-button" data-testid="revert" onClick={() => setEdits(noEdits())}>Revert</button>
                        <button type="button" className="sc-top-button primary" data-testid="save" disabled={busy} onClick={() => void save()}>Save</button>
                    </>
                ) : (
                    <button type="button" className="sc-top-button primary" data-testid="done" onClick={() => window.close()}>Done</button>
                ))}
                {mode !== "view" && (
                    <button type="button" className="sc-top-button primary" data-testid="mode-done"
                            onClick={() => (mode === "crop" ? finishCrop() : setMode("view"))}>Done</button>
                )}
            </div>

            <div className="sc-stage" ref={stage} data-testid="stage"
                 onPointerDown={penDown} onPointerMove={(e) => { penMove(e); handleMove(e); }}
                 onPointerUp={(e) => { penUp(e); handleUp(); }} onPointerCancel={(e) => { penUp(e); handleUp(); }}>
                <canvas ref={canvas} className={"sc-canvas" + (mode === "markup" ? " drawing" : "")} data-testid="canvas" />
                {frame && (
                    <div className="sc-crop" data-testid="crop-frame" style={frame} onPointerDown={handleDown("move")}>
                        {(["tl", "tr", "bl", "br"] as const).map((h) => (
                            <div key={h} className={"sc-handle " + h} data-testid={"crop-" + h} onPointerDown={handleDown(h)} />
                        ))}
                    </div>
                )}
            </div>

            <div className="sc-bottom">
                {mode === "view" && (
                    <Toolbar kind="fade">
                        <IconToolButton icon="crop" label="Crop" testId="crop" disabled={!image} onClick={startCrop} />
                        <IconToolButton icon="markup" label="Markup" testId="markup" disabled={!image} onClick={() => setMode("markup")} />
                        <ToolSpacer />
                        <div ref={shareButton}>
                            <IconToolButton icon="share" label="Share" testId="share" disabled={!image || busy} onClick={() => setSharing(true)} />
                        </div>
                        <IconToolButton icon="trash" label="Delete" testId="delete" onClick={() => setConfirmDelete(true)} />
                    </Toolbar>
                )}
                {mode === "markup" && (
                    <Toolbar kind="fade">
                        {PEN_COLORS.map((c) => (
                            <button key={c} type="button" className={"sc-swatch" + (c === color ? " on" : "")} style={{ background: c }}
                                    aria-label={"Pen " + c} aria-pressed={c === color} data-testid={"pen-" + c.slice(1)} onClick={() => setColor(c)} />
                        ))}
                        <ToolSpacer />
                        <IconToolButton icon="undo" label="Undo" testId="undo" disabled={edits.strokes.length === 0} onClick={undo} />
                    </Toolbar>
                )}
                {mode === "crop" && (
                    <Toolbar kind="fade">
                        <IconToolButton caption="Reset" testId="crop-reset" onClick={() => setDraftCrop({ x: 0, y: 0, ...size })} />
                        <ToolSpacer />
                    </Toolbar>
                )}
            </div>

            {sharing && (
                <PopupMenu anchor={shareButton.current}
                           options={[{ label: "Email", value: "email" }, { label: "Messaging", value: "messaging" }]}
                           onSelect={(v) => void share(v)} onClose={() => setSharing(false)} />
            )}
            <Dialog open={confirmDelete} title="Delete this screen capture?" message="It will be removed from this device."
                    onClose={() => setConfirmDelete(false)} testId="delete-dialog">
                <Button variant="negative" onClick={() => void remove()} data-testid="delete-confirm">Delete</Button>
                <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </Dialog>
            {toast && <div className="sc-toast" role="status" data-testid="toast">{toast}</div>}
        </div>
    );
}
