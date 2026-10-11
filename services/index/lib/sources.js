// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the index reads, each a switch in Settings > Assistant > Search
// (all off until the user turns the index on; then on, but photos' and
// voice memos' own pictures and sound only with "Include photos and voice
// memos"):
//
//   memos       com.palm.note:1                 Memos {memoId}
//   tasks       com.palm.task:1                 Tasks {taskId}
//   events      com.palm.calendarevent:1        Calendar {showEventDetail}
//   contacts    com.palm.person:1               Contacts {id}
//   email       com.palm.email:1 and the kinds  Email {emailId}
//               that extend it (IMAP, POP, EAS,
//               any connector's)
//   messages    com.palm.message:1 and the      Messaging {threadId}
//               kinds that extend it: SMS, MMS
//               and every Synergy account's chat
//               (Jabber, Matrix, Delta Chat,
//               Telegram, any future connector:
//               the messaging contract has each
//               kind extend it), so none is named here
//   files       /media/internal through          Files {path: its folder}
//               org.webosphoenix.filemanager:
//               names, and the text of text files
//               and PDFs
//   photos      com.palm.media.image.file:1     Photos {imageList}
//               (the media indexer's): its name,
//               album and date; and the picture
//               itself through the vision encoder
//   voicememos  org.webosphoenix.voicememo:1    Voice Memos {memoId}
//               its title, date and transcript;
//               and the recording through the
//               audio encoder
//
// For each record: the passages to embed (lib/chunk.js, written as the
// model card asks: "title: ... | text: ..."), and what a result shows
// (show), read again from the record when it is found, so the index keeps
// no text.

"use strict";

var chunk = require("./chunk");

var SOURCES = [
    { id: "memos", title: "Memos", kind: "com.palm.note:1", appId: "com.palm.app.notes" },
    { id: "tasks", title: "Tasks", kind: "com.palm.task:1", appId: "org.webosphoenix.tasks" },
    { id: "events", title: "Calendar", kind: "com.palm.calendarevent:1", appId: "com.palm.app.calendar" },
    { id: "contacts", title: "Contacts", kind: "com.palm.person:1", appId: "com.palm.app.contacts" },
    { id: "email", title: "Email", kind: "com.palm.email:1", appId: "com.palm.app.email" },
    { id: "messages", title: "Messages", kind: "com.palm.message:1", appId: "org.webosphoenix.messaging" },
    { id: "files", title: "Files", files: true, appId: "org.webosphoenix.files" },
    { id: "photos", title: "Photos", kind: "com.palm.media.image.file:1", appId: "org.webosphoenix.photos", media: "image" },
    { id: "voicememos", title: "Voice Memos", kind: "org.webosphoenix.voicememo:1", appId: "org.webosphoenix.voicememos", media: "audio" }
];
function find(id) { return SOURCES.filter(function (s) { return s.id === id; })[0] || null; }

// The files whose words are read (others: their name and folder only).
var TEXT_FILES = /\.(?:txt|text|md|markdown|csv|tsv|json|xml|html?|log|ini|conf|yaml|yml|vcf|ics|srt|rtf)$/i;
var PDF = /\.pdf$/i;

var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// "Friday 9 October 2026": a date as words, so "the dentist in October" finds it.
function dayWords(ms) {
    if (!ms && ms !== 0) return "";
    var d = new Date(Number(ms));
    if (isNaN(d.getTime())) return "";
    return DAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
}
function iso(s) { var t = Date.parse(s); return isNaN(t) ? 0 : t; }

// An address as the index compares them: digits of a phone number (the
// last 10), an email or chat address in lower case.
function normAddr(a) {
    var s = String(a || "").trim().toLowerCase();
    if (!s) return "";
    if (/^[+(\d][\d\s().-]{5,}$/.test(s)) { var d = s.replace(/\D/g, ""); return d.slice(-10); }
    return s.replace(/^(?:mailto|xmpp|tel|sms):/, "");
}

function personName(p) {
    var n = p && p.name || {};
    return [n.givenName, n.familyName].filter(Boolean).join(" ") || (p && p.nickname) || "";
}
// address -> name, from the people (com.palm.person:1).
function namesOf(people) {
    var out = new Map();
    (people || []).forEach(function (p) {
        var name = personName(p);
        if (!name) return;
        [].concat(p.phoneNumbers || [], p.emails || [], p.ims || []).forEach(function (x) {
            var k = normAddr(x && x.value);
            if (k && !out.has(k)) out.set(k, name);
        });
    });
    return out;
}

function firstLine(s) { return chunk.clean(s).split("\n")[0].slice(0, 80); }
function bodyOf(email, ctx) {
    var parts = (email.parts || []).filter(function (p) { return !p.type || p.type === "body"; });
    var inline = parts.filter(function (p) { return typeof p.content === "string" && p.content; })[0];
    if (inline) return Promise.resolve(/html/i.test(inline.mimeType || "") || /<[a-z][^>]*>/i.test(inline.content) ? chunk.htmlText(inline.content) : chunk.clean(inline.content));
    var file = parts.filter(function (p) { return p.path; })[0];
    if (!file || !ctx.readText) return Promise.resolve(chunk.clean(email.summary || ""));
    return Promise.resolve(ctx.readText(file.path, 200000)).then(function (t) {
        if (!t) return chunk.clean(email.summary || "");
        return /html/i.test(file.mimeType || "") || /<[a-z][^>]*>/i.test(t) ? chunk.htmlText(t) : chunk.clean(t);
    }, function () { return chunk.clean(email.summary || ""); });
}
function nameFor(addr, ctx) { var k = normAddr(addr && addr.addr); return (addr && addr.name) || (k && ctx.names && ctx.names.get(k)) || (addr && addr.addr) || ""; }
function outgoing(m) { return /^(?:outbox|sent|draft|drafts)$/i.test(String(m.folder || "")) || m.type === "outgoing"; }

// Whether a record is left out (hidden email, a draft not yet a message).
function skip(source, r) {
    if (!r || r._del) return true;
    if (source === "email") return !!(r.flags && r.flags.visible === false);
    if (source === "messages") return !!(r.flags && r.flags.visible === false) || !String(r.messageText || "").trim();
    if (source === "tasks") return !String(r.summary || "").trim();
    if (source === "memos") return !String(r.text || r.title || "").trim();
    return false;
}

// The sender, for "what did Sam say about ...": a normalized address ("me" for one sent).
function author(source, r) {
    if (source === "messages") return outgoing(r) ? "me" : normAddr(r.from && r.from.addr);
    if (source === "email") return normAddr(r.from && r.from.addr);
    return "";
}

function timeOf(source, r) {
    switch (source) {
    case "memos": return r.modifiedTimestamp || r.createdTimestamp || 0;
    case "tasks": return r.modifiedTime || r.createdTime || 0;
    case "events": return r.dtstart || 0;
    case "email": return r.timestamp || 0;
    case "messages": return r.localTimestamp || r.timestamp || 0;
    case "photos": return r.createdTime || r.modifiedTime || 0;
    case "voicememos": return iso(r.created);
    case "files": return r.mtime || 0;
    }
    return 0;
}

function album(r) {
    var p = String(r.albumPath || r.path || "").replace(/\/[^\/]*$/, "");
    if (/\/DCIM(?:\/|$)/.test(p)) return "Camera";
    if (/\/screencaptures$/.test(p)) return "Screen captures";
    return p.replace(/^.*\//, "").replace(/[-_]+/g, " ");
}
function fileTitle(path) { return String(path || "").replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " "); }

// The document to embed for a record: {title, text} (text may be long:
// passages() cuts it).
function documentOf(source, r, ctx) {
    var when = dayWords(timeOf(source, r));
    switch (source) {
    case "memos": return Promise.resolve({ title: "", text: r.text || r.title || "" });
    case "tasks": return Promise.resolve({ title: r.summary, text: [r.summary, r.notes, r.due ? "Due " + dayWords(r.due) : "", r.completed ? "Done" : ""].filter(Boolean).join(". ") });
    case "events": return Promise.resolve({ title: r.subject || "", text: [r.subject, when, r.allDay ? "all day" : "", r.location ? "At " + r.location : "", r.note].filter(Boolean).join(". ") });
    case "contacts": {
        var org = r.organization || (r.organizations || [])[0] || {};
        var lines = [personName(r), r.nickname ? "Known as " + r.nickname : "", org.name ? [org.title, org.name].filter(Boolean).join(" at ") : "",
                     (r.emails || []).map(function (e) { return e.value; }).join(", "), (r.phoneNumbers || []).map(function (e) { return e.value; }).join(", "),
                     (r.addresses || []).map(function (a) { return [a.streetAddress, a.locality, a.region, a.country].filter(Boolean).join(" "); }).join("; "),
                     r.birthday ? "Birthday " + r.birthday : "", r.note || r.notes || ""];
        return Promise.resolve({ title: personName(r), text: lines.filter(Boolean).join(". ") });
    }
    case "email":
        return bodyOf(r, ctx).then(function (body) {
            return { title: r.subject || "", text: headerOf("email", r, ctx) + " " + body };
        });
    case "messages":
        return Promise.resolve({ title: "", text: headerOf("messages", r, ctx) + " " + (r.messageText || "") });
    case "photos": {
        var name = r.title || fileTitle(r.path);
        return Promise.resolve({ title: name, text: ["Photo " + name, album(r) ? "in the album " + album(r) : "", when ? "taken " + when : "",
                                                       r.place || r.locationName || ""].filter(Boolean).join(", ") });
    }
    case "voicememos": {
        var said = r.transcript && !r.transcript.placeholder ? r.transcript.text : "";
        return Promise.resolve({ title: r.title || "", text: ["Voice memo " + (r.title || ""), when, said].filter(Boolean).join(". ") });
    }
    case "files": {
        var folder = String(r.path || "").replace(/\/[^\/]*$/, "").replace(/^\/media\/internal\/?/, "") || "Internal storage";
        var head = r.name + " in " + folder;
        return Promise.resolve(r.text ? { title: r.name, text: head + ". " + r.text } : { title: r.name, text: head });
    }
    }
    return Promise.resolve({ title: "", text: "" });
}

// [{input, plain}]: the passages (input as the model reads a document).
// What documentOf puts before an email's or a message's words to say who
// wrote it ("From {who}." and "{who}:", the words of a passage, one space
// apart): the model reads who, and a result, which shows who apart, leaves
// it out of its snippet.
function headerOf(source, r, ctx) {
    ctx = ctx || {};
    var h = source === "email" ? "From " + nameFor(r.from, ctx) + "."
        : source === "messages" ? (outgoing(r) ? "Me to " + nameFor((r.to || [])[0], ctx) : nameFor(r.from, ctx)) + ":" : "";
    return h.split(/\s+/).filter(Boolean).join(" ");
}

function passagesOf(source, r, ctx) {
    return documentOf(source, r, ctx || {}).then(function (doc) {
        return chunk.passages(doc.text).map(function (p) { return { input: chunk.documentInput(doc.title, p.text), plain: p.text }; });
    });
}

// The picture or recording to embed itself (with "Include photos and voice memos").
function mediaOf(source, r) {
    if (source === "photos" && r.path) return { type: "image", path: r.path, mime: r.mimeType || (/\.png$/i.test(r.path) ? "image/png" : "image/jpeg") };
    if (source === "voicememos" && r.path) return { type: "audio", path: r.path, mime: r.mimeType || "audio/wav", duration: r.duration || 0 };
    return null;
}

// What a result shows and opens: {title, who, place, time, allDay, path, params}.
function show(source, r, ctx) {
    var t = timeOf(source, r);
    switch (source) {
    case "memos": return { title: firstLine(r.text || r.title), time: t, params: { memoId: r._id } };
    case "tasks": return { title: r.summary || "", time: r.due || t, allDay: !!r.allDay, params: { taskId: r._id } };
    case "events": return { title: r.subject || "", time: r.dtstart, allDay: !!r.allDay, place: r.location || "", params: { showEventDetail: r._id } };
    case "contacts": {
        var org = r.organization || (r.organizations || [])[0] || {};
        return { title: personName(r), place: org.name || "", params: { id: r._id } };
    }
    case "email": return { title: r.subject || "(no subject)", who: nameFor(r.from, ctx), time: t, params: { emailId: r._id } };
    case "messages": return { title: outgoing(r) ? "You" : nameFor(r.from, ctx), who: outgoing(r) ? nameFor((r.to || [])[0], ctx) : "", time: t,
                              params: r.threadId ? { threadId: r.threadId } : {} };
    case "photos": return { title: r.title || fileTitle(r.path), place: album(r), time: t, path: r.path,
                            params: { imageList: { results: [{ file_path: r.path }] } } };
    case "voicememos": return { title: r.title || "", time: t, params: { memoId: r._id } };
    case "files": return { title: r.name || fileTitle(r.path), place: String(r.path || "").replace(/\/[^\/]*$/, "").replace(/^\/media\/internal/, "Internal storage"),
                           time: t, path: r.path, params: { path: String(r.path || "").replace(/\/[^\/]*$/, "") || "/media/internal" } };
    }
    return { title: "", params: {} };
}

module.exports = { SOURCES: SOURCES, find: find, skip: skip, author: author, timeOf: timeOf, passagesOf: passagesOf, documentOf: documentOf, headerOf: headerOf,
                   mediaOf: mediaOf, show: show, namesOf: namesOf, normAddr: normAddr, dayWords: dayWords, TEXT_FILES: TEXT_FILES, PDF: PDF };
