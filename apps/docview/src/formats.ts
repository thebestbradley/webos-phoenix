// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What Doc View reads, and turning each into something to show:
//
//   EPUB             a book, a chapter at a time, in pages (epub.ts)
//   Word (.docx)     mammoth.js -> HTML, scrolled
//   Markdown         marked (MIT) -> HTML, cleaned by DOMPurify, scrolled
//   Plain text       paragraphs, scrolled
//   Excel (.xlsx)    sheets of cells (office.ts)
//   PowerPoint       slides (office.ts)
//
// Older binary Office files (.doc, .xls, .ppt) and OpenDocument are not
// read; Doc View says so.

import DOMPurify from "dompurify";
import { marked } from "marked";
import { parseEpub, type Book } from "./epub";
import { parsePptx, parseXlsx, type Presentation, type Sheet } from "./office";
import { escapeHtml } from "./zip";

export type Format = "epub" | "docx" | "xlsx" | "pptx" | "markdown" | "text" | "unsupported";

const BY_EXT: Record<string, Format> = {
    epub: "epub", docx: "docx", xlsx: "xlsx", pptx: "pptx",
    md: "markdown", markdown: "markdown", txt: "text", text: "text", log: "text", csv: "text",
};
const BY_MIME: Record<string, Format> = {
    "application/epub+zip": "epub",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "text/markdown": "markdown", "text/plain": "text", "text/csv": "text",
};

/** The extensions Doc View lists and opens. */
export const EXTENSIONS = ["epub", "docx", "xlsx", "pptx", "md", "markdown", "txt"];

export function formatOf(name: string, mime?: string): Format {
    const ext = (/\.([^./]+)$/.exec(name.replace(/[?#].*$/, ""))?.[1] ?? "").toLowerCase();
    return BY_EXT[ext] ?? (mime ? BY_MIME[mime.split(";")[0].trim().toLowerCase()] : undefined) ?? "unsupported";
}

export function isBook(f: Format): boolean {
    return f === "epub";
}

export function formatLabel(f: Format): string {
    return { epub: "E-book", docx: "Word document", xlsx: "Excel spreadsheet", pptx: "PowerPoint presentation",
             markdown: "Markdown", text: "Text", unsupported: "Document" }[f];
}

export type Content =
    | { kind: "book"; book: Book }
    | { kind: "flow"; html: string; title?: string; className: string }
    | { kind: "sheets"; sheets: Sheet[] }
    | { kind: "slides"; presentation: Presentation };

function decodeText(bytes: Uint8Array): string {
    // UTF-8, or UTF-16 with a byte order mark; anything else as Windows-1252.
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
    } catch {
        return new TextDecoder("windows-1252").decode(bytes);
    }
}

/** Plain text as paragraphs (blank lines between them), lines kept. */
export function textToHtml(text: string): string {
    return text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.trim() ? `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>` : "").join("\n");
}

export function markdownToHtml(text: string): string {
    const html = marked.parse(text, { async: false, gfm: true }) as string;
    return clean(html);
}

export function clean(html: string): string {
    return DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "form", "iframe", "object", "embed"], ADD_ATTR: ["target"] });
}

function decodeEntities(s: string): string {
    const t = document.createElement("textarea");
    t.innerHTML = s;
    return t.value;
}

/** The first heading or line, as a title. */
export function firstLine(text: string): string | undefined {
    const line = text.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l);
    return line ? line.slice(0, 80) : undefined;
}

export async function loadContent(format: Format, bytes: Uint8Array): Promise<Content> {
    switch (format) {
        case "epub":
            return { kind: "book", book: parseEpub(bytes) };
        case "xlsx":
            return { kind: "sheets", sheets: parseXlsx(bytes) };
        case "pptx":
            return { kind: "slides", presentation: parsePptx(bytes) };
        case "docx": {
            // mammoth is large; load it only for Word files.
            const mammoth = (await import("mammoth")).default;
            const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            // The browser build reads an ArrayBuffer; the Node one (the unit tests) a Buffer.
            const NodeBuffer = (globalThis as { Buffer?: { from(b: ArrayBuffer): unknown } }).Buffer;
            const input = (NodeBuffer ? { arrayBuffer: buf, buffer: NodeBuffer.from(buf) } : { arrayBuffer: buf }) as { arrayBuffer: ArrayBuffer };
            const r = await mammoth.convertToHtml(input, {
                externalFileAccess: false,
                styleMap: ["p[style-name='Title'] => h1.title:fresh", "p[style-name='Subtitle'] => p.subtitle:fresh"],
            });
            const html = clean(r.value);
            const title = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim();
            return { kind: "flow", html, title: title ? decodeEntities(title) : undefined, className: "docx" };
        }
        case "markdown": {
            const text = decodeText(bytes);
            return { kind: "flow", html: markdownToHtml(text), title: firstLine(text), className: "markdown" };
        }
        case "text": {
            const text = decodeText(bytes);
            return { kind: "flow", html: textToHtml(text), className: "text" };
        }
        default:
            throw new Error("Doc View cannot read this kind of file.");
    }
}
