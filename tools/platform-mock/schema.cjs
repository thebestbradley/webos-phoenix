// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A small JSON Schema (2020-12) checker for the platform contract's files
// (docs/platform-api/*.schema.json), enough for what they use: type
// (with null), const, enum, required, properties, items, minItems,
// maxItems, minimum, maximum, minLength, maxLength, pattern, oneOf,
// if/then, and $ref to "#/$defs/x" or "other.schema.json#/$defs/x". No
// dependencies, so the conformance suite runs anywhere Node does.
//
// validate(schemaFile, ref, value) -> [problems] ("" path: the value).

"use strict";

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "../../docs/platform-api");
const cache = {};
function load(file) {
    if (!cache[file]) cache[file] = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    return cache[file];
}
function resolve(file, ref) {
    const [f, frag] = ref.split("#");
    const target = f ? f : file;
    let node = load(target);
    for (const part of (frag || "").split("/").filter(Boolean)) node = node[part];
    if (!node) throw new Error("no schema " + ref + " in " + file);
    return { file: target, node };
}
function typeOf(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
    return typeof v;
}

function check(file, s, v, at, out) {
    if (s.$ref) {
        const r = resolve(file, s.$ref);
        return check(r.file, r.node, v, at, out);
    }
    if (s.type) {
        const types = [].concat(s.type);
        const t = typeOf(v);
        if (!types.includes(t) && !(t === "integer" && types.includes("number"))) {
            out.push(`${at || "(value)"}: ${t}, not ${types.join(" or ")}`);
            return;
        }
    }
    if ("const" in s && JSON.stringify(v) !== JSON.stringify(s.const)) out.push(`${at}: not ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) out.push(`${at}: ${JSON.stringify(v)} is not one of ${s.enum.join(", ")}`);
    if (s.oneOf) {
        const ok = s.oneOf.filter((alt) => { const o = []; check(file, alt, v, at, o); return !o.length; });
        if (ok.length !== 1) out.push(`${at}: matches ${ok.length} of oneOf`);
    }
    if (s.if && s.then) {
        const o = [];
        check(file, s.if, v, at, o);
        if (!o.length) check(file, s.then, v, at, out);
    }
    if (typeof v === "string") {
        if (s.minLength !== undefined && v.length < s.minLength) out.push(`${at}: shorter than ${s.minLength}`);
        if (s.maxLength !== undefined && v.length > s.maxLength) out.push(`${at}: longer than ${s.maxLength}`);
        if (s.pattern && !new RegExp(s.pattern).test(v)) out.push(`${at}: ${JSON.stringify(v.slice(0, 60))} does not match ${s.pattern}`);
    }
    if (typeof v === "number") {
        if (s.minimum !== undefined && v < s.minimum) out.push(`${at}: below ${s.minimum}`);
        if (s.maximum !== undefined && v > s.maximum) out.push(`${at}: above ${s.maximum}`);
    }
    if (Array.isArray(v)) {
        if (s.minItems !== undefined && v.length < s.minItems) out.push(`${at}: fewer than ${s.minItems} items`);
        if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${at}: more than ${s.maxItems} items`);
        if (s.items) v.forEach((x, i) => check(file, s.items, x, `${at}[${i}]`, out));
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
        if (s.required) for (const k of s.required) if (!(k in v)) out.push(`${at ? at + "." : ""}${k}: missing`);
        if (s.properties) for (const k of Object.keys(s.properties)) if (k in v) check(file, s.properties[k], v[k], at ? at + "." + k : k, out);
    }
}

function validate(file, ref, value) {
    const out = [];
    const r = ref ? resolve(file, ref) : { file, node: load(file) };
    check(r.file, r.node, value, "", out);
    return out;
}

module.exports = { validate, load };
