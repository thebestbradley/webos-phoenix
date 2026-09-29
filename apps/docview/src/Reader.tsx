// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Reading one document: the title bar and the command menu over it (tap
// the middle of the page to show or hide them), the table of contents,
// text size and font, and night mode. Where the reader was is kept.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Glyph, IconToolButton, Spinner, Toolbar, ToolSpacer, useBack } from "@phoenix/ui";
import { flatToc } from "./epub";
import { formatLabel, loadContent, type Content, type Format } from "./formats";
import type { TapZone } from "./Frame";
import { positionOf, savePosition, stepFont, type Position, type Prefs } from "./library";
import { BookView, FlowView, SheetView, SlidesView, type ViewHandle } from "./Views";

export interface ReaderProps {
    target: string;
    name: string;
    format: Format;
    prefs: Prefs;
    onPrefs: (p: Prefs) => void;
    load: () => Promise<Uint8Array>;
    onClose: () => void;
}

export function Reader({ target, name, format, prefs, onPrefs, load, onClose }: ReaderProps) {
    const [content, setContent] = useState<Content | null>(null);
    const [error, setError] = useState("");
    const [chrome, setChrome] = useState(true);
    const [status, setStatus] = useState("");
    const [panel, setPanel] = useState<"toc" | "text" | null>(null);
    const [start] = useState<Position | undefined>(() => positionOf(target));
    const view = useRef<ViewHandle>(null);
    const title = content?.kind === "book" ? content.book.title : content?.kind === "flow" && content.title ? content.title : name.replace(/\.[^.]+$/, "");

    useEffect(() => {
        let live = true;
        load().then((bytes) => loadContent(format, bytes)).then((c) => { if (live) setContent(c); },
            (e: Error) => { if (live) setError(e?.message || "This document cannot be opened."); });
        return () => { live = false; };
    }, [load, format]);

    const titleRef = useRef(title);
    titleRef.current = title;
    const onPosition = useCallback((p: Omit<Position, "at" | "title">) => {
        savePosition(target, { ...p, title: titleRef.current });
    }, [target]);

    const onTap = useCallback((zone: TapZone) => {
        // Turning a page by tapping its edge hides the bars, as e-readers do.
        if (zone === "left") { view.current?.turn(-1); setChrome(false); setPanel(null); }
        else if (zone === "right") { view.current?.turn(1); setChrome(false); setPanel(null); }
        else { setChrome((c) => !c); setPanel(null); }
    }, []);

    useBack(() => { setPanel(null); return true; }, panel !== null);

    // Arrow keys and Page Up/Down turn pages.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight" || e.key === "PageDown") view.current?.turn(1);
            else if (e.key === "ArrowLeft" || e.key === "PageUp") view.current?.turn(-1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const common = { prefs, start, onPosition, onStatus: setStatus, onTap };
    const toc = content?.kind === "book" ? flatToc(content.book.toc).filter((e) => e.chapter >= 0) : [];

    return (
        <div className={"dv-reader" + (prefs.night ? " night" : "") + (chrome ? " chrome" : "")} data-testid="reader">
            <div className="dv-content">
                {!content && !error && <div className="dv-loading"><Spinner large /></div>}
                {error && (
                    <div className="dv-error" role="alert" data-testid="reader-error">
                        <p>{error}</p>
                        <Button onClick={onClose}>Close</Button>
                    </div>
                )}
                {content?.kind === "book" && <BookView ref={view} book={content.book} {...common} />}
                {content?.kind === "flow" && <FlowView ref={view} html={content.html} className={content.className} {...common} />}
                {content?.kind === "sheets" && <SheetView ref={view} sheets={content.sheets} {...common} />}
                {content?.kind === "slides" && <SlidesView ref={view} presentation={content.presentation} {...common} />}
            </div>

            <div className="dv-top">
                <button type="button" className="dv-back" aria-label="Back" data-testid="reader-back" onClick={onClose} />
                <div className="dv-titles">
                    <div className="dv-title" data-testid="reader-title">{title}</div>
                    <div className="dv-sub">{content?.kind === "book" && content.book.author ? content.book.author : formatLabel(format)}</div>
                </div>
            </div>

            <div className="dv-bottom">
                <div className="dv-status" data-testid="reader-status">{status}</div>
                <Toolbar kind="dark" className="dv-toolbar">
                    <IconToolButton icon="list" label="Contents" testId="toc" disabled={!toc.length} depressed={panel === "toc"}
                                    onClick={() => setPanel(panel === "toc" ? null : "toc")} />
                    <ToolSpacer />
                    {content?.kind === "book" && <IconToolButton icon="prev" label="Previous page" testId="page-prev" onClick={() => view.current?.turn(-1)} />}
                    {content?.kind === "book" && <IconToolButton icon="next" label="Next page" testId="page-next" onClick={() => view.current?.turn(1)} />}
                    <ToolSpacer />
                    <IconToolButton icon="text-size" label="Text" testId="text-size" depressed={panel === "text"} disabled={!content || content.kind === "slides"}
                                    onClick={() => setPanel(panel === "text" ? null : "text")} />
                    <IconToolButton icon="moon" label={prefs.night ? "Day" : "Night"} testId="night" depressed={prefs.night}
                                    onClick={() => onPrefs({ ...prefs, night: !prefs.night })} />
                </Toolbar>
            </div>

            {panel === "toc" && (
                <div className="dv-panel dv-toc" data-testid="toc-panel">
                    <div className="dv-panel-head"><span>Contents</span>
                        <button type="button" aria-label="Close" onClick={() => setPanel(null)}><Glyph name="close" size={20} /></button>
                    </div>
                    <div className="dv-toc-list">
                        {toc.map((e, i) => (
                            <button type="button" key={i} className="dv-toc-item" style={{ paddingLeft: 16 + e.depth * 18 }} data-testid={`toc-${e.title}`}
                                    onClick={() => { view.current?.goTo(e.chapter, e.fragment); setPanel(null); }}>{e.title}</button>
                        ))}
                    </div>
                </div>
            )}
            {panel === "text" && (
                <div className="dv-panel dv-textpanel" data-testid="text-panel">
                    <div className="dv-size-row">
                        <button type="button" className="dv-size small" aria-label="Smaller text" data-testid="font-smaller"
                                disabled={prefs.fontScale <= 80} onClick={() => onPrefs({ ...prefs, fontScale: stepFont(prefs.fontScale, -1) })}>A</button>
                        <span className="dv-size-value" data-testid="font-scale">{prefs.fontScale}%</span>
                        <button type="button" className="dv-size big" aria-label="Larger text" data-testid="font-larger"
                                disabled={prefs.fontScale >= 200} onClick={() => onPrefs({ ...prefs, fontScale: stepFont(prefs.fontScale, 1) })}>A</button>
                    </div>
                    {content?.kind !== "sheets" && content?.kind !== "slides" && (
                        <div className="dv-font-row" role="radiogroup">
                            {(["book", "serif", "sans"] as const).map((f) => (
                                <button type="button" key={f} role="radio" aria-checked={prefs.font === f} data-testid={`font-${f}`}
                                        className={"dv-font " + f + (prefs.font === f ? " on" : "")} onClick={() => onPrefs({ ...prefs, font: f })}>
                                    {f === "book" ? "Original" : f === "serif" ? "Serif" : "Sans"}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
