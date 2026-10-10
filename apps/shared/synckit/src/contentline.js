// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The content line syntax shared by vCard (RFC 6350, and 2.1 / 3.0 = RFC
// 2426) and iCalendar (RFC 5545): folded lines of
//   [group.]NAME;PARAM=value,value;PARAM="quoted:value":VALUE
// grouped into BEGIN:X ... END:X components.
//
// parse(text) returns the top-level components:
//   { name, props: [{ group, name, params: {NAME: [values]}, value }], components: [...] }
// Values are the raw text after the colon; unescapeText / splitValue turn a
// TEXT value into its parts. serialize() writes components back, folding
// lines at 75 octets and escaping as the RFCs require.

"use strict";

function unfold(text) {
    var raw = String(text).replace(/\r\n|\r/g, "\n").split("\n");
    var lines = [];
    for (var i = 0; i < raw.length; i++) {
        var l = raw[i];
        if ((l.charAt(0) === " " || l.charAt(0) === "\t") && lines.length) {
            lines[lines.length - 1] += l.slice(1);
            continue;
        }
        // vCard 2.1 quoted-printable values continue after a soft break ("=" at the end).
        if (lines.length && /ENCODING=QUOTED-PRINTABLE/i.test(lines[lines.length - 1].split(":")[0]) &&
            /=$/.test(lines[lines.length - 1])) {
            lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + l;
            continue;
        }
        if (l.length) lines.push(l);
    }
    return lines;
}

// Splits "NAME;P=a,b;Q=\"x:y\":value" at the first colon outside quotes.
function parseLine(line) {
    var inQuote = false, i;
    for (i = 0; i < line.length; i++) {
        var c = line.charAt(i);
        if (c === "\"") inQuote = !inQuote;
        else if (c === ":" && !inQuote) break;
    }
    var head = line.slice(0, i), value = line.slice(i + 1);
    // Split the head at ; outside quotes.
    var parts = [], cur = "", q = false;
    for (var j = 0; j < head.length; j++) {
        var ch = head.charAt(j);
        if (ch === "\"") { q = !q; cur += ch; }
        else if (ch === ";" && !q) { parts.push(cur); cur = ""; }
        else cur += ch;
    }
    parts.push(cur);
    var name = parts.shift(), group = "";
    var dot = name.indexOf(".");
    if (dot >= 0) { group = name.slice(0, dot); name = name.slice(dot + 1); }
    var params = {};
    parts.forEach(function (p) {
        var eq = p.indexOf("=");
        // vCard 2.1 bare parameters ("TEL;CELL;HOME:...") are TYPE values.
        var pname = eq >= 0 ? p.slice(0, eq).toUpperCase() : "TYPE";
        var pval = eq >= 0 ? p.slice(eq + 1) : p;
        var vals = [], v = "", qq = false;
        for (var k = 0; k < pval.length; k++) {
            var c2 = pval.charAt(k);
            if (c2 === "\"") qq = !qq;
            else if (c2 === "," && !qq) { vals.push(v); v = ""; }
            else v += c2;
        }
        vals.push(v);
        params[pname] = (params[pname] || []).concat(vals);
    });
    return { group: group, name: name.toUpperCase(), params: params, value: value };
}

function parse(text) {
    var roots = [], stack = [];
    unfold(text).forEach(function (line) {
        var p = parseLine(line);
        if (p.name === "BEGIN") {
            var comp = { name: p.value.trim().toUpperCase(), props: [], components: [] };
            if (stack.length) stack[stack.length - 1].components.push(comp);
            else roots.push(comp);
            stack.push(comp);
        } else if (p.name === "END") {
            stack.pop();
        } else if (stack.length) {
            stack[stack.length - 1].props.push(p);
        }
    });
    return roots;
}

// TEXT unescaping (\n \N \\ \; \, ; vCard 2.1 quoted-printable too).
function unescapeText(s) {
    return String(s).replace(/\\([nN;,\\:])/g, function (m, c) { return c === "n" || c === "N" ? "\n" : c; });
}

function escapeText(s) {
    return String(s === undefined || s === null ? "" : s)
        .replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

// Splits a structured value (N, ADR, ORG: ";"; CATEGORIES, NICKNAME: ",")
// at unescaped separators and unescapes each part.
function splitValue(s, sep) {
    var out = [], cur = "";
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        if (c === "\\" && i + 1 < s.length) { cur += c + s.charAt(i + 1); i++; }
        else if (c === sep) { out.push(unescapeText(cur)); cur = ""; }
        else cur += c;
    }
    out.push(unescapeText(cur));
    return out;
}

function decodeQuotedPrintable(s) {
    var bytes = [];
    for (var i = 0; i < s.length; i++) {
        if (s.charAt(i) === "=" && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) {
            bytes.push(parseInt(s.substr(i + 1, 2), 16));
            i += 2;
        } else {
            bytes.push(s.charCodeAt(i) & 0xff);
        }
    }
    try { return decodeURIComponent(bytes.map(function (b) { return "%" + (b < 16 ? "0" : "") + b.toString(16); }).join("")); }
    catch (e) { return String.fromCharCode.apply(null, bytes); }
}

// The value of a property as text, decoding vCard 2.1 quoted-printable.
function textOf(prop) {
    if (!prop) return "";
    var enc = (prop.params.ENCODING || [])[0];
    var v = prop.value;
    if (enc && enc.toUpperCase() === "QUOTED-PRINTABLE") v = decodeQuotedPrintable(v);
    return v;
}

function paramValue(v) {
    return /[:;,"]/.test(v) ? "\"" + String(v).replace(/"/g, "'") + "\"" : v;
}

// UTF-8 aware folding at 75 octets (RFC 5545 3.1, RFC 6350 3.2).
function fold(line) {
    var out = [], cur = "", octets = 0;
    for (var i = 0; i < line.length; i++) {
        var ch = line.charAt(i);
        var code = line.charCodeAt(i);
        // Keep surrogate pairs together.
        var n = code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < line.length) { ch += line.charAt(i + 1); i++; n = 4; }
        if (octets + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; octets = 0; }
        cur += ch; octets += n;
    }
    out.push(cur);
    return out.join("\r\n ");
}

function serializeProp(p) {
    var head = (p.group ? p.group + "." : "") + p.name;
    Object.keys(p.params || {}).forEach(function (k) {
        var vals = [].concat(p.params[k]).filter(function (v) { return v !== undefined && v !== null && v !== ""; });
        if (vals.length) head += ";" + k + "=" + vals.map(paramValue).join(",");
    });
    return fold(head + ":" + p.value);
}

function serialize(comp) {
    var lines = ["BEGIN:" + comp.name];
    comp.props.forEach(function (p) { lines.push(serializeProp(p)); });
    (comp.components || []).forEach(function (c) { lines.push(serialize(c).replace(/\r\n$/, "")); });
    lines.push("END:" + comp.name);
    return lines.join("\r\n") + "\r\n";
}

function prop(name, value, params, group) {
    return { group: group || "", name: name, params: params || {}, value: value };
}

function find(comp, name) { return comp.props.filter(function (p) { return p.name === name; }); }
function first(comp, name) { return find(comp, name)[0] || null; }
function hasType(p, type) {
    return (p.params.TYPE || []).some(function (t) {
        return String(t).toUpperCase().split(",").indexOf(type) >= 0;
    });
}

module.exports = {
    parse: parse, serialize: serialize, prop: prop, find: find, first: first, hasType: hasType,
    unescapeText: unescapeText, escapeText: escapeText, splitValue: splitValue, textOf: textOf,
    decodeQuotedPrintable: decodeQuotedPrintable
};
