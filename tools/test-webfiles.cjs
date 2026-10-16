#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A web page's own files (runtime/phoenix-runtime.js, "A web page's own
// files"), in headless Chromium against the virtual webOS filesystem
// (tools/serve-rootfs.py), with the page tools/fixtures/webfiles (a plain
// web app, as a third party's is):
//
//   - <input type=file>: in the page, behind a label (several files), made
//     by script and clicked: Phoenix's file picker opens (never Chromium's
//     chooser), with kinds from accept; the files picked are the input's,
//     with their bytes, then "input" and "change"; Cancel fires "cancel";
//     the page's own preventDefault keeps the picker shut.
//   - the File System Access API: showOpenFilePicker (a handle: getFile,
//     a write back with keepExistingData), showSaveFilePicker (the save
//     picker; the file written on close where Files lists it; saved again
//     through the same handle without a picker; Cancel is an AbortError);
//     no showDirectoryPicker.
//   - in columns (a tablet's sheets without the user's List: the sections
//     before run with it chosen): an input's file picked in the column view,
//     and showSaveFilePicker into a folder of the columns.
//   - downloads: a Blob through a link made by script (its URL revoked at
//     once), a link in the page, a data: URL, FileSaver.js's uncancelable
//     click: the save picker with the name, the file written, "Saved ... to
//     ..."; webDownload for a download Chromium started (a Blob, and a file
//     of the web: the download manager, into Downloads).
//
//   node tools/test-webfiles.cjs [--out DIR]
//
// Needs apps/sharesheet built (cd apps && npm run build -w sharesheet).

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

async function drained(pending) {
    const r = await pending;
    try { await r.arrayBuffer(); } catch (e) { /* the status is what counts */ }
    return r;
}

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const FIXTURE = path.join(__dirname, "fixtures", "webfiles");
const APP = "org.webosphoenix.test.webfiles";
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "webfiles-tests");
const port = 8500 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const DOCS = "/media/internal/Documents";

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
}

async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await drained(fetch(url))).ok) return; } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/sharesheet/dist/index.html"))) {
        console.error("apps/sharesheet/dist is missing: build the apps (cd apps && npm run build -w sharesheet)");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), "--extra-rootfs", FIXTURE],
                         { stdio: "ignore" });
    const errors = [];
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport: { width: 1024, height: 740 }, acceptDownloads: true });
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        // Chromium's own chooser and downloads: none (but FileSaver.js's, below).
        let choosers = 0, downloads = [];
        page.on("filechooser", () => { choosers++; });
        page.on("download", (d) => { downloads.push(d.suggestedFilename()); d.cancel().catch(() => {}); });
        // What the runtime tells the shell (banners, notifications).
        const host = [];
        page.on("console", (m) => {
            const t = m.text();
            if (t.indexOf("__phoenix__") === 0) try { host.push(JSON.parse(t.slice(11))); } catch (e) { /* not ours */ }
        });
        await page.goto(`${origin}/usr/palm/applications/${APP}/index.html`);
        await page.waitForFunction(() => window.results && window.results.length > 0);
        // The sheets' list, the user's choice on this tablet (their columns, the default, are below).
        await page.evaluate(() => localStorage.setItem("phoenix:filepicker:view", JSON.stringify("list")));
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const results = () => page.evaluate(() => window.results);
        const nextResult = async (kind, from) => {
            const h = await page.waitForFunction(([k, n]) => window.results.slice(n).find((r) => r.kind === k || r.kind === k + "-error"),
                                                 [kind, from], { timeout: 15000 });
            return h.jsonValue();
        };
        const count = () => page.evaluate(() => window.results.length);
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (s) => res(JSON.parse(s));
            b.call(u, JSON.stringify(p || {}));
        }), [uri, params]);
        const readText = async (p) => {
            const r = await luna("luna://org.webosphoenix.filemanager/read", { path: p });
            return r.returnValue ? r.data : null;
        };
        const sheet = async (kind) => {
            const el = await page.waitForSelector(`iframe[data-phoenix-sheet=${kind}]`, { timeout: 10000 });
            const f = await el.contentFrame();
            await f.waitForSelector(kind === "save" ? "[data-testid=save-picker]" : ".ss-pick");
            await page.waitForTimeout(400);   // it has risen
            return f;
        };
        const sheetGone = () => page.waitForSelector("iframe[data-phoenix-sheet]", { state: "detached" });
        const saveIn = async (f, name) => {
            await f.waitForFunction(() => {
                const el = document.querySelector("[data-testid=save-folder]");
                return el && document.querySelector("[data-testid=save-folders] [data-testid^=save-folder-], [data-testid=save-folders] .ss-empty");
            });
            if (name) await f.fill("[data-testid=save-name]", name);
            await f.click("[data-testid=save-confirm]");
            // The same name again: Replace.
            const replace = await f.waitForSelector("[data-testid=replace-dialog]", { timeout: 800 }).catch(() => null);
            if (replace) await f.click("[data-testid=replace-confirm]");
            await sheetGone();
        };

        // ---- The page sees ----------------------------------------------------------------------------
        const ready = (await results())[0];
        check(ready.showOpenFilePicker === "function" && ready.showSaveFilePicker === "function" && ready.showDirectoryPicker === false,
              `the page has showOpenFilePicker and showSaveFilePicker, no showDirectoryPicker (${JSON.stringify(ready)})`);
        const req = (accept, multiple) => page.evaluate(([a, m]) => __phoenixRuntime.webFiles.pickRequest(a, m), [accept, multiple]);
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        check(same((await req("", false)).kinds, ["image", "video", "audio", "document", "file"]), "accept: none: every kind");
        let r = await req("image/*", true);
        check(same(r.kinds, ["image"]) && r.multiple === true && r.extensions.length === 0, "accept image/*: the pictures, several");
        r = await req(".txt,.md,text/plain", false);
        check(same(r.kinds, ["document", "file"]) && same(r.extensions, ["txt", "md", "text"]), `accept .txt,.md,text/plain: Documents and Files of those (${r.extensions})`);
        r = await req("image/*,.pdf", false);
        check(same(r.kinds, ["image", "document", "file"]) && r.extensions.includes("pdf") && r.extensions.includes("png"), "accept image/*,.pdf: the pictures, and Documents and Files");
        check(same((await req("application/x-unknown", false)).kinds, ["image", "video", "audio", "document", "file"]), "accept: an unknown type alone: every kind");
        r = await req("application/x-vectorcraft,.vectorcraft", false);
        check(same(r.kinds, ["document", "file"]) && same(r.extensions, ["vectorcraft"]), "accept: an unknown type and its extension: that extension");
        check(same((await req("video/mp4", false)).kinds, ["video"]), "accept video/mp4: the videos");

        // ---- <input type=file> ------------------------------------------------------------------------
        let n = await count();
        await page.click("#image-input");
        let f = await sheet("pick");
        check(await f.locator("[data-testid=picture-picker]").count() === 1, "a picture input: Phoenix's picture picker opens");
        await shot("1-input-picture-picker");
        const thumb = f.locator("[data-testid=pick-picture]").nth(0);
        const pictureName = await thumb.getAttribute("title");
        await thumb.click();
        let res = await nextResult("change", n);
        const pic = res.files && res.files[0];
        const sample = await page.evaluate((name) => fetch("/media/internal/samples/photos/" + name).then((x) => x.ok ? x.arrayBuffer() : null)
            .then((b) => b && b.byteLength), pictureName);
        check(pic && pic.name === pictureName && /^image\//.test(pic.type) && pic.size > 0 && pic.size === sample && pic.head.indexOf("ffd8ff") === 0,
              `the picture is the input's file, with its bytes (${pic && [pic.name, pic.type, pic.size].join(", ")})`);
        check((await results()).slice(n).some((x) => x.kind === "input" && x.id === "image-input"), "\"input\" before \"change\"");
        check(await page.evaluate(() => document.getElementById("image-input").files.length === 1), "input.files holds it");

        n = await count();
        await page.click("#image-input");
        f = await sheet("pick");
        await f.click("[data-testid=pick-cancel]");
        res = await nextResult("cancel", n);
        check(res.kind === "cancel" && res.id === "image-input", "Cancel: \"cancel\"");
        check(await page.evaluate(() => document.getElementById("image-input").files.length === 1), "... and the input keeps its file");

        // Behind a label, several files: Documents (the kind first).
        n = await count();
        await page.click("#text-label");
        f = await sheet("pick");
        check(await f.locator("[data-testid=pick-kind-document]").count() === 1 && await f.locator("[data-testid=pick-kind-file]").count() === 1 &&
              await f.locator("[data-testid^=pick-kind-]").count() === 2, "a text input: Documents and Files");
        await f.click("[data-testid=pick-kind-document]");
        await f.waitForSelector(`[data-path='${DOCS}/Welcome.txt']`);
        const listed = await f.$$eval("[data-testid=pick-document]", (els) => els.map((e) => e.getAttribute("data-path")));
        check(listed.length > 0 && listed.every((p) => /\.(txt|md|text)$/.test(p)), `only its extensions (${listed.length} documents)`);
        await f.click(`[data-path='${DOCS}/Welcome.txt']`);
        await f.click(`[data-path='${DOCS}/Trip notes.md']`);
        await shot("2-input-documents");
        await f.click("[data-testid=pick-ok]");
        res = await nextResult("change", n);
        const welcome = await readText(`${DOCS}/Welcome.txt`);
        check(res.files && res.files.length === 2 && res.files.some((x) => x.name === "Welcome.txt" && x.text === welcome) &&
              res.files.some((x) => x.name === "Trip notes.md" && /Harbor weekend/.test(x.text)), "several files, with their text");
        check(res.files && res.files.every((x) => x.lastModified > 0 && x.lastModified < Date.now() - 86400000), "... and their dates");

        // Made by script and clicked, not in the page.
        n = await count();
        await page.click("#detached-open");
        f = await sheet("pick");
        await f.click("[data-testid=pick-kind-file]");
        await f.click("[data-testid=pick-folder-Documents]");
        await f.click(`[data-path='${DOCS}/Shopping list.txt']`);
        res = await nextResult("change", n);
        check(res.id === "detached" && res.files[0].name === "Shopping list.txt" && /Coffee beans/.test(res.files[0].text),
              "an input made by script and clicked: the picker, then its file");

        // The page's own preventDefault keeps the picker shut.
        await page.evaluate(() => {
            window.__stop = (e) => e.preventDefault();
            document.getElementById("image-input").addEventListener("click", window.__stop);
        });
        await page.click("#image-input");
        await page.waitForTimeout(700);
        check(await page.locator("iframe[data-phoenix-sheet]").count() === 0, "the page's preventDefault: no picker");
        check(await page.evaluate(() => { let seen = null; const i = document.getElementById("image-input");
                                          const l = (e) => { seen = e.defaultPrevented; }; i.addEventListener("click", l); i.click();
                                          i.removeEventListener("click", l); return seen; }) === true,
              "... and the page reads defaultPrevented as its own");
        await page.evaluate(() => document.getElementById("image-input").removeEventListener("click", window.__stop));
        await page.waitForTimeout(300);
        check(await page.evaluate(() => { let seen = null; const i = document.getElementById("image-input");
                                          const l = (e) => { seen = e.defaultPrevented; }; i.addEventListener("click", l); i.click();
                                          i.removeEventListener("click", l); return seen; }) === false,
              "without it, the page sees the click not prevented");
        f = await sheet("pick");
        await f.click("[data-testid=pick-cancel]");
        await sheetGone();
        // showPicker().
        n = await count();
        await page.evaluate(() => document.getElementById("image-input").showPicker());
        f = await sheet("pick");
        await f.click("[data-testid=pick-cancel]");
        res = await nextResult("cancel", n);
        check(res.kind === "cancel", "input.showPicker(): the picker");

        // ---- The File System Access API ---------------------------------------------------------------
        n = await count();
        await page.click("#fsa-open");
        f = await sheet("pick");
        await f.click("[data-testid=pick-kind-document]");
        await f.click(`[data-path='${DOCS}/Shopping list.txt']`);
        res = await nextResult("fsa-open", n);
        check(res.kind === "fsa-open" && res.name === "Shopping list.txt" && /Coffee beans/.test(res.text),
              "showOpenFilePicker: a handle whose getFile() is the file picked");
        check(await page.evaluate(() => window.openHandle instanceof FileSystemFileHandle && window.openHandle.kind === "file"),
              "... a FileSystemFileHandle");
        n = await count();
        await page.click("#fsa-write-back");
        res = await nextResult("fsa-written-back", n);
        const shopping = await readText(`${DOCS}/Shopping list.txt`);
        check(res.kind === "fsa-written-back" && /Coffee beans[\s\S]*\nAppended\.$/.test(shopping || ""),
              "createWritable({keepExistingData}) and a write at the end: the file has it");

        await page.fill("#text", "Saved through the File System Access API.");
        n = await count();
        await page.click("#fsa-save-as");
        f = await sheet("save");
        check(await f.inputValue("[data-testid=save-name]") === "note.txt", "showSaveFilePicker: the save picker, with the suggested name");
        await shot("3-save-picker");
        await saveIn(f);
        res = await nextResult("fsa-saved", n);
        check(res.kind === "fsa-saved" && res.name === "note.txt", "the handle is the file chosen");
        check(await readText(`${DOCS}/note.txt`) === "Saved through the File System Access API.", "written there on close()");
        const list = await luna("luna://org.webosphoenix.filemanager/list", { path: DOCS });
        check(list.returnValue && list.entries.some((e) => e.name === "note.txt"), "Files lists it");
        await page.fill("#text", "Saved again.");
        n = await count();
        await page.click("#fsa-save");
        res = await nextResult("fsa-saved-again", n);
        await page.waitForTimeout(300);
        const again = [res.kind, await page.locator("iframe[data-phoenix-sheet]").count(), await readText(`${DOCS}/note.txt`)];
        check(again[0] === "fsa-saved-again" && again[1] === 0 && again[2] === "Saved again.",
              `the same handle saves again, without a picker (${JSON.stringify(again)})`);
        n = await count();
        await page.evaluate(() => {
            window.showSaveFilePicker({ suggestedName: "x.txt" }).then(() => window.results.push({ kind: "abort-test" }),
                (e) => window.results.push({ kind: "abort-test", name: e.name }));
        });
        f = await sheet("save");
        await f.click("[data-testid=save-cancel]");
        res = await nextResult("abort-test", n);
        check(res.name === "AbortError", "Cancel in the save picker: an AbortError");

        // ---- In columns (a tablet's sheets, no List chosen) -------------------------------------------
        await page.evaluate(() => localStorage.removeItem("phoenix:filepicker:view"));
        n = await count();
        await page.click("#detached-open");
        f = await sheet("pick");
        await f.click("[data-testid=pick-kind-file]");
        await f.waitForSelector("[data-testid=pick-columns]");
        check(await f.locator("[data-testid='view-switch-columns'][aria-checked='true']").count() === 1, "no List chosen: the picker's folders in columns");
        await f.click("[data-testid='pick-column-0'] [data-testid='pick-col-Documents']");
        const welcomeRow = `[data-testid='pick-column-1'] [data-path='${DOCS}/Welcome.txt']`;
        await f.click(welcomeRow);
        await f.waitForSelector("[data-testid=pick-preview]");
        await f.click(welcomeRow);
        res = await nextResult("change", n);
        check(res.id === "detached" && res.files.length === 1 && res.files[0].name === "Welcome.txt" && res.files[0].text === welcome,
              "in columns: a file marked, then a second tap picks it, the input's");
        await page.fill("#text", "Saved from the columns.");
        n = await count();
        await page.click("#fsa-save-as");
        f = await sheet("save");
        await f.waitForSelector("[data-testid=save-columns]");
        check(true, "the save picker in columns too");
        await f.click("[data-testid='save-column-0'] [data-testid='save-col-Music']");
        await f.waitForFunction(() => document.querySelector("[data-testid=save-folder]").textContent.trim() === "Music");
        await shot("3b-save-columns");
        await f.click("[data-testid=save-confirm]");
        await sheetGone();
        res = await nextResult("fsa-saved", n);
        check(res.kind === "fsa-saved" && await readText("/media/internal/Music/note.txt") === "Saved from the columns.",
              "showSaveFilePicker in columns: written in the folder of the last column");
        // The list and Documents again for what follows (the runtime keeps both: filepicker:view, filepicker:lastFolder).
        await page.evaluate((docs) => {
            localStorage.setItem("phoenix:filepicker:view", JSON.stringify("list"));
            localStorage.setItem("phoenix:filepicker:lastFolder", JSON.stringify(docs));
        }, DOCS);

        // ---- Downloads --------------------------------------------------------------------------------
        // What the runtime tells the shell after `from`: the first of a type.
        const hostMessage = async (type, from) => {
            const until = Date.now() + 10000;
            let m = null;
            while (Date.now() < until && !(m = host.slice(from).find((x) => x.type === type))) await page.waitForTimeout(50);
            return m;
        };
        // Saved: the banner comes once the file is written.
        const saved = async (from) => {
            const m = await hostMessage("banner", from);
            return m && m.payload.message;
        };
        const downloadTo = async (button, name, text) => {
            const before = host.length;
            await page.fill("#text", text);
            await page.click(button);
            const s = await sheet("save");
            const suggested = await s.inputValue("[data-testid=save-name]");
            await saveIn(s);
            const banner = await saved(before);
            return { suggested, saved: await readText(`${DOCS}/${name}`), banner };
        };
        let d = await downloadTo("#download-blob", "download.txt", "A Blob, its URL revoked at once.");
        check(d.suggested === "download.txt" && d.saved === "A Blob, its URL revoked at once.",
              "a Blob through a link made by script: the save picker with its name, the file written");
        check(d.banner === "Saved download.txt to Documents", `... and the shell is told (${d.banner})`);
        d = await downloadTo("#download-link", "linked.txt", "A link in the page.");
        check(d.suggested === "linked.txt" && d.saved === "A link in the page.", "a link with download in the page");
        d = await downloadTo("#download-data", "data.txt", "A data: URL, ünïcödé.");
        check(d.suggested === "data.txt" && d.saved === "A data: URL, ünïcödé.", "a data: URL");
        await page.evaluate(() => {
            const create = URL.createObjectURL;
            URL.createObjectURL = function (b) { return (window.__lastUrl = create.call(URL, b)); };
        });
        await page.fill("#text", "FileSaver.js's click.");
        let before = host.length;
        await page.click("#download-filesaver");
        f = await sheet("save");
        check(await f.inputValue("[data-testid=save-name]") === "filesaver.txt", "FileSaver.js's uncancelable click: the save picker too");
        check(await page.evaluate(() => __phoenixRuntime.webDownload({ url: window.__lastUrl, name: "filesaver.txt" })) === true,
              "... and Chromium's own download of it is the runtime's already (webDownload: taken)");
        await saveIn(f);
        await saved(before);
        await page.waitForTimeout(300);
        check(await readText(`${DOCS}/filesaver.txt`) === "FileSaver.js's click." &&
              await page.locator("iframe[data-phoenix-sheet]").count() === 0, "... saved once");

        // A download Chromium started (phoenix-sim's WebAppWindow hands it over).
        before = host.length;
        check(await page.evaluate(() => {
            window.__navUrl = URL.createObjectURL(new Blob(["Navigated to a Blob."], { type: "text/plain" }));
            return __phoenixRuntime.webDownload({ url: window.__navUrl, name: "navigated.txt", mimeType: "text/plain" });
        }) === true, "webDownload: a Blob of the page's");
        f = await sheet("save");
        check(await f.inputValue("[data-testid=save-name]") === "navigated.txt", "... the save picker with Chromium's name for it");
        await saveIn(f);
        await saved(before);
        check(await readText(`${DOCS}/navigated.txt`) === "Navigated to a Blob.", "... saved");
        // A file of the web: the download manager (another origin: localhost).
        before = host.length;
        check(await page.evaluate((u) => __phoenixRuntime.webDownload({ url: u, name: "fixture-icon.svg" }),
                                  `http://localhost:${port}/usr/palm/applications/${APP}/icon.svg`) === true,
              "webDownload: a file of the web");
        const note = await hostMessage("notification", before);
        const icon = await readText("/media/internal/Downloads/fixture-icon.svg");
        check(/<svg/.test(icon || "") && host.slice(before).some((m) => m.type === "ongoing"),
              "... the download manager fetches it into Downloads, with its ongoing activity");
        check(note && note.payload.appId === "org.webosphoenix.files" && note.payload.title === "fixture-icon.svg" &&
              note.payload.body === "Finished downloading" && note.payload.params.path === "/media/internal/Downloads",
              `... and "Finished downloading" opens Files there (${note && [note.payload.title, note.payload.body].join(": ")})`);

        await page.waitForTimeout(300);
        await shot("4-page");
        check(choosers === 0, `Chromium's own file chooser never opened (${choosers})`);
        check(downloads.every((x) => x === "filesaver.txt"), `Chromium downloaded nothing itself but FileSaver.js's uncancelable click (${downloads.join(", ") || "none"})`);
        await context.close();
        await browser.close();
    } finally {
        server.kill();
    }
    const serious = errors.filter((e) => !/ResizeObserver/.test(e));
    check(!serious.length, "no page errors" + (serious.length ? ":\n  " + serious.join("\n  ") : ""));
    console.log(failures ? `${failures} check(s) failed` : "all checks passed");
    console.log(`Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
