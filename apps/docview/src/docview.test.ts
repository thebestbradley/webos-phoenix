// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Reading the demo documents (apps/media-samples/media/documents) and a few
// made up here for the corner cases.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { chapterContent, chapterTitle, flatToc, parseEpub, rewriteCss } from "./epub";
import { formatOf, loadContent, markdownToHtml, textToHtml } from "./formats";
import { frameDocument, readerCss } from "./Frame";
import { DEFAULT_PREFS, fractionFromPage, loadPrefs, pageFromFraction, percentRead, positionOf, savePosition, savePrefs, stepFont } from "./library";
import { cellRef, columnName, formatNumber, isDateFormat, parsePptx, parseXlsx, slideText } from "./office";
import { Package, resolveHref } from "./zip";

const DOCS = resolve(__dirname, "../../media-samples/media/documents");
const sample = (name: string) => new Uint8Array(readFileSync(resolve(DOCS, name)));
const urlFor = (p: string) => `blob:test/${p}`;

describe("formats", () => {
    it("tells formats by extension, then MIME type", () => {
        expect(formatOf("Book.EPUB")).toBe("epub");
        expect(formatOf("notes.md")).toBe("markdown");
        expect(formatOf("https://example.org/report.docx?dl=1")).toBe("docx");
        expect(formatOf("attachment", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("xlsx");
        expect(formatOf("old.doc")).toBe("unsupported");
    });

    it("turns text into paragraphs and cleans Markdown", () => {
        expect(textToHtml("one\nline two\n\n<b>three</b>")).toBe("<p>one<br>line two</p>\n<p>&lt;b&gt;three&lt;/b&gt;</p>");
        const html = markdownToHtml("# Hi\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n| a | b |\n|---|---|\n| 1 | 2 |");
        expect(html).toContain("<h1>Hi</h1>");
        expect(html).not.toMatch(/script|onerror/);
        expect(html).toContain("<table>");
    });

    it("converts the demo Word document with mammoth.js", async () => {
        const c = await loadContent("docx", sample("meeting-notes.docx"));
        expect(c.kind).toBe("flow");
        if (c.kind !== "flow") return;
        expect(c.title).toBe("Harbor Festival: planning meeting");
        expect(c.html).toContain("<h1>Decisions</h1>");
        expect(c.html).toMatch(/<table>.*Book the ferry/s);
        expect((c.html.match(/<li>/g) ?? []).length).toBe(3);
    });
});

describe("EPUB", () => {
    it("reads the demo book's metadata, spine, contents and cover", () => {
        const book = parseEpub(sample("the-lighthouse-cat.epub"));
        expect(book.title).toBe("The Lighthouse Cat");
        expect(book.author).toBe("webOS Phoenix contributors");
        expect(book.language).toBe("en");
        expect(book.cover).toBe("OEBPS/images/cover.jpg");
        expect(book.spine.map((s) => s.path)).toEqual(["OEBPS/cover.xhtml", "OEBPS/chapter1.xhtml", "OEBPS/chapter2.xhtml", "OEBPS/chapter3.xhtml"]);
        expect(flatToc(book.toc).map((e) => [e.title, e.chapter])).toEqual([["The Keeper", 1], ["The Storm", 2], ["The Ship", 3]]);
        expect(chapterTitle(book, 2)).toBe("The Storm");
    });

    it("gives a chapter with its stylesheet inlined and its pictures from the book", () => {
        const book = parseEpub(sample("the-lighthouse-cat.epub"));
        const ch = chapterContent(book, 2, urlFor);
        expect(ch.css).toMatch(/text-indent/);
        expect(ch.html).toContain('src="blob:test/OEBPS/images/storm.png"');
        expect(ch.html).toMatch(/The Storm/);
        expect(ch.lang).toBe("en");
    });

    function makeEpub(chapter: string, extra: Record<string, string> = {}, ncxOnly = false): Uint8Array {
        const files: Record<string, Uint8Array> = {
            mimetype: strToU8("application/epub+zip"),
            "META-INF/container.xml": strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>'),
            "content.opf": strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="${ncxOnly ? "2.0" : "3.0"}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>
                <manifest><item id="c" href="text/c.xhtml" media-type="application/xhtml+xml"/><item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
                <item id="i" href="img/p.png" media-type="image/png"/></manifest><spine toc="n"><itemref idref="c"/></spine></package>`),
            "toc.ncx": strToU8('<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>Only</text></navLabel><content src="text/c.xhtml#s2"/></navPoint></navMap></ncx>'),
            "text/c.xhtml": strToU8(chapter),
            "img/p.png": new Uint8Array([137, 80, 78, 71]),
        };
        for (const [k, v] of Object.entries(extra)) files[k] = strToU8(v);
        return zipSync(files);
    }

    it("takes out scripts, handlers and remote styles, and turns chapter links into book links", () => {
        const book = parseEpub(makeEpub(`<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../s.css"/><style>p{background:url(../img/p.png)}</style></head>
            <body><script>alert(1)</script><p onclick="alert(2)" id="s2">Hi <a href="c.xhtml#s2">there</a> <a href="https://example.org">web</a></p>
            <img src="../img/p.png"/><img src="../img/missing.png"/><iframe src="https://evil.example"></iframe></body></html>`,
        { "s.css": "@import url(https://evil.example/x.css); body{background:url(https://evil.example/t.png)} div{position:fixed}" }, true));
        expect(flatToc(book.toc)).toEqual([{ title: "Only", chapter: 0, fragment: "s2", children: [], depth: 0 }]);
        const ch = chapterContent(book, 0, urlFor);
        expect(ch.html).not.toMatch(/script|onclick|iframe|evil/);
        expect(ch.html).toContain('data-book-href="text/c.xhtml#s2"');
        expect(ch.html).toContain('target="_blank"');
        expect(ch.html).toContain('src="blob:test/img/p.png"');
        expect(ch.css).not.toMatch(/evil|@import/);
        expect(ch.css).toContain('url("blob:test/img/p.png")');
        expect(ch.css).toContain("position: static");
    });

    it("says what is wrong with a file that is not an EPUB", () => {
        expect(() => parseEpub(new Uint8Array([1, 2, 3]))).toThrow(/not an EPUB/);
        expect(() => parseEpub(zipSync({ "a.txt": strToU8("x") }))).toThrow(/no package document/);
    });

    it("resolves paths inside the package", () => {
        expect(resolveHref("OEBPS/text/ch1.xhtml", "../images/a%20b.png#x")).toBe("OEBPS/images/a b.png");
        expect(resolveHref("OEBPS/ch1.xhtml", "/root.css")).toBe("root.css");
        expect(resolveHref("a.xhtml", "https://x.org/y")).toBe("https://x.org/y");
        expect(rewriteCss("a{b:url('x.png')}", "OEBPS/s.css", urlFor, new Package(zipSync({ "OEBPS/x.png": new Uint8Array([1]) })))).toBe('a{b:url("blob:test/OEBPS/x.png")}');
    });
});

describe("Excel", () => {
    it("reads the demo workbook's sheets, numbers, formulas' values and dates", () => {
        const [budget, notes] = parseXlsx(sample("trip-budget.xlsx"));
        expect(budget.name).toBe("Budget");
        expect(budget.rows[0].map((c) => c.text)).toEqual(["Item", "Cost", "People", "Each"]);
        expect(budget.rows[0][0].bold).toBe(true);
        expect(budget.rows[1].map((c) => c.text)).toEqual(["Ferry tickets", "96.00", "4", "24.00"]);
        expect(budget.rows[5][1]).toMatchObject({ text: "568.40", numeric: true, bold: true });
        expect(budget.rows[7][1].text).toBe("Oct 2, 2026");
        expect(budget.widths[0]).toBeGreaterThan(100);
        expect(notes.rows.map((r) => r[0].text)).toContain("Book the cabin before the end of the month.");
    });

    it("formats numbers as their formats say", () => {
        expect(formatNumber(1234.5, 4)).toBe("1,234.50");
        expect(formatNumber(0.125, 10)).toBe("12.50%");
        expect(formatNumber(-3, 0, '#,##0.00;(#,##0.00)')).toBe("(3.00)");
        expect(formatNumber(1 / 3, 0)).toBe("0.3333333333");
        expect(formatNumber(12, 0, '"€"#,##0')).toBe("€12");
        expect(isDateFormat(0, "yyyy-mm-dd")).toBe(true);
        expect(isDateFormat(0, "0.00")).toBe(false);
        expect(isDateFormat(14)).toBe(true);
    });

    it("names cells and columns", () => {
        expect(cellRef("B3")).toEqual([2, 1]);
        expect(cellRef("AA10")).toEqual([9, 26]);
        expect(columnName(0)).toBe("A");
        expect(columnName(27)).toBe("AB");
    });

    it("spans merged cells", () => {
        const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
            <row r="1"><c r="A1" t="inlineStr"><is><t>Title</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2" t="b"><v>1</v></c></row>
            </sheetData><mergeCells><mergeCell ref="A1:B1"/></mergeCells></worksheet>`;
        const x = zipSync({
            "xl/workbook.xml": strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
            "xl/_rels/workbook.xml.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/s.xml" Type="x"/></Relationships>'),
            "xl/worksheets/s.xml": strToU8(sheet),
        });
        const [s] = parseXlsx(x);
        expect(s.rows[0][0]).toMatchObject({ text: "Title", colSpan: 2, rowSpan: 1 });
        expect(s.rows[0][1].hidden).toBe(true);
        expect(s.rows[1].map((c) => c.text)).toEqual(["1", "TRUE"]);
    });
});

describe("PowerPoint", () => {
    it("reads the demo presentation's slides, text and pictures", () => {
        const p = parsePptx(sample("roadmap.pptx"));
        expect(p.aspect).toBeCloseTo(16 / 9);
        expect(p.heightPt).toBeCloseTo(405);
        expect(p.slides).toHaveLength(3);
        expect(p.slides[0].background).toBe("#1F3A5F");
        expect(slideText(p.slides[0])).toBe("webOS Phoenix roadmap\nAutumn 2026");
        const body = p.slides[1].items.find((i) => i.kind === "text" && i.paragraphs.length === 3);
        expect(body && body.kind === "text" && body.paragraphs[0]).toMatchObject({ bullet: "•", runs: [{ text: "Tasks with reminders on the activity manager", size: 22 }] });
        const pic = p.slides[2].items.find((i) => i.kind === "picture");
        expect(pic).toMatchObject({ kind: "picture", path: "ppt/media/image1.png", mime: "image/png" });
        expect(pic!.x).toBeGreaterThan(0.5);
    });
});

describe("reading positions and preferences", () => {
    beforeEach(() => localStorage.clear());

    it("keeps the place and says how far along it is", () => {
        savePosition("/b.epub", { part: 2, fraction: 0.5, parts: 4, title: "B" });
        expect(positionOf("/b.epub")).toMatchObject({ part: 2, fraction: 0.5 });
        expect(percentRead(positionOf("/b.epub"))).toBe(63);
        expect(percentRead(undefined)).toBe(0);
        expect(pageFromFraction(0.5, 5)).toBe(2);
        expect(fractionFromPage(4, 5)).toBe(1);
        expect(pageFromFraction(0.9, 1)).toBe(0);
    });

    it("steps the text size and keeps preferences", () => {
        expect(stepFont(100, 1)).toBe(115);
        expect(stepFont(80, -1)).toBe(80);
        expect(loadPrefs()).toEqual(DEFAULT_PREFS);
        savePrefs({ fontScale: 130, night: true, font: "sans" });
        expect(loadPrefs()).toEqual({ fontScale: 130, night: true, font: "sans" });
    });

    it("lays out pages in columns, and night mode over the book's colours", () => {
        expect(readerCss("pages", DEFAULT_PREFS)).toMatch(/column-width: calc\(100vw - 44px\)/);
        expect(readerCss("scroll", DEFAULT_PREFS)).not.toMatch(/column-width/);
        expect(readerCss("pages", { ...DEFAULT_PREFS, night: true, fontScale: 150 })).toMatch(/background: #111 !important[\s\S]*font-size: 150%|font-size: 150%[\s\S]*background: #111 !important/);
        const doc = frameDocument({ html: "<p>x</p>", css: "</style><script>", mode: "scroll", prefs: DEFAULT_PREFS, lang: 'e"n' });
        expect(doc).not.toContain("</style><script>");
        expect(doc).toContain('lang="e&quot;n"');
    });
});
