#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The page side of the virtual keyboard (runtime/phoenix-runtime.js,
// "Virtual keyboard"), with an original Enyo 1.0 app (Memos) in headless
// Chromium:
//
//  * an editable element taking the focus reaches the shell as an
//    "inputFocus" host message with its PalmIME field type (e-mail 4,
//    URL 7, password 1, ...), and losing it too; buttons and the like do not;
//  * Enyo's manual mode (enyo.keyboard.forceShow / forceHide over
//    PalmSystem.setManualKeyboardEnabled / keyboardShow / keyboardHide)
//    shows and hides it on request and stops following the focus;
//  * the shell's hide key blurs the element (__phoenixRuntime.imeRemoveFocus);
//  * the keyboard coming up or going reaches the app as Enyo's
//    "keyboardShown" event (Mojo.keyboardShown), and
//    com.palm.systemmanager/getSystemStatus reports ime.visible as the
//    shell last said;
//  * a key click (playFeedback "key") plays its sound file.
//
//   node tools/test-keyboard.cjs [--tablet] [--out DIR]

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
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "keyboard-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const port = 8880 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}/usr/palm/applications/com.palm.app.notes/index.html`;

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
    if (!fs.existsSync(path.join(REPO, "third_party/core-apps/com.palm.app.notes/appinfo.json"))) {
        console.error("third_party/core-apps is missing: git submodule update --init");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`http://127.0.0.1:${port}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [];
        const inputs = [];   // inputFocus payloads
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            const t = m.text();
            if (t.startsWith("__phoenix__")) {
                const msg = JSON.parse(t.slice(11));
                if (msg.type === "inputFocus") inputs.push(msg.payload);
            }
        });
        await page.goto(base);
        await page.waitForFunction(() => window.enyo && enyo.keyboard && document.body.children.length > 0, null, { timeout: 15000 });
        await page.waitForTimeout(500);
        const last = () => inputs[inputs.length - 1];
        const settle = () => page.waitForTimeout(100);

        // Fields to focus, beside the app's own.
        await page.evaluate(() => {
            const add = (html) => { const d = document.createElement("div"); d.innerHTML = html; document.body.appendChild(d.firstChild); };
            add('<input id="kbText" type="text">');
            add('<input id="kbEmail" type="email">');
            add('<input id="kbUrl" type="url">');
            add('<input id="kbPassword" type="password">');
            add('<textarea id="kbArea"></textarea>');
            add('<button id="kbButton">OK</button>');
            add('<input id="kbCheck" type="checkbox">');
        });

        // ---- The focus reaches the shell ---------------------------------------------------
        const n0 = inputs.length;
        await page.focus("#kbText");
        await settle();
        check(inputs.length === n0 + 1 && last().focused === true && last().state.type === 0, "a text field: focused, FieldType_Text (" + JSON.stringify(last()) + ")");
        check(last().appId === "com.palm.app.notes", "the message names the app");
        await page.focus("#kbEmail");
        await settle();
        check(last().focused && last().state.type === 4, "an e-mail field: FieldType_Email");
        await page.focus("#kbUrl");
        await settle();
        check(last().focused && last().state.type === 7, "a URL field: FieldType_URL");
        await page.focus("#kbPassword");
        await settle();
        check(last().focused && last().state.type === 1, "a password field: FieldType_Password");
        await page.focus("#kbArea");
        await settle();
        check(last().focused && last().state.type === 0, "a text area: FieldType_Text");
        await page.focus("#kbButton");
        await settle();
        check(last().focused === false, "a button takes the focus: the keyboard goes");
        const n1 = inputs.length;
        await page.focus("#kbCheck");
        await settle();
        check(inputs.length === n1, "nothing new for a check box");

        // ---- Keys typed into the page ------------------------------------------------------
        await page.focus("#kbText");
        await page.keyboard.type("hi");
        check(await page.evaluate(() => document.getElementById("kbText").value) === "hi", "key events type into the focused field");

        // ---- The hide key ----------------------------------------------------------------------
        await page.evaluate(() => __phoenixRuntime.imeRemoveFocus());
        await settle();
        check(await page.evaluate(() => document.activeElement === document.body || !document.activeElement), "imeRemoveFocus blurs the field");
        check(last().focused === false, "and the shell hears it lost the focus");

        // ---- The focused field leaves the page (a view gone under Back) -------------------------
        await page.evaluate(() => { const d = document.createElement("div"); d.id = "kbGone"; d.innerHTML = '<input type="text">'; document.body.appendChild(d); });
        await page.focus("#kbGone input");
        await settle();
        check(last().focused === true, "a field in a view about to go: focused");
        // Qt WebEngine 6.8's Chromium 122 sends no focusout for a removed
        // element (newer ones do): swallow it here to be that Chromium.
        await page.evaluate(() => {
            const stop = (e) => e.stopImmediatePropagation();
            window.addEventListener("focusout", stop, true);
            document.getElementById("kbGone").remove();
            window.removeEventListener("focusout", stop, true);
        });
        await settle();
        check(last().focused === false, "its view is removed: the shell hears the focus went (Chromium sends no focusout)");
        // ...and a view hidden with its field focused (Memos' editor under Back).
        await page.evaluate(() => { const d = document.createElement("div"); d.id = "kbHidden"; d.innerHTML = '<textarea></textarea>'; document.body.appendChild(d); });
        await page.focus("#kbHidden textarea");
        await settle();
        check(last().focused === true, "a field in a view about to hide: focused");
        await page.evaluate(() => { document.getElementById("kbHidden").style.display = "none"; });
        await settle();
        check(last().focused === false && await page.evaluate(() => document.activeElement === document.body),
              "its view hides: the field loses the focus and the keyboard goes");
        await page.evaluate(() => document.getElementById("kbHidden").remove());

        // ---- Enyo's manual mode -------------------------------------------------------------------
        await page.evaluate(() => enyo.keyboard.forceShow(enyo.keyboard.typeEmail));
        await settle();
        check(last().focused === true && last().state.type === 4, "enyo.keyboard.forceShow(typeEmail) shows it");
        check(await page.evaluate(() => enyo.keyboard.isManualMode()), "in manual mode");
        const n2 = inputs.length;
        await page.focus("#kbUrl");
        await page.focus("#kbButton");
        await settle();
        check(inputs.length === n2, "manual mode: the focus is not followed");
        await page.evaluate(() => enyo.keyboard.forceHide());
        await settle();
        check(last().focused === false, "enyo.keyboard.forceHide() hides it");
        await page.evaluate(() => enyo.keyboard.setManualMode(false));
        await page.focus("#kbText");
        await settle();
        check(last().focused === true, "back to automatic: the focus is followed again");

        // ---- The shell tells the app ------------------------------------------------------------------
        await page.evaluate(() => {
            window.__kb = [];
            enyo.dispatcher.features.push(function (e) { if (e.type === "keyboardShown") window.__kb.push(e.showing); });
        });
        await page.evaluate(() => __phoenixRuntime.keyboardShown(true));
        check(await page.evaluate(() => enyo.keyboard.isShowing()) === true, "Mojo.keyboardShown(true): enyo.keyboard.isShowing()");
        await page.evaluate(() => __phoenixRuntime.keyboardShown(false));
        check(JSON.stringify(await page.evaluate(() => window.__kb)) === "[true,false]", "Enyo's keyboardShown events follow");
        await page.screenshot({ path: path.join(outDir, "memos.png") });

        const status = () => page.evaluate(() => new Promise((resolve) => {
            __phoenixRuntime.dispatch("luna://com.palm.systemmanager/getSystemStatus", {}, resolve,
                                      { cancelled: function () { return false; }, onCancel: null });
        }));
        let s = await status();
        check(s && s.ime && s.ime.visible === false, "getSystemStatus: ime.visible false by default");
        await page.evaluate(() => __phoenixRuntime.applyHostStatus({ ime: { visible: true } }));
        s = await status();
        check(s.ime.visible === true, "getSystemStatus: ime.visible as the shell said");
        await page.evaluate(() => __phoenixRuntime.applyHostStatus({ ime: { visible: false } }));

        // The key clicks (shell/assets/sounds/phoenix/feedback, CC0 mimics):
        // the shell plays them through a page's audiod; here the page plays
        // one itself, and the file is served as a short WAV.
        const click = await page.evaluate(() => new Promise((resolve) => {
            const n = __phoenixRuntime.sounds.log.length;
            __phoenixRuntime.dispatch("luna://com.webos.service.audio/playFeedback", { name: "key" }, () => {
                const e = __phoenixRuntime.sounds.log[n] || {};
                fetch(e.fileName || "/").then((r) => r.arrayBuffer().then((b) => {
                    const tag = (from, to) => String.fromCharCode.apply(null, new Uint8Array(b.slice(from, to)));
                    resolve({ file: e.fileName, sink: e.sink, status: r.status, riff: tag(0, 4) + tag(8, 12), bytes: b.byteLength });
                }), () => resolve({ file: e.fileName, error: true }));
            }, { cancelled: function () { return false; }, onCancel: null });
        }));
        check(click.file === "/usr/share/phoenix/sounds/feedback/key.wav" && click.sink === "pfeedback" && click.status === 200
              && click.riff === "RIFFWAVE" && click.bytes < 10000,
              "a key click plays on the feedback stream (" + JSON.stringify(click) + ")");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(`\n${failures ? failures + " check(s) failed" : "All checks passed"}. Screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
