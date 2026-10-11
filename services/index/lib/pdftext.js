// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The words of a PDF where that is cheap: its page content streams
// (uncompressed, or FlateDecode through inflate: Node's zlib on a device,
// the page's DecompressionStream in the simulator), and the strings shown
// with Tj, TJ, ' and " (ISO 32000-1 9.4.3). Fonts with their own encodings
// (CID fonts without a ToUnicode map) give no words this way; then the
// file is found by its name only. Nothing here runs the PDF.

"use strict";

var MAX_STREAMS = 400, MAX_CHARS = 200000;

function latin1(bytes, from, to) {
    var s = "";
    for (var i = from; i < to; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(to, i + 0x8000)));
    return s;
}

// The text operators' strings in a content stream.
function shown(content) {
    var out = [], i = 0, n = content.length;
    function literal() {
        var depth = 1, s = "";
        i++;
        while (i < n && depth > 0) {
            var c = content[i++];
            if (c === "\\") {
                var e = content[i++];
                if (e === "n") s += "\n"; else if (e === "r") s += "\r"; else if (e === "t") s += "\t";
                else if (e === "b" || e === "f") s += " ";
                else if (/[0-7]/.test(e)) {
                    var oct = e;
                    while (oct.length < 3 && /[0-7]/.test(content[i])) oct += content[i++];
                    s += String.fromCharCode(parseInt(oct, 8));
                } else if (e === "\n" || e === "\r") { /* a line continued */ }
                else s += e;
            } else if (c === "(") { depth++; s += c; }
            else if (c === ")") { depth--; if (depth) s += c; }
            else s += c;
        }
        return s;
    }
    function hex() {
        var end = content.indexOf(">", i);
        var h = content.slice(i + 1, end < 0 ? n : end).replace(/[^0-9a-fA-F]/g, "");
        i = end < 0 ? n : end + 1;
        if (h.length % 2) h += "0";
        var s = "";
        // Two bytes a character when it reads as UTF-16 (a FEFF mark, or
        // every other byte zero); else one.
        var wide = /^feff/i.test(h) || (h.length >= 4 && /^(?:00[0-9a-f]{2})+$/i.test(h));
        for (var k = /^feff/i.test(h) ? 4 : 0; k < h.length; k += wide ? 4 : 2) s += String.fromCharCode(parseInt(h.substr(k, wide ? 4 : 2), 16));
        return s;
    }
    var pending = [];
    while (i < n) {
        var c = content[i];
        if (c === "(") { pending.push(literal()); continue; }
        if (c === "<" && content[i + 1] !== "<") { pending.push(hex()); continue; }
        if (c === "[" || c === "]") { i++; continue; }
        var m = /^(?:Tj|TJ|'|")/.exec(content.slice(i, i + 2));
        if (m && (i === 0 || /\s|\]|\)|>/.test(content[i - 1]))) {
            if (pending.length) out.push(pending.join(""));
            pending = [];
            i += m[0].length;
            continue;
        }
        if (/^(?:T\*|Td|TD|ET)\b/.test(content.slice(i, i + 3))) { if (out.length && out[out.length - 1] !== "\n") out.push("\n"); i += 2; continue; }
        if (/[A-Za-z]/.test(c)) { pending = /^(?:Tj|TJ)/.test(content.slice(i, i + 2)) ? pending : []; }
        i++;
    }
    return out.join(" ").replace(/ *\n */g, "\n");
}

// -> Promise<string>: the PDF's words (maybe "").
function extract(bytes, inflate) {
    if (!bytes || bytes.length < 8 || latin1(bytes, 0, 5) !== "%PDF-") return Promise.resolve("");
    var all = latin1(bytes, 0, bytes.length);
    var re = /stream\r?\n/g, m, jobs = [];
    while ((m = re.exec(all)) && jobs.length < MAX_STREAMS) {
        var start = m.index + m[0].length;
        var end = all.indexOf("endstream", start);
        if (end < 0) break;
        var dict = all.slice(Math.max(0, all.lastIndexOf("obj", m.index)), m.index);
        re.lastIndex = end;
        // Pictures, fonts and the like are not text.
        if (/\/Subtype\s*\/(?:Image|Type1C|CIDFontType0C|OpenType)|\/Length1|\/Type\s*\/(?:XObject|XRef|ObjStm|EmbeddedFile|Metadata)/.test(dict)) continue;
        var data = bytes.subarray(start, end);
        if (/\/FlateDecode/.test(dict)) jobs.push(inflate ? Promise.resolve(inflate(data)).then(function (d) { return latin1(d, 0, d.length); }, function () { return ""; }) : Promise.resolve(""));
        else if (!/\/Filter/.test(dict)) jobs.push(Promise.resolve(latin1(data, 0, data.length)));
    }
    return Promise.all(jobs).then(function (texts) {
        var words = texts.map(function (t) { return /\b(?:Tj|TJ)\b/.test(t) ? shown(t) : ""; }).join("\n").slice(0, MAX_CHARS);
        // Mostly not letters: a font's own codes, not words.
        var letters = (words.match(/[A-Za-zÀ-ɏ]/g) || []).length;
        return letters < words.replace(/\s/g, "").length * 0.5 ? "" : words;
    });
}

module.exports = { extract: extract, shown: shown };
