// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An app's screenshots: a strip on the app page, and a full-screen viewer
// when one is tapped. In the viewer the screenshots follow the finger
// sideways and settle on the next or previous one (a quarter of the width,
// or a quick flick); the arrows, the arrow keys and the dots move too; the
// back gesture or the close button leaves it. Screenshots that do not load
// (the webOS Archive lists some it no longer has) are left out.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useBack } from "@phoenix/ui";

export function Screenshots({ urls }: { urls: string[] }) {
    const [failed, setFailed] = useState<Set<string>>(new Set());
    const [open, setOpen] = useState<number | null>(null);
    useEffect(() => { setFailed(new Set()); setOpen(null); }, [urls.join("\n")]);
    const shown = urls.filter((u) => !failed.has(u));
    if (shown.length === 0) return null;
    return (
        <>
            <div className="mk-shots" data-testid="screenshots">
                {shown.map((s, i) => (
                    <button key={s} type="button" className="mk-shot" data-testid={`screenshot-${i}`} onClick={() => setOpen(i)}
                            aria-label={`Screenshot ${i + 1} of ${shown.length}`}>
                        <img src={s} alt="" loading="lazy" onError={() => setFailed((f) => new Set(f).add(s))} />
                    </button>
                ))}
            </div>
            {open !== null && <Viewer urls={shown} start={open} onClose={() => setOpen(null)} />}
        </>
    );
}

function Viewer({ urls, start, onClose }: { urls: string[]; start: number; onClose: () => void }) {
    const [index, setIndex] = useState(start);
    const [drag, setDrag] = useState(0);              // px the finger has moved the strip
    const [dragging, setDragging] = useState(false);
    const area = useRef<HTMLDivElement>(null);
    const from = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
    const last = urls.length - 1;
    const go = (i: number) => setIndex(Math.max(0, Math.min(last, i)));

    useBack(() => { onClose(); return true; });
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") go(index - 1);
            else if (e.key === "ArrowRight") go(index + 1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [index]);

    function down(e: ReactPointerEvent) {
        from.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    function move(e: ReactPointerEvent) {
        const f = from.current;
        if (!f || f.id !== e.pointerId) return;
        let dx = e.clientX - f.x;
        if (!dragging && Math.abs(dx) < 6) return;
        // Past the first and the last, it gives a little.
        if ((index === 0 && dx > 0) || (index === last && dx < 0)) dx /= 3;
        setDragging(true);
        setDrag(dx);
    }
    function up(e: ReactPointerEvent) {
        const f = from.current;
        from.current = null;
        if (!f || f.id !== e.pointerId) return;
        const width = area.current?.clientWidth || 1;
        const dx = e.clientX - f.x, dt = Math.max(1, e.timeStamp - f.t);
        const flick = Math.abs(dx) / dt > 0.5 && Math.abs(dx) > 20;
        if (dragging && (Math.abs(dx) > width / 4 || flick)) go(index + (dx < 0 ? 1 : -1));
        setDragging(false);
        setDrag(0);
    }

    return (
        <div className="mk-viewer" data-testid="screenshot-viewer" role="dialog" aria-label="Screenshots">
            <div className="mk-viewer-area" ref={area} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                <div className="mk-viewer-track" data-testid="viewer-track"
                     style={{ transform: `translateX(calc(${-index * 100}% + ${drag}px))`, transition: dragging ? "none" : undefined }}>
                    {urls.map((u, i) => (
                        <div key={u} className="mk-viewer-page">
                            <img src={u} alt={`Screenshot ${i + 1}`} draggable={false} />
                        </div>
                    ))}
                </div>
            </div>
            <button type="button" className="mk-viewer-close" data-testid="viewer-close" aria-label="Close" onClick={onClose}>×</button>
            {index > 0 && <button type="button" className="mk-viewer-arrow left" data-testid="viewer-prev" aria-label="Previous" onClick={() => go(index - 1)}>‹</button>}
            {index < last && <button type="button" className="mk-viewer-arrow right" data-testid="viewer-next" aria-label="Next" onClick={() => go(index + 1)}>›</button>}
            {urls.length > 1 && (
                <div className="mk-viewer-dots" data-testid="viewer-dots">
                    {urls.map((u, i) => (
                        <button key={u} type="button" className={i === index ? "on" : ""} aria-label={`Screenshot ${i + 1}`}
                                aria-current={i === index} onClick={() => go(i)} />
                    ))}
                </div>
            )}
        </div>
    );
}
