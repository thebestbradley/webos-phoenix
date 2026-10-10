#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The file pickers (docs/SHARE-AND-FILES.md), in headless Chromium against
// the virtual webOS filesystem (tools/serve-rootfs.py):
//
//   SF1  luna-systemui's own file picker, as Enyo 1's FilePicker shows it
//        in a frame of the app's card (CrossAppUI), with the runtime and
//        the webOS 3 media kinds behind it, in the original apps' flows:
//        Clock's alarm sound (a ringtone), Email's attachments (several
//        pictures, a document) and Contacts' photo (the crop view, then
//        com.palm.image making the photo, which the contact shows).
//   SF2  org.webosphoenix.filepicker/pick: several kinds (the kind first),
//        several files, a crop size (cropInfo and the crop made), and any
//        file by folder with extensions.
//
//   node tools/test-filepicker.cjs [--out DIR]
//
// Needs the submodules (third_party) and apps/sharesheet built.

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
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "filepicker-tests");
const port = 8400 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const A = `${origin}/usr/palm/applications/`;
const PICKER = "/usr/lib/luna/system/luna-systemui/app/FilePicker/filepicker.html";

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
    for (const need of ["third_party/luna-systemui/app/FilePicker/FilePickerApp.js", "third_party/core-apps/com.palm.app.email/appinfo.json",
                        "apps/sharesheet/dist/index.html"]) {
        if (!fs.existsSync(path.join(REPO, need))) {
            console.error(`${need} is missing: git submodule update --init, and build the apps (cd apps && npm run build)`);
            process.exit(2);
        }
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    const errors = [];
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();

        // A fresh device, and a page of the app (a headless app's window).
        const open = async (url, windowed) => {
            const context = await browser.newContext({ viewport: { width: 1024, height: 740 } });
            let page = await context.newPage();
            const popup = windowed ? context.waitForEvent("page", { timeout: 20000 }) : null;
            await page.goto(url);
            if (popup) { page = await popup; await page.waitForLoadState(); }
            page.on("pageerror", (e) => errors.push(e.message));
            return { context, page };
        };
        const picker = async (page) => {
            const el = await page.waitForSelector(`iframe[src^='${PICKER}']`);
            const f = await el.contentFrame();
            await f.waitForFunction(() => !!window.view && !!window.__phoenixRuntime);
            return f;
        };
        const shot = (page, name) => page.screenshot({ path: path.join(outDir, name + ".png") });

        // ---- SF1: Clock's alarm sound ------------------------------------------------------------
        {
            const { context, page } = await open(A + "com.palm.app.clock/index.html", true);
            await page.waitForFunction(() => window.enyo && enyo.$ && enyo.$.clockMain, null, { timeout: 15000 });
            await page.evaluate(() => enyo.$.clockMain.$.paneMainView.selectViewByName("alarmList"));
            await page.click("text=New Alarm");
            await page.click("#clockMain_alarmList_alarmEdit_itemSound");
            const f = await picker(page);
            check(await f.evaluate(() => PalmSystem.appIdentifier) === "com.palm.app.clock", "SF1: the picker runs as the app whose card it is in");
            await f.waitForSelector("text=Ringtone");
            const tones = await f.evaluate(() => document.body.innerText);
            check(/Ringtone/.test(tones) && /Phone/.test(tones) && /Arcade Ring/.test(tones),
                "Clock's sound: the ringtones (com.palm.media.audio.file:1 isRingtone), the system's and the user's");
            await page.waitForTimeout(300);
            await shot(page, "clock-ringtones");
            await f.click("text=Phone");
            await page.waitForSelector(`iframe[src^='${PICKER}']`, { state: "detached" }).catch(() => {});
            const sound = await page.evaluate(() => [enyo.$.clockMain_alarmList_alarmEdit_lblSound.content,
                enyo.$.clockMain_alarmList_alarmEdit.objAlarmRecord.alarmSoundFile]);
            check(sound[0] === "Phone" && sound[1] === "/usr/palm/sounds/phone.wav", `the alarm takes the sound picked (${sound.join(", ")})`);
            await page.waitForTimeout(300);
            await shot(page, "clock-sound");
            await context.close();
        }

        // ---- SF1: Email's attachments ---------------------------------------------------------------
        {
            const { context, page } = await open(A + "com.palm.app.email/index.html?launchParams=" +
                encodeURIComponent(JSON.stringify({ summary: "Pictures", text: "Here they are" })), true);
            await page.waitForSelector(".attachment-button", { timeout: 20000 });
            await page.waitForTimeout(1000);
            await page.click(".attachment-button");
            let f = await picker(page);
            await f.waitForSelector("text=Documents");
            check(["Photos", "Videos", "Music", "Documents"].every((k) => f.locator(`text=${k}`)), "Email: the picker asks for the kind first");
            await shot(page, "email-kinds");
            await f.click("text=Photos");
            await f.waitForSelector("text=Sample Photos");
            check(/Sample Photos\s*\(7\)/.test(await f.evaluate(() => document.body.innerText)), "the albums (com.palm.media.image.album:1) with their counts");
            await f.click("text=Sample Photos");
            await f.waitForSelector(".AlbumGridThumb img");
            // (Three cells a row; the last row's spare cells are hidden.)
            const thumbs = await f.$$eval(".AlbumGridThumb", (els) => els.filter((e) => e.style.visibility !== "hidden").length);
            check(thumbs === 7, `an album's pictures (com.palm.media.types:1 by albumId): ${thumbs}`);
            await f.locator(".AlbumGridThumb").nth(0).click();
            await f.locator(".AlbumGridThumb").nth(4).click();
            check(/2 Files Selected/.test(await f.evaluate(() => document.body.innerText)), "several pictures are ticked: \"2 Files Selected\"");
            await page.waitForTimeout(500);
            await shot(page, "email-pictures");
            await f.click('text="OK"');
            await page.waitForFunction(() => /petals\.jpg, dunes\.jpg/.test(document.body.innerText), null, { timeout: 5000 }).then(
                () => check(true, "OK attaches them to the message"), () => check(false, "OK attaches them to the message"));
            // A document.
            await page.click(".attachment-button");
            f = await picker(page);
            await f.click("text=Documents");
            await f.waitForSelector("text=meeting-notes.docx");
            await page.waitForTimeout(300);
            await shot(page, "email-documents");
            await f.click("text=meeting-notes.docx");
            await f.waitForSelector("text=1 File Selected");
            // The tap moves the list a few pixels (Enyo's scroller); a tap
            // on OK at once, while it moved, was not taken (seen once, with
            // the list 4 px off). A person's next tap comes later.
            await page.waitForTimeout(500);
            await f.click('text="OK"');
            await page.waitForFunction(() => /meeting-notes\.docx/.test(document.body.innerText), null, { timeout: 5000 }).then(
                () => check(true, "a document (com.palm.media.misc.file:1) is attached too"), () => check(false, "a document is attached too"));
            await page.waitForTimeout(300);
            await shot(page, "email-attached");
            await context.close();
        }

        // ---- SF1: Contacts' photo ----------------------------------------------------------------------
        {
            const { context, page } = await open(A + "com.palm.app.contacts/index.html", false);
            await page.waitForSelector("#contactsApp_splitPane_contacts_addContactsButton", { timeout: 20000 });
            await page.waitForTimeout(1500);
            await page.click("#contactsApp_splitPane_contacts_addContactsButton");
            await page.waitForSelector("#contactsApp_edit_changeButton");
            await page.waitForTimeout(1000);
            await page.click("#contactsApp_edit_changeButton");
            const f = await picker(page);
            await f.click("text=Sample Photos");
            await f.waitForSelector(".AlbumGridThumb img");
            await f.locator(".AlbumGridThumb").nth(0).click();
            await f.waitForSelector(".enyo-croppable-image");
            check(true, "Contacts: a picture opens the crop view (cropWidth / cropHeight 256)");
            await page.waitForTimeout(800);
            await shot(page, "contacts-crop");
            await f.click('text="OK"');
            await page.waitForFunction(() => /blob:/.test(enyo.$.contactsApp_edit_photoImage.node.style.backgroundImage), null, { timeout: 10000 }).then(
                () => check(true, "the contact shows the photo com.palm.image made from the crop"), () => check(false, "the contact shows its new photo"));
            const made = await page.evaluate(() => /url\("?([^")]+)/.exec(enyo.$.contactsApp_edit_photoImage.node.style.backgroundImage)[1]);
            const size = await page.evaluate((u) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = u; }), made);
            check(size && size[0] === size[1] && size[0] > 0, `the photo is square (${size && size.join("x")})`);
            await page.waitForTimeout(500);
            await shot(page, "contacts-photo");
            await context.close();
        }

        // ---- SF2: org.webosphoenix.filepicker/pick ------------------------------------------------------
        {
            const { context, page } = await open(A + "com.palm.app.calculator/index.html", false);
            await page.waitForTimeout(1500);
            const pick = (params) => page.evaluate((p) => {
                window.__picked = undefined;
                const b = new PalmServiceBridge();
                b.onservicecallback = (j) => { window.__picked = JSON.parse(j); };
                b.call("luna://org.webosphoenix.filepicker/pick", JSON.stringify(p));
            }, params);
            const picked = () => page.waitForFunction(() => window.__picked).then((h) => h.jsonValue());
            const sheet = async () => {
                const f = await (await page.waitForSelector("iframe[data-phoenix-sheet=pick]")).contentFrame();
                await f.waitForSelector(".ss-pick");
                await page.waitForTimeout(400);   // it has risen
                return f;
            };

            await pick({ kinds: ["image", "video", "audio", "document", "file"], multiple: true });
            let f = await sheet();
            check(await f.locator("[data-testid^='pick-kind-']").count() === 5, "SF2: several kinds: the kind first");
            await shot(page, "pick-kinds");
            await f.click("[data-testid='pick-kind-audio']");
            await f.locator("[data-testid='pick-audio']").nth(0).click();
            await f.locator("[data-testid='pick-audio']").nth(2).click();
            check(await f.textContent("[data-testid='pick-count']") === "2 Files Selected", "several files: \"2 Files Selected\"");
            await shot(page, "pick-music");
            await f.click("[data-testid='pick-ok']");
            let r = await picked();
            check(r.files && r.files.length === 2 && r.files.every((x) => /^audio\//.test(x.mimeType) && x.size > 0), "OK answers with both songs");

            await pick({ kinds: ["image"], cropWidth: 300, cropHeight: 200 });
            f = await sheet();
            await f.locator("[data-testid='pick-picture']").nth(0).click();
            await f.waitForFunction(() => document.querySelector("[data-testid='pick-crop-image']")?.naturalWidth > 0);
            const frame = await f.locator("[data-testid='pick-crop-frame']").boundingBox();
            check(Math.abs(frame.width / frame.height - 1.5) < 0.02, "a crop size: a frame of its shape (300 x 200)");
            await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
            await page.mouse.wheel(0, -300);
            await page.waitForTimeout(200);
            await page.mouse.down();
            await page.mouse.move(frame.x + frame.width / 2 + 40, frame.y + frame.height / 2 + 30, { steps: 4 });
            await page.mouse.up();
            await shot(page, "pick-crop");
            await f.click("[data-testid='pick-ok']");
            r = await picked();
            const c = r.files && r.files[0].cropInfo;
            check(c && c.sourceWidth === 480 && c.suggestedXsize > 0 && Math.abs(c.suggestedXsize / c.suggestedYsize - 1.5) < 0.05 && c.scale > 0,
                `cropInfo as CroppableImage gave it (${c && [c.suggestedXtop, c.suggestedYtop, c.suggestedXsize, c.suggestedYsize].join(", ")})`);
            const crop = r.files && r.files[0].croppedPath;
            const cropSize = crop && await page.evaluate((p) => __phoenixRuntime.fileManager.url(p).then((u) => new Promise((res) => {
                const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = u;
            })), crop);
            check(cropSize && cropSize[0] === 300 && cropSize[1] === 200, `and the crop made at that size (${crop}: ${cropSize && cropSize.join("x")})`);

            await pick({ kinds: ["file"], extensions: ["txt"] });
            f = await sheet();
            await f.click("[data-testid='pick-folder-Documents']");
            await f.waitForSelector("[data-testid='pick-file']");
            const names = await f.$$eval("[data-testid='pick-file'] .ss-pick-row-title", (els) => els.map((e) => e.textContent));
            check(names.length > 0 && names.every((n) => /\.txt$/.test(n)), `any file, by folder, with extensions: ${names.join(", ")}`);
            await shot(page, "pick-files");
            await f.click("[data-testid='pick-cancel']");
            check(await f.textContent("[data-testid='pick-cancel']") === "Cancel", "Back goes up a folder");
            await f.click("[data-testid='pick-cancel']");
            r = await picked();
            check(r.canceled === true, "Cancel answers {canceled: true}");

            const bad = await page.evaluate(() => new Promise((res) => {
                const b = new PalmServiceBridge();
                b.onservicecallback = (j) => res(JSON.parse(j));
                b.call("luna://org.webosphoenix.filepicker/pick", JSON.stringify({ kinds: ["spreadsheet"] }));
            }));
            check(bad.returnValue === false, "an unknown kind is refused");
            await context.close();
        }

        await browser.close();
    } finally {
        server.kill();
    }
    const serious = errors.filter((e) => !/ResizeObserver/.test(e));
    if (serious.length) console.log("page errors:\n  " + serious.join("\n  "));
    console.log(failures ? `${failures} check(s) failed` : "all checks passed");
    console.log(`Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
