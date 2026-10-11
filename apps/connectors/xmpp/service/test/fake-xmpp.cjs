// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A fake XMPP server for the Jabber account's tests and the simulator's
// demo server (chat.example): the protocol, not a simulation of the
// account. It speaks what the client needs, following the specifications
// section by section:
//
//   RFC 6120   streams (TCP framing with STARTTLS, faked: the socket says it
//              is secure after <proceed/>), SASL SCRAM-SHA-256 / -SHA-1 /
//              PLAIN (scram.js's server side), resource binding, stream errors
//   RFC 7395   WebSocket framing (<open/>, <close/>, one element per message)
//   RFC 6121   roster get and pushes, presence broadcast and probes,
//              subscription requests, messages between users
//   XEP-0198   stream management: enable, <r/>/<a/>, resume
//   XEP-0280   carbons;  XEP-0313 MAM (urn:xmpp:mam:2) with RSM paging
//   XEP-0363   HTTP upload slots, and the upload host's PUT and GET (request())
//   XEP-0184   receipts; XEP-0333 markers; XEP-0085 chat states (from buddies)
//   XEP-0030   disco#info / #items (the upload component); XEP-0199 ping
//   XEP-0357   push enable / disable recorded (pushRegistrations)
//
// Buddies are users the server plays itself: they have presence and answer
// a message after a moment with one of their replies (the demo), mark it
// received (XEP-0184) and displayed (XEP-0333).
//
//   var s = createFakeXmpp({domain, users: {"me": "pw"}, buddies: [...]})
//   s.socket({framing: "stream"|"message", secure?}) -> a NetSocket for the client
//   s.net()   -> an Environment.net (connect, websocket, resolveSrv) for the kit
//   s.request(req) -> the upload host's HTTP (PUT / GET slots), host-meta
//   s.deliver(fromJid, toBareJid, text, opts?)  s.setPresence(jid, show, status)
//   s.unauthorized(on)  s.throttle(seconds)  s.requests()   (the conformance suite's)

"use strict";

var X = require("../lib/xml");
var scram = require("../lib/scram");

var NS = {
    stream: "http://etherx.jabber.org/streams", tls: "urn:ietf:params:xml:ns:xmpp-tls", sasl: "urn:ietf:params:xml:ns:xmpp-sasl",
    bind: "urn:ietf:params:xml:ns:xmpp-bind", sm: "urn:xmpp:sm:3", framing: "urn:ietf:params:xml:ns:xmpp-framing",
    streams: "urn:ietf:params:xml:ns:xmpp-streams", stanzas: "urn:ietf:params:xml:ns:xmpp-stanzas", roster: "jabber:iq:roster",
    carbons: "urn:xmpp:carbons:2", forward: "urn:xmpp:forward:0", mam: "urn:xmpp:mam:2", rsm: "http://jabber.org/protocol/rsm",
    data: "jabber:x:data", upload: "urn:xmpp:http:upload:0", discoInfo: "http://jabber.org/protocol/disco#info",
    discoItems: "http://jabber.org/protocol/disco#items", ping: "urn:xmpp:ping", receipts: "urn:xmpp:receipts",
    markers: "urn:xmpp:chat-markers:0", chatStates: "http://jabber.org/protocol/chatstates", delay: "urn:xmpp:delay",
    sid: "urn:xmpp:sid:0", push: "urn:xmpp:push:0", oob: "jabber:x:oob", vcard: "vcard-temp"
};

function bare(j) { return String(j || "").split("/")[0].toLowerCase(); }

function createFakeXmpp(options) {
    options = options || {};
    var domain = options.domain || "chat.example";
    var uploadHost = "upload." + domain;
    var users = Object.assign({}, options.users || {});            // local part -> password
    var buddies = (options.buddies || []).map(function (b) { return Object.assign({ replies: [], show: "", status: "", online: true }, b); });
    var replyDelay = options.replyDelay === undefined ? 1200 : options.replyDelay;
    var schedule = options.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
    var rosters = {};                // bare jid -> [{jid, name, subscription, groups}]
    var archives = {};               // bare jid -> [{id, stamp, el}]
    var sessions = [];               // open client streams
    var detached = {};               // sm id -> session awaiting resume
    var uploads = {};                // path -> {bytes, mimeType, put: bool}
    var pushRegistrations = [];
    var connections = 0, refuse = false, slowDown = 0, archiveSeq = 0, idSeq = 0, lastUploadUrl = null;
    var mechanisms = options.mechanisms || ["SCRAM-SHA-256", "SCRAM-SHA-1", "PLAIN"];
    var log = options.log || function () {};

    function buddy(jid) { return buddies.filter(function (b) { return b.jid === bare(jid); })[0] || null; }
    function rosterOf(user) {
        if (!rosters[user]) rosters[user] = buddies.map(function (b) {
            return { jid: b.jid, name: b.name, subscription: "both", groups: b.group ? [b.group] : ["Buddies"] };
        });
        return rosters[user];
    }
    function stanzaId() { return "sid-" + (++idSeq).toString(36); }
    function now() { return options.now ? options.now() : Date.now(); }

    function archive(user, el, stamp) {
        var list = archives[user] = archives[user] || [];
        // The archive's id is the stanza-id it gave the message (XEP-0313 5.1.2, XEP-0359).
        var sid = el.getChildren("stanza-id", NS.sid).filter(function (s) { return bare(s.attrs.by) === user; })[0];
        archiveSeq++;
        var item = { id: sid ? sid.attrs.id : "a" + String(archiveSeq).padStart(6, "0"), stamp: stamp || now(), el: el };
        list.push(item);
        return item;
    }

    // ---- A client stream ----------------------------------------------------------------------

    function Session(framing, secure) {
        var self = this;
        this.framing = framing;
        this.secure = !!secure;
        this.user = null;           // bare jid once signed in
        this.resource = null;
        this.bound = false;
        this.available = false;
        this.carbons = false;
        this.sm = null;             // {id, inbound, outbound, queue}
        this.closed = false;
        this.listeners = { data: [], close: [] };
        this.parser = null;
        this.newParser();
        // The client's end.
        this.client = {
            get framing() { return framing; },
            get secure() { return self.secure; },
            write: function (t) {
                if (self.closed) return;     // as a socket that has gone: the write is lost
                Promise.resolve().then(function () { if (!self.closed) self.parser.write(String(t)); });
            },
            startTls: framing === "stream" ? function () {
                return new Promise(function (resolve) { schedule(function () { self.secure = true; self.parser.reset(); resolve(); }, 0); });
            } : undefined,
            onData: function (f) { self.listeners.data.push(f); },
            onClose: function (f) { self.listeners.close.push(f); },
            close: function () { self.end(null, true); }
        };
    }
    Session.prototype.newParser = function () {
        var self = this;
        this.parser = X.createParser({ stream: this.framing === "stream" });
        this.parser.on("streamStart", function (attrs) { self.onStreamStart(attrs); });
        this.parser.on("streamEnd", function () { self.end(null, true); });
        this.parser.on("stanza", function (e) {
            try { self.onElement(e); } catch (err) { log("fake-xmpp: " + err.stack); self.streamError("internal-server-error"); }
        });
        this.parser.on("error", function () { self.streamError("not-well-formed"); });
    };
    Session.prototype.out = function (text) {
        var self = this;
        if (this.closed) return;
        schedule(function () { if (!self.closed) self.listeners.data.forEach(function (f) { f(text); }); }, 0);
    };
    Session.prototype.sendEl = function (el) {
        var counted = el.is && (el.is("message") || el.is("presence") || el.is("iq"));
        if (counted && this.sm) this.sm.outbound++;
        this.out(el.toString());
    };
    Session.prototype.end = function (error, fromClient) {
        if (this.closed) return;
        var self = this;
        this.closed = true;
        sessions = sessions.filter(function (s) { return s !== self; });
        // A stream that may be resumed waits (XEP-0198 5): not offline yet.
        if (this.sm && this.sm.resumable && !fromClient) { detached[this.sm.id] = this; }
        else if (this.user && this.available) broadcastUnavailable(this);
        schedule(function () { self.listeners.close.forEach(function (f) { f(error || undefined); }); }, 0);
    };
    Session.prototype.streamError = function (condition, text) {
        var e = X.el("stream:error", { "xmlns:stream": this.framing === "message" ? NS.stream : undefined },
                     X.el(condition, { xmlns: NS.streams }), text ? X.el("text", { xmlns: NS.streams }, text) : null);
        this.out(e.toString() + (this.framing === "stream" ? "</stream:stream>" : X.el("close", { xmlns: NS.framing }).toString()));
        var self = this;
        schedule(function () { self.end(null, true); }, 5);
    };
    Session.prototype.onStreamStart = function (attrs) {
        if (attrs.to && attrs.to !== domain) return this.streamError("host-unknown");
        var sid = "s" + (++idSeq);
        if (this.framing === "message") this.out(X.el("open", { xmlns: NS.framing, from: domain, id: sid, version: "1.0", "xml:lang": "en" }).toString());
        else this.out("<?xml version='1.0'?><stream:stream from='" + domain + "' id='" + sid + "' version='1.0' xml:lang='en' xmlns='jabber:client' xmlns:stream='" + NS.stream + "'>");
        if (slowDown && !this.user) return this.streamError("policy-violation", "Too many connections; wait " + slowDown + " seconds");
        var f = X.el("stream:features", this.framing === "message" ? { "xmlns:stream": NS.stream } : {});
        if (!this.secure && this.framing === "stream") f.append(X.el("starttls", { xmlns: NS.tls }, X.el("required")));
        else if (!this.user) {
            var m = X.el("mechanisms", { xmlns: NS.sasl });
            mechanisms.forEach(function (x) { m.append(X.el("mechanism", {}, x)); });
            f.append(m);
        } else {
            f.append(X.el("bind", { xmlns: NS.bind }));
            f.append(X.el("sm", { xmlns: NS.sm }));
        }
        this.out(f.toString());
    };
    Session.prototype.restart = function () {
        this.parser.reset();
    };
    Session.prototype.onElement = function (e) {
        var self = this;
        var ns = e.getNS();
        if (ns === NS.tls && e.is("starttls")) { this.out(X.el("proceed", { xmlns: NS.tls }).toString()); return; }
        if (ns === NS.sasl) return this.onSasl(e);
        if (ns === NS.sm) return this.onSm(e);
        if (!this.user) return this.streamError("not-authorized");
        if (this.sm && (e.is("message") || e.is("presence") || e.is("iq"))) this.sm.inbound++;
        if (e.is("iq")) return this.onIq(e);
        if (e.is("presence")) return this.onPresence(e);
        if (e.is("message")) return this.onMessage(e);
        void self;
    };
    Session.prototype.onSasl = function (e) {
        var self = this;
        if (e.is("auth")) {
            var mech = e.attrs.mechanism;
            if (mechanisms.indexOf(mech) < 0) return this.out(X.el("failure", { xmlns: NS.sasl }, X.el("invalid-mechanism")).toString());
            var data = scram.fromUtf8(scram.fromBase64(e.text()));
            if (mech === "PLAIN") {
                var parts = data.split("\u0000");
                // The demo server: any name with any password (PLAIN is all it offers then).
                if (options.acceptAny && parts[1] && parts[2] && users[parts[1]] === undefined) users[parts[1]] = parts[2];
                return this.saslDone(parts[1], users[parts[1]] !== undefined && users[parts[1]] === parts[2] && !refuse, "");
            }
            var hash = scram.HASHES[mech];
            this.scram = scram.serverExchange(data, function (u) { return refuse ? "\u0000refused" + Math.random() : users[u]; }, hash);
            return this.out(X.el("challenge", { xmlns: NS.sasl }, scram.toBase64(scram.utf8(this.scram.serverFirst))).toString());
        }
        if (e.is("response") && this.scram) {
            var ex = this.scram;
            this.scram = null;
            ex.finish(scram.fromUtf8(scram.fromBase64(e.text()))).then(function (final) {
                self.saslDone(ex.user, !!final, final ? scram.toBase64(scram.utf8(final)) : "");
            });
        }
    };
    Session.prototype.saslDone = function (user, ok, extra) {
        if (!ok) return this.out(X.el("failure", { xmlns: NS.sasl }, X.el("not-authorized")).toString());
        this.user = (user + "@" + domain).toLowerCase();
        this.out(X.el("success", { xmlns: NS.sasl }, extra || null).toString());
        this.restart();
    };
    Session.prototype.onSm = function (e) {
        if (e.is("enable") && this.bound) {
            this.sm = { id: "sm-" + (++idSeq), inbound: 0, outbound: 0, resumable: e.attrs.resume === "true" || e.attrs.resume === "1" };
            return this.out(X.el("enabled", { xmlns: NS.sm, id: this.sm.id, resume: this.sm.resumable ? "true" : undefined, max: "600" }).toString());
        }
        if (e.is("r") && this.sm) return this.out(X.el("a", { xmlns: NS.sm, h: String(this.sm.inbound) }).toString());
        if (e.is("a")) return;
        if (e.is("resume")) {
            var old = detached[e.attrs.previd];
            if (!old || old.user !== this.user) return this.out(X.el("failed", { xmlns: NS.sm }, X.el("item-not-found", { xmlns: NS.stanzas })).toString());
            delete detached[e.attrs.previd];
            this.resource = old.resource;
            this.bound = true;
            this.available = old.available;
            this.carbons = old.carbons;
            this.sm = old.sm;
            this.presence = old.presence;
            sessions.push(this);
            this.out(X.el("resumed", { xmlns: NS.sm, previd: this.sm.id, h: String(this.sm.inbound) }).toString());
            var self = this;
            (old.missed || []).forEach(function (m) { self.sendEl(m); });
        }
    };
    Session.prototype.full = function () { return this.user + "/" + this.resource; };
    Session.prototype.result = function (iq, child) {
        this.sendEl(X.el("iq", { type: "result", id: iq.attrs.id, to: this.full(), from: iq.attrs.to }, child || null));
    };
    Session.prototype.error = function (iq, type, condition) {
        this.sendEl(X.el("iq", { type: "error", id: iq.attrs.id, to: this.full(), from: iq.attrs.to },
                         X.el("error", { type: type }, X.el(condition, { xmlns: NS.stanzas }))));
    };
    Session.prototype.onIq = function (iq) {
        var self = this, type = iq.attrs.type, to = iq.attrs.to ? bare(iq.attrs.to) : domain;
        var child = iq.getChildElements()[0];
        if (!child) return;
        var cns = child.getNS();
        if (child.is("bind", NS.bind)) {
            this.resource = child.getChildText("resource") || "r" + (++idSeq);
            this.bound = true;
            sessions.push(this);
            return this.sendEl(X.el("iq", { type: "result", id: iq.attrs.id }, X.el("bind", { xmlns: NS.bind }, X.el("jid", {}, this.full()))));
        }
        if (child.is("ping", NS.ping)) return this.result(iq);
        if (cns === NS.roster && type === "get") {
            var q = X.el("query", { xmlns: NS.roster });
            rosterOf(this.user).forEach(function (r) {
                var it = X.el("item", { jid: r.jid, name: r.name || undefined, subscription: r.subscription });
                (r.groups || []).forEach(function (g) { it.append(X.el("group", {}, g)); });
                q.append(it);
            });
            return this.result(iq, q);
        }
        if (cns === NS.roster && type === "set") {
            var item = child.getChild("item");
            var list = rosterOf(this.user);
            var j = bare(item.attrs.jid);
            var existing = list.filter(function (r) { return r.jid === j; })[0];
            if (item.attrs.subscription === "remove") rosters[this.user] = list.filter(function (r) { return r.jid !== j; });
            else if (existing) existing.name = item.attrs.name;
            else list.push({ jid: j, name: item.attrs.name, subscription: "none", groups: [] });
            this.result(iq);
            return pushRoster(this.user, item);
        }
        if (child.is("enable", NS.carbons) && type === "set") { this.carbons = true; return this.result(iq); }
        if (child.is("disable", NS.carbons) && type === "set") { this.carbons = false; return this.result(iq); }
        if (cns === NS.discoInfo && type === "get") {
            var info = X.el("query", { xmlns: NS.discoInfo });
            if (to === uploadHost) {
                info.append(X.el("identity", { category: "store", type: "file", name: "HTTP File Upload" }));
                info.append(X.el("feature", { var: NS.upload }));
                info.append(X.el("x", { xmlns: NS.data, type: "result" },
                    X.el("field", { var: "FORM_TYPE", type: "hidden" }, X.el("value", {}, NS.upload)),
                    X.el("field", { var: "max-file-size" }, X.el("value", {}, String(10 * 1024 * 1024)))));
            } else if (to === domain) {
                info.append(X.el("identity", { category: "server", type: "im", name: "Fake XMPP" }));
                [NS.discoInfo, NS.discoItems, NS.ping, NS.carbons, NS.push].forEach(function (f) { info.append(X.el("feature", { var: f })); });
            } else if (to === this.user) {
                info.append(X.el("identity", { category: "pubsub", type: "pep" }));
                [NS.mam].forEach(function (f) { info.append(X.el("feature", { var: f })); });
            } else return this.error(iq, "cancel", "item-not-found");
            return this.result(iq, info);
        }
        if (cns === NS.discoItems && type === "get") {
            var items = X.el("query", { xmlns: NS.discoItems });
            if (to === domain) items.append(X.el("item", { jid: uploadHost, name: "HTTP File Upload" }));
            return this.result(iq, items);
        }
        if (child.is("request", NS.upload) && type === "get" && to === uploadHost) {
            var size = Number(child.attrs.size);
            if (!(size > 0) || size > 10 * 1024 * 1024) return this.error(iq, "modify", "not-acceptable");
            var path = "/" + (++idSeq).toString(36) + Math.random().toString(36).slice(2, 8) + "/" + encodeURIComponent(child.attrs.filename || "file");
            uploads[path] = { size: size, mimeType: child.attrs["content-type"] || "application/octet-stream", bytes: null };
            var url = "https://" + uploadHost + path;
            lastUploadUrl = url;
            return this.result(iq, X.el("slot", { xmlns: NS.upload },
                X.el("put", { url: url }, X.el("header", { name: "Authorization" }, "Bearer slot-" + idSeq)),
                X.el("get", { url: url })));
        }
        if (child.is("query", NS.mam) && type === "set" && (to === this.user || !iq.attrs.to)) return this.mamQuery(iq, child);
        if ((child.is("enable", NS.push) || child.is("disable", NS.push)) && type === "set") {
            pushRegistrations.push({ user: this.user, op: child.localName(), jid: child.attrs.jid, node: child.attrs.node });
            return this.result(iq);
        }
        if (child.is("vCard", NS.vcard) && type === "get") {
            var b = buddy(to);
            return this.result(iq, X.el("vCard", { xmlns: NS.vcard }, b ? X.el("FN", {}, b.name) : null));
        }
        // To a local user's client: route; else not here.
        var target = sessions.filter(function (s) { return s.full() === iq.attrs.to; })[0];
        if (target) return target.sendEl(Object.assign(iq, { attrs: Object.assign({}, iq.attrs, { from: self.full() }) }));
        return this.error(iq, "cancel", "service-unavailable");
    };
    // XEP-0313 4: the archive after a stanza id, a page at a time (RSM, XEP-0059).
    Session.prototype.mamQuery = function (iq, q) {
        var self = this;
        var list = (archives[this.user] || []).slice();
        var form = q.getChild("x", NS.data);
        var withJid = null, start = 0;
        if (form) form.getChildren("field").forEach(function (f) {
            var v = f.getChildText("value");
            if (f.attrs.var === "with") withJid = bare(v);
            if (f.attrs.var === "start") start = Date.parse(v) || 0;
        });
        if (withJid) list = list.filter(function (a) { return bare(a.el.attrs.from) === withJid || bare(a.el.attrs.to) === withJid; });
        if (start) list = list.filter(function (a) { return a.stamp >= start; });
        var set = q.getChild("set", NS.rsm);
        var max = set ? Number(set.getChildText("max") || 50) : 50;
        var after = set ? set.getChildText("after") : null;
        var before = set ? set.getChild("before") : null;
        if (after) { var i = list.map(function (a) { return a.id; }).indexOf(after); list = i >= 0 ? list.slice(i + 1) : []; }
        var page;
        if (before) { page = list.slice(Math.max(0, list.length - max)); }
        else page = list.slice(0, max);
        page.forEach(function (a) {
            self.sendEl(X.el("message", { to: self.full(), from: self.user },
                X.el("result", { xmlns: NS.mam, queryid: q.attrs.queryid, id: a.id },
                    X.el("forwarded", { xmlns: NS.forward }, X.el("delay", { xmlns: NS.delay, stamp: new Date(a.stamp).toISOString() }),
                         X.parse(a.el.toString())))));
        });
        var complete = before ? page.length === list.length : page.length === list.length;
        var rsm = X.el("set", { xmlns: NS.rsm });
        if (page.length) { rsm.append(X.el("first", {}, page[0].id)); rsm.append(X.el("last", {}, page[page.length - 1].id)); }
        rsm.append(X.el("count", {}, String(list.length)));
        this.result(iq, X.el("fin", { xmlns: NS.mam, complete: complete ? "true" : undefined }, rsm));
    };
    Session.prototype.onPresence = function (p) {
        var self = this, type = p.attrs.type;
        if (!p.attrs.to) {
            // Broadcast: initial or changed presence, or unavailable.
            var first = !this.available;
            this.available = type !== "unavailable";
            this.presence = p;
            if (first && this.available) {
                // Probes answered (RFC 6121 4.2.2): each buddy's presence.
                rosterOf(this.user).forEach(function (r) { var b = buddy(r.jid); if (b) self.sendEl(buddyPresence(b, self.full())); });
                sessions.forEach(function (s) {
                    if (s !== self && s.user !== self.user && s.available && rosterOf(self.user).some(function (r) { return r.jid === s.user; }))
                        self.sendEl(withFrom(s.presence || X.el("presence"), s.full(), self.full()));
                });
            }
            sessions.forEach(function (s) {
                if (s !== self && s.available && (s.user === self.user || rosterOf(s.user).some(function (r) { return r.jid === self.user; })))
                    s.sendEl(withFrom(p, self.full(), s.full()));
            });
            return;
        }
        var to = bare(p.attrs.to);
        if (type === "subscribe" || type === "subscribed" || type === "unsubscribe" || type === "unsubscribed") {
            var b = buddy(to);
            if (b && type === "subscribe") self.sendEl(X.el("presence", { from: b.jid, to: self.user, type: "subscribed" }));
            return;
        }
        // Directed presence to a user.
        sessions.forEach(function (s) { if (s.user === to) s.sendEl(withFrom(p, self.full(), s.full())); });
    };
    Session.prototype.onMessage = function (m) {
        var self = this;
        var to = bare(m.attrs.to);
        if (!to) return;
        var out = withFrom(m, this.full(), m.attrs.to);
        if (!m.getChild("store", "urn:xmpp:hints") && (m.getChild("body") || m.getChild("x", NS.oob))) {
            out.append(X.el("stanza-id", { xmlns: NS.sid, id: stanzaId(), by: this.user }));
            archive(this.user, out);
        }
        // Carbons: the sender's other clients get a sent copy (XEP-0280 6).
        if (m.getChild("body") && !m.getChild("private", NS.carbons))
            sessions.forEach(function (s) {
                if (s !== self && s.user === self.user && s.carbons) s.sendEl(X.el("message", { from: self.user, to: s.full(), type: m.attrs.type },
                    X.el("sent", { xmlns: NS.carbons }, X.el("forwarded", { xmlns: NS.forward }, X.parse(out.toString())))));
            });
        var b = buddy(to);
        if (b) return buddyAnswers(b, self, m);
        if (users[to.split("@")[0]] !== undefined && to.split("@")[1] === domain) deliverTo(to, out);
    };

    function withFrom(el, from, to) {
        var c = X.parse(el.toString());
        c.attrs.from = from;
        if (to) c.attrs.to = to;
        return c;
    }
    function buddyPresence(b, to) {
        if (!b.online) return X.el("presence", { from: b.jid + "/phone", to: to, type: "unavailable" });
        return X.el("presence", { from: b.jid + "/phone", to: to }, b.show ? X.el("show", {}, b.show) : null, b.status ? X.el("status", {}, b.status) : null);
    }
    function broadcastUnavailable(s) {
        sessions.forEach(function (o) {
            if (o !== s && o.available && rosterOf(o.user).some(function (r) { return r.jid === s.user; }))
                o.sendEl(X.el("presence", { from: s.full(), to: o.full(), type: "unavailable" }));
        });
    }
    function pushRoster(user, item) {
        sessions.forEach(function (s) {
            if (s.user === user) s.sendEl(X.el("iq", { type: "set", id: "push" + (++idSeq), to: s.full() }, X.el("query", { xmlns: NS.roster }, X.parse(item.toString()))));
        });
    }

    // A message for a user: archived, to every available client (RFC 6121
    // 8.5.2.1.1, as most servers do for type chat), carbons of their own.
    function deliverTo(user, el) {
        var copy = withFrom(el, el.attrs.from, user);
        if (!copy.getChild("stanza-id", NS.sid)) copy.append(X.el("stanza-id", { xmlns: NS.sid, id: stanzaId(), by: user }));
        else copy.getChild("stanza-id", NS.sid).attrs.by = user;
        if (copy.getChild("body") || copy.getChild("x", NS.oob)) archive(user, copy);
        var targets = sessions.filter(function (s) { return s.user === user && s.available; });
        targets.forEach(function (s) { s.sendEl(withFrom(copy, copy.attrs.from, s.full())); });
        // Stream resumption: what a detached stream missed is sent on resume.
        Object.keys(detached).forEach(function (k) {
            var d = detached[k];
            if (d.user === user) (d.missed = d.missed || []).push(withFrom(copy, copy.attrs.from, d.full()));
        });
        return copy;
    }

    function buddyAnswers(b, s, m) {
        var id = m.attrs.id;
        // XEP-0184: received; XEP-0333: displayed, a little later.
        if (id && m.getChild("request", NS.receipts) && b.online)
            schedule(function () { deliverTo(s.user, X.el("message", { from: b.jid + "/phone", type: "chat" }, X.el("received", { xmlns: NS.receipts, id: id }), X.el("store", { xmlns: "urn:xmpp:hints" }))); }, 50);
        if (!m.getChild("body") || !b.online || !b.replies.length) return;
        if (id && m.getChild("markable", NS.markers))
            schedule(function () { deliverTo(s.user, X.el("message", { from: b.jid + "/phone", type: "chat" }, X.el("displayed", { xmlns: NS.markers, id: id }))); }, Math.max(60, replyDelay / 2));
        b.n = (b.n || 0) + 1;
        var text = b.replies[(b.n - 1) % b.replies.length];
        schedule(function () {
            deliverTo(s.user, X.el("message", { from: b.jid + "/phone", type: "chat" }, X.el("active", { xmlns: NS.chatStates })));
        }, Math.max(30, replyDelay / 3));
        schedule(function () {
            deliverTo(s.user, X.el("message", { from: b.jid + "/phone", type: "chat", id: "b" + (++idSeq) },
                X.el("body", {}, text), X.el("active", { xmlns: NS.chatStates }), X.el("markable", { xmlns: NS.markers })));
        }, replyDelay);
    }

    // ---- What the tests and the simulator drive ------------------------------------------------

    function socket(o) {
        connections++;
        var s = new Session((o && o.framing) || "stream", !!(o && o.secure));
        return s.client;
    }

    var server = {
        domain: domain,
        socket: socket,
        // As Environment.net: SRV for the domain (STARTTLS on 5222), TCP to it, WebSocket.
        net: function (n) {
            n = n || {};
            var env = {};
            if (n.tcp !== false) {
                env.resolveSrv = function (name) {
                    if (name === "_xmpp-client._tcp." + domain) return Promise.resolve([{ name: "xmpp." + domain, port: 5222, priority: 5, weight: 0 }]);
                    return Promise.resolve([]);
                };
                env.connect = function (c) {
                    if (c.host !== "xmpp." + domain && c.host !== domain) return Promise.reject(Object.assign(new Error("getaddrinfo ENOTFOUND " + c.host), { code: "ENOTFOUND" }));
                    return Promise.resolve(socket({ framing: "stream", secure: !!c.tls }));
                };
            }
            if (n.websocket !== false) {
                env.websocket = function (url) {
                    if (url.indexOf("wss://" + domain + "/") !== 0) return Promise.reject(Object.assign(new Error("Could not connect to " + url), { code: "ECONNREFUSED" }));
                    return Promise.resolve(socket({ framing: "message", secure: true }));
                };
            }
            return env;
        },
        // HTTP: the domain's host-meta (XEP-0156), the upload host's slots.
        request: function (req) {
            var u = new URL(req.url);
            var reply = function (status, body, headers) {
                var r = { status: status, headers: headers || {} };
                if (req.binary) r.bytes = body instanceof Uint8Array ? body : scram.utf8(String(body || ""));
                else r.body = body instanceof Uint8Array ? scram.fromUtf8(body) : String(body || "");
                return Promise.resolve(r);
            };
            if (u.host === domain && u.pathname === "/.well-known/host-meta.json")
                return reply(200, JSON.stringify({ links: [{ rel: "urn:xmpp:alt-connections:websocket", href: "wss://" + domain + "/xmpp-websocket" }] }), { "content-type": "application/json" });
            if (u.host === domain && u.pathname === "/.well-known/host-meta") return reply(404, "");
            if (u.host !== uploadHost) return reply(404, "");
            var slot = uploads[u.pathname];
            if (!slot) return reply(404, "");
            if (req.method === "PUT") {
                if (slot.bytes) return reply(409, "");
                var body = req.body instanceof Uint8Array ? req.body : scram.utf8(String(req.body || ""));
                if (body.length !== slot.size) return reply(400, "size");
                if (!req.headers || !/^Bearer slot-/.test(req.headers.Authorization || req.headers.authorization || "")) return reply(403, "");
                slot.bytes = body;
                return reply(201, "");
            }
            if (req.method === "GET" && slot.bytes) return reply(200, slot.bytes, { "content-type": slot.mimeType, "content-length": String(slot.bytes.length) });
            return reply(404, "");
        },
        addUser: function (name, password) { users[name] = password; },
        // Any stanza for a user, as a remote server would route it.
        deliverRaw: function (user, el) { return deliverTo(bare(user), el); },
        // A message to user from anyone (a buddy, or a user of another server); opts: {oob, id, type}.
        deliver: function (from, user, text, opts) {
            opts = opts || {};
            var el = X.el("message", { from: from.indexOf("/") < 0 ? from + "/phone" : from, type: opts.type || "chat", id: opts.id || "m" + (++idSeq) },
                          text ? X.el("body", {}, text) : null, opts.oob ? X.el("x", { xmlns: NS.oob }, X.el("url", {}, opts.oob)) : null,
                          X.el("markable", { xmlns: NS.markers }), X.el("request", { xmlns: NS.receipts }));
            return deliverTo(bare(user), el);
        },
        // What one of the user's own other clients sent (a carbon on the others, and the archive).
        sentFromOtherClient: function (user, to, text) {
            var el = X.el("message", { from: bare(user) + "/laptop", to: to, type: "chat", id: "o" + (++idSeq) }, X.el("body", {}, text),
                          X.el("stanza-id", { xmlns: NS.sid, id: stanzaId(), by: bare(user) }));
            archive(bare(user), el);
            sessions.forEach(function (s) {
                if (s.user === bare(user) && s.carbons) s.sendEl(X.el("message", { from: bare(user), to: s.full(), type: "chat" },
                    X.el("sent", { xmlns: NS.carbons }, X.el("forwarded", { xmlns: NS.forward }, X.parse(el.toString())))));
            });
        },
        typing: function (from, user, state) {
            return deliverTo(bare(user), X.el("message", { from: from + "/phone", type: "chat" }, X.el(state || "composing", { xmlns: NS.chatStates })));
        },
        setPresence: function (jid, show, status) {
            var b = buddy(jid);
            if (!b) return false;
            b.online = show !== "unavailable";
            b.show = show === "unavailable" || show === "available" ? "" : show || "";
            b.status = status || "";
            sessions.forEach(function (s) {
                if (s.available && rosterOf(s.user).some(function (r) { return r.jid === b.jid; })) s.sendEl(buddyPresence(b, s.full()));
            });
            return true;
        },
        buddies: function () { return buddies.map(function (b) { return { jid: b.jid, name: b.name }; }); },
        archive: function (user) { return (archives[bare(user)] || []).map(function (a) { return a.el.toString(); }); },
        upload: function (url) { var u = new URL(url); return uploads[u.pathname] || null; },
        // The link of the last picture put on the upload host (one a buddy can send back).
        lastUpload: function () { return lastUploadUrl && uploads[new URL(lastUploadUrl).pathname].bytes ? lastUploadUrl : null; },
        sessions: function () { return sessions.map(function (s) { return { user: s.user, resource: s.resource, available: s.available, carbons: s.carbons, sm: !!s.sm }; }); },
        // Drop the connection under a client (the network went), its stream kept for resumption.
        dropConnections: function () { sessions.slice().forEach(function (s) { s.end(new Error("network lost"), false); }); },
        pushRegistrations: function () { return pushRegistrations.slice(); },
        // The conformance suite's switches (docs/SYNERGY-SDK.md "Testing").
        unauthorized: function (on) { refuse = !!on; if (on) sessions.slice().forEach(function (s) { s.streamError("not-authorized"); }); },
        throttle: function (seconds) { slowDown = seconds; if (seconds) sessions.slice().forEach(function (s) { s.streamError("policy-violation"); }); },
        requests: function () { return connections; },
        close: function () { sessions.slice().forEach(function (s) { s.end(null, true); }); detached = {}; }
    };
    return server;
}

// The simulator's demo server: chat.example and its people (fictional,
// linked by name to the sample contacts; runtime "Instant messaging").
function demoServer(o) {
    return createFakeXmpp(Object.assign({
        domain: "chat.example",
        buddies: [
            { jid: "ada.palmer@chat.example", name: "Ada Palmer", show: "", status: "Flashing a Pre 3",
              replies: ["Ha, yes!", "Cards forever.", "Send me a picture when it boots?", "On my way."] },
            { jid: "marcus.reyes@chat.example", name: "Marcus Reyes", show: "dnd", status: "In a meeting until 3",
              replies: ["In a meeting, will reply after.", "Can't talk now, later?"] },
            { jid: "lena.okafor@chat.example", name: "Lena Okafor", show: "", status: "",
              replies: ["Hi! Just landed.", "Sounds good.", "See you there."] },
            { jid: "theo.lindqvist@chat.example", name: "Theo Lindqvist", online: false, replies: [] }
        ],
        // Any name signs in on the demo server, with any password (users added
        // as they sign in), so it can only offer PLAIN (over its TLS): the
        // tests' servers offer SCRAM.
        users: {}, acceptAny: true, mechanisms: ["PLAIN"]
    }, o || {}));
}

module.exports = { createFakeXmpp: createFakeXmpp, demoServer: demoServer, NS: NS };
