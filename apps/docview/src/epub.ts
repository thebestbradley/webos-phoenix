// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// EPUB 2 and 3 (IDPF/W3C): META-INF/container.xml names the package
// document; its manifest lists the files, the spine their reading order,
// and the navigation document (EPUB 3 nav, or the EPUB 2 NCX) the table of
// contents. Each chapter is an XHTML file shown on its own, with its
// stylesheets inlined and its pictures as blob: URLs, after DOMPurify has
// taken out anything active (the reader's frame runs no scripts either).
//
// Written for Phoenix rather than taken from epub.js (BSD-2-Clause, last
// released in 2022, pulling in old xmldom and localforage) or foliate-js
// (MIT, not published by its author; the npm copy is a third party's):
// this is the small part of them a phone reader needs.

import DOMPurify from "dompurify";
import { attrLocal, byLocal, childrenLocal, escapeHtml, firstLocal, mimeOfPath, Package, resolveHref } from "./zip";

export interface TocEntry {
    title: string;
    /** Index into the spine, or -1 if the target is not in it. */
    chapter: number;
    /** Element id to go to in the chapter, if any. */
    fragment?: string;
    children: TocEntry[];
}

export interface SpineItem {
    path: string;
    linear: boolean;
}

export interface Book {
    title: string;
    author: string;
    language?: string;
    /** Path of the cover picture in the package, if any. */
    cover?: string;
    spine: SpineItem[];
    toc: TocEntry[];
    pkg: Package;
}

export interface Chapter {
    /** Sanitised body markup. */
    html: string;
    /** The chapter's stylesheets, inlined, with their url()s pointing at blob: URLs. */
    css: string;
    lang?: string;
    bodyClass?: string;
}

/** A URL for a file in the package (blob: in the app; anything in tests). */
export type UrlFor = (path: string) => string;

export class EpubError extends Error {}

export function parseEpub(data: Uint8Array): Book {
    let pkg: Package;
    try { pkg = new Package(data); } catch { throw new EpubError("This is not an EPUB file (not a ZIP package)."); }
    const container = pkg.xml("META-INF/container.xml");
    const rootfile = container && firstLocal(container, "rootfile")?.getAttribute("full-path");
    if (!rootfile) throw new EpubError("This EPUB has no package document (META-INF/container.xml).");
    const opf = pkg.xml(rootfile);
    if (!opf) throw new EpubError(`This EPUB's package document (${rootfile}) cannot be read.`);

    const manifest = new Map<string, { path: string; type: string; props: string[] }>();
    for (const item of byLocal(opf, "item")) {
        const id = item.getAttribute("id"), href = item.getAttribute("href");
        if (!id || !href) continue;
        manifest.set(id, { path: resolveHref(rootfile, href), type: item.getAttribute("media-type") ?? "", props: (item.getAttribute("properties") ?? "").split(/\s+/) });
    }
    const spineEl = firstLocal(opf, "spine");
    const spine: SpineItem[] = [];
    for (const ref of spineEl ? childrenLocal(spineEl, "itemref") : []) {
        const it = manifest.get(ref.getAttribute("idref") ?? "");
        if (it && pkg.has(it.path)) spine.push({ path: it.path, linear: ref.getAttribute("linear") !== "no" });
    }
    if (!spine.length) throw new EpubError("This EPUB has no chapters.");

    const meta = (name: string) => firstLocal(opf, name)?.textContent?.trim() ?? "";
    let cover = [...manifest.values()].find((m) => m.props.includes("cover-image"))?.path;
    if (!cover) {
        const id = byLocal(opf, "meta").find((m) => m.getAttribute("name") === "cover")?.getAttribute("content");
        if (id) cover = manifest.get(id)?.path;
    }

    const chapterOf = (path: string) => spine.findIndex((s) => s.path === path);
    const entry = (base: string, title: string, href: string, children: TocEntry[]): TocEntry => {
        const target = resolveHref(base, href);
        const frag = /#(.+)$/.exec(href)?.[1];
        return { title: title.replace(/\s+/g, " ").trim(), chapter: chapterOf(target), fragment: frag, children };
    };

    let toc: TocEntry[] = [];
    const nav = [...manifest.values()].find((m) => m.props.includes("nav"));
    const navDoc = nav && (pkg.xml(nav.path, "application/xhtml+xml") ?? pkg.xml(nav.path, "text/html"));
    if (navDoc && nav) {
        const tocNav = byLocal(navDoc, "nav").find((n) => (attrLocal(n, "type") ?? "").split(/\s+/).includes("toc")) ?? byLocal(navDoc, "nav")[0];
        const walkOl = (ol: Element | undefined): TocEntry[] => !ol ? [] : childrenLocal(ol, "li").map((li) => {
            const a = childrenLocal(li, "a")[0] ?? childrenLocal(li, "span")[0];
            return entry(nav.path, a?.textContent ?? "", a?.getAttribute("href") ?? "", walkOl(childrenLocal(li, "ol")[0]));
        }).filter((e) => e.title);
        if (tocNav) toc = walkOl(childrenLocal(tocNav, "ol")[0]);
    }
    if (!toc.length) {
        const ncxId = spineEl?.getAttribute("toc");
        const ncx = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find((m) => m.type === "application/x-dtbncx+xml");
        const ncxDoc = ncx && pkg.xml(ncx.path);
        if (ncxDoc && ncx) {
            const walk = (el: Element): TocEntry[] => childrenLocal(el, "navPoint").map((np) => {
                const label = firstLocal(childrenLocal(np, "navLabel")[0] ?? np, "text")?.textContent ?? "";
                const src = childrenLocal(np, "content")[0]?.getAttribute("src") ?? "";
                return entry(ncx.path, label, src, walk(np));
            });
            const map = firstLocal(ncxDoc, "navMap");
            if (map) toc = walk(map);
        }
    }

    return { title: meta("title") || "Untitled", author: meta("creator"), language: meta("language") || undefined, cover, spine, toc, pkg };
}

// ---- Chapters ------------------------------------------------------------------------

const URI_OK = /^(?:(?:https?|mailto|blob|data):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** url(...) in CSS from `base`, pointing at package files; remote ones are dropped (no tracking). */
export function rewriteCss(css: string, base: string, urlFor: UrlFor, pkg: Package): string {
    return css
        .replace(/@import[^;]+;/gi, "")
        .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, _q, u: string) => {
            if (/^data:/i.test(u)) return `url("${u}")`;
            if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return "none";
            const p = resolveHref(base, u);
            return pkg.has(p) ? `url("${urlFor(p)}")` : "none";
        })
        // Books must not fight the reader's own layout.
        .replace(/position\s*:\s*fixed/gi, "position: static");
}

export function chapterContent(book: Book, index: number, urlFor: UrlFor): Chapter {
    const { pkg } = book;
    const path = book.spine[index]?.path;
    if (!path) return { html: "", css: "" };
    const doc = pkg.xml(path, "application/xhtml+xml") ?? new DOMParser().parseFromString(pkg.text(path) ?? "", "text/html");
    let css = "";
    for (const el of Array.from(doc.querySelectorAll("link, style"))) {
        if (el.localName === "link") {
            if (!/stylesheet/i.test(el.getAttribute("rel") ?? "")) continue;
            const p = resolveHref(path, el.getAttribute("href") ?? "");
            const text = pkg.text(p);
            if (text) css += rewriteCss(text, p, urlFor, pkg) + "\n";
        } else {
            css += rewriteCss(el.textContent ?? "", path, urlFor, pkg) + "\n";
        }
    }
    const body = doc.querySelector("body") ?? doc.documentElement;
    // Pictures and media from the package.
    const src = (el: Element, attr: string) => {
        const v = el.getAttribute(attr);
        if (!v || /^(data|https?|blob):/i.test(v)) return;
        const p = resolveHref(path, v);
        if (pkg.has(p)) el.setAttribute(attr, urlFor(p));
        else el.removeAttribute(attr);
    };
    body.querySelectorAll("img, source, video, audio, input[type=image]").forEach((el) => src(el, "src"));
    byLocal(body, "image").forEach((el) => {
        const href = el.getAttribute("href") ?? attrLocal(el, "href");
        if (!href) return;
        const p = resolveHref(path, href);
        if (pkg.has(p)) { el.setAttribute("href", urlFor(p)); el.removeAttributeNS("http://www.w3.org/1999/xlink", "href"); }
    });
    // Links to other chapters become in-book links the reader follows.
    body.querySelectorAll("a[href]").forEach((a) => {
        const href = a.getAttribute("href")!;
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); return; }
        const target = href.startsWith("#") ? path + href : resolveHref(path, href) + (/#.+$/.exec(href)?.[0] ?? "");
        a.setAttribute("data-book-href", target);
        a.setAttribute("href", "#");
    });
    const markup = body.innerHTML;
    const html = DOMPurify.sanitize(markup, {
        ALLOWED_URI_REGEXP: URI_OK,
        ADD_ATTR: ["data-book-href", "epub:type", "target"],
        FORBID_TAGS: ["style", "link", "script", "iframe", "object", "embed", "form", "base", "meta"],
        ADD_DATA_URI_TAGS: ["image"],
    });
    const lang = doc.documentElement.getAttribute("xml:lang") ?? doc.documentElement.getAttribute("lang") ?? book.language;
    return { html, css, lang: lang ?? undefined, bodyClass: body.getAttribute("class") ?? undefined };
}

/** blob: URLs for a book's files, made once each; revoke() frees them. */
export function blobUrls(pkg: Package): { urlFor: UrlFor; revoke(): void } {
    const made = new Map<string, string>();
    return {
        urlFor(path: string) {
            let u = made.get(path);
            if (!u) {
                const bytes = pkg.bytes(path);
                u = bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeOfPath(path) })) : "";
                made.set(path, u);
            }
            return u;
        },
        revoke() { made.forEach((u) => { if (u) URL.revokeObjectURL(u); }); made.clear(); },
    };
}

/** The table of contents flattened, with depth, for a list. */
export function flatToc(toc: TocEntry[], depth = 0): (TocEntry & { depth: number })[] {
    return toc.flatMap((e) => [{ ...e, depth }, ...flatToc(e.children, depth + 1)]);
}

/** The title of the chapter at `index` from the table of contents, if it has one. */
export function chapterTitle(book: Book, index: number): string {
    const hit = flatToc(book.toc).filter((e) => e.chapter === index && !e.fragment)[0] ?? flatToc(book.toc).find((e) => e.chapter === index);
    return hit ? hit.title : "";
}

export { escapeHtml };
