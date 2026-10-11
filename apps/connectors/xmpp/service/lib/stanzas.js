// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What a message stanza means for Messaging: a chat message (with a
// picture), a receipt, a marker, a chat state; unwrapped from carbons
// (XEP-0280) and archive results (XEP-0313) when they come from the
// account's own server, and nothing else (XEP-0280 section 11: a carbon
// from anyone else is a forgery). And the stanzas the account sends.

"use strict";

var X = require("./xml");

var NS = {
    carbons: "urn:xmpp:carbons:2", forward: "urn:xmpp:forward:0", mam: "urn:xmpp:mam:2", delay: "urn:xmpp:delay",
    sid: "urn:xmpp:sid:0", oob: "jabber:x:oob", receipts: "urn:xmpp:receipts", markers: "urn:xmpp:chat-markers:0",
    chatStates: "http://jabber.org/protocol/chatstates", hints: "urn:xmpp:hints", eme: "urn:xmpp:eme:0",
    omemo: "eu.siacs.conversations.axolotl", omemo2: "urn:xmpp:omemo:2", openpgp: "urn:xmpp:openpgp:0", otr: "urn:xmpp:otr:0"
};
var CHAT_STATES = ["active", "composing", "paused", "inactive", "gone"];

function bare(j) { return String(j || "").split("/")[0].toLowerCase(); }

// -> {type, from, to, body, url, id, originId, stanzaId, stamp, carbon, archiveId, receiptId, markerId, chatState, encrypted}
// or null for what is not a chat message (headlines, errors, group chats).
function parseMessage(el, own, opts) {
    opts = opts || {};
    own = bare(own);
    var carbon = null, archiveId = null, stamp = null;
    var outerFrom = el.attrs.from ? bare(el.attrs.from) : own;
    var inner = el;
    var sent = el.getChild("sent", NS.carbons), received = el.getChild("received", NS.carbons);
    var result = el.getChild("result", NS.mam);
    if (sent || received) {
        if (outerFrom !== own) return null;
        var fw = (sent || received).getChild("forwarded", NS.forward);
        inner = fw && fw.getChild("message");
        if (!inner) return null;
        carbon = sent ? "sent" : "received";
    } else if (result) {
        if (outerFrom !== own) return null;
        if (opts.queryId && result.attrs.queryid !== opts.queryId) return null;
        var f = result.getChild("forwarded", NS.forward);
        inner = f && f.getChild("message");
        if (!inner) return null;
        archiveId = result.attrs.id || null;
        var d = f.getChild("delay", NS.delay);
        stamp = d ? Date.parse(d.attrs.stamp) : null;
    }
    var type = inner.attrs.type || "normal";
    if (type === "error" || type === "groupchat" || type === "headline") return null;
    var from = bare(inner.attrs.from || own), to = bare(inner.attrs.to || own);
    var outgoing = from === own;
    if (!stamp) {
        var delay = inner.getChild("delay", NS.delay);
        stamp = delay ? Date.parse(delay.attrs.stamp) : null;
    }
    var sid = inner.getChildren("stanza-id", NS.sid).filter(function (s) { return bare(s.attrs.by) === own; })[0];
    var origin = inner.getChild("origin-id", NS.sid);
    var body = inner.getChildText("body");
    var oob = inner.getChild("x", NS.oob);
    var url = oob ? (oob.getChildText("url") || "").trim() : "";
    var receipt = inner.getChild("received", NS.receipts);
    var displayed = inner.getChild("displayed", NS.markers);
    var state = inner.getChildElements().filter(function (c) { return c.getNS() === NS.chatStates && CHAT_STATES.indexOf(c.localName()) >= 0; })[0];
    // XEP-0380: encrypted by a scheme this client cannot read (OMEMO, OpenPGP, OTR).
    var encryption = inner.getChild("encryption", NS.eme);
    var encrypted = !!(encryption || inner.getChild("encrypted", NS.omemo) || inner.getChild("encrypted", NS.omemo2) ||
                       inner.getChild("openpgp", NS.openpgp));
    return {
        type: type, from: from, to: to, outgoing: outgoing, peer: outgoing ? to : from,
        body: body, url: url, id: inner.attrs.id || null, originId: origin ? origin.attrs.id : null,
        stanzaId: archiveId || (sid ? sid.attrs.id : null), stamp: isFinite(stamp) ? stamp : null, carbon: carbon, archiveId: archiveId,
        receiptId: receipt ? receipt.attrs.id || null : null, markerId: displayed ? displayed.attrs.id || null : null,
        chatState: state ? state.localName() : null, wantsReceipt: !!inner.getChild("request", NS.receipts),
        markable: !!inner.getChild("markable", NS.markers),
        encrypted: encrypted, encryptionName: encryption ? encryption.attrs.name || encryption.attrs.namespace : encrypted ? "OMEMO" : null
    };
}

// The message for an outgoing chat line: its db8 id as the id and the
// origin-id (XEP-0359), a receipt asked for (XEP-0184), markable
// (XEP-0333), active (XEP-0085); a picture's link also as out-of-band data
// (XEP-0066), as XEP-0363 section 4 suggests, so clients show it inline.
function chatMessage(o) {
    var m = X.el("message", { to: o.to, type: "chat", id: o.id },
                 X.el("body", {}, o.body || o.url || ""),
                 X.el("origin-id", { xmlns: NS.sid, id: o.id }),
                 X.el("request", { xmlns: NS.receipts }),
                 X.el("markable", { xmlns: NS.markers }),
                 X.el("active", { xmlns: NS.chatStates }));
    if (o.url) m.append(X.el("x", { xmlns: NS.oob }, X.el("url", {}, o.url)));
    return m;
}

function receiptFor(p) {
    return X.el("message", { to: p.from, id: "r-" + (p.id || ""), type: "chat" }, X.el("received", { xmlns: NS.receipts, id: p.id }),
                X.el("store", { xmlns: NS.hints }));
}
function displayedFor(to, id) {
    return X.el("message", { to: to, id: "d-" + id, type: "chat" }, X.el("displayed", { xmlns: NS.markers, id: id }),
                X.el("store", { xmlns: NS.hints }));
}
function chatState(to, state) {
    return X.el("message", { to: to, type: "chat" }, X.el(state, { xmlns: NS.chatStates }), X.el("no-store", { xmlns: NS.hints }));
}

// Presence: webOS availability (0 available, 1 mobile, 2 busy, 3
// invisible, 4 offline; docs) <-> <show> (RFC 6121 4.7.2.1).
function availabilityOf(p) {
    if (p.attrs.type === "unavailable") return 4;
    var show = p.getChildText("show");
    if (show === "away" || show === "xa" || show === "dnd") return 2;
    return 0;
}
function presenceFor(availability, status) {
    var p = X.el("presence");
    if (availability === 2) p.append(X.el("show", {}, "away"));
    if (status) p.append(X.el("status", {}, status));
    return p;
}

module.exports = { parseMessage: parseMessage, chatMessage: chatMessage, receiptFor: receiptFor, displayedFor: displayedFor,
                   chatState: chatState, availabilityOf: availabilityOf, presenceFor: presenceFor, bare: bare, NS: NS };
