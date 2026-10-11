// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Synergy as the Assistant sees it: the accounts connected through it and
// what each can do, found on the device at the time of asking, never from
// a list of connectors written here. A connector added later, a third
// party's included, works with the Assistant as soon as its account is
// signed in, wherever it keeps its data in Synergy's standard kinds:
//
//   the accounts    com.palm.service.accounts listAccounts: each account
//                   annotated with its template (app-services
//                   com.palm.service.accounts Account.annotate), so each
//                   capability provider says what it is: capability
//                   (MESSAGING, CALENDAR, TASKS, MAIL, DOCUMENTS, ...),
//                   capabilitySubtype (IM), serviceName ("type_jabber"),
//                   dbkinds ({immessage, calendarevent, task, ...}),
//                   loc_name, loc_shortName, readOnlyData
//   the data        the standard kinds and the kinds that extend them:
//                   com.palm.immessage:1 and com.palm.chatthread:1
//                   (messages), com.palm.calendar:1 and
//                   com.palm.calendarevent:1, com.palm.tasklist:1 and
//                   com.palm.task:1, com.palm.mail.account:1,
//                   com.palm.folder:1 and com.palm.email:1, each with the
//                   account's accountId (or, for email, its folder's)
//   posting         an app's appinfo.json "phoenix".shareTargets entry
//                   with a connector ({templateId, service, accepts,
//                   audience, accountLabel}: connector-kit share.ts), and
//                   the service's share method
//   drives          the file manager's /media/drives/<accountId> for every
//                   account with DOCUMENTS (connector-kit drives.ts)
//
// What people call an account ("my work account", "Slack", "my Google
// calendar") is matched against the account's own names: its template's
// name, its providers' short names, its alias and its user name, and the
// language's other words for a service (lib/lang/en-synergy.js SERVICES:
// "Gmail" for Google, "Mastodon" for the Fediverse).

"use strict";

var ACCOUNTS = "luna://com.palm.service.accounts/";
var DB = "luna://com.palm.db/";

// The IM transports Phoenix had before the accounts service described
// them to the Assistant (their login states, com.palm.imloginstate:1):
// used only for an account the accounts service does not list.
var KNOWN_IM = {
    type_jabber: { kind: "com.palm.immessage.xmpp:1", label: "Jabber" },
    type_matrix: { kind: "com.palm.immessage.matrix:1", label: "Matrix" },
    type_deltachat: { kind: "com.palm.immessage.deltachat:1", label: "Delta Chat" },
    type_telegram: { kind: "com.palm.immessage.telegram:1", label: "Telegram" }
};

// Words of a provider's name that name no service ("Messages and
// channels", "People you follow"): such a name is not one people call the
// account by.
// ("To Do", Microsoft's tasks, as generic as "Tasks": "my to do list" is the
// phone's own default list, lib/commands.js listKey.)
var GENERIC = /^(?:contacts?|calendars?|tasks?|to|do|to-?dos?|notifications?|messages?|messaging|and|channels?|direct|people|you|follow|files?|e-?mail|mail|chats?|workspace|the|im|text|sms|memos?|phone|voice|storage|local|documents?|feeds?|news|entries|posts?)$/;
// Account words that are no one's name for it.
var NOISE = /^(?:com|org|net|io|me|example|www|mail|the|my|account|app)$/;

function ok(r) { return r && r.returnValue !== false; }
function call(env, uri, params) {
    return Promise.resolve(env.luna.call(uri, params || {})).then(function (r) { return ok(r) ? r : null; }, function () { return null; });
}
function find(env, kind, where) {
    var q = { from: kind, limit: 500 };
    if (where) q.where = where;
    return call(env, DB + "find", { query: q }).then(function (r) { return ((r && r.results) || []).filter(function (o) { return o && !o._del; }); });
}
function lower(s) { return String(s || "").toLowerCase().trim(); }
function squash(s) { return lower(s).replace(/[^a-z0-9À-￿]+/g, ""); }
function wordsOf(s) { return lower(s).replace(/[^a-z0-9À-￿@.+#]+/g, " ").trim().split(" ").filter(Boolean); }

// ---- The accounts -----------------------------------------------------------------------------

// One capability provider, as the template describes it.
function capOf(p) {
    return { id: p.id || "", capability: String(p.capability || ""), subtype: String(p.capabilitySubtype || ""),
             serviceName: String(p.serviceName || ""), name: String(p.loc_name || ""), shortName: String(p.loc_shortName || ""),
             kinds: p.dbkinds || p.db_kinds || {}, readOnly: !!p.readOnlyData, implementation: String(p.implementation || ""),
             subKind: String(p.subKind || "") };
}
// The names one account goes by, as phrases (lower case).
function phrasesOf(a) {
    var out = [];
    function add(s) { s = lower(s).replace(/\s+/g, " "); if (s && out.indexOf(s) < 0) out.push(s); }
    var name = String(a.provider || "");
    add(name);
    // "Jabber (XMPP)": both.
    var paren = /^(.+?)\s*\((.+)\)$/.exec(name);
    if (paren) { add(paren[1]); add(paren[2]); }
    a.caps.forEach(function (c) {
        [c.shortName, c.name].forEach(function (n) {
            if (n && !wordsOf(n).every(function (w) { return GENERIC.test(w); })) add(n);
        });
    });
    if (a.alias && lower(a.alias) !== lower(name)) add(a.alias);
    if (a.username) add(a.username);
    return out;
}
function accountWords(a) {
    var w = {};
    a.phrases.forEach(function (p) { wordsOf(p).forEach(function (x) { w[x] = true; }); });
    // A user name's parts ("jordan@northwind.example": northwind).
    String(a.username || "").toLowerCase().split(/[^a-z0-9À-￿]+/).forEach(function (x) { if (x.length > 2 && !NOISE.test(x)) w[x] = true; });
    return w;
}
// The template's providers merged with the account's, as Account.annotate
// does (listAccounts already gives them annotated; a bare db8 record is
// completed from the templates).
function model(rec, template) {
    var t = template || {};
    var provs = (rec.capabilityProviders || []).map(function (c) {
        var full = (t.capabilityProviders || []).filter(function (x) { return x.id === c.id; })[0] || {};
        return capOf(Object.assign({}, full, c, { dbkinds: c.dbkinds || full.dbkinds, loc_name: c.loc_name || full.loc_name,
                                                  loc_shortName: c.loc_shortName || full.loc_shortName, serviceName: c.serviceName || full.serviceName,
                                                  capabilitySubtype: c.capabilitySubtype || full.capabilitySubtype, readOnlyData: c.readOnlyData || full.readOnlyData,
                                                  implementation: c.implementation || full.implementation }));
    });
    var a = { id: rec._id, templateId: String(rec.templateId || ""), provider: String(rec.loc_name || t.loc_name || rec.templateId || ""),
              alias: String(rec.alias || ""), username: String(rec.username || ""), caps: provs, record: rec };
    a.phrases = phrasesOf(a);
    a.words = accountWords(a);
    return a;
}
// Every account and what it can do: [{id, templateId, provider, alias,
// username, caps: [cap], phrases, words, label}]. Kept on env for the turn.
function accounts(env) {
    if (env.__synergyAccounts) return env.__synergyAccounts;
    var p = call(env, ACCOUNTS + "listAccounts", {}).then(function (r) {
        var list = ((r && r.results) || []).filter(function (a) { return a && a._id && !a.beingDeleted; }).map(function (a) { return model(a); });
        // IM accounts the accounts service did not describe: their login states (KNOWN_IM).
        return find(env, "com.palm.imloginstate:1").then(function (states) {
            states.forEach(function (s) {
                var known = KNOWN_IM[s.serviceName];
                var has = list.filter(function (a) { return a.id === s.accountId; })[0];
                if (has) {
                    has.caps.forEach(function (c) { if (c.serviceName === s.serviceName && !c.imUsername) c.imUsername = String(s.username || ""); });
                    return;
                }
                if (!known) return;
                list.push(model({ _id: s.accountId || "im:" + s.serviceName + ":" + s.username, templateId: "", loc_name: known.label, username: s.username,
                                  capabilityProviders: [{ id: s.serviceName, capability: "MESSAGING", capabilitySubtype: "IM", serviceName: s.serviceName,
                                                          dbkinds: { immessage: known.kind }, loc_shortName: known.label }] }));
                list[list.length - 1].caps[0].imUsername = String(s.username || "");
            });
            labelAll(list);
            return list;
        });
    });
    env.__synergyAccounts = p;
    return p;
}
// How each is named back: name, what the user called it (its alias) or its
// service ("Work", "Slack"); label, which one it is among the others ("Work
// (Microsoft)", "Slack (jordan@northwind)" when there are two).
function labelAll(list) {
    list.forEach(function (a) {
        var same = list.filter(function (b) { return b.provider === a.provider; });
        var aliased = a.alias && lower(a.alias) !== lower(a.provider);
        a.name = aliased ? a.alias : a.provider;
        a.label = aliased ? a.alias + " (" + a.provider + ")" : same.length > 1 ? a.provider + " (" + (a.username || a.id) + ")" : a.provider;
        a.several = same.length > 1;
    });
}
function withCap(list, capability, test) {
    return list.filter(function (a) { return a.caps.some(function (c) { return c.capability === capability && (!test || test(c)); }); });
}
function capIn(a, capability, test) {
    return a.caps.filter(function (c) { return c.capability === capability && (!test || test(c)); })[0] || null;
}

// What the grammar needs to know a phrase is an account (lib/grammar.js
// ctx.accounts): [{phrases, caps: [capability]}].
function vocabulary(env) {
    return accounts(env).then(function (list) {
        return list.map(function (a) {
            return { phrases: a.phrases, caps: a.caps.map(function (c) { return c.capability; }), label: a.label };
        });
    }, function () { return []; });
}

// The accounts the words name, the best fits only: [account]. said: "my
// work account", "Slack", "google calendar" (the capability word is
// left to the caller). canon(words) -> words: the language's names for
// services ("gmail" -> "google").
function named(list, said, canon) {
    var s = lower(said).replace(/^(?:my|the|our|your)\s+/, "").replace(/'s$/, "").replace(/\s+(?:account|accounts|app|workspace|profile)$/, "").trim();
    if (!s) return [];
    var forms = [s];
    var c = canon ? canon(s) : s;
    if (c && c !== s) forms.push(c);
    var exact = list.filter(function (a) {
        return forms.some(function (f) { return a.phrases.some(function (p) { return squash(p) === squash(f); }); });
    });
    if (exact.length) return exact;
    return list.filter(function (a) {
        return forms.some(function (f) {
            var w = wordsOf(f).filter(function (x) { return !NOISE.test(x); });
            return w.length > 0 && w.every(function (x) { return a.words[x] || a.words[x.replace(/s$/, "")]; });
        });
    });
}

// ---- Messaging --------------------------------------------------------------------------------

// The IM accounts: [{account, service, kind, label, username}], one per
// MESSAGING provider with a serviceName and a message kind (the IM
// transports' contract: docs/SYNERGY-CONNECTORS.md 7).
function imAccounts(env) {
    return accounts(env).then(function (list) {
        var out = [];
        list.forEach(function (a) {
            a.caps.forEach(function (c) {
                if (c.capability !== "MESSAGING" || !c.serviceName || !/^type_/.test(c.serviceName)) return;
                var kind = c.kinds.immessage || (KNOWN_IM[c.serviceName] || {}).kind;
                if (!kind) return;
                out.push({ account: a, service: c.serviceName, kind: kind, label: c.shortName || a.provider,
                           username: c.imUsername || a.username });
            });
        });
        // Two accounts on one network: each named ("Slack (Northwind)").
        out.forEach(function (x) {
            var same = out.filter(function (y) { return y.service === x.service; });
            x.several = same.length > 1;
            x.shown = x.several ? x.label + " (" + (x.account.alias && x.account.alias !== x.account.provider ? x.account.alias : x.username) + ")" : x.label;
        });
        return out;
    });
}
// The conversations (com.palm.chatthread:1), newest first.
function threads(env) {
    return find(env, "com.palm.chatthread:1").then(function (all) {
        return all.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    });
}

// ---- Calendars, lists, mail -------------------------------------------------------------------

// The calendars, each with its account: [{calendar, account|null, eventKind, writable}].
// The kind of an account's new event is its template's CALENDAR provider's
// dbkinds.calendarevent (com.palm.app.calendar CalendarsManager.js:320-337
// findAccountSubkind), else com.palm.calendarevent:1.
function calendars(env) {
    return Promise.all([accounts(env), find(env, "com.palm.calendar:1")]).then(function (got) {
        var byId = {};
        got[0].forEach(function (a) { byId[a.id] = a; });
        return got[1].map(function (c) {
            var a = byId[c.accountId] || null, cap = a ? capIn(a, "CALENDAR") : null;
            var kind = cap && (cap.kinds.calendarevent || cap.subKind);
            return { calendar: c, account: a, eventKind: kind && /^[\w.-]+:\d+$/.test(kind) ? kind : "com.palm.calendarevent:1",
                     writable: !c.isReadOnly && !(cap && cap.readOnly) };
        });
    });
}
// The task lists, each with its account: [{list, account|null}].
function taskLists(env) {
    return Promise.all([accounts(env), find(env, "com.palm.tasklist:1")]).then(function (got) {
        var byId = {};
        got[0].forEach(function (a) { byId[a.id] = a; });
        return got[1].map(function (l) { return { list: l, account: byId[l.accountId] || null }; });
    });
}
// The mail accounts: [{mail (com.palm.mail.account:1), account, folders: [folder], addresses: [lower]}].
function mailAccounts(env) {
    return Promise.all([accounts(env), find(env, "com.palm.mail.account:1"), find(env, "com.palm.folder:1")]).then(function (got) {
        var byId = {};
        got[0].forEach(function (a) { byId[a.id] = a; });
        return got[1].map(function (m) {
            var a = byId[m.accountId] || model({ _id: m.accountId || m._id, loc_name: "Email", username: m.email || m.username || "", alias: m.alias || "" });
            if (!a.label) labelAll([a]);
            return { mail: m, account: a, folders: got[2].filter(function (f) { return f.accountId === m.accountId; }),
                     addresses: [m.email, m.username, a.username].filter(Boolean).map(lower) };
        });
    });
}
// Every address the user is known by (their accounts' user names and mail
// addresses): who "me" is among an event's attendees.
function ownAddresses(env) {
    return Promise.all([accounts(env), find(env, "com.palm.mail.account:1")]).then(function (got) {
        var out = {};
        got[0].forEach(function (a) { if (/@/.test(a.username)) out[lower(a.username)] = true; });
        got[1].forEach(function (m) { [m.email, m.username].forEach(function (x) { if (x) out[lower(x)] = true; }); });
        return out;
    });
}

// ---- Posting ----------------------------------------------------------------------------------

// The accounts that take a post: every installed app's connector share
// target (appinfo.json "phoenix".shareTargets[].connector), once per
// signed-in account of its template. -> [{account, target, label, appId, as}]
// The apps: the application manager's (services/appmanager on a device,
// with SAM's "phoenix" property; the simulator's launch point records
// carry shareTargets), as the share sheet reads them.
function shareTargets(env) {
    var apps = call(env, "luna://com.palm.applicationManager/listApps", {}).then(function (r) { return (r && r.apps) || []; });
    return Promise.all([accounts(env), apps]).then(function (got) {
        var out = [];
        got[1].forEach(function (app) {
            var decl = (app.phoenix && app.phoenix.shareTargets) || app.shareTargets || [];
            decl.forEach(function (d) {
                var c = d && d.connector;
                if (!c || !c.templateId || !c.service) return;
                got[0].filter(function (a) { return a.templateId === c.templateId; }).forEach(function (a) {
                    out.push({ account: a, target: c, label: String(d.label || app.title || a.provider), appId: app.id,
                               as: String(c.accountLabel || "{username}").replace(/\{(\w+)\}/g, function (m, k) { return String(a.record[k] || ""); }) });
                });
            });
        });
        return out;
    });
}

// ---- Drives -----------------------------------------------------------------------------------

var DRIVES = "/media/drives";
// The drives: every account with DOCUMENTS, at /media/drives/<accountId>.
function drives(env) {
    return accounts(env).then(function (list) {
        return withCap(list, "DOCUMENTS").map(function (a) { return { account: a, path: DRIVES + "/" + a.id }; });
    });
}

// ---- Meetings ---------------------------------------------------------------------------------
// A meeting's address in an event (connector-kit pim.ts joinUrlOf: Teams,
// Zoom, Meet, Webex, Jitsi), its joinUrl or url first.
var MEETING = /https:\/\/(?:[a-z0-9-]+\.)*(?:teams\.microsoft\.com\/l\/meetup-join|teams\.live\.com\/meet|zoom\.us\/(?:j|my|w)|zoomgov\.com\/j|meet\.google\.com|[a-z0-9-]+\.webex\.com\/(?:meet|join|[a-z0-9-]+\/j\.php)|meet\.jit\.si)[^\s<>"')\]]*/i;
function joinUrlOf(ev) {
    if (!ev) return "";
    if (ev.joinUrl && /^https:\/\//i.test(ev.joinUrl)) return String(ev.joinUrl);
    var texts = [ev.url, ev.location, ev.note];
    for (var i = 0; i < texts.length; ++i) {
        var m = MEETING.exec(String(texts[i] || ""));
        if (m) return m[0];
    }
    return "";
}
// Which service a meeting's address is ("Zoom", "Microsoft Teams", "Google Meet", ...).
function meetingService(url) {
    var u = lower(url);
    if (/zoom(?:gov)?\.(?:us|com)/.test(u)) return "Zoom";
    if (/teams\.(?:microsoft|live)\.com/.test(u)) return "Microsoft Teams";
    if (/meet\.google\.com/.test(u)) return "Google Meet";
    if (/webex\.com/.test(u)) return "Webex";
    if (/meet\.jit\.si/.test(u)) return "Jitsi Meet";
    return "the meeting";
}

module.exports = {
    accounts: accounts, vocabulary: vocabulary, named: named, withCap: withCap, capIn: capIn,
    imAccounts: imAccounts, threads: threads, calendars: calendars, taskLists: taskLists, mailAccounts: mailAccounts,
    ownAddresses: ownAddresses, shareTargets: shareTargets, drives: drives, DRIVES: DRIVES,
    joinUrlOf: joinUrlOf, meetingService: meetingService, MEETING: MEETING, KNOWN_IM: KNOWN_IM,
    find: find, squash: squash, wordsOf: wordsOf, model: model, labelAll: labelAll
};
