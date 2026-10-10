#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// App-to-app launch contracts: every com.palm.applicationManager launch or
// open with a literal app id (or a literal target scheme) in the original
// apps (third_party/), the compat overlays, Phoenix's apps, the shell and
// the runtime, checked against the launch params the app it reaches says it
// reads. A button that launches another app with keys that app ignores (the
// original Contacts' "message" button opened Phoenix's Messaging with
// {compose: {...}}, which it did not read, so nothing happened) fails here.
//
// What an app reads:
//   - a Phoenix app: "phoenix": {"launchParams": [...]} in its appinfo.json
//     (apps/<app>/public/appinfo.json), the keys its launchParams.ts
//     normalizer (or its own code) takes;
//   - an original app: tools/launch-contracts.json "originals", each with the
//     file that reads them;
//   - an id Phoenix has no app for: tools/launch-contracts.json "absent",
//     with why (reported, not failed).
// Original ids are resolved as the runtime does (APP_ALIASES and
// runtime.appAliases[...] in runtime/phoenix-runtime.js), alias params added.
//
//   node tools/check-launch-contracts.cjs            check; exit 1 on a broken contract
//   node tools/check-launch-contracts.cjs --markdown the inventory table (docs/LAUNCH-CONTRACTS.md)
//   node tools/check-launch-contracts.cjs --write-doc the table into docs/LAUNCH-CONTRACTS.md
//   node tools/check-launch-contracts.cjs --json     the rows as JSON
//
// docs/LAUNCH-CONTRACTS.md says how to add a contract.

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const args = process.argv.slice(2);
// --repo DIR: check another checkout (the inventory before a change).
const REPO = args.includes("--repo") ? path.resolve(args[args.indexOf("--repo") + 1]) : path.resolve(__dirname, "..");
const rel = (p) => path.relative(REPO, p).split(path.sep).join("/");
const read = (p) => fs.readFileSync(p, "utf8");

// ---- Sources ----------------------------------------------------------------------------

const SKIP_DIR = /(^|\/)(node_modules|dist|build|spec|specs|test|tests|mock|mocks|support|examples|\.git|images|css|assets|lib\/build|enyo-build|deploy)(\/|$)/;
const SKIP_FILE = /(\.test\.[jt]sx?|\.spec\.js|-spec\.js|\.min\.js|enyo-build\.js|\.d\.ts)$/;

function walk(dir, exts, out) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
            if (!SKIP_DIR.test(rel(p) + "/") || rel(p).startsWith("compat/")) walk(p, exts, out);
        } else if (exts.test(e.name) && !SKIP_FILE.test(e.name)) out.push(p);
    }
    return out;
}

// An original file a compat overlay replaces is not what runs: the overlay
// is scanned instead.
const OVERLAY = path.join(REPO, "compat/rootfs");
const DEVICE_ROOTS = [
    ["third_party/core-apps/", "usr/palm/applications/"],
    ["third_party/enyo-1.0/framework/", "usr/palm/frameworks/enyo/0.10/framework/"],
    ["third_party/luna-systemui/", "usr/palm/applications/com.palm.systemui/"],
    ["third_party/luna-applauncher/", "usr/palm/applications/com.palm.launcher/"],
    ["third_party/isis/isis-browser/", "usr/palm/applications/com.palm.app.browser/"],
];
function overlaid(file) {
    const r = rel(file);
    for (const [from, to] of DEVICE_ROOTS)
        if (r.startsWith(from) && fs.existsSync(path.join(OVERLAY, to, r.slice(from.length)))) return true;
    return false;
}

function sources() {
    const js = /\.(js|cjs|mjs|ts|tsx)$/;
    const files = [];
    for (const d of fs.existsSync(path.join(REPO, "apps")) ? fs.readdirSync(path.join(REPO, "apps")) : []) {
        const app = path.join(REPO, "apps", d);
        if (!fs.statSync(app).isDirectory() || d === "node_modules") continue;
        if (d === "shared") {
            for (const s of fs.readdirSync(app)) {
                walk(path.join(app, s, "src"), js, files);
                walk(path.join(app, s, "share-page"), js, files);
            }
            continue;
        }
        walk(path.join(app, "src"), js, files);
        walk(path.join(app, "service"), js, files);
        for (const f of fs.readdirSync(app)) if (/\.js$/.test(f) && !/config/.test(f)) files.push(path.join(app, f));
    }
    walk(path.join(REPO, "shell/qml"), /\.(qml|js)$/, files);
    files.push(path.join(REPO, "runtime/phoenix-runtime.js"));
    walk(path.join(REPO, "compat/rootfs"), /\.js$/, files);
    for (const d of ["core-apps", "luna-systemui", "luna-applauncher", "enyo-1.0/framework/source", "enyo-1.0/framework/lib",
                     "loadable-frameworks", "app-services", "isis/isis-browser/source", "foundation-frameworks"])
        walk(path.join(REPO, "third_party", d), /\.js$/, files);
    return files.filter((f) => fs.existsSync(f) && !overlaid(f));
}

// ---- A small JavaScript scanner: object literals and their top-level keys ---------------

// Every {...} in the text with its top-level keys ("key:" right after "{"
// or ","), skipping strings, comments, template literals and regexes.
function objects(text) {
    const out = [];
    const stack = [];
    let i = 0, prev = "";          // last significant character
    const n = text.length;
    const regexOk = () => prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev);
    while (i < n) {
        const c = text[i];
        if (c === "/" && text[i + 1] === "/") { while (i < n && text[i] !== "\n") i++; continue; }
        if (c === "/" && text[i + 1] === "*") { const e = text.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
        if (c === "\"" || c === "'") {
            const s = i++;
            while (i < n && text[i] !== c && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
            i++;
            note(s, i);
            prev = c;
            continue;
        }
        if (c === "`") {
            i++;
            let depth = 0;
            while (i < n) {
                if (text[i] === "\\") { i += 2; continue; }
                if (depth === 0 && text[i] === "`") break;
                if (text[i] === "$" && text[i + 1] === "{") { depth++; i += 2; continue; }
                if (depth > 0 && text[i] === "}") depth--;
                i++;
            }
            i++;
            prev = "`";
            continue;
        }
        if (c === "/" && regexOk()) {
            let j = i + 1, cls = false;
            while (j < n && text[j] !== "\n") {
                if (text[j] === "\\") { j += 2; continue; }
                if (text[j] === "[") cls = true; else if (text[j] === "]") cls = false;
                else if (text[j] === "/" && !cls) break;
                j++;
            }
            if (j < n && text[j] === "/") { i = j + 1; while (/[a-z]/i.test(text[i] || "")) i++; prev = "/"; continue; }
        }
        if (c === "{" || c === "(" || c === "[") {
            stack.push({ ch: c, start: i, keys: [], after: true });
            prev = c;
            i++;
            continue;
        }
        if (c === "}" || c === ")" || c === "]") {
            const f = stack.pop();
            if (f && f.ch === "{" && f.keys.length) out.push({ start: f.start, end: i + 1, keys: f.keys });
            prev = c;
            i++;
            continue;
        }
        if (c === ",") { const f = stack[stack.length - 1]; if (f) f.after = true; prev = c; i++; continue; }
        if (/[A-Za-z_$]/.test(c)) {
            const s = i;
            while (i < n && /[\w$]/.test(text[i])) i++;
            note(s, i);
            prev = "a";
            continue;
        }
        if (!/\s/.test(c)) { const f = stack[stack.length - 1]; if (f) f.after = false; prev = c; }
        i++;
    }
    return out;

    // A word or string right after "{" or "," followed by ":" is a key.
    function note(s, e) {
        const f = stack[stack.length - 1];
        if (!f || f.ch !== "{" || !f.after) { if (f) f.after = false; return; }
        f.after = false;
        let j = e;
        while (j < n && /[ \t\r\n]/.test(text[j])) j++;
        let k = text.slice(s, e);
        // Shorthand {otpauth, threadId}.
        if ((text[j] === "," || text[j] === "}") && /^[A-Za-z_$][\w$]*$/.test(k) && !/^(return|break|continue|this|true|false|null|undefined)$/.test(k)) {
            f.keys.push({ key: k, at: s, shorthand: true });
            return;
        }
        if (text[j] !== ":") return;
        if (k[0] === "\"" || k[0] === "'") k = k.slice(1, -1);
        f.keys.push({ key: k, at: j + 1 });
    }
}

// The text of a top-level value, from its start to the "," or "}" that ends it.
function valueAt(text, at, end) {
    let depth = 0, i = at;
    for (; i < end - 1; i++) {
        const c = text[i];
        if (c === "\"" || c === "'" || c === "`") {
            const q = c;
            i++;
            while (i < end && text[i] !== q) i += text[i] === "\\" ? 2 : 1;
            continue;
        }
        if (c === "/" && text[i + 1] === "/") { while (i < end && text[i] !== "\n") i++; continue; }
        if ("{([".includes(c)) depth++;
        else if ("})]".includes(c)) depth--;
        else if (c === "," && depth === 0) break;
    }
    return text.slice(at, i).trim();
}

function lineOf(text, pos) {
    let n = 1;
    for (let i = 0; i < pos; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
}

// ---- Resolving ids and params --------------------------------------------------------------

// "id", 'id', or a constant defined in the file (var/const/let NAME = "id",
// QML property NAME: "id").
function idValue(expr, text) {
    expr = String(expr || "").trim();
    const appId = (v) => (/^[a-z][\w-]*(\.[\w-]+)+$/i.test(v) ? v : null);
    let m = /^["'`]([\w.\-]+)["'`]$/.exec(expr);
    if (m) return appId(m[1]);
    m = /^([A-Za-z_$][\w$]*)$/.exec(expr);
    if (!m) return null;
    const def = new RegExp("(?:\\b(?:const|var|let)\\s+|\\bproperty\\s+string\\s+)" + m[1] + "\\s*[=:]\\s*[\"']([\\w.\\-]+)[\"']").exec(text);
    return def ? appId(def[1]) : null;
}

function objectKeysOf(text, start) {
    const objs = objects(text.slice(start));
    const first = objs.filter((o) => o.start === 0)[0];
    return first ? first.keys.map((k) => k.key) : [];
}

// The keys of a params expression: an object literal, or a variable
// assigned an object literal (and given keys) in the lines before.
function paramKeys(expr, text, pos) {
    expr = String(expr || "").trim();
    if (!expr) return { keys: [] };
    const m = /^([A-Za-z_$][\w$]*)$/.exec(expr);
    if (!m) {
        // An object literal, or several (cond ? {a} : {b}): the keys of each.
        const outer = outerObjects(expr);
        return outer.length ? { keys: [...new Set(outer.flatMap((o) => o.keys.map((k) => k.key)))] }
            : /^\{\s*\}$/.test(expr) ? { keys: [] } : { keys: null };
    }
    // Only the enclosing function's own lines: from its last "function" or "=>".
    let from = Math.max(0, pos - 3000);
    const fn = /\bfunction\b|=>/g;
    let f;
    const win = text.slice(from, pos);
    while ((f = fn.exec(win))) from = Math.max(from, pos - win.length + f.index);
    const before = text.slice(from, pos);
    const keys = new Set();
    let found = false;
    // NAME = {...} or NAME = cond ? {...} : {...}, up to the ";".
    const assign = new RegExp("\\b" + m[1] + "\\s*=(?!=)\\s*", "g");
    let a;
    while ((a = assign.exec(before))) {
        const rest = before.slice(a.index + a[0].length);
        const semi = rest.indexOf(";");
        const mine = outerObjects(semi < 0 ? rest : rest.slice(0, semi));
        if (!mine.length) continue;
        found = true;
        for (const o of mine) for (const k of o.keys) keys.add(k.key);
    }
    const prop = new RegExp("\\b" + m[1] + "\\.([A-Za-z_$][\\w$]*)\\s*=[^=]", "g");
    while ((a = prop.exec(before))) { found = true; keys.add(a[1]); }
    return found ? { keys: [...keys] } : { keys: null };
}

// The arguments of a call, from its "(": each one's text.
function callArgs(text, open) {
    const out = [];
    let depth = 0, from = open + 1, i = open + 1;
    for (; i < text.length; i++) {
        const c = text[i];
        if (c === "\"" || c === "'" || c === "`") {
            const q = c;
            i++;
            while (i < text.length && text[i] !== q) i += text[i] === "\\" ? 2 : 1;
            continue;
        }
        if ("{([".includes(c)) depth++;
        else if ("})]".includes(c)) {
            if (depth === 0) break;
            depth--;
        } else if (c === "," && depth === 0) { out.push(text.slice(from, i).trim()); from = i + 1; }
    }
    const last = text.slice(from, i).trim();
    if (last) out.push(last);
    return out;
}

// The object literals of an expression not inside another one.
function outerObjects(expr) {
    const all = objects(expr).sort((x, y) => x.start - y.start);
    const out = [];
    for (const o of all) if (!out.some((p) => o.start > p.start && o.end <= p.end)) out.push(o);
    return out;
}

// ---- Contracts ---------------------------------------------------------------------------

function runtimeAliases() {
    const text = read(path.join(REPO, "runtime/phoenix-runtime.js"));
    const at = text.indexOf("var APP_ALIASES = {");
    const aliases = {};
    if (at >= 0) {
        const o = objects(text.slice(at + "var APP_ALIASES = ".length)).filter((x) => x.start === 0)[0];
        const src = text.slice(at + "var APP_ALIASES = ".length, at + "var APP_ALIASES = ".length + o.end);
        Object.assign(aliases, vm.runInNewContext("(" + src + ")", {}));
    }
    // runtime.appAliases["com.palm.x"] = CONST;  (CONST defined in the file)
    const re = /runtime\.appAliases\[\s*"([^"]+)"\s*\]\s*=\s*([A-Za-z_$][\w$]*|"[^"]+")/g;
    let m;
    while ((m = re.exec(text))) {
        const v = idValue(m[2], text);
        if (v) aliases[m[1]] = v;
    }
    return aliases;
}

function phoenixApps() {
    const apps = {};
    const dir = path.join(REPO, "apps");
    for (const d of fs.readdirSync(dir)) {
        for (const p of [path.join(dir, d, "public/appinfo.json"), path.join(dir, d, "appinfo.json")]) {
            if (!fs.existsSync(p)) continue;
            try {
                const info = JSON.parse(read(p));
                if (!info.id) continue;
                const ph = info.phoenix || {};
                apps[info.id] = { id: info.id, file: rel(p), launchParams: Array.isArray(ph.launchParams) ? ph.launchParams : null };
                for (const lp of ph.launchPoints || []) if (lp.id) apps[lp.id] = { ...apps[info.id], launchPoint: lp.params || {} };
            } catch (e) { /* not an app */ }
            break;
        }
    }
    return apps;
}

const contracts = JSON.parse(read(path.join(REPO, "tools/launch-contracts.json")));
const ALIASES = runtimeAliases();
const APPS = phoenixApps();
const HANDLERS = JSON.parse(read(path.join(REPO, "compat/rootfs/usr/palm/command-resource-handlers.json"))).redirects;
// Keys every app gets from the system, not its caller.
const UNIVERSAL = new Set((contracts.universal || {}).keys || []);

function resolve(id) {
    const a = ALIASES[id];
    if (!a) return { id, aliasParams: {} };
    return typeof a === "string" ? { id: a, aliasParams: {} } : { id: a.id || id, aliasParams: a.params || {}, routed: !!a.route };
}

function contractOf(id) {
    const byRuntime = (contracts.runtime || {})[id] || [];
    if (APPS[id]) return { kind: "phoenix", keys: APPS[id].launchParams && APPS[id].launchParams.concat(byRuntime), file: APPS[id].file };
    const o = (contracts.originals || {})[id];
    if (o) return { kind: "original", keys: o.launchParams.concat(o.ignored || [], byRuntime), file: o.source.replace(/ .*/, "") };
    const ab = (contracts.absent || {})[id];
    if (ab) return { kind: "absent", why: ab };
    return null;
}

function targetApp(target) {
    for (const h of HANDLERS) if (new RegExp(h.url, "i").test(target)) return h.appId;
    if (/^https?:/i.test(target)) return "com.palm.app.browser";
    return null;
}

// ---- Finding the launches ----------------------------------------------------------------

const LAUNCH_CONTEXT = /applicationManager|\blaunch|openApp|startApp|appOpen|appMgrOpen|launchApplicationService/;
// The call an object literal is passed to, read back from its "{".
const CALLER = /(?:\.(?:launch|open|openApp|launchApp|startApp|appOpen|appMgrOpen|launchApplicationService|launchHelp|openAccountsApp|openAppCatalog)\.call|applicationManager\/(?:launch|open)["'`]\s*,|postToHost\(\s*["'](?:launch|open)["']\s*,|["'](?:launch|open)["']\s*,|callService\([^,]*applicationManager\/(?:launch|open)["']\s*,)\s*\(?\s*$/;

function scan(file) {
    const text = read(file);
    if (!LAUNCH_CONTEXT.test(text)) return [];
    const rows = [];
    const where = (pos) => `${rel(file)}:${lineOf(text, pos)}`;
    const push = (pos, how, idExpr, paramsExpr, extra) => {
        const id = idValue(idExpr, text);
        if (!id || !/\./.test(id)) return;
        const p = paramsExpr === undefined ? { keys: [] } : paramKeys(paramsExpr, text, pos);
        rows.push({ caller: where(pos), how, id, keys: p.keys, ...(extra || {}) });
    };
    // Object literals: {id, params} / {appId, params} anywhere in a launch
    // context; {id} / {target} passed to a launch or open call.
    for (const o of objects(text)) {
        const keys = Object.fromEntries(o.keys.map((k) => [k.key, k]));
        const before = text.slice(Math.max(0, o.start - 160), o.start);
        const passed = CALLER.test(before);
        const idKey = keys.id || keys.appId;
        // A map's value ("com.palm.app.backup": {id, params}: APP_ALIASES) is not a launch.
        if (/["'][\w.\-]+["']\s*:\s*$/.test(before)) continue;
        // {id: "com.palm.app.x"} kept in a variable for a launch call (luna-systemui's callParams).
        const kept = /\b(?:callParams|launchParams|launchArgs)\s*=\s*$/.test(before);
        if (idKey && (keys.params || passed || kept)) {
            if (keys.method && !keys.params) continue;
            push(o.start, passed ? (/open/.test(before.slice(-60)) ? "open" : "launch") : keys.appId ? "open descriptor" : "launch",
                 valueAt(text, idKey.at, o.end), keys.params ? valueAt(text, keys.params.at, o.end) : undefined);
        } else if (keys.target && passed && !idKey) {
            const t = valueAt(text, keys.target.at, o.end);
            const m = /^["'`]([a-z][a-z0-9+.\-]*):/i.exec(t);
            if (!m) continue;
            const scheme = m[1].toLowerCase();
            const sample = scheme + ":" + (/^https?$/.test(scheme) ? "//example.com/" : "x");
            const app = targetApp(sample);
            rows.push({ caller: where(o.start), how: "open " + scheme + ":", id: app || "(no handler for " + scheme + ":)",
                        keys: ["target"], target: scheme + ":", unhandled: !app });
        }
    }
    // apps.launch(ID, {...}) / launch(env, ID, {...}) / shell.launch("id", {...})
    const call = /\b(?:apps\.launch|shell\.launch|(?<![.\w])launch)\(/g;
    let m;
    while ((m = call.exec(text))) {
        if (/\bfunction\s+$/.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
        const a = callArgs(text, m.index + m[0].length - 1);
        if (a[0] === "env") a.shift();
        if (!a.length) continue;
        push(m.index, "launch", a[0], a[1] === undefined ? "{}" : a[1]);
    }
    return rows;
}

// Just Type's quick actions and database results: appinfo.json
// "universalSearch" {action | dbsearch | search: {url: appId, launchParam}}.
// luna-applauncher launches url with {[launchParam]: text} (app/Actions.js:119-133,
// app/DbSearch.js:272-275; a JSON launchParam is an object template).
function universalSearchRows() {
    const rows = [];
    const files = [];
    for (const d of fs.readdirSync(path.join(REPO, "apps"))) files.push(path.join(REPO, "apps", d, "public/appinfo.json"));
    const core = path.join(REPO, "third_party/core-apps");
    if (fs.existsSync(core)) for (const d of fs.readdirSync(core)) files.push(path.join(core, d, "appinfo.json"));
    for (const f of files) {
        if (!fs.existsSync(f)) continue;
        let info;
        try { info = JSON.parse(read(f)); } catch (e) { continue; }
        const us = info.universalSearch;
        if (!us) continue;
        for (const [kind, list] of Object.entries(us)) {
            for (const item of Array.isArray(list) ? list : [list]) {
                if (!item || typeof item !== "object" || !item.url || item.launchParam === undefined) continue;
                let keys;
                try { const o = JSON.parse(item.launchParam); keys = typeof o === "object" && o ? Object.keys(o) : [String(item.launchParam)]; }
                catch (e) { keys = [String(item.launchParam)]; }
                const at = read(f).split("\n").findIndex((l) => l.includes("\"launchParam\"")) + 1;
                rows.push({ caller: rel(f) + ":" + at, how: "Just Type " + kind, id: item.url, keys });
            }
        }
    }
    return rows;
}

// ---- Checking ----------------------------------------------------------------------------

function check(row) {
    if (row.unhandled) return { ...row, status: "❌", why: "nothing handles " + row.target };
    const r = resolve(row.id);
    const sent = [...new Set([...(row.keys || []), ...Object.keys(r.aliasParams)])].filter((k) => !UNIVERSAL.has(k));
    const c = contractOf(r.id);
    const out = { ...row, resolved: r.id, sent };
    if (!c) return { ...out, status: "❌", why: "no app " + r.id };
    if (c.kind === "absent") return { ...out, status: "❌", why: c.why, absent: true };
    if (!c.keys) return { ...out, status: "⚠", why: r.id + " declares no launchParams (" + c.file + ")" };
    if (row.keys === null) return { ...out, status: "✅", why: "params not literal" };
    const unread = sent.filter((k) => !c.keys.includes(k));
    if (!unread.length) return { ...out, status: "✅" };
    const readSome = sent.length > unread.length;
    const res = { ...out, status: readSome ? "⚠" : "❌", why: r.id + " does not read " + unread.join(", ") + " (" + c.file + ")", unread };
    // A known one, and why it stays (tools/launch-contracts.json "exceptions").
    const file = row.caller.replace(/:\d+$/, "");
    const known = (contracts.exceptions || []).find((e) => e.file === file && e.id === row.id && unread.every((k) => (e.keys || []).includes(k)));
    return known ? { ...res, excused: true, why: res.why + ": " + known.why } : res;
}

function main() {
    const rows = [];
    for (const f of sources()) {
        try { rows.push(...scan(f)); } catch (e) { console.error(rel(f) + ": " + e.message); process.exitCode = 2; }
    }
    rows.push(...universalSearchRows());
    const checked = rows.map(check);
    const counts = { "✅": 0, "⚠": 0, "❌": 0 };
    for (const r of checked) counts[r.status]++;
    if (args.includes("--json")) { console.log(JSON.stringify(checked, null, 1)); return; }
    if (args.includes("--markdown") || args.includes("--write-doc")) {
        const unexplained = checked.filter((r) => r.status !== "✅" && !r.absent && !r.excused).length;
        const lines = ["| Caller | How | Target (original id) | Phoenix app | Params sent | Status |", "|---|---|---|---|---|---|"];
        const order = { "❌": 0, "⚠": 1, "✅": 2 };
        checked.sort((a, b) => order[a.status] - order[b.status] || a.caller.localeCompare(b.caller, "en", { numeric: true }));
        for (const r of checked) {
            const target = r.target ? "`" + r.target + "`" : "`" + r.id + "`";
            const resolved = r.resolved && r.resolved !== r.id ? "`" + r.resolved + "`" : r.target ? "`" + r.id + "`" : "same";
            const keys = r.keys === null ? "(variable)" : (r.sent || r.keys).length ? (r.sent || r.keys).map((k) => "`" + k + "`").join(", ") : "none";
            const why = r.why && r.status !== "✅" ? " " + r.why.replace(/\|/g, "\\|") : "";
            lines.push(`| \`${r.caller}\` | ${r.how} | ${target} | ${resolved} | ${keys} | ${r.status}${r.absent || r.excused ? " known:" : ""}${why} |`);
        }
        lines.push("", `${checked.length} launches: ${counts["✅"]} ✅, ${counts["⚠"]} ⚠, ${counts["❌"]} ❌ ` +
                   `(${checked.filter((r) => r.absent).length} of the ❌ go to apps Phoenix does not have; ` +
                   `${unexplained ? unexplained + " ⚠ or ❌ not explained in tools/launch-contracts.json" : "every ⚠ and ❌ has its why in tools/launch-contracts.json"}).`);
        if (!args.includes("--write-doc")) { console.log(lines.join("\n")); return; }
        // docs/LAUNCH-CONTRACTS.md: the table between its markers.
        const doc = path.join(REPO, "docs/LAUNCH-CONTRACTS.md");
        const text = read(doc);
        const start = "<!-- launch-table: node tools/check-launch-contracts.cjs --write-doc -->", end = "<!-- /launch-table -->";
        const i = text.indexOf(start), j = text.indexOf(end);
        if (i < 0 || j < i) throw new Error("docs/LAUNCH-CONTRACTS.md has no launch-table markers");
        fs.writeFileSync(doc, text.slice(0, i + start.length) + "\n" + lines.join("\n") + "\n" + text.slice(j));
        console.log("docs/LAUNCH-CONTRACTS.md: " + checked.length + " launches");
        return;
    }
    let bad = 0;
    for (const r of checked) {
        if (r.status === "✅" || r.absent || r.excused) continue;
        bad++;
        console.log(`FAIL ${r.caller}: ${r.how} ${r.id}${r.resolved && r.resolved !== r.id ? " (" + r.resolved + ")" : ""}: ${r.why}`);
    }
    console.log(`${checked.length} launches checked: ${counts["✅"]} ✅, ${counts["⚠"]} ⚠, ${counts["❌"]} ❌` +
                ` (${checked.filter((r) => r.absent).length} to apps Phoenix does not have, listed in tools/launch-contracts.json "absent")`);
    if (bad) {
        console.log("\nA launch sends keys its target does not read, or reaches no app. Make the target read them " +
                    "(its launchParams.ts and appinfo.json \"phoenix\": {\"launchParams\"}), fix the caller, " +
                    "or say why in tools/launch-contracts.json (docs/LAUNCH-CONTRACTS.md).");
        process.exitCode = 1;
    }
}

if (require.main === module) main();
module.exports = { objects, scan, check, resolve, contractOf };
