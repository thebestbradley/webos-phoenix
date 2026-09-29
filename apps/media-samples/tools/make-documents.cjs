#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Generates the demo documents that PDF View and Doc View find on a fresh
// device, into media/documents/ (mounted at /media/internal/samples/documents):
//
//   field-guide.pdf          a four-page guide to webOS Phoenix (Chromium's
//                            print to PDF, so its text can be searched)
//   the-lighthouse-cat.epub  a short illustrated story in three chapters
//                            (EPUB 3 with an EPUB 2 table of contents too)
//   meeting-notes.docx       headings, a list, emphasis and a table
//   trip-budget.xlsx         two sheets: numbers with formulas (and their
//                            cached values), a date, and notes
//   roadmap.pptx             three slides with titles, bullets and a picture
//   reading-notes.md         Markdown
//
// All of the text and pictures are written or drawn by this script and are
// dedicated to the public domain (CC0 1.0). The Office files are written by
// hand as minimal Office Open XML packages (ECMA-376), so they are the same
// every run; LibreOffice opens them. Rerun after a change:
//
//   node apps/media-samples/tools/make-documents.cjs
//
// Needs Playwright with Chromium, and fflate (apps/node_modules, npm ci in
// apps/). Updates the "documents" list of media/index.json, keeping the rest.

"use strict";
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* fall back to the global install */ }
    const root = require("child_process").execSync("npm root -g").toString().trim();
    return require(path.join(root, "playwright"));
}
const { zipSync, strToU8 } = require(path.join(__dirname, "..", "..", "node_modules", "fflate"));

const OUT = path.join(__dirname, "..", "media", "documents");
const DEVICE_DIR = "/media/internal/samples/documents";
// Zip entries get this date, so the packages are the same every run.
const ZIP_DATE = new Date("2026-09-01T08:00:00Z");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function zip(files, stored = []) {
    const entries = {};
    for (const [name, data] of Object.entries(files))
        entries[name] = [typeof data === "string" ? strToU8(data) : data, { level: stored.includes(name) ? 0 : 6, mtime: ZIP_DATE }];
    return Buffer.from(zipSync(entries));
}

// ---- The story (EPUB) --------------------------------------------------------------------

const STORY = {
    title: "The Lighthouse Cat",
    author: "webOS Phoenix contributors",
    chapters: [
        ["The Keeper", [
            "On the last rock before the open sea stood a lighthouse, and in the lighthouse lived a keeper named Ada and a grey cat called Pixel.",
            "Every evening Ada climbed the one hundred and twelve steps to light the lamp. Pixel climbed them too, a little ahead, stopping now and then to look back as if to say that she was slow.",
            "From the lantern room they could see the harbor lights on the mainland, the fishing boats coming home, and, far out, the ships that passed without stopping.",
            "“They never wave,” Ada said. Pixel, who had never waved at anyone, agreed.",
        ]],
        ["The Storm", [
            "In November the wind turned. It came from the north for three days, and on the third night it brought a storm that shook the windows in their frames.",
            "Halfway through the night the lamp flickered. Ada found the trouble at once: a loose wire behind the clockwork, rattled free by the wind. She could not reach it. Her hands were too big for the gap.",
            "Pixel looked at the gap, and at Ada, and walked in. There was a small spark, a smell of dust, and then the lamp burned steady and bright again.",
            "When Pixel came out her whiskers were singed at the tips. She sat down and washed them as if nothing at all had happened.",
        ]],
        ["The Ship", [
            "In the morning a ship lay at anchor in the lee of the rock, safe, its deck washed clean by the waves.",
            "Its captain rowed over in a small boat to say thank you. Without the light, she said, they would have run onto the reef.",
            "Ada told her about the wire. The captain looked at Pixel for a long time. Then she took off her cap and bowed.",
            "Ever since, the ships that pass the lighthouse at night flash their lamps twice. Ada waves back. Pixel does not wave, but she watches until they are gone.",
        ]],
    ],
};

function chapterXhtml(title, paras, n) {
    return `${XML}<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<section epub:type="chapter" id="ch${n}">
<h1><span class="num">Chapter ${n}</span> ${esc(title)}</h1>
${n === 2 ? '<p class="figure"><img src="images/storm.png" alt="A lighthouse in a storm"/></p>\n' : ""}${paras.map((p, i) => `<p${i === 0 ? ' class="first"' : ""}>${esc(p)}</p>`).join("\n")}
</section>
</body>
</html>
`;
}

function epub(cover, storm) {
    const id = "urn:uuid:5f0e2c1a-8d51-4f6e-9a43-0c7b1e2a9d10";
    const chapters = STORY.chapters.map(([t, p], i) => [`chapter${i + 1}.xhtml`, t, chapterXhtml(t, p, i + 1)]);
    const opf = `${XML}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${id}</dc:identifier>
<dc:title>${esc(STORY.title)}</dc:title>
<dc:creator>${esc(STORY.author)}</dc:creator>
<dc:language>en</dc:language>
<dc:rights>CC0 1.0: dedicated to the public domain</dc:rights>
<meta property="dcterms:modified">2026-09-01T08:00:00Z</meta>
<meta name="cover" content="cover-image"/>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
<item id="storm" href="images/storm.png" media-type="image/png"/>
<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
${chapters.map(([f], i) => `<item id="c${i + 1}" href="${f}" media-type="application/xhtml+xml"/>`).join("\n")}
</manifest>
<spine toc="ncx">
<itemref idref="cover" linear="yes"/>
${chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("\n")}
</spine>
</package>
`;
    const nav = `${XML}<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><title>Contents</title></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${chapters.map(([f, t]) => `<li><a href="${f}">${esc(t)}</a></li>`).join("\n")}
</ol></nav></body></html>
`;
    const ncx = `${XML}<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${id}"/></head>
<docTitle><text>${esc(STORY.title)}</text></docTitle>
<navMap>
${chapters.map(([f, t], i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(t)}</text></navLabel><content src="${f}"/></navPoint>`).join("\n")}
</navMap>
</ncx>
`;
    const coverX = `${XML}<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">
<head><title>Cover</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body class="cover"><img src="images/cover.jpg" alt="${esc(STORY.title)}"/></body></html>
`;
    const css = `body { font-family: serif; line-height: 1.5; }
h1 { font-size: 1.5em; text-align: center; margin: 1.2em 0 1em; }
h1 .num { display: block; font-size: 0.6em; letter-spacing: 0.15em; text-transform: uppercase; color: #7a5a3a; }
p { margin: 0; text-indent: 1.4em; text-align: justify; }
p.first { text-indent: 0; }
p.first::first-letter { font-size: 2.6em; float: left; line-height: 0.9; margin: 0.05em 0.08em 0 0; color: #7a5a3a; }
p.figure { text-indent: 0; text-align: center; margin: 0.5em 0 1em; }
p.figure img { max-width: 100%; max-height: 40vh; }
body.cover { margin: 0; text-align: center; }
body.cover img { max-width: 100%; max-height: 100vh; }
`;
    const container = `${XML}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;
    const files = {
        mimetype: "application/epub+zip",
        "META-INF/container.xml": container,
        "OEBPS/content.opf": opf,
        "OEBPS/nav.xhtml": nav,
        "OEBPS/toc.ncx": ncx,
        "OEBPS/style.css": css,
        "OEBPS/cover.xhtml": coverX,
        "OEBPS/images/cover.jpg": cover,
        "OEBPS/images/storm.png": storm,
    };
    for (const [f, , x] of chapters) files[`OEBPS/${f}`] = x;
    return zip(files, ["mimetype"]);
}

// ---- Word (WordprocessingML) ---------------------------------------------------------------

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function run(text, { b, i } = {}) {
    const pr = (b ? "<w:b/>" : "") + (i ? "<w:i/>" : "");
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
function para(runs, style, list) {
    const ppr = (style ? `<w:pStyle w:val="${style}"/>` : "") + (list ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>` : "");
    return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${(Array.isArray(runs) ? runs : [run(runs)]).join("")}</w:p>`;
}
function table(rows) {
    const cell = (t, head) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${para([run(t, { b: head })])}</w:tc>`;
    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9000" w:type="dxa"/>` +
        `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join("")}</w:tblBorders></w:tblPr>` +
        `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>` +
        rows.map((r, i) => `<w:tr>${r.map((c) => cell(c, i === 0)).join("")}</w:tr>`).join("") + "</w:tbl>";
}

function docx() {
    const body = [
        para("Harbor Festival: planning meeting", "Title"),
        para([run("Date: ", { b: true }), run("Tuesday, 15 September 2026. "), run("Present: ", { b: true }), run("Ada, Ben, Chiara, Dev.")]),
        para("Decisions", "Heading1"),
        para("The festival runs on the first weekend of October, rain or shine.", null, true),
        para([run("The lantern walk starts at the pier at "), run("7 pm", { b: true }), run(", not 8 pm as last year.")], null, true),
        para([run("Music is "), run("acoustic only", { i: true }), run(" after 10 pm.")], null, true),
        para("Tasks", "Heading1"),
        table([["Task", "Who", "When"], ["Book the ferry", "Ben", "18 Sep"], ["Print the posters", "Chiara", "22 Sep"], ["Lanterns and candles", "Dev", "29 Sep"]]),
        para("Notes", "Heading2"),
        para("Last year the food stalls ran out of cups before nine. Order twice as many, and ask the stalls to bring their own where they can."),
        para([run("Next meeting: "), run("Tuesday, 29 September", { b: true }), run(", same place.")]),
    ].join("\n");
    const document = `${XML}<w:document ${W_NS}><w:body>
${body}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
    const style = (id, name, size, extra = "") => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
        `<w:pPr><w:spacing w:before="240" w:after="120"/>${extra}</w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
    const styles = `${XML}<w:styles ${W_NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style("Title", "Title", 40, '<w:jc w:val="left"/>')}
${style("Heading1", "heading 1", 32, '<w:outlineLvl w:val="0"/>')}
${style("Heading2", "heading 2", 26, '<w:outlineLvl w:val="1"/>')}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
</w:styles>`;
    const numbering = `${XML}<w:numbering ${W_NS}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;
    return zip({
        "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`,
        "_rels/.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
        "docProps/core.xml": core("Harbor Festival: planning meeting"),
        "word/_rels/document.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`,
        "word/document.xml": document,
        "word/styles.xml": styles,
        "word/numbering.xml": numbering,
    });
}

function core(title) {
    return `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title)}</dc:title><dc:creator>webOS Phoenix</dc:creator><dc:rights>CC0 1.0</dc:rights>
<dcterms:created xsi:type="dcterms:W3CDTF">2026-09-01T08:00:00Z</dcterms:created>
</cp:coreProperties>`;
}

// ---- Excel (SpreadsheetML) ----------------------------------------------------------------

function xlsx() {
    const strings = [];
    const si = (s) => { let i = strings.indexOf(s); if (i < 0) { i = strings.length; strings.push(s); } return i; };
    const col = (n) => String.fromCharCode(65 + n);
    // [value, kind] kind: s string, n number, f formula [f, cached], d date serial (style 1)
    const budget = [
        [["Item", "s"], ["Cost", "s"], ["People", "s"], ["Each", "s"]],
        [["Ferry tickets", "s"], [96, "n"], [4, "n"], [["B2/C2", 24], "f"]],
        [["Cabin, two nights", "s"], [310, "n"], [4, "n"], [["B3/C3", 77.5], "f"]],
        [["Groceries", "s"], [142.4, "n"], [4, "n"], [["B4/C4", 35.6], "f"]],
        [["Lantern walk", "s"], [20, "n"], [4, "n"], [["B5/C5", 5], "f"]],
        [["Total", "s"], [["SUM(B2:B5)", 568.4], "f"], [null], [["SUM(D2:D5)", 142.1], "f"]],
        [[null]],
        [["Leaving on", "s"], [46297, "d"]],
    ];
    const notes = [
        [["Notes", "s"]],
        [["Prices are for the whole group, in euros.", "s"]],
        [["Book the cabin before the end of the month.", "s"]],
    ];
    const sheetXml = (rows, widths) => `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>
${rows.map((r, ri) => `<row r="${ri + 1}">${r.map(([v, k], ci) => {
        const ref = col(ci) + (ri + 1);
        if (v === null || v === undefined) return "";
        const bold = ri === 0 || (r[0] && r[0][0] === "Total") ? ' s="2"' : "";
        if (k === "s") return `<c r="${ref}" t="s"${bold}><v>${si(v)}</v></c>`;
        if (k === "n") return `<c r="${ref}"${ci === 1 || ci === 3 ? ' s="3"' : ""}><v>${v}</v></c>`;
        if (k === "d") return `<c r="${ref}" s="1"><v>${v}</v></c>`;
        return `<c r="${ref}" s="${bold ? 4 : 3}"><f>${v[0]}</f><v>${v[1]}</v></c>`;
    }).join("")}</row>`).join("\n")}
</sheetData>
</worksheet>`;
    const s1 = sheetXml(budget, [22, 12, 10, 12]);
    const s2 = sheetXml(notes, [50]);
    const sst = `${XML}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("\n")}
</sst>`;
    const styles = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Liberation Sans"/></font><font><b/><sz val="11"/><name val="Liberation Sans"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
    return zip({
        "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`,
        "_rels/.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
        "docProps/core.xml": core("Trip budget"),
        "xl/workbook.xml": `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets>
</workbook>`,
        "xl/_rels/workbook.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
        "xl/worksheets/sheet1.xml": s1,
        "xl/worksheets/sheet2.xml": s2,
        "xl/sharedStrings.xml": sst,
        "xl/styles.xml": styles,
    });
}

// ---- PowerPoint (PresentationML) -------------------------------------------------------------

const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const EMU = 12700;   // per point
const SW = 9144000, SH = 5143500;   // 16:9, 10 x 5.625 in

function textBox(id, name, x, y, w, h, paras, { size = 20, bold = false, color = "333333", ph } = {}) {
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ""}</p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paras.map((t) => {
        const bullet = t.startsWith("- ");
        const text = bullet ? t.slice(2) : t;
        return `<a:p>${bullet ? '<a:pPr marL="285750" indent="-285750"><a:buChar char="•"/></a:pPr>' : ""}<a:r><a:rPr lang="en-US" sz="${size * 100}"${bold ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p>`;
    }).join("")}</p:txBody></p:sp>`;
}

function slideXml(shapes, bg = "FFFFFF") {
    return `${XML}<p:sld ${P_NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
${shapes.join("\n")}
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function picture(id, x, y, w, h) {
    return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function pptx(image) {
    const M = 457200;   // half an inch
    const slides = [
        slideXml([
            textBox(2, "Title", M, 1600000, SW - 2 * M, 900000, ["webOS Phoenix roadmap"], { size: 40, bold: true, color: "FFFFFF", ph: "ctrTitle" }),
            textBox(3, "Subtitle", M, 2600000, SW - 2 * M, 600000, ["Autumn 2026"], { size: 24, color: "C8D6E8", ph: "subTitle" }),
        ], "1F3A5F"),
        slideXml([
            textBox(2, "Title", M, 300000, SW - 2 * M, 700000, ["Done this quarter"], { size: 32, bold: true, color: "1F3A5F", ph: "title" }),
            textBox(3, "Body", M, 1200000, SW - 2 * M, 3400000, [
                "- Tasks with reminders on the activity manager",
                "- Voice Memos with on-device transcription",
                "- Videos, Podcasts, PDF View and Doc View",
            ], { size: 22 }),
        ]),
        slideXml([
            textBox(2, "Title", M, 300000, SW - 2 * M, 700000, ["Next: the harbor release"], { size: 32, bold: true, color: "1F3A5F", ph: "title" }),
            textBox(3, "Body", M, 1200000, 4300000, 3400000, [
                "- Maps on OpenStreetMap",
                "- A now-playing dashboard",
                "- CalDAV sync for Tasks",
            ], { size: 22 }),
            picture(4, 5000000, 1200000, 3600000, 2700000),
        ]),
    ];
    const files = {
        "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("\n")}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`,
        "_rels/.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
        "docProps/core.xml": core("webOS Phoenix roadmap"),
        "ppt/presentation.xml": `${XML}<p:presentation ${P_NS}>
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst>
<p:sldSz cx="${SW}" cy="${SH}"/><p:notesSz cx="${SH}" cy="${SW}"/>
</p:presentation>`,
        "ppt/_rels/presentation.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${slides.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`,
        "ppt/slideMasters/slideMaster1.xml": `${XML}<p:sldMaster ${P_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
        "ppt/slideLayouts/slideLayout1.xml": `${XML}<p:sldLayout ${P_NS} type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
        "ppt/theme/theme1.xml": theme(),
        "ppt/media/image1.png": image,
    };
    slides.forEach((x, i) => {
        files[`ppt/slides/slide${i + 1}.xml`] = x;
        files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
${i === 2 ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>' : ""}
</Relationships>`;
    });
    return zip(files);
}

function theme() {
    const clr = (n, v) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
    return `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Phoenix"><a:themeElements>
<a:clrScheme name="Phoenix">${clr("dk1", "000000")}${clr("lt1", "FFFFFF")}${clr("dk2", "1F3A5F")}${clr("lt2", "EEECE1")}${clr("accent1", "3B8FD6")}${clr("accent2", "E07A1F")}${clr("accent3", "4A9A4F")}${clr("accent4", "7A4FC0")}${clr("accent5", "B8322A")}${clr("accent6", "E0A23A")}${clr("hlink", "0563C1")}${clr("folHlink", "954F72")}</a:clrScheme>
<a:fontScheme name="Phoenix"><a:majorFont><a:latin typeface="Liberation Sans"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Liberation Sans"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Phoenix"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;
}

// ---- PDF (Chromium's print to PDF) ------------------------------------------------------------

const GUIDE = `<!doctype html><html><head><meta charset="utf-8"><title>webOS Phoenix Field Guide</title><style>
@page { size: A5; margin: 16mm 14mm; }
body { font-family: "DejaVu Serif", serif; font-size: 10.5pt; line-height: 1.45; color: #222; }
h1 { font-family: "DejaVu Sans", sans-serif; font-size: 22pt; margin: 30mm 0 4mm; color: #1f3a5f; }
h2 { font-family: "DejaVu Sans", sans-serif; font-size: 14pt; margin: 0 0 3mm; color: #1f3a5f; break-before: page; }
.sub { font-size: 12pt; color: #666; }
.note { font-size: 8pt; color: #999; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0; font-size: 9.5pt; }
td, th { border: 0.5pt solid #999; padding: 1.5mm 2mm; text-align: left; }
th { background: #e4ebf3; }
.card { border: 0.8pt solid #1f3a5f; border-radius: 3mm; padding: 3mm 4mm; margin: 4mm 0; background: #f4f7fb; }
</style></head><body>
<h1>webOS Phoenix<br>Field Guide</h1>
<p class="sub">Cards, gestures and the apps you carry.</p>
<p class="note">Dedicated to the public domain (CC0 1.0).</p>
<p>This little guide walks through the parts of webOS Phoenix you use every day. It is a demo document: PDF View opens it from Files, from an email or from the browser. Try searching it for the word <i>harbor</i>.</p>
<h2>1. Cards</h2>
<p>Every app you open is a card. Swipe sideways to move between them, and flick a card up to close it. Drag one card onto another to make a stack; the stack moves and closes as one.</p>
<div class="card">Tip: tap the top of a card in card view to open it full screen again.</div>
<p>The gesture area below the screen does the rest. A swipe up from it shows your cards; a swipe from the right edge into it is the back gesture.</p>
<h2>2. Just Type</h2>
<p>Start typing in card view and Just Type searches your apps, contacts, email and the web. Quick actions start a new email, memo, task or voice memo with what you typed.</p>
<table><tr><th>You type</th><th>You get</th></tr>
<tr><td>harbor</td><td>the Harbor at Dusk photo, the Harbor Timelapse video, and a web search</td></tr>
<tr><td>milk</td><td>your shopping list in Files, and "New Task: milk"</td></tr>
<tr><td>Ada</td><td>Ada's contact card and your last emails from her</td></tr></table>
<h2>3. Reading and watching</h2>
<p>PDF View shows PDF files with page thumbnails, pinch to zoom and search. Doc View reads e-books, Word, Excel and PowerPoint files, text and Markdown, and remembers where you stopped.</p>
<p>Videos plays the films on your device with subtitles, and picks up where you left off. Podcasts subscribes to feeds and downloads episodes for the ferry, where there is no signal in the harbor.</p>
</body></html>`;

// ---- Markdown ------------------------------------------------------------------------------

const NOTES_MD = `# Reading notes

Things to read on the ferry, and what I thought of them.

## Books

1. *The Lighthouse Cat*: short, and the cat is the best character.
2. A field guide to **webOS Phoenix**, mostly for the tips on cards.

## Links

- The [PDF.js](https://mozilla.github.io/pdf.js/) project renders the PDFs.
- Markdown files like this one open in Doc View.

> "A lighthouse is only useful in the dark."

| Title | Pages | Done |
| --- | ---: | :---: |
| The Lighthouse Cat | 3 chapters | yes |
| Field Guide | 4 | no |

\`\`\`
$ ls /media/internal/samples/documents
\`\`\`
`;

// ---- Main ----------------------------------------------------------------------------------

async function main() {
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch();
    const page = await browser.newPage();
    fs.mkdirSync(OUT, { recursive: true });

    const draw = (w, h, type, body) => page.evaluate(({ w, h, type, body }) => {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        new Function("ctx", "w", "h", body)(c.getContext("2d"), w, h);
        return c.toDataURL(type, 0.85).split(",")[1];
    }, { w, h, type, body }).then((b64) => Buffer.from(b64, "base64"));

    const LIGHTHOUSE = `
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "#0d1b33"); g.addColorStop(0.6, "#27466e"); g.addColorStop(1, "#0a1424");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        const beam = ctx.createLinearGradient(w * 0.5, 0, w, 0);
        beam.addColorStop(0, "rgba(255,236,170,0.55)"); beam.addColorStop(1, "rgba(255,236,170,0)");
        ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.36); ctx.lineTo(w, h * 0.22); ctx.lineTo(w, h * 0.5); ctx.fill();
        ctx.restore();
        ctx.fillStyle = "#1a2a40"; ctx.beginPath(); ctx.moveTo(0, h * 0.82); ctx.quadraticCurveTo(w * 0.5, h * 0.72, w, h * 0.84); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
        // The tower.
        ctx.fillStyle = "#e9e4da"; ctx.beginPath(); ctx.moveTo(w * 0.44, h * 0.8); ctx.lineTo(w * 0.47, h * 0.4); ctx.lineTo(w * 0.53, h * 0.4); ctx.lineTo(w * 0.56, h * 0.8); ctx.fill();
        ctx.fillStyle = "#b8322a"; for (let i = 0; i < 3; ++i) { const y = h * (0.48 + i * 0.1); ctx.fillRect(w * (0.455 - i * 0.005), y, w * (0.09 + i * 0.01), h * 0.035); }
        ctx.fillStyle = "#333"; ctx.fillRect(w * 0.455, h * 0.38, w * 0.09, h * 0.02);
        ctx.fillStyle = "#ffe9a6"; ctx.fillRect(w * 0.475, h * 0.33, w * 0.05, h * 0.05);
        ctx.fillStyle = "#333"; ctx.beginPath(); ctx.moveTo(w * 0.465, h * 0.33); ctx.lineTo(w * 0.5, h * 0.29); ctx.lineTo(w * 0.535, h * 0.33); ctx.fill();
        // The cat on the rock.
        ctx.fillStyle = "#0b0f18"; ctx.beginPath(); ctx.ellipse(w * 0.66, h * 0.79, w * 0.035, h * 0.022, 0, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(w * 0.69, h * 0.765, w * 0.018, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.moveTo(w * 0.678, h * 0.755); ctx.lineTo(w * 0.683, h * 0.738); ctx.lineTo(w * 0.69, h * 0.752); ctx.fill();
        ctx.beginPath(); ctx.moveTo(w * 0.69, h * 0.752); ctx.lineTo(w * 0.698, h * 0.737); ctx.lineTo(w * 0.703, h * 0.756); ctx.fill();
        ctx.strokeStyle = "#0b0f18"; ctx.lineWidth = w * 0.008; ctx.beginPath(); ctx.moveTo(w * 0.628, h * 0.79); ctx.quadraticCurveTo(w * 0.6, h * 0.77, w * 0.615, h * 0.74); ctx.stroke();`;
    const cover = await draw(600, 900, "image/jpeg", LIGHTHOUSE + `
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold 58px DejaVu Serif, serif"; ctx.fillText("The Lighthouse", w / 2, 120); ctx.fillText("Cat", w / 2, 185);
        ctx.font = "24px DejaVu Sans, sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.fillText("A short story", w / 2, 230);`);
    const storm = await draw(480, 300, "image/png", LIGHTHOUSE + `
        ctx.strokeStyle = "rgba(200,220,255,0.35)"; ctx.lineWidth = 1.2;
        for (let i = 0; i < 140; ++i) { const x = (i * 83.3) % w, y = (i * 47.1) % h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6, y + 16); ctx.stroke(); }`);
    const slidePic = await draw(480, 360, "image/png", LIGHTHOUSE);

    const docs = [];
    const write = (file, data, title) => {
        fs.writeFileSync(path.join(OUT, file), data);
        docs.push({ file_path: `${DEVICE_DIR}/${file}`, title, file_size: data.length, last_modified_date: "2026-09-01T08:00:00Z" });
        console.log(`documents/${file} ${(data.length / 1024).toFixed(1)} KB`);
    };

    await page.setContent(GUIDE, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A5", printBackground: true, tagged: true });
    write("field-guide.pdf", pdf, "webOS Phoenix Field Guide");
    write("the-lighthouse-cat.epub", epub(cover, storm), STORY.title);
    write("meeting-notes.docx", docx(), "Harbor Festival: planning meeting");
    write("trip-budget.xlsx", xlsx(), "Trip budget");
    write("roadmap.pptx", pptx(slidePic), "webOS Phoenix roadmap");
    write("reading-notes.md", Buffer.from(NOTES_MD), "Reading notes");

    await browser.close();
    const indexFile = path.join(__dirname, "..", "media", "index.json");
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    index.documents = docs;
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
