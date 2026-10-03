// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Reading Office Open XML (ECMA-376) spreadsheets and presentations.
//
// Word documents go through mammoth.js (BSD-2-Clause), which turns them
// into clean HTML (headings, lists, tables, emphasis, pictures). For Excel
// and PowerPoint there is no permissively licensed reader small enough for
// a phone app: SheetJS's npm release is years old (newer builds are only on
// its own CDN), and ExcelJS writes as much as it reads. So Doc View reads
// them itself, read-only:
//
//   xlsx: every sheet's cells as they were last calculated (formulas are
//         not recalculated), shared and inline strings, numbers with their
//         decimals, percentages, dates, merged cells and column widths.
//         Not: charts, pictures, conditional formats, fonts and fills.
//   pptx: each slide's text boxes where they sit (size, bold, italic,
//         colour, alignment, bullets), pictures, simple tables and a plain
//         background colour. Not: themes and master slide art, shapes other
//         than rectangles, charts, SmartArt, animations.

import { byLocal, childrenLocal, firstLocal, mimeOfPath, Package, relAttr, resolveHref } from "./zip";

// ---- Relationships ------------------------------------------------------------------------

/** A part's relationships: Id -> target path (resolved). */
export function relationships(pkg: Package, part: string): Map<string, string> {
    const dir = part.replace(/[^/]*$/, "");
    const rels = pkg.xml(`${dir}_rels/${part.slice(dir.length)}.rels`);
    const out = new Map<string, string>();
    if (!rels) return out;
    for (const r of byLocal(rels, "Relationship")) {
        const id = r.getAttribute("Id"), target = r.getAttribute("Target");
        if (!id || !target || r.getAttribute("TargetMode") === "External") continue;
        out.set(id, resolveHref(part, target));
    }
    return out;
}

// ---- Spreadsheets ------------------------------------------------------------------------

export interface Cell {
    text: string;
    /** Right-align numbers. */
    numeric?: boolean;
    bold?: boolean;
    colSpan?: number;
    rowSpan?: number;
    /** Covered by a merged cell to its top left: not drawn. */
    hidden?: boolean;
}

export interface Sheet {
    name: string;
    rows: Cell[][];
    /** Column widths in px. */
    widths: number[];
}

/** "B3" -> [row 2, col 1] */
export function cellRef(ref: string): [number, number] {
    const m = /^([A-Z]+)(\d+)$/i.exec(ref.trim());
    if (!m) return [-1, -1];
    let col = 0;
    for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
    return [Number(m[2]) - 1, col - 1];
}

/** Column letters for a 0-based column: 0 -> "A", 27 -> "AB". */
export function columnName(n: number): string {
    let s = "";
    for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
}

const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Is a number format a date or time? (Quoted text and [colour] codes aside.) */
export function isDateFormat(id: number, code?: string): boolean {
    if (DATE_FORMATS.has(id)) return true;
    if (!code) return false;
    const bare = code.replace(/"[^"]*"/g, "").replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, "").replace(/\\./g, "");
    return /[dmyhs]/i.test(bare) && !/[#0]/.test(bare.replace(/[dmyhs]/gi, ""));
}

/** Excel's serial day number (1900 system) -> a date. */
export function serialDate(n: number): Date {
    return new Date(Math.round((n - 25569) * 86400 * 1000));
}

export function formatNumber(v: number, id: number, code?: string): string {
    if (isDateFormat(id, code)) {
        const d = serialDate(v);
        const time = /h/i.test(code ?? "") || (id >= 18 && id <= 21);
        const date = !(id >= 18 && id <= 21) && !/^\[?h/i.test(code ?? "");
        const opts: Intl.DateTimeFormatOptions = { timeZone: "UTC" };
        if (date) Object.assign(opts, { year: "numeric", month: "short", day: "numeric" });
        if (time) Object.assign(opts, { hour: "numeric", minute: "2-digit" });
        return d.toLocaleString("en-US", opts);
    }
    const c = code ?? (id === 1 ? "0" : id === 2 ? "0.00" : id === 3 ? "#,##0" : id === 4 ? "#,##0.00" : id === 9 ? "0%" : id === 10 ? "0.00%" : "");
    if (!c || c === "General") {
        return String(Number.isInteger(v) ? v : Number(v.toPrecision(10)));
    }
    // "positive;negative;zero": a negative section shows the number without its sign.
    const sections = c.split(";");
    const neg = v < 0;
    const section = neg && sections[1] ? sections[1] : sections[0];
    const pct = section.includes("%");
    const decimals = (/\.([0#]+)/.exec(section)?.[1].length) ?? 0;
    const grouping = /#,##|0,0/.test(section);
    const s = Math.abs(pct ? v * 100 : v).toLocaleString("en-US", {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouping,
    });
    const prefix = (/^"([^"]*)"/.exec(section)?.[1]) ?? (/^\[\$([^\]-]+)/.exec(section)?.[1]) ?? (/^([$€£¥])/.exec(section)?.[1]) ?? "";
    const body = prefix + s + (pct ? "%" : "");
    if (!neg) return body;
    if (!sections[1]) return "-" + body;
    return /^\(/.test(section) ? `(${body})` : section.trim().startsWith("-") ? "-" + body : body;
}

function sharedStrings(pkg: Package, path: string | undefined): string[] {
    const doc = path ? pkg.xml(path) : undefined;
    if (!doc) return [];
    return byLocal(doc, "si").map((si) => {
        // Rich text runs, without phonetic hints.
        const ts = byLocal(si, "t").filter((t) => t.parentElement?.localName !== "rPh");
        return ts.map((t) => t.textContent ?? "").join("");
    });
}

interface CellStyle { numFmt: number; bold: boolean }

function styles(pkg: Package, path: string | undefined): { xfs: CellStyle[]; formats: Map<number, string> } {
    const doc = path ? pkg.xml(path) : undefined;
    const formats = new Map<number, string>();
    if (!doc) return { xfs: [], formats };
    for (const f of byLocal(doc, "numFmt")) formats.set(Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") ?? "");
    const fonts = (() => {
        const el = firstLocal(doc, "fonts");
        return el ? childrenLocal(el, "font").map((f) => childrenLocal(f, "b").length > 0 && childrenLocal(f, "b")[0].getAttribute("val") !== "0") : [];
    })();
    const cellXfs = firstLocal(doc, "cellXfs");
    const xfs = cellXfs ? childrenLocal(cellXfs, "xf").map((x) => ({
        numFmt: Number(x.getAttribute("numFmtId") ?? 0),
        bold: !!fonts[Number(x.getAttribute("fontId") ?? 0)],
    })) : [];
    return { xfs, formats };
}

const MAX_ROWS = 2000, MAX_COLS = 100;

export function parseXlsx(data: Uint8Array): Sheet[] {
    const pkg = new Package(data);
    const wbPath = relationships(pkg, "").size ? [...relationships(pkg, "").values()].find((p) => /workbook\.xml$/.test(p)) ?? "xl/workbook.xml" : "xl/workbook.xml";
    const wb = pkg.xml(wbPath);
    if (!wb) throw new Error("This is not an Excel workbook.");
    const rels = relationships(pkg, wbPath);
    const relOfType = (re: RegExp) => [...rels.values()].find((p) => re.test(p));
    const strings = sharedStrings(pkg, relOfType(/sharedStrings\.xml$/i));
    const { xfs, formats } = styles(pkg, relOfType(/styles\.xml$/i));

    return byLocal(wb, "sheet").map((sh) => {
        const name = sh.getAttribute("name") ?? "Sheet";
        const path = rels.get(relAttr(sh, "id") ?? "") ?? "";
        const doc = pkg.xml(path);
        const rows: Cell[][] = [];
        const widths: number[] = [];
        if (!doc) return { name, rows, widths };
        for (const c of byLocal(doc, "col")) {
            const min = Number(c.getAttribute("min")), max = Math.min(Number(c.getAttribute("max")), MAX_COLS);
            const w = Math.round(Number(c.getAttribute("width") ?? 8.43) * 7 + 5);
            for (let i = min; i <= max; ++i) widths[i - 1] = w;
        }
        let nextRow = 0;
        for (const r of byLocal(doc, "row")) {
            const ri = r.getAttribute("r") ? Number(r.getAttribute("r")) - 1 : nextRow;
            nextRow = ri + 1;
            if (ri >= MAX_ROWS) break;
            let nextCol = 0;
            for (const c of childrenLocal(r, "c")) {
                const [, ci0] = c.getAttribute("r") ? cellRef(c.getAttribute("r")!) : [ri, nextCol];
                const ci = ci0 < 0 ? nextCol : ci0;
                nextCol = ci + 1;
                if (ci >= MAX_COLS) continue;
                const t = c.getAttribute("t") ?? "n";
                const v = childrenLocal(c, "v")[0]?.textContent ?? "";
                const style = xfs[Number(c.getAttribute("s") ?? 0)] ?? { numFmt: 0, bold: false };
                let text = "", numeric = false;
                if (t === "s") text = strings[Number(v)] ?? "";
                else if (t === "inlineStr") text = byLocal(c, "t").map((x) => x.textContent ?? "").join("");
                else if (t === "str") text = v;
                else if (t === "b") text = v === "1" ? "TRUE" : "FALSE";
                else if (t === "e") text = v;
                else if (v !== "") {
                    const n = Number(v);
                    text = isFinite(n) ? formatNumber(n, style.numFmt, formats.get(style.numFmt)) : v;
                    numeric = !isDateFormat(style.numFmt, formats.get(style.numFmt));
                }
                (rows[ri] ??= [])[ci] = { text, numeric, bold: style.bold };
            }
        }
        for (const m of byLocal(doc, "mergeCell")) {
            const [a, b] = (m.getAttribute("ref") ?? "").split(":");
            const [r0, c0] = cellRef(a ?? ""), [r1, c1] = cellRef(b ?? a ?? "");
            if (r0 < 0 || r1 < r0 || c1 < c0 || r0 >= MAX_ROWS || c0 >= MAX_COLS) continue;
            for (let r = r0; r <= Math.min(r1, MAX_ROWS - 1); ++r)
                for (let c = c0; c <= Math.min(c1, MAX_COLS - 1); ++c)
                    (rows[r] ??= [])[c] = r === r0 && c === c0
                        ? { ...(rows[r][c] ?? { text: "" }), rowSpan: r1 - r0 + 1, colSpan: c1 - c0 + 1 }
                        : { text: "", hidden: true };
        }
        // Fill the gaps so every row is a plain array.
        const cols = rows.reduce((n, r) => Math.max(n, r?.length ?? 0), 0);
        for (let i = 0; i < rows.length; ++i) {
            const row = rows[i] ?? [];
            for (let j = 0; j < cols; ++j) row[j] ??= { text: "" };
            rows[i] = row;
        }
        return { name, rows, widths };
    });
}

// ---- Presentations -------------------------------------------------------------------------

export interface Run {
    text: string;
    /** Points. */
    size?: number;
    bold?: boolean;
    italic?: boolean;
    color?: string;
}

export interface Paragraph {
    runs: Run[];
    align?: "left" | "center" | "right" | "justify";
    bullet?: string;
    level: number;
}

export interface Box {
    /** Fractions of the slide (0..1). */
    x: number; y: number; w: number; h: number;
}

export type SlideItem =
    | (Box & { kind: "text"; paragraphs: Paragraph[]; fill?: string; anchor?: "t" | "ctr" | "b" })
    | (Box & { kind: "picture"; path: string; mime: string })
    | (Box & { kind: "table"; rows: string[][] });

export interface Slide {
    background?: string;
    items: SlideItem[];
}

export interface Presentation {
    /** Width / height. */
    aspect: number;
    /** The slide height in points (font sizes are in points). */
    heightPt: number;
    slides: Slide[];
    pkg: Package;
}

function color(el: Element | undefined): string | undefined {
    const fill = el && childrenLocal(el, "solidFill")[0];
    const rgb = fill && childrenLocal(fill, "srgbClr")[0]?.getAttribute("val");
    return rgb && /^[0-9a-f]{6}$/i.test(rgb) ? "#" + rgb : undefined;
}

const ALIGN: Record<string, Paragraph["align"]> = { l: "left", ctr: "center", r: "right", just: "justify" };

function paragraphs(txBody: Element): Paragraph[] {
    return childrenLocal(txBody, "p").map((p) => {
        const pPr = childrenLocal(p, "pPr")[0];
        const runs: Run[] = [];
        for (const r of Array.from(p.children)) {
            if (r.localName === "br") { runs.push({ text: "\n" }); continue; }
            if (r.localName !== "r" && r.localName !== "fld") continue;
            const rPr = childrenLocal(r, "rPr")[0];
            const sz = rPr?.getAttribute("sz");
            runs.push({
                text: childrenLocal(r, "t")[0]?.textContent ?? "",
                size: sz ? Number(sz) / 100 : undefined,
                bold: rPr?.getAttribute("b") === "1",
                italic: rPr?.getAttribute("i") === "1",
                color: color(rPr),
            });
        }
        const bu = pPr && (childrenLocal(pPr, "buChar")[0]?.getAttribute("char") ?? (childrenLocal(pPr, "buAutoNum")[0] ? "#" : undefined));
        return { runs, align: ALIGN[pPr?.getAttribute("algn") ?? ""], bullet: bu ?? undefined, level: Number(pPr?.getAttribute("lvl") ?? 0) };
    });
}

type Frame = { ox: number; oy: number; sx: number; sy: number };

function box(el: Element, frame: Frame, sw: number, sh: number): Box | null {
    const xfrm = firstLocal(el, "xfrm");
    const off = xfrm && childrenLocal(xfrm, "off")[0], ext = xfrm && childrenLocal(xfrm, "ext")[0];
    if (!off || !ext) return null;
    const x = frame.ox + Number(off.getAttribute("x")) * frame.sx, y = frame.oy + Number(off.getAttribute("y")) * frame.sy;
    return { x: x / sw, y: y / sh, w: (Number(ext.getAttribute("cx")) * frame.sx) / sw, h: (Number(ext.getAttribute("cy")) * frame.sy) / sh };
}

/** Where a placeholder without its own position goes (the usual title and body areas). */
function placeholderBox(el: Element): Box {
    const type = firstLocal(el, "ph")?.getAttribute("type") ?? "body";
    if (type === "title" || type === "ctrTitle") return { x: 0.06, y: 0.06, w: 0.88, h: 0.18 };
    if (type === "subTitle") return { x: 0.12, y: 0.5, w: 0.76, h: 0.2 };
    return { x: 0.06, y: 0.26, w: 0.88, h: 0.66 };
}

export function parsePptx(data: Uint8Array): Presentation {
    const pkg = new Package(data);
    const presPath = [...relationships(pkg, "").values()].find((p) => /presentation\.xml$/.test(p)) ?? "ppt/presentation.xml";
    const pres = pkg.xml(presPath);
    if (!pres) throw new Error("This is not a PowerPoint presentation.");
    const size = firstLocal(pres, "sldSz");
    const sw = Number(size?.getAttribute("cx") ?? 9144000), sh = Number(size?.getAttribute("cy") ?? 6858000);
    const rels = relationships(pkg, presPath);
    const slides: Slide[] = [];
    for (const id of byLocal(pres, "sldId")) {
        const path = rels.get(relAttr(id, "id") ?? "");
        const doc = path ? pkg.xml(path) : undefined;
        if (!doc || !path) continue;
        const srels = relationships(pkg, path);
        const items: SlideItem[] = [];
        const walk = (parent: Element, frame: Frame) => {
            for (const el of Array.from(parent.children)) {
                if (el.localName === "sp") {
                    const tx = childrenLocal(el, "txBody")[0];
                    const paras = tx ? paragraphs(tx) : [];
                    const spPr = childrenLocal(el, "spPr")[0];
                    const fill = color(spPr);
                    if (!paras.some((p) => p.runs.some((r) => r.text.trim())) && !fill) continue;
                    const b = box(el, frame, sw, sh) ?? placeholderBox(el);
                    const anchor = tx && childrenLocal(tx, "bodyPr")[0]?.getAttribute("anchor");
                    items.push({ kind: "text", ...b, paragraphs: paras, fill, anchor: anchor === "ctr" || anchor === "b" ? anchor : "t" });
                } else if (el.localName === "pic") {
                    const blip = firstLocal(el, "blip");
                    const target = blip && srels.get(relAttr(blip, "embed") ?? "");
                    const b = box(el, frame, sw, sh);
                    if (target && b && pkg.has(target)) items.push({ kind: "picture", ...b, path: target, mime: mimeOfPath(target) });
                } else if (el.localName === "graphicFrame") {
                    const tbl = firstLocal(el, "tbl");
                    const b = box(el, frame, sw, sh);
                    if (tbl && b) items.push({
                        kind: "table", ...b,
                        rows: byLocal(tbl, "tr").map((tr) => childrenLocal(tr, "tc").map((tc) => byLocal(tc, "t").map((t) => t.textContent ?? "").join(" "))),
                    });
                } else if (el.localName === "grpSp") {
                    const xfrm = firstLocal(childrenLocal(el, "grpSpPr")[0] ?? el, "xfrm");
                    const at = (n: string, a: string) => Number(xfrm && childrenLocal(xfrm, n)[0]?.getAttribute(a) || 0);
                    const cx = at("chExt", "cx") || 1, cy = at("chExt", "cy") || 1;
                    const sx = (at("ext", "cx") / cx) || 1, sy = (at("ext", "cy") / cy) || 1;
                    walk(el, {
                        ox: frame.ox + (at("off", "x") - at("chOff", "x") * sx) * frame.sx,
                        oy: frame.oy + (at("off", "y") - at("chOff", "y") * sy) * frame.sy,
                        sx: frame.sx * sx, sy: frame.sy * sy,
                    });
                }
            }
        };
        const tree = firstLocal(doc, "spTree");
        if (tree) walk(tree, { ox: 0, oy: 0, sx: 1, sy: 1 });
        const bgPr = firstLocal(doc, "bgPr");
        slides.push({ background: color(bgPr), items });
    }
    return { aspect: sw / sh, heightPt: sh / 12700, slides, pkg };
}

/** All the text of a slide, for a quick outline or a search. */
export function slideText(s: Slide): string {
    return s.items.map((i) => (i.kind === "text" ? i.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n") : i.kind === "table" ? i.rows.map((r) => r.join(" ")).join("\n") : "")).filter(Boolean).join("\n");
}
