#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The page side of editing (runtime/phoenix-runtime.js, "Editing"), in
// headless Chromium with an original Enyo 1.0 app (Memos) and a Phoenix
// app (Files):
//
//  * every Enyo 1.0 app menu starts with Enyo's own Edit submenu (the
//    TouchPad apps did not list it; Mojo gave it to every app), and every
//    @phoenix/ui app menu with the same Edit;
//  * __phoenixRuntime.editState says what Edit can do: Select All, Cut and
//    Paste need a focused field, Copy a selection;
//  * Select All, Cut and Copy act on the focused field through the page's
//    own commands, and Copy puts the text on the system clipboard;
//    PalmSystem.paste() (Enyo's Input and Edit > Paste) puts it back;
//  * Edit's items work from the menu without taking the field's focus;
//  * a mouse press and hold on text selects the word and asks the shell for
//    the edit popup ("editMenu", with the word's box and what it can do);
//    a press that moves, on a button, or on text that cannot be selected
//    (Enyo 1.0's own UI, user-select: none, as on webOS) does not.
//
// The shell side (the popup, and the clipboard itself in QtWebEngine) is
// shell/tests/tst_editpopup.qml and the simulator.
//
// Build the apps first (cd apps && npm ci && npm run build).
//
//   node tools/test-editing.cjs [--tablet] [--out DIR]

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "editing-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8880 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const appUrl = (id) => `${origin}/usr/palm/applications/${id}/index.html`;

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

// Host messages ("__phoenix__" console lines) of one type.
function hostMessages(page, type) {
    const list = [];
    page.on("console", (m) => {
        const t = m.text();
        if (t.startsWith("__phoenix__")) {
            const msg = JSON.parse(t.slice(11));
            if (msg.type === type) list.push(msg.payload);
        }
    });
    return list;
}

async function enyoApp(context) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const menus = hostMessages(page, "editMenu");
    await page.goto(appUrl("com.palm.app.notes"));
    await page.waitForFunction(() => window.enyo && enyo.appMenu && document.body.children.length > 0, null, { timeout: 15000 });
    await page.waitForTimeout(500);

    // A memo on the wall keeps its lines (compat phoenix-compat.css): in the
    // sample groceries memo each item starts a line of its own, under
    // "Groceries", rather than running on after it.
    const lineStarts = await page.waitForFunction(() => {
        const el = [...document.querySelectorAll(".memo-preview-content")].find((e) => /^Groceries/.test(e.textContent));
        const t = el && el.firstChild;
        if (!t || t.nodeType !== 3) return null;
        const at = (word) => {
            const i = t.data.indexOf(word), r = document.createRange();
            r.setStart(t, i); r.setEnd(t, i + 1);
            return Math.round(r.getBoundingClientRect().left);
        };
        return [at("Groceries"), at("Milk"), at("Coffee")];
    }, null, { timeout: 10000 }).then((h) => h.jsonValue(), () => null);
    check(!!lineStarts && lineStarts[1] === lineStarts[0] && lineStarts[2] === lineStarts[0],
          `a memo on the wall keeps its lines: its items start lines of their own (${JSON.stringify(lineStarts)})`);
    // Back in the editor (compat app/phoenix-back.js): back to the wall.
    await page.click(".new-memo");
    await page.waitForTimeout(500);
    const editing = () => page.evaluate(() => enyo.$.appView_edit.showing);
    check(await editing(), "a memo opens in the editor");
    await page.evaluate(() => __phoenixRuntime.back());
    await page.waitForTimeout(500);
    check(!(await editing()), "Back in the editor goes back to the wall");

    // Fields of our own, beside the app's.
    await page.evaluate(() => {
        const add = (html) => { const d = document.createElement("div"); d.innerHTML = html; document.body.appendChild(d.firstChild); };
        add('<input id="edA" type="text" value="hello brave world" style="position:fixed;left:10px;bottom:130px;width:280px;height:30px;font:16px sans-serif;z-index:9999">');
        add('<input id="edB" type="text" value="" style="position:fixed;left:10px;bottom:90px;width:280px;height:30px;z-index:9999">');
        add('<p id="edP" style="position:fixed;left:10px;bottom:50px;margin:0;font:20px sans-serif;background:#fff;z-index:9999;user-select:text">Palm webOS lives</p>');
        add('<p id="edQ" style="position:fixed;left:170px;bottom:10px;margin:0;font:20px sans-serif;z-index:9999">Fixed label</p>');
        add('<button id="edBtn" style="position:fixed;left:10px;bottom:10px;z-index:9999">Press</button>');
    });

    // The menu (made when it first opens): Enyo's EditMenu first, then the
    // app's own items.
    await page.evaluate(() => __phoenixRuntime.openAppMenu());
    await page.waitForTimeout(400);
    await page.evaluate(() => enyo.appMenu.close());
    await page.waitForTimeout(300);
    const menu = await page.evaluate(() => {
        const m = Object.values(enyo.$).find((c) => c instanceof enyo.AppMenu);
        const controls = m.getControls();
        return {
            first: controls[0] instanceof enyo.EditMenu,
            edits: controls.filter((c) => c instanceof enyo.EditMenu).length,
            dom: [...m.hasNode().querySelectorAll(".enyo-menuitem")].map((n) => n.textContent.trim()).filter(Boolean)[0],
            last: controls[controls.length - 1].hasClass("enyo-menu-last") || !!controls[controls.length - 1].hasNode().querySelector(".enyo-menu-last"),
            count: controls.length,
        };
    });
    check(menu.first && menu.edits === 1 && menu.count > 1 && /^Edit/.test(menu.dom) && menu.last, "Enyo app menu: Edit first, once, before the app's items (" + JSON.stringify(menu) + ")");

    const state = () => page.evaluate(() => __phoenixRuntime.editState());
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); getSelection().removeAllRanges(); });
    let s = await state();
    check(!s.editable && !s.canSelectAll && !s.canCut && !s.canCopy && !s.canPaste, "nothing focused or selected: Edit has nothing to do");

    await page.focus("#edA");
    await page.evaluate(() => document.getElementById("edA").setSelectionRange(6, 11));
    s = await state();
    check(s.editable && s.canSelectAll && s.canCut && s.canCopy && s.canPaste, "a field with a selection: all four");

    // Copy, then paste into another field: the system clipboard.
    await page.evaluate(() => __phoenixRuntime.edit("copy"));
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check(clip === "brave", "Copy puts the selection on the clipboard (" + JSON.stringify(clip) + ")");
    await page.focus("#edB");
    await page.evaluate(() => PalmSystem.paste());
    await page.waitForFunction(() => document.getElementById("edB").value === "brave", null, { timeout: 3000 }).catch(() => {});
    check(await page.inputValue("#edB") === "brave", "PalmSystem.paste() pastes the clipboard into the focused field");

    // Cut, and Select All.
    await page.focus("#edA");
    await page.evaluate(() => document.getElementById("edA").setSelectionRange(0, 6));
    await page.evaluate(() => __phoenixRuntime.edit("cut"));
    check(await page.inputValue("#edA") === "brave world"
          && await page.evaluate(() => navigator.clipboard.readText()) === "hello ", "Cut takes the selection to the clipboard");
    await page.evaluate(() => __phoenixRuntime.edit("selectAll"));
    const all = await page.evaluate(() => { const e = document.getElementById("edA"); return [e.selectionStart, e.selectionEnd]; });
    check(all[0] === 0 && all[1] === "brave world".length, "Select All selects the field");

    // From the menu itself, on an Enyo Input (Enyo sends Edit's commands to
    // the focused control): open it, Edit > Copy, the field keeps its focus.
    await page.evaluate(() => {
        const host = document.createElement("div");
        host.style.cssText = "position:fixed;left:10px;bottom:170px;width:280px;z-index:9999;background:#fff";
        document.body.appendChild(host);
        const input = new enyo.Input({ name: "edEnyo", value: "brave new world" });
        input.renderInto(host);
        input.forceFocus();
        // (Enyo finds a control by its node's id: the test keeps its own.)
        window.edEnyo = input.$.input.hasNode();
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => edEnyo.setSelectionRange(0, 5));
    await page.evaluate(() => __phoenixRuntime.openAppMenu());
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, "enyo-menu.png") });
    const editItem = page.locator(".enyo-menuitem", { hasText: /^Edit$/ }).first();
    await editItem.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, "enyo-edit.png") });
    await page.locator(".enyo-menuitem", { hasText: /^Copy$/ }).first().click();
    await page.waitForTimeout(300);
    const fromMenu = await page.evaluate(() => navigator.clipboard.readText());
    check(fromMenu === "brave", "Enyo Edit > Copy copies the field's selection (" + JSON.stringify(fromMenu) + ")");
    check(await page.evaluate(() => document.activeElement === edEnyo), "the field keeps the focus");
    await page.evaluate(() => enyo.appMenu.isOpen && enyo.appMenu.close());
    await page.waitForTimeout(300);

    // Press and hold with the mouse: the word, and the popup.
    const hold = async (sel, dx, dy, move) => {
        const box = await page.locator(sel).boundingBox();
        const x = box.x + dx;
        const y = box.y + (dy === undefined ? box.height / 2 : dy);
        await page.mouse.move(x, y);
        await page.mouse.down();
        if (move) await page.mouse.move(x + 20, y);
        await page.waitForTimeout(700);
        await page.mouse.up();
        await page.waitForTimeout(100);
    };
    const n = menus.length;
    await hold("#edP", 80);
    const word = await page.evaluate(() => String(getSelection()));
    const popup = menus[n];
    check(word === "webOS", "press and hold selects the word (" + JSON.stringify(word) + ")");
    check(popup && popup.appId === "com.palm.app.notes" && popup.width > 20 && popup.height > 10
          && popup.canCopy && !popup.canCut && !popup.canPaste,
          "... and asks the shell for the edit popup over it (" + JSON.stringify(popup) + ")");

    await page.evaluate(() => { document.getElementById("edA").value = "one two three"; });
    await hold("#edA", 60);
    const inField = await page.evaluate(() => { const e = document.getElementById("edA"); return e.value.substring(e.selectionStart, e.selectionEnd); });
    const fieldPopup = menus[n + 1];
    check(inField === "two" && fieldPopup && fieldPopup.canCut && fieldPopup.canPaste && fieldPopup.canSelectAll,
          "in a field: the word, and all four (" + JSON.stringify({ inField, fieldPopup }) + ")");

    const before = menus.length;
    await hold("#edP", 80, undefined, true);
    await hold("#edBtn", 10);
    await hold("#edQ", 20);
    check(menus.length === before, "no popup for a press that moves, on a button, or on text Enyo keeps unselectable (" + JSON.stringify(menus.slice(before)) + ")");

    check(errors.length === 0, "Enyo: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    await page.close();
}

async function phoenixApp(context) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(appUrl("org.webosphoenix.files"));
    await page.waitForFunction(() => window.__phoenixRuntime && document.querySelector("#root, body").children.length > 0, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
        const i = document.createElement("input");
        i.id = "edC";
        i.value = "copy me";
        i.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:9999";
        document.body.appendChild(i);
    });
    await page.focus("#edC");
    await page.evaluate(() => document.getElementById("edC").setSelectionRange(0, 4));
    await page.evaluate(() => __phoenixRuntime.openAppMenu());
    await page.waitForSelector(".pui-appmenu");
    const first = await page.locator(".pui-appmenu [role=menuitem]").first().textContent();
    check(first === "Edit", "Phoenix app menu: Edit first (" + JSON.stringify(first) + ")");
    await page.locator(".pui-appmenu [role=menuitem]", { hasText: /^Edit$/ }).click();
    await page.screenshot({ path: path.join(outDir, "phoenix-edit.png") });
    const labels = await page.locator(".pui-appmenu-subitem").allTextContents();
    check(JSON.stringify(labels) === JSON.stringify(["Select All", "Cut", "Copy", "Paste"]), "Edit's items (" + labels.join(", ") + ")");
    await page.locator(".pui-appmenu-subitem", { hasText: "Copy" }).click();
    await page.waitForTimeout(200);
    check(await page.evaluate(() => navigator.clipboard.readText()) === "copy",
          "Phoenix Edit > Copy copies the field's selection");
    check(await page.evaluate(() => document.activeElement && document.activeElement.id) === "edC"
          && await page.locator(".pui-appmenu").count() === 0, "the menu closes, the field keeps the focus");
    check(errors.length === 0, "Files: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    await page.close();
}

async function main() {
    if (!fs.existsSync(path.join(REPO, "third_party/core-apps/com.palm.app.notes/appinfo.json"))) {
        console.error("third_party/core-apps is missing: git submodule update --init");
        process.exit(2);
    }
    if (!fs.existsSync(path.join(REPO, "apps/files/dist"))) {
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
        await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
        await enyoApp(context);
        await phoenixApp(context);
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "All checks passed"}. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
