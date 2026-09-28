#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives Files (apps/files, built into dist/) in headless Chromium against
// the simulated org.webosphoenix.filemanager in runtime/phoenix-runtime.js:
// browses /media/internal, shows hidden files and sorts, makes and renames
// a folder, copies a file into it and pastes it twice, edits and saves a
// text file, makes a new file, goes back with the back gesture, shows the
// info sheet, deletes the folder, views pictures, installs an .ipk, opens
// a song with Music, and opens a read-only system file.
//
//   node tools/test-files.cjs [--tablet] [--out DIR]
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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "files-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8700 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const appUrl = (id, params) => `${origin}/usr/palm/applications/${id}/index.html` +
    (params ? "?launchParams=" + encodeURIComponent(JSON.stringify(params)) : "");

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
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
    if (!fs.existsSync(path.join(REPO, "apps/files/dist/index.html"))) {
        console.error("apps/files/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const errors = [];
        const host = [];
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
            else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
        });
        const lastHost = (type) => [...host].reverse().find((m) => m.type === type);
        const shot = (name) => page.screenshot({ path: path.join(outDir, name + ".png") });
        const row = (name) => `[data-testid='file-${name}']`;
        const title = () => page.textContent("[data-testid='folder-title']");
        const menuItem = (text) => page.click(`.pui-menu-item:has-text("${text}")`);
        const luna = (uri, params) => page.evaluate(([u, p]) => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call(u, JSON.stringify(p));
        }), [uri, params]);
        const hold = async (sel) => {
            const box = await page.locator(sel).boundingBox();
            await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
            await page.mouse.down();
            await page.waitForTimeout(700);
            await page.mouse.up();
        };
        const favorite = async (name) => {
            if (tablet) {
                await page.click(`[data-testid='fav-${name}']`);
            } else {
                await page.click("[data-testid='favorites']");
                await menuItem(name);
            }
        };
        const nameDialog = async (value) => {
            await page.waitForSelector("[data-testid='name-dialog']");
            await page.fill("[data-testid='name-field']", value);
            await page.click("[data-testid='name-ok']");
            await page.waitForSelector("[data-testid='name-dialog']", { state: "detached" });
        };

        // Start from a fresh device.
        await page.goto(appUrl("org.webosphoenix.files"));
        await page.evaluate(() => new Promise((res) => {
            localStorage.clear();
            const r = indexedDB.deleteDatabase("phoenix-media");
            r.onsuccess = r.onerror = r.onblocked = () => res();
        }));
        await page.reload();

        // ---- Browse ----------------------------------------------------------------
        await page.waitForSelector(row("Documents"));
        check((await title()) === "Internal storage", "opens /media/internal");
        const top = await page.$$eval(".fm-row .pui-row-title", (els) => els.map((e) => e.textContent));
        check(["Documents", "Downloads", "Music", "Pictures", "ringtones", "samples"].every((n) => top.includes(n)),
            `the storage has the usual folders (${top.join(", ")})`);
        check(!top.includes(".thumbnails"), "hidden files are hidden");
        check((await page.$$eval("[data-testid^='crumb-']", (els) => els.map((e) => e.textContent))).join(" ") === "/ media internal",
            "the path bar shows / media internal");
        await page.waitForTimeout(200);
        await shot("browse");

        await page.click("[data-testid='menu']");
        await page.waitForSelector(".pui-popup");
        await shot("menu");
        await menuItem("Show Hidden Files");
        await page.waitForSelector(row(".thumbnails"));
        check(true, "the menu shows hidden files");
        await page.click("[data-testid='menu']");
        await menuItem("Hide Hidden Files");
        await page.waitForSelector(row(".thumbnails"), { state: "detached" });

        await page.click(row("Documents"));
        await page.waitForSelector(row("Welcome.txt"));
        check((await title()) === "Documents", "tapping a folder opens it");
        const listed = () => page.$$eval(".fm-row .pui-row-title", (els) => els.map((e) => e.textContent));
        check((await listed()).join(",") === "Shopping list.txt,Trip notes.md,Welcome.txt", "sorted by name");
        await page.click("[data-testid='menu']");
        await menuItem("Sort by Size");
        await page.waitForFunction(() => document.querySelector(".fm-row .pui-row-title").textContent === "Welcome.txt");
        check(true, "sort by size puts the largest file first");
        await page.click("[data-testid='menu']");
        await menuItem("Sort by Date");
        await page.waitForFunction(() => document.querySelector(".fm-row .pui-row-title").textContent === "Shopping list.txt");
        check(true, "sort by date puts the newest file first");
        await page.click("[data-testid='menu']");
        await menuItem("Sort by Name");

        // ---- New folder, rename ---------------------------------------------------------
        await page.click("[data-testid='new']");
        await menuItem("New Folder");
        await nameDialog("Projects");
        await page.waitForSelector(row("Projects"));
        check(true, "new folder: Projects");
        await hold(row("Projects"));
        await page.waitForSelector("[data-testid='check-Projects'][aria-checked='true']");
        check((await title()) === "1 selected", "holding an item selects it");
        await shot("select");
        await page.click("[data-testid='more']");
        await menuItem("Rename");
        await nameDialog("Work");
        await page.waitForSelector(row("Work"));
        check(await page.locator(row("Projects")).count() === 0, "rename: Projects is now Work");

        // ---- Copy and paste --------------------------------------------------------------
        await page.click("[data-testid='select']");
        await page.click("[data-testid='check-Welcome.txt']");
        await page.click("[data-testid='copy']");
        await page.waitForSelector("[data-testid='paste']");
        await page.click(row("Work"));
        await page.waitForSelector("[data-testid='empty']");
        await page.click("[data-testid='paste']");
        await page.waitForSelector(row("Welcome.txt"));
        await page.click("[data-testid='paste']");
        await page.waitForSelector(row("Welcome 2.txt"));
        check(true, "copy and paste twice: Welcome.txt and Welcome 2.txt");
        await page.waitForTimeout(300);
        await shot("pasted");

        // ---- Text editor ---------------------------------------------------------------------
        await page.click(row("Welcome.txt"));
        await page.waitForSelector("[data-testid='editor-text']");
        check((await page.inputValue("[data-testid='editor-text']")).startsWith("Welcome to webOS Phoenix!"), "the editor shows the text");
        await page.click("[data-testid='editor-text']");
        await page.keyboard.press("Control+End");
        await page.keyboard.type("Edited in Files.\n");
        await page.waitForSelector("[data-testid='editor-save']:not([disabled])");
        await shot("editor");
        await page.click("[data-testid='editor-save']");
        await page.waitForSelector("[data-testid='editor-save'][disabled]");
        const saved = await luna("luna://org.webosphoenix.filemanager/read", { path: "/media/internal/Documents/Work/Welcome.txt" });
        check(/Edited in Files\.\n$/.test(saved.data), "saving writes the file back");
        await page.click("[data-testid='editor-close']");
        await page.waitForSelector("[data-testid='text-editor']", { state: "detached" });

        await page.click("[data-testid='new']");
        await menuItem("New File");
        await nameDialog("todo.txt");
        await page.waitForSelector("[data-testid='editor-text']");
        await page.fill("[data-testid='editor-text']", "- buy milk\n");
        await page.keyboard.press("Escape");
        await page.waitForSelector("[data-testid='discard-dialog']");
        check(true, "back with unsaved changes asks first");
        await page.click("[data-testid='discard-save']");
        await page.waitForSelector("[data-testid='text-editor']", { state: "detached" });
        await page.waitForSelector(row("todo.txt"));
        check((await page.textContent(`${row("todo.txt")} .pui-row-subtitle`)).startsWith("11 B"), "new file: todo.txt saved (11 B)");

        // ---- Back gesture, info, delete ------------------------------------------------------------
        await page.keyboard.press("Escape");
        await page.waitForSelector(row("Welcome.txt"));
        check((await title()) === "Documents", "the back gesture returns to Documents");

        await page.click("[data-testid='select']");
        await page.click("[data-testid='check-Welcome.txt']");
        await page.click("[data-testid='more']");
        await menuItem("Info");
        await page.waitForSelector("[data-testid='info-dialog']");
        check((await page.textContent("[data-testid='info-path']")) === "/media/internal/Documents/Welcome.txt", "info shows the full path");
        check((await page.textContent("[data-testid='info-permissions']")).includes("-rw-r--r-- (0644)"), "info shows the permissions");
        check((await page.textContent("[data-testid='info-type']")).includes("text/plain"), "info shows the type");
        await page.waitForTimeout(300);
        await shot("info");
        await page.click("[data-testid='info-close']");
        await page.click("[data-testid='check-Welcome.txt']");
        await page.click("[data-testid='check-Work']");
        await page.click("[data-testid='delete']");
        await page.waitForSelector("[data-testid='delete-dialog']");
        await page.waitForTimeout(300);
        await shot("delete");
        await page.click("[data-testid='delete-confirm']");
        await page.waitForSelector(row("Work"), { state: "detached" });
        const gone = await luna("luna://org.webosphoenix.filemanager/stat", { path: "/media/internal/Documents/Work" });
        check(gone.returnValue === false && gone.errorCode === 1, "delete removes the folder and what is in it");

        // ---- Image viewer ------------------------------------------------------------------------
        await favorite("Pictures");
        await page.waitForSelector(row("harbor-dusk.jpg"));
        check((await title()) === "Pictures", "favourites open Pictures");
        await page.click(row("alpine-lake.jpg"));
        await page.waitForSelector("[data-testid='image-viewer']");
        await page.waitForFunction(() => document.querySelector("[data-testid='viewer-image']")?.naturalWidth > 0);
        check((await page.textContent("[data-testid='viewer-index']")).startsWith("1 of 3"), "the viewer shows the first of 3 pictures");
        await page.click("[data-testid='viewer-next']");
        await page.waitForFunction(() => document.querySelector("[data-testid='viewer-title']").textContent === "aurora.jpg");
        await page.waitForFunction(() => document.querySelector("[data-testid='viewer-image']")?.naturalWidth > 0);
        check(true, "next shows aurora.jpg");
        await page.waitForTimeout(200);
        await shot("viewer");
        await page.keyboard.press("Escape");
        await page.waitForSelector("[data-testid='image-viewer']", { state: "detached" });

        // ---- Install a package, open with ----------------------------------------------------------
        await favorite("Downloads");
        await page.click(row("org.example.hello_1.0.0_all.ipk"));
        await page.waitForSelector("[data-testid='install-confirm']");
        await page.click("[data-testid='install-confirm']");
        await page.waitForFunction(() => /Installed/.test(document.querySelector("[data-testid='install-status']")?.textContent ?? ""));
        check(true, "installing the .ipk reports success");
        await shot("install");
        await page.click("[data-testid='install-close']");

        await favorite("Music");
        host.length = 0;
        await page.click(row("morning-boot.ogg"));
        await page.waitForSelector("[data-testid='open-with-org.webosphoenix.music']");
        await shot("open-with");
        await page.click("[data-testid='open-with-org.webosphoenix.music']");
        await page.waitForSelector("[data-testid='open-with-dialog']", { state: "detached" });
        const launch = lastHost("launch");
        check(launch && launch.payload.id === "org.webosphoenix.music" && launch.payload.params.target === "/media/internal/Music/morning-boot.ogg",
            "open with Music launches it with the file");

        // ---- System files ----------------------------------------------------------------------------
        await page.click("[data-testid='crumb-0']");
        await page.waitForSelector(row("etc"));
        check((await title()) === "Device", "the path bar goes to /");
        await page.click(row("etc"));
        await page.click(row("hostname"));
        await page.waitForSelector("[data-testid='editor-text'][readonly]");
        check((await page.inputValue("[data-testid='editor-text']")) === "webos-phoenix\n", "system files open read-only");
        await page.keyboard.press("Escape");
        await page.waitForSelector("[data-testid='text-editor']", { state: "detached" });
        await hold(row("hostname"));
        check(await page.locator("[data-testid='delete']").isDisabled(), "system files cannot be deleted");
        await page.keyboard.press("Escape");

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
