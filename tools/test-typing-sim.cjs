#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Every character typed on a hardware keyboard into phoenix-sim, as X
// delivers it (xdotool through Xvfb's XKB keymap, then Qt's xcb and Qt
// WebEngine): the US layout and, with setxkbmap, German and French, their
// Shift and AltGr levels too. Into each kind of field:
//
//   - Just Type (com.palm.launcher's search field, an Enyo 1.0 RichText),
//     typed in card view (the first keys go through the shell's typeAhead);
//   - an Enyo 1.0 app's enyo.Input and enyo.RichText (Memos' page);
//   - the Browser's URL bar (isis-browser AddressInput, an enyo.Input);
//   - a Phoenix React app's controlled input (Help's search);
//   - the lock screen's password (the shell's own QML field): set, the
//     device locked, the password typed and Enter: unlocked.
//
// And first, the virtual keyboard into web pages: shell/tests-web
// (tst_keyboardweb.qml: every key of every layer of the phone's and the
// tablet's keyboards, through KeyInjector and Qt WebEngine, into a plain
// input and Enyo 1.0's Input and RichText), run with qmltestrunner with Qt
// WebEngine's sandbox off (--qmltestrunner, else $QT_ROOT_DIR's, the Qt
// the build found, or the PATH's; --no-qml skips it). The virtual
// keyboard into the shell's own fields is shell/tests/tst_keyboardcharacters.qml.
//
// What reaches the field must be the characters typed, nothing remapped
// (the owner's "/" that came out "?", 28 November 2026). The pages are read
// over Qt WebEngine's DevTools protocol (QTWEBENGINE_REMOTE_DEBUGGING), as
// tools/test-signin-card-sim.cjs does.
//
//   xvfb-run -a -s "-screen 0 1920x1200x24" node tools/test-typing-sim.cjs [--tablet] [--layouts us,de,fr]
//       [--sim build/phoenix-sim] [--out DIR] [--qmltestrunner PATH] [--no-qml] [--no-sim]
//
// Needs phoenix-sim and the apps built, xdotool, setxkbmap and xkbcomp,
// a display (Xvfb: the layout is changed on that display only).
// TYPING_DEBUG=1 prints each failing page's last key events.

"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const tablet = args.includes("--tablet");
const form = tablet ? "tablet" : "phone";
const SIM = path.resolve(opt("--sim", path.join(REPO, "build", "phoenix-sim")));
const outDir = path.resolve(opt("--out", path.join(REPO, "build", "typing-tests", form)));
const QML_DIR = opt("--qml-dir", path.join(REPO, "shell", "qml"));
const LAYOUTS = opt("--layouts", "us,de,fr").split(",");
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 500);
const BUILD = path.dirname(SIM);

// ---- The virtual keyboard into web pages (shell/tests-web) --------------------------

function qmltestrunner() {
    const given = opt("--qmltestrunner", "");
    if (given) return given;
    const roots = [process.env.QT_ROOT_DIR];
    try {
        // The Qt the build found: Qt6_DIR is <root>/lib/cmake/Qt6.
        const m = /^Qt6_DIR:[A-Z]+=(.*)$/m.exec(fs.readFileSync(path.join(BUILD, "CMakeCache.txt"), "utf8"));
        if (m) roots.push(path.resolve(m[1], "..", "..", ".."));
    } catch (e) { /* no cache */ }
    for (const r of roots)
        if (r && fs.existsSync(path.join(r, "bin", "qmltestrunner"))) return path.join(r, "bin", "qmltestrunner");
    return "qmltestrunner";
}
function runWebQml() {
    const r = require("child_process").spawnSync(qmltestrunner(), ["-import", path.join(REPO, "shell", "qml"), "-import", path.join(BUILD, "qml"),
                                                                 "-input", path.join(REPO, "shell", "tests-web")], {
        env: Object.assign({}, process.env, { QT_QPA_PLATFORM: "offscreen", QTWEBENGINE_DISABLE_SANDBOX: "1" }),
        encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024
    });
    const out = (r.stdout || "") + (r.stderr || "");
    const lines = out.split("\n").filter((l) => /^(PASS|FAIL!|XPASS|   Actual|   Expected|   Loc|Totals)/.test(l));
    lines.forEach((l) => console.log("     " + l));
    check(r.status === 0 && /Totals: \d+ passed, 0 failed/.test(out), "the virtual keyboard into web pages (shell/tests-web)"
          + (r.error ? ": " + r.error.message : ""));
}

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
    for (let t = 0; t < (ms || 15000); t += 250) {
        const v = await fn().catch(() => null);
        if (v) return v;
        await sleep(250);
    }
    return null;
}

// ---- What is typed ----------------------------------------------------------------

// Every character the layout in use has on a key, typed as a person types
// it: that key's keycode, with Shift and AltGr (ISO_Level3_Shift) held for
// its second, third and fourth levels, read from the X server's own keymap
// (xkbcomp). Never by keysym: xdotool types a character a layout lacks by
// binding it to a spare key for a moment, and an X client can read that key
// before the keymap change reaches it (a character lost), which no
// keyboard does. Dead keys are left out (they type nothing alone).

// X keysym names (keysymdef.h) for what the us, de and fr layouts have
// beyond the names that are the character itself ("a", "7"); "Uxxxx" is
// read as it says.
const KEYSYMS = {
    AE: 0xc6, Adiaeresis: 0xc4, ENG: 0x14a, ETH: 0xd0, EuroSign: 0x20ac, Greek_OMEGA: 0x3a9, Hstroke: 0x126,
    Lstroke: 0x141, Odiaeresis: 0xd6, Oslash: 0xd8, THORN: 0xde, Tslash: 0x166, Udiaeresis: 0xdc, adiaeresis:
    0xe4, ae: 0xe6, agrave: 0xe0, ampersand: 0x26, apostrophe: 0x27, asciicircum: 0x5e, asciitilde: 0x7e,
    asterisk: 0x2a, at: 0x40, backslash: 0x5c, bar: 0x7c, braceleft: 0x7b, braceright: 0x7d, bracketleft: 0x5b,
    bracketright: 0x5d, brokenbar: 0xa6, ccedilla: 0xe7, cent: 0xa2, colon: 0x3a, comma: 0x2c, copyright: 0xa9,
    currency: 0xa4, degree: 0xb0, division: 0xf7, dollar: 0x24, doublelowquotemark: 0x201e, downarrow: 0x2193,
    dstroke: 0x111, eacute: 0xe9, egrave: 0xe8, emdash: 0x2014, endash: 0x2013, eng: 0x14b, equal: 0x3d, eth:
    0xf0, exclam: 0x21, exclamdown: 0xa1, fiveeighths: 0x215d, grave: 0x60, greater: 0x3e, guillemetleft: 0xab,
    guillemetright: 0xbb, hstroke: 0x127, idotless: 0x131, kra: 0x138, leftarrow: 0x2190, leftdoublequotemark:
    0x201c, leftsinglequotemark: 0x2018, less: 0x3c, lstroke: 0x142, macron: 0xaf, minus: 0x2d, mu: 0xb5,
    multiply: 0xd7, notsign: 0xac, numbersign: 0x23, odiaeresis: 0xf6, oneeighth: 0x215b, onehalf: 0xbd,
    onequarter: 0xbc, onesuperior: 0xb9, ordfeminine: 0xaa, ordmasculine: 0xba, oslash: 0xf8, paragraph: 0xb6,
    parenleft: 0x28, parenright: 0x29, percent: 0x25, period: 0x2e, periodcentered: 0xb7, plus: 0x2b, plusminus:
    0xb1, question: 0x3f, questiondown: 0xbf, quotedbl: 0x22, registered: 0xae, rightarrow: 0x2192,
    rightdoublequotemark: 0x201d, rightsinglequotemark: 0x2019, section: 0xa7, semicolon: 0x3b, seveneighths:
    0x215e, singlelowquotemark: 0x201a, slash: 0x2f, space: 0x20, ssharp: 0xdf, sterling: 0xa3, thorn: 0xfe,
    threeeighths: 0x215c, threesuperior: 0xb3, trademark: 0x2122, tslash: 0x167, twosuperior: 0xb2, udiaeresis:
    0xfc, ugrave: 0xf9, underscore: 0x5f, uparrow: 0x2191, yen: 0xa5
};
function keysymChar(name) {
    if (/^U[0-9A-F]{4,6}$/.test(name)) return String.fromCodePoint(parseInt(name.slice(1), 16));
    if (name.length === 1) return name;
    return KEYSYMS[name] !== undefined ? String.fromCodePoint(KEYSYMS[name]) : null;
}
// The modifiers of each level, as xdotool presses them: left Shift's
// keycode, and the layout's AltGr (ISO_Level3_Shift: right Alt on German
// and French keyboards; the US layout's only on a key a PC has not).
const SHIFT = "50";
function levelMods(level, altGr) {
    return [[], [SHIFT], [altGr], [altGr, SHIFT]][level];
}
const TYPES = /^(ONE_LEVEL|TWO_LEVEL|ALPHABETIC|FOUR_LEVEL|FOUR_LEVEL_ALPHABETIC|FOUR_LEVEL_SEMIALPHABETIC|FOUR_LEVEL_PLUS_LOCK)$/;

// [{ch, keycode, level}] for the layout in use: each printable character
// once, at its lowest level, in keycode order (the space not first: a
// space alone does not start Just Type).
function layoutPlan() {
    const xkb = execFileSync("xkbcomp", ["-xkb", process.env.DISPLAY, "-"], { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const codes = {};
    for (const m of xkb.matchAll(/^\s*<([A-Z0-9+-]+)>\s*=\s*(\d+);/gm)) codes[m[1]] = Number(m[2]);
    const plan = [], seen = new Set();
    let altGr = null;
    for (const m of xkb.matchAll(/^\s*key <([A-Z0-9+-]+)>\s*\{[^}]*?\[\s*ISO_Level3_Shift\s*\]/gm))
        if (codes[m[1]] !== undefined && (altGr === null || m[1] === "RALT")) altGr = String(codes[m[1]]);
    for (const m of xkb.matchAll(/^\s*key <([A-Z0-9+-]+)>\s*\{([^}]*)\}/gm)) {
        const name = m[1], body = m[2];
        if (/^KP/.test(name) || codes[name] === undefined) continue;
        const type = /type(?:\[Group1\])?\s*=\s*"([^"]+)"/.exec(body);
        if (type && !TYPES.test(type[1])) continue;
        const syms = /symbols\[Group1\]\s*=\s*\[([^\]]*)\]/.exec(body) || /^\s*\[([^\]]*)\]/.exec(body);
        if (!syms) continue;
        syms[1].split(",").map((x) => x.trim()).slice(0, altGr ? 4 : 2).forEach((sym, level) => {
            const ch = keysymChar(sym);
            if (!ch || seen.has(ch) || /^dead_/.test(sym) || ch.codePointAt(0) < 0x20 || /\p{C}/u.test(ch)) return;
            seen.add(ch);
            plan.push({ ch, keycode: codes[name], level, mods: levelMods(level, altGr) });
        });
    }
    plan.sort((p, q) => p.keycode - q.keycode || p.level - q.level);
    if (plan.length && plan[0].ch === " ") plan.push(plan.shift());
    return plan;
}
function xdoArgs(plan) {
    const out = [];
    for (const p of plan) {
        const mods = p.mods;
        mods.forEach((k) => out.push("keydown", k));
        out.push("key", String(p.keycode));
        mods.slice().reverse().forEach((k) => out.push("keyup", k));
    }
    return out;
}
function typePlan(plan) {
    // In pieces: one xdotool for a few dozen keys.
    for (let i = 0; i < plan.length; i += 40)
        xdo(...xdoArgs(plan.slice(i, i + 40)));
}
function xdo(...a) { return execFileSync("xdotool", a, { stdio: ["ignore", "pipe", "pipe"] }).toString(); }
function windowId() { return xdo("search", "--onlyvisible", "--pid", String(simPid)).trim().split("\n").pop(); }

// What a layout must type where (its keys by their place: the key right of
// the period is "/" on a US keyboard, "-" on German's; German's "/" is
// Shift+7, French's Shift+":"), so a plan read wrongly fails here.
const PLACES = {
    us: { "/": [61, 0], "?": [61, 1], "\\": [51, 0], "|": [51, 1], "~": [49, 1], "`": [49, 0], "@": [11, 1], "\"": [48, 1] },
    de: { "/": [16, 1], "?": [20, 1], "\\": [20, 2], "|": [94, 2], "~": [35, 2], "@": [24, 2], "ß": [20, 0], "Ä": [48, 1], "€": [26, 2] },
    fr: { "/": [60, 1], "?": [58, 1], "\\": [17, 2], "|": [15, 2], "@": [19, 2], "é": [11, 0], "ù": [48, 0], "€": [26, 2] }
};
function checkPlan(layout, plan) {
    const at = {};
    plan.forEach((p) => { at[p.ch] = [p.keycode, p.level]; });
    const wrong = Object.entries(PLACES[layout] || {}).filter(([ch, w]) => !at[ch] || at[ch][0] !== w[0] || at[ch][1] !== w[1])
        .map(([ch, w]) => `${ch} at ${JSON.stringify(at[ch])}, not ${JSON.stringify(w)}`);
    check(wrong.length === 0, `${layout}: the X keymap is the ${layout} layout (${wrong.join("; ") || plan.length + " characters"})`);
    const missing = Array.from({ length: 0x7f - 0x21 }, (_, i) => String.fromCharCode(0x21 + i)).filter((c) => !at[c]);
    console.log(`     ${layout}: ${plan.length} characters on its keys; ASCII only through dead keys or not at all: ${JSON.stringify(missing.join(""))}`);
}
function setLayout(layout) {
    execFileSync("setxkbmap", ["-layout", layout]);
    // The X server tells its clients (XkbNewKeyboardNotify); the
    // simulator reads the new keymap before the next key.
    execFileSync("sleep", ["0.5"]);
}

// The first character that differs, for the failure's message.
function diff(got, want) {
    if (got === want) return "";
    let i = 0;
    while (i < got.length && i < want.length && got[i] === want[i]) ++i;
    const cp = (s) => s === undefined ? "end" : JSON.stringify(s) + " U+" + s.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
    return ` at ${i}: got ${cp(got[i])}, wanted ${cp(want[i])} (got ${JSON.stringify(got.slice(Math.max(0, i - 4), i + 6))})`;
}

// ---- The DevTools protocol, by hand (Node's WebSocket) ----------------------------

async function targets() {
    const r = await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json");
    return (await r.json()).filter((t) => t.type === "page");
}
async function connect(target) {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const waiting = {};
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
    };
    return {
        evaluate(expression) {
            return new Promise((resolve) => {
                const n = ++id;
                waiting[n] = (m) => resolve(m.result && m.result.result ? m.result.result.value : undefined);
                ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
            });
        },
        close() { ws.close(); }
    };
}
async function pageMatching(re, ms) {
    const t = await until(async () => (await targets()).find((x) => re.test(x.url)), ms);
    return t ? connect(t) : null;
}
function call(page, uri, params) {
    return page.evaluate(`new Promise((resolve) => { var b = new PalmServiceBridge(); b.onservicecallback = (t) => resolve(JSON.parse(t));
                          b.call(${JSON.stringify(uri)}, ${JSON.stringify(JSON.stringify(params || {}))}); })`);
}
function screenshot(name) {
    const file = path.join(outDir, name);
    try { execFileSync("import", ["-window", windowId(), file]); } catch (e) { return "(no screenshot: " + e.message + ")"; }
    return file;
}
let simPid = 0;

// A page's field: focused, emptied, typed into, read back.
// The element tapped as a person taps a field (the web view takes the
// keyboard focus from the shell, the page focuses the field), after
// clearJs empties it.
async function tap(page, elJs) {
    const g = xdo("getwindowgeometry", "--shell", windowId());
    const wx = Number(/X=(-?\d+)/.exec(g)[1]), wy = Number(/Y=(-?\d+)/.exec(g)[1]);
    const ww = Number(/WIDTH=(\d+)/.exec(g)[1]), wh = Number(/HEIGHT=(\d+)/.exec(g)[1]);
    // Where the page is in the window: a click on a sheet over the whole
    // page says (its clientX / clientY against the screen's point).
    await page.evaluate(`(function () { var d = document.createElement("div"); d.id = "__typingSheet";
        d.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;";
        d.addEventListener("mousedown", function (e) { window.__typingAt = { x: e.clientX, y: e.clientY }; e.preventDefault(); d.remove(); });
        window.__typingAt = null; document.documentElement.appendChild(d); return true; })()`);
    const sx = wx + Math.round(ww / 2), sy = wy + Math.round(wh / 2);
    xdo("mousemove", "--sync", String(sx), String(sy), "click", "1");
    const at = await until(() => page.evaluate("window.__typingAt"), 3000);
    if (!at) throw new Error("the page's place in the window: no click reached it");
    const r = await page.evaluate(`(function () { var e = ${elJs}; e.scrollIntoView({ block: "nearest" }); var r = e.getBoundingClientRect();
        return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 }; })()`);
    xdo("mousemove", "--sync", String(Math.round(sx - at.x + r.x)), String(Math.round(sy - at.y + r.y)), "click", "1");
}
async function typeInto(page, elJs, clearJs, readJs, layout, plan, what) {
    await page.evaluate(clearJs);
    await tap(page, elJs);
    await sleep(400);
    if (process.env.TYPING_DEBUG)
        await page.evaluate(`(function () { window.__keylog = []; if (window.__keylogOn) return true; window.__keylogOn = true;
            ["keydown", "keypress", "keyup", "beforeinput", "input"].forEach(function (t) { document.addEventListener(t, function (e) {
                window.__keylog.push([t, e.key, e.code, e.keyCode, e.data, e.inputType, e.defaultPrevented].join("|")); }, true); }); return true; })()`);
    typePlan(plan);
    const want = plan.map((p) => p.ch).join("");
    let got = "";
    await until(async () => { got = await page.evaluate(readJs); return got === want; }, 5000);
    if (!check(got === want, `${form} ${layout}: ${what}${diff(String(got), want)}`) && process.env.TYPING_DEBUG)
        console.log((await page.evaluate("window.__keylog.slice(-40).join('\\n')")));
    if (got !== want)
        console.log("     " + screenshot(`typing-${what.replace(/[^A-Za-z]+/g, "-")}-${form}-${layout}.png`));
}

async function main() {
    if (!fs.existsSync(SIM)) { console.error(SIM + " is missing: build phoenix-sim first"); process.exit(2); }
    if (!args.includes("--no-qml"))
        runWebQml();
    if (args.includes("--no-sim")) {
        console.log(failures ? failures + " failed" : "all passed");
        process.exit(failures ? 1 : 0);
    }
    if (!process.env.DISPLAY) { console.error("No display: run under xvfb-run"); process.exit(2); }
    fs.mkdirSync(outDir, { recursive: true });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-typing-sim-"));
    // The display's own layout, to put back.
    const sim = spawn(SIM, ["--" + form, "--stay-awake", "--no-boot-animation", "--quiet", "--hardware-keyboard", "--no-toolbar",
                            "--qml-dir", QML_DIR, "--repo-dir", REPO, "--launch", "com.palm.app.notes"], {
        env: Object.assign({}, process.env, { HOME: home, QTWEBENGINE_REMOTE_DEBUGGING: String(DEBUG_PORT), QTWEBENGINE_DISABLE_SANDBOX: "1" }),
        stdio: ["ignore", "pipe", "pipe"]
    });
    simPid = sim.pid;
    let simLog = "";
    sim.stdout.on("data", (d) => { simLog += d; });
    sim.stderr.on("data", (d) => { simLog += d; });
    try {
        const sys = await pageMatching(/com\.palm\.systemui\/index\.html/, 60000);
        if (!check(!!sys && !!(await until(() => sys.evaluate("Date.now() - JSON.parse(localStorage.getItem('phoenix:systemui:listening') || '0') < 30000"), 30000)),
                   form + ": the system UI is up")) throw new Error("no system UI");
        // xdotool types to the window with the X focus (Xvfb: the only one).
        await until(async () => { xdo("windowfocus", "--sync", windowId()); return true; }, 10000);

        // 1. Memos (Enyo 1.0): an enyo.Input and an enyo.RichText of its own.
        const notes = await pageMatching(/com\.palm\.app\.notes/, 30000);
        if (!check(!!notes && !!(await until(() => notes.evaluate("!!(window.enyo && enyo.Input && document.body)"), 30000)), form + ": Memos is up"))
            throw new Error("no Memos");
        await notes.evaluate(`(function () {
            var box = new enyo.Control({ components: [{ kind: "Input", name: "inp", spellcheck: false, autocorrect: false, autoCapitalize: "lowercase" },
                                                      { kind: "RichText", name: "rich", richContent: false }] });
            var host = document.body.appendChild(document.createElement("div"));
            // Over the app, where a tap reaches it.
            host.style.cssText = "position:fixed;left:8px;right:8px;top:60px;z-index:100000;background:#fff;";
            box.renderInto(host);
            window.__typing = box; return true; })()`);
        const enyoInput = "(function () { var n = __typing.$.inp.hasNode(); return (n.querySelector('input') || n).value; })()";
        const enyoRich = "__typing.$.rich.getText()";
        // A RichText's text: spaces it keeps as non-breaking ones (contenteditable).
        const richText = (js) => `(${js}).replace(/\\u00a0/g, " ")`;

        // 2. The Browser.
        await call(notes, "luna://com.palm.applicationManager/launch", { id: "com.palm.app.browser" });
        const browser = await pageMatching(/com\.palm\.app\.browser/, 30000);
        check(!!browser && !!(await until(() => browser.evaluate("!!(window.enyo && enyo.$ && Object.keys(enyo.$).some(function (k) { return /userinput$/.test(k); }))"), 30000)),
              form + ": the Browser is up");
        const urlInput = "(function () { var k = Object.keys(enyo.$).filter(function (k) { return /addressInput_userinput$|userinput$/.test(k); })[0]; return enyo.$[k]; })()";

        // 3. Help's search (a Phoenix React app's controlled input).
        await call(notes, "luna://com.palm.applicationManager/launch", { id: "org.webosphoenix.help" });
        const help = await pageMatching(/org\.webosphoenix\.help/, 30000);
        const feedSel = "document.querySelector('[data-testid=help-search]')";
        const feed = help && await until(() => help.evaluate("!!" + feedSel), 20000);
        check(!!feed, form + ": Help's search field is there");

        const bring = async (appId) => {
            await call(notes, "luna://com.palm.applicationManager/launch", { id: appId });
            await sleep(1200);
        };

        for (const layout of LAYOUTS) {
            setLayout(layout);
            const plan = layoutPlan();
            checkPlan(layout, plan);
            await bring("com.palm.app.notes");
            await typeInto(notes, "__typing.$.inp.hasNode()", "__typing.$.inp.setValue(''), true", enyoInput, layout, plan, "Memos, an enyo.Input");
            await typeInto(notes, "__typing.$.rich.hasNode()", "__typing.$.rich.setValue(''), true", richText(enyoRich), layout, plan, "Memos, an enyo.RichText");
            if (browser) {
                await bring("com.palm.app.browser");
                await typeInto(browser, `${urlInput}.hasNode()`, `${urlInput}.setValue(''), true`,
                               `${urlInput}.getValue()`, layout, plan, "the Browser's URL bar");
            }
            if (feed) {
                await bring("org.webosphoenix.help");
                // Emptied as React empties it (its value setter, then input).
                await typeInto(help, feedSel, `(function () { var i = ${feedSel}; var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                                            set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
                               `${feedSel}.value`, layout, plan, "Help's search (React)");
            }

            // 4. Just Type, from card view: the first keys reach the shell.
            // (F1, the simulator's up gesture: Home would close a popup
            // alert first, the "Dismissing Cards" tutorial the first card
            // view puts up, Shell.homeKey.)
            xdo("key", "F1");
            await sleep(1200);
            typePlan(plan);
            const want = plan.map((p) => p.ch).join("");
            const jt = await pageMatching(/com\.palm\.launcher/, 15000);
            let got = "";
            if (jt)
                await until(async () => { got = await jt.evaluate(richText("(function () { var f = enyo.$.justTypeApp_justType_searchField || Object.keys(enyo.$).filter(function (k) { return /justType_searchField$/.test(k); }).map(function (k) { return enyo.$[k]; })[0]; return f.getText ? f.getText() : f.getValue(); })()")); return got === want; }, 8000);
            check(got === want, `${form} ${layout}: Just Type${diff(String(got), want)}`);
            console.log("     " + screenshot(`typing-justtype-${form}-${layout}.png`));
            xdo("key", "Escape");
            await sleep(800);
        }

        // 5. The lock screen's password (the shell's own field), each layout.
        for (const layout of LAYOUTS) {
            setLayout(layout);
            // The characters people trip over, those the layout has.
            const plan = layoutPlan().filter((p) => "a/?\\|~`'\"@{}[]^€éèàßäÄ°§µ".indexOf(p.ch) >= 0);
            const pass = plan.map((p) => p.ch).join("");
            const set = await call(notes, "luna://com.palm.systemmanager/setDevicePasscode", { lockMode: "password", passCode: pass });
            check(set && set.returnValue === true, `${form} ${layout}: a password set (${JSON.stringify(set)})`);
            xdo("key", "F3");
            await until(() => notes.evaluate("localStorage.getItem('phoenix:deviceLocked') === 'true'"), 10000);
            await sleep(800);
            xdo("key", "F3");
            await sleep(1500);
            typePlan(plan);
            await sleep(300);
            const typedShot = screenshot(`typing-lock-typed-${form}-${layout}.png`);
            xdo("key", "Return");
            const unlocked = await until(() => notes.evaluate("localStorage.getItem('phoenix:deviceLocked') === 'false'"), 8000);
            if (!check(!!unlocked, `${form} ${layout}: the lock screen takes the password ${JSON.stringify(pass)}`))
                console.log("     " + typedShot + "\n     " + screenshot(`typing-lock-${form}-${layout}.png`));
            await call(notes, "luna://com.palm.systemmanager/setDevicePasscode", { lockMode: "none", passCode: "", oldPasscode: pass });
            if (!unlocked) break;
        }
    } catch (e) {
        failures++;
        console.log("FAIL " + (e && e.stack || e));
        console.log(simLog.split("\n").filter((l) => /Error|error|warn/i.test(l)).slice(-30).join("\n"));
    } finally {
        try { execFileSync("setxkbmap", ["-layout", "us"]); } catch (e) { /* the display is gone */ }
        sim.kill("SIGTERM");
        await sleep(500);
        try { sim.kill("SIGKILL"); } catch (e) { /* gone */ }
        fs.rmSync(home, { recursive: true, force: true });
    }
    console.log(failures ? failures + " failed" : "all passed");
    process.exit(failures ? 1 : 0);
}

main();
