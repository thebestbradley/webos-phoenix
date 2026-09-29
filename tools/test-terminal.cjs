#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Drives the Terminal (apps/terminal, built into dist/) in headless
// Chromium, twice:
//
//   simulated   against the runtime's small simulated shell (no host shell;
//               the same output on every machine): typing, the extras row
//               (sticky and locked Ctrl, arrows, | ~, its other pages),
//               resize on rotation, long press to select, copy and paste,
//               links opening in Web, the app menu (Preferences: shell,
//               text size, colour scheme; Keys Help), New Session and
//               Ctrl+Shift+T opening another card, the back gesture,
//               exit and restart, and that no other app may open a shell
//   real        tools/serve-rootfs.py --terminal with --terminal-shell
//               /bin/sh: a real shell on a real PTY over the dev server's
//               WebSocket (arithmetic, the terminal size and its change,
//               UTF-8, 600 KB of output through the flow control, the exit
//               status) and that a wrong token is refused
//
//   node tools/test-terminal.cjs [--tablet] [--out DIR]
//
// Build the apps first (cd apps && npm ci && npm run build). The device's
// C++ service is tested by services/pty's pty-test.

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const APP = "org.webosphoenix.terminal";
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "terminal-tests", tablet ? "tablet" : "phone");
const viewport = tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 };
const turned = tablet ? { width: 768, height: 996 } : { width: 480, height: 292 };

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

function serve(extra) {
    const port = 8700 + Math.floor(Math.random() * 90);
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port), ...extra], { stdio: "ignore" });
    return { server, origin: `http://127.0.0.1:${port}` };
}

// Page helpers.
function helpers(page, host) {
    const text = () => page.evaluate(() => document.querySelector(".xterm-rows").innerText.replace(/ /g, " "));
    const waitText = async (re, ms = 5000) => {
        const until = Date.now() + ms;
        let t = "";
        while (Date.now() < until) {
            t = await text();
            if (re.test(t)) return true;
            await page.waitForTimeout(50);
        }
        console.log("    (terminal shows: " + JSON.stringify(t.slice(-300)) + ")");
        return false;
    };
    const type = async (s) => {
        await page.focus(".xterm-helper-textarea");
        await page.keyboard.type(s, { delay: 5 });
    };
    const key = (id) => page.dispatchEvent(`[data-testid='key-${id}']`, "pointerdown", { clientX: 10, button: 0 })
        .then(() => page.dispatchEvent("[data-testid='extras']", "pointerup", { clientX: 10 }));
    const appMenu = async (label) => {
        await page.evaluate(() => document.dispatchEvent(new CustomEvent("phoenixAppMenu")));
        await page.click(`.pui-appmenu-item:has-text("${label}")`);
    };
    const size = () => page.evaluate(() => {
        const rows = document.querySelectorAll(".xterm-rows > div").length;
        const probe = document.querySelector(".xterm-char-measure-element");
        return { rows, charWidth: probe ? probe.getBoundingClientRect().width / Math.max(1, probe.textContent.length) : 0 };
    });
    const launches = () => host.filter((m) => m.type === "launch" || m.type === "open");
    return { text, waitText, type, key, appMenu, size, launches };
}

async function simulated(chromium) {
    const { server, origin } = serve([]);
    const appUrl = `${origin}/usr/palm/applications/${APP}/index.html`;
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [];
        const host = [];
        const watch = (p) => {
            p.on("pageerror", (e) => errors.push(e.message));
            p.on("console", (m) => {
                const t = m.text();
                if (t.startsWith("__phoenix__")) host.push(JSON.parse(t.slice(11)));
                else if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push(t);
            });
        };
        watch(page);
        const shot = (name) => page.screenshot({ path: path.join(outDir, "sim-" + name + ".png") });
        const { text, waitText, type, key, appMenu, size, launches } = helpers(page, host);

        await page.goto(appUrl);
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl);
        check(await waitText(/Phoenix simulated shell[\s\S]*user@phoenix:~\$\s*$/), "start: the simulated shell's prompt");
        const hostJson = await (await fetch(`${origin}/usr/share/phoenix/host.json`)).json();
        check(JSON.stringify(hostJson) === "{}", "start: no host shell without --terminal");

        await type("echo hello   terminal\n");
        check(await waitText(/^hello terminal$/m), "type: a command runs and prints");
        await shot("typed");

        // ---- The extras row ----------------------------------------------------------
        await key("ctrl");
        check(await page.getAttribute("[data-testid='key-ctrl']", "aria-pressed") === "true", "extras: Ctrl stays down for the next key");
        await type("c");
        check(await waitText(/\^C/), "extras: Ctrl then c sends Ctrl-C (the shell prints ^C)");
        check(await page.getAttribute("[data-testid='key-ctrl']", "aria-pressed") === "false", "extras: Ctrl is used up by one key");
        await key("ctrl");
        await key("ctrl");
        check(await page.$eval("[data-testid='key-ctrl']", (e) => e.classList.contains("locked")), "extras: tapping Ctrl twice locks it");
        await key("ctrl");
        check(await page.getAttribute("[data-testid='key-ctrl']", "aria-pressed") === "false", "extras: and a third tap releases it");

        await type("echo a");
        await key("pipe");
        await key("tilde");
        await key("slash");
        await key("dash");
        await type("b\n");
        check(await waitText(/^a\|~\/-b$/m), "extras: | ~ / - type their characters");
        await key("up");
        await key("up");
        await type("\n");
        check(await waitText(/hello terminal[\s\S]*hello terminal/), "extras: Up recalls an earlier command");

        await page.dispatchEvent("[data-testid='key-tab']", "pointerdown", { clientX: 200, button: 0 });
        await page.dispatchEvent("[data-testid='extras']", "pointerup", { clientX: 100 });
        check(await page.getAttribute("[data-testid='extras']", "data-page") === "1", "extras: a swipe along the row shows its next page");
        check(!!(await page.$("[data-testid='key-pgup']")) && !!(await page.$("[data-testid='key-lbrace']")), "extras: Home, End, PgUp, PgDn and brackets");
        await page.dispatchEvent("[data-testid='extras-page-2']", "pointerup");
        check(!!(await page.$("[data-testid='key-f12']")), "extras: the function keys");
        await page.dispatchEvent("[data-testid='extras-page-0']", "pointerup");

        // ---- Rotation: the terminal reflows ------------------------------------------------
        const before = await size();
        await type("printenv\n");
        await waitText(/COLUMNS=\d+/);
        const cols1 = Number(/COLUMNS=(\d+)/.exec(await text())[1]);
        await page.setViewportSize(turned);
        await page.waitForTimeout(400);
        await type("clear\nprintenv\n");
        await waitText(/COLUMNS=\d+/);
        const cols2 = Number(/COLUMNS=(\d+)/.exec(await text())[1]);
        const after = await size();
        check(cols2 !== cols1 && (cols2 > cols1) === (turned.width > viewport.width) && after.rows !== before.rows,
              `rotate: the shell hears the new size (${cols1} -> ${cols2} columns, ${before.rows} -> ${after.rows} rows)`);
        await page.setViewportSize(viewport);
        await page.waitForTimeout(300);

        // ---- Links, selection, copy and paste ----------------------------------------------
        await type("clear\necho see https://example.com/phoenix now\n");
        await waitText(/^see https:\/\/example.com\/phoenix now$/m);
        const cell = async (re, offset) => page.evaluate(([src, off]) => {
            const rows = [...document.querySelectorAll(".xterm-rows > div")];
            const screen = document.querySelector(".xterm-screen").getBoundingClientRect();
            const i = rows.findIndex((r) => new RegExp(src).test(r.textContent));
            const row = rows[i].getBoundingClientRect();
            const probe = document.querySelector(".xterm-char-measure-element");
            const cw = probe.getBoundingClientRect().width / probe.textContent.length;
            const col = rows[i].textContent.search(new RegExp(src)) + off;
            return { x: screen.left + (col + 0.5) * cw, y: row.top + row.height / 2 };
        }, [re.source, offset]);
        const link = await cell(/https:/, 3);
        await page.mouse.move(link.x - 2, link.y);
        await page.mouse.move(link.x, link.y);
        await page.waitForTimeout(200);
        const n = launches().length;
        await page.mouse.click(link.x, link.y);
        await page.waitForTimeout(400);
        const opened = launches().slice(n).some((m) => JSON.stringify(m.payload).includes("https://example.com/phoenix"));
        check(opened, "links: tapping a URL opens it in Web");

        const word = await cell(/see/, 1);
        await page.mouse.move(word.x, word.y);
        await page.mouse.down();
        await page.waitForTimeout(700);
        await page.mouse.up();
        await page.waitForSelector(".pui-popup", { timeout: 3000 }).catch(() => {});
        const menuItems = await page.$$eval(".pui-popup .pui-menu-item", (els) => els.map((e) => e.textContent.trim()));
        check(menuItems.includes("Copy") && menuItems.includes("Paste") && menuItems.includes("Select All"),
              `select: a long press selects the word and offers ${menuItems.join(", ")}`);
        await shot("selection");
        await page.click(".pui-popup :text-is('Copy')");
        const copied = await page.evaluate(() => localStorage.getItem("org.webosphoenix.terminal.clipboard"));
        check(copied === "see", `copy: the selected word ("${copied}")`);
        await type("echo pasted:");
        await appMenu("Paste");
        await waitText(/echo pasted:see/);
        await type("\n");
        check(await waitText(/^pasted:see$/m), "paste: from the app menu into the shell");

        // ---- The app menu -------------------------------------------------------------------
        await page.evaluate(() => document.dispatchEvent(new CustomEvent("phoenixAppMenu")));
        const items = await page.$$eval(".pui-appmenu-item", (els) => els.map((e) => e.textContent));
        check(["New Session", "Copy", "Paste", "Select All", "Clear", "Preferences", "Keys Help", "Close Session"].every((i) => items.includes(i)),
              `menu: ${items.join(", ")}`);
        await shot("appmenu");
        await page.click(".pui-appmenu-item:has-text('Preferences')");
        await page.waitForSelector("[data-testid='prefs-dialog']");
        check(/bash/.test(await page.textContent("[data-testid='pref-shell']")), "prefs: the shell is bash by default");
        await page.click("[data-testid='pref-shell']");
        const shells = await page.$$eval(".pui-popup .pui-menu-item", (els) => els.map((e) => e.textContent.trim()));
        check(shells.some((s) => /zsh/.test(s)) && shells.some((s) => /fish/.test(s)), `prefs: zsh (and fish) can be chosen (${shells.join(", ")})`);
        await page.click(".pui-popup :text-matches('^zsh')");
        check(/zsh/.test(await page.textContent("[data-testid='pref-shell']")), "prefs: zsh chosen for new sessions");
        await page.click("[data-testid='pref-scheme']");
        await page.click(".pui-popup :text-is('Classic')");
        check(await page.getAttribute(".term-app", "data-scheme") === "classic", "prefs: the Classic colour scheme applies at once");
        const sizeBefore = await size();
        await page.click("[data-testid='pref-size']");
        await page.click(".pui-popup :text-is('Large')");
        await page.waitForTimeout(300);
        const sizeAfter = await size();
        check(sizeAfter.charWidth > sizeBefore.charWidth, `prefs: larger text (${sizeBefore.charWidth.toFixed(1)} -> ${sizeAfter.charWidth.toFixed(1)} px a character)`);
        await shot("prefs");
        await page.click("[data-testid='prefs-done']");
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("org.webosphoenix.terminal.prefs")));
        check(stored.shell === "zsh" && stored.scheme === "classic" && stored.textSize === "large", "prefs: kept for the next card");
        await appMenu("Keys Help");
        check(/Ctrl\+Shift\+T/.test(await page.textContent("[data-testid='keys-help']")), "help: the keys (after the Preware Terminal's Non-Obvious Keys)");
        await page.click("[data-testid='keys-done']");

        // ---- More sessions: more cards -------------------------------------------------------
        const [card2] = await Promise.all([context.waitForEvent("page"), appMenu("New Session")]);
        watch(card2);
        await card2.waitForSelector(".xterm-rows");
        const h2 = helpers(card2, host);
        check(await h2.waitText(/user@phoenix:~\$\s*$/), "new session: a second card with its own shell");
        check(await card2.getAttribute(".term-app", "data-scheme") === "classic", "new session: with the preferences");
        await card2.close();
        await page.bringToFront();
        await page.focus(".xterm-helper-textarea");
        const [card3] = await Promise.all([context.waitForEvent("page"), page.keyboard.press("Control+Shift+T")]);
        check(!!card3, "keyboard: Ctrl+Shift+T opens a new session");
        await card3.close();

        // The back gesture reaches the shell as Esc, not as leaving the app.
        await page.focus(".xterm-helper-textarea");
        const backHandled = await page.evaluate(() => __phoenixRuntime.back());
        // Esc then x is Alt-x to the shell, which the simulated one ignores: the x never shows.
        await type("xecho esc-ok\n");
        check(backHandled && await waitText(/\$ echo esc-ok\nesc-ok$/m), "back: Esc for the shell");

        // ---- Exit and restart ---------------------------------------------------------------------
        await type("exit 7\n");
        check(await waitText(/fsh exited with code 7\. Press Enter[\s\S]*for a new session\./), "exit: the status and how to go on");
        await type("\n");
        check(await waitText(/Phoenix simulated shell[^\n]*\n[\s\S]*\$\s*$/), "exit: Enter starts a new shell");
        await shot("final");

        // ---- Only the Terminal may open a shell -----------------------------------------------------
        const other = await context.newPage();
        await other.goto(`${origin}/usr/palm/applications/org.webosphoenix.tasks/index.html`);
        const refused = await other.evaluate(() => new Promise((res) => {
            const b = new PalmServiceBridge();
            b.onservicecallback = (j) => res(JSON.parse(j));
            b.call("luna://org.webosphoenix.pty/open", JSON.stringify({ cols: 80, rows: 24, subscribe: true }));
        }));
        check(refused.returnValue === false && refused.errorCode === 1, "security: another app may not open a shell");
        await other.close();

        check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
}

async function real(chromium) {
    const sh = fs.existsSync("/bin/sh") ? "/bin/sh" : null;
    if (!sh) { console.log("skip real shell: no /bin/sh"); return; }
    const { server, origin } = serve(["--terminal", "--terminal-shell", sh]);
    const appUrl = `${origin}/usr/palm/applications/${APP}/index.html`;
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const hostJson = await (await fetch(`${origin}/usr/share/phoenix/host.json`, { headers: { Host: new URL(origin).host } })).json();
        check(hostJson.pty === "websocket" && /token=/.test(hostJson.url), "real: the dev server offers a WebSocket PTY with a token");
        const bad = await fetch(`${origin}/__phoenix/pty/shells?token=wrong`);
        check(bad.status === 403, "real: a wrong token is refused");
        const foreign = await fetch(hostJson.url.replace(/^ws/, "http").replace("/__phoenix/pty?", "/__phoenix/pty/shells?"),
                                    { headers: { Origin: "http://evil.example" } });
        check(foreign.status === 403, "real: another site's page is refused");

        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const { text, waitText, type } = helpers(page, []);
        await page.goto(appUrl);
        await page.evaluate(() => localStorage.clear());
        await page.goto(appUrl);
        check(await waitText(/on this computer \(the host\)[\s\S]*[$#]\s*$/), "real: a real shell's prompt, marked as the host's");
        await type("echo phoenix-$((6*7))\n");
        check(await waitText(/^phoenix-42$/m), "real: the shell computes (echo $((6*7)))");
        await type("stty size\n");
        await waitText(/^\d+ \d+$/m);
        const [rows1, cols1] = /^(\d+) (\d+)$/m.exec(await text()).slice(1).map(Number);
        check(rows1 > 5 && cols1 > 20, `real: the PTY has the card's size (${cols1}x${rows1})`);
        await page.setViewportSize(turned);
        await page.waitForTimeout(400);
        await type("clear; stty size\n");
        await page.waitForTimeout(400);
        await waitText(/^\d+ \d+$/m);
        const [rows2, cols2] = /^(\d+) (\d+)$/m.exec(await text()).slice(1).map(Number);
        check(cols2 !== cols1 && rows2 !== rows1, `real: resize reaches the PTY (${cols1}x${rows1} -> ${cols2}x${rows2})`);
        await page.setViewportSize(viewport);
        await type("clear; printf 'caf\\303\\251 \\342\\202\\254\\n'\n");
        check(await waitText(/^café €$/m), "real: UTF-8 output");
        await type("clear; head -c 600000 /dev/zero | tr '\\000' x; echo; echo flood-done\n");
        check(await waitText(/^flood-done$/m, 20000), "real: 600 KB of output gets through the flow control");
        await page.screenshot({ path: path.join(outDir, "real-shell.png") });
        await type("exit 5\n");
        check(await waitText(/exited with code 5/), "real: the exit status");
        check(errors.length === 0, "real: no page errors" + (errors.length ? ":\n    " + errors.slice(0, 5).join("\n    ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
}

async function main() {
    if (!fs.existsSync(path.join(REPO, "apps/terminal/dist/index.html"))) {
        console.error("apps/terminal/dist is missing: run `npm ci && npm run build` in apps/ first");
        process.exit(2);
    }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    console.log("# simulated shell");
    await simulated(chromium);
    console.log("# real shell (serve-rootfs.py --terminal)");
    await real(chromium);
    console.log(`\nScreenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
