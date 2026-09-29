// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A chapter or document in a frame of its own, so its stylesheets stay
// inside. The frame is sandboxed without scripts (the markup was cleaned
// by DOMPurify as well); the reader reaches in to lay it out and to see
// taps, swipes and link clicks.
//
//   pages:  CSS columns one screen wide; turning a page scrolls one column.
//   scroll: one long column, scrolled.

import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import type { Prefs } from "./library";

export type FrameMode = "pages" | "scroll";
export type TapZone = "left" | "center" | "right";

export interface FrameProps {
    html: string;
    css?: string;
    lang?: string;
    bodyClass?: string;
    mode: FrameMode;
    prefs: Prefs;
    /** Where to open: 0..1 through (pages or scroll). -1: the last page. */
    startFraction: number;
    /** An element id to show (a table of contents entry). */
    startFragment?: string;
    /** Laid out: how many pages (1 when scrolling). */
    onLayout: (pages: number, page: number) => void;
    /** Pages mode: a page was shown. */
    onPage?: (page: number) => void;
    /** Scroll mode: the scroll position, 0..1. */
    onScroll?: (fraction: number) => void;
    onTap: (zone: TapZone) => void;
    /** A swipe past the first or last page: turn to the next or previous chapter. */
    onEdge?: (dir: 1 | -1) => void;
    /** An in-book link ("OEBPS/ch2.xhtml#note3"). */
    onBookLink?: (href: string) => void;
    /** A link to the web. */
    onWebLink?: (url: string) => void;
    testId?: string;
}

export interface FrameHandle {
    turn(dir: 1 | -1): void;
    goToPage(page: number): void;
    page(): number;
    pages(): number;
}

const PAD_X = 22, PAD_Y = 26;
/** From this width, two columns make a page. */
const TWO_UP = 700;

function fontFamily(p: Prefs): string {
    if (p.font === "serif") return '"DejaVu Serif", Georgia, "Times New Roman", serif';
    if (p.font === "sans") return '"Open Sans", "DejaVu Sans", Helvetica, Arial, sans-serif';
    return "";
}

/** The reader's own style, over the document's. */
export function readerCss(mode: FrameMode, p: Prefs): string {
    const family = fontFamily(p);
    const base = `
html { font-size: ${p.fontScale}% !important; -webkit-text-size-adjust: none; }
body { overflow-wrap: break-word; ${family ? `font-family: ${family} !important;` : ""} }
body * { ${family ? `font-family: inherit !important;` : ""} max-width: 100%; }
img, svg, video { max-width: 100% !important; height: auto; object-fit: contain; }
table { border-collapse: collapse; max-width: 100%; }
td, th { border: 1px solid rgba(128,128,128,0.5); padding: 4px 6px; vertical-align: top; }
pre { white-space: pre-wrap; }
a { color: #1f66b1; }
::selection { background: rgba(90,160,230,0.35); }`;
    const theme = p.night ? `
html, body { background: #111 !important; color: #c8c8c8 !important; }
body * { color: inherit !important; background-color: transparent !important; border-color: #3a3a3a !important; }
a, a * { color: #7fb2e5 !important; }
img { opacity: 0.85; }` : `
html, body { background: #fdfcf9 !important; color: #222; }`;
    const layout = mode === "pages" ? `
html { height: 100% !important; overflow: hidden !important; }
body { margin: 0 !important; height: 100vh !important; box-sizing: border-box !important;
       padding: ${PAD_Y}px ${PAD_X}px !important; width: 100vw !important; max-width: none !important;
       column-width: calc(100vw - ${2 * PAD_X}px) !important; column-gap: ${2 * PAD_X}px !important; column-fill: auto !important; }
img, svg, video { max-height: calc(100vh - ${2 * PAD_Y + 8}px) !important; }
h1, h2, h3, h4, figure, img { break-inside: avoid; break-after: avoid; }
/* Two columns a screen on a wide card, like an open book. */
@media (min-width: ${TWO_UP}px) { body { column-width: calc((100vw - ${4 * PAD_X}px) / 2) !important; } }` : `
html { overflow-y: auto !important; overflow-x: hidden !important; }
body { margin: 0 auto !important; padding: 64px 18px 96px !important; max-width: 760px !important; box-sizing: border-box; line-height: 1.5; }
table { display: block; overflow-x: auto; }`;
    return base + theme + layout;
}

export function frameDocument(props: Pick<FrameProps, "html" | "css" | "lang" | "bodyClass" | "mode" | "prefs">): string {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    return `<!doctype html><html${props.lang ? ` lang="${esc(props.lang)}"` : ""}><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<style>${(props.css ?? "").replace(/<\/style/gi, "<\\/style")}</style>` +
        `<style id="phoenix-reader">${readerCss(props.mode, props.prefs)}</style></head>` +
        `<body${props.bodyClass ? ` class="${esc(props.bodyClass)}"` : ""}>${props.html}</body></html>`;
}

export const Frame = forwardRef<FrameHandle, FrameProps>(function Frame(props, ref) {
    const frame = useRef<HTMLIFrameElement>(null);
    const state = useRef({ page: 0, pages: 1, fraction: props.startFraction, ready: false });
    const latest = useRef(props);
    latest.current = props;

    const win = () => frame.current?.contentWindow ?? null;
    const doc = () => frame.current?.contentDocument ?? null;

    const showPage = useCallback((page: number) => {
        const d = doc(), w = win();
        if (!d || !w) return;
        const s = state.current;
        s.page = Math.max(0, Math.min(s.pages - 1, page));
        s.fraction = s.pages > 1 ? s.page / (s.pages - 1) : 0;
        (d.scrollingElement ?? d.documentElement).scrollLeft = s.page * w.innerWidth;
        latest.current.onPage?.(s.page);
    }, []);

    // Count the pages (again after pictures load or the text size changes).
    const layout = useCallback((keep: "fraction" | "start") => {
        const d = doc(), w = win();
        if (!d || !w) return;
        const s = state.current;
        const el = d.scrollingElement ?? d.documentElement;
        if (latest.current.mode === "pages") {
            s.pages = Math.max(1, Math.ceil(el.scrollWidth / Math.max(1, w.innerWidth) - 0.02));
            let page: number;
            if (keep === "start" && latest.current.startFragment) {
                const target = d.getElementById(latest.current.startFragment);
                page = target ? Math.floor((target.getBoundingClientRect().left + el.scrollLeft) / w.innerWidth) : 0;
            } else if (s.fraction < 0) page = s.pages - 1;
            else page = Math.round(s.fraction * (s.pages - 1));
            latest.current.onLayout(s.pages, page);
            showPage(page);
        } else {
            s.pages = 1;
            const max = el.scrollHeight - el.clientHeight;
            if (keep === "start" && latest.current.startFragment) d.getElementById(latest.current.startFragment)?.scrollIntoView();
            else el.scrollTop = Math.max(0, s.fraction) * max;
            latest.current.onLayout(1, 0);
        }
    }, [showPage]);

    useImperativeHandle(ref, () => ({
        turn(dir) {
            const s = state.current;
            const next = s.page + dir;
            if (next < 0 || next >= s.pages) latest.current.onEdge?.(dir);
            else showPage(next);
        },
        goToPage(p) { showPage(p); },
        page: () => state.current.page,
        pages: () => state.current.pages,
    }), [showPage]);

    // A new chapter or document: write the frame.
    useEffect(() => {
        const f = frame.current;
        if (!f) return;
        state.current = { page: 0, pages: 1, fraction: props.startFraction, ready: false };
        f.srcdoc = frameDocument(props);
        // The reader style is updated in place below; the content changes only with html/mode.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.html, props.css, props.mode]);

    // Text size, font or night mode: restyle in place and keep the place.
    useEffect(() => {
        const d = doc();
        const style = d?.getElementById("phoenix-reader");
        if (!style || !state.current.ready) return;
        style.textContent = readerCss(props.mode, props.prefs);
        requestAnimationFrame(() => layout("fraction"));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.prefs.fontScale, props.prefs.night, props.prefs.font]);

    const onLoad = () => {
        const d = doc(), w = win();
        if (!d || !w) return;
        state.current.ready = true;
        layout("start");
        // Pictures change the layout as they arrive.
        d.querySelectorAll("img").forEach((img) => { if (!img.complete) img.addEventListener("load", () => layout("fraction"), { once: true }); });
        w.addEventListener("resize", () => layout("fraction"));
        if (latest.current.mode === "scroll") {
            w.addEventListener("scroll", () => {
                const el = d.scrollingElement ?? d.documentElement;
                const max = el.scrollHeight - el.clientHeight;
                state.current.fraction = max > 0 ? el.scrollTop / max : 0;
                latest.current.onScroll?.(state.current.fraction);
            }, { passive: true });
        }
        // Taps, swipes and links.
        let down: { x: number; y: number; t: number } | null = null;
        d.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
        d.addEventListener("pointerup", (e) => {
            const s = down;
            down = null;
            if (!s) return;
            const dx = e.clientX - s.x, dy = e.clientY - s.y;
            if (latest.current.mode === "pages" && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) && Date.now() - s.t < 800) {
                const dir = dx < 0 ? 1 : -1;
                const st = state.current;
                if (st.page + dir < 0 || st.page + dir >= st.pages) latest.current.onEdge?.(dir);
                else showPage(st.page + dir);
            }
        });
        d.addEventListener("click", (e) => {
            const a = (e.target as Element | null)?.closest?.("a");
            if (a) {
                e.preventDefault();
                const book = a.getAttribute("data-book-href");
                const href = a.getAttribute("href") ?? "";
                if (book) latest.current.onBookLink?.(book);
                else if (/^https?:/i.test(href)) latest.current.onWebLink?.(href);
                return;
            }
            if (d.getSelection?.()?.toString()) return;
            const x = e.clientX / Math.max(1, w.innerWidth);
            const zone: TapZone = latest.current.mode === "pages" ? (x < 0.3 ? "left" : x > 0.7 ? "right" : "center") : "center";
            latest.current.onTap(zone);
        });
        d.addEventListener("keydown", (e) => w.parent.dispatchEvent(new KeyboardEvent("keydown", { key: e.key })));
    };

    return <iframe ref={frame} className="dv-frame" title="Document" sandbox="allow-same-origin" onLoad={onLoad} data-testid={props.testId} />;
});
