// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The document: pages one below the other on grey, as webOS's PDF View
// (Adobe Reader for webOS) showed them. Scroll through, pinch (or the
// zoom buttons, or Ctrl + the mouse wheel) to zoom, double-tap to zoom in
// and out, the grid button for page thumbnails, and the search button to
// find text (every match on the page is marked, the current one brighter).
// The page and zoom are remembered for next time.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { Button, Dialog, ErrorText, Glyph, IconToolButton, Spinner, TextField, Toolbar, ToolSpacer } from "@phoenix/ui";
import { PdfDocument, passwordNeeded } from "./engine";
import { clampZoom, pageInView, recentFor, saveRecent, stepZoom } from "./library";
import { findMatches, matchLabel, type Match } from "./search";

export interface ViewerProps {
    target: string;
    name: string;
    load: () => Promise<Uint8Array>;
    onClose: () => void;
}

const GAP = 10;
const MARGIN = 8;
const MAX_FIT_WIDTH = 760;

type Rect = { x: number; y: number; w: number; h: number };

function PageView({ doc, n, scale, visible, marks, current }: {
    doc: PdfDocument; n: number; scale: number; visible: boolean; marks: Rect[]; current: Rect[];
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [drawn, setDrawn] = useState<number | null>(null);
    useEffect(() => {
        if (!visible || drawn === scale || !canvas.current) return;
        const job = doc.render(n, canvas.current, scale);
        job.promise.then(() => setDrawn(scale), () => {});
        return () => job.cancel();
    }, [doc, n, scale, visible, drawn]);
    return (
        <>
            <canvas ref={canvas} className={"pv-canvas" + (drawn === null ? " blank" : "")} />
            {drawn === null && visible && <div className="pv-page-spinner"><Spinner /></div>}
            {marks.map((r, i) => <span key={"m" + i} className="pv-mark" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />)}
            {current.map((r, i) => <span key={"c" + i} className="pv-mark current" data-testid="current-match" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />)}
            <span className="pv-page-number">{n + 1}</span>
        </>
    );
}

function Thumb({ doc, n, onOpen, current }: { doc: PdfDocument; n: number; onOpen: () => void; current: boolean }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const holder = useRef<HTMLButtonElement>(null);
    const [shown, setShown] = useState(false);
    useEffect(() => {
        const el = holder.current;
        if (!el || typeof IntersectionObserver === "undefined") { setShown(true); return; }
        const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); } });
        io.observe(el);
        return () => io.disconnect();
    }, []);
    useEffect(() => {
        if (!shown || !canvas.current) return;
        let job: { cancel(): void } | null = null;
        void doc.size(n).then((s) => {
            if (!canvas.current) return;
            job = doc.render(n, canvas.current, 96 / s.width);
        });
        return () => job?.cancel();
    }, [doc, n, shown]);
    return (
        <button type="button" ref={holder} className={"pv-thumb" + (current ? " current" : "")} onClick={onOpen} data-testid={`thumb-${n + 1}`}>
            <canvas ref={canvas} />
            <span>{n + 1}</span>
        </button>
    );
}

export function Viewer({ target, name, load, onClose }: ViewerProps) {
    const [doc, setDoc] = useState<PdfDocument | null>(null);
    const [error, setError] = useState("");
    const [password, setPassword] = useState<{ bytes: Uint8Array; wrong: boolean } | null>(null);
    const [pw, setPw] = useState("");
    const [title, setTitle] = useState(name);
    const [sizes, setSizes] = useState<{ width: number; height: number }[]>([]);
    const [viewW, setViewW] = useState(0);
    const [viewH, setViewH] = useState(0);
    const saved = useMemo(() => recentFor(target), [target]);
    const [zoom, setZoom] = useState(saved?.zoom ?? 1);
    const [page, setPage] = useState(Math.max(0, (saved?.page ?? 1) - 1));
    const [scrollTop, setScrollTop] = useState(0);
    const [thumbs, setThumbs] = useState(false);
    const [searching, setSearching] = useState(false);
    const [query, setQuery] = useState("");
    const [matches, setMatches] = useState<Match[] | null>(null);
    const [matchAt, setMatchAt] = useState(0);
    const [busy, setBusy] = useState(false);
    const [marks, setMarks] = useState<Record<number, { all: Rect[]; current: Rect[] }>>({});
    const [pinch, setPinch] = useState<{ ratio: number; cx: number; cy: number } | null>(null);
    const scroller = useRef<HTMLDivElement>(null);
    const restored = useRef(false);

    // ---- Opening --------------------------------------------------------------------

    const open = useCallback(async (bytes: Uint8Array, pass?: string) => {
        try {
            // PDF.js takes the buffer over; keep our own copy for a password retry.
            const d = await PdfDocument.open(bytes.slice(), pass);
            const s = await Promise.all(Array.from({ length: d.numPages }, (_, i) => d.size(i)));
            setSizes(s);
            setDoc(d);
            setPassword(null);
            const t = await d.title();
            if (t) setTitle(t);
        } catch (e) {
            const need = passwordNeeded(e);
            if (need) { setPassword({ bytes, wrong: need === 2 }); return; }
            console.warn("[pdfview] cannot open the PDF:", e instanceof Error ? `${e.name}: ${e.message}` : e);
            setError("This PDF cannot be opened. It may be damaged.");
        }
    }, []);

    useEffect(() => {
        let live = true;
        load().then((b) => { if (live) void open(b); }, () => { if (live) setError("The file cannot be read."); });
        return () => { live = false; };
    }, [load, open]);
    useEffect(() => () => doc?.destroy(), [doc]);

    // ---- Layout ---------------------------------------------------------------------

    useLayoutEffect(() => {
        const el = scroller.current;
        if (!el) return;
        const measure = () => { setViewW(el.clientWidth); setViewH(el.clientHeight); };
        measure();
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        ro?.observe(el);
        window.addEventListener("resize", measure);
        return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
    }, [doc]);

    const widest = sizes.reduce((m, s) => Math.max(m, s.width), 1);
    // Fit the width, but not wider than a comfortable page on a tablet.
    const fit = viewW > 0 ? Math.min(viewW - 2 * MARGIN, MAX_FIT_WIDTH) / widest : 1;
    const scale = fit * zoom;
    const tops = useMemo(() => {
        const t: number[] = [];
        let y = MARGIN;
        for (const s of sizes) { t.push(y); y += s.height * scale + GAP; }
        return t;
    }, [sizes, scale]);
    const contentH = tops.length ? tops[tops.length - 1] + sizes[sizes.length - 1].height * scale + MARGIN : 0;
    const contentW = Math.max(viewW, widest * scale + 2 * MARGIN);

    const goTo = useCallback((n: number, smooth = false) => {
        const el = scroller.current;
        if (!el || !tops.length) return;
        const i = Math.max(0, Math.min(tops.length - 1, n));
        el.scrollTo({ top: tops[i] - MARGIN, behavior: smooth ? "smooth" : "auto" });
        setPage(i);
    }, [tops]);

    // Back to where it was left.
    useLayoutEffect(() => {
        if (restored.current || !doc || !viewW || !tops.length) return;
        restored.current = true;
        goTo(page);
    }, [doc, viewW, tops, goTo, page]);

    const onScroll = () => {
        const el = scroller.current!;
        setScrollTop(el.scrollTop);
        setPage(pageInView(tops, el.scrollTop, el.clientHeight));
    };

    // Remember the page and zoom.
    useEffect(() => {
        if (!doc) return;
        const t = setTimeout(() => saveRecent({ target, title, page: page + 1, pages: doc.numPages, zoom }), 400);
        return () => clearTimeout(t);
    }, [doc, target, title, page, zoom]);

    // Zoom keeping the point at (cx, cy) of the view still.
    const zoomTo = useCallback((z: number, cx?: number, cy?: number) => {
        const el = scroller.current;
        const nz = clampZoom(z);
        if (!el || nz === zoom) { setZoom(nz); return; }
        const px = cx ?? el.clientWidth / 2, py = cy ?? el.clientHeight / 3;
        const r = nz / zoom;
        const x = (el.scrollLeft + px) * r - px, y = (el.scrollTop + py) * r - py;
        setZoom(nz);
        requestAnimationFrame(() => { el.scrollLeft = Math.max(0, x); el.scrollTop = Math.max(0, y); });
    }, [zoom]);

    // Ctrl + wheel zooms (desktop, the simulator).
    useEffect(() => {
        const el = scroller.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            const r = el.getBoundingClientRect();
            zoomTo(zoom * Math.exp(-e.deltaY / 300), e.clientX - r.left, e.clientY - r.top);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [zoom, zoomTo]);

    // Pinch with two fingers; double-tap zooms in, or back out.
    const touch = useRef<{ d: number; cx: number; cy: number } | null>(null);
    const lastTap = useRef(0);
    const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: ReactTouchEvent) => {
        if (e.touches.length === 2) {
            const r = scroller.current!.getBoundingClientRect();
            touch.current = { d: dist(e.touches), cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top };
        } else if (e.touches.length === 1) {
            const now = Date.now();
            if (now - lastTap.current < 300) {
                const r = scroller.current!.getBoundingClientRect();
                zoomTo(zoom > 1.2 ? 1 : 2, e.touches[0].clientX - r.left, e.touches[0].clientY - r.top);
                lastTap.current = 0;
            } else lastTap.current = now;
        }
    };
    const onTouchMove = (e: ReactTouchEvent) => {
        const t = touch.current;
        if (!t || e.touches.length !== 2) return;
        setPinch({ ratio: dist(e.touches) / t.d, cx: t.cx, cy: t.cy });
    };
    const onTouchEnd = () => {
        if (touch.current && pinch) zoomTo(zoom * pinch.ratio, pinch.cx, pinch.cy);
        touch.current = null;
        setPinch(null);
    };
    useEffect(() => {
        // Keep the browser from zooming the page itself.
        const el = scroller.current;
        if (!el) return;
        const stop = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
        el.addEventListener("touchmove", stop, { passive: false });
        return () => el.removeEventListener("touchmove", stop);
    }, [doc]);

    // ---- Search ---------------------------------------------------------------------

    const runSearch = async () => {
        if (!doc || !query.trim()) return;
        setBusy(true);
        const texts = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.text(i)));
        const found = findMatches(texts, query);
        setBusy(false);
        setMatches(found);
        const first = Math.max(0, found.findIndex((m) => m.page >= page));
        setMatchAt(first);
        if (found.length) goTo(found[first].page);
    };
    const stepMatch = (d: 1 | -1) => {
        if (!matches?.length) return;
        const i = (matchAt + d + matches.length) % matches.length;
        setMatchAt(i);
        const m = matches[i];
        if (m.page !== page) goTo(m.page);
    };
    // Rectangles for the matches on the pages in view.
    useEffect(() => {
        if (!doc || !matches) { setMarks({}); return; }
        let live = true;
        const pages = [...new Set(matches.map((m) => m.page))].filter((p) => Math.abs(p - page) <= 2);
        void Promise.all(pages.map(async (p) => {
            const on = matches.filter((m) => m.page === p);
            const cur = matches[matchAt]?.page === p ? matches[matchAt] : null;
            const all = await doc.itemRects(p, on.filter((m) => m !== cur).flatMap((m) => m.items), scale);
            const current = cur ? await doc.itemRects(p, cur.items, scale) : [];
            return [p, { all, current }] as const;
        })).then((r) => { if (live) setMarks(Object.fromEntries(r)); });
        return () => { live = false; };
    }, [doc, matches, matchAt, page, scale]);

    const closeSearch = () => { setSearching(false); setMatches(null); setQuery(""); };

    // ---- Drawing --------------------------------------------------------------------

    const visible = (i: number) => {
        const top = tops[i], h = sizes[i].height * scale;
        return top + h >= scrollTop - viewH && top <= scrollTop + 2 * viewH;
    };

    return (
        <div className="pv-viewer" data-testid="viewer">
            <div className="pv-top">
                <button type="button" className="pv-back" aria-label="Back" data-testid="viewer-back" onClick={onClose} />
                <div className="pv-title" data-testid="doc-title">{title}</div>
                {doc && <div className="pv-page-label" data-testid="page-label">{page + 1} / {doc.numPages}</div>}
            </div>
            {searching && (
                <div className="pv-search" data-testid="search-bar">
                    <div className="pv-search-field">
                        <TextField value={query} onChange={(v) => { setQuery(v); setMatches(null); }} onSubmit={() => void runSearch()}
                                   placeholder="Find in document" autoFocus testId="search-field" />
                    </div>
                    <span className="pv-search-count" data-testid="search-count">{busy ? <Spinner /> : matches ? matchLabel(matchAt, matches.length) : ""}</span>
                    <button type="button" className="pv-search-btn" aria-label="Previous match" data-testid="search-prev" disabled={!matches?.length} onClick={() => stepMatch(-1)}>‹</button>
                    <button type="button" className="pv-search-btn" aria-label="Next match" data-testid="search-next" disabled={!matches?.length} onClick={() => stepMatch(1)}>›</button>
                    <button type="button" className="pv-search-btn" aria-label="Close search" data-testid="search-close" onClick={closeSearch}>×</button>
                </div>
            )}
            <div ref={scroller} className={"pv-scroll" + (searching ? " searching" : "")} data-testid="pages" onScroll={onScroll}
                 onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
                {!doc && !error && !password && <div className="pv-loading"><Spinner large /></div>}
                {error && <div className="pv-error" role="alert">{error}</div>}
                {doc && (
                    <div className="pv-pages" style={{
                        width: contentW, height: contentH,
                        transform: pinch ? `scale(${pinch.ratio})` : undefined,
                        transformOrigin: pinch ? `${(scroller.current?.scrollLeft ?? 0) + pinch.cx}px ${(scroller.current?.scrollTop ?? 0) + pinch.cy}px` : undefined,
                    }}>
                        {sizes.map((s, i) => (
                            <div key={i} className="pv-page" data-testid={`page-${i + 1}`}
                                 style={{ top: tops[i], left: Math.max(MARGIN, (contentW - s.width * scale) / 2), width: s.width * scale, height: s.height * scale }}>
                                <PageView doc={doc} n={i} scale={scale} visible={visible(i)} marks={marks[i]?.all ?? []} current={marks[i]?.current ?? []} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <Toolbar kind="dark" className="pv-toolbar">
                <IconToolButton icon="grid" label="Pages" testId="thumbs" depressed={thumbs} disabled={!doc} onClick={() => setThumbs(!thumbs)} />
                <ToolSpacer />
                <IconToolButton icon="zoom-out" label="Zoom out" testId="zoom-out" disabled={!doc} onClick={() => zoomTo(stepZoom(zoom, -1))} />
                <button type="button" className="pv-zoom-label" data-testid="zoom-label" disabled={!doc} onClick={() => zoomTo(1)}>{Math.round(zoom * 100)}%</button>
                <IconToolButton icon="zoom-in" label="Zoom in" testId="zoom-in" disabled={!doc} onClick={() => zoomTo(stepZoom(zoom, 1))} />
                <ToolSpacer />
                <IconToolButton icon="search" label="Find" testId="search" depressed={searching} disabled={!doc}
                                onClick={() => (searching ? closeSearch() : setSearching(true))} />
            </Toolbar>
            {thumbs && doc && (
                <div className="pv-thumbs" data-testid="thumbnails">
                    <div className="pv-thumbs-head">
                        <span>Pages</span>
                        <button type="button" aria-label="Close" onClick={() => setThumbs(false)}><Glyph name="close" size={20} /></button>
                    </div>
                    <div className="pv-thumbs-grid">
                        {sizes.map((_, i) => <Thumb key={i} doc={doc} n={i} current={i === page} onOpen={() => { setThumbs(false); goTo(i); }} />)}
                    </div>
                </div>
            )}
            <Dialog open={!!password} title="Password" message={password?.wrong ? "That password is not right. Try again." : "This document is protected with a password."}
                    onClose={onClose} testId="password-dialog">
                <TextField value={pw} onChange={setPw} type="password" placeholder="Password" autoFocus
                           onSubmit={() => password && void open(password.bytes, pw)} testId="password-field" />
                {password?.wrong && <ErrorText>Wrong password</ErrorText>}
                <Button variant="affirmative" onClick={() => password && void open(password.bytes, pw)}>Open</Button>
                <Button onClick={onClose}>Cancel</Button>
            </Dialog>
        </div>
    );
}
