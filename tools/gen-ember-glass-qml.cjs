#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ember Glass's design tokens for the shell (docs/SYSTEM-UI-2.md, "How the
// look is built"): reads shell/design/ember-glass.tokens.json, a copy of
// Ember Glass UI's tokens/ember-glass.tokens.json (W3C Design Tokens,
// DTCG 2025.10), and writes shell/qml/Phoenix/Shell/EmberGlass.qml, a QML
// singleton with every token as a property:
//
//   color        a QML color, its alpha in it ("#AARRGGBB")
//   dimension    a real, in CSS px (one legacy pixel: Theme.px() them)
//   number       a real; duration an int, in ms
//   cubicBezier  [x1, y1, x2, y2] (for Easing.BezierSpline add 1, 1)
//   fontFamily   the families in order of preference
//   typography   {fontFamily, fontSize, fontWeight, letterSpacing, lineHeight, textTransform?}
//   gradient     {stops: [{position, color}], angle?, radial?}
//   shadow       {color, offsetX, offsetY, blur, spread, inset?}, or a list of them
//
// A token's path in camelCase is its name (gesture-light.width ->
// gestureLightWidth, glass.l1.blur -> glassL1Blur); theme.light.* and
// theme.dark.* go into EmberGlass.light and EmberGlass.dark under the rest
// of their path (theme.dark.color.ink-3 -> EmberGlass.dark.colorInk3).
// Aliases ("{theme.light.color.plane}") are resolved.
//
//   node tools/gen-ember-glass-qml.cjs            write EmberGlass.qml from the copy
//   node tools/gen-ember-glass-qml.cjs --check    fail if EmberGlass.qml is not what the copy gives (CI)
//   node tools/gen-ember-glass-qml.cjs --from DIR refresh the copy from an ember-glass-ui
//                                                 checkout's committed HEAD first, and
//                                                 record where it came from
//                                                 (shell/design/ember-glass.tokens.source.json)
//
// Never edit EmberGlass.qml by hand: change the tokens in ember-glass-ui and
// refresh the copy.

"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const COPY = path.join(REPO, "shell/design/ember-glass.tokens.json");
const SOURCE = path.join(REPO, "shell/design/ember-glass.tokens.source.json");
const OUT = path.join(REPO, "shell/qml/Phoenix/Shell/EmberGlass.qml");

function fail(msg) {
    console.error("gen-ember-glass-qml: " + msg);
    process.exit(1);
}

// Refresh the copy from a checkout's committed tokens (not its working
// tree: another hand may be editing it), and record the commit.
function refresh(dir) {
    const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
    const commit = git("rev-parse", "HEAD").trim();
    const json = git("show", "HEAD:tokens/ember-glass.tokens.json");
    JSON.parse(json);
    let version = "";
    try { version = JSON.parse(git("show", "HEAD:packages/tokens/package.json")).version || ""; } catch (e) { /* none */ }
    fs.mkdirSync(path.dirname(COPY), { recursive: true });
    fs.writeFileSync(COPY, json);
    const source = {
        "//": "Where shell/design/ember-glass.tokens.json came from (tools/gen-ember-glass-qml.cjs --from). Apache-2.0, as ember-glass-ui.",
        repository: "github.com/thebestbradley/ember-glass-ui",
        path: "tokens/ember-glass.tokens.json",
        commit,
        committed: git("log", "-1", "--format=%cI", "HEAD", "--", "tokens/ember-glass.tokens.json").trim(),
        package: "@ember-glass/tokens",
        version,
        sha256: crypto.createHash("sha256").update(json).digest("hex")
    };
    fs.writeFileSync(SOURCE, JSON.stringify(source, null, 4) + "\n");
}

function camel(parts) {
    return parts.map((p, i) => {
        const words = String(p).split(/[-_]/).filter((w) => w !== "");
        return words.map((w, j) => (i === 0 && j === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");
    }).join("");
}

function hex2(n) {
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

// Aliases inside a value (a gradient stop's "{ember.mid}"): set by main().
let aliasValue = null;

// "#AARRGGBB" (or "#RRGGBB" when opaque), from the token's hex (exact) and alpha.
function qmlColor(c) {
    if (typeof c === "string" && /^\{[^}]+\}$/.test(c) && aliasValue)
        return qmlColor(aliasValue(c));
    if (!c || typeof c !== "object")
        fail("not a colour: " + JSON.stringify(c));
    let rgb = typeof c.hex === "string" ? c.hex.replace(/^#/, "").toLowerCase() : "";
    if (!/^[0-9a-f]{6}$/.test(rgb)) {
        if (!Array.isArray(c.components) || c.components.length !== 3)
            fail("a colour needs hex or three components: " + JSON.stringify(c));
        rgb = c.components.map((v) => hex2(v * 255)).join("");
    }
    const a = typeof c.alpha === "number" ? c.alpha : 1;
    return a >= 1 ? "#" + rgb : "#" + hex2(a * 255) + rgb;
}

function px(d, what) {
    if (typeof d === "string" && /^\{[^}]+\}$/.test(d) && aliasValue)
        return px(aliasValue(d), what);
    if (typeof d === "number")
        return d;
    if (!d || typeof d.value !== "number" || d.unit !== "px")
        fail(what + ": a dimension in px expected, got " + JSON.stringify(d));
    return d.value;
}

function ms(d, what) {
    if (!d || typeof d.value !== "number" || (d.unit !== "ms" && d.unit !== "s"))
        fail(what + ": a duration expected, got " + JSON.stringify(d));
    return d.unit === "s" ? d.value * 1000 : d.value;
}

function round(n) {
    return Math.round(n * 1e4) / 1e4;
}

function main() {
    const args = process.argv.slice(2);
    const check = args.includes("--check");
    const fromIdx = args.indexOf("--from");
    if (fromIdx >= 0) {
        if (!args[fromIdx + 1])
            fail("--from needs an ember-glass-ui checkout");
        refresh(path.resolve(args[fromIdx + 1]));
    }
    if (!fs.existsSync(COPY))
        fail(path.relative(REPO, COPY) + " is missing: --from <ember-glass-ui checkout>");
    const raw = fs.readFileSync(COPY, "utf8");
    const tokens = JSON.parse(raw);
    const source = fs.existsSync(SOURCE) ? JSON.parse(fs.readFileSync(SOURCE, "utf8")) : {};
    const sha = crypto.createHash("sha256").update(raw).digest("hex");
    if (source.sha256 && source.sha256 !== sha)
        fail("the copy's SHA-256 is not the one recorded in " + path.relative(REPO, SOURCE) + ": refresh it with --from");

    // Every token by its dotted path, for aliases.
    const byPath = new Map();
    (function index(node, at) {
        if (!node || typeof node !== "object")
            return;
        if ("$value" in node) {
            byPath.set(at.join("."), node);
            return;
        }
        for (const k of Object.keys(node))
            if (!k.startsWith("$"))
                index(node[k], at.concat(k));
    })(tokens, []);

    function resolve(node, seen) {
        let v = node.$value;
        let type = node.$type;
        let ext = node.$extensions;
        const hops = seen || [];
        if (typeof v === "string" && /^\{[^}]+\}$/.test(v)) {
            const target = v.slice(1, -1);
            if (hops.includes(target))
                fail("alias loop at " + target);
            const t = byPath.get(target);
            if (!t)
                fail("alias to a token that is not there: " + v);
            const r = resolve(t, hops.concat(target));
            return { type: type || r.type, value: r.value, ext: ext || r.ext };
        }
        return { type, value: v, ext };
    }

    aliasValue = (ref) => {
        const t = byPath.get(ref.slice(1, -1));
        if (!t)
            fail("alias to a token that is not there: " + ref);
        return resolve(t).value;
    };

    function familyList(v) {
        if (typeof v === "string" && /^\{[^}]+\}$/.test(v))
            return familyList(resolve(byPath.get(v.slice(1, -1)) || fail("alias: " + v)).value);
        return Array.isArray(v) ? v.slice() : [String(v)];
    }

    function shadowOf(s, what) {
        const o = { color: qmlColor(s.color), offsetX: px(s.offsetX, what), offsetY: px(s.offsetY, what), blur: px(s.blur, what), spread: px(s.spread, what) };
        if (s.inset)
            o.inset = true;
        return o;
    }

    // [qmlType, JS expression] for a token.
    function convert(node, what) {
        const { type, value, ext } = resolve(node);
        const extra = ext && ext["org.webosphoenix.ember-glass"] ? ext["org.webosphoenix.ember-glass"] : null;
        switch (type) {
        case "color":
            return ["color", JSON.stringify(qmlColor(value))];
        case "dimension":
            return ["real", String(round(px(value, what)))];
        case "number":
            if (typeof value !== "number")
                fail(what + ": a number expected");
            return ["real", String(value)];
        case "duration":
            return ["int", String(Math.round(ms(value, what)))];
        case "cubicBezier":
            if (!Array.isArray(value) || value.length !== 4)
                fail(what + ": four numbers expected");
            return ["var", JSON.stringify(value)];
        case "fontFamily":
            return ["var", JSON.stringify(familyList(value))];
        case "typography": {
            const t = {
                fontFamily: familyList(value.fontFamily),
                fontSize: px(value.fontSize, what),
                fontWeight: value.fontWeight,
                letterSpacing: px(value.letterSpacing, what),
                lineHeight: value.lineHeight
            };
            if (extra && extra.textTransform)
                t.textTransform = extra.textTransform;
            return ["var", JSON.stringify(t)];
        }
        case "gradient": {
            const g = { stops: value.map((s) => ({ position: s.position, color: qmlColor(s.color) })) };
            if (extra && typeof extra.angle === "number")
                g.angle = extra.angle;
            if (extra && extra.radial)
                g.radial = extra.radial;
            return ["var", JSON.stringify(g)];
        }
        case "shadow":
            return ["var", JSON.stringify(Array.isArray(value) ? value.map((s) => shadowOf(s, what)) : shadowOf(value, what))];
        default:
            fail(what + ": a token of type " + type + " this generator does not know");
        }
        return null;
    }

    function properties(node, at, indent, skipTheme) {
        const lines = [];
        const names = new Set();
        (function walk(n, p) {
            if (!n || typeof n !== "object")
                return;
            if ("$value" in n) {
                const name = camel(p);
                if (names.has(name))
                    fail("two tokens make the name " + name);
                names.add(name);
                const [type, expr] = convert(n, at.concat(p).join("."));
                // An object literal in parentheses: after a property's colon
                // a brace opens a block of script, not an object.
                lines.push(`${indent}readonly property ${type} ${name}: ${expr.startsWith("{") ? "(" + expr + ")" : expr}`);
                return;
            }
            for (const k of Object.keys(n)) {
                if (k.startsWith("$") || (skipTheme && p.length === 0 && k === "theme"))
                    continue;
                walk(n[k], p.concat(k));
            }
        })(node, []);
        return lines;
    }

    const themes = tokens.theme && typeof tokens.theme === "object" ? Object.keys(tokens.theme).filter((k) => !k.startsWith("$")) : [];
    for (const t of ["light", "dark"])
        if (!themes.includes(t))
            fail("theme." + t + " is missing");
    const shape = (n) => JSON.stringify(Object.keys(n).sort().map((k) => (n[k] && typeof n[k] === "object" && !("$value" in n[k]) ? [k, JSON.parse(shape(n[k]))] : k)));
    if (shape(tokens.theme.light) !== shape(tokens.theme.dark))
        fail("theme.light and theme.dark do not have the same tokens");

    const from = source.commit
        ? `ember-glass-ui ${source.path} at ${source.commit.slice(0, 12)} (${source.package} ${source.version}, ${source.committed})`
        : "ember-glass-ui tokens/ember-glass.tokens.json";
    const out = [];
    out.push("// Generated by tools/gen-ember-glass-qml.cjs from shell/design/ember-glass.tokens.json:");
    out.push(`// ${from}.`);
    out.push("// Do not edit: change the tokens in ember-glass-ui, then");
    out.push("//   node tools/gen-ember-glass-qml.cjs --from <ember-glass-ui checkout>");
    out.push("// SPDX-License-Identifier: Apache-2.0");
    out.push("//");
    out.push("// Ember Glass's design tokens (docs/SYSTEM-UI-2.md): dimensions in CSS px,");
    out.push("// one legacy pixel each (Theme.px()); the themed ones in light and dark.");
    out.push("");
    out.push("pragma Singleton");
    out.push("import QtQuick");
    out.push("");
    out.push("QtObject {");
    out.push(`    readonly property string tokensSource: ${JSON.stringify(from)}`);
    out.push(`    readonly property string tokensSha256: ${JSON.stringify(sha)}`);
    out.push("");
    out.push(...properties(tokens, [], "    ", true));
    for (const t of themes) {
        out.push("");
        out.push(`    readonly property QtObject ${t}: QtObject {`);
        out.push(...properties(tokens.theme[t], ["theme", t], "        ", false));
        out.push("    }");
    }
    out.push("}");
    const text = out.join("\n") + "\n";

    if (check) {
        const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
        if (have !== text) {
            console.error("gen-ember-glass-qml: " + path.relative(REPO, OUT) + " is out of date: node tools/gen-ember-glass-qml.cjs");
            process.exit(1);
        }
        console.log("ok   " + path.relative(REPO, OUT) + " matches the tokens");
        return;
    }
    fs.writeFileSync(OUT, text);
    console.log("wrote " + path.relative(REPO, OUT) + " (" + byPath.size + " tokens)");
}

main();
