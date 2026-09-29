// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// PDF.js (Mozilla, Apache-2.0; pdfjs-dist) behind a small interface. The
// "legacy" build of PDF.js 4.10 is used: it is transpiled and polyfilled
// for older Chromium, which is what Qt WebEngine 6.4 (phoenix-sim,
// Chromium 102) and OSE's web runtime have. PDF.js 5 and 6 need newer
// browsers even in their legacy builds (Promise.withResolvers and more
// are no longer polyfilled). Its worker, standard fonts and CMaps are
// copied next to the app by vite.config.ts and loaded from there;
// nothing is fetched from the network.

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { pageText, type ItemPart, type PageText } from "./search";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

const asset = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;

export interface Outline {
    title: string;
    page: number;
    items: Outline[];
}

export class PdfDocument {
    readonly doc: PDFDocumentProxy;
    private task: { destroy(): Promise<void> } | null = null;
    private texts = new Map<number, Promise<PageText>>();
    private pages = new Map<number, Promise<PDFPageProxy>>();

    private constructor(doc: PDFDocumentProxy) {
        this.doc = doc;
    }

    /** Open from bytes. `password` asks for one (a PasswordException has code 1 or 2). */
    static async open(data: Uint8Array, password?: string): Promise<PdfDocument> {
        const task = pdfjs.getDocument({
            data,
            password,
            cMapUrl: asset("cmaps"),
            cMapPacked: true,
            standardFontDataUrl: asset("standard_fonts"),
            // PDF.js 5+ evaluates nothing; 4.x may compile font programs unless told not to.
            isEvalSupported: false,
            enableXfa: false,
        });
        const d = new PdfDocument(await task.promise);
        d.task = task;
        return d;
    }

    get numPages(): number {
        return this.doc.numPages;
    }

    page(n: number): Promise<PDFPageProxy> {
        let p = this.pages.get(n);
        if (!p) this.pages.set(n, (p = this.doc.getPage(n + 1)));
        return p;
    }

    /** The page's size in PDF points at scale 1 (turned as it is shown). */
    async size(n: number): Promise<{ width: number; height: number }> {
        const vp = (await this.page(n)).getViewport({ scale: 1 });
        return { width: vp.width, height: vp.height };
    }

    /** Draw page n on the canvas at `scale` (CSS px per point) for a screen of `dpr`. */
    render(n: number, canvas: HTMLCanvasElement, scale: number, dpr = window.devicePixelRatio || 1): { promise: Promise<void>; cancel(): void } {
        let task: { promise: Promise<void>; cancel(): void } | null = null;
        let cancelled = false;
        const promise = this.page(n).then((page) => {
            if (cancelled) return;
            const vp = page.getViewport({ scale: scale * dpr });
            canvas.width = Math.floor(vp.width);
            canvas.height = Math.floor(vp.height);
            task = page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp });
            return task.promise;
        });
        return {
            promise: promise.catch((e: { name?: string }) => { if (e?.name !== "RenderingCancelledException") throw e; }),
            cancel() { cancelled = true; task?.cancel(); },
        };
    }

    /** The page's text, for search. */
    text(n: number): Promise<PageText> {
        let t = this.texts.get(n);
        if (!t) {
            t = this.page(n).then((p) => p.getTextContent()).then((c) =>
                pageText(c.items.map((i) => ("str" in i ? { str: i.str, hasEOL: i.hasEOL } : { str: "" }))));
            this.texts.set(n, t);
        }
        return t;
    }

    /**
     * Rectangles (CSS px at `scale`, from the page's top left) of parts of
     * text items on page n, to highlight a match (an item's width is
     * shared out evenly between its characters).
     */
    async itemRects(n: number, parts: ItemPart[], scale: number): Promise<{ x: number; y: number; w: number; h: number }[]> {
        const page = await this.page(n);
        const vp = page.getViewport({ scale });
        const content = await page.getTextContent();
        const out: { x: number; y: number; w: number; h: number }[] = [];
        for (const part of parts) {
            const it = content.items[part.item];
            if (!it || !("transform" in it)) continue;
            const tx = pdfjs.Util.transform(vp.transform, it.transform);
            const h = Math.hypot(tx[2], tx[3]);
            const w = it.width * scale;
            out.push({ x: tx[4] + w * part.from, y: tx[5] - h, w: w * (part.to - part.from), h: h * 1.15 });
        }
        return out;
    }

    async title(): Promise<string | undefined> {
        try {
            const m = await this.doc.getMetadata();
            const t = (m.info as { Title?: string } | undefined)?.Title;
            return typeof t === "string" && t.trim() ? t.trim() : undefined;
        } catch {
            return undefined;
        }
    }

    /** The document's bookmarks, with 0-based pages. */
    async outline(): Promise<Outline[]> {
        const raw = await this.doc.getOutline().catch(() => null);
        if (!raw) return [];
        const walk = async (items: typeof raw): Promise<Outline[]> => Promise.all(items.map(async (o) => {
            let page = -1;
            try {
                const dest = typeof o.dest === "string" ? await this.doc.getDestination(o.dest) : o.dest;
                if (dest && dest[0]) page = await this.doc.getPageIndex(dest[0] as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
            } catch { /* no page */ }
            return { title: o.title, page, items: await walk(o.items ?? []) };
        }));
        return walk(raw);
    }

    destroy(): void {
        void this.task?.destroy();
    }
}

/** A PDF.js PasswordException: 1 needs a password, 2 the password was wrong. */
export function passwordNeeded(e: unknown): 0 | 1 | 2 {
    const x = e as { name?: string; code?: number };
    if (x?.name !== "PasswordException") return 0;
    return x.code === 2 ? 2 : 1;
}
