// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The ways Doc View shows a document: a book in pages, a document scrolled,
// a workbook's sheets, a presentation's slides.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { apps } from "@phoenix/luna";
import { GroupedToolButtons } from "@phoenix/ui";
import { blobUrls, chapterContent, chapterTitle, type Book } from "./epub";
import { Frame, type FrameHandle, type TapZone } from "./Frame";
import { fractionFromPage, type Position, type Prefs } from "./library";
import { columnName, type Presentation, type Sheet, type SlideItem } from "./office";

export interface ViewHandle {
    /** Turn a page (books) or step a slide / sheet. */
    turn(dir: 1 | -1): void;
    /** Go to a table of contents entry. */
    goTo(part: number, fragment?: string): void;
}

interface Common {
    prefs: Prefs;
    start?: Position;
    onPosition: (p: Omit<Position, "at" | "title">) => void;
    onStatus: (s: string) => void;
    onTap: (zone: TapZone) => void;
}

const openWeb = (url: string) => { void apps.launch("com.palm.app.browser", { target: url }).catch(() => {}); };

// ---- Books -------------------------------------------------------------------------------

export const BookView = forwardRef<ViewHandle, Common & { book: Book }>(function BookView({ book, prefs, start, onPosition, onStatus, onTap }, ref) {
    const urls = useMemo(() => blobUrls(book.pkg), [book]);
    useEffect(() => () => urls.revoke(), [urls]);
    const [chapter, setChapter] = useState(() => Math.max(0, Math.min(book.spine.length - 1, start?.part ?? 0)));
    const [entry, setEntry] = useState<{ fraction: number; fragment?: string }>({ fraction: start?.fraction ?? 0 });
    const [pages, setPages] = useState({ page: 0, pages: 1 });
    const frame = useRef<FrameHandle>(null);
    const content = useMemo(() => chapterContent(book, chapter, urls.urlFor), [book, chapter, urls]);

    const go = (c: number, fraction: number, fragment?: string) => {
        if (c < 0 || c >= book.spine.length) return;
        setEntry({ fraction, fragment });
        setChapter(c);
    };
    useImperativeHandle(ref, () => ({
        turn(dir) { frame.current?.turn(dir); },
        goTo(part, fragment) { go(part, 0, fragment); },
    }));

    useEffect(() => {
        const title = chapterTitle(book, chapter);
        onStatus(`${title ? title + " · " : ""}${pages.page + 1} of ${pages.pages}`);
    }, [book, chapter, pages, onStatus]);

    const report = (page: number, total: number) => {
        setPages({ page, pages: total });
        onPosition({ part: chapter, fraction: fractionFromPage(page, total), parts: book.spine.length });
    };

    return (
        <Frame ref={frame} key={chapter} html={content.html} css={content.css} lang={content.lang} bodyClass={content.bodyClass}
               mode="pages" prefs={prefs} startFraction={entry.fraction} startFragment={entry.fragment} testId="book-frame"
               onLayout={(total, page) => report(page, total)} onPage={(page) => report(page, frame.current?.pages() ?? 1)}
               onTap={onTap} onEdge={(dir) => go(chapter + dir, dir > 0 ? 0 : -1)}
               onBookLink={(href) => {
                   const [path, frag] = href.split("#");
                   const c = book.spine.findIndex((s) => s.path === path);
                   if (c >= 0) go(c, 0, frag);
               }}
               onWebLink={openWeb} />
    );
});

// ---- Documents (scrolled) ----------------------------------------------------------------

export const FlowView = forwardRef<ViewHandle, Common & { html: string; className: string }>(function FlowView({ html, className, prefs, start, onPosition, onStatus, onTap }, ref) {
    useImperativeHandle(ref, () => ({ turn() { /* scrolls */ }, goTo() { /* one part */ } }));
    const [pct, setPct] = useState(Math.round((start?.fraction ?? 0) * 100));
    useEffect(() => { onStatus(`${pct}%`); }, [pct, onStatus]);
    return (
        <Frame html={html} bodyClass={className} mode="scroll" prefs={prefs} startFraction={start?.fraction ?? 0} testId="doc-frame"
               css={FLOW_CSS}
               onLayout={() => {}}
               onScroll={(f) => { setPct(Math.round(f * 100)); onPosition({ part: 0, fraction: f, parts: 1 }); }}
               onTap={onTap} onWebLink={openWeb} />
    );
});

const FLOW_CSS = `
body { font-family: "DejaVu Serif", Georgia, serif; font-size: 17px; line-height: 1.5; }
body.markdown, body.text { font-family: "Open Sans", "DejaVu Sans", sans-serif; }
body.text p { margin: 0 0 0.9em; }
h1, h2, h3 { font-family: "Open Sans", "DejaVu Sans", sans-serif; line-height: 1.25; }
h1 { font-size: 1.6em; } h2 { font-size: 1.3em; margin-top: 1.4em; }
blockquote { margin: 1em 0; padding: 0.2em 1em; border-left: 4px solid #9bb5d1; color: #555; }
code, pre { font-family: "DejaVu Sans Mono", monospace; font-size: 0.88em; background: rgba(128,128,128,0.12); border-radius: 3px; }
pre { padding: 8px 10px; }
table { margin: 1em 0; }
th { background: rgba(90,140,200,0.15); }
li { margin: 0.25em 0; }
`;

// ---- Workbooks ----------------------------------------------------------------------------

export const SheetView = forwardRef<ViewHandle, Common & { sheets: Sheet[] }>(function SheetView({ sheets, prefs, start, onPosition, onStatus, onTap }, ref) {
    const [at, setAt] = useState(Math.max(0, Math.min(sheets.length - 1, start?.part ?? 0)));
    const scroller = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => ({
        turn(dir) { setAt((a) => Math.max(0, Math.min(sheets.length - 1, a + dir))); },
        goTo(part) { setAt(part); },
    }));
    const sheet = sheets[at];
    useEffect(() => {
        onStatus(sheets.length > 1 ? `Sheet ${at + 1} of ${sheets.length}` : sheet?.name ?? "");
        onPosition({ part: at, fraction: 0, parts: sheets.length });
    }, [at, sheets, sheet, onStatus, onPosition]);
    const cols = sheet?.rows.reduce((n, r) => Math.max(n, r.length), 0) ?? 0;
    return (
        <div className={"dv-sheets" + (prefs.night ? " night" : "") + (sheets.length > 1 ? "" : " single")} data-testid="sheets">
            {sheets.length > 1 && (
                <div className="dv-sheet-tabs">
                    <GroupedToolButtons value={at} onChange={setAt}
                                        options={sheets.map((s, i) => ({ value: i, caption: s.name, testId: `sheet-${s.name}` }))} />
                </div>
            )}
            <div ref={scroller} className="dv-sheet-scroll" style={{ fontSize: `${(14 * prefs.fontScale) / 100}px` }} onClick={() => onTap("center")}>
                {!sheet?.rows.length ? <div className="dv-sheet-empty">This sheet is empty.</div> : (
                    <table className="dv-sheet" data-testid="sheet-table">
                        <thead>
                            <tr><th className="corner" />{Array.from({ length: cols }, (_, c) => (
                                <th key={c} style={{ minWidth: sheet.widths[c] ? (sheet.widths[c] * prefs.fontScale) / 100 : undefined }}>{columnName(c)}</th>
                            ))}</tr>
                        </thead>
                        <tbody>
                            {sheet.rows.map((row, r) => (
                                <tr key={r}>
                                    <th>{r + 1}</th>
                                    {row.map((cell, c) => cell.hidden ? null : (
                                        <td key={c} colSpan={cell.colSpan} rowSpan={cell.rowSpan}
                                            className={(cell.numeric ? "num" : "") + (cell.bold ? " bold" : "")}>{cell.text}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
});

// ---- Presentations -------------------------------------------------------------------------

function SlideItemView({ item, urlFor, heightPt }: { item: SlideItem; urlFor: (p: string) => string; heightPt: number }) {
    const box = { left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.w * 100}%`, height: `${item.h * 100}%` };
    if (item.kind === "picture") return <img className="dv-slide-pic" src={urlFor(item.path)} alt="" style={box} draggable={false} />;
    if (item.kind === "table") {
        return (
            <div className="dv-slide-table" style={box}>
                <table><tbody>{item.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
            </div>
        );
    }
    return (
        <div className={`dv-slide-text anchor-${item.anchor ?? "t"}`} style={{ ...box, background: item.fill, fontSize: `calc(var(--slide-h) * ${18 / heightPt})` }}>
            <div>
                {item.paragraphs.map((p, i) => (
                    <p key={i} style={{ textAlign: p.align, marginLeft: p.level ? `${p.level * 1.2}em` : undefined }} className={p.bullet ? "bullet" : undefined}>
                        {p.bullet && <span className="dv-bullet">{p.bullet === "#" ? `${i + 1}.` : p.bullet}</span>}
                        {p.runs.map((r, j) => r.text === "\n" ? <br key={j} /> : (
                            <span key={j} style={{
                                // Points as a share of the slide height, so text scales with the slide.
                                fontSize: r.size ? `calc(var(--slide-h) * ${r.size / heightPt})` : undefined,
                                fontWeight: r.bold ? "bold" : undefined, fontStyle: r.italic ? "italic" : undefined, color: r.color,
                            }}>{r.text}</span>
                        ))}
                    </p>
                ))}
            </div>
        </div>
    );
}

export const SlidesView = forwardRef<ViewHandle, Common & { presentation: Presentation }>(function SlidesView({ presentation, prefs, start, onPosition, onStatus, onTap }, ref) {
    const urls = useMemo(() => blobUrls(presentation.pkg), [presentation]);
    useEffect(() => () => urls.revoke(), [urls]);
    const scroller = useRef<HTMLDivElement>(null);
    const [current, setCurrent] = useState(Math.max(0, start?.part ?? 0));
    const [width, setWidth] = useState(300);
    const n = presentation.slides.length;
    useEffect(() => {
        const el = scroller.current;
        if (!el) return;
        // As wide as the card allows, but a whole slide fits the height.
        const measure = () => setWidth(Math.max(120, Math.min(el.clientWidth - 24, 900, (el.clientHeight - 150) * presentation.aspect)));
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [presentation.aspect]);
    const height = width / presentation.aspect;
    const goTo = (i: number) => {
        const el = scroller.current?.querySelector<HTMLElement>(`[data-slide='${i}']`);
        el?.scrollIntoView({ block: "start" });
    };
    useImperativeHandle(ref, () => ({ turn(dir) { goTo(Math.max(0, Math.min(n - 1, current + dir))); }, goTo }));
    // Back to the slide it was left at, once laid out.
    const restored = useRef(false);
    useEffect(() => {
        if (restored.current || !width) return;
        restored.current = true;
        if (current > 0) requestAnimationFrame(() => goTo(current));
    });
    useEffect(() => {
        onStatus(`Slide ${current + 1} of ${n}`);
        onPosition({ part: current, fraction: 0, parts: n });
    }, [current, n, onStatus, onPosition]);
    const onScroll = () => {
        const el = scroller.current!;
        setCurrent(Math.max(0, Math.min(n - 1, Math.floor((el.scrollTop + el.clientHeight / 3) / (height + 16)))));
    };
    return (
        <div ref={scroller} className={"dv-slides" + (prefs.night ? " night" : "")} onScroll={onScroll} onClick={() => onTap("center")} data-testid="slides">
            {presentation.slides.map((s, i) => (
                <div key={i} className="dv-slide" data-slide={i} data-testid={`slide-${i + 1}`}
                     style={{ width, height, background: s.background ?? "#fff", ["--slide-h" as string]: `${height}px` }}>
                    {s.items.map((it, j) => <SlideItemView key={j} item={it} urlFor={urls.urlFor} heightPt={presentation.heightPt} />)}
                    <span className="dv-slide-number">{i + 1}</span>
                </div>
            ))}
        </div>
    );
});
