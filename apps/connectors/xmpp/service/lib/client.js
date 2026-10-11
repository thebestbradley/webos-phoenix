// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An XMPP client stream (RFC 6120), written for Phoenix's Jabber account
// (docs/SYNERGY-CONNECTORS.md 7) on the connector kit's sockets (ctx.net):
//
//   - the server from the domain's SRV records (RFC 6120 3.2.1:
//     _xmpp-client._tcp, STARTTLS; XEP-0368: _xmpps-client._tcp, TLS from
//     the start), else the domain on 5222; where the host has no TCP (the
//     simulator's page) a WebSocket (RFC 7395) the domain names in its
//     host-meta (XEP-0156);
//   - TLS always (STARTTLS when the server is reached in the clear); only a
//     server on this computer (127.0.0.1, localhost: tests) may be plain;
//   - SASL SCRAM-SHA-256 or SCRAM-SHA-1 (RFC 5802, 7677), the server's
//     signature checked; PLAIN only over TLS and only when the server
//     offers no SCRAM;
//   - resource binding, then stream management (XEP-0198): every stanza
//     counted and acknowledged, the unacknowledged ones sent again when the
//     stream is resumed after a drop;
//   - IQs with ids and timeouts; ping (XEP-0199) and service discovery
//     (XEP-0030) answered; anything else unknown answered
//     service-unavailable (RFC 6120 8.4).
//
// The account's logic (roster, messages, carbons, archive, uploads) is in
// lib/session.js; this file only speaks the stream.
//
//   var c = createClient({net, http?, jid, password, resource, log?, timers?, features?})
//   c.on("online", fn({jid, resumed})) .on("stanza", fn(el)) .on("close", fn({error, resumable}))
//   c.connect() -> Promise<{jid, resumed}>      c.send(el)      c.iq(el, ms?) -> Promise<el>
//   c.resume() -> Promise                         c.close()       c.discoverEndpoints(domain)

"use strict";

var X = require("./xml");
var scram = require("./scram");

var NS = {
    stream: "http://etherx.jabber.org/streams", client: "jabber:client", tls: "urn:ietf:params:xml:ns:xmpp-tls",
    sasl: "urn:ietf:params:xml:ns:xmpp-sasl", bind: "urn:ietf:params:xml:ns:xmpp-bind", session: "urn:ietf:params:xml:ns:xmpp-session",
    sm: "urn:xmpp:sm:3", framing: "urn:ietf:params:xml:ns:xmpp-framing", stanzas: "urn:ietf:params:xml:ns:xmpp-stanzas",
    streams: "urn:ietf:params:xml:ns:xmpp-streams", ping: "urn:xmpp:ping", discoInfo: "http://jabber.org/protocol/disco#info"
};

function bare(jid) { return String(jid || "").split("/")[0].toLowerCase(); }
function domainOf(jid) { var b = bare(jid); return b.indexOf("@") >= 0 ? b.split("@")[1] : b; }
function localOf(jid) { var b = bare(jid); return b.indexOf("@") >= 0 ? b.split("@")[0] : ""; }
function isLoopback(host) { return /^(127\.\d+\.\d+\.\d+|localhost|\[?::1\]?)(:\d+)?$/i.test(String(host)); }

function fail(message, errorCode, extra) {
    var e = new Error(message);
    e.errorCode = errorCode;
    return Object.assign(e, extra || {});
}

// A stream error's condition -> an error code the accounts library shows
// (and the kit's backoff for a server that asks us to slow down).
var BACKOFF_MS = 15 * 60 * 1000;
function streamError(condition, text, now) {
    switch (condition) {
    case "not-authorized": return fail(text || "Not authorized", "401_UNAUTHORIZED");
    case "host-unknown": return fail(text || "The server does not serve that domain", "HOST_NOT_FOUND");
    case "policy-violation": case "resource-constraint":
        return fail(text || "The server asked to slow down", "503_SERVICE_UNAVAILABLE", { retryAt: now() + BACKOFF_MS });
    case "conflict": return fail(text || "Signed in elsewhere with the same resource", "CONNECTION_FAILED", { conflict: true });
    case "system-shutdown": return fail(text || "The server is shutting down", "503_SERVICE_UNAVAILABLE");
    }
    return fail(text || "The server closed the stream (" + condition + ")", "CONNECTION_FAILED");
}

function createClient(o) {
    var net = o.net, log = o.log || function () {};
    var timers = o.timers || { setTimeout: setTimeout, clearTimeout: clearTimeout };
    var now = o.now || function () { return Date.now(); };
    var jid = bare(o.jid), domain = domainOf(o.jid), resource = o.resource || "phoenix";
    var handlers = {};
    var socket = null, parser = null, features = null, pending = {}, seq = 0;
    var state = "offline";       // connecting | online | closing | offline
    var boundJid = "";
    // Stream management (XEP-0198).
    var sm = { enabled: false, id: null, resumable: false, location: null, inbound: 0, outbound: 0, queue: [], ackedOut: 0 };
    var ackTimer = null, keepTimer = null, waitingAck = false, deadTimers = [];
    var waiters = [];            // stream-level elements awaited during negotiation
    var endpoint = null;         // the endpoint that worked, for a resume

    function emit(type, arg) { (handlers[type] || []).slice().forEach(function (f) { try { f(arg); } catch (e) { log("handler: " + e.message); } }); }
    function id() { return "ph" + now().toString(36) + "-" + (++seq); }

    // ---- Finding the server -----------------------------------------------------------------

    function discoverEndpoints(dom) {
        var out = [];
        var chain = Promise.resolve();
        if (o.host) {
            out.push({ kind: o.directTls ? "tls" : "starttls", host: o.host, port: o.port || (o.directTls ? 5223 : 5222) });
            return Promise.resolve(out);
        }
        if (net.supports.tcp) {
            chain = Promise.all([
                net.supports.srv ? net.resolveSrv("_xmpps-client._tcp." + dom).catch(function () { return []; }) : [],
                net.supports.srv ? net.resolveSrv("_xmpp-client._tcp." + dom).catch(function () { return []; }) : []
            ]).then(function (r) {
                // XEP-0368 section 3: both sets by priority, direct TLS first where equal.
                var all = r[0].map(function (s) { return { kind: "tls", host: s.name, port: s.port, priority: s.priority, weight: s.weight, tlsFirst: 0 }; })
                    .concat(r[1].map(function (s) { return { kind: "starttls", host: s.name, port: s.port, priority: s.priority, weight: s.weight, tlsFirst: 1 }; }));
                all.sort(function (a, b) { return a.priority - b.priority || a.tlsFirst - b.tlsFirst || b.weight - a.weight; });
                out = out.concat(all);
                // RFC 6120 3.2.2: no SRV records, the domain itself on 5222.
                if (!all.length) out.push({ kind: "starttls", host: dom, port: 5222 });
            });
        }
        if (net.supports.websocket && o.http) {
            chain = chain.then(function () { return hostMetaWebsocket(dom); }).then(function (url) {
                if (url) out.push({ kind: "websocket", url: url });
            });
        }
        return chain.then(function () {
            if (!out.length) throw fail("No way to reach " + dom + " from here", "HOST_NOT_FOUND");
            return out;
        });
    }

    // XEP-0156: the domain's host-meta names its WebSocket endpoint
    // (urn:xmpp:alt-connections:websocket), as JSON or as XRD.
    function hostMetaWebsocket(dom) {
        var base = (isLoopback(dom) ? "http://" : "https://") + dom + "/.well-known/host-meta";
        var REL = "urn:xmpp:alt-connections:websocket";
        return o.http.request({ method: "GET", url: base + ".json", headers: { Accept: "application/json" } }).then(function (r) {
            if (r.status !== 200) throw new Error("no JSON host-meta");
            var j = JSON.parse(r.body || "{}");
            var link = (j.links || []).filter(function (l) { return l.rel === REL && /^wss?:\/\//.test(l.href || ""); })[0];
            return link ? link.href : null;
        }).catch(function (e1) {
            log("host-meta.json of " + dom + ": " + e1.message);
            return o.http.request({ method: "GET", url: base }).then(function (r) {
                if (r.status !== 200) return null;
                var m = new RegExp("<Link[^>]+rel=[\"']" + REL.replace(/[.:]/g, "\\$&") + "[\"'][^>]*href=[\"'](wss?://[^\"']+)").exec(r.body || "") ||
                        new RegExp("<Link[^>]+href=[\"'](wss?://[^\"']+)[\"'][^>]*rel=[\"']" + REL.replace(/[.:]/g, "\\$&")).exec(r.body || "");
                return m ? m[1] : null;
            }).catch(function (e2) { log("host-meta of " + dom + ": " + e2.message); return null; });
        }).then(function (url) {
            // Only a WebSocket of the account's own domain (or its subdomain).
            if (!url) return null;
            var h = new URL(url).host.replace(/:\d+$/, "");
            if (h !== dom && h.slice(-(dom.length + 1)) !== "." + dom && !(isLoopback(h) && isLoopback(dom))) return null;
            net.allowHost(new URL(url).host);
            return url;
        });
    }

    // ---- The socket and the parser -------------------------------------------------------------

    function openSocket(ep) {
        if (ep.kind === "websocket") return net.websocket(ep.url, ["xmpp"]);
        return net.connect({ host: ep.host, port: ep.port, tls: ep.kind === "tls", servername: domain });
    }

    function newParser() {
        parser = X.createParser({ stream: socket.framing === "stream" });
        parser.on("streamStart", function (attrs) { emitStream({ start: attrs }); });
        parser.on("streamEnd", function () { emitStream({ end: true }); drop(fail("The server closed the stream", "CONNECTION_FAILED")); });
        parser.on("stanza", onElement);
        parser.on("error", function (e) { drop(fail(e.message, "CONNECTION_FAILED")); });
    }

    function write(text) {
        if (!socket) throw fail("Not connected", "CONNECTION_FAILED");
        socket.write(text);
    }
    function openStream() {
        if (socket.framing === "message") write(X.el("open", { xmlns: NS.framing, to: domain, version: "1.0", "xml:lang": "en" }).toString());
        else write("<?xml version='1.0'?><stream:stream to='" + X.escapeAttr(domain) + "' version='1.0' xml:lang='en' xmlns='jabber:client' xmlns:stream='" + NS.stream + "'>");
    }

    // During negotiation: wait for the next stream-level element matching fn.
    function expect(fn, ms) {
        return new Promise(function (resolve, reject) {
            var w = { fn: fn, resolve: resolve, reject: reject };
            w.timer = timers.setTimeout(function () {
                waiters = waiters.filter(function (x) { return x !== w; });
                reject(fail("The server did not answer", "CONNECTION_TIMEOUT"));
            }, ms || 30000);
            waiters.push(w);
        });
    }
    function emitStream(ev) {
        var w = waiters.filter(function (x) { return x.fn(ev); })[0];
        if (!w) return false;
        waiters = waiters.filter(function (x) { return x !== w; });
        timers.clearTimeout(w.timer);
        w.resolve(ev);
        return true;
    }

    function onElement(e) {
        // Stream errors end everything.
        if (e.is("error", NS.stream)) {
            var cond = e.getChildElements().filter(function (c) { return c.getNS() === NS.streams && c.localName() !== "text"; })[0];
            return drop(streamError(cond ? cond.localName() : "undefined-condition", e.getChildText("text", NS.streams), now));
        }
        if (state !== "online") {
            if (emitStream({ el: e })) return;
        }
        // XEP-0198 acknowledgements.
        if (e.getNS() === NS.sm) {
            if (e.is("r", NS.sm)) { socket.write(X.el("a", { xmlns: NS.sm, h: String(sm.inbound) }).toString()); return; }
            if (e.is("a", NS.sm)) { acked(Number(e.attrs.h)); return; }
            if (state !== "online") return;
        }
        if (!(e.is("message") || e.is("presence") || e.is("iq"))) return;
        if (sm.enabled) sm.inbound = (sm.inbound + 1) % 4294967296;
        if (e.is("iq") && (e.attrs.type === "result" || e.attrs.type === "error")) {
            var p = pending[e.attrs.id];
            if (p) {
                delete pending[e.attrs.id];
                timers.clearTimeout(p.timer);
                if (e.attrs.type === "result") p.resolve(e);
                else p.reject(stanzaError(e));
                return;
            }
        }
        if (e.is("iq") && (e.attrs.type === "get" || e.attrs.type === "set")) return answerIq(e);
        emit("stanza", e);
    }

    function stanzaError(e) {
        var err = e.getChild("error");
        var cond = err ? err.getChildElements().filter(function (c) { return c.getNS() === NS.stanzas && c.localName() !== "text"; })[0] : null;
        var name = cond ? cond.localName() : "undefined-condition";
        var code = name === "not-authorized" || name === "forbidden" ? "401_UNAUTHORIZED"
                 : name === "item-not-found" || name === "service-unavailable" || name === "feature-not-implemented" ? "UNSUPPORTED"
                 : name === "resource-constraint" || name === "policy-violation" ? "503_SERVICE_UNAVAILABLE" : "SERVER_ERROR";
        return fail("The server answered " + name + (err && err.getChildText("text", NS.stanzas) ? ": " + err.getChildText("text", NS.stanzas) : ""), code, { condition: name });
    }

    // IQs addressed to us: the listeners first ({handled}), then ping and
    // disco, else service-unavailable.
    function answerIq(e) {
        var ev = { iq: e, handled: false, reply: function (child) { ev.handled = true; send(X.el("iq", { type: "result", to: e.attrs.from, id: e.attrs.id }, child || null)); } };
        emit("iq", ev);
        if (ev.handled) return;
        if (e.attrs.type === "get" && e.getChild("ping", NS.ping)) return ev.reply();
        var q = e.getChild("query", NS.discoInfo);
        if (e.attrs.type === "get" && q && !q.attrs.node) {
            var info = X.el("query", { xmlns: NS.discoInfo }, X.el("identity", { category: "client", type: "phone", name: "webOS Phoenix" }));
            (o.features || []).concat([NS.discoInfo, NS.ping]).forEach(function (f) { info.append(X.el("feature", { var: f })); });
            return ev.reply(info);
        }
        send(X.el("iq", { type: "error", to: e.attrs.from, id: e.attrs.id },
                  X.el("error", { type: "cancel" }, X.el("service-unavailable", { xmlns: NS.stanzas }))));
    }

    // ---- Negotiation ---------------------------------------------------------------------------

    function features_() {
        return expect(function (ev) { return ev.el && ev.el.is("features", NS.stream); }).then(function (ev) { features = ev.el; return features; });
    }
    function restart() {
        parser.reset();
        openStream();
        return features_();
    }

    function negotiate(ep, resuming) {
        return features_().then(function (f) {
            // TLS (RFC 6120 5): STARTTLS when offered and not already secure.
            var tls = f.getChild("starttls", NS.tls);
            if (!socket.secure && tls && socket.startTls) {
                write(X.el("starttls", { xmlns: NS.tls }).toString());
                return expect(function (ev) { return ev.el && ev.el.getNS() === NS.tls; }).then(function (ev) {
                    if (!ev.el.is("proceed", NS.tls)) throw fail("The server refused TLS", "CONNECTION_FAILED");
                    return socket.startTls(domain);
                }).then(restart);
            }
            if (!socket.secure && !isLoopback(ep.host || (ep.url && new URL(ep.url).host) || "")) {
                throw fail("The server offers no encryption: not signing in", "SSL_CERT_UNTRUSTED");
            }
            return f;
        }).then(function (f) {
            return authenticate(f);
        }).then(restart).then(function (f) {
            if (resuming && sm.id && f.getChild("sm", NS.sm)) return tryResume().then(function (ok) { return ok ? { resumed: true } : bind(f); });
            return bind(f);
        });
    }

    function authenticate(f) {
        var mechs = (f.getChild("mechanisms", NS.sasl) || X.el("x")).getChildren("mechanism").map(function (m) { return m.text().trim(); });
        var mech = ["SCRAM-SHA-256", "SCRAM-SHA-1"].filter(function (m) { return mechs.indexOf(m) >= 0; })[0];
        if (!mech && mechs.indexOf("PLAIN") >= 0 && socket.secure) mech = "PLAIN";
        if (!mech) throw fail("The server offers no sign-in this device supports (" + mechs.join(", ") + ")", "UNSUPPORTED");
        var user = localOf(o.jid) || o.jid;
        function saslResult(ev) { return ev.el && ev.el.getNS() === NS.sasl; }
        function refused(el) {
            var cond = el.getChildElements().filter(function (c) { return c.localName() !== "text"; })[0];
            var name = cond ? cond.localName() : "not-authorized";
            if (name === "not-authorized" || name === "credentials-expired" || name === "account-disabled")
                return fail("Wrong Jabber ID or password", "401_UNAUTHORIZED", { condition: name });
            return fail("The server refused the sign-in (" + name + ")", "401_UNAUTHORIZED", { condition: name });
        }
        if (mech === "PLAIN") {
            var b = scram.utf8("\u0000" + user + "\u0000" + o.password);
            write(X.el("auth", { xmlns: NS.sasl, mechanism: "PLAIN" }, scram.toBase64(b)).toString());
            return expect(saslResult).then(function (ev) { if (!ev.el.is("success")) throw refused(ev.el); });
        }
        var hash = scram.HASHES[mech];
        var first = scram.clientFirst({ username: user });
        var expected = null;
        write(X.el("auth", { xmlns: NS.sasl, mechanism: mech }, scram.toBase64(scram.utf8(first.message))).toString());
        return expect(saslResult).then(function (ev) {
            if (!ev.el.is("challenge")) throw refused(ev.el);
            return scram.clientFinal(first.state, scram.fromUtf8(scram.fromBase64(ev.el.text())), o.password, hash);
        }).then(function (fin) {
            expected = fin.serverSignature;
            write(X.el("response", { xmlns: NS.sasl }, scram.toBase64(scram.utf8(fin.message))).toString());
            return expect(saslResult);
        }).then(function (ev) {
            if (!ev.el.is("success")) throw refused(ev.el);
            // RFC 5802 section 9: the server proves it knew the password too.
            if (!scram.verifyServerFinal(scram.fromUtf8(scram.fromBase64(ev.el.text())), expected))
                throw fail("The server's answer to the sign-in did not check out", "CONNECTION_FAILED");
        });
    }

    function bind(f) {
        if (!f.getChild("bind", NS.bind)) throw fail("The server offers no resource binding", "UNSUPPORTED");
        return rawIq(X.el("iq", { type: "set", id: id() }, X.el("bind", { xmlns: NS.bind }, X.el("resource", {}, resource)))).then(function (r) {
            boundJid = r.getChild("bind", NS.bind).getChildText("jid", NS.bind) || jid + "/" + resource;
            // RFC 3921's session, only where the server still needs it (RFC 6121 note).
            var s = f.getChild("session", NS.session);
            if (s && !s.getChild("optional", NS.session)) return rawIq(X.el("iq", { type: "set", id: id() }, X.el("session", { xmlns: NS.session })));
        }).then(function () {
            if (!f.getChild("sm", NS.sm) || o.streamManagement === false) return { resumed: false };
            write(X.el("enable", { xmlns: NS.sm, resume: "true" }).toString());
            return expect(function (ev) { return ev.el && ev.el.getNS() === NS.sm && (ev.el.is("enabled") || ev.el.is("failed")); }).then(function (ev) {
                if (ev.el.is("enabled", NS.sm)) {
                    sm = { enabled: true, id: ev.el.attrs.id || null, resumable: ev.el.attrs.resume === "true" || ev.el.attrs.resume === "1",
                           location: ev.el.attrs.location || null, inbound: 0, outbound: 0, queue: [], ackedOut: 0 };
                }
                return { resumed: false };
            });
        });
    }

    function tryResume() {
        write(X.el("resume", { xmlns: NS.sm, h: String(sm.inbound), previd: sm.id }).toString());
        return expect(function (ev) { return ev.el && ev.el.getNS() === NS.sm && (ev.el.is("resumed") || ev.el.is("failed")); }).then(function (ev) {
            if (!ev.el.is("resumed", NS.sm)) {
                log("stream not resumed: a new session");
                var lost = sm.queue.slice();
                sm = { enabled: false, id: null, resumable: false, location: null, inbound: 0, outbound: 0, queue: [], ackedOut: 0 };
                emit("resumeFailed", { unacked: lost });
                return false;
            }
            acked(Number(ev.el.attrs.h));
            var again = sm.queue.slice();
            sm.queue = [];
            sm.outbound = sm.ackedOut;
            state = "resuming";
            again.forEach(function (s) { send(s); });
            return true;
        });
    }

    // The server handled h stanzas of ours: those leave the queue.
    function acked(h) {
        if (!sm.enabled || !isFinite(h)) return;
        var n = (h - sm.ackedOut + 4294967296) % 4294967296;
        if (n > sm.queue.length) n = sm.queue.length;
        var done = sm.queue.splice(0, n);
        sm.ackedOut = h;
        waitingAck = false;
        if (done.length) emit("acked", done);
    }

    // IQ before the stream is online (bind, session): not queued for SM.
    function rawIq(el) {
        return new Promise(function (resolve, reject) {
            var i = el.attrs.id;
            pending[i] = { resolve: resolve, reject: reject, timer: timers.setTimeout(function () {
                delete pending[i];
                reject(fail("The server did not answer", "CONNECTION_TIMEOUT"));
            }, 30000) };
            write(el.toString());
        });
    }

    // ---- Online --------------------------------------------------------------------------------

    function send(el) {
        if (state !== "online" && state !== "resuming") throw fail("Not connected", "CONNECTION_FAILED");
        var counted = el.is("message") || el.is("presence") || el.is("iq");
        if (counted && sm.enabled) {
            sm.queue.push(el);
            sm.outbound++;
        }
        socket.write(el.toString());
        if (counted && sm.enabled) requestAck();
    }
    // Ask for an acknowledgement soon after sending (one <r/> for a burst).
    function requestAck() {
        if (ackTimer || waitingAck) return;
        ackTimer = timers.setTimeout(function () {
            ackTimer = null;
            if (!socket || state !== "online" || !sm.queue.length) return;
            waitingAck = true;
            socket.write(X.el("r", { xmlns: NS.sm }).toString());
            // No answer in a minute: the connection is dead even if the socket does not know.
            var asked = sm.ackedOut;
            deadTimers.push(timers.setTimeout(function () {
                if (state === "online" && waitingAck && sm.ackedOut === asked) drop(fail("The server stopped answering", "CONNECTION_TIMEOUT"));
            }, 60000));
        }, 250);
    }
    // A keepalive every few minutes (a NAT forgets an idle connection): an
    // SM request, else a ping.
    function keepalive() {
        timers.clearTimeout(keepTimer);
        keepTimer = timers.setTimeout(function () {
            if (state !== "online") return;
            if (sm.enabled) {
                waitingAck = true;
                var asked = sm.ackedOut;
                socket.write(X.el("r", { xmlns: NS.sm }).toString());
                deadTimers.push(timers.setTimeout(function () {
                    if (state === "online" && waitingAck && sm.ackedOut === asked && !sm.queue.length) waitingAck = false;
                }, 60000));
            } else {
                iq(X.el("iq", { type: "get", to: domain }, X.el("ping", { xmlns: NS.ping })), 60000).catch(function (e) {
                    if (e.errorCode === "CONNECTION_TIMEOUT") drop(e);
                });
            }
            keepalive();
        }, o.keepaliveMs || 4 * 60 * 1000);
    }

    function iq(el, ms) {
        return new Promise(function (resolve, reject) {
            var i = el.attrs.id || (el.attrs.id = id());
            pending[i] = { resolve: resolve, reject: reject, timer: timers.setTimeout(function () {
                delete pending[i];
                reject(fail("The server did not answer", "CONNECTION_TIMEOUT"));
            }, ms || 30000) };
            try { send(el); } catch (e) { delete pending[i]; reject(e); }
        });
    }

    // ---- Life ---------------------------------------------------------------------------------

    function drop(error) {
        if (state === "offline") return;
        var wasOnline = state === "online";
        state = "offline";
        timers.clearTimeout(keepTimer);
        timers.clearTimeout(ackTimer);
        deadTimers.splice(0).forEach(function (t) { timers.clearTimeout(t); });
        waitingAck = false;
        ackTimer = null;
        waiters.splice(0).forEach(function (w) { timers.clearTimeout(w.timer); w.reject(error || fail("Disconnected", "CONNECTION_FAILED")); });
        Object.keys(pending).forEach(function (k) { timers.clearTimeout(pending[k].timer); pending[k].reject(error || fail("Disconnected", "CONNECTION_FAILED")); });
        pending = {};
        var s = socket;
        socket = null;
        if (s) try { s.close(); } catch (e) { /* gone */ }
        if (wasOnline) emit("close", { error: error || null, resumable: !!(sm.enabled && sm.resumable && sm.id) && !(error && error.conflict) });
    }

    function start(resuming) {
        if (state !== "offline") return Promise.reject(fail("Already " + state, "CONNECTION_FAILED"));
        state = "connecting";
        var eps = endpoint && resuming ? Promise.resolve([endpoint]) : discoverEndpoints(domain);
        return eps.then(function (list) {
            var lastError = null;
            function tryNext(i) {
                if (i >= list.length) throw lastError || fail("Could not reach " + domain, "CONNECTION_FAILED");
                var ep = list[i];
                state = "connecting";
                return openSocket(ep).then(function (s) {
                    socket = s;
                    s.onData(function (t) { if (socket === s && parser) parser.write(t); });
                    s.onClose(function (err) {
                        if (socket !== s) return;
                        drop(err ? fail(err.message, err.code === "ENOTFOUND" ? "HOST_NOT_FOUND" : err.code === "ETIMEDOUT" ? "CONNECTION_TIMEOUT"
                                                    : /certificate|self.signed|CERT/i.test(err.code || err.message) ? "SSL_CERT_UNTRUSTED" : "CONNECTION_FAILED")
                                 : fail("The connection closed", "CONNECTION_FAILED"));
                    });
                    newParser();
                    openStream();
                    return negotiate(ep, resuming).then(function (r) {
                        endpoint = ep;
                        return r;
                    });
                }).catch(function (e) {
                    // A refused sign-in or a server that asks to wait is final; the next endpoint otherwise.
                    var s = socket;
                    socket = null;
                    if (s) try { s.close(); } catch (x) { /* gone */ }
                    if (e.errorCode === "401_UNAUTHORIZED" || e.retryAt || e.errorCode === "UNSUPPORTED" || e.errorCode === "SSL_CERT_UNTRUSTED") throw e;
                    lastError = e;
                    return tryNext(i + 1);
                });
            }
            return tryNext(0);
        }).then(function (r) {
            state = "online";
            keepalive();
            var ev = { jid: boundJid || jid + "/" + resource, resumed: !!r.resumed };
            emit("online", ev);
            return ev;
        }, function (e) {
            state = "offline";
            throw e;
        });
    }

    var api = {
        on: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn); return api; },
        connect: function () { return start(false); },
        // After a drop: the same endpoint, the stream resumed if the server kept it (XEP-0198 5).
        resume: function () { return start(true); },
        send: send,
        iq: iq,
        id: id,
        close: function () {
            if (state === "offline") return Promise.resolve();
            var s = socket;
            state = "closing";
            try {
                if (s && s.framing === "message") s.write(X.el("close", { xmlns: NS.framing }).toString());
                else if (s) s.write("</stream:stream>");
            } catch (e) { /* gone */ }
            sm.enabled = false;
            sm.id = null;
            state = "online";   // drop() emits close for an orderly end too
            drop(null);
            return Promise.resolve();
        },
        get online() { return state === "online"; },
        get jid() { return boundJid; },
        get bareJid() { return jid; },
        get domain() { return domain; },
        get secure() { return !!(socket && socket.secure); },
        get streamManagement() { return { enabled: sm.enabled, resumable: sm.resumable, unacked: sm.queue.length }; },
        discoverEndpoints: discoverEndpoints
    };
    return api;
}

module.exports = { createClient: createClient, bare: bare, domainOf: domainOf, localOf: localOf, isLoopback: isLoopback, NS: NS, streamError: streamError };
