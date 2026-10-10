// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The full-screen viewer: swipe left and right between the album's pictures,
// tap to show or hide the title and the command menu (share, set as
// wallpaper, delete).
//
//   Set as wallpaper: com.webos.service.systemservice setPreferences
//       {wallpaper: {wallpaperName, wallpaperFile}}, the preference Settings'
//       Screen & Lock pane sets (luna-sysservice stores any key).
//   Delete: the file (org.webosphoenix.service.mediafiles/remove), then the
//       index entry (com.webos.service.mediaindexer requestDelete).
//   Share (the command menu and the app menu): the system's share sheet
//       (docs/SHARE-AND-FILES.md SF5), with the picture or video: the apps
//       that take it (Email, Messaging, ...), Save to Files.
//   Play in Videos: videos play here, in place, as in the webOS 2.x Photos &
//       Videos app; the Videos app (launch {target}) adds resuming,
//       subtitles and turning the device.
//   Print (app menu, pictures): PrintPhoto.tsx, through the print manager.

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { apps, deleteMedia, shareSheet, system, type MediaItem } from "@phoenix/luna";
import { useMediaUrl } from "@phoenix/luna/react";
import { AppMenu, Button, Dialog, IconToolButton, Toolbar, ToolSpacer, cssImage, icons } from "@phoenix/ui";
import { isVideo } from "./albums";
import { PrintPhoto } from "./PrintPhoto";

const VIDEOS_APP = "org.webosphoenix.videos";

export interface ViewerProps {
    items: MediaItem[];
    index: number;
    onIndex: (index: number) => void;
    onClose: () => void;
    onDeleted: (index: number) => void;
}

function Slide({ item, active }: { item: MediaItem; active: boolean }) {
    const url = useMediaUrl(item.file_path);
    const video = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false);
    useEffect(() => {
        if (!active && video.current && !video.current.paused) video.current.pause();
    }, [active]);
    if (!url) return <div className="ph-slide" />;
    if (isVideo(item)) {
        return (
            <div className="ph-slide">
                <video ref={video} className="ph-slide-media" src={url} playsInline preload="metadata"
                       onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
                {!playing && (
                    <button type="button" className="ph-play" aria-label="Play" style={{ backgroundImage: cssImage(icons.fullscreenPlay) }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); void video.current?.play(); }} />
                )}
            </div>
        );
    }
    return (
        <div className="ph-slide">
            <img className="ph-slide-media" src={url} alt={item.title ?? ""} draggable={false} />
        </div>
    );
}

export function Viewer({ items, index, onIndex, onClose, onDeleted }: ViewerProps) {
    const [chrome, setChrome] = useState(true);
    const [drag, setDrag] = useState<number | null>(null);
    const start = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
    const pager = useRef<HTMLDivElement>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [printing, setPrinting] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const item = items[index];

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 2200);
        return () => clearTimeout(t);
    }, [toast]);

    // Arrow keys (desktop browsers and the simulator's keyboard).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
            else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [index, items.length, onIndex]);

    const onPointerDown = (e: PointerEvent) => {
        start.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        let dx = e.clientX - s.x;
        // Resist at the ends, as the webOS viewer does.
        if ((index === 0 && dx > 0) || (index === items.length - 1 && dx < 0)) dx /= 3;
        if (drag !== null || Math.abs(dx) > 6) setDrag(dx);
    };
    const onPointerUp = (e: PointerEvent) => {
        const s = start.current;
        start.current = null;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x, dt = Date.now() - s.t;
        const width = pager.current?.clientWidth || window.innerWidth;
        setDrag(null);
        if (Math.abs(dx) < 6 && Math.abs(e.clientY - s.y) < 6) {
            if (dt < 500) setChrome((c) => !c);
            return;
        }
        const flick = Math.abs(dx) > 30 && dt < 250;
        if ((dx < -width * 0.2 || (flick && dx < 0)) && index < items.length - 1) onIndex(index + 1);
        else if ((dx > width * 0.2 || (flick && dx > 0)) && index > 0) onIndex(index - 1);
    };

    const setWallpaper = async () => {
        await system.setPreferences({ wallpaper: { wallpaperName: item.title ?? "", wallpaperFile: item.file_path } });
        setToast("Wallpaper set");
    };

    const shared = () => ({ title: item.title ?? "", files: [{ path: item.file_path, mimeType: item.mime ?? "" }] });
    const share = async () => {
        try {
            const r = await shareSheet.open(shared());
            if (r.action === "files") setToast("Saved to Files");
        } catch {
            setToast("Could not share");
        }
    };

    const remove = async () => {
        setConfirmDelete(false);
        const i = index;
        try {
            await deleteMedia(item);
            onDeleted(i);
        } catch {
            setToast("Could not delete");
        }
    };

    const kind = isVideo(item) ? "video" : "photo";
    return (
        <div className="ph-viewer" data-testid="viewer">
            <div
                ref={pager}
                className="ph-pager"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                <div className={"ph-track" + (drag === null ? " settle" : "")}
                     style={{ transform: `translateX(calc(${-index * 100}% + ${drag ?? 0}px))` }}>
                    {items.map((it, i) => Math.abs(i - index) <= 1 && (
                        <div key={it.uri} className="ph-page" style={{ left: `${i * 100}%` }}>
                            <Slide item={it} active={i === index} />
                        </div>
                    ))}
                </div>
            </div>

            <div className={"ph-viewer-top" + (chrome ? "" : " hidden")}>
                <button type="button" className="ph-viewer-back" aria-label="Back" onClick={onClose} />
                <div className="ph-viewer-title">{item.title}</div>
                <div className="ph-viewer-index" data-testid="viewer-index">{index + 1} of {items.length}</div>
            </div>

            <div className={"ph-viewer-bottom" + (chrome ? "" : " hidden")}>
                <Toolbar kind="fade">
                    <IconToolButton icon="share" label="Share" testId="share" onClick={() => void share()} />
                    <ToolSpacer />
                    {kind === "photo" && <IconToolButton icon="wallpaper" label="Set as wallpaper" testId="wallpaper" onClick={() => void setWallpaper()} />}
                    {kind === "video" && (
                        <IconToolButton icon="video" label="Play in Videos" testId="open-videos"
                                        onClick={() => void apps.launch(VIDEOS_APP, { target: item.file_path }).catch(() => setToast("Videos is not installed"))} />
                    )}
                    <ToolSpacer />
                    <IconToolButton icon="trash" label="Delete" testId="delete" onClick={() => setConfirmDelete(true)} />
                </Toolbar>
            </div>

            <Dialog open={confirmDelete} title={`Delete this ${kind}?`} message={`The ${kind} will be removed from this device.`}
                    onClose={() => setConfirmDelete(false)} testId="delete-dialog">
                <Button variant="negative" onClick={() => void remove()} data-testid="delete-confirm">Delete</Button>
                <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </Dialog>
            {printing && <PrintPhoto item={item} onClose={() => setPrinting(false)}
                                     onDone={(text) => { setPrinting(false); setToast(text); }} />}
            <AppMenu share={shared} items={[{ label: "Print", onSelect: () => setPrinting(true), disabled: kind !== "photo" }]} />
            {toast && <div className="ph-toast" role="status">{toast}</div>}
        </div>
    );
}
