// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A small namespace-aware XML reader for WebDAV responses (RFC 4918
// multistatus bodies), and helpers to write request bodies. The sync engine
// runs in Node.js on a device (no DOMParser) and in a browser page in the
// simulator, so it cannot rely on either platform's XML parser.
//
// parse(text) returns the root element as
//   { ns, name, attrs, children: [element], text }
// where ns is the namespace URI, name the local name and text the
// concatenated character data of the element itself. Comments, processing
// instructions and doctypes are skipped; CDATA is kept as text.

"use strict";

var ENTITIES = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };

function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, function (m, e) {
        if (e.charAt(0) === "#") {
            var code = e.charAt(1) === "x" || e.charAt(1) === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return isNaN(code) ? m : String.fromCodePoint(code);
        }
        return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
    });
}

function escape(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function parse(text) {
    var pos = 0;
    var root = null;
    // Stack of { el, nsMap } with the element's in-scope prefixes.
    var stack = [];
    var baseNs = { xml: "http://www.w3.org/XML/1998/namespace" };

    function scope() { return stack.length ? stack[stack.length - 1].nsMap : baseNs; }

    function resolveName(qname, nsMap, isAttr) {
        var i = qname.indexOf(":");
        var prefix = i >= 0 ? qname.slice(0, i) : "";
        var local = i >= 0 ? qname.slice(i + 1) : qname;
        // Unprefixed attributes have no namespace; unprefixed elements get the default one.
        var ns = prefix ? nsMap[prefix] : (isAttr ? "" : nsMap[""]);
        return { ns: ns || "", name: local };
    }

    while (pos < text.length) {
        var lt = text.indexOf("<", pos);
        if (lt < 0) break;
        if (lt > pos && stack.length)
            stack[stack.length - 1].el.text += decodeEntities(text.slice(pos, lt));
        if (text.startsWith("<!--", lt)) {
            var endC = text.indexOf("-->", lt + 4);
            pos = endC < 0 ? text.length : endC + 3;
            continue;
        }
        if (text.startsWith("<![CDATA[", lt)) {
            var endD = text.indexOf("]]>", lt + 9);
            if (stack.length) stack[stack.length - 1].el.text += text.slice(lt + 9, endD < 0 ? text.length : endD);
            pos = endD < 0 ? text.length : endD + 3;
            continue;
        }
        if (text.startsWith("<?", lt) || text.startsWith("<!", lt)) {
            var endP = text.indexOf(">", lt);
            pos = endP < 0 ? text.length : endP + 1;
            continue;
        }
        if (text.charAt(lt + 1) === "/") {
            var endE = text.indexOf(">", lt);
            stack.pop();
            pos = endE < 0 ? text.length : endE + 1;
            continue;
        }
        // Start tag: find its end, skipping quoted attribute values.
        var i = lt + 1, quote = null;
        while (i < text.length) {
            var ch = text.charAt(i);
            if (quote) { if (ch === quote) quote = null; }
            else if (ch === "\"" || ch === "'") quote = ch;
            else if (ch === ">") break;
            i++;
        }
        var raw = text.slice(lt + 1, i);
        var selfClosing = raw.charAt(raw.length - 1) === "/";
        if (selfClosing) raw = raw.slice(0, -1);
        var m = /^\s*([^\s\/>]+)/.exec(raw);
        var qname = m ? m[1] : "";
        var attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, a;
        var rawAttrs = {};
        var nsMap = Object.create(scope());
        var attrText = m ? raw.slice(m[0].length) : "";
        while ((a = attrRe.exec(attrText))) {
            var val = decodeEntities(a[3] !== undefined ? a[3] : a[4]);
            if (a[1] === "xmlns") nsMap[""] = val;
            else if (a[1].indexOf("xmlns:") === 0) nsMap[a[1].slice(6)] = val;
            else rawAttrs[a[1]] = val;
        }
        var nm = resolveName(qname, nsMap, false);
        var el = { ns: nm.ns, name: nm.name, attrs: {}, children: [], text: "" };
        Object.keys(rawAttrs).forEach(function (k) {
            var an = resolveName(k, nsMap, true);
            el.attrs[an.name] = rawAttrs[k];
        });
        if (stack.length) stack[stack.length - 1].el.children.push(el);
        else if (!root) root = el;
        if (!selfClosing) stack.push({ el: el, nsMap: nsMap });
        pos = i + 1;
    }
    if (!root) throw new Error("not an XML document");
    return root;
}

// Direct children matching namespace and local name.
function children(el, ns, name) {
    return (el && el.children || []).filter(function (c) { return c.ns === ns && c.name === name; });
}

function child(el, ns, name) { return children(el, ns, name)[0] || null; }

// Follows a path of [ns, name] pairs: child(child(el, a), b) ...
function path(el, steps) {
    var cur = el;
    for (var i = 0; i < steps.length && cur; i++) cur = child(cur, steps[i][0], steps[i][1]);
    return cur;
}

function text(el) { return el ? el.text.trim() : ""; }

module.exports = { parse: parse, children: children, child: child, path: path, text: text, escape: escape };
