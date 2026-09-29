// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The ZIP packages EPUB and Office Open XML files are (fflate, MIT), and
// the XML in them.

import { unzipSync, strFromU8 } from "fflate";

export class Package {
    readonly files: Record<string, Uint8Array>;
    private lower: Map<string, string>;

    constructor(data: Uint8Array) {
        this.files = unzipSync(data);
        this.lower = new Map(Object.keys(this.files).map((k) => [k.toLowerCase(), k]));
    }

    /** The entry's name as stored (ZIP names are matched without regard to case as a fallback). */
    private name(path: string): string | undefined {
        const p = path.replace(/^\/+/, "");
        return p in this.files ? p : this.lower.get(p.toLowerCase());
    }

    has(path: string): boolean {
        return this.name(path) !== undefined;
    }

    bytes(path: string): Uint8Array | undefined {
        const n = this.name(path);
        return n === undefined ? undefined : this.files[n];
    }

    text(path: string): string | undefined {
        const b = this.bytes(path);
        return b ? strFromU8(b).replace(/^﻿/, "") : undefined;
    }

    xml(path: string, type: DOMParserSupportedType = "application/xml"): Document | undefined {
        const t = this.text(path);
        if (t === undefined) return undefined;
        const doc = new DOMParser().parseFromString(t, type);
        return doc.getElementsByTagName("parsererror").length ? undefined : doc;
    }

    list(prefix = ""): string[] {
        return Object.keys(this.files).filter((k) => k.startsWith(prefix));
    }
}

/** "OEBPS/text/ch1.xhtml" + "../images/a.png" -> "OEBPS/images/a.png" (fragment and query dropped). */
export function resolveHref(base: string, href: string): string {
    const clean = href.replace(/[#?].*$/, "");
    let rel = clean;
    try { rel = decodeURIComponent(clean); } catch { /* keep */ }
    if (/^[a-z][a-z0-9+.-]*:/i.test(rel)) return rel;
    const parts = rel.startsWith("/") ? [] : base.split("/").slice(0, -1);
    for (const seg of rel.split("/")) {
        if (!seg || seg === ".") continue;
        if (seg === "..") parts.pop();
        else parts.push(seg);
    }
    return parts.join("/");
}

/** Elements by local name, whatever their namespace prefix ("dc:title", "a:t"). */
export function byLocal(root: Document | Element, name: string): Element[] {
    return Array.from(root.getElementsByTagName("*")).filter((e) => e.localName === name);
}

export function firstLocal(root: Document | Element, name: string): Element | undefined {
    return byLocal(root, name)[0];
}

/** Direct children by local name. */
export function childrenLocal(el: Element, name: string): Element[] {
    return Array.from(el.children).filter((e) => e.localName === name);
}

const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A relationship id attribute (r:id, r:embed), not a plain "id" beside it. */
export function relAttr(el: Element, name: "id" | "embed" | "link"): string | null {
    return el.getAttributeNS(R_NS, name) ?? el.getAttribute(`r:${name}`);
}

/** An attribute by local name ("r:id", "r:embed", "xlink:href"). */
export function attrLocal(el: Element, name: string): string | null {
    for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
    return null;
}

const MIME_BY_EXT: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
    css: "text/css", xhtml: "application/xhtml+xml", html: "text/html", ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
    emf: "image/emf", wmf: "image/wmf", bmp: "image/bmp",
};

export function mimeOfPath(path: string): string {
    return MIME_BY_EXT[(/\.([^.\/]+)$/.exec(path)?.[1] ?? "").toLowerCase()] ?? "application/octet-stream";
}

export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
