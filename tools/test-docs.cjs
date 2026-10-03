#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives the two document apps (built into dist/) in headless Chromium
// against the simulated file manager and application manager, with the
// demo documents (apps/media-samples/media/documents):
//
//   PDF View: the list of PDFs, opening one (PDF.js draws the pages), zoom,
//       search with every match marked, page thumbnails, the page kept for
//       next time, and PDFs handed over by Files ("Open with"), Email
//       (getResourceInfo, then open) and the browser (a web address).
//   Doc View: Books and Documents, an EPUB in pages (turning, the table of
//       contents, a picture, text size, night mode, the place kept), a Word
//       document, an Excel workbook (two sheets), a PowerPoint presentation
//       and a Markdown file, and the types it is registered for.
//
//   node tools/test-docs.cjs [--tablet] [--out DIR]
//
// Build the apps first (cd apps && npm ci && npm run build).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "docs-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8400 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const PDF = "org.webosphoenix.pdfview";
const DOC = "org.webosphoenix.docview";
const DIR = "/media/internal/samples/documents";
const appUrl = (id, params) => `${origin}/usr/palm/applications/${id}/index.html` +
    (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
}
async function expect(promise, what) {
    await promise.then(() => check(true, what), () => check(false, what));
}

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await fetch(url)).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

async function main() {
    for (const app of ["pdfview", "docview"]) {
        if (!fs.existsSync(path.join(REPO, `apps/${app}/dist/index.html`))) {
            console.error(`apps/${app}/dist is missing: run \`npm ci && npm run build\` in apps/ first`);
            process.exit(2);
        }
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [];
        const host = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(p));
        }), [uri, params]);
        const text = (sel) => page.textContent(sel).then((t) => (t ?? "").trim());
        const lastHost = (type) => [...host].reverse().find((m) => m.type === type);
        // Inside Doc View's reading frame.
        const inFrame = (fn, arg) => page.evaluate(([f, a]) => {
            const d = document.querySelector("iframe.dv-frame")?.contentDocument;
            return d ? new Function("d", "a", f)(d, a) : null;
        }, [fn, arg]);

        await page.goto(appUrl(PDF));
        await page.evaluate(() => localStorage.clear());

        // ================================ PDF View ================================================
        await page.reload();
        await page.waitForSelector("[data-testid='file-field-guide.pdf']");
        check(true, "PDF View lists the PDFs on the device");
        await shot("pdf-library");
        await page.click("[data-testid='file-field-guide.pdf']");
        await page.waitForSelector("[data-testid='page-label']");
        check(await text("[data-testid='page-label']") === "1 / 4", "opens the guide: 4 pages");
        check(await text("[data-testid='doc-title']") === "webOS Phoenix Field Guide", "with the title from the PDF");
        await expect(page.waitForFunction(() => {
            const c = document.querySelector("[data-testid='page-1'] canvas");
            if (!c || !c.width) return false;
            const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
            for (let i = 0; i < px.length; i += 4 * 97) if (px[i] < 128) return true;   // some dark text
            return false;
        }, null, { timeout: 10000 }), "PDF.js draws the first page");
        await page.waitForTimeout(300);
        await shot("pdf-page");

        await page.click("[data-testid='zoom-in']");
        check(await text("[data-testid='zoom-label']") === "125%", "zoom in");
        await page.click("[data-testid='zoom-out']");
        await page.click("[data-testid='zoom-out']");
        check(await text("[data-testid='zoom-label']") === "75%", "zoom out");
        await page.click("[data-testid='zoom-label']");
        check(await text("[data-testid='zoom-label']") === "100%", "the zoom label fits the width again");

        await page.click("[data-testid='search']");
        await page.fill("[data-testid='search-field']", "Harbor");
        await page.keyboard.press("Enter");
        await expect(page.waitForFunction(() => document.querySelector("[data-testid='search-count']")?.textContent === "1 of 5"), "search finds \"harbor\" 5 times");
        await page.click("[data-testid='search-next']");
        await expect(page.waitForFunction(() => document.querySelector("[data-testid='page-label']")?.textContent === "3 / 4", null, { timeout: 5000 }),
            "the next match is on page 3");
        await expect(page.waitForSelector("[data-testid='page-3'] [data-testid='current-match']"), "the current match is marked");
        check(await page.locator("[data-testid='page-3'] .pv-mark").count() >= 3, "and the other matches on the page too");
        await page.waitForTimeout(300);
        await shot("pdf-search");
        await page.click("[data-testid='search-close']");

        await page.click("[data-testid='thumbs']");
        await page.waitForSelector("[data-testid='thumb-4']");
        await page.waitForTimeout(500);
        await shot("pdf-thumbnails");
        await page.click("[data-testid='thumb-4']");
        await expect(page.waitForFunction(() => document.querySelector("[data-testid='page-label']")?.textContent === "4 / 4"), "a thumbnail goes to its page");
        await page.waitForTimeout(600);
        await page.click("[data-testid='viewer-back']");
        await page.waitForSelector("[data-testid='recents']");
        check(/Page 4 of 4/.test(await text("[data-testid='recents']")), "the start page lists it as read lately, at page 4");
        await page.click("[data-testid='recents'] .pui-row");
        await expect(page.waitForFunction(() => document.querySelector("[data-testid='page-label']")?.textContent === "4 / 4"), "and opens it at page 4 again");

        // Handed over by other apps.
        const pdfHandlers = await luna("luna://com.webos.applicationManager/listAllHandlersForMime", { mime: "application/pdf" });
        check((pdfHandlers.resources || [])[0]?.appId === PDF, "PDF View is the app for application/pdf");
        const info = await luna("luna://com.webos.applicationManager/getResourceInfo", { uri: `file://${DIR}/field-guide.pdf`, mime: "application/pdf" });
        check(info.appIdByExtension === PDF, "Email's getResourceInfo names PDF View for a PDF attachment");
        host.length = 0;
        await luna("luna://com.webos.applicationManager/open", { target: `${DIR}/field-guide.pdf` });
        await page.waitForTimeout(100);
        check(lastHost("launch")?.payload.id === PDF, "the browser's open {target} of a downloaded PDF launches PDF View");
        await page.goto(appUrl(PDF, { target: `${origin}${DIR}/field-guide.pdf` }));
        await expect(page.waitForFunction(() => document.querySelector("[data-testid='page-label']")?.textContent === "1 / 4", null, { timeout: 10000 }),
            "a PDF at a web address opens (downloaded through the web)");

        // Files' "Open with" offers it.
        await page.goto(appUrl("org.webosphoenix.files", { path: DIR }));
        await page.waitForSelector("[data-testid='file-field-guide.pdf']");
        await page.click("[data-testid='file-field-guide.pdf']");
        await page.waitForSelector(`[data-testid='open-with-${PDF}']`);
        await shot("files-open-with");
        host.length = 0;
        await page.click(`[data-testid='open-with-${PDF}']`);
        await page.waitForTimeout(200);
        check(lastHost("launch")?.payload.id === PDF && lastHost("launch")?.payload.params.target === `${DIR}/field-guide.pdf`,
            "Files' \"Open with\" launches PDF View with the file");

        // ================================ Doc View ================================================
        await page.goto(appUrl(DOC));
        await page.waitForSelector("[data-testid='doc-the-lighthouse-cat.epub']");
        await expect(page.waitForFunction(() => /The Lighthouse Cat/.test(document.querySelector("[data-testid='doc-the-lighthouse-cat.epub']")?.textContent ?? "")),
            "Books lists the EPUB by its title");
        await page.waitForTimeout(400);
        await shot("doc-books");
        await page.click("[data-testid='tab-documents']");
        await page.waitForSelector("[data-testid='doc-meeting-notes.docx']");
        const docs = await page.$$eval("[data-testid='library'] .pui-row", (els) => els.map((e) => e.getAttribute("data-testid")));
        check(["doc-meeting-notes.docx", "doc-trip-budget.xlsx", "doc-roadmap.pptx", "doc-reading-notes.md", "doc-Welcome.txt"].every((d) => docs.includes(d)),
            "Documents lists Word, Excel, PowerPoint, Markdown and text files");
        await shot("doc-documents");

        // The book.
        await page.click("[data-testid='tab-books']");
        await page.click("[data-testid='doc-the-lighthouse-cat.epub']");
        await page.waitForSelector("[data-testid='reader']");
        await expect(page.waitForFunction(() => /^1 of 1$/.test(document.querySelector("[data-testid='reader-status']")?.textContent ?? "")), "the book opens at its cover");
        check(await text("[data-testid='reader-title']") === "The Lighthouse Cat", "with the book's title");
        await page.click("[data-testid='page-next']");
        await expect(page.waitForFunction(() => /^The Keeper · 1 of \d+$/.test(document.querySelector("[data-testid='reader-status']")?.textContent ?? "")),
            "turning the page goes to chapter 1");
        const keeperPages = Number((await text("[data-testid='reader-status']")).replace(/.* of /, ""));
        check(await inFrame("return /one hundred and twelve steps/.test(d.body.textContent)"), "the chapter's text is in the reader");
        await page.waitForTimeout(300);
        await shot("doc-book");

        await page.click("[data-testid='toc']");
        await page.waitForSelector("[data-testid='toc-The Storm']");
        await shot("doc-contents");
        await page.click("[data-testid='toc-The Storm']");
        await expect(page.waitForFunction(() => /^The Storm · 1 of/.test(document.querySelector("[data-testid='reader-status']")?.textContent ?? "")),
            "the table of contents goes to chapter 2");
        await expect(page.waitForFunction(() => {
            const img = document.querySelector("iframe.dv-frame")?.contentDocument?.querySelector("img");
            return img && img.complete && img.naturalWidth > 100;
        }, null, { timeout: 5000 }), "the chapter's picture comes from the book");
        check(await page.getAttribute("iframe.dv-frame", "sandbox") === "allow-same-origin", "the reading frame is sandboxed without scripts");

        await page.click("[data-testid='page-next']");
        await page.click("[data-testid='text-size']");
        await page.click("[data-testid='font-larger']");
        await page.click("[data-testid='font-larger']");
        check(await text("[data-testid='font-scale']") === "130%", "the text gets larger");
        const px = await inFrame("return parseFloat(d.defaultView.getComputedStyle(d.body).fontSize)");
        check(px > 18, `in the book too (${px}px)`);
        await page.click("[data-testid='font-sans']");
        await page.click("[data-testid='text-size']");
        await page.click("[data-testid='night']");
        await expect(page.waitForFunction(() => {
            const d = document.querySelector("iframe.dv-frame")?.contentDocument;
            return d && getComputedStyle(d.body).backgroundColor === "rgb(17, 17, 17)";
        }), "night mode darkens the page");
        await page.waitForTimeout(300);
        await shot("doc-night");
        await page.click("[data-testid='night']");
        await page.click("[data-testid='text-size']");
        await page.click("[data-testid='font-smaller']");
        await page.click("[data-testid='font-smaller']");
        await page.click("[data-testid='font-book']");
        await page.click("[data-testid='text-size']");
        const where = await text("[data-testid='reader-status']");
        await page.waitForTimeout(200);
        await page.click("[data-testid='reader-back']");
        await page.waitForSelector("[data-testid='library']");
        check(/% read/.test(await text("[data-testid='doc-the-lighthouse-cat.epub']")), "the library shows how far the book is read");
        await page.click("[data-testid='doc-the-lighthouse-cat.epub']");
        await expect(page.waitForFunction((w) => document.querySelector("[data-testid='reader-status']")?.textContent === w, where, { timeout: 5000 }),
            `and opens it where it was left (${where})`);
        check(keeperPages >= 1, `chapter 1 is ${keeperPages} page(s) long`);
        await page.click("[data-testid='reader-back']");

        // Word.
        await page.click("[data-testid='tab-documents']");
        await page.click("[data-testid='doc-meeting-notes.docx']");
        await expect(page.waitForFunction(() => /Decisions/.test(document.querySelector("iframe.dv-frame")?.contentDocument?.querySelector("h1, h2")?.parentElement?.textContent ?? "")),
            "a Word document opens (mammoth.js)");
        check(await text("[data-testid='reader-title']") === "Harbor Festival: planning meeting", "titled after its Title paragraph");
        check(await inFrame("return d.querySelectorAll('table tr').length === 4 && d.querySelectorAll('ul li').length === 3"), "with its list and table");
        await page.waitForTimeout(300);
        await shot("doc-word");
        await page.click("[data-testid='reader-back']");

        // Excel.
        await page.click("[data-testid='doc-trip-budget.xlsx']");
        await page.waitForSelector("[data-testid='sheet-table']");
        const cells = await page.$$eval("[data-testid='sheet-table'] td", (els) => els.map((e) => e.textContent));
        check(cells.includes("568.40") && cells.includes("142.10") && cells.includes("Oct 2, 2026"), "an Excel sheet shows its numbers and dates as formatted");
        await page.waitForTimeout(200);
        await shot("doc-excel");
        await page.click("[data-testid='sheet-Notes']");
        await expect(page.waitForFunction(() => /Book the cabin/.test(document.querySelector("[data-testid='sheet-table']")?.textContent ?? "")), "and its second sheet");
        await page.click("[data-testid='reader-back']");

        // PowerPoint.
        await page.click("[data-testid='doc-roadmap.pptx']");
        await page.waitForSelector("[data-testid='slide-3']");
        check(await page.locator("[data-testid='slides'] .dv-slide").count() === 3, "a presentation shows its 3 slides");
        check(/Done this quarter/.test(await text("[data-testid='slide-2']")), "with their text");
        check(await page.locator("[data-testid='slide-3'] img.dv-slide-pic").count() === 1, "and pictures");
        await page.waitForTimeout(300);
        await shot("doc-slides");
        await page.click("[data-testid='reader-back']");

        // Markdown.
        await page.click("[data-testid='doc-reading-notes.md']");
        await expect(page.waitForFunction(() => document.querySelector("iframe.dv-frame")?.contentDocument?.querySelector("h1")?.textContent === "Reading notes"),
            "Markdown is shown formatted");
        check(await inFrame("return d.querySelectorAll('table th').length === 3 && !!d.querySelector('blockquote')"), "with its table and quote");
        await page.click("[data-testid='reader-back']");

        // The types Doc View opens.
        for (const [mime, what] of [["application/epub+zip", "EPUB"], ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Word"],
            ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Excel"], ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "PowerPoint"]]) {
            const r = await luna("luna://com.webos.applicationManager/listAllHandlersForMime", { mime });
            check((r.resources || [])[0]?.appId === DOC, `Doc View is the app for ${what} files`);
        }
        await page.goto(appUrl(DOC, { target: `file://${DIR}/meeting-notes.docx` }));
        await expect(page.waitForFunction(() => /Harbor Festival/.test(document.querySelector("[data-testid='reader-title']")?.textContent ?? ""), null, { timeout: 8000 }),
            "a launch with {target} opens that document");

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
