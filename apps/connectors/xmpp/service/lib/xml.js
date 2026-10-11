// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// XML for an XMPP stream (RFC 6120 section 11: no DTD, no processing
// instructions but the declaration, no comments expected): a streaming
// parser and elements to build, read and write stanzas. Plain CommonJS
// without dependencies, so it runs on a device (run-js-service), in the
// simulator's page and in Node's tests.
//
//   var p = createParser({stream: true});   // TCP: <stream:stream> stays open
//   p.on("streamStart", fn(attrs)); p.on("stanza", fn(el)); p.on("streamEnd", fn())
//   p.on("error", fn(err)); p.write(text)
//   createParser({stream: false})           // WebSocket (RFC 7395): one
//                                           // element per message; <open/>
//                                           // and <close/> are the stream's
//   el(name, attrs?, ...children)            // build: x("message", {to}, x("body", {}, "Hi"))
//   element.getChild(name, ns?), getChildren, getChildText, text(), toString()

"use strict";

var ENTITIES = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };

function escapeText(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
    return escapeText(s).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function unescape(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, function (m, e) {
        if (e.charAt(0) === "#") {
            var code = e.charAt(1) === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return ENTITIES[e] !== undefined ? ENTITIES[e] : m;
    });
}

function Element(name, attrs) {
    this.name = name;
    this.attrs = attrs || {};
    this.children = [];
    this.parent = null;
}
Element.prototype.localName = function () {
    var i = this.name.indexOf(":");
    return i < 0 ? this.name : this.name.slice(i + 1);
};
// The element's namespace: its own xmlns (or the prefix's), else its parent's.
Element.prototype.getNS = function () {
    var i = this.name.indexOf(":");
    var attr = i < 0 ? "xmlns" : "xmlns:" + this.name.slice(0, i);
    for (var e = this; e; e = e.parent) if (e.attrs[attr] !== undefined) return e.attrs[attr];
    return i < 0 ? (this.defaultNS || "") : "";
};
Element.prototype.is = function (name, ns) {
    return this.localName() === name && (ns === undefined || this.getNS() === ns);
};
Element.prototype.c = function (name, attrs) {
    var child = new Element(name, attrs);
    child.parent = this;
    this.children.push(child);
    return child;
};
Element.prototype.append = function (child) {
    if (child === null || child === undefined || child === false) return this;
    if (Array.isArray(child)) { child.forEach(this.append, this); return this; }
    if (child instanceof Element) child.parent = this;
    else child = String(child);
    this.children.push(child);
    return this;
};
Element.prototype.getChildren = function (name, ns) {
    return this.children.filter(function (c) { return c instanceof Element && c.is(name, ns); });
};
Element.prototype.getChild = function (name, ns) {
    return this.getChildren(name, ns)[0] || null;
};
Element.prototype.getChildElements = function () {
    return this.children.filter(function (c) { return c instanceof Element; });
};
Element.prototype.text = function () {
    return this.children.map(function (c) { return typeof c === "string" ? c : ""; }).join("");
};
Element.prototype.getChildText = function (name, ns) {
    var c = this.getChild(name, ns);
    return c ? c.text() : null;
};
Element.prototype.toString = function () {
    var self = this;
    var a = Object.keys(this.attrs).filter(function (k) { return self.attrs[k] !== undefined && self.attrs[k] !== null; })
        .map(function (k) { return " " + k + "=\"" + escapeAttr(self.attrs[k]) + "\""; }).join("");
    if (!this.children.length) return "<" + this.name + a + "/>";
    return "<" + this.name + a + ">" + this.children.map(function (c) {
        return typeof c === "string" ? escapeText(c) : c.toString();
    }).join("") + "</" + this.name + ">";
};

// el("message", {to: "a@b"}, el("body", {}, "Hi"))
function el(name, attrs) {
    var e = new Element(name, Object.assign({}, attrs || {}));
    for (var i = 2; i < arguments.length; i++) e.append(arguments[i]);
    return e;
}

function parseAttrs(text) {
    var attrs = {}, re = /([^\s=\/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, m;
    while ((m = re.exec(text))) attrs[m[1]] = unescape(m[2] !== undefined ? m[2] : m[3]);
    return attrs;
}

// stream: true for TCP (a <stream:stream> root that stays open; its
// children are the stanzas); false for WebSocket framing (RFC 7395 section
// 3.3: each message one whole element, <open/> and <close/> framing it).
// defaultNS: the stanzas' namespace when they name none ("jabber:client").
function createParser(options) {
    options = options || {};
    var streamMode = options.stream !== false;
    var defaultNS = options.defaultNS || "jabber:client";
    var handlers = {};
    var buf = "";
    var stack = [];
    var root = null;        // the open <stream:stream>
    var failed = false;
    var maxSize = options.maxStanzaBytes || 10 * 1024 * 1024;
    function emit(type, arg) { (handlers[type] || []).forEach(function (f) { f(arg); }); }
    function fail(message) {
        failed = true;
        emit("error", Object.assign(new Error("Bad XML: " + message), { condition: "not-well-formed" }));
    }
    function open(name, attrs, selfClosing) {
        if (streamMode && !root && stack.length === 0) {
            if (name !== "stream:stream" && name !== "stream") return fail("expected <stream:stream>, got <" + name + ">");
            root = new Element(name, attrs);
            emit("streamStart", attrs);
            return;
        }
        if (!streamMode && stack.length === 0 && (name === "open" || name === "close") &&
            attrs.xmlns === "urn:ietf:params:xml:ns:xmpp-framing") {
            emit(name === "open" ? "streamStart" : "streamEnd", attrs);
            return;
        }
        var e = new Element(name, attrs);
        e.defaultNS = defaultNS;
        if (stack.length) {
            e.parent = stack[stack.length - 1];
            e.parent.children.push(e);
        } else if (root) {
            e.parent = root;
        }
        if (selfClosing) close(e);
        else stack.push(e);
    }
    function close(e) {
        if (!e.parent || e.parent === root) {
            // A stanza (or stream-level element) is done: it no longer hangs on the root.
            if (e.parent === root) e.parent = root;
            emit("stanza", e);
        }
    }
    function end(name) {
        if (streamMode && !stack.length && root && name === root.name) {
            root = null;
            emit("streamEnd");
            return;
        }
        var e = stack.pop();
        if (!e || e.name !== name) return fail("</" + name + "> closes " + (e ? "<" + e.name + ">" : "nothing"));
        if (!stack.length) close(e);
    }
    function text(t) {
        if (!stack.length) return;   // whitespace between stanzas (keepalives)
        stack[stack.length - 1].children.push(unescape(t));
    }
    function run() {
        while (!failed && buf.length) {
            var lt = buf.indexOf("<");
            // Text waits for the next tag: an entity may be cut between two pieces.
            if (lt < 0) return;
            if (lt > 0) { text(buf.slice(0, lt)); buf = buf.slice(lt); continue; }
            if (buf.startsWith("<?")) {
                var pe = buf.indexOf("?>");
                if (pe < 0) return;
                buf = buf.slice(pe + 2);
                continue;
            }
            if (buf.startsWith("<!--")) {
                var ce = buf.indexOf("-->");
                if (ce < 0) return;
                buf = buf.slice(ce + 3);
                continue;
            }
            if (buf.startsWith("<![CDATA[")) {
                var de = buf.indexOf("]]>");
                if (de < 0) return;
                if (stack.length) stack[stack.length - 1].children.push(buf.slice(9, de));
                buf = buf.slice(de + 3);
                continue;
            }
            if (buf.startsWith("<!")) return fail("DTDs are not allowed");
            // A tag: find its end outside quotes.
            var i = 1, q = null;
            for (; i < buf.length; i++) {
                var ch = buf.charAt(i);
                if (q) { if (ch === q) q = null; }
                else if (ch === "\"" || ch === "'") q = ch;
                else if (ch === ">") break;
            }
            if (i >= buf.length) {
                if (buf.length > maxSize) fail("a tag larger than " + maxSize + " bytes");
                return;
            }
            var tag = buf.slice(1, i);
            buf = buf.slice(i + 1);
            if (tag.charAt(0) === "/") { end(tag.slice(1).trim()); continue; }
            var self = tag.charAt(tag.length - 1) === "/";
            if (self) tag = tag.slice(0, -1);
            var m = /^([^\s\/>]+)\s*([\s\S]*)$/.exec(tag);
            if (!m) return fail("<" + tag + ">");
            open(m[1], parseAttrs(m[2]), self);
        }
    }
    return {
        on: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn); return this; },
        write: function (t) {
            if (failed) return;
            buf += t;
            run();
        },
        // A new stream on the same connection (after STARTTLS or SASL, RFC 6120 4.3.3).
        reset: function () { buf = ""; stack = []; root = null; failed = false; }
    };
}

// Parse one whole element (a WebSocket message, a test's expectation).
function parse(text) {
    var out = null, err = null;
    var p = createParser({ stream: false });
    p.on("stanza", function (e) { if (!out) out = e; });
    p.on("error", function (e) { err = e; });
    p.write(text);
    if (err) throw err;
    return out;
}

module.exports = { Element: Element, el: el, createParser: createParser, parse: parse, escapeText: escapeText, escapeAttr: escapeAttr };
